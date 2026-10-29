import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { it } from 'node:test';
import { chromium } from 'playwright-core';
import { ServicioAdmin } from '../src/app/servicio.ts';
import { api, appAdmin, appCajero } from './ayudas/app.ts';
import { centralLocal } from './ayudas/central-pglite.ts';
import { ALMACENES, nuevoMundo, politica, porAlmacen, vender } from './ayudas/comun.ts';

porAlmacen('Límite de ventas en efectivo del día por caja: aviso permanente para cobrar en la otra caja', (alm) => {
  const admin = (ctx: ReturnType<typeof nuevoMundo>) => new ServicioAdmin({ central: ctx.m.central as never, actor: { rol: 'admin', usuario: 'Edgardo' }, fuente: () => ctx.m.central.repo.ops(), cajas: [{ tienda: 'DUO', caja: 1 }, { tienda: 'DUO', caja: 2 }], reloj: ctx.m.reloj });
  it('LE1 sin límite no hay aviso; con límite se enciende al llegar a lo cobrado en efectivo del día, solo en esa caja, y apunta a la otra', (t) => {
    const ctx = nuevoMundo(alm, politica());
    t.after(ctx.limpiar);
    const a = admin(ctx);
    const c1 = ctx.m.caja('DUO', 1), c2 = ctx.m.caja('DUO', 2);
    const v = vender(ctx.m, 'DUO', 1, ctx.items[0]!.item_id).venta.total;
    assert.deepEqual([c1.limiteEfectivo().limite, c1.limiteEfectivo().alcanzado], [0, false], 'sin límite fijado');
    a.fijarLimiteEfectivo({ tienda: 'DUO', caja: 1, limite: v + 100 });
    ctx.m.pump(); ctx.m.pump();
    const e = c1.limiteEfectivo();
    assert.deepEqual([e.limite, e.vendido, e.alcanzado, e.cobrar_en], [v + 100, v, false, 2], 'aún le falta');
    vender(ctx.m, 'DUO', 1, ctx.items[0]!.item_id);
    ctx.m.pump();
    assert.deepEqual([c1.limiteEfectivo().alcanzado, c1.limiteEfectivo().cobrar_en], [true, 2], 'al llegar al límite se enciende y manda a la caja 2');
    assert.equal(c2.limiteEfectivo().alcanzado, false, 'la caja 2 no tiene límite');
    assert.equal(a.cajasFondo().cajas.find((c) => c.caja === 1)!.limite_efectivo, v + 100);
    // la caja 2, con su propio límite, apunta a la caja 1
    a.fijarLimiteEfectivo({ tienda: 'DUO', caja: 2, limite: 1 });
    ctx.m.pump(); ctx.m.pump();
    vender(ctx.m, 'DUO', 2, ctx.items[0]!.item_id);
    assert.deepEqual([c2.limiteEfectivo().alcanzado, c2.limiteEfectivo().cobrar_en], [true, 1]);
    // quitar el límite apaga el aviso
    a.fijarLimiteEfectivo({ tienda: 'DUO', caja: 1, limite: 0 });
    ctx.m.pump(); ctx.m.pump();
    assert.equal(c1.limiteEfectivo().alcanzado, false);
    for (const mal of [-1, 1.5, Number.NaN]) assert.throws(() => a.fijarLimiteEfectivo({ tienda: 'DUO', caja: 1, limite: mal }), /importe en pesos/);
    assert.throws(() => a.fijarLimiteEfectivo({ tienda: 'XXX', caja: 1, limite: 100 }), /tienda desconocida/);
  });
  it('LE5 el límite de lunes a jueves es distinto al de viernes a domingo; si no se fija el de fin de semana, vale el mismo', (t) => {
    const ctx = nuevoMundo(alm, politica());
    t.after(ctx.limpiar);
    const a = admin(ctx);
    const c1 = ctx.m.caja('DUO', 1);
    const v = vender(ctx.m, 'DUO', 1, ctx.items[0]!.item_id).venta.total; // jueves 1/oct/2026: ya hay ventas del día
    a.fijarLimiteEfectivo({ tienda: 'DUO', caja: 1, limite: v * 10, limite_fin_semana: v });
    ctx.m.pump(); ctx.m.pump();
    assert.deepEqual([c1.limiteEfectivo().dia, c1.limiteEfectivo().limite, c1.limiteEfectivo().alcanzado], ['entre_semana', v * 10, false], 'jueves: manda el de lunes a jueves');
    const fila = a.cajasFondo().cajas.find((c) => c.caja === 1)!;
    assert.deepEqual([fila.limite_efectivo, fila.limite_efectivo_fin_semana], [v * 10, v]);
    for (const [dia, esperado] of [['2026-10-02', 'fin_semana'], ['2026-10-03', 'fin_semana'], ['2026-10-04', 'fin_semana'], ['2026-10-05', 'entre_semana']] as const) {
      ctx.m.reloj.fijar(`${dia}T19:00:00Z`);
      assert.equal(c1.limiteEfectivo().dia, esperado, dia);
    }
    // viernes: otra venta del día, límite de fin de semana = lo de una venta
    ctx.m.reloj.fijar('2026-10-02T19:00:00Z');
    assert.equal(c1.limiteEfectivo().alcanzado, false, 'viernes sin ventas del día todavía');
    vender(ctx.m, 'DUO', 1, ctx.items[0]!.item_id);
    assert.deepEqual([c1.limiteEfectivo().limite, c1.limiteEfectivo().alcanzado], [v, true], 'viernes: manda el de fin de semana');
    // sin límite de fin de semana, vale el de entre semana
    a.fijarLimiteEfectivo({ tienda: 'DUO', caja: 1, limite: v * 10 });
    ctx.m.pump(); ctx.m.pump();
    assert.deepEqual([c1.limiteEfectivo().limite, c1.limiteEfectivo().alcanzado], [v * 10, false]);
    assert.throws(() => a.fijarLimiteEfectivo({ tienda: 'DUO', caja: 1, limite: 100, limite_fin_semana: -5 }), /importe en pesos/);
  });
  it('LE2 el servicio de la caja solo dice si el aviso está activo (sin importes)', (t) => {
    const ctx = nuevoMundo(alm, politica());
    t.after(ctx.limpiar);
    const a = admin(ctx);
    a.fijarLimiteEfectivo({ tienda: 'DUO', caja: 1, limite: 100 });
    ctx.m.pump(); ctx.m.pump();
    const c1 = ctx.m.caja('DUO', 1);
    const r = { activo: true, alcanzado: false, cobrar_en: 2, tienda: 'DUO', caja: 1 };
    assert.deepEqual(Object.keys(r).sort(), ['activo', 'alcanzado', 'caja', 'cobrar_en', 'tienda']);
    assert.equal(c1.limiteEfectivo().limite, 100);
  });
});

