import assert from 'node:assert/strict';
import { it } from 'node:test';
import { ServicioAdmin } from '../src/app/servicio.ts';
import { hojaDetalleVentas, hojaResumenVentas } from '../src/inventario.ts';
import { codigoTicketDeposito } from '../src/depositos.ts';
import { fechaLocal } from '../src/util.ts';
import { nuevoMundo, politica, porAlmacen, vender } from './ayudas/comun.ts';

porAlmacen('Fees por daño de depósitos en Análisis y Reportes', (alm) => {
  it('FD1 el fee retenido es ingreso por daño: suma en Análisis, Reportes y Excel, pero no es ticket ni sale en el Historial', (t) => {
    const ctx = nuevoMundo(alm, politica());
    t.after(ctx.limpiar);
    const { m, items } = ctx;
    const a = new ServicioAdmin({ central: m.central, actor: { rol: 'admin', usuario: 'galo' }, fuente: () => m.central.repo.ops(), cajas: [{ tienda: 'DUO', caja: 1 }], reloj: m.reloj } as never);
    const caja = m.caja('DUO', 1);
    const venta = vender(m, 'DUO', 1, items[2]!.item_id).venta; // una venta normal, para comparar
    const d = caja.recibirDeposito({ ref: 'd1', clienta: 'María González', monto: 30000, usuario: 'Ana' });
    caja.cobrarFeeDeposito({ ref: 'f1', deposito_id: d.deposito_id, monto: 15000, motivo: 'Cierre roto', usuario: 'Ana' });
    caja.devolverDeposito({ ref: 'r1', deposito_id: d.deposito_id, confirmado: true, usuario: 'Ana', codigo: codigoTicketDeposito(caja.depositoPorId(d.deposito_id)!) });
    m.pump(); m.pump(); m.pump();
    const hoy = fechaLocal(m.reloj.now());

    // Análisis: el fee cuenta en el total pero no como ticket; las ventas siguen igual
    const mes = a.analisisVentas({ agrupar: 'mes', desde: `${hoy.slice(0, 4)}-01-01`, hasta: `${hoy.slice(0, 4)}-12-31` });
    const fila = mes.filas.find((f) => f.clave === hoy.slice(0, 7))!;
    assert.deepEqual([fila.tickets, fila.total_ventas, fila.fees, fila.total], [1, venta.total, 15000, venta.total + 15000]);

    // Reportes: la fila existe como fee, el total la incluye y los tickets no
    const r = a.reporte({});
    const fee = r.filas.find((x) => x.tipo_ticket === 'fee')!;
    assert.deepEqual([fee.fee_deposito, fee.total, fee.total_mercancia, fee.piezas, fee.estado], ['DEP-D1-0001', 15000, 0, 0, 'confirmada']);
    assert.equal(r.porCaja[0]!.tickets, 1, 'el fee no es un ticket');
    assert.equal(r.total, venta.total + 15000);
    assert.equal(r.total_mercancia, venta.total, 'ni es mercancía');

    // Excel de la contadora
    const det = hojaDetalleVentas(r).filas.find((f) => f[2] === 'Fee por daño')!;
    assert.deepEqual([det[1], det[4]], ['DEP-D1-0001', 150]);
    const diaXls = hojaResumenVentas(r).filas[0]!;
    assert.deepEqual([diaXls[2], diaXls[11], diaXls[12]], [1, 150, (venta.total + 15000) / 100], 'tickets 1; fees 150; total con el fee');

    // El Historial de ventas no lista fees (no son tickets que se puedan abrir) y su resumen no los cuenta
    const h = a.historialVentas({});
    assert.equal(h.ventas.filter((x) => x.tipo_ticket === 'fee').length, 0);
    assert.equal(h.resumen.tickets, 1);
    // Resumen del día de Administración: los depósitos aparecen aparte de las ventas (que no se mueven)
    const dia = a.resumenDia();
    assert.deepEqual([dia.total.depositos.recibidos, dia.total.depositos.devueltos, dia.total.depositos.fees, dia.total.depositos.aplicados, dia.total.depositos.pendiente], [30000, 15000, 15000, 0, 0]);
    assert.equal(dia.total.ventas_netas, venta.total, 'los depósitos no cambian las ventas netas');
    assert.equal(dia.tiendas.find((x: any) => x.tienda === 'DUO')!.depositos.recibidos_n, 1);
    // devolver el resto del depósito no genera ingreso: solo hay UNA fila de fee
    assert.equal(r.filas.filter((x) => x.tipo_ticket === 'fee').length, 1);
  });
});
