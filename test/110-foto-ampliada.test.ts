import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { it } from 'node:test';
import { chromium } from 'playwright-core';

const RAIZ = join(import.meta.dirname, '..');
const chromiumPath = [process.env.POS_CHROMIUM, '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', '/opt/pw-browsers/chromium/chrome-linux/chrome'].find((p) => p && existsSync(p));
const FOTO = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

it('FA1 tocar la foto de una persona (lista, ficha, formulario) la muestra grande, sin abrir además la fila que la contiene', { timeout: 120_000, skip: chromiumPath ? false : 'Chromium no encontrado' }, async (t) => {
  execFileSync(process.execPath, [join(RAIZ, 'scripts', 'construir-prueba.mjs')], { stdio: 'pipe' });
  const browser = await chromium.launch({ executablePath: chromiumPath, args: ['--no-sandbox'] });
  t.after(() => browser.close());
  const page = await (await browser.newContext({ viewport: { width: 1280, height: 800 } })).newPage();
  const errores: string[] = [];
  page.on('pageerror', (e) => errores.push(String(e)));
  await page.goto(`file://${join(RAIZ, 'dist', 'pos-venta-prueba.html')}`);
  await page.waitForSelector('#scan');
  // una fila con la foto dentro, como en la lista de personal: el clic de la fila no debe dispararse
  await page.evaluate((src) => {
    const fila = document.createElement('div');
    fila.id = 'fila-prueba'; (window as any).__filaTocada = 0;
    fila.addEventListener('click', () => { (window as any).__filaTocada++; });
    fila.innerHTML = `<img data-ampliar id="foto-prueba" src="${src}" alt="Foto de Carmen" style="width:44px;height:44px">`;
    document.body.appendChild(fila);
  }, FOTO);
  await page.click('#foto-prueba');
  await page.waitForSelector('#dlg-foto-grande[open] img.foto-grande');
  assert.equal(await page.getAttribute('#dlg-foto-grande img.foto-grande', 'src'), FOTO);
  assert.equal(await page.evaluate(() => (window as any).__filaTocada), 0, 'tocar la foto no activa la fila');
  await page.click('#fg-cerrar');
  assert.equal(await page.locator('#dlg-foto-grande[open]').count(), 0);
  // se vuelve a abrir y se cierra tocando la propia foto
  await page.click('#foto-prueba');
  await page.waitForSelector('#dlg-foto-grande[open]');
  await page.click('#dlg-foto-grande img.foto-grande');
  assert.equal(await page.locator('#dlg-foto-grande[open]').count(), 0);
  assert.deepEqual(errores, []);
});
