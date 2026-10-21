import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import ExcelJS from 'exceljs';
import { chromium } from 'playwright-core';
import { centralLocal, como, usuario } from './ayudas/central-pglite.ts';
import { pruebasReporte, simularSupabase, URL_CENTRAL } from './ayudas/supabase-simulado.ts';
import { leerXlsxNode } from '../src/xlsx-node.ts';

const RAIZ = join(import.meta.dirname, '..');
const DIST = mkdtempSync(join(tmpdir(), 'londuo-admin-'));
const HTML = join(DIST, 'administracion.html');
const chromiumPath = [process.env.POS_CHROMIUM, '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', '/opt/pw-browsers/chromium/chrome-linux/chrome'].find((p) => p && existsSync(p));

/** Archivo con la forma del «Sales Detail» del POS anterior (datos inventados). Los días 1 al 12 van como fecha de Excel con día y mes intercambiados. */
async function reporteAnterior() {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Sales Detail');
  ws.getCell('L1').value = 'TIENDA DE PRUEBA'; ws.getCell('L2').value = 'Sales Detail';
  ws.getRow(6).values = [null, 'Date', null, 'Receipt #', null, 'Receipt Type', null, 'Full Name', null, 'Qty Sold', null, 'Total', null, 'Payment'];
  const d = (y: number, m: number, dia: number) => new Date(Date.UTC(y, m - 1, dia));
  const filas: [unknown, number, number, number, string | null][] = [
    [d(2026, 1, 9), 52346, 1, 549, 'Credit Card'], [d(2026, 1, 9), 52347, 2, 1698, 'Debit Card'], [d(2026, 2, 9), 52348, 3, 203, 'Cash'],
    ['13/09/2026', 52349, 0, 30, 'Cash'], ['13/09/2026', 52350, 0, 0, 'None'], ['30/09/2026', 52351, 2, 654, 'Split'],
  ];
  filas.forEach(([fecha, folio, piezas, total, pago], i) => { ws.getRow(7 + i).values = [null, fecha as never, null, folio, null, 'Sales', null, null, null, piezas, null, total, null, pago]; });
  ws.getRow(7 + filas.length + 1).values = [null, null, null, null, null, null, null, null, null, 8, null, 3134];
  return new Uint8Array((await wb.xlsx.writeBuffer()) as ArrayBuffer);
}

