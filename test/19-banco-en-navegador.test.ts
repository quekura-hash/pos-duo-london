import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { chromium } from 'playwright-core';
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { leerXlsxNode } from '../src/xlsx-node.ts';
import { ENCABEZADOS_REALES, FILAS_REALISTAS, xlsxDeFilas } from './ayudas/inventario.ts';

const RAIZ = join(import.meta.dirname, '..');
const HTML = join(RAIZ, 'dist', 'pos-venta-prueba.html');
const chromiumPath = [process.env.POS_CHROMIUM, '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', '/opt/pw-browsers/chromium/chrome-linux/chrome'].find((p) => p && existsSync(p));

/** Con empleadas registradas la venta queda como «Autocompra» por omisión; en las pruebas que no lo revisan solo se espera a que se asigne. */
const vendioClientas = async (page: import('playwright-core').Page) => { if (await page.locator('#bloque-vendio').isVisible()) await page.waitForFunction(() => (document.querySelector('#vendio-por') as HTMLSelectElement).value === 'autocompra'); };
/** Los formularios de usuarios exigen nombres y apellidos: lo mínimo para las pruebas. */
const perfilMin = async (page: import('playwright-core').Page, p: 'caj' | 'adm') => { await page.fill(`#${p}-nombres`, 'Prueba'); await page.fill(`#${p}-apellidos`, 'Apellido'); };
describe('[navegador real] Versión de prueba en una sola página (motor en memoria dentro del navegador)', { timeout: 120_000, skip: chromiumPath ? false : 'Chromium no encontrado (defina POS_CHROMIUM)' }, () => {
  it('B1 se construye y permite probar venta, inventario compartido, fallas simuladas y Administración sin servidor', async (t) => {
    execFileSync(process.execPath, [join(RAIZ, 'scripts', 'construir-prueba.mjs')], { stdio: 'pipe' });
    const browser = await chromium.launch({ executablePath: chromiumPath, args: ['--no-sandbox'] });
    t.after(() => browser.close());
    const page = await (await browser.newContext({ viewport: { width: 1366, height: 820 }, colorScheme: 'light' })).newPage();
    const errores: string[] = [];
    page.on('pageerror', (e) => errores.push(String(e)));
    page.on('console', (m) => { if (m.type() === 'error') errores.push(m.text()); });
    await page.goto(`file://${HTML}`);
    await page.waitForSelector('[data-chip="tienda"]');
    const escanear = async (c: string) => { await page.fill('#scan', c); await page.press('#scan', 'Enter'); };

    // venta completa de la Caja 1 de DÚO
    await escanear('0002026090782');
    await page.waitForSelector('#cuerpo tr[data-linea]');
    await escanear('7501234567890');
    await page.waitForSelector('#cuerpo tr[data-linea]:nth-child(2)');
    assert.equal(await page.textContent('#total'), '$1,019.00');
    await page.fill('#recibido', '1100');
    await page.click('#btn-cobrar');
    await page.waitForSelector('#dlg-ticket[open]');
    assert.match((await page.textContent('#resumen-venta'))!, /Folio 000001 · ticket D1-000001 · cambio \$81\.00/);
    assert.match((await page.textContent('#ticket-texto'))!, /^#1001 0002026090782 +/m);
    assert.doesNotMatch((await page.textContent('#ticket-texto'))!, /iva|tax|impuesto|%/i);
    await page.click('#btn-nueva');

    // inventario compartido: la Caja 2 de DÚO ve 4 de 5 jeans, y su serie empieza en 1
    await page.selectOption('#sesion-prueba', 'DUO/2');
    await page.waitForSelector('[data-chip="caja"] b');
    assert.equal(await page.textContent('[data-chip="caja"] b'), '2');
    await escanear('levis');
    await page.waitForSelector('.tabla-resultados');
    const filas = await page.$$eval('.tabla-resultados tbody tr', (t) => t.map((r) => r.textContent!.replace(/\s+/g, ' ')));
    assert.ok(filas.some((f) => /1001.*JEANS.*20260913.*\$899\.00.*4/.test(f)), filas.join(' | '));
    // la otra tienda conserva su inventario
    await page.selectOption('#sesion-prueba', 'LON/1');
    await page.waitForSelector('[data-chip="caja"] b');
    await escanear('levis');
    await page.waitForSelector('.tabla-resultados');
    assert.ok((await page.$$eval('.tabla-resultados tbody tr', (t) => t.map((r) => r.textContent!))).some((f) => /1001/.test(f) && /\b3\b/.test(f)));

    // código duplicado a propósito: no se agrega
    await page.selectOption('#sesion-prueba', 'DUO/1');
    await page.waitForSelector('#scan');
    await escanear('7508888888888');
    await page.waitForSelector('[data-resultado="ambiguo"]');
    assert.equal(await page.locator('#cuerpo tr[data-linea]').count(), 0);

    // impresora con falla simulada: la venta se guarda y se puede reintentar
    await page.check('#falla-imp');
    await escanear('7501234567890');
    await page.waitForSelector('#cuerpo tr[data-linea]');
    await page.click('#btn-exacto');
    await page.click('#btn-cobrar');
    await page.waitForSelector('#dlg-ticket[open]');
    assert.match((await page.textContent('#estado-impresion'))!, /sin papel.*SÍ quedó guardada/);
    assert.match((await page.textContent('#resumen-venta'))!, /Folio 000002/);
    assert.equal(await page.isChecked('#falla-imp'), false, 'la falla simulada ocurre una sola vez');
    await page.click('#btn-reimprimir');
    await page.waitForFunction(() => /reimpresión/.test(document.querySelector('#estado-impresion')!.textContent!));
    await page.click('#btn-nueva');

    // hub caído (simulado): la caja lo muestra y la venta se guarda pendiente de sincronizar
    await page.check('#falla-hub');
    await page.waitForFunction(() => document.querySelector('[data-chip="hub"] b')?.textContent === 'Sin conexión', null, { timeout: 8000 }).catch(() => {});
    await escanear('7501234567890');
    await page.waitForSelector('#cuerpo tr[data-linea]');
    await page.click('#btn-exacto');
    await page.click('#btn-cobrar');
    await page.waitForSelector('#dlg-ticket[open]');
    assert.match((await page.textContent('#resumen-venta'))!, /Folio 000003/);
    await page.click('#btn-nueva');
    await page.waitForSelector('[data-chip="hub"]');
    assert.equal(await page.textContent('[data-chip="hub"] b'), 'Sin conexión');
    assert.notEqual(await page.textContent('[data-chip="pendientes"] b'), '0');

    // Administración: ve las ventas de las cajas con sus folios originales
    await page.uncheck('#falla-hub');
    await page.selectOption('#sesion-prueba', 'admin');
    await page.waitForSelector('#tabla-inv-resumen'); // Administración abre en Inventario
    assert.deepEqual(await page.$$eval('#nav button', (b) => b.map((x) => x.textContent)), ['Inventario', 'Almacén', 'Promociones', 'Tarjetas de regalo', 'Reportes', 'Cortes', 'Configuración', 'Caja']);
    await page.click('#nav button[data-vista="reportes"]');
    await page.waitForSelector('#filtros');
    await page.click('#filtros button[type="submit"]');
    await page.waitForSelector('#tabla-reporte tbody tr');
    assert.equal(await page.locator('#tabla-reporte tbody tr').count(), 3, 'las 3 ventas, tras sincronizar');
    assert.deepEqual(await page.$$eval('#tabla-reporte tbody tr', (r) => r.map((x) => [...x.querySelectorAll('td')].slice(0, 3).map((c) => c.textContent).join(' '))), ['DUO 1 000001', 'DUO 1 000002', 'DUO 1 000003']);
    await page.screenshot({ path: join(RAIZ, 'docs', 'capturas', '08-banco-de-prueba-admin.png') });

    // reiniciar datos: vuelve a empezar
    await page.selectOption('#sesion-prueba', 'DUO/1');
    await page.waitForSelector('#scan');
    await page.click('#reiniciar');
    await page.waitForSelector('[data-chip="folio"]', { state: 'attached' });
    assert.equal(await page.locator('[data-chip="folio"]').isHidden(), true);
    assert.deepEqual(errores, [], 'sin errores en la consola');
  });

  it('B2 importar un inventario .xlsx en la página: vista previa, hallazgos, carga, venta, exportación y persistencia en el navegador', async (t) => {
    execFileSync(process.execPath, [join(RAIZ, 'scripts', 'construir-prueba.mjs')], { stdio: 'pipe' });
    const dir = mkdtempSync(join(tmpdir(), 'pos-xlsx-'));
    const archivo = join(dir, 'inventario_prueba.xlsx');
    writeFileSync(archivo, await xlsxDeFilas(FILAS_REALISTAS));
    const browser = await chromium.launch({ executablePath: chromiumPath, args: ['--no-sandbox'] });
    t.after(async () => { await browser.close(); rmSync(dir, { recursive: true, force: true }); });
    const page = await (await browser.newContext({ viewport: { width: 1366, height: 900 }, colorScheme: 'light', acceptDownloads: true })).newPage();
    const errores: string[] = [];
    page.on('pageerror', (e) => errores.push(String(e)));
    page.on('console', (m) => { if (m.type() === 'error') errores.push(m.text()); });
    await page.goto(`file://${HTML}`);
    await page.waitForSelector('[data-chip="tienda"]');
    const escanear = async (c: string) => { await page.fill('#scan', c); await page.press('#scan', 'Enter'); };

    await page.setInputFiles('#archivo-inventario', archivo);
    await page.waitForSelector('#dlg-importar[open]');
    assert.match((await page.textContent('#imp-resumen'))!, /13 artículos · con código 11 · sin código 2 /);
    assert.equal(await page.locator('#imp-anomalias tr[data-tipo="item_no_duplicado"]').count(), 1);
    assert.match((await page.textContent('#imp-anomalias tr[data-tipo="cupon_obsoleto"]'))!, /cupón/i);
    assert.deepEqual(await page.$$eval('#imp-previa tbody tr:first-child td', (c) => c.map((x) => x.textContent)), ['1', '0021001403065', 'BLUSA', 'blusa seksy', '', '', '$169.00']);
    await page.check('input[name="imp-perfil"][value="1"]');
    assert.deepEqual(await page.$$eval('#imp-previa tbody tr:first-child td', (c) => c.slice(2, 4).map((x) => x.textContent)), ['blusa seksy', 'BLUSA'], 'el perfil alternativo invierte Marca y Descripción');
    await page.check('input[name="imp-perfil"][value="0"]');
    await page.screenshot({ path: join(RAIZ, 'docs', 'capturas', '10-importar-inventario.png') });
    // departamentos: ZAPATOS ya no se vende; los nombres en inglés/escritos distinto se piden revisar y se puede elegir el destino
    assert.equal(await page.getAttribute('#imp-deptos tr[data-clave="zapatos"]', 'data-estado'), 'descontinuado');
    assert.equal(await page.inputValue('#imp-deptos tr[data-clave="zapatos"] select'), 'Sin clasificar');
    assert.equal(await page.inputValue('#imp-deptos tr[data-clave="system"] select'), 'Sin clasificar');
    assert.equal(await page.inputValue('#imp-deptos tr[data-clave="perfumes"] select'), 'Cosméticos y perfumes');
    await page.selectOption('#imp-deptos tr[data-clave="women s"] select', 'Dama');
    assert.equal(await page.isChecked('#imp-regla-env'), true);
    await page.check('#imp-modo-prueba');
    await page.fill('#imp-duo', '10');
    await page.click('#imp-cargar');
    await page.waitForFunction(() => /Inventario cargado: inventario_prueba\.xlsx · 13 artículos/.test(document.querySelector('#estado-inv')!.textContent!));
    assert.equal(await page.isVisible('#quitar-inv'), true);

    // vender un artículo importado
    await escanear('0021001403065');
    await page.waitForSelector('#cuerpo tr[data-linea]');
    const celdas = await page.$$eval('#cuerpo tr[data-linea]:nth-child(1) td[data-col]', (t) => Object.fromEntries(t.map((x) => [x.getAttribute('data-col'), x.textContent!.replace(/[−+]/g, '').replace(/×.*$/, '').trim()])));
    assert.deepEqual([celdas.item_no, celdas.codigo, celdas.marca, celdas.descripcion, celdas.precio], ['1', '0021001403065', 'BLUSA', 'blusa seksy', '$169.00']);
    await escanear('0000000000322'); // precio 0: no se puede vender
    await page.waitForFunction(() => /precio/i.test(document.querySelector('#mensaje')!.textContent!));
    assert.equal(await page.locator('#cuerpo tr[data-linea]').count(), 1, 'el artículo sin precio no se agrega');
    await escanear('1010M3'); // código alterno
    await page.waitForFunction(() => document.querySelectorAll('#cuerpo tr[data-linea]').length === 2);
    await escanear('rhapsody'); // sin código: se elige de la búsqueda
    await page.waitForSelector('.tabla-resultados [data-agregar]');
    assert.match((await page.textContent('.tabla-resultados tbody tr'))!, /\(sin código\)/);
    await page.click('.tabla-resultados [data-agregar]');
    await page.waitForFunction(() => document.querySelectorAll('#cuerpo tr[data-linea]').length === 3);
    await page.click('#btn-exacto');
    await page.click('#btn-cobrar');
    await page.waitForSelector('#dlg-ticket[open]');
    assert.match((await page.textContent('#ticket-texto'))!, /^#1 0021001403065 +/m);
    await page.click('#btn-nueva');

    // Administración: inventario y exportación
    await page.selectOption('#sesion-prueba', 'admin');
    await page.click('#nav button[data-vista="inventario"]');
    await page.waitForSelector('#tabla-inv-resumen');
    assert.equal(await page.textContent('#tabla-inv-resumen [data-campo="articulos"]'), '13');
    assert.equal(await page.textContent('#tabla-inv-resumen [data-campo="sin_codigo"]'), '2');
    assert.equal(await page.textContent('#tabla-inv-resumen [data-campo="precio_no_vendible"]'), '1');
    await page.screenshot({ path: join(RAIZ, 'docs', 'capturas', '11-inventario-en-la-pagina.png') });
    const [descarga] = await Promise.all([page.waitForEvent('download'), page.click('#btn-exportar')]);
    const filas = (await leerXlsxNode(readFileSync((await descarga.path())!)))[0]!.filas;
    assert.equal(filas.length, 14);
    const f1 = filas.find((f) => f[0] === 1)!;
    assert.deepEqual([f1[1], f1[2], f1[3], f1[7]], ['0021001403065', 'BLUSA', 'blusa seksy', 169]);
    assert.equal(f1[12], 9, 'DÚO: 10 de prueba − 1 vendida (ya sincronizada)');

    // persistencia: al recargar, el inventario sigue cargado (guardado en este navegador)
    await page.reload();
    await page.waitForFunction(() => /Inventario cargado: inventario_prueba\.xlsx · 13 artículos/.test(document.querySelector('#estado-inv')!.textContent!), null, { timeout: 15000 });
    await page.selectOption('#sesion-prueba', 'DUO/2');
    await page.waitForSelector('#scan');
    await escanear('0031001403033');
    await page.waitForSelector('#cuerpo tr[data-linea]');
    await page.click('#quitar-inv');
    await page.waitForFunction(() => /Datos de ejemplo/.test(document.querySelector('#estado-inv')!.textContent!));
    await page.reload();
    await page.waitForSelector('[data-chip="tienda"]');
    await page.waitForTimeout(400);
    assert.match((await page.textContent('#estado-inv'))!, /Datos de ejemplo/, 'quitado el inventario, no vuelve a cargarse');
    assert.deepEqual(errores, []);
  });
  it('B3 Almacén en la página: acceso a Administración desde la caja, alta de lote con departamentos, entrega a tiendas y confirmación al primer escaneo', async (t) => {
    execFileSync(process.execPath, [join(RAIZ, 'scripts', 'construir-prueba.mjs')], { stdio: 'pipe' });
    const dir = mkdtempSync(join(tmpdir(), 'pos-alta-'));
    const archivo = join(dir, 'CODIGOS_OCTUBRE.xlsx');
    const ENC = ['CANTIDAD', 'DESCRIPCION', 'ESTILO', 'MARCA', 'CODIGO', 'PRECIO', 'LOTE', 'DEPARTAMENTO'];
    writeFileSync(archivo, await xlsxDeFilas([
      [24, 'BLUSA', 'BT2988', 'CAPELLA', '202610001', 349, '20261014', 'mujer plus'],
      [12, 'PANTALON', '90332-', 'WAX JEAN', '202610002', 649, '20261014', 'DAMA'],
      [10, 'BOLSA DE REGALO', 'BR1', 'EFENTUS', '202610003', 25, '20261014', 'ACCESORIOS'],
      [5, 'JEANS', '726-', 'LEVIS', '0002026090782', 899, '20261014', 'CABALLERO'],
      [3, 'SIN PRECIO', 'X', 'Y', '202610005', 0, '1', 'DAMA'],
    ], ENC));
    const browser = await chromium.launch({ executablePath: chromiumPath, args: ['--no-sandbox'] });
    t.after(async () => { await browser.close(); rmSync(dir, { recursive: true, force: true }); });
    const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: 'light' })).newPage();
    const errores: string[] = [];
    page.on('pageerror', (e) => errores.push(String(e)));
    page.on('console', (m) => { if (m.type() === 'error') errores.push(m.text()); });
    await page.goto(`file://${HTML}`);
    await page.waitForSelector('[data-chip="tienda"]');

    // acceso a Administración desde el menú lateral de la caja, y regreso a la misma caja
    await page.click('#nav button[data-vista="administracion"]');
    await page.waitForSelector('#nav button[data-vista="almacen"]');
    assert.equal(await page.inputValue('#sesion-prueba'), 'admin');
    await page.click('#nav button[data-vista="almacen"]');
    await page.waitForSelector('#btn-alta-lote');
    assert.match((await page.textContent('#alm-cuerpo'))!, /El almacén está vacío/);

    // alta de lote: se revisa antes de guardar
    await page.click('#btn-alta-lote');
    await page.waitForSelector('#zona-archivo');
    await page.setInputFiles('#archivo-alta', archivo);
    await page.waitForSelector('#alta-resumen');
    assert.match((await page.textContent('#alta-resumen'))!, /5 filas · 3 artículos nuevos · 1 ya existen \(se suman piezas\) · 1 no se darán de alta · 51 piezas/);
    assert.match((await page.textContent('#alta-sin-pedimento'))!, /no trae la columna de No\. de pedimento/);
    assert.equal(await page.inputValue('#alta-deptos tr[data-clave="mujer plus"] select'), 'Dama Plus');
    assert.equal(await page.getAttribute('#alta-filas tr[data-fila="6"]', 'data-estado'), 'invalido');
    assert.match((await page.textContent('#alta-filas tr[data-fila="5"]'))!, /ya existe: se suman piezas/i);
    assert.match((await page.textContent('#alta-filas tr[data-fila="4"]'))!, /Envolturas y Bolsas de regalo/);
    await page.fill('#alta-pedimento', 'PED-OCT-1');
    await page.screenshot({ path: join(RAIZ, 'docs', 'capturas', '24-alta-lote-almacen.png') });
    await page.click('#alta-confirmar');
    await page.waitForFunction(() => /Lote dado de alta: 3 artículo\(s\) nuevo\(s\), 1 existente/.test(document.querySelector('#msg-alm')!.textContent!));
    const fila = '#alm-cuerpo tr[data-codigo="202610001"]';
    assert.equal(await page.textContent(`${fila} [data-col="almacen"]`), '24');
    assert.match((await page.textContent(fila))!, /PED-OCT-1/);

    // recordatorio de sacar a piso: morado si faltan más de 7 días, rojo si faltan 7 o menos; aviso en el menú lateral
    const dia = (n: number) => new Date(Date.now() - 7 * 3600e3 + n * 86400000).toISOString().slice(0, 10); // fecha local (UTC-7), como la app
    const f2 = '#alm-cuerpo tr[data-codigo="202610002"]';
    await page.fill(`${fila} .f-piso`, dia(30));
    await page.waitForSelector(`${fila}[data-piso="morada"]`);
    assert.match((await page.textContent('#aviso-piso'))!, /Revise los artículos para sacar a piso el \d\d\/\w{3}\/\d\d \(1\)/);
    assert.match((await page.getAttribute('#aviso-piso', 'class'))!, /morada/);
    await page.fill(`${f2} .f-piso`, dia(5));
    await page.waitForSelector(`${f2}[data-piso="roja"]`);
    assert.match((await page.textContent(`${f2} [data-col="marca-piso"]`))!, /En 5 días/);
    assert.match((await page.getAttribute('#aviso-piso', 'class'))!, /roja/);
    await page.screenshot({ path: join(RAIZ, 'docs', 'capturas', '27-almacen-sacar-a-piso.png') });

    // entrega: escribir cantidades marca solas las etiquetas; sin ellas no se entrega
    assert.equal(await page.isChecked(`${fila} .et-precio`), false);
    await page.fill(`${fila} .q-DUO`, '12');
    assert.deepEqual([await page.isChecked(`${fila} .et-precio`), await page.isChecked(`${fila} .et-costura`)], [true, true]);
    await page.fill(`${fila} .q-LON`, '12');
    await page.uncheck(`${fila} .et-costura`);
    await page.click(`${fila} .btn-entregar`);
    await page.waitForFunction(() => /etiqueta/i.test(document.querySelector('#msg-alm')!.textContent!));
    // más de lo que hay: avisa y pide confirmación
    await page.check(`${fila} .et-costura`);
    await page.fill(`${fila} .q-LON`, '20');
    await page.click(`${fila} .btn-entregar`);
    await page.waitForSelector('#btn-confirmar-exceso');
    assert.match((await page.textContent('#msg-alm'))!, /32 pieza\(s\) y el almacén registra 24/);
    await page.fill(`${fila} .q-LON`, '12');
    await page.click(`${fila} .btn-entregar`);
    await page.waitForFunction(() => /Entrega registrada. En el almacén quedan 0/.test(document.querySelector('#msg-alm')!.textContent!));
    assert.match((await page.textContent(`${fila} [data-col="pendiente"]`))!, /Tienda DÚO: 12 · Tienda London: 12/);
    assert.equal(await page.locator(`${fila}[data-piso]`).count(), 0, 'ya se sacó todo del almacén: sin marca');
    assert.equal(await page.inputValue(`${fila} .f-piso`), dia(30), 'la fecha se conserva como referencia');
    await page.screenshot({ path: join(RAIZ, 'docs', 'capturas', '25-almacen-entregas.png') });

    // la tienda: el catálogo ya llegó, la existencia no hasta confirmar al primer escaneo
    await page.click('#nav button[data-vista="volver_caja"]');
    await page.waitForSelector('[data-chip="tienda"]');
    await page.fill('#scan', '202610001');
    await page.press('#scan', 'Enter');
    await page.waitForSelector('#dlg-recepcion[open]');
    assert.match((await page.textContent('#rec-pregunta'))!, /¿Confirmas que recibiste 12 piezas\?/);
    await page.screenshot({ path: join(RAIZ, 'docs', 'capturas', '26-confirmar-recepcion.png') });
    await page.click('#rec-si');
    await page.waitForFunction(() => /Recepción confirmada: 12/.test(document.querySelector('#mensaje')!.textContent!));
    assert.equal(await page.inputValue('#sesion-prueba'), 'DUO/1');
    await page.fill('#scan', '202610001');
    await page.press('#scan', 'Enter');
    await page.waitForTimeout(300);
    assert.equal(await page.locator('#dlg-recepcion[open]').count(), 0, 'ya confirmada: no vuelve a preguntar');
    // reporte de entregas: DÚO confirmó, London sigue pendiente
    await page.click('#nav button[data-vista="administracion"]');
    await page.waitForSelector('#nav button[data-vista="almacen"]');
    await page.click('#nav button[data-vista="almacen"]');
    await page.click('#btn-reporte-entregas');
    await page.waitForSelector('#filtros-ent');
    await page.fill('#ent-desde', '2000-01-01');
    await page.fill('#ent-hasta', '2099-12-31');
    await page.click('#filtros-ent button[type=submit]');
    await page.waitForFunction(() => document.querySelectorAll('#tabla-ent-detalle tr[data-entrega]').length === 2);
    assert.deepEqual(await page.$$eval('#tabla-ent-detalle tr[data-entrega]', (r) => r.map((x) => (x as HTMLElement).dataset.estado).sort()), ['confirmada', 'pendiente']);
    assert.equal(await page.textContent('#tabla-ent-resumen [data-campo="piezas"]'), '24');
    await page.screenshot({ path: join(RAIZ, 'docs', 'capturas', '39-reporte-entregas.png') });
    await page.click('#btn-exportar-ent');
    await page.waitForFunction(() => /Archivo entregado|Descarga/.test(document.querySelector('#estado-exportar-ent')!.textContent!));
    await page.click('#btn-volver-alm');
    await page.waitForSelector('#btn-reporte-entregas');
    // London recibe MENOS de lo entregado: «Otra cantidad» → faltante naranja en Almacén que se ubica y se corrige
    await page.selectOption('#sesion-prueba', 'LON/1');
    await page.waitForSelector('[data-chip="tienda"]');
    await page.fill('#scan', '202610001');
    await page.press('#scan', 'Enter');
    await page.waitForSelector('#dlg-recepcion[open]');
    await page.click('#rec-otra');
    assert.equal(await page.isDisabled('#rec-otra-ok'), true);
    await page.fill('#rec-qty', '12');
    assert.equal(await page.isDisabled('#rec-otra-ok'), true, 'no puede ser igual o mayor a lo entregado');
    await page.fill('#rec-qty', '9');
    assert.match((await page.textContent('#rec-aviso'))!, /registran 3 faltante/);
    await page.screenshot({ path: join(RAIZ, 'docs', 'capturas', '40-recepcion-otra-cantidad.png') });
    await page.click('#rec-otra-ok');
    await page.waitForFunction(() => /Se registró el faltante de 3/.test(document.querySelector('#mensaje')!.textContent!));
    await page.click('#nav button[data-vista="administracion"]');
    await page.click('#nav button[data-vista="almacen"]');
    await page.waitForSelector('#tabla-faltantes tr.faltante-pendiente');
    assert.equal((await page.textContent('#tabla-faltantes [data-col="sin-ubicar"]'))!.trim(), '3');
    assert.match((await page.textContent('#n-faltantes'))!, /3 por ubicar/);
    // el menú lo avisa en cualquier pantalla de Administración
    assert.match((await page.textContent('#aviso-faltantes'))!, /3 piezas por ubicar en 1 entrega/);
    await page.click('#nav button[data-vista="inventario"]');
    await page.waitForSelector('#tabla-inv-lista tr[data-item]');
    await page.waitForSelector('#aviso-faltantes');
    await page.screenshot({ path: join(RAIZ, 'docs', 'capturas', '57-aviso-faltantes.png') });
    await page.click('#aviso-faltantes');
    await page.waitForSelector('#tabla-faltantes tr.faltante-pendiente');
    await page.fill('#tabla-faltantes input[data-destino="almacen"]', '1');
    await page.fill('#tabla-faltantes input[data-destino="DUO"]', '1');
    await page.fill('#tabla-faltantes input[data-destino="perdida"]', '5');
    await page.click('#tabla-faltantes .btn-guardar-faltante');
    await page.waitForFunction(() => /ubicaron 7/.test(document.querySelector('#msg-faltantes')!.textContent!));
    await page.fill('#tabla-faltantes input[data-destino="perdida"]', '1');
    await page.screenshot({ path: join(RAIZ, 'docs', 'capturas', '41-piezas-faltantes.png') });
    await page.click('#tabla-faltantes .btn-guardar-faltante');
    await page.waitForFunction(() => document.querySelectorAll('#tabla-faltantes tr.faltante-pendiente').length === 0);
    assert.match((await page.textContent('#n-faltantes'))!, /0 por ubicar/);
    assert.equal(await page.locator('#aviso-faltantes').count(), 0, 'sin faltantes por ubicar el aviso desaparece');
    // corregir una entrada mal capturada: el lote de 24 en realidad era de 30
    await page.uncheck('#alm-solo');
    await page.click(`${fila} .btn-entradas`);
    await page.waitForSelector('#dlg-entradas[open] #tabla-entradas tr[data-entrada]');
    await page.click('#tabla-entradas .ent-corregir');
    await page.fill('#ent-qty', '30');
    await page.click('#ent-guardar');
    await page.waitForFunction(() => /Escriba el motivo|motivo/i.test(document.querySelector('#msg-ent')!.textContent!));
    await page.fill('#ent-motivo', 'el lote traía 30 piezas');
    await page.click('#ent-guardar');
    await page.waitForFunction(() => /Entrada corregida/.test(document.querySelector('#msg-ent')!.textContent!));
    assert.match((await page.textContent('#tabla-entradas tr[data-entrada]'))!, /30.*era 24.*el lote traía 30 piezas/);
    await page.screenshot({ path: join(RAIZ, 'docs', 'capturas', '50-corregir-entrada.png') });
    await page.click('#ent-cerrar');
    assert.deepEqual(errores, []);
  });
  it('B4 lo que se hace en la página (alta de almacén, departamento) se conserva al recargar', async (t) => {
    execFileSync(process.execPath, [join(RAIZ, 'scripts', 'construir-prueba.mjs')], { stdio: 'pipe' });
    const browser = await chromium.launch({ executablePath: chromiumPath, args: ['--no-sandbox'] });
    t.after(() => browser.close());
    const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: 'light' })).newPage();
    const errores: string[] = [];
    page.on('pageerror', (e) => errores.push(String(e)));
    page.on('console', (m) => { if (m.type() === 'error') errores.push(m.text()); });
    await page.goto(`file://${HTML}`);
    await page.waitForSelector('[data-chip="tienda"]');
    await page.waitForFunction(() => !!(window as any).__POS_GUARDAR_ESTADO__);
    await page.waitForTimeout(500);
    await page.click('#nav button[data-vista="administracion"]');
    await page.click('#nav button[data-vista="almacen"]');
    await page.click('#btn-alta-manual');
    await page.fill('#man-cantidad', '7');
    await page.fill('#man-codigo', 'PERSIST-1');
    await page.fill('#man-descripcion', 'CAMISA PRUEBA');
    await page.fill('#man-precio', '250');
    await page.click('#manual-guardar');
    await page.waitForSelector('#alm-cuerpo tr[data-codigo="PERSIST-1"]');
    await page.evaluate(() => (window as any).__POS_GUARDAR_ESTADO__());
    await page.reload();
    await page.waitForSelector('[data-chip="tienda"]');
    await page.waitForTimeout(800);
    await page.click('#nav button[data-vista="administracion"]');
    await page.click('#nav button[data-vista="almacen"]');
    await page.waitForSelector('#alm-cuerpo tr[data-codigo="PERSIST-1"]');
    assert.equal(await page.textContent('#alm-cuerpo tr[data-codigo="PERSIST-1"] [data-col="almacen"]'), '7');
    // «Reiniciar datos de prueba» sí borra todo
    await page.click('#reiniciar');
    await page.waitForTimeout(500);
    await page.reload();
    await page.waitForSelector('[data-chip="tienda"]');
    await page.waitForTimeout(800);
    await page.click('#nav button[data-vista="administracion"]');
    await page.click('#nav button[data-vista="almacen"]');
    await page.waitForSelector('#alm-cuerpo');
    assert.equal(await page.locator('#alm-cuerpo tr[data-codigo="PERSIST-1"]').count(), 0);
    assert.deepEqual(errores, []);
  });
  it('B5 promociones, cupón con QR, supervisor y descuento con clave en la página', async (t) => {
    execFileSync(process.execPath, [join(RAIZ, 'scripts', 'construir-prueba.mjs')], { stdio: 'pipe' });
    const browser = await chromium.launch({ executablePath: chromiumPath, args: ['--no-sandbox'] });
    t.after(() => browser.close());
    const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: 'light', acceptDownloads: true })).newPage();
    const errores: string[] = [];
    page.on('pageerror', (e) => errores.push(String(e)));
    page.on('console', (m) => { if (m.type() === 'error') errores.push(m.text()); });
    await page.goto(`file://${HTML}`);
    await page.waitForSelector('[data-chip="tienda"]');

    // Administración: supervisor, promoción 2x1 y cupón
    await page.click('#nav button[data-vista="administracion"]');
    await page.click('#nav button[data-vista="promociones"]');
    await page.waitForSelector('#form-sup');
    await page.fill('#sup-nombre', 'Ana Supervisora');
    await page.fill('#sup-clave', '12');
    await page.click('#btn-sup');
    await page.waitForFunction(() => /4 a 8 d/.test(document.querySelector('#msg-sup')!.textContent!));
    await page.fill('#sup-clave', '4321');
    await page.click('#btn-sup');
    await page.waitForSelector('#tabla-supervisores tr[data-sup]');

    await page.click('#btn-nueva-promo');
    await page.fill('#pr-nombre', '2x1 en jeans');
    await page.click('#form-promo details summary');
    await page.fill('#pr-palabras', 'jeans');
    await page.click('#pr-guardar');
    await page.waitForSelector('#tabla-promos tr[data-promo]');
    assert.match((await page.textContent('#tabla-promos tr[data-promo]'))!, /Lleva 2, paga 1.*jeans.*sin fecha límite.*Activa/);

    await page.click('#btn-nueva-promo');
    await page.selectOption('#pr-tipo', 'cupon');
    await page.fill('#pr-nombre', 'Verano 20');
    await page.fill('#pr-codigo', 'verano20');
    await page.fill('#pr-cup-valor', '20');
    await page.fill('#pr-minimo', '500');
    await page.uncheck('#pr-sin-fin');
    await page.fill('#pr-fin', new Date(Date.now() - 7 * 3600e3 + 30 * 86400000).toISOString().slice(0, 10));
    await page.click('#pr-guardar');
    await page.waitForSelector('#tabla-promos tr[data-promo] .p-qr');
    assert.match((await page.textContent('#tabla-promos'))!, /Código VERANO20: 20 % de descuento en compras desde \$500\.00/);

    // imagen del cupón con QR: se descarga un PNG real
    await page.click('#tabla-promos .p-qr');
    await page.waitForSelector('#img-cupon');
    assert.deepEqual(await page.$eval('#img-cupon', (c) => [(c as HTMLCanvasElement).width, (c as HTMLCanvasElement).height]), [1080, 1350]);
    assert.equal(await page.$eval('#img-cupon', (c) => (c as HTMLCanvasElement).getContext('2d')!.getImageData(540, 900, 1, 1).data[0] !== undefined), true);
    const [descarga] = await Promise.all([page.waitForEvent('download'), page.click('#img-png')]);
    const ruta = await descarga.path();
    const png = readFileSync(ruta!);
    assert.equal(descarga.suggestedFilename(), 'cupon-VERANO20.png');
    assert.deepEqual([...png.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10], 'es un PNG');
    assert.ok(png.length > 10_000);
    await page.screenshot({ path: join(RAIZ, 'docs', 'capturas', '28-cupon-qr.png') });
    await page.click('#img-cerrar');
    await page.screenshot({ path: join(RAIZ, 'docs', 'capturas', '29-promociones-admin.png') });

    // Caja: la promoción se aplica sola; el cupón se escanea; el descuento pide la clave del supervisor
    await page.click('#nav button[data-vista="volver_caja"]');
    await page.waitForSelector('[data-chip="tienda"]');
    const escanear = async (c: string) => { await page.fill('#scan', c); await page.press('#scan', 'Enter'); };
    await escanear('0002026090782');
    await page.waitForSelector('#cuerpo tr[data-linea]');
    await escanear('0002026090799');
    await page.waitForFunction(() => document.querySelector('#total')!.textContent === '$899.00');
    assert.match((await page.textContent('#promos-aplicadas'))!, /2x1 en jeans.*-\$899\.00/);
    // una sola promoción o cupón por compra: con el 2x1 puesto, el cupón (que da menos) no se combina
    await page.click('#btn-cupon');
    await page.fill('#cup-codigo', 'verano20');
    await page.click('#cup-aplicar');
    await page.waitForFunction(() => /no se combina.*2x1 en jeans/.test(document.querySelector('#msg-cupon')!.textContent!));
    await page.click('#cup-cerrar');
    // sin la segunda pieza no hay 2x1 y el cupón escaneado sí aplica
    await page.click('#btn-quitar');
    await page.waitForFunction(() => document.querySelectorAll('#cuerpo tr[data-linea]').length === 1);
    await escanear('CUPON:VERANO20');
    await page.waitForFunction(() => document.querySelector('#total')!.textContent === '$719.20');
    assert.match((await page.textContent('#promos-aplicadas'))!, /Cupón VERANO20.*-\$179\.80/);
    await page.click('#btn-quitar-cupon');
    await page.waitForFunction(() => document.querySelector('#total')!.textContent === '$899.00');
    await page.click('#btn-cupon');
    await page.fill('#cup-codigo', 'NOEXISTE');
    await page.click('#cup-aplicar');
    await page.waitForFunction(() => /no existe/.test(document.querySelector('#msg-cupon')!.textContent!));
    await page.fill('#cup-codigo', 'verano20');
    await page.click('#cup-aplicar');
    await page.waitForFunction(() => document.querySelector('#total')!.textContent === '$719.20');
    await page.screenshot({ path: join(RAIZ, 'docs', 'capturas', '30-venta-promos-cupon.png') });

    await page.click('#btn-descuento');
    await page.waitForSelector('#form-descuento');
    await page.check('input[name="desc-alcance"][value="venta"]');
    await page.fill('#desc-valor', '100');
    await page.fill('#desc-clave', '0000');
    await page.click('#desc-aplicar');
    await page.waitForFunction(() => /clave del supervisor no es válida/.test(document.querySelector('#msg-desc')!.textContent!));
    await page.fill('#desc-clave', '4321');
    await page.click('#desc-aplicar');
    await page.waitForFunction(() => document.querySelector('#total')!.textContent === '$0.00');
    assert.match((await page.textContent('#promos-aplicadas'))!, /Descuento autorizado por Ana Supervisora/);
    await vendioClientas(page);
    await page.waitForSelector('#btn-cobrar:not([disabled])');
    await page.click('#btn-cobrar');
    await page.waitForSelector('#dlg-ticket[open]');
    const ticket = (await page.textContent('#ticket-texto'))!;
    assert.match(ticket, /Descuento autorizado por Ana +-\$899\.00\s+Supervisora/);
    assert.match(ticket, /TOTAL +\$0\.00/);
    // reporte de descuentos: la venta aparece con el supervisor que la autorizó
    await page.click('#btn-nueva');
    await page.click('#nav button[data-vista="administracion"]');
    await page.click('#nav button[data-vista="promociones"]');
    await page.click('#btn-reporte-promos');
    await page.waitForSelector('#tabla-desc-supervisor tr[data-supervisor]');
    assert.equal(await page.getAttribute('#nav button[data-vista="promociones"]', 'aria-current'), 'page', 'el reporte cuelga de Promociones en el menú');
    assert.equal(await page.locator('#nav button[data-vista="descuentos"]').count(), 0, 'ya no hay «Descuentos» aparte en el menú');
    assert.match((await page.textContent('#tabla-desc-supervisor tr[data-supervisor="Ana Supervisora"]'))!, /Ana Supervisora.*\$899\.00.*100 %/s);
    assert.equal(await page.textContent('#tabla-desc-resumen [data-campo="tickets"]'), '1 ticket(s)');
    assert.match((await page.textContent('#tabla-desc-detalle tr[data-tipo="manual"]'))!, /Descuento autorizado.*Ana Supervisora.*\$899\.00.*confirmada/s);
    await page.screenshot({ path: join(RAIZ, 'docs', 'capturas', '32-reporte-descuentos.png') });
    await page.click('#btn-volver-promos');
    await page.waitForSelector('#tabla-promos');
    assert.deepEqual(errores, []);
  });
  it('B6 promoción por tienda desde Inventario («Crear promoción»), paquete a precio fijo, nombre de tienda editable', async (t) => {
    execFileSync(process.execPath, [join(RAIZ, 'scripts', 'construir-prueba.mjs')], { stdio: 'pipe' });
    const browser = await chromium.launch({ executablePath: chromiumPath, args: ['--no-sandbox'] });
    t.after(() => browser.close());
    const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: 'light' })).newPage();
    const errores: string[] = [];
    page.on('pageerror', (e) => errores.push(String(e)));
    page.on('console', (m) => { if (m.type() === 'error') errores.push(m.text()); });
    await page.goto(`file://${HTML}`);
    await page.waitForSelector('[data-chip="tienda"]');
    await page.click('#nav button[data-vista="administracion"]');

    // nombre de la tienda editable
    await page.click('#nav button[data-vista="configuracion"]');
    await page.click('#cfg-tab-tiendas');
    const duo = '#tabla-tiendas section[data-tienda="DUO"]';
    await page.waitForSelector(duo);
    assert.equal(await page.inputValue(`${duo} .t-nombre`), 'DÚO New York');
    assert.equal(await page.inputValue(`${duo} .t-rfc`), 'PAVK-781208-TB9');
    assert.match(await page.inputValue(`${duo} .t-politica`), /PÓLIZA DE DEVOLUCIÓN[\s\S]*NO HAY CAMBIOS SIN RECIBO/);
    assert.equal(await page.inputValue('#tabla-tiendas section[data-tienda="LON"] .t-rfc'), '', 'London no trae datos de fábrica');
    await page.fill(`${duo} .t-nombre`, 'DÚO Centro');
    await page.fill(`${duo} .t-direccion`, 'Calle Nueva 123');
    await page.fill(`${duo} .t-politica`, 'Cambios en 5 días con ticket\nNo hacemos devoluciones de efectivo');
    await page.click(`${duo} .t-guardar`);
    await page.waitForFunction(() => /Datos guardados/.test(document.querySelector('#msg-tiendas')!.textContent!));
    await page.fill(`${duo} .t-nombre`, ' ');
    await page.click(`${duo} .t-guardar`);
    await page.waitForFunction(() => /falta el nombre/.test(document.querySelector('#msg-tiendas')!.textContent!));
    await page.screenshot({ path: join(RAIZ, 'docs', 'capturas', '34-datos-de-tienda.png') });

    // Inventario → buscar el artículo → clic en la fila abre su edición → «Crear promoción» con ese artículo ya elegido
    await page.click('#nav button[data-vista="inventario"]');
    await page.fill('#inv-q', 'mascada');
    await page.waitForFunction(() => document.querySelectorAll('#tabla-inv-lista tbody tr[data-item]').length === 1);
    await page.click('#tabla-inv-lista tr[data-item]');
    await page.waitForSelector('#form-articulo');
    await page.click('#art-promo');
    await page.waitForSelector('#form-promo');
    assert.match((await page.textContent('#pr-items'))!, /MASCADA/);
    await page.selectOption('#pr-tipo', 'paquete');
    await page.fill('#pr-nombre', 'Accesorio popular: 4 por $185');
    await page.fill('#pr-lleva2', '4');
    await page.fill('#pr-precio', '185');
    await page.uncheck('.pr-tienda[value="LON"]'); // solo DÚO
    await page.click('#pr-guardar');
    await page.waitForSelector('#tabla-promos tr[data-promo]');
    const fila = '#tabla-promos tr[data-promo]';
    assert.match((await page.textContent(`${fila} [data-col="tiendas"]`))!, /^DÚO Centro$/);
    assert.match((await page.textContent(fila))!, /Lleva 4 por \$185\.00 \(artículos: MASCADA EFENTUS\).*sin fecha límite.*Activa/);
    // un buscador dentro de la promoción también encuentra artículos (por código)
    await page.click(`${fila} .p-editar`);
    await page.fill('#pr-buscar', '0000000000017');
    await page.waitForSelector('#pr-tabla-res tr[data-item]');
    assert.match((await page.textContent('#pr-tabla-res'))!, /BOLSA/);
    assert.equal(await page.isChecked('#pr-acumulable'), true, 'el paquete es acumulable por omisión');
    assert.equal(await page.textContent('#pr-activa-txt'), 'Promoción activa');
    await page.uncheck('#pr-activa');
    assert.equal(await page.textContent('#pr-activa-txt'), 'Promoción desactivada');
    await page.check('#pr-activa');
    await page.screenshot({ path: join(RAIZ, 'docs', 'capturas', '31-promocion-por-tienda.png') });
    await page.click('#pr-cerrar');

    // en la caja de DÚO vale; en la de London no. El nombre editado aparece en la pantalla
    await page.click('#nav button[data-vista="volver_caja"]');
    await page.waitForSelector('[data-chip="tienda"]');
    assert.match((await page.textContent('[data-chip="tienda"]'))!, /DÚO Centro/);
    const escanear = async (c: string) => { await page.fill('#scan', c); await page.press('#scan', 'Enter'); };
    for (let i = 0; i < 4; i++) { await escanear('7501234567890'); await page.waitForTimeout(150); }
    await page.waitForFunction(() => document.querySelector('#total')!.textContent === '$185.00');
    assert.match((await page.textContent('#promos-aplicadas'))!, /Accesorio popular: 4 por \$185.*-\$295\.00/);
    // acumulable: 8 piezas = dos paquetes
    for (let i = 0; i < 4; i++) { await escanear('7501234567890'); await page.waitForTimeout(150); }
    await page.waitForFunction(() => document.querySelector('#total')!.textContent === '$370.00');
    // el ticket sale con el logo de la tienda, sus datos editados y su política
    await page.click('#btn-exacto');
    await page.click('#btn-cobrar');
    await page.waitForSelector('#dlg-ticket[open]');
    assert.equal(await page.$eval('#logo-ticket', (i) => (i as HTMLImageElement).naturalWidth > 100), true, 'el logo del ticket cargó');
    const ticketDuo = (await page.textContent('#ticket-texto'))!;
    for (const x of ['DÚO Centro', 'Calle Nueva 123', 'RFC: PAVK-781208-TB9', 'TELÉFONO 534-0607', 'Cambios en 5 días con ticket']) assert.ok(ticketDuo.includes(x), x);
    assert.doesNotMatch(ticketDuo, /PÓLIZA/, 'la política editada reemplaza la de fábrica');
    await page.screenshot({ path: join(RAIZ, 'docs', 'capturas', '35-ticket-con-logo-y-datos.png') });
    await page.click('#btn-nueva');
    await page.selectOption('#sesion-prueba', 'LON/1');
    await page.waitForSelector('[data-chip="tienda"]');
    for (let i = 0; i < 4; i++) { await escanear('7501234567890'); await page.waitForTimeout(150); }
    await page.waitForFunction(() => document.querySelector('#total')!.textContent === '$480.00');
    assert.equal(await page.locator('#promos-aplicadas li').count(), 0, 'la promoción de DÚO no aplica en London');
    assert.deepEqual(errores, []);
  });
  it('B7 Inventario: lista completa de 50 en 50, clic en un artículo para editarlo, ver su historial y crearle una promoción', async (t) => {
    execFileSync(process.execPath, [join(RAIZ, 'scripts', 'construir-prueba.mjs')], { stdio: 'pipe' });
    const dir = mkdtempSync(join(tmpdir(), 'pos-inv120-'));
    const archivo = join(dir, 'inventario120.xlsx');
    writeFileSync(archivo, await xlsxDeFilas(Array.from({ length: 120 }, (_, i) => [i + 1, 'MARCA', `ARTICULO ${i + 1}`, null, null, null, 100 + i, 0, `70000${String(i + 1).padStart(3, '0')}`, 'DAMA', null, 'Yes', null, null])));
    const browser = await chromium.launch({ executablePath: chromiumPath, args: ['--no-sandbox'] });
    t.after(async () => { await browser.close(); rmSync(dir, { recursive: true, force: true }); });
    const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: 'light' })).newPage();
    const errores: string[] = [];
    page.on('pageerror', (e) => errores.push(String(e)));
    page.on('console', (m) => { if (m.type() === 'error') errores.push(m.text()); });
    await page.goto(`file://${HTML}`);
    await page.waitForSelector('[data-chip="tienda"]');
    await page.setInputFiles('#archivo-inventario', archivo);
    await page.waitForSelector('#dlg-importar[open]');
    await page.click('#imp-cargar');
    await page.waitForFunction(() => /Inventario cargado: inventario120\.xlsx · 120 artículos/.test(document.querySelector('#estado-inv')!.textContent!));
    await page.click('#nav button[data-vista="administracion"]');
    await page.click('#nav button[data-vista="inventario"]');
    await page.waitForSelector('#tabla-inv-lista tr[data-item]');

    // lista completa en páginas de 50
    assert.equal(await page.locator('#tabla-inv-lista tbody tr[data-item]').count(), 50);
    assert.equal(await page.textContent('#inv-pag-info'), 'Artículos 1–50 de 120 · página 1 de 3');
    assert.equal(await page.isDisabled('#inv-ant'), true);
    await page.click('#inv-sig');
    await page.waitForFunction(() => /Artículos 51–100 de 120/.test(document.querySelector('#inv-pag-info')!.textContent!));
    await page.click('#inv-sig');
    await page.waitForFunction(() => /Artículos 101–120 de 120 · página 3 de 3/.test(document.querySelector('#inv-pag-info')!.textContent!));
    assert.equal(await page.locator('#tabla-inv-lista tbody tr[data-item]').count(), 20);
    assert.equal(await page.isDisabled('#inv-sig'), true);

    // buscar y entrar a la edición con un clic
    await page.fill('#inv-q', 'articulo 77');
    await page.waitForFunction(() => document.querySelectorAll('#tabla-inv-lista tbody tr[data-item]').length === 1);
    await page.click('#tabla-inv-lista tr[data-item]');
    await page.waitForSelector('#form-articulo');
    assert.equal(await page.inputValue('#art-descripcion'), 'ARTICULO 77');
    assert.equal(await page.inputValue('#art-precio'), '176'); // $100 + 76
    await page.fill('#art-precio', '199.50');
    await page.fill('#art-marca', 'ACME');
    await page.click('#art-guardar');
    await page.waitForFunction(() => /guardado/.test(document.querySelector('#inv-msg')!.textContent!));
    assert.match((await page.textContent('#tabla-inv-lista tr[data-item]'))!, /ACME.*\$199\.50/);

    // historial y crear promoción desde el mismo artículo
    await page.click('#tabla-inv-lista tr[data-item]');
    await page.waitForSelector('#form-articulo');
    await page.click('#art-historial');
    await page.waitForSelector('#tabla-art-historial tbody tr');
    const eventos = await page.$$eval('#tabla-art-historial tbody tr', (r) => r.map((x) => x.textContent));
    assert.match(eventos[0]!, /Cambio en el catálogo.*Marca: «MARCA» → «ACME».*Precio: \$176\.00 → \$199\.50.*Administración/);
    assert.match(eventos.at(-1)!, /Alta en el catálogo/);
    await page.screenshot({ path: join(RAIZ, 'docs', 'capturas', '33-articulo-historial.png') });
    await page.click('#art-promo');
    await page.waitForSelector('#form-promo');
    assert.match((await page.textContent('#pr-items'))!, /ARTICULO 77 ACME/, 'el artículo ya queda elegido en la promoción');
    // por cada $X de compra no necesita artículos
    await page.selectOption('#pr-tipo', 'por_cada');
    assert.equal(await page.isVisible('#pr-buscar'), false);
    assert.match((await page.textContent('#form-promo'))!, /no necesita elegir artículos/);
    await page.selectOption('#pr-tipo', 'paquete');
    assert.match((await page.textContent('#pr-items'))!, /ARTICULO 77 ACME/);
    assert.deepEqual(errores, []);
  });
  it('B8 ticket de regalo: se pide antes de cobrar o después, sale sin precios y se reimprime desde el historial', async (t) => {
    execFileSync(process.execPath, [join(RAIZ, 'scripts', 'construir-prueba.mjs')], { stdio: 'pipe' });
    const browser = await chromium.launch({ executablePath: chromiumPath, args: ['--no-sandbox'] });
    t.after(() => browser.close());
    const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: 'light' })).newPage();
    const errores: string[] = [];
    page.on('pageerror', (e) => errores.push(String(e)));
    page.on('console', (m) => { if (m.type() === 'error') errores.push(m.text()); });
    await page.goto(`file://${HTML}`);
    await page.waitForSelector('[data-chip="tienda"]');
    const escanear = async (c: string) => { await page.fill('#scan', c); await page.press('#scan', 'Enter'); };
    // 1) se enciende «Ticket de regalo» ANTES de cobrar: sale junto con el ticket de la venta
    await escanear('0002026090782');
    await page.waitForSelector('#cuerpo tr[data-linea]');
    await page.click('#btn-regalo');
    assert.equal(await page.getAttribute('#btn-regalo', 'aria-pressed'), 'true');
    await page.fill('#recibido', '1000');
    await page.click('#btn-cobrar');
    await page.waitForSelector('#dlg-ticket[open]');
    await page.waitForFunction(() => /Ticket de regalo enviado a la impresora/.test(document.querySelector('#estado-regalo')?.textContent ?? ''));
    // 2) desde el mismo diálogo se puede ver (e imprimir otra vez)
    await page.click('#btn-ticket-regalo');
    await page.waitForSelector('#ticket-regalo-texto');
    const regalo = (await page.textContent('#ticket-regalo-texto'))!;
    assert.match(regalo, /\*\*\* TICKET DE REGALO \*\*\*/);
    assert.match(regalo, /^1 JEANS LEVIS 726-$/m);
    assert.match(regalo, /^Compra: D1-000001$/m);
    assert.doesNotMatch(regalo, /\$|TOTAL|Efectivo/);
    assert.equal(await page.$eval('#dlg-regalo #logo-ticket', (i) => (i as HTMLImageElement).naturalWidth > 100), true, 'lleva el logo');
    await page.screenshot({ path: join(RAIZ, 'docs', 'capturas', '36-ticket-de-regalo.png') });
    await page.click('#regalo-reimprimir');
    await page.waitForFunction(() => /enviado a la impresora/.test(document.querySelector('#estado-regalo-dlg')!.textContent!));
    await page.click('#regalo-cerrar');
    await page.click('#btn-nueva');
    // la casilla se apaga sola para la siguiente venta
    await page.waitForSelector('#btn-regalo');
    assert.equal(await page.getAttribute('#btn-regalo', 'aria-pressed'), 'false');
    // 3) desde el historial
    await page.click('#nav button[data-vista="ventas"]');
    await page.waitForSelector('#tabla-ventas [data-ver]');
    await page.click('#tabla-ventas [data-ver]');
    await page.click('#btn-ticket-regalo');
    await page.waitForSelector('#ticket-regalo-texto');
    assert.match((await page.textContent('#ticket-regalo-texto'))!, /JEANS LEVIS/);
    assert.deepEqual(errores, []);
  });

  it('B9 venta en espera: se guarda con nota, se atiende a otro cliente y se retoma; la vacía no se guarda', async (t) => {
    execFileSync(process.execPath, [join(RAIZ, 'scripts', 'construir-prueba.mjs')], { stdio: 'pipe' });
    const browser = await chromium.launch({ executablePath: chromiumPath, args: ['--no-sandbox'] });
    t.after(() => browser.close());
    const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: 'light' })).newPage();
    const errores: string[] = [];
    page.on('pageerror', (e) => errores.push(String(e)));
    page.on('console', (m) => { if (m.type() === 'error') errores.push(m.text()); });
    await page.goto(`file://${HTML}`);
    await page.waitForSelector('[data-chip="tienda"]');
    const escanear = async (c: string) => { await page.fill('#scan', c); await page.press('#scan', 'Enter'); };
    assert.equal(await page.isDisabled('#btn-espera'), false);
    // con la venta vacía no hay nada que guardar
    await page.click('#btn-espera');
    await page.waitForSelector('#dlg-espera[open]');
    assert.equal(await page.isDisabled('#esp-guardar'), true);
    assert.match((await page.textContent('#dlg-espera'))!, /No hay ventas en espera/);
    await page.click('#esp-cerrar');
    // cliente 1 se guarda en espera
    await escanear('0002026090782');
    await page.waitForSelector('#cuerpo tr[data-linea]');
    await page.click('#btn-espera');
    await page.fill('#esp-nota', 'Sra. Lupe');
    await page.click('#esp-guardar');
    await page.waitForFunction(() => /\(1\)/.test(document.querySelector('#txt-espera')?.textContent ?? ''));
    assert.equal(await page.locator('#cuerpo tr[data-linea]').count(), 0, 'la pantalla queda limpia para el siguiente cliente');
    // cliente 2 se cobra
    await escanear('0002026090799');
    await page.waitForSelector('#cuerpo tr[data-linea]');
    await page.fill('#recibido', '1000');
    await page.click('#btn-cobrar');
    await page.waitForSelector('#dlg-ticket[open]');
    await page.click('#btn-nueva');
    await page.waitForFunction(() => /\(1\)/.test(document.querySelector('#txt-espera')?.textContent ?? ''));
    // se retoma el cliente 1
    await page.click('#btn-espera');
    assert.match((await page.textContent('#dlg-espera'))!, /Sra\. Lupe/);
    await page.screenshot({ path: join(RAIZ, 'docs', 'capturas', '37-venta-en-espera.png') });
    await page.click('#dlg-espera .esp-retomar');
    await page.waitForSelector('#cuerpo tr[data-linea]');
    assert.equal(await page.locator('#cuerpo tr[data-linea]').count(), 1);
    assert.equal((await page.textContent('#txt-espera'))!.trim(), 'Venta en espera');
    // y se descarta una segunda con confirmación en dos pasos
    await page.click('#btn-espera');
    await page.click('#esp-guardar');
    await page.waitForFunction(() => /\(1\)/.test(document.querySelector('#txt-espera')?.textContent ?? ''));
    await page.click('#btn-espera');
    await page.click('#dlg-espera .esp-descartar');
    assert.match((await page.textContent('#dlg-espera .esp-descartar'))!, /Confirmar/);
    await page.click('#dlg-espera .esp-descartar');
    await page.waitForFunction(() => /No hay ventas en espera/.test(document.querySelector('#dlg-espera')?.textContent ?? ''));
    assert.deepEqual(errores, []);
  });

  it('B10 tarjeta con captura manual: total y mixto; pide autorización, valida el monto y la autorización sale en el ticket', async (t) => {
    execFileSync(process.execPath, [join(RAIZ, 'scripts', 'construir-prueba.mjs')], { stdio: 'pipe' });
    const browser = await chromium.launch({ executablePath: chromiumPath, args: ['--no-sandbox'] });
    t.after(() => browser.close());
    const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: 'light' })).newPage();
    const errores: string[] = [];
    page.on('pageerror', (e) => errores.push(String(e)));
    page.on('console', (m) => { if (m.type() === 'error') errores.push(m.text()); });
    await page.goto(`file://${HTML}`);
    await page.waitForSelector('[data-chip="tienda"]');
    const escanear = async (c: string) => { await page.fill('#scan', c); await page.press('#scan', 'Enter'); };
    await escanear('0002026090782');
    await page.waitForSelector('#cuerpo tr[data-linea]');
    // tarjeta por el total
    assert.equal(await page.isDisabled('[data-forma="tarjeta"]'), false);
    await page.click('[data-forma="tarjeta"]');
    assert.equal(await page.isDisabled('#btn-cobrar'), true, 'sin autorización no se puede cobrar');
    await page.fill('#tj-aut', '12');
    assert.equal(await page.isDisabled('#btn-cobrar'), true, 'autorización demasiado corta');
    await page.fill('#tj-aut', 'ab1234');
    await page.selectOption('#tj-marca', 'Visa');
    await page.locator('#tj-ult4').pressSequentially('43x2a1');
    assert.equal(await page.inputValue('#tj-ult4'), '4321', 'solo acepta dígitos');
    await page.screenshot({ path: join(RAIZ, 'docs', 'capturas', '38-tarjeta-manual.png') });
    assert.equal(await page.isDisabled('#btn-cobrar'), false);
    await page.click('#btn-cobrar');
    await page.waitForSelector('#dlg-ticket[open]');
    assert.match((await page.textContent('#ticket-texto'))!, /Aut\. AB1234\s+VISA \*\*\*\*4321/);
    await page.click('#btn-nueva');
    // mixto: tarjeta parcial + resto en efectivo
    await escanear('0002026090782');
    await page.waitForSelector('#cuerpo tr[data-linea]');
    await page.click('[data-forma="mixto"]');
    await page.fill('#tj-aut', '998877');
    assert.equal(await page.isDisabled('#btn-cobrar'), true, 'sin monto de tarjeta no se puede cobrar');
    await page.fill('#tj-monto', '999999');
    assert.equal(await page.isDisabled('#btn-cobrar'), true, 'el monto no puede exceder el total');
    await page.fill('#tj-monto', '100');
    await page.waitForFunction(() => document.querySelector('#tj-resto-monto')!.textContent !== '$0.00');
    assert.equal(await page.isDisabled('#btn-cobrar'), false);
    await page.click('#btn-cobrar');
    await page.waitForSelector('#dlg-ticket[open]');
    const tk = (await page.textContent('#ticket-texto'))!;
    assert.match(tk, /Tarjeta\s+\$100\.00/);
    assert.match(tk, /Efectivo MXN/);
    assert.match(tk, /Aut\. 998877/);
    assert.deepEqual(errores, []);
  });

  it('B11 catálogo inicial en El Limbo: se vende en cualquier tienda y caja y el saldo baja en un solo lugar', async (t) => {
    execFileSync(process.execPath, [join(RAIZ, 'scripts', 'construir-prueba.mjs')], { stdio: 'pipe' });
    const dir = mkdtempSync(join(tmpdir(), 'pos-limbo-'));
    const archivo = join(dir, 'catalogo-inicial.xlsx');
    writeFileSync(archivo, await xlsxDeFilas(Array.from({ length: 30 }, (_, i) => [i + 1, 'MARCA', `ARTICULO ${i + 1}`, null, null, null, 100 + i, 0, `70000${String(i + 1).padStart(3, '0')}`, 'DAMA', null, 'Yes', null, null])));
    const browser = await chromium.launch({ executablePath: chromiumPath, args: ['--no-sandbox'] });
    t.after(async () => { await browser.close(); rmSync(dir, { recursive: true, force: true }); });
    const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: 'light' })).newPage();
    const errores: string[] = [];
    page.on('pageerror', (e) => errores.push(String(e)));
    page.on('console', (m) => { if (m.type() === 'error') errores.push(m.text()); });
    await page.goto(`file://${HTML}`);
    await page.waitForSelector('[data-chip="tienda"]');
    await page.setInputFiles('#archivo-inventario', archivo);
    await page.waitForSelector('#dlg-importar[open]');
    assert.equal(await page.isChecked('#imp-modo-limbo'), true, 'el catálogo inicial en El Limbo es la opción por omisión');
    await page.fill('#imp-limbo', '5');
    await page.screenshot({ path: join(RAIZ, 'docs', 'capturas', '42-importar-el-limbo.png') });
    await page.click('#imp-cargar');
    await page.waitForFunction(() => /catálogo inicial en El Limbo \(5 pza/.test(document.querySelector('#estado-inv')!.textContent!));
    // DÚO Caja 1 vende una pieza: El Limbo baja de 5 a 4 y la tienda no tiene existencia propia
    await page.fill('#scan', '70000001'); await page.press('#scan', 'Enter');
    await page.waitForSelector('#cuerpo tr[data-linea]');
    assert.match((await page.textContent('[data-existencia="limbo"]'))!, /El Limbo: 5/);
    assert.match((await page.textContent('[data-existencia="tienda"]'))!, /Esta tienda: 0/);
    await page.fill('#recibido', '1000');
    await page.click('#btn-cobrar');
    await page.waitForSelector('#dlg-ticket[open]');
    await page.click('#btn-nueva');
    // London Caja 1 ve el mismo saldo y vende otra: queda en 3
    await page.selectOption('#sesion-prueba', 'LON/1');
    await page.waitForSelector('[data-chip="tienda"]');
    await page.fill('#scan', '70000001'); await page.press('#scan', 'Enter');
    await page.waitForSelector('#cuerpo tr[data-linea]');
    assert.match((await page.textContent('[data-existencia="limbo"]'))!, /El Limbo: 4/);
    await page.fill('#recibido', '1000');
    await page.click('#btn-cobrar');
    await page.waitForSelector('#dlg-ticket[open]');
    await page.click('#btn-nueva');
    // Administración: columna El Limbo
    await page.selectOption('#sesion-prueba', 'admin');
    await page.click('#nav button[data-vista="inventario"]');
    await page.waitForSelector('#tabla-inv-lista tr[data-item]');
    await page.fill('#inv-q', '70000001');
    await page.waitForFunction(() => document.querySelectorAll('#tabla-inv-lista tbody tr[data-item]').length === 1);
    assert.equal(await page.textContent('#tabla-inv-lista tr[data-item] [data-col="limbo"]'), '3');
    assert.equal(await page.locator('#btn-catalogo-inicial').count(), 1, 'Inventario ofrece cargar el catálogo inicial');
    assert.equal(await page.textContent('#tabla-inv-tiendas tr[data-tienda="LIMBO"] td'), 'El Limbo');
    await page.screenshot({ path: join(RAIZ, 'docs', 'capturas', '43-inventario-el-limbo.png') });
    assert.deepEqual(errores, []);
  });

  it('B12 el archivo trae cantidades: se eligen la columna y se cargan como existencia inicial de El Limbo', async (t) => {
    execFileSync(process.execPath, [join(RAIZ, 'scripts', 'construir-prueba.mjs')], { stdio: 'pipe' });
    const dir = mkdtempSync(join(tmpdir(), 'pos-limbo-cant-'));
    const archivo = join(dir, 'catalogo-con-cantidades.xlsx');
    writeFileSync(archivo, await xlsxDeFilas(Array.from({ length: 10 }, (_, i) => [i + 1, 'MARCA', `ARTICULO ${i + 1}`, null, null, null, 100 + i, 0, `70000${String(i + 1).padStart(3, '0')}`, 'DAMA', null, 'Yes', null, null, i === 0 ? 8 : 3]), [...ENCABEZADOS_REALES, 'Piezas']));
    const browser = await chromium.launch({ executablePath: chromiumPath, args: ['--no-sandbox'] });
    t.after(async () => { await browser.close(); rmSync(dir, { recursive: true, force: true }); });
    const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: 'light' })).newPage();
    const errores: string[] = [];
    page.on('pageerror', (e) => errores.push(String(e)));
    page.on('console', (m) => { if (m.type() === 'error') errores.push(m.text()); });
    await page.goto(`file://${HTML}`);
    await page.waitForSelector('[data-chip="tienda"]');
    await page.setInputFiles('#archivo-inventario', archivo);
    await page.waitForSelector('#dlg-importar[open]');
    await page.selectOption('#imp-col-cantidad', 'Piezas');
    await page.waitForSelector('#imp-cantidad-archivo');
    assert.match((await page.textContent("#imp-cantidad-archivo"))!, /10 artículos con cantidad · 35 piezas/);
    await page.screenshot({ path: join(RAIZ, 'docs', 'capturas', '44-importar-cantidades.png') });
    await page.click('#imp-cargar');
    await page.waitForFunction(() => /cantidades del archivo, 35 piezas/.test(document.querySelector('#estado-inv')!.textContent!));
    await page.fill('#scan', '70000001'); await page.press('#scan', 'Enter');
    await page.waitForSelector('#cuerpo tr[data-linea]');
    assert.match((await page.textContent('[data-existencia="limbo"]'))!, /El Limbo: 8/);
    assert.deepEqual(errores, []);
  });

  it('B13 retiro de efectivo: aviso flotante con $10,000 de venta (sin bloquear), retiro con billetes grandes y datos impresos', async (t) => {
    execFileSync(process.execPath, [join(RAIZ, 'scripts', 'construir-prueba.mjs')], { stdio: 'pipe' });
    const browser = await chromium.launch({ executablePath: chromiumPath, args: ['--no-sandbox'] });
    t.after(() => browser.close());
    const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: 'light' })).newPage();
    const errores: string[] = [];
    page.on('pageerror', (e) => errores.push(String(e)));
    page.on('console', (m) => { if (m.type() === 'error') errores.push(m.text()); });
    await page.goto(`file://${HTML}`);
    await page.waitForSelector('[data-chip="tienda"]');
    assert.equal(await page.locator('#nav button[data-vista="retiro"]').count(), 1, 'Retiro está en el menú de venta');
    // $12,000 de efectivo de venta (el fondo no cuenta): una venta de 12 jeans de $899 + fondo de $3,000
    await page.evaluate(async () => {
      const a = (window as any).__POS_ATENDER__;
      await a('POST', '/api/efectivo/movimiento', { tipo: 'fondo_inicial', monto: 300000, moneda: 'MXN' });
      const { json: v } = await a('POST', '/api/venta/nueva', {});
      const { json: e } = await a('POST', '/api/venta/escanear', { cart: v.cart, codigo: '0002026090782' });
      await a('POST', '/api/venta/cantidad', { cart: v.cart, linea_id: e.linea.linea_id, qty: 12 });
      await a('POST', '/api/venta/cobrar-efectivo', { cart: v.cart, recibido: 1100000 });
    });
    await page.click('#nav button[data-vista="retiro"]');
    await page.waitForSelector('#ret-resumen');
    await page.click('#nav button[data-vista="venta"]');
    await page.waitForSelector('#dlg-retiro-aviso[open]');
    assert.match((await page.textContent('#ret-aviso-monto'))!, /\$10,788\.00/);
    // el aviso NO bloquea: se puede escanear con el aviso a la vista
    await page.fill('#scan', '0002026090799');
    await page.press('#scan', 'Enter');
    await page.waitForSelector('#cuerpo tr[data-linea]');
    await page.screenshot({ path: join(RAIZ, 'docs', 'capturas', '45-aviso-retiro.png') });
    await page.click('#ret-aviso-despues');
    assert.equal(await page.locator('#dlg-retiro-aviso[open]').count(), 0);
    // retiro: no alcanza con $7,000; con $8,500 sí
    await page.click('#nav button[data-vista="retiro"]');
    await page.waitForSelector('#ret-tabla-mxn');
    await page.fill('.ret-mxn[data-den="100000"]', '7');
    assert.equal(await page.isDisabled('#btn-retirar'), true);
    assert.match((await page.textContent('#ret-estado'))!, /Faltan \$1,000\.00/);
    await page.fill('.ret-mxn[data-den="100000"]', '8');
    await page.fill('.ret-mxn[data-den="50000"]', '1');
    assert.equal(await page.isDisabled('#btn-retirar'), false);
    await page.screenshot({ path: join(RAIZ, 'docs', 'capturas', '46-retiro.png') });
    await page.click('#btn-retirar');
    await page.waitForSelector('#dlg-retiro-ticket[open]');
    assert.match((await page.textContent('#ret-tk-resumen'))!, /D1-R0001/);
    assert.match((await page.textContent('#ret-tk-texto'))!, /TOTAL RETIRADO \(MXN\)\s+\$8,500\.00/);
    assert.match((await page.textContent('#ret-tk-impresion'))!, /enviados a la impresora/);
    await page.click('#ret-tk-cerrar');
    await page.waitForSelector('#tabla-retiros tr[data-retiro]');
    assert.equal(await page.textContent('#ret-resumen [data-campo="equivalente"]'), '$2,288.00');
    assert.deepEqual(errores, []);
  });

  it('B14 conteo de El Limbo: escanear cuenta una pieza, se corrige la cantidad, se aplica y El Limbo queda en lo contado', async (t) => {
    execFileSync(process.execPath, [join(RAIZ, 'scripts', 'construir-prueba.mjs')], { stdio: 'pipe' });
    const dir = mkdtempSync(join(tmpdir(), 'pos-conteo-'));
    const archivo = join(dir, 'catalogo.xlsx');
    writeFileSync(archivo, await xlsxDeFilas(Array.from({ length: 10 }, (_, i) => [i + 1, 'MARCA', `ARTICULO ${i + 1}`, null, null, null, 100 + i, 0, `70000${String(i + 1).padStart(3, '0')}`, 'DAMA', null, 'Yes', null, null])));
    const browser = await chromium.launch({ executablePath: chromiumPath, args: ['--no-sandbox'] });
    t.after(async () => { await browser.close(); rmSync(dir, { recursive: true, force: true }); });
    const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: 'light' })).newPage();
    const errores: string[] = [];
    page.on('pageerror', (e) => errores.push(String(e)));
    page.on('console', (m) => { if (m.type() === 'error') errores.push(m.text()); });
    await page.goto(`file://${HTML}`);
    await page.waitForSelector('[data-chip="tienda"]');
    await page.setInputFiles('#archivo-inventario', archivo);
    await page.waitForSelector('#dlg-importar[open]');
    await page.fill('#imp-limbo', '5');
    await page.click('#imp-cargar');
    await page.waitForFunction(() => /catálogo inicial en El Limbo/.test(document.querySelector('#estado-inv')!.textContent!));
    await page.selectOption('#sesion-prueba', 'admin');
    await page.click('#nav button[data-vista="inventario"]');
    await page.click('#btn-conteo-limbo');
    await page.waitForSelector('#cl-form');
    assert.equal(await page.isDisabled('#cl-aplicar'), true, 'sin nada contado no hay qué aplicar');
    const contar = async (c: string) => { await page.fill('#cl-scan', c); await page.press('#cl-scan', 'Enter'); };
    await contar('70000001'); await contar('70000001'); await contar('70000001'); // 3 piezas del artículo 1 (el sistema dice 5)
    await contar('70000002');
    await contar('9999999999999');
    await page.waitForFunction(() => /No se encontró el código/.test(document.querySelector('#msg-cl')!.textContent!));
    await page.waitForFunction(() => document.querySelectorAll('#cl-tabla tr[data-item]').length === 2);
    assert.match((await page.textContent('#cl-tabla tr[data-item] [data-col="dif"]'))!, /-4/, 'el artículo 2: 1 contada contra 5 en el sistema (más reciente arriba)');
    // corregir a mano la cantidad del artículo 1: contó 6
    const fila1 = page.locator('#cl-tabla tr[data-item]', { hasText: 'ARTICULO 1' });
    await fila1.locator('.cl-contado').fill('6');
    await fila1.locator('.cl-contado').press('Tab');
    await page.waitForFunction(() => /2 artículo\(s\) · 7 pieza\(s\) contadas · diferencia contra el sistema: -3/.test(document.querySelector('#cl-resumen')!.textContent!));
    await page.screenshot({ path: join(RAIZ, 'docs', 'capturas', '47-conteo-limbo.png') });
    // el conteo sobrevive a recargar la vista
    await page.click('#btn-volver-inv');
    await page.click('#btn-conteo-limbo');
    await page.waitForSelector('#cl-tabla tr[data-item]');
    assert.equal(await page.locator('#cl-tabla tr[data-item]').count(), 2);
    await page.click('#cl-aplicar');
    await page.waitForSelector('#dlg-cl-confirmar[open]');
    assert.match((await page.textContent('#cl-conf-resumen'))!, /2 artículo\(s\) contados: 1 pieza\(s\) sobrantes y 4 faltantes/);
    await page.click('#cl-conf-si');
    await page.waitForFunction(() => /Conteo aplicado: 2 artículo\(s\), 2 con diferencia \(1 sobrantes, 4 faltantes\)/.test(document.querySelector('#msg-cl')?.textContent ?? ''));
    assert.equal(await page.locator('#cl-historial tr[data-conteo]').count(), 1);
    // Inventario: El Limbo del artículo 1 = 6 y del 2 = 1; el resto no cambió
    await page.click('#btn-volver-inv');
    await page.waitForSelector('#tabla-inv-lista tr[data-item]');
    const limbo = async (q: string) => { await page.fill('#inv-q', q); await page.waitForFunction((c) => { const f = document.querySelectorAll('#tabla-inv-lista tbody tr[data-item]'); return f.length === 1 && f[0]!.textContent!.includes(c); }, q); return page.textContent('#tabla-inv-lista tr[data-item] [data-col="limbo"]'); };
    assert.equal(await limbo('70000001'), '6');
    assert.equal(await limbo('70000002'), '1');
    assert.equal(await limbo('70000003'), '5', 'lo que no se contó no se toca');
    assert.deepEqual(errores, []);
  });

  it('B15 limpiar la búsqueda: botón y Esc borran texto, resultados y mensaje sin tocar la venta', async (t) => {
    execFileSync(process.execPath, [join(RAIZ, 'scripts', 'construir-prueba.mjs')], { stdio: 'pipe' });
    const browser = await chromium.launch({ executablePath: chromiumPath, args: ['--no-sandbox'] });
    t.after(() => browser.close());
    const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: 'light' })).newPage();
    const errores: string[] = [];
    page.on('pageerror', (e) => errores.push(String(e)));
    page.on('console', (m) => { if (m.type() === 'error') errores.push(m.text()); });
    await page.goto(`file://${HTML}`);
    await page.waitForSelector('[data-chip="tienda"]');
    await page.fill('#scan', '0002026090782'); await page.press('#scan', 'Enter');
    await page.waitForSelector('#cuerpo tr[data-linea]');
    // una búsqueda por texto que no sirve
    await page.fill('#scan', 'jeans'); await page.press('#scan', 'Enter');
    await page.waitForSelector('#resultados table');
    await page.click('#btn-limpiar-busqueda');
    assert.equal(await page.locator('#resultados table').count(), 0);
    assert.equal(await page.inputValue('#scan'), '');
    assert.equal((await page.textContent('#mensaje'))!.trim(), '');
    assert.equal(await page.locator('#cuerpo tr[data-linea]').count(), 1, 'la venta no se toca');
    // Esc hace lo mismo con texto a medio escribir
    await page.fill('#scan', 'jeans'); await page.press('#scan', 'Enter');
    await page.waitForSelector('#resultados table');
    await page.fill('#scan', 'algo a medias');
    await page.press('#scan', 'Escape');
    assert.equal(await page.locator('#resultados table').count(), 0);
    assert.equal(await page.inputValue('#scan'), '');
    assert.equal(await page.locator('#cuerpo tr[data-linea]').count(), 1);
    assert.deepEqual(errores, []);
  });

  it('B16 nuevo artículo desde la venta: Administración registra la clave del cajero, la caja pide esa clave y el artículo llega a todas las tiendas', async (t) => {
    execFileSync(process.execPath, [join(RAIZ, 'scripts', 'construir-prueba.mjs')], { stdio: 'pipe' });
    const browser = await chromium.launch({ executablePath: chromiumPath, args: ['--no-sandbox'] });
    t.after(() => browser.close());
    const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: 'light' })).newPage();
    const errores: string[] = [];
    page.on('pageerror', (e) => errores.push(String(e)));
    page.on('console', (m) => { if (m.type() === 'error') errores.push(m.text()); });
    await page.goto(`file://${HTML}`);
    await page.waitForSelector('[data-chip="pie-usuario"]');
    const usuario = ((await page.textContent('[data-chip="pie-usuario"]'))!).replace(/^Usuario:\s*/, '').trim();
    // sin clave registrada no se puede
    await page.click('#btn-nuevo-articulo');
    await page.waitForSelector('#dlg-nuevo-articulo[open]');
    await page.fill('#na-codigo', '202610555'); await page.fill('#na-descripcion', 'PANTIMEDIAS'); await page.fill('#na-precio', '189'); await page.fill('#na-clave', '1234');
    await page.click('#na-guardar');
    await page.waitForFunction(() => /no tiene una clave registrada/.test(document.querySelector('#msg-na')!.textContent!));
    await page.click('#na-cerrar');
    // Administración registra la clave del cajero
    await page.selectOption('#sesion-prueba', 'admin');
    await page.click('#nav button[data-vista="configuracion"]');
    await page.click('#cfg-tab-cajeros');
    await page.waitForSelector('#form-cajero');
    await page.fill('#caj-nombre', usuario); await page.fill('#caj-clave', '1234');
    await perfilMin(page, 'caj'); await page.click('#btn-caj');
    await page.waitForSelector('#tabla-cajeros tr[data-cajero]');
    await page.screenshot({ path: join(RAIZ, 'docs', 'capturas', '48-cajeros.png') });
    // la caja: búsqueda sin resultados → ofrecer el alta con el código ya escrito
    await page.selectOption('#sesion-prueba', 'DUO/1');
    await page.waitForSelector('#form-login'); // ya hay un cajero con clave: la caja pide iniciar sesión
    await page.selectOption('#lg-usuario', usuario); await page.fill('#lg-clave', '1234'); await page.click('#lg-entrar');
    await page.waitForSelector('#scan');
    await page.fill('#scan', '202610555'); await page.press('#scan', 'Enter');
    await page.waitForSelector('#btn-alta-desde-busqueda');
    await page.click('#btn-alta-desde-busqueda');
    await page.waitForSelector('#dlg-nuevo-articulo[open]');
    assert.equal(await page.inputValue('#na-codigo'), '202610555');
    await page.fill('#na-descripcion', 'PANTIMEDIAS'); await page.fill('#na-marca', 'DUESANG'); await page.fill('#na-precio', '189');
    await page.screenshot({ path: join(RAIZ, 'docs', 'capturas', '49-nuevo-articulo.png') });
    await page.fill('#na-clave', '9999');
    await page.click('#na-guardar');
    await page.waitForFunction(() => /la clave no es correcta/.test(document.querySelector('#msg-na')!.textContent!));
    assert.equal(await page.inputValue('#na-clave'), '', 'una clave equivocada se borra');
    await page.fill('#na-clave', '1234');
    await page.click('#na-guardar');
    await page.waitForSelector('#cuerpo tr[data-linea]');
    assert.match((await page.textContent('#cuerpo tr[data-linea]'))!, /PANTIMEDIAS/);
    assert.equal(await page.textContent('#total'), '$189.00');
    // llega a London
    await page.selectOption('#sesion-prueba', 'LON/1');
    await page.waitForSelector('#form-login');
    await page.selectOption('#lg-usuario', usuario); await page.fill('#lg-clave', '1234'); await page.click('#lg-entrar');
    await page.waitForSelector('#scan');
    await page.fill('#scan', '202610555'); await page.press('#scan', 'Enter');
    await page.waitForSelector('#cuerpo tr[data-linea]');
    assert.match((await page.textContent('#cuerpo tr[data-linea]'))!, /PANTIMEDIAS/);
    assert.deepEqual(errores, []);
  });

  it('B17 inicio de sesión: la caja pide cajero y clave, la venta queda a su nombre y se puede cerrar sesión; Administración pide contraseña al crear su primer administrador', async (t) => {
    execFileSync(process.execPath, [join(RAIZ, 'scripts', 'construir-prueba.mjs')], { stdio: 'pipe' });
    const browser = await chromium.launch({ executablePath: chromiumPath, args: ['--no-sandbox'] });
    t.after(() => browser.close());
    const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: 'light' })).newPage();
    const errores: string[] = [];
    page.on('pageerror', (e) => errores.push(String(e)));
    page.on('console', (m) => { if (m.type() === 'error') errores.push(m.text()); });
    await page.goto(`file://${HTML}`);
    await page.waitForSelector('[data-chip="tienda"]');
    assert.equal(await page.locator('#btn-salir').count(), 0, 'sin cajeros registrados no hay inicio de sesión');
    // Administración (abierta) crea un administrador y un cajero
    await page.selectOption('#sesion-prueba', 'admin');
    await page.click('#nav button[data-vista="configuracion"]');
    await page.click('#cfg-tab-cajeros');
    await page.waitForSelector('#form-admin');
    assert.match((await page.textContent('#panel-admins'))!, /consola está abierta/);
    await page.fill('#adm-nombre', 'Edgardo'); await page.fill('#adm-clave', 'clave-segura');
    await perfilMin(page, 'adm'); await page.click('#btn-adm');
    await page.waitForFunction(() => /Administrador agregado/.test(document.querySelector('#msg-admins')?.textContent ?? ''));
    assert.equal(await page.locator('#btn-salir').count(), 1, 'quien crea al primer administrador queda dentro y ve «Cerrar sesión»');
    assert.match((await page.textContent('[data-chip="usuario"]'))!, /Edgardo/);
    await page.fill('#caj-nombre', 'Lupe'); await page.fill('#caj-clave', '4321');
    await perfilMin(page, 'caj'); await page.click('#btn-caj');
    await page.waitForSelector('#tabla-cajeros tr[data-cajero]');
    await page.screenshot({ path: join(RAIZ, 'docs', 'capturas', '51-usuarios.png') });
    // cerrar sesión de Administración → pide usuario y contraseña
    await page.click('#btn-salir');
    await page.waitForSelector('#form-login');
    await page.fill('#lg-usuario', 'Edgardo'); await page.fill('#lg-clave', 'mal-mal'); await page.click('#lg-entrar');
    await page.waitForFunction(() => /incorrectos/.test(document.querySelector('#msg-login')!.textContent!));
    await page.fill('#lg-clave', 'clave-segura'); await page.click('#lg-entrar');
    await page.waitForSelector('#nav button[data-vista="reportes"]');
    // la caja: elegir cajero y clave; la venta sale a su nombre
    await page.selectOption('#sesion-prueba', 'DUO/1');
    await page.waitForSelector('#form-login');
    await page.screenshot({ path: join(RAIZ, 'docs', 'capturas', '52-inicio-de-sesion.png') });
    await page.fill('#lg-clave', '0000'); await page.click('#lg-entrar');
    await page.waitForFunction(() => /no es correcta/.test(document.querySelector('#msg-login')!.textContent!));
    await page.fill('#lg-clave', '4321'); await page.click('#lg-entrar');
    await page.waitForSelector('#scan');
    assert.match((await page.textContent('[data-chip="usuario"]'))!, /Lupe/);
    await page.fill('#scan', '0002026090782'); await page.press('#scan', 'Enter');
    await page.waitForSelector('#cuerpo tr[data-linea]');
    await page.fill('#recibido', '1000');
    await vendioClientas(page);
    await page.click('#btn-cobrar');
    await page.waitForSelector('#dlg-ticket[open]');
    assert.match((await page.textContent('#ticket-texto'))!, /Vendedora-Cajera: Lupe/);
    await page.click('#btn-nueva');
    await page.click('#btn-salir');
    await page.waitForSelector('#form-login');
    assert.deepEqual(errores.filter((e) => !/401|NO_AUTENTICADO|403|Failed to load resource/.test(e)), []);
  });

  it('B18 roles: el almacenista solo ve Inventario y Almacén y no cambia precios; el cajero no entra a Administración; el supervisor ve todo', async (t) => {
    execFileSync(process.execPath, [join(RAIZ, 'scripts', 'construir-prueba.mjs')], { stdio: 'pipe' });
    const browser = await chromium.launch({ executablePath: chromiumPath, args: ['--no-sandbox'] });
    t.after(() => browser.close());
    const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: 'light' })).newPage();
    const errores: string[] = [];
    page.on('pageerror', (e) => errores.push(String(e)));
    page.on('console', (m) => { if (m.type() === 'error') errores.push(m.text()); });
    await page.goto(`file://${HTML}`);
    await page.waitForSelector('[data-chip="tienda"]');
    await page.selectOption('#sesion-prueba', 'admin');
    await page.click('#nav button[data-vista="configuracion"]');
    await page.click('#cfg-tab-cajeros');
    await page.waitForSelector('#form-admin');
    // el primer usuario debe ser supervisor (la opción de almacenista está desactivada) y registra su clave de caja
    assert.equal(await page.locator('#adm-rol option[value="almacenista"]').isDisabled(), true);
    await page.fill('#adm-nombre', 'Edgardo'); await page.fill('#adm-clave', 'clave-segura'); await page.fill('#adm-clave-caja', '2468');
    await perfilMin(page, 'adm'); await page.click('#btn-adm');
    await page.waitForFunction(() => document.querySelectorAll('#tabla-admins tr[data-admin]').length === 1);
    await page.selectOption('#adm-rol', 'almacenista');
    assert.equal(await page.locator('#adm-caja-campo').isHidden(), true, 'el almacenista no lleva clave de caja');
    await page.fill('#adm-nombre', 'Gabo'); await page.fill('#adm-clave', 'clave-gabo');
    await perfilMin(page, 'adm'); await page.click('#btn-adm');
    await page.waitForFunction(() => document.querySelectorAll('#tabla-admins tr[data-admin]').length === 2);
    assert.match((await page.textContent('#tabla-admins tr[data-rol="almacenista"]'))!, /Almacenista/);
    await page.fill('#caj-nombre', 'Lupe'); await page.fill('#caj-clave', '4321');
    await perfilMin(page, 'caj'); await page.click('#btn-caj');
    await page.waitForSelector('#tabla-cajeros tr[data-cajero]');
    await page.screenshot({ path: join(RAIZ, 'docs', 'capturas', '53-roles.png') });
    // el almacenista
    await page.click('#btn-salir');
    await page.waitForSelector('#form-login');
    await page.fill('#lg-usuario', 'Gabo'); await page.fill('#lg-clave', 'clave-gabo'); await page.click('#lg-entrar');
    await page.waitForSelector('#nav button[data-vista="inventario"]');
    assert.deepEqual(await page.$$eval('#nav button', (b) => b.map((x) => x.textContent!.trim())), ['Inventario', 'Almacén', 'Caja']);
    assert.match((await page.textContent('[data-chip="rol"]'))!, /Almacenista/);
    await page.waitForSelector('#tabla-inv-lista tr[data-item]');
    await page.click('#tabla-inv-lista tr[data-item]');
    await page.waitForSelector('#form-articulo');
    assert.equal(await page.locator('#art-promo').count(), 0, 'sin «Crear promoción»');
    assert.equal(await page.getAttribute('#art-precio', 'readonly'), '');
    await page.fill('#art-marca', 'MARCA GABO');
    await page.click('#art-guardar');
    await page.waitForFunction(() => /guardado/.test(document.querySelector('#inv-msg')!.textContent!));
    await page.screenshot({ path: join(RAIZ, 'docs', 'capturas', '54-almacenista.png') });
    await page.click('#nav button[data-vista="almacen"]');
    await page.waitForSelector('#btn-alta-lote');
    // el cajero no entra a Administración
    await page.click('#btn-salir');
    await page.waitForSelector('#form-login');
    await page.fill('#lg-usuario', 'Lupe'); await page.fill('#lg-clave', '4321'); await page.click('#lg-entrar');
    await page.waitForFunction(() => /incorrectos/.test(document.querySelector('#msg-login')!.textContent!));
    // el supervisor ve todo
    await page.fill('#lg-usuario', 'Edgardo'); await page.fill('#lg-clave', 'clave-segura'); await page.click('#lg-entrar');
    await page.waitForSelector('#nav button[data-vista="reportes"]');
    assert.equal(await page.locator('#nav button[data-vista]').count(), 8, '7 pantallas más Caja');
    assert.match((await page.textContent('[data-chip="rol"]'))!, /Supervisor/);
    assert.deepEqual(errores.filter((e) => !/401|403|Failed to load resource/.test(e)), []);
  });

  it('B19 claves en la caja: el retiro pide la propia; el historial ya no cancela ventas; el cambio no pide clave y la devolución de efectivo la pide (la misma cajera u otra)', async (t) => {
    execFileSync(process.execPath, [join(RAIZ, 'scripts', 'construir-prueba.mjs')], { stdio: 'pipe' });
    const browser = await chromium.launch({ executablePath: chromiumPath, args: ['--no-sandbox'] });
    t.after(() => browser.close());
    const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: 'light' })).newPage();
    const errores: string[] = [];
    page.on('pageerror', (e) => errores.push(String(e)));
    page.on('console', (m) => { if (m.type() === 'error') errores.push(m.text()); });
    await page.goto(`file://${HTML}`);
    await page.waitForSelector('[data-chip="tienda"]');
    // Administración registra dos cajeros
    await page.selectOption('#sesion-prueba', 'admin');
    await page.click('#nav button[data-vista="configuracion"]');
    await page.click('#cfg-tab-cajeros');
    await page.waitForSelector('#form-cajero');
    for (const [n, c] of [['Lupe', '4321'], ['Rosa', '8765']]) {
      await page.fill('#caj-nombre', n); await page.fill('#caj-clave', c); await perfilMin(page, 'caj'); await page.click('#btn-caj');
      await page.waitForFunction((x) => [...document.querySelectorAll('#tabla-cajeros tr[data-cajero] b[data-alias]')].some((td) => td.textContent === x), n);
    }
    // Lupe entra a la caja y hace una venta
    await page.selectOption('#sesion-prueba', 'DUO/1');
    await page.waitForSelector('#form-login');
    await page.selectOption('#lg-usuario', 'Lupe'); await page.fill('#lg-clave', '4321'); await page.click('#lg-entrar');
    await page.waitForSelector('#scan');
    const vender = async () => page.evaluate(async () => {
      const a = (window as any).__POS_ATENDER__;
      const { json: v } = await a('POST', '/api/venta/nueva', {});
      const { json: e } = await a('POST', '/api/venta/escanear', { cart: v.cart, codigo: '0002026090782' });
      await a('POST', '/api/venta/cantidad', { cart: v.cart, linea_id: e.linea.linea_id, qty: 12 });
      return (await a('POST', '/api/venta/cobrar-efectivo', { cart: v.cart, recibido: 1500000 })).json.venta.folio;
    });
    const folio = await vender();
    // retiro: pide SU clave
    await page.click('#nav button[data-vista="retiro"]');
    await page.waitForSelector('#ret-clave');
    await page.fill('.ret-mxn[data-den="100000"]', '8');
    assert.equal(await page.isDisabled('#btn-retirar'), true, 'sin clave no se puede retirar');
    await page.fill('#ret-clave', '8765'); // la de Rosa no vale a nombre de Lupe
    await page.click('#btn-retirar');
    await page.waitForFunction(() => /no es correcta/.test(document.querySelector('#ret-estado')!.textContent!));
    await page.fill('#ret-clave', '4321');
    await page.click('#btn-retirar');
    await page.waitForSelector('#dlg-retiro-ticket[open]');
    await page.click('#ret-tk-cerrar');
    // abrir caja: pide la clave de la propia persona
    await page.click('#nav button[data-vista="venta"]');
    await page.click('#btn-abrir-caja');
    await page.waitForSelector('#dlg-abrir-caja[open]');
    await page.fill('#ac-clave', '8765'); // la de Rosa no vale a nombre de Lupe
    await page.click('#form-abrir-caja button[type=submit]');
    await page.waitForFunction(() => /no es correcta/.test(document.querySelector('#msg-ac')!.textContent!));
    await page.fill('#ac-clave', '4321');
    await page.click('#form-abrir-caja button[type=submit]');
    await page.waitForFunction(() => /Caja abierta/.test(document.querySelector('#mensaje')!.textContent!));
    // el historial ya no cancela ventas cobradas: ofrece «Aceptar cambio»
    await page.click('#nav button[data-vista="ventas"]');
    await page.waitForSelector(`#tabla-ventas tr[data-folio="${folio}"] [data-cambio]`);
    assert.equal(await page.locator('[data-cancelar]').count(), 0, 'no hay botón de cancelar venta en el historial');
    assert.equal((await page.textContent(`#tabla-ventas tr[data-folio="${folio}"] [data-cambio]`))!.trim(), 'Aceptar cambio');
    await page.click(`#tabla-ventas tr[data-folio="${folio}"] [data-cambio]`);
    await page.waitForSelector('form[data-sale] input[data-linea]'); // la venta ya viene buscada por folio
    await page.fill('form[data-sale] input[data-linea]', '1');
    await page.click('form[data-sale] button[type=submit]'); // el cambio no pide clave
    await page.waitForSelector('#cuerpo tr.fila-cambio');
    // cambio por un artículo más barato: queda saldo a favor y el dinero solo sale con clave
    await page.fill('#scan', '7501234567890'); await page.press('#scan', 'Enter');
    await page.waitForSelector('#saldo-favor-monto');
    assert.equal(await page.textContent('#saldo-favor-monto'), '$779.00');
    await vendioClientas(page);
    await page.click('#btn-devolver-dinero');
    await page.waitForSelector('#dlg-devolver-dinero[open]');
    await page.fill('#dd-clave', '0000');
    await page.click('#form-devolver-dinero button[type=submit]');
    await page.waitForFunction(() => /no es correcta/.test(document.querySelector('#msg-dd')!.textContent!));
    assert.equal(await page.inputValue('#dd-quien'), 'Lupe', 'por omisión autoriza la misma Vendedora-Cajera');
    await page.fill('#dd-clave', '4321'); // la misma cajera con su propia clave
    await page.click('#form-devolver-dinero button[type=submit]');
    await page.waitForSelector('#dlg-ticket[open] #resumen-devolucion');
    assert.match((await page.textContent('#resumen-devolucion'))!, /efectivo entregado \$779\.00.*autorizada por Lupe/);
    assert.match((await page.textContent('#ticket-texto'))!, /Devolución de efectivo autorizada por Lupe/);
    // otra Vendedora-Cajera también puede autorizar
    await page.click('#btn-nueva');
    await page.click('#nav button[data-vista="ventas"]');
    const folio2 = await vender();
    await page.click('#nav button[data-vista="ventas"]');
    await page.click(`#tabla-ventas tr[data-folio="${folio2}"] [data-cambio]`);
    await page.waitForSelector('form[data-sale] input[data-linea]');
    await page.fill('form[data-sale] input[data-linea]', '1');
    await page.click('form[data-sale] button[type=submit]');
    await page.waitForSelector('#btn-devolver-dinero');
    await page.click('#btn-devolver-dinero');
    await page.selectOption('#dd-quien', 'Rosa'); await page.fill('#dd-clave', '8765');
    await page.click('#form-devolver-dinero button[type=submit]');
    await page.waitForSelector('#dlg-ticket[open] #resumen-devolucion');
    assert.match((await page.textContent('#resumen-devolucion'))!, /autorizada por Rosa/);
    assert.deepEqual(errores.filter((e) => !/401|403|Failed to load resource/.test(e)), []);
  });

  it('B21 editar en esta venta (precio con clave de supervisor) y cancelar la venta (solo confirmación, sin clave)', async (t) => {
    execFileSync(process.execPath, [join(RAIZ, 'scripts', 'construir-prueba.mjs')], { stdio: 'pipe' });
    const browser = await chromium.launch({ executablePath: chromiumPath, args: ['--no-sandbox'] });
    t.after(() => browser.close());
    const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: 'light' })).newPage();
    const errores: string[] = [];
    page.on('pageerror', (e) => errores.push(String(e)));
    page.on('console', (m) => { if (m.type() === 'error') errores.push(m.text()); });
    await page.goto(`file://${HTML}`);
    await page.waitForSelector('[data-chip="tienda"]');
    await page.selectOption('#sesion-prueba', 'admin');
    await page.click('#nav button[data-vista="configuracion"]');
    await page.click('#cfg-tab-cajeros');
    await page.waitForSelector('#form-admin');
    await page.fill('#adm-nombre', 'Edgardo'); await page.fill('#adm-clave', 'clave-segura'); await page.fill('#adm-clave-caja', '2468');
    await perfilMin(page, 'adm'); await page.click('#btn-adm');
    await page.waitForFunction(() => document.querySelectorAll('#tabla-admins tr[data-admin]').length === 1);
    await page.fill('#caj-nombre', 'Lupe'); await page.fill('#caj-clave', '4321'); await perfilMin(page, 'caj'); await page.click('#btn-caj');
    await page.waitForFunction(() => document.querySelectorAll('#tabla-cajeros tr[data-cajero]').length === 1);
    await page.selectOption('#sesion-prueba', 'DUO/1');
    await page.waitForSelector('#form-login');
    await page.selectOption('#lg-usuario', 'Lupe'); await page.fill('#lg-clave', '4321'); await page.click('#lg-entrar');
    await page.waitForSelector('#scan');
    assert.equal(await page.locator('#btn-editar-catalogo').count(), 0, 'ya no existe «Editar catálogo»');
    await page.fill('#scan', '0002026090782'); await page.press('#scan', 'Enter');
    await page.waitForSelector('#cuerpo tr');
    await page.click('#cuerpo tr');
    // editar la descripción: sin clave
    await page.click('#btn-editar-venta');
    await page.waitForSelector('#dlg-editar-linea[open]');
    assert.equal(await page.locator('#el-clave-bloque').isHidden(), true, 'la clave solo aparece al cambiar el precio');
    await page.fill('#el-desc', 'CAMISA CON DEFECTO');
    await page.click('#form-editar-linea button[type=submit]');
    await page.waitForFunction(() => /CAMISA CON DEFECTO/.test(document.querySelector('#cuerpo')!.textContent!));
    // cambiar el precio: pide la clave de un supervisor
    await page.click('#cuerpo tr');
    await page.click('#btn-editar-venta');
    await page.waitForSelector('#dlg-editar-linea[open]');
    await page.fill('#el-precio', '50');
    await page.waitForSelector('#el-clave', { state: 'visible' });
    await page.fill('#el-clave', '4321'); // la de una Vendedora-Cajera no autoriza
    await page.click('#form-editar-linea button[type=submit]');
    await page.waitForFunction(() => /clave/i.test(document.querySelector("#msg-el")!.textContent!));
    await page.fill('#el-clave', '2468');
    await page.click('#form-editar-linea button[type=submit]');
    await page.waitForFunction(() => /\$50\.00/.test(document.querySelector('#total')!.textContent!));
    assert.match((await page.textContent('#cuerpo'))!, /\(editado\)/);
    // cancelar la venta: solo confirmación
    await page.click('#btn-cancelar-venta');
    await page.waitForSelector('#dlg-cancelar-venta[open]');
    assert.equal(await page.locator('#dlg-cancelar-venta input').count(), 0, 'no pide clave ni nada');
    await page.click('#cv-no');
    assert.equal(await page.locator('#cuerpo tr').count(), 1, '«No» conserva la venta');
    await page.click('#btn-cancelar-venta');
    await page.click('#cv-si');
    await page.waitForFunction(() => document.querySelectorAll('#cuerpo tr[data-linea], #cuerpo tr[data-id]').length === 0 && /\$0\.00/.test(document.querySelector('#total')!.textContent!));
    assert.deepEqual(errores.filter((e) => !/401|403|Failed to load resource/.test(e)), []);
  });

  it('B22 cambio por un artículo más caro: la pieza queda en negativo, el crédito se descuenta y se cobra solo la diferencia', async (t) => {
    execFileSync(process.execPath, [join(RAIZ, 'scripts', 'construir-prueba.mjs')], { stdio: 'pipe' });
    const browser = await chromium.launch({ executablePath: chromiumPath, args: ['--no-sandbox'] });
    t.after(() => browser.close());
    const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: 'light' })).newPage();
    const errores: string[] = [];
    page.on('pageerror', (e) => errores.push(String(e)));
    page.on('console', (m) => { if (m.type() === 'error') errores.push(m.text()); });
    await page.goto(`file://${HTML}`);
    await page.waitForSelector('[data-chip="tienda"]');
    await page.selectOption('#sesion-prueba', 'DUO/1');
    await page.waitForSelector('#scan');
    assert.equal((await page.textContent('#btn-devolucion'))!.trim(), 'Hacer Cambio');
    assert.equal(await page.locator('#btn-editar-catalogo').count(), 0);
    // venta original: mascada $120
    await page.fill('#scan', '7501234567890'); await page.press('#scan', 'Enter');
    await page.waitForSelector('#cuerpo tr[data-linea]');
    await page.fill('#recibido', '120'); await page.click('#btn-cobrar');
    await page.waitForSelector('#dlg-ticket[open]');
    await page.click('#btn-nueva');
    // hacer cambio: la mascada regresa y se lleva una bolsa de $450
    await page.click('#btn-devolucion');
    await page.fill('#bv-folio', '1');
    await page.click('#form-buscar-venta button[type="submit"]');
    await page.waitForSelector('[data-venta-propia] input[data-linea]');
    await page.fill('[data-venta-propia] input[data-linea]', '1');
    await page.click('[data-venta-propia] button[type="submit"]');
    await page.waitForSelector('#cuerpo tr.fila-cambio');
    await page.fill('#scan', '0000000000017'); await page.press('#scan', 'Enter');
    await page.waitForFunction(() => document.querySelector('#total')!.textContent === '$330.00');
    assert.equal(await page.textContent('#dd-cambio'), '-$120.00');
    assert.equal(await page.locator('#saldo-favor').isHidden(), true);
    await page.fill('#recibido', '400');
    await page.click('#btn-cobrar');
    await page.waitForSelector('#dlg-ticket[open] #ticket-texto');
    const tk = (await page.textContent('#ticket-texto'))!;
    assert.match(tk, /BOLSA/);
    assert.match(tk, /Crédito por cambio \(folio 000001\)/);
    assert.match(await page.textContent('#dlg-cambio') ?? '', /\$70\.00/);
    assert.deepEqual(errores.filter((e) => !/401|403|Failed to load resource/.test(e)), []);
  });

  it('B23 registro de empleadas con alias, datos y foto (cámara o archivo); «Vendió por» en la venta; reporte por vendedora', async (t) => {
    execFileSync(process.execPath, [join(RAIZ, 'scripts', 'construir-prueba.mjs')], { stdio: 'pipe' });
    const browser = await chromium.launch({ executablePath: chromiumPath, args: ['--no-sandbox', '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] });
    t.after(() => browser.close());
    const ctxNav = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: 'light', permissions: ['camera'] });
    const page = await ctxNav.newPage();
    const errores: string[] = [];
    page.on('pageerror', (e) => errores.push(String(e)));
    page.on('console', (m) => { if (m.type() === 'error') errores.push(m.text()); });
    await page.goto(`file://${HTML}`);
    await page.waitForSelector('[data-chip="tienda"]');
    await page.selectOption('#sesion-prueba', 'admin');
    await page.click('#nav button[data-vista="configuracion"]');
    await page.click('#cfg-tab-cajeros');
    await page.waitForSelector('#form-admin');
    // sin nombres y apellidos no se registra
    await page.fill('#adm-nombre', 'Edgardo'); await page.fill('#adm-clave', 'clave-segura'); await page.fill('#adm-clave-caja', '2468');
    await page.click('#btn-adm');
    await page.waitForFunction(() => /nombres y los apellidos/.test(document.querySelector('#msg-admins')!.textContent!));
    // foto con la cámara (falsa en la prueba)
    await page.fill('#adm-nombres', 'Edgardo'); await page.fill('#adm-apellidos', 'Morales Ruiz'); await page.fill('#adm-telefono', '662 123 4567'); await page.fill('#adm-direccion', 'Blvd. Kino 100');
    await page.click('#adm-foto-btn');
    await page.waitForSelector('#dlg-foto[open]');
    await page.waitForSelector('#foto-capturar:not([disabled])', { timeout: 15000 });
    await page.click('#foto-capturar');
    await page.waitForSelector('#foto-usar:not([hidden])');
    await page.click('#foto-usar');
    await page.waitForSelector('#adm-foto');
    assert.match((await page.getAttribute('#adm-foto', 'src'))!, /^data:image\/jpeg;base64,/);
    await page.click('#btn-adm');
    await page.waitForFunction(() => document.querySelectorAll('#tabla-admins tr[data-admin]').length === 1);
    // cajera con foto de archivo
    await page.fill('#caj-nombre', 'Lupe'); await page.fill('#caj-clave', '4321');
    await page.fill('#caj-nombres', 'Guadalupe'); await page.fill('#caj-apellidos', 'Pérez López'); await page.fill('#caj-telefono', '6621234567'); await page.fill('#caj-direccion', 'Calle 5 #123');
    await page.click('#caj-foto-btn');
    await page.waitForSelector('#dlg-foto[open]');
    await page.setInputFiles('#foto-archivo', { name: 'f.png', mimeType: 'image/png', buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAQAAAAECAIAAAAmkwkpAAAAEElEQVR4nGM4YWQERwzEcQDxIxLBm7UkwAAAAABJRU5ErkJggg==', 'base64') });
    await page.waitForSelector('#foto-usar:not([hidden])');
    await page.click('#foto-usar');
    await page.waitForSelector('#caj-foto');
    await page.click('#btn-caj');
    await page.waitForFunction(() => document.querySelectorAll('#tabla-cajeros tr[data-cajero]').length === 1);
    const fila = page.locator('#tabla-cajeros tr[data-cajero]');
    assert.equal(await fila.locator('b[data-alias]').textContent(), 'Lupe');
    assert.equal(await fila.locator('[data-nombre-completo]').textContent(), 'Guadalupe Pérez López');
    assert.match((await fila.locator('img').getAttribute('src'))!, /^data:image\/jpeg;base64,/, 'la foto del archivo se recortó a JPEG');
    // editar datos
    await page.click('#tabla-cajeros .c-editar');
    await page.waitForSelector('#dlg-empleado[open]');
    assert.equal(await page.inputValue('#ed-alias'), 'Lupe');
    assert.equal(await page.inputValue('#ed-direccion'), 'Calle 5 #123');
    await page.fill('#ed-telefono', '6629998888');
    await page.click('#emp-guardar');
    await page.waitForFunction(() => /6629998888/.test(document.querySelector('#tabla-cajeros tr[data-cajero]')!.textContent!));
    // la caja: entra con su alias y debe elegir quién vendió
    await page.selectOption('#sesion-prueba', 'DUO/1');
    await page.waitForSelector('#form-login');
    assert.equal(await page.textContent('label[for="lg-usuario"]'), 'Usuario');
    await page.selectOption('#lg-usuario', 'Lupe'); await page.fill('#lg-clave', '4321'); await page.click('#lg-entrar');
    await page.waitForSelector('#scan');
    await page.fill('#scan', '0002026090782'); await page.press('#scan', 'Enter');
    await page.waitForSelector('#cuerpo tr[data-linea]');
    await page.fill('#recibido', '899');
    assert.equal(await page.inputValue('#vendio-por'), 'autocompra', 'por omisión la venta es Autocompra');
    assert.deepEqual(await page.$$eval('#vendio-por option', (o) => o.map((x) => x.textContent)), ['Autocompra', 'Edgardo (supervisor)', 'Lupe']);
    await page.waitForFunction(() => !(document.querySelector('#btn-cobrar') as HTMLButtonElement).disabled);
    await page.selectOption('#vendio-por', { label: 'Lupe' });
    await page.waitForFunction(() => !(document.querySelector('#btn-cobrar') as HTMLButtonElement).disabled);
    await page.click('#btn-cobrar');
    await page.waitForSelector('#dlg-ticket[open] #ticket-texto');
    assert.match((await page.textContent('#ticket-texto'))!, /Vendedora-Cajera: Lupe\nVendió: Lupe/);
    await page.click('#btn-nueva');
    // otra venta sin ayuda: queda Autocompra sin tocar el selector
    await page.fill('#scan', '7501234567890'); await page.press('#scan', 'Enter');
    await page.waitForSelector('#cuerpo tr[data-linea]');
    assert.equal(await page.inputValue('#vendio-por'), 'autocompra');
    await page.fill('#recibido', '120');
    await page.waitForFunction(() => !(document.querySelector('#btn-cobrar') as HTMLButtonElement).disabled);
    await page.click('#btn-cobrar');
    await page.waitForSelector('#dlg-ticket[open] #ticket-texto');
    assert.doesNotMatch((await page.textContent('#ticket-texto'))!, /Vendió:/);
    await page.click('#btn-nueva');
    await page.click('#nav button[data-vista="ventas"]');
    await page.waitForSelector('#tabla-ventas tr[data-folio="2"]');
    assert.deepEqual(await page.$$eval('#tabla-ventas tr[data-col="x"], #tabla-ventas td[data-col="vendio"]', (c) => c.map((x) => x.textContent)), ['Lupe', 'Autocompra']);
    // reporte por vendedora (Administración)
    await page.selectOption('#sesion-prueba', 'admin');
    await page.click('#nav button[data-vista="reportes"]');
    await page.waitForSelector('#filtros');
    await page.click('#filtros button[type="submit"]');
    await page.waitForSelector('#tabla-vendedoras tr[data-vendedora]');
    const filas = await page.$$eval('#tabla-vendedoras tr[data-vendedora]', (r) => r.map((x) => [...x.querySelectorAll('td')].map((c) => c.textContent!.replace(/\s+/g, ' ').trim())));
    assert.deepEqual(filas.map((f) => [f[0], f[1], f[3], f[5]]), [['LupeGuadalupe Pérez López', '1', '$899.00', '$899.00'], ['Autocompra', '1', '$120.00', '$120.00']]);
    assert.deepEqual(errores.filter((e) => !/401|403|Failed to load resource/.test(e)), []);
  });

  it('B24 pantalla de folios (P-06): un ticket con folio mayor bloquea la caja, la pantalla informa y sugiere y la caja continúa con confirmación', async (t) => {
    execFileSync(process.execPath, [join(RAIZ, 'scripts', 'construir-prueba.mjs')], { stdio: 'pipe' });
    const browser = await chromium.launch({ executablePath: chromiumPath, args: ['--no-sandbox'] });
    t.after(() => browser.close());
    const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: 'light' })).newPage();
    const errores: string[] = [];
    page.on('pageerror', (e) => errores.push(String(e)));
    page.on('console', (m) => { if (m.type() === 'error') errores.push(m.text()); });
    await page.goto(`file://${HTML}`);
    await page.waitForSelector('[data-chip="tienda"]');
    await page.waitForSelector('#scan');
    for (let i = 0; i < 2; i++) { // dos ventas normales: folios 1 y 2
      await page.fill('#scan', '7501234567890'); await page.press('#scan', 'Enter');
      await page.waitForSelector('#cuerpo tr[data-linea]');
      await page.fill('#recibido', '120'); await page.click('#btn-cobrar');
      await page.waitForSelector('#dlg-ticket[open] #ticket-texto');
      await page.click('#btn-nueva');
    }
    // se escanea un ticket de esta caja con el folio 5: la serie se bloquea
    await page.evaluate(() => (window as any).__POS_TICKET_ESCANEADO__(5));
    await page.waitForSelector('#folios-bloqueo');
    assert.match((await page.textContent('[data-alerta="folios"]'))!, /no puede vender/);
    assert.match((await page.textContent('#folios-bloqueo .mensaje'))!, /folio mayor/);
    assert.equal((await page.textContent('#folio-ultimo'))!.trim(), '000002');
    assert.equal((await page.textContent('#folio-visto'))!.trim(), '000005');
    assert.equal((await page.textContent('#folio-sugerido'))!.trim(), '000006');
    assert.equal(await page.inputValue('#fo-siguiente'), '6');
    assert.equal(await page.locator('#folios-auto').count(), 0, 'sin P-06 aceptada no hay recuperación automática');
    await page.screenshot({ path: join(RAIZ, 'docs', 'capturas', '56-revisar-folios.png') });
    // exige evidencia y un folio que no reutilice ninguno
    await page.click('#fo-confirmar');
    await page.waitForFunction(() => /evidencia/.test(document.querySelector('#msg-folios')!.textContent!));
    await page.fill('#fo-ref', 'último ticket impreso D1-000005');
    await page.fill('#fo-siguiente', '5');
    await page.click('#fo-confirmar');
    await page.waitForFunction(() => /no supera/.test(document.querySelector('#msg-folios')!.textContent!));
    await page.fill('#fo-siguiente', '6');
    await page.click('#fo-confirmar');
    await page.waitForSelector('#scan');
    assert.match((await page.textContent('#mensaje'))!, /continúa desde el 000006/);
    assert.equal(await page.locator('[data-alerta="folios"]').count(), 0);
    await page.fill('#scan', '7501234567890'); await page.press('#scan', 'Enter');
    await page.waitForSelector('#cuerpo tr[data-linea]');
    await page.fill('#recibido', '120'); await page.click('#btn-cobrar');
    await page.waitForSelector('#dlg-ticket[open] #ticket-texto');
    assert.match((await page.textContent('#resumen-venta'))!, /Folio 000006/);
    await page.click('#btn-nueva');
    // la pantalla en orden informa los folios sin comprobar
    await page.evaluate(() => (document.querySelector('#nav button[data-vista="venta"]') as HTMLElement).click());
    assert.deepEqual(errores.filter((e) => !/401|403|Failed to load resource/.test(e)), []);
  });

  it('B25 calculadora: ventana flotante y movible desde el menú lateral que sigue abierta mientras se vende y se cierra con su X', async (t) => {
    execFileSync(process.execPath, [join(RAIZ, 'scripts', 'construir-prueba.mjs')], { stdio: 'pipe' });
    const browser = await chromium.launch({ executablePath: chromiumPath, args: ['--no-sandbox'] });
    t.after(() => browser.close());
    const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: 'light' })).newPage();
    const errores: string[] = [];
    page.on('pageerror', (e) => errores.push(String(e)));
    page.on('console', (m) => { if (m.type() === 'error') errores.push(m.text()); });
    await page.goto(`file://${HTML}`);
    await page.waitForSelector('#scan');
    assert.equal(await page.locator('#calculadora').count(), 0);
    await page.click('#btn-calculadora');
    await page.waitForSelector('#calculadora');
    const tecla = async (...ks: string[]) => { for (const k of ks) await page.click(`#calculadora [data-calc="${k}"]`); };
    await tecla('1', '2', '*', '3', '+', '4', '=');
    assert.equal(await page.textContent('#calc-pantalla'), '40');
    await tecla('C', '1', '0', '/', '4', '=');
    assert.equal(await page.textContent('#calc-pantalla'), '2.5');
    await tecla('C', '2', '0', '0', '+', '1', '5', '%', '=');
    assert.equal(await page.textContent('#calc-pantalla'), '230', 'el % de un sumando es sobre el primer número');
    await tecla('C', '1', '/', '0', '=');
    assert.equal(await page.textContent('#calc-pantalla'), 'Error');
    await tecla('C', '1', '2', '3', '4', '5', '6');
    assert.equal(await page.textContent('#calc-pantalla'), '123,456');
    await tecla('Backspace', 'neg');
    assert.equal(await page.textContent('#calc-pantalla'), '-12,345');
    // teclado: con el foco en la calculadora (al abrirla, o tocando su barra o visor) se teclea igual que con el mouse
    await page.click('#calc-visor');
    assert.equal(await page.evaluate(() => document.activeElement?.id), 'calculadora');
    assert.match((await page.textContent('#calc-ayuda'))!, /Teclado activo/);
    await page.keyboard.press('Escape');
    await page.keyboard.type('12*3+4');
    await page.keyboard.press('Enter');
    assert.equal(await page.textContent('#calc-pantalla'), '40');
    await page.keyboard.type('10,5');
    await page.keyboard.press('Backspace');
    assert.equal(await page.textContent('#calc-pantalla'), '10.');
    await page.keyboard.press('Delete');
    await page.keyboard.type('9/4=');
    assert.equal(await page.textContent('#calc-pantalla'), '2.25');
    await page.keyboard.press('Escape');
    await page.keyboard.type('5');
    assert.equal(await page.textContent('#calc-pantalla'), '5');
    // fuera de la calculadora el teclado es del POS: no la toca
    await page.click('#scan');
    await page.keyboard.type('77');
    assert.equal(await page.inputValue('#scan'), '77');
    assert.equal(await page.textContent('#calc-pantalla'), '5');
    assert.match((await page.textContent('#calc-ayuda'))!, /Toque la barra/);
    await page.fill('#scan', '');
    await page.click('#calc-visor');
    await page.keyboard.press('Escape');
    await tecla('1', '2', '3', '4', '5', '6', 'Backspace', 'neg'); // deja -12,345 para lo que sigue
    // se mueve arrastrando la barra y no se sale de la ventana
    const antes = (await page.locator('#calculadora').boundingBox())!;
    await page.mouse.move(antes.x + 60, antes.y + 15);
    await page.mouse.down(); await page.mouse.move(antes.x - 300, antes.y + 200, { steps: 5 }); await page.mouse.up();
    const despues = (await page.locator('#calculadora').boundingBox())!;
    assert.ok(Math.abs(despues.x - (antes.x - 360)) < 4 && Math.abs(despues.y - (antes.y + 185)) < 4, 'se movió con el mouse');
    await page.mouse.move(despues.x + 60, despues.y + 15); await page.mouse.down(); await page.mouse.move(-500, -500, { steps: 3 }); await page.mouse.up();
    const borde = (await page.locator('#calculadora').boundingBox())!;
    assert.ok(borde.x >= 0 && borde.y >= 0, 'queda dentro de la ventana');
    await page.mouse.move(borde.x + 60, borde.y + 15); await page.mouse.down(); await page.mouse.move(1150, 250, { steps: 4 }); await page.mouse.up(); // se deja a un lado, sin tapar el menú
    // con la calculadora abierta todo el POS sigue funcionando: se escribe en la búsqueda, se vende y se cambia de pantalla
    await page.click('#scan');
    await tecla('7');
    assert.equal(await page.inputValue('#scan'), '', 'las teclas de la calculadora no escriben en la búsqueda');
    assert.equal(await page.evaluate(() => document.activeElement?.id), 'scan', 'la calculadora no roba el foco');
    await page.fill('#scan', '7501234567890'); await page.press('#scan', 'Enter');
    await page.waitForSelector('#cuerpo tr[data-linea]');
    await page.fill('#recibido', '120'); await page.click('#btn-cobrar');
    await page.waitForSelector('#dlg-ticket[open] #ticket-texto');
    await page.click('#btn-nueva');
    await page.click('#nav button[data-vista="ventas"]');
    await page.waitForSelector('#tabla-ventas');
    await page.click('#nav button[data-vista="venta"]');
    await page.waitForSelector('#scan');
    assert.equal(await page.locator('#calculadora').count(), 1, 'sigue abierta al cambiar de pantalla');
    assert.equal(await page.textContent('#calc-pantalla'), '-123,457', 'conserva lo que tenía (incluida la tecla 7 de la prueba)');
    assert.equal(await page.getAttribute('#btn-calculadora', 'aria-pressed'), 'true');
    // se cierra con la X (y el botón del menú la vuelve a abrir)
    await page.click('#calc-cerrar');
    assert.equal(await page.locator('#calculadora').count(), 0);
    await page.click('#btn-calculadora');
    await page.waitForSelector('#calculadora');
    await page.click('#btn-calculadora');
    assert.equal(await page.locator('#calculadora').count(), 0);
    assert.deepEqual(errores.filter((e) => !/401|403|Failed to load resource/.test(e)), []);
  });

  it('B26 respaldo cifrado: se pide clave, se guarda en la carpeta elegida (o se descarga), no es legible y se restaura con la clave correcta', async (t) => {
    execFileSync(process.execPath, [join(RAIZ, 'scripts', 'construir-prueba.mjs')], { stdio: 'pipe' });
    const browser = await chromium.launch({ executablePath: chromiumPath, args: ['--no-sandbox'] });
    t.after(() => browser.close());
    const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: 'light', acceptDownloads: true })).newPage();
    const errores: string[] = [];
    page.on('pageerror', (e) => errores.push(String(e)));
    page.on('console', (m) => { if (m.type() === 'error') errores.push(m.text()); });
    // carpeta de OneDrive simulada en memoria (en el equipo real es la carpeta que elige la persona)
    await page.addInitScript(() => {
      const archivos = new Map<string, Uint8Array>();
      (window as any).__ARCHIVOS__ = archivos;
      class Carpeta {
        name = 'Respaldos POS (OneDrive)'; kind = 'directory';
        async queryPermission() { return 'granted'; }
        async requestPermission() { return 'granted'; }
        async getFileHandle(n: string) { return { kind: 'file', name: n, createWritable: async () => ({ write: async (b: Uint8Array) => { archivos.set(n, new Uint8Array(b)); }, close: async () => {} }) }; }
        async removeEntry(n: string) { archivos.delete(n); }
        values() { const it = [...archivos.keys()].map((name) => ({ kind: 'file', name })); let i = 0; return { next: async () => (i < it.length ? { done: false, value: it[i++] } : { done: true }) }; }
      }
      (window as any).showDirectoryPicker = async () => new Carpeta();
    });
    await page.goto(`file://${HTML}`);
    await page.waitForSelector('#scan');
    // una venta para que haya algo que respaldar
    await page.fill('#scan', '7501234567890'); await page.press('#scan', 'Enter');
    await page.waitForSelector('#cuerpo tr[data-linea]');
    await page.fill('#recibido', '120'); await page.click('#btn-cobrar');
    await page.waitForSelector('#dlg-ticket[open] #ticket-texto');
    await page.click('#btn-nueva');
    assert.match((await page.textContent('#estado-respaldo'))!, /SIN clave|Sin carpeta/);
    // sin clave: se pide (mínimo 8 caracteres, dos veces); sin carpeta el respaldo se descarga
    await page.click('#resp-ahora');
    await page.waitForSelector('#dlg-respaldo[open] #form-resp');
    await page.fill('#resp-k1', 'corta'); await page.fill('#resp-k2', 'corta');
    await page.click('#form-resp button[type=submit]');
    await page.waitForFunction(() => /al menos 8/.test(document.querySelector('#msg-resp')!.textContent!));
    await page.fill('#resp-k1', 'clave-respaldo-1'); await page.fill('#resp-k2', 'otra-distinta-1');
    await page.click('#form-resp button[type=submit]');
    await page.waitForFunction(() => /no coinciden/.test(document.querySelector('#msg-resp')!.textContent!));
    await page.fill('#resp-k2', 'clave-respaldo-1');
    await page.click('#form-resp button[type=submit]');
    await page.waitForFunction(() => /clave guardada/.test(document.querySelector('#estado-respaldo')!.textContent!));
    const [descarga] = await Promise.all([page.waitForEvent('download'), page.click('#resp-ahora')]);
    assert.match(descarga.suggestedFilename(), /^respaldo-pos-\d{4}-\d{2}-\d{2}-\d{4}\.posbak$/);
    const ruta = await descarga.path();
    const bytes = readFileSync(ruta!);
    assert.equal(bytes.subarray(0, 7).toString('latin1'), 'POSBAK1');
    assert.doesNotMatch(bytes.toString('latin1'), /sale\.confirmed|7501234567890|MASCADA/, 'el archivo no es legible sin la clave');
    await page.waitForFunction(() => /último respaldo: hoy/.test(document.querySelector('#estado-respaldo')!.textContent!));
    // con carpeta elegida el respaldo se escribe ahí
    await page.click('#resp-carpeta');
    await page.waitForFunction(() => /Carpeta: Respaldos POS \(OneDrive\)/.test(document.querySelector('#estado-respaldo')!.textContent!));
    await page.click('#resp-ahora');
    await page.waitForFunction(() => (window as any).__ARCHIVOS__.size === 1);
    assert.match(await page.evaluate(() => [...(window as any).__ARCHIVOS__.keys()][0]), /^respaldo-pos-.*\.posbak$/);
    // se pierden los datos y se restaura: primero con la clave equivocada, luego con la buena
    await page.click('#reiniciar');
    await page.waitForSelector('#scan');
    await page.click('#nav button[data-vista="ventas"]');
    await page.waitForSelector('#tabla-ventas');
    assert.equal(await page.locator('#tabla-ventas tr[data-folio]').count(), 0, 'tras reiniciar no hay ventas');
    await page.setInputFiles('#resp-archivo', { name: 'respaldo.posbak', mimeType: 'application/octet-stream', buffer: bytes });
    await page.waitForSelector('#dlg-respaldo[open] #form-resp');
    await page.fill('#resp-k1', 'clave-equivocada-9');
    await page.click('#form-resp button[type=submit]');
    await page.waitForFunction(() => /No se pudo restaurar: la clave no es correcta/.test(document.querySelector('#estado-respaldo')!.textContent!));
    await page.setInputFiles('#resp-archivo', { name: 'respaldo.posbak', mimeType: 'application/octet-stream', buffer: bytes });
    await page.waitForSelector('#dlg-respaldo[open] #form-resp');
    await page.fill('#resp-k1', 'clave-respaldo-1');
    await page.click('#form-resp button[type=submit]');
    await page.waitForSelector('#resp-detalle');
    assert.match((await page.textContent('#resp-detalle'))!, /Respaldo del hoy/);
    await Promise.all([page.waitForEvent('load'), page.click('#resp-si')]);
    await page.waitForSelector('#scan');
    await page.click('#nav button[data-vista="ventas"]');
    await page.waitForSelector('#tabla-ventas tr[data-folio="1"]');
    assert.match((await page.textContent('#tabla-ventas tr[data-folio="1"]'))!, /000001.*\$120\.00/);
    assert.deepEqual(errores.filter((e) => !/401|403|Failed to load resource/.test(e)), []);
  });

  it('B27 abrir caja: botón en la venta que abre el cajón sin vender y se ve en el corte', async (t) => {
    execFileSync(process.execPath, [join(RAIZ, 'scripts', 'construir-prueba.mjs')], { stdio: 'pipe' });
    const browser = await chromium.launch({ executablePath: chromiumPath, args: ['--no-sandbox'] });
    t.after(() => browser.close());
    const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: 'light' })).newPage();
    const errores: string[] = [];
    page.on('pageerror', (e) => errores.push(String(e)));
    page.on('console', (m) => { if (m.type() === 'error') errores.push(m.text()); });
    await page.goto(`file://${HTML}`);
    await page.waitForSelector('#scan');
    assert.equal((await page.textContent('#btn-abrir-caja'))!.trim(), 'Abrir caja');
    await page.click('#btn-abrir-caja');
    await page.waitForFunction(() => /Caja abierta/.test(document.querySelector('#mensaje')!.textContent!));
    await page.check('#falla-imp');
    await page.click('#btn-abrir-caja');
    await page.waitForFunction(() => /no se pudo abrir la caja/.test(document.querySelector('#mensaje')!.textContent!));
    await page.click('#nav button[data-vista="corte"]');
    await page.waitForSelector('[data-campo="aperturas_cajon_sin_venta"], #tabla-corte');
    assert.match((await page.textContent('body'))!, /Aperturas del cajón sin venta[\s\S]{0,40}1/);
    assert.deepEqual(errores.filter((e) => !/401|403|Failed to load resource/.test(e)), []);
  });

  it('B28 recompensas: Administración crea la regla, el ticket muestra el cupón con QR y se canjea escaneando el código', async (t) => {
    execFileSync(process.execPath, [join(RAIZ, 'scripts', 'construir-prueba.mjs')], { stdio: 'pipe' });
    const browser = await chromium.launch({ executablePath: chromiumPath, args: ['--no-sandbox'] });
    t.after(() => browser.close());
    const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: 'light' })).newPage();
    const errores: string[] = [];
    page.on('pageerror', (e) => errores.push(String(e)));
    page.on('console', (m) => { if (m.type() === 'error') errores.push(m.text()); });
    await page.goto(`file://${HTML}`);
    await page.waitForSelector('#scan');
    await page.selectOption('#sesion-prueba', 'admin');
    await page.click('#nav button[data-vista="promociones"]');
    await page.click('#btn-recompensas');
    await page.waitForSelector('#dlg-recompensas[open]');
    await page.click('#rec-nueva');
    await page.fill('#rc-nombre', 'Gana $50 en tu próxima compra');
    await page.check('.rc-tienda[value="DUO"]');
    await page.fill('#rc-compra', '1000');
    await page.fill('#rc-valor', '50');
    await page.fill('#rc-minimo', '500');
    await page.fill('#rc-dias', '30');
    await page.click('#rc-guardar');
    await page.waitForSelector('#tabla-recompensas tr[data-rec]');
    assert.match((await page.textContent('#tabla-recompensas tr[data-rec]'))!, /Gana \$50.*\$1,000\.00.*\$50\.00 de descuento.*compra mínima \$500\.00.*30 días.*activa.*0 \/ 0/);
    await page.click('#rec-cerrar');
    // una compra de $1,798 (2 jeans) gana el cupón; una de $899 no
    await page.selectOption('#sesion-prueba', 'DUO/1');
    await page.waitForSelector('#scan');
    await page.fill('#scan', '0002026090782'); await page.press('#scan', 'Enter');
    await page.waitForSelector('#cuerpo tr[data-linea]');
    await page.fill('#recibido', '899'); await page.click('#btn-cobrar');
    await page.waitForSelector('#dlg-ticket[open] #ticket-texto');
    assert.equal(await page.locator('[data-cupon-ganado]').count(), 0, '$899 no alcanza');
    await page.click('#btn-nueva');
    await page.fill('#scan', '0002026090782'); await page.press('#scan', 'Enter');
    await page.waitForSelector('#cuerpo tr[data-linea]');
    await page.click('#cuerpo tr[data-linea] [data-accion="mas"]');
    await page.waitForFunction(() => document.querySelector('#total')!.textContent === '$1,798.00');
    await page.fill('#recibido', '1798'); await page.click('#btn-cobrar');
    await page.waitForSelector('#dlg-ticket[open] [data-cupon-ganado]');
    const codigo = (await page.getAttribute('[data-cupon-ganado]', 'data-cupon-ganado'))!;
    assert.match(codigo, /^RC-DUO1-\d{6}-1$/);
    assert.match((await page.textContent('#ticket-texto'))!, /¡TE GANASTE UN CUPÓN![\s\S]*\$50\.00 de descuento en tu próxima compra[\s\S]*Compra mínima: \$500\.00[\s\S]*Código: RC-DUO1/);
    const oscuros = await page.$eval('canvas[data-qr]', (c: any) => { const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; let n = 0; for (let i = 0; i < d.length; i += 4) if (d[i] < 60) n++; return n; });
    assert.ok(oscuros > 500, 'el QR se dibujó');
    await page.click('#btn-nueva');
    // se canjea escaneando el código (el lector escribe el texto y Enter)
    await page.fill('#scan', '0002026090782'); await page.press('#scan', 'Enter');
    await page.waitForSelector('#cuerpo tr[data-linea]');
    await page.fill('#scan', codigo); await page.press('#scan', 'Enter');
    await page.waitForFunction(() => /aplicado: -\$50\.00/.test(document.querySelector('#mensaje')!.textContent!));
    assert.equal(await page.textContent('#total'), '$849.00');
    assert.deepEqual(errores.filter((e) => !/401|403|Failed to load resource/.test(e)), []);
  });

  it('B20 cierre por inactividad: aviso un minuto antes, «Seguir trabajando» renueva, al cerrarse la venta queda en espera y se vuelve al inicio de sesión', async (t) => {
    execFileSync(process.execPath, [join(RAIZ, 'scripts', 'construir-prueba.mjs')], { stdio: 'pipe' });
    const browser = await chromium.launch({ executablePath: chromiumPath, args: ['--no-sandbox'] });
    t.after(() => browser.close());
    const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: 'light' })).newPage();
    const errores: string[] = [];
    page.on('pageerror', (e) => errores.push(String(e)));
    page.on('console', (m) => { if (m.type() === 'error') errores.push(m.text()); });
    await page.goto(`file://${HTML}`);
    await page.waitForSelector('[data-chip="tienda"]');
    // se puede configurar el tiempo (Administración abierta aún)
    await page.selectOption('#sesion-prueba', 'admin');
    await page.click('#nav button[data-vista="configuracion"]');
    await page.click('#cfg-tab-cajeros');
    await page.waitForSelector('#form-inactividad');
    assert.deepEqual([await page.inputValue('#ina-caja'), await page.inputValue('#ina-admin')], ['10', '15']);
    await page.fill('#ina-caja', '10'); await page.click('#btn-inactividad');
    await page.waitForFunction(() => /Guardado/.test(document.querySelector('#msg-inactividad')!.textContent!));
    await page.fill('#caj-nombre', 'Lupe'); await page.fill('#caj-clave', '4321'); await perfilMin(page, 'caj'); await page.click('#btn-caj');
    await page.waitForSelector('#tabla-cajeros tr[data-cajero]');
    await page.selectOption('#sesion-prueba', 'DUO/1');
    await page.waitForSelector('#form-login');
    await page.selectOption('#lg-usuario', 'Lupe'); await page.fill('#lg-clave', '4321'); await page.click('#lg-entrar');
    await page.waitForSelector('#scan');
    await page.fill('#scan', '0002026090782'); await page.press('#scan', 'Enter');
    await page.waitForSelector('#cuerpo tr[data-linea]');
    await page.waitForTimeout(5500); // el latido recoge la actividad y queda tranquilo
    // 9 min y medio sin tocar nada: aparece el aviso con la cuenta regresiva
    await page.evaluate(() => (window as any).__POS_AVANZAR__(9.5 * 60e3));
    await page.waitForSelector('#aviso-inactividad:not([hidden])', { timeout: 15000 });
    assert.match((await page.textContent('#aviso-inactividad'))!, /se cerrará en \d+ s/);
    await page.screenshot({ path: join(RAIZ, 'docs', 'capturas', '56-aviso-inactividad.png') });
    // «Seguir trabajando» renueva
    await page.click('#btn-seguir');
    await page.waitForSelector('#aviso-inactividad', { state: 'hidden' });
    await page.waitForTimeout(5500);
    // 11 minutos sin actividad: se cierra la sesión
    await page.evaluate(() => (window as any).__POS_AVANZAR__(11 * 60e3));
    await page.waitForSelector('#form-login', { timeout: 15000 });
    assert.equal(await page.locator('#aviso-inactividad:not([hidden])').count(), 0);
    // al volver a entrar, la venta con artículos está en «Venta en espera»
    await page.selectOption('#lg-usuario', 'Lupe'); await page.fill('#lg-clave', '4321'); await page.click('#lg-entrar');
    await page.waitForFunction(() => /Venta en espera \(1\)/.test(document.querySelector('#txt-espera')?.textContent ?? ''));
    await page.click('#btn-espera');
    assert.match((await page.textContent('#dlg-espera'))!, /Sesión de Lupe cerrada por inactividad/);
    assert.deepEqual(errores.filter((e) => !/401|403|Failed to load resource/.test(e)), []);
  });
});

