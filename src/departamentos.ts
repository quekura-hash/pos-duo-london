// Departamentos: catálogo editable (alta, renombre, desactivar, alias) y resolución de nombres al importar un archivo.
// Módulo puro: sin red ni almacenamiento. Las operaciones `depto.*` viven en el log del central (ver proyecciones.ts).

export interface Departamento {
  id: string;
  nombre: string;
  activo: boolean;
  /** Otras formas de escribir el departamento que se aceptan sin preguntar (p. ej. «mujer plus»). */
  alias: string[];
}

export const DEPTO_SIN_CLASIFICAR = 'Sin clasificar';
export const DEPTO_ENVOLTURAS = 'Envolturas y Bolsas de regalo';

/** Catálogo inicial. Ya no incluye Zapatos ni Niños (no se venden). */
export const DEPARTAMENTOS_BASE: Departamento[] = [
  { id: 'dama', nombre: 'Dama', activo: true, alias: ['mujer', 'damas', 'ladies', 'women', 'woman'] },
  { id: 'dama-plus', nombre: 'Dama Plus', activo: true, alias: ['mujer plus', 'plus', 'curvy', 'talla extra', 'tallas extra', 'dama talla extra'] },
  { id: 'vestidos-de-noche', nombre: 'Vestidos de noche', activo: true, alias: ['noche', 'vestido de noche', 'vestidos noche', 'gala', 'fiesta'] },
  { id: 'caballero', nombre: 'Caballero', activo: true, alias: ['hombre', 'caballeros', 'men', 'man'] },
  { id: 'accesorios', nombre: 'Accesorios', activo: true, alias: ['accesorio', 'accesorios dama', 'valiz'] },
  { id: 'accesorios-caballero', nombre: 'Accesorios caballero', activo: true, alias: ['accesorios hombre', 'accesorio caballero'] },
  { id: 'bolsos-y-carteras', nombre: 'Bolsos y Carteras', activo: true, alias: ['bolsas y equipaje', 'bolsas', 'bolsa', 'bolsos', 'carteras', 'equipaje', 'bolsas equipaje'] },
  { id: 'cosmeticos-y-perfumes', nombre: 'Cosméticos y perfumes', activo: true, alias: ['cosmeticos', 'perfumes', 'perfumeria', 'fragancias'] },
  { id: 'envolturas', nombre: DEPTO_ENVOLTURAS, activo: true, alias: ['envolturas', 'bolsas de regalo', 'cajas de regalo', 'empaque'] },
  { id: 'tarjetas-de-regalo', nombre: 'Tarjetas de regalo y cupones', activo: true, alias: ['tarjetas de regalo', 'tarjetas', 'cupones', 'regalos', 'gift card'] },
  { id: 'electronicos', nombre: 'Electrónicos', activo: true, alias: ['electronica'] },
  { id: 'sin-clasificar', nombre: DEPTO_SIN_CLASIFICAR, activo: true, alias: ['system', 'sin departamento', 'general'] },
];

/** Departamentos que ya no se venden: sus artículos se importan como «Sin clasificar» con un aviso. */
export const DESCONTINUADOS = ['zapatos', 'zapato', 'calzado', 'shoes', 'ninos', 'ninas', 'nino', 'nina', 'kids', 'infantil'];

const sinAcentos = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '');
/** Forma comparable: sin acentos, minúsculas, sin signos ni espacios repetidos. */
export const normalizarDepto = (s: unknown): string =>
  sinAcentos(String(s ?? '')).toLowerCase().replace(/[^a-z0-9ñ]+/g, ' ').replace(/\s+/g, ' ').trim();

const singular = (t: string) => (t.length > 3 && t.endsWith('s') ? t.slice(0, -1) : t);
const tokens = (k: string) => k.split(' ').filter(Boolean).map(singular);

function distancia(a: string, b: string): number {
  const prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    let diag = prev[0]!;
    prev[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = prev[j]!;
      prev[j] = Math.min(prev[j]! + 1, prev[j - 1]! + 1, diag + (a[i - 1] === b[j - 1] ? 0 : 1));
      diag = tmp;
    }
  }
  return prev[b.length]!;
}

/** Parecido entre 0 y 1: el mayor entre la cercanía de letras y el traslape de palabras. */
export function parecido(a: string, b: string): number {
  if (!a || !b) return 0;
  const letras = 1 - distancia(a, b) / Math.max(a.length, b.length);
  const ta = tokens(a), tb = tokens(b);
  const comunes = ta.filter((t) => tb.includes(t)).length;
  const palabras = comunes / new Set([...ta, ...tb]).size;
  return Math.max(letras, palabras);
}

