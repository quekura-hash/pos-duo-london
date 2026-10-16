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
      fecha_local: fechaLocal(v.ocurrio_en), cajero: v.cajero, total: v.total, estado: v.estado,
    });
  }
  // Orden estable por serie y folio: se ordena, pero nunca se asigna un número nuevo.
  return filas.sort((a, b) => a.tienda.localeCompare(b.tienda) || a.caja - b.caja || a.folio - b.folio);
}

export interface Consolidado {
  filas: FilaVenta[];
  porCaja: { tienda: string; caja: number; tickets: number; total: number }[];
  total: number;
}

/** Solo Administración: consolidado de todas las cajas o de las seleccionadas (incluso de tiendas distintas). */
export function reporteConsolidado(actor: Actor, ops: Op[], f: Filtro = {}): Consolidado {
  if (actor.rol !== 'admin') throw new ErrorDominio('PROHIBIDO', 'los reportes consolidados son solo de Administración');
  const filas = ventasPorCaja(actor, ops, f);
  const porCaja = new Map<string, { tienda: string; caja: number; tickets: number; total: number }>();
  for (const r of filas) {
    if (r.estado === 'cancelada') continue;
    const k = `${r.tienda}/${r.caja}`;
    const a = porCaja.get(k) ?? { tienda: r.tienda, caja: r.caja, tickets: 0, total: 0 };
    a.tickets++;
    a.total += r.total;
    porCaja.set(k, a);
  }
  const lista = [...porCaja.values()];
  return { filas, porCaja: lista, total: lista.reduce((a, c) => a + c.total, 0) };
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
