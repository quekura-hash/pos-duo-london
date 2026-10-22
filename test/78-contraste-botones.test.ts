import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { describe, it } from 'node:test';
import { chromium, type Page } from 'playwright-core';
import { api, appAdmin, appCajero } from './ayudas/app.ts';
import { ALMACENES, nuevoMundo, politica } from './ayudas/comun.ts';

const CANDIDATOS = [process.env.POS_CHROMIUM, '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', '/opt/pw-browsers/chromium/chrome-linux/chrome'];
const chromiumPath = CANDIDATOS.find((p) => p && existsSync(p));

/** Botones visibles cuyo texto tiene menos de 4.5:1 de contraste con su fondo (el color real, mezclando transparencias). */
const medir = (page: Page) => page.evaluate(() => {
  const parse = (c: string) => { const m = c.match(/rgba?\(([^)]+)\)/); if (!m) return null; const [r, g, b, a = '1'] = m[1]!.split(/[ ,\/]+/).filter(Boolean).map(Number); return { r: r!, g: g!, b: b!, a: Number(a) }; };
  const lum = (c: { r: number; g: number; b: number }) => { const f = (v: number) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b); };
  const fondo = (el: Element) => { let e: Element | null = el; let base = { r: 255, g: 255, b: 255 }; const capas: { r: number; g: number; b: number; a: number }[] = []; while (e) { const c = parse(getComputedStyle(e).backgroundColor); if (c && c.a > 0) { capas.push(c); if (c.a >= 1) break; } e = e.parentElement; } for (const c of capas.reverse()) base = { r: base.r * (1 - c.a) + c.r * c.a, g: base.g * (1 - c.a) + c.g * c.a, b: base.b * (1 - c.a) + c.b * c.a }; return base; };
  const out: string[] = [];
  for (const el of document.querySelectorAll('button, .btn, [role="button"], input[type=button], input[type=submit]')) {
    const r = el.getBoundingClientRect(); const cs = getComputedStyle(el);
    if (r.width < 4 || r.height < 4 || cs.visibility === 'hidden' || cs.display === 'none' || (el as HTMLButtonElement).disabled) continue;
    const t = parse(cs.color); if (!t) continue;
    const bg = fondo(el); const f = { r: t.r * t.a + bg.r * (1 - t.a), g: t.g * t.a + bg.g * (1 - t.a), b: t.b * t.a + bg.b * (1 - t.a) };
    const l1 = lum(f), l2 = lum(bg); const ratio = (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
    if (ratio < 4.5) out.push(`${ratio.toFixed(2)} · ${(el.textContent || el.getAttribute('aria-label') || '').trim().replace(/\s+/g, ' ').slice(0, 40)} · #${el.id} .${String(el.className).slice(0, 40)} · color ${cs.color} fondo rgb(${Math.round(bg.r)},${Math.round(bg.g)},${Math.round(bg.b)})`);
  }
  return out;
});
describe('[navegador real] Contraste de los botones', { timeout: 180_000, skip: chromiumPath ? false : 'Chromium no encontrado (defina POS_CHROMIUM)' }, () => {
  it('BC1 ningún botón de la caja ni de Administración queda con texto casi invisible, en claro y en oscuro', async (t) => {
    const b = await chromium.launch({ executablePath: chromiumPath, args: ['--no-sandbox'] });
    const ctx = nuevoMundo(ALMACENES[1]!, politica());
    const adm = await appAdmin(ctx);
    const caja = await appCajero(ctx, 'DUO', 1, 'Ana');
    t.after(async () => { await b.close(); await adm.cerrar(); await caja.cerrar(); ctx.limpiar(); });
    await api(adm.url, '/api/admin/cajeros', { nombre: 'Ana', clave: '1111', perfil: { nombres: 'Ana', apellidos: 'L' } });
    await api(adm.url, '/api/admin/administradores', { nombre: 'Edgardo', clave: 'clave-segura' });
    ctx.m.pump(); ctx.m.pump(); ctx.m.pump();
    const malos: string[] = [];
    for (const esquema of ['light', 'dark'] as const) {
      const c = await b.newContext({ viewport: { width: 1366, height: 820 }, colorScheme: esquema });
      const page = await c.newPage();
      await api(caja.url, '/api/login', { usuario: 'Ana', clave: '1111' });
      await page.goto(caja.url);
      await page.waitForSelector('#nav');
      for (const v of ['venta', 'retiro', 'ventas', 'corte']) { await page.click(`#nav button[data-vista="${v}"]`); await page.waitForTimeout(300); malos.push(...(await medir(page)).map((m) => `caja ${esquema} ${v}: ${m}`)); }
      await page.goto(adm.url);
      await page.waitForSelector('#lg-clave', { timeout: 3000 }).then(async () => { await page.fill('#lg-usuario', 'Edgardo'); await page.fill('#lg-clave', 'clave-segura'); await page.click('#lg-entrar'); }).catch(() => undefined);
      await page.waitForSelector('#nav button');
      for (const v of ['inventario', 'almacen', 'promociones', 'reportes', 'historial', 'configuracion']) { await page.click(`#nav button[data-vista="${v}"]`); await page.waitForTimeout(300); malos.push(...(await medir(page)).map((m) => `admin ${esquema} ${v}: ${m}`)); }
      await c.close();
    }
    assert.deepEqual([...new Set(malos.map((m) => m.replace(/^(caja|admin) \w+ \w+: /, '')))], []);
  });
});
