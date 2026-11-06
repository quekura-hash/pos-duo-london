import assert from 'node:assert/strict';
import { it } from 'node:test';
import { reporteDeCaja } from '../src/reporte-contadora.ts';
import { conVentasCorregidas } from '../src/proyecciones.ts';
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
    const op = crearOp('venta.corregida', 'DUO', 1, 'admin', ctx.m.reloj.now(), {
      sale_id: venta.sale_id, tienda: 'DUO', caja: 1, folio: venta.folio, pagos: [{ metodo: 'tarjeta', monto: 50000, autorizacion: '1234' }], medio: 'tarjeta',
      motivo: 'La tarjeta de regalo se cobró con tarjeta de crédito, no en efectivo', por: 'Edgardo',
    }, `venta.corregida:${venta.sale_id}`);
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
    const corregidas = conVentasCorregidas(ops);
    assert.equal(corregidas.find((o) => o.tipo === 'giftcard.emitida')!.payload.medio, 'tarjeta');
    const v = corregidas.find((o) => o.tipo === 'sale.confirmed')!.payload;
    assert.deepEqual(v.pagos_originales.map((p: any) => p.metodo), ['efectivo']);
    assert.equal(corregidas.some((o) => o.tipo === 'venta.corregida'), false);
  });

  it('PC2 un renglón cobrado como artículo que en realidad era una tarjeta de regalo: pasa a contar como tarjeta vendida y no como mercancía; el pago no cambia', async (t) => {
    const ctx = nuevoMundo(alm, politica());
    t.after(ctx.limpiar);
    const s = servicioDe(ctx, 'DUO', 1, 'Ana');
    const c1 = s.svc.nuevaVenta(); s.svc.escanear(c1, '7501234567890'); // mascada $120, tomada aquí como si fuera la «tarjeta de regalo»
    const venta = (await s.svc.cobrarTarjetaManual(c1, { autorizacion: '2397' })).venta;
    const hoy = ctx.m.reloj.now().slice(0, 10);
    const antes = s.svc.corte(hoy).vivo;
    assert.deepEqual([antes.ventas_mercancia, antes.tarjetas_regalo_vendidas, antes.cobros_tarjeta], [12000, 0, 12000]);
    const op = crearOp('venta.corregida', 'DUO', 1, 'admin', ctx.m.reloj.now(), {
      sale_id: venta.sale_id, tienda: 'DUO', caja: 1, folio: venta.folio, tarjetas_regalo: [{ linea_id: venta.lineas[0]!.linea_id, codigo: '102251044', meses: 4 }],
      motivo: 'Se cobró como artículo; en realidad es la tarjeta de regalo 102251044', por: 'Edgardo',
    }, `venta.corregida:${venta.sale_id}`);
    ctx.m.central.repo.appendOp(op);
    ctx.m.hub('DUO').recibir(op, 'central');
    ctx.m.pump(); ctx.m.pump(); ctx.m.pump();
    const despues = s.svc.corte(hoy).vivo;
    assert.deepEqual([despues.ventas_mercancia, despues.tarjetas_regalo_vendidas, despues.cobros_tarjeta, despues.ventas], [0, 12000, 12000, 12000], 'la misma venta y el mismo cobro, pero como tarjeta de regalo');
    const v = conVentasCorregidas(ctx.m.central.repo.ops()).find((o) => o.tipo === 'sale.confirmed')!.payload;
    assert.deepEqual([v.lineas[0].tarjeta_regalo.codigo, v.lineas[0].departamento, v.pagos[0].autorizacion], ['102251044', 'TARJETAS DE REGALO', '2397']);
    assert.equal(v.pagos_originales, undefined, 'el pago no se tocó');
  });
});
