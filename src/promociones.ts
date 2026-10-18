// Promociones y cupones: configuración (central) y cálculo del descuento de un carrito.
// Todo en centavos enteros. Módulo puro: no lee la bitácora ni el reloj (reciben lo que necesitan).
import type { Linea } from './tipos.ts';

export type TipoPromo = 'nxm' | 'por_cada' | 'cupon';
export interface Alcance { departamentos: string[]; palabras: string[]; item_ids: string[] }

export interface Promocion {
  id: string;
  tipo: TipoPromo;
  nombre: string;
  activa: boolean;
  /** Fechas locales AAAA-MM-DD, inclusive. null = sin límite (hasta que Administración la desactive). */
  inicio: string | null;
  fin: string | null;
  // 2x1 / «lleva X paga Y»: de cada grupo de `lleva` piezas del alcance, las más baratas (lleva − paga) salen gratis.
  lleva?: number;
  paga?: number;
  alcance?: Alcance;
  // por cada $X de compra, $Y de descuento (centavos)
  cada?: number;
  descuenta?: number;
  // cupón: un código con % o $ de descuento y compra mínima (centavos)
  codigo?: string;
  pct?: number;
  monto?: number;
  minimo?: number;
  /** Veces que se puede canjear en total (null = sin límite). */
  usos_max?: number | null;
  /** false = no se combina con promociones de la misma venta. */
  combinable?: boolean;
}

export const normCodigo = (s: unknown) => String(s ?? '').trim().toUpperCase().replace(/\s+/g, '');
const sinAcentos = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
export const fechaOk = (f: unknown): f is string => typeof f === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(f) && new Date(`${f}T00:00:00Z`).toISOString().slice(0, 10) === f;

/** Vigente hoy: activa y dentro de sus fechas (inclusive). */
export const vigente = (p: Promocion, hoy: string) => p.activa && (!p.inicio || hoy >= p.inicio) && (!p.fin || hoy <= p.fin);
export type EstadoPromo = 'activa' | 'programada' | 'vencida' | 'inactiva';
export function estadoPromo(p: Promocion, hoy: string): EstadoPromo {
  if (!p.activa) return 'inactiva';
  if (p.inicio && hoy < p.inicio) return 'programada';
  if (p.fin && hoy > p.fin) return 'vencida';
  return 'activa';
}

export type ErrorPromo = { codigo: 'DATOS_INVALIDOS' | 'CODIGO_REPETIDO' | 'NO_EXISTE'; mensaje: string };
const entero = (v: unknown, min: number) => typeof v === 'number' && Number.isInteger(v) && v >= min;

/** Valida y normaliza una promoción. Devuelve la promoción limpia o el motivo del rechazo. */
export function validarPromocion(p: Promocion, otras: Promocion[]): { ok: true; promo: Promocion } | { ok: false; error: ErrorPromo } {
  const mal = (mensaje: string) => ({ ok: false as const, error: { codigo: 'DATOS_INVALIDOS' as const, mensaje } });
  const nombre = String(p.nombre ?? '').trim().replace(/\s+/g, ' ');
  if (!nombre) return mal('falta el nombre de la promoción');
  if (!['nxm', 'por_cada', 'cupon'].includes(p.tipo)) return mal('tipo de promoción desconocido');
  const inicio = p.inicio || null, fin = p.fin || null;
  if (inicio !== null && !fechaOk(inicio)) return mal('la fecha de inicio no es válida');
  if (fin !== null && !fechaOk(fin)) return mal('la fecha de término no es válida');
  if (inicio && fin && fin < inicio) return mal('la fecha de término es anterior a la de inicio');
  const base: Promocion = { id: p.id, tipo: p.tipo, nombre, activa: !!p.activa, inicio, fin };
  if (p.tipo === 'nxm') {
    if (!entero(p.lleva, 2) || !entero(p.paga, 1) || p.paga! >= p.lleva!) return mal('«lleva» debe ser 2 o más y «paga» un número menor que «lleva»');
    const a = p.alcance ?? { departamentos: [], palabras: [], item_ids: [] };
    const alcance: Alcance = {
      departamentos: (a.departamentos ?? []).map((x) => String(x).trim()).filter(Boolean),
      palabras: (a.palabras ?? []).map((x) => String(x).trim()).filter(Boolean),
      item_ids: (a.item_ids ?? []).map((x) => String(x).trim()).filter(Boolean),
    };
    if (!alcance.departamentos.length && !alcance.palabras.length && !alcance.item_ids.length) return mal('indique a qué mercancía aplica (departamentos, palabras de la descripción o artículos)');
    return { ok: true, promo: { ...base, lleva: p.lleva, paga: p.paga, alcance } };
  }
  if (p.tipo === 'por_cada') {
    if (!entero(p.cada, 1) || !entero(p.descuenta, 1) || p.descuenta! >= p.cada!) return mal('el descuento debe ser mayor que 0 y menor que el monto de compra');
    return { ok: true, promo: { ...base, cada: p.cada, descuenta: p.descuenta } };
  }
  const codigo = normCodigo(p.codigo);
  if (!/^[A-Z0-9-]{3,24}$/.test(codigo)) return mal('el código del cupón lleva de 3 a 24 letras, números o guiones');
  if (otras.some((o) => o.tipo === 'cupon' && o.id !== p.id && o.codigo === codigo)) return { ok: false, error: { codigo: 'CODIGO_REPETIDO', mensaje: `el código ${codigo} ya existe` } };
  const tienePct = p.pct !== undefined && p.pct !== null, tieneMonto = p.monto !== undefined && p.monto !== null;
  if (tienePct === tieneMonto) return mal('el cupón es de un porcentaje o de un monto fijo, no ambos');
  if (tienePct && (!entero(p.pct, 1) || p.pct! > 100)) return mal('el porcentaje debe ser un entero de 1 a 100');
  if (tieneMonto && !entero(p.monto, 1)) return mal('el monto de descuento debe ser mayor que 0');
  const minimo = p.minimo ?? 0;
  if (!entero(minimo, 0)) return mal('la compra mínima no es válida');
  const usos = p.usos_max ?? null;
  if (usos !== null && !entero(usos, 1)) return mal('los usos máximos deben ser un entero mayor que 0 (o vacío para sin límite)');
  return { ok: true, promo: { ...base, codigo, ...(tienePct ? { pct: p.pct } : { monto: p.monto }), minimo, usos_max: usos, combinable: p.combinable !== false } };
}

