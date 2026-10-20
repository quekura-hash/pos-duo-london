// Publica una versión de la app de Windows en el almacén `actualizaciones` de Supabase.
// Uso: node windows/publicar.mjs [--estable]      (necesita LONDUO_PUBLICADOR_CORREO y LONDUO_PUBLICADOR_CLAVE en el entorno)
//  - Sube primero el instalador y su .blockmap y AL FINAL el archivo de versión: así ninguna caja ve una versión cuyo instalador aún no está.
//  - `--estable` publica además la versión como `latest.yml` (canal estable). Sin ella solo va al canal de pruebas (`pruebas.yml`).
//  - Se conservan las últimas 3 versiones (el .blockmap de la instalada hace falta para las actualizaciones diferenciales).
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const BUCKET = 'actualizaciones';
const COPIAS = 3;
const MIME = { '.exe': 'application/octet-stream', '.blockmap': 'application/octet-stream', '.yml': 'text/yaml' };
const tipoDe = (n) => MIME[n.slice(n.lastIndexOf('.'))] ?? 'application/octet-stream';

/** Versión (X.Y.Z) de un nombre como LonDuo-POS-Setup-0.2.2.exe[.blockmap]. */
export const versionDe = (nombre) => /Setup-(\d+\.\d+\.\d+)\.exe/.exec(nombre)?.[1] ?? null;
const cmpVersion = (a, b) => { const x = a.split('.').map(Number), y = b.split('.').map(Number); for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] - y[i]; return 0; };

/**
 * @param {{ url: string, llave: string, correo: string, clave: string, carpeta: string, estable?: boolean, fetch?: typeof fetch, leer?: (ruta: string) => Uint8Array, listarCarpeta?: (c: string) => string[], registro?: (t: string) => void }} o
 */
export async function publicar(o) {
  const f = o.fetch ?? fetch;
  const log = o.registro ?? ((t) => console.log(t));
  const leer = o.leer ?? ((r) => readFileSync(r));
  const archivos = (o.listarCarpeta ?? ((c) => readdirSync(c)))(o.carpeta);
  const exe = archivos.find((n) => /^LonDuo-POS-Setup-\d+\.\d+\.\d+\.exe$/.test(n));
  if (!exe) throw new Error(`No hay instalador en ${o.carpeta}. Arme primero la versión con node windows/construir.mjs.`);
  const mapa = `${exe}.blockmap`;
  if (!archivos.includes(mapa) || !archivos.includes('pruebas.yml')) throw new Error('Faltan el .blockmap o pruebas.yml de esa versión.');
  const version = versionDe(exe);
  const base = o.url.replace(/\/+$/, '');

  const auth = await f(`${base}/auth/v1/token?grant_type=password`, { method: 'POST', headers: { apikey: o.llave, 'Content-Type': 'application/json' }, body: JSON.stringify({ email: o.correo, password: o.clave }) });
  const sesion = await auth.json().catch(() => ({}));
  if (!auth.ok || !sesion.access_token) throw new Error('No se pudo iniciar sesión con la cuenta publicadora (revise el correo y la contraseña).');
  const cab = { apikey: o.llave, Authorization: `Bearer ${sesion.access_token}` };

  const subir = async (nombre, bytes) => {
    const r = await f(`${base}/storage/v1/object/${BUCKET}/${encodeURIComponent(nombre)}`, { method: 'POST', headers: { ...cab, 'Content-Type': tipoDe(nombre), 'x-upsert': 'true', 'cache-control': 'no-cache' }, body: bytes });
    if (!r.ok) throw new Error(`No se pudo subir ${nombre}: ${(await r.json().catch(() => ({}))).message ?? r.status}`);
    log(`  subido ${nombre} (${(bytes.length / 1048576).toFixed(1)} MB)`);
  };
  const dir = (n) => join(o.carpeta, n);
  log(`Publicando LonDuo POS v${version}…`);
  await subir(exe, leer(dir(exe)));
  await subir(mapa, leer(dir(mapa)));
  const yml = leer(dir('pruebas.yml'));
  await subir('pruebas.yml', yml);
  if (o.estable) await subir('latest.yml', yml);

  // Verificación: lo que ve cualquier caja (sin credenciales) debe ser esta versión.
  const visto = await (await f(`${base}/storage/v1/object/public/${BUCKET}/pruebas.yml?t=${Date.now()}`)).text();
  if (!new RegExp(`^version: ${version.replace(/\./g, '\\.')}$`, 'm').test(visto)) throw new Error('Se subió, pero la dirección pública no muestra la versión nueva todavía.');
  const cabeza = await f(`${base}/storage/v1/object/public/${BUCKET}/${encodeURIComponent(exe)}`, { method: 'HEAD' });
  const esperado = Number(/size: (\d+)/.exec(visto)?.[1] ?? NaN);
  if (!cabeza.ok || (Number.isFinite(esperado) && Number(cabeza.headers.get('content-length')) !== esperado)) throw new Error('El instalador público no coincide con el tamaño esperado.');

  // Retención: se conservan las últimas COPIAS versiones.
  const lista = await f(`${base}/storage/v1/object/list/${BUCKET}`, { method: 'POST', headers: { ...cab, 'Content-Type': 'application/json' }, body: JSON.stringify({ prefix: '', limit: 200 }) });
  const nombres = lista.ok ? (await lista.json()).map((x) => x.name) : [];
  const versiones = [...new Set(nombres.map(versionDe).filter(Boolean))].sort(cmpVersion);
  const sobran = versiones.slice(0, Math.max(0, versiones.length - COPIAS));
  const borrar = nombres.filter((n) => sobran.includes(versionDe(n)));
  if (borrar.length) {
    const r = await f(`${base}/storage/v1/object/${BUCKET}`, { method: 'DELETE', headers: { ...cab, 'Content-Type': 'application/json' }, body: JSON.stringify({ prefixes: borrar }) });
    if (r.ok) log(`  retiradas versiones viejas: ${sobran.join(', ')}`);
  }
  log(`Listo: v${version} publicada en ${o.estable ? 'pruebas y estable' : 'pruebas'}.`);
  return { version, canales: o.estable ? ['pruebas', 'estable'] : ['pruebas'], retiradas: sobran };
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const raiz = join(import.meta.dirname, '..');
  const central = JSON.parse(readFileSync(join(import.meta.dirname, 'central.json'), 'utf8'));
  const correo = process.env.LONDUO_PUBLICADOR_CORREO, clave = process.env.LONDUO_PUBLICADOR_CLAVE;
  if (!correo || !clave) { console.error('Faltan LONDUO_PUBLICADOR_CORREO y LONDUO_PUBLICADOR_CLAVE (se configuran como variables del entorno, nunca en el chat).'); process.exit(2); }
  void statSync;
  publicar({ url: central.url, llave: central.llave, correo, clave, carpeta: join(raiz, 'dist', 'windows'), estable: process.argv.includes('--estable') }).catch((e) => { console.error(`ERROR: ${e.message}`); process.exit(1); });
}
