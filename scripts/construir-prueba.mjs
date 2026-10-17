// Genera dist/pos-venta-prueba.html: UNA página que contiene el motor, el servicio, la pantalla y datos sintéticos.
import { build } from 'esbuild';
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
  entryPoints: [join(raiz, 'src/app/navegador.ts')], bundle: true, format: 'iife', globalName: 'PosBanco', platform: 'browser', target: 'es2022', write: false,
  plugins: [{ name: 'stubs-de-node', setup(b) {
    b.onResolve({ filter: /^node:/ }, (a) => ({ path: a.path, namespace: 'stub' }));
    b.onLoad({ filter: /.*/, namespace: 'stub' }, (a) => ({ contents: STUBS[a.path] ?? 'export {}', loader: 'js' }));
  } }],
});
const bundle = r.outputFiles[0].text.replace(/<\/script/gi, '<\\/script');
const exceljs = readFileSync(join(raiz, 'node_modules/exceljs/dist/exceljs.min.js'), 'utf8').replace(/<\/script/gi, '<\\/script');
const logo = (n) => 'data:image/png;base64,' + readFileSync(join(raiz, 'src/app/publico', n)).toString('base64');
const logos = JSON.stringify({ DUO: logo('logo-duo.png'), LON: logo('logo-london.png') });
const css = readFileSync(join(raiz, 'src/app/publico/estilos.css'), 'utf8');
const app = readFileSync(join(raiz, 'src/app/publico/app.js'), 'utf8').replace(/<\/script/gi, '<\\/script');

const estiloBanco = `
.banco { position: sticky; top: 0; z-index: 5; background: var(--aviso-fondo); color: var(--texto); border-bottom: 1px solid var(--borde); padding: 8px 16px; display: flex; flex-wrap: wrap; gap: 8px 16px; align-items: center; font-size: 13px; }
.banco label { display: inline-flex; gap: 6px; align-items: center; } .banco select { padding: 4px 6px; border: 1px solid var(--borde); border-radius: 6px; background: var(--superficie); }
.banco details { flex-basis: 100%; } .banco summary { cursor: pointer; font-weight: 600; } .banco .tabla-ayuda { overflow-x: auto; } .banco table { margin: 8px 0; background: var(--superficie); } .banco code { font-family: ui-monospace, Menlo, Consolas, monospace; user-select: all; }
.banco .estado-inv { font-weight: 600; } .banco .fila-inv { flex-basis: 100%; display: flex; flex-wrap: wrap; gap: 8px 16px; align-items: center; }
#dlg-importar { max-width: min(860px, 96vw); width: 96vw; } #dlg-importar h2 { margin: 0 0 8px; } #dlg-importar fieldset { border: 1px solid var(--borde); border-radius: 8px; margin: 8px 0; } #dlg-importar label { display: block; margin: 4px 0; } #dlg-importar input[type=number] { width: 90px; padding: 4px; border: 1px solid var(--borde); border-radius: 6px; background: var(--superficie); text-align: right; } .anomalias td, .anomalias th { white-space: normal; }
.app { min-height: calc(100vh - 44px); }`;
const marcado = `
<div class="banco" role="region" aria-label="Controles de la prueba">
  <strong>PRUEBA con datos sintéticos · en memoria (se borra al recargar) · políticas de ensayo, no aprobadas</strong>
  <label>Sesión <select id="sesion-prueba">
    <option value="DUO/1">Cajero · DÚO Caja 1 (efectivo, tarjeta bancaria y de regalo)</option><option value="DUO/2">Cajero · DÚO Caja 2 (solo efectivo)</option>
    <option value="LON/1">Cajero · London Caja 1</option><option value="LON/2">Cajero · London Caja 2</option><option value="admin">Administración</option></select></label>
  <label><input type="checkbox" id="falla-hub"> Hub de la tienda caído (simulado)</label>
  <label><input type="checkbox" id="falla-imp"> La siguiente impresión falla (una vez, simulada)</label>
  <button class="btn" type="button" id="reiniciar">Reiniciar datos de prueba</button>
  <div class="fila-inv">
    <button class="btn" type="button" id="importar">Importar inventario (.xlsx)</button>
    <input type="file" id="archivo-inventario" accept=".xlsx" hidden>
    <button class="btn" type="button" id="quitar-inv" hidden>Quitar inventario cargado</button>
    <span class="estado-inv" id="estado-inv" role="status" aria-live="polite">Datos de ejemplo (6 artículos). El archivo que importe se lee en este navegador y no se envía a ningún servidor.</span>
  </div>
  <details><summary id="resumen-ayuda">Artículos de prueba: qué escanear</summary><div id="ayuda"></div></details>
</div>
<div class="app">
  <header class="encabezado" id="encabezado" aria-label="Estado de la caja"></header>
  <aside class="nav" aria-label="Navegación principal">
    <nav id="nav"></nav>
    <div id="tc-barra" class="tc" aria-label="Tipo de cambio del dólar"></div>
    <p class="prueba" role="note"><strong>MODO DE PRUEBA</strong><br>Datos sintéticos · usuarios de prueba sin autenticación</p>
  </aside>
  <main id="vista" tabindex="-1"></main>
  <footer class="pie" id="pie" aria-label="Estado de la sesión"></footer>
</div>
<dialog id="dlg-ticket" aria-labelledby="dlg-titulo"></dialog>
<dialog id="dlg-tc" aria-labelledby="tc-titulo"></dialog>
<dialog id="dlg-importar" aria-labelledby="dlg-imp-titulo"></dialog>`;
const arranque = readFileSync(join(raiz, 'scripts/arranque-prueba.js'), 'utf8').replace(/<\/script/gi, '<\\/script');
const piezas = `<title>POS Venta de Prueba</title>
<style>
${css}
${estiloBanco}
</style>
${marcado}
<script>window.__POS_MANUAL__ = true; window.__POS_LOGOS__ = ${logos};</script>
<script>
${app}
</script>
<script>
${exceljs}
</script>
<script>
${bundle}
${arranque}
</script>`;
// Página completa (para abrirla como archivo) y fragmento (la plataforma de artefactos pone su propio esqueleto).
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
writeFileSync(join(raiz, 'dist/pos-venta-prueba.html'), html);
writeFileSync(join(raiz, 'dist/pos-venta-prueba-fragmento.html'), piezas);
console.log(`dist/pos-venta-prueba.html (${(html.length / 1024).toFixed(0)} KB)`);