const REAL = process.env.POS_INVENTARIO_REAL;
describe('[navegador real] Inventario real de DÚO en la página (solo con POS_INVENTARIO_REAL)', { timeout: 180_000, skip: REAL && existsSync(REAL) && chromiumPath ? false : 'defina POS_INVENTARIO_REAL' }, () => {
  it('BR1 21,220 artículos reales: se importa, se escanea, se busca y se vende', async (t) => {
    execFileSync(process.execPath, [join(RAIZ, 'scripts', 'construir-prueba.mjs')], { stdio: 'pipe' });
    const browser = await chromium.launch({ executablePath: chromiumPath, args: ['--no-sandbox'] });
    t.after(() => browser.close());
    const page = await (await browser.newContext({ viewport: { width: 1366, height: 900 }, colorScheme: 'light' })).newPage();
    const errores: string[] = [];
    page.on('pageerror', (e) => errores.push(String(e)));
    page.on('console', (m) => { if (m.type() === 'error') errores.push(m.text()); });
    await page.goto(`file://${HTML}`);
    await page.waitForSelector('[data-chip="tienda"]');
    let t0 = Date.now();
    await page.setInputFiles('#archivo-inventario', REAL!);
    await page.waitForSelector('#dlg-importar[open]', { timeout: 60000 });
    const msLeer = Date.now() - t0;
    assert.match((await page.textContent('#imp-resumen'))!, /21220 artículos · con código 20565 · sin código 655 · sin descripción 8810 · sin marca 0 · precio no vendible 187/);
    await page.screenshot({ path: join(RAIZ, 'dist', 'captura-inventario-real.png') });
    t0 = Date.now();
    await page.check('#imp-modo-prueba');
    await page.fill('#imp-duo', '10');
    await page.click('#imp-cargar');
    await page.waitForFunction(() => /Inventario cargado: .* 21220 artículos/.test(document.querySelector('#estado-inv')!.textContent!), null, { timeout: 120000 });
    const msCargar = Date.now() - t0;
    t0 = Date.now();
    await page.fill('#scan', '0021001403065'); await page.press('#scan', 'Enter');
    await page.waitForSelector('#cuerpo tr[data-linea]');
    const msEscaneo = Date.now() - t0;
    await page.fill('#scan', 'vestido'); await page.press('#scan', 'Enter');
    await page.waitForSelector('.tabla-resultados');
    assert.match((await page.textContent('#mensaje'))!, /resultados para «vestido»; se muestran los primeros 20/);
    await page.click('#btn-exacto');
    await page.click('#btn-cobrar');
    await page.waitForSelector('#dlg-ticket[open]');
    assert.match((await page.textContent('#resumen-venta'))!, /Folio 000001/);
    console.log(`  (inventario real en el navegador: leer ${msLeer} ms, cargar ${msCargar} ms, primer escaneo ${msEscaneo} ms)`);
    assert.ok(msEscaneo < 3000);
    assert.deepEqual(errores, []);
  });

  it('B-regalo en la página única: alta de tarjeta de regalo en DÚO, no vale en London (P-23), cobro en DÚO, Caja 2 sin tarjetas (P-25) y logos incrustados', async (t) => {
    execFileSync(process.execPath, [join(RAIZ, 'scripts', 'construir-prueba.mjs')], { stdio: 'pipe' });
    const browser = await chromium.launch({ executablePath: chromiumPath, args: ['--no-sandbox'] });
    t.after(() => browser.close());
    const page = await (await browser.newContext({ viewport: { width: 1366, height: 820 }, colorScheme: 'light' })).newPage();
    const errores: string[] = [];
    page.on('pageerror', (e) => errores.push(String(e)));
    page.on('console', (m) => { if (m.type() === 'error') errores.push(m.text()); });
    await page.goto(`file://${HTML}`);
    await page.waitForSelector('[data-logo="DUO"]');
    assert.equal(await page.evaluate(() => (document.querySelector('[data-logo]') as HTMLImageElement).naturalWidth > 50), true, 'logo de DÚO incrustado en la página');
    await page.click('#nav button[data-vista="tarjetas"]');
    await page.fill('#alta-codigo', 'BANCO-1');
    await page.fill('#alta-monto', '300');
    await page.click('#btn-alta');
    await page.waitForSelector('#dlg-ticket[open]');
    await page.click('#btn-cerrar');
    await page.selectOption('#sesion-prueba', 'LON/1'); // entrega lo pendiente (red simulada) y cambia de tienda
    await page.waitForSelector('[data-logo="LON"]');
    assert.equal(await page.evaluate(() => (document.querySelector('[data-logo]') as HTMLImageElement).naturalWidth > 50), true, 'logo de London incrustado');
    // P-23 (decidido): la tarjeta vale solo en la tienda que la emitió
    await page.click('#nav button[data-vista="tarjetas"]');
    await page.fill('#saldo-codigo', 'BANCO-1');
    await page.click('#btn-saldo');
    await page.waitForFunction(() => /no está dada de alta/.test(document.querySelector('#resultado-saldo')!.textContent!));
    await page.selectOption('#sesion-prueba', 'DUO/1');
    await page.waitForSelector('#scan');
    await page.fill('#scan', '7501234567890');
    await page.press('#scan', 'Enter');
    await page.waitForSelector('#cuerpo tr[data-linea]');
    await page.click('#formas button[data-forma="regalo"]');
    await page.fill('#codigo-regalo', 'BANCO-1');
    await page.press('#codigo-regalo', 'Enter');
    await page.waitForSelector('#regalo-aplicado');
    assert.equal(await page.textContent('#saldo-regalo'), '$300.00');
    await page.click('#btn-cobrar');
    await page.waitForSelector('#dlg-ticket[open]');
    assert.match((await page.textContent('#resumen-venta'))!, /saldo de la tarjeta \$180\.00/);
    // P-25 (decidido): la Caja 2 no maneja tarjetas de regalo ni tiene el menú
    await page.click('#btn-nueva');
    await page.selectOption('#sesion-prueba', 'DUO/2');
    await page.waitForSelector('#formas');
    assert.deepEqual(await page.$$eval('#formas button', (b) => b.map((x) => [x.textContent!.trim(), (x as HTMLButtonElement).disabled])), [['Efectivo', false], ['Tarjeta', true], ['Mixto', true], ['Tarjeta de regalo', true]]);
    assert.equal(await page.locator('#nav button[data-vista="tarjetas"]').count(), 0);
    assert.deepEqual(errores, []);
  });

  it('B-dolares en la página única: cobro con dólares, el lápiz propaga la tasa a otra tienda y Administración ve los dólares recibidos', async (t) => {
    execFileSync(process.execPath, [join(RAIZ, 'scripts', 'construir-prueba.mjs')], { stdio: 'pipe' });
    const browser = await chromium.launch({ executablePath: chromiumPath, args: ['--no-sandbox'] });
    t.after(() => browser.close());
    const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: 'light' })).newPage();
    const errores: string[] = [];
    page.on('pageerror', (e) => errores.push(String(e)));
    page.on('console', (m) => { if (m.type() === 'error') errores.push(m.text()); });
    await page.goto(`file://${HTML}`);
    await page.waitForSelector('[data-tc="tasa"]');
    assert.match((await page.textContent('[data-tc="tasa"]'))!, /Dólar: \$18\.00 MXN/);
    await page.fill('#scan', '0002026090782'); await page.press('#scan', 'Enter');
    await page.waitForSelector('#cuerpo tr[data-linea]');
    await page.click('#btn-usd');
    await page.fill('#usd', '50');
    await page.fill('#recibido', '0');
    assert.deepEqual([await page.textContent('#usd-equivalente'), await page.textContent('#lbl-cambio'), await page.textContent('#cambio')], ['$900.00', 'Cambio', '$1.00']);
    await page.click('#btn-cobrar');
    await page.waitForSelector('#dlg-ticket[open]');
    assert.match((await page.textContent('#ticket-texto'))!, /USD recibidos +US\$50\.00[\s\S]*Tasa 18\.00 MXN\/USD \(v1\)[\s\S]*Cambio MXN +\$1\.00/);
    await page.click('#btn-nueva');
    // el usuario de prueba de DÚO Caja 1 tiene permiso: cambia la tasa
    await page.click('#btn-editar-tc');
    await page.fill('#tc-valor', '19');
    await page.click('#tc-guardar');
    await page.waitForFunction(() => /\$19\.00 MXN/.test(document.querySelector('[data-tc="tasa"]')!.textContent!));
    await page.selectOption('#sesion-prueba', 'LON/2');
    await page.waitForFunction(() => /\$19\.00 MXN/.test(document.querySelector('[data-tc="tasa"]')?.textContent ?? ''));
    assert.equal(await page.locator('#btn-editar-tc').count(), 0, 'London Caja 2 no tiene permiso');
    await page.selectOption('#sesion-prueba', 'admin');
    await page.waitForSelector('#nav');
    await page.click('#nav button[data-vista="cortes"]');
    await page.click('#btn-ir-dolares');
    await page.fill('#usd-desde', new Date(Date.now() - 7 * 3600e3).toISOString().slice(0, 10));
    await page.click('#filtros-usd button[type="submit"]');
    await page.waitForSelector('#tabla-dolares tbody tr[data-folio]');
    assert.equal(await page.textContent('#total-usd'), 'US$50.00');
    assert.deepEqual(errores, []);
  });
});
