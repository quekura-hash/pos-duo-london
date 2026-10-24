import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { describe, it } from 'node:test';
import { chromium } from 'playwright-core';
import { api, appAdmin } from './ayudas/app.ts';
import { ALMACENES, nuevoMundo, politica } from './ayudas/comun.ts';

const chromiumPath = [process.env.POS_CHROMIUM, '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', '/opt/pw-browsers/chromium/chrome-linux/chrome'].find((p) => p && existsSync(p));
const sqlite = ALMACENES.find((a) => a.nombre === 'sqlite')!;

describe('[navegador real] Personal: una sola lista de perfiles y sus pestañas', { timeout: 180_000, skip: chromiumPath ? false : 'Chromium no encontrado' }, () => {
  it('PE1 Perfiles junta supervisores, almacenistas y Vendedoras-Cajeras en una lista con filtro; Descuento y crédito, Nómina y Horarios son pestañas; Configuración ya no trae Usuarios', async (t) => {
    const browser = await chromium.launch({ executablePath: chromiumPath, args: ['--no-sandbox'] });
    const ctx = nuevoMundo(sqlite, politica());
    const adm = await appAdmin(ctx);
    t.after(async () => { await browser.close(); await adm.cerrar(); ctx.limpiar(); });
    assert.equal((await api(adm.url, '/api/admin/administradores', { nombre: 'Edgardo', clave: 'clave-segura', clave_caja: '2468' })).status, 200);
    assert.equal((await api(adm.url, '/api/admin/administradores', { nombre: 'Mario', clave: 'clave-mario', rol: 'almacenista', clave_caja: '9753' })).status, 200);
    assert.equal((await api(adm.url, '/api/admin/cajeros', { nombre: 'Lupe', clave: '4321' })).status, 200);
    assert.equal((await api(adm.url, '/api/admin/supervisores', { nombre: 'Evelin', clave: '1357' })).status, 200);
    const page = await (await browser.newContext({ viewport: { width: 1366, height: 800 } })).newPage();
    const errores: string[] = [];
    page.on('pageerror', (e) => errores.push(String(e)));
    await page.goto(adm.url);
    await page.waitForSelector('#nav');
    // el menú se llama Personal y Configuración ya no tiene «Usuarios»
    assert.ok((await page.$$eval('#nav button', (b) => b.map((x) => x.textContent))).includes('Personal'));
    await page.click('#nav button[data-vista="configuracion"]');
    await page.waitForSelector('#cfg-tab-tiendas');
    assert.deepEqual(await page.$$eval('[role="tab"]', (b) => b.map((x) => x.textContent)), ['Tiendas', 'Departamentos', 'Tipo de cambio', 'Cajas']);
    await page.click('#cfg-tab-cajas');
    await page.waitForSelector('#form-inactividad');
    // Personal: cuatro pestañas y Perfiles por omisión
    await page.click('#nav button[data-vista="empleadas"]');
    await page.waitForSelector('#tabla-personal');
    assert.deepEqual(await page.$$eval('[role="tab"]', (b) => b.map((x) => x.textContent)), ['Perfiles', 'Descuento y crédito', 'Nómina', 'Horarios']);
    const filas = async () => page.$$eval('#tabla-personal tbody tr[data-rol]', (r) => r.filter((x) => !(x as HTMLElement).hidden).map((x) => `${x.querySelector('td:nth-child(1) b')?.textContent}|${x.querySelector('td:nth-child(2)')?.textContent}`));
    assert.deepEqual((await filas()).sort(), ['Edgardo|Supervisor', 'Evelin|Supervisor', 'Lupe|Vendedora-Cajera', 'Mario|Almacenista']);
    await page.selectOption('#per-filtro', 'cajero');
    assert.deepEqual(await filas(), ['Lupe|Vendedora-Cajera']);
    await page.selectOption('#per-filtro', 'supervisor');
    assert.deepEqual((await filas()).sort(), ['Edgardo|Supervisor', 'Evelin|Supervisor']);
    await page.selectOption('#per-filtro', '');
    // la supervisora de caja puede cambiar su clave desde aquí
    await page.fill('#tabla-personal tr[data-sup] .s-clave', '2222');
    await page.click('#tabla-personal tr[data-sup] .s-guardar');
    await page.waitForFunction(() => /Clave cambiada/.test(document.querySelector('#msg-admins')!.textContent!));
    // las otras pestañas
    await page.click('#per-tab-descuento');
    await page.waitForSelector('#form-emp-config');
    await page.click('#per-tab-nomina');
    await page.waitForSelector('#form-nomina');
    await page.click('#per-tab-horarios');
    assert.match((await page.textContent('#personal-cuerpo'))!, /En desarrollo/);
    // Promociones ya no administra supervisores
    await page.click('#nav button[data-vista="promociones"]');
    await page.waitForSelector('#tabla-promos');
    assert.equal(await page.locator('#form-sup').count(), 0);
    assert.deepEqual(errores, []);
  });
});
