import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { chromium } from 'playwright-core';
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { leerXlsxNode } from '../src/xlsx-node.ts';
import { FILAS_REALISTAS, xlsxDeFilas } from './ayudas/inventario.ts';

const RAIZ = join(import.meta.dirname, '..');
const HTML = join(RAIZ, 'dist', 'pos-venta-prueba.html');
const chromiumPath = [process.env.POS_CHROMIUM, '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', '/opt/pw-browsers/chromium/chrome-linux/chrome'].find((p) => p && existsSync(p));

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
    assert.match((await page.textContent('#ticket-texto'))!, /Item #: 1001 +Código: 0002026090782/);
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
    await page.waitForSelector('#filtros');
    assert.deepEqual(await page.$$eval('#nav button', (b) => b.map((x) => x.textContent)), ['Reportes', 'Cortes', 'Dólares recibidos', 'Inventario', 'Almacén', 'Departamentos', 'Tarjetas de regalo', 'Tipo de cambio', 'Caja']);
    await page.click('#filtros button[type="submit"]');
    await page.waitForSelector('#tabla-reporte tbody tr');
    assert.equal(await page.locator('#tabla-reporte tbody tr').count(), 3, 'las 3 ventas, tras sincronizar');
    assert.deepEqual(await page.$$eval('#tabla-reporte tbody tr', (r) => r.map((x) => [...x.querySelectorAll('td')].slice(0, 3).map((c) => c.textContent).join(' '))), ['DUO 1 000001', 'DUO 1 000002', 'DUO 1 000003']);
    await page.screenshot({ path: join(RAIZ, 'docs', 'capturas', '08-banco-de-prueba-admin.png') });

    // reiniciar datos: vuelve a empezar
    await page.selectOption('#sesion-prueba', 'DUO/1');
    await page.waitForSelector('#scan');
    await page.click('#reiniciar');
    await page.waitForSelector('[data-chip="folio"]');
    assert.match((await page.textContent('[data-chip="folio"] b'))!, /folio al cobrar/);
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
    assert.match((await page.textContent('#imp-resumen'))!, /14 artículos · con código 12 · sin código 2 /);
    assert.equal(await page.locator('#imp-anomalias tr[data-tipo="item_no_duplicado"]').count(), 1);
    assert.match((await page.textContent('#imp-anomalias tr[data-tipo="precio_negativo"]'))!, /cupón/i);
    assert.deepEqual(await page.$$eval('#imp-previa tbody tr:first-child td', (c) => c.map((x) => x.textContent)), ['1', '0021001403065', 'BLUSA', 'blusa seksy', '', '', '$169.00']);
    await page.check('input[name="imp-perfil"][value="1"]');
    assert.deepEqual(await page.$$eval('#imp-previa tbody tr:first-child td', (c) => c.slice(2, 4).map((x) => x.textContent)), ['blusa seksy', 'BLUSA'], 'el perfil alternativo invierte Marca y Descripción');
    await page.check('input[name="imp-perfil"][value="0"]');
    await page.screenshot({ path: join(RAIZ, 'docs', 'capturas', '10-importar-inventario.png') });
    // departamentos: ZAPATOS ya no se vende; los nombres en inglés/escritos distinto se piden revisar y se puede elegir el destino
    assert.equal(await page.getAttribute('#imp-deptos tr[data-clave="zapatos"]', 'data-estado'), 'descontinuado');
    assert.equal(await page.inputValue('#imp-deptos tr[data-clave="zapatos"] select'), 'Sin clasificar');
    assert.equal(await page.inputValue('#imp-deptos tr[data-clave="system"] select'), 'Sin clasificar');
    assert.equal(await page.inputValue('#imp-deptos tr[data-clave="cupones"] select'), 'Tarjetas de regalo y cupones');
    await page.selectOption('#imp-deptos tr[data-clave="women s"] select', 'Dama');
    assert.equal(await page.isChecked('#imp-regla-env'), true);
    await page.fill('#imp-duo', '10');
    await page.click('#imp-cargar');
    await page.waitForFunction(() => /Inventario cargado: inventario_prueba\.xlsx · 14 artículos/.test(document.querySelector('#estado-inv')!.textContent!));
    assert.equal(await page.isVisible('#quitar-inv'), true);

    // vender un artículo importado
    await escanear('0021001403065');
    await page.waitForSelector('#cuerpo tr[data-linea]');
    const celdas = await page.$$eval('#cuerpo tr[data-linea]:nth-child(1) td[data-col]', (t) => Object.fromEntries(t.map((x) => [x.getAttribute('data-col'), x.textContent!.replace(/[−+]/g, '').replace(/×.*$/, '').trim()])));
    assert.deepEqual([celdas.item_no, celdas.codigo, celdas.marca, celdas.descripcion, celdas.precio], ['1', '0021001403065', 'BLUSA', 'blusa seksy', '$169.00']);
    await escanear('0121020030001'); // cupón con precio negativo
    await page.waitForFunction(() => /precio/i.test(document.querySelector('#mensaje')!.textContent!));
    assert.equal(await page.locator('#cuerpo tr[data-linea]').count(), 1, 'el cupón no se agrega');
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
    assert.match((await page.textContent('#ticket-texto'))!, /Item #: 1 +Código: 0021001403065/);
    await page.click('#btn-nueva');

    // Administración: inventario y exportación
    await page.selectOption('#sesion-prueba', 'admin');
    await page.click('#nav button[data-vista="inventario"]');
    await page.waitForSelector('#tabla-inv-resumen');
    assert.equal(await page.textContent('#tabla-inv-resumen [data-campo="articulos"]'), '14');
    assert.equal(await page.textContent('#tabla-inv-resumen [data-campo="sin_codigo"]'), '2');
    assert.equal(await page.textContent('#tabla-inv-resumen [data-campo="precio_no_vendible"]'), '2');
    await page.screenshot({ path: join(RAIZ, 'docs', 'capturas', '11-inventario-en-la-pagina.png') });
    const [descarga] = await Promise.all([page.waitForEvent('download'), page.click('#btn-exportar')]);
    const filas = (await leerXlsxNode(readFileSync((await descarga.path())!)))[0]!.filas;
    assert.equal(filas.length, 15);
    const f1 = filas.find((f) => f[0] === 1)!;
    assert.deepEqual([f1[1], f1[2], f1[3], f1[7]], ['0021001403065', 'BLUSA', 'blusa seksy', 169]);
    assert.equal(f1[12], 9, 'DÚO: 10 de prueba − 1 vendida (ya sincronizada)');

    // persistencia: al recargar, el inventario sigue cargado (guardado en este navegador)
    await page.reload();
    await page.waitForFunction(() => /Inventario cargado: inventario_prueba\.xlsx · 14 artículos/.test(document.querySelector('#estado-inv')!.textContent!), null, { timeout: 15000 });
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
    const dia = (n: number) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);
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
    assert.deepEqual(errores, []);
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
    await page.click('#nav button[data-vista="dolares"]');
    await page.fill('#usd-desde', new Date(Date.now() - 7 * 3600e3).toISOString().slice(0, 10));
    await page.click('#filtros-usd button[type="submit"]');
    await page.waitForSelector('#tabla-dolares tbody tr[data-folio]');
    assert.equal(await page.textContent('#total-usd'), 'US$50.00');
    assert.deepEqual(errores, []);
  });
});