it('LE3 migración 0016 (central real): el límite es solo de Administración y las cajas lo reciben; lo anterior se conserva', async () => {
  const db = await centralLocal();
  const r = (await db.query(`select pos.tipo_para_cajas('caja.limite_efectivo') as cajas, pos.tipo_solo_admin('caja.limite_efectivo') as admin, pos.tipo_para_cajas('metas.config') as metas, pos.tipo_para_cajas('caja.fondo_autorizado') as fondo, pos.tipo_para_cajas('sale.confirmed') as venta`)).rows;
  assert.deepEqual(r, [{ cajas: true, admin: true, metas: true, fondo: true, venta: false }]);
});

const chromiumPath = [process.env.POS_CHROMIUM, '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', '/opt/pw-browsers/chromium/chrome-linux/chrome'].find((p) => p && existsSync(p));
it('LE4 [navegador] Administración fija el límite; la caja muestra el aviso permanente «Cobrar en Caja 2» en su barra lateral al llegar y lo apaga al quitarlo', { timeout: 240_000, skip: chromiumPath ? false : 'Chromium no encontrado' }, async (t) => {
  const browser = await chromium.launch({ executablePath: chromiumPath, args: ['--no-sandbox'] });
  const ctx = nuevoMundo(ALMACENES.find((x) => x.nombre === 'sqlite')!, politica());
  const adm = await appAdmin(ctx);
  const caja = await appCajero(ctx, 'DUO', 1, 'Lupe');
  t.after(async () => { await browser.close(); await adm.cerrar(); await caja.cerrar(); ctx.limpiar(); });
  await api(adm.url, '/api/admin/cajeros', { nombre: 'Lupe', clave: '4321' });
  ctx.m.pump(); ctx.m.pump(); ctx.m.pump();
  const errores: string[] = [];
  const a = await (await browser.newContext({ viewport: { width: 1366, height: 1000 }, locale: 'es-MX' })).newPage();
  a.on('pageerror', (e) => errores.push(String(e)));
  await a.goto(adm.url);
  await a.waitForSelector('#nav');
  const filas = await api(adm.url, '/api/admin/cajas/fondo');
  assert.ok(filas.json.cajas.every((c: { limite_efectivo: number }) => c.limite_efectivo === 0));
  // la pantalla de Administración: Configuración › Cajas › «Límite de efectivo»
  await a.click('#nav button[data-vista="configuracion"]');
  await a.click('#cfg-tab-cajas');
  await a.waitForSelector('#tabla-cajas-fondo');
  await a.locator('tr[data-caja="DUO/1"] .cf-limite').click();
  await a.fill('#cf-limite', '1');
  await a.fill('#cf-limite-fds', '2');
  await a.click('#form-cf button[type="submit"]');
  await a.waitForFunction(() => /Límite guardado/.test(document.querySelector('#msg-cajas')!.textContent!));
  assert.match((await a.textContent('tr[data-caja="DUO/1"] [data-col="limite"]'))!, /\$1\.00/);
  assert.match((await a.textContent('tr[data-caja="DUO/1"] [data-limite="fin-semana"]'))!, /\$2\.00/);
  assert.match((await a.textContent('tr[data-caja="DUO/2"] [data-col="limite"]'))!, /sin límite/);
  assert.equal((await api(adm.url, '/api/admin/cajas/fondo')).json.cajas.find((c: { caja: number; tienda: string }) => c.tienda === 'DUO' && c.caja === 1).limite_efectivo, 100);
  await api(adm.url, '/api/admin/cajas/limite-efectivo', { tienda: 'DUO', caja: 1, limite: 100 });
  ctx.m.pump(); ctx.m.pump(); ctx.m.pump();
  await api(caja.url, '/api/login', { usuario: 'Lupe', clave: '4321' });
  const c = await (await browser.newContext({ viewport: { width: 1366, height: 900 }, locale: 'es-MX' })).newPage();
  c.on('pageerror', (e) => errores.push(String(e)));
  await c.goto(caja.url);
  await c.waitForSelector('#tc-barra');
  await c.waitForFunction(() => !!document.querySelector('#limite-efectivo'));
  assert.equal(await c.locator('#limite-efectivo').isVisible(), false, 'aún no llega al límite: sin aviso');
  vender(ctx.m, 'DUO', 1, ctx.items[0]!.item_id);
  await c.reload();
  await c.waitForSelector('#limite-efectivo:not([hidden])');
  assert.match((await c.textContent('#limite-efectivo'))!, /Esta caja ya llegó al límite de efectivo[\s\S]*Cobrar en Caja 2/);
  await api(adm.url, '/api/admin/cajas/limite-efectivo', { tienda: 'DUO', caja: 1, limite: 0 });
  ctx.m.pump(); ctx.m.pump(); ctx.m.pump();
  await c.reload();
  await c.waitForFunction(() => !!document.querySelector('#limite-efectivo'));
  await c.waitForFunction(() => document.querySelector('#limite-efectivo')!.hasAttribute('hidden'));
  assert.deepEqual(errores, []);
});
