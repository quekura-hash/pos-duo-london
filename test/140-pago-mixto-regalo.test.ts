import assert from 'node:assert/strict';
import { it } from 'node:test';
import { nuevoMundo, politica, porAlmacen, servicioDe } from './ayudas/comun.ts';

const VESTIDO = '0002026090782'; // $899.00

porAlmacen('Pago mixto: tarjeta de regalo + tarjeta bancaria + efectivo', (alm) => {
  const prep = (t: { after: (f: () => void) => void }, saldo = 50000) => {
    const ctx = nuevoMundo(alm, politica());
    t.after(ctx.limpiar);
    const s = servicioDe(ctx, 'DUO', 1, 'Ana');
    s.svc.caja.altaTarjetaRegalo({ codigo: 'GC-1', monto: saldo, ref: 'gc1', cajero: 'Ana' });
    ctx.m.pump(); ctx.m.pump();
    const venta = () => { const c = s.svc.nuevaVenta(); s.svc.escanear(c, VESTIDO); return c; };
    const metodos = (v: { pagos: { metodo: string; monto: number }[] }) => v.pagos.map((p) => [p.metodo, p.monto]);
    return { ctx, s, venta, metodos };
  };
  it('MX1 tarjeta de regalo + tarjeta bancaria (sin efectivo): $500 + $399', async (t) => {
    const { s, venta, metodos } = prep(t);
    const c = venta();
    const v = (await s.svc.cobrarTarjetaManual(c, { autorizacion: 'A123', importe: 39900, regalo: 'GC-1' })).venta;
    assert.deepEqual(metodos(v), [['tarjeta_regalo', 50000], ['tarjeta', 39900]]);
    assert.equal(v.total, 89900);
    assert.equal(s.svc.caja.saldoTarjeta('GC-1'), 0);
  });
  it('MX2 los tres: regalo $500 + tarjeta $300 + efectivo $99', async (t) => {
    const { s, venta, metodos } = prep(t);
    const c = venta();
    const v = (await s.svc.cobrarTarjetaManual(c, { autorizacion: 'A123', importe: 30000, regalo: 'GC-1' })).venta;
    assert.deepEqual(metodos(v), [['tarjeta_regalo', 50000], ['tarjeta', 30000], ['efectivo', 9900]]);
    assert.equal(v.pagos.reduce((a, p) => a + p.monto, 0), v.total);
  });
  it('MX3 regalo + efectivo sigue funcionando (el caso de la venta 53143: $500 + $44)', async (t) => {
    const { s, venta, metodos } = prep(t);
    const c = venta();
    const v = (await s.svc.cobrarTarjetaRegalo(c, 'GC-1', 39900)).venta;
    assert.deepEqual(metodos(v), [['tarjeta_regalo', 50000], ['efectivo', 39900]]);
  });
  it('MX4 el saldo cubre todo: no se cobra con la terminal; y un saldo mayor que la venta solo usa lo necesario', async (t) => {
    const { s, venta, metodos } = prep(t, 100000);
    const c = venta();
    const v = (await s.svc.cobrarTarjetaManual(c, { regalo: 'GC-1' })).venta;
    assert.deepEqual(metodos(v), [['tarjeta_regalo', 89900]]);
    assert.equal(s.svc.caja.saldoTarjeta('GC-1'), 10100);
  });
  it('MX5 validaciones: tarjeta inexistente, importe de tarjeta que excede lo que falta, y la venta no se confirma', async (t) => {
    const { s, venta } = prep(t);
    const c = venta();
    await assert.rejects(s.svc.cobrarTarjetaManual(c, { autorizacion: 'A123', importe: 30000, regalo: 'NOEXISTE' }), { codigo: 'TARJETA_INEXISTENTE' });
    await assert.rejects(s.svc.cobrarTarjetaManual(c, { autorizacion: 'A123', importe: 40000, regalo: 'GC-1' }), { codigo: 'PAGO_INVALIDO' }); // faltan $399, no $400
    assert.equal(s.svc.caja.saldoTarjeta('GC-1'), 50000, 'el saldo no se tocó');
    assert.equal(s.svc.caja.opsVentas().filter((o) => o.tipo === 'sale.confirmed' && o.payload.sale_id === c).length, 0);
  });
  it('MX6 el corte separa cada medio y la devolución regresa cada parte a donde salió', async (t) => {
    const { ctx, s, venta } = prep(t);
    const c = venta();
    const v = (await s.svc.cobrarTarjetaManual(c, { autorizacion: 'A123', importe: 30000, regalo: 'GC-1' })).venta;
    const corte = s.svc.corte(ctx.m.reloj.now().slice(0, 10)).vivo;
    assert.equal(corte.cobros_tarjeta_regalo, 50000);
    assert.equal(corte.cobros_tarjeta, 30000);
    assert.equal(corte.mxn.cobros, 50000 + 9900, 'el efectivo de la venta ($99) más el de la alta de la tarjeta ($500)');
    const dev = s.svc.caja.devolver({ sale_id: v.sale_id, renglones: [{ linea_id: v.lineas[0]!.linea_id, qty: 1 }], motivo: 'x' });
    assert.deepEqual(dev.reembolsos.map((r) => [r.metodo, r.monto]).sort(), [['efectivo', 9900], ['tarjeta', 30000], ['tarjeta_regalo', 50000]].sort());
    assert.equal(s.svc.caja.saldoTarjeta('GC-1'), 50000, 'el saldo vuelve a la tarjeta');
  });
  it('MX7 efectivo recibido y cambio en el mixto: $99 con un billete de $100 deja $1 de cambio y el corte lo descuenta', async (t) => {
    const { ctx, s, venta } = prep(t);
    const c = venta();
    const v = (await s.svc.cobrarTarjetaManual(c, { autorizacion: 'A123', importe: 30000, regalo: 'GC-1', recibido: 10000 })).venta;
    const ef = v.pagos.find((p) => p.metodo === 'efectivo')!;
    assert.deepEqual([ef.monto, ef.recibido, ef.cambio], [9900, 10000, 100]);
    const corte = s.svc.corte(ctx.m.reloj.now().slice(0, 10)).vivo;
    assert.equal(corte.mxn.cambio, 100);
    const c2 = venta();
    await assert.rejects(s.svc.cobrarTarjetaManual(c2, { autorizacion: 'A123', importe: 30000, recibido: 5000 }), { codigo: 'EFECTIVO_INSUFICIENTE' }); // faltan $599, recibió $50
  });
});
