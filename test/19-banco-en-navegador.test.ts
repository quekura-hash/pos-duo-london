import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { chromium } from 'playwright-core';

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
    assert.deepEqual(await page.$$eval('#nav button', (b) => b.map((x) => x.textContent)), ['Reportes']);
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
});
