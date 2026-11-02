import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { chromium, devices, type Browser, type Page } from 'playwright-core';
import { centralLocal, usuario } from './ayudas/central-pglite.ts';
import { simularSupabase, URL_CENTRAL } from './ayudas/supabase-simulado.ts';
import { irASeccion } from './ayudas/navegacion.ts';

const RAIZ = join(import.meta.dirname, '..');
const chromiumPath = [process.env.POS_CHROMIUM, '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', '/opt/pw-browsers/chromium/chrome-linux/chrome'].find((p) => p && existsSync(p));

const { defaultBrowserType: _omitido, ...IPHONE } = devices['iPhone 13']!;
void _omitido;
const VIEWPORT_PRO_MAX = { width: 440, height: 956 };

async function preparar(t: { after: (f: () => unknown) => void }) {
  const dist = mkdtempSync(join(tmpdir(), 'londuo-admin-'));
  execFileSync(process.execPath, [join(RAIZ, 'scripts', 'construir-admin.mjs')], { stdio: 'pipe', env: { ...process.env, LONDUO_DIST: dist, LONDUO_SUPABASE_URL: URL_CENTRAL, LONDUO_SUPABASE_KEY: 'sb_publishable_prueba' } });
  const db = await centralLocal();
  const edgardo = await usuario(db, 'edgardo@x.mx', 'supervisor');
  let folio = 0;
  const op = (tipo: string, id: string, tienda: string, caja: number, fecha: string, hora: string, payload: object) =>
    db.query(`insert into pos.ops (op_id, tipo, tienda, caja, origen, ocurrio_en, payload) values ($1, $2, $3, $4, $5, $6, $7::jsonb)`, [`${tipo}:${id}`, tipo, tienda, caja, `caja:${tienda}/${caja}`, new Date(Date.parse(`${fecha}T${hora}:00Z`) + 7 * 3600_000).toISOString(), JSON.stringify(payload)]);
  const venta = async (fecha: string, hora: string, pesos: number, tienda = 'DUO', caja = 1, vendedora = 'Ana') => {
    const id = `v${++folio}`;
    await op('sale.confirmed', id, tienda, caja, fecha, hora, { sale_id: id, tienda, caja, folio, cajero: 'Caja', vendedora_id: `id-${vendedora}`, vendedora, lineas: [{ linea_id: `${id}-1`, item_id: 'i1', qty: 1, importe: pesos * 100, precio_unit: pesos * 100, descripcion: 'Bolsa cruzada piel', marca: 'DUO' }], total: pesos * 100, pagos: [{ metodo: 'efectivo', monto: pesos * 100 }] });
    return id;
  };
  // 14/10: cinco tickets en DUO·Caja 1 (total $5,631.00, promedio $1,126.20).
  for (const [h, p] of [['10:05', 1200], ['11:20', 1500], ['13:40', 1000], ['16:15', 931], ['18:30', 1000]] as const) await venta('2026-10-14', h, p);
  // 15/10: DUO·Caja 2 con $800 y una devolución de $300 (neto $500, 1 ticket); y una venta que luego se cancela (no cuenta).
  const v2 = await venta('2026-10-15', '12:00', 800, 'DUO', 2, 'Bea');
  await op('return.registered', 'd1', 'DUO', 2, '2026-10-15', '15:00', { return_id: 'd1', sale_id: v2, tienda: 'DUO', caja: 2, folio: 99, importe: 30000, lineas: [{ linea_id: `${v2}-1`, qty: 1, importe: 30000 }], motivo: 'x', reembolsos: [{ metodo: 'efectivo', monto: 30000 }] });
  // 16/10: un retiro y un gasto para verlos con datos.
  await op('cash.retiro', 'r1', 'DUO', 1, '2026-10-16', '17:00', { tienda: 'DUO', caja: 1, folio_retiro: 'D1-R0001', usuario: 'Ana', mxn: { total: 500000 }, equivalente_mxn: 500000, retiro_id: 'r1' });
  await op('cash.gasto', 'g1', 'DUO', 1, '2026-10-16', '17:30', { tienda: 'DUO', caja: 1, folio_gasto: 'D1-G0001', usuario: 'Ana', concepto: 'Limpieza', recibio: 'Rosa', autorizado_por: 'Edgardo', monto: 25000, gasto_id: 'g1' });
  const browser = await chromium.launch({ executablePath: chromiumPath, args: ['--no-sandbox'] });
  t.after(async () => { await browser.close(); rmSync(dist, { recursive: true, force: true }); });
  const abrir = async (opciones: Parameters<Browser['newContext']>[0]) => {
    const ctx = await browser.newContext({ acceptDownloads: true, ...opciones });
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
    await irASeccion(page, 'historial');
    await page.waitForSelector('#ha-filtros');
    return { page, errores };
  };
  return { abrir };
}
const consultar = async (page: Page, desde: string, hasta: string, caja = '') => {
  await page.fill('#ha-desde', desde); await page.fill('#ha-hasta', hasta); await page.selectOption('#ha-caja', caja);
  await page.click('#ha-consultar');
  await page.waitForFunction(([d, h]) => !!document.querySelector('#ha-resultado .panel-seccion') && (document.querySelector('#ha-desde') as HTMLInputElement).value === d && (document.querySelector('#ha-hasta') as HTMLInputElement).value === h, [desde, hasta]);
  await page.waitForTimeout(150);
};
const resumen = (page: Page) => page.evaluate(() => ({ total: document.querySelector('#ha-total')!.textContent, tickets: document.querySelector('#ha-tickets')!.textContent, promedio: document.querySelector('#ha-promedio')!.textContent }));
const sinDesborde = (page: Page, ancho: number) => page.evaluate((w) => ({ sw: document.documentElement.scrollWidth, iw: window.innerWidth, w }), ancho);

