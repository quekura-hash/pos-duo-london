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

  it('V3 con hub disponible la autoridad PREVIENE la doble devolución entre cajas de la misma tienda', (t) => {
    const { m, items, limpiar } = nuevoMundo(alm, politica());
    t.after(limpiar);
    const { venta } = vender(m, 'DUO', 1, items[2]!.item_id, 1);
    m.pump();
    const lin = venta.lineas[0]!.linea_id;
    m.caja('DUO', 1).devolver({ sale_id: venta.sale_id, renglones: [{ linea_id: lin, qty: 1 }], motivo: 'caja1' });
    m.pump();
    // Caja 2 no conoce la venta (no es de su caja) pero la consulta al hub; el hub ya registró la devolución
    assert.throws(() => m.caja('DUO', 2).devolver({ sale_id: venta.sale_id, renglones: [{ linea_id: lin, qty: 1 }], motivo: 'caja2' }), { codigo: 'DEVOLUCION_EXCEDE' });
  });

  it('V4 con ambas cajas aisladas (P-03=permitir_con_incidencia) la doble devolución NO se puede evitar: se detecta, ambas quedan y se señala', (t) => {
    const { m, items, limpiar } = nuevoMundo(alm, politica({ P03_devolucion_venta_no_local: 'permitir_con_incidencia' }));
    t.after(limpiar);
    const { venta } = vender(m, 'DUO', 1, items[2]!.item_id, 1);
    m.pump();
    const lin = venta.lineas[0]!.linea_id;
    m.caerHub('DUO');
    m.caja('DUO', 1).devolver({ sale_id: venta.sale_id, renglones: [{ linea_id: lin, qty: 1 }], motivo: 'caja1' });
    m.caja('DUO', 2).devolver({ sale_id: venta.sale_id, renglones: [{ linea_id: lin, qty: 1 }], motivo: 'caja2', ventaSnapshot: venta });
    m.levantarHub('DUO');
    m.pump();
    m.pump();
    assert.equal(devoluciones(m.central.repo.ops()).length, 2, 'ninguna operación se descarta ni se modifica');
    const inc = detectar(m.central.repo.ops()).filter((i) => i.tipo === 'devolucion_excede_vendido');
    assert.equal(inc.length, 1);
    assert.deepEqual([inc[0]!.vendido, inc[0]!.devuelto], [1, 2]);
  });

  it('V5 P-03=bloquear: sin acceso a la venta original no se devuelve; con P-03 permitir exige el ticket', (t) => {
    const a = nuevoMundo(alm, politica({ P03_devolucion_venta_no_local: 'bloquear' }));
    const b = nuevoMundo(alm, politica({ P03_devolucion_venta_no_local: 'permitir_con_incidencia' }));
    t.after(() => { a.limpiar(); b.limpiar(); });
    for (const ctx of [a, b]) {
      const { venta } = vender(ctx.m, 'DUO', 1, ctx.items[2]!.item_id, 1);
      ctx.m.caerHub('DUO');
      const lin = venta.lineas[0]!.linea_id;
      if (ctx === a) {
        assert.throws(() => ctx.m.caja('DUO', 2).devolver({ sale_id: venta.sale_id, renglones: [{ linea_id: lin, qty: 1 }], motivo: 'x', ventaSnapshot: venta }), { codigo: 'DEVOLUCION_BLOQUEADA' });
      } else {
        assert.throws(() => ctx.m.caja('DUO', 2).devolver({ sale_id: venta.sale_id, renglones: [{ linea_id: lin, qty: 1 }], motivo: 'x' }), { codigo: 'DEVOLUCION_BLOQUEADA' }, 'sin ticket no hay datos');
        const d = ctx.m.caja('DUO', 2).devolver({ sale_id: venta.sale_id, renglones: [{ linea_id: lin, qty: 1 }], motivo: 'x', ventaSnapshot: venta });
        assert.equal((d as any).verificacion, 'ticket_sin_verificar');
      }
    }
  });

  it('V6 devolver una venta cancelada se rechaza; la devolución entrega efectivo de la caja que devuelve (corte)', (t) => {
    const { m, items, limpiar } = nuevoMundo(alm, politica());
    t.after(limpiar);
    const { venta } = vender(m, 'DUO', 1, items[2]!.item_id, 1);
    m.pump();
    m.reloj.avanzar(1000);
    const d = m.caja('DUO', 2).devolver({ sale_id: venta.sale_id, renglones: [{ linea_id: venta.lineas[0]!.linea_id, qty: 1 }], motivo: 'x' });
    assert.equal(d.caja, 2, 'afecta el efectivo de la caja que entrega el dinero');
    const fecha = '2026-10-01';
    assert.equal(m.caja('DUO', 2).generarCorte(fecha).devoluciones, 12000);
    assert.equal(m.caja('DUO', 1).generarCorte(fecha).devoluciones, 0);
    const v2 = vender(m, 'DUO', 1, items[2]!.item_id, 1).venta;
    m.caja('DUO', 1).cancelarVenta(v2.sale_id, 'x');
    assert.throws(() => m.caja('DUO', 1).devolver({ sale_id: v2.sale_id, renglones: [{ linea_id: v2.lineas[0]!.linea_id, qty: 1 }], motivo: 'x' }), { codigo: 'DEVOLUCION_BLOQUEADA' });
    assert.equal(ventas(m.caja('DUO', 1).ops()).get(venta.sale_id)!.estado, 'confirmada', 'devolver no altera la venta original');
  });
});
