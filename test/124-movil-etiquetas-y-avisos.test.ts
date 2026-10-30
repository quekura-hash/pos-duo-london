import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { chromium, devices } from 'playwright-core';
import { URL_CENTRAL } from './ayudas/supabase-simulado.ts';

const RAIZ = join(import.meta.dirname, '..');
const DIST = mkdtempSync(join(tmpdir(), 'londuo-admin-'));
const HTML = join(DIST, 'administracion.html');
const chromiumPath = [process.env.POS_CHROMIUM, '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', '/opt/pw-browsers/chromium/chrome-linux/chrome'].find((p) => p && existsSync(p));
const { defaultBrowserType: _omitido, ...IPHONE } = devices['iPhone 13']!;
void _omitido;

describe('[iPhone] Etiquetas de tarjetas y avisos flotantes', { timeout: 120_000, skip: chromiumPath ? false : 'Chromium no encontrado' }, () => {
  it('MV-1 las etiquetas de fila (th scope=row) no se quedan pegadas arriba de la pantalla: van dentro de su tarjeta; los avisos flotantes quedan bajo la barra de estado', async (t) => {
    execFileSync(process.execPath, [join(RAIZ, 'scripts', 'construir-admin.mjs')], { stdio: 'pipe', env: { ...process.env, LONDUO_DIST: DIST, LONDUO_SUPABASE_URL: URL_CENTRAL, LONDUO_SUPABASE_KEY: 'sb_publishable_prueba' } });
    const browser = await chromium.launch({ executablePath: chromiumPath, args: ['--no-sandbox'] });
    t.after(() => browser.close());
    const page = await (await browser.newContext({ ...IPHONE, deviceScaleFactor: 2 })).newPage();
    await page.goto(`file://${HTML}`);
    await page.waitForSelector('#puerta:not([hidden])');
    const r = await page.evaluate(() => {
      const filas = Array.from({ length: 40 }, (_, i) => `<tr><th scope="row">Etiqueta ${i}</th><td class="num">$${i}.00</td></tr>`).join('');
      document.body.insertAdjacentHTML('beforeend', `<main id="prueba"><div class="panel"><table id="t-prueba"><tbody>${filas}</tbody></table></div></main><div id="avisos-flotantes"></div>`);
      window.scrollTo(0, 600); // con sticky las etiquetas se irían a la parte de arriba de la pantalla
      const th = document.querySelector('#t-prueba tr:nth-child(30) th')!, tr = th.parentElement!, td = tr.querySelector('td')!;
      const a = th.getBoundingClientRect(), b = tr.getBoundingClientRect(), c = td.getBoundingClientRect();
      return { posicion: getComputedStyle(th).position, dentro: a.top >= b.top - 1 && a.bottom <= b.bottom + 1, mismaLinea: Math.abs((a.top + a.bottom) / 2 - (c.top + c.bottom) / 2) < 12, izquierda: a.left < c.left, texto: th.textContent, top: getComputedStyle(document.querySelector('#avisos-flotantes')!).top };
    });
    assert.equal(r.posicion, 'static', 'la etiqueta de fila no es sticky');
    assert.ok(r.dentro, 'la etiqueta queda dentro de su tarjeta (no pegada arriba)');
    assert.ok(r.mismaLinea && r.izquierda, 'etiqueta a la izquierda y el importe a la derecha, en la misma línea');
    assert.equal(r.top, '8px', 'los avisos flotantes se separan de arriba con la zona segura (8 px + la barra de estado)');
  });
});

