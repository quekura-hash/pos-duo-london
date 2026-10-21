import { ErrorDominio } from './errores.ts';
import { devoluciones, ventas } from './proyecciones.ts';
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
  /** Incluir las ventas históricas del POS anterior (por omisión sí). */
  historicas?: boolean;
  /** Solo estas tiendas (además de `cajas`, si viene). */
  tiendas?: string[];
}

export interface FilaVenta {
  tienda: string;
  caja: number;
  folio: number; // folio ORIGINAL de la serie: nunca se renumera
  sale_id: string;
  fecha_local: string;
  cajero: string;
  /** Quién atendió la venta («Autocompra» si nadie ayudó; vacío en ventas anteriores a este registro). */
  vendedora: string;
  total: number;
  /** Total sin las tarjetas de regalo vendidas o recargadas (que no son ventas de mercancía). */
  total_mercancia: number;
  estado: 'confirmada' | 'cancelada';
  /** Piezas de mercancía del ticket (sin tarjetas de regalo). */
  piezas: number;
  /** Forma de pago en español: Efectivo, Tarjeta, Dólares, Tarjeta de regalo… o Mixto. */
  pago: string;
  /** Venta normal, cambio sin diferencia o fee por daño (estos dos últimos solo vienen de las históricas). */
  tipo_ticket: 'venta' | 'cambio' | 'fee';
  /** true = viene del POS anterior (importada), no de esta caja. */
  historico: boolean;
  /** Hora local HH:MM (las históricas no la traen). */
  hora: string;
  /** Cuánto se cobró por cada forma de pago (centavos MXN). `mixto` = pago mixto de una venta histórica sin desglose. */
  montos: MontosPago;
}
export interface MontosPago { efectivo: number; tarjeta: number; dolares: number; tarjeta_regalo: number; otro: number; mixto: number }
const sinMontos = (): MontosPago => ({ efectivo: 0, tarjeta: 0, dolares: 0, tarjeta_regalo: 0, otro: 0, mixto: 0 });

const ETIQUETA_PAGO: Record<string, string> = { efectivo: 'Efectivo', tarjeta: 'Tarjeta', efectivo_usd: 'Dólares', tarjeta_regalo: 'Tarjeta de regalo', credito_cambio: 'Crédito de cambio', mixto: 'Mixto', sin_pago: 'Sin pago' };
/** Una sola forma de pago → su nombre; varias distintas → «Mixto». */
export function etiquetaPago(metodos: string[]): string {
  const u = [...new Set(metodos)];
  return u.length === 0 ? 'Sin pago' : u.length === 1 ? (ETIQUETA_PAGO[u[0]!] ?? u[0]!) : 'Mixto';
}

const mismaCaja = (a: RefCaja, b: RefCaja) => a.tienda === b.tienda && a.caja === b.caja;

