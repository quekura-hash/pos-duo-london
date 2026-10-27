import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { describe, it } from 'node:test';
import { chromium } from 'playwright-core';
import { api, appAdmin, appCajero } from './ayudas/app.ts';
import { ALMACENES, nuevoMundo, politica } from './ayudas/comun.ts';

const chromiumPath = [process.env.POS_CHROMIUM, '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', '/opt/pw-browsers/chromium/chrome-linux/chrome'].find((p) => p && existsSync(p));
const sqlite = ALMACENES.find((a) => a.nombre === 'sqlite')!;

describe('[navegador real] Clientes VIP: Administración y caja', { timeout: 240_000, skip: chromiumPath ? false : 'Chromium no encontrado (defina POS_CHROMIUM)' }, () => {
  it('UV1 Administración da de alta a la cliente VIP y fija excepciones; la cajera la elige con su clave y el descuento aparece en la venta', async (t) => {
    const browser = await chromium.launch({ executablePath: chromiumPath, args: ['--no-sandbox'] });
    const ctx = nuevoMundo(sqlite, politica());
    const adm = await appAdmin(ctx);
    const caja = await appCajero(ctx, 'DUO', 1, 'Lupe');
    t.after(async () => { await browser.close(); await adm.cerrar(); await caja.cerrar(); ctx.limpiar(); });
    await api(adm.url, '/api/admin/administradores', { nombre: 'Edgardo', clave: 'clave-segura', clave_caja: '2468' });
    await api(adm.url, '/api/admin/cajeros', { nombre: 'Lupe', clave: '4321' });
    ctx.m.pump(); ctx.m.pump(); ctx.m.pump();
    await api(caja.url, '/api/login', { usuario: 'Lupe', clave: '4321' });
    const errores: string[] = [];
    const a = await (await browser.newContext({ viewport: { width: 1366, height: 900 }, locale: 'es-MX' })).newPage();
    a.on('pageerror', (e) => errores.push(String(e)));
    await a.goto(adm.url);
    await a.waitForSelector('#nav');
    await a.click('#nav button[data-vista="configuracion"]');
    await a.click('#cfg-tab-vip');
    await a.waitForSelector('#form-vip-alta');
    // validación: nombre incompleto
    await a.fill('#vipa-nombre', 'Maria'); await a.fill('#vipa-tel', '6861234567'); await a.fill('#vipa-pct', '15');
    await a.click('#vipa-guardar');
    await a.waitForFunction(() => /nombre/i.test(document.querySelector('#msg-vip-admin')!.textContent!));
    await a.fill('#vipa-nombre', 'María López Soto');
    await a.click('#vipa-guardar');
    await a.waitForSelector('#tabla-vip tr[data-vip]');
    assert.match((await a.textContent('#tabla-vip'))!, /María López Soto[\s\S]*15%/);
    await a.fill('#vipx-marcas', 'Efentus');
    await a.click('#form-vip-ex button[type="submit"]');
    await a.waitForFunction(() => /Excepciones guardadas/.test(document.querySelector('#msg-vip-admin')!.textContent!));
    ctx.m.pump(); ctx.m.pump(); ctx.m.pump();
    // caja
    const c = await (await browser.newContext({ viewport: { width: 1366, height: 900 }, locale: 'es-MX' })).newPage();
    c.on('pageerror', (e) => errores.push(String(e)));
    await c.goto(caja.url);
    await c.waitForSelector('#scan');
    await c.fill('#scan', '0002026090782'); await c.press('#scan', 'Enter');
    await c.waitForSelector('#cuerpo tr[data-linea]');
    await c.click('#btn-descuento');
    await c.click('#desc-vip');
    await c.waitForSelector('#form-vip');
    await c.fill('#vip-buscar', 'lopez');
    await c.click('#vip-lista [data-vip]');
    await c.fill('#vip-clave', '0000');
    await c.click('#vip-aplicar');
    await c.waitForFunction(() => document.querySelector('#msg-vip')!.textContent!.length > 0);
    await c.fill('#vip-clave', '4321');
    await c.click('#vip-aplicar');
    await c.waitForSelector('[data-vip-venta]');
    assert.match((await c.textContent('[data-vip-venta]'))!, /María López Soto 15%/);
    await c.click('#btn-quitar-vip');
    await c.waitForSelector('[data-vip-venta]', { state: 'detached' });
    assert.deepEqual(errores.filter((e) => !/401|403|Failed to load resource/.test(e)), []);
  });
});
