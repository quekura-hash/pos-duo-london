import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { chromium, devices, type Page } from 'playwright-core';
import { como, usuario, centralLocal } from './ayudas/central-pglite.ts';
import { simularSupabase, URL_CENTRAL } from './ayudas/supabase-simulado.ts';

const RAIZ = join(import.meta.dirname, '..');
const DIST = mkdtempSync(join(tmpdir(), 'londuo-admin-'));
const HTML = join(DIST, 'administracion.html');
const chromiumPath = [process.env.POS_CHROMIUM, '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', '/opt/pw-browsers/chromium/chrome-linux/chrome'].find((p) => p && existsSync(p));
const { defaultBrowserType: _omitido, ...IPHONE } = devices['iPhone 13']!;
void _omitido;

type Atender = { __POS_ATENDER__: (m: string, r: string, c?: unknown) => Promise<{ status: number; json: Record<string, unknown> }> };
const ANCHO = 390;
/** La página no debe ser más ancha que la pantalla (si lo fuera, el navegador la encoge y todo se ve diminuto). Se mide contra el ancho real del teléfono. */
const sinDesborde = async (p: Page, donde: string) => {
  const r = await p.evaluate((ancho) => {
    const malos = [...document.querySelectorAll('body *')].filter((e) => { const b = e.getBoundingClientRect(); return b.width > 0 && b.right > ancho + 1 && getComputedStyle(e).position !== 'fixed' && !e.closest('#nav'); }).slice(0, 4).map((e) => `${e.tagName.toLowerCase()}${e.id ? '#' + e.id : ''}.${String(e.className).slice(0, 30)} → ${Math.round(e.getBoundingClientRect().right)}`);
    const anchos = [...document.querySelectorAll('body *')].filter((e) => e.scrollWidth > ancho + 1 && e.clientWidth <= ancho + 1).slice(0, 4).map((e) => `${e.tagName.toLowerCase()}${e.id ? '#' + e.id : ''}.${String(e.className).slice(0, 24)} sw=${e.scrollWidth}`);
    return { ancho: document.documentElement.scrollWidth, malos: [...malos, ...anchos] };
  }, ANCHO);
  assert.ok(r.ancho <= ANCHO + 1, `${donde}: la página se desborda a lo ancho (${r.ancho} > ${ANCHO}): ${r.malos.join(' | ')}`);
};

