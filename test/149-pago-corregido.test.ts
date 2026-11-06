import assert from 'node:assert/strict';
import { it } from 'node:test';
import { reporteDeCaja } from '../src/reporte-contadora.ts';
import { conPagosCorregidos } from '../src/proyecciones.ts';
import { crearOp } from '../src/util.ts';
import { nuevoMundo, politica, porAlmacen, servicioDe } from './ayudas/comun.ts';

porAlmacen('Corrección de la forma de pago de una venta ya registrada (efectivo → tarjeta)', (alm) => {
  it('PC1 la venta conserva su folio y total; el corte de la caja y el reporte la cuentan con la tarjeta, no en efectivo', async (t) => {
    const ctx = nuevoMundo(alm, politica());
    t.after(ctx.limpiar);
    const s = servicioDe(ctx, 'DUO', 1, 'Ana');
    const { venta } = await s.svc.altaTarjetaRegalo('GC-1', 50000, undefined, 'ref-1'); // se cobró «en efectivo» y en realidad fue con tarjeta
    const hoy = ctx.m.reloj.now().slice(0, 10);
    const antes = s.svc.corte(hoy).vivo;
    assert.deepEqual([antes.cobros_efectivo, antes.cobros_tarjeta], [50000, 0]);
    const op = crearOp('venta.pago_corregido', 'DUO', 1, 'admin', ctx.m.reloj.now(), {
      sale_id: venta.sale_id, tienda: 'DUO', caja: 1, folio: venta.folio, pagos: [{ metodo: 'tarjeta', monto: 50000, autorizacion: '1234' }], medio: 'tarjeta',
      motivo: 'La tarjeta de regalo se cobró con tarjeta de crédito, no en efectivo', por: 'Edgardo',
    }, `venta.pago_corregido:${venta.sale_id}`);
    ctx.m.central.repo.appendOp(op); // la nube ya tiene la corrección (así la lee Administración y el reporte de la contadora)
    ctx.m.hub('DUO').recibir(op, 'central'); // y baja a la tienda
    ctx.m.pump(); ctx.m.pump(); ctx.m.pump();
    const despues = s.svc.corte(hoy).vivo;
    assert.deepEqual([despues.cobros_efectivo, despues.cobros_tarjeta, despues.ventas], [0, 50000, 50000], 'misma venta, otra forma de pago');
    assert.equal(despues.efectivo_esperado, antes.efectivo_esperado - 50000, 'ese dinero nunca estuvo en el cajón');
    // reporte de la contadora (lee las operaciones de la nube)
    const ops = ctx.m.central.repo.ops();
    const rep = reporteDeCaja(ops, 'DUO', 1, hoy.slice(0, 7));
    assert.deepEqual([rep.total, rep.efectivo, rep.tarjeta, rep.tickets], [50000, 0, 50000, 1]);
    // la emisión de la tarjeta dice «tarjeta» y la venta guarda sus pagos originales
    const corregidas = conPagosCorregidos(ops);
    assert.equal(corregidas.find((o) => o.tipo === 'giftcard.emitida')!.payload.medio, 'tarjeta');
    const v = corregidas.find((o) => o.tipo === 'sale.confirmed')!.payload;
    assert.deepEqual(v.pagos_originales.map((p: any) => p.metodo), ['efectivo']);
    assert.equal(corregidas.some((o) => o.tipo === 'venta.pago_corregido'), false);
  });
});
