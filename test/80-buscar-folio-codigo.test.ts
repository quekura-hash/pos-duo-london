import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { describe, it } from 'node:test';
import { chromium } from 'playwright-core';
import { interpretarFolio } from '../src/ticket.ts';
import { api, appAdmin, appCajero } from './ayudas/app.ts';
import { ALMACENES, nuevoMundo, politica, porAlmacen } from './ayudas/comun.ts';

const CANDIDATOS = [process.env.POS_CHROMIUM, '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', '/opt/pw-browsers/chromium/chrome-linux/chrome'];
const chromiumPath = CANDIDATOS.find((p) => p && existsSync(p));
const sqlite = ALMACENES.find((a) => a.nombre === 'sqlite')!;
const JEANS = '0002026090782';

const vender = async (caja: any) => {
  const cart = (await api(caja.url, '/api/venta/nueva', {})).json.cart;
  await api(caja.url, '/api/venta/escanear', { cart, codigo: JEANS });
  return (await api(caja.url, '/api/venta/cobrar-efectivo', { cart, recibido: 5000000 })).json.venta;
};

it('BF0 interpretarFolio entiende el código impreso y el folio suelto', () => {
  assert.deepEqual(interpretarFolio('D2-000003'), { folio: 3, tienda: 'DUO', caja: 2 });
  assert.deepEqual(interpretarFolio(' d2000003 '), { folio: 3, tienda: 'DUO', caja: 2 });
  assert.deepEqual(interpretarFolio('L1-000120'), { folio: 120, tienda: 'LON', caja: 1 });
  assert.deepEqual(interpretarFolio('000045'), { folio: 45 });
  assert.deepEqual(interpretarFolio('7'), { folio: 7 });
  for (const mal of ['', 'abc', 'X1-000003', 'D2-', '0', 'D2-000000']) assert.equal(interpretarFolio(mal), null, mal);
});

porAlmacen('Buscar un ticket por su código (D2-000001) y avisar en qué caja se hizo', (alm) => {
  const preparar = async (t: { after(f: () => void): void }) => {
    const ctx = nuevoMundo(alm, politica());
    t.after(ctx.limpiar);
    const adm = await appAdmin(ctx); t.after(() => adm.cerrar());
    const c1 = await appCajero(ctx, 'DUO', 1, 'Ana'); t.after(() => c1.cerrar());
    const c2 = await appCajero(ctx, 'DUO', 2, 'Beto'); t.after(() => c2.cerrar());
    const v1 = await vender(c1), v2 = await vender(c2);
    ctx.m.pump(); ctx.m.pump(); ctx.m.pump();
    return { ctx, adm, c1, c2, v1, v2 };
  };

  it('BF1 el historial trae el código del ticket y la búsqueda por D2-000001 desde la Caja 1 avisa que es de la Caja 2', async (t) => {
    const { adm, c1, c2 } = await preparar(t);
    const dia = (await api(c2.url, '/api/ventas')).json.ventas;
    assert.equal(dia[0].codigo_ticket, 'D2-000001');
    assert.equal((await api(c1.url, '/api/ventas')).json.ventas[0].codigo_ticket, 'D1-000001');
    // desde la Caja 1: el código de la Caja 2 se localiza y dice en cuál caja se hizo
    const r = (await api(c1.url, '/api/ventas/buscar?folio=D2-000001')).json;
    assert.deepEqual(r.resultados.map((v: any) => [v.caja, v.codigo_ticket, v.propia]), [[2, 'D2-000001', false]]);
    // el código de la propia caja encuentra solo la propia; el folio suelto encuentra las dos
    assert.deepEqual((await api(c1.url, '/api/ventas/buscar?folio=D1-000001')).json.resultados.map((v: any) => v.propia), [true]);
    assert.equal((await api(c1.url, '/api/ventas/buscar?folio=1')).json.resultados.length, 2);
    // de la otra tienda: aviso sin datos; folio inválido: error claro
    const lon = (await api(c1.url, '/api/ventas/buscar?folio=L1-000001')).json;
    assert.deepEqual(lon.resultados, []);
    assert.match(lon.aviso, /London Love, Caja 1/);
    assert.match((await api(c1.url, '/api/ventas/buscar?folio=hola')).json.error.mensaje, /folio no es válido/);
    // Administración busca igual y muestra el código
    const h = (await api(adm.url, '/api/admin/ventas?desde=2026-10-01&hasta=2026-10-01&folio=D2-000001')).json;
    assert.deepEqual(h.ventas.map((v: any) => [v.codigo_ticket, v.caja]), [['D2-000001', 2]]);
    assert.equal((await api(adm.url, '/api/admin/ventas?desde=2026-10-01&hasta=2026-10-01&folio=1')).json.ventas.length, 2);
    assert.equal((await api(adm.url, '/api/admin/ventas?desde=2026-10-01&hasta=2026-10-01&folio=L1-000001')).json.ventas.length, 0);
  });
});

describe('[navegador real] Buscar ticket por código en el historial', { timeout: 240_000, skip: chromiumPath ? false : 'Chromium no encontrado (defina POS_CHROMIUM)' }, () => {
  it('UB1 el historial de la Caja 1 muestra D1-… y al buscar D2-000001 avisa que la venta es de la Caja 2', async (t) => {
    const browser = await chromium.launch({ executablePath: chromiumPath, args: ['--no-sandbox'] });
    const ctx = nuevoMundo(sqlite, politica());
    const adm = await appAdmin(ctx);
    const c1 = await appCajero(ctx, 'DUO', 1, 'Ana');
    const c2 = await appCajero(ctx, 'DUO', 2, 'Beto');
    t.after(async () => { await browser.close(); await adm.cerrar(); await c1.cerrar(); await c2.cerrar(); ctx.limpiar(); });
    await vender(c1); await vender(c2);
    ctx.m.pump(); ctx.m.pump(); ctx.m.pump();
    const page = await (await browser.newContext({ viewport: { width: 1366, height: 820 }, locale: 'es-MX' })).newPage();
    await page.goto(c1.url);
    await page.click('#nav button[data-vista="ventas"]');
    await page.waitForSelector('#tabla-ventas tr[data-detalle]');
    assert.match((await page.textContent('#tabla-ventas tbody'))!, /D1-000001/);
    await page.fill('#hist-folio', 'D2-000001');
    await page.click('#form-historial button[type="submit"]');
    await page.waitForSelector('#aviso-folio');
    assert.match((await page.textContent('#aviso-folio'))!, /Caja 2 \(D2-000001\)\. Realice la operación en esa caja/);
    assert.equal(await page.locator('#tabla-ventas tr[data-detalle]').count(), 0);
    // la devolución también entiende el código
    await page.fill('#hist-folio', '');
    await page.click('#form-historial button[type="submit"]');
    await page.waitForSelector('[data-cambio]');
    await page.click('[data-cambio]');
    await page.waitForSelector('#bv-folio');
    await page.fill('#bv-folio', 'D2-000001');
    await page.press('#bv-folio', 'Enter');
    await page.waitForSelector('[data-venta-ajena]');
    assert.match((await page.textContent('[data-venta-ajena]'))!, /Esta venta se hizo en la Caja 2/);
  });
});
