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
