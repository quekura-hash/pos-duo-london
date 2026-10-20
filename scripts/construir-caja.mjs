// Genera dist/caja.html: la CAJA de LonDuo POS conectada al central (Supabase); se empaqueta dentro de la app de Windows.
// Variables opcionales al construir: LONDUO_SUPABASE_URL y LONDUO_SUPABASE_KEY (la llave PÚBLICA/publishable; nunca la service_role).
import { build } from 'esbuild';
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const raiz = join(import.meta.dirname, '..');
const STUBS = {
  'node:sqlite': 'export class DatabaseSync { constructor() { throw new Error("SQLite no está disponible en el navegador"); } }',
  'node:fs': 'const no = () => { throw new Error("sin sistema de archivos"); }; export const copyFileSync = no, mkdirSync = no, rmSync = no, writeFileSync = no, readFileSync = no;',
  'node:path': 'export const join = (...p) => p.join("/");',
  'node:crypto': 'export const randomUUID = () => crypto.randomUUID();',
};
const r = await build({
  entryPoints: [join(raiz, 'src/app/caja-nube-navegador.ts')], bundle: true, format: 'iife', globalName: 'PosCaja', platform: 'browser', target: 'es2022', write: false,
  plugins: [{ name: 'stubs-de-node', setup(b) {
    b.onResolve({ filter: /^node:/ }, (a) => ({ path: a.path, namespace: 'stub' }));
    b.onLoad({ filter: /.*/, namespace: 'stub' }, (a) => ({ contents: STUBS[a.path] ?? 'export {}', loader: 'js' }));
  } }],
});
const seguro = (t) => t.replace(/<\/script/gi, '<\\/script');
const bundle = seguro(r.outputFiles[0].text);
const logo = (n) => 'data:image/png;base64,' + readFileSync(join(raiz, 'src/app/publico', n)).toString('base64');
const logos = JSON.stringify({ DUO: logo('logo-duo.png'), LON: logo('logo-london.png') });
const logosTicket = JSON.stringify({ DUO: logo('ticket-duo.png'), LON: logo('ticket-london.png') });
const css = readFileSync(join(raiz, 'src/app/publico/estilos.css'), 'utf8');
const app = seguro(readFileSync(join(raiz, 'src/app/publico/app.js'), 'utf8'));
const qr = seguro(readFileSync(join(raiz, 'src/app/publico/qr.js'), 'utf8'));
const arranque = seguro(readFileSync(join(raiz, 'scripts/arranque-caja.js'), 'utf8'));

const VERSION = (() => {
  const v = JSON.parse(readFileSync(join(raiz, 'package.json'), 'utf8')).version;
  let sha = 'sin-git';
  try { sha = execFileSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: raiz, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim(); } catch { /* sin git */ }
  const f = new Date().toISOString().slice(0, 10);
  return { numero: v, commit: sha, fecha: f, texto: `Caja v${v} · ${sha} · ${f}` };
})();
const CENTRAL = { url: process.env.LONDUO_SUPABASE_URL ?? '', llave: process.env.LONDUO_SUPABASE_KEY ?? '' };
if (/service_role/i.test(CENTRAL.llave) || (CENTRAL.llave.startsWith('eyJ') && JSON.parse(Buffer.from(CENTRAL.llave.split('.')[1] ?? '', 'base64url').toString() || '{}').role === 'service_role')) {
  throw new Error('Esa es la llave service_role: NUNCA va en una página. Use la llave pública (anon/publishable).');
}

const estilo = `
#puerta { position: fixed; inset: 0; z-index: 100; background: var(--fondo, #f6f5f3); overflow: auto; padding: 24px 16px; }
#puerta[hidden] { display: none; } #puerta .panel { max-width: 440px; margin: 40px auto; } #puerta input { width: 100%; box-sizing: border-box; }
.app { min-height: 100vh; }`;
const marcado = `
<div class="app">
  <header class="encabezado" id="encabezado" aria-label="Estado de la caja"></header>
  <aside class="nav" aria-label="Navegación principal"><nav id="nav"></nav><div id="tc-barra" class="tc" aria-label="Tipo de cambio del dólar"></div></aside>
  <main id="vista" tabindex="-1"></main>
  <footer class="pie" id="pie" aria-label="Estado de la sesión"></footer>
</div>
<dialog id="dlg-ticket" aria-labelledby="dlg-titulo"></dialog>
<dialog id="dlg-tc" aria-labelledby="tc-titulo"></dialog>
<div id="puerta" role="dialog" aria-labelledby="pu-titulo">
  <section class="panel">
    <div style="text-align:center;margin-bottom:14px"><div style="font-size:26px;font-weight:800;letter-spacing:.5px" id="pu-titulo">LonDuo POS</div><div class="nota" style="margin:0">Smart Retail Management · Caja</div><div class="nota" id="version-pos" style="margin:2px 0 0;font-size:11px">${VERSION.texto}</div></div>
    <div id="msg-puerta" class="mensaje" role="alert"></div>
    <form id="pu-form" autocomplete="off" hidden>
      <div class="campo"><label for="pu-correo">Cuenta de esta caja (correo)</label><input id="pu-correo" type="email" autocomplete="off"></div>
      <div class="campo"><label for="pu-clave">Contraseña de la caja</label><input id="pu-clave" type="password" autocomplete="off"></div>
      <button class="btn btn-primario" type="submit" id="pu-entrar"><span>Conectar esta caja</span></button>
      <button class="btn" type="button" id="pu-reintentar" style="margin-top:8px"><span>Reintentar con la cuenta guardada</span></button>
    </form>
  </section>
</div>`;
const piezas = `<title>LonDuo POS · Caja</title>
<style>
${css}
${estilo}
</style>
${marcado}
<script>window.__POS_MANUAL__ = true; window.__POS_VERSION__ = ${JSON.stringify(VERSION)}; window.__POS_CENTRAL__ = ${JSON.stringify(CENTRAL)}; window.__POS_LOGOS__ = ${logos}; window.__POS_LOGOS_TICKET__ = ${logosTicket};</script>
<script>
${qr}
</script>
<script>
${app}
</script>
<script>
${bundle}
${arranque}
</script>`;
const html = `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<link rel="icon" href="data:,">
</head>
<body>
${piezas}
</body>
</html>
`;
mkdirSync(join(raiz, 'dist'), { recursive: true });
writeFileSync(join(raiz, 'dist/caja.html'), html);
console.log(`dist/caja.html (${(html.length / 1024).toFixed(0)} KB) · ${VERSION.texto}${CENTRAL.url ? ' · central ' + CENTRAL.url : ''}`);
