import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { describe, it } from 'node:test';
import { chromium } from 'playwright-core';
import { api, appAdmin, appCajero } from './ayudas/app.ts';
import { ALMACENES, nuevoMundo, politica } from './ayudas/comun.ts';

const CANDIDATOS = [process.env.POS_CHROMIUM, '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', '/opt/pw-browsers/chromium/chrome-linux/chrome'];
const chromiumPath = CANDIDATOS.find((p) => p && existsSync(p));
const sqlite = ALMACENES.find((a) => a.nombre === 'sqlite')!;

describe('[navegador real] Ventas a empleadas: caja y Administración', { timeout: 240_000, skip: chromiumPath ? false : 'Chromium no encontrado (defina POS_CHROMIUM)' }, () => {
  it('UE1 la cajera elige a la empleada con su clave, marca el uniforme y cobra a crédito; Administración ve la cuenta, registra el abono y el reporte de nómina', async (t) => {
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
    const rosa = ((await api(caja.url, '/api/empleadas')).json.empleadas as { id: string; nombre: string }[]).find((e) => e.nombre === 'Rosa')!.id;
    await api(adm.url, '/api/admin/empleadas/limite', { empleada_id: rosa, limite: 100000, motivo: 'alta de crédito' });
    ctx.m.pump(); ctx.m.pump(); ctx.m.pump();
    const errores: string[] = [];
    const contexto = await browser.newContext({ viewport: { width: 1366, height: 900 }, locale: 'es-MX' });
    const page = await contexto.newPage();
    page.on('pageerror', (e) => errores.push(String(e)));
    page.on('console', (m) => { if (m.type() === 'error' && !/401|403|409|Failed to load resource/.test(m.text())) errores.push(m.text()); });
    await page.goto(caja.url);
    await page.waitForSelector('#scan');
    await page.fill('#scan', '0002026090782'); await page.press('#scan', 'Enter');
    await page.waitForSelector('#cuerpo tr[data-linea]');
    await page.fill('#scan', '7501234567890'); await page.press('#scan', 'Enter');
    await page.waitForFunction(() => document.querySelectorAll('#cuerpo tr[data-linea]').length === 2);
    assert.equal(await page.isDisabled('[data-forma="credito"]'), true, 'sin empleada no hay crédito');
    assert.equal(await page.isVisible('#btn-uniforme'), false, 'sin empleada elegida no se ofrece «Marcar como uniforme»');
    // elegir a la empleada: clave equivocada y luego la buena
    await page.click('#btn-empleada');
    await page.waitForSelector('#dlg-empleada[open]');
    await page.selectOption('#emp-quien', { label: 'Rosa' });
    await page.fill('#emp-clave', '0000');
    await page.click('#form-empleada button[type="submit"]');
    await page.waitForFunction(() => /clave/i.test(document.querySelector('#msg-emp')!.textContent!));
    await page.fill('#emp-clave', '8765');
    await page.click('#form-empleada button[type="submit"]');
    await page.waitForSelector('#bloque-empleada:not([hidden])');
    assert.match((await page.textContent('#mensaje'))!, /15% ya se aplicó a toda la venta[\s\S]*Marcar como uniforme/);
    assert.match((await page.textContent('#bloque-empleada'))!, /Venta a empleada: Rosa[\s\S]*15%[\s\S]*Crédito disponible: \$1,000\.00/);
    // 899 + 120 = 1,019 − 15 % = 866.15
    await page.waitForFunction(() => document.querySelector('#total')!.textContent === '$866.15');
    // la mascada (120) es uniforme: 30 %
    await page.click('#cuerpo tr[data-linea]:nth-of-type(2) td.desc');
    await page.click('#btn-uniforme');
    await page.waitForFunction(() => document.querySelector('#total')!.textContent === '$848.15'); // 764.15 + 84
    // pago a crédito
    await page.click('[data-forma="credito"]');
    await page.waitForSelector('#credito-monto');
    assert.equal(await page.textContent('#credito-monto'), '$848.15');
    assert.equal(await page.isDisabled('#btn-cobrar'), false);
    await page.click('#btn-cobrar');
    await page.waitForSelector('#dlg-ticket[open] #ticket-texto');
    const tk = (await page.textContent('#ticket-texto'))!;
    assert.match(tk, /Empleada: Rosa[\s\S]*Descuento de empleada 15%[\s\S]*Descuento de empleada 30% \(uniforme\)[\s\S]*Crédito de empleada \(nómina\) +\$848\.15[\s\S]*Firma: Rosa/);

    // Administración
    ctx.m.pump(); ctx.m.pump(); ctx.m.pump();
    const a = await (await browser.newContext({ viewport: { width: 1440, height: 1000 }, locale: 'es-MX' })).newPage();
    a.on('pageerror', (e) => errores.push(String(e)));
    await a.goto(adm.url);
    await a.waitForSelector('#nav');
    await a.click('#nav button[data-vista="empleadas"]');
    await a.click('#per-tab-descuento');
    await a.waitForSelector('#tabla-empleadas tr[data-emp]');
    const fila = `#tabla-empleadas tr[data-emp="${rosa}"]`;
    assert.equal(await a.textContent(`${fila} [data-col="saldo"]`), '$848.15');
    assert.equal(await a.textContent(`${fila} [data-col="disponible"]`), '$151.85');
    // abono de nómina de $300
    await a.click(`${fila} .em-abono`);
    await a.fill('#ef-monto', '300');
    await a.fill('#ef-periodo', 'octubre, 1ª quincena');
    await a.click('#form-emp button[type="submit"]');
    await a.waitForFunction((f) => document.querySelector(`${f} [data-col="saldo"]`)?.textContent === '$548.15', fila);
    assert.equal(await a.textContent(`${fila} [data-col="abonos"]`), '$300.00');
    // movimientos y reporte de nómina del día
    await a.click(`${fila} .em-mov`);
    await a.waitForSelector('#tabla-emp-mov');
    assert.match((await a.textContent('#tabla-emp-mov'))!, /Venta a crédito[\s\S]*Abono de nómina[\s\S]*octubre, 1ª quincena/);
    await a.click('#per-tab-nomina');
    await a.fill('#nom-desde', '2026-10-01'); await a.fill('#nom-hasta', '2026-10-01');
    await a.click('#form-nomina button[type="submit"]');
    await a.waitForFunction(() => /\$548\.15/.test(document.querySelector('#nom-total')?.parentElement?.textContent ?? ''));
    assert.deepEqual(errores, []);
  });
});