describe('[iPhone] Administración en el teléfono', { timeout: 180_000, skip: chromiumPath ? false : 'Chromium no encontrado' }, () => {
  it('M1 menú inferior, almacén en tarjetas por estilo, etiquetas y cantidades DÚO/London, y tablas como tarjetas', async (t) => {
    execFileSync(process.execPath, [join(RAIZ, 'scripts', 'construir-admin.mjs')], { stdio: 'pipe', env: { ...process.env, LONDUO_DIST: DIST, LONDUO_SUPABASE_URL: URL_CENTRAL, LONDUO_SUPABASE_KEY: 'sb_publishable_prueba' } });
    const db = await centralLocal();
    const edgardo = await usuario(db, 'edgardo@x.mx', 'supervisor');
    const browser = await chromium.launch({ executablePath: chromiumPath, args: ['--no-sandbox'] });
    t.after(() => browser.close());
    const ctx = await browser.newContext({ ...IPHONE, deviceScaleFactor: 2 });
    await simularSupabase(ctx, db, { 'edgardo@x.mx': edgardo });
    const page = await ctx.newPage();
    const errores: string[] = [];
    page.on('pageerror', (e) => errores.push(String(e)));
    page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource|net::/.test(m.text())) errores.push(m.text()); });
    await page.goto(`file://${HTML}`);
    await page.waitForSelector('#puerta:not([hidden])');
    await sinDesborde(page, 'pantalla de entrada');
    assert.equal(await page.locator('#pu-proyecto').isVisible(), false, 'con el proyecto fijado solo se piden correo y contraseña');
    await page.fill('#pu-correo', 'edgardo@x.mx'); await page.fill('#pu-clave', 'buena'); await page.click('#pu-entrar');
    await page.waitForSelector('#puerta', { state: 'hidden' });
    await page.waitForSelector('#nav button');

    // El menú es una barra inferior (pegada al borde de abajo) y el encabezado queda arriba.
    const dim = await page.evaluate(() => { const n = document.querySelector('.nav')!.getBoundingClientRect(); return { abajo: Math.round(n.bottom), alto: window.innerHeight, ancho: Math.round(n.width), ventana: window.innerWidth }; });
    assert.ok(Math.abs(dim.abajo - dim.alto) <= 1 && dim.ancho === dim.ventana, JSON.stringify(dim));
    await sinDesborde(page, 'Inventario');
    const botonMin = await page.$$eval('#nav button', (b) => Math.min(...b.map((x) => x.getBoundingClientRect().height)));
    assert.ok(botonMin >= 48, `los botones del menú son táctiles (${botonMin}px)`);

    // Almacén: tres artículos dados de alta (dos del estilo 123L, uno de otro).
    const alta = (codigo: string, desc: string, estilo: string, lote: string) => page.evaluate(async (d) => (await (window as unknown as Atender).__POS_ATENDER__('POST', '/api/admin/almacen/manual', { lote_id: `m-${d.codigo}`, cantidad: 40, codigo: d.codigo, descripcion: d.desc, marca: 'LEVIS', estilo: d.estilo, lote: d.lote, precio: 499, departamento: 'Dama' })).status, { codigo, desc, estilo, lote });
    assert.equal(await alta('7500000000011', 'BLUSA', '123L', '20261014'), 200);
    assert.equal(await alta('7500000000028', 'BLUSA', '123L-N', '20261015'), 200);
    assert.equal(await alta('7500000000035', 'FALDA', 'ABC9', '20261016'), 200);
    await page.click('#nav button[data-vista="almacen"]');
    await page.waitForSelector('#alm-tarjetas article[data-item]');
    assert.equal(await page.locator('#tabla-almacen').isVisible(), false, 'en el teléfono la tabla de escritorio no se ve');
    assert.equal(await page.locator('#alm-tarjetas article').count(), 3);
    await sinDesborde(page, 'Almacén');
    await page.screenshot({ path: join(RAIZ, 'docs', 'capturas', '60-movil-almacen.png') });

    // «Busca el estilo 123L»: el estilo exacto sale primero y la FALDA desaparece.
    await page.fill('#alm-q-m', '123L');
    await page.waitForFunction(() => document.querySelectorAll('#alm-tarjetas article').length === 2);
    const estilos = await page.$$eval('#alm-tarjetas article .alm-meta span:first-child b', (x) => x.map((e) => e.textContent));
    assert.deepEqual(estilos, ['123L', '123L-N']);
    const tarjeta = page.locator('#alm-tarjetas article').first();
    const entre = async (sel: string) => (await tarjeta.locator(sel).boundingBox())!;
    assert.ok((await entre('.btn-entregar')).height >= 48 && (await entre('.cont-mas >> nth=0')).width >= 44, 'controles táctiles grandes');

    // Cantidades: «+» tres veces para DÚO, 15 escrito para London y «misma cantidad»; las dos etiquetas se marcan solas.
    for (let i = 0; i < 3; i++) await tarjeta.locator('.q-DUO').locator('xpath=../..').locator('.cont-mas').click();
    assert.equal(await tarjeta.locator('.q-DUO').inputValue(), '3');
    assert.equal(await tarjeta.locator('.et-precio').isChecked(), true);
    assert.equal(await tarjeta.locator('.et-costura').isChecked(), true);
    await tarjeta.locator('.q-DUO').fill('15');
    await tarjeta.locator('.btn-igual').click();
    assert.deepEqual([await tarjeta.locator('.q-DUO').inputValue(), await tarjeta.locator('.q-LON').inputValue()], ['15', '15']);
    await tarjeta.locator('.btn-entregar').click();
    await page.waitForFunction(() => /Entrega registrada. En el almacén quedan 10 pieza/.test(document.querySelector('#msg-alm')!.textContent!));
    await page.waitForFunction(() => { const e = (window as unknown as { POS_ADMIN: { estado(): { pendientes: number } | null } }).POS_ADMIN.estado(); return !!e && e.pendientes === 0; });
    const entregas = (await como(db, edgardo, (q) => q(`select payload from pos.ops where tipo = 'alm.entrega' order by seq`))) as { payload: { tienda: string; qty: number; etiqueta_precio: boolean; etiqueta_costura: boolean } }[];
    assert.deepEqual(entregas.map((e) => [e.payload.tienda, e.payload.qty, e.payload.etiqueta_precio, e.payload.etiqueta_costura]).sort(), [['DUO', 15, true, true], ['LON', 15, true, true]]);

    // Las demás pantallas con tablas pasan a tarjetas sin desbordarse.
    await page.click('#nav button[data-vista="inventario"]');
    await page.waitForSelector('#lista-inv .fila-inv');
    // El inventario es una lista de filas compactas (no tarjetas), sin los botones del Limbo, y el estado de la conexión es un chip en el encabezado.
    assert.equal(await page.locator('#tabla-inv-lista').isVisible(), false, 'la tabla de escritorio no se ve en el teléfono');
    assert.equal(await page.locator('#btn-catalogo-inicial, #btn-conteo-limbo').count(), 0);
    const filas = page.locator('#lista-inv .fila-inv');
    assert.equal(await filas.count(), 3);
    assert.ok((await filas.first().boundingBox())!.height < 110, 'cada artículo ocupa pocos renglones');
    assert.match((await filas.first().textContent())!, /BLUSA|FALDA/);
    // Orden y filtros por campo: lo más nuevo primero; «Lote= 20261015» filtra por lote.
    const caja = await page.locator('#inv-q').boundingBox();
    assert.ok(caja!.height >= 40 && caja!.height <= 56, `el buscador mide ${caja!.height}px de alto (no debe crecer)`);
    assert.ok(caja!.width >= 220, `y ocupa el ancho (menos el botón de cámara): ${caja!.width}`);
    assert.equal(await page.inputValue('#inv-orden'), 'nuevo');
    assert.equal(await filas.first().locator('.fi-desc').textContent(), 'FALDA', 'más nuevo primero');
    await page.selectOption('#inv-orden', 'cara');
    await page.waitForFunction(() => /\$/.test(document.querySelector('#lista-inv .fila-inv .fi-precio')?.textContent ?? ''));
    const precios = await page.$$eval('#lista-inv .fi-precio', (x) => x.map((e) => Number(e.textContent!.replace(/[$,]/g, ''))));
    assert.deepEqual(precios, [...precios].sort((a, b) => b - a), 'más caro primero');
    await page.evaluate(() => document.querySelector('#inv-q')!.scrollIntoView({ block: 'center' }));
    await page.screenshot({ path: join(RAIZ, 'docs', 'capturas', '65-movil-buscador.png') });
    await page.fill('#inv-q', 'Lote= 20261015');
    await page.waitForFunction(() => document.querySelectorAll('#lista-inv .fila-inv').length === 1);
    assert.match((await filas.first().textContent())!, /123L-N/);
    await page.fill('#inv-q', '');
    await page.waitForFunction(() => document.querySelectorAll('#lista-inv .fila-inv').length === 3);
    await page.selectOption('#inv-orden', 'nuevo');
    await sinDesborde(page, 'Inventario con orden y buscador');
    assert.equal(await page.locator('.barra-nube').isVisible(), false, 'ya no hay barra amarilla');
    assert.match((await page.textContent('#estado-nube'))!, /Sincronizado/);
    assert.equal(await page.locator('#btn-sync').isVisible(), true);
    await sinDesborde(page, 'Inventario con artículos');

    // Con contenido largo el encabezado se queda arriba al bajar y se puede volver hasta arriba.
    await page.evaluate(() => { document.querySelector('#vista')!.insertAdjacentHTML('beforeend', '<div id="relleno" style="height:4000px"></div>'); window.scrollTo(0, document.body.scrollHeight); });
    assert.ok(await page.evaluate(() => window.scrollY) > 1000);
    assert.equal(Math.round((await page.locator('.encabezado').boundingBox())!.y), 0, 'el encabezado sigue arriba tras bajar mucho');
    await page.evaluate(() => { window.scrollTo(0, 0); document.querySelector('#relleno')!.remove(); });
    assert.equal(await page.evaluate(() => window.scrollY), 0);
    await page.screenshot({ path: join(RAIZ, 'docs', 'capturas', '61-movil-inventario.png') });
    assert.ok((await page.locator('#vista').boundingBox())!.y >= (await page.locator('.encabezado').boundingBox())!.height - 1, 'el contenido empieza debajo del encabezado');
    for (const v of ['promociones', 'tarjetas', 'reportes', 'cortes', 'configuracion']) {
      await page.click(`#nav button[data-vista="${v}"]`);
      await page.waitForTimeout(400);
      await sinDesborde(page, v);
    }
    // Diálogo a pantalla completa (edición de un artículo).
    await page.click('#nav button[data-vista="inventario"]');
    await page.waitForSelector('#lista-inv .fila-inv');
    await page.click('#lista-inv .fila-inv');
    await page.waitForSelector('#dlg-articulo[open]');
    const hoja = await page.evaluate(() => { const r = document.querySelector('#dlg-articulo')!.getBoundingClientRect(); return { ancho: Math.round(r.width), alto: Math.round(r.height), ventana: window.innerWidth, altoVentana: window.innerHeight }; });
    assert.deepEqual([hoja.ancho, hoja.alto], [hoja.ventana, hoja.altoVentana], 'la hoja ocupa toda la pantalla');
    // El botón Guardar queda a la vista y es tocable (nada encima), también tras recorrer la hoja hasta abajo.
    const tocable = () => page.evaluate(() => { const b = document.querySelector('#art-guardar')!; const r = b.getBoundingClientRect(); const e = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2); return { dentro: r.bottom <= window.innerHeight && r.top >= 0, encima: !!e && (e === b || b.contains(e)) }; });
    assert.deepEqual(await tocable(), { dentro: true, encima: true }, 'Guardar visible al abrir');
    await page.evaluate(() => { document.querySelector('#dlg-articulo')!.scrollTop = 99999; });
    assert.deepEqual(await tocable(), { dentro: true, encima: true }, 'Guardar visible al final de la hoja');
    assert.equal(await page.locator('.nav').isVisible(), false, 'el menú inferior no tapa la hoja');
    await page.screenshot({ path: join(RAIZ, 'docs', 'capturas', '62-movil-articulo.png') });
    assert.deepEqual(errores, []);
  });
});
