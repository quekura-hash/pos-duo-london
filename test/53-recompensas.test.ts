import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { it } from 'node:test';
import { appAdmin, appCajero, api } from './ayudas/app.ts';
import { nuevoMundo, politica, porAlmacen } from './ayudas/comun.ts';

porAlmacen('Recompensas: cupón impreso en el ticket con QR de un solo uso', (alm) => {
  const regla = (o: Record<string, unknown> = {}) => ({ nombre: 'Gana $50 en tu próxima compra', activa: true, tiendas: ['DUO'], inicio: null, fin: null, compra_minima: 100000, cupon: { monto: 5000, minimo: 50000, vigencia: { modo: 'dias', dias: 30 } }, ...o });
  const preparar = async (t: { after(f: () => void): void }) => {
    const ctx = nuevoMundo(alm, politica());
    t.after(ctx.limpiar);
    const adm = await appAdmin(ctx); t.after(() => adm.cerrar());
    const c1 = await appCajero(ctx, 'DUO', 1, 'Ana'); t.after(() => c1.cerrar());
    const c2 = await appCajero(ctx, 'DUO', 2, 'Beto'); t.after(() => c2.cerrar());
    const l1 = await appCajero(ctx, 'LON', 1, 'Luis'); t.after(() => l1.cerrar());
    const r = await api(adm.url, '/api/admin/recompensas', regla());
    assert.equal(r.status, 200);
    ctx.m.pump(); ctx.m.pump(); ctx.m.pump();
    return { ctx, adm, c1, c2, l1 };
  };
  const comprar = async (caja: any, codigos: string[], opts: { cupon?: string; recibido?: number } = {}) => {
    const cart = (await api(caja.url, '/api/venta/nueva', {})).json.cart;
    let ult: any;
    for (const c of codigos) ult = await api(caja.url, '/api/venta/escanear', { cart, codigo: c });
    let cupon: any = null;
    if (opts.cupon) cupon = await api(caja.url, '/api/venta/cupon', { cart, codigo: opts.cupon });
    const total = (await api(caja.url, '/api/venta/actual', {})).json; void total;
    const venta = await api(caja.url, '/api/venta/cobrar-efectivo', { cart, recibido: opts.recibido ?? 5000000 });
    return { venta: venta.json.venta, ticket: venta.json.ticket_texto, cupon, ult };
  };
  const JEANS = '0002026090782', MASCADA = '7501234567890';

  it('RE1 validación de la regla y estados (crear, desactivar)', async (t) => {
    const { adm } = await preparar(t);
    const mal = async (o: Record<string, unknown>) => (await api(adm.url, '/api/admin/recompensas', regla(o))).json.error.codigo;
    assert.equal(await mal({ nombre: '' }), 'RECOMPENSA_INVALIDA');
    assert.equal(await mal({ tiendas: [] }), 'RECOMPENSA_INVALIDA');
    assert.equal(await mal({ compra_minima: 0 }), 'RECOMPENSA_INVALIDA');
    assert.equal(await mal({ cupon: { monto: 5000, pct: 10, minimo: 0, vigencia: { modo: 'dias', dias: 5 } } }), 'RECOMPENSA_INVALIDA');
    assert.equal(await mal({ cupon: { pct: 120, minimo: 0, vigencia: { modo: 'dias', dias: 5 } } }), 'RECOMPENSA_INVALIDA');
    assert.equal(await mal({ cupon: { pct: 20, minimo: 0, vigencia: { modo: 'fechas', inicio: '2026-12-10', fin: '2026-12-01' } } }), 'RECOMPENSA_INVALIDA');
    const l = (await api(adm.url, '/api/admin/recompensas')).json.recompensas;
    assert.equal(l.length, 1);
    assert.deepEqual([l[0].estado, l[0].regaladas, l[0].canjeadas], ['activa', 0, 0]);
    const off = await api(adm.url, '/api/admin/recompensas', { ...regla(), id: l[0].id, activa: false });
    assert.equal(off.json.recompensas[0].estado, 'inactiva');
  });

  it('RE2 con lo PAGADO ≥ mínimo se imprime el cupón con su QR; con menos, o con un cupón de descuento que baja lo pagado, no', async (t) => {
    const { ctx, adm, c1 } = await preparar(t);
    assert.equal((await comprar(c1, [MASCADA])).venta.recompensas, undefined, 'una compra chica no gana');
    assert.equal((await comprar(c1, [JEANS])).venta.recompensas, undefined, '$899 < $1,000');
    // un cupón de 20% baja lo que paga: 899 + 120 = 1,019 → paga 815.20 < 1,000: no gana
    await api(adm.url, '/api/admin/promociones', { tipo: 'cupon', nombre: 'Veinte', activa: true, tiendas: ['DUO'], inicio: null, fin: null, codigo: 'V20', pct: 20, minimo: 0, usos_max: null });
    ctx.m.pump(); ctx.m.pump(); ctx.m.pump();
    assert.equal((await comprar(c1, [JEANS, MASCADA], { cupon: 'V20' })).venta.recompensas, undefined, 'con el 20% paga menos del mínimo');
    const g = await comprar(c1, [JEANS, JEANS]);
    assert.equal(g.venta.recompensas.length, 1);
    const e = g.venta.recompensas[0];
    assert.match(e.codigo, /^RC-DUO1-0000\d\d-1$/);
    assert.deepEqual([e.monto, e.minimo, e.tienda, e.nombre], [5000, 50000, 'DUO', 'Gana $50 en tu próxima compra']);
    assert.match(g.ticket, /¡TE GANASTE UN CUPÓN!/);
    assert.match(g.ticket, /\$50\.00 de descuento en tu próxima compra/);
    assert.match(g.ticket, /Compra mínima: \$500\.00/);
    assert.match(g.ticket, /Válido del \d\d\/\d\d\/2026 al \d\d\/\d\d\/20\d\d/);
    assert.match(g.ticket, new RegExp(`Código: ${e.codigo}`));
    // el ticket impreso (ESC/POS) lleva el QR nativo con el código
    const bin = readdirSync(c1.s.impresora.dir).filter((f) => f.endsWith('.bin')).sort().at(-1)!;
    const bytes = [...readFileSync(join(c1.s.impresora.dir, bin))];
    const cod = [...Buffer.from(e.codigo, 'latin1')];
    const i = bytes.findIndex((_, k) => bytes[k] === 0x1d && bytes[k + 1] === 0x28 && bytes[k + 2] === 0x6b && bytes[k + 5] === 0x31 && bytes[k + 6] === 0x50);
    assert.ok(i > 0, 'comando «guardar datos del QR»');
    assert.deepEqual(bytes.slice(i + 8, i + 8 + cod.length), cod);
    assert.deepEqual(bytes.slice(i + 8 + cod.length, i + 8 + cod.length + 8), [0x1d, 0x28, 0x6b, 3, 0, 0x31, 0x51, 0x30], 'imprimir el QR');
    // una regla desactivada ya no regala
    const l = (await api(adm.url, '/api/admin/recompensas')).json.recompensas[0];
    await api(adm.url, '/api/admin/recompensas', { ...regla(), id: l.id, activa: false });
    ctx.m.pump(); ctx.m.pump(); ctx.m.pump();
    assert.equal((await comprar(c1, [JEANS, JEANS])).venta.recompensas, undefined);
  });

  it('RE3 canje: respeta mínimo, vigencia y un solo uso (también entre las dos cajas), y solo en la tienda que lo emitió', async (t) => {
    const { ctx, adm, c1, c2, l1 } = await preparar(t);
    const g = (await comprar(c1, [JEANS, JEANS])).venta.recompensas[0];
    ctx.m.pump(); ctx.m.pump(); ctx.m.pump();
    // mínimo de uso $500
    const cartChica = (await api(c2.url, '/api/venta/nueva', {})).json.cart;
    await api(c2.url, '/api/venta/escanear', { cart: cartChica, codigo: MASCADA });
    const chica = await api(c2.url, '/api/venta/cupon', { cart: cartChica, codigo: g.codigo });
    assert.equal(chica.json.error.codigo, 'CUPON_NO_APLICA');
    assert.match(chica.json.error.mensaje, /al menos \$500\.00/);
    // en la OTRA caja de la tienda: el hub conoce el cupón → aplica y el cobro baja $50
    const c = await comprar(c2, [JEANS], { cupon: g.codigo });
    assert.equal(c.cupon.json.cupon.monto, 5000);
    assert.equal(c.venta.total, 89900 - 5000);
    ctx.m.pump(); ctx.m.pump(); ctx.m.pump();
    // un solo uso: ni en la misma caja ni en la que lo emitió
    for (const caja of [c2, c1]) {
      const cart = (await api(caja.url, '/api/venta/nueva', {})).json.cart;
      await api(caja.url, '/api/venta/escanear', { cart, codigo: JEANS });
      const otra = await api(caja.url, '/api/venta/cupon', { cart, codigo: g.codigo });
      assert.match(otra.json.error.mensaje, /ya se usó/);
    }
    // solo en la tienda que lo emitió: London no lo conoce
    const cartL = (await api(l1.url, '/api/venta/nueva', {})).json.cart;
    await api(l1.url, '/api/venta/escanear', { cart: cartL, codigo: JEANS });
    const enL = await api(l1.url, '/api/venta/cupon', { cart: cartL, codigo: g.codigo });
    assert.equal(enL.json.error.codigo, 'CUPON_NO_APLICA');
    // el reporte de Administración cuenta lo regalado y lo canjeado
    ctx.m.pump(); ctx.m.pump(); ctx.m.pump();
    const r = (await api(adm.url, '/api/admin/recompensas')).json.recompensas[0];
    assert.deepEqual([r.regaladas, r.canjeadas], [1, 1]);
  });

  it('RE4 vigencia por fechas, cancelación de la venta que lo regaló y código inexistente', async (t) => {
    const { ctx, adm, c1 } = await preparar(t);
    const l = (await api(adm.url, '/api/admin/recompensas')).json.recompensas[0];
    await api(adm.url, '/api/admin/recompensas', { ...regla({ cupon: { pct: 20, minimo: 0, vigencia: { modo: 'fechas', inicio: '2027-01-10', fin: '2027-01-20' } } }), id: l.id });
    ctx.m.pump(); ctx.m.pump(); ctx.m.pump();
    const g = await comprar(c1, [JEANS, JEANS]);
    const e = g.venta.recompensas[0];
    assert.deepEqual([e.pct, e.valido_desde, e.valido_hasta], [20, '2027-01-10', '2027-01-20']);
    assert.match(g.ticket, /20% de descuento en tu próxima compra/);
    assert.match(g.ticket, /Válido del 10\/01\/2027 al 20\/01\/2027/);
    // todavía no empieza (hoy es octubre de 2026)
    const cart = (await api(c1.url, '/api/venta/nueva', {})).json.cart;
    await api(c1.url, '/api/venta/escanear', { cart, codigo: JEANS });
    assert.match((await api(c1.url, '/api/venta/cupon', { cart, codigo: e.codigo })).json.error.mensaje, /empieza el 2027-01-10/);
    // se cancela la venta que lo regaló: el cupón se anula
    assert.equal((await api(c1.url, '/api/venta/cancelar', { sale_id: g.venta.sale_id, motivo: 'error' })).status, 200);
    assert.match((await api(c1.url, '/api/venta/cupon', { cart, codigo: e.codigo })).json.error.mensaje, /se anuló/);
    assert.match((await api(c1.url, '/api/venta/cupon', { cart, codigo: 'RC-DUO1-999999-1' })).json.error.mensaje, /no existe/);
  });
});
