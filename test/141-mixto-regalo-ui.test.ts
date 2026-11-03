import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { describe, it } from 'node:test';
import { chromium } from 'playwright-core';
import { api, appCajero } from './ayudas/app.ts';
import { ALMACENES, nuevoMundo, politica } from './ayudas/comun.ts';

const chromiumPath = [process.env.POS_CHROMIUM, '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', '/opt/pw-browsers/chromium/chrome-linux/chrome'].find((p) => p && existsSync(p));
const sqlite = ALMACENES.find((a) => a.nombre === 'sqlite')!;
const VESTIDO = '0002026090782'; // $899.00

describe('[navegador real] Botón Mixto con tarjeta de regalo', { timeout: 240_000, skip: chromiumPath ? false : 'Chromium no encontrado' }, () => {
  it('MU1 mixto: regalo + efectivo, regalo + tarjeta, los tres, y tarjeta + efectivo sin regalo', async (t) => {
    const browser = await chromium.launch({ executablePath: chromiumPath, args: ['--no-sandbox'] });
    const ctx = nuevoMundo(sqlite, politica());
    const caja = await appCajero(ctx, 'DUO', 1, 'Ana');
    t.after(async () => { await browser.close(); await caja.cerrar(); ctx.limpiar(); });
    for (const [cod, monto] of [['GC-A', 50000], ['GC-B', 50000], ['GC-C', 50000]] as const) caja.s.svc.caja.altaTarjetaRegalo({ codigo: cod, monto, ref: `ref-${cod}`, cajero: 'Ana' });
    ctx.m.pump(); ctx.m.pump();
    const page = await (await browser.newContext({ viewport: { width: 1366, height: 900 } })).newPage();
    const errores: string[] = [];
    page.on('pageerror', (e) => errores.push(String(e)));
    await page.goto(caja.url);
    await page.waitForSelector('#scan');
    const nueva = async () => { await page.click('#btn-nueva'); await page.waitForSelector('#dlg-ticket', { state: 'hidden' }); await page.waitForSelector('#scan'); };
    const ventaDe = (n: number) => caja.s.svc.caja.opsVentas().filter((o) => o.tipo === 'sale.confirmed' && !o.payload.lineas.some((l: any) => l.tarjeta_regalo)).map((o) => o.payload)[n - 1]!;

    // 1) regalo + efectivo: $899 − $500 = $399 en efectivo (sin monto de tarjeta bancaria)
    await page.fill('#scan', VESTIDO); await page.press('#scan', 'Enter'); await page.waitForSelector('#cuerpo tr[data-linea]');
    await page.click('button[data-forma="mixto"]');
    assert.equal(await page.locator('#codigo-regalo-mx').count(), 1, 'el Mixto trae el campo de la tarjeta de regalo');
    await page.fill('#codigo-regalo-mx', 'GC-A'); await page.press('#codigo-regalo-mx', 'Enter');
    await page.waitForSelector('#saldo-regalo-mx');
    assert.equal((await page.textContent('#saldo-regalo-mx'))!.trim(), '$500.00');
    assert.equal((await page.textContent('#mx-regalo'))!.trim(), '$500.00');
    assert.equal((await page.textContent('#tj-resto-monto'))!.trim(), '$399.00');
    assert.equal(await page.isDisabled('#btn-cobrar'), false);
    await page.click('#btn-cobrar'); await page.waitForSelector('#dlg-ticket[open]');
    assert.deepEqual(ventaDe(1).pagos.map((p: any) => [p.metodo, p.monto]), [['tarjeta_regalo', 50000], ['efectivo', 39900]]);
    await nueva();

    // 2) regalo + tarjeta bancaria: sin efectivo
    await page.fill('#scan', VESTIDO); await page.press('#scan', 'Enter'); await page.waitForSelector('#cuerpo tr[data-linea]');
    await page.click('button[data-forma="mixto"]');
    await page.fill('#codigo-regalo-mx', 'GC-B'); await page.press('#codigo-regalo-mx', 'Enter'); await page.waitForSelector('#saldo-regalo-mx');
    await page.fill('#tj-monto', '399');
    assert.equal((await page.textContent('#tj-resto-monto'))!.trim(), '$0.00');
    assert.equal(await page.isDisabled('#btn-cobrar'), false);
    await page.fill('#tj-monto', '400'); // más de lo que falta: no se puede cobrar
    assert.equal(await page.isDisabled('#btn-cobrar'), true);
    await page.fill('#tj-monto', '399');
    await page.click('#btn-cobrar'); await page.waitForSelector('#dlg-ticket[open]');
    assert.deepEqual(ventaDe(2).pagos.map((p: any) => [p.metodo, p.monto]), [['tarjeta_regalo', 50000], ['tarjeta', 39900]]);
    await nueva();

    // 3) los tres: regalo $500 + tarjeta $300 + efectivo $99
    await page.fill('#scan', VESTIDO); await page.press('#scan', 'Enter'); await page.waitForSelector('#cuerpo tr[data-linea]');
    await page.click('button[data-forma="mixto"]');
    await page.fill('#codigo-regalo-mx', 'GC-C'); await page.press('#codigo-regalo-mx', 'Enter'); await page.waitForSelector('#saldo-regalo-mx');
    await page.fill('#tj-monto', '300');
    assert.equal((await page.textContent('#tj-resto-monto'))!.trim(), '$99.00');
    await page.click('#btn-cobrar'); await page.waitForSelector('#dlg-ticket[open]');
    assert.deepEqual(ventaDe(3).pagos.map((p: any) => [p.metodo, p.monto]), [['tarjeta_regalo', 50000], ['tarjeta', 30000], ['efectivo', 9900]]);
    assert.match((await page.textContent('#ticket-texto'))!, /Tarjeta de regalo[\s\S]*Tarjeta[\s\S]*Efectivo/);
    await nueva();

    // 4) sin tarjeta de regalo el mixto de siempre (tarjeta + efectivo) y un código inexistente bloquea el cobro
    await page.fill('#scan', VESTIDO); await page.press('#scan', 'Enter'); await page.waitForSelector('#cuerpo tr[data-linea]');
    await page.click('button[data-forma="mixto"]');
    await page.fill('#tj-monto', '500');
    assert.equal((await page.textContent('#tj-resto-monto'))!.trim(), '$399.00');
    assert.equal(await page.isDisabled('#btn-cobrar'), false);
    await page.fill('#codigo-regalo-mx', 'NO-EXISTE'); await page.press('#codigo-regalo-mx', 'Enter');
    await page.waitForFunction(() => /no está dada de alta/.test(document.querySelector('#info-regalo-mx')?.textContent ?? ''));
    assert.equal(await page.isDisabled('#btn-cobrar'), true, 'con un código que no existe no se cobra');
    await page.fill('#codigo-regalo-mx', ''); await page.press('#codigo-regalo-mx', 'Enter');
    await page.waitForFunction(() => document.querySelector('#info-regalo-mx')?.hasAttribute('hidden'));
    assert.equal(await page.isDisabled('#btn-cobrar'), false);
    await page.click('#btn-cobrar'); await page.waitForSelector('#dlg-ticket[open]');
    assert.deepEqual(ventaDe(4).pagos.map((p: any) => [p.metodo, p.monto]), [['tarjeta', 50000], ['efectivo', 39900]]);
    for (const c of ['GC-A', 'GC-B', 'GC-C']) assert.equal(caja.s.svc.caja.saldoTarjeta(c), 0, `${c} quedó en cero`);
    assert.deepEqual(errores.filter((e) => !/401|403|Failed to load resource/.test(e)), []);
  });
});
