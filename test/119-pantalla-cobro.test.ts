import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { describe, it } from 'node:test';
import { readFileSync } from 'node:fs';
import { chromium } from 'playwright-core';
import { api, appAdmin, appCajero } from './ayudas/app.ts';
import { ALMACENES, nuevoMundo, politica } from './ayudas/comun.ts';

const chromiumPath = [process.env.POS_CHROMIUM, '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', '/opt/pw-browsers/chromium/chrome-linux/chrome'].find((p) => p && existsSync(p));
const sqlite = ALMACENES.find((a) => a.nombre === 'sqlite')!;
const JEANS = '0002026090782';

it('PC0 el total en dólares se redondea SIEMPRE hacia arriba al siguiente múltiplo de 25 centavos (83.94 → 84.00, 63.08 → 63.25); un monto exacto se queda', () => {
  const m = /const mxnAUsd = (.*);\n/.exec(readFileSync(new URL('../src/app/publico/app.js', import.meta.url), 'utf8'))!;
  const f = new Function(`return ${m[1]}`)() as (mxnC: number, tasa: number) => number;
  assert.equal(f(146900, 175000), 8400, '$1,469.00 a $17.50 = 83.94 → 84.00');
  assert.equal(f(110390, 175000), 6325, '$1,103.90 a $17.50 = 63.08 → 63.25');
  assert.equal(f(147000, 175000), 8400, '$1,470.00 a $17.50 = 84.00 exacto: no sube');
  assert.equal(f(45000, 180000), 2500, '$450 a $18.00 = 25.00 exacto');
  assert.equal(f(89900, 180000), 5000, '49.94 → 50.00');
  assert.equal(f(1, 175000), 25, 'un centavo ya sube al primer escalón');
  assert.equal(f(0, 175000), 0);
  for (let mxn = 1; mxn <= 400000; mxn += 997) for (const tasa of [170000, 175000, 180000, 183500]) {
    const exacto = (mxn * 10000) / tasa, r = f(mxn, tasa);
    assert.ok(r % 25 === 0 && r >= exacto - 1e-6 && r - exacto < 25 + 1e-6, `${mxn}@${tasa}: ${r} vs ${exacto}`);
  }
});

