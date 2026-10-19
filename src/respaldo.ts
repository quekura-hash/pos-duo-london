// Respaldo cifrado de los datos de la página de prueba (inventario importado y todo lo hecho después).
// Formato: «POSBAK1\0» + sal (16) + IV (12) + AES-256-GCM( gzip( JSON ) ), con la clave derivada por PBKDF2-SHA256 (250,000 vueltas).
// Se cifra ANTES de salir del equipo: quien tenga el archivo (OneDrive, Drive…) no lee nada sin la clave del respaldo.

export interface PaqueteRespaldo {
  version: 1;
  creado: string;
  /** Archivo de inventario importado y cómo se interpretó (null = datos de ejemplo). */
  inventario: unknown | null;
  /** Estado del banco: ventas, altas, entregas… (null = nada todavía). */
  estado: unknown | null;
}

const MAGIA = new TextEncoder().encode('POSBAK1\0');
const VUELTAS = 250_000;

export class ErrorRespaldo extends Error {
  readonly codigo: 'FORMATO_INVALIDO' | 'CLAVE_INCORRECTA' | 'CLAVE_CORTA';
  constructor(codigo: 'FORMATO_INVALIDO' | 'CLAVE_INCORRECTA' | 'CLAVE_CORTA', mensaje: string) { super(mensaje); this.codigo = codigo; }
}
export const CLAVE_MIN = 8;

const aBase64 = (b: Uint8Array) => { let s = ''; for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000)); return btoa(s); };
const deBase64 = (t: string) => Uint8Array.from(atob(t), (c) => c.charCodeAt(0));

async function flujo(datos: Uint8Array, t: CompressionStream | DecompressionStream): Promise<Uint8Array> {
  const w = t.writable.getWriter();
  void w.write(datos as BufferSource).then(() => w.close());
  return new Uint8Array(await new Response(t.readable).arrayBuffer());
}
async function derivar(clave: string, sal: Uint8Array): Promise<CryptoKey> {
  const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(clave), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey({ name: 'PBKDF2', salt: sal as BufferSource, iterations: VUELTAS, hash: 'SHA-256' }, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}

/** JSON que conserva los `Uint8Array` (el .xlsx importado) como base64. */
const serializar = (p: PaqueteRespaldo) => JSON.stringify(p, (_k, v) => (v instanceof Uint8Array ? { __u8: aBase64(v) } : v));
const deserializar = (t: string): PaqueteRespaldo => JSON.parse(t, (_k, v) => (v && typeof v === 'object' && typeof v.__u8 === 'string' ? deBase64(v.__u8) : v));

export async function cifrarRespaldo(p: PaqueteRespaldo, clave: string): Promise<Uint8Array> {
  if (typeof clave !== 'string' || clave.length < CLAVE_MIN) throw new ErrorRespaldo('CLAVE_CORTA', `la clave del respaldo lleva al menos ${CLAVE_MIN} caracteres`);
  const sal = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const comprimido = await flujo(new TextEncoder().encode(serializar(p)), new CompressionStream('gzip'));
  const cifrado = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: iv as BufferSource }, await derivar(clave, sal), comprimido as BufferSource));
  const out = new Uint8Array(MAGIA.length + 16 + 12 + cifrado.length);
  out.set(MAGIA, 0); out.set(sal, MAGIA.length); out.set(iv, MAGIA.length + 16); out.set(cifrado, MAGIA.length + 28);
  return out;
}

export async function descifrarRespaldo(bytes: Uint8Array, clave: string): Promise<PaqueteRespaldo> {
  if (bytes.length < MAGIA.length + 28 + 16 || !MAGIA.every((b, i) => bytes[i] === b)) throw new ErrorRespaldo('FORMATO_INVALIDO', 'el archivo no es un respaldo de la caja');
  const sal = bytes.subarray(MAGIA.length, MAGIA.length + 16);
  const iv = bytes.subarray(MAGIA.length + 16, MAGIA.length + 28);
  let comprimido: Uint8Array;
  try {
    comprimido = new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: iv as BufferSource }, await derivar(clave, sal), bytes.subarray(MAGIA.length + 28) as BufferSource));
  } catch {
    throw new ErrorRespaldo('CLAVE_INCORRECTA', 'la clave no es correcta o el archivo está dañado');
  }
  const p = deserializar(new TextDecoder().decode(await flujo(comprimido, new DecompressionStream('gzip'))));
  if (p?.version !== 1) throw new ErrorRespaldo('FORMATO_INVALIDO', 'versión de respaldo desconocida');
  return p;
}

const dos = (n: number) => String(n).padStart(2, '0');
/** `respaldo-pos-AAAA-MM-DD-HHMM.posbak` con la hora local de la computadora. */
export const nombreRespaldo = (d: Date) => `respaldo-pos-${d.getFullYear()}-${dos(d.getMonth() + 1)}-${dos(d.getDate())}-${dos(d.getHours())}${dos(d.getMinutes())}.posbak`;
export const esArchivoRespaldo = (n: string) => /^respaldo-pos-\d{4}-\d{2}-\d{2}-\d{4}\.posbak$/.test(n);
/** Rotación: de los respaldos que hay, cuáles borrar para conservar solo los `conservar` más recientes (el nombre ordena por fecha). */
export const sobrantes = (nombres: string[], conservar = 30) => nombres.filter(esArchivoRespaldo).sort().slice(0, Math.max(0, nombres.filter(esArchivoRespaldo).length - conservar));
