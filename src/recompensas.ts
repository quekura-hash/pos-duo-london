// Recompensas: reglas que regalan un cupón impreso al final del ticket (con QR de un solo uso) cuando la compra alcanza cierto monto.
// El cupón vale SOLO en la tienda que lo emitió. En la caja se canjea como cualquier cupón (una sola promoción por compra: la que más descuento da).
import { fechaOk, type Promocion } from './promociones.ts';
import type { Venta } from './tipos.ts';
import { addDias } from './util.ts';

export interface ReglaRecompensa {
  id: string;
  nombre: string;
  activa: boolean;
  /** Tiendas donde se regala el cupón (y donde vale: el cupón es de la tienda que lo emitió). */
  tiendas: string[];
  /** Periodo en que se regala (fechas locales, inclusive; null = sin límite). */
  inicio: string | null;
  fin: string | null;
  /** Lo que la clienta PAGA (mercancía, ya con descuentos y crédito de cambio) para ganarlo, en centavos. */
  compra_minima: number;
  cupon: {
    /** `monto`: $X de descuento; `pct`: X % de descuento. */
    monto?: number;
    pct?: number;
    /** Compra mínima para usar el cupón, en centavos (0 = sin mínimo). */
    minimo: number;
    /** `dias`: vale N días a partir de la fecha del ticket; `fechas`: del `inicio` al `fin` indicados. */
    vigencia: { modo: 'dias'; dias: number } | { modo: 'fechas'; inicio: string; fin: string };
  };
}

/** Cupón regalado en un ticket (queda dentro de la venta, con su código único). */
export interface RecompensaEmitida {
  codigo: string;
  regla_id: string;
  nombre: string;
  monto?: number;
  pct?: number;
  minimo: number;
  valido_desde: string;
  valido_hasta: string;
  tienda: string;
}

const entero = (n: unknown, min: number): n is number => typeof n === 'number' && Number.isInteger(n) && n >= min;

export function validarRegla(r: ReglaRecompensa, tiendasValidas: string[] = []): { ok: true; regla: ReglaRecompensa } | { ok: false; mensaje: string } {
  const mal = (mensaje: string) => ({ ok: false as const, mensaje });
  const nombre = String(r.nombre ?? '').trim().replace(/\s+/g, ' ');
  if (!nombre) return mal('falta el nombre de la recompensa');
  if (nombre.length > 40) return mal('el nombre admite hasta 40 caracteres (sale impreso en el ticket)');
  const inicio = r.inicio || null, fin = r.fin || null;
  if (inicio !== null && !fechaOk(inicio)) return mal('la fecha de inicio no es válida');
  if (fin !== null && !fechaOk(fin)) return mal('la fecha de término no es válida');
  if (inicio && fin && fin < inicio) return mal('la fecha de término es anterior a la de inicio');
  const tiendas = [...new Set((r.tiendas ?? []).map((t) => String(t).trim()).filter(Boolean))];
  if (!tiendas.length) return mal('elija en qué tienda se regala (y donde vale)');
  if (tiendasValidas.length && tiendas.some((t) => !tiendasValidas.includes(t))) return mal('tienda desconocida');
  if (!entero(r.compra_minima, 1)) return mal('el monto de compra para ganarlo debe ser mayor que 0');
  const c = r.cupon ?? ({} as ReglaRecompensa['cupon']);
  const tienePct = c.pct !== undefined && c.pct !== null, tieneMonto = c.monto !== undefined && c.monto !== null;
  if (tienePct === tieneMonto) return mal('el cupón es de un porcentaje o de un monto fijo, no ambos');
  if (tienePct && (!entero(c.pct, 1) || c.pct! > 100)) return mal('el porcentaje debe ser un entero de 1 a 100');
  if (tieneMonto && !entero(c.monto, 1)) return mal('el monto del cupón debe ser mayor que 0');
  const minimo = c.minimo ?? 0;
  if (!entero(minimo, 0)) return mal('la compra mínima para usar el cupón no es válida');
  let vigencia: ReglaRecompensa['cupon']['vigencia'];
  if (c.vigencia?.modo === 'fechas') {
    if (!fechaOk(c.vigencia.inicio) || !fechaOk(c.vigencia.fin)) return mal('las fechas de uso del cupón no son válidas');
    if (c.vigencia.fin < c.vigencia.inicio) return mal('la fecha final de uso es anterior a la inicial');
    vigencia = { modo: 'fechas', inicio: c.vigencia.inicio, fin: c.vigencia.fin };
  } else if (c.vigencia?.modo === 'dias') {
    if (!entero(c.vigencia.dias, 1) || c.vigencia.dias > 365) return mal('los días de vigencia son un entero de 1 a 365');
    vigencia = { modo: 'dias', dias: c.vigencia.dias };
  } else return mal('indique cuánto tiempo vale el cupón (días o fechas)');
  return { ok: true, regla: { id: r.id, nombre, activa: !!r.activa, tiendas, inicio, fin, compra_minima: r.compra_minima, cupon: { ...(tienePct ? { pct: c.pct } : { monto: c.monto }), minimo, vigencia } } };
}

