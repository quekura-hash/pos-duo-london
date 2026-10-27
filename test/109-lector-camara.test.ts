import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { it } from 'node:test';
import { chromium } from 'playwright-core';

const RAIZ = join(import.meta.dirname, '..');
const chromiumPath = [process.env.POS_CHROMIUM, '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', '/opt/pw-browsers/chromium/chrome-linux/chrome'].find((p) => p && existsSync(p));
// Código 128 de «8342509102» (el de la etiqueta del vestido): 90 módulos, 1 = barra negra.
const BITS = '110100111001011110010010110111000110001011101111011011011001100110110000100101100011101011';

it('LC1 los buscadores de artículos de Administración tienen un botón de cámara que lee el código de la etiqueta y lo pone en el buscador', { timeout: 120_000, skip: chromiumPath ? false : 'Chromium no encontrado' }, async (t) => {
  execFileSync(process.execPath, [join(RAIZ, 'scripts', 'construir-prueba.mjs')], { stdio: 'pipe' });
  // la «cámara»: un video de prueba con el código de barras dibujado, como si la etiqueta estuviera frente al teléfono (se arma aquí mismo: un JPEG repetido)
  const dir = mkdtempSync(join(tmpdir(), 'lector-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const armador = await chromium.launch({ executablePath: chromiumPath, args: ['--no-sandbox'] });
  const jpeg = await (await armador.newPage()).evaluate((bits) => {
    const c = document.createElement('canvas'); c.width = 640; c.height = 480;
    const g = c.getContext('2d')!;
    g.fillStyle = '#ececec'; g.fillRect(0, 0, 640, 480); g.fillStyle = '#fff'; g.fillRect(40, 140, 560, 200); g.fillStyle = '#000';
    const mod = 5, q = (560 - bits.length * mod) / 2;
    for (let i = 0; i < bits.length; i++) if (bits[i] === '1') g.fillRect(40 + q + i * mod, 160, mod, 120);
    return c.toDataURL('image/jpeg', 0.95).split(',')[1]!;
  }, BITS);
  await armador.close();
  const video = join(dir, 'etiqueta.mjpeg');
  writeFileSync(video, Buffer.concat(Array.from({ length: 60 }, () => Buffer.from(jpeg, 'base64'))));
  const browser = await chromium.launch({ executablePath: chromiumPath, args: ['--no-sandbox', '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', `--use-file-for-fake-video-capture=${video}`] });
  t.after(() => browser.close());
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, colorScheme: 'light', hasTouch: true, isMobile: true, permissions: ['camera'] });
  const page = await ctx.newPage();
  const errores: string[] = [];
  page.on('pageerror', (e) => errores.push(String(e)));
  await page.goto(`file://${join(RAIZ, 'dist', 'pos-venta-prueba.html')}`);
  await page.waitForSelector('#scan');
  // en la caja (sin la librería de lectura) no aparece ningún botón de cámara; en Administración la página la trae: aquí se agrega como lo hace la versión de Administración
  await page.selectOption('#sesion-prueba', 'admin');
  await page.click('#nav button[data-vista="inventario"]');
  await page.waitForSelector('#inv-q');
  assert.equal(await page.locator('.btn-camara').count(), 0, 'sin la librería de lectura no hay botón');
  await page.addScriptTag({ path: join(RAIZ, 'node_modules', '@zxing', 'library', 'umd', 'index.min.js') });
  await page.click('#nav button[data-vista="almacen"]');
  await page.waitForSelector('#alm-q-m', { state: 'attached' });
  await page.click('#nav button[data-vista="inventario"]');
  await page.waitForSelector('#inv-q + .btn-camara');
  // el botón queda en la misma fila, pegado al borde del buscador (no como una caja aparte)
  const caja = (await page.locator('#inv-q').boundingBox())!, boton = (await page.locator('#inv-q + .btn-camara').boundingBox())!;
  assert.ok(boton.x >= caja.x + caja.width - 1 && Math.abs(boton.y - caja.y) < 8 && boton.height < 60, `botón junto al buscador: ${JSON.stringify({ caja, boton })}`);
  // pitido de lector al leer: se cuentan los osciladores que arma el audio
  await page.evaluate(() => { (window as any).__pitidos = 0; const A = window.AudioContext; const crear = A.prototype.createOscillator; A.prototype.createOscillator = function (this: AudioContext) { (window as any).__pitidos++; return crear.call(this); }; });
  // lectura: se abre la cámara, lee el código y lo escribe en el buscador
  await page.click('#inv-q + .btn-camara');
  await page.waitForSelector('#dlg-escaner[open]');
  await page.waitForFunction(() => (document.querySelector('#inv-q') as HTMLInputElement).value === '8342509102', undefined, { timeout: 20_000 });
  assert.equal(await page.locator('#dlg-escaner[open]').count(), 0, 'al leer, la cámara se cierra');
  assert.ok((await page.evaluate(() => (window as any).__pitidos)) >= 1, 'al leer suena el pitido');
  // el buscador de Almacén también lo tiene
  await page.click('#nav button[data-vista="almacen"]');
  await page.waitForSelector('#alm-q-m + .btn-camara, #alm-q + .btn-camara', { state: 'attached' });
  assert.deepEqual(errores, []);
});
