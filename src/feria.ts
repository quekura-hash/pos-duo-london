// Estado de la «feria» (billetes y monedas de cambio) de cada caja.
// Parte del fondo contado al abrir y, venta por venta, ESTIMA qué billetes y monedas entran y salen: como no se sabe con cuáles pagó la clienta ni cuáles dio la
// cajera, se supone lo más probable (el menor número de piezas). El cierre cuenta billete por billete y moneda por moneda: desde ese conteo deja de ser una estimación.
import { fechaLocal } from './util.ts';
import type { Op } from './tipos.ts';

/** Denominaciones en centavos, de mayor a menor. Las de feria son las que se vigilan y se dan de cambio. */
export const DENOMS_RECIBIDO = [50000, 20000, 10000, 5000, 2000, 1000, 500, 200, 100] as const; // nunca se supone que pagaron con billete de $1,000
export const DENOMS_FERIA = [50000, 20000, 10000, 5000, 2000, 1000, 500, 200, 100] as const;
/** Mínimo de piezas de cada denominación de feria: por debajo, la caja «va a necesitar feria pronto». Con 0 en dos o más, el estado es crítico. */
export const MINIMO_FERIA: Record<number, number> = { 50000: 2, 20000: 5, 10000: 5, 5000: 8, 2000: 10, 1000: 5, 500: 10, 200: 10, 100: 20 };
/** Entradas de feria sin desglose conocido (una entrega de cambio): se supone billete chico y moneda, no de $200. */
const DENOMS_ENTRADA = [10000, 5000, 2000, 1000, 500, 200, 100] as const;

export type Desglose = Record<string, number>;
export type EstadoFeria = 'bien' | 'bajo' | 'critico' | 'sin_dato';

/** Reparte un importe (centavos; los centavos sueltos se ignoran) en el menor número de piezas con las denominaciones dadas. */
export function repartir(cent: number, denoms: readonly number[]): Desglose {
  const out: Desglose = {};
  let resto = Math.max(0, Math.floor(cent / 100) * 100);
  for (const d of denoms) { const n = Math.floor(resto / d); if (n > 0) { out[String(d)] = n; resto -= n * d; } }
  return out;
}
/** Lo más probable que dio la cajera de cambio: 349 → 1 de $200, 1 de $100, 2 de $20, 1 de $5 y 2 de $2. */
export const desglosarCambio = (cent: number) => repartir(cent, DENOMS_FERIA);
/** Lo más probable que entregó la clienta, sin billetes de $1,000: 2,500 → 5 de $500. */
export const desglosarRecibido = (cent: number) => repartir(cent, DENOMS_RECIBIDO);
export const desglosarEntrada = (cent: number) => repartir(cent, DENOMS_ENTRADA);

const sumar = (a: Desglose, b: Desglose, signo: 1 | -1): { inv: Desglose; faltante: boolean } => {
  const inv = { ...a };
  let faltante = false;
  for (const [k, n] of Object.entries(b)) {
    const v = (inv[k] ?? 0) + signo * n;
    if (v < 0) { faltante = true; inv[k] = 0; } else inv[k] = v;
  }
  return { inv, faltante };
};

export interface EventoFeria {
  ocurrio_en: string;
  /** venta | devolucion | cancelacion | retiro | entrada | gasto | ajuste | fondo | conteo */
  tipo: string;
  descripcion: string;
  entra: Desglose;
  sale: Desglose;
  /** false cuando las piezas son exactas (fondo, conteo y retiro se cuentan billete por billete). */
  estimado: boolean;
}
export interface ReporteFeria {
  tienda: string; caja: number; fecha: string;
  estado: EstadoFeria;
  /** Piezas por denominación (centavos → cantidad) al momento actual. */
  inventario: Desglose;
  agotadas: number[]; bajas: number[];
  /** El último conteo (fondo o cierre) que lo respaldó; todo lo que sigue es estimación. */
  confirmado_en: string | null;
  /** Hay movimientos desde la última confirmación: las cifras son estimadas. */
  estimado: boolean;
  /** La estimación quiso sacar más piezas de las que había (la suposición falló): conviene contar. */
  desfase: boolean;
  eventos: EventoFeria[];
}

