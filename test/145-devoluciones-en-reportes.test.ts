import assert from 'node:assert/strict';
import { it } from 'node:test';
import { analizarVentas } from '../src/analisis-ventas.ts';
import { reporteConsolidado } from '../src/consultas.ts';
import { totalesPorDia } from '../src/metas.ts';
import { correoDelReporte, reporteDeCaja } from '../src/reporte-contadora.ts';
import { nuevoMundo, politica, porAlmacen, servicioDe } from './ayudas/comun.ts';

const MASCADA = '7501234567890'; // $120
const BOLSA = '0000000000017'; // $450
const JEANS = '0002026090782'; // $899
const ADMIN = { rol: 'admin', usuario: 'prueba' } as never;

porAlmacen('Devoluciones y cambios: restan el día en que ocurren, así el mes no cuenta dos veces lo devuelto', (alm) => {
  it('DV1 vendida ayer, cambiada hoy por otra más cara: el mes suma lo realmente vendido (no la venta y además el cambio completo)', async (t) => {
    const ctx = nuevoMundo(alm, politica());
    t.after(ctx.limpiar);
    const s = servicioDe(ctx, 'DUO', 1, 'Ana');
    // Día 1 (2 nov): se vende la mascada de $120.
    ctx.m.reloj.fijar('2026-11-02T20:00:00Z');
    const c1 = s.svc.nuevaVenta(); s.svc.escanear(c1, MASCADA);
    const v1 = (await s.svc.cobrarEfectivo(c1, 12000)).venta;
    // Día 2 (3 nov): una venta normal de $899 y el cambio de la mascada por la bolsa de $450 (paga la diferencia de $330).
    ctx.m.reloj.fijar('2026-11-03T20:00:00Z');
    const c2 = s.svc.nuevaVenta(); s.svc.escanear(c2, JEANS);
    await s.svc.cobrarEfectivo(c2, 89900);
    const c3 = s.svc.nuevaVenta();
    s.svc.iniciarCambio(c3, v1.sale_id, [{ linea_id: v1.lineas[0]!.linea_id, qty: 1 }], { clienta: { nombre: 'Ana López', telefono: '6531234567' }, motivo: 'cambio' });
    s.svc.escanear(c3, BOLSA);
    const v3 = (await s.svc.cobrarEfectivo(c3, 33000)).venta;
    assert.equal(v3.total, 45000, 'el ticket del cambio es la bolsa completa');
    ctx.m.pump(); ctx.m.pump();
    const ops = ctx.m.central.repo.ops();

    // Reporte de la contadora: ventas 120 + 899 + 450 − 120 devuelto = $1,349 (no $1,469).
    const rep = reporteDeCaja(ops, 'DUO', 1, '2026-11');
    assert.equal(rep.total, 12000 + 89900 + 45000 - 12000, 'el total del mes resta lo devuelto');
    assert.equal(rep.tickets, 3, 'la devolución no es un ticket de venta');
    assert.equal(rep.devoluciones, 1);
    assert.equal(rep.devoluciones_total, -12000);
    assert.equal(rep.efectivo, 12000 + 89900 + 33000, 'solo entró en efectivo lo que de verdad se cobró');
    assert.equal(rep.otros, 0, 'el crédito de la mercancía devuelta se compensa a sí mismo');
    const detalle = rep.hojas[0]!;
    const filaDev = detalle.filas.find((f) => String(f[2]).startsWith('Devolución'))!;
    assert.deepEqual([filaDev[3], filaDev[4]], [-1, -120], 'fila de devolución: piezas y total en negativo');
    assert.equal(typeof filaDev[1], 'number', 'la devolución lleva su propio folio de la serie');
    assert.ok(detalle.filas.some((f) => f[2] === 'Venta · cambio de mercancía'), 'el ticket del cambio se marca como cambio de mercancía');
    const folios = detalle.filas.map((f) => Number(f[1])).sort((a, b) => a - b);
    assert.deepEqual(folios, [1, 2, 3, 4], 'folios consecutivos: ninguno falta sin explicación');
    assert.match(correoDelReporte(rep).texto, /Devoluciones y cambios \(1; ya restados del total\): −\$120\.00/);

    // Análisis (por mes) y metas coinciden con el reporte; el día de ayer no se toca.
    const an = analizarVentas(reporteConsolidado(ADMIN, ops, { desde: '2026-11-01', hasta: '2026-11-30', devoluciones: true }).filas, { agrupar: 'mes', desde: '2026-11-01', hasta: '2026-11-30' });
    assert.equal(an.resumen.total_ventas, 134900);
    assert.equal(an.resumen.tickets, 3);
    const dias = totalesPorDia(ops, 'DUO');
    assert.equal(dias.get('2026-11-02'), 12000, 'ayer se queda como se vendió');
    assert.equal(dias.get('2026-11-03'), 89900 + 45000 - 12000, 'hoy: ventas del día menos lo devuelto');
    // Y el corte de hoy ya decía lo mismo.
    assert.equal(s.svc.corte('2026-11-03').vivo.ventas_netas, 89900 + 45000 - 12000);
    // El Historial de ventas sigue mostrando solo tickets.
    const sinDevs = reporteConsolidado(ADMIN, ops, { desde: '2026-11-01', hasta: '2026-11-30' }).filas;
    assert.equal(sinDevs.some((f) => f.tipo_ticket === 'devolucion'), false);
  });

  it('DV2 devolución con reembolso en efectivo (sin cambio): resta del día y del reporte', async (t) => {
    const ctx = nuevoMundo(alm, politica());
    t.after(ctx.limpiar);
    const s = servicioDe(ctx, 'DUO', 1, 'Ana');
    ctx.m.reloj.fijar('2026-11-02T20:00:00Z');
    const c1 = s.svc.nuevaVenta(); s.svc.escanear(c1, JEANS);
    const v = (await s.svc.cobrarEfectivo(c1, 89900)).venta;
    ctx.m.reloj.fijar('2026-11-03T20:00:00Z');
    s.svc.caja.devolver({ sale_id: v.sale_id, renglones: [{ linea_id: v.lineas[0]!.linea_id, qty: 1 }], motivo: 'no le quedó' });
    ctx.m.pump(); ctx.m.pump();
    const ops = ctx.m.central.repo.ops();
    const rep = reporteDeCaja(ops, 'DUO', 1, '2026-11');
    assert.equal(rep.total, 0, 'vendido y devuelto en el mes: $0');
    assert.equal(rep.efectivo, 0, 'el efectivo devuelto sale de lo cobrado');
    assert.equal(rep.tickets, 1);
    assert.equal(totalesPorDia(ops, 'DUO').get('2026-11-03'), -89900);
  });
});
