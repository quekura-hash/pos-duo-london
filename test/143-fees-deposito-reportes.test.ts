import assert from 'node:assert/strict';
import { it } from 'node:test';
import { ServicioAdmin } from '../src/app/servicio.ts';
import { hojaDetalleVentas, hojaResumenVentas } from '../src/inventario.ts';
import { codigoTicketDeposito } from '../src/depositos.ts';
import { correoDelReporte, reporteDeCaja } from '../src/reporte-contadora.ts';
import { fechaLocal } from '../src/util.ts';
import { nuevoMundo, politica, porAlmacen, vender } from './ayudas/comun.ts';

porAlmacen('Fees por daño de depósitos: no son venta ni ingreso; solo quedan en el efectivo del corte', (alm) => {
  it('FD1 el fee retenido paga el arreglo de la prenda: no suma a Análisis, Reportes, Excel, ventas netas ni al reporte de la contadora, y SÍ queda en el efectivo esperado y en el bloque de depósitos del corte', (t) => {
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

    // Análisis: solo la venta
    const mes = a.analisisVentas({ agrupar: 'mes', desde: `${hoy.slice(0, 4)}-01-01`, hasta: `${hoy.slice(0, 4)}-12-31` });
    const fila = mes.filas.find((f) => f.clave === hoy.slice(0, 7))!;
    assert.deepEqual([fila.tickets, fila.total_ventas, fila.fees, fila.total], [1, venta.total, 0, venta.total]);

    // Reportes y Excel: ninguna fila ni total de fee
    const r = a.reporte({});
    assert.equal(r.filas.filter((x) => x.tipo_ticket === 'fee').length, 0);
    assert.equal(r.porCaja[0]!.tickets, 1);
    assert.equal(r.total, venta.total);
    assert.equal(hojaDetalleVentas(r).filas.filter((f) => f[2] === 'Fee por daño').length, 0);
    const diaXls = hojaResumenVentas(r).filas[0]!;
    assert.deepEqual([diaXls[2], diaXls[11], diaXls[12]], [1, 0, venta.total / 100]);

    // Reporte de la contadora: ni suma ni menciona el fee (aunque las operaciones de depósito estuvieran presentes)
    const rc = reporteDeCaja(m.central.repo.ops(), 'DUO', 1, hoy.slice(0, 7));
    assert.deepEqual([rc.tickets, rc.fees, rc.total], [1, 0, venta.total]);
    assert.doesNotMatch(correoDelReporte(rc).texto, /Fees/);

    // Resumen del día y corte: ventas netas sin el fee; el fee aparece en el bloque de depósitos y el efectivo esperado lo conserva
    const dia = a.resumenDia();
    assert.deepEqual([dia.total.depositos.recibidos, dia.total.depositos.devueltos, dia.total.depositos.fees, dia.total.depositos.aplicados, dia.total.depositos.pendiente], [30000, 15000, 15000, 0, 0]);
    assert.equal(dia.total.ventas_netas, venta.total, 'los depósitos no cambian las ventas netas');
    const corte = caja.corteEnVivo(hoy);
    assert.equal(corte.ventas_netas, venta.total);
    assert.equal(corte.depositos.fees, 15000);
    // efectivo: venta + depósito recibido − depósito devuelto (el fee retenido queda en el cajón: 30000 − 15000)
    assert.equal(corte.efectivo_esperado, venta.total + 30000 - 15000, 'el fee queda dentro del efectivo esperado');
    // el Historial de ventas tampoco lo lista
    assert.equal(a.historialVentas({}).ventas.filter((x) => x.tipo_ticket === 'fee').length, 0);
  });
});
