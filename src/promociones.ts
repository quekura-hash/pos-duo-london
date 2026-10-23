// Promociones y cupones: configuración (central) y cálculo del descuento de un carrito.
// Todo en centavos enteros. Módulo puro: no lee la bitácora ni el reloj (reciben lo que necesitan).
import type { Linea } from './tipos.ts';

export type TipoPromo = 'nxm' | 'paquete' | 'por_cada' | 'cupon';
export interface Alcance { departamentos: string[]; palabras: string[]; item_ids: string[] }

export interface Promocion {
  id: string;
  tipo: TipoPromo;
  nombre: string;
  activa: boolean;
  /** Tiendas donde vale: una promoción o cupón de una tienda no aplica en la otra. (Sin dato = todas, por compatibilidad.) */
  tiendas?: string[];
  /** Fechas locales AAAA-MM-DD, inclusive. null = sin límite (hasta que Administración la desactive). */
  inicio: string | null;
  fin: string | null;
  // 2x1 / «lleva X paga Y»: de cada grupo de `lleva` piezas del alcance, las más baratas (lleva − paga) salen gratis.
  lleva?: number;
  paga?: number;
  alcance?: Alcance;
  // paquete a precio fijo: «lleva N y paga $P en total» (usa `lleva` y `alcance`)
  precio?: number;
  // por cada $X de compra, $Y de descuento (centavos)
  cada?: number;
  descuenta?: number;
  // cupón: un código con % o $ de descuento y compra mínima (centavos)
  codigo?: string;
  pct?: number;
  monto?: number;
  minimo?: number;
  /** Lleva-paga, paquete y por-cada: true (o sin dato) = se repite por cada grupo completo (8 piezas de un paquete de 4 = 2 paquetes); false = aplica una sola vez por compra. */
  acumulable?: boolean;
  /** Veces que se puede canjear en total (null = sin límite). */
  usos_max?: number | null;
  /**
   * «Imprimir al final del ticket»: la promoción NO se aplica sola; es un regalo. Cuando lo que la clienta paga alcanza `compra_minima`
   * el ticket imprime un código QR de un solo uso que activa esta promoción en una compra futura (solo en la tienda que lo regaló).
   * Las fechas de inicio y término de la promoción son el periodo en que se regala.
   */
  regalo?: Regalo;
  /** Uso interno: copia de una promoción regalada, ligada al código QR de un ticket (se canjea con ese código, una sola vez). */
  canje?: boolean;
}
export interface Regalo {
  /** Lo que la clienta PAGA (mercancía, ya con descuentos y crédito de cambio) para ganarlo, en centavos. */
  compra_minima: number;
  /** `dias`: vale N días a partir de la fecha del ticket; `fechas`: del `inicio` al `fin` indicados. */
  vigencia: { modo: 'dias'; dias: number } | { modo: 'fechas'; inicio: string; fin: string };
}
/** Un código (cupón escrito/escaneado) activa estas promociones: los cupones y las copias regaladas en un ticket. */
export const esCanje = (p: Promocion) => p.tipo === 'cupon' || !!p.canje;

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

export const aplicaEnTienda = (p: Promocion, tienda: string) => !p.tiendas?.length || p.tiendas.includes(tienda);

export type ErrorPromo = { codigo: 'DATOS_INVALIDOS' | 'CODIGO_REPETIDO' | 'NO_EXISTE'; mensaje: string };
const entero = (v: unknown, min: number) => typeof v === 'number' && Number.isInteger(v) && v >= min;

