import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { describe, it } from 'node:test';
import { chromium } from 'playwright-core';
import { appAdmin } from './ayudas/app.ts';
import { ALMACENES, nuevoMundo, politica } from './ayudas/comun.ts';

const chromiumPath = [process.env.POS_CHROMIUM, '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', '/opt/pw-browsers/chromium/chrome-linux/chrome'].find((p) => p && existsSync(p));
const sqlite = ALMACENES.find((a) => a.nombre === 'sqlite')!;

describe('[navegador real] Formulario de promoción: solo los campos del tipo elegido', { timeout: 120_000, skip: chromiumPath ? false : 'Chromium no encontrado' }, () => {
  it('PT1 «Lleva X, paga Y» y «Paquete a precio fijo» no muestran los campos del otro', async (t) => {
    const browser = await chromium.launch({ executablePath: chromiumPath, args: ['--no-sandbox'] });
    const ctx = nuevoMundo(sqlite, politica());
    const adm = await appAdmin(ctx);
    t.after(async () => { await browser.close(); await adm.cerrar(); ctx.limpiar(); });
    const page = await (await browser.newContext({ viewport: { width: 390, height: 844 } })).newPage();
    await page.goto(adm.url);
    await page.waitForSelector('#nav');
    await page.click('#nav button[data-vista="promociones"]');
    await page.click('#btn-nueva-promo');
    await page.waitForSelector('#dlg-promo[open]');
    await page.selectOption('#pr-tipo', 'nxm');
    assert.deepEqual([await page.isVisible('#pr-lleva'), await page.isVisible('#pr-paga'), await page.isVisible('#pr-lleva2'), await page.isVisible('#pr-precio')], [true, true, false, false]);
    await page.selectOption('#pr-tipo', 'paquete');
    assert.deepEqual([await page.isVisible('#pr-lleva'), await page.isVisible('#pr-paga'), await page.isVisible('#pr-lleva2'), await page.isVisible('#pr-precio')], [false, false, true, true]);
    await page.selectOption('#pr-tipo', 'cupon');
    assert.deepEqual([await page.isVisible('#pr-lleva'), await page.isVisible('#pr-lleva2')], [false, false]);
  });
});
