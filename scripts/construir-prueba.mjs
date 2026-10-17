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
const css = readFileSync(join(raiz, 'src/app/publico/estilos.css'), 'utf8');
const app = readFileSync(join(raiz, 'src/app/publico/app.js'), 'utf8').replace(/<\/script/gi, '<\\/script');

const estiloBanco = `
.banco { position: sticky; top: 0; z-index: 5; background: var(--aviso-fondo); color: var(--texto); border-bottom: 1px solid var(--borde); padding: 8px 16px; display: flex; flex-wrap: wrap; gap: 8px 16px; align-items: center; font-size: 13px; }
.banco label { display: inline-flex; gap: 6px; align-items: center; } .banco select { padding: 4px 6px; border: 1px solid var(--borde); border-radius: 6px; background: var(--superficie); }
.banco details { flex-basis: 100%; } .banco summary { cursor: pointer; font-weight: 600; } .banco .tabla-ayuda { overflow-x: auto; } .banco table { margin: 8px 0; background: var(--superficie); } .banco code { font-family: ui-monospace, Menlo, Consolas, monospace; user-select: all; }
.app { min-height: calc(100vh - 44px); }`;
const marcado = `
<div class="banco" role="region" aria-label="Controles de la prueba">
  <strong>PRUEBA con datos sintéticos · en memoria (se borra al recargar) · políticas de ensayo, no aprobadas</strong>
  <label>Sesión <select id="sesion-prueba">
    <option value="DUO/1">Cajero · DÚO Caja 1 (efectivo, tarjeta, mixto)</option><option value="DUO/2">Cajero · DÚO Caja 2 (solo efectivo)</option>
    <option value="LON/1">Cajero · London Caja 1</option><option value="LON/2">Cajero · London Caja 2</option><option value="admin">Administración</option></select></label>
  <label><input type="checkbox" id="falla-hub"> Hub de la tienda caído (simulado)</label>
  <label><input type="checkbox" id="falla-imp"> La siguiente impresión falla (una vez, simulada)</label>
  <button class="btn" type="button" id="reiniciar">Reiniciar datos de prueba</button>
  <details><summary>Artículos de prueba: qué escanear</summary><div id="ayuda"></div></details>
</div>
<div class="app">
  <aside class="nav" aria-label="Navegación principal">
    <div class="marca">POS<span>DÚO · London</span></div>
    <nav id="nav"></nav>
    <p class="prueba" role="note"><strong>MODO DE PRUEBA</strong><br>Datos sintéticos · usuarios de prueba sin autenticación</p>
  </aside>
  <header class="encabezado" id="encabezado" aria-label="Estado de la caja"></header>
  <main id="vista" tabindex="-1"></main>
</div>
<dialog id="dlg-ticket" aria-labelledby="dlg-titulo"></dialog>`;
const arranque = `
(function () {
  var $ = function (s) { return document.querySelector(s); };
  var ctl = PosBanco.iniciarBanco({ alCambiar: function () { aplicar(); window.POS_UI.iniciar(); } });
  window.__POS_ATENDER__ = function (m, r, c) { return ctl.atender(m, r, c).then(function (x) { $('#falla-imp').checked = ctl.fallaImpresoraActiva(); return x; }); };
  function aplicar() {
    var esAdmin = ctl.sesion === 'admin';
    $('#falla-hub').disabled = esAdmin; $('#falla-imp').disabled = esAdmin;
    $('#falla-hub').checked = ctl.hubCaidoActivo(); $('#falla-imp').checked = ctl.fallaImpresoraActiva();
  }
  var pesos = function (c) { return '$' + (c / 100).toFixed(2).replace(/\\B(?=(\\d{3})+(?!\\d))/g, ','); };
  $('#ayuda').innerHTML = '<div class="tabla-ayuda"><table><thead><tr><th>Código (escanear)</th><th>Item #</th><th>Artículo</th><th>Estilo</th><th>Lote</th><th>Precio</th><th>Existencia DÚO / London</th></tr></thead><tbody>' +
    PosBanco.ARTICULOS_DE_PRUEBA.map(function (a) { return '<tr><td><code>' + a.codigo + '</code></td><td>' + a.item_no + '</td><td>' + a.descripcion + ' ' + a.marca + '</td><td>' + a.estilo + '</td><td>' + a.lote + '</td><td>' + pesos(a.precio) + '</td><td>' + (a.existencias.DUO || 0) + ' / ' + (a.existencias.LON || 0) + '</td></tr>'; }).join('') +
    '</tbody></table></div><p>También puede escribir texto (<code>mascada</code>, <code>levis</code>, <code>falda</code>) o un Item # (<code>1003</code>). La BOLSA tiene una sola pieza en DÚO (pruebe venderla desde las dos cajas). Los códigos <code>7508888888888</code> están duplicados a propósito: el POS no adivina cuál es. Tras vender en una caja, cambie a la otra caja de la misma tienda para ver el inventario compartido.</p>';
  $('#sesion-prueba').addEventListener('change', function (e) { ctl.seleccionar(e.target.value); });
  $('#falla-hub').addEventListener('change', function (e) { ctl.caerHub(ctl.tienda(), e.target.checked); });
  $('#falla-imp').addEventListener('change', function (e) { ctl.fallaImpresora(ctl.sesion, e.target.checked); });
  $('#reiniciar').addEventListener('click', function () { ctl.reiniciar(); $('#sesion-prueba').value = ctl.sesion; });
  window.POS_PRUEBA = ctl;
  aplicar();
  window.POS_UI.iniciar();
})();`;
const piezas = `<title>POS Venta de Prueba</title>
<style>
${css}
${estiloBanco}
</style>
${marcado}
<script>window.__POS_MANUAL__ = true;</script>
<script>
${app}
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
