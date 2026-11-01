import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { chromium, devices } from 'playwright-core';
import { centralLocal, usuario } from './ayudas/central-pglite.ts';
import { simularSupabase, URL_CENTRAL } from './ayudas/supabase-simulado.ts';

const RAIZ = join(import.meta.dirname, '..');
const chromiumPath = [process.env.POS_CHROMIUM, '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', '/opt/pw-browsers/chromium/chrome-linux/chrome'].find((p) => p && existsSync(p));
const { defaultBrowserType: _omitido, ...IPHONE_SE } = devices['iPhone SE']!;
void _omitido;

describe('[navegador real] feria resumida (iPhone SE) y ventas en espera sin deslizar (caja)', { timeout: 240_000, skip: chromiumPath ? false : 'Chromium no encontrado' }, () => {
  it('FE1 la feria muestra el último estado conocido de cada caja (el cierre de ayer) en una tarjeta compacta, sin movimientos', async (t) => {
    const dist = mkdtempSync(join(tmpdir(), 'londuo-admin-'));
    execFileSync(process.execPath, [join(RAIZ, 'scripts', 'construir-admin.mjs')], { stdio: 'pipe', env: { ...process.env, LONDUO_DIST: dist, LONDUO_SUPABASE_URL: URL_CENTRAL, LONDUO_SUPABASE_KEY: 'sb_publishable_prueba' } });
    const db = await centralLocal();
    const edgardo = await usuario(db, 'edgardo@x.mx', 'supervisor');
    const ayer = new Date(Date.now() - 7 * 3600_000 - 86400_000).toISOString().slice(0, 10);
    // Ayer, DÚO Caja 1: fondo contado y conteo de cierre; hoy nadie ha contado nada.
    const op = (id: string, tipo: string, payload: object) => db.query(`insert into pos.ops (op_id, tipo, tienda, caja, origen, ocurrio_en, payload) values ($1, $2, 'DUO', 1, 'caja:DUO/1', $3, $4::jsonb)`, [id, tipo, `${ayer}T16:00:00Z`, JSON.stringify(payload)]);
    await op('fondo-ayer', 'cash.fondo', { tienda: 'DUO', caja: 1, fecha: ayer, denominaciones: { '50000': 3, '20000': 4, '10000': 6, '5000': 9, '2000': 12, '1000': 3, '500': 12, '200': 15, '100': 30 } });
    await op('conteo-ayer', 'cash.conteo', { tienda: 'DUO', caja: 1, fecha: ayer, moneda: 'MXN', alcance: 'ventas', denominaciones: { '50000': 1, '20000': 0, '1000': 2 } });
    const browser = await chromium.launch({ executablePath: chromiumPath, args: ['--no-sandbox'] });
    t.after(async () => { await browser.close(); rmSync(dist, { recursive: true, force: true }); });
    const ctx = await browser.newContext({ ...IPHONE_SE, deviceScaleFactor: 2 });
    await simularSupabase(ctx, db, { 'edgardo@x.mx': edgardo });
    const page = await ctx.newPage();
    const errores: string[] = [];
    page.on('pageerror', (e) => errores.push(String(e)));
    page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource|net::/.test(m.text())) errores.push(m.text()); });
    await page.goto(`file://${join(dist, 'administracion.html')}`);
    await page.waitForSelector('#puerta:not([hidden])');
    await page.fill('#pu-correo', 'edgardo@x.mx'); await page.fill('#pu-clave', 'buena'); await page.click('#pu-entrar');
    await page.waitForSelector('#puerta', { state: 'hidden' });
    await page.waitForFunction(() => /Sincronizado/.test(document.querySelector('#estado-nube')?.textContent ?? ''));
    await page.click('#nav button[data-vista="configuracion"]');
    await page.click('button:has-text("Feria")');
    await page.waitForSelector('.fer-caja');
    assert.equal(await page.locator('.fer-caja').count(), 4, 'una tarjeta por caja');
    const duo1 = page.locator('.fer-caja[data-caja="DUO/1"]');
    assert.match((await duo1.textContent())!, /Al cierre del/, 'sin conteo de hoy, se muestra el cierre de ayer');
    assert.equal(await duo1.locator('.fer-d').count(), 9, 'los 9 billetes y monedas');
    assert.equal((await duo1.locator('.fer-d[data-den="50000"] b').textContent())!.trim(), '4', '3 del fondo + 1 contado en el cierre');
    assert.equal(await page.locator('.ver-movimientos, .movimientos-feria').count(), 0, 'sin tablas de movimientos ni «entró/salió»');
    const sinDato = page.locator('.fer-caja[data-caja="LON/2"]');
    assert.match((await sinDato.textContent())!, /Sin conteo reciente/);
    const ancho = await page.evaluate(() => ({ pagina: document.documentElement.scrollWidth, ventana: window.innerWidth }));
    assert.ok(ancho.pagina <= ancho.ventana + 1, `sin desborde horizontal en iPhone SE: ${JSON.stringify(ancho)}`);
    await page.setViewportSize({ width: 375, height: 1150 }); // alta, solo para que la captura muestre las 4 cajas juntas
    await page.evaluate(() => window.scrollTo(0, 330));
    await page.screenshot({ path: join(RAIZ, 'docs', 'capturas', 'feria-iphone-se.png') });
    assert.deepEqual(errores, []);
  });

  it('VE1 con varias ventas en espera, cada una trae su botón «Recuperar venta» a la vista, sin barra de desplazamiento lateral (ventana de la caja)', async (t) => {
    execFileSync(process.execPath, [join(RAIZ, 'scripts', 'construir-prueba.mjs')], { stdio: 'pipe' });
    const browser = await chromium.launch({ executablePath: chromiumPath, args: ['--no-sandbox'] });
    t.after(() => browser.close());
    const page = await (await browser.newContext({ viewport: { width: 1100, height: 640 }, colorScheme: 'light' })).newPage();
    const errores: string[] = [];
    page.on('pageerror', (e) => errores.push(String(e)));
    await page.goto(`file://${join(RAIZ, 'dist', 'pos-venta-prueba.html')}`);
    await page.waitForSelector('#scan');
    const guardar = async (codigo: string, nota: string, n: number) => {
      await page.fill('#scan', codigo); await page.press('#scan', 'Enter');
      await page.waitForSelector('#cuerpo tr[data-linea]');
      await page.click('#btn-espera');
      await page.fill('#esp-nota', nota);
      await page.click('#esp-guardar');
      await page.waitForFunction((k) => new RegExp(`\\(${k}\\)`).test(document.querySelector('#txt-espera')?.textContent ?? ''), n);
    };
    await guardar('0002026090782', 'Sesión de Spice Girls cerrada por inactividad', 1);
    await guardar('0002026090799', 'senora guera con un nombre bastante largo para probar', 2);
    await page.click('#btn-espera');
    await page.waitForSelector('#dlg-espera[open]');
    assert.equal(await page.locator('#dlg-espera .esp-retomar').count(), 2);
    const caja = await page.evaluate(() => { const d = document.querySelector('#dlg-espera') as HTMLElement; return { scroll: d.scrollWidth, ancho: d.clientWidth, ventana: window.innerWidth }; });
    assert.ok(caja.scroll <= caja.ancho + 1, `la ventana no se desliza de lado: ${JSON.stringify(caja)}`);
    for (const b of await page.locator('#dlg-espera .esp-retomar').all()) {
      await b.scrollIntoViewIfNeeded();
      const r = (await b.boundingBox())!;
      assert.ok(r.x >= 0 && r.x + r.width <= caja.ventana, `el botón cabe en pantalla: ${JSON.stringify(r)}`);
      assert.match((await b.textContent())!, /Recuperar venta/);
    }
    await page.screenshot({ path: join(RAIZ, 'docs', 'capturas', 'venta-en-espera-iphone-se.png') });
    await page.locator('#dlg-espera .esp-retomar').first().click();
    await page.waitForSelector('#cuerpo tr[data-linea]');
    assert.deepEqual(errores, []);
  });
});
