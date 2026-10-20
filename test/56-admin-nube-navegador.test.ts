import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { chromium } from 'playwright-core';
import { centralLocal, como, usuario } from './ayudas/central-pglite.ts';
import { simularSupabase, URL_CENTRAL } from './ayudas/supabase-simulado.ts';
import { FILAS_REALISTAS, xlsxDeFilas } from './ayudas/inventario.ts';

const RAIZ = join(import.meta.dirname, '..');
const HTML = join(RAIZ, 'dist', 'administracion.html');
const chromiumPath = [process.env.POS_CHROMIUM, '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', '/opt/pw-browsers/chromium/chrome-linux/chrome'].find((p) => p && existsSync(p));

describe('[navegador real] Administración conectada al central (Supabase simulado con Postgres real)', { timeout: 180_000, skip: chromiumPath ? false : 'Chromium no encontrado' }, () => {
  it('B30 entrar, cargar el catálogo desde Excel, verlo desde otro equipo y respetar el rol', async (t) => {
    execFileSync(process.execPath, [join(RAIZ, 'scripts', 'construir-admin.mjs')], { stdio: 'pipe' });
    const db = await centralLocal();
    const cuentas = { 'edgardo@x.mx': await usuario(db, 'edgardo@x.mx', 'supervisor'), 'bodega@x.mx': await usuario(db, 'bodega@x.mx', 'almacenista'), 'intruso@x.mx': await usuario(db, 'intruso@x.mx') };
    const dir = mkdtempSync(join(tmpdir(), 'pos-adm-'));
    const archivo = join(dir, 'inventario_prueba.xlsx');
    writeFileSync(archivo, await xlsxDeFilas(FILAS_REALISTAS));
    const browser = await chromium.launch({ executablePath: chromiumPath, args: ['--no-sandbox'] });
    t.after(async () => { await browser.close(); rmSync(dir, { recursive: true, force: true }); });
    const errores: string[] = [];
    const abrir = async () => {
      const ctx = await browser.newContext({ viewport: { width: 1366, height: 860 }, colorScheme: 'light' });
      await simularSupabase(ctx, db, cuentas);
      const page = await ctx.newPage();
      page.on('pageerror', (e) => errores.push(String(e)));
      page.on('console', (m) => { if (m.type() === 'error' && !/status of 40[01]/.test(m.text())) errores.push(m.text()); });
      await page.goto(`file://${HTML}`);
      await page.waitForSelector('#puerta:not([hidden])');
      return page;
    };
    const entrar = async (page: import('playwright-core').Page, correo: string, clave: string) => {
      await page.evaluate(() => { (document.querySelector('#pu-proyecto') as HTMLDetailsElement).open = true; });
      await page.fill('#pu-url', URL_CENTRAL); await page.fill('#pu-llave', 'sb_publishable_prueba');
      await page.fill('#pu-correo', correo); await page.fill('#pu-clave', clave);
      await page.click('#pu-entrar');
    };

    // Entrada: contraseña mala, usuario sin acceso y supervisor.
    const mac = await abrir();
    assert.match((await mac.textContent('#version-pos'))!, /^Administración v\d+\.\d+\.\d+ · /);
    await entrar(mac, 'edgardo@x.mx', 'mala');
    await mac.waitForFunction(() => /No se pudo iniciar sesión/.test(document.querySelector('#msg-puerta')!.textContent!));
    assert.equal(await mac.isVisible('#puerta'), true);
    await entrar(mac, 'intruso@x.mx', 'buena');
    await mac.waitForFunction(() => /no tiene acceso a la Administración/.test(document.querySelector('#msg-puerta')!.textContent!));
    await entrar(mac, 'edgardo@x.mx', 'buena');
    await mac.waitForSelector('#puerta', { state: 'hidden' });
    await mac.waitForFunction(() => /edgardo@x\.mx \(supervisor\) · Sincronizado/.test(document.querySelector('#estado-nube')!.textContent!));
    const menu = await mac.$$eval('#nav button', (b) => b.map((x) => x.textContent!.trim()));
    assert.ok(menu.length >= 7, menu.join(' | '));

    // Cargar el catálogo desde Excel: pasa al central.
    await mac.setInputFiles('#archivo-inventario', archivo);
    await mac.waitForSelector('#dlg-importar[open]');
    await mac.click('#imp-cargar');
    await mac.waitForFunction(() => /Inventario cargado: inventario_prueba\.xlsx · 13 artículos/.test(document.querySelector('#estado-inv')!.textContent!));
    await mac.waitForFunction(() => /Sincronizado/.test(document.querySelector('#estado-nube')!.textContent!) && !/por subir/.test(document.querySelector('#estado-nube')!.textContent!));
    const [{ n }] = (await como(db, cuentas['edgardo@x.mx'], (q) => q(`select count(*)::int as n from pos.ops where tipo = 'item.created'`))) as { n: number }[];
    assert.ok(n >= 10, `item.created en el central: ${n}`);

    // Otro equipo (otro navegador, sin nada guardado): el almacenista descarga el catálogo y solo ve Inventario y Almacén.
    const bodega = await abrir();
    await entrar(bodega, 'bodega@x.mx', 'buena');
    await bodega.waitForSelector('#puerta', { state: 'hidden' });
    await bodega.waitForFunction(() => /bodega@x\.mx \(almacén\)/.test(document.querySelector('#estado-nube')!.textContent!));
    assert.deepEqual(await bodega.$$eval('#nav button', (b) => b.map((x) => x.textContent!.trim().toLowerCase())).then((l) => l.filter((x) => /inventario|almac|promoc|report|corte|config/.test(x)).length), 2);
    const filas = (await bodega.evaluate(async () => (await (window as unknown as { __POS_ATENDER__: (m: string, r: string, c?: unknown) => Promise<{ json: { resumen: { articulos: number } } }> }).__POS_ATENDER__('GET', '/api/admin/inventario')).json.resumen.articulos));
    assert.equal(filas, 13);

    // Cerrar sesión devuelve a la puerta de entrada.
    await bodega.click('#btn-salir');
    await bodega.waitForSelector('#puerta:not([hidden])');
    assert.deepEqual(errores, []);
  });
});
