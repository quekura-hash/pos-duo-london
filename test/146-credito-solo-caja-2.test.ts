import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { describe, it } from 'node:test';
import { chromium } from 'playwright-core';
import { api, appAdmin, appCajero } from './ayudas/app.ts';
import { ALMACENES, nuevoMundo, politica } from './ayudas/comun.ts';

const chromiumPath = [process.env.POS_CHROMIUM, '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', '/opt/pw-browsers/chromium/chrome-linux/chrome'].find((p) => p && existsSync(p));
const sqlite = ALMACENES.find((a) => a.nombre === 'sqlite')!;

describe('Créditos de empleadas: solo se registran en la caja 2', { timeout: 120_000 }, () => {
  it('CR1 en la caja 1 el servidor lo rechaza con el aviso; en la caja 2 sigue el flujo normal (pide a la empleada)', async (t) => {
    const ctx = nuevoMundo(sqlite, politica());
    const adm = await appAdmin(ctx);
    const c1 = await appCajero(ctx, 'DUO', 1, 'Ana');
    const c2 = await appCajero(ctx, 'DUO', 2, 'Rosa');
    t.after(async () => { await adm.cerrar(); await c1.cerrar(); await c2.cerrar(); ctx.limpiar(); });
    for (const c of [c1, c2]) {
      const cart = (await api(c.url, '/api/venta/nueva', {})).json.cart;
      await api(c.url, '/api/venta/escanear', { cart, codigo: '7501234567890' });
      const r = await api(c.url, '/api/venta/cobrar-credito-empleada', { cart });
      if (c === c1) {
        assert.equal(r.json.error.codigo, 'CREDITO_SOLO_CAJA_2');
        assert.match(r.json.error.mensaje, /Los créditos solo se registran en la caja 2/);
      } else assert.equal(r.json.error.codigo, 'SIN_EMPLEADA', 'la caja 2 sí llega a pedir la empleada');
    }
  });

  it('CR2 pantalla: en la caja 1 el botón avisa y no se elige; en la caja 2 está activo y, sin empleada, abre «Venta a empleada»', { skip: chromiumPath ? false : 'Chromium no encontrado' }, async (t) => {
    const browser = await chromium.launch({ executablePath: chromiumPath, args: ['--no-sandbox'] });
    const ctx = nuevoMundo(sqlite, politica());
    const adm = await appAdmin(ctx);
    const c1 = await appCajero(ctx, 'DUO', 1, 'Ana');
    const c2 = await appCajero(ctx, 'DUO', 2, 'Rosa');
    t.after(async () => { await browser.close(); await adm.cerrar(); await c1.cerrar(); await c2.cerrar(); ctx.limpiar(); });
    for (const [c, num] of [[c1, 1], [c2, 2]] as const) {
      const page = await (await browser.newContext({ viewport: { width: 1366, height: 900 }, locale: 'es-MX' })).newPage();
      await page.goto(c.url);
      await page.waitForSelector('#scan');
      await page.fill('#scan', '7501234567890'); await page.press('#scan', 'Enter');
      await page.waitForSelector('#cuerpo tr[data-linea]');
      assert.equal(await page.isDisabled('[data-forma="credito"]'), false, `caja ${num}: el botón está activo`);
      await page.click('[data-forma="credito"]');
      if (num === 1) {
        await page.waitForFunction(() => /Los créditos solo se registran en la caja 2/.test(document.querySelector('#mensaje')?.textContent ?? ''));
        assert.equal(await page.getAttribute('[data-forma="credito"]', 'aria-pressed'), 'false', 'no queda elegido el crédito');
      } else {
        await page.waitForSelector('#dlg-empleada[open]');
      }
    }
  });
});

describe('Gasto de caja: autorizar sin segunda persona', { timeout: 120_000, skip: chromiumPath ? false : 'Chromium no encontrado' }, () => {
  it('GS1 la lista «Autoriza» trae la opción «No hay nadie más»: con la clave propia registra el gasto y queda anotado', async (t) => {
    const browser = await chromium.launch({ executablePath: chromiumPath, args: ['--no-sandbox'] });
    const ctx = nuevoMundo(sqlite, politica());
    const adm = await appAdmin(ctx);
    const caja = await appCajero(ctx, 'DUO', 1, 'Lupe');
    t.after(async () => { await browser.close(); await adm.cerrar(); await caja.cerrar(); ctx.limpiar(); });
    await api(adm.url, '/api/admin/administradores', { nombre: 'Edgardo', clave: 'clave-segura', clave_caja: '2468' });
    await api(adm.url, '/api/admin/cajeros', { nombre: 'Lupe', clave: '4321' });
    ctx.m.pump(); ctx.m.pump(); ctx.m.pump();
    await api(caja.url, '/api/login', { usuario: 'Lupe', clave: '4321' });
    const cart = (await api(caja.url, '/api/venta/nueva', {})).json.cart; // hay efectivo en el cajón para pagar el gasto
    await api(caja.url, '/api/venta/escanear', { cart, codigo: '0002026090782' });
    await api(caja.url, '/api/venta/cobrar-efectivo', { cart, recibido: 89900 });
    const page = await (await browser.newContext({ viewport: { width: 1366, height: 1100 }, locale: 'es-MX' })).newPage();
    await page.goto(caja.url);
    await page.waitForSelector('#nav');
    await page.click('#nav button[data-vista="extraordinarias"]');
    await page.waitForSelector('#form-gasto');
    const opciones = await page.$$eval('#gs-quien option', (o) => o.map((x) => x.textContent));
    assert.deepEqual(opciones, ['Edgardo (supervisor)', 'No hay nadie más: autorizo yo con mi clave']);
    await page.selectOption('#gs-quien', '__solo__');
    assert.equal(await page.isChecked('#gs-solo'), true, 'la casilla y la lista van sincronizadas');
    await page.fill('#gs-monto', '150'); await page.fill('#gs-concepto', 'Pago de limpieza'); await page.fill('#gs-recibio', 'María Pérez'); await page.fill('#gs-clave', '4321');
    await page.click('#btn-gasto');
    await page.waitForFunction(() => /registrado/.test(document.querySelector('#msg-gasto')?.textContent ?? ''));
    await page.waitForFunction(() => /sin segunda persona/.test(document.querySelector('#tabla-extraordinarias')?.textContent ?? ''));
  });
});