/** Resuelve qué cajas puede consultar el actor. El cajero NUNCA ve más que la suya. */
function cajasPermitidas(actor: Actor, f: Filtro): RefCaja[] | 'todas' {
  if (actor.rol === 'cajero') {
    const propia = { tienda: actor.tienda, caja: actor.caja };
    if (f.cajas && f.cajas.some((c) => !mismaCaja(c, propia))) {
      throw new ErrorDominio('PROHIBIDO', `la Vendedora-Cajera ${actor.usuario} solo consulta su propia caja`);
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
    if (f.tiendas && !f.tiendas.includes(v.tienda)) continue;
    if (!enPeriodo(v.ocurrio_en, f)) continue;
    filas.push({
      tienda: v.tienda, caja: v.caja, folio: v.folio, sale_id: v.sale_id,
      fecha_local: fechaLocal(v.ocurrio_en), cajero: v.cajero, vendedora: v.vendedora === undefined ? '' : v.vendedora_id ? v.vendedora : 'Autocompra', total: v.total, total_mercancia: v.lineas.filter((l) => !l.tarjeta_regalo).reduce((a, l) => a + l.importe, 0), estado: v.estado,
      piezas: v.lineas.filter((l) => !l.tarjeta_regalo).reduce((a, l) => a + l.qty, 0), pago: etiquetaPago((v.pagos ?? []).map((x: { metodo: string }) => x.metodo)), tipo_ticket: 'venta', historico: false,
      hora: new Date(Date.parse(v.ocurrio_en) - 7 * 3600_000).toISOString().slice(11, 16),
      montos: (v.pagos ?? []).reduce((m: MontosPago, x: { metodo: string; monto: number }) => { const k = x.metodo === 'efectivo' ? 'efectivo' : x.metodo === 'tarjeta' ? 'tarjeta' : x.metodo === 'efectivo_usd' ? 'dolares' : x.metodo === 'tarjeta_regalo' ? 'tarjeta_regalo' : 'otro'; m[k] += x.monto; return m; }, sinMontos()),
    });
  }
  if (actor.rol === 'admin' && f.historicas !== false) {
    for (const o of ops) {
      if (o.tipo !== 'venta.historica') continue;
      const h = o.payload;
      if (permitidas !== 'todas' && !permitidas.some((c) => c.tienda === h.tienda_hist && c.caja === h.caja_hist)) continue;
      if (f.tiendas && !f.tiendas.includes(h.tienda_hist)) continue;
      if ((f.desde && h.fecha < f.desde) || (f.hasta && h.fecha > f.hasta)) continue;
      filas.push({
        tienda: h.tienda_hist, caja: h.caja_hist, folio: h.folio, sale_id: h.hist_id, fecha_local: h.fecha, cajero: '', vendedora: '', total: h.total, total_mercancia: h.tipo_hist === 'venta' ? h.total : 0,
        estado: 'confirmada', piezas: h.piezas, pago: ETIQUETA_PAGO[h.pago] ?? h.pago, tipo_ticket: h.tipo_hist, historico: true, hora: '',
        montos: { ...sinMontos(), [h.pago === 'efectivo' ? 'efectivo' : h.pago === 'tarjeta' ? 'tarjeta' : h.pago === 'mixto' ? 'mixto' : 'otro']: h.total },
      });
    }
  }
  // Orden estable por serie y folio: se ordena, pero nunca se asigna un número nuevo.
  return filas.sort((a, b) => a.tienda.localeCompare(b.tienda) || a.caja - b.caja || Number(a.historico) - Number(b.historico) || a.folio - b.folio);
}

export interface Consolidado {
  filas: FilaVenta[];
  porCaja: { tienda: string; caja: number; tickets: number; total: number; total_mercancia: number; historico?: boolean }[];
  total: number;
  /** Consolidado SIN tarjetas de regalo: así lo cobrado con una tarjeta no se cuenta dos veces. */
  total_mercancia: number;
}

/** Solo Administración: consolidado de todas las cajas o de las seleccionadas (incluso de tiendas distintas). */
export function reporteConsolidado(actor: Actor, ops: Op[], f: Filtro = {}): Consolidado {
  if (actor.rol !== 'admin') throw new ErrorDominio('PROHIBIDO', 'los reportes consolidados son solo de Administración');
  const filas = ventasPorCaja(actor, ops, f);
  const porCaja = new Map<string, { tienda: string; caja: number; tickets: number; total: number; total_mercancia: number; historico?: boolean }>();
  for (const r of filas) {
    if (r.estado === 'cancelada') continue;
    const k = `${r.tienda}/${r.caja}${r.historico ? '/hist' : ''}`;
    const a = porCaja.get(k) ?? { tienda: r.tienda, caja: r.caja, tickets: 0, total: 0, total_mercancia: 0, ...(r.historico ? { historico: true } : {}) };
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
    'Vendedora-Cajera': r.cajero, 'Total MXN': aMXN(r.total), Estado: r.estado,
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

// ── promociones y descuentos autorizados ──
export interface FilaDescuento {
  tienda: string; caja: number; folio: number; sale_id: string; fecha_local: string; hora: string; cajero: string;
  tipo: 'promo' | 'cupon' | 'manual';
  /** id de la promoción o cupón (o del supervisor, en un descuento manual). */
  ref: string;
  concepto: string;
  supervisor: string | null;
  /** Mercancía de la venta a precio de lista. */
  importe_venta: number;
  monto: number;
  /** Porcentaje del importe de la venta, en diezmilésimas (10000 = 100 %). */
  pct_bp: number;
  estado: 'confirmada' | 'cancelada';
}
export interface ReporteDescuentos {
  filas: FilaDescuento[];
  /** Totales SIN las ventas canceladas. */
  resumen: { tickets: number; monto: number; promo: { tickets: number; monto: number }; cupon: { tickets: number; monto: number }; manual: { tickets: number; monto: number } };
  porPromocion: { tipo: 'promo' | 'cupon'; ref: string; concepto: string; tickets: number; monto: number }[];
  porSupervisor: { supervisor: string; descuentos: number; tickets: number; monto: number; mayor_pct_bp: number; al_100: number }[];
}
/**
 * Descuentos de las ventas del periodo, con su origen: promoción, cupón o descuento manual autorizado por un supervisor.
 * El supervisor sale del registro de la propia venta; una venta anterior a ese registro aparece «sin registro de supervisor».
 */
export function descuentosPorCaja(actor: Actor, ops: Op[], f: Filtro = {}): ReporteDescuentos {
  const permitidas = cajasPermitidas(actor, f);
  const nombresSup = new Map<string, string>();
  for (const o of ops) if (o.tipo === 'supervisor.guardado') nombresSup.set(o.payload.id, o.payload.nombre);
  const filas: FilaDescuento[] = [];
  for (const v of ventas(ops).values()) {
    if (permitidas !== 'todas' && !permitidas.some((c) => mismaCaja(c, v))) continue;
    if (!enPeriodo(v.ocurrio_en, f)) continue;
    const bruto = v.lineas.filter((l) => !l.tarjeta_regalo).reduce((a, l) => a + l.qty * l.precio_unit, 0);
    const grupos = new Map<string, { tipo: FilaDescuento['tipo']; ref: string; concepto: string; monto: number }>();
    for (const l of v.lineas) {
      const det = l.descuento_detalle ?? (l.descuento > 0 ? [{ tipo: 'manual' as const, ref: '', nombre: 'Descuento', monto: l.descuento }] : []);
      for (const d of det) {
        const k = `${d.tipo}|${d.ref}`;
        const g = grupos.get(k) ?? { tipo: d.tipo, ref: d.ref, concepto: d.nombre, monto: 0 };
        g.monto += d.monto;
        grupos.set(k, g);
      }
    }
    const local = new Date(Date.parse(v.ocurrio_en) - 7 * 3600_000).toISOString();
    for (const g of grupos.values()) {
      if (g.monto <= 0) continue;
      filas.push({
        tienda: v.tienda, caja: v.caja, folio: v.folio, sale_id: v.sale_id, fecha_local: fechaLocal(v.ocurrio_en), hora: local.slice(11, 16), cajero: v.cajero,
        tipo: g.tipo, ref: g.ref, concepto: g.tipo === 'manual' ? 'Descuento autorizado' : g.concepto,
        supervisor: g.tipo === 'manual' ? (g.ref ? (nombresSup.get(g.ref) ?? g.concepto.replace(/^Descuento autorizado por /, '')) : 'sin registro de supervisor') : null,
        importe_venta: bruto, monto: g.monto, pct_bp: bruto > 0 ? Math.round((g.monto * 10000) / bruto) : 0, estado: v.estado,
      });
    }
  }
  filas.sort((a, b) => a.fecha_local.localeCompare(b.fecha_local) || a.tienda.localeCompare(b.tienda) || a.caja - b.caja || a.folio - b.folio);
  const vivas = filas.filter((r) => r.estado === 'confirmada');
  const resumen = { tickets: new Set(vivas.map((r) => r.sale_id)).size, monto: vivas.reduce((a, r) => a + r.monto, 0), promo: { tickets: 0, monto: 0 }, cupon: { tickets: 0, monto: 0 }, manual: { tickets: 0, monto: 0 } };
  for (const t of ['promo', 'cupon', 'manual'] as const) {
    const l = vivas.filter((r) => r.tipo === t);
    resumen[t] = { tickets: new Set(l.map((r) => r.sale_id)).size, monto: l.reduce((a, r) => a + r.monto, 0) };
  }
  const pp = new Map<string, ReporteDescuentos['porPromocion'][number]>();
  const ps = new Map<string, ReporteDescuentos['porSupervisor'][number]>();
  for (const r of vivas) {
    if (r.tipo === 'manual') {
      const k = r.supervisor!;
      const x = ps.get(k) ?? { supervisor: k, descuentos: 0, tickets: 0, monto: 0, mayor_pct_bp: 0, al_100: 0 };
      x.descuentos++; x.tickets++; x.monto += r.monto; x.mayor_pct_bp = Math.max(x.mayor_pct_bp, r.pct_bp); if (r.pct_bp >= 10000) x.al_100++;
      ps.set(k, x);
    } else {
      const k = `${r.tipo}|${r.ref}`;
      const x = pp.get(k) ?? { tipo: r.tipo, ref: r.ref, concepto: r.concepto, tickets: 0, monto: 0 };
      x.tickets++; x.monto += r.monto;
      pp.set(k, x);
    }
  }
  return { filas, resumen, porPromocion: [...pp.values()].sort((a, b) => b.monto - a.monto), porSupervisor: [...ps.values()].sort((a, b) => b.monto - a.monto) };
}

export interface FilaVendedora {
  /** `vendedora_id`, `autocompra` (nadie ayudó) o `sin_registro` (ventas anteriores al registro). */
  clave: string;
  alias: string;
  tickets: number;
  piezas: number;
  /** Venta de mercancía (sin tarjetas de regalo) de las ventas que atendió. */
  vendido: number;
  /** Lo devuelto o cambiado de esas mismas ventas dentro del periodo. */
  devuelto: number;
  neto: number;
}

/** Solo Administración: ventas por vendedora (la persona que atendió, no quien cobró) en el periodo y las cajas elegidas. */
export function ventasPorVendedora(actor: Actor, ops: Op[], f: Filtro = {}): FilaVendedora[] {
  if (actor.rol !== 'admin') throw new ErrorDominio('PROHIBIDO', 'el reporte por vendedora es solo de Administración');
  const permitidas = cajasPermitidas(actor, f);
  const todas = ventas(ops);
  const filas = new Map<string, FilaVendedora>();
  const fila = (v: { vendedora_id?: string | null; vendedora?: string }) => {
    const clave = v.vendedora === undefined ? 'sin_registro' : v.vendedora_id ?? 'autocompra';
    const alias = v.vendedora === undefined ? 'Sin registrar' : v.vendedora_id ? v.vendedora : 'Autocompra';
    let r = filas.get(clave);
    if (!r) filas.set(clave, (r = { clave, alias, tickets: 0, piezas: 0, vendido: 0, devuelto: 0, neto: 0 }));
    return r;
  };
  for (const v of todas.values()) {
    if (v.estado !== 'confirmada') continue;
    if (permitidas !== 'todas' && !permitidas.some((c) => mismaCaja(c, v))) continue;
    if (!enPeriodo(v.ocurrio_en, f)) continue;
    const mercancia = v.lineas.filter((l) => !l.tarjeta_regalo);
    if (!mercancia.length) continue;
    const r = fila(v);
    r.tickets++;
    r.piezas += mercancia.reduce((a, l) => a + l.qty, 0);
    r.vendido += mercancia.reduce((a, l) => a + l.importe, 0);
  }
  for (const d of devoluciones(ops)) {
    const v = todas.get(d.sale_id);
    if (!v || v.estado !== 'confirmada') continue;
    if (permitidas !== 'todas' && !permitidas.some((c) => mismaCaja(c, { tienda: d.tienda, caja: d.caja }))) continue;
    if (!enPeriodo(d.ocurrio_en, f)) continue;
    fila(v).devuelto += d.importe;
  }
  for (const r of filas.values()) r.neto = r.vendido - r.devuelto;
  return [...filas.values()].sort((a, b) => b.neto - a.neto || a.alias.localeCompare(b.alias, 'es'));
}
