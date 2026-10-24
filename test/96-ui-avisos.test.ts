import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { describe, it } from 'node:test';
import { chromium } from 'playwright-core';
import { api, appAdmin } from './ayudas/app.ts';
import { ALMACENES, nuevoMundo, politica } from './ayudas/comun.ts';

const chromiumPath = [process.env.POS_CHROMIUM, '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', '/opt/pw-browsers/chromium/chrome-linux/chrome'].find((p) => p && existsSync(p));
const sqlite = ALMACENES.find((a) => a.nombre === 'sqlite')!;

describe('[navegador real] Avisos a la vista y campos que faltan', { timeout: 180_000, skip: chromiumPath ? false : 'Chromium no encontrado' }, () => {
  it('AV1 un mensaje fuera de pantalla sale como aviso emergente con X; uno que ya se ve no se duplica; los campos obligatorios vacíos se marcan en rojo', async (t) => {
    const browser = await chromium.launch({ executablePath: chromiumPath, args: ['--no-sandbox'] });
    const ctx = nuevoMundo(sqlite, politica());
    const adm = await appAdmin(ctx);
    t.after(async () => { await browser.close(); await adm.cerrar(); ctx.limpiar(); });
    await api(adm.url, '/api/admin/administradores', { nombre: 'Edgardo', clave: 'clave-segura', clave_caja: '2468' });
    const page = await (await browser.newContext({ viewport: { width: 1280, height: 600 } })).newPage();
    const errores: string[] = [];
    page.on('pageerror', (e) => errores.push(String(e)));
    await page.goto(adm.url);
    await page.waitForSelector('#nav');
    await page.click('#nav button[data-vista="empleadas"]');
    await page.waitForSelector('#form-cajero');
    const avisos = () => page.$$eval('#avisos-flotantes .toast-aviso', (a) => a.map((x) => x.textContent!.replace('✕', '').trim()));

    // 1) campos obligatorios vacíos: se marcan, se enfoca el primero y sale el aviso con los nombres
    await page.click('#btn-caj');
    await page.waitForSelector('#avisos-flotantes .toast-aviso.error');
    assert.match((await avisos())[0]!, /Falta completar: .*Usuario \(alias\).*Nombres.*Apellidos.*/);
    assert.ok((await page.locator('#form-cajero .campo-falta').count()) >= 4, 'los campos vacíos quedan marcados en rojo');
    assert.equal(await page.evaluate(() => document.activeElement?.id), 'caj-nombre');
    assert.equal(await page.isVisible('#avisos-flotantes .toast-aviso'), true);
    // al escribir, el campo deja de estar marcado
    await page.fill('#caj-nombre', 'Lupe');
    assert.equal(await page.locator('#caj-nombre.campo-falta').count(), 0);
    // la X cierra el aviso
    await page.click('#avisos-flotantes .av-x');
    assert.equal((await avisos()).length, 0);

    // 2) un mensaje que queda fuera de la pantalla sale como aviso emergente
    await page.evaluate(() => { document.querySelector('#panel-alta')!.scrollIntoView(); (document.querySelector('main') as HTMLElement).scrollTop += 2000; window.scrollTo(0, document.body.scrollHeight); });
    await page.evaluate(() => { const m = document.querySelector('#msg-cajeros') as HTMLElement; m.className = 'mensaje error'; m.textContent = 'Esa clave ya existe.'; });
    await page.waitForSelector('#avisos-flotantes .toast-aviso');
    assert.deepEqual(await avisos(), ['Esa clave ya existe.']);
    // cuando el mensaje se borra o cambia, el aviso se quita solo
    await page.evaluate(() => { const m = document.querySelector('#msg-cajeros') as HTMLElement; m.className = 'mensaje'; m.textContent = ''; });
    await page.waitForFunction(() => document.querySelectorAll('#avisos-flotantes .toast-aviso').length === 0);

    // 3) un mensaje que ya se ve en pantalla no se duplica
    await page.evaluate(() => { window.scrollTo(0, 0); (document.querySelector('main') as HTMLElement).scrollTop = 0; });
    await page.evaluate(() => { const m = document.querySelector('#msg-cajeros') as HTMLElement; m.className = 'mensaje error'; m.textContent = 'Visible.'; });
    await page.waitForTimeout(400);
    assert.deepEqual(await avisos(), []);
    // 4) dentro de una ventana modal el aviso queda POR ENCIMA de la ventana (no tapado)
    await page.evaluate(() => {
      const d = document.createElement('dialog'); d.id = 'dlg-prueba-avisos'; d.style.cssText = 'overflow:auto;max-height:70vh';
      d.innerHTML = '<button id="cerrar-prueba" type="button">Cerrar</button><div style="height:3000px">contenido largo</div><div id="msg-modal" class="mensaje"></div>';
      document.body.appendChild(d); d.showModal();
      const m = d.querySelector('#msg-modal') as HTMLElement; m.className = 'mensaje error'; m.textContent = 'La clave del supervisor no es correcta.';
    });
    await page.waitForSelector('#avisos-flotantes .toast-aviso');
    const encima = await page.evaluate(() => { const t = document.querySelector('#avisos-flotantes .toast-aviso') as HTMLElement; const r = t.getBoundingClientRect(); const e = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2); return !!e && t.contains(e); });
    assert.equal(encima, true, 'el aviso se ve por encima de la ventana modal');
    await page.click('#avisos-flotantes .av-x'); // y se puede cerrar aunque la ventana modal esté abierta
    assert.equal((await avisos()).length, 0);
    assert.deepEqual(errores, []);
  });
});
