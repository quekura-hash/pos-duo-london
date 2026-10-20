import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { chromium, type Page } from 'playwright-core';
import { como } from './ayudas/central-pglite.ts';
import { escenario, ESCANEAR } from './ayudas/escenario-central.ts';
import { simularSupabase, URL_CENTRAL } from './ayudas/supabase-simulado.ts';

const RAIZ = join(import.meta.dirname, '..');
const HTML = join(RAIZ, 'dist', 'caja.html');
const chromiumPath = [process.env.POS_CHROMIUM, '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', '/opt/pw-browsers/chromium/chrome-linux/chrome'].find((p) => p && existsSync(p));

type Est = { POS_CAJA: { estado(): { dentro: boolean; tienda: string; caja: number; error: string | null; pendientes: number; sincronizando: boolean } | null; sincronizar(): Promise<boolean> } };
type Hw = { __imp: number[][]; __creds?: { correo: string; clave: string } };

describe('[navegador real] Caja conectada al central (Supabase simulado con Postgres real)', { timeout: 180_000, skip: chromiumPath ? false : 'Chromium no encontrado' }, () => {
  it('B31 conecta la caja, baja el catálogo, vende e imprime, sube la venta y sigue vendiendo sin internet con sus folios', async (t) => {
    execFileSync(process.execPath, [join(RAIZ, 'scripts', 'construir-caja.mjs')], { stdio: 'pipe', env: { ...process.env, LONDUO_SUPABASE_URL: URL_CENTRAL, LONDUO_SUPABASE_KEY: 'sb_publishable_prueba' } });
    const { db, cuentas } = await escenario();
    const browser = await chromium.launch({ executablePath: chromiumPath, args: ['--no-sandbox'] });
    t.after(() => browser.close());
    const ctx = await browser.newContext({ viewport: { width: 1366, height: 860 }, colorScheme: 'light' });
    await simularSupabase(ctx, db, Object.fromEntries(Object.entries(cuentas).map(([k, v]) => [k, v.id])));
    // La app de Windows le da a la pantalla `posHardware`; aquí se simula (la impresora guarda los bytes, las credenciales viven en el navegador).
    await ctx.addInitScript(() => {
      const w = window as unknown as Hw & { posHardware: unknown };
      w.__imp = [];
      const guardadas = localStorage.getItem('prueba-creds');
      if (guardadas) w.__creds = JSON.parse(guardadas);
      w.posHardware = {
        imprimirRaw: async (b: Uint8Array) => { w.__imp.push(Array.from(b)); },
        credencialesCaja: async () => w.__creds ?? null,
        guardarCredencialesCaja: async (c: { correo: string; clave: string }) => { localStorage.setItem('prueba-creds', JSON.stringify(c)); w.__creds = c; },
      };
    });
    const errores: string[] = [];
    const nueva = async (): Promise<Page> => {
      const p = await ctx.newPage();
      p.on('pageerror', (e) => errores.push(String(e)));
      p.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource|ERR_FAILED|net::/.test(m.text())) errores.push(m.text()); });
      await p.goto(`file://${HTML}`);
      return p;
    };

    // Primera vez: la caja no tiene cuenta; se la da el administrador y se conecta.
    let page = await nueva();
    await page.waitForSelector('#pu-form:not([hidden])');
    assert.match((await page.textContent('#version-pos'))!, /^Caja v\d+\.\d+\.\d+ · /);
    assert.equal(await page.locator('.barra-nube').count(), 0, 'no hay barra de estado sobre la pantalla del POS');
    await page.fill('#pu-correo', 'caja-duo-1@x.mx'); await page.fill('#pu-clave', 'mala'); await page.click('#pu-entrar');
    await page.waitForFunction(() => /revisa correo y contraseña/.test(document.querySelector('#msg-puerta')!.textContent!));
    await page.fill('#pu-correo', 'edgardo@x.mx'); await page.fill('#pu-clave', 'buena'); await page.click('#pu-entrar');
    await page.waitForFunction(() => /no es de una caja/.test(document.querySelector('#msg-puerta')!.textContent!));
    await page.fill('#pu-correo', 'caja-duo-1@x.mx'); await page.fill('#pu-clave', 'buena'); await page.click('#pu-entrar');
    await page.waitForSelector('#puerta', { state: 'hidden' });
    await page.waitForFunction(() => { const e = (window as unknown as Est).POS_CAJA.estado(); return !!e && e.dentro && e.tienda === 'DUO' && e.caja === 1 && !e.error; });
    assert.deepEqual(await page.evaluate(() => (window as unknown as Hw).__creds), { correo: 'caja-duo-1@x.mx', clave: 'buena' });

    // La cajera entra con su clave local (la dio Administración) y vende.
    await page.selectOption('#lg-usuario', 'Ana'); await page.fill('#lg-clave', '1234'); await page.click('#lg-entrar');
    await page.waitForSelector('#scan');
    const vender = async (p: Page, folio: string) => {
      await p.fill('#scan', ESCANEAR); await p.press('#scan', 'Enter');
      await p.waitForSelector('#cuerpo tr[data-linea]');
      await p.fill('#recibido', '500'); await p.click('#btn-cobrar');
      await p.waitForSelector('#dlg-ticket[open]');
      await p.waitForFunction((f) => new RegExp(`Folio ${f}`).test(document.querySelector('#resumen-venta')!.textContent!), folio);
    };
    await vender(page, '000001');
    const trabajos = await page.evaluate(() => (window as unknown as Hw).__imp);
    assert.ok(trabajos.length >= 1 && trabajos[0]![0] === 0x1b && trabajos[0]![1] === 0x40, 'el ticket salió a la impresora como ESC/POS');
    await page.click('#btn-nueva');
    await page.evaluate(() => (window as unknown as Est).POS_CAJA.sincronizar());
    await page.waitForFunction(() => { const e = (window as unknown as Est).POS_CAJA.estado(); return !!e && e.pendientes === 0 && !e.error && !e.sincronizando; });
    const ventas = async () => ((await como(db, cuentas['edgardo@x.mx']!.id, (q) => q(`select origen from pos.ops where tipo = 'sale.confirmed'`))) as { origen: string }[]).map((x) => x.origen);
    assert.deepEqual(await ventas(), ['caja:DUO/1']);

    // La PC se reinicia SIN internet: abre con lo guardado, la cajera vuelve a entrar y el folio continúa.
    await page.close();
    await ctx.route(`${URL_CENTRAL}/**`, (r) => r.abort('internetdisconnected'));
    page = await nueva();
    await page.waitForSelector('#puerta', { state: 'hidden', timeout: 60_000 });
    await page.waitForSelector('#lg-usuario');
    await page.selectOption('#lg-usuario', 'Ana'); await page.fill('#lg-clave', '1234'); await page.click('#lg-entrar');
    await page.waitForSelector('#scan');
    await vender(page, '000002');
    await page.waitForFunction(() => { const e = (window as unknown as Est).POS_CAJA.estado(); return !!e && !!e.error && e.pendientes > 0; });
    assert.equal(await page.locator('#aviso-inactividad:visible').count(), 0, 'sin cajeras registradas no hay aviso de inactividad');
    assert.deepEqual(await ventas(), ['caja:DUO/1'], 'sin internet nada llegó al central todavía');
    assert.deepEqual(errores, []);
  });
});
