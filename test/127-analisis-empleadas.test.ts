import assert from 'node:assert/strict';
import { it } from 'node:test';
import { SIN_VENDEDORA, analizarPorEmpleada, analizarVentas } from '../src/analisis-ventas.ts';
import type { FilaVenta } from '../src/consultas.ts';
import { hojaAnalisisEmpleadas } from '../src/inventario.ts';
import { api, appAdmin } from './ayudas/app.ts';
import { ALMACENES, nuevoMundo, politica, vender } from './ayudas/comun.ts';

const fila = (fecha: string, vendedora: string, total: number, extra: Partial<FilaVenta> = {}): FilaVenta =>
  ({ tienda: 'DUO', caja: 1, folio: 1, sale_id: `${fecha}${vendedora}${total}`, fecha_local: fecha, cajero: 'Caja', vendedora, total, total_mercancia: total, estado: 'confirmada', piezas: 1, pago: 'Efectivo', tipo_ticket: 'venta', historico: false, hora: '12:00', montos: {}, ...extra }) as never;
const FILAS: FilaVenta[] = [
  fila('2026-01-05', 'Ana', 10000), fila('2026-01-05', 'Ana', 20000), fila('2026-01-20', 'Beto', 30000), fila('2026-02-02', 'Ana', 5000),
  fila('2026-02-03', 'Autocompra', 7000), fila('2026-01-06', '', 9000, { historico: true, hora: '' }), fila('2025-12-30', 'Ana', 4000),
  fila('2026-01-07', 'Ana', 99999, { estado: 'cancelada' }), fila('2026-01-08', 'Ana', 0, { tipo_ticket: 'cambio' }), fila('2026-01-09', '', 1500, { tipo_ticket: 'fee', historico: true }),
];

it('AE1 por mes: una serie por empleada, de la que más vendió a la que menos, «sin dato» al final, periodos sin ventas en cero y todo suma al total', () => {
  const r = analizarPorEmpleada(FILAS, { agrupar: 'mes', desde: '2025-12-01', hasta: '2026-02-28' });
  assert.deepEqual(r.periodos.map((p) => p.clave), ['2025-12', '2026-01', '2026-02']);
  assert.deepEqual(r.empleadas.map((e) => e.alias), ['Ana', 'Beto', 'Autocompra', SIN_VENDEDORA], 'Ana 39,000 · Beto 30,000 · Autocompra 7,000 · sin dato al final aunque vendió más que otras');
  const ana = r.empleadas[0]!;
  assert.deepEqual(ana.periodos, [{ tickets: 1, piezas: 1, total: 4000 }, { tickets: 2, piezas: 2, total: 30000 }, { tickets: 1, piezas: 1, total: 5000 }]);
  assert.deepEqual([ana.tickets, ana.total, ana.promedio_ticket], [4, 39000, 9750]);
  assert.deepEqual(r.empleadas.find((e) => e.alias === 'Beto')!.periodos.map((p) => p.total), [0, 30000, 0], 'diciembre y febrero de Beto: ceros');
  assert.deepEqual(r.empleadas.find((e) => e.alias === SIN_VENDEDORA)!.periodos.map((p) => p.total), [0, 9000, 0], 'lo importado del POS anterior no trae empleada');
  assert.equal(r.resumen.total, 4000 + 30000 + 5000 + 30000 + 7000 + 9000, 'sin canceladas, cambios ni fees');
  assert.deepEqual(r.totales.map((t) => t.total), [4000, 69000, 12000]);
  assert.equal(r.empleadas.reduce((a, e) => a + e.total, 0), r.resumen.total);
  assert.ok(Math.abs(r.empleadas.reduce((a, e) => a + e.porcentaje, 0) - 100) < 0.2, 'los porcentajes suman 100');
  assert.deepEqual([r.resumen.empleadas, r.resumen.mejor], [3, { alias: 'Ana', total: 39000 }], '«sin dato» no cuenta como empleada ni como la mejor');
});

