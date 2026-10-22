import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { describe, it } from 'node:test';
import { chromium, type Browser, type Page } from 'playwright-core';
import { existenciaAlmacen } from '../src/almacen.ts';
import { LIMBO, type Op } from '../src/tipos.ts';
import { appAdmin } from './ayudas/app.ts';
import { ALMACENES, nuevoMundo, politica } from './ayudas/comun.ts';

const CANDIDATOS = [process.env.POS_CHROMIUM, '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', '/opt/pw-browsers/chromium/chrome-linux/chrome'];
const chromiumPath = CANDIDATOS.find((p) => p && existsSync(p));
const sqlite = ALMACENES.find((a) => a.nombre === 'sqlite')!;

async function pagina(browser: Browser, url: string, ancho = 1366, alto = 820): Promise<{ page: Page; errores: string[] }> {
  const ctx = await browser.newContext({ viewport: { width: ancho, height: alto }, colorScheme: 'light', locale: 'es-MX' });
  const page = await ctx.newPage();
  const errores: string[] = [];
  page.on('pageerror', (e) => errores.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error') errores.push(m.text()); });
  await page.goto(url);
  return { page, errores };
}
/** Espera a que el texto de un elemento cumpla la expresión; si no, el error trae lo que sí decía. */
async function esperarTexto(page: Page, selector: string, re: RegExp) {
  try { await page.waitForFunction(([s, r]) => new RegExp(r).test(document.querySelector(s as string)?.textContent ?? ''), [selector, re.source], { timeout: 8000 }); }
  catch { throw new Error(`${selector} no dijo ${re}; decía: «${await page.textContent(selector).catch(() => '(no existe)')}»`); }
}
const articulo = (n: number, lote: string): Op => ({
  op_id: `item:v${n}`, tipo: 'item.created', tienda: null, caja: null, origen: 'migracion', ocurrio_en: '2026-10-01T15:00:00Z',
  payload: { item_id: `v${n}`, codigo: `99${n}`, item_no: String(3000 + n), marca: 'TM', descripcion: `CAMISA ${n}`, estilo: '123L', lote, departamento: 'CABALLERO', precio: 25000, origen: 'migracion' },
});
const limbo = (n: number, delta: number): Op => ({ op_id: `mov:limbo:v${n}`, tipo: 'inv.movement', tienda: LIMBO, caja: null, origen: 'importacion:t', ocurrio_en: '2026-10-01T15:00:00Z', payload: { item_id: `v${n}`, tienda: LIMBO, delta, tipo: 'limbo_inicial', doc: 'importacion:t' } });

/** 8 camisas viejas (sin lote) con 2 piezas en El Limbo cada una y 2 con lote 202610. */
const sembrar = (ctx: ReturnType<typeof nuevoMundo>) => {
  const ops: Op[] = [];
  for (let n = 1; n <= 8; n++) ops.push(articulo(n, ''), limbo(n, 2));
  for (let n = 9; n <= 10; n++) ops.push(articulo(n, '202610'), limbo(n, 5));
  ctx.m.sembrarOps(ops);
};
const enLimbo = (ctx: ReturnType<typeof nuevoMundo>, n: number) => ctx.m.central.repo.ops().filter((o) => o.tipo === 'inv.movement' && o.payload.tienda === LIMBO && o.payload.item_id === `v${n}`).reduce((a, o) => a + o.payload.delta, 0);
const enAlmacen = (ctx: ReturnType<typeof nuevoMundo>, n: number) => existenciaAlmacen(ctx.m.central.repo.ops()).get(`v${n}`)?.existencia ?? 0;

describe('[navegador real] Inventario: seleccionar y dar su ubicación real a las piezas de El Limbo', { timeout: 240_000, skip: chromiumPath ? false : 'Chromium no encontrado (defina POS_CHROMIUM)' }, () => {
  it('UL1 Lote=0 + «seleccionar todo» + quitar los que sí se usan + pasar al almacén', async (t) => {
    const browser = await chromium.launch({ executablePath: chromiumPath, args: ['--no-sandbox'] });
    const ctx = nuevoMundo(sqlite, politica());
    sembrar(ctx);
    const adm = await appAdmin(ctx);
    t.after(async () => { await browser.close(); await adm.cerrar(); ctx.limpiar(); });
    const { page, errores } = await pagina(browser, adm.url);
    await page.click('#nav button[data-vista="inventario"]');
    await page.waitForSelector('#inv-pag-info');
    await page.fill('#inv-q', 'lote=0');
    await esperarTexto(page, '#inv-pag-info', /de 8\b/);
    assert.equal(await page.locator('#tabla-inv-lista tbody tr[data-item]').count(), 8, 'Lote=0 muestra solo lo que no tiene lote');

    // modo selección
    await page.click('#inv-sel-modo');
    await page.waitForSelector('#inv-sel:not([hidden])');
    assert.equal(await page.locator('#tabla-inv-lista input[data-sel]').count(), 8);
    assert.equal(await page.textContent('#sel-n'), '0');
    assert.equal(await page.isDisabled('#sel-almacen'), true, 'sin selección no hay acciones');
    await page.click('#tabla-inv-lista tr[data-item="v1"] td:nth-child(3)');
    assert.equal(await page.textContent('#sel-n'), '1', 'tocar el renglón lo marca (no abre el artículo)');
    assert.equal(await page.locator('#dlg-articulo[open]').count(), 0);
    await page.click('#sel-todo');
    assert.equal(await page.textContent('#sel-n'), '8');
    assert.equal(await page.locator('#tabla-inv-lista input[data-sel]:checked').count(), 8);
    // quitar los 2 que sí se usan
    await page.uncheck('#tabla-inv-lista input[data-sel="v7"]');
    await page.click('#tabla-inv-lista tr[data-item="v8"] td:nth-child(3)');
    assert.equal(await page.textContent('#sel-n'), '6');
    assert.match((await page.textContent('#inv-sel .sel-resumen'))!, /todo lo del buscador, sin 2/);
    // cambiar la búsqueda quita «todo lo del buscador»
    // (se verifica más abajo) — ahora pasar al almacén
    await page.click('#sel-almacen');
    await page.waitForSelector('#dlg-reubicar[open]');
    await esperarTexto(page, '#ru-resumen', /6 artículos · 12 piezas pasarían al almacén/);
    assert.match((await page.textContent('#ru-ok'))!, /Pasar 12 piezas al almacén/);
    await page.click('#ru-ok');
    await esperarTexto(page, '#inv-msg', /pasaron de El Limbo al almacén/);
    assert.match((await page.textContent('#inv-msg'))!, /6 artículos \(12 piezas\)/);
    assert.deepEqual([1, 2, 3, 4, 5, 6].map((n) => [enLimbo(ctx, n), enAlmacen(ctx, n)]), Array(6).fill([0, 2]));
    assert.deepEqual([7, 8, 9].map((n) => [enLimbo(ctx, n), enAlmacen(ctx, n)]), [[2, 0], [2, 0], [5, 0]], 'los quitados y los que tienen lote no se tocan');
    assert.equal(await page.locator('#inv-sel:not([hidden])').count(), 0, 'la selección se limpia al terminar');

    // «Limbo>0» ahora solo trae los que faltan por ubicar
    await page.fill('#inv-q', 'limbo>0');
    await esperarTexto(page, '#inv-pag-info', /de 4\b/);
    assert.deepEqual(errores.filter((e) => !/401|403|Failed to load resource/.test(e)), []);
  });

  it('UL2 ya no existe: da de baja con aviso; cantidad fija; Ubicar piezas desde el artículo; al cambiar la búsqueda se quita «todo del buscador»', async (t) => {
    const browser = await chromium.launch({ executablePath: chromiumPath, args: ['--no-sandbox'] });
    const ctx = nuevoMundo(sqlite, politica());
    sembrar(ctx);
    const adm = await appAdmin(ctx);
    t.after(async () => { await browser.close(); await adm.cerrar(); ctx.limpiar(); });
    const { page } = await pagina(browser, adm.url);
    await page.click('#nav button[data-vista="inventario"]');
    await page.waitForSelector('#inv-pag-info');
    await page.fill('#inv-q', 'lote=0');
    await esperarTexto(page, '#inv-pag-info', /de 8\b/);
    await page.click('#inv-sel-modo');
    await page.click('#sel-todo');
    await page.fill('#inv-q', 'lote=0 camisa 1');
    await esperarTexto(page, '#inv-msg', /quitó/);
    assert.equal(await page.textContent('#sel-n'), '0', 'cambió la búsqueda: empieza de nuevo');
    // marcar uno por uno se conserva al cambiar la búsqueda
    await page.fill('#inv-q', 'lote=0');
    await esperarTexto(page, '#inv-pag-info', /de 8\b/);
    await page.click('#tabla-inv-lista tr[data-item="v2"] td:nth-child(3)');
    await page.click('#tabla-inv-lista tr[data-item="v3"] td:nth-child(3)');
    await page.fill('#inv-q', 'camisa');
    await esperarTexto(page, '#inv-pag-info', /de 10\b/);
    assert.equal(await page.textContent('#sel-n'), '2', 'lo marcado a mano se conserva');

    // baja con aviso
    await page.click('#sel-baja');
    await page.waitForSelector('#dlg-reubicar[open]');
    await esperarTexto(page, '#ru-resumen', /2 artículos · 4 piezas se darían de baja/);
    assert.match((await page.textContent('#ru-aviso'))!, /de verdad ya no existen/);
    assert.match((await page.textContent('#ru-ok'))!, /Dar de baja 4 piezas/);
    // cantidad fija de 1 por artículo
    await page.fill('#ru-n', '1');
    await esperarTexto(page, '#ru-resumen', /2 artículos · 2 piezas se darían de baja/);
    await page.click('#ru-ok');
    await esperarTexto(page, '#inv-msg', /dados de baja/);
    assert.deepEqual([enLimbo(ctx, 2), enLimbo(ctx, 3), enAlmacen(ctx, 2)], [1, 1, 0], 'baja de 1 pieza cada uno; no entra a ningún lado');

  });
  it('UL4 Existencias reales (supervisor): «de 71, 41 están en DÚO» → Limbo baja solo a 30; se guarda tal cual, sin escáner', async (t) => {
    const browser = await chromium.launch({ executablePath: chromiumPath, args: ['--no-sandbox'] });
    const ctx = nuevoMundo(sqlite, politica());
    sembrar(ctx);
    ctx.m.sembrarOps([articulo(20, ''), limbo(20, 71)]);
    const adm = await appAdmin(ctx);
    t.after(async () => { await browser.close(); await adm.cerrar(); ctx.limpiar(); });
    const { page } = await pagina(browser, adm.url);
    await page.click('#nav button[data-vista="inventario"]');
    await page.waitForSelector('#inv-pag-info');
    await page.fill('#inv-q', 'camisa 20');
    await esperarTexto(page, '#inv-pag-info', /de 1\b/);
    await page.click('#tabla-inv-lista tr[data-item="v20"] td:nth-child(2)');
    await page.waitForSelector('#dlg-articulo[open]');
    assert.equal(await page.locator('#art-ubicar').count(), 0, 'el supervisor tiene la ventana completa, no la de solo Limbo');
    await page.click('#art-existencias');
    await page.waitForSelector('#dlg-existencias[open]');
    assert.deepEqual(await page.$$eval('#ex-tabla tbody tr', (r) => r.map((x) => [x.getAttribute('data-lugar'), (x.querySelector('input') as HTMLInputElement).value])), [['limbo', '71'], ['almacen', '0'], ['DUO', '0'], ['LON', '0']]);
    assert.equal(await page.isDisabled('#ex-ok'), true, 'sin cambios no se puede guardar');
    await page.fill('input[data-ex="DUO"]', '41');
    assert.equal(await page.inputValue('input[data-ex="limbo"]'), '30', 'lo que se agrega en DÚO se descuenta de El Limbo');
    assert.match((await page.textContent('#ex-total'))!, /71 \(antes 71\)/);
    // sin la casilla, El Limbo no se mueve solo
    await page.uncheck('#ex-limbo-auto');
    await page.fill('input[data-ex="LON"]', '10');
    assert.equal(await page.inputValue('input[data-ex="limbo"]'), '30');
    assert.match((await page.textContent('#ex-total'))!, /81 \(antes 71\) · \+10/);
    // valores inválidos
    await page.fill('input[data-ex="LON"]', '-3');
    assert.equal(await page.isDisabled('#ex-ok'), true);
    assert.match((await page.textContent('#ex-msg'))!, /enteros de 0 o más/);
    await page.fill('input[data-ex="LON"]', '0');
    await page.fill('#ex-motivo', 'Conteo del propietario');
    await page.click('#ex-ok');
    await esperarTexto(page, '#inv-msg', /guardadas: .*El Limbo \(sin ubicar\) 71 → 30 · Tienda DÚO 0 → 41/);
    const ops = ctx.m.central.repo.ops();
    const suma = (tienda: string) => ops.filter((o) => o.tipo === 'inv.movement' && o.payload.tienda === tienda && o.payload.item_id === 'v20').reduce((x, o) => x + o.payload.delta, 0);
    assert.deepEqual([suma(LIMBO), suma('DUO'), suma('LON')], [30, 41, 0]);
    assert.equal(ops.filter((o) => o.tipo === 'inv.ajuste').length, 1);
  });
});
