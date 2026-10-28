import assert from 'node:assert/strict';
import { it } from 'node:test';
import { analizarVentas, diaSemana, diasEntre, semanaIso } from '../src/analisis-ventas.ts';
import type { FilaVenta } from '../src/consultas.ts';
import { ServicioAdmin } from '../src/app/servicio.ts';
import { escribirXlsxNode, leerXlsxNode } from '../src/xlsx-node.ts';
import { fechaLocal } from '../src/util.ts';
import { nuevoMundo, politica, porAlmacen, vender } from './ayudas/comun.ts';

let n = 0;
const fila = (fecha: string, hora: string, pesos: number, piezas = 1, o: Partial<FilaVenta> = {}): FilaVenta => ({
  tienda: 'DUO', caja: 1, folio: ++n, sale_id: `s${n}`, fecha_local: fecha, cajero: 'Ana', vendedora: '', total: pesos * 100, total_mercancia: pesos * 100, estado: 'confirmada', piezas, pago: 'Efectivo',
  tipo_ticket: 'venta', historico: false, hora, montos: { efectivo: pesos * 100, tarjeta: 0, dolares: 0, tarjeta_regalo: 0, otro: 0, mixto: 0, credito: 0 }, ...o,
});

it('AN1 calendario: día de la semana, días entre fechas y semana ISO (incluye el cambio de año)', () => {
  assert.deepEqual([diaSemana('2026-03-02'), diaSemana('2026-03-08'), diaSemana('2026-10-21')], [0, 6, 2], 'lunes, domingo y miércoles');
  assert.equal(diasEntre('2026-03-01', '2026-03-31'), 31);
  assert.deepEqual(semanaIso('2026-01-01'), { anio: 2026, semana: 1, lunes: '2025-12-29' }, 'el 1/ene/2026 (jueves) ya es la semana 1');
  assert.equal(semanaIso('2026-03-02').semana, 10);
  assert.deepEqual([semanaIso('2027-01-01').anio, semanaIso('2027-01-01').semana], [2026, 53], 'el 1/ene/2027 (viernes) es la semana 53 de 2026');
  assert.deepEqual([semanaIso('2024-12-30').anio, semanaIso('2024-12-30').semana], [2025, 1]);
});

it('AN2 por mes: rellena los meses sin ventas, no cuenta cancelados ni cambios, los fees suman al total pero no son tickets, y marca el mejor mes', () => {
  const filas = [
    fila('2026-01-10', '10:15', 1000), fila('2026-01-20', '11:00', 500, 2), fila('2026-03-05', '17:30', 3000, 3),
    fila('2026-03-06', '12:00', 9999, 1, { estado: 'cancelada' }), fila('2026-03-07', '12:00', 0, 0, { tipo_ticket: 'cambio' }), fila('2026-03-08', '12:00', 150, 0, { tipo_ticket: 'fee' }),
    fila('2025-12-31', '12:00', 777), // fuera del rango pedido
  ];
  const r = analizarVentas(filas, { agrupar: 'mes', desde: '2026-01-01', hasta: '2026-04-30' });
  assert.deepEqual(r.filas.map((f) => f.etiqueta), ['enero 2026', 'febrero 2026', 'marzo 2026', 'abril 2026'], 'febrero y abril aparecen en cero');
  assert.deepEqual(r.filas.map((f) => [f.tickets, f.piezas, f.total / 100]), [[2, 3, 1500], [0, 0, 0], [1, 3, 3150], [0, 0, 0]]);
  assert.equal(r.filas[2]!.fees, 15000);
  assert.equal(r.filas[2]!.promedio_ticket, 300000, 'ticket promedio solo con ventas: sin el fee');
  assert.deepEqual([r.resumen.tickets, r.resumen.total / 100, r.resumen.total_ventas / 100, r.resumen.fees / 100, r.resumen.promedio_ticket / 100], [3, 4650, 4500, 150, 1500]);
  assert.equal(r.mejor.por_total!.etiqueta, 'marzo 2026');
  assert.equal(r.mejor.por_tickets!.etiqueta, 'enero 2026');
  assert.ok(Math.abs(r.filas.reduce((s, f) => s + f.porcentaje, 0) - 100) < 0.2, 'los porcentajes suman 100');
  assert.deepEqual(r.filas.map((f) => f.promedio_dia), [Math.round(150000 / 31), Math.round(0 / 28), Math.round(315000 / 31), 0], 'promedio por día del mes dentro del rango');
});

