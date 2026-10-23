// Supervisores que autorizan descuentos con una clave numérica tecleada en la caja.
// La clave nunca se guarda: se guarda sal + SHA-256(sal + clave). Es un control de prototipo (no hay autenticación de usuarios todavía).

const K = [
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da, 0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
];

/** SHA-256 síncrono (funciona igual en Node y en el navegador). */
export function sha256(texto: string): string {
  const bytes = new TextEncoder().encode(texto);
  const l = bytes.length;
  const n = (((l + 9 + 63) >> 6) << 6);
  const m = new Uint8Array(n);
  m.set(bytes);
  m[l] = 0x80;
  const dv = new DataView(m.buffer);
  dv.setUint32(n - 4, (l * 8) >>> 0);
  dv.setUint32(n - 8, Math.floor((l * 8) / 2 ** 32));
  const h = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19];
  const w = new Uint32Array(64);
  const rr = (x: number, c: number) => (x >>> c) | (x << (32 - c));
  for (let o = 0; o < n; o += 64) {
    for (let i = 0; i < 16; i++) w[i] = dv.getUint32(o + i * 4);
    for (let i = 16; i < 64; i++) {
      const s0 = rr(w[i - 15]!, 7) ^ rr(w[i - 15]!, 18) ^ (w[i - 15]! >>> 3);
      const s1 = rr(w[i - 2]!, 17) ^ rr(w[i - 2]!, 19) ^ (w[i - 2]! >>> 10);
      w[i] = (w[i - 16]! + s0 + w[i - 7]! + s1) >>> 0;
    }
    let [a, b, c, d, e, f, g, hh] = h as [number, number, number, number, number, number, number, number];
    for (let i = 0; i < 64; i++) {
      const t1 = (hh + (rr(e, 6) ^ rr(e, 11) ^ rr(e, 25)) + ((e & f) ^ (~e & g)) + K[i]! + w[i]!) >>> 0;
      const t2 = ((rr(a, 2) ^ rr(a, 13) ^ rr(a, 22)) + ((a & b) ^ (a & c) ^ (b & c))) >>> 0;
      hh = g; g = f; f = e; e = (d + t1) >>> 0; d = c; c = b; b = a; a = (t1 + t2) >>> 0;
    }
    h[0] = (h[0]! + a) >>> 0; h[1] = (h[1]! + b) >>> 0; h[2] = (h[2]! + c) >>> 0; h[3] = (h[3]! + d) >>> 0;
    h[4] = (h[4]! + e) >>> 0; h[5] = (h[5]! + f) >>> 0; h[6] = (h[6]! + g) >>> 0; h[7] = (h[7]! + hh) >>> 0;
  }
  return h.map((x) => x.toString(16).padStart(8, '0')).join('');
}

/** Supervisor de caja: autoriza descuentos y cambios con su clave numérica y también puede iniciar sesión y cobrar en la caja. `solo_caja` (almacenista que también cobra): puede cobrar pero NO autoriza descuentos. */
export interface Supervisor { id: string; nombre: string; activo: boolean; sal: string; hash: string; solo_caja?: boolean }
export const hashClave = (sal: string, clave: string) => sha256(`${sal}:${clave}`);
export const claveValida = (c: unknown): c is string => typeof c === 'string' && /^\d{4,8}$/.test(c);

/** Cajero con clave propia: confirma operaciones a su nombre (p. ej. dar de alta un artículo en la caja). La clave se guarda con sal y hash, como la de los supervisores. */
export interface Cajero {
  id: string; nombre: string; activo: boolean; sal: string; hash: string; perfil?: Perfil;
  /** Tienda donde trabaja hoy («vendió por» solo la muestra ahí). Vacío o ausente = en todas. Cambia sola cuando inicia sesión en otra tienda (`cajero.ubicacion`). */
  tienda?: string;
}
/**
 * Registro de la persona. El `nombre` del usuario (cajero, supervisor o almacenista) es su ALIAS: lo que se elige al iniciar sesión, sale en el ticket
 * y en los reportes. Aquí van los datos completos; `foto` es una imagen pequeña (data URL) tomada con la cámara de la PC.
 */
export interface Perfil { nombres: string; apellidos: string; telefono: string; direccion: string; foto?: string }
const FOTO_RE = /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/;
/** Valida y mezcla los datos del perfil: lo no enviado se conserva; un texto vacío lo borra. Sin ningún dato devuelve undefined. */
export function mezclarPerfil(actual: Perfil | undefined, d: Partial<Perfil> | undefined): { ok: true; perfil: Perfil | undefined } | { ok: false; mensaje: string } {
  const limpia = (v: unknown, max: number, rotulo: string): string | { error: string } => {
    const t = String(v ?? '').trim().replace(/\s+/g, ' ');
    return t.length > max ? { error: `${rotulo} admite hasta ${max} caracteres` } : t;
  };
  const campos: [keyof Pick<Perfil, 'nombres' | 'apellidos' | 'telefono' | 'direccion'>, number, string][] = [['nombres', 60, 'Los nombres'], ['apellidos', 60, 'Los apellidos'], ['telefono', 20, 'El teléfono'], ['direccion', 160, 'La dirección']];
  const out: Perfil = { nombres: actual?.nombres ?? '', apellidos: actual?.apellidos ?? '', telefono: actual?.telefono ?? '', direccion: actual?.direccion ?? '', ...(actual?.foto ? { foto: actual.foto } : {}) };
  for (const [k, max, rotulo] of campos) {
    if (d?.[k] === undefined) continue;
    const t = limpia(d[k], max, rotulo);
    if (typeof t !== 'string') return { ok: false, mensaje: t.error };
    out[k] = t;
  }
  if (out.telefono && !/^[0-9+()\-\s]{7,20}$/.test(out.telefono)) return { ok: false, mensaje: 'el teléfono solo lleva números (y + - ( ) espacios), de 7 a 20 caracteres' };
  if (d?.foto !== undefined) {
    if (d.foto === '' || d.foto === null) delete out.foto;
    else if (typeof d.foto !== 'string' || d.foto.length > 200_000 || !FOTO_RE.test(d.foto)) return { ok: false, mensaje: 'la foto debe ser una imagen JPEG, PNG o WebP de hasta 150 KB' };
    else out.foto = d.foto;
  }
  const vacio = !out.nombres && !out.apellidos && !out.telefono && !out.direccion && !out.foto;
  return { ok: true, perfil: vacio ? undefined : out };
}
/** Administrador: contraseña de 6 a 40 caracteres. Sus registros solo viven en el central (no se reparten a las cajas). */
/** Quien entra a Administración: el supervisor ve todo y autoriza en la caja; el almacenista solo trabaja Inventario y Almacén. Sin `rol` (registros anteriores) vale supervisor. */
export type RolAdmin = 'supervisor' | 'almacenista';
export type Administrador = Cajero & { rol?: RolAdmin };
export const claveAdminValida = (c: unknown): c is string => typeof c === 'string' && c.length >= 6 && c.length <= 40;
/** Los nombres se comparan sin importar mayúsculas, acentos ni espacios de más. */
export const nombreClave = (n: string) => n.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();

/** El supervisor activo cuya clave coincide, o null. */
export function supervisorPorClave(lista: Supervisor[], clave: string): Supervisor | null {
  if (!claveValida(clave)) return null;
  return lista.find((s) => s.activo && s.hash === hashClave(s.sal, clave)) ?? null;
}