export const reglaVigente = (r: ReglaRecompensa, hoy: string) => r.activa && (!r.inicio || hoy >= r.inicio) && (!r.fin || hoy <= r.fin);

/** Código único por ticket y recompensa: solo letras, números y guiones (así el lector no lo altera según la distribución del teclado). */
export const codigoRecompensa = (tienda: string, caja: number, folio: number, n: number) => `RC-${tienda}${caja}-${String(folio).padStart(6, '0')}-${n}`;
export const esCodigoRecompensa = (c: string) => /^RC-[A-Z0-9]+-\d{6}-\d+$/.test(c.trim().toUpperCase());

/** Recompensas que gana una compra: reglas vigentes de la tienda cuyo monto se alcanza con lo PAGADO. Se regalan hasta 3 (las de mayor monto de compra). */
export function recompensasGanadas(reglas: ReglaRecompensa[], tienda: string, caja: number, folio: number, hoy: string, pagado: number): RecompensaEmitida[] {
  const ganadas = reglas.filter((r) => reglaVigente(r, hoy) && r.tiendas.includes(tienda) && pagado >= r.compra_minima).sort((a, b) => b.compra_minima - a.compra_minima).slice(0, 3);
  return ganadas.map((r, i) => {
    const v = r.cupon.vigencia;
    return {
      codigo: codigoRecompensa(tienda, caja, folio, i + 1), regla_id: r.id, nombre: r.nombre,
      ...(r.cupon.pct !== undefined ? { pct: r.cupon.pct } : { monto: r.cupon.monto }), minimo: r.cupon.minimo,
      valido_desde: v.modo === 'fechas' ? v.inicio : hoy, valido_hasta: v.modo === 'fechas' ? v.fin : addDias(hoy, v.dias), tienda,
    };
  });
}

/** El cupón regalado, visto como un cupón normal (un solo uso, solo en la tienda emisora) para que lo calcule el motor de promociones. */
export function promoDeRecompensa(e: RecompensaEmitida): Promocion {
  return { id: e.codigo, tipo: 'cupon', nombre: e.nombre, activa: true, tiendas: [e.tienda], inicio: e.valido_desde, fin: e.valido_hasta, codigo: e.codigo, ...(e.pct !== undefined ? { pct: e.pct } : { monto: e.monto }), minimo: e.minimo, usos_max: 1 };
}

export interface EstadoRecompensa { emitida: RecompensaEmitida | null; canjeada: boolean; cancelada: boolean }
/** Qué se sabe de un cupón de recompensa con las ventas que se conocen: quién lo emitió, si ya se canjeó y si su venta se canceló. */
export function buscarRecompensa(vs: Map<string, Venta>, codigo: string): EstadoRecompensa {
  const cod = codigo.trim().toUpperCase();
  let emitida: RecompensaEmitida | null = null, cancelada = false, canjeada = false;
  for (const v of vs.values()) {
    const e = v.recompensas?.find((r) => r.codigo === cod);
    if (e) { emitida = e; cancelada = v.estado === 'cancelada'; }
    if (v.estado === 'confirmada' && v.lineas.some((l) => l.descuento_detalle?.some((d) => d.tipo === 'cupon' && d.ref === cod))) canjeada = true;
  }
  return { emitida, canjeada, cancelada };
}