describe('[navegador real] Reportes: importar ventas del POS anterior y exportar a Excel para la contadora', { timeout: 180_000, skip: chromiumPath ? false : 'Chromium no encontrado' }, () => {
  it('RH1 vista previa, confirmar, reporte con históricas (y sin ellas), Excel descargable y reimportar sin duplicar', async (t) => {
    execFileSync(process.execPath, [join(RAIZ, 'scripts', 'construir-admin.mjs')], { stdio: 'pipe', env: { ...process.env, LONDUO_DIST: DIST, LONDUO_SUPABASE_URL: URL_CENTRAL, LONDUO_SUPABASE_KEY: 'sb_publishable_prueba' } });
    const db = await centralLocal();
    const edgardo = await usuario(db, 'edgardo@x.mx', 'supervisor');
    const dir = mkdtempSync(join(tmpdir(), 'pos-hist-'));
    const archivo = join(dir, 'REPORTE_DE_DUO_SEPTIEMBRE.xlsx');
    writeFileSync(archivo, await reporteAnterior());
    const browser = await chromium.launch({ executablePath: chromiumPath, args: ['--no-sandbox'] });
    t.after(async () => { await browser.close(); rmSync(dir, { recursive: true, force: true }); });
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, acceptDownloads: true });
    await simularSupabase(ctx, db, { 'edgardo@x.mx': edgardo });
    const page = await ctx.newPage();
    const errores: string[] = [];
    page.on('pageerror', (e) => errores.push(String(e)));
    await page.goto(`file://${HTML}`);
    await page.waitForSelector('#puerta:not([hidden])');
    await page.fill('#pu-correo', 'edgardo@x.mx'); await page.fill('#pu-clave', 'buena'); await page.click('#pu-entrar');
    await page.waitForSelector('#puerta', { state: 'hidden' });
    await page.click('#nav button[data-vista="reportes"]');
    await page.waitForSelector('#rep-importar');

    // Vista previa: no guarda nada; corrige las fechas y marca lo raro.
    await page.click('#rep-importar');
    await page.waitForSelector('#dlg-hist[open]');
    await page.selectOption('#hist-caja', 'DUO/1');
    await page.setInputFiles('#hist-archivo', archivo);
    await page.waitForSelector('#hist-resumen');
    const resumen = await page.$$eval('#hist-resumen tr', (f) => Object.fromEntries(f.map((r) => [r.querySelector('th')!.textContent, r.querySelector('td')!.textContent!.replace(/\s+/g, ' ')])));
    assert.equal(resumen['Tickets'], '6');
    assert.match(resumen['Folios']!, /52346 al 52351/);
    assert.match(resumen['Fechas']!, /2026-09-01 al 2026-09-30/);
    assert.match(resumen['Total']!, /\$3,134\.00/);
    assert.match(resumen['Fees por daño']!, /^1 · \$30\.00/);
    assert.equal(resumen['Cambios ($0)'], '1');
    assert.match((await page.textContent('#hist-msg'))!, /Revisa el resumen/);
    assert.match((await page.textContent('#dlg-hist .mensaje.aviso'))!, /3 fecha\(s\) venían con el día y el mes intercambiados/);
    assert.equal(await page.locator('#hist-revisar tbody tr').count(), 3, 'fee, cambio y pago mixto para revisar');
    assert.equal((await como(db, edgardo, (q) => q(`select count(*)::int n from pos.ops where tipo = 'venta.historica'`)) as { n: number }[])[0]!.n, 0, 'la vista previa no guarda');
    await page.screenshot({ path: join(RAIZ, 'docs', 'capturas', '63-importar-ventas-anteriores.png') });

    // Confirmar: se guarda en el central y la reimportación no duplica.
    await page.click('#hist-confirmar');
    await page.waitForFunction(() => /6 ticket\(s\) importados/.test(document.querySelector('#hist-msg')!.textContent!));
    await page.waitForFunction(() => { const e = (window as unknown as { POS_ADMIN: { estado(): { pendientes: number } | null } }).POS_ADMIN.estado(); return !!e && e.pendientes === 0; });
    assert.equal((await como(db, edgardo, (q) => q(`select count(*)::int n from pos.ops where tipo = 'venta.historica'`)) as { n: number }[])[0]!.n, 6);
    await page.setInputFiles('#hist-archivo', []);
    await page.setInputFiles('#hist-archivo', archivo);
    await page.waitForFunction(() => /Todos estos tickets ya estaban importados/.test(document.querySelector('#hist-msg')!.textContent!));
    assert.equal(await page.isDisabled('#hist-confirmar'), true, 'nada nuevo que importar');
    await page.click('#hist-cerrar');

    // Reporte de septiembre con históricas (folio original, origen, forma de pago); sin ellas queda vacío.
    await page.fill('#desde', '2026-09-01'); await page.fill('#hasta', '2026-09-30');
    await page.click('#filtros button[type=submit]');
    await page.waitForFunction(() => document.querySelectorAll('#tabla-reporte tbody tr.fila-hist').length === 6);
    const filas = await page.$$eval('#tabla-reporte tbody tr', (r) => r.map((x) => [...x.querySelectorAll('td')].map((c) => c.textContent)));
    assert.deepEqual(filas[0], ['DUO', '1', '52346', '2026-09-01', '', '$549.00', 'confirmada', '1', 'Tarjeta', 'POS anterior']);
    assert.deepEqual([filas[3]![2], filas[3]![7], filas[3]![9]], ['52349', '0', 'POS anterior · fee por daño']);
    assert.equal(await page.textContent('#total-consolidado'), '$3,134.00');
    assert.match((await page.textContent('#tabla-por-caja'))!, /DUO\s*1 \(histórico\)\s*6/);
    await page.uncheck('#hist');
    await page.click('#filtros button[type=submit]');
    await page.waitForFunction(() => document.querySelectorAll('#tabla-reporte tbody tr.fila-hist').length === 0);
    await page.check('#hist');
    await page.click('#filtros button[type=submit]');
    await page.waitForFunction(() => document.querySelectorAll('#tabla-reporte tbody tr.fila-hist').length === 6);
    await page.screenshot({ path: join(RAIZ, 'docs', 'capturas', '64-reporte-con-historicas.png') });

    // Excel para la contadora.
    const [descarga] = await Promise.all([page.waitForEvent('download'), page.click('#rep-excel')]);
    assert.match(descarga.suggestedFilename(), /^reporte-de-ventas-2026-09-01-a-2026-09-30\.xlsx$/);
    const ruta = join(dir, 'salida.xlsx');
    await descarga.saveAs(ruta);
    const hojas = await leerXlsxNode(readFileSync(ruta));
    assert.deepEqual(hojas.map((h) => h.nombre), ['Detalle de ventas', 'Resumen por día']);
    assert.equal(hojas[0]!.filas.length, 7, 'encabezado y 6 tickets');
    assert.deepEqual([hojas[0]!.filas[1]![1], hojas[0]!.filas[1]![2], hojas[0]!.filas[1]![4], hojas[0]!.filas[1]![5]], [52346, 'Venta', 549, 'Tarjeta']);
    assert.deepEqual(errores, []);
  });
});

