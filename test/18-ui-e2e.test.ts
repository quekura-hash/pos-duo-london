import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { chromium, type Browser, type Page } from 'playwright-core';
import { nuevoMundo, politica, ALMACENES } from './ayudas/comun.ts';
import { appAdmin, appCajero } from './ayudas/app.ts';

const CAPTURAS = join(import.meta.dirname, '..', 'docs', 'capturas');
const CANDIDATOS = [process.env.POS_CHROMIUM, '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', '/opt/pw-browsers/chromium/chrome-linux/chrome'];
const chromiumPath = CANDIDATOS.find((p) => p && existsSync(p));
const sqlite = ALMACENES.find((a) => a.nombre === 'sqlite')!;

async function pagina(browser: Browser, url: string, ancho = 1366, alto = 820): Promise<{ page: Page; errores: string[] }> {
  const ctx = await browser.newContext({ viewport: { width: ancho, height: alto }, colorScheme: 'light', locale: 'es-MX' });
  const page = await ctx.newPage();
  const errores: string[] = [];
  page.on('pageerror', (e) => errores.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error') errores.push(m.text()); });
  await page.goto(url);
  return { page, errores };
}
const escanear = async (page: Page, codigo: string) => { await page.fill('#scan', codigo); await page.press('#scan', 'Enter'); };
const celdas = async (page: Page, n: number) => page.$$eval(`#cuerpo tr[data-linea]:nth-child(${n}) td[data-col]`, (tds) => Object.fromEntries(tds.map((td) => [td.getAttribute('data-col'), td.textContent!.replace(/[−+]/g, '').replace(/Quitar.*$/, '').trim()])));

describe('[navegador real — Chromium con Playwright, UI sobre SQLite]', { timeout: 240_000, skip: chromiumPath ? false : 'Chromium no encontrado (defina POS_CHROMIUM)' }, () => {
  it('UI1 flujo completo: escanear → agregar → cobrar en efectivo → ticket → corte, con capturas', async (t) => {
    const browser = await chromium.launch({ executablePath: chromiumPath, args: ['--no-sandbox'] });
    const ctx = nuevoMundo(sqlite, politica());
    const app = await appCajero(ctx, 'DUO', 1, 'Ana');
    const app2 = await appCajero(ctx, 'DUO', 2, 'Beto');
    t.after(async () => { await browser.close(); await app.cerrar(); await app2.cerrar(); ctx.limpiar(); });
    const { page, errores } = await pagina(browser, app.url);

    // encabezado
    await page.waitForSelector('[data-chip="tienda"]');
    const chip = async (k: string) => (await page.textContent(`[data-chip="${k}"] b`))!.trim();
    assert.match(await chip('tienda'), /DÚO New York \(DUO\)/);
    assert.equal(await chip('caja'), '1');
    assert.equal(await chip('usuario'), 'Ana');
    assert.equal(await chip('fecha'), '01/10/2026 08:00');
    assert.match(await chip('folio'), /folio al cobrar/);
    assert.equal(await chip('hub'), 'Conectado');
    assert.equal(await chip('pendientes'), '0');
    // navegación según permisos: un cajero NO ve Administración ni Reportes
    assert.deepEqual(await page.$$eval('#nav button', (b) => b.map((x) => x.textContent)), ['Venta', 'Mi corte', 'Ventas de mi caja']);
    // tabla: columnas separadas y en el orden pedido
    assert.deepEqual(await page.$$eval('#tabla-venta thead th:not(:last-child)', (h) => h.map((x) => x.textContent)),
      ['Item #', 'Código', 'Descripción', 'Marca', 'Estilo', 'Lote', 'Cant.', 'Precio unit.', 'Descuento', 'Importe']);
    // botón de regalo visible y deshabilitado (etapa posterior), debajo de Cobrar
    const regalo = page.locator('#btn-regalo');
    assert.equal(await regalo.isVisible(), true);
    assert.equal(await regalo.isDisabled(), true);
    const yCobrar = (await page.locator('#btn-cobrar').boundingBox())!.y;
    assert.ok((await regalo.boundingBox())!.y > yCobrar, 'el botón de regalo va debajo de Cobrar');

    // escanear (con ceros iniciales) y agregar
    await escanear(page, '0002026090782');
    await page.waitForSelector('#cuerpo tr[data-linea]');
    assert.deepEqual(await celdas(page, 1), {
      item_no: '1001', codigo: '0002026090782', descripcion: 'JEANS', marca: 'LEVIS', estilo: '726-', lote: '20260913',
      cantidad: '1', precio: '$899.00', descuento: '$0.00', importe: '$899.00',
    });
    await escanear(page, '0002026090782');
    await page.waitForFunction(() => document.querySelector('#cuerpo tr[data-linea] [data-col="cantidad"] b')?.textContent === '2');
    await escanear(page, '7501234567890');
    await page.waitForSelector('#cuerpo tr[data-linea]:nth-child(2)');
    await page.click('#cuerpo tr[data-linea]:nth-child(2) [data-accion="mas"]');
    await page.waitForFunction(() => document.querySelectorAll('#cuerpo tr[data-linea]')[1]?.querySelector('[data-col="cantidad"] b')?.textContent === '2');
    await escanear(page, '0000000000017'); // bolsa: se agrega y se quita
    await page.waitForSelector('#cuerpo tr[data-linea]:nth-child(3)');
    await page.click('#cuerpo tr[data-linea]:nth-child(3) [data-accion="quitar"]');
    await page.waitForFunction(() => document.querySelectorAll('#cuerpo tr[data-linea]').length === 2);
    // detalle con departamento
    await page.click('#cuerpo tr[data-linea]:nth-child(1) td[data-col="descripcion"]');
    assert.match((await page.textContent('#detalle'))!, /Departamento\s*CABALLERO/);
    assert.equal(await page.textContent('#total'), '$2,038.00');
    assert.equal(await page.textContent('#piezas'), '4');

    // efectivo: cobrar deshabilitado hasta cubrir el total; cambio calculado
    assert.equal(await page.locator('#btn-cobrar').isDisabled(), true);
    await page.fill('#recibido', '2000');
    assert.equal(await page.locator('#btn-cobrar').isDisabled(), true);
    await page.fill('#recibido', '2100');
    assert.equal(await page.textContent('#cambio'), '$62.00');
    assert.equal(await page.locator('#btn-cobrar').isDisabled(), false);
    await page.screenshot({ path: join(CAPTURAS, '01-venta-en-curso.png') });
    await page.click('#btn-cobrar');

    // ticket
    await page.waitForSelector('#dlg-ticket[open]');
    assert.match((await page.textContent('#resumen-venta'))!, /Folio 000001 · ticket D1-000001 · cambio \$62\.00/);
    assert.match((await page.textContent('#estado-impresion'))!, /Ticket enviado a la impresora/);
    const ticket = (await page.textContent('#ticket-texto'))!;
    assert.match(ticket, /Item #: 1001 +Código: 0002026090782/);
    assert.match(ticket, /Marca: LEVIS +Estilo: 726- +Lote: 20260913/);
    assert.match(ticket, /TOTAL +\$2,038\.00/);
    assert.match(ticket, /Efectivo MXN +\$2,038\.00/);
    assert.doesNotMatch(ticket, /iva|tax|impuesto|%/i);
    assert.equal(await chip('folio'), 'Folio 000001');
    await page.screenshot({ path: join(CAPTURAS, '02-ticket.png') });
    assert.equal(app.s.impresora.trabajos, 1);
    await page.click('#btn-nueva');
    await page.waitForSelector('#scan');
    assert.equal(await page.textContent('#total'), '$0.00');

    // corte de ESTA caja
    await page.click('#nav button[data-vista="corte"]');
    await page.waitForSelector('#tabla-corte');
    const corte = async (k: string) => (await page.textContent(`#tabla-corte tr[data-campo="${k}"] td`))!.trim();
    assert.deepEqual([await corte('tickets'), await corte('ventas'), await corte('cobros_efectivo'), await corte('efectivo_esperado'), await corte('folio_inicial'), await corte('folio_final')],
      ['1', '$2,038.00', '$2,038.00', '$2,038.00', '1', '1']);
    await page.screenshot({ path: join(CAPTURAS, '03-corte.png') });
    await page.click('#btn-cerrar-corte');
    await page.waitForSelector('#estado-corte .mensaje');
    assert.match((await page.textContent('#estado-corte'))!, /Corte cerrado/);

    // ventas de la caja y reimpresión
    await page.click('#nav button[data-vista="ventas"]');
    await page.waitForSelector('#tabla-ventas tr[data-folio="1"]');
    assert.match((await page.textContent('#tabla-ventas tr[data-folio="1"]'))!, /000001.*Ana.*\$2,038\.00/);

    // inventario compartido: tras sincronizar, la Caja 2 ve 3 de 5 jeans y la Caja 1 sigue con su serie
    ctx.m.pump();
    const p2 = (await pagina(browser, app2.url)).page;
    await p2.waitForSelector('#scan');
    assert.equal(await p2.textContent('[data-chip="caja"] b'), '2');
    await escanear(p2, 'levis');
    await p2.waitForSelector('.tabla-resultados');
    const filas = await p2.$$eval('.tabla-resultados tbody tr', (trs) => trs.map((tr) => tr.textContent!.replace(/\s+/g, ' ')));
    assert.ok(filas.some((f) => /1001.*0002026090782.*JEANS.*LEVIS.*726-.*20260913.*\$899\.00.*3/.test(f)), `existencia compartida: ${filas.join(' | ')}`);
    assert.deepEqual(errores, [], 'sin errores en la consola del navegador');
    // el cajero de la Caja 2 intenta ver la caja 1: el servidor lo rechaza (el navegador registra el 403 como error de red)
    const intento = await p2.evaluate(async () => (await fetch('/api/ventas?cajas=DUO/1')).status);
    assert.equal(intento, 403);
  });

  it('UI2 falla de impresora: se avisa, la venta queda guardada y se reintenta con el mismo folio', async (t) => {
    const browser = await chromium.launch({ executablePath: chromiumPath, args: ['--no-sandbox'] });
    const ctx = nuevoMundo(sqlite, politica());
    const app = await appCajero(ctx, 'LON', 2, 'Luis');
    t.after(async () => { await browser.close(); await app.cerrar(); ctx.limpiar(); });
    const { page, errores } = await pagina(browser, app.url);
    await page.waitForSelector('#scan');
    assert.match(await page.textContent('[data-chip="tienda"] b') ?? '', /London Love \(LON\)/);
    app.s.impresora.falla = 'sin papel';
    await escanear(page, '7501234567890');
    await page.waitForSelector('#cuerpo tr[data-linea]');
    await page.click('#btn-exacto');
    await page.click('#btn-cobrar');
    await page.waitForSelector('#dlg-ticket[open]');
    assert.match((await page.textContent('#estado-impresion'))!, /impresora falló: sin papel.*SÍ quedó guardada/);
    assert.match((await page.textContent('#resumen-venta'))!, /Folio 000001/);
    await page.screenshot({ path: join(CAPTURAS, '04-falla-de-impresora.png') });
    app.s.impresora.falla = null;
    await page.click('#btn-reimprimir');
    await page.waitForFunction(() => /reimpresión/.test(document.querySelector('#estado-impresion')!.textContent!));
    assert.match((await page.textContent('#ticket-texto'))!, /\*\*\* REIMPRESIÓN 1 \*\*\*/);
    assert.match((await page.textContent('#ticket-texto'))!, /Folio: 000001/);
    assert.equal(ctx.m.caja('LON', 2).ops().filter((o) => o.tipo === 'sale.confirmed').length, 1);
    assert.deepEqual(errores, []);
  });

  it('UI3 un código duplicado no se agrega: la pantalla lo explica y pide a Administración resolverlo', async (t) => {
    const browser = await chromium.launch({ executablePath: chromiumPath, args: ['--no-sandbox'] });
    const ctx = nuevoMundo(sqlite, politica());
    t.after(async () => { await browser.close(); await app.cerrar(); ctx.limpiar(); });
    ctx.m.cortarInternet('DUO'); ctx.m.cortarInternet('LON');
    const dup = (marca: string) => ({ codigo: '7507777777777', marca, descripcion: 'FALDA', estilo: 'F-1', lote: '20261016', departamento: 'DAMA', precio: 30000, existencia_inicial: 2 });
    ctx.m.caja('DUO', 2).altaArticulo(dup('A'));
    ctx.m.caja('LON', 1).altaArticulo(dup('B'));
    ctx.m.restablecerInternet('DUO'); ctx.m.restablecerInternet('LON'); ctx.m.pump(); ctx.m.pump();
    const app = await appCajero(ctx, 'DUO', 1);
    const { page } = await pagina(browser, app.url);
    await page.waitForSelector('#scan');
    await escanear(page, '7507777777777');
    await page.waitForSelector('[data-resultado="ambiguo"]');
    assert.match((await page.textContent('#mensaje'))!, /duplicado.*Administración/);
    assert.equal(await page.locator('#cuerpo tr[data-linea]').count(), 0);
    assert.equal(await page.locator('[data-resultado="ambiguo"] li').count(), 2);
    await escanear(page, 'falda');
    await page.waitForSelector('.tabla-resultados');
    assert.equal(await page.locator('.tabla-resultados [data-agregar]').count(), 0, 'no se ofrece elegir entre artículos con código duplicado');
  });

  it('UI4 Administración: solo Reportes; elige una, varias o todas las cajas y ve los folios originales', async (t) => {
    const browser = await chromium.launch({ executablePath: chromiumPath, args: ['--no-sandbox'] });
    const ctx = nuevoMundo(sqlite, politica());
    const a1 = await appCajero(ctx, 'DUO', 1);
    const a2 = await appCajero(ctx, 'LON', 2, 'Luis');
    const adm = await appAdmin(ctx);
    t.after(async () => { await browser.close(); await a1.cerrar(); await a2.cerrar(); await adm.cerrar(); ctx.limpiar(); });
    for (const [s, n] of [[a1.s.svc, 2], [a2.s.svc, 1]] as const) {
      for (let i = 0; i < n; i++) { const c = s.nuevaVenta(); s.escanear(c, '7501234567890'); await s.cobrarEfectivo(c, 12000); }
    }
    ctx.m.pump();
    const { page, errores } = await pagina(browser, adm.url);
    await page.waitForSelector('#filtros');
    assert.deepEqual(await page.$$eval('#nav button', (b) => b.map((x) => x.textContent)), ['Reportes']);
    await page.fill('#desde', '2026-10-01');
    await page.fill('#hasta', '2026-10-01');
    await page.click('#filtros button[type="submit"]');
    await page.waitForSelector('#tabla-reporte tbody tr');
    assert.equal(await page.locator('#tabla-reporte tbody tr').count(), 3);
    assert.equal(await page.textContent('#total-consolidado'), '$360.00');
    await page.screenshot({ path: join(CAPTURAS, '05-administracion-todas.png') });
    // una sola caja
    await page.uncheck('#todas');
    await page.check('.caja[value="DUO/1"]');
    await page.click('#filtros button[type="submit"]');
    await page.waitForFunction(() => document.querySelectorAll('#tabla-reporte tbody tr').length === 2);
    assert.deepEqual(await page.$$eval('#tabla-reporte tbody tr', (r) => r.map((x) => [...x.querySelectorAll('td')].slice(0, 3).map((c) => c.textContent))), [['DUO', '1', '000001'], ['DUO', '1', '000002']]);
    // varias cajas de tiendas distintas
    await page.check('.caja[value="LON/2"]');
    await page.click('#filtros button[type="submit"]');
    await page.waitForFunction(() => document.querySelectorAll('#tabla-reporte tbody tr').length === 3);
    assert.deepEqual(await page.$$eval('#tabla-por-caja tbody tr:not(:last-child)', (r) => r.map((x) => [...x.querySelectorAll('td')].map((c) => c.textContent).join(' '))), ['DUO 1 2 $240.00', 'LON 2 1 $120.00']);
    assert.deepEqual(errores, []);
  });

  it('UI5 pantalla angosta: la interfaz sigue usable (sin desbordar horizontalmente la página)', async (t) => {
    const browser = await chromium.launch({ executablePath: chromiumPath, args: ['--no-sandbox'] });
    const ctx = nuevoMundo(sqlite, politica());
    const app = await appCajero(ctx, 'DUO', 1);
    t.after(async () => { await browser.close(); await app.cerrar(); ctx.limpiar(); });
    const { page } = await pagina(browser, app.url, 820, 900);
    await page.waitForSelector('#scan');
    await escanear(page, '7501234567890');
    await page.waitForSelector('#cuerpo tr[data-linea]');
    const desborde = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    assert.ok(desborde <= 1, `desborde horizontal de ${desborde}px`);
    await page.screenshot({ path: join(CAPTURAS, '06-pantalla-angosta.png') });
  });

  it('UI6 las diez columnas caben sin desplazamiento horizontal en 1366, 1280 y 1024 px de ancho', async (t) => {
    const browser = await chromium.launch({ executablePath: chromiumPath, args: ['--no-sandbox'] });
    const ctx = nuevoMundo(sqlite, politica());
    const app = await appCajero(ctx, 'DUO', 1);
    t.after(async () => { await browser.close(); await app.cerrar(); ctx.limpiar(); });
    for (const [ancho, alto] of [[1366, 768], [1280, 800], [1024, 768]] as const) {
      const { page } = await pagina(browser, app.url, ancho, alto);
      await page.waitForSelector('#scan');
      await escanear(page, '0002026090782');
      await page.waitForSelector('#cuerpo tr[data-linea]');
      await escanear(page, '7501234567890');
      await page.waitForSelector('#cuerpo tr[data-linea]:nth-child(2)');
      const m = await page.evaluate(() => {
        const cont = document.querySelector('.tabla-cont')!;
        const ths = [...document.querySelectorAll('#tabla-venta thead th')].map((th) => th.getBoundingClientRect());
        const c = cont.getBoundingClientRect();
        return { sobra: cont.scrollWidth - cont.clientWidth, primeraIzq: ths[0]!.left - c.left, ultimaDer: c.right - ths[ths.length - 1]!.right };
      });
      assert.ok(m.sobra <= 1, `${ancho}px: la tabla se desborda ${m.sobra}px`);
      assert.ok(m.primeraIzq >= -1 && m.ultimaDer >= -1, `${ancho}px: columnas fuera del área visible`);
      if (ancho === 1366) await page.screenshot({ path: join(CAPTURAS, '01-venta-en-curso.png') });
      if (ancho === 1024) await page.screenshot({ path: join(CAPTURAS, '07-venta-1024.png') });
      await page.context().close();
    }
  });
});