export type EstadoResolucion = 'vacio' | 'exacto' | 'alias' | 'descontinuado' | 'sugerido' | 'desconocido';
export interface Resolucion {
  original: string;
  estado: EstadoResolucion;
  /** Nombre del departamento propuesto (siempre uno que existe y está activo). */
  propuesto: string;
  sugerencias: { nombre: string; puntaje: number }[];
}

const UMBRAL_SUGERENCIA = 0.6;

/** Qué departamento le toca a un texto del archivo. Nunca inventa: lo que no reconoce cae en «Sin clasificar» y se avisa. */
export function resolverDepartamento(original: string, catalogo: Departamento[] = DEPARTAMENTOS_BASE): Resolucion {
  const activos = catalogo.filter((d) => d.activo);
  const sin = activos.find((d) => d.id === 'sin-clasificar')?.nombre ?? DEPTO_SIN_CLASIFICAR;
  const k = normalizarDepto(original);
  if (!k) return { original, estado: 'vacio', propuesto: sin, sugerencias: [] };
  const exacto = activos.find((d) => normalizarDepto(d.nombre) === k);
  if (exacto) return { original, estado: 'exacto', propuesto: exacto.nombre, sugerencias: [] };
  const porAlias = activos.find((d) => d.alias.some((a) => normalizarDepto(a) === k));
  if (porAlias) return { original, estado: 'alias', propuesto: porAlias.nombre, sugerencias: [{ nombre: porAlias.nombre, puntaje: 1 }] };
  if (DESCONTINUADOS.includes(k)) return { original, estado: 'descontinuado', propuesto: sin, sugerencias: [] };
  const puntos = activos
    .map((d) => ({ nombre: d.nombre, puntaje: Math.max(...[d.nombre, ...d.alias].map((c) => parecido(k, normalizarDepto(c)))) }))
    .filter((x) => x.puntaje >= 0.45)
    .sort((x, y) => y.puntaje - x.puntaje || x.nombre.localeCompare(y.nombre))
    .slice(0, 3);
  if (puntos[0] && puntos[0].puntaje >= UMBRAL_SUGERENCIA) return { original, estado: 'sugerido', propuesto: puntos[0].nombre, sugerencias: puntos };
  return { original, estado: 'desconocido', propuesto: sin, sugerencias: puntos };
}

/** Regla de descripción: bolsas y cajas de regalo van juntas, sin importar el departamento con que vengan. */
export function esEnvoltura(a: { descripcion?: string; marca?: string; estilo?: string }): boolean {
  const t = normalizarDepto(`${a.descripcion ?? ''} ${a.marca ?? ''} ${a.estilo ?? ''}`);
  if (/\b(tarjeta|tarjetas|cupon|cupones|gift card)\b/.test(t)) return false;
  return /\b(bolsas?|cajas?|envolturas?)\b.*\bregalo\b|\bregalo\b.*\b(bolsas?|cajas?|envolturas?)\b|\bgift ?(bag|box)\b/.test(t);
}

export interface GrupoDepto extends Resolucion {
  /** Texto normalizado: la llave de las decisiones. */
  clave: string;
  /** Artículos del archivo que traen este texto. */
  articulos: number;
  filas_ejemplo: number[];
}

/** Agrupa los textos distintos de departamento del archivo y propone qué hacer con cada uno. */
export function revisarDepartamentos(
  arts: { departamento: string; fila_origen: number }[],
  catalogo: Departamento[] = DEPARTAMENTOS_BASE,
): GrupoDepto[] {
  const g = new Map<string, GrupoDepto>();
  for (const a of arts) {
    const clave = normalizarDepto(a.departamento);
    let x = g.get(clave);
    if (!x) g.set(clave, (x = { ...resolverDepartamento(a.departamento, catalogo), clave, articulos: 0, filas_ejemplo: [] }));
    x.articulos++;
    if (x.filas_ejemplo.length < 3) x.filas_ejemplo.push(a.fila_origen);
  }
  const peso = (x: GrupoDepto) => (x.estado === 'exacto' || x.estado === 'alias' ? 1 : 0);
  return [...g.values()].sort((a, b) => peso(a) - peso(b) || b.articulos - a.articulos);
}

export interface OpcionesDepto {
  /** Texto original (normalizado) → nombre elegido. Lo que falte se resuelve con la propuesta. */
  decisiones?: Record<string, string>;
  /** Aplica la regla de bolsas/cajas de regalo. Predeterminado: sí. */
  reglaEnvolturas?: boolean;
}

