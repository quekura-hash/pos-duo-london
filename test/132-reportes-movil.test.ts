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

async function preparar(t: { after: (f: () => unknown) => void }) {
  const dist = mkdtempSync(join(tmpdir(), 'londuo-admin-'));
  execFileSync(process.execPath, [join(RAIZ, 'scripts', 'construir-admin.mjs')], { stdio: 'pipe', env: { ...process.env, LONDUO_DIST: dist, LONDUO_SUPABASE_URL: URL_CENTRAL, LONDUO_SUPABASE_KEY: 'sb_publishable_prueba' } });
  const db = await centralLocal();
  const edgardo = await usuario(db, 'edgardo@x.mx', 'supervisor');
  // Ventas de hoy (hora local = UTC−7): DÚO caja 1 y 2 y London caja 1, con efectivo, tarjeta y dólares.
  const hoy = new Date(Date.now() - 7 * 3600_000).toISOString().slice(0, 10);
  let folio = 0;
  const venta = async (tienda: string, caja: number, pesos: number, pagos: object[]) => {
    const id = `v${++folio}`;
    const payload = { sale_id: id, tienda, caja, folio, cajero: 'Ana', lineas: [{ linea_id: `${id}-1`, item_id: 'i1', qty: 1, importe: pesos * 100, precio_unit: pesos * 100 }], total: pesos * 100, pagos };
    await db.query(`insert into pos.ops (op_id, tipo, tienda, caja, origen, ocurrio_en, payload) values ($1, 'sale.confirmed', $2, $3, $4, $5, $6::jsonb)`, [`sale.confirmed:${id}`, tienda, caja, `caja:${tienda}/${caja}`, `${hoy}T18:${String(10 + folio).padStart(2, '0')}:00Z`, JSON.stringify(payload)]);
  };
  await venta('DUO', 1, 1200, [{ metodo: 'efectivo', monto: 1200, recibido: 1500 * 100 / 100 * 1 }]);
  await venta('DUO', 1, 3450, [{ metodo: 'tarjeta', monto: 3450 * 100 }]);
  await venta('DUO', 2, 890, [{ metodo: 'efectivo', monto: 890 * 100 }]);
  await venta('LON', 1, 593, [{ metodo: 'efectivo', monto: 593 * 100 }]);
  const browser = await chromium.launch({ executablePath: chromiumPath, args: ['--no-sandbox'] });
  t.after(async () => { await browser.close(); rmSync(dist, { recursive: true, force: true }); });
  const abrir = async (opciones: Parameters<Browser['newContext']>[0]) => {
    const ctx = await browser.newContext(opciones);
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
    await irASeccion(page, 'reportes');
    await page.waitForSelector('#rd-total');
    return { page, errores };
  };
  return { abrir };
}
const y = (page: Page, sel: string) => page.evaluate((s) => Math.round(document.querySelector(s)!.getBoundingClientRect().top + window.scrollY), sel);

