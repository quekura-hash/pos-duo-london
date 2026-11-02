import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { chromium, devices, type Browser, type Page } from 'playwright-core';
import { centralLocal, usuario } from './ayudas/central-pglite.ts';
import { simularSupabase, URL_CENTRAL } from './ayudas/supabase-simulado.ts';

const RAIZ = join(import.meta.dirname, '..');
const chromiumPath = [process.env.POS_CHROMIUM, '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', '/opt/pw-browsers/chromium/chrome-linux/chrome'].find((p) => p && existsSync(p));
const { defaultBrowserType: _omitido, ...IPHONE } = devices['iPhone 13']!;
void _omitido;

async function preparar(t: { after: (f: () => unknown) => void }) {
  const dist = mkdtempSync(join(tmpdir(), 'londuo-admin-'));
  execFileSync(process.execPath, [join(RAIZ, 'scripts', 'construir-admin.mjs')], { stdio: 'pipe', env: { ...process.env, LONDUO_DIST: dist, LONDUO_SUPABASE_URL: URL_CENTRAL, LONDUO_SUPABASE_KEY: 'sb_publishable_prueba' } });
  const db = await centralLocal();
  const cuentas = { 'edgardo@x.mx': await usuario(db, 'edgardo@x.mx', 'supervisor'), 'gabo@x.mx': await usuario(db, 'gabo@x.mx', 'almacenista') };
  const browser = await chromium.launch({ executablePath: chromiumPath, args: ['--no-sandbox'] });
  t.after(async () => { await browser.close(); rmSync(dist, { recursive: true, force: true }); });
  const abrir = async (correo: keyof typeof cuentas, opciones: Parameters<Browser['newContext']>[0]) => {
    const ctx = await browser.newContext(opciones);
    await simularSupabase(ctx, db, cuentas);
    const page = await ctx.newPage();
    const errores: string[] = [];
    page.on('pageerror', (e) => errores.push(String(e)));
    page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource|net::/.test(m.text())) errores.push(m.text()); });
    await page.goto(`file://${join(dist, 'administracion.html')}`);
    await page.waitForSelector('#puerta:not([hidden])');
    await page.fill('#pu-correo', correo); await page.fill('#pu-clave', 'buena'); await page.click('#pu-entrar');
    await page.waitForSelector('#puerta', { state: 'hidden' });
    await page.waitForFunction(() => /Sincronizado/.test(document.querySelector('#estado-nube')?.textContent ?? ''));
    return { page, errores };
  };
  return { abrir };
}
const etiquetas = (page: Page, sel: string) => page.$$eval(sel, (e) => e.map((x) => x.textContent!.trim()));
const titulo = (page: Page) => page.textContent('#vista h1');

