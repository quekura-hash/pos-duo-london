import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { describe, it } from 'node:test';
import { chromium, type Browser, type Page } from 'playwright-core';
import { api, appAdmin, appCajero } from './ayudas/app.ts';
import { ALMACENES, nuevoMundo, politica } from './ayudas/comun.ts';

const CANDIDATOS = [process.env.POS_CHROMIUM, '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', '/opt/pw-browsers/chromium/chrome-linux/chrome'];
const chromiumPath = CANDIDATOS.find((p) => p && existsSync(p));
const sqlite = ALMACENES.find((a) => a.nombre === 'sqlite')!;

async function pagina(browser: Browser, url: string, ancho = 1366, alto = 900): Promise<{ page: Page; errores: string[] }> {
  const ctx = await browser.newContext({ viewport: { width: ancho, height: alto }, colorScheme: 'light', locale: 'es-MX' });
  const page = await ctx.newPage();
  const errores: string[] = [];
  page.on('pageerror', (e) => errores.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error') errores.push(m.text()); });
  await page.goto(url);
  return { page, errores };
}

describe('[navegador real] Cierre de caja guiado por pasos', { timeout: 240_000, skip: chromiumPath ? false : 'Chromium no encontrado (defina POS_CHROMIUM)' }, () => {
  it('UC1 el asistente guía fondo → ventas → cierre: confirmación exacta, nota si no coincide, diferencias visibles, CERRAR CORTE solo al final y con clave', async (t) => {
    const browser = await chromium.launch({ executablePath: chromiumPath, args: ['--no-sandbox'] });
    const ctx = nuevoMundo(sqlite, politica());
    const adm = await appAdmin(ctx);
    const caja = await appCajero(ctx, 'DUO', 1, 'Ana');
    t.after(async () => { await browser.close(); await adm.cerrar(); await caja.cerrar(); ctx.limpiar(); });
    await api(adm.url, '/api/admin/administradores', { nombre: 'Edgardo', clave: 'clave-segura', clave_caja: '2468' });
    await api(adm.url, '/api/admin/cajeros', { nombre: 'Lupe', clave: '4321' });
    ctx.m.pump(); ctx.m.pump(); ctx.m.pump();
    await api(caja.url, '/api/login', { usuario: 'Lupe', clave: '4321' });
    const cart = (await api(caja.url, '/api/venta/nueva', {})).json.cart;
    await api(caja.url, '/api/venta/escanear', { cart, codigo: '0002026090782' });
    await api(caja.url, '/api/venta/cobrar-efectivo', { cart, recibido: 89900 });

    const { page, errores } = await pagina(browser, caja.url);
    await page.click('#nav button[data-vista="corte"]');
    await page.waitForSelector('#paso-fondo');
    // paso 1: lo que no se ve todavía
    assert.equal(await page.locator('#btn-cerrar-corte').count(), 0, 'CERRAR CORTE no aparece hasta terminar los conteos');
    assert.equal(await page.locator('#tabla-corte').count(), 0);
    assert.equal(await page.locator('#form-movimiento').count(), 0, 'el registro de movimientos salió del flujo de cierre');
    assert.equal(await page.isDisabled('[data-paso="2"]'), true, 'no se puede saltar al paso 2');
    assert.equal(await page.isDisabled('[data-paso="3"]'), true);
    assert.match((await page.textContent('#fondo-autorizado'))!, /\$5,000\.00/);
    assert.equal(await page.locator('[data-fondo="m50"]').count(), 0, 'sin la moneda de 50 centavos');
    // faltante: 4 billetes de $1,000 → faltan $1,000, hay que registrar el faltante con una nota
    await page.fill('[data-fondo="b100000"]', '4');
    assert.match((await page.textContent('#fondo-dif-txt'))!, /Faltan \$1,000\.00/);
    assert.match((await page.textContent('#fondo-estado'))!, /Fondo incompleto/);
    await page.click('#btn-fondo');
    await page.waitForFunction(() => /nota/i.test(document.querySelector('#msg-fondo')!.textContent!));
    // sobrante y luego exacto: «FONDO COMPLETO» solo con $5,000
    await page.fill('[data-fondo="b100000"]', '6');
    assert.match((await page.textContent('#fondo-dif-txt'))!, /Sobran \$1,000\.00/);
    await page.fill('[data-fondo="b100000"]', '4');
    await page.fill('[data-fondo="b50000"]', '2');
    assert.equal((await page.textContent('#fondo-estado'))!.trim(), 'FONDO COMPLETO');
    assert.equal(await page.isHidden('#fondo-nota-campo'), true);
    await page.click('#btn-fondo');
    // paso 2: el fondo ya está separado; se cuenta solo el efectivo de ventas
    await page.waitForSelector('#paso-ventas');
    assert.match((await page.textContent('#fondo-confirmado'))!, /\$5,000\.00/);
    assert.equal(await page.locator('#panel-usd').count(), 0, 'sin dólares no se muestra su conteo');
    assert.match((await page.textContent('#venta-esperado'))!, /\$899\.00/);
    await page.fill('[data-venta="b50000"]', '1');
    await page.fill('[data-venta="b20000"]', '1');
    await page.fill('[data-venta="b10000"]', '1');
    await page.fill('[data-venta="b5000"]', '1');
    await page.fill('[data-venta="m500"]', '1');
    await page.fill('[data-venta="m200"]', '2');
    assert.equal(await page.textContent('#venta-total-mxn'), '$859.00');
    assert.equal(await page.textContent('#venta-dif'), '-$40.00');
    assert.match((await page.textContent('#venta-estado'))!, /Faltante de \$40\.00/);
    await page.click('#btn-conteo');
    // paso 3: resumen con el faltante registrado, sin corregirlo; cierre con clave
    await page.waitForSelector('#paso-cierre');
    assert.match((await page.textContent('#rc-dif-mxn'))!, /-\$40\.00[\s\S]*Faltante/);
    assert.match((await page.textContent('#rc-fondo-confirmado'))!, /\$5,000\.00 \(completo\)/);
    assert.equal(await page.textContent('#rc-esperado'), '$899.00');
    assert.equal(await page.textContent('#rc-tarjeta'), '$0.00');
    await page.fill('#cierre-obs', 'Faltante de $40 por pago de barrendero.');
    await page.click('#btn-cerrar-corte');
    await page.waitForFunction(() => /clave/i.test(document.querySelector('#msg-cierre')!.textContent!) || document.querySelector('#corte-cerrado'));
    await page.fill('#cierre-clave', '0000');
    await page.click('#btn-cerrar-corte');
    await page.waitForFunction(() => /clave/i.test(document.querySelector('#msg-cierre')!.textContent!));
    await page.fill('#cierre-clave', '4321');
    await page.click('#btn-cerrar-corte');
    await page.waitForSelector('#corte-cerrado');
    assert.match((await page.textContent('#corte-cerrado'))!, /Corte cerrado por Lupe/);
    assert.equal(await page.locator('#btn-cerrar-corte').count(), 0);
    assert.match((await page.textContent('#estado-impresion-cierre'))!, /ticket de cierre se envió a la impresora/);
    await page.click('#btn-reimprimir-cierre');
    await page.waitForFunction(() => /Reimpresión 1 enviada/.test(document.querySelector('#estado-impresion-cierre')!.textContent!));
    const cierre = (await api(caja.url, '/api/corte')).json.cerrado;
    assert.deepEqual([cierre.diferencia_mxn, cierre.observaciones, cierre.fondo_confirmado], [-4000, 'Faltante de $40 por pago de barrendero.', 500000]);
    assert.deepEqual(errores.filter((e) => !/401|403|Failed to load resource/.test(e)), []);
  });

  it('UC2 operaciones extraordinarias en la caja (entrada con clave de supervisor) y Configuración › Cajas en Administración (fondo y ajustes con motivo)', async (t) => {
    const browser = await chromium.launch({ executablePath: chromiumPath, args: ['--no-sandbox'] });
    const ctx = nuevoMundo(sqlite, politica());
    const adm = await appAdmin(ctx);
    const caja = await appCajero(ctx, 'DUO', 1, 'Ana');
    t.after(async () => { await browser.close(); await adm.cerrar(); await caja.cerrar(); ctx.limpiar(); });
    await api(adm.url, '/api/admin/administradores', { nombre: 'Edgardo', clave: 'clave-segura', clave_caja: '2468' });
    await api(adm.url, '/api/admin/cajeros', { nombre: 'Lupe', clave: '4321' });
    ctx.m.pump(); ctx.m.pump(); ctx.m.pump();
    await api(caja.url, '/api/login', { usuario: 'Lupe', clave: '4321' });

    const { page, errores } = await pagina(browser, caja.url);
    await page.click('#nav button[data-vista="extraordinarias"]');
    await page.waitForSelector('#form-entrada');
    await page.fill('#ent-monto', '300');
    await page.fill('#ent-motivo', 'cambio de la tienda de junto');
    await page.click('#btn-entrada');
    await page.waitForFunction(() => /supervisor/i.test(document.querySelector('#msg-ent')!.textContent!));
    await page.fill('#ent-clave', '2468');
    await page.click('#btn-entrada');
    await page.waitForFunction(() => /Entrada registrada/.test(document.querySelector('#msg-ent')!.textContent!));
    assert.match((await page.textContent('#tabla-extraordinarias'))!, /Entrada de efectivo[\s\S]*\$300\.00[\s\S]*cambio de la tienda de junto[\s\S]*Edgardo/);

    // Administración: fondo de la caja y entrega
    const a = (await pagina(browser, adm.url, 1440, 900)).page;
    await a.waitForSelector('#nav');
    await a.click('#nav button[data-vista="configuracion"]');
    await a.click('#cfg-tab-cajas');
    await a.waitForSelector('#tabla-cajas-fondo tr[data-caja="DUO/1"]');
    assert.match((await a.textContent('#tabla-cajas-fondo tr[data-caja="DUO/1"] [data-col="fondo"]'))!, /\$5,000\.00.*por defecto/);
    await a.click('#tabla-cajas-fondo tr[data-caja="DUO/1"] .cf-fondo');
    await a.fill('#cf-monto', '6000');
    await a.fill('#cf-motivo', 'temporada alta');
    await a.click('#form-cf button[type="submit"]');
    await a.waitForFunction(() => /\$6,000\.00/.test(document.querySelector('#tabla-cajas-fondo tr[data-caja="DUO/1"] [data-col="fondo"]')?.textContent ?? ''));
    assert.match((await a.textContent('#tabla-cajas-fondo tr[data-caja="DUO/1"]'))!, /temporada alta/);
    await a.click('#tabla-cajas-fondo tr[data-caja="DUO/1"] .cf-ajuste');
    await a.fill('#cf-monto', '1000');
    await a.fill('#cf-motivo', 'entrega de cambio');
    await a.click('#form-cf button[type="submit"]');
    await a.waitForSelector('#tabla-ajustes tbody tr td:has-text("entrega de cambio")');
    ctx.m.pump(); ctx.m.pump(); ctx.m.pump();
    // la caja recibe el nuevo fondo autorizado y la entrega
    await page.click('#nav button[data-vista="corte"]');
    await page.waitForSelector('#paso-fondo');
    assert.match((await page.textContent('#fondo-autorizado'))!, /\$6,000\.00/);
    const v = (await api(caja.url, '/api/corte')).json.vivo;
    assert.deepEqual([v.entradas, v.ajustes_admin, v.efectivo_esperado], [30000, 100000, 130000]);
    assert.deepEqual(errores.filter((e) => !/401|403|Failed to load resource/.test(e)), []);
  });
});