describe('[iPhone] Administración › Cortes', { timeout: 120_000, skip: chromiumPath ? false : 'Chromium no encontrado' }, () => {
  it('MV-2 cada celda de la tabla de cortes lleva su propio nombre (el encabezado va en dos filas y antes quedaban desfasados: «Fondo» salía como «PESOS (MXN) físicos»)', async (t) => {
    const { centralLocal, usuario } = await import('./ayudas/central-pglite.ts');
    const { simularSupabase } = await import('./ayudas/supabase-simulado.ts');
    execFileSync(process.execPath, [join(RAIZ, 'scripts', 'construir-admin.mjs')], { stdio: 'pipe', env: { ...process.env, LONDUO_DIST: DIST, LONDUO_SUPABASE_URL: URL_CENTRAL, LONDUO_SUPABASE_KEY: 'sb_publishable_prueba' } });
    const db = await centralLocal();
    const edgardo = await usuario(db, 'edgardo@x.mx', 'supervisor');
    const browser = await chromium.launch({ executablePath: chromiumPath, args: ['--no-sandbox'] });
    t.after(() => browser.close());
    const ctx = await browser.newContext({ ...IPHONE, deviceScaleFactor: 2 });
    await simularSupabase(ctx, db, { 'edgardo@x.mx': edgardo });
    const page = await ctx.newPage();
    const errores: string[] = [];
    page.on('pageerror', (e) => errores.push(String(e)));
    await page.goto(`file://${HTML}`);
    await page.waitForSelector('#puerta:not([hidden])');
    await page.fill('#pu-correo', 'edgardo@x.mx'); await page.fill('#pu-clave', 'buena'); await page.click('#pu-entrar');
    await page.waitForSelector('#puerta', { state: 'hidden' });
    await page.waitForSelector('#nav');
    const bloque = { fondo: 500000, cobros: 120000, cambio: -3000, entradas: 0, devoluciones: 0, cancelaciones: 0, retiros: 0, esperado: 617000, contado: 617000, diferencia: 0 };
    await page.evaluate((b) => {
      const w = window as unknown as { __POS_ATENDER__: (m: string, r: string, c?: unknown) => Promise<unknown> };
      const orig = w.__POS_ATENDER__;
      w.__POS_ATENDER__ = async (m, r, c) => (r === '/api/admin/cortes' ? { status: 200, json: { ok: true, cortes: [{ tienda: 'DUO', caja: 1, fecha: '2026-10-29', tickets: 7, ventas_netas: 120000, mxn: b, usd: { ...b, fondo: 0, cobros: 39500, cambio: 0, esperado: 39500, contado: 39500, equivalente_historico_mxn: 69125 } }] } } : orig(m, r, c));
    }, bloque);
    await page.evaluate(() => (window as unknown as { ir: (v: string) => void }).ir('cortes'));
    await page.waitForSelector('#tabla-cortes tbody tr[data-corte]');
    const etiquetas = await page.evaluate(() => Array.from(document.querySelectorAll('#tabla-cortes tbody tr[data-corte] td')).map((td) => `${td.getAttribute('data-label')}=${td.textContent!.trim()}`));
    assert.deepEqual(etiquetas.slice(0, 8), ['Tienda=DUO', 'Caja=1', 'Fecha=2026-10-29', 'Tickets=7', 'Ventas netas MXN=$1,200.00', 'Pesos · Fondo=$5,000.00', 'Pesos · Cobros=$1,200.00', 'Pesos · Cambio=-$30.00']);
    assert.ok(etiquetas.includes('Pesos · Diferencia=$0.00'));
    assert.ok(etiquetas.includes('Dólares · Cobros=US$395.00'), etiquetas.join(' | '));
    assert.ok(etiquetas.includes('Equivalente MXN de los USD (contable)=$691.25'));
    assert.ok(!etiquetas.some((e) => /PESOS \(MXN\) físicos|DÓLARES \(USD\) físicos/.test(e)), 'ninguna celda usa el título agrupado como nombre');
    const total = await page.evaluate(() => Array.from(document.querySelectorAll('#tabla-cortes tbody tr:last-child td')).slice(0, 2).map((td) => td.getAttribute('data-label')));
    assert.deepEqual(total, ['Total · Pesos · Fondo', 'Total · Pesos · Cobros']);
    assert.deepEqual(errores, []);
  });
});
