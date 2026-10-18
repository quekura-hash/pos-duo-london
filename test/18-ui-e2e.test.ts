import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { chromium, type Browser, type Page } from 'playwright-core';
import { nuevoMundo, politica, ALMACENES } from './ayudas/comun.ts';
import { appAdmin, appCajero } from './ayudas/app.ts';
import { leerXlsxNode } from '../src/xlsx-node.ts';
import { readFileSync } from 'node:fs';

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
    assert.match(await chip('tienda'), /^DÚO New York$/);
    assert.equal(await chip('caja'), '1');
    assert.equal(await chip('usuario'), 'Ana');
    assert.equal(await chip('fecha'), '01 oct 2026 · 08:00');
    assert.match(await chip('folio'), /folio al cobrar/);
    assert.equal(await chip('hub'), 'Conectado');
    assert.equal(await chip('pendientes'), '0');
    // navegación según permisos: un cajero NO ve Administración ni Reportes
    assert.deepEqual(await page.$$eval('#nav button', (b) => b.map((x) => x.textContent)), ['Venta', 'Retiro', 'Historial', 'Corte de caja', 'Tarjetas de regalo']);
    // tabla: columnas separadas y en el orden pedido
    assert.deepEqual(await page.$$eval('#tabla-venta thead th:not(:last-child)', (h) => h.map((x) => x.textContent)),
      ['Item #', 'Código', 'Descripción', 'Marca', 'Estilo', 'Lote', 'Cant.', 'Precio', 'Desc.', 'Importe']);
    // botón de ticket de regalo visible y activo (se enciende antes de cobrar), debajo de Cobrar
    const regalo = page.locator('#btn-regalo');
    assert.equal(await regalo.isVisible(), true);
    assert.equal(await regalo.isDisabled(), false);
    assert.equal(await regalo.getAttribute('aria-pressed'), 'false');
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
    assert.match(ticket, /^#1001 0002026090782 +/m);
    assert.match(ticket, /^\d+ JEANS LEVIS 726-$/m);
    assert.doesNotMatch(ticket, /Marca:|Estilo:|Lote/);
    assert.match(ticket, /TOTAL +\$2,038\.00/);
    assert.match(ticket, /Efectivo MXN +\$2,038\.00/);
    assert.doesNotMatch(ticket, /iva|tax|impuesto|%/i);
    assert.equal(await chip('folio'), 'Folio 000001');
    await page.screenshot({ path: join(CAPTURAS, '02-ticket.png') });
    assert.equal(app.s.impresora.trabajos, 1);
    await page.click('#btn-nueva');
    await page.waitForFunction(() => document.querySelector('#total')?.textContent === '$0.00');

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
    assert.match(await page.textContent('[data-chip="tienda"] b') ?? '', /^London Love$/);
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

  it('UI3 un código duplicado (P-13): la pantalla lo explica, el cajero elige y el renglón queda marcado para revisión', async (t) => {
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
    assert.match((await page.textContent('#mensaje'))!, /duplicado.*Administración lo revise/);
    assert.equal(await page.locator('#cuerpo tr[data-linea]').count(), 0, 'nada se agrega solo');
    assert.equal(await page.locator('[data-resultado="ambiguo"] li').count(), 2);
    await page.click('[data-resultado="ambiguo"] li:nth-child(1) [data-agregar]');
    await page.waitForSelector('#cuerpo tr[data-linea]');
    assert.match((await page.textContent('#mensaje'))!, /queda marcado para revisión/);
    await escanear(page, 'falda');
    await page.waitForSelector('.tabla-resultados');
    assert.equal(await page.locator('.tabla-resultados [data-agregar]').count(), 2, 'se puede elegir entre los artículos con código duplicado');
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
    assert.deepEqual(await page.$$eval('#nav button', (b) => b.map((x) => x.textContent)), ['Reportes', 'Cortes', 'Inventario', 'Almacén', 'Promociones', 'Tarjetas de regalo', 'Configuración', 'Créditos']);
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

  it('UI7 Administración consulta el inventario y lo exporta a Excel (descarga real del navegador)', async (t) => {
    const browser = await chromium.launch({ executablePath: chromiumPath, args: ['--no-sandbox'] });
    const ctx = nuevoMundo(sqlite, politica());
    const a1 = await appCajero(ctx, 'DUO', 1);
    const adm = await appAdmin(ctx);
    t.after(async () => { await browser.close(); await a1.cerrar(); await adm.cerrar(); ctx.limpiar(); });
    const s = a1.s.svc;
    const c = s.nuevaVenta(); s.escanear(c, '0002026090782'); s.escanear(c, '0002026090782');
    await s.cobrarEfectivo(c, 200000);
    ctx.m.pump();
    const { page, errores } = await pagina(browser, adm.url);
    await page.waitForSelector('#nav');
    await page.click('#nav button[data-vista="inventario"]');
    await page.waitForSelector('#tabla-inv-resumen');
    assert.equal(await page.textContent('#tabla-inv-resumen [data-campo="articulos"]'), '4');
    assert.equal(await page.textContent('#tabla-inv-resumen [data-campo="sin_codigo"]'), '0');
    assert.deepEqual(await page.$$eval('#tabla-inv-tiendas tbody tr', (r) => r.map((x) => [...x.querySelectorAll('td')].map((c) => c.textContent))), [['DUO', '57', '4', '0'], ['LON', '53', '2', '0'], ['El Limbo', '0', '0', '0']]);
    assert.equal(await page.locator('#tabla-inv-lista tbody tr[data-item]').count(), 4, 'la lista completa del inventario');
    await page.screenshot({ path: join(CAPTURAS, '09-inventario-administracion.png') });
    const [descarga] = await Promise.all([page.waitForEvent('download'), page.click('#btn-exportar')]);
    assert.equal(descarga.suggestedFilename(), 'inventario.xlsx');
    const ruta = await descarga.path();
    const filas = (await leerXlsxNode(readFileSync(ruta!)))[0]!.filas;
    assert.deepEqual(filas[0]!.slice(0, 8), ['Item #', 'Código', 'Marca', 'Descripción', 'Estilo', 'Lote', 'Departamento', 'Precio de venta']);
    assert.equal(filas.length, 5);
    assert.deepEqual(filas[1]!.slice(0, 2), [1001, '0002026090782'], 'el código conserva sus ceros');
    assert.deepEqual(filas[1]!.slice(12, 14), [3, 3], 'existencia DÚO 5 − 2 vendidas y London 3');
    // un cajero no tiene la ruta de inventario
    const r = await fetch(`${a1.url}/api/admin/inventario`);
    assert.equal(r.status, 403);
    assert.deepEqual(errores, []);
  });

  it('UI8 maqueta: logo de la tienda arriba a la izquierda, sin Apartados, botones con iconos y pendientes visibles pero deshabilitados', async (t) => {
    const browser = await chromium.launch({ executablePath: chromiumPath, args: ['--no-sandbox'] });
    const ctx = nuevoMundo(sqlite, politica());
    const duo = await appCajero(ctx, 'DUO', 1, 'Andrea');
    const lon = await appCajero(ctx, 'LON', 2, 'Luis');
    t.after(async () => { await browser.close(); await duo.cerrar(); await lon.cerrar(); ctx.limpiar(); });
    for (const [app, tienda, alt] of [[duo, 'DUO', 'DÚO New York'], [lon, 'LON', 'London Love']] as const) {
      const { page, errores } = await pagina(browser, app.url);
      await page.waitForSelector('[data-logo]');
      assert.equal(await page.getAttribute('[data-logo]', 'data-logo'), tienda);
      assert.equal(await page.getAttribute('[data-logo]', 'alt'), alt);
      const caja = await page.locator('.encabezado .logo').boundingBox();
      assert.ok(caja!.x < 40 && caja!.y < 40, 'el logo va en la esquina superior izquierda');
      assert.equal(await page.evaluate(() => (document.querySelector('.encabezado .logo') as HTMLImageElement).naturalWidth > 50), true, 'el logo cargó');
      const texto = (await page.textContent('body'))!;
      assert.doesNotMatch(texto, /apartado/i, 'no hay botones ni referencias a apartados');
      assert.equal(await page.locator('#nav button svg').count(), tienda === 'DUO' ? 5 : 4, 'cada opción de navegación tiene su icono (la Caja 2 no tiene Tarjetas de regalo)');
      const sinIcono = await page.$$eval('button:not(.btn-icono):not([type=submit])', (bs) => bs.filter((b) => !b.querySelector('svg') && !/^[−+]$/.test(b.textContent!.trim())).map((b) => b.textContent!.trim()));
      assert.deepEqual(sinIcono, [], 'todo botón visible lleva icono');
      for (const id of ['btn-nuevo-articulo', 'btn-editar-venta']) {
        const b = page.locator(`#${id}`);
        if (await b.count()) { assert.equal(await b.isDisabled(), true, id); assert.equal(await b.getAttribute('title'), 'Próximamente'); }
      }
      assert.equal(await page.locator('#nav button[data-proximamente="creditos"]').count(), 0, 'Créditos ya no está en el menú de venta');
      const formas = await page.$$eval('#formas button', (b) => b.map((x) => [x.textContent!.trim(), (x as HTMLButtonElement).disabled]));
      assert.deepEqual(formas, [['Efectivo', false], ['Tarjeta', tienda !== 'DUO'], ['Mixto', tienda !== 'DUO'], ['Tarjeta de regalo', tienda !== 'DUO']]);
      assert.deepEqual(errores, []);
    }
    const { page } = await pagina(browser, duo.url);
    await page.waitForSelector('#scan');
    await page.screenshot({ path: join(CAPTURAS, '10-maqueta-duo.png') });
  });

  it('UI9 tarjeta de regalo: alta con comprobante, cobro total y cobro parcial con efectivo, saldo y corte', async (t) => {
    const browser = await chromium.launch({ executablePath: chromiumPath, args: ['--no-sandbox'] });
    const ctx = nuevoMundo(sqlite, politica());
    const app = await appCajero(ctx, 'DUO', 1, 'Andrea');
    const adm = await appAdmin(ctx);
    t.after(async () => { await browser.close(); await app.cerrar(); await adm.cerrar(); ctx.limpiar(); });
    const { page, errores } = await pagina(browser, app.url);
    await page.waitForSelector('#scan');
    await page.click('#nav button[data-vista="tarjetas"]');
    await page.waitForSelector('#form-alta');
    // monto inválido
    await page.fill('#alta-codigo', 'TR-0001');
    await page.fill('#alta-monto', 'abc');
    await page.click('#btn-alta');
    assert.match((await page.textContent('#msg-alta'))!, /monto válido/);
    await page.fill('#alta-monto', '200');
    await page.click('#btn-alta');
    await page.waitForSelector('#dlg-ticket[open]');
    assert.match((await page.textContent('#resumen-alta'))!, /TR-0001.*saldo \$200\.00.*folio 000001.*cambio \$0\.00/);
    assert.match((await page.textContent('#ticket-texto'))!, /Folio: 000001[\s\S]*Tarjeta de regalo TR-0001\s+TR-0001 +\$200\.00[\s\S]*TOTAL +\$200\.00[\s\S]*Efectivo MXN +\$200\.00/);
    await page.screenshot({ path: join(CAPTURAS, '11-alta-tarjeta-regalo.png') });
    await page.click('#btn-cerrar');
    await page.waitForSelector('#tabla-tarjetas tr[data-tarjeta="TR-0001"]');
    // duplicada
    await page.fill('#alta-codigo', 'TR-0001');
    await page.fill('#alta-monto', '50');
    await page.click('#btn-alta');
    await page.waitForFunction(() => /ya está dada de alta/.test(document.querySelector('#msg-alta')!.textContent!));
    // consultar saldo
    await page.fill('#saldo-codigo', 'TR-0001');
    await page.click('#btn-saldo');
    await page.waitForSelector('#saldo-consultado');
    assert.equal(await page.textContent('#saldo-consultado'), '$200.00');
    await page.fill('#saldo-codigo', 'NOEXISTE');
    await page.click('#btn-saldo');
    await page.waitForFunction(() => /no está dada de alta/.test(document.querySelector('#resultado-saldo')!.textContent!));

    // cobro con la tarjeta: mascada $120 con saldo $200 -> saldo $80, sin efectivo
    await page.click('#nav button[data-vista="venta"]');
    await page.waitForSelector('#scan');
    await escanear(page, '7501234567890');
    await page.waitForSelector('#cuerpo tr[data-linea]');
    await page.click('#formas button[data-forma="regalo"]');
    assert.equal(await page.locator('#btn-cobrar').isDisabled(), true, 'sin tarjeta no se puede cobrar');
    await page.fill('#codigo-regalo', 'TR-0001');
    await page.press('#codigo-regalo', 'Enter');
    await page.waitForSelector('#regalo-aplicado');
    assert.deepEqual([await page.textContent('#saldo-regalo'), await page.textContent('#regalo-aplicado'), await page.textContent('#regalo-restante')], ['$200.00', '$120.00', '$80.00']);
    assert.equal(await page.locator('#resto-regalo').isHidden(), true);
    assert.equal(await page.locator('#btn-cobrar').isDisabled(), false);
    await page.screenshot({ path: join(CAPTURAS, '12-cobro-tarjeta-regalo.png') });
    await page.click('#btn-cobrar');
    await page.waitForSelector('#dlg-ticket[open]');
    assert.match((await page.textContent('#resumen-venta'))!, /Folio 000002.*cambio \$0\.00.*saldo de la tarjeta \$80\.00/);
    const tk = (await page.textContent('#ticket-texto'))!;
    assert.match(tk, /Tarjeta de regalo +\$120\.00/);
    assert.match(tk, /Tarjeta: TR-0001 +Saldo \$80\.00/);
    await page.click('#btn-nueva');
    await page.waitForFunction(() => document.querySelector('#total')?.textContent === '$0.00');

    // cobro parcial: 2 mascadas $240 con saldo $80 -> $160 en efectivo
    await page.waitForSelector('#scan');
    await escanear(page, '7501234567890');
    await page.waitForSelector('#cuerpo tr[data-linea]');
    await escanear(page, '7501234567890');
    await page.waitForFunction(() => document.querySelector('#cuerpo [data-col="cantidad"] b')?.textContent === '2');
    await page.click('#formas button[data-forma="regalo"]');
    await page.fill('#codigo-regalo', 'TR-0001');
    await page.press('#codigo-regalo', 'Enter');
    await page.waitForSelector('#regalo-resto');
    assert.equal(await page.textContent('#regalo-resto'), '$160.00');
    assert.equal(await page.locator('#btn-cobrar').isDisabled(), true, 'falta el efectivo del resto');
    await page.fill('#recibido', '100');
    assert.equal(await page.locator('#btn-cobrar').isDisabled(), true);
    await page.fill('#recibido', '200');
    assert.equal(await page.textContent('#cambio'), '$40.00');
    await page.click('#btn-cobrar');
    await page.waitForSelector('#dlg-ticket[open]');
    assert.match((await page.textContent('#resumen-venta'))!, /Folio 000003.*cambio \$40\.00.*saldo de la tarjeta \$0\.00/);
    await page.click('#btn-nueva');
    await page.waitForFunction(() => document.querySelector('#total')?.textContent === '$0.00');
    // tarjeta agotada
    await page.waitForSelector('#scan');
    await escanear(page, '7501234567890');
    await page.waitForSelector('#cuerpo tr[data-linea]');
    await page.click('#formas button[data-forma="regalo"]');
    await page.fill('#codigo-regalo', 'TR-0001');
    await page.press('#codigo-regalo', 'Enter');
    await page.waitForSelector('#regalo-aplicado').catch(() => {});
    assert.equal(await page.locator('#btn-cobrar').isDisabled(), true, 'sin saldo no se cobra');

    // corte: efectivo esperado = efectivo del resto ($160) + alta ($200)
    await page.click('#nav button[data-vista="corte"]');
    await page.waitForSelector('#tabla-corte');
    const corte = async (k: string) => (await page.textContent(`#tabla-corte tr[data-campo="${k}"] td`))!.trim();
    assert.deepEqual([await corte('tickets'), await corte('cobros_efectivo'), await corte('cobros_tarjeta_regalo'), await corte('tarjetas_regalo_vendidas'), await corte('ventas_mercancia'), await corte('ventas_netas'), await corte('efectivo_esperado')],
      ['3', '$360.00', '$200.00', '$200.00', '$360.00', '$360.00', '$360.00']);
    await page.screenshot({ path: join(CAPTURAS, '13-corte-con-tarjeta-regalo.png') });

    // Administración ve el libro de tarjetas
    ctx.m.pump(); ctx.m.pump();
    const a = (await pagina(browser, adm.url)).page;
    await a.waitForSelector('#nav');
    await a.click('#nav button[data-vista="tarjetas"]');
    await a.waitForSelector('#tabla-tarjetas tr[data-tarjeta="TR-0001"]');
    assert.match((await a.textContent('#tabla-tarjetas tr[data-tarjeta="TR-0001"]'))!, /TR-0001.*DUO · Caja 1.*\$200\.00.*\$200\.00.*\$0\.00.*2027/);
    // el cajero no tiene la ruta del libro completo
    assert.equal((await fetch(`${app.url}/api/admin/tarjetas`)).status, 403);
    // el reporte consolidado separa la venta de la tarjeta de la mercancía
    await a.click('#nav button[data-vista="reportes"]');
    await a.fill('#desde', '2026-10-01'); await a.fill('#hasta', '2026-10-01');
    await a.click('#filtros button[type="submit"]');
    await a.waitForSelector('#total-mercancia');
    assert.deepEqual([await a.textContent('#total-consolidado'), await a.textContent('#total-mercancia')], ['$560.00', '$360.00']);
    assert.deepEqual(errores.filter((e) => !/409|403/.test(e)), []);
  });

  it('UI10 recarga y vencimiento visibles; cambio o devolución: busca por fecha/hora y por artículo en ambas cajas, devuelve solo en la caja de origen', async (t) => {
    const browser = await chromium.launch({ executablePath: chromiumPath, args: ['--no-sandbox'] });
    const ctx = nuevoMundo(sqlite, politica());
    const app = await appCajero(ctx, 'DUO', 1, 'Andrea');
    const app2 = await appCajero(ctx, 'DUO', 2, 'Beto');
    t.after(async () => { await browser.close(); await app.cerrar(); await app2.cerrar(); ctx.limpiar(); });
    // una venta en cada caja
    const s1 = app.s.svc, s2 = app2.s.svc;
    const c1 = s1.nuevaVenta(); s1.escanear(c1, '0002026090782'); const v1 = (await s1.cobrarEfectivo(c1, 89900)).venta;
    const c2 = s2.nuevaVenta(); s2.escanear(c2, '7501234567890'); const v2 = (await s2.cobrarEfectivo(c2, 12000)).venta;
    ctx.m.pump();
    const { page, errores } = await pagina(browser, app.url);
    await page.waitForSelector('#scan');
    // recarga de una tarjeta
    await page.click('#nav button[data-vista="tarjetas"]');
    await page.fill('#alta-codigo', 'R-1'); await page.fill('#alta-monto', '100'); await page.click('#btn-alta');
    await page.waitForSelector('#dlg-ticket[open]'); await page.click('#btn-cerrar');
    await page.waitForSelector('#tabla-tarjetas tr[data-tarjeta="R-1"]');
    await page.fill('#rec-codigo', 'R-1'); await page.fill('#rec-monto', '50'); await page.fill('#rec-recibido', '100');
    await page.click('#btn-recarga');
    await page.waitForSelector('#dlg-ticket[open]');
    assert.match((await page.textContent('#resumen-alta'))!, /R-1.*saldo \$150\.00.*cambio \$50\.00/);
    assert.match((await page.textContent('#ticket-texto'))!, /Recarga de tarjeta de regalo R-1/);
    await page.click('#btn-cerrar');
    await page.waitForFunction(() => document.querySelector('#tabla-tarjetas tr[data-tarjeta="R-1"] [data-col="saldo"]')?.textContent === '$150.00');
    await page.fill('#saldo-codigo', 'R-1'); await page.click('#btn-saldo');
    await page.waitForSelector('#saldo-consultado');
    assert.match((await page.textContent('#resultado-saldo'))!, /\$150\.00.*Vigente hasta 01 oct 2027/);
    // devolución: la venta de la otra caja se localiza pero no se devuelve aquí
    await page.click('#nav button[data-vista="venta"]');
    await page.click('#btn-devolucion');
    await page.waitForSelector('#form-buscar-venta');
    await page.fill('#bv-fecha', '2026-10-01');
    await page.click('#form-buscar-venta button[type="submit"]');
    await page.waitForSelector('[data-venta-propia]');
    assert.equal(await page.locator('[data-venta-propia]').count(), 3, 'jeans, venta de tarjeta y recarga de esta caja');
    assert.equal(await page.locator('[data-venta-ajena]').count(), 1);
    assert.match((await page.textContent('[data-venta-ajena]'))!, /D2-000001[\s\S]*Caja 2[\s\S]*MASCADA[\s\S]*Esta venta se hizo en la Caja 2/);
    assert.equal(await page.locator('[data-venta-ajena] input').count(), 0, 'no hay cómo devolver una venta de otra caja');
    assert.doesNotMatch((await page.textContent('[data-venta-ajena]'))!, /\$120\.00/, 'no se muestran importes de la otra caja');
    // por artículo escaneado
    await page.fill('#bv-codigo', '7501234567890');
    await page.click('#form-buscar-venta button[type="submit"]');
    await page.waitForFunction(() => document.querySelectorAll('[data-venta-ajena]').length === 1 && document.querySelectorAll('[data-venta-propia]').length === 0);
    assert.match((await page.textContent('#bv-msg'))!, /Historial de ventas de MASCADA/);
    // devolver una pieza de la venta propia (jeans)
    await page.fill('#bv-codigo', '');
    await page.fill('#bv-folio', '1');
    await page.click('#form-buscar-venta button[type="submit"]');
    await page.waitForSelector('[data-venta-propia] input[data-linea]');
    await page.click('[data-venta-propia] button[type="submit"]'); // sin piezas
    await page.waitForFunction(() => /Indique cuántas piezas/.test(document.querySelector('[data-venta-propia] [data-msg]')!.textContent!));
    await page.fill('[data-venta-propia] input[data-linea]', '1');
    await page.screenshot({ path: join(CAPTURAS, '14-cambio-o-devolucion.png') });
    await page.fill('[data-venta-propia] [data-motivo]', 'talla');
    await page.click('[data-venta-propia] button[type="submit"]');
    await page.waitForSelector('#dlg-ticket[open]');
    assert.match((await page.textContent('#resumen-devolucion'))!, /Folio 000004.*devuelto \$899\.00.*efectivo \$899\.00/);
    assert.match((await page.textContent('#ticket-texto'))!, /DEVOLUCIÓN[\s\S]*Venta original: D1-000001[\s\S]*TOTAL DEVUELTO +\$899\.00/);
    await page.click('#btn-cerrar');
    await page.waitForFunction(() => (document.querySelector('[data-venta-propia] input[data-linea]') as HTMLInputElement | null)?.disabled === true);
    assert.equal(ctx.m.caja('DUO', 1).estadoFolios().ultimo, 4, 'la devolución y la venta de tarjeta/recarga consumieron la misma serie');
    void v1; void v2;
    assert.deepEqual(errores.filter((e) => !/409/.test(e)), []);
  });

  it('UI11 dólares en efectivo: cobro habitual intacto, USD + MXN con faltante/cambio, tasa del cobro, lápiz con permiso, corte por moneda y reimpresión', async (t) => {
    const browser = await chromium.launch({ executablePath: chromiumPath, args: ['--no-sandbox'] });
    const ctx = nuevoMundo(sqlite, politica());
    ctx.m.fijarTipoCambioInicial(180000, 'Gerencia');
    ctx.m.central.asignarPermiso('Ana', 'editar_tipo_cambio', true, 'admin');
    ctx.m.pump();
    const app = await appCajero(ctx, 'DUO', 1, 'Ana');
    const app2 = await appCajero(ctx, 'DUO', 2, 'Beto');
    t.after(async () => { await browser.close(); await app.cerrar(); await app2.cerrar(); ctx.limpiar(); });
    const { page, errores } = await pagina(browser, app.url, 1440, 900);
    await page.waitForSelector('[data-tc="tasa"]');
    // barra izquierda: tasa, fecha/hora, versión y estado de verificación; lápiz solo con permiso
    assert.match((await page.textContent('[data-tc="tasa"]'))!, /Dólar: \$18\.00 MXN/);
    assert.match((await page.textContent('[data-tc="fecha"]'))!, /Actualizado 01 oct 2026 · 08:00 · v1 · Gerencia/);
    assert.match((await page.textContent('[data-tc="estado"]'))!, /Sincronizado/);
    assert.equal(await page.locator('#btn-editar-tc').count(), 1);
    const p2 = (await pagina(browser, app2.url, 1440, 900)).page;
    await p2.waitForSelector('[data-tc="tasa"]');
    assert.equal(await p2.locator('#btn-editar-tc').count(), 0, 'Beto no tiene permiso: no ve el lápiz');

    // cobro habitual en pesos: sin pasos extra (el bloque de dólares ni se abre)
    await escanear(page, '7501234567890');
    await page.waitForSelector('#cuerpo tr[data-linea]');
    assert.equal(await page.locator('#bloque-usd').isHidden(), true);
    await page.fill('#recibido', '150');
    assert.equal(await page.textContent('#cambio'), '$30.00');
    assert.equal(await page.textContent('#lbl-cambio'), 'Cambio');
    await page.click('#btn-cobrar');
    await page.waitForSelector('#dlg-ticket[open]');
    assert.doesNotMatch((await page.textContent('#ticket-texto'))!, /USD|Tasa/);
    await page.click('#btn-nueva');
    await page.waitForFunction(() => document.querySelector('#total')?.textContent === '$0.00');

    // $1,349 (jeans + bolsa): US$50 + $400 → equivalente $900, recibido $1,300, faltan $49
    await escanear(page, '0002026090782');
    await page.waitForSelector('#cuerpo tr[data-linea]');
    await escanear(page, '0000000000017');
    await page.waitForSelector('#cuerpo tr[data-linea]:nth-child(2)');
    assert.equal(await page.textContent('#total'), '$1,349.00');
    await page.click('#btn-usd');
    await page.waitForSelector('#bloque-usd:not([hidden])');
    assert.match((await page.textContent('#info-tasa'))!, /\$18\.00 MXN por USD.*\(v1\)/);
    await page.fill('#usd', '50');
    await page.fill('#recibido', '400');
    assert.deepEqual([await page.textContent('#usd-equivalente'), await page.textContent('#total-recibido'), await page.textContent('#lbl-cambio'), await page.textContent('#cambio')], ['$900.00', '$1,300.00', 'Faltan', '$49.00']);
    assert.equal(await page.locator('#btn-cobrar').isDisabled(), true);
    await page.screenshot({ path: join(CAPTURAS, '15-cobro-con-dolares-faltan.png') });

    // la tasa global cambia mientras se cobra: este cobro conserva la suya y lo avisa; el botón toma la nueva
    ctx.m.central.fijarTipoCambio(190000, 'Gerencia', 1);
    ctx.m.pump();
    await page.waitForSelector('#aviso-tasa-nueva', { timeout: 9000 });
    assert.match((await page.textContent('#aviso-tasa-nueva'))!, /cambió a \$19\.00 \(v2\).*conserva/);
    assert.equal(await page.textContent('#usd-equivalente'), '$900.00', 'no se recalcula con la nueva tasa');
    await page.fill('#recibido', '500'); // $900 + $500 = $1,400 → cambio $51
    assert.deepEqual([await page.textContent('#lbl-cambio'), await page.textContent('#cambio')], ['Cambio', '$51.00']);
    await page.screenshot({ path: join(CAPTURAS, '16-cobro-con-dolares-cambio.png') });
    await page.click('#btn-cobrar');
    await page.waitForSelector('#dlg-ticket[open]');
    assert.match((await page.textContent('#resumen-venta'))!, /cambio \$51\.00.*dólares recibidos US\$50\.00/);
    const tk = (await page.textContent('#ticket-texto'))!;
    assert.match(tk, /TOTAL +\$1,349\.00/);
    assert.match(tk, /USD recibidos +US\$50\.00/);
    assert.match(tk, /Tasa 18\.00 MXN\/USD \(v1\)/);
    assert.match(tk, /Equivalente MXN +\$900\.00/);
    assert.match(tk, /Pesos recibidos +\$500\.00/);
    assert.match(tk, /Cambio MXN +\$51\.00/);
    assert.doesNotMatch(tk, /\b(iva|tax|impuesto)\b|%/i);
    await page.click('#btn-nueva');
    await page.waitForFunction(() => document.querySelector('#total')?.textContent === '$0.00');

    // solo dólares, cobro nuevo con la tasa vigente (19.00): US$100 = $1,900 para $120 → cambio $1,780
    await escanear(page, '7501234567890');
    await page.waitForSelector('#cuerpo tr[data-linea]');
    await page.click('#btn-usd');
    await page.waitForSelector('#bloque-usd:not([hidden])');
    assert.match((await page.textContent('#info-tasa'))!, /\$19\.00 MXN por USD.*\(v2\)/);
    await page.fill('#usd', '100');
    assert.equal(await page.textContent('#cambio'), '$1,780.00');
    await page.click('#btn-cobrar');
    await page.waitForSelector('#dlg-ticket[open]');
    await page.click('#btn-nueva');

    // lápiz: valida, guarda para todas y se ve en la otra caja sin reiniciar
    await page.click('#btn-editar-tc');
    await page.waitForSelector('#form-tc');
    await page.fill('#tc-valor', '0');
    await page.click('#tc-guardar');
    await page.waitForFunction(() => /número positivo/.test(document.querySelector('#tc-msg')!.textContent!));
    await page.fill('#tc-valor', '20.50');
    await page.screenshot({ path: join(CAPTURAS, '17-editar-tipo-de-cambio.png') });
    await page.click('#tc-guardar');
    await page.waitForFunction(() => /\$20\.50 MXN/.test(document.querySelector('[data-tc="tasa"]')!.textContent!));
    assert.match((await page.textContent('[data-tc="fecha"]'))!, /v3 · Ana/);
    ctx.m.pump();
    await p2.waitForFunction(() => /\$20\.50 MXN/.test(document.querySelector('[data-tc="tasa"]')?.textContent ?? ''), null, { timeout: 9000 });
    // sin conexión con el central: se sigue cobrando con la tasa guardada y se avisa que no se puede verificar
    ctx.m.cortarInternet('DUO');
    await page.waitForFunction(() => /no se puede verificar/.test(document.querySelector('[data-tc="estado"]')?.textContent ?? ''), null, { timeout: 9000 });
    await page.click('#btn-editar-tc');
    await page.fill('#tc-valor', '21');
    await page.click('#tc-guardar');
    await page.waitForFunction(() => /conexión con el servicio central/.test(document.querySelector('#tc-msg')!.textContent!));
    await page.click('#tc-cancelar');
    ctx.m.restablecerInternet('DUO');

    // corte: pesos y dólares por separado (US$150 recibidos; cambio de $51 y $1,780 en pesos)
    await page.click('#nav button[data-vista="corte"]');
    await page.waitForSelector('#tabla-corte');
    const corte = async (k: string) => (await page.textContent(`#tabla-corte tr[data-campo="${k}"] td`))!.trim();
    assert.equal(await corte('usd_recibidos'), 'US$150.00');
    assert.equal(await corte('usd_equivalente_mxn_historico'), '$2,800.00', '900 a 18.00 + 1,900 a 19.00: cada operación con su tasa');
    assert.equal(await corte('cambio_mxn_con_usd'), '$1,831.00');
    assert.equal(await corte('efectivo_esperado'), '-$1,211.00', 'pesos físicos: +120 +449 −1,780 (sin fondo en pesos el cajón queda corto: el cambio sale de pesos, no de dólares)');
    // movimientos y conteo por denominaciones
    await page.selectOption('#mov-tipo', 'fondo_inicial');
    await page.selectOption('#mov-moneda', 'USD');
    await page.fill('#mov-monto', '100');
    await page.click('#btn-movimiento');
    await page.waitForFunction(() => document.querySelector('#tabla-corte tr[data-campo="fondo_inicial_usd"] td')?.textContent === 'US$100.00');
    assert.equal(await corte('efectivo_usd_esperado'), 'US$250.00');
    await page.fill('[data-conteo="USD"][data-clave="100"]', '2');
    await page.fill('[data-conteo="USD"][data-clave="50"]', '1');
    assert.equal(await page.textContent('#conteo-total-USD'), 'US$250.00');
    await page.click('#btn-conteo-USD');
    await page.waitForFunction(() => document.querySelector('#tabla-corte tr[data-campo="conteo_usd"] td')?.textContent === 'US$250.00');
    assert.equal(await corte('diferencia_usd'), 'US$0.00');
    await page.screenshot({ path: join(CAPTURAS, '18-corte-pesos-y-dolares.png') });

    // reimpresión conserva la tasa original aunque hoy sea otra
    await page.click('#nav button[data-vista="ventas"]');
    await page.waitForSelector('#tabla-ventas tr[data-folio="2"]');
    await page.click('#tabla-ventas tr[data-folio="2"] [data-ver]');
    await page.waitForSelector('#dlg-ticket[open] #ticket-texto');
    assert.match((await page.textContent('#ticket-texto'))!, /Tasa 18\.00 MXN\/USD \(v1\)/);
    await page.click('#btn-reimprimir');
    await page.waitForFunction(() => /REIMPRESIÓN 1/.test(document.querySelector('#ticket-texto')!.textContent!));
    assert.match((await page.textContent('#ticket-texto'))!, /Tasa 18\.00 MXN\/USD \(v1\)/);
    assert.deepEqual(errores.filter((e) => !/409/.test(e)), []);
  });

  it('UI12 Administración: tipo de cambio con historial y permisos por usuario; dólares recibidos con tasa de cada operación y exportación a Excel', async (t) => {
    const browser = await chromium.launch({ executablePath: chromiumPath, args: ['--no-sandbox'] });
    const ctx = nuevoMundo(sqlite, politica());
    ctx.m.fijarTipoCambioInicial(180000, 'Gerencia');
    const a1 = await appCajero(ctx, 'DUO', 1, 'Ana');
    const a2 = await appCajero(ctx, 'LON', 2, 'Luis');
    const adm = await appAdmin(ctx);
    t.after(async () => { await browser.close(); await a1.cerrar(); await a2.cerrar(); await adm.cerrar(); ctx.limpiar(); });
    const v1 = a1.s.svc.nuevaVenta(); a1.s.svc.escanear(v1, '0002026090782'); await a1.s.svc.cobrarEfectivo(v1, 20000, 5000); // US$50 + $200 por $899 → cambio $201
    ctx.m.central.fijarTipoCambio(190000, 'Gerencia', 1); ctx.m.pump();
    const v2 = a2.s.svc.nuevaVenta(); a2.s.svc.escanear(v2, '7501234567890'); await a2.s.svc.cobrarEfectivo(v2, 0, 1000); // US$10 a 19.00 por $120 → cambio $70
    ctx.m.pump(); ctx.m.pump();
    const { page, errores } = await pagina(browser, adm.url, 1440, 900);
    await page.waitForSelector('#nav');
    assert.match((await page.textContent('[data-tc="tasa"]'))!, /Dólar: \$19\.00 MXN/);
    // permisos por usuario
    await page.click('#nav button[data-vista="configuracion"]');
    await page.click('#cfg-tab-tipo_cambio');
    await page.waitForSelector('#tabla-tc tbody tr');
    assert.deepEqual(await page.$$eval('#tabla-tc tbody tr', (r) => r.map((x) => [...x.querySelectorAll('td')].slice(0, 4).map((c) => c.textContent))), [['v2', '$19.00', '$18.00 (v1)', 'Gerencia'], ['v1', '$18.00', '—', 'Gerencia']]);
    await page.fill('#perm-usuario', 'Ana');
    await page.click('#btn-permiso');
    await page.waitForSelector('#tabla-permisos tr[data-usuario="Ana"]');
    assert.match((await page.textContent('#tabla-permisos tr[data-usuario="Ana"]'))!, /Ana.*Sí/);
    ctx.m.pump();
    assert.equal(ctx.m.caja('LON', 2).puedeEditarTipoCambio('Ana'), true, 'el permiso llega a todas las cajas');
    // Administración edita la tasa (v3) y queda el registro de quién y el valor anterior
    await page.click('#btn-editar-tc-vista');
    await page.fill('#tc-valor', '19.25');
    await page.click('#tc-guardar');
    await page.waitForFunction(() => /\$19\.25 MXN/.test(document.querySelector('[data-tc="tasa"]')!.textContent!));
    await page.waitForSelector('#tabla-tc tr[data-version="3"]');
    assert.match((await page.textContent('#tabla-tc tr[data-version="3"]'))!, /v3\$19\.25\$19\.00 \(v2\)Administración|v3.*19\.25.*19\.00 \(v2\).*galo/);
    // dólares recibidos: cada operación con su tasa
    await page.click('#nav button[data-vista="cortes"]');
    await page.click('#btn-ir-dolares');
    await page.fill('#usd-desde', '2026-10-01');
    await page.fill('#usd-hasta', '2026-10-01');
    await page.click('#filtros-usd button[type="submit"]');
    await page.waitForSelector('#tabla-dolares tbody tr[data-folio]');
    assert.deepEqual(await page.$$eval('#tabla-dolares tbody tr', (r) => r.map((x) => [...x.querySelectorAll('td')].map((c) => c.textContent))),
      [['DUO', '1', '000001', '2026-10-01 08:00', 'Ana', 'US$50.00', '18.00 (v1)', '$900.00', '$200.00', '$201.00', 'confirmada'], ['LON', '2', '000001', '2026-10-01 08:00', 'Luis', 'US$10.00', '19.00 (v2)', '$190.00', '$0.00', '$70.00', 'confirmada']]);
    assert.deepEqual([await page.textContent('#total-usd'), await page.textContent('#total-equivalente')], ['US$60.00', '$1,090.00']);
    await page.screenshot({ path: join(CAPTURAS, '19-dolares-recibidos-administracion.png') });
    const [descarga] = await Promise.all([page.waitForEvent('download'), page.click('#btn-exportar-dolares')]);
    assert.equal(descarga.suggestedFilename(), 'dolares-recibidos.xlsx');
    const filas = (await leerXlsxNode(readFileSync((await descarga.path())!)))[0]!.filas;
    assert.deepEqual(filas[0]!.slice(6, 12), ['USD recibidos', 'Tipo de cambio (MXN por USD)', 'Versión de la tasa', 'Equivalente MXN (tasa de la operación)', 'Pesos recibidos', 'Cambio entregado MXN']);
    assert.deepEqual(filas[1]!.slice(0, 12), ['DUO', 1, 1, '2026-10-01', '08:00', 'Ana', '50.00', '18.00', 1, '900.00', '200.00', '201.00']);
    assert.deepEqual(filas[2]!.slice(6, 10), ['10.00', '19.00', 2, '190.00']);
    // un cajero no tiene las rutas de administración de tasa ni de dólares
    assert.equal((await fetch(`${a1.url}/api/admin/dolares`)).status, 403);
    assert.equal((await fetch(`${a1.url}/api/admin/tipo-cambio`)).status, 403);
    const sinPermiso = await fetch(`${a2.url}/api/tipo-cambio`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ tasa: 200000 }) });
    assert.deepEqual([sinPermiso.status, (await sinPermiso.json()).error.codigo], [409, 'PERMISO_DENEGADO']);
    assert.deepEqual(errores.filter((e) => !/403|409/.test(e)), []);
  });

  it('UI13 billetes, aviso de cambio, confirmación de más del 10 %, conteo de pesos y cortes consolidados por moneda', async (t) => {
    const browser = await chromium.launch({ executablePath: chromiumPath, args: ['--no-sandbox'] });
    const ctx = nuevoMundo(sqlite, politica());
    ctx.m.fijarTipoCambioInicial(180000, 'Gerencia');
    ctx.m.central.asignarPermiso('Ana', 'editar_tipo_cambio', true, 'admin');
    ctx.m.pump();
    const app = await appCajero(ctx, 'DUO', 1, 'Ana');
    const adm = await appAdmin(ctx);
    t.after(async () => { await browser.close(); await app.cerrar(); await adm.cerrar(); ctx.limpiar(); });
    ctx.m.caja('DUO', 1).movimientoEfectivo('fondo_inicial', 10000); // fondo de $100: el efectivo en pesos es CONOCIDO
    const { page, errores } = await pagina(browser, app.url, 1440, 900);
    await page.waitForSelector('#scan');
    await escanear(page, '7501234567890');
    await page.waitForSelector('#cuerpo tr[data-linea]');
    await page.click('#btn-usd');
    await page.waitForSelector('#bloque-usd:not([hidden])');
    // solo billetes: sin centavos
    await page.fill('#usd', '100.50');
    await page.waitForFunction(() => /Solo se aceptan billetes/.test(document.querySelector('#msg-usd')!.textContent!));
    assert.equal(await page.locator('#btn-cobrar').isDisabled(), true);
    // procedimiento operativo: rechazar un billete dañado o sospechoso
    await page.click('#btn-rechazar-billete');
    await page.waitForSelector('#form-rechazo');
    await page.selectOption('#rb-denom', '100');
    await page.selectOption('#rb-motivo', 'sospechoso');
    await page.fill('#rb-nota', 'sin marca de agua');
    await page.click('#rb-guardar');
    await page.waitForFunction(() => /Rechazo registrado/.test(document.querySelector('#mensaje')!.textContent!));
    // US$100 por $120: cambio $1,680, más de lo que se sabe que hay en la caja ($100) → advertencia, sin bloquear
    await page.fill('#usd', '100');
    assert.equal(await page.textContent('#cambio'), '$1,680.00');
    await page.waitForSelector('#aviso-cambio:not([hidden])');
    assert.match((await page.textContent('#aviso-cambio'))!, /Advertencia: el cambio \(\$1,680\.00\) supera los pesos que se sabe que hay en la caja \(\$100\.00\)/);
    assert.equal(await page.locator('#btn-cobrar').isDisabled(), false, 'la advertencia no bloquea el cobro');
    await page.screenshot({ path: join(CAPTURAS, '20-advertencia-de-cambio.png') });
    await page.click('#btn-cobrar');
    await page.waitForSelector('#dlg-ticket[open]');
    assert.match((await page.textContent('#avisos-venta'))!, /el cambio entregado superó en \$1,580\.00/);
    await page.click('#btn-nueva');
    await page.waitForFunction(() => document.querySelector('#total')?.textContent === '$0.00');

    // más del 10 % pide confirmación adicional; uno normal no
    await page.click('#btn-editar-tc');
    await page.fill('#tc-valor', '19.50'); // +8.33 %
    await page.click('#tc-guardar');
    await page.waitForFunction(() => /\$19\.50 MXN/.test(document.querySelector('[data-tc="tasa"]')!.textContent!));
    await page.click('#btn-editar-tc');
    await page.fill('#tc-valor', '25');
    await page.click('#tc-guardar');
    await page.waitForFunction(() => /Atención: este cambio es de \+28\.21 %/.test(document.querySelector('#tc-msg')!.textContent!));
    assert.match((await page.textContent('[data-tc="tasa"]'))!, /\$19\.50/, 'sin confirmar no se guarda');
    assert.match((await page.textContent('#tc-guardar'))!, /Sí, confirmar el cambio/);
    await page.screenshot({ path: join(CAPTURAS, '21-confirmar-cambio-mayor-10.png') });
    await page.click('#tc-guardar');
    await page.waitForFunction(() => /\$25\.00 MXN/.test(document.querySelector('[data-tc="tasa"]')!.textContent!));

    // corte: conteo de pesos con diferencia, billetes rechazados y cierre
    await page.click('#nav button[data-vista="corte"]');
    await page.waitForSelector('#tabla-corte');
    const corte = async (k: string) => (await page.textContent(`#tabla-corte tr[data-campo="${k}"] td`))!.trim();
    assert.equal(await corte('billetes_usd_rechazados'), '1');
    assert.equal(await corte('efectivo_esperado'), '-$1,580.00');
    await page.fill('[data-conteo="MXN"][data-clave="10000"]', '1');
    assert.equal(await page.textContent('#conteo-total-MXN'), '$100.00');
    await page.click('#btn-conteo-MXN');
    await page.waitForFunction(() => document.querySelector('#tabla-corte tr[data-campo="conteo_mxn"] td')?.textContent === '$100.00');
    assert.equal(await corte('diferencia_mxn'), '$1,680.00');
    await page.click('#btn-cerrar-corte');
    await page.waitForSelector('#estado-corte .mensaje');
    ctx.m.pump(); ctx.m.pump();

    // Administración: pesos y dólares en columnas separadas; el equivalente es contable
    const a = (await pagina(browser, adm.url, 1600, 900)).page;
    await a.waitForSelector('#nav');
    await a.click('#nav button[data-vista="cortes"]');
    await a.fill('#cor-desde', '2026-10-01'); await a.fill('#cor-hasta', '2026-10-01');
    await a.click('#filtros-cortes button[type="submit"]');
    await a.waitForSelector('#tabla-cortes tr[data-corte="DUO-1-2026-10-01"]');
    const c = async (col: string) => (await a.textContent(`#tabla-cortes tr[data-corte="DUO-1-2026-10-01"] [data-col="${col}"]`))!.trim();
    assert.deepEqual([await c('mxn-fondo'), await c('mxn-cobros'), await c('mxn-cambio'), await c('mxn-esperado'), await c('mxn-contado'), await c('mxn-diferencia')], ['$100.00', '$0.00', '$1,680.00', '-$1,580.00', '$100.00', '$1,680.00']);
    assert.deepEqual([await c('usd-cobros'), await c('usd-esperado'), await c('usd-contado'), await c('usd-diferencia'), await c('equivalente')], ['US$100.00', 'US$100.00', '—', '—', '$1,800.00']);
    assert.match((await a.textContent('#resultado-cortes'))!, /Pesos y dólares son dinero físico distinto/);
    await a.screenshot({ path: join(CAPTURAS, '22-cortes-consolidados-por-moneda.png') });
    assert.deepEqual(errores.filter((e) => !/409/.test(e)), []);
  });
  it('UI14 Administración: alta, edición, renombre y desactivación de departamentos, con avisos de repetidos', async (t) => {
    const browser = await chromium.launch({ executablePath: chromiumPath, args: ['--no-sandbox'] });
    const ctx = nuevoMundo(sqlite, politica());
    const adm = await appAdmin(ctx);
    t.after(async () => { await browser.close(); await adm.cerrar(); ctx.limpiar(); });
    const { page, errores } = await pagina(browser, adm.url, 1440, 900);
    await page.waitForSelector('#nav');
    await page.click('#nav button[data-vista="configuracion"]');
    await page.click('#cfg-tab-departamentos');
    await page.waitForSelector('#tabla-deptos tbody tr');
    const nombres = await page.$$eval('#tabla-deptos .d-nombre', (i) => i.map((x) => (x as HTMLInputElement).value));
    assert.ok(nombres.includes('Bolsos y Carteras') && nombres.includes('Envolturas y Bolsas de regalo'));
    assert.ok(!nombres.some((n) => /zapato|niños/i.test(n)));
    assert.equal(await page.isDisabled('#tabla-deptos tr[data-depto="sin-clasificar"] .d-activo'), true);
    // alta
    await page.fill('#nd-nombre', 'Hogar y cocina');
    await page.fill('#nd-alias', 'hogar, cocina');
    await page.click('#btn-nuevo-depto');
    await page.waitForSelector('#tabla-deptos tr[data-depto="hogar-y-cocina"]');
    assert.equal(await page.inputValue('#tabla-deptos tr[data-depto="hogar-y-cocina"] .d-alias'), 'hogar, cocina');
    // repetido: se avisa y no se crea
    await page.fill('#nd-nombre', 'mujer');
    await page.click('#btn-nuevo-depto');
    await page.waitForFunction(() => /ya es un nombre o alias|ya existe/.test(document.querySelector('#msg-depto')!.textContent!));
    // renombrar y desactivar
    const fila = '#tabla-deptos tr[data-depto="electronicos"]';
    await page.fill(`${fila} .d-nombre`, 'Electrónica y celulares');
    await page.uncheck(`${fila} .d-activo`);
    await page.click(`${fila} .d-guardar`);
    await page.waitForFunction(() => (document.querySelector('#tabla-deptos tr[data-depto="electronicos"] .d-nombre') as HTMLInputElement).value === 'Electrónica y celulares');
    assert.equal(await page.isChecked(`${fila} .d-activo`), false);
    await page.screenshot({ path: join(CAPTURAS, '23-departamentos.png') });
    assert.deepEqual(errores.filter((e) => !/409/.test(e)), []);
  });
});
