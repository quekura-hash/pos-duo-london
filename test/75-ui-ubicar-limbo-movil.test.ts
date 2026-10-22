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

    // el botón Seleccionar es un botón normal (como «Exportar inventario a Excel»): mismo color y tamaño, no una caja gigante
    const dims = await page.evaluate(() => { const q = (id: string) => document.querySelector(id) as HTMLElement; const b = q('#inv-sel-modo'), x = q('#btn-exportar'); const r = b.getBoundingClientRect(); return { alto: r.height, ancho: r.width, fondo: getComputedStyle(b).backgroundColor, fondoExportar: getComputedStyle(x).backgroundColor }; });
    assert.ok(dims.alto >= 40 && dims.alto <= 60, `alto normal: ${JSON.stringify(dims)}`);
    assert.ok(dims.ancho < 260, `no ocupa todo el ancho: ${JSON.stringify(dims)}`);
    assert.equal(dims.fondo, dims.fondoExportar, 'mismo turquesa que Exportar inventario a Excel');
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
  it('UM2 el historial de ventas de Administración es una lista compacta (no tarjetas gigantes) y tocar una venta abre el detalle', async (t) => {
    execFileSync(process.execPath, [join(RAIZ, 'scripts', 'construir-admin.mjs')], { stdio: 'pipe', env: { ...process.env, LONDUO_DIST: DIST, LONDUO_SUPABASE_URL: URL_CENTRAL, LONDUO_SUPABASE_KEY: 'sb_publishable_prueba' } });
    const db = await centralLocal();
    const edgardo = await usuario(db, 'edgardo@x.mx', 'supervisor');
    for (let n = 1; n <= 6; n++) {
      const linea = { linea_id: `l${n}`, item_id: 'x', item_no: '1', codigo: '1', descripcion: 'BLUSA', marca: 'TM', estilo: 'E', lote: '', departamento: 'DAMA', qty: 1, precio_unit: 10000 * n, descuento: 0, importe: 10000 * n };
      const venta = { sale_id: `s${n}`, tienda: 'DUO', caja: 2, folio: n, cajero: 'Caja DUO-2', lineas: [linea], total: 10000 * n, pagos: [{ metodo: 'efectivo', monto: 10000 * n }], vendedora: 'Autocompra', vendedora_id: null };
      await db.query(`insert into pos.ops (op_id, tipo, tienda, caja, origen, ocurrio_en, payload) values ($1, 'sale.confirmed', 'DUO', 2, 'caja:DUO/2', $2, $3::jsonb)`, [`sale:s${n}`, `2026-10-21T19:${10 + n}:00Z`, JSON.stringify(venta)]);
    }
    const browser = await chromium.launch({ executablePath: chromiumPath, args: ['--no-sandbox'] });
    t.after(() => browser.close());
    const ctx = await browser.newContext({ ...IPHONE, deviceScaleFactor: 2 });
    await simularSupabase(ctx, db, { 'edgardo@x.mx': edgardo });
    const page = await ctx.newPage();
    await page.goto(`file://${HTML}`);
    await page.waitForSelector('#puerta:not([hidden])');
    await page.fill('#pu-correo', 'edgardo@x.mx'); await page.fill('#pu-clave', 'buena'); await page.click('#pu-entrar');
    await page.waitForSelector('#puerta', { state: 'hidden' });
    await page.waitForSelector('#nav button');
    await page.click('#nav button[data-vista="historial"]');
    await page.waitForSelector('#ha-filtros');
    await page.fill('#ha-desde', '2026-10-21'); await page.fill('#ha-hasta', '2026-10-21');
    await page.tap('#ha-filtros button[type="submit"]');
    await page.waitForSelector('#lista-historial-admin .fila-inv');
    assert.equal(await page.locator('#lista-historial-admin .fila-inv').count(), 6);
    assert.equal(await page.locator('#tabla-historial-admin').isVisible(), false, 'en el teléfono no se usa la tabla de tarjetas');
    const alto = await page.locator('#lista-historial-admin .fila-inv').first().boundingBox();
    assert.ok(alto && alto.height < 100, `cada venta es una fila compacta (${alto?.height}px)`);
    const visibles = await page.evaluate(() => [...document.querySelectorAll('#lista-historial-admin .fila-inv')].filter((e) => { const r = e.getBoundingClientRect(); return r.bottom <= window.innerHeight; }).length);
    assert.ok(visibles >= 3, `caben varias ventas en la pantalla (${visibles})`);
    assert.match((await page.textContent('#lista-historial-admin .fila-inv'))!, /000006[\s\S]*Caja 2[\s\S]*Efectivo/);
    await page.tap('#lista-historial-admin .fila-inv');
    await page.waitForSelector('#dlg-detalle-venta[open]');
    assert.match((await page.textContent('#dv-titulo'))!, /Venta 000006/);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), true);
  });
  it('UM3 Existencias reales en el iPhone: cabe en la pantalla y guarda en el central real (Limbo 71 → 30, DÚO 41, almacén 0 → 0)', async (t) => {
    execFileSync(process.execPath, [join(RAIZ, 'scripts', 'construir-admin.mjs')], { stdio: 'pipe', env: { ...process.env, LONDUO_DIST: DIST, LONDUO_SUPABASE_URL: URL_CENTRAL, LONDUO_SUPABASE_KEY: 'sb_publishable_prueba' } });
    const db = await centralLocal();
    const edgardo = await usuario(db, 'edgardo@x.mx', 'supervisor');
    const art = { item_id: 'p1', codigo: '9901', item_no: '4001', marca: 'TM', descripcion: 'EXPOSURE', estilo: '123L', lote: '', departamento: 'CABALLERO', precio: 25000, origen: 'migracion' };
    await db.query(`insert into pos.ops (op_id, tipo, tienda, caja, origen, ocurrio_en, payload) values ('item:p1', 'item.created', null, null, 'migracion', '2026-10-01T15:00:00Z', $1::jsonb)`, [JSON.stringify(art)]);
    await db.query(`insert into pos.ops (op_id, tipo, tienda, caja, origen, ocurrio_en, payload) values ('mov:limbo:p1', 'inv.movement', 'LIMBO', null, 'importacion:t', '2026-10-01T15:00:00Z', $1::jsonb)`, [JSON.stringify({ item_id: 'p1', tienda: 'LIMBO', delta: 71, tipo: 'limbo_inicial', doc: 'x' })]);
    const browser = await chromium.launch({ executablePath: chromiumPath, args: ['--no-sandbox'] });
    t.after(() => browser.close());
    const ctx = await browser.newContext({ ...IPHONE, deviceScaleFactor: 2 });
    await simularSupabase(ctx, db, { 'edgardo@x.mx': edgardo });
    const page = await ctx.newPage();
    await page.goto(`file://${HTML}`);
    await page.waitForSelector('#puerta:not([hidden])');
    await page.fill('#pu-correo', 'edgardo@x.mx'); await page.fill('#pu-clave', 'buena'); await page.click('#pu-entrar');
    await page.waitForSelector('#puerta', { state: 'hidden' });
    await page.waitForSelector('#nav button');
    await page.click('#nav button[data-vista="inventario"]');
    await page.waitForSelector('#lista-inv .fila-inv[data-item="p1"]');
    await page.tap('#lista-inv .fila-inv[data-item="p1"]');
    await page.waitForSelector('#dlg-articulo[open]');
    await page.tap('#art-existencias');
    await page.waitForSelector('#dlg-existencias[open]');
    const dlg = await page.evaluate(() => { const r = document.querySelector('#dlg-existencias')!.getBoundingClientRect(); const ok = document.querySelector('#ex-ok')!.getBoundingClientRect(); return { izq: r.left, der: r.right, ancho: window.innerWidth, okAbajo: ok.bottom, alto: window.innerHeight, desborda: document.documentElement.scrollWidth > window.innerWidth + 1 }; });
    assert.ok(dlg.izq >= -1 && dlg.der <= dlg.ancho + 1 && !dlg.desborda, `el diálogo cabe de ancho: ${JSON.stringify(dlg)}`);
    await page.fill('input[data-ex="DUO"]', '41');
    assert.equal(await page.inputValue('input[data-ex="limbo"]'), '30');
    const ok = await page.locator('#ex-ok').boundingBox();
    assert.ok(ok && ok.height >= 40, 'el botón Guardar es de tamaño táctil');
    await page.tap('#ex-ok');
    await esperarTexto(page, '#inv-msg', /El Limbo \(sin ubicar\) 71 → 30 · Tienda DÚO 0 → 41/);
    const filas = (await db.query(`select tipo, tienda, payload->>'delta' as delta from pos.ops where op_id like '%ajuste%' order by seq`)).rows as { tipo: string; tienda: string | null; delta: string | null }[];
    assert.deepEqual(filas.map((f) => f.tipo).sort(), ['inv.ajuste', 'inv.movement', 'inv.movement'], 'el central real aceptó el ajuste');
    const saldo = (await db.query(`select payload->>'tienda' as tienda, sum((payload->>'delta')::int) as q from pos.ops where tipo = 'inv.movement' and payload->>'item_id' = 'p1' group by 1 order by 1`)).rows as { tienda: string; q: string }[];
    assert.deepEqual(saldo.map((x) => [x.tienda, Number(x.q)]), [['DUO', 41], ['LIMBO', 30]]);
  });
  it('UM4 trabajadoras en el iPhone: tienda en la lista, el expediente se abre solo con la clave y se guarda en el central real', async (t) => {
    execFileSync(process.execPath, [join(RAIZ, 'scripts', 'construir-admin.mjs')], { stdio: 'pipe', env: { ...process.env, LONDUO_DIST: DIST, LONDUO_SUPABASE_URL: URL_CENTRAL, LONDUO_SUPABASE_KEY: 'sb_publishable_prueba' } });
    const db = await centralLocal();
    const edgardo = await usuario(db, 'edgardo@x.mx', 'supervisor');
    // las reglas de la migración 0009: la ubicación llega a todas las cajas y el expediente es solo de Administración
    assert.deepEqual((await db.query(`select pos.tipo_para_cajas('cajero.ubicacion') as ub, pos.tipo_para_cajas('trabajadora.expediente') as exp, pos.tipo_solo_admin('trabajadora.expediente') as solo`)).rows, [{ ub: true, exp: false, solo: true }]);
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
    const atender = (metodo: string, ruta: string, cuerpo?: unknown) => page.evaluate(async (d) => (await (window as unknown as { __POS_ATENDER__: (m: string, r: string, c?: unknown) => Promise<{ status: number; json: Record<string, unknown> }> }).__POS_ATENDER__(d.m, d.r, d.c)).status, { m: metodo, r: ruta, c: cuerpo });
    assert.equal(await atender('POST', '/api/admin/cajeros', { nombre: 'Ana', clave: '1111', tienda: 'DUO', perfil: { nombres: 'Ana', apellidos: 'López' } }), 200);
    await page.click('#nav button[data-vista="configuracion"]');
    await page.click('#cfg-tab-cajeros');
    await page.waitForSelector('#tabla-cajeros tr[data-cajero]');
    assert.match((await page.textContent('#tabla-cajeros tr[data-cajero]'))!, /DÚO/);
    await page.tap('#tabla-cajeros tr[data-cajero] .c-editar');
    await page.waitForSelector('#dlg-empleado[open]');
    await page.tap('#emp-expediente');
    await page.waitForSelector('#dlg-expediente[open] #form-exp-clave');
    assert.doesNotMatch((await page.textContent('#dlg-expediente'))!, /Puntualidad|Anotaciones/);
    // primera vez: crear su clave corta (no la contraseña de Supabase)
    await page.fill('#exp-nueva', '2468'); await page.fill('#exp-nueva2', '2468');
    await page.tap('#form-exp-clave button[type=submit]');
    await page.waitForSelector('#form-exp');
    const dlg = await page.evaluate(() => { const r = document.querySelector('#dlg-expediente')!.getBoundingClientRect(); return { izq: r.left, der: r.right, ancho: window.innerWidth, desborda: document.documentElement.scrollWidth > window.innerWidth + 1 }; });
    assert.ok(dlg.izq >= -1 && dlg.der <= dlg.ancho + 1 && !dlg.desborda, `el expediente cabe de ancho: ${JSON.stringify(dlg)}`);
    const boton = await page.locator('[data-crit="puntualidad"] .exp-n[data-n="4"]').boundingBox();
    assert.ok(boton && boton.width >= 38 && boton.height >= 38, 'las calificaciones son botones táctiles');
    await page.tap('[data-crit="puntualidad"] .exp-n[data-n="4"]');
    await page.tap('[data-crit="humildad"] .exp-n[data-n="5"]');
    await page.check('input[name="exp-rec"][value="si"]');
    await page.fill('#exp-alta', '2025-03-10');
    await page.fill('#exp-notas', 'Buena vendedora.');
    await page.tap('#exp-guardar');
    await esperarTexto(page, '#msg-exp', /Ficha guardada/);
    const filas = (await db.query(`select tipo, tienda, payload->>'recontratable' as rec, payload->'calificaciones'->>'puntualidad' as p from pos.ops where tipo = 'trabajadora.expediente'`)).rows as { tipo: string; tienda: string | null; rec: string; p: string }[];
    assert.deepEqual(filas.map((f) => [f.tipo, f.tienda, f.rec, f.p]), [['trabajadora.expediente', null, 'true', '4']], 'el central real lo aceptó; no lleva tienda, por eso las cajas nunca lo reciben');
    await page.tap('#exp-cerrar');
    await page.waitForSelector('#dlg-expediente', { state: 'hidden' });
    assert.deepEqual(errores, []);
  });
});
