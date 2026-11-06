import assert from 'node:assert/strict';
import { it } from 'node:test';
import { codigoTicketDeposito } from '../src/depositos.ts';
import { correoDelReporte, reporteDeCaja } from '../src/reporte-contadora.ts';
import { fechaLocal } from '../src/util.ts';
import { nuevoMundo, politica, porAlmacen, vender } from './ayudas/comun.ts';

porAlmacen('El reporte de la contadora trae los fees por daño de los depósitos', (alm) => {
  it('CF1 el fee retenido sale en el total, en la línea «Fees por daño» del correo y en el Excel; solo con las operaciones que lee la función (deposito.fee y deposito.recibido)', (t) => {
    const ctx = nuevoMundo(alm, politica());
    t.after(ctx.limpiar);
    const { m, items } = ctx;
    const caja = m.caja('DUO', 1);
    const venta = vender(m, 'DUO', 1, items[2]!.item_id).venta;
    const d = caja.recibirDeposito({ ref: 'd1', clienta: 'María González', monto: 30000, usuario: 'Ana' });
    caja.cobrarFeeDeposito({ ref: 'f1', deposito_id: d.deposito_id, monto: 15000, motivo: 'Cierre roto', usuario: 'Ana' });
    caja.devolverDeposito({ ref: 'r1', deposito_id: d.deposito_id, confirmado: true, usuario: 'Ana', codigo: codigoTicketDeposito(caja.depositoPorId(d.deposito_id)!) });
    m.pump(); m.pump(); m.pump();
    const periodo = fechaLocal(m.reloj.now()).slice(0, 7);
    // lo mismo que lee la función de Supabase: ventas, cancelaciones, históricas, devoluciones, correcciones, fees y la recepción del depósito (sin devoluciones de dinero ni aplicaciones)
    const TIPOS = ['sale.confirmed', 'sale.cancelled', 'venta.historica', 'historico.duplicados', 'return.registered', 'venta.corregida', 'deposito.fee', 'deposito.recibido'];
    const ops = m.central.repo.ops().filter((o) => TIPOS.includes(o.tipo));
    const r = reporteDeCaja(ops, 'DUO', 1, periodo);
    assert.deepEqual([r.tickets, r.fees, r.total], [1, 15000, venta.total + 15000]);
    const c = correoDelReporte(r);
    assert.match(c.texto, /Fees por daño \(incluidos en el total\): \$150\.00/);
    const det = r.hojas[0]!.filas.find((f) => f[2] === 'Fee por daño')!;
    assert.deepEqual([det[1], det[4]], ['DEP-D1-0001', 150], 'con el folio del depósito');
    const dia = r.hojas[1]!.filas[0]!;
    assert.deepEqual([dia[11], dia[12]], [150, (venta.total + 15000) / 100]);
  });
});
