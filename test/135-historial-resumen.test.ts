import assert from 'node:assert/strict';
import { it } from 'node:test';
import { ServicioAdmin } from '../src/app/servicio.ts';
import { nuevoMundo, politica, porAlmacen, vender } from './ayudas/comun.ts';

porAlmacen('Historial de ventas: resumen del periodo (total, tickets y ticket promedio)', (alm) => {
  const admin = (ctx: ReturnType<typeof nuevoMundo>) => new ServicioAdmin({ central: ctx.m.central, actor: { rol: 'admin', usuario: 'galo' }, fuente: () => ctx.m.central.repo.ops(), cajas: [{ tienda: 'DUO', caja: 1 }, { tienda: 'DUO', caja: 2 }, { tienda: 'LON', caja: 1 }], reloj: ctx.m.reloj } as any);
  it('HR1 periodo vacío: $0, 0 tickets y ticket promedio 0 (sin dividir entre cero)', (t) => {
    const ctx = nuevoMundo(alm, politica());
    t.after(ctx.limpiar);
    const r = admin(ctx).historialVentas({}).resumen;
    assert.deepEqual([r.total_ventas, r.tickets, r.ticket_promedio], [0, 0, 0]);
  });
  it('HR2 usa la misma fórmula que las ventas netas del resumen del día: resta devoluciones, no cuenta canceladas y respeta la caja', (t) => {
    const ctx = nuevoMundo(alm, politica());
    t.after(ctx.limpiar);
    const { m, items } = ctx;
    const a = vender(m, 'DUO', 1, items[2]!.item_id, 2);
    const b = vender(m, 'DUO', 1, items[2]!.item_id, 1);
    const c = vender(m, 'DUO', 2, items[2]!.item_id, 1);
    const cancelada = vender(m, 'DUO', 1, items[2]!.item_id, 1);
    m.caja('DUO', 1).cancelarVenta(cancelada.venta.sale_id, 'prueba', 'Ana');
    const dev = m.caja('DUO', 1).devolver({ sale_id: a.venta.sale_id, renglones: [{ linea_id: a.venta.lineas[0]!.linea_id, qty: 1 }], motivo: 'x' });
    m.pump(); m.pump(); m.pump();
    const svc = admin(ctx);
    const todas = svc.historialVentas({}).resumen;
    const dia = svc.resumenDia().total;
    assert.equal(todas.total_ventas, dia.ventas_netas, 'coincide con las ventas netas del resumen del día');
    assert.equal(todas.tickets, dia.tickets);
    assert.equal(todas.tickets, 3, 'la cancelada no cuenta');
    assert.equal(todas.total_ventas, a.venta.total + b.venta.total + c.venta.total - dev.importe);
    assert.equal(todas.ticket_promedio, Math.round(todas.total_ventas / 3));
    const caja2 = svc.historialVentas({ cajas: [{ tienda: 'DUO', caja: 2 }] }).resumen;
    assert.deepEqual([caja2.total_ventas, caja2.tickets], [c.venta.total, 1]);
    const caja1 = svc.historialVentas({ cajas: [{ tienda: 'DUO', caja: 1 }] }).resumen;
    assert.equal(caja1.total_ventas, a.venta.total + b.venta.total - dev.importe, 'la devolución resta en su caja');
    assert.deepEqual(svc.historialVentas({ desde: '2000-01-01', hasta: '2000-01-02' }).resumen.tickets, 0);
  });
});
