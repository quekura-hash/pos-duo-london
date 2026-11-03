import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { createServer } from 'node:http';
import { extname, join } from 'node:path';
import { describe, it } from 'node:test';
import { chromium } from 'playwright-core';

const RAIZ = join(import.meta.dirname, '..');
const DIST = mkdtempSync(join(tmpdir(), 'londuo-pwa-'));
const WEB = join(DIST, 'admin-web');
const chromiumPath = [process.env.POS_CHROMIUM, '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', '/opt/pw-browsers/chromium/chrome-linux/chrome'].find((p) => p && existsSync(p));
const TIPOS: Record<string, string> = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.webmanifest': 'application/manifest+json', '.png': 'image/png' };

describe('[navegador real] Administración instalable (PWA)', { timeout: 120_000, skip: chromiumPath ? false : 'Chromium no encontrado' }, () => {
  it('P1 el manifiesto y los íconos son válidos, el service worker abre sin conexión y muestra las notificaciones push', async (t) => {
    execFileSync(process.execPath, [join(RAIZ, 'scripts', 'construir-admin.mjs'), '--pwa'], { stdio: 'pipe', env: { ...process.env, LONDUO_DIST: DIST, LONDUO_SUPABASE_URL: 'https://prueba.supabase.co', LONDUO_SUPABASE_KEY: 'sb_publishable_prueba' } });
    const servidor = createServer((req, res) => {
      const ruta = !req.url || req.url === '/' ? 'index.html' : req.url.slice(1).split('?')[0]!;
      try { res.writeHead(200, { 'content-type': TIPOS[extname(ruta)] ?? 'application/octet-stream', 'cache-control': 'no-cache' }); res.end(readFileSync(join(WEB, ruta))); } catch { res.writeHead(404); res.end(); }
    });
    await new Promise<void>((r) => servidor.listen(0, '127.0.0.1', r));
    const base = `http://localhost:${(servidor.address() as { port: number }).port}/`;
    const browser = await chromium.launch({ executablePath: chromiumPath, args: ['--no-sandbox'] });
    t.after(async () => { await browser.close(); servidor.close(); });
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const page = await ctx.newPage();
    await page.goto(base);
    await page.waitForSelector('#puerta:not([hidden])');

    // Manifiesto: nombre, pantalla completa tipo app e íconos que existen y tienen el tamaño declarado.
    const href = await page.getAttribute('link[rel=manifest]', 'href');
    const m = JSON.parse(readFileSync(join(WEB, href!), 'utf8')) as { display: string; start_url: string; icons: { src: string; sizes: string; purpose: string }[]; short_name: string };
    assert.deepEqual([m.display, m.short_name], ['standalone', 'LonDuo']);
    for (const ic of m.icons) {
      const png = readFileSync(join(WEB, ic.src));
      assert.deepEqual([png.readUInt32BE(16), png.readUInt32BE(20)].map(String), ic.sizes.split('x'), ic.src);
    }
    assert.ok(m.icons.some((i) => i.purpose === 'maskable'));
    assert.equal(await page.getAttribute('link[rel=apple-touch-icon]', 'href'), 'icon-180.png');
    assert.equal(await page.getAttribute('meta[name=apple-mobile-web-app-capable]', 'content'), 'yes');

    // Service worker: se registra, controla la página y guarda lo básico.
    await page.evaluate(() => navigator.serviceWorker.ready);
    await page.reload();
    await page.waitForFunction(() => !!navigator.serviceWorker.controller);
    // Sin conexión la Administración abre desde lo guardado.
    await ctx.setOffline(true);
    await page.reload();
    await page.waitForSelector('#puerta:not([hidden])');
    assert.match((await page.textContent('#pu-titulo'))!, /LonDuo POS/);
    await ctx.setOffline(false);

    // Notificación push: llega al service worker y se muestra con su título, texto y destino.
    const cdp = await ctx.newCDPSession(page);
    const registro = new Promise<{ registrationId: string }>((resolve) => { cdp.on('ServiceWorker.workerRegistrationUpdated', (e: { registrations: { registrationId: string; scopeURL: string }[] }) => { const r = e.registrations.find((x) => x.scopeURL === base); if (r) resolve(r); }); });
    await cdp.send('ServiceWorker.enable');
    const reg = await registro;
    await ctx.grantPermissions(['notifications'], { origin: new URL(base).origin });
    await cdp.send('ServiceWorker.deliverPushMessage', { origin: new URL(base).origin, registrationId: reg.registrationId, data: JSON.stringify({ titulo: 'Venta DÚO · $1,019.00', cuerpo: 'Caja 1 · Folio 000123 · Ana', tag: 'venta', url: './#ventas' }) });
    let n: { titulo: string; cuerpo: string; tag: string; url: string } | null = null;
    for (let i = 0; i < 40 && !n; i++) {
      n = await page.evaluate(async () => { const l = await (await navigator.serviceWorker.ready).getNotifications(); const x = l[0]; return x ? { titulo: x.title, cuerpo: x.body, tag: x.tag, url: (x.data as { url: string }).url } : null; });
      if (!n) await page.waitForTimeout(250);
    }
    assert.deepEqual(n, { titulo: 'Venta DÚO · $1,019.00', cuerpo: 'Caja 1 · Folio 000123 · Ana', tag: 'venta', url: './#ventas' });
  });
  it('P2 ningún archivo de la página pasa de 2 MB (la página de subida de Cloudflare se atora con archivos grandes) y las librerías van como archivos aparte, funcionando', async (t) => {
    const dist = mkdtempSync(join(tmpdir(), 'londuo-pwa-tam-'));
    execFileSync(process.execPath, [join(RAIZ, 'scripts', 'construir-admin.mjs'), '--pwa'], { stdio: 'pipe', env: { ...process.env, LONDUO_DIST: dist, LONDUO_SUPABASE_URL: 'https://prueba.supabase.co', LONDUO_SUPABASE_KEY: 'sb_publishable_prueba' } });
    const web = join(dist, 'admin-web');
    const grandes = readdirSync(web).map((f) => [f, statSync(join(web, f)).size] as const).filter(([, n]) => n > 2_000_000);
    assert.deepEqual(grandes, [], 'el límite práctico del subidor de Cloudflare está alrededor de 2.5 MB por archivo (0.2.60 con 2.46 MB subió; 0.2.61 con 2.62 MB se atoró)');
    assert.ok(existsSync(join(web, 'zxing.min.js')) && existsSync(join(web, 'exceljs.min.js')));
    assert.match(readFileSync(join(web, 'sw.js'), 'utf8'), /'zxing\.min\.js', 'exceljs\.min\.js'/, 'se guardan para el modo sin conexión');
    const servidor = createServer((req, res) => {
      const ruta = !req.url || req.url === '/' ? 'index.html' : req.url.slice(1).split('?')[0]!;
      try { res.writeHead(200, { 'content-type': TIPOS[extname(ruta)] ?? 'application/octet-stream' }); res.end(readFileSync(join(web, ruta))); } catch { res.writeHead(404); res.end(); }
    });
    await new Promise<void>((r) => servidor.listen(0, '127.0.0.1', r));
    const browser = await chromium.launch({ executablePath: chromiumPath, args: ['--no-sandbox'] });
    t.after(async () => { await browser.close(); servidor.close(); });
    const page = await (await browser.newContext({ viewport: { width: 390, height: 844 } })).newPage();
    const errores: string[] = [];
    page.on('pageerror', (e) => errores.push(String(e)));
    await page.goto(`http://localhost:${(servidor.address() as { port: number }).port}/`);
    await page.waitForSelector('#puerta:not([hidden])');
    // las dos librerías cargaron antes que la app (mismo orden de siempre) y la exportación a Excel puede crear un libro
    const r = await page.evaluate(async () => ({ zxing: typeof (window as any).ZXing?.BrowserMultiFormatReader, excel: typeof (window as any).ExcelJS?.Workbook, libro: !!new (window as any).ExcelJS.Workbook().addWorksheet('x') }));
    assert.deepEqual(r, { zxing: 'function', excel: 'function', libro: true });
    assert.deepEqual(errores, []);
  });
});