/** Valida y normaliza una promoción. Devuelve la promoción limpia o el motivo del rechazo. */
export function validarPromocion(p: Promocion, otras: Promocion[], tiendasValidas: string[] = []): { ok: true; promo: Promocion } | { ok: false; error: ErrorPromo } {
  const mal = (mensaje: string) => ({ ok: false as const, error: { codigo: 'DATOS_INVALIDOS' as const, mensaje } });
  const nombre = String(p.nombre ?? '').trim().replace(/\s+/g, ' ');
  if (!nombre) return mal('falta el nombre de la promoción');
  if (!['nxm', 'paquete', 'por_cada', 'cupon'].includes(p.tipo)) return mal('tipo de promoción desconocido');
  const inicio = p.inicio || null, fin = p.fin || null;
  if (inicio !== null && !fechaOk(inicio)) return mal('la fecha de inicio no es válida');
  if (fin !== null && !fechaOk(fin)) return mal('la fecha de término no es válida');
  if (inicio && fin && fin < inicio) return mal('la fecha de término es anterior a la de inicio');
  const tiendas = [...new Set((p.tiendas ?? []).map((t) => String(t).trim()).filter(Boolean))];
  if (!tiendas.length) return mal('elija en qué tienda vale (DÚO, London o ambas)');
  if (tiendasValidas.length && tiendas.some((t) => !tiendasValidas.includes(t))) return mal('tienda desconocida');
  let regalo: Regalo | undefined;
  if (p.regalo) {
    if (nombre.length > 40) return mal('el nombre admite hasta 40 caracteres (sale impreso en el ticket)');
    if (!entero(p.regalo.compra_minima, 1)) return mal('el monto de compra para ganarla debe ser mayor que 0');
    const v = p.regalo.vigencia;
    if (v?.modo === 'fechas') {
      if (!fechaOk(v.inicio) || !fechaOk(v.fin)) return mal('las fechas de uso del cupón no son válidas');
      if (v.fin < v.inicio) return mal('la fecha final de uso es anterior a la inicial');
      regalo = { compra_minima: p.regalo.compra_minima, vigencia: { modo: 'fechas', inicio: v.inicio, fin: v.fin } };
    } else if (v?.modo === 'dias') {
      if (!entero(v.dias, 1) || v.dias > 365) return mal('los días de vigencia son un entero de 1 a 365');
      regalo = { compra_minima: p.regalo.compra_minima, vigencia: { modo: 'dias', dias: v.dias } };
    } else return mal('indique cuánto tiempo vale lo que se regala (días o fechas)');
  }
  const base: Promocion = { id: p.id, tipo: p.tipo, nombre, activa: !!p.activa, tiendas, inicio, fin, ...(p.tipo !== 'cupon' ? { acumulable: p.acumulable !== false } : {}), ...(regalo ? { regalo } : {}) };
  if (p.tipo === 'nxm' || p.tipo === 'paquete') {
    if (p.tipo === 'nxm' && (!entero(p.lleva, 2) || !entero(p.paga, 1) || p.paga! >= p.lleva!)) return mal('«lleva» debe ser 2 o más y «paga» un número menor que «lleva»');
    if (p.tipo === 'paquete' && (!entero(p.lleva, 2) || !entero(p.precio, 0))) return mal('el paquete lleva 2 piezas o más y un precio total en pesos');
    const a = p.alcance ?? { departamentos: [], palabras: [], item_ids: [] };
    const alcance: Alcance = {
      departamentos: (a.departamentos ?? []).map((x) => String(x).trim()).filter(Boolean),
      palabras: (a.palabras ?? []).map((x) => String(x).trim()).filter(Boolean),
      item_ids: (a.item_ids ?? []).map((x) => String(x).trim()).filter(Boolean),
    };
    if (!alcance.departamentos.length && !alcance.palabras.length && !alcance.item_ids.length) return mal('indique a qué mercancía aplica (departamentos, palabras de la descripción o artículos)');
    return { ok: true, promo: p.tipo === 'nxm' ? { ...base, lleva: p.lleva, paga: p.paga, alcance } : { ...base, lleva: p.lleva, precio: p.precio, alcance } };
  }
  if (p.tipo === 'por_cada') {
    if (!entero(p.cada, 1) || !entero(p.descuenta, 1) || p.descuenta! >= p.cada!) return mal('el descuento debe ser mayor que 0 y menor que el monto de compra');
    return { ok: true, promo: { ...base, cada: p.cada, descuenta: p.descuenta } };
  }
  // Un cupón regalado en el ticket no lleva código propio: cada ticket imprime el suyo.
  const codigo = regalo ? '' : normCodigo(p.codigo);
  if (!regalo && !/^[A-Z0-9-]{3,24}$/.test(codigo)) return mal('el código del cupón lleva de 3 a 24 letras, números o guiones');
  if (!regalo && otras.some((o) => o.tipo === 'cupon' && o.id !== p.id && o.codigo === codigo)) return { ok: false, error: { codigo: 'CODIGO_REPETIDO', mensaje: `el código ${codigo} ya existe` } };
  const tienePct = p.pct !== undefined && p.pct !== null, tieneMonto = p.monto !== undefined && p.monto !== null;
  if (tienePct === tieneMonto) return mal('el cupón es de un porcentaje o de un monto fijo, no ambos');
  if (tienePct && (!entero(p.pct, 1) || p.pct! > 100)) return mal('el porcentaje debe ser un entero de 1 a 100');
  if (tieneMonto && !entero(p.monto, 1)) return mal('el monto de descuento debe ser mayor que 0');
  const minimo = p.minimo ?? 0;
  if (!entero(minimo, 0)) return mal('la compra mínima no es válida');
  const usos = regalo ? null : (p.usos_max ?? null);
  if (usos !== null && !entero(usos, 1)) return mal('los usos máximos deben ser un entero mayor que 0 (o vacío para sin límite)');
  return { ok: true, promo: { ...base, ...(regalo ? {} : { codigo }), ...(tienePct ? { pct: p.pct } : { monto: p.monto }), minimo, usos_max: usos } };
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

type Reparto = Map<Linea, number>;

/** Descuento que daría UNA promoción sobre la mercancía (sin aplicarlo). El de cada línea nunca pasa de lo que le queda por cobrar. */
function descuentoDe(p: Promocion, merc: Linea[], restante: (l: Linea) => number, usarCupon = false): Reparto {
  const por: Reparto = new Map();
  const suma = (l: Linea, m: number) => { if (m > 0) por.set(l, Math.min((por.get(l) ?? 0) + m, restante(l))); };
  if (p.tipo === 'nxm' || p.tipo === 'paquete') {
    const unidades: { l: Linea; precio: number }[] = [];
    for (const l of merc) if (aplicaAlcance(p.alcance!, l)) for (let i = 0; i < l.qty; i++) unidades.push({ l, precio: l.precio_unit });
    unidades.sort((a, b) => b.precio - a.precio);
    const maxGrupos = p.acumulable === false ? 1 : Infinity;
    for (let g = 0; (g + 1) * p.lleva! <= unidades.length && g < maxGrupos; g++) {
      const grupo = unidades.slice(g * p.lleva!, (g + 1) * p.lleva!);
      if (p.tipo === 'nxm') {
        for (const u of grupo.slice(grupo.length - (p.lleva! - p.paga!))) suma(u.l, u.precio);
      } else {
        const lista = grupo.reduce((a, u) => a + u.precio, 0);
        const desc = lista - p.precio!;
        if (desc > 0) repartir(desc, grupo.map((u) => u.precio)).forEach((m, i) => suma(grupo[i]!.l, m));
      }
    }
    return por;
  }
  const elegible = merc.reduce((a, l) => a + restante(l), 0);
  let monto = 0;
  if (p.tipo === 'por_cada') monto = Math.min(Math.min(Math.floor(elegible / p.cada!), p.acumulable === false ? 1 : Infinity) * p.descuenta!, elegible);
  else if (usarCupon) monto = Math.min(p.pct !== undefined ? Math.floor((elegible * p.pct + 50) / 100) : p.monto!, elegible);
  if (monto > 0) repartir(monto, merc.map(restante)).forEach((m, i) => suma(merc[i]!, m));
  return por;
}

/**
 * Calcula el descuento de un carrito. REGLA: en cada compra aplica UNA sola promoción o cupón (nunca se combinan): la que más
 * descuento le da al cliente (empate: la primera creada). El descuento MANUAL autorizado por un supervisor se respeta aparte y
 * las promociones se calculan sobre el precio de lista, sin pasar del importe de cada línea. Una promoción o cupón de una tienda
 * no aplica en la otra.
 */
/** Id del «descuento de empleada» entre las candidatas: compite con las promociones y cupones (aplica el que más le convenga, no se combinan). */
export const ID_DESCUENTO_EMPLEADA = 'descuento-empleada';
export interface ConfigEmpleada { pct: number; pct_uniforme: number }
export function calcularDescuentos(lineas: Linea[], promos: Promocion[], codigoCupon: string | null, hoy: string, usosCupon: (codigo: string) => number = () => 0, tienda = '', empleada: ConfigEmpleada | null = null): ResultadoDescuentos {
  const out: Linea[] = lineas.map((l) => ({ ...l, descuento_detalle: esMercancia(l) ? manualDe(l).map((d) => ({ ...d })) : [] }));
  const merc = out.filter(esMercancia);
  const restante = (l: Linea) => l.qty * l.precio_unit - (l.descuento_detalle ?? []).reduce((a, d) => a + d.monto, 0);
  const candidatas: { p: Promocion; por: Reparto; total: number }[] = [];
  const total = (r: Reparto) => [...r.values()].reduce((a, b) => a + b, 0);
  for (const p of promos) {
    if (esCanje(p) || p.regalo || !vigente(p, hoy) || (tienda && !aplicaEnTienda(p, tienda))) continue;
    const por = descuentoDe(p, merc, restante);
    if (total(por) > 0) candidatas.push({ p, por, total: total(por) });
  }
  // venta a empleada: su descuento (15 %, o 30 % en uniformes) compite con las promociones y cupones
  if (empleada) {
    const por: Reparto = new Map();
    for (const l of merc) {
      const m = Math.floor((restante(l) * (l.uniforme ? empleada.pct_uniforme : empleada.pct) + 50) / 100);
      if (m > 0) por.set(l, m);
    }
    if (total(por) > 0) candidatas.push({ p: { id: ID_DESCUENTO_EMPLEADA, tipo: 'cupon', nombre: 'Descuento de empleada', activa: true, inicio: null, fin: null, canje: true }, por, total: total(por) });
  }
  // cupón capturado: se revisa y compite con las promociones
  let cupon: ResultadoDescuentos['cupon'] = null;
  if (codigoCupon) {
    const cod = normCodigo(codigoCupon);
    const p = promos.find((x) => esCanje(x) && x.codigo === cod);
    const rechazo = (nombre: string, motivo: string) => ({ codigo: cod, nombre, monto: 0, aplicado: false, motivo });
    const elegible = merc.reduce((a, l) => a + restante(l), 0);
    if (!p) cupon = rechazo(cod, 'el cupón no existe');
    else if (tienda && !aplicaEnTienda(p, tienda)) cupon = rechazo(p.nombre, 'este cupón no es válido en esta tienda');
    else if (!p.activa) cupon = rechazo(p.nombre, 'el cupón está desactivado');
    else if (p.inicio && hoy < p.inicio) cupon = rechazo(p.nombre, `el cupón empieza el ${p.inicio}`);
    else if (p.fin && hoy > p.fin) cupon = rechazo(p.nombre, `el cupón venció el ${p.fin}`);
    else if (p.usos_max != null && usosCupon(cod) >= p.usos_max) cupon = rechazo(p.nombre, 'el cupón ya se usó el máximo de veces');
    else if (elegible < (p.minimo ?? 0)) cupon = rechazo(p.nombre, `requiere una compra de al menos $${((p.minimo ?? 0) / 100).toFixed(2)}`);
    else {
      const por = descuentoDe(p, merc, restante, true);
      if (total(por) > 0) { candidatas.push({ p, por, total: total(por) }); cupon = { codigo: cod, nombre: p.nombre, monto: total(por), aplicado: false }; }
      else cupon = rechazo(p.nombre, 'no hay importe al que aplicar el cupón');
    }
  }
  // gana UNA: la de mayor descuento (empate: la primera de la lista)
  let mejor: (typeof candidatas)[number] | null = null;
  for (const c of candidatas) if (!mejor || c.total > mejor.total) mejor = c;
  const aplicadas: AplicadaPromo[] = [];
  if (mejor) {
    const deEmpleada = mejor.p.id === ID_DESCUENTO_EMPLEADA;
    for (const [l, m] of mejor.por) l.descuento_detalle!.push({ tipo: deEmpleada ? 'empleada' : esCanje(mejor.p) ? 'cupon' : 'promo', ref: mejor.p.id, nombre: deEmpleada ? `Descuento de empleada ${l.uniforme ? empleada!.pct_uniforme : empleada!.pct}%${l.uniforme ? ' (uniforme)' : ''}` : mejor.p.nombre, monto: m });
    if (!esCanje(mejor.p) && !deEmpleada) aplicadas.push({ promo_id: mejor.p.id, nombre: mejor.p.nombre, tipo: mejor.p.tipo, monto: mejor.total });
  }
  if (cupon && !cupon.motivo) {
    if (mejor && esCanje(mejor.p) && mejor.p.id !== ID_DESCUENTO_EMPLEADA) cupon = { ...cupon, monto: mejor.total, aplicado: true };
    else cupon = { ...cupon, monto: 0, aplicado: false, motivo: mejor ? `no se combina: se aplicó «${mejor.p.nombre}», que da más descuento en esta compra` : 'no hay importe al que aplicar el cupón' };
  }
  for (const l of out) {
    l.descuento = (l.descuento_detalle ?? []).reduce((a, d) => a + d.monto, 0);
    l.importe = l.qty * l.precio_unit - l.descuento;
    if (!l.descuento_detalle?.length) delete l.descuento_detalle;
  }
  return { lineas: out, aplicadas, cupon };
}
