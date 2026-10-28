import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { chromium, type Browser, type Page } from 'playwright-core';
import { api, appAdmin, appCajero } from './ayudas/app.ts';
import { ALMACENES, nuevoMundo, politica } from './ayudas/comun.ts';

const CANDIDATOS = [process.env.POS_CHROMIUM, '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', '/opt/pw-browsers/chromium/chrome-linux/chrome'];
const chromiumPath = CANDIDATOS.find((p) => p && existsSync(p));
const sqlite = ALMACENES.find((a) => a.nombre === 'sqlite')!;

async function pagina(browser: Browser, url: string, ancho = 1366, alto = 820): Promise<{ page: Page; errores: string[] }> {
  const ctx = await browser.newContext({ viewport: { width: ancho, height: alto }, colorScheme: 'light', locale: 'es-MX' });
  const page = await ctx.newPage();
  const errores: string[] = [];
  page.on('pageerror', (e) => errores.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error') errores.push(m.text()); });
  await page.goto(url);
  return { page, errores };
}

describe('[navegador real] Historial con detalle de venta y «Revertir venta»', { timeout: 240_000, skip: chromiumPath ? false : 'Chromium no encontrado (defina POS_CHROMIUM)' }, () => {
  it('UH1 tocar una venta abre el detalle; Revertir venta pide datos de la clienta y la clave de otra persona, e imprime los dos tickets', async (t) => {
    const browser = await chromium.launch({ executablePath: chromiumPath, args: ['--no-sandbox'] });
    const ctx = nuevoMundo(sqlite, politica());
    const adm = await appAdmin(ctx);
    const caja = await appCajero(ctx, 'DUO', 1, 'Ana');
    t.after(async () => { await browser.close(); await adm.cerrar(); await caja.cerrar(); ctx.limpiar(); });
    await api(adm.url, '/api/admin/administradores', { nombre: 'Edgardo', clave: 'clave-segura', clave_caja: '2468' });
    await api(adm.url, '/api/admin/cajeros', { nombre: 'Lupe', clave: '4321' });
    await api(adm.url, '/api/admin/cajeros', { nombre: 'Rosa', clave: '8765' });
    ctx.m.pump(); ctx.m.pump(); ctx.m.pump();
    await api(caja.url, '/api/login', { usuario: 'Lupe', clave: '4321' });
    const cart = (await api(caja.url, '/api/venta/nueva', {})).json.cart;
    await api(caja.url, '/api/venta/escanear', { cart, codigo: '0002026090782' });
    const v = (await api(caja.url, '/api/venta/cobrar-efectivo', { cart, recibido: 100000 })).json.venta;

    const { page, errores } = await pagina(browser, caja.url);
    await page.click('#nav button[data-vista="ventas"]');
    await page.waitForSelector(`#tabla-ventas tr[data-detalle="${v.sale_id}"]`);
    assert.equal(await page.locator('[data-revertir]').count(), 1, 'cada venta cobrada tiene su botón Revertir venta');
    assert.equal((await page.textContent('[data-revertir]'))!.trim(), 'Revertir venta');

    // tocar el renglón abre el detalle
    await page.click(`#tabla-ventas tr[data-detalle="${v.sale_id}"] td:first-child`);
    await page.waitForSelector('#dlg-detalle-venta[open]');
    assert.match((await page.textContent('#dv-titulo'))!, /Venta D1-000001/);
    assert.match((await page.textContent('#dv-datos'))!, /Vendedora-Cajera\s*Lupe/);
    assert.match((await page.textContent('#dv-resumen'))!, /Caja 1[\s\S]*\d\d\/\d\d\/\d{4} \d{1,2}:\d\d (AM|PM)/);
    assert.match((await page.textContent('#dv-lineas'))!, /\$899\.00/);
    assert.equal(await page.locator('#dv-cambio').count(), 1);
    assert.equal(await page.locator('#dv-revertir').count(), 1);
    assert.match((await page.textContent('#dv-ticket'))!, /Folio: 000001/);

    // Revertir: valida los datos de la clienta antes de enviar nada
    await page.click('#dv-revertir');
    await page.waitForSelector('#dlg-revertir[open]');
    await page.click('#rv-ok');
    assert.match((await page.textContent('#msg-rv'))!, /nombre de la clienta/);
    await page.fill('#rv-nombre', 'Ana López');
    await page.click('#rv-ok');
    assert.match((await page.textContent('#msg-rv'))!, /teléfono/);
    await page.fill('#rv-telefono', '653 123 4567');
    await page.click('#rv-ok');
    assert.match((await page.textContent('#msg-rv'))!, /motivo/);
    await page.fill('#rv-motivo', 'no le quedó');
    await page.click('#rv-ok');
    assert.match((await page.textContent('#msg-rv'))!, /clave/);
    // otra persona autoriza: ella misma no puede
    assert.deepEqual((await page.$$eval('#rv-quien option', (o) => o.map((x) => x.textContent))).sort(), ['Edgardo (supervisor)', 'Rosa']);
    await page.selectOption('#rv-quien', 'Rosa');
    await page.fill('#rv-clave', '0000');
    await page.click('#rv-ok');
    await page.waitForFunction(() => /clave/i.test(document.querySelector('#msg-rv')!.textContent!) && /correcta|inválida|CLAVE/i.test(document.querySelector('#msg-rv')!.textContent!));
    await page.fill('#rv-clave', '8765');
    await page.click('#rv-ok');
    await page.waitForFunction(() => /revertida/.test(document.querySelector('#mensaje-hist')?.textContent ?? ''));
    assert.match((await page.textContent('#mensaje-hist'))!, /Venta 000001 revertida[\s\S]*VENTA CANCELADA/);
    assert.equal(await page.locator('[data-revertir]').count(), 0, 'una venta cancelada ya no se revierte');
    assert.equal((await page.textContent(`#tabla-ventas tr[data-detalle="${v.sale_id}"] .insignia`))!.trim(), 'cancelada');

    // dos tickets impresos: el de la clienta y el comprobante que firma
    const impresos = readdirSync(caja.s.impresora.dir).filter((f) => f.endsWith('.txt')).sort().map((f) => readFileSync(join(caja.s.impresora.dir, f), 'utf8'));
    assert.match(impresos.at(-2)!, /VENTA CANCELADA/);
    assert.match(impresos.at(-1)!, /VENTA CANCELADA[\s\S]*COPIA PARA LA TIENDA[\s\S]*Ana López[\s\S]*Recibí devolución/);

    // el detalle de la venta cancelada muestra quién, por qué y los datos de la clienta
    await page.click(`#tabla-ventas tr[data-detalle="${v.sale_id}"] td:first-child`);
    await page.waitForSelector('#dlg-detalle-venta[open] #dv-cancelada');
    assert.match((await page.textContent('#dv-cancelada'))!, /por Lupe, autorizó Rosa[\s\S]*Motivo: no le quedó[\s\S]*Ana López · 653 123 4567/);
    assert.equal(await page.locator('#dv-revertir').count(), 0);
    assert.equal(await page.locator('#dv-cambio').count(), 0);
    assert.deepEqual(errores.filter((e) => !/401|403|409|Failed to load resource/.test(e)), []);
  });

  it('UH2 Administración: historial de todas las cajas; tocar la venta abre el mismo detalle, sin Revertir ni Cambio', async (t) => {
    const browser = await chromium.launch({ executablePath: chromiumPath, args: ['--no-sandbox'] });
    const ctx = nuevoMundo(sqlite, politica());
    const adm = await appAdmin(ctx);
    const caja = await appCajero(ctx, 'DUO', 1, 'Ana');
    t.after(async () => { await browser.close(); await adm.cerrar(); await caja.cerrar(); ctx.limpiar(); });
    const cart = (await api(caja.url, '/api/venta/nueva', {})).json.cart;
    await api(caja.url, '/api/venta/escanear', { cart, codigo: '0002026090782' });
    const v = (await api(caja.url, '/api/venta/cobrar-efectivo', { cart, recibido: 100000 })).json.venta;
    ctx.m.pump(); ctx.m.pump(); ctx.m.pump();

    const { page, errores } = await pagina(browser, adm.url);
    await page.waitForSelector('#nav button[data-vista="historial"]');
    await page.click('#nav button[data-vista="historial"]');
    await page.fill('#ha-desde', '2026-10-01');
    await page.fill('#ha-hasta', '2026-10-01');
    await page.click('#ha-filtros button[type="submit"]');
    await page.waitForSelector(`#tabla-historial-admin tr[data-detalle="${v.sale_id}"]`);
    assert.match((await page.textContent(`#tabla-historial-admin tr[data-detalle="${v.sale_id}"]`))!, /DUO · 1[\s\S]*000001[\s\S]*Ana|Lupe|\$899\.00/);
    await page.click(`#tabla-historial-admin tr[data-detalle="${v.sale_id}"] td:first-child`);
    await page.waitForSelector('#dlg-detalle-venta[open]');
    assert.match((await page.textContent('#dv-titulo'))!, /Venta D1-000001/);
    assert.match((await page.textContent('#dv-lineas'))!, /\$899\.00/);
    assert.match((await page.textContent('#dv-ticket'))!, /Folio: 000001/);
    assert.equal(await page.locator('#dv-revertir').count(), 0, 'en Administración solo se consulta');
    assert.equal(await page.locator('#dv-cambio').count(), 0);
    assert.match((await page.textContent('#dlg-detalle-venta'))!, /hágalo en la caja donde se vendió/);
    // un folio que no existe no devuelve filas
    await page.click('#dv-cerrar');
    await page.fill('#ha-folio', '99');
    await page.click('#ha-filtros button[type="submit"]');
    await page.waitForFunction(() => /No hay ventas con esos datos/.test(document.querySelector('#ha-resultado')?.textContent ?? ''));
    assert.deepEqual(errores.filter((e) => !/401|403|Failed to load resource/.test(e)), []);
  });
  it('UH3 en el iPhone el historial de Administración y el detalle caben sin desplazamiento horizontal', async (t) => {
    const browser = await chromium.launch({ executablePath: chromiumPath, args: ['--no-sandbox'] });
    const ctx = nuevoMundo(sqlite, politica());
    const adm = await appAdmin(ctx);
    const caja = await appCajero(ctx, 'DUO', 1, 'Ana');
    t.after(async () => { await browser.close(); await adm.cerrar(); await caja.cerrar(); ctx.limpiar(); });
    const cart = (await api(caja.url, '/api/venta/nueva', {})).json.cart;
    await api(caja.url, '/api/venta/escanear', { cart, codigo: '0002026090782' });
    const v = (await api(caja.url, '/api/venta/cobrar-efectivo', { cart, recibido: 100000 })).json.venta;
    ctx.m.pump(); ctx.m.pump(); ctx.m.pump();
    const { page } = await pagina(browser, adm.url, 390, 844);
    await page.waitForSelector('#nav button[data-vista="historial"]');
    await page.click('#nav button[data-vista="historial"]');
    await page.fill('#ha-desde', '2026-10-01'); await page.fill('#ha-hasta', '2026-10-01');
    await page.click('#ha-filtros button[type="submit"]');
    await page.waitForSelector(`#tabla-historial-admin tr[data-detalle="${v.sale_id}"]`);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), true, 'la lista no se desborda');
    await page.click(`#tabla-historial-admin tr[data-detalle="${v.sale_id}"]`);
    await page.waitForSelector('#dlg-detalle-venta[open]');
    const caja2 = await page.evaluate(() => { const r = document.querySelector('#dlg-detalle-venta')!.getBoundingClientRect(); return { izq: r.left, der: r.right, ancho: window.innerWidth }; });
    assert.ok(caja2.izq >= -1 && caja2.der <= caja2.ancho + 1, `el detalle cabe en la pantalla: ${JSON.stringify(caja2)}`);
    const cerrar = await page.locator('#dv-cerrar').boundingBox();
    assert.ok(cerrar && cerrar.x >= 0 && cerrar.x + cerrar.width <= 390, 'el botón Cerrar es alcanzable');
  });
});
