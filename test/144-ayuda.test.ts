import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { chromium } from 'playwright-core';
import { api, appCajero } from './ayudas/app.ts';
import { ALMACENES, nuevoMundo, politica } from './ayudas/comun.ts';

const RAIZ = join(import.meta.dirname, '..');
const chromiumPath = [process.env.POS_CHROMIUM, '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', '/opt/pw-browsers/chromium/chrome-linux/chrome'].find((p) => p && existsSync(p));
const sqlite = ALMACENES.find((a) => a.nombre === 'sqlite')!;
const APP = readFileSync(join(RAIZ, 'src/app/publico/app.js'), 'utf8');

describe('Ayuda integrada', { timeout: 240_000, skip: chromiumPath ? false : 'Chromium no encontrado' }, () => {
  it('AY1 el buscador entiende palabras clave, sinónimos y acentos (cambio de prenda, corte, tarjeta de crédito, descuento de empleada)', async (t) => {
    const browser = await chromium.launch({ executablePath: chromiumPath, args: ['--no-sandbox'] });
    const ctx = nuevoMundo(sqlite, politica());
    const caja = await appCajero(ctx, 'DUO', 1, 'Ana');
    t.after(async () => { await browser.close(); await caja.cerrar(); ctx.limpiar(); });
    assert.ok((await api(caja.url, '/api/sesion')).json.nav.includes('ayuda'), 'la caja trae la pestaña Ayuda');
    const page = await (await browser.newContext({ viewport: { width: 1366, height: 800 } })).newPage();
    const errores: string[] = [];
    page.on('pageerror', (e) => errores.push(String(e)));
    await page.goto(caja.url);
    await page.waitForSelector('#nav button[data-vista="ayuda"]');
    await page.click('#nav button[data-vista="ayuda"]');
    await page.waitForSelector('#ay-q');
    const titulos = () => page.$$eval('#ay-lista .ay-cab b', (b) => b.map((x) => x.textContent!));
    const buscar = async (q: string) => { await page.fill('#ay-q', q); return titulos(); };
    assert.ok((await titulos()).length >= 25, 'sin buscar muestra todos los temas');
    // los ejemplos del dueño
    for (const q of ['cambio de mercancía', 'cambio de artículo', 'cambio de prenda', 'cambio falda', 'hacer cambio de vestido']) assert.equal((await buscar(q))[0], 'Hacer un cambio de mercancía (artículo, prenda, falda…)', q);
    assert.equal((await buscar('¿cómo se hace el corte?'))[0], 'Hacer el corte de caja (cierre del día)');
    assert.equal((await buscar('cierre'))[0], 'Hacer el corte de caja (cierre del día)', 'cierre = corte');
    assert.equal((await buscar('cómo cobrar con tarjeta de crédito'))[0], 'Cobrar con tarjeta de crédito o débito');
    assert.equal((await buscar('TC'))[0], 'Cobrar con tarjeta de crédito o débito', 'siglas');
    assert.equal((await buscar('venta con descuento de empleada'))[0], 'Venta con descuento de empleada');
    assert.equal((await buscar('DEPOSITO vestido'))[0].startsWith('Recibir un depósito'), true, 'sin acentos ni mayúsculas');
    assert.ok((await buscar('totalización')).includes('Totalización bancaria al cerrar el corte'));
    assert.deepEqual(await buscar('xyzqq'), []);
    assert.match((await page.textContent('#ay-lista'))!, /No encontré nada/);
    // con un solo resultado el artículo aparece abierto, con sus pasos numerados
    const r = await buscar('perdio comprobante');
    assert.equal(r[0], 'La clienta perdió su comprobante de depósito');
    if (!(await page.locator('#ay-lista .ay-art.abierto').count())) await page.click('#ay-lista .ay-cab');
    assert.equal(await page.locator('#ay-lista .ay-art.abierto ol.ay-pasos li').count() >= 3, true);
    // temas, abrir/cerrar y botón «Ir a»
    await page.fill('#ay-q', '');
    await page.click('#ay-cats [data-ay-cat="Depósitos"]');
    assert.equal((await titulos()).length, 5);
    await page.click('#ay-cats [data-ay-cat=""]');
    await page.fill('#ay-q', 'corte');
    await page.click('#ay-lista [data-ay-abrir="corte"]'); // con varios resultados empiezan cerrados
    await page.click('#ay-lista [data-ay-ir="corte"]');
    await page.waitForSelector('h1:has-text("Cierre de caja")');
    assert.deepEqual(errores, []);
  });

  it('AY2 el manual solo cita botones y pantallas que existen en la aplicación (no se desactualiza sin avisar)', () => {
    // Todo lo que está entre «comillas angulares» en el manual debe aparecer tal cual como texto de un botón, título o campo de la app.
    const bloque = APP.slice(APP.indexOf('const AYUDA_ARTICULOS'), APP.indexOf('const AYUDA_SINONIMOS'));
    const citas = [...new Set([...bloque.matchAll(/«([^»]{3,60})»/g)].map((m) => m[1]!.trim()))];
    const resto = APP.replace(bloque, '');
    const titulosDelManual = new Set([...bloque.matchAll(/titulo: '([^']+)'/g)].map((m) => m[1]!));
    const NO_VERIFICABLES = new Set(['Autocompra', 'Venta en espera', 'Retomar', 'Ventas guardadas', 'Comprobante extraviado', ...titulosDelManual]); // se escriben dinámicamente, vienen del ticket impreso o son referencias a otros temas
    const normaliza = (s: string) => s.replace(/\s+/g, ' ').toLowerCase();
    const textoApp = normaliza(resto);
    const faltan = citas.filter((c) => !NO_VERIFICABLES.has(c) && !textoApp.includes(normaliza(c).replace(/\.\.\.$/, '').replace(/…$/, '')) && !textoApp.includes(normaliza(c).replace(/\.\.\.|…/g, '').trim()));
    assert.deepEqual(faltan, [], `el manual cita textos que ya no existen en la aplicación: ${faltan.join(' | ')}`);
  });

  for (const esquema of ['light', 'dark'] as const) {
    it(`AY3 (${esquema}) la pantalla de Ayuda se ve bien y no desborda (captura)`, async (t) => {
      const browser = await chromium.launch({ executablePath: chromiumPath, args: ['--no-sandbox'] });
      const ctx = nuevoMundo(sqlite, politica());
      const caja = await appCajero(ctx, 'DUO', 1, 'Ana');
      t.after(async () => { await browser.close(); await caja.cerrar(); ctx.limpiar(); });
      const page = await (await browser.newContext({ viewport: { width: 1366, height: 800 }, colorScheme: esquema })).newPage();
      await page.goto(caja.url);
      await page.click('#nav button[data-vista="ayuda"]');
      await page.fill('#ay-q', 'cambio de prenda');
      await page.waitForSelector('#ay-lista .ay-art');
      await page.click('#ay-lista .ay-cab');
      const d = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: window.innerWidth }));
      assert.ok(d.sw <= d.iw, JSON.stringify(d));
      await page.screenshot({ path: join(RAIZ, 'docs', 'capturas', `ayuda-${esquema}.png`) });
    });
  }
});
