import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { describe, it } from 'node:test';
import { chromium } from 'playwright-core';
import { api, appAdmin, appCajero } from './ayudas/app.ts';
import { ALMACENES, nuevoMundo, politica } from './ayudas/comun.ts';

const chromiumPath = [process.env.POS_CHROMIUM, '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', '/opt/pw-browsers/chromium/chrome-linux/chrome'].find((p) => p && existsSync(p));
const sqlite = ALMACENES.find((a) => a.nombre === 'sqlite')!;

describe('[sqlite] Una supervisora también es empleada con crédito', () => {
  it('SC1 Administración la lista en Empleadas, le fija el límite y registra su abono; la caja le vende a crédito con su clave', async (t) => {
    const ctx = nuevoMundo(sqlite, politica());
    const adm = await appAdmin(ctx);
    const caja = await appCajero(ctx, 'DUO', 1, 'Lupe');
    t.after(async () => { await adm.cerrar(); await caja.cerrar(); ctx.limpiar(); });
    assert.equal((await api(adm.url, '/api/admin/cajeros', { nombre: 'Lupe', clave: '4321' })).status, 200);
    assert.equal((await api(adm.url, '/api/admin/supervisores', { nombre: 'Evelyn', clave: '1357' })).status, 200);
    ctx.m.pump(); ctx.m.pump(); ctx.m.pump();
    const cuentas = async () => (await api(adm.url, '/api/admin/empleadas')).json.empleadas as { id: string; nombre: string; limite: number; disponible: number }[];
    const eve = (await cuentas()).find((e) => e.nombre === 'Evelyn');
    assert.ok(eve, 'la supervisora aparece en Empleadas');
    assert.equal((await api(adm.url, '/api/admin/empleadas/limite', { empleada_id: eve.id, limite: 100000, motivo: 'crédito de supervisora' })).status, 200);
    assert.equal((await cuentas()).find((e) => e.nombre === 'Evelyn')!.limite, 100000);
    assert.equal((await api(adm.url, '/api/admin/empleadas/movimiento', { empleada_id: eve.id, tipo: 'ajuste_cargo', monto: 5000, motivo: 'ajuste', ref: 'r-1' })).status, 200);
    assert.equal((await api(adm.url, '/api/admin/empleadas/limite', { empleada_id: 'no-existe', limite: 10, motivo: 'prueba' })).status >= 400, true);
    ctx.m.pump(); ctx.m.pump(); ctx.m.pump();
    // la caja la lista y le vende a crédito con la clave de ella
    assert.equal((await api(caja.url, '/api/login', { usuario: 'Lupe', clave: '4321' })).status, 200);
    assert.ok((await api(caja.url, '/api/empleadas')).json.empleadas.some((e: { id: string }) => e.id === eve.id));
    const c = (await api(caja.url, '/api/venta/nueva', {})).json.cart;
    await api(caja.url, '/api/venta/escanear', { cart: c, codigo: '7501234567890' }); // mascada $120
    assert.equal((await api(caja.url, '/api/venta/empleada', { cart: c, empleada_id: eve.id, clave: '1357' })).status, 200);
    const cr = await api(caja.url, '/api/venta/cobrar-credito-empleada', { cart: c }); assert.equal(cr.status, 200, JSON.stringify(cr.json));
    ctx.m.pump(); ctx.m.pump(); ctx.m.pump();
    const e2 = (await cuentas()).find((e) => e.nombre === 'Evelyn')!;
    assert.ok(e2.disponible < 100000 - 5000, `el crédito se descuenta de su disponible: ${e2.disponible}`);
  });
  it('SC2 las marcas y departamentos excluidos no llevan descuento de empleada; los demás sí, y los porcentajes se conservan', async (t) => {
    const ctx = nuevoMundo(sqlite, politica());
    const adm = await appAdmin(ctx);
    const caja = await appCajero(ctx, 'DUO', 1, 'Lupe');
    t.after(async () => { await adm.cerrar(); await caja.cerrar(); ctx.limpiar(); });
    await api(adm.url, '/api/admin/cajeros', { nombre: 'Lupe', clave: '4321' });
    await api(adm.url, '/api/admin/cajeros', { nombre: 'Rosa', clave: '8765' });
    ctx.m.pump(); ctx.m.pump(); ctx.m.pump();
    assert.equal((await api(adm.url, '/api/admin/empleadas/config', { pct: 20, pct_uniforme: 40 })).status, 200);
    // guardar solo las excepciones no pisa los porcentajes
    const g = await api(adm.url, '/api/admin/empleadas/config', { marcas: ['efentus'], departamentos: [' skincare ', ''] });
    assert.equal(g.status, 200, JSON.stringify(g.json));
    const cfg = (await api(adm.url, '/api/admin/empleadas')).json.config;
    assert.deepEqual([cfg.pct, cfg.pct_uniforme, cfg.marcas, cfg.departamentos], [20, 40, ['efentus'], ['skincare']]);
    assert.equal((await api(adm.url, '/api/admin/empleadas/config', { pct: 0 })).status >= 400, true);
    for (let i = 0; i < 4; i++) ctx.m.pump();
    await api(caja.url, '/api/login', { usuario: 'Lupe', clave: '4321' });
    const rosa = ((await api(caja.url, '/api/empleadas')).json.empleadas as { id: string; nombre: string }[]).find((e) => e.nombre === 'Rosa')!.id;
    const c = (await api(caja.url, '/api/venta/nueva', {})).json.cart;
    await api(caja.url, '/api/venta/escanear', { cart: c, codigo: '0002026090782' }); // jeans $899
    await api(caja.url, '/api/venta/escanear', { cart: c, codigo: '7501234567890' }); // mascada $120 (marca excluida)
    const r = await api(caja.url, '/api/venta/empleada', { cart: c, empleada_id: rosa, clave: '8765' });
    assert.equal(r.status, 200, JSON.stringify(r.json));
    assert.equal(r.json.carrito.descuentos, 18000, 'solo el jeans: 20 % de $899 = $179.80, a pesos enteros $180');
    assert.equal(r.json.carrito.total, 89900 + 12000 - 18000);
  });
  it('SC3 [navegador] Administración guarda las excepciones de empleada desde Descuento y crédito', { skip: chromiumPath ? false : 'Chromium no encontrado' }, async (t) => {
    const browser = await chromium.launch({ executablePath: chromiumPath, args: ['--no-sandbox'] });
    const ctx = nuevoMundo(sqlite, politica());
    const adm = await appAdmin(ctx);
    t.after(async () => { await browser.close(); await adm.cerrar(); ctx.limpiar(); });
    const page = await (await browser.newContext({ viewport: { width: 1366, height: 900 } })).newPage();
    const errores: string[] = [];
    page.on('pageerror', (e) => errores.push(String(e)));
    await page.goto(adm.url);
    await page.waitForSelector('#nav');
    await page.click('#nav button[data-vista="empleadas"]');
    await page.click('#per-tab-descuento');
    await page.waitForSelector('#form-emp-ex');
    await page.fill('#ex-marcas', "Victoria's Secret");
    await page.fill('#ex-deptos', 'Skincare\nBolsos de dama');
    await page.click('#form-emp-ex button[type="submit"]');
    await page.waitForFunction(() => /Excepciones guardadas/.test(document.querySelector('#msg-emp-admin')!.textContent!));
    const cfg = (await api(adm.url, '/api/admin/empleadas')).json.config;
    assert.deepEqual([cfg.pct, cfg.pct_uniforme, cfg.marcas, cfg.departamentos], [15, 30, ["Victoria's Secret"], ['Skincare', 'Bolsos de dama']]);
    assert.deepEqual(errores, []);
  });
});