/** Reparte `monto` entre `pesos` de forma proporcional, en centavos enteros (mayor residuo; empates al primero). */
export function repartir(monto: number, pesos: number[]): number[] {
  const total = pesos.reduce((a, b) => a + b, 0);
  if (monto <= 0 || total <= 0) return pesos.map(() => 0);
  const exacto = pesos.map((w) => (monto * w) / total);
  const base = exacto.map(Math.floor);
  let resto = monto - base.reduce((a, b) => a + b, 0);
  const orden = exacto.map((e, i) => ({ i, r: e - Math.floor(e) })).sort((a, b) => b.r - a.r || a.i - b.i);
  for (const { i } of orden) { if (resto <= 0) break; base[i]!++; resto--; }
  return base;
}

export const esMercancia = (l: Linea) => !l.tarjeta_regalo;
const manualDe = (l: Linea) => (l.descuento_detalle ? l.descuento_detalle.filter((d) => d.tipo === 'manual') : l.descuento > 0 ? [{ tipo: 'manual' as const, ref: '', nombre: 'Descuento', monto: l.descuento }] : []);

export function aplicaAlcance(a: Alcance, l: Pick<Linea, 'item_id' | 'departamento' | 'descripcion' | 'marca'>): boolean {
  if (a.item_ids.includes(l.item_id)) return true;
  const dep = a.departamentos.length === 0 || a.departamentos.some((d) => sinAcentos(d) === sinAcentos(l.departamento));
  const txt = sinAcentos(`${l.descripcion} ${l.marca}`);
  const pal = a.palabras.length === 0 || a.palabras.some((w) => txt.includes(sinAcentos(w)));
  return (a.departamentos.length > 0 || a.palabras.length > 0) && dep && pal;
}

export interface AplicadaPromo { promo_id: string; nombre: string; tipo: TipoPromo; monto: number }
export interface ResultadoDescuentos {
  lineas: Linea[];
  aplicadas: AplicadaPromo[];
  cupon: { codigo: string; nombre: string; monto: number; aplicado: boolean; motivo?: string } | null;
}

/**
 * Calcula promociones y cupón de un carrito. El descuento MANUAL (autorizado por un supervisor) se respeta y las promociones
 * se calculan sobre el precio de lista, sin pasar nunca del importe de la línea. Orden: 2x1/lleva-paga, luego «por cada $X»
 * y al final el cupón (sobre lo que queda).
 */
