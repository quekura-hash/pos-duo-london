import assert from 'node:assert/strict';
import { it } from 'node:test';
import { ServicioAdmin } from '../src/app/servicio.ts';
import { reporteConsolidado } from '../src/consultas.ts';
import { totalesPorDia } from '../src/metas.ts';
import { historicasDuplicadas, reglasDuplicadosHistoricos } from '../src/proyecciones.ts';
import { reporteDeCaja } from '../src/reporte-contadora.ts';
import type { VentaHistorica } from '../src/ventas-historicas.ts';
import { nuevoMundo, politica, porAlmacen } from './ayudas/comun.ts';

const fila = (folio: number, fecha: string, total: number, tipo: VentaHistorica['tipo'] = 'venta'): VentaHistorica => ({ folio, fecha, tipo, piezas: 1, total, pago: 'efectivo', pago_original: 'Cash' });

porAlmacen('Ventas históricas importadas dos veces con otra caja: se revisan y dejan de contar sin borrar nada', (alm) => {
  const admin = (ctx: ReturnType<typeof nuevoMundo>) => new ServicioAdmin({ central: ctx.m.central as never, actor: { rol: 'admin', usuario: 'Edgardo' }, fuente: () => ctx.m.central.repo.ops(), cajas: [{ tienda: 'DUO', caja: 1 }, { tienda: 'DUO', caja: 2 }], reloj: ctx.m.reloj });
  it('HD1 solo se descartan las copias EXACTAS (folio, fecha, total y tipo) de la caja 2; lo distinto se conserva; reglas repetidas no duplican; ningún dato se borra', (t) => {
    const ctx = nuevoMundo(alm, politica());
    t.after(ctx.limpiar);
    const a = admin(ctx);
    // la caja 1 trae toda la historia; la caja 2 repite 3 tickets idénticos y trae 3 que NO son copia (otra fecha, otro total, otro tipo) y 2 propios
    ctx.m.central.importarVentasHistoricas({ tienda: 'DUO', caja: 1, lote: 'c1', por: 'Edgardo', filas: [fila(100, '2025-03-01', 50000), fila(101, '2025-03-02', 30000), fila(102, '2025-03-03', 20000), fila(103, '2025-03-04', 10000), fila(104, '2025-03-05', 10000), fila(105, '2025-03-06', 7000, 'fee')] });
    ctx.m.central.importarVentasHistoricas({ tienda: 'DUO', caja: 2, lote: 'c2', por: 'Edgardo', filas: [fila(100, '2025-03-01', 50000), fila(101, '2025-03-02', 30000), fila(102, '2025-03-03', 20000), fila(103, '2025-03-09', 10000), fila(104, '2025-03-05', 12000), fila(105, '2025-03-06', 7000, 'venta'), fila(900, '2026-02-01', 9000), fila(901, '2026-02-02', 4000)] });
    const ops = () => ctx.m.central.repo.ops();
    const todas = ops().filter((o) => o.tipo === 'venta.historica').length;
    const v = a.duplicadosHistoricos({ tienda: 'DUO', caja: 2, igual_a_caja: 1 });
    assert.deepEqual([v.tickets, v.total, v.desde, v.hasta, v.ya_descartados], [3, 100000, '2025-03-01', '2025-03-03', false]);
    assert.deepEqual(v.por_mes, [{ mes: '2025-03', tickets: 3, total: 100000 }]);
    // antes de descartar, las dos cajas cuentan todo
    const total = () => reporteConsolidado({ rol: 'admin', usuario: 'x' } as never, ops(), { desde: '2025-01-01', hasta: '2026-12-31', cajas: [{ tienda: 'DUO', caja: 1 }, { tienda: 'DUO', caja: 2 }], historicas: true }).total;
    const antes = total();
    const r = a.descartarDuplicadosHistoricos({ tienda: 'DUO', caja: 2, igual_a_caja: 1 });
    assert.deepEqual([r.ok, r.tickets, r.total], [true, 3, 100000]);
    assert.equal(total(), antes - 100000, 'los reportes ya no cuentan las 3 copias');
    assert.equal(ops().filter((o) => o.tipo === 'venta.historica').length, todas, 'no se borró nada');
    assert.equal(historicasDuplicadas(ops()).size, 3);
    assert.equal(reglasDuplicadosHistoricos(ops()).length, 1);
    // las metas parten de lo real: el 1/mar/2025 vale $500, no $1,000
    assert.equal(totalesPorDia(ops(), 'DUO').get('2025-03-01'), 50000);
    // el reporte mensual de la caja 2 tampoco las trae
    const mar2 = reporteDeCaja(ops(), 'DUO', 2, '2025-03');
    assert.equal(mar2.tickets, 3, 'de la caja 2 en marzo quedan solo sus 3 tickets propios (103, 104 y 105)');
    // aplicar otra vez no duplica la regla ni cambia nada
    a.descartarDuplicadosHistoricos({ tienda: 'DUO', caja: 2, igual_a_caja: 1 });
    assert.equal(reglasDuplicadosHistoricos(ops()).length, 1);
    assert.equal(a.duplicadosHistoricos({ tienda: 'DUO', caja: 2, igual_a_caja: 1 }).ya_descartados, true);
    // validaciones
    assert.throws(() => a.descartarDuplicadosHistoricos({ tienda: 'DUO', caja: 1, igual_a_caja: 1 }), /distintas/);
    assert.throws(() => a.descartarDuplicadosHistoricos({ tienda: 'LON', caja: 2, igual_a_caja: 1 }), /no hay tickets duplicados/);
  });
});