it('AN3 por hora: de la primera a la última hora con ventas sin huecos, promedio por día del periodo, y las históricas (sin hora) se dejan fuera y se cuentan', () => {
  const marzo = [fila('2026-03-02', '09:05', 100), fila('2026-03-02', '09:50', 200), fila('2026-03-03', '12:00', 400), fila('2026-03-31', '09:59', 300), fila('2026-03-15', '', 5000, 1, { historico: true })];
  const r = analizarVentas(marzo, { agrupar: 'hora', desde: '2026-03-01', hasta: '2026-03-31' });
  assert.deepEqual(r.filas.map((f) => f.etiqueta), ['9:00 – 10:00', '10:00 – 11:00', '11:00 – 12:00', '12:00 – 13:00'], 'hora 10 y 11 en cero, sin cortar la tabla');
  assert.deepEqual(r.filas.map((f) => [f.tickets, f.total / 100]), [[3, 600], [0, 0], [0, 0], [1, 400]]);
  assert.equal(r.sin_hora, 1);
  assert.equal(r.resumen.total / 100, 1000, 'la venta histórica no entra a la vista por hora');
  assert.equal(r.filas[0]!.promedio_dia, Math.round(60000 / 31), 'promedio por cada día de marzo');
  assert.equal(analizarVentas(marzo, { agrupar: 'dia', desde: '2026-03-01', hasta: '2026-03-31' }).resumen.total / 100, 6000, 'por día sí cuenta la histórica');
});

