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
type Atender = { __POS_ATENDER__: (m: string, r: string, c?: unknown) => Promise<{ status: number; json: Record<string, any> }> };
// una foto mínima (PNG de 1 píxel) para ver el avatar circular
const FOTO = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

async function preparar(t: { after: (f: () => unknown) => void }) {
  const dist = mkdtempSync(join(tmpdir(), 'londuo-admin-'));
  execFileSync(process.execPath, [join(RAIZ, 'scripts', 'construir-admin.mjs')], { stdio: 'pipe', env: { ...process.env, LONDUO_DIST: dist, LONDUO_SUPABASE_URL: URL_CENTRAL, LONDUO_SUPABASE_KEY: 'sb_publishable_prueba' } });
  const db = await centralLocal();
  const edgardo = await usuario(db, 'edgardo@x.mx', 'supervisor');
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
    return { page, errores };
  };
  const llamar = (page: Page, metodo: string, ruta: string, cuerpo: unknown) => page.evaluate(async (d) => (await (window as unknown as Atender).__POS_ATENDER__(d.m, d.r, d.c)).status, { m: metodo, r: ruta, c: cuerpo });
  const sembrar = async (page: Page) => {
    assert.equal(await llamar(page, 'POST', '/api/admin/cajeros', { nombre: 'Carmen', clave: '4321', tienda: 'DUO', perfil: { nombres: 'Carmen guadalupe', apellidos: 'Alvarez', telefono: '6531036512', foto: FOTO } }), 200);
    assert.equal(await llamar(page, 'POST', '/api/admin/cajeros', { nombre: 'Eva', clave: '5555', tienda: 'LON', perfil: { nombres: 'Eva Esther', apellidos: 'García Martínez', telefono: '6531080678' } }), 200);
    const ana = await page.evaluate(async () => (await (window as unknown as Atender).__POS_ATENDER__('POST', '/api/admin/cajeros', { nombre: 'Ana', clave: '6666', tienda: 'DUO', perfil: { nombres: 'Ana', apellidos: 'Pérez', telefono: '6530000001' } })).json.cajeros.find((c: any) => c.nombre === 'Ana').id);
    assert.equal(await llamar(page, 'POST', '/api/admin/cajeros', { id: ana, activo: false }), 200);
    assert.equal(await llamar(page, 'POST', '/api/admin/supervisores', { nombre: 'Rosa', clave: '1111' }), 200);
  };
  return { abrir, sembrar, llamar };
}
const ir = async (page: Page) => { await irASeccion(page, 'empleadas'); await page.waitForSelector('#tabla-personal tr[data-rol]'); };