describe('[navegador real] Historial de ventas en el teléfono', { timeout: 300_000, skip: chromiumPath ? false : 'Chromium no encontrado' }, () => {
  for (const esquema of ['light', 'dark'] as const) {
    it(`HM1 (${esquema}) filtros, resumen real, filas compactas, retiros y gastos; sin Origen ni Folio; sin desborde (iPhone Pro Max, 440 px)`, async (t) => {
      const { abrir } = await preparar(t);
      const { page, errores } = await abrir({ ...IPHONE, viewport: VIEWPORT_PRO_MAX, deviceScaleFactor: 2, colorScheme: esquema });
      // Origen y Folio ya no están en la pantalla; Desde / Hasta / Caja / Consultar sí.
      assert.equal(await page.locator('#ha-origen, #ha-folio').count(), 0);
      assert.deepEqual(await page.$$eval('#ha-filtros label', (l) => l.map((x) => x.firstChild!.textContent!.trim())), ['Desde', 'Hasta', 'Caja']);
      assert.equal((await page.textContent('#ha-consultar'))!.trim(), 'Consultar');
      assert.equal(await page.locator('#ha-consultar svg').count(), 1);
      assert.deepEqual(await page.$$eval('#ha-caja option', (o) => o.map((x) => (x as HTMLOptionElement).value)), ['', 'DUO/1', 'DUO/2', 'LON/1', 'LON/2']);
      // — Resumen real: cinco tickets, $5,631.00, promedio $1,126.20.
      await consultar(page, '2026-10-14', '2026-10-14');
      assert.deepEqual(await resumen(page), { total: '$5,631.00', tickets: '5', promedio: '$1,126.20' });
      assert.equal(await page.locator('#lista-historial-admin .fila-venta').count(), 5);
      // — Fila: folio+hora a la izquierda, importe a la derecha; tienda/caja/artículo; fecha y forma de pago; chevron.
      const fila = page.locator('#lista-historial-admin .fila-venta').first();
      const txt = (await fila.innerText()).replace(/\s+/g, ' ');
      assert.match(txt, /D1-\d{6} · \d{1,2}:\d\d (AM|PM)[\s\S]*\$\d[\d,]*\.\d\d/);
      assert.match(txt, /DUO · Caja 1 · Bolsa cruzada piel/);
      assert.match(txt, /14\/10\/2026 Efectivo/);
      assert.equal(await fila.locator('.fi-flecha svg').count(), 1);
      const caja = await fila.evaluate((e) => { const r = e.getBoundingClientRect(); return { h: r.height, w: r.width }; });
      assert.ok(caja.h >= 56 && caja.h <= 120, `alto de fila ${caja.h}`);
      // — Caja 2 + devolución: resta del total (neto $500.00, 1 ticket); la cancelada no existe aquí.
      await consultar(page, '2026-10-15', '2026-10-15', 'DUO/2');
      assert.deepEqual(await resumen(page), { total: '$500.00', tickets: '1', promedio: '$500.00' });
      await consultar(page, '2026-10-15', '2026-10-15', 'DUO/1');
      assert.deepEqual(await resumen(page), { total: '$0.00', tickets: '0', promedio: '$0.00' });
      assert.match((await page.textContent('#ha-resultado'))!, /No hay ventas con esos datos/);
      // — Estados vacíos de Retiros y Gastos, sin pegarse a la cabecera de la tabla.
      assert.equal((await page.textContent('#vacio-retiros'))!.trim(), 'Sin retiros en el periodo.');
      assert.equal((await page.textContent('#vacio-gastos'))!.trim(), 'Sin gastos en el periodo.');
      assert.ok(!/CajaSin/.test(await page.innerText('#panel-retiros')) && !/CajaSin/.test(await page.innerText('#panel-gastos')));
      await page.screenshot({ path: join(RAIZ, 'docs', 'capturas', `historial-movil-vacio-${esquema}.png`), fullPage: true });
      // — Retiros y gastos con datos conservan sus filas y totales.
      await consultar(page, '2026-10-16', '2026-10-16');
      assert.match(await page.innerText('#panel-retiros'), /D1-R0001[\s\S]*Ana[\s\S]*\$5,000\.00/);
      assert.match(await page.innerText('#panel-gastos'), /D1-G0001[\s\S]*Limpieza[\s\S]*Rosa[\s\S]*\$250\.00/);
      assert.equal(await page.locator('#vacio-retiros, #vacio-gastos').count(), 0);
      assert.deepEqual(await resumen(page), { total: '$0.00', tickets: '0', promedio: '$0.00' }, 'retiros y gastos no son ventas');
      // — Detalle desde una fila (flujo intacto).
      await consultar(page, '2026-10-14', '2026-10-14');
      await page.locator('#lista-historial-admin .fila-venta').first().click();
      await page.waitForSelector('#dlg-detalle-venta[open]');
      await page.click('#dv-cerrar');
      // — Sin desborde horizontal real y la isla sigue visible sin tapar el contenido final.
      const d = await sinDesborde(page, 440);
      assert.ok(d.sw <= 440 && d.iw === 440, JSON.stringify(d));
      await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
      assert.ok(await page.locator('#isla').isVisible(), 'la isla de navegación sigue ahí');
      const solapa = await page.evaluate(() => { const i = document.querySelector('#isla')!.getBoundingClientRect(); const u = [...document.querySelectorAll('#ha-resultado .panel')].at(-1)!.getBoundingClientRect(); return u.bottom - i.top; });
      assert.ok(solapa <= 1, `el último panel queda por encima de la isla (${solapa}px)`);
      await page.evaluate(() => window.scrollTo(0, 0));
      await page.screenshot({ path: join(RAIZ, 'docs', 'capturas', `historial-movil-${esquema}.png`) });
      assert.deepEqual(errores, []);
    });
  }
  it('HM2 teléfono pequeño (iPhone SE, 320 px) sin desborde y en escritorio sigue la tabla', async (t) => {
    const { abrir } = await preparar(t);
    const peq = await abrir({ ...IPHONE, viewport: { width: 320, height: 568 }, deviceScaleFactor: 2 });
    await consultar(peq.page, '2026-10-14', '2026-10-14');
    const d = await sinDesborde(peq.page, 320);
    assert.ok(d.sw <= 320 && d.iw === 320, JSON.stringify(d));
    const esc = await abrir({ viewport: { width: 1366, height: 900 } });
    await consultar(esc.page, '2026-10-14', '2026-10-14');
    assert.equal(await esc.page.locator('#tabla-historial-admin tr[data-detalle]').count(), 5);
    assert.equal(await esc.page.locator('#lista-historial-admin').isVisible(), false);
    assert.deepEqual(await resumen(esc.page), { total: '$5,631.00', tickets: '5', promedio: '$1,126.20' });
  });
});