describe('[navegador real] Al cobrar: la feria que se da en grande y los detalles de la venta (ya no el ticket)', { timeout: 180_000, skip: chromiumPath ? false : 'Chromium no encontrado (defina POS_CHROMIUM)' }, () => {
  it('PC1 con cambio: «DAR DE FERIA» enorme y en verde, con total, recibido, forma de pago y artículos; con dólares muestra el tipo de cambio; sin cambio dice PAGO EXACTO; el ticket no se ve pero sigue ahí para imprimir', async (t) => {
    const browser = await chromium.launch({ executablePath: chromiumPath, args: ['--no-sandbox'] });
    const ctx = nuevoMundo(sqlite, politica());
    const adm = await appAdmin(ctx);
    const caja = await appCajero(ctx, 'DUO', 1, 'Ana');
    t.after(async () => { await browser.close(); await adm.cerrar(); await caja.cerrar(); ctx.limpiar(); });
    await api(adm.url, '/api/admin/tipo-cambio', { tasa: 180000, confirmar: true });
    await api(adm.url, '/api/admin/cajeros', { nombre: 'Lupe', clave: '4321' });
    for (let i = 0; i < 4; i++) ctx.m.pump();
    await api(caja.url, '/api/login', { usuario: 'Lupe', clave: '4321' });
    const page = await (await browser.newContext({ viewport: { width: 1366, height: 800 } })).newPage();
    const errores: string[] = [];
    page.on('pageerror', (e) => errores.push(String(e)));
    await page.goto(caja.url);
    await page.waitForSelector('#scan');
    // «Nueva venta» cierra el aviso al instante, pero el carrito nuevo y la pantalla de venta se arman un momento después (y reemplazan el campo de escaneo):
    // se espera a que termine antes de escanear el siguiente artículo, como lo haría una cajera.
    const nueva = async () => { const lista = page.waitForResponse((r) => /\/api\/venta\/vendedoras/.test(r.url())); await page.click('#btn-nueva'); await page.waitForSelector('#dlg-ticket', { state: 'hidden' }); await lista; await page.waitForTimeout(200); };
    // 1) efectivo con cambio: $899 pagados con $1,000
    await page.fill('#scan', JEANS); await page.press('#scan', 'Enter');
    await page.waitForSelector('#cuerpo tr[data-linea]');
    // el total también en dólares (tipo de cambio $18.00): $899.00 / 18 = 49.94 → se redondea hacia arriba a múltiplos de 25 centavos: US$50.00; debajo del de pesos y en un tamaño menor; la forma de cobro y la feria siguen en pesos
    assert.equal((await page.textContent('#total-usd'))!.trim(), 'US$50.00');
    assert.match((await page.textContent('#total-usd-bloque'))!, /US\$50\.00\s*USD/);
    const tamUsd = await page.evaluate(() => ({ usd: parseFloat(getComputedStyle(document.querySelector('#total-usd')!).fontSize), mxn: parseFloat(getComputedStyle(document.querySelector('#total')!).fontSize), yUsd: document.querySelector('#total-usd')!.getBoundingClientRect().top, yMxn: document.querySelector('#total')!.getBoundingClientRect().bottom }));
    assert.ok(tamUsd.usd < tamUsd.mxn && tamUsd.yUsd >= tamUsd.yMxn, `el total en dólares va debajo y más chico: ${JSON.stringify(tamUsd)}`);
    await page.fill('#recibido', '1000');
    await page.click('#btn-cobrar');
    await page.waitForSelector('#dlg-ticket[open] #dar-feria');
    assert.match((await page.textContent('#dar-feria'))!, /DAR DE FERIA\s*\$101\.00/);
    const tam = await page.evaluate(() => { const f = (s: string) => parseFloat(getComputedStyle(document.querySelector(s)!).fontSize); return { feria: f('#dar-feria-monto'), resto: f('#detalle-cobro dd') }; });
    assert.ok(tam.feria >= 64 && tam.feria > tam.resto * 3, `la feria es lo más grande: ${JSON.stringify(tam)}`);
    const verde = await page.evaluate(() => { const c = (e: Element) => getComputedStyle(e).color; const ok = document.createElement('i'); ok.style.color = 'var(--ok)'; document.body.append(ok); const r = [c(document.querySelector('#dar-feria-monto')!), c(ok)]; ok.remove(); return r; });
    assert.equal(verde[0], verde[1], 'verde de la paleta de LonDuo');
    const det = (await page.textContent('#detalle-cobro'))!.replace(/\s+/g, ' ');
    assert.match(det, /Total de la venta ?\$899\.00/);
    assert.match(det, /Recibido ?\$1,000\.00/);
    assert.match(det, /Pago ?Efectivo MXN/);
    assert.match(det, /Ticket ?D1-000001/);
    assert.match(await page.textContent('#lineas-cobro') as string, /\$899\.00/);
    assert.equal(await page.isVisible('#ticket-texto'), true, 'sigue en el DOM (1px) para lectores de pantalla y pruebas');
    assert.equal((await page.locator('#ticket-texto').boundingBox())!.width <= 2, true, 'pero no se ve en pantalla');
    assert.match((await page.textContent('#ticket-texto'))!, /Folio: 000001/);
    assert.match((await page.textContent('#resumen-venta'))!, /cambio \$101\.00/);
    await nueva();
    // 2) pago exacto en efectivo: sin feria
    await page.fill('#scan', JEANS); await page.press('#scan', 'Enter');
    await page.waitForSelector('#cuerpo tr[data-linea]');
    await page.click('#btn-exacto');
    await page.click('#btn-cobrar');
    await page.waitForSelector('#dlg-ticket[open] #dar-feria');
    assert.match((await page.textContent('#dar-feria'))!, /PAGO EXACTO/);
    assert.equal(await page.locator('#dar-feria-monto').count(), 0);
    await nueva();
    // 3) con dólares: US$50 a $18.00 = $900 y la feria en pesos
    await page.fill('#scan', JEANS); await page.press('#scan', 'Enter');
    await page.waitForSelector('#cuerpo tr[data-linea]');
    await page.fill('#recibido', '0');
    await page.fill('#usd', '50');
    await page.waitForSelector('#bloque-usd:not([hidden])');
    await page.click('#btn-cobrar');
    await page.waitForSelector('#dlg-ticket[open] #dar-feria');
    assert.match((await page.textContent('#dar-feria'))!, /DAR DE FERIA\s*\$1\.00/);
    assert.match((await page.textContent('#detalle-cobro'))!.replace(/\s+/g, ' '), /Pago ?Dólares US\$50\.00 a \$18\.00 = \$900\.00/);
    assert.deepEqual(errores, []);
  });
});
