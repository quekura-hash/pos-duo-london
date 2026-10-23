import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { describe, it } from 'node:test';
import { chromium } from 'playwright-core';
import { api, appAdmin, appCajero } from './ayudas/app.ts';
import { ALMACENES, nuevoMundo, politica } from './ayudas/comun.ts';

const CANDIDATOS = [process.env.POS_CHROMIUM, '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', '/opt/pw-browsers/chromium/chrome-linux/chrome'];
const chromiumPath = CANDIDATOS.find((p) => p && existsSync(p));
const sqlite = ALMACENES.find((a) => a.nombre === 'sqlite')!;
const JEANS = '0002026090782', MASCADA = '7501234567890', BOLSA = '0000000000017';

async function escenario(t: { after(f: () => void | Promise<void>): void }) {
  const ctx = nuevoMundo(sqlite, politica());
  const adm = await appAdmin(ctx);
  const duo = await appCajero(ctx, 'DUO', 1, 'Ana');
  const lon = await appCajero(ctx, 'LON', 1, 'Luis');
  t.after(async () => { await adm.cerrar(); await duo.cerrar(); await lon.cerrar(); ctx.limpiar(); });
  await api(adm.url, '/api/admin/administradores', { nombre: 'Edgardo', clave: 'clave-segura', clave_caja: '2468' });
  await api(adm.url, '/api/admin/cajeros', { nombre: 'Lupe', clave: '4321' });
  ctx.m.pump(); ctx.m.pump(); ctx.m.pump();
  await api(duo.url, '/api/login', { usuario: 'Lupe', clave: '4321' });
  await api(lon.url, '/api/login', { usuario: 'Lupe', clave: '4321' });
  const vender = async (caja: any, codigo: string, tarjeta = false) => {
    const cart = (await api(caja.url, '/api/venta/nueva', {})).json.cart;
    await api(caja.url, '/api/venta/escanear', { cart, codigo });
    const r = tarjeta ? await api(caja.url, '/api/venta/cobrar-tarjeta', { cart, autorizacion: 'A12345', marca: 'visa', ultimos4: '4242' }) : await api(caja.url, '/api/venta/cobrar-efectivo', { cart, recibido: 5000000 });
    assert.equal(r.status, 200, JSON.stringify(r.json));
    return r.json.venta;
  };
  // DÚO: jeans $899 (efectivo) y mascada $120 (tarjeta), y la mascada se cambia por una bolsa de $450 (paga $330)
  await vender(duo, JEANS);
  const masc = await vender(duo, MASCADA, true);
  const cart = (await api(duo.url, '/api/venta/nueva', {})).json.cart;
  await api(duo.url, '/api/venta/cambio/iniciar', { cart, sale_id: masc.sale_id, renglones: [{ linea_id: masc.lineas[0].linea_id, qty: 1 }], clienta: { nombre: 'Ana López', telefono: '6531234567' }, motivo: 'no le quedó' });
  await api(duo.url, '/api/venta/escanear', { cart, codigo: BOLSA });
  assert.equal((await api(duo.url, '/api/venta/cobrar-efectivo', { cart, recibido: 33000 })).status, 200);
  // London: una bolsa de $450 en efectivo que se devuelve en efectivo
  const bolsa = await vender(lon, BOLSA);
  const d = await api(lon.url, '/api/venta/devolver', { sale_id: bolsa.sale_id, renglones: [{ linea_id: bolsa.lineas[0].linea_id, qty: 1 }], motivo: 'defecto', autoriza: { nombre: 'Edgardo', clave: '2468' } });
  assert.equal(d.status, 200, JSON.stringify(d.json));
  ctx.m.pump(); ctx.m.pump(); ctx.m.pump();
  return { ctx, adm };
}

it('RD1 el resumen del día junta las dos tiendas: venta total, efectivo, tarjeta, cambios y devoluciones, ventas netas', async (t) => {
  const { adm } = await escenario(t);
  const r = (await api(adm.url, '/api/admin/resumen-dia?fecha=2026-10-01')).json;
  const duo = r.tiendas.find((x: any) => x.tienda === 'DUO'), lon = r.tiendas.find((x: any) => x.tienda === 'LON');
  assert.deepEqual([duo.tickets, duo.venta_total, duo.efectivo, duo.tarjeta, duo.mercancia_recibida_por_cambio, duo.devoluciones_con_reembolso, duo.ventas_netas], [3, 146900, 122900, 12000, 12000, 0, 134900]);
  assert.deepEqual([lon.tickets, lon.venta_total, lon.efectivo, lon.devoluciones_con_reembolso, lon.ventas_netas], [1, 45000, 45000, 45000, 0]);
  assert.deepEqual([r.total.tickets, r.total.venta_total, r.total.efectivo, r.total.pesos, r.total.tarjeta, r.total.mercancia_recibida_por_cambio, r.total.devoluciones_con_reembolso, r.total.ventas_netas], [4, 191900, 167900, 167900, 12000, 12000, 45000, 134900]);
  // otro día: en ceros
  const otro = (await api(adm.url, '/api/admin/resumen-dia?fecha=2026-09-30')).json;
  assert.deepEqual([otro.total.tickets, otro.total.venta_total, otro.total.ventas_netas], [0, 0, 0]);
});

describe('[navegador real] Resumen del día en Reportes', { timeout: 240_000, skip: chromiumPath ? false : 'Chromium no encontrado (defina POS_CHROMIUM)' }, () => {
  it('RD2 Reportes abre con el resumen del día de las dos tiendas, con la venta total sobresaliendo', async (t) => {
    const browser = await chromium.launch({ executablePath: chromiumPath, args: ['--no-sandbox'] });
    t.after(() => browser.close());
    const { adm } = await escenario(t);
    const page = await (await browser.newContext({ viewport: { width: 1366, height: 1000 } })).newPage();
    await page.goto(adm.url);
    await page.waitForSelector('#nav');
    await page.click('#nav button[data-vista="reportes"]');
    await page.waitForSelector('#rd-total');
    // el servidor de prueba corre «hoy» en 2026-10-01
    await page.fill('#rd-fecha', '2026-10-01');
    await page.waitForFunction(() => document.querySelector('#rd-total')!.textContent === '$1,919.00');
    assert.match((await page.textContent('#rd-venta-total'))!, /VENTA TOTAL DEL DÍA · 01\/10\/2026[\s\S]*4 tickets/);
    assert.equal(await page.textContent('#rd-efectivo'), '$1,679.00');
    assert.equal(await page.textContent('#rd-tarjeta'), '$120.00');
    assert.equal((await page.textContent('#rd-netas'))!.trim(), '$1,349.00');
    assert.match((await page.textContent('#rd-tiendas [data-tienda="LON"]'))!, /\$450\.00[\s\S]*1 ticket/);
    const g = await page.locator('#rd-venta-total .kpi-valor').evaluate((e) => parseFloat(getComputedStyle(e).fontSize));
    assert.ok(g >= 32, 'la venta total del día sobresale');
  });
});
