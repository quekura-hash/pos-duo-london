// Genera dist/administracion.html: la Administración de LonDuo POS conectada al central (Supabase).
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
  entryPoints: [join(raiz, 'src/app/admin-nube-navegador.ts')], bundle: true, format: 'iife', globalName: 'PosAdmin', platform: 'browser', target: 'es2022', write: false,
  plugins: [{ name: 'stubs-de-node', setup(b) {
    b.onResolve({ filter: /^node:/ }, (a) => ({ path: a.path, namespace: 'stub' }));
    b.onLoad({ filter: /.*/, namespace: 'stub' }, (a) => ({ contents: STUBS[a.path] ?? 'export {}', loader: 'js' }));
  } }],
});
const seguro = (t) => t.replace(/<\/script/gi, '<\\/script');
const bundle = seguro(r.outputFiles[0].text);
const exceljs = seguro(readFileSync(join(raiz, 'node_modules/exceljs/dist/exceljs.min.js'), 'utf8'));
const logo = (n) => 'data:image/png;base64,' + readFileSync(join(raiz, 'src/app/publico', n)).toString('base64');
const logos = JSON.stringify({ DUO: logo('logo-duo.png'), LON: logo('logo-london.png') });
const logosTicket = JSON.stringify({ DUO: logo('ticket-duo.png'), LON: logo('ticket-london.png') });
const css = readFileSync(join(raiz, 'src/app/publico/estilos.css'), 'utf8');
const app = seguro(readFileSync(join(raiz, 'src/app/publico/app.js'), 'utf8'));
const qr = seguro(readFileSync(join(raiz, 'src/app/publico/qr.js'), 'utf8'));
const importador = seguro(readFileSync(join(raiz, 'scripts/importador-inventario.js'), 'utf8'));
const arranque = seguro(readFileSync(join(raiz, 'scripts/arranque-admin.js'), 'utf8'));

const VERSION = (() => {
  const v = JSON.parse(readFileSync(join(raiz, 'package.json'), 'utf8')).version;
  let sha = 'sin-git';
  try { sha = execFileSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: raiz, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim(); } catch { /* sin git */ }
  const f = new Date().toISOString().slice(0, 10);
  return { numero: v, commit: sha, fecha: f, texto: `Administración v${v} · ${sha} · ${f}` };
})();
const CENTRAL = { url: process.env.LONDUO_SUPABASE_URL ?? '', llave: process.env.LONDUO_SUPABASE_KEY ?? '' };
if (/service_role/i.test(CENTRAL.llave) || (CENTRAL.llave.startsWith('eyJ') && JSON.parse(Buffer.from(CENTRAL.llave.split('.')[1] ?? '', 'base64url').toString() || '{}').role === 'service_role')) {
  throw new Error('Esa es la llave service_role: NUNCA va en una página. Use la llave pública (anon/publishable).');
}

const estilo = `
.estado-nube { font-size: 13px; font-weight: 600; } .estado-nube.mal { color: var(--error, #b3261e); }
.barra-nube { position: sticky; top: 0; z-index: 5; background: var(--aviso-fondo); color: var(--texto); border-bottom: 1px solid var(--borde); padding: 8px 16px; display: flex; flex-wrap: wrap; gap: 8px 16px; align-items: center; font-size: 13px; }
.barra-nube .espacio { flex: 1; }
#puerta { position: fixed; inset: 0; z-index: 100; background: var(--fondo, #f6f5f3); overflow: auto; padding: 24px 16px; }
#puerta[hidden] { display: none; } #puerta .panel { max-width: 420px; margin: 40px auto; } #puerta details { margin: 8px 0 12px; } #puerta input { width: 100%; box-sizing: border-box; }
#dlg-importar { max-width: min(860px, 96vw); width: 96vw; } #dlg-importar h2 { margin: 0 0 8px; } #dlg-importar fieldset { border: 1px solid var(--borde); border-radius: 8px; margin: 8px 0; } #dlg-importar label { display: block; margin: 4px 0; } #dlg-importar input[type=number] { width: 90px; padding: 4px; border: 1px solid var(--borde); border-radius: 6px; background: var(--superficie); text-align: right; } .anomalias td, .anomalias th { white-space: normal; }
.aviso-depto td { background: color-mix(in srgb, #f5b301 18%, transparent); }
.app { min-height: calc(100vh - 44px); }`;
const marcado = `
<div class="barra-nube" role="region" aria-label="Conexión con el central">
  <strong>LonDuo POS · Administración</strong>
  <span class="estado-nube" id="estado-nube" role="status" aria-live="polite">Sin sesión</span>
  <button class="btn" type="button" id="btn-sync">Sincronizar ahora</button>
  <span class="espacio"></span>
  <span class="estado-inv" id="estado-inv" role="status" aria-live="polite"></span>
  <small id="version-pos">${VERSION.texto}</small>
  <input type="file" id="archivo-inventario" accept=".xlsx" hidden>
</div>
<div class="app">
  <header class="encabezado" id="encabezado" aria-label="Estado de la sesión"></header>
  <aside class="nav" aria-label="Navegación principal"><nav id="nav"></nav><div id="tc-barra" class="tc" aria-label="Tipo de cambio del dólar"></div></aside>
  <main id="vista" tabindex="-1"></main>
  <footer class="pie" id="pie" aria-label="Estado de la sesión"></footer>
</div>
<dialog id="dlg-ticket" aria-labelledby="dlg-titulo"></dialog>
<dialog id="dlg-tc" aria-labelledby="tc-titulo"></dialog>
<dialog id="dlg-importar" aria-labelledby="dlg-imp-titulo"></dialog>
<div id="puerta" role="dialog" aria-labelledby="pu-titulo">
  <section class="panel">
    <div style="text-align:center;margin-bottom:14px"><div style="font-size:26px;font-weight:800;letter-spacing:.5px" id="pu-titulo">LonDuo POS</div><div class="nota" style="margin:0">Smart Retail Management · Administración</div><div class="nota" style="margin:2px 0 0;font-size:11px">${VERSION.texto}</div></div>
    <form id="form-puerta" autocomplete="on">
      <div class="campo"><label for="pu-correo">Correo</label><input id="pu-correo" type="email" autocomplete="username"></div>
      <div class="campo"><label for="pu-clave">Contraseña</label><input id="pu-clave" type="password" autocomplete="current-password"></div>
      <details id="pu-proyecto"><summary>Proyecto del central</summary>
        <div class="campo"><label for="pu-url">Dirección del proyecto</label><input id="pu-url" type="url" placeholder="https://xxxx.supabase.co"></div>
        <div class="campo"><label for="pu-llave">Llave pública (anon / publishable)</label><input id="pu-llave" type="text" autocomplete="off" placeholder="sb_publishable_… o eyJ…"><small>Nunca la llave service_role.</small></div>
      </details>
      <div id="msg-puerta" class="mensaje" role="alert"></div>
      <button class="btn btn-primario" type="submit" id="pu-entrar"><span>Entrar</span></button>
    </form>
  </section>
</div>`;
const piezas = `<title>LonDuo POS · Administración</title>
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
${exceljs}
</script>
<script>
${bundle}
${importador}
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
writeFileSync(join(raiz, 'dist/administracion.html'), html);
console.log(`dist/administracion.html (${(html.length / 1024).toFixed(0)} KB) · ${VERSION.texto}${CENTRAL.url ? ' · central ' + CENTRAL.url : ''}`);