it('AN4 día de la semana (con cuántos de cada uno hubo en el rango) y mapa de calor día × hora', () => {
  const filas = [fila('2026-03-02', '09:00', 100), fila('2026-03-09', '09:30', 300), fila('2026-03-07', '18:00', 700), fila('2026-03-08', '18:10', 50)];
  const r = analizarVentas(filas, { agrupar: 'dia_semana', desde: '2026-03-01', hasta: '2026-03-31' });
  assert.deepEqual(r.filas.map((f) => f.etiqueta), ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo']);
  assert.deepEqual([r.filas[0]!.total / 100, r.filas[5]!.total / 100, r.filas[6]!.total / 100], [400, 700, 50]);
  assert.equal(r.filas[0]!.promedio_dia, 400 * 100 / 5, 'marzo 2026 tiene 5 lunes (2, 9, 16, 23, 30)');
  assert.equal(r.filas[6]!.promedio_dia, 5000 / 5, 'y 5 domingos');
  const m = analizarVentas(filas, { agrupar: 'mapa_calor', desde: '2026-03-01', hasta: '2026-03-31' });
  assert.equal(m.matriz![0]![9], 40000, 'lunes 9 h: los dos lunes');
  assert.equal(m.matriz![5]![18], 70000, 'sábado 18 h');
  assert.equal(m.matriz![6]![18], 5000);
  assert.equal(m.matriz!.flat().reduce((a, b) => a + b, 0), 115000);
});

it('AN5 por semana: semanas ISO con su rango, huecos en cero y cuál es la semana más alta del año', () => {
  const filas = [fila('2026-03-02', '10:00', 500), fila('2026-03-08', '10:00', 500), fila('2026-03-09', '10:00', 300), fila('2026-03-23', '10:00', 2500)];
  const r = analizarVentas(filas, { agrupar: 'semana', desde: '2026-03-01', hasta: '2026-03-31' });
  assert.deepEqual(r.filas.map((f) => f.etiqueta), ['Sem 9 · 23 feb – 1 mar', 'Sem 10 · 2–8 mar', 'Sem 11 · 9–15 mar', 'Sem 12 · 16–22 mar', 'Sem 13 · 23–29 mar', 'Sem 14 · 30 mar – 5 abr']);
  assert.deepEqual(r.filas.map((f) => f.total / 100), [0, 1000, 300, 0, 2500, 0]);
  assert.deepEqual(r.mejor.por_total, { clave: '2026-S13', etiqueta: 'Sem 13 · 23–29 mar', total: 250000 }, 'semana más alta');
  assert.equal(r.filas[1]!.promedio_dia, Math.round(100000 / 7));
});

it('AN6 forma de pago, caja y tienda: ordenadas de más a menos, con su porcentaje', () => {
  const filas = [fila('2026-03-02', '10:00', 300, 1, { pago: 'Tarjeta' }), fila('2026-03-02', '11:00', 700, 1, { pago: 'Efectivo' }), fila('2026-03-03', '11:00', 200, 1, { pago: 'Efectivo', tienda: 'LON', caja: 2 })];
  const p = analizarVentas(filas, { agrupar: 'forma_pago' });
  assert.deepEqual(p.filas.map((f) => [f.etiqueta, f.total / 100, f.porcentaje]), [['Efectivo', 900, 75], ['Tarjeta', 300, 25]]);
  assert.deepEqual(analizarVentas(filas, { agrupar: 'caja' }).filas.map((f) => [f.etiqueta, f.total / 100]), [['DÚO · Caja 1', 1000], ['London · Caja 2', 200]]);
  assert.deepEqual(analizarVentas(filas, { agrupar: 'tienda' }).filas.map((f) => f.etiqueta), ['DÚO New York', 'London Love']);
  const vacio = analizarVentas([], { agrupar: 'hora', desde: '2026-03-01', hasta: '2026-03-31' });
  assert.deepEqual([vacio.filas.length, vacio.resumen.total, vacio.mejor.por_total], [0, 0, null], 'sin ventas no hay mejor categoría');
});

porAlmacen('Análisis en el servicio: usa el mismo reporte (con históricas, cajas y fechas) y se exporta a Excel', (alm) => {
  it('AN7 por mes, por hora y por caja con una venta histórica de septiembre y una venta nueva de hoy', async (t) => {
    const ctx = nuevoMundo(alm, politica());
    t.after(ctx.limpiar);
    const a = new ServicioAdmin({ central: ctx.m.central, actor: { rol: 'admin', usuario: 'galo' }, fuente: () => ctx.m.central.repo.ops(), cajas: [{ tienda: 'DUO', caja: 1 }, { tienda: 'DUO', caja: 2 }] as never, tiendas: () => ['DUO', 'LON'] } as never);
    const HOJA: unknown[][] = [[null, 'Date', null, 'Receipt #', null, 'Receipt Type', null, 'Full Name', null, 'Qty Sold', null, 'Total', null, 'Payment'], [null, '13/09/2026', null, 52349, null, 'Sales', null, null, null, 2, null, 1000, null, 'Cash'], [null, '14/09/2026', null, 52350, null, 'Sales', null, null, null, 1, null, 500, null, 'Credit Card']];
    a.importarVentasHistoricas({ filas: HOJA, tienda: 'DUO', caja: 1, nombre: 'p.xlsx' });
    const v = vender(ctx.m, 'DUO', 1, ctx.items[2]!.item_id).venta;
    ctx.m.pump();
    const hoy = fechaLocal(new Date().toISOString());
    const anio = hoy.slice(0, 4);
    const mes = a.analisisVentas({ agrupar: 'mes', desde: `${anio}-01-01`, hasta: `${anio}-12-31` });
    assert.equal(mes.filas.length, 12, 'los doce meses del año');
    const sept = mes.filas.find((f) => f.clave === `${anio}-09`)!;
    assert.deepEqual([sept.tickets, sept.total], [2, 150000], 'septiembre: las dos históricas');
    assert.equal(mes.filas.find((f) => f.clave === hoy.slice(0, 7))!.total >= v.total, true);
    assert.equal(mes.mejor.por_total!.etiqueta, mes.filas.reduce((m2, f) => (f.total > m2.total ? f : m2)).etiqueta);
    const hora = a.analisisVentas({ agrupar: 'hora', desde: `${anio}-01-01`, hasta: `${anio}-12-31` });
    assert.equal(hora.sin_hora, 2, 'las históricas no tienen hora');
    assert.equal(hora.resumen.tickets, 1);
    assert.equal(a.analisisVentas({ agrupar: 'hora', desde: `${anio}-01-01`, hasta: `${anio}-12-31`, historicas: false }).sin_hora, 0);
    assert.equal(a.analisisVentas({ agrupar: 'dia', desde: `${anio}-09-01`, hasta: `${anio}-09-30`, cajas: [{ tienda: 'DUO', caja: 2 }] }).resumen.tickets, 0, 'filtro por caja');
    assert.deepEqual(a.analisisVentas({ agrupar: 'caja' }).filas.map((f) => f.etiqueta), ['DÚO · Caja 1']);
    assert.throws(() => a.analisisVentas({ agrupar: 'trimestre' as never }), /agrupación desconocida/);
    // Excel: tabla con importes numéricos, porcentaje y total.
    const hojas = a.hojasAnalisis({ agrupar: 'mes', desde: `${anio}-01-01`, hasta: `${anio}-12-31` });
    const leidas = await leerXlsxNode(await escribirXlsxNode(hojas));
    assert.equal(leidas[0]!.nombre, 'Ventas por mes');
    assert.deepEqual(leidas[0]!.filas[0], ['Periodo', 'Tickets', 'Piezas', 'Ventas', 'Fees por daño', 'Total', 'Ticket promedio', 'Promedio por día', '% del total']);
    const filaSept = leidas[0]!.filas.find((f) => String(f[0]).startsWith('septiembre'))!;
    assert.deepEqual([filaSept[1], filaSept[3], filaSept[5]], [2, 1500, 1500]);
    assert.equal(leidas[0]!.filas.find((f) => f[0] === 'TOTAL')![1], mes.resumen.tickets);
  });
});
