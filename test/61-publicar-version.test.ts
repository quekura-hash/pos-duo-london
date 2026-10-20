import assert from 'node:assert/strict';
import { test } from 'node:test';
// @ts-expect-error módulo .mjs sin tipos
import { publicar, versionDe } from '../windows/publicar.mjs';

/** Almacén simulado: guarda lo que se sube, en orden, y contesta como Supabase Storage. */
function servidor(opts: { clave?: string; falla?: string } = {}) {
  const objetos = new Map<string, Uint8Array>();
  const subidas: string[] = [];
  const f = (async (url: string, init: { method?: string; headers?: Record<string, string>; body?: unknown } = {}) => {
    const u = new URL(url);
    const json = (status: number, cuerpo: unknown, cab: Record<string, string> = {}) => new Response(JSON.stringify(cuerpo), { status, headers: { 'content-type': 'application/json', ...cab } });
    if (u.pathname === '/auth/v1/token') {
      const b = JSON.parse(String(init.body));
      return b.password === (opts.clave ?? 'buena') ? json(200, { access_token: 'jwt' }) : json(400, { error: 'invalid_grant' });
    }
    const m = /^\/storage\/v1\/object\/(?:public\/)?actualizaciones\/(.+)$/.exec(u.pathname);
    if (init.method === 'POST' && m) {
      if (init.headers?.Authorization !== 'Bearer jwt' || init.headers['x-upsert'] !== 'true') return json(403, { message: 'sin permiso' });
      const nombre = decodeURIComponent(m[1]!);
      if (opts.falla === nombre) return json(500, { message: 'disco lleno' });
      objetos.set(nombre, init.body as Uint8Array); subidas.push(nombre);
      return json(200, { Key: nombre });
    }
    if (u.pathname === '/storage/v1/object/list/actualizaciones') return json(200, [...objetos.keys()].map((name) => ({ name })));
    if (init.method === 'DELETE' && u.pathname === '/storage/v1/object/actualizaciones') { for (const n of JSON.parse(String(init.body)).prefixes) objetos.delete(n); return json(200, []); }
    if (m && (init.method === 'HEAD' || !init.method)) {
      const o = objetos.get(decodeURIComponent(m[1]!));
      if (!o) return json(404, {});
      return init.method === 'HEAD' ? new Response(null, { status: 200, headers: { 'content-length': String(o.length) } }) : new Response(o as BodyInit);
    }
    return json(404, {});
  }) as unknown as typeof fetch;
  return { f, objetos, subidas };
}
const carpeta = (v: string) => {
  const exe = new Uint8Array(1000 + v.length);
  const archivos: Record<string, Uint8Array> = { [`LonDuo-POS-Setup-${v}.exe`]: exe, [`LonDuo-POS-Setup-${v}.exe.blockmap`]: new Uint8Array(50), 'pruebas.yml': new TextEncoder().encode(`version: ${v}\nfiles:\n  - url: LonDuo-POS-Setup-${v}.exe\n    size: ${exe.length}\n`) };
  return { leer: (r: string) => archivos[r.split('/').pop()!]!, listarCarpeta: () => Object.keys(archivos) };
};
const base = { url: 'https://x.supabase.co', llave: 'pub', correo: 'p@x.mx', clave: 'buena', carpeta: '/dist/windows', registro: () => undefined };

test('PV1 publica en orden (instalador, mapa y AL FINAL el archivo de versión), verifica lo público y conserva 3 versiones', async () => {
  const s = servidor();
  for (const v of ['0.2.0', '0.2.1', '0.2.2', '0.2.3']) await publicar({ ...base, fetch: s.f, ...carpeta(v) });
  const ultimas = s.subidas.slice(-3);
  assert.deepEqual(ultimas, ['LonDuo-POS-Setup-0.2.3.exe', 'LonDuo-POS-Setup-0.2.3.exe.blockmap', 'pruebas.yml']);
  assert.deepEqual([...s.objetos.keys()].filter((n) => /Setup/.test(n)).map(versionDe).filter((v, i, a) => a.indexOf(v) === i).sort(), ['0.2.1', '0.2.2', '0.2.3'], 'la 0.2.0 se retiró; quedan las 3 últimas');
  assert.ok(!s.objetos.has('latest.yml'), 'sin --estable no se toca el canal estable');
  await publicar({ ...base, fetch: s.f, ...carpeta('0.2.3'), estable: true });
  assert.equal(new TextDecoder().decode(s.objetos.get('latest.yml')), new TextDecoder().decode(s.objetos.get('pruebas.yml')));
});

test('PV2 errores claros: contraseña mala, carpeta sin instalador, subida que falla (el archivo de versión no se sube)', async () => {
  await assert.rejects(publicar({ ...base, fetch: servidor().f, ...carpeta('0.2.3'), clave: 'mala' }), /No se pudo iniciar sesión con la cuenta publicadora/);
  await assert.rejects(publicar({ ...base, fetch: servidor().f, leer: () => new Uint8Array(1), listarCarpeta: () => ['pruebas.yml'] }), /No hay instalador/);
  const s = servidor({ falla: 'LonDuo-POS-Setup-0.2.3.exe.blockmap' });
  await assert.rejects(publicar({ ...base, fetch: s.f, ...carpeta('0.2.3') }), /No se pudo subir LonDuo-POS-Setup-0.2.3.exe.blockmap: disco lleno/);
  assert.ok(!s.objetos.has('pruebas.yml'), 'si algo falla, las cajas no ven una versión a medias');
});
