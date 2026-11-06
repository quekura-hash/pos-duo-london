import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { describe, it } from 'node:test';
import { chromium } from 'playwright-core';
import { api, appAdmin, appCajero } from './ayudas/app.ts';
import { ALMACENES, nuevoMundo, politica, porAlmacen } from './ayudas/comun.ts';

const chromiumPath = [process.env.POS_CHROMIUM, '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', '/opt/pw-browsers/chromium/chrome-linux/chrome'].find((p) => p && existsSync(p));

porAlmacen('Tarjetas de regalo: se pueden pagar con tarjeta bancaria (crédito o débito), no solo en efectivo', (alm) => {
  const preparar = async (t: { after(f: () => void): void }) => {
    const ctx = nuevoMundo(alm, politica());
    t.after(ctx.limpiar);
    const adm = await appAdmin(ctx); t.after(() => adm.cerrar());
    const caja = await appCajero(ctx, 'DUO', 1, 'Ana'); t.after(() => caja.cerrar());
    return { ctx, adm, caja };
  };
  const corte = async (caja: any) => (await api(caja.url, '/api/corte')).json.vivo;

  it('TR1 alta con tarjeta: pide la autorización, queda como cobro con tarjeta (no efectivo) y la emisión dice «tarjeta»', async (t) => {
    const { ctx, caja } = await preparar(t);
    const sin = await api(caja.url, '/api/tarjeta/alta', { codigo: 'GC-100', monto: 50000, pago: 'tarjeta', ref: 'r-0' });
    assert.equal(sin.json.error.codigo, 'AUTORIZACION_REQUERIDA_TARJETA', 'sin autorización no se cobra');
    const r = await api(caja.url, '/api/tarjeta/alta', { codigo: 'GC-100', monto: 50000, pago: 'tarjeta', autorizacion: '1234', ref: 'r-1' });
    assert.equal(r.status, 200, JSON.stringify(r.json));
    assert.deepEqual(r.json.venta.pagos.map((p: any) => [p.metodo, p.monto, p.autorizacion]), [['tarjeta', 50000, '1234']]);
    assert.equal(r.json.tarjeta.saldo, 50000);
    const c = await corte(caja);
    assert.deepEqual([c.cobros_efectivo, c.cobros_tarjeta, c.tarjetas_regalo_vendidas, c.ventas_mercancia], [0, 50000, 50000, 0], 'es cobro con tarjeta y no entra al efectivo del cajón');
    ctx.m.pump(); ctx.m.pump();
    const emitida = ctx.m.central.repo.ops().find((o) => o.tipo === 'giftcard.emitida' && o.payload.codigo === 'GC-100')!;
    assert.equal(emitida.payload.medio, 'tarjeta');
    // la tarjeta ya sirve para pagar
    const cart = (await api(caja.url, '/api/venta/nueva', {})).json.cart;
    await api(caja.url, '/api/venta/escanear', { cart, codigo: '7501234567890' });
    const p = await api(caja.url, '/api/venta/cobrar-regalo', { cart, codigo: 'GC-100' });
    assert.equal(p.status, 200, JSON.stringify(p.json));
  });

  it('TR2 alta en efectivo sigue igual, y la recarga también acepta tarjeta', async (t) => {
    const { ctx, caja } = await preparar(t);
    const e = await api(caja.url, '/api/tarjeta/alta', { codigo: 'GC-200', monto: 30000, ref: 'r-2' });
    assert.deepEqual(e.json.venta.pagos.map((p: any) => p.metodo), ['efectivo']);
    const rec = await api(caja.url, '/api/tarjeta/recargar', { codigo: 'GC-200', monto: 20000, pago: 'tarjeta', autorizacion: 'AB12', ref: 'r-3' });
    assert.equal(rec.status, 200, JSON.stringify(rec.json));
    assert.deepEqual(rec.json.venta.pagos.map((p: any) => [p.metodo, p.monto]), [['tarjeta', 20000]]);
    assert.equal(rec.json.tarjeta.saldo, 50000);
    const c = await corte(caja);
    assert.deepEqual([c.cobros_efectivo, c.cobros_tarjeta], [30000, 20000]);
    ctx.m.pump(); ctx.m.pump();
    assert.equal(ctx.m.central.repo.ops().find((o) => o.tipo === 'giftcard.recarga' && o.payload.codigo === 'GC-200')!.payload.medio, 'tarjeta');
    assert.equal((await api(caja.url, '/api/tarjeta/alta', { codigo: 'GC-300', monto: 1000, pago: 'cheque', ref: 'r-4' })).json.error.codigo, 'PAGO_INVALIDO');
  });
});

describe('Tarjetas de regalo: pantalla con forma de pago', { timeout: 120_000, skip: chromiumPath ? false : 'Chromium no encontrado' }, () => {
  it('TR3 «Forma de pago»: con tarjeta pide la autorización (y oculta el efectivo recibido); se vende y el ticket sale con la tarjeta', async (t) => {
    const browser = await chromium.launch({ executablePath: chromiumPath, args: ['--no-sandbox'] });
    const ctx = nuevoMundo(ALMACENES.find((a) => a.nombre === 'sqlite')!, politica());
    const adm = await appAdmin(ctx);
    const caja = await appCajero(ctx, 'DUO', 1, 'Ana');
    t.after(async () => { await browser.close(); await adm.cerrar(); await caja.cerrar(); ctx.limpiar(); });
    const page = await (await browser.newContext({ viewport: { width: 1366, height: 1000 }, locale: 'es-MX' })).newPage();
    await page.goto(caja.url);
    await page.waitForSelector('#nav');
    await page.click('#nav button[data-vista="tarjetas"]');
    await page.waitForSelector('#form-alta');
    assert.deepEqual(await page.$$eval('#alta-pago option', (o) => o.map((x) => x.textContent)), ['Efectivo', 'Tarjeta de crédito o débito']);
    assert.equal(await page.isVisible('#alta-auth'), false, 'en efectivo no se pide la autorización');
    await page.selectOption('#alta-pago', 'tarjeta');
    assert.equal(await page.isVisible('#alta-auth'), true);
    assert.equal(await page.isVisible('#alta-recibido'), false, 'con tarjeta no se pide el efectivo recibido');
    await page.fill('#alta-codigo', 'GC-900'); await page.fill('#alta-monto', '500');
    await page.click('#btn-alta');
    await page.waitForFunction(() => /últimos 4/.test(document.querySelector('#msg-alta')?.textContent ?? ''));
    await page.fill('#alta-auth', '4321');
    await page.click('#btn-alta');
    await page.waitForSelector('dialog[open]');
    const tarjeta = (await api(caja.url, '/api/tarjetas')).json.tarjetas[0];
    assert.equal(tarjeta.codigo, 'GC-900');
    const c = (await api(caja.url, '/api/corte')).json.vivo;
    assert.deepEqual([c.cobros_efectivo, c.cobros_tarjeta], [0, 50000]);
  });
});
