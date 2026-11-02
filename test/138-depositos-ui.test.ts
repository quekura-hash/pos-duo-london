import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { chromium, type Browser, type Page } from 'playwright-core';
import { api, appCajero } from './ayudas/app.ts';
import { ALMACENES, nuevoMundo, politica } from './ayudas/comun.ts';

const RAIZ = join(import.meta.dirname, '..');
const chromiumPath = [process.env.POS_CHROMIUM, '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', '/opt/pw-browsers/chromium/chrome-linux/chrome'].find((p) => p && existsSync(p));
const sqlite = ALMACENES.find((a) => a.nombre === 'sqlite')!;
const VESTIDO = '0002026090782'; // $899.00

async function abrir(browser: Browser, url: string, esquema: 'light' | 'dark', ancho = 1366, alto = 768) {
  const page = await (await browser.newContext({ viewport: { width: ancho, height: alto }, colorScheme: esquema, locale: 'es-MX' })).newPage();
  const errores: string[] = [];
  page.on('pageerror', (e) => errores.push(String(e)));
  await page.goto(url);
  await page.waitForSelector('#scan');
  return { page, errores };
}
const impresos = (dir: string) => readdirSync(dir).filter((f) => f.endsWith('.txt')).sort().map((f) => readFileSync(join(dir, f), 'utf8'));

