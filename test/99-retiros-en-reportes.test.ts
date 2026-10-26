import assert from 'node:assert/strict';
import { it } from 'node:test';
import { ServicioAdmin } from '../src/app/servicio.ts';
import { nuevoMundo, politica, porAlmacen, servicioDe } from './ayudas/comun.ts';

porAlmacen('Retiros de efectivo en Historial de ventas y en el Resumen del día', (alm) => {
  it('RR1 el retiro aparece en el historial (quién, cuánto, caja) y en el resumen del día por tienda y en total', async (t) => {
    const ctx = nuevoMundo(alm, politica());
    ctx.m.fijarTipoCambioInicial(180000);
    t.after(ctx.limpiar);
    const a = new ServicioAdmin({ central: ctx.m.central, actor: { rol: 'admin', usuario: 'galo' }, fuente: () => ctx.m.central.repo.ops(), cajas: [{ tienda: 'DUO', caja: 1 }, { tienda: 'LON', caja: 1 }], reloj: ctx.m.reloj } as any);
    const s = servicioDe(ctx, 'DUO', 1, 'Ana');
    s.svc.caja.movimientoEfectivo('fondo_inicial', 200000, 'MXN');
    for (let i = 0; i < 12; i++) { const c = s.svc.nuevaVenta(); s.svc.escanear(c, '0002026090782'); await s.svc.cobrarEfectivo(c, 100000, 0); }
    await s.svc.registrarRetiro({ retiro_id: 'r1', mxn: { '100000': 8, '50000': 1 } }); // $8,500
    ctx.m.pump(); ctx.m.pump(); ctx.m.pump();
    const h = a.historialVentas({});
    assert.equal(h.retiros.length, 1);
    assert.deepEqual([h.retiros[0]!.tienda, h.retiros[0]!.caja, h.retiros[0]!.usuario, h.retiros[0]!.equivalente_mxn, h.retiros[0]!.folio_retiro], ['DUO', 1, 'Ana', 850000, 'D1-R0001']);
    const d = a.resumenDia();
    assert.equal(d.total.retiros, 850000);
    assert.equal(d.total.retiros_n, 1);
    assert.equal(d.tiendas.find((x: any) => x.tienda === 'DUO')!.retiros, 850000);
    assert.equal(d.tiendas.find((x: any) => x.tienda === 'LON')!.retiros, 0);
    // buscar un folio de venta no mezcla los retiros
    assert.equal(a.historialVentas({ folio: 'D1-000001' }).retiros.length, 0);
  });
});