export function calcularDescuentos(lineas: Linea[], promos: Promocion[], codigoCupon: string | null, hoy: string, usosCupon: (codigo: string) => number = () => 0): ResultadoDescuentos {
  const out: Linea[] = lineas.map((l) => ({ ...l, descuento_detalle: esMercancia(l) ? manualDe(l).map((d) => ({ ...d })) : [] }));
  const merc = out.filter(esMercancia);
  const restante = (l: Linea) => l.qty * l.precio_unit - (l.descuento_detalle ?? []).reduce((a, d) => a + d.monto, 0);
  const aplicadas: AplicadaPromo[] = [];
  const sumar = (l: Linea, p: Promocion, monto: number) => {
    if (monto <= 0) return 0;
    const m = Math.min(monto, restante(l));
    if (m > 0) l.descuento_detalle!.push({ tipo: p.tipo === 'cupon' ? 'cupon' : 'promo', ref: p.id, nombre: p.nombre, monto: m });
    return Math.max(m, 0);
  };
  const vig = promos.filter((p) => vigente(p, hoy));
  // 1) lleva X, paga Y
  const consumidas = new Map<string, number>();
  for (const p of vig.filter((x) => x.tipo === 'nxm')) {
    const unidades: { l: Linea; precio: number }[] = [];
    for (const l of merc) {
      if (!aplicaAlcance(p.alcance!, l)) continue;
      for (let i = 0; i < l.qty - (consumidas.get(l.linea_id) ?? 0); i++) unidades.push({ l, precio: l.precio_unit });
    }
    unidades.sort((a, b) => b.precio - a.precio);
    const gratis = p.lleva! - p.paga!;
    let total = 0;
    const porLinea = new Map<Linea, number>();
    for (let g = 0; (g + 1) * p.lleva! <= unidades.length; g++) {
      const grupo = unidades.slice(g * p.lleva!, (g + 1) * p.lleva!);
      for (const u of grupo) consumidas.set(u.l.linea_id, (consumidas.get(u.l.linea_id) ?? 0) + 1);
      for (const u of grupo.slice(grupo.length - gratis)) porLinea.set(u.l, (porLinea.get(u.l) ?? 0) + u.precio);
    }
    for (const [l, m] of porLinea) total += sumar(l, p, m);
    if (total > 0) aplicadas.push({ promo_id: p.id, nombre: p.nombre, tipo: p.tipo, monto: total });
  }
  // 2) por cada $X de compra, $Y de descuento
  for (const p of vig.filter((x) => x.tipo === 'por_cada')) {
    const elegible = merc.reduce((a, l) => a + restante(l), 0);
    const monto = Math.min(Math.floor(elegible / p.cada!) * p.descuenta!, elegible);
    if (monto <= 0) continue;
    const partes = repartir(monto, merc.map(restante));
    let total = 0;
    merc.forEach((l, i) => { total += sumar(l, p, partes[i]!); });
    if (total > 0) aplicadas.push({ promo_id: p.id, nombre: p.nombre, tipo: p.tipo, monto: total });
  }
  // 3) cupón
  let cupon: ResultadoDescuentos['cupon'] = null;
  if (codigoCupon) {
    const cod = normCodigo(codigoCupon);
    const p = promos.find((x) => x.tipo === 'cupon' && x.codigo === cod);
    const rechazo = (nombre: string, motivo: string) => ({ codigo: cod, nombre, monto: 0, aplicado: false, motivo });
    const elegible = merc.reduce((a, l) => a + restante(l), 0);
    if (!p) cupon = rechazo(cod, 'el cupón no existe');
    else if (!p.activa) cupon = rechazo(p.nombre, 'el cupón está desactivado');
    else if (p.inicio && hoy < p.inicio) cupon = rechazo(p.nombre, `el cupón empieza el ${p.inicio}`);
    else if (p.fin && hoy > p.fin) cupon = rechazo(p.nombre, `el cupón venció el ${p.fin}`);
    else if (p.usos_max != null && usosCupon(cod) >= p.usos_max) cupon = rechazo(p.nombre, 'el cupón ya se usó el máximo de veces');
    else if (p.combinable === false && aplicadas.length) cupon = rechazo(p.nombre, 'este cupón no se combina con promociones de la venta');
    else if (elegible < (p.minimo ?? 0)) cupon = rechazo(p.nombre, `requiere una compra de al menos $${((p.minimo ?? 0) / 100).toFixed(2)}`);
    else {
      const bruto = p.pct !== undefined ? Math.floor((elegible * p.pct + 50) / 100) : Math.min(p.monto!, elegible);
      const monto = Math.min(bruto, elegible);
      const partes = repartir(monto, merc.map(restante));
      let total = 0;
      merc.forEach((l, i) => { total += sumar(l, p, partes[i]!); });
      cupon = { codigo: cod, nombre: p.nombre, monto: total, aplicado: total > 0 };
      if (total <= 0) cupon.motivo = 'no hay importe al que aplicar el cupón';
    }
  }
  for (const l of out) {
    l.descuento = (l.descuento_detalle ?? []).reduce((a, d) => a + d.monto, 0);
    l.importe = l.qty * l.precio_unit - l.descuento;
    if (!l.descuento_detalle?.length) delete l.descuento_detalle;
  }
  return { lineas: out, aplicadas, cupon };
}