describe('[navegador real] Depósitos en la caja', { timeout: 300_000, skip: chromiumPath ? false : 'Chromium no encontrado' }, () => {
  for (const esquema of ['light', 'dark'] as const) {
    it(`DU1 (${esquema}) botones cuadrados en una sola fila, Resumen intacto, y el flujo recibir → buscar → aplicar / devolver / fee`, async (t) => {
      const browser = await chromium.launch({ executablePath: chromiumPath, args: ['--no-sandbox'] });
      const ctx = nuevoMundo(sqlite, politica());
      const caja = await appCajero(ctx, 'DUO', 1, 'Ana');
      t.after(async () => { await browser.close(); await caja.cerrar(); ctx.limpiar(); });
      const { page, errores } = await abrir(browser, caja.url, esquema);

      // — Barra de herramientas: botones cuadrados, icono arriba, texto en hasta 2 renglones, todos en una fila.
      const botones = await page.$$eval('.acciones-inf .btn', (b) => b.filter((x) => (x as HTMLElement).offsetParent !== null).map((x) => { const r = x.getBoundingClientRect(); return { id: x.id, y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height), iconoArriba: (x.querySelector('svg')!.getBoundingClientRect().bottom <= x.querySelector('span')!.getBoundingClientRect().top + 2) }; }));
      const dep = botones.find((b) => b.id === 'btn-depositos');
      assert.ok(dep, 'existe el botón Depósitos');
      assert.equal(await page.locator('#btn-depositos svg').count(), 1);
      assert.equal((await page.textContent('#btn-depositos'))!.trim(), 'Depósitos');
      const idsEnLaFila = botones.filter((b) => b.y === dep!.y).map((b) => b.id);
      assert.ok(botones.length >= 7, `${botones.length} botones`);
      assert.deepEqual([...new Set(botones.map((b) => b.y))].length, 1, `todos los botones en una sola fila: ${JSON.stringify(botones)}`);
      assert.ok(botones.every((b) => Math.abs(b.w - b.h) <= Math.max(12, b.w * 0.15)), `cuadrados: ${JSON.stringify(botones)}`);
      assert.ok(botones.every((b) => b.iconoArriba), 'el icono va arriba del texto');
      void idsEnLaFila;
      // — El Resumen de venta no recibió botones nuevos.
      const enResumen = await page.$$eval('aside.resumen button', (b) => b.map((x) => (x.textContent ?? '').trim()));
      assert.ok(!enResumen.some((x) => /dep[oó]sito/i.test(x)), `Resumen: ${enResumen.join(' | ')}`);
      assert.equal(await page.locator('aside.resumen #btn-depositos').count(), 0);
      await page.screenshot({ path: join(RAIZ, 'docs', 'capturas', `depositos-1-venta-${esquema}.png`) });

      // — Ventana: tres opciones.
      await page.click('#btn-depositos');
      await page.waitForSelector('#dlg-depositos[open] #dep-nuevo');
      assert.deepEqual(await page.$$eval('#dlg-depositos .dep-op b', (b) => b.map((x) => x.textContent)), ['Nuevo depósito', 'Buscar depósito', 'Depósitos pendientes']);
      assert.equal((await page.textContent('#dep-cuenta'))!.trim(), '0');
      await page.screenshot({ path: join(RAIZ, 'docs', 'capturas', `depositos-2-menu-${esquema}.png`) });

      // — Nuevo depósito: validaciones, botones rápidos, total, y se recibe.
      await page.click('#dep-nuevo');
      assert.equal(await page.inputValue('#dep-concepto'), 'Prueba de vestido de noche');
      assert.match((await page.textContent('.dep-donde'))!, /Caja 1[\s\S]*Ana/);
      assert.match((await page.textContent('.dep-info'))!, /no se registra como venta/);
      await page.click('#dep-guardar');
      assert.match((await page.textContent('#dep-msg'))!, /nombre de la clienta/);
      await page.fill('#dep-clienta', 'María González');
      await page.click('#dep-guardar');
      assert.match((await page.textContent('#dep-msg'))!, /monto del depósito/);
      assert.deepEqual(await page.$$eval('.dep-rapido', (b) => b.map((x) => x.textContent)), ['$100', '$200', '$300', '$500']);
      await page.click('.dep-rapido[data-monto="300"]');
      assert.equal((await page.textContent('#dep-total'))!.trim(), '$300.00');
      await page.screenshot({ path: join(RAIZ, 'docs', 'capturas', `depositos-3-nuevo-${esquema}.png`) });
      await page.dblclick('#dep-guardar'); // doble clic: un solo depósito
      await page.waitForSelector('#dep-ticket');
      const ticket = (await page.textContent('#dep-ticket'))!;
      assert.match(ticket, /COMPROBANTE DE DEPÓSITO/);
      assert.match(ticket, /Folio: DEP-D1-0001/);
      assert.match(ticket, /María González/);
      assert.match(ticket, /DEPÓSITO RECIBIDO\s+\$300\.00/);
      assert.match(ticket, /NO es una venta/);
      assert.match((await page.textContent('#dep-estado-impresion'))!, /Ticket enviado a la impresora/);
      assert.equal((await api(caja.url, '/api/depositos')).json.depositos.length, 1);
      assert.equal(impresos(caja.s.impresora.dir).filter((x) => /COMPROBANTE DE DEPÓSITO/.test(x)).length, 1, 'se imprimió una sola vez');
      await page.screenshot({ path: join(RAIZ, 'docs', 'capturas', `depositos-4-comprobante-${esquema}.png`) });
      await page.click('#dep-listo');
      assert.equal((await page.textContent('#dep-cuenta'))!.trim(), '1');

      // — Buscar por nombre (y un código desconocido no muestra nada) → detalle.
      await page.click('#dep-buscar');
      await page.fill('#dep-q', 'DEP-D1-9999'); await page.press('#dep-q', 'Enter');
      await page.waitForSelector('#dep-resultados .ps-vacio');
      await page.fill('#dep-q', 'maria gonzalez'); await page.press('#dep-q', 'Enter');
      await page.waitForSelector('#dep-resultados [data-dep]');
      assert.match((await page.textContent('#dep-resultados'))!, /DEP-D1-0001[\s\S]*Pendiente[\s\S]*María González[\s\S]*\$300\.00/);
      await page.click('#dep-resultados [data-dep]');
      await page.waitForSelector('#dep-a-devolver');
      assert.equal((await page.textContent('#dep-saldo'))!.trim(), '$300.00');
      assert.deepEqual(await page.$$eval('.dep-accion b', (b) => b.map((x) => x.textContent)), ['Devolver depósito', 'Aplicar a una compra', 'Cobrar fee por daño']);
      await page.screenshot({ path: join(RAIZ, 'docs', 'capturas', `depositos-5-detalle-${esquema}.png`) });

      // — Aplicar a una compra: sin artículos no se puede; con el vestido ($899) el adicional es $599 y el Resumen lo refleja sin botones nuevos.
      await page.click('#dep-a-aplicar');
      assert.match((await page.textContent('#dlg-depositos'))!, /Primero agregue el vestido/);
      await page.click('#dep-cerrar');
      await page.fill('#scan', VESTIDO); await page.press('#scan', 'Enter');
      await page.waitForSelector('#cuerpo tr[data-linea]');
      await page.click('#btn-depositos');
      await page.click('#dep-pendientes');
      await page.fill('#dep-filtro', 'maria');
      await page.click('#dep-lista [data-dep]');
      await page.click('#dep-a-aplicar');
      assert.equal((await page.textContent('#dep-ap-precio'))!.trim(), '$899.00');
      assert.equal((await page.textContent('#dep-ap-aplica'))!.trim(), '$300.00');
      assert.equal((await page.textContent('#dep-ap-resta'))!.trim(), '$599.00');
      await page.click('#dep-ap-ejecutar');
      await page.waitForSelector('#dlg-depositos', { state: 'hidden' });
      assert.equal((await page.textContent('#total'))!.trim(), '$599.00');
      assert.equal((await page.textContent('#brutas'))!.trim(), '$899.00', 'el precio no cambia');
      assert.equal((await page.textContent('#descuentos'))!.trim(), '$0.00', 'no es un descuento');
      assert.equal((await page.textContent('#dd-deposito'))!.trim(), '-$300.00');
      assert.equal((await api(caja.url, '/api/depositos')).json.depositos[0].saldo, 30000, 'reservado, no consumido');
      await page.screenshot({ path: join(RAIZ, 'docs', 'capturas', `depositos-6-aplicado-${esquema}.png`) });
      // quitar desde el módulo libera la reserva
      await page.click('#btn-depositos');
      await page.click('#dep-quitar');
      await page.waitForSelector('#dep-encarrito', { state: 'detached' });
      assert.equal((await page.textContent('#total'))!.trim(), '$899.00');
      await page.click('#dep-pendientes'); await page.click('#dep-lista [data-dep]'); await page.click('#dep-a-aplicar'); await page.click('#dep-ap-ejecutar');
      await page.waitForSelector('#dlg-depositos', { state: 'hidden' });
      // cobrar la diferencia en efectivo
      await page.fill('#recibido', '600');
      await page.click('#btn-cobrar');
      await page.waitForSelector('#dlg-ticket[open]');
      const ticketVenta = (await page.textContent('#ticket-texto'))!;
      assert.match(ticketVenta, /Depósito DEP-D1-0001\s+\$300\.00/);
      assert.match(ticketVenta, /\$899\.00/);
      const dep1 = (await api(caja.url, '/api/deposito?id=' + (await api(caja.url, '/api/depositos?q=DEP-D1-0001')).json.depositos[0].deposito_id)).json.deposito;
      assert.deepEqual([dep1.saldo, dep1.estado, dep1.aplicado], [0, 'cerrado', 30000]);
      await page.click('#btn-nueva');
      await page.waitForSelector('#dlg-ticket', { state: 'hidden' });

      // — Devolver: pide confirmar que no hay daños y entrega el dinero; el cajón se abre solo en la devolución.
      const nuevoDep = async (nombre: string, monto: string) => {
        if (!(await page.locator('#dlg-depositos[open]').count())) await page.click('#btn-depositos');
        await page.click('#dep-nuevo');
        await page.fill('#dep-clienta', nombre); await page.fill('#dep-monto', monto);
        await page.click('#dep-guardar'); await page.waitForSelector('#dep-ticket'); await page.click('#dep-listo');
      };
      await nuevoDep('Lupe Pérez', '500');
      await page.click('#dep-buscar'); await page.fill('#dep-q', 'DEP-D1-0002'); await page.press('#dep-q', 'Enter');
      await page.click('#dep-resultados [data-dep]');
      await page.click('#dep-a-devolver');
      assert.equal(await page.isDisabled('#dep-dev-ejecutar'), true, 'no entrega el dinero sin confirmar');
      await page.check('#dep-dev-ok');
      assert.equal(await page.isDisabled('#dep-dev-ejecutar'), false);
      await page.screenshot({ path: join(RAIZ, 'docs', 'capturas', `depositos-7-devolver-${esquema}.png`) });
      await page.click('#dep-dev-ejecutar');
      await page.waitForSelector('#dep-ticket');
      assert.match((await page.textContent('#dep-ticket'))!, /DEVOLUCIÓN DE DEPÓSITO[\s\S]*DEVUELTO A LA CLIENTA\s+\$500\.00[\s\S]*Saldo restante\s+\$0\.00/);
      await page.click('#dep-listo');

      // — Fee por daño mayor al saldo se rechaza; uno válido retiene sin mover efectivo y deja el resto.
      await nuevoDep('Rosa Díaz', '300');
      await page.click('#dep-pendientes'); await page.click('#dep-lista [data-dep]');
      await page.click('#dep-a-fee');
      await page.fill('#dep-fee-monto', '400'); await page.fill('#dep-fee-motivo', 'Cierre roto');
      await page.click('#dep-fee-ejecutar');
      assert.match((await page.textContent('#dep-msg'))!, /mayor que el saldo/);
      await page.fill('#dep-fee-monto', '150');
      assert.equal((await page.textContent('#dep-fee-resto'))!.trim(), '$150.00');
      await page.screenshot({ path: join(RAIZ, 'docs', 'capturas', `depositos-8-fee-${esquema}.png`) });
      await page.click('#dep-fee-ejecutar');
      await page.waitForSelector('#dep-ticket');
      assert.match((await page.textContent('#dep-ticket'))!, /FEE POR DAÑO[\s\S]*RETENIDO POR DAÑO\s+\$150\.00[\s\S]*Saldo restante\s+\$150\.00[\s\S]*Motivo: Cierre roto/);
      await page.click('#dep-listo');
      const pend = (await api(caja.url, '/api/depositos')).json.depositos;
      assert.deepEqual(pend.map((x: any) => [x.folio, x.saldo, x.estado]), [['DEP-D1-0003', 15000, 'parcial']]);

      // — El corte lo refleja: efectivo = $300 (dep. aplicado→ya estaba) + $600 cobrados + $500 recibido − $500 devuelto + $300 recibido = ...
      const corte = (await api(caja.url, '/api/corte')).json;
      const c = corte.vivo;
      assert.equal(c.depositos.recibidos, 110000);
      assert.equal(c.depositos.devueltos, 50000);
      assert.equal(c.depositos.aplicados, 30000);
      assert.equal(c.depositos.fees, 15000);
      assert.equal(c.depositos.pendiente, 15000);
      assert.equal(c.ventas, 89900, 'solo la venta del vestido, una vez');
      assert.equal(c.mxn.esperado, 110000 - 50000 + 59900, 'depósitos recibidos − devueltos + lo cobrado de la compra ($599 netos de cambio)');
      assert.deepEqual(errores.filter((e) => !/401|403|409|Failed to load resource/.test(e)), []);
    });
  }
});