describe('[navegador real] Reportes en el teléfono: tres bloques claros', { timeout: 300_000, skip: chromiumPath ? false : 'Chromium no encontrado' }, () => {
  it('RP1 orden y jerarquía: Resumen del día (hero primero) › Filtros del reporte › Envíos mensuales; todo lo funcional sigue ahí', async (t) => {
    const { abrir } = await preparar(t);
    const { page, errores } = await abrir({ ...IPHONE, viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, colorScheme: 'light' });
    await page.waitForSelector('#filtros');
    const hayContadora = await page.locator('#panel-contadora .rc-caja').count();
    // Tres bloques, en ese orden, cada uno con su propia tarjeta.
    const ys = [await y(page, '#resumen-dia'), await y(page, '#filtros'), ...(hayContadora ? [await y(page, '#panel-contadora')] : [])];
    assert.deepEqual([...ys].sort((a, b) => a - b), ys, `orden de los bloques: ${ys}`);
    // 1 · Resumen: el dato más importante es la venta total del día; el hero va antes que las tiendas y es el texto más grande.
    assert.match((await page.textContent('#rd-venta-total'))!, /VENTAS NETAS · \d\d\/\d\d\/\d{4}[\s\S]*4 tickets/);
    assert.equal(await page.textContent('#rd-total'), '$6,133.00');
    const tam = await page.evaluate(() => { const f = (s: string) => parseFloat(getComputedStyle(document.querySelector(s)!).fontSize); return { hero: f('#rd-total'), tienda: f('#rd-tiendas .kpi > b'), cobro: f('#rd-efectivo'), titulo: f('#resumen-dia h2') }; });
    assert.ok(tam.hero >= 40 && tam.hero > tam.tienda && tam.tienda > tam.cobro && tam.hero > tam.titulo * 2, JSON.stringify(tam));
    const yHero = await y(page, '#rd-venta-total'), yTiendas = await y(page, '#rd-tiendas'), yCobro = await y(page, '.kpi-cobro'), yCajas = await y(page, '#rd-por-caja'), yCambios = await y(page, '.panel-resumen');
    assert.deepEqual([yHero, yTiendas, yCobro, yCajas, yCambios].sort((a, b) => a - b), [yHero, yTiendas, yCobro, yCajas, yCambios]);
    // Todo lo que ya existía en el resumen sigue presente (mismos ids y datos).
    for (const id of ['#rd-efectivo', '#rd-pesos', '#rd-dolares', '#rd-tarjeta', '#rd-cambio', '#rd-devoluciones', '#rd-retiros', '#rd-gastos', '#rd-fecha']) assert.equal(await page.locator(id).count(), 1, id);
    assert.equal((await page.textContent('#rd-tiendas [data-tienda="DUO"] [data-col="venta"]'))!.trim(), '$5,540.00');
    assert.equal(await page.locator('#rd-por-caja .caja-detalle').count(), 4);
    assert.equal(await page.locator('#rd-por-caja .caja-detalle .ic').count() > 8, true, 'las filas llevan iconos');
    // 2 · Filtros: encabezado propio, cajas, rango de fechas, histórico y acciones (Consultar es el botón principal).
    assert.equal(await page.textContent('#filtros .sec-cab h2'), 'Filtros del reporte');
    assert.match((await page.textContent('#filtros .sec-sub'))!, /Define las cajas y el periodo a consultar/);
    assert.deepEqual(await page.$$eval('#filtros .filtro-cajas label', (l) => l.map((x) => x.textContent!.trim())), ['Todas', 'DUO · Caja 1', 'DUO · Caja 2', 'LON · Caja 1', 'LON · Caja 2']);
    assert.equal(await page.locator('#desde').isVisible(), true); assert.equal(await page.locator('#hasta').isVisible(), true);
    assert.match((await page.textContent('#filtros .check-hist'))!, /Incluir ventas del POS anterior \(históricas\)/);
    assert.deepEqual(await page.$$eval('.acciones-reporte .btn span', (b) => b.map((x) => x.textContent)), ['Consultar', 'Exportar a Excel (contadora)', 'Importar ventas del POS anterior', 'Revisar ventas duplicadas']);
    const cajas = await page.$$eval('.acciones-reporte .btn', (b) => b.map((x) => { const r = x.getBoundingClientRect(); return { w: Math.round(r.width), h: Math.round(r.height), fondo: getComputedStyle(x).backgroundImage !== 'none' }; }));
    assert.ok(cajas.every((c) => c.w >= 150 && c.h >= 52) && cajas[0]!.fondo && cajas.slice(1).every((c) => !c.fondo), `acciones táctiles y Consultar destacado: ${JSON.stringify(cajas)}`);
    // La selección de cajas y la consulta siguen funcionando con el nuevo diseño.
    await page.uncheck('#todas');
    assert.equal(await page.locator('.filtro-cajas .caja:checked').count(), 0);
    await page.click('#filtros button[type="submit"]');
    await page.waitForFunction(() => /Seleccione al menos una caja/.test(document.querySelector('#resultado')?.textContent ?? ''));
    await page.check('.filtro-cajas .caja[value="DUO/1"]');
    await page.click('#filtros button[type="submit"]');
    await page.waitForSelector('#tabla-reporte');
    assert.equal((await page.textContent('#total-consolidado'))!.trim(), '$4,650.00');
    await page.check('#todas');
    assert.equal(await page.locator('.filtro-cajas .caja:checked').count(), 4);
    // 3 · Envíos mensuales (cuando hay envío configurable): una tarjeta por caja y el Especial con identidad propia.
    if (hayContadora) {
      assert.equal(await page.textContent('#panel-contadora .sec-cab h2'), 'Envío mensual a la contadora');
      assert.equal(await page.locator('#panel-contadora .rc-puntos li').count(), 4, 'el texto largo ahora son 4 puntos');
      assert.equal(await page.locator('#panel-contadora fieldset.rc-caja:not(.rc-especial)').count(), 4);
      assert.equal(await page.locator('#rc-especial fieldset.rc-especial').count(), 2);
      assert.match((await page.textContent('#rc-especial h3'))!, /Reporte Especial Caja 1/);
      const f = page.locator('fieldset.rc-caja:not(.rc-especial)').first();
      assert.equal(await f.locator('.rc-guardar, .rc-probar').count(), 2);
      const botones = await f.locator('.rc-guardar, .rc-probar').evaluateAll((b) => b.map((x) => { const r = x.getBoundingClientRect(); return [Math.round(r.width), Math.round(r.height), Math.round(r.top)]; }));
      assert.ok(botones[0]![0] === botones[1]![0] && botones[0]![1] === botones[1]![1] && botones[0]![2] === botones[1]![2], `Guardar y Enviarme una prueba alineados: ${JSON.stringify(botones)}`);
      // el interruptor y el correo se siguen usando igual
      await f.locator('.rc-activo').check(); assert.equal(await f.locator('.rc-activo').isChecked(), true);
      await f.locator('.rc-correos').fill('malo');
      await f.locator('.rc-guardar').click();
      await page.waitForFunction(() => /Revisa estos correos: malo/.test(document.querySelector('.rc-msg')?.textContent ?? ''));
    }
    // Capturas de los tres bloques (para compararlas con las referencias).
    for (const [sel, nombre] of [['#resumen-dia', 'resumen'], ['#filtros', 'filtros'], ['#panel-contadora', 'envios']] as const) {
      if (await page.locator(sel).count()) { await page.locator(sel).scrollIntoViewIfNeeded(); await page.locator(sel).screenshot({ path: join(RAIZ, 'docs', 'capturas', `reportes-${nombre}.png`) }); }
    }
    assert.deepEqual(errores, []);
  });

  it('RP2 sin desbordes ni recortes en 320, 375, 390 y 430 px, en claro y oscuro, y el escritorio no cambia de forma', async (t) => {
    const { abrir } = await preparar(t);
    for (const [ancho, esquema] of [[320, 'dark'], [375, 'light'], [390, 'dark'], [430, 'light']] as const) {
      const { page, errores } = await abrir({ ...IPHONE, viewport: { width: ancho, height: 740 }, deviceScaleFactor: 2, colorScheme: esquema });
      await page.waitForSelector('#filtros');
      const r = await page.evaluate(() => {
        const malos = [...document.querySelectorAll('#resumen-dia *, #filtros *, #panel-contadora *')].filter((e) => { const b = e.getBoundingClientRect(); return b.width > 0 && (b.right > window.innerWidth + 1 || b.left < -1) && !e.closest('.tabla-cont'); }).slice(0, 4).map((e) => `${e.tagName.toLowerCase()}${e.id ? '#' + e.id : ''}.${String(e.className).slice(0, 24)}`);
        const cortos = [...document.querySelectorAll('.acciones-reporte .btn, .rc-caja .btn, .isla-btn')].filter((e) => e.scrollWidth > e.clientWidth + 1 || e.scrollHeight > e.clientHeight + 1).map((e) => e.textContent!.trim());
        return { pagina: document.documentElement.scrollWidth, ventana: window.innerWidth, malos, cortos };
      });
      r.malos.push(...(r.ventana !== ancho ? [`la pantalla se ensanchó a ${r.ventana}`] : []));
      assert.ok(r.pagina <= r.ventana + 1 && r.malos.length === 0, `${ancho}px sin desborde: ${JSON.stringify(r)}`);
      assert.deepEqual(r.cortos, [], `${ancho}px: botones con texto recortado`);
      assert.deepEqual(errores, []);
    }
    // Escritorio: sin iconos ni encabezados decorativos nuevos (se ve como antes).
    const { page } = await abrir({ viewport: { width: 1280, height: 900 }, colorScheme: 'light' });
    await page.waitForSelector('#filtros');
    assert.equal(await page.locator('#filtros .sec-cab').isVisible(), false, 'el encabezado nuevo de Filtros es solo del teléfono');
    assert.equal(await page.locator('#rd-por-caja .caja-detalle .ic').first().isVisible(), false, 'iconos decorativos ocultos en escritorio');
    assert.equal(await page.locator('#resumen-dia .sec-sub').isVisible(), false);
  });
});
