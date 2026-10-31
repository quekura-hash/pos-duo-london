import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { chromium, devices, type Page } from 'playwright-core';
import { centralLocal, usuario } from './ayudas/central-pglite.ts';
import { simularSupabase, URL_CENTRAL } from './ayudas/supabase-simulado.ts';

const RAIZ = join(import.meta.dirname, '..');
const chromiumPath = [process.env.POS_CHROMIUM, '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', '/opt/pw-browsers/chromium/chrome-linux/chrome'].find((p) => p && existsSync(p));
const { defaultBrowserType: _omitido, ...IPHONE } = devices['iPhone 13']!;
void _omitido;

describe('[navegador real] Análisis por empleada', { timeout: 240_000, skip: chromiumPath ? false : 'Chromium no encontrado' }, () => {
  it('AE5 desglose por empleada: apilada, una por empleada, ranking, matriz, año y iPhone', async (t) => {
    const dist = mkdtempSync(join(tmpdir(), 'londuo-admin-'));
    execFileSync(process.execPath, [join(RAIZ, 'scripts', 'construir-admin.mjs')], { stdio: 'pipe', env: { ...process.env, LONDUO_DIST: dist, LONDUO_SUPABASE_URL: URL_CENTRAL, LONDUO_SUPABASE_KEY: 'sb_publishable_prueba' } });
    const db = await centralLocal();
    const edgardo = await usuario(db, 'edgardo@x.mx', 'supervisor');
    let folio = 0;
    const venta = async (fechaLocal: string, hora: string, pesos: number, vendedora: string) => {
      const utc = new Date(Date.parse(`${fechaLocal}T${hora}:00Z`) + 7 * 3600_000).toISOString();
      const id = `v${++folio}`;
      const payload = { sale_id: id, tienda: 'DUO', caja: 1, folio, cajero: 'Caja', vendedora_id: `id-${vendedora}`, vendedora, lineas: [{ linea_id: `${id}-1`, item_id: 'i1', qty: 1, importe: pesos * 100, precio_unit: pesos * 100 }], total: pesos * 100, pagos: [{ metodo: 'efectivo', monto: pesos * 100 }] };
      await db.query(`insert into pos.ops (op_id, tipo, tienda, caja, origen, ocurrio_en, payload) values ($1, 'sale.confirmed', 'DUO', 1, 'caja:DUO/1', $2, $3::jsonb)`, [`sale.confirmed:${id}`, utc, JSON.stringify(payload)]);
    };
    await venta('2026-03-02', '10:00', 1000, 'Ana'); await venta('2026-03-02', '11:00', 500, 'Bea'); await venta('2026-03-03', '10:00', 700, 'Ana'); await venta('2026-04-06', '11:00', 300, 'Bea');
    const browser = await chromium.launch({ executablePath: chromiumPath, args: ['--no-sandbox'] });
    t.after(async () => { await browser.close(); rmSync(dist, { recursive: true, force: true }); });
    const abrir = async (movil: boolean) => {
      const ctx = await browser.newContext(movil ? { ...IPHONE, deviceScaleFactor: 2 } : { viewport: { width: 1280, height: 1000 } });
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
      await page.selectOption('#an-desglose', 'empleada');
      await page.waitForSelector('#an-ranking');
      return { page, errores };
    };
    const { page, errores } = await abrir(false);
    const ranking = await page.$$eval('#an-ranking tbody tr:not(.fila-total)', (r) => r.map((x) => [...x.querySelectorAll('td')].map((c) => c.textContent!.trim())));
    assert.deepEqual(ranking.map((f) => [f[0], f[2], f[4], f[6]]), [['Ana', '2', '$1,700.00', '68%'], ['Bea', '2', '$800.00', '32%']]);
    assert.equal(await page.locator('#an-grafica-emp .gb').count(), 12, 'por mes: 12 meses');
    assert.equal(await page.locator('#an-grafica-emp .gb .gs').count(), 3, 'marzo: Ana y Bea; abril: Bea');
    await page.screenshot({ path: join(RAIZ, 'docs', 'capturas', 'analisis-empleadas-apilada.png'), fullPage: true });
    // Una gráfica por empleada.
    await page.selectOption('#an-vista', 'separadas');
    await page.waitForSelector('#an-emp-grid');
    assert.equal(await page.locator('.an-emp-card').count(), 2);
    // Por año y por día (con rango de marzo).
    await page.selectOption('#an-agrupar', 'anio');
    await page.waitForFunction(() => /Total/.test(document.querySelector('#an-matriz thead')?.textContent ?? '') && document.querySelectorAll('#an-matriz thead th').length === 3);
    await page.selectOption('#an-rango', 'mes'); await page.fill('#an-mes', '2026-03'); await page.dispatchEvent('#an-mes', 'change');
    await page.selectOption('#an-agrupar', 'dia');
    await page.waitForFunction(() => document.querySelectorAll('#an-matriz thead th').length === 33);
    // Tickets en vez de pesos; y las opciones no válidas ya no están.
    await page.selectOption('#an-metrica', 'tickets');
    assert.deepEqual((await page.$$eval('#an-agrupar option', (o) => o.map((x) => (x as HTMLOptionElement).value))).sort(), ['anio', 'dia', 'mes', 'semana'], 'por empleada solo día, semana, mes y año');
    assert.deepEqual(await page.$$eval('#an-metrica option', (o) => o.map((x) => (x as HTMLOptionElement).value)), ['total', 'tickets', 'piezas']);
    await page.selectOption('#an-desglose', 'todo');
    await page.waitForSelector('#an-tabla');
    assert.equal(errores.length, 0, errores.join(' | '));
    const m = await abrir(true);
    const ancho = await m.page.evaluate(() => ({ pagina: document.documentElement.scrollWidth, ventana: window.innerWidth }));
    assert.ok(ancho.pagina <= ancho.ventana + 1, `iPhone sin desborde horizontal: ${JSON.stringify(ancho)}`);
    await m.page.screenshot({ path: join(RAIZ, 'docs', 'capturas', 'analisis-empleadas-iphone.png'), fullPage: true });
    assert.equal(m.errores.length, 0, m.errores.join(' | '));
  });
});
