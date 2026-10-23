import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { describe, it } from 'node:test';
import { chromium } from 'playwright-core';
import { api, appAdmin, appCajero } from './ayudas/app.ts';
import { ALMACENES, nuevoMundo, politica } from './ayudas/comun.ts';

const CANDIDATOS = [process.env.POS_CHROMIUM, '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', '/opt/pw-browsers/chromium/chrome-linux/chrome'];
const chromiumPath = CANDIDATOS.find((p) => p && existsSync(p));
const sqlite = ALMACENES.find((a) => a.nombre === 'sqlite')!;

/** «Sales Detail» del POS anterior (datos inventados): columnas B, D, F, J, L y N. */
const fila = (fecha: string, folio: number, tipo: string, piezas: number, total: number, pago: string) => [null, fecha, null, folio, null, tipo, null, null, null, piezas, null, total, null, pago, null, null];
const HOJA: unknown[][] = [
  [null, '2026-09-30T00:00:00.000Z'], [], [], [], [], [null, 'Date', null, 'Receipt #', null, 'Receipt Type', null, 'Full Name', null, 'Qty Sold', null, 'Total', null, 'Payment', null, null],
  fila('13/09/2026', 1001, 'Sales', 2, 899, 'Cash'), fila('13/09/2026', 1002, 'Sales', 1, 549, 'Credit Card'), fila('14/09/2026', 1003, 'Sales', 0, 0, 'None'),
];

async function escenario(t: { after(f: () => void | Promise<void>): void }) {
  const ctx = nuevoMundo(sqlite, politica());
  const adm = await appAdmin(ctx);
  const caja = await appCajero(ctx, 'DUO', 1, 'Ana');
  t.after(async () => { await adm.cerrar(); await caja.cerrar(); ctx.limpiar(); });
  const imp = await api(adm.url, '/api/admin/ventas-historicas/importar', { filas: HOJA, tienda: 'DUO', caja: 1, nombre: 'prueba.xlsx' });
  assert.equal(imp.status, 200, JSON.stringify(imp.json));
  // y una venta nueva con el folio 1 (para ver que no se confunde con el folio 1001 del POS anterior)
  const cart = (await api(caja.url, '/api/venta/nueva', {})).json.cart;
  await api(caja.url, '/api/venta/escanear', { cart, codigo: '0002026090782' });
  await api(caja.url, '/api/venta/cobrar-efectivo', { cart, recibido: 100000 });
  ctx.m.pump(); ctx.m.pump(); ctx.m.pump();
  return { ctx, adm };
}

it('HP1 el Historial muestra también las ventas del POS anterior, marcadas; se buscan por folio y el código D1-… solo busca en el POS nuevo', async (t) => {
  const { adm } = await escenario(t);
  const todas = (await api(adm.url, '/api/admin/ventas?desde=2026-09-01&hasta=2026-10-31')).json.ventas;
  assert.deepEqual(todas.filter((v: any) => v.historico).map((v: any) => [v.folio, v.total, v.pago, v.codigo_ticket]).sort(), [[1001, 89900, 'Efectivo', null], [1002, 54900, 'Tarjeta', null], [1003, 0, 'Sin pago', null]].sort());
  assert.equal(todas.filter((v: any) => !v.historico).length, 1);
  // origen
  const ant = (await api(adm.url, '/api/admin/ventas?desde=2026-09-01&hasta=2026-10-31&origen=anterior')).json.ventas;
  assert.deepEqual([ant.length, ant.every((v: any) => v.historico)], [3, true]);
  const nuevo = (await api(adm.url, '/api/admin/ventas?desde=2026-09-01&hasta=2026-10-31&origen=nuevo')).json.ventas;
  assert.deepEqual([nuevo.length, nuevo.every((v: any) => !v.historico)], [1, true]);
  // folio suelto: busca en los dos; el código del POS nuevo, solo en el nuevo
  const f1001 = (await api(adm.url, '/api/admin/ventas?desde=2026-09-01&hasta=2026-10-31&folio=1001')).json.ventas;
  assert.deepEqual(f1001.map((v: any) => [v.folio, v.historico]), [[1001, true]]);
  const f1 = (await api(adm.url, '/api/admin/ventas?desde=2026-09-01&hasta=2026-10-31&folio=1')).json.ventas;
  assert.deepEqual(f1.map((v: any) => [v.folio, v.historico]), [[1, false]]);
  const codigo = (await api(adm.url, '/api/admin/ventas?desde=2026-09-01&hasta=2026-10-31&folio=D1-001001')).json.ventas;
  assert.deepEqual(codigo, [], 'D1-001001 no es el folio 1001 del POS anterior');
  // detalle de una venta del POS anterior
  const d = (await api(adm.url, `/api/admin/venta?sale_id=${encodeURIComponent('hist:DUO/1:1001')}`)).json;
  assert.deepEqual([d.detalle.folio, d.detalle.total, d.detalle.fecha_local, d.detalle.historica.piezas, d.detalle.historica.pago, d.detalle.lineas.length, d.ticket_texto], [1001, 89900, '2026-09-13', 2, 'efectivo', 0, '']);
  assert.equal((await api(adm.url, '/api/admin/venta?sale_id=hist:DUO/1:9999')).status >= 400, true);
});

describe('[navegador real] Historial con ventas del POS anterior', { timeout: 240_000, skip: chromiumPath ? false : 'Chromium no encontrado (defina POS_CHROMIUM)' }, () => {
  it('HP2 se ven en la lista con la marca «POS anterior» y su detalle explica qué se conserva', async (t) => {
    const browser = await chromium.launch({ executablePath: chromiumPath, args: ['--no-sandbox'] });
    t.after(() => browser.close());
    const { adm } = await escenario(t);
    const page = await (await browser.newContext({ viewport: { width: 1366, height: 900 }, locale: 'es-MX' })).newPage();
    await page.goto(adm.url);
    await page.waitForSelector('#nav');
    await page.click('#nav button[data-vista="historial"]');
    await page.waitForSelector('#ha-filtros');
    await page.fill('#ha-desde', '2026-09-01'); await page.fill('#ha-hasta', '2026-10-31');
    await page.fill('#ha-folio', '1001');
    await page.click('#ha-filtros button[type="submit"]');
    await page.waitForSelector('#tabla-historial-admin tr[data-detalle]');
    assert.match((await page.textContent('#tabla-historial-admin tbody'))!, /1001[\s\S]*POS anterior[\s\S]*\$899\.00/);
    await page.click('#tabla-historial-admin tr[data-detalle] td:first-child');
    await page.waitForSelector('#dlg-detalle-venta[open] #dv-historica');
    assert.match((await page.textContent('#dv-titulo'))!, /POS anterior · folio 1001/);
    assert.match((await page.textContent('#dv-datos'))!, /Total\s*\$899\.00[\s\S]*Piezas\s*2[\s\S]*Efectivo/);
    assert.match((await page.textContent('#dv-historica'))!, /solo se conserva/);
  });
});
