import { ErrorDominio } from './errores.ts';
import { ventas } from './proyecciones.ts';
import type { Actor, Op } from './tipos.ts';
import { aMXN, fechaLocal } from './util.ts';

export interface RefCaja {
  tienda: string;
  caja: number;
}
export interface Filtro {
  cajas?: RefCaja[];
  desde?: string; // YYYY-MM-DD local America/Hermosillo, inclusive
  hasta?: string;
}

export interface FilaVenta {
  tienda: string;
  caja: number;
  folio: number; // folio ORIGINAL de la serie: nunca se renumera
  sale_id: string;
  fecha_local: string;
  cajero: string;
  total: number;
  /** Total sin las tarjetas de regalo vendidas o recargadas (que no son ventas de mercancía). */
  total_mercancia: number;
  estado: 'confirmada' | 'cancelada';
}

const mismaCaja = (a: RefCaja, b: RefCaja) => a.tienda === b.tienda && a.caja === b.caja;

/** Resuelve qué cajas puede consultar el actor. El cajero NUNCA ve más que la suya. */
function cajasPermitidas(actor: Actor, f: Filtro): RefCaja[] | 'todas' {
  if (actor.rol === 'cajero') {
    const propia = { tienda: actor.tienda, caja: actor.caja };
    if (f.cajas && f.cajas.some((c) => !mismaCaja(c, propia))) {
      throw new ErrorDominio('PROHIBIDO', `el cajero ${actor.usuario} solo consulta su propia caja`);
    }
    return [propia];
  }
  return f.cajas ?? 'todas';
}

function enPeriodo(iso: string, f: Filtro) {
  const d = fechaLocal(iso);
  return (!f.desde || d >= f.desde) && (!f.hasta || d <= f.hasta);
}

export function ventasPorCaja(actor: Actor, ops: Op[], f: Filtro = {}): FilaVenta[] {
  const permitidas = cajasPermitidas(actor, f);
  const filas: FilaVenta[] = [];
  for (const v of ventas(ops).values()) {
    if (permitidas !== 'todas' && !permitidas.some((c) => mismaCaja(c, v))) continue;
    if (!enPeriodo(v.ocurrio_en, f)) continue;
    filas.push({
      tienda: v.tienda, caja: v.caja, folio: v.folio, sale_id: v.sale_id,
      fecha_local: fechaLocal(v.ocurrio_en), cajero: v.cajero, total: v.total, total_mercancia: v.lineas.filter((l) => !l.tarjeta_regalo).reduce((a, l) => a + l.importe, 0), estado: v.estado,
    });
  }
  // Orden estable por serie y folio: se ordena, pero nunca se asigna un número nuevo.
  return filas.sort((a, b) => a.tienda.localeCompare(b.tienda) || a.caja - b.caja || a.folio - b.folio);
}

export interface Consolidado {
  filas: FilaVenta[];
  porCaja: { tienda: string; caja: number; tickets: number; total: number; total_mercancia: number }[];
  total: number;
  /** Consolidado SIN tarjetas de regalo: así lo cobrado con una tarjeta no se cuenta dos veces. */
  total_mercancia: number;
}

/** Solo Administración: consolidado de todas las cajas o de las seleccionadas (incluso de tiendas distintas). */
export function reporteConsolidado(actor: Actor, ops: Op[], f: Filtro = {}): Consolidado {
  if (actor.rol !== 'admin') throw new ErrorDominio('PROHIBIDO', 'los reportes consolidados son solo de Administración');
  const filas = ventasPorCaja(actor, ops, f);
  const porCaja = new Map<string, { tienda: string; caja: number; tickets: number; total: number; total_mercancia: number }>();
  for (const r of filas) {
    if (r.estado === 'cancelada') continue;
    const k = `${r.tienda}/${r.caja}`;
    const a = porCaja.get(k) ?? { tienda: r.tienda, caja: r.caja, tickets: 0, total: 0, total_mercancia: 0 };
    a.tickets++;
    a.total += r.total;
    a.total_mercancia += r.total_mercancia;
    porCaja.set(k, a);
  }
  const lista = [...porCaja.values()];
  return { filas, porCaja: lista, total: lista.reduce((a, c) => a + c.total, 0), total_mercancia: lista.reduce((a, c) => a + c.total_mercancia, 0) };
}

export interface FilaCorte {
  tienda: string;
  caja: number;
  fecha: string;
  tickets: number;
  ventas_netas: number;
  efectivo_esperado: number;
  folio_inicial: number | null;
  folio_final: number | null;
  /** Dinero FÍSICO por moneda (pesos y dólares nunca se mezclan). Los cortes guardados antes de existir los dólares no traen estos campos. */
  mxn?: ResumenMoneda;
  usd?: ResumenMoneda & {
    /** Equivalente CONTABLE en MXN con la tasa de cada operación: no es dinero físico del cajón. */
    equivalente_historico_mxn: number;
  };
  ventas_anuladas_antes_de_cobro?: number;
  cancelaciones_posteriores_al_cobro?: number;
  billetes_usd_rechazados?: number;
}
export interface ResumenMoneda {
  fondo: number;
  cobros: number;
  cambio: number;
  entradas: number;
  devoluciones: number;
  cancelaciones: number;
  retiros: number;
  esperado: number;
  contado: number | null;
  diferencia: number | null;
}

