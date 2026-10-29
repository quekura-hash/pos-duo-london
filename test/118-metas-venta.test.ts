import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { it } from 'node:test';
import { chromium } from 'playwright-core';
import { api, appAdmin, appCajero } from './ayudas/app.ts';
import { ServicioAdmin } from '../src/app/servicio.ts';
import { avanceMetas, colorDeRitmo, diaEquivalente, diasDelPeriodo, fraccionDelDia, lunesDe, metasDias, totalesPorDia, CONFIG_METAS_INICIAL } from '../src/metas.ts';
import type { VentaHistorica } from '../src/ventas-historicas.ts';
import { centralLocal } from './ayudas/central-pglite.ts';
import { ALMACENES } from './ayudas/comun.ts';
const ALMACENES_SQLITE = () => ALMACENES.find((a) => a.nombre === 'sqlite')!;
import { nuevoMundo, politica, porAlmacen, vender } from './ayudas/comun.ts';

it('MV1 calendario: el día equivalente es 364 días atrás (mismo día de la semana), la semana va de lunes a domingo y el mes trae todos sus días', () => {
  assert.equal(diaEquivalente('2026-10-30'), '2025-10-31'); // viernes → viernes
  assert.equal(new Date('2025-10-31T12:00:00Z').getUTCDay(), 5);
  assert.equal(lunesDe('2026-10-04'), '2026-09-28'); // domingo
  assert.equal(lunesDe('2026-10-05'), '2026-10-05'); // lunes
  assert.deepEqual(diasDelPeriodo('semana', '2026-10-01'), ['2026-09-28', '2026-09-29', '2026-09-30', '2026-10-01', '2026-10-02', '2026-10-03', '2026-10-04']);
  assert.equal(diasDelPeriodo('mes', '2026-02-10').length, 28);
  assert.equal(diasDelPeriodo('dia', '2026-10-01').join(), '2026-10-01');
});

it('MV2 la meta de cada día es lo vendido el día equivalente del año pasado más el incremento, a pesos enteros; sin historial no hay meta', () => {
  const t = new Map([['2025-10-02', 100000], ['2025-10-03', 33333]]);
  assert.deepEqual(metasDias(t, 0, '2026-10-01', '2026-10-04'), { '2026-10-01': 100000, '2026-10-02': 33300 });
  assert.deepEqual(metasDias(t, 5, '2026-10-01', '2026-10-02'), { '2026-10-01': 105000, '2026-10-02': 35000 });
  assert.deepEqual(metasDias(new Map(), 5, '2026-10-01', '2026-10-31'), {});
});

it('MV3 el color sale del ritmo: lo vendido contra lo que ya se debería llevar a esta hora; al abrir siempre va verde', () => {
  const c = { verde_pct: 90, amarillo_pct: 60 };
  assert.deepEqual([1, 0.9, 0.89, 0.6, 0.59, 0].map((r) => colorDeRitmo(r, c)), ['verde', 'verde', 'amarillo', 'amarillo', 'rojo', 'rojo']);
  assert.deepEqual([fraccionDelDia('09:00', '10:00', '20:00'), fraccionDelDia('15:00', '10:00', '20:00'), fraccionDelDia('21:00', '10:00', '20:00')], [0, 0.5, 1]);
  const metas = { '2026-10-01': 100000 };
  const av = (hora: string, vendido: number) => avanceMetas({ tienda: 'DUO', fecha: '2026-10-01', hora, config: CONFIG_METAS_INICIAL, metas, totales: new Map([['2026-10-01', vendido]]) });
  assert.equal(av('09:00', 0).dia!.color, 'verde', 'antes de abrir');
  assert.deepEqual([av('15:00', 50000).dia!.color, av('15:00', 45000).dia!.color, av('15:00', 30000).dia!.color, av('15:00', 20000).dia!.color], ['verde', 'verde', 'amarillo', 'rojo']);
  assert.equal(Math.round(av('15:00', 30000).dia!.pct), 30);
  assert.equal(av('15:00', 120000).dia!.pct, 120, 'puede pasar de 100 %');
  assert.equal(av('15:00', 1).semana!.meta, 100000, 'la semana suma las metas de sus días');
  assert.equal(avanceMetas({ tienda: 'DUO', fecha: '2026-11-15', hora: '12:00', config: CONFIG_METAS_INICIAL, metas, totales: new Map() }).mes, null, 'sin meta en el periodo no hay barra');
});

