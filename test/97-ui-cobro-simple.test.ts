import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { describe, it } from 'node:test';
import { chromium } from 'playwright-core';
import { api, appAdmin, appCajero } from './ayudas/app.ts';
import { ALMACENES, nuevoMundo, politica } from './ayudas/comun.ts';

const chromiumPath = [process.env.POS_CHROMIUM, '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', '/opt/pw-browsers/chromium/chrome-linux/chrome'].find((p) => p && existsSync(p));
const sqlite = ALMACENES.find((a) => a.nombre === 'sqlite')!;
const JEANS = '0002026090782';

describe('[navegador real] Cobro en efectivo: pesos y dólares siempre a la vista, Enter cobra y «Venta por» junto al buscador', { timeout: 180_000, skip: chromiumPath ? false : 'Chromium no encontrado' }, () => {
  it('CS1 los dólares se escriben sin botón (fijan el tipo de cambio solos y se quitan al vaciar el renglón); Enter cobra solo con el botón encendido y nunca desde el escáner', async (t) => {
    const browser = await chromium.launch({ executablePath: chromiumPath, args: ['--no-sandbox'] });
    const ctx = nuevoMundo(sqlite, politica());
    const adm = await appAdmin(ctx);
    const caja = await appCajero(ctx, 'DUO', 1, 'Ana');
    t.after(async () => { await browser.close(); await adm.cerrar(); await caja.cerrar(); ctx.limpiar(); });
    await api(adm.url, '/api/admin/tipo-cambio', { tasa: 180000, confirmar: true });
    await api(adm.url, '/api/admin/cajeros', { nombre: 'Lupe', clave: '4321' });
    await api(adm.url, '/api/admin/cajeros', { nombre: 'Rosa', clave: '8765' });
    for (let i = 0; i < 4; i++) ctx.m.pump();
    await api(caja.url, '/api/login', { usuario: 'Lupe', clave: '4321' });
    const page = await (await browser.newContext({ viewport: { width: 1366, height: 768 } })).newPage();
    const errores: string[] = [];
    page.on('pageerror', (e) => errores.push(String(e)));
    await page.goto(caja.url);
    await page.waitForSelector('#scan');
    // «Venta por» va junto al buscador de artículos
    assert.equal(await page.locator('.buscador #bloque-vendio').count(), 1);
    assert.equal(await page.isVisible('.buscador #vendio-por'), true);
    await page.fill('#scan', JEANS); await page.press('#scan', 'Enter');
    await page.waitForSelector('#cuerpo tr[data-linea]');
    // Enter desde el escáner NO cobra (aunque el cobro ya se pueda): sigue en la venta
    await page.fill('#recibido', '1000');
    await page.focus('#scan');
    await page.press('#scan', 'Enter');
    assert.equal(await page.locator('#dlg-ticket[open]').count(), 0);
    // sin botón de «agregar dólares»: pesos y dólares ya están a la vista
    assert.equal(await page.locator('#btn-usd').count(), 0);
    assert.equal(await page.isVisible('#recibido'), true);
    assert.equal(await page.isVisible('#usd'), true);
    assert.equal(await page.isHidden('#bloque-usd'), true);
    // al escribir dólares se fija el tipo de cambio y salen las equivalencias; al vaciarlos se quitan
    await page.fill('#recibido', '0');
    await page.fill('#usd', '50');
    await page.waitForSelector('#bloque-usd:not([hidden])');
    assert.equal(await page.textContent('#usd-equivalente'), '$900.00');
    assert.equal(await page.textContent('#cambio'), '$1.00');
    await page.fill('#usd', '');
    await page.waitForSelector('#bloque-usd', { state: 'hidden' });
    // sin recibido suficiente el botón está apagado y Enter no cobra
    await page.fill('#recibido', '100');
    assert.equal(await page.isDisabled('#btn-cobrar'), true);
    await page.press('#recibido', 'Enter');
    assert.equal(await page.locator('#dlg-ticket[open]').count(), 0);
    // con el botón encendido, Enter cobra
    await page.fill('#recibido', '1000');
    assert.equal(await page.isDisabled('#btn-cobrar'), false);
    await page.press('#recibido', 'Enter');
    await page.waitForSelector('#dlg-ticket[open]');
    assert.deepEqual(errores, []);
  });
});
