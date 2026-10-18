import assert from 'node:assert/strict';
import { it } from 'node:test';
import { nuevoMundo, politica, porAlmacen, servicioDe } from './ayudas/comun.ts';

porAlmacen('Tarjeta con captura manual del comprobante', (alm) => {
  it('TM1 todo con tarjeta: venta con folio, autorización en el ticket, sin cobro pendiente y en el corte como tarjeta', async (t) => {
    const ctx = nuevoMundo(alm, politica());
    t.after(ctx.limpiar);
    const s = servicioDe(ctx, 'DUO', 1, 'Ana');
    const c = s.svc.nuevaVenta();
    s.svc.escanear(c, '0002026090782');
    const total = s.svc.vista(c).total;
    const r = await s.svc.cobrarTarjetaManual(c, { autorizacion: ' ab1234 ', marca: 'Visa', ultimos4: '4321' });
    assert.equal(r.venta.pagos.length, 1);
    assert.deepEqual([r.venta.pagos[0]!.metodo, r.venta.pagos[0]!.monto, r.venta.pagos[0]!.autorizacion, r.venta.pagos[0]!.marca, r.venta.pagos[0]!.ultimos4], ['tarjeta', total, 'AB1234', 'Visa', '4321']);
    assert.match(r.ticket_texto, /Tarjeta/);
    assert.match(r.ticket_texto, /Aut\. AB1234\s+VISA \*\*\*\*4321/);
    assert.equal(ctx.m.caja('DUO', 1).pendientesDeConciliar().length, 0);
    // doble clic: misma venta
    const otra = await s.svc.cobrarTarjetaManual(c, { autorizacion: 'AB1234' });
    assert.equal(otra.venta.sale_id, r.venta.sale_id);
  });

  it('TM2 mixto: tarjeta parcial y el resto en efectivo exacto; suma exacta al total', async (t) => {
    const ctx = nuevoMundo(alm, politica());
    t.after(ctx.limpiar);
    const s = servicioDe(ctx, 'DUO', 1, 'Ana');
    const c = s.svc.nuevaVenta();
    s.svc.escanear(c, '0002026090782');
    const total = s.svc.vista(c).total;
    const r = await s.svc.cobrarTarjetaManual(c, { importe: 10000, autorizacion: '998877' });
    assert.deepEqual(r.venta.pagos.map((p) => [p.metodo, p.monto]), [['tarjeta', 10000], ['efectivo', total - 10000]]);
    assert.equal(r.venta.pagos.reduce((a, p) => a + p.monto, 0), total);
  });

  it('TM3 validaciones: autorización, últimos 4, importes, caja sin terminal; los rechazos no dejan cobros pendientes', async (t) => {
    const ctx = nuevoMundo(alm, politica());
    t.after(ctx.limpiar);
    const s = servicioDe(ctx, 'DUO', 1, 'Ana');
    const c = s.svc.nuevaVenta();
    await assert.rejects(() => s.svc.cobrarTarjetaManual(c, { autorizacion: '123456' }), { codigo: 'CARRITO_VACIO' });
    s.svc.escanear(c, '0002026090782');
    const total = s.svc.vista(c).total;
    await assert.rejects(() => s.svc.cobrarTarjetaManual(c, { autorizacion: '' }), { codigo: 'DATOS_REQUERIDOS' });
    await assert.rejects(() => s.svc.cobrarTarjetaManual(c, { autorizacion: '12' }), { codigo: 'DATOS_REQUERIDOS' });
    await assert.rejects(() => s.svc.cobrarTarjetaManual(c, { autorizacion: '123456', ultimos4: '12' }), { codigo: 'DATOS_REQUERIDOS' });
    await assert.rejects(() => s.svc.cobrarTarjetaManual(c, { autorizacion: '123456', importe: total + 1 }), { codigo: 'PAGO_INVALIDO' });
    await assert.rejects(() => s.svc.cobrarTarjetaManual(c, { autorizacion: '123456', importe: 0 }), { codigo: 'PAGO_INVALIDO' });
    assert.equal(ctx.m.caja('DUO', 1).pendientesDeConciliar().length, 0);
    const b = servicioDe(ctx, 'DUO', 2, 'Beto');
    const c2 = b.svc.nuevaVenta();
    b.svc.escanear(c2, '0002026090782');
    await assert.rejects(() => b.svc.cobrarTarjetaManual(c2, { autorizacion: '123456' }), { codigo: 'PAGO_NO_PERMITIDO' });
    // sigue pudiendo cobrarse normal
    const ok = await s.svc.cobrarTarjetaManual(c, { autorizacion: '123456' });
    assert.equal(ok.venta.estado, 'confirmada');
  });
});
