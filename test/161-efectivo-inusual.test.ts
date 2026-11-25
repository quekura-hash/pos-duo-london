import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { describe, it, test } from 'node:test';
import { chromium } from 'playwright-core';
import { revisarEfectivo } from '../src/efectivo-inusual.ts';
import { api, appAdmin, appCajero } from './ayudas/app.ts';
import { ALMACENES, nuevoMundo, politica, porAlmacen, servicioDe } from './ayudas/comun.ts';

const chromiumPath = [process.env.POS_CHROMIUM, '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', '/opt/pw-browsers/chromium/chrome-linux/chrome'].find((p) => p && existsSync(p));
const sqlite = ALMACENES.find((a) => a.nombre === 'sqlite')!;
const JEANS = '0002026090782';
const c = (pesos: number) => Math.round(pesos * 100);

test('EI1 la regla: avisa del cambio de más de $1,000 y del monto poco común; no de pagar justo, con billete redondo o con monedas para recibir cambio redondo', () => {
  const r = (aplicar: number, pesos: number, usd?: number, equivalente?: number) => revisarEfectivo({ aplicar: c(aplicar), pesos: c(pesos), usd: usd === undefined ? 0 : c(usd), equivalente: equivalente === undefined ? 0 : c(equivalente) });
  // el caso real: el número de autorización escrito en «Pesos recibidos»
  assert.deepEqual([r(4818, 5531).inusual, r(4818, 5531).motivos, r(4818, 5531).cambio], [true, ['monto_extrano'], c(713)]);
  // normales: justo, billete redondo, monedas para recibir cambio redondo, diferencia pequeña
  for (const [aplicar, recibido] of [[4818, 4818], [4818, 5000], [4818, 5018], [1299, 1319], [4818, 4825], [899, 1000], [120, 500], [4818, 4830]] as const) assert.equal(r(aplicar, recibido).inusual, false, `${aplicar} con ${recibido}`);
  // cambio de más de $1,000 (aunque el monto sea redondo)
  assert.deepEqual(r(300, 2000).motivos, ['cambio_grande']);
  assert.deepEqual(r(4818, 10000).motivos, ['cambio_grande']);
  assert.equal(r(300, 1300).inusual, false, 'exactamente $1,000 de cambio todavía no avisa');
  assert.deepEqual(r(300, 1301).motivos, ['cambio_grande', 'monto_extrano'], 'con $1,001 de cambio y un monto no redondo avisa de las dos cosas');
  // los dos motivos a la vez
  assert.deepEqual(r(899, 5531).motivos, ['cambio_grande', 'monto_extrano']);
  // dólares: el cambio grande sigue avisando; los centavos de dólar no se aceptan
  assert.deepEqual(r(900, 0, 200, 3640).motivos, ['cambio_grande']);
  assert.deepEqual(r(900, 0, 50.5, 909).motivos, ['dolares_con_centavos']);
  assert.equal(r(900, 0, 50, 900).inusual, false);
});

porAlmacen('Efectivo inusual: el servicio revisa y deja marca solo de lo que de verdad lo era', (alm) => {
  it('EI2 revisarEfectivo, y la marca queda en la bitácora (con la caja y la cajera) solo si la cajera confirmó un efectivo inusual', async (t) => {
    const ctx = nuevoMundo(alm, politica());
    t.after(ctx.limpiar);
    const s = servicioDe(ctx, 'DUO', 1, 'Ana');
    const rev = s.svc.revisarEfectivo({ aplicar: 481800, pesos: 553100 });
    assert.deepEqual([rev.inusual, rev.motivos, rev.cambio, rev.recibido], [true, ['monto_extrano'], 71300, 553100]);
    assert.equal(s.svc.revisarEfectivo({ aplicar: 481800, pesos: 500000 }).inusual, false);
    assert.throws(() => s.svc.revisarEfectivo({ aplicar: -1, pesos: 5 }), /inválidos/);
    // 1) venta de $120 con $5,531, confirmada como correcta: queda la marca
    const c1 = s.svc.nuevaVenta(); s.svc.escanear(c1, '7501234567890');
    const v1 = (await s.svc.cobrarEfectivo(c1, 553100, 0, true)).venta;
    // 2) una venta normal que un cliente ya modificado marca como inusual: no se marca (el servidor lo vuelve a evaluar)
    const c2 = s.svc.nuevaVenta(); s.svc.escanear(c2, '7501234567890');
    const v2 = (await s.svc.cobrarEfectivo(c2, 20000, 0, true)).venta;
    // 3) inusual pero sin confirmar (no pasó por el aviso): tampoco
    const c3 = s.svc.nuevaVenta(); s.svc.escanear(c3, '7501234567890');
    await s.svc.cobrarEfectivo(c3, 553100);
    ctx.m.pump(); ctx.m.pump(); ctx.m.pump();
    const marcas = ctx.m.central.repo.ops().filter((o) => o.tipo === 'efectivo.inusual');
    assert.equal(marcas.length, 1);
    assert.deepEqual([marcas[0]!.payload.sale_id, marcas[0]!.payload.folio, marcas[0]!.payload.cajero, marcas[0]!.payload.motivos, marcas[0]!.payload.recibido, marcas[0]!.payload.cambio, marcas[0]!.tienda, marcas[0]!.caja], [v1.sale_id, v1.folio, 'Ana', ['cambio_grande', 'monto_extrano'], 553100, 541100, 'DUO', 1]);
    assert.notEqual(marcas[0]!.payload.sale_id, v2.sale_id);
    // el detalle de la venta (caja e historial de Administración) lo dice; el de una venta normal no
    assert.deepEqual(s.svc.detalleVenta(v1.sale_id).detalle.efectivo_inusual, { motivos: ['cambio_grande', 'monto_extrano'], recibido: 553100, cambio: 541100 });
    assert.equal(s.svc.detalleVenta(v2.sale_id).detalle.efectivo_inusual, undefined);
    // la venta no cambió: sigue siendo efectivo por su total
    assert.deepEqual(v1.pagos.map((p) => [p.metodo, p.monto]), [['efectivo', 12000]]);
  });
});

