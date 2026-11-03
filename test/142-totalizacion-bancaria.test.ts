import assert from 'node:assert/strict';
import { it } from 'node:test';
import { nuevoMundo, politica, porAlmacen, servicioDe } from './ayudas/comun.ts';

const VESTIDO = '0002026090782'; // $899.00
const HOY = (ctx: { m: { reloj: { now(): string } } }) => ctx.m.reloj.now().slice(0, 10);

porAlmacen('Corte: totalización bancaria contra la tarjeta neta del sistema', (alm) => {
  it('TB2 cierre con totalización: coincide con tarjeta − reembolso a tarjeta', async (t) => {
    const ctx = nuevoMundo(alm, politica());
    t.after(ctx.limpiar);
    const s = servicioDe(ctx, 'DUO', 1, 'Ana');
    const c1 = s.svc.nuevaVenta(); s.svc.escanear(c1, VESTIDO);
    const v = (await s.svc.cobrarTarjetaManual(c1, { autorizacion: 'A111' })).venta; // $899 con tarjeta
    const c2 = s.svc.nuevaVenta(); s.svc.escanear(c2, VESTIDO);
    await s.svc.cobrarTarjetaManual(c2, { autorizacion: 'B222' }); // otros $899
    s.svc.caja.devolver({ sale_id: v.sale_id, renglones: [{ linea_id: v.lineas[0]!.linea_id, qty: 1 }], motivo: 'no le quedó' }); // reembolso a tarjeta de $899
    const vivo = s.svc.corte(HOY(ctx)).vivo;
    assert.deepEqual([vivo.cobros_tarjeta, vivo.devoluciones_a_tarjeta], [179800, 89900]);
    s.svc.confirmarFondo({ '100000': 5 });
    s.svc.registrarConteo('MXN', {}, 'ventas');
    await assert.rejects(() => s.svc.cerrarCorte(HOY(ctx)), { codigo: 'CIERRE_INCOMPLETO' }); // sin totalización no cierra
    await assert.rejects(() => s.svc.cerrarCorte(HOY(ctx), { totalizacion: -5 }), { codigo: 'CIERRE_INCOMPLETO' });
    const r = await s.svc.cerrarCorte(HOY(ctx), { totalizacion: 89900 });
    assert.deepEqual((r.corte as any).totalizacion_bancaria, { capturado: 89900, sistema: 89900, diferencia: 0, coincide: true, capturo: 'Ana' });
    assert.match(r.ticket_texto!, /TOTALIZACIÓN BANCARIA[\s\S]*Coincide\s+OK/);
    assert.equal(s.svc.corte(HOY(ctx)).estado.cerrado, true, 'el dato nuevo no hace que el corte parezca desactualizado');
  });
});