export function cortesPorCaja(actor: Actor, ops: Op[], f: Filtro = {}): FilaCorte[] {
  const permitidas = cajasPermitidas(actor, f);
  return ops
    .filter((o) => o.tipo === 'corte.generado')
    .map((o) => o.payload as FilaCorte)
    .filter((c) => (permitidas === 'todas' || permitidas.some((p) => mismaCaja(p, c))) &&
      (!f.desde || c.fecha >= f.desde) && (!f.hasta || c.fecha <= f.hasta))
    .sort((a, b) => a.fecha.localeCompare(b.fecha) || a.tienda.localeCompare(b.tienda) || a.caja - b.caja);
}

/** Filas listas para Excel: códigos/lotes como texto, importes como texto decimal exacto. */
export function aFilasExportables(filas: FilaVenta[]) {
  return filas.map((r) => ({
    Tienda: r.tienda, Caja: r.caja, Folio: r.folio, Fecha: r.fecha_local,
    Cajero: r.cajero, 'Total MXN': aMXN(r.total), Estado: r.estado,
  }));
}

export interface BusquedaVentas {
  /** Instantes UTC ISO, inclusive. */
  desde?: string;
  hasta?: string;
  item_id?: string;
  folio?: number;
}
/** Lo que se muestra de una venta de OTRA caja para localizarla: nunca importes, pagos ni cajero. */
export interface VentaLocalizada {
  sale_id: string;
  tienda: string;
  caja: number;
  folio: number;
  ocurrio_en: string;
  lineas: { linea_id: string; item_id: string; descripcion: string; qty: number }[];
}
/** Ventas confirmadas de UNA tienda (todas sus cajas) que cumplen la búsqueda. Solo para localizar en qué caja se vendió. */
export function localizarVentas(ops: Op[], tienda: string, q: BusquedaVentas): VentaLocalizada[] {
  const out: VentaLocalizada[] = [];
  for (const v of ventas(ops).values()) {
    if (v.tienda !== tienda || v.estado !== 'confirmada') continue;
    if (q.desde && v.ocurrio_en < q.desde) continue;
    if (q.hasta && v.ocurrio_en > q.hasta) continue;
    if (q.folio != null && v.folio !== q.folio) continue;
    if (q.item_id && !v.lineas.some((l) => l.item_id === q.item_id)) continue;
    out.push({
      sale_id: v.sale_id, tienda: v.tienda, caja: v.caja, folio: v.folio, ocurrio_en: v.ocurrio_en,
      lineas: v.lineas.map((l) => ({ linea_id: l.linea_id, item_id: l.item_id, descripcion: l.descripcion, qty: l.qty })),
    });
  }
  return out.sort((a, b) => b.ocurrio_en.localeCompare(a.ocurrio_en)).slice(0, 100);
}

/** Un cobro con dólares: lo físico recibido y su equivalente con la tasa de ESA operación (nunca la última del día). */
export interface FilaDolares {
  tienda: string;
  caja: number;
  folio: number;
  sale_id: string;
  fecha_local: string;
  hora: string;
  cajero: string;
  usd: number;
  tasa: number;
  tasa_version: number;
  equivalente: number;
  pesos_recibidos: number;
  cambio_mxn: number;
  total_venta: number;
  estado: 'confirmada' | 'cancelada';
}
export interface ReporteDolares {
  filas: FilaDolares[];
  porCaja: { tienda: string; caja: number; cobros: number; usd: number; equivalente_historico: number }[];
  usd: number;
  equivalente_historico: number;
}
export function dolaresPorCaja(actor: Actor, ops: Op[], f: Filtro = {}): ReporteDolares {
  const permitidas = cajasPermitidas(actor, f);
  const filas: FilaDolares[] = [];
  for (const v of ventas(ops).values()) {
    if (permitidas !== 'todas' && !permitidas.some((c) => mismaCaja(c, v))) continue;
    if (!enPeriodo(v.ocurrio_en, f)) continue;
    for (const p of v.pagos) {
      if (p.metodo !== 'efectivo_usd') continue;
      const local = new Date(Date.parse(v.ocurrio_en) - 7 * 3600_000).toISOString();
      filas.push({
        tienda: v.tienda, caja: v.caja, folio: v.folio, sale_id: v.sale_id, fecha_local: fechaLocal(v.ocurrio_en), hora: local.slice(11, 16), cajero: v.cajero,
        usd: p.usd!, tasa: p.tasa!, tasa_version: p.tasa_version!, equivalente: p.equivalente!, pesos_recibidos: p.pesos_recibidos!, cambio_mxn: p.cambio_mxn!,
        total_venta: v.total, estado: v.estado,
      });
    }
  }
  filas.sort((a, b) => a.tienda.localeCompare(b.tienda) || a.caja - b.caja || a.folio - b.folio);
  const por = new Map<string, ReporteDolares['porCaja'][number]>();
  for (const r of filas) {
    // Una venta cancelada SÍ suma: los dólares recibidos siguen en el cajón (el reembolso fue en pesos). La fila la marca como cancelada.
    const k = `${r.tienda}/${r.caja}`;
    const a = por.get(k) ?? { tienda: r.tienda, caja: r.caja, cobros: 0, usd: 0, equivalente_historico: 0 };
    a.cobros++; a.usd += r.usd; a.equivalente_historico += r.equivalente;
    por.set(k, a);
  }
  const porCaja = [...por.values()];
  return { filas, porCaja, usd: porCaja.reduce((a, c) => a + c.usd, 0), equivalente_historico: porCaja.reduce((a, c) => a + c.equivalente_historico, 0) };
}