describe('[navegador real] Efectivo inusual: aviso antes de cobrar', { timeout: 240_000, skip: chromiumPath ? false : 'Chromium no encontrado (defina POS_CHROMIUM)' }, () => {
  it('EI3 el aviso sale con $5,531 para una venta chica; «Corregir» no cobra; «Sí, es correcto» cobra y deja la marca; un pago normal no avisa', async (t) => {
    const browser = await chromium.launch({ executablePath: chromiumPath, args: ['--no-sandbox'] });
    const ctx = nuevoMundo(sqlite, politica());
    const adm = await appAdmin(ctx);
    const caja = await appCajero(ctx, 'DUO', 1, 'Ana');
    t.after(async () => { await browser.close(); await adm.cerrar(); await caja.cerrar(); ctx.limpiar(); });
    await api(adm.url, '/api/admin/cajeros', { nombre: 'Lupe', clave: '4321' });
    for (let i = 0; i < 4; i++) ctx.m.pump();
    await api(caja.url, '/api/login', { usuario: 'Lupe', clave: '4321' });
    const page = await (await browser.newContext({ viewport: { width: 1366, height: 768 } })).newPage();
    const errores: string[] = [];
    page.on('pageerror', (e) => errores.push(String(e)));
    await page.goto(caja.url);
    await page.waitForSelector('#scan');
    await page.fill('#scan', JEANS); await page.press('#scan', 'Enter');
    await page.waitForSelector('#cuerpo tr[data-linea]');
    const total = (await page.textContent('#total'))!; // $899.00
    // $5,531 para $899: cambio de $4,632 y monto poco común
    await page.fill('#recibido', '5531');
    await page.click('#btn-cobrar');
    await page.waitForSelector('#dlg-efectivo-inusual[open]');
    assert.match((await page.textContent('#ei-motivos'))!, /mayor a \$1,000[\s\S]*autorización de una tarjeta/);
    assert.deepEqual([await page.textContent('#ei-recibido'), await page.textContent('#ei-aplicar'), await page.textContent('#ei-cambio')], ['$5,531.00', total, '$4,632.00']);
    // «Corregir»: no se cobró nada y la cajera sigue en la venta
    await page.click('#ei-corregir');
    await page.waitForSelector('#dlg-efectivo-inusual', { state: 'hidden' });
    assert.equal(await page.locator('#dlg-ticket[open]').count(), 0);
    assert.equal(await page.isDisabled('#btn-cobrar'), false);
    assert.equal(ctx.m.central.repo.ops().filter((o) => o.tipo === 'sale.confirmed').length, 0);
    // un pago normal ($1,000 para $899) no avisa y cobra
    await page.fill('#recibido', '1000');
    await page.click('#btn-cobrar');
    await page.waitForSelector('#dlg-ticket[open] #ticket-texto');
    assert.equal(await page.locator('#dlg-efectivo-inusual[open]').count(), 0);
    await page.click('#btn-nueva');
    await page.waitForSelector('#dlg-ticket', { state: 'hidden' });
    await page.waitForFunction(() => document.querySelectorAll('#cuerpo tr[data-linea]').length === 0 && !!document.querySelector('#scan'));
    // otra venta: $5,531 confirmado como correcto
    await page.fill('#scan', JEANS); await page.press('#scan', 'Enter');
    await page.waitForSelector('#cuerpo tr[data-linea]');
    await page.fill('#recibido', '5531');
    await page.click('#btn-cobrar');
    await page.waitForSelector('#dlg-efectivo-inusual[open]');
    await page.click('#ei-confirmar');
    await page.waitForSelector('#dlg-ticket[open] #ticket-texto');
    assert.match((await page.textContent('#dar-feria-monto'))!, /\$4,632\.00/);
    for (let i = 0; i < 4; i++) ctx.m.pump();
    const marcas = ctx.m.central.repo.ops().filter((o) => o.tipo === 'efectivo.inusual');
    assert.equal(marcas.length, 1);
    assert.deepEqual([marcas[0]!.payload.cambio, marcas[0]!.payload.cajero, marcas[0]!.payload.motivos], [463200, 'Lupe', ['cambio_grande', 'monto_extrano']]);
    assert.equal(ctx.m.central.repo.ops().filter((o) => o.tipo === 'sale.confirmed').length, 2);
    assert.deepEqual(errores, []);
  });
});