describe('[navegador real] Reportes: envío mensual a la contadora', { timeout: 180_000, skip: chromiumPath ? false : 'Chromium no encontrado' }, () => {
  it('RH2 el supervisor activa el envío caja por caja con sus correos, ve los envíos hechos y pide una prueba de una caja', async (t) => {
    const dist = mkdtempSync(join(tmpdir(), 'londuo-admin-'));
    execFileSync(process.execPath, [join(RAIZ, 'scripts', 'construir-admin.mjs')], { stdio: 'pipe', env: { ...process.env, LONDUO_DIST: dist, LONDUO_SUPABASE_URL: URL_CENTRAL, LONDUO_SUPABASE_KEY: 'sb_publishable_prueba' } });
    const db = await centralLocal();
    const edgardo = await usuario(db, 'edgardo@x.mx', 'supervisor');
    await db.query(`insert into pos.envios_reporte (periodo, tienda, caja, enviado_en, correos, tickets, total, proveedor_id) values ('2026-09', 'DUO', 1, '2026-10-01T04:00:05Z', array['conta@despacho.mx'], 337, 32215200, 're_1')`);
    await db.query(`insert into pos.envios_reporte (periodo, tienda, caja, intentos, ultimo_error, avisado_en) values ('2026-10', 'DUO', 2, 4, 'Resend: 503', now()), ('2026-10', 'LON', 1, 2, 'tiempo agotado', null)`);
    const browser = await chromium.launch({ executablePath: chromiumPath, args: ['--no-sandbox'] });
    t.after(async () => { await browser.close(); rmSync(dist, { recursive: true, force: true }); });
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 1100 } });
    await simularSupabase(ctx, db, { 'edgardo@x.mx': edgardo });
    const page = await ctx.newPage();
    const errores: string[] = [];
    page.on('pageerror', (e) => errores.push(String(e)));
    await page.goto(`file://${join(dist, 'administracion.html')}`);
    await page.waitForSelector('#puerta:not([hidden])');
    await page.fill('#pu-correo', 'edgardo@x.mx'); await page.fill('#pu-clave', 'buena'); await page.click('#pu-entrar');
    await page.waitForSelector('#puerta', { state: 'hidden' });
    await page.click('#nav button[data-vista="reportes"]');
    await page.waitForSelector('#panel-contadora .rc-caja');
    assert.deepEqual(await page.$$eval('#panel-contadora legend', (x) => x.map((e) => e.textContent)), ['DÚO New York · Caja 1', 'DÚO New York · Caja 2', 'London Love · Caja 1', 'London Love · Caja 2'], 'una sección por caja');
    assert.match((await page.textContent('#tabla-envios tbody'))!, /septiembre 2026.*DÚO New York · Caja 1.*Enviado.*337.*\$322,152\.00.*conta@despacho\.mx/);
    assert.match((await page.locator('#tabla-envios tbody tr', { hasText: 'DÚO New York · Caja 2' }).textContent())!, /No se envió · 4 de 4 intentos · se avisó a tu teléfono\s*Resend: 503/);
    assert.match((await page.locator('#tabla-envios tbody tr', { hasText: 'London Love · Caja 1' }).textContent())!, /Reintentando · 2 de 4 intentos\s*tiempo agotado/);

    const caja = (t: string, n: number) => page.locator(`.rc-caja[data-tienda="${t}"][data-caja="${n}"]`);
    const duo1 = caja('DUO', 1), duo2 = caja('DUO', 2);
    // Validaciones: sin correos no se activa; correos mal escritos se señalan.
    await duo1.locator('.rc-activo').check();
    await duo1.locator('.rc-guardar').click();
    assert.match((await duo1.locator('.rc-msg').textContent())!, /Escribe al menos un correo/);
    await duo1.locator('.rc-correos').fill('conta@despacho.mx, mal@');
    await duo1.locator('.rc-guardar').click();
    assert.match((await duo1.locator('.rc-msg').textContent())!, /Revisa estos correos: mal@/);
    assert.equal((await db.query('select 1 from pos.reporte_contadora')).rows.length, 0, 'nada se guardó con datos malos');
    // Cada caja con SUS correos (con mayúsculas y repetidos: se limpian).
    await duo1.locator('.rc-correos').fill('Conta@Despacho.mx; edgardo@x.mx conta@despacho.mx');
    await duo1.locator('.rc-guardar').click();
    await page.waitForFunction(() => /Guardado: el informe de DÚO New York · Caja 1 se enviará a conta@despacho\.mx, edgardo@x\.mx/.test(document.querySelector('.rc-caja[data-tienda="DUO"][data-caja="1"] .rc-msg')!.textContent!));
    await duo2.locator('.rc-activo').check();
    await duo2.locator('.rc-correos').fill('otra.contadora@despacho.mx');
    await duo2.locator('.rc-guardar').click();
    await page.waitForFunction(() => /Caja 2 se enviará a otra\.contadora@despacho\.mx/.test(document.querySelector('.rc-caja[data-tienda="DUO"][data-caja="2"] .rc-msg')!.textContent!));
    const filas = (await como(db, edgardo, (q) => q('select tienda, caja, activo, correos from pos.reporte_contadora order by tienda, caja'))) as { tienda: string; caja: number; activo: boolean; correos: string[] }[];
    assert.deepEqual(filas.map((f) => [f.tienda, f.caja, f.activo, f.correos]), [['DUO', 1, true, ['conta@despacho.mx', 'edgardo@x.mx']], ['DUO', 2, true, ['otra.contadora@despacho.mx']]]);
    // Apagar London Caja 1 (sin correos) queda guardado como apagado; al volver a la pantalla se ve cada cosa en su caja.
    await caja('LON', 1).locator('.rc-guardar').click();
    await page.waitForFunction(() => /el envío de esta caja está apagado/.test(document.querySelector('.rc-caja[data-tienda="LON"][data-caja="1"] .rc-msg')!.textContent!));
    await page.click('#nav button[data-vista="inventario"]');
    await page.click('#nav button[data-vista="reportes"]');
    await page.waitForSelector('#panel-contadora .rc-caja');
    assert.equal(await page.inputValue('#rc-correos-DUO-1'), 'conta@despacho.mx, edgardo@x.mx');
    assert.equal(await page.inputValue('#rc-correos-DUO-2'), 'otra.contadora@despacho.mx');
    assert.equal(await page.inputValue('#rc-correos-LON-2'), '');
    assert.equal(await page.isChecked('.rc-caja[data-tienda="DUO"][data-caja="2"] .rc-activo'), true);
    assert.equal(await page.isChecked('.rc-caja[data-tienda="LON"][data-caja="2"] .rc-activo'), false);
    // Prueba de la Caja 2: la función recibe tienda y caja, y el aviso dice a qué correo llegó.
    await duo2.locator('.rc-probar').click();
    await page.waitForFunction(() => /te mandé a edgardo@x\.mx el reporte de lo que va del mes de DÚO New York · Caja 2 \(3 ticket\(s\), \$1,234\.00\)/.test(document.querySelector('.rc-caja[data-tienda="DUO"][data-caja="2"] .rc-msg')!.textContent!));
    assert.deepEqual(pruebasReporte.at(-1), { accion: 'prueba', tienda: 'DUO', caja: 2 });
    await page.evaluate(() => document.querySelector('#panel-contadora')!.scrollIntoView());
    await page.screenshot({ path: join(RAIZ, 'docs', 'capturas', '66-envio-contadora.png') });
    assert.deepEqual(errores, []);
  });
});