it('MV4 la semana y el mes pesan cada día por su meta: lo de días anteriores cuenta completo y el día de hoy solo lo que va de su horario', () => {
  const metas: Record<string, number> = {};
  for (let d = 1; d <= 31; d++) metas[`2026-10-${String(d).padStart(2, '0')}`] = 10000;
  const totales = new Map<string, number>([['2026-10-01', 10000], ['2026-10-02', 10000], ['2026-10-03', 4000]]);
  const a = avanceMetas({ tienda: 'DUO', fecha: '2026-10-03', hora: '15:00', config: CONFIG_METAS_INICIAL, metas, totales });
  assert.equal(a.mes!.meta, 310000);
  assert.equal(a.mes!.vendido, 24000);
  assert.equal(a.mes!.esperado, 25000, '2 días completos + la mitad del tercero');
  assert.equal(a.semana!.desde, '2026-09-28');
  assert.equal(a.semana!.hasta, '2026-10-04');
});

porAlmacen('Metas de venta: se publican a las cajas, la caja solo ve porcentaje y Administración ve las cantidades', (alm) => {
  const filaHist = (fecha: string, total: number, folio: number): VentaHistorica => ({ folio, fecha, tipo: 'venta', piezas: 1, total, pago: 'efectivo', pago_original: 'Cash' });
  const admin = (ctx: ReturnType<typeof nuevoMundo>) => new ServicioAdmin({ central: ctx.m.central as never, actor: { rol: 'admin', usuario: 'Edgardo' }, fuente: () => ctx.m.central.repo.ops(), cajas: [{ tienda: 'DUO', caja: 1 }, { tienda: 'LON', caja: 1 }], reloj: ctx.m.reloj });
  it('MV5 Administración publica la meta (año pasado + incremento), la caja ve solo el porcentaje y una tienda sin historial no tiene barra', async (t) => {
    const ctx = nuevoMundo(alm, politica());
    t.after(ctx.limpiar);
    const a = admin(ctx);
    // el reloj de la prueba marca jueves 1/oct/2026 8:00; el día equivalente es el jueves 2/oct/2025
    ctx.m.central.importarVentasHistoricas({ tienda: 'DUO', caja: 1, lote: 'p', por: 'Edgardo', filas: [filaHist('2025-10-02', 100000, 1), filaHist('2025-10-03', 50000, 2)] });
    ctx.m.pump();
    const caja = ctx.m.caja('DUO', 1);
    assert.equal(caja.metasAvance(), null, 'sin metas publicadas no hay barra');
    const r0 = a.metasAdmin(); // abre la pantalla: publica sola lo que falta
    ctx.m.pump(); ctx.m.pump();
    const duo = r0.tiendas.find((x) => x.tienda === 'DUO')!;
    assert.equal(duo.periodos.dia!.meta, 100000);
    assert.equal(duo.sin_historial, false);
    assert.equal(r0.tiendas.find((x) => x.tienda === 'LON')!.sin_historial, true);
    assert.equal(ctx.m.caja('LON', 1).metasAvance(), null, 'London no tiene historial: sin barra');
    const v = vender(ctx.m, 'DUO', 1, ctx.items[0]!.item_id).venta;
    ctx.m.pump();
    const p = caja.metasAvance()!;
    assert.equal(p.dia!.pct, Math.round((v.total / 100000) * 100), 'la caja ve solo el porcentaje');
    assert.deepEqual(Object.keys(p.dia!).sort(), ['color', 'pct']);
    assert.equal(p.dia!.color, 'verde', 'antes de abrir la tienda el ritmo es verde');
    // incremento del 5 %: la meta sube y se republica a las cajas
    const g = a.guardarMetas({ tiendas: { DUO: { incremento_pct: 5 } } });
    ctx.m.pump(); ctx.m.pump();
    assert.equal(g.tiendas.find((x) => x.tienda === 'DUO')!.periodos.dia!.meta, 105000);
    assert.equal(caja.metasAvance()!.dia!.pct, Math.round((v.total / 105000) * 100));
    // validaciones
    assert.throws(() => a.guardarMetas({ tiendas: { DUO: { incremento_pct: 9999 } } }), /incremento/);
    assert.throws(() => a.guardarMetas({ tiendas: { DUO: { apertura: '20:00', cierre: '10:00' } } }), /cierre/);
    assert.throws(() => a.guardarMetas({ verde_pct: 50, amarillo_pct: 60 }), /verde/);
    // a media tarde sin ventas nuevas el ritmo es rojo; con la venta sube
    ctx.m.reloj.fijar('2026-10-01T22:00:00Z'); // 3:00 p. m.
    assert.ok(['rojo', 'amarillo', 'verde'].includes(caja.metasAvance()!.dia!.color));
    const rep = a.metasAdmin().tiendas.find((x) => x.tienda === 'DUO')!;
    assert.equal(rep.periodos.dia!.vendido, v.total, 'Administración ve las cantidades reales');
    assert.equal(rep.dias.length, 31);
    assert.equal(rep.dias[1]!.ano_pasado, 50000, 'el viernes 2/oct/2026 compara con el viernes 3/oct/2025 (364 días antes)');
  });
  it('MV5b la barra de la caja cuenta también lo importado del POS anterior del mes en curso, y se actualiza sola al importar más', (t) => {
    const ctx = nuevoMundo(alm, politica());
    t.after(ctx.limpiar);
    const a = admin(ctx);
    ctx.m.central.importarVentasHistoricas({ tienda: 'DUO', caja: 1, lote: 'p', por: 'Edgardo', filas: [filaHist('2025-10-02', 100000, 1)] });
    ctx.m.central.importarVentasHistoricas({ tienda: 'DUO', caja: 1, lote: 'q', por: 'Edgardo', filas: [filaHist('2026-10-01', 40000, 2)] });
    a.metasAdmin(); // publica
    ctx.m.pump(); ctx.m.pump(); ctx.m.pump();
    const caja = ctx.m.caja('DUO', 1);
    assert.equal(caja.metasAvance()!.dia!.pct, 40, 'las cajas no reciben las ventas importadas, pero la meta publicada trae lo ya vendido');
    assert.equal(caja.metasAvance()!.semana!.pct, 40);
    ctx.m.central.importarVentasHistoricas({ tienda: 'DUO', caja: 1, lote: 'r', por: 'Edgardo', filas: [filaHist('2026-10-01', 10000, 3)] });
    ctx.m.pump(); ctx.m.pump(); ctx.m.pump();
    assert.equal(caja.metasAvance()!.dia!.pct, 50, 'al importar más, las metas se republican solas');
  });
});