it('AE2 por día, semana y año: periodos completos y alineados con el análisis normal del mismo rango', () => {
  const dia = analizarPorEmpleada(FILAS, { agrupar: 'dia', desde: '2026-01-04', hasta: '2026-01-08' });
  assert.equal(dia.periodos.length, 5, 'todos los días del rango, con o sin ventas');
  assert.deepEqual(dia.empleadas.find((e) => e.alias === 'Ana')!.periodos.map((p) => p.total), [0, 30000, 0, 0, 0], 'la cancelada y el cambio no cuentan');
  const anio = analizarPorEmpleada(FILAS, { agrupar: 'anio', desde: '2025-01-01', hasta: '2026-12-31' });
  assert.deepEqual(anio.periodos.map((p) => p.clave), ['2025', '2026']);
  assert.deepEqual(anio.empleadas.find((e) => e.alias === 'Ana')!.periodos.map((p) => p.total), [4000, 35000]);
  const sem = analizarPorEmpleada(FILAS, { agrupar: 'semana', desde: '2026-01-05', hasta: '2026-02-08' });
  assert.deepEqual(sem.periodos.map((p) => p.clave), analizarVentas(FILAS, { agrupar: 'semana', desde: '2026-01-05', hasta: '2026-02-08' }).filas.map((f) => f.clave));
  assert.equal(sem.empleadas.find((e) => e.alias === 'Beto')!.periodos.filter((p) => p.total > 0).length, 1);
  // el análisis normal también ve ahora el año
  const normal = analizarVentas(FILAS, { agrupar: 'anio', desde: '2025-01-01', hasta: '2026-12-31' });
  assert.deepEqual(normal.filas.map((f) => [f.etiqueta, f.total]), [['2025', 4000], ['2026', 81000 + 1500]], '2026: ventas de mercancía más el fee por daño del POS anterior');
  assert.equal(normal.filas.find((f) => f.etiqueta === '2026')!.promedio_dia, Math.round(normal.filas.find((f) => f.etiqueta === '2026')!.total / 365));
});

it('AE3 la hoja de Excel: una fila por empleada, una columna por periodo y totales; las medidas son pesos, tickets o piezas', () => {
  const r = analizarPorEmpleada(FILAS, { agrupar: 'mes', desde: '2026-01-01', hasta: '2026-02-28' });
  const h = hojaAnalisisEmpleadas(r);
  assert.deepEqual(h.encabezados, ['Empleada', 'enero 2026', 'febrero 2026', 'Total', 'Tickets', 'Piezas', 'Ticket promedio', '% del total']);
  assert.deepEqual(h.filas[0]!.slice(0, 5), ['Ana', 300, 50, 350, 3]);
  assert.deepEqual(h.filas.at(-1)!.slice(0, 5), ['TOTAL', 690, 120, 810, 6]);
  assert.deepEqual(hojaAnalisisEmpleadas(r, 'tickets').filas[0]!.slice(0, 4), ['Ana', 2, 1, 3]);
  assert.match(hojaAnalisisEmpleadas(r, 'piezas').nombre, /piezas/);
});

const sqlite = ALMACENES.find((a) => a.nombre === 'sqlite')!;
it('AE4 ruta de Administración: /api/admin/analisis con desglose por empleada (y rechaza agrupaciones que no aplican)', async (t) => {
  const ctx = nuevoMundo(sqlite, politica());
  const adm = await appAdmin(ctx);
  t.after(async () => { await adm.cerrar(); ctx.limpiar(); });
  vender(ctx.m, 'DUO', 1, ctx.items[0]!.item_id); vender(ctx.m, 'DUO', 2, ctx.items[0]!.item_id);
  ctx.m.pump(); ctx.m.pump(); ctx.m.pump();
  const r = await api(adm.url, '/api/admin/analisis?desglose=empleada&agrupar=mes&desde=2026-10-01&hasta=2026-10-31&historicas=0');
  assert.equal(r.status, 200, JSON.stringify(r.json));
  const a = r.json.analisis;
  assert.deepEqual(a.periodos.map((p: { clave: string }) => p.clave), ['2026-10']);
  assert.equal(a.resumen.tickets, 2);
  assert.ok(a.empleadas.every((e: { periodos: unknown[] }) => e.periodos.length === 1));
  const x = await api(adm.url, '/api/admin/analisis?desglose=empleada&agrupar=hora&historicas=0');
  assert.ok(x.status >= 400 && /día, semana, mes o año/.test(JSON.stringify(x.json)), JSON.stringify(x.json));
  const hojas = (await api(adm.url, '/api/admin/analisis?desglose=empleada&agrupar=anio&completo=1&desde=2026-01-01&hasta=2026-12-31&historicas=0')).json.hojas;
  assert.match(hojas[0].nombre, /Ventas por empleada/);
  assert.equal(hojas[0].encabezados[1], '2026');
});