describe('[navegador real] Personal › Perfiles rediseñado', { timeout: 300_000, skip: chromiumPath ? false : 'Chromium no encontrado' }, () => {
  it('PF1 encabezado con Roles y permisos, buscador, contador, tarjetas, acciones y modales (teléfono 440 px)', async (t) => {
    const { abrir, sembrar } = await preparar(t);
    const { page, errores } = await abrir({ ...IPHONE, viewport: { width: 440, height: 956 }, deviceScaleFactor: 2, colorScheme: 'light' });
    await sembrar(page);
    await ir(page);
    // — Las cuatro secciones, en dos columnas por dos filas, con la actual resaltada.
    assert.deepEqual(await page.$$eval('[role="tab"] span', (b) => b.map((x) => x.textContent)), ['Perfiles', 'Descuento y crédito', 'Nómina', 'Horarios']);
    const tabs = await page.$$eval('[role="tab"]', (b) => b.map((x) => { const r = x.getBoundingClientRect(); return { x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width) }; }));
    assert.ok(tabs[0]!.y === tabs[1]!.y && tabs[2]!.y === tabs[3]!.y && tabs[2]!.y > tabs[0]!.y && tabs[0]!.x === tabs[2]!.x, `2×2: ${JSON.stringify(tabs)}`);
    assert.equal(await page.getAttribute('#per-tab-perfiles', 'aria-selected'), 'true');
    // — Encabezado: «Perfiles» y, a la derecha, «Roles y permisos»; ya no hay bloques largos de texto.
    const [h2, rolBtn] = (await page.evaluate(() => ['#panel-personal .per-cab h2', '#per-roles'].map((s) => { const r = document.querySelector(s)!.getBoundingClientRect(); return { x: r.left, y: r.top, d: r.right }; }))) as unknown as [Record<string, number>, Record<string, number>];
    assert.ok(rolBtn!.x > h2!.d && Math.abs(rolBtn!.y - h2!.y) < 30, 'el botón va a la derecha del título');
    assert.equal(await page.locator('#panel-personal > .nota:not(#per-vacio)').count(), 0, 'sin párrafos largos');
    assert.doesNotMatch((await page.textContent('#panel-personal'))!, /Entran con su usuario y contraseña|Cada Vendedora-Cajera tiene su propia clave/);
    // — Buscador con lupa, selector y contador real.
    assert.equal(await page.getAttribute('#per-buscar', 'placeholder'), 'Buscar por nombre, alias o teléfono');
    assert.equal(await page.locator('.per-lupa svg').count(), 1);
    assert.equal((await page.textContent('#per-contador'))!.trim(), '4 perfiles');
    await page.fill('#per-buscar', '6531036512'); assert.equal((await page.textContent('#per-contador'))!.trim(), '1 perfil');
    await page.fill('#per-buscar', 'zzz'); assert.equal((await page.textContent('#per-contador'))!.trim(), '0 perfiles'); assert.equal(await page.isVisible('#per-vacio'), true);
    await page.fill('#per-buscar', 'activo'); assert.equal((await page.textContent('#per-contador'))!.trim(), '0 perfiles', 'la búsqueda es por nombre, alias o teléfono (no por el estado)');
    await page.fill('#per-buscar', '');
    await page.selectOption('#per-filtro', 'cajero'); assert.equal((await page.textContent('#per-contador'))!.trim(), '3 perfiles');
    await page.selectOption('#per-filtro', '');
    // — Tarjetas: foto circular, alias en negritas, nombre completo, teléfono, estado; rol y tienda en columnas; sin campos de clave.
    const carmen = page.locator('#tabla-personal tr[data-cajero]:has-text("Carmen")');
    assert.equal(await carmen.locator('img').count(), 1);
    assert.equal(await carmen.locator('img').evaluate((e) => getComputedStyle(e).borderRadius), '50%');
    assert.ok((await carmen.locator('b[data-alias]').evaluate((e) => Number(getComputedStyle(e).fontWeight))) >= 700);
    assert.match((await carmen.locator('.p-datos').textContent())!, /Carmen[\s\S]*Carmen guadalupe Alvarez[\s\S]*6531036512/);
    assert.equal((await carmen.locator('.estado-pill').textContent())!.trim(), 'Activo');
    assert.equal((await carmen.locator('.p-rol').textContent())!.trim(), 'Vendedora-Cajera'); assert.match((await carmen.locator('.p-tienda').textContent())!, /DÚO/);
    assert.equal(await page.locator('#tabla-personal input').count(), 0, 'ninguna tarjeta trae campos de contraseña o clave');
    assert.equal((await page.textContent('#tabla-personal tr[data-cajero]:has-text("Ana") .estado-pill'))!.trim(), 'Desactivado');
    assert.deepEqual(await carmen.locator('.p-acc .btn span').allTextContents(), ['Editar', 'Gestionar claves', 'Desactivar', 'Eliminar']);
    assert.deepEqual(await page.locator('#tabla-personal tr[data-sup] .p-acc .btn span').allTextContents(), ['Gestionar claves', 'Desactivar', 'Eliminar'], 'el supervisor de caja no tiene Editar (como antes)');
    assert.match(await page.locator('#tabla-personal tr[data-cajero]:has-text("Ana") .p-acc .btn').nth(2).textContent() ?? '', /Activar/);
    const rojo = await carmen.locator('.c-eliminar').evaluate((e) => ({ color: getComputedStyle(e).color, borde: getComputedStyle(e).borderTopColor }));
    assert.equal(rojo.color, rojo.borde, 'Eliminar en rojo'); assert.notEqual(rojo.color, await carmen.locator('.c-editar').evaluate((e) => getComputedStyle(e).color));
    // — Compacta, táctil y sin recortes en el teléfono.
    const caja = (await carmen.boundingBox())!;
    assert.ok(caja.height <= 285, `tarjeta compacta (${Math.round(caja.height)}px)`);
    const btns = await carmen.locator('.p-acc .btn').evaluateAll((b) => b.map((x) => ({ h: Math.round(x.getBoundingClientRect().height), corta: x.scrollWidth > x.clientWidth + 1 })));
    assert.ok(btns.every((b) => b.h >= 42 && !b.corta), JSON.stringify(btns));
    assert.equal(await page.evaluate(() => window.innerWidth), 440, 'la página no ensanchó la pantalla');
    // — Roles y permisos: el texto original, organizado en un cuadro.
    await page.click('#per-roles');
    await page.waitForSelector('#dlg-per-roles[open]');
    const roles = (await page.textContent('#dlg-per-roles'))!;
    for (const frase of ['Ve todo Administración, autoriza operaciones en la caja', 'clave de caja (4 a 8 dígitos)', 'Solo Inventario y Almacén', 'cambiar precios y fijar las existencias reales', 'cobra, pero no autoriza descuentos', 'usuario y contraseña (6 a 40 caracteres), que solo viven en el servidor central', 'Las Vendedoras-Cajeras no entran a Administración', 'propia clave (4 a 8 dígitos) para confirmar operaciones a su nombre', 'es con el que entra a la caja y el que sale en tickets y reportes', 'La clave no se puede volver a ver: si se olvida, se cambia']) assert.ok(roles.includes(frase), frase);
    await page.screenshot({ path: join(RAIZ, 'docs', 'capturas', 'personal-roles-y-permisos.png') });
    await page.click('#roles-ok');
    // — Gestionar claves: un cuadro por rol, sin mostrar claves actuales; la cajera solo trae clave de caja.
    await carmen.locator('.c-claves').click();
    await page.waitForSelector('#dlg-claves[open]');
    assert.equal(await page.locator('#dlg-claves #cl-clave').count(), 0, 'la cajera no tiene contraseña de Administración');
    assert.equal(await page.inputValue('#cl-clave-caja'), '', 'nunca se muestra la clave actual');
    await page.click('#cl-guardar');
    await page.waitForFunction(() => /Escriba la nueva clave/.test(document.querySelector('#msg-claves')?.textContent ?? ''));
    await page.fill('#cl-clave-caja', '7788'); await page.click('#cl-guardar');
    await page.waitForSelector('#dlg-claves', { state: 'hidden' });
    await page.waitForFunction(() => /Clave cambiada/.test(document.querySelector('#msg-cajeros')?.textContent ?? ''));
    await page.locator('#tabla-personal tr[data-sup] .s-claves').click();
    await page.waitForSelector('#dlg-claves[open]');
    assert.equal(await page.locator('#cl-clave').count(), 0); assert.match((await page.textContent('#claves-titulo'))!, /Gestionar claves/);
    await page.click('#cl-cerrar');
    // — Desactivar cambia el estado y el texto del botón; Editar abre el formulario de siempre.
    await carmen.locator('.c-activo').click();
    await page.waitForFunction(() => /Desactivado/.test(document.querySelector('#tabla-personal tr[data-cajero] .estado-pill')?.textContent ?? '') || true);
    await page.waitForFunction(() => [...document.querySelectorAll('#tabla-personal tr[data-cajero]')].some((r) => /Carmen/.test(r.textContent!) && /Desactivado/.test(r.querySelector('.estado-pill')!.textContent!)));
    await page.locator('#tabla-personal tr[data-cajero]:has-text("Carmen") .c-activo').click();
    await page.waitForFunction(() => [...document.querySelectorAll('#tabla-personal tr[data-cajero]')].some((r) => /Carmen/.test(r.textContent!) && /Activo/.test(r.querySelector('.estado-pill')!.textContent!)));
    await page.locator('#tabla-personal tr[data-cajero]:has-text("Carmen") .c-editar').click();
    await page.waitForSelector('#form-empleado'); await page.click('#emp-cerrar');
    await page.locator('#panel-personal').scrollIntoViewIfNeeded();
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({ path: join(RAIZ, 'docs', 'capturas', 'personal-perfiles-movil.png') });
    assert.deepEqual(errores, []);
  });

  it('PF2 sin desborde ni recortes en 320, 375, 390, 430 y 440 px (claro y oscuro) y en escritorio las tarjetas se reparten en varias columnas', async (t) => {
    const { abrir, sembrar } = await preparar(t);
    for (const [ancho, esquema] of [[320, 'dark'], [375, 'light'], [390, 'dark'], [430, 'light'], [440, 'dark']] as const) {
      const { page, errores } = await abrir({ ...IPHONE, viewport: { width: ancho, height: 900 }, deviceScaleFactor: 2, colorScheme: esquema });
      if (ancho === 320) await sembrar(page);
      await ir(page);
      const r = await page.evaluate((real) => ({ ancha: window.innerWidth, pagina: document.documentElement.scrollWidth, malos: [...document.querySelectorAll('#panel-personal *')].filter((e) => e.getBoundingClientRect().right > real + 1 && !e.closest('thead')).slice(0, 3).map((e) => `${e.tagName.toLowerCase()}.${String(e.className).slice(0, 20)}`), cortos: [...document.querySelectorAll('#tabla-personal .p-acc .btn, .btn-roles, #per-filtro, .per-contador')].filter((e) => e.scrollWidth > e.clientWidth + 1).map((e) => e.textContent!.trim()) }), ancho);
      assert.ok(r.ancha === ancho && r.pagina <= ancho + 1 && r.malos.length === 0, `${ancho}px sin desborde: ${JSON.stringify(r)}`);
      assert.deepEqual(r.cortos, [], `${ancho}px: controles con texto recortado`);
      if (ancho === 440 && esquema === 'dark') await page.screenshot({ path: join(RAIZ, 'docs', 'capturas', 'personal-perfiles-oscuro.png') });
      assert.deepEqual(errores, []);
    }
    const d = await abrir({ viewport: { width: 1366, height: 900 }, colorScheme: 'light' });
    await ir(d.page);
    const cols = await d.page.$$eval('#tabla-personal tr.persona-card', (c) => c.map((x) => Math.round(x.getBoundingClientRect().left)));
    assert.ok(new Set(cols).size >= 2, `en escritorio hay al menos dos columnas de tarjetas: ${cols}`);
    assert.equal(await d.page.locator('#per-roles').isVisible(), true);
    const botones = await d.page.$$eval('#tabla-personal tr[data-cajero] .p-acc .btn', (b) => new Set(b.slice(0, 4).map((x) => Math.round(x.getBoundingClientRect().top))).size);
    const det = await d.page.$$eval('#tabla-personal tr[data-cajero] .p-acc', (a) => a.slice(0, 1).map((x) => [...x.querySelectorAll('.btn')].map((b) => { const r = b.getBoundingClientRect(); return [Math.round(r.left), Math.round(r.top), Math.round(r.width)]; }).concat([[Math.round(x.getBoundingClientRect().width)]] as never)));
    assert.equal(botones, 1, `en escritorio las cuatro acciones van en una sola fila ${JSON.stringify(det)}`);
    await d.page.screenshot({ path: join(RAIZ, 'docs', 'capturas', 'personal-perfiles-escritorio.png') });
    assert.deepEqual(d.errores, []);
  });
});
