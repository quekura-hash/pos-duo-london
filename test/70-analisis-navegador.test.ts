import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { chromium, devices, type Page } from 'playwright-core';
import { centralLocal, usuario } from './ayudas/central-pglite.ts';
import { simularSupabase, URL_CENTRAL } from './ayudas/supabase-simulado.ts';
import { leerXlsxNode } from '../src/xlsx-node.ts';

const RAIZ = join(import.meta.dirname, '..');
const chromiumPath = [process.env.POS_CHROMIUM, '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', '/opt/pw-browsers/chromium/chrome-linux/chrome'].find((p) => p && existsSync(p));
const { defaultBrowserType: _omitido, ...IPHONE } = devices['iPhone 13']!;
void _omitido;

describe('[navegador real] Análisis de ventas', { timeout: 240_000, skip: chromiumPath ? false : 'Chromium no encontrado' }, () => {
  it('AN8 por mes, semana, hora y mapa de calor; fechas y cajas; Excel; y en el iPhone sin desbordes', async (t) => {
    const dist = mkdtempSync(join(tmpdir(), 'londuo-admin-'));
    execFileSync(process.execPath, [join(RAIZ, 'scripts', 'construir-admin.mjs')], { stdio: 'pipe', env: { ...process.env, LONDUO_DIST: dist, LONDUO_SUPABASE_URL: URL_CENTRAL, LONDUO_SUPABASE_KEY: 'sb_publishable_prueba' } });
    const db = await centralLocal();
    const edgardo = await usuario(db, 'edgardo@x.mx', 'supervisor');
    // Ventas de 2026 (hora local = UTC−7): marzo (lun 2: 9:15 y 10:30; mar 3: 10:45; lun 9: 17:20) y abril (lun 6: 11:00) en DÚO Caja 1; una de London Caja 2 el 4 de marzo a las 14:00.
    let folio = 0;
    const venta = async (fechaLocal: string, hora: string, pesos: number, tienda = 'DUO', caja = 1) => {
      const utc = new Date(Date.parse(`${fechaLocal}T${hora}:00Z`) + 7 * 3600_000).toISOString();
      const id = `v${++folio}`;
      const payload = { sale_id: id, tienda, caja, folio, cajero: 'Ana', lineas: [{ linea_id: `${id}-1`, item_id: 'i1', qty: 1, importe: pesos * 100, precio_unit: pesos * 100 }], total: pesos * 100, pagos: [{ metodo: 'efectivo', monto: pesos * 100 }] };
      await db.query(`insert into pos.ops (op_id, tipo, tienda, caja, origen, ocurrio_en, payload) values ($1, 'sale.confirmed', $2, $3, $4, $5, $6::jsonb)`, [`sale.confirmed:${id}`, tienda, caja, `caja:${tienda}/${caja}`, utc, JSON.stringify(payload)]);
    };
    await venta('2026-03-02', '09:15', 1000); await venta('2026-03-02', '10:30', 500); await venta('2026-03-03', '10:45', 700); await venta('2026-03-09', '17:20', 2000);
    await venta('2026-04-06', '11:00', 300); await venta('2026-03-04', '14:00', 400, 'LON', 2);
    await db.query(`insert into pos.ops (op_id, tipo, tienda, caja, origen, ocurrio_en, payload) values ('hist:DUO/1:52346', 'venta.historica', null, null, 'admin', now(), $1::jsonb)`, [JSON.stringify({ hist_id: 'hist:DUO/1:52346', tienda_hist: 'DUO', caja_hist: 1, folio: 52346, fecha: '2026-09-02', tipo_hist: 'venta', piezas: 1, total: 150000, pago: 'tarjeta', pago_original: 'Credit Card', fuente: 'POS anterior' })]);

    const browser = await chromium.launch({ executablePath: chromiumPath, args: ['--no-sandbox'] });
    t.after(async () => { await browser.close(); rmSync(dist, { recursive: true, force: true }); });
    const abrir = async (movil: boolean) => {
      const ctx = await browser.newContext(movil ? { ...IPHONE, deviceScaleFactor: 2 } : { viewport: { width: 1280, height: 1000 }, acceptDownloads: true });
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
      await page.click('#nav button[data-vista="analisis"]');
      await page.waitForSelector('#an-resultado .an-kpis');
      await page.selectOption('#an-anio', '2026');
      return { page, errores };
    };
    const filas = (page: Page) => page.$$eval('#an-tabla tbody tr:not(.fila-total)', (r) => r.map((x) => [...x.querySelectorAll('td')].map((c) => c.textContent!.trim())));

    const { page, errores } = await abrir(false);
    // Por mes (2026): 12 meses, septiembre con la histórica, marzo el más alto.
    await page.waitForFunction(() => document.querySelectorAll('#an-tabla tbody tr:not(.fila-total)').length === 12);
    assert.equal(await page.locator('#an-grafica .gb').count(), 12);
    const mar = (await filas(page))[2]!;
    assert.deepEqual([mar[0], mar[2], mar[4]], ['marzo 2026', '5', '$4,600.00'], 'marzo: 4 de DÚO Caja 1 y 1 de London Caja 2');
    assert.match((await filas(page))[8]!.join(' '), /septiembre 2026.*\$1,500\.00/, 'la histórica entra en septiembre');
    assert.equal(await page.locator('#an-grafica .gb.mejor .gb-eti').textContent(), 'mar', 'la barra del mejor mes va resaltada');
    assert.match((await page.textContent('.an-kpis'))!, /Mejor mes.*marzo 2026.*\$4,600\.00/);
    // Solo DÚO Caja 1 (se quita lo demás) y sin históricas.
    await page.uncheck('#an-todas');
    await page.check('.an-caja[value="DUO/1"]');
    await page.waitForFunction(() => /\$4,200\.00/.test(document.querySelectorAll('#an-tabla tbody tr')[2]!.textContent!));
    await page.uncheck('#an-hist');
    await page.waitForFunction(() => !/\$1,500\.00/.test(document.querySelectorAll('#an-tabla tbody tr')[8]!.textContent!));
    // Por hora de marzo: 9 a 17 h sin huecos.
    await page.selectOption('#an-rango', 'mes'); await page.fill('#an-mes', '2026-03'); await page.dispatchEvent('#an-mes', 'change');
    await page.selectOption('#an-agrupar', 'hora');
    await page.waitForFunction(() => document.querySelectorAll('#an-tabla tbody tr:not(.fila-total)').length === 9);
    const horas = await filas(page);
    assert.deepEqual(horas.map((f) => f[0]), ['9:00 – 10:00', '10:00 – 11:00', '11:00 – 12:00', '12:00 – 13:00', '13:00 – 14:00', '14:00 – 15:00', '15:00 – 16:00', '16:00 – 17:00', '17:00 – 18:00']);
    assert.deepEqual([horas[0]![2], horas[0]![4], horas[1]![2], horas[1]![4], horas[8]![4]], ['1', '$1,000.00', '2', '$1,200.00', '$2,000.00']);
    assert.equal(await page.locator('#an-grafica .gb.mejor .gb-eti').textContent(), '17h');
    // Por semana de todo el año: Sem 10 (2–8 mar) es la más alta con $2,200 (Sem 11 trae $2,000).
    await page.selectOption('#an-rango', 'anio'); await page.selectOption('#an-agrupar', 'semana');
    await page.waitForFunction(() => document.querySelectorAll('#an-tabla tbody tr:not(.fila-total)').length >= 52);
    assert.match((await page.textContent('.an-kpis'))!, /Mejor semana.*Sem 10 · 2–8 mar.*\$2,200\.00/);
    assert.equal(await page.locator('#an-tabla tr.fila-mejor td').first().textContent(), 'Sem 10 · 2–8 mar');
    // Mapa de calor: lunes a las 9 h = $1,000; lunes a las 17 h = $2,000 (lunes 9 de marzo).
    await page.selectOption('#an-agrupar', 'mapa_calor');
    await page.waitForSelector('#an-calor');
    const celda = (dia: number, hora: number) => page.evaluate(([d, h]) => { const t = document.querySelector('#an-calor')!; const col = [...t.querySelectorAll('thead th')].findIndex((x) => x.textContent === `${h}h`); return Number(t.querySelectorAll('tbody tr')[d!]!.querySelectorAll('td')[col - 1]!.getAttribute('data-v')); }, [dia, hora]);
    assert.deepEqual([await celda(0, 9), await celda(0, 17), await celda(1, 10)], [100000, 200000, 70000]);
    await page.screenshot({ path: join(RAIZ, 'docs', 'capturas', '67-analisis-mapa-calor.png') });
    await page.selectOption('#an-agrupar', 'dia_semana');
    await page.waitForFunction(() => document.querySelectorAll('#an-tabla tbody tr:not(.fila-total)').length === 7);
    await page.selectOption('#an-agrupar', 'mes');
    await page.waitForFunction(() => document.querySelectorAll('#an-tabla tbody tr:not(.fila-total)').length === 12);
    await page.screenshot({ path: join(RAIZ, 'docs', 'capturas', '68-analisis-por-mes.png') });
    // Excel de lo que se ve.
    const [descarga] = await Promise.all([page.waitForEvent('download'), page.click('#an-excel')]);
    assert.equal(descarga.suggestedFilename(), 'analisis-de-ventas-mes.xlsx');
    const ruta = join(dist, 'a.xlsx');
    await descarga.saveAs(ruta);
    const hojas = await leerXlsxNode(readFileSync(ruta));
    assert.equal(hojas[0]!.nombre, 'Ventas por mes');
    assert.equal(hojas[0]!.filas.find((f) => String(f[0]).startsWith('marzo'))![5], 4200);
    assert.deepEqual(errores, []);

    // iPhone: la pantalla cabe y la gráfica se desliza dentro de su caja, no la página.
    const m = await abrir(true);
    await m.page.selectOption('#an-agrupar', 'dia');
    await m.page.waitForFunction(() => document.querySelectorAll('#an-tabla tbody tr:not(.fila-total)').length >= 365);
    const ancho = await m.page.evaluate(() => ({ pagina: document.documentElement.scrollWidth, ventana: window.innerWidth, grafica: (document.querySelector('.grafica-cont') as HTMLElement).scrollWidth > (document.querySelector('.grafica-cont') as HTMLElement).clientWidth }));
    assert.ok(ancho.pagina <= ancho.ventana + 1, `la página no se desborda (${ancho.pagina} > ${ancho.ventana})`);
    assert.equal(ancho.grafica, true, 'la gráfica de 365 días se desliza por dentro');
    await m.page.selectOption('#an-agrupar', 'mes');
    await m.page.waitForFunction(() => document.querySelectorAll('#an-tabla tbody tr:not(.fila-total)').length === 12);
    assert.ok((await m.page.evaluate(() => document.documentElement.scrollWidth)) <= 391);
    assert.equal(await m.page.locator('#an-l-desde').isVisible(), false, 'las fechas a elegir solo salen con «Fechas a elegir»');
    await m.page.evaluate(() => document.querySelector('#an-resultado')!.scrollIntoView());
    await m.page.screenshot({ path: join(RAIZ, 'docs', 'capturas', '69-movil-analisis.png') });
    assert.deepEqual(m.errores, []);
  });
});
