import assert from 'node:assert/strict';
import { it } from 'node:test';
import { detectar } from '../src/incidencias.ts';
import { devoluciones, ventas } from '../src/proyecciones.ts';
import { nuevoMundo, politica, porAlmacen, vender } from './ayudas/comun.ts';

porAlmacen('Deduplicación frente a conflictos de negocio (devoluciones)', (alm) => {
  it('V1 devolución parcial proporcional al descuento realmente pagado; la última unidad absorbe el redondeo', (t) => {
    const { m, items, limpiar } = nuevoMundo(alm, politica());
    t.after(limpiar);
    const { venta } = vender(m, 'DUO', 1, items[2]!.item_id, 3, { descuento: 1000 }); // 3×120.00 − 10.00 = 350.00
    assert.equal(venta.total, 35000);
    const c = m.caja('DUO', 1);
    const l = venta.lineas[0]!.linea_id;
    assert.equal(c.devolver({ sale_id: venta.sale_id, renglones: [{ linea_id: l, qty: 1 }], motivo: 'a' }).importe, 11666);
    assert.equal(c.devolver({ sale_id: venta.sale_id, renglones: [{ linea_id: l, qty: 1 }], motivo: 'b' }).importe, 11666);
    assert.equal(c.devolver({ sale_id: venta.sale_id, renglones: [{ linea_id: l, qty: 1 }], motivo: 'c' }).importe, 11668, '35000 = 11666 + 11666 + 11668');
    assert.throws(() => c.devolver({ sale_id: venta.sale_id, renglones: [{ linea_id: l, qty: 1 }], motivo: 'd' }), { codigo: 'DEVOLUCION_EXCEDE' });
  });

  it('V2 reintento de la misma devolución (mismo id) no devuelve dos veces ni suma dos veces las existencias', (t) => {
    const { m, items, limpiar } = nuevoMundo(alm, politica());
    t.after(limpiar);
    const { venta } = vender(m, 'DUO', 1, items[2]!.item_id, 2);
    const c = m.caja('DUO', 1);
    const antes = c.stockLocal(items[2]!.item_id);
    const args = { sale_id: venta.sale_id, renglones: [{ linea_id: venta.lineas[0]!.linea_id, qty: 1 }], motivo: 'x', devolucion_id: 'dev-fija' };
    c.devolver(args);
    c.devolver(args);
    assert.equal(devoluciones(c.ops()).length, 1);
    assert.equal(c.stockLocal(items[2]!.item_id), antes + 1);
  });

  it('V3 P-03 (decidido): una devolución se hace SOLO en la caja donde se vendió; la otra caja indica cuál es', (t) => {
    const { m, items, limpiar } = nuevoMundo(alm, politica());
    t.after(limpiar);
    const { venta } = vender(m, 'DUO', 1, items[2]!.item_id, 1);
    const lin = venta.lineas[0]!.linea_id;
    const arg = { sale_id: venta.sale_id, renglones: [{ linea_id: lin, qty: 1 }], motivo: 'x' };
    m.pump();
    assert.throws(() => m.caja('DUO', 2).devolver(arg), (e: any) => e.codigo === 'DEVOLUCION_OTRA_CAJA' && e.detalle.caja === 1 && /Caja 1/.test(e.message));
    assert.equal(m.caja('DUO', 2).estadoFolios().ultimo, 0, 'lo rechazado no consume folio');
    assert.equal(m.caja('DUO', 1).devolver(arg).caja, 1);
  });

  it('V4 sin hub la otra caja ni siquiera ve la venta: se bloquea; con el ticket (snapshot) sigue siendo la caja equivocada', (t) => {
    const a = nuevoMundo(alm, politica({ P03_devolucion_venta_no_local: 'bloquear' }));
    const b = nuevoMundo(alm, politica({ P03_devolucion_venta_no_local: 'permitir_con_incidencia' }));
    t.after(() => { a.limpiar(); b.limpiar(); });
    for (const ctx of [a, b]) {
      const { venta } = vender(ctx.m, 'DUO', 1, ctx.items[2]!.item_id, 1);
      ctx.m.caerHub('DUO');
      const arg = { sale_id: venta.sale_id, renglones: [{ linea_id: venta.lineas[0]!.linea_id, qty: 1 }], motivo: 'x', ventaSnapshot: venta };
      assert.throws(() => ctx.m.caja('DUO', 2).devolver(arg), { codigo: ctx === a ? 'DEVOLUCION_BLOQUEADA' : 'DEVOLUCION_OTRA_CAJA' });
      assert.throws(() => ctx.m.caja('DUO', 2).devolver({ ...arg, ventaSnapshot: undefined }), { codigo: 'DEVOLUCION_BLOQUEADA' }, 'sin ticket ni hub no hay datos');
    }
  });

  it('V5 reintento y doble devolución: con una sola caja autorizada no hay doble devolución entre cajas; el exceso se rechaza', (t) => {
    const { m, items, limpiar } = nuevoMundo(alm, politica());
    t.after(limpiar);
    const { venta } = vender(m, 'DUO', 1, items[2]!.item_id, 1);
    const arg = { sale_id: venta.sale_id, renglones: [{ linea_id: venta.lineas[0]!.linea_id, qty: 1 }], motivo: 'x' };
    m.caja('DUO', 1).devolver(arg);
    assert.throws(() => m.caja('DUO', 1).devolver({ ...arg, motivo: 'otra vez' }), { codigo: 'DEVOLUCION_EXCEDE' });
    m.pump();
    assert.deepEqual(detectar(m.central.repo.ops()).filter((i) => i.tipo === 'devolucion_excede_vendido' || i.tipo.startsWith('folio_')), []);
  });

  it('V6 devolver una venta cancelada se rechaza; la devolución entrega efectivo de su caja (corte) y usa folio de la serie', (t) => {
    const { m, items, limpiar } = nuevoMundo(alm, politica());
    t.after(limpiar);
    const { venta } = vender(m, 'DUO', 1, items[2]!.item_id, 1);
    m.pump();
    m.reloj.avanzar(1000);
    const d = m.caja('DUO', 1).devolver({ sale_id: venta.sale_id, renglones: [{ linea_id: venta.lineas[0]!.linea_id, qty: 1 }], motivo: 'x' });
    assert.equal(d.caja, 1, 'afecta el efectivo de la caja que entrega el dinero (la misma que vendió)');
    assert.equal(d.folio, 2, 'la devolución usa el siguiente folio de la serie de ventas (P-08)');
    const fecha = '2026-10-01';
    assert.equal(m.caja('DUO', 1).generarCorte(fecha).devoluciones, 12000);
    assert.equal(m.caja('DUO', 2).generarCorte(fecha).devoluciones, 0);
    const v2 = vender(m, 'DUO', 1, items[2]!.item_id, 1).venta;
    m.caja('DUO', 1).cancelarVenta(v2.sale_id, 'x');
    assert.throws(() => m.caja('DUO', 1).devolver({ sale_id: v2.sale_id, renglones: [{ linea_id: v2.lineas[0]!.linea_id, qty: 1 }], motivo: 'x' }), { codigo: 'DEVOLUCION_BLOQUEADA' });
    assert.equal(ventas(m.caja('DUO', 1).ops()).get(venta.sale_id)!.estado, 'confirmada', 'devolver no altera la venta original');
  });
});