const fechaDe = (o: Op) => (typeof o.payload?.fecha === 'string' ? (o.payload.fecha as string) : fechaLocal(o.ocurrio_en));
const propia = (o: Op, tienda: string, caja: number) => o.payload?.tienda === tienda && o.payload?.caja === caja;
const efectivoDe = (reembolsos: { metodo: string; monto: number }[] | undefined, importe: number) =>
  (reembolsos ?? [{ metodo: 'efectivo', monto: importe }]).filter((r) => r.metodo === 'efectivo').reduce((a, r) => a + r.monto, 0);

export function estadoDe(inv: Desglose): { estado: EstadoFeria; agotadas: number[]; bajas: number[] } {
  const agotadas = DENOMS_FERIA.filter((d) => (inv[String(d)] ?? 0) === 0);
  const bajas = DENOMS_FERIA.filter((d) => (inv[String(d)] ?? 0) > 0 && (inv[String(d)] ?? 0) < MINIMO_FERIA[d]!);
  const estado: EstadoFeria = agotadas.length >= 2 ? 'critico' : agotadas.length === 1 || bajas.length > 0 ? 'bajo' : 'bien';
  return { estado, agotadas: [...agotadas], bajas: [...bajas] };
}

/** Estado de la feria de UNA caja en un día, recorriendo en orden lo que pasó en ella. Sin fondo contado no hay punto de partida (`sin_dato`). */
export function estimarFeria(ops: Op[], tienda: string, caja: number, fecha: string): ReporteFeria {
  const base: ReporteFeria = { tienda, caja, fecha, estado: 'sin_dato', inventario: {}, agotadas: [], bajas: [], confirmado_en: null, estimado: false, desfase: false, eventos: [] };
  const del = ops.filter((o) => propia(o, tienda, caja) || (o.tipo === 'sale.cancelled')).sort((a, b) => a.ocurrio_en.localeCompare(b.ocurrio_en));
  const ventas = new Map<string, Op>();
  for (const o of ops) if (o.tipo === 'sale.confirmed' && propia(o, tienda, caja)) ventas.set(o.payload.sale_id, o);
  const fondoDia = del.filter((o) => o.tipo === 'cash.fondo' && fechaDe(o) === fecha).at(-1);
  if (!fondoDia) return base;
  let inv: Desglose = { ...(fondoDia.payload.denominaciones as Desglose) };
  const fondoDen: Desglose = { ...inv };
  let confirmadoEn = fondoDia.ocurrio_en;
  let estimado = false;
  let desfase = false;
  const eventos: EventoFeria[] = [{ ocurrio_en: fondoDia.ocurrio_en, tipo: 'fondo', descripcion: 'Fondo contado y confirmado', entra: fondoDen, sale: {}, estimado: false }];
  const aplicar = (o: Op, tipo: string, descripcion: string, entra: Desglose, sale: Desglose, esEstimado = true) => {
    let r = sumar(inv, entra, 1); inv = r.inv;
    r = sumar(inv, sale, -1); inv = r.inv;
    if (r.faltante) desfase = true;
    if (esEstimado) estimado = true;
    eventos.push({ ocurrio_en: o.ocurrio_en, tipo, descripcion, entra, sale, estimado: esEstimado });
  };
  for (const o of del) {
    if (o === fondoDia || o.ocurrio_en < fondoDia.ocurrio_en || (o.tipo === 'sale.cancelled' ? fechaLocal(o.ocurrio_en) : fechaDe(o)) !== fecha) continue; // solo lo posterior al fondo, del mismo día
    const p = o.payload;
    if (o.tipo === 'sale.confirmed') {
      let entra: Desglose = {}; let sale: Desglose = {};
      for (const pg of p.pagos as { metodo: string; monto: number; recibido?: number; cambio?: number; pesos_recibidos?: number; cambio_mxn?: number }[]) {
        if (pg.metodo === 'efectivo') { entra = sumar(entra, desglosarRecibido(pg.recibido ?? pg.monto), 1).inv; if ((pg.cambio ?? 0) > 0) sale = sumar(sale, desglosarCambio(pg.cambio!), 1).inv; }
        else if (pg.metodo === 'efectivo_usd') { if ((pg.pesos_recibidos ?? 0) > 0) entra = sumar(entra, desglosarRecibido(pg.pesos_recibidos!), 1).inv; if ((pg.cambio_mxn ?? 0) > 0) sale = sumar(sale, desglosarCambio(pg.cambio_mxn!), 1).inv; }
      }
      if (Object.keys(entra).length || Object.keys(sale).length) aplicar(o, 'venta', `Venta ${String(p.folio).padStart(6, '0')}`, entra, sale);
    } else if (o.tipo === 'return.registered') {
      const ef = efectivoDe(p.reembolsos, p.importe);
      if (ef > 0) aplicar(o, 'devolucion', 'Devolución en efectivo', {}, desglosarCambio(ef));
    } else if (o.tipo === 'sale.cancelled') {
      const v = ventas.get(p.sale_id);
      if (!v) continue;
      const ef = p.reembolsos ? (p.reembolsos as { metodo: string; monto: number }[]).filter((r) => r.metodo === 'efectivo').reduce((a, r) => a + r.monto, 0) : 0;
      if (ef > 0) aplicar(o, 'cancelacion', `Cancelación de la venta ${String(v.payload.folio).padStart(6, '0')}`, {}, desglosarCambio(ef));
    } else if (o.tipo === 'cash.retiro') {
      aplicar(o, 'retiro', `Retiro ${p.folio_retiro}`, {}, { ...(p.mxn?.denominaciones as Desglose) }, false);
    } else if (o.tipo === 'cash.movement' && p.moneda === 'MXN' && p.tipo === 'entrada') {
      aplicar(o, 'entrada', 'Entrada de efectivo (sin desglose)', desglosarEntrada(p.monto), {});
    } else if (o.tipo === 'cash.movement' && p.moneda === 'MXN' && p.tipo === 'gasto') {
      aplicar(o, 'gasto', 'Gasto de caja', {}, desglosarCambio(p.monto));
    } else if (o.tipo === 'cash.ajuste_admin') {
      if (p.tipo === 'salida') aplicar(o, 'ajuste', 'Salida por ajuste de Administración', {}, desglosarCambio(p.monto));
      else aplicar(o, 'ajuste', 'Entrega de Administración (sin desglose)', desglosarEntrada(p.monto), {});
    } else if (o.tipo === 'cash.arqueo' && p.fecha === fecha) {
      // Conteo del cajón a cualquier hora: lo contado billete por billete es lo que hay y reemplaza la estimación.
      inv = { ...(p.denominaciones as Desglose) };
      confirmadoEn = o.ocurrio_en; estimado = false; desfase = false;
      eventos.push({ ocurrio_en: o.ocurrio_en, tipo: 'conteo', descripcion: 'Conteo del cajón (billete por billete)', entra: {}, sale: {}, estimado: false });
    } else if (o.tipo === 'cash.conteo' && p.moneda === 'MXN' && p.alcance === 'ventas' && p.fecha === fecha) {
      // El conteo del cierre es exacto: fondo contado + efectivo de ventas contado, billete por billete y moneda por moneda.
      inv = sumar({ ...fondoDen }, (p.denominaciones ?? {}) as Desglose, 1).inv;
      confirmadoEn = o.ocurrio_en; estimado = false; desfase = false;
      eventos.push({ ocurrio_en: o.ocurrio_en, tipo: 'conteo', descripcion: 'Conteo del cierre (billete por billete)', entra: {}, sale: {}, estimado: false });
    }
  }
  const e = estadoDe(inv);
  return { ...base, estado: e.estado, inventario: inv, agotadas: e.agotadas, bajas: e.bajas, confirmado_en: confirmadoEn, estimado, desfase, eventos };
}