it('MV6 migraciones 0014 y 0015 (central real): VIP y metas son solo de Administración y se reparten a las cajas; lo anterior se conserva', async () => {
  const db = await centralLocal();
  const r = (await db.query(`select pos.tipo_para_cajas('metas.config') as metas_cajas, pos.tipo_solo_admin('metas.config') as metas_admin, pos.tipo_para_cajas('vip.guardado') as vip_cajas, pos.tipo_solo_admin('vip.excepciones') as vip_admin,
    pos.tipo_para_cajas('empleadas.config') as emp, pos.tipo_para_cajas('venta.consulta') as consulta, pos.tipo_solo_admin('sale.confirmed') as venta_admin, pos.tipo_para_cajas('giftcard.emitida') as regalo`)).rows;
  assert.deepEqual(r, [{ metas_cajas: true, metas_admin: true, vip_cajas: true, vip_admin: true, emp: true, consulta: true, venta_admin: false, regalo: true }]);
});

const chromiumPath = [process.env.POS_CHROMIUM, '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', '/opt/pw-browsers/chromium/chrome-linux/chrome'].find((p) => p && existsSync(p));
it('MV7 [navegador] Administración configura la meta (incremento) y ve el reporte con cantidades; la caja ve la barra solo con porcentaje y cambia de día a semana y mes', { timeout: 240_000, skip: chromiumPath ? false : 'Chromium no encontrado' }, async (t) => {
  const browser = await chromium.launch({ executablePath: chromiumPath, args: ['--no-sandbox'] });
  const ctx = nuevoMundo(ALMACENES_SQLITE(), politica());
  const adm = await appAdmin(ctx);
  const caja = await appCajero(ctx, 'DUO', 1, 'Lupe');
  t.after(async () => { await browser.close(); await adm.cerrar(); await caja.cerrar(); ctx.limpiar(); });
  const fila = (fecha: string, total: number, folio: number): VentaHistorica => ({ folio, fecha, tipo: 'venta', piezas: 1, total, pago: 'efectivo', pago_original: 'Cash' });
  ctx.m.central.importarVentasHistoricas({ tienda: 'DUO', caja: 1, lote: 'p', por: 'Edgardo', filas: [fila('2025-10-02', 100000, 1), fila('2025-10-03', 50000, 2)] });
  await api(adm.url, '/api/admin/cajeros', { nombre: 'Lupe', clave: '4321' });
  ctx.m.pump(); ctx.m.pump(); ctx.m.pump();
  const errores: string[] = [];
  const a = await (await browser.newContext({ viewport: { width: 1366, height: 1000 }, locale: 'es-MX' })).newPage();
  a.on('pageerror', (e) => errores.push(String(e)));
  await a.goto(adm.url);
  await a.waitForSelector('#nav');
  await a.click('#nav button[data-vista="configuracion"]');
  await a.click('#cfg-tab-metas');
  await a.waitForSelector('#form-metas');
  // la pantalla de Administración usa la fecha real; el historial de la prueba cae en octubre de 2025, así que el mes trae meta y el día de hoy no
  assert.match((await a.textContent('[data-reporte-meta="DUO"] [data-meta-periodo="mes"]'))!, /Meta \$1,500\.00/);
  assert.match((await a.textContent('[data-reporte-meta="LON"]'))!, /no tiene ventas del año pasado/);
  await a.fill('#tabla-metas-config tr[data-tienda="DUO"] .mt-inc', '5');
  await a.click('#form-metas button[type="submit"]');
  await a.waitForFunction(() => /Metas guardadas/.test(document.querySelector('#msg-metas')!.textContent!));
  assert.match((await a.textContent('[data-reporte-meta="DUO"] [data-meta-periodo="mes"]'))!, /Meta \$1,575\.00/);
  assert.equal((await api(adm.url, '/api/admin/metas')).json.tiendas.find((x: { tienda: string }) => x.tienda === 'DUO').incremento_pct, 5);
  // valores inválidos se rechazan con un mensaje
  await a.fill('#mt-verde', '40'); await a.fill('#mt-amarillo', '60');
  await a.click('#form-metas button[type="submit"]');
  await a.waitForFunction(() => /verde/.test(document.querySelector('#msg-metas')!.textContent!));
  // la caja recibe la meta publicada y muestra la barra con solo porcentaje
  ctx.m.pump(); ctx.m.pump(); ctx.m.pump();
  await api(caja.url, '/api/login', { usuario: 'Lupe', clave: '4321' });
  const c = await (await browser.newContext({ viewport: { width: 1366, height: 900 }, locale: 'es-MX' })).newPage();
  c.on('pageerror', (e) => errores.push(String(e)));
  await c.goto(caja.url);
  await c.waitForSelector('#metas-barra:not([hidden])');
  assert.match((await c.textContent('#metas-barra'))!, /Meta del día[\s\S]*0%/);
  assert.doesNotMatch((await c.textContent('#metas-barra'))!, /\$/, 'la caja no ve cantidades');
  assert.equal(await c.locator('#metas-barra [data-metas="relleno"]').getAttribute('class'), 'metas-relleno verde');
  await c.click('[data-metas-periodo="semana"]');
  await c.waitForFunction(() => /Meta de la semana/.test(document.querySelector('#metas-barra')!.textContent!));
  await c.click('[data-metas-periodo="mes"]');
  await c.waitForFunction(() => /Meta del mes/.test(document.querySelector('#metas-barra')!.textContent!));
  assert.deepEqual(errores.filter((e) => !/401|403|Failed to load resource/.test(e)), []);
});

