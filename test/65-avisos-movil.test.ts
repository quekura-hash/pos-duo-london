import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { chromium, devices } from 'playwright-core';
import { centralLocal, usuario } from './ayudas/central-pglite.ts';
import { pruebas, simularSupabase, URL_CENTRAL } from './ayudas/supabase-simulado.ts';

const RAIZ = join(import.meta.dirname, '..');
const DIST = mkdtempSync(join(tmpdir(), 'londuo-admin-'));
const HTML = join(DIST, 'administracion.html');
const chromiumPath = [process.env.POS_CHROMIUM, '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', '/opt/pw-browsers/chromium/chrome-linux/chrome'].find((p) => p && existsSync(p));
const { defaultBrowserType: _omitido, ...IPHONE } = devices['iPhone 13']!;
void _omitido;
const VAPID = 'BEl62iUYgUivxIkv69yViEuiBIa-Ib9-SkvMeAtA3LFgDzkrxZJjSgSnfckjBJuBkr3qBUYIHBQFLXYp5Nksh8U';

describe('[iPhone] Avisos de la Administración', { timeout: 180_000, skip: chromiumPath ? false : 'Chromium no encontrado' }, () => {
  it('AV1 activar avisos, elegir qué avisar, pausar, probar y desactivar', async (t) => {
    execFileSync(process.execPath, [join(RAIZ, 'scripts', 'construir-admin.mjs')], { stdio: 'pipe', env: { ...process.env, LONDUO_DIST: DIST, LONDUO_SUPABASE_URL: URL_CENTRAL, LONDUO_SUPABASE_KEY: 'sb_publishable_prueba', LONDUO_VAPID_PUBLICA: VAPID } });
    const db = await centralLocal();
    const edgardo = await usuario(db, 'edgardo@x.mx', 'supervisor');
    const browser = await chromium.launch({ executablePath: chromiumPath, args: ['--no-sandbox'] });
    t.after(() => browser.close());
    const ctx = await browser.newContext({ ...IPHONE, deviceScaleFactor: 2 });
    // Push del teléfono simulado: el permiso y la suscripción son del navegador, no del central.
    await ctx.addInitScript(() => {
      let sub: unknown = null;
      const crear = () => ({ endpoint: 'https://push.apple.test/abc', toJSON: () => ({ keys: { p256dh: 'p256-x', auth: 'auth-x' } }), unsubscribe: async () => { sub = null; return true; } });
      const pm = { getSubscription: async () => sub, subscribe: async (o: { applicationServerKey: Uint8Array }) => { (window as unknown as { __llave: number }).__llave = o.applicationServerKey.length; sub = crear(); return sub; } };
      Object.defineProperty(navigator, 'serviceWorker', { value: { ready: Promise.resolve({ pushManager: pm }), register: async () => ({}) }, configurable: true });
      (window as unknown as { PushManager: unknown }).PushManager = function () {};
      const N = function () {} as unknown as { permission: string; requestPermission: () => Promise<string> };
      N.permission = 'default'; N.requestPermission = async () => (N.permission = 'granted');
      (window as unknown as { Notification: unknown }).Notification = N;
    });
    await simularSupabase(ctx, db, { 'edgardo@x.mx': edgardo });
    const page = await ctx.newPage();
    const errores: string[] = [];
    page.on('pageerror', (e) => errores.push(String(e)));
    await page.goto(`file://${HTML}`);
    await page.waitForSelector('#puerta:not([hidden])');
    await page.fill('#pu-correo', 'edgardo@x.mx'); await page.fill('#pu-clave', 'buena'); await page.click('#pu-entrar');
    await page.waitForSelector('#puerta', { state: 'hidden' });
    await page.click('#nav button[data-vista=avisos]');
    await page.waitForSelector('#av-activar');
    assert.match((await page.textContent('#av-texto'))!, /desactivados/);

    await page.click('#av-activar');
    await page.waitForSelector('#av-prefs');
    assert.equal(await page.evaluate(() => (window as unknown as { __llave: number }).__llave), 65, 'la llave pública VAPID se manda como 65 bytes');
    const fila = async () => (await db.query<{ prefs: Record<string, unknown>; pausa_hasta: string | null; activa: boolean }>(`select prefs, pausa_hasta, activa from pos.suscripciones_push where endpoint = 'https://push.apple.test/abc'`)).rows[0]!;
    assert.equal((await fila()).activa, true);
    assert.equal((await fila()).prefs.venta, true, 'por omisión avisa cada venta');

    // Se cansó de las ventas: apaga «Cada venta», sube el mínimo y deja solo DÚO.
    await page.uncheck('#av-venta'); await page.fill('#av-min', '500'); await page.uncheck('#av-t-LON');
    await page.click('#av-guardar');
    await page.waitForSelector('#msg-avisos.ok');
    const p = (await fila()).prefs;
    assert.deepEqual([p.venta, p.venta_minima, p.tiendas, p.corte, p.resumen_dia], [false, 50000, ['DUO'], true, true]);

    // Pausa una hora y reanuda.
    await page.click('[data-pausa="60"]');
    await page.waitForSelector('[data-pausa="0"]');
    const hasta = Date.parse((await fila()).pausa_hasta!);
    assert.ok(hasta > Date.now() + 50 * 60000 && hasta < Date.now() + 70 * 60000);
    await page.click('[data-pausa="0"]');
    await page.waitForSelector('[data-pausa="0"]', { state: 'detached' });
    assert.equal((await fila()).pausa_hasta, null);

    // Prueba y desactivación.
    await page.click('#av-probar');
    await page.waitForSelector('#msg-avisos.ok');
    assert.deepEqual(pruebas.at(-1), { accion: 'prueba', endpoint: 'https://push.apple.test/abc' });
    await page.click('#av-apagar');
    await page.waitForSelector('#av-activar');
    assert.equal((await db.query(`select 1 from pos.suscripciones_push`)).rows.length, 0);
    assert.deepEqual(errores, []);
  });
});
