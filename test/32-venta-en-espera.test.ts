import assert from 'node:assert/strict';
import { it } from 'node:test';
import { nuevoMundo, politica, porAlmacen, servicioDe } from './ayudas/comun.ts';

porAlmacen('Venta en espera: guardar, retomar y descartar', (alm) => {
  it('VE1 se guarda con nota, la caja abre una venta nueva y la guardada se retoma intacta', async (t) => {
    const ctx = nuevoMundo(alm, politica());
    t.after(ctx.limpiar);
    const s = servicioDe(ctx, 'DUO', 1, 'Ana');
    const c1 = s.svc.nuevaVenta();
    s.svc.escanear(c1, '0002026090782');
    s.svc.escanear(c1, '0002026090799');
    const antes = s.svc.vista(c1);
    const r = s.svc.ponerEnEspera(c1, '  Sra. Lupe  ');
    assert.notEqual(r.cart, c1);
    assert.equal(r.carrito.lineas.length, 0);
    assert.equal(r.espera.length, 1);
    assert.equal(r.espera[0]!.nota, 'Sra. Lupe');
    assert.equal(r.espera[0]!.piezas, antes.piezas);
    assert.equal(r.espera[0]!.total, antes.total);
    assert.equal(s.svc.carritoActual(), r.cart, 'la venta en pantalla es la nueva, no la guardada');
    // una venta en espera no se puede tocar hasta retomarla? sí se puede retomar desde otra con artículos
    s.svc.escanear(r.cart, '7501234567890');
    const t2 = s.svc.retomarVenta(c1, r.cart);
    assert.equal(t2.cart, c1);
    assert.equal(t2.carrito.piezas, antes.piezas);
    assert.equal(t2.carrito.total, antes.total);
    assert.equal(t2.espera.length, 1, 'la venta que estaba en pantalla quedó en espera');
    assert.equal(s.svc.carritoActual(), c1);
    const venta = await s.svc.cobrarEfectivo(c1, 500000, 0);
    assert.equal(venta.venta.total, antes.total);
  });

  it('VE2 una venta vacía no se pone en espera y al retomar una guardada la vacía se descarta sin anulación', async (t) => {
    const ctx = nuevoMundo(alm, politica());
    t.after(ctx.limpiar);
    const s = servicioDe(ctx, 'DUO', 1, 'Ana');
    const vacia = s.svc.nuevaVenta();
    assert.throws(() => s.svc.ponerEnEspera(vacia, ''), { codigo: 'CARRITO_VACIO' });
    const c1 = s.svc.nuevaVenta();
    s.svc.escanear(c1, '0002026090782');
    const { cart: c2 } = s.svc.ponerEnEspera(c1, '');
    s.svc.retomarVenta(c1, c2);
    assert.deepEqual(ctx.m.caja('DUO', 1).carritosActivos().filter((x) => x === c2), [], 'la venta vacía se descartó');
    assert.equal(ctx.m.central.repo.ops().filter((o) => o.tipo === 'sale.voided').length, 0, 'sin constancia de anulación para una venta vacía');
  });

  it('VE3 descartar una guardada deja la constancia de anulación; el cobro con tarjeta o venta confirmada no se pone en espera', async (t) => {
    const ctx = nuevoMundo(alm, politica());
    t.after(ctx.limpiar);
    const s = servicioDe(ctx, 'DUO', 1, 'Ana');
    const c1 = s.svc.nuevaVenta();
    s.svc.escanear(c1, '0002026090782');
    const { espera } = s.svc.ponerEnEspera(c1, 'x');
    assert.equal(espera.length, 1);
    const r = s.svc.descartarEnEspera(c1);
    assert.equal(r.espera.length, 0);
    const voided = ctx.m.caja('DUO', 1).repo.ops().filter((o) => o.tipo === 'sale.voided');
    assert.equal(voided.length, 1);
    assert.equal(voided[0]!.payload.motivo, 'venta en espera descartada');
    const c2 = s.svc.nuevaVenta();
    s.svc.escanear(c2, '0002026090782');
    await s.svc.cobrarEfectivo(c2, 500000, 0);
    assert.throws(() => s.svc.ponerEnEspera(c2, ''), { codigo: 'CARRITO_CERRADO' });
  });

  it('VE4 las ventas en espera son de cada caja y dejan constancia (en espera / retomada)', async (t) => {
    const ctx = nuevoMundo(alm, politica());
    t.after(ctx.limpiar);
    const a = servicioDe(ctx, 'DUO', 1, 'Ana');
    const b = servicioDe(ctx, 'DUO', 2, 'Beto');
    const c1 = a.svc.nuevaVenta();
    a.svc.escanear(c1, '0002026090782');
    a.svc.ponerEnEspera(c1, 'k');
    assert.equal(b.svc.ventasEnEspera().length, 0);
    a.svc.retomarVenta(c1);
    const ops = ctx.m.caja('DUO', 1).repo.ops().filter((o) => o.tipo.startsWith('cart.'));
    assert.deepEqual(ops.map((o) => o.tipo), ['cart.en_espera', 'cart.retomada']);
    assert.equal(ops[0]!.payload.nota, 'k');
  });
});
