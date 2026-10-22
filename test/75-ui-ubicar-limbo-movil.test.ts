import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { chromium, devices } from 'playwright-core';
import { centralLocal, usuario } from './ayudas/central-pglite.ts';
import { simularSupabase, URL_CENTRAL } from './ayudas/supabase-simulado.ts';

const RAIZ = join(import.meta.dirname, '..');
const DIST = mkdtempSync(join(tmpdir(), 'londuo-admin-'));
const HTML = join(DIST, 'administracion.html');
const chromiumPath = [process.env.POS_CHROMIUM, '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', '/opt/pw-browsers/chromium/chrome-linux/chrome'].find((p) => p && existsSync(p));
const { defaultBrowserType: _omitido, ...IPHONE } = devices['iPhone 13']!;
void _omitido;

const esperarTexto = async (page: import('playwright-core').Page, selector: string, re: RegExp) => {
  try { await page.waitForFunction(([s, r]) => new RegExp(r).test(document.querySelector(s as string)?.textContent ?? ''), [selector, re.source], { timeout: 10000 }); }
  catch { throw new Error(`${selector} no dijo ${re}; decía: «${await page.textContent(selector).catch(() => '(no existe)')}»`); }
};

describe('[iPhone] Inventario: seleccionar y ubicar piezas de El Limbo', { timeout: 180_000, skip: chromiumPath ? false : 'Chromium no encontrado' }, () => {
  it('UM1 se marca tocando la fila, la barra de acciones se ve sobre el menú inferior y el diálogo cabe en la pantalla', async (t) => {
    execFileSync(process.execPath, [join(RAIZ, 'scripts', 'construir-admin.mjs')], { stdio: 'pipe', env: { ...process.env, LONDUO_DIST: DIST, LONDUO_SUPABASE_URL: URL_CENTRAL, LONDUO_SUPABASE_KEY: 'sb_publishable_prueba' } });
    const db = await centralLocal();
    const edgardo = await usuario(db, 'edgardo@x.mx', 'supervisor');
    // 8 camisas viejas (sin lote) con 2 piezas en El Limbo cada una y 2 con lote 202610 (para que filtrar cambie la lista)
    for (let n = 1; n <= 10; n++) {
      const art = { item_id: `v${n}`, codigo: `99${n}`, item_no: String(3000 + n), marca: 'TM', descripcion: `CAMISA ${n}`, estilo: '123L', lote: n <= 8 ? '' : '202610', departamento: 'CABALLERO', precio: 25000, origen: 'migracion' };
      await db.query(`insert into pos.ops (op_id, tipo, tienda, caja, origen, ocurrio_en, payload) values ($1, 'item.created', null, null, 'migracion', '2026-10-01T15:00:00Z', $2::jsonb)`, [`item:v${n}`, JSON.stringify(art)]);
      await db.query(`insert into pos.ops (op_id, tipo, tienda, caja, origen, ocurrio_en, payload) values ($1, 'inv.movement', 'LIMBO', null, 'importacion:t', '2026-10-01T15:00:00Z', $2::jsonb)`, [`mov:limbo:v${n}`, JSON.stringify({ item_id: `v${n}`, tienda: 'LIMBO', delta: n <= 8 ? 2 : 5, tipo: 'limbo_inicial', doc: 'importacion:t' })]);
    }
    const browser = await chromium.launch({ executablePath: chromiumPath, args: ['--no-sandbox'] });
    t.after(() => browser.close());
    const ctx = await browser.newContext({ ...IPHONE, deviceScaleFactor: 2 });
    await simularSupabase(ctx, db, { 'edgardo@x.mx': edgardo });
    const page = await ctx.newPage();
    const errores: string[] = [];
    page.on('pageerror', (e) => errores.push(String(e)));
    page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource|net::/.test(m.text())) errores.push(m.text()); });
    await page.goto(`file://${HTML}`);
    await page.waitForSelector('#puerta:not([hidden])');
    await page.fill('#pu-correo', 'edgardo@x.mx'); await page.fill('#pu-clave', 'buena'); await page.click('#pu-entrar');
    await page.waitForSelector('#puerta', { state: 'hidden' });
    await page.waitForSelector('#nav button');
    await page.click('#nav button[data-vista="inventario"]');
    await page.waitForSelector('#inv-q');
    await page.fill('#inv-q', 'lote=0');
    await esperarTexto(page, '#inv-pag-info', /de 8\b/);
    assert.equal(await page.locator('#lista-inv .fila-inv').count(), 8, 'Lote=0 muestra los 8 sin lote');

    await page.tap('#inv-sel-modo');
    await page.waitForSelector('#inv-sel:not([hidden])');
    await page.tap('#lista-inv .fila-inv[data-item="v1"]');
    await page.tap('#lista-inv .fila-inv[data-item="v2"]');
    assert.equal(await page.textContent('#sel-n'), '2');
    assert.equal(await page.locator('#lista-inv .fila-inv.sel').count(), 2);
    assert.equal(await page.locator('#dlg-articulo[open]').count(), 0, 'en selección no se abre el artículo');
    await page.tap('#sel-todo');
    assert.equal(await page.textContent('#sel-n'), '8');
    await page.tap('#lista-inv .fila-inv[data-item="v3"]'); // quitar uno
    assert.equal(await page.textContent('#sel-n'), '7');

    const m = await page.evaluate(() => {
      const b = document.querySelector('#inv-sel')!.getBoundingClientRect();
      const nav = document.querySelector('.nav')!.getBoundingClientRect();
      return { izq: b.left, der: b.right, ancho: window.innerWidth, abajoBarra: b.bottom, arribaNav: nav.top, desborda: document.documentElement.scrollWidth > window.innerWidth + 1 };
    });
    assert.equal(m.desborda, false, 'sin desplazamiento horizontal');
    assert.ok(m.izq >= -6 && m.der <= m.ancho + 6, `la barra cabe de ancho: ${JSON.stringify(m)}`);
    assert.ok(m.abajoBarra <= m.arribaNav + 2, `la barra de acciones no queda tapada por el menú inferior: ${JSON.stringify(m)}`);
    const alm = await page.locator('#sel-almacen').boundingBox();
    assert.ok(alm && alm.height >= 40 && alm.width > 80, 'el botón Pasar a Almacén es de tamaño táctil');

    await page.tap('#sel-almacen');
    await page.waitForSelector('#dlg-reubicar[open]');
    await esperarTexto(page, '#ru-resumen', /7 artículos · 14 piezas pasarían al almacén/);
    const dlg = await page.evaluate(() => { const r = document.querySelector('#dlg-reubicar')!.getBoundingClientRect(); return { izq: r.left, der: r.right, ancho: window.innerWidth, abajo: r.bottom, alto: window.innerHeight }; });
    assert.ok(dlg.izq >= -1 && dlg.der <= dlg.ancho + 1 && dlg.abajo <= dlg.alto + 1, `el diálogo cabe: ${JSON.stringify(dlg)}`);
    const ok = await page.locator('#ru-ok').boundingBox();
    assert.ok(ok && ok.y + ok.height <= dlg.alto, 'el botón de confirmar se alcanza sin salir de la pantalla');
    await page.tap('#ru-ok');
    await esperarTexto(page, '#inv-msg', /7 artículos \(14 piezas\) pasaron de El Limbo al almacén/);
    // ya no quedan sin ubicar más que el que se quitó
    await page.fill('#inv-q', 'limbo>0');
    await esperarTexto(page, '#inv-pag-info', /de 3\b/);
    assert.deepEqual(errores, []);
  });
});