/** Asigna el departamento final de cada artículo. Devuelve cuántos cambiaron por la regla de envolturas. */
export function aplicarDepartamentos<T extends { departamento: string; descripcion?: string; marca?: string; estilo?: string; fila_origen: number }>(
  arts: T[], catalogo: Departamento[], o: OpcionesDepto = {},
): { articulos: T[]; porEnvoltura: number; sinDestino: string[] } {
  const activos = new Set(catalogo.filter((d) => d.activo).map((d) => d.nombre));
  const cache = new Map<string, string>();
  const sinDestino = new Set<string>();
  let porEnvoltura = 0;
  const envolturas = catalogo.find((d) => d.activo && d.id === 'envolturas')?.nombre;
  const articulos = arts.map((a) => {
    const k = normalizarDepto(a.departamento);
    let destino = cache.get(k);
    if (destino === undefined) {
      const elegido = o.decisiones?.[k];
      if (elegido !== undefined && !activos.has(elegido)) sinDestino.add(elegido);
      destino = elegido !== undefined && activos.has(elegido) ? elegido : resolverDepartamento(a.departamento, catalogo).propuesto;
      cache.set(k, destino);
    }
    if ((o.reglaEnvolturas ?? true) && envolturas && destino !== envolturas && esEnvoltura(a)) { destino = envolturas; porEnvoltura++; }
    return { ...a, departamento: destino };
  });
  return { articulos, porEnvoltura, sinDestino: [...sinDestino] };
}

// ── proyección del catálogo a partir de operaciones ──
export const slug = (s: string) => normalizarDepto(s).replace(/ /g, '-');

type OpDepto = { tipo: string; payload: any };
export interface CambioRenombre { de: string; a: string }

/** Aplica una operación `depto.*` a la lista. Devuelve el renombre ocurrido para que los artículos lo sigan. */
export function aplicarOpDepto(lista: Departamento[], o: OpDepto): CambioRenombre | null {
  const p = o.payload;
  if (o.tipo === 'depto.alta') {
    if (!lista.some((d) => d.id === p.id)) lista.push({ id: p.id, nombre: p.nombre, activo: true, alias: [...(p.alias ?? [])] });
    return null;
  }
  if (o.tipo === 'depto.editado') {
    const d = lista.find((x) => x.id === p.id);
    if (!d) return null;
    let cambio: CambioRenombre | null = null;
    if (typeof p.nombre === 'string' && p.nombre !== d.nombre) { cambio = { de: d.nombre, a: p.nombre }; d.nombre = p.nombre; }
    if (typeof p.activo === 'boolean') d.activo = p.activo;
    if (Array.isArray(p.alias)) d.alias = [...p.alias];
    return cambio;
  }
  return null;
}

export const copiarBase = (): Departamento[] => DEPARTAMENTOS_BASE.map((d) => ({ ...d, alias: [...d.alias] }));

export interface CambioDepto { id?: string; nombre?: string; activo?: boolean; alias?: string[] }
export type ErrorDepto = { codigo: 'NOMBRE_REQUERIDO' | 'NOMBRE_REPETIDO' | 'ALIAS_REPETIDO' | 'NO_EXISTE' | 'NO_SE_PUEDE_DESACTIVAR'; mensaje: string };

/** Valida un alta (sin id) o una edición. Los nombres y alias no se pueden repetir entre departamentos (comparados sin acentos ni mayúsculas). */
export function validarCambioDepto(lista: Departamento[], c: CambioDepto): ErrorDepto | null {
  const actual = c.id ? lista.find((d) => d.id === c.id) : undefined;
  if (c.id && !actual) return { codigo: 'NO_EXISTE', mensaje: 'el departamento no existe' };
  if (!c.id && !normalizarDepto(c.nombre)) return { codigo: 'NOMBRE_REQUERIDO', mensaje: 'falta el nombre del departamento' };
  if (c.nombre !== undefined && !normalizarDepto(c.nombre)) return { codigo: 'NOMBRE_REQUERIDO', mensaje: 'falta el nombre del departamento' };
  if (actual?.id === 'sin-clasificar' && c.activo === false) return { codigo: 'NO_SE_PUEDE_DESACTIVAR', mensaje: '«Sin clasificar» es el destino de lo que no se reconoce y no se puede desactivar' };
  const otros = lista.filter((d) => d.id !== actual?.id);
  const nombre = c.nombre ?? actual?.nombre ?? '';
  const alias = c.alias ?? actual?.alias ?? [];
  const usados = new Map<string, string>();
  for (const d of otros) for (const x of [d.nombre, ...d.alias]) usados.set(normalizarDepto(x), d.nombre);
  if (usados.has(normalizarDepto(nombre))) return { codigo: 'NOMBRE_REPETIDO', mensaje: `«${nombre}» ya existe como «${usados.get(normalizarDepto(nombre))}»` };
  for (const a of alias) {
    const k = normalizarDepto(a);
    if (k && usados.has(k)) return { codigo: 'ALIAS_REPETIDO', mensaje: `«${a}» ya es un nombre o alias de «${usados.get(k)}»` };
  }
  return null;
}