describe('[navegador real] Navegación inferior tipo isla (teléfono)', { timeout: 300_000, skip: chromiumPath ? false : 'Chromium no encontrado' }, () => {
  it('NV1 isla fija de tres botones (Reportes · Menú · Configuración), menú con todas las secciones, lápiz y personalización con memoria', async (t) => {
    const { abrir } = await preparar(t);
    const { page, errores } = await abrir('edgardo@x.mx', { ...IPHONE, viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, colorScheme: 'dark' });
    await page.waitForSelector('#isla');
    // Tres botones fijos; la barra deslizante de 11 secciones ya no se ve; por omisión Reportes | Menú | Configuración.
    assert.deepEqual(await etiquetas(page, '#isla button span'), ['Reportes', 'Menú', 'Configuración']);
    const caja = await page.evaluate(() => { const i = getComputedStyle(document.querySelector('#isla')!); return { pos: i.position, desliza: i.overflowX, nav: getComputedStyle(document.querySelector('.nav')!).display }; });
    assert.deepEqual(caja, { pos: 'fixed', desliza: 'visible', nav: 'none' });
    await page.evaluate(() => window.scrollTo(0, 99999));
    assert.equal(await page.locator('#isla').isVisible(), true, 'siempre visible, también al bajar');
    // El acceso rápido izquierdo abre Reportes y queda resaltado.
    await page.click('#isla [data-lado="izq"]');
    await page.waitForFunction(() => /Reportes/.test(document.querySelector('#vista h1')?.textContent ?? ''));
    assert.equal(await page.getAttribute('#isla [data-lado="izq"]', 'aria-current'), 'page');
    await page.screenshot({ path: join(RAIZ, 'docs', 'capturas', 'isla-reportes.png') });
    // Menú: panel con título, subtítulo, lápiz arriba a la derecha y todas las secciones; la activa, resaltada.
    await page.click('#isla-menu');
    await page.waitForSelector('#menu-hoja:not([hidden])');
    assert.equal(await page.getAttribute('#isla-menu', 'aria-expanded'), 'true');
    assert.equal(await page.textContent('#menu-titulo'), 'Menú de navegación');
    assert.match((await page.textContent('#menu-hoja .menu-cab-txt p'))!, /Accede a todas las secciones de LonDuo POS/);
    const secciones = await etiquetas(page, '#menu-hoja .menu-tile span');
    assert.deepEqual(secciones, ['Inventario', 'Almacén', 'Promociones', 'Tarjetas de regalo', 'Reportes', 'Historial de ventas', 'Análisis', 'Cortes', 'Personal', 'Configuración', 'Avisos']);
    assert.equal(await page.getAttribute('#menu-hoja .menu-tile[data-vista="reportes"]', 'aria-current'), 'page');
    const [lapiz, hoja] = (await page.evaluate(() => ['#menu-lapiz', '#menu-hoja'].map((s) => { const r = document.querySelector(s)!.getBoundingClientRect(); return { izq: r.left, der: r.right, arriba: r.top }; }))) as unknown as [Record<string, number>, Record<string, number>];
    assert.ok(lapiz!.der > hoja!.der - 40 && lapiz!.arriba < hoja!.arriba + 90, `el lápiz va arriba a la derecha: ${JSON.stringify({ lapiz, hoja })}`);
    await page.screenshot({ path: join(RAIZ, 'docs', 'capturas', 'isla-menu.png') });
    // Se cierra con el Menú, con el fondo y con Esc.
    await page.click('#isla-menu'); assert.equal(await page.locator('#menu-hoja').isVisible(), false);
    await page.click('#isla-menu'); await page.mouse.click(190, 120); assert.equal(await page.locator('#menu-hoja').isVisible(), false, 'tocar fuera lo cierra');
    await page.click('#isla-menu'); await page.keyboard.press('Escape'); assert.equal(await page.locator('#menu-hoja').isVisible(), false);
    // Elegir una sección navega y cierra el panel.
    await page.click('#isla-menu'); await page.click('#menu-hoja [data-vista="inventario"]');
    await page.waitForSelector('#inv-q');
    assert.equal(await page.locator('#menu-hoja').isVisible(), false);
    assert.equal(await page.locator('#isla [aria-current="page"]').count(), 0, 'Inventario no es un acceso rápido: ninguno queda resaltado');
    // Configuración es una sección normal (con lo suyo) y NO trae la personalización de la isla.
    await page.click('#isla [data-lado="der"]');
    await page.waitForFunction(() => /Configuración/.test(document.querySelector('#vista h1')?.textContent ?? ''));
    assert.equal(await titulo(page), 'Configuración');
    const cfg = await page.textContent('#vista');
    for (const x of ['Tiendas', 'Departamentos', 'Tipo de cambio', 'Cajas', 'Feria', 'Clientes VIP', 'Metas de venta']) assert.ok(cfg!.includes(x), x);
    assert.ok(!/accesos rápidos|isla|Personalizar/i.test(cfg!), 'Configuración no mezcla la personalización de la navegación');
    // Lápiz → Personalizar accesos rápidos.
    await page.click('#isla-menu'); await page.click('#menu-lapiz');
    assert.equal(await page.textContent('#menu-titulo'), 'Personalizar accesos rápidos');
    assert.match((await page.textContent('.pers-guia'))!, /Elige qué secciones quieres en los botones izquierdo y derecho.*“Menú” es fijo/);
    assert.deepEqual(await etiquetas(page, '.slot-isla'), ['Botón izquierdoReportes', 'Botón derechoConfiguración']);
    assert.match((await page.textContent('.pers-actual'))!, /“Reportes” en el botón izquierdo y “Configuración” en el derecho/);
    assert.equal(await page.locator('.menu-tile.asignada').count(), 2, 'las dos asignadas llevan marca');
    await page.screenshot({ path: join(RAIZ, 'docs', 'capturas', 'isla-personalizar.png') });
    // Izquierdo = Inventario (queda a la izquierda de la isla y se guarda).
    await page.click('.pers-rejilla [data-sec="inventario"]');
    assert.deepEqual(await etiquetas(page, '#isla button span'), ['Inventario', 'Menú', 'Configuración']);
    // Derecho = Almacén.
    await page.click('.slot-isla[data-lado="der"]'); await page.click('.pers-rejilla [data-sec="almacen"]');
    assert.deepEqual(await etiquetas(page, '#isla button span'), ['Inventario', 'Menú', 'Almacén']);
    // Sin repetidos: elegir para el derecho la que tiene el izquierdo las intercambia.
    await page.click('.pers-rejilla [data-sec="inventario"]');
    assert.deepEqual(await etiquetas(page, '#isla button span'), ['Almacén', 'Menú', 'Inventario']);
    assert.match((await page.textContent('.pers-actual'))!, /“Almacén” en el botón izquierdo y “Inventario” en el derecho/);
    // La X vuelve al menú; el Menú sigue siendo fijo (no hay forma de asignarlo).
    await page.click('#menu-volver');
    assert.equal(await page.textContent('#menu-titulo'), 'Menú de navegación');
    await page.keyboard.press('Escape');
    // Se recuerda al volver a abrir la página.
    await page.reload();
    await page.waitForFunction(() => /Sincronizado/.test(document.querySelector('#estado-nube')?.textContent ?? '')).catch(() => undefined);
    if (await page.locator('#puerta:not([hidden])').count()) { await page.fill('#pu-correo', 'edgardo@x.mx'); await page.fill('#pu-clave', 'buena'); await page.click('#pu-entrar'); await page.waitForSelector('#puerta', { state: 'hidden' }); }
    await page.waitForSelector('#isla');
    assert.deepEqual(await etiquetas(page, '#isla button span'), ['Almacén', 'Menú', 'Inventario']);
    assert.deepEqual(errores, []);
  });

  it('NV2 el almacenista solo tiene sus dos secciones (Inventario · Menú · Almacén) y en escritorio sigue el menú lateral de siempre', async (t) => {
    const { abrir } = await preparar(t);
    const a = await abrir('gabo@x.mx', { ...IPHONE, deviceScaleFactor: 2 });
    await a.page.waitForSelector('#isla');
    assert.deepEqual(await etiquetas(a.page, '#isla button span'), ['Inventario', 'Menú', 'Almacén']);
    await a.page.click('#isla-menu');
    assert.deepEqual(await etiquetas(a.page, '#menu-hoja .menu-tile span'), ['Inventario', 'Almacén']);
    assert.deepEqual(a.errores, []);
    const e = await abrir('edgardo@x.mx', { viewport: { width: 1280, height: 900 } });
    await e.page.waitForSelector('#nav button');
    assert.equal(await e.page.locator('#isla').isVisible(), false, 'en escritorio no hay isla');
    assert.equal(await e.page.locator('#nav button[data-vista="reportes"]').isVisible(), true, 'el menú lateral sigue igual');
    assert.equal(await e.page.locator('#nav button').count() >= 10, true);
    assert.deepEqual(e.errores, []);
  });

  it('NV3 la isla y el panel caben sin recortes en 320, 375, 390 y 430 px (claro y oscuro) y no tapan los cuadros de diálogo', async (t) => {
    const { abrir } = await preparar(t);
    for (const [ancho, esquema] of [[320, 'dark'], [375, 'light'], [390, 'dark'], [430, 'light']] as const) {
      const { page, errores } = await abrir('edgardo@x.mx', { ...IPHONE, viewport: { width: ancho, height: 740 }, deviceScaleFactor: 2, colorScheme: esquema });
      await page.waitForSelector('#isla');
      const medir = () => page.evaluate(() => {
        const mal = (e: Element) => { const r = e.getBoundingClientRect(); const s = e.querySelector('span')!.getBoundingClientRect(); return e.scrollWidth > e.clientWidth + 1 || (e.querySelector('span') as HTMLElement).scrollWidth > (e.querySelector('span') as HTMLElement).clientWidth + 1 || s.right > r.right + 0.5 || s.left < r.left - 0.5; };
        return { botones: [...document.querySelectorAll('#isla button')].map((b) => ({ w: Math.round(b.getBoundingClientRect().width), h: Math.round(b.getBoundingClientRect().height), corta: mal(b) })), pagina: document.documentElement.scrollWidth, ventana: window.innerWidth };
      });
      let m = await medir();
      assert.ok(m.botones.every((b) => !b.corta && b.h >= 48 && b.w === m.botones[0]!.w), `${ancho}px isla: ${JSON.stringify(m)}`);
      assert.ok(m.pagina <= m.ventana + 1, `${ancho}px sin desborde horizontal`);
      await page.click('#isla-menu');
      const tiles = await page.$$eval('#menu-hoja .menu-tile', (e) => e.map((x) => { const r = x.getBoundingClientRect(); return { dentro: r.left >= 0 && r.right <= window.innerWidth, w: Math.round(r.width) }; }));
      assert.ok(tiles.every((x) => x.dentro), `${ancho}px: las secciones caben en el panel`);
      const hoja = await page.evaluate(() => { const h = document.querySelector('#menu-hoja')!.getBoundingClientRect(); const i = document.querySelector('#isla')!.getBoundingClientRect(); return { sobreIsla: h.bottom <= i.top + 1, dentroArriba: h.top >= 40 }; });
      assert.deepEqual(hoja, { sobreIsla: true, dentroArriba: true }, `${ancho}px: el panel queda sobre la isla y dentro de la pantalla`);
      await page.click('#menu-lapiz');
      const pers = await page.evaluate(() => { const h = document.querySelector('#menu-hoja') as HTMLElement; return { desborda: h.scrollWidth > h.clientWidth + 1 }; });
      assert.equal(pers.desborda, false, `${ancho}px: Personalizar sin desplazamiento lateral`);
      // Nada se parte a la mitad ni se corta: cada etiqueta de la personalización cabe completa en su caja.
      const partidas = await page.evaluate(() => [...document.querySelectorAll('.pers-rejilla .menu-tile span, .slot-valor b')].filter((e) => { const x = e as HTMLElement; if (!x.offsetParent) return false; const r = document.createRange(); r.selectNodeContents(x); const palabras = (x.textContent ?? '').split(/\s+/); const ancho = Math.max(...palabras.map((w) => { const sp = document.createElement('span'); sp.style.cssText = `position:absolute;visibility:hidden;white-space:nowrap;font:${getComputedStyle(x).font}`; sp.textContent = w; document.body.appendChild(sp); const a = sp.getBoundingClientRect().width; sp.remove(); return a; })); return ancho > x.clientWidth + 0.5 || x.scrollWidth > x.clientWidth + 1; }).map((e) => e.textContent));
      assert.deepEqual(partidas, [], `${ancho}px: etiquetas cortadas o partidas`);
      await page.click('#menu-volver'); await page.keyboard.press('Escape');
      // Un cuadro de diálogo (editar artículo) queda por encima: la isla no lo tapa.
      await page.click('#isla-menu'); await page.click('#menu-hoja [data-vista="inventario"]');
      await page.waitForSelector('#inv-q');
      assert.equal(await page.locator('#isla').isVisible(), true);
      await page.click('#inv-filtros'); await page.waitForSelector('#dlg-inv-filtros[open]');
      assert.equal(await page.locator('#isla').isVisible(), false, 'con un diálogo abierto la isla se oculta (no lo tapa)');
      await page.click('#fi-cerrar');
      assert.equal(await page.locator('#isla').isVisible(), true);
      m = await medir();
      assert.deepEqual(errores, []);
    }
  });
});