it('MV8 [navegador] sin metas publicadas la caja NO dibuja la barra de metas (ni una caja vacía bajo el tipo de cambio)', { timeout: 120_000, skip: chromiumPath ? false : 'Chromium no encontrado' }, async (t) => {
  const browser = await chromium.launch({ executablePath: chromiumPath, args: ['--no-sandbox'] });
  const ctx = nuevoMundo(ALMACENES_SQLITE(), politica());
  const adm = await appAdmin(ctx);
  const caja = await appCajero(ctx, 'DUO', 1, 'Lupe');
  t.after(async () => { await browser.close(); await adm.cerrar(); await caja.cerrar(); ctx.limpiar(); });
  await api(adm.url, '/api/admin/cajeros', { nombre: 'Lupe', clave: '4321' });
  ctx.m.pump(); ctx.m.pump(); ctx.m.pump();
  await api(caja.url, '/api/login', { usuario: 'Lupe', clave: '4321' });
  const c = await (await browser.newContext({ viewport: { width: 1366, height: 900 }, locale: 'es-MX' })).newPage();
  await c.goto(caja.url);
  await c.waitForSelector('#tc-barra');
  await c.waitForFunction(() => !!document.querySelector('#metas-barra'));
  assert.equal(await c.locator('#metas-barra').isVisible(), false);
});
