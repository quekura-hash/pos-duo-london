import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { describe, it } from 'node:test';
import { chromium } from 'playwright-core';
import { api, appAdmin, appCajero } from './ayudas/app.ts';
import { ALMACENES, nuevoMundo, politica } from './ayudas/comun.ts';

const chromiumPath = [process.env.POS_CHROMIUM, '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', '/opt/pw-browsers/chromium/chrome-linux/chrome'].find((p) => p && existsSync(p));
const sqlite = ALMACENES.find((a) => a.nombre === 'sqlite')!;
const JEANS = '0002026090782';

describe('[navegador real] Al cobrar: la feria que se da en grande y los detalles de la venta (ya no el ticket)', { timeout: 180_000, skip: chromiumPath ? false : 'Chromium no encontrado (defina POS_CHROMIUM)' }, () => {
  it('PC1 con cambio: «DAR DE FERIA» enorme y en verde, con total, recibido, forma de pago y artículos; con dólares muestra el tipo de cambio; sin cambio dice PAGO EXACTO; el ticket no se ve pero sigue ahí para imprimir', async (t) => {
    const browser = await chromium.launch({ executablePath: chromiumPath, args: ['--no-sandbox'] });
    const ctx = nuevoMundo(sqlite, politica());
    const adm = await appAdmin(ctx);
    const caja = await appCajero(ctx, 'DUO', 1, 'Ana');
    t.after(async () => { await browser.close(); await adm.cerrar(); await caja.cerrar(); ctx.limpiar(); });
    await api(adm.url, '/api/admin/tipo-cambio', { tasa: 180000, confirmar: true });
    await api(adm.url, '/api/admin/cajeros', { nombre: 'Lupe', clave: '4321' });
    for (let i = 0; i < 4; i++) ctx.m.pump();
    await api(caja.url, '/api/login', { usuario: 'Lupe', clave: '4321' });
    const page = await (await browser.newContext({ viewport: { width: 1366, height: 800 } })).newPage();
    const errores: string[] = [];
    page.on('pageerror', (e) => errores.push(String(e)));
    await page.goto(caja.url);
    await page.waitForSelector('#scan');
    const nueva = async () => { await page.click('#btn-nueva'); await page.waitForSelector('#dlg-ticket', { state: 'hidden' }); };
    // 1) efectivo con cambio: $899 pagados con $1,000
    await page.fill('#scan', JEANS); await page.press('#scan', 'Enter');
    await page.waitForSelector('#cuerpo tr[data-linea]');
    await page.fill('#recibido', '1000');
    await page.click('#btn-cobrar');
    await page.waitForSelector('#dlg-ticket[open] #dar-feria');
    assert.match((await page.textContent('#dar-feria'))!, /DAR DE FERIA\s*\$101\.00/);
    const tam = await page.evaluate(() => { const f = (s: string) => parseFloat(getComputedStyle(document.querySelector(s)!).fontSize); return { feria: f('#dar-feria-monto'), resto: f('#detalle-cobro dd') }; });
    assert.ok(tam.feria >= 64 && tam.feria > tam.resto * 3, `la feria es lo más grande: ${JSON.stringify(tam)}`);
    const verde = await page.evaluate(() => { const c = (e: Element) => getComputedStyle(e).color; const ok = document.createElement('i'); ok.style.color = 'var(--ok)'; document.body.append(ok); const r = [c(document.querySelector('#dar-feria-monto')!), c(ok)]; ok.remove(); return r; });
    assert.equal(verde[0], verde[1], 'verde de la paleta de LonDuo');
    const det = (await page.textContent('#detalle-cobro'))!.replace(/\s+/g, ' ');
    assert.match(det, /Total de la venta ?\$899\.00/);
    assert.match(det, /Recibido ?\$1,000\.00/);
    assert.match(det, /Pago ?Efectivo MXN/);
    assert.match(det, /Ticket ?D1-000001/);
    assert.match(await page.textContent('#lineas-cobro') as string, /\$899\.00/);
    assert.equal(await page.isVisible('#ticket-texto'), true, 'sigue en el DOM (1px) para lectores de pantalla y pruebas');
    assert.equal((await page.locator('#ticket-texto').boundingBox())!.width <= 2, true, 'pero no se ve en pantalla');
    assert.match((await page.textContent('#ticket-texto'))!, /Folio: 000001/);
    assert.match((await page.textContent('#resumen-venta'))!, /cambio \$101\.00/);
    await nueva();
    // 2) pago exacto en efectivo: sin feria
    await page.fill('#scan', JEANS); await page.press('#scan', 'Enter');
    await page.waitForSelector('#cuerpo tr[data-linea]');
    await page.click('#btn-exacto');
    await page.click('#btn-cobrar');
    await page.waitForSelector('#dlg-ticket[open] #dar-feria');
    assert.match((await page.textContent('#dar-feria'))!, /PAGO EXACTO/);
    assert.equal(await page.locator('#dar-feria-monto').count(), 0);
    await nueva();
    // 3) con dólares: US$50 a $18.00 = $900 y la feria en pesos
    await page.fill('#scan', JEANS); await page.press('#scan', 'Enter');
    await page.waitForSelector('#cuerpo tr[data-linea]');
    await page.fill('#recibido', '0');
    await page.fill('#usd', '50');
    await page.waitForSelector('#bloque-usd:not([hidden])');
    await page.click('#btn-cobrar');
    await page.waitForSelector('#dlg-ticket[open] #dar-feria');
    assert.match((await page.textContent('#dar-feria'))!, /DAR DE FERIA\s*\$1\.00/);
    assert.match((await page.textContent('#detalle-cobro'))!.replace(/\s+/g, ' '), /Pago ?Dólares US\$50\.00 a \$18\.00 = \$900\.00/);
    assert.deepEqual(errores, []);
  });
});
