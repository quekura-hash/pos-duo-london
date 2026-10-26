import assert from 'node:assert/strict';
import { it } from 'node:test';
import { revisarReporteAnterior } from '../src/ventas-historicas.ts';
import { ServicioAdmin } from '../src/app/servicio.ts';
import { nuevoMundo, politica, porAlmacen, vender } from './ayudas/comun.ts';

/** Hoja con la forma del «Sales Detail» del POS anterior (datos inventados): columnas B, D, F, H, J, L y N. */
const fila = (fecha: unknown, folio: number | null, tipo: string | null, piezas: number | null, total: number | null, pago: string | null) => [null, fecha, null, folio, null, tipo, null, null, null, piezas, null, total, null, pago, null, null];
const ENCABEZADO = [null, 'Date', null, 'Receipt #', null, 'Receipt Type', null, 'Full Name', null, 'Qty Sold', null, 'Total', null, 'Payment', null, null];
const HOJA: unknown[][] = [
  [null, '2026-09-30T00:00:00.000Z', ...Array(9).fill(null), 'TIENDA DE PRUEBA'], [null, '08:18 p. m.'], [], [], [], ENCABEZADO,
  fila('2026-01-09T00:00:00.000Z', 1001, 'Sales', 1, 549, 'Credit Card'), // 1 de septiembre, guardada por Excel como 9 de enero
  fila('2026-01-09T00:00:00.000Z', 1002, 'Sales', 2, 1698, 'Debit Card'),
  fila('2026-02-09T00:00:00.000Z', 1003, 'Sales', 3, 203, 'Cash'),
  fila('2026-09-09T00:00:00.000Z', 1004, 'Sales', 2, 654, 'Split'), // 9 de septiembre: día y mes iguales, no se toca
  fila('13/09/2026', 1005, 'Sales', 0, 30, 'Cash'), // sin piezas: fee por daño
  fila('14/09/2026', 1006, 'Sales', 0, 0, 'None'), // $0: cambio
  fila('14/09/2026', 1007, 'Sales', 0, -150, 'Cash'), // fee negativo
  fila('30/09/2026', 1008, 'Sales', 1, 399, 'Credit Card'),
  [null, null, null, null, null, null, null, null, null, 9, null, 3382],
];

it('HV1 el lector entiende el «Sales Detail»: corrige fechas intercambiadas, clasifica venta/cambio/fee y pago, y avisa de lo raro', () => {
  const r = revisarReporteAnterior(HOJA);
  assert.deepEqual(r.errores, []);
  assert.equal(r.filas.length, 8, 'el renglón de totales no cuenta');
  assert.deepEqual(r.filas.map((f) => f.fecha), ['2026-09-01', '2026-09-01', '2026-09-02', '2026-09-09', '2026-09-13', '2026-09-14', '2026-09-14', '2026-09-30']);
  assert.equal(r.resumen.fechas_corregidas, 3);
  assert.deepEqual(r.filas.map((f) => f.tipo), ['venta', 'venta', 'venta', 'venta', 'fee', 'cambio', 'fee', 'venta']);
  assert.deepEqual(r.filas.map((f) => f.pago), ['tarjeta', 'tarjeta', 'efectivo', 'mixto', 'efectivo', 'sin_pago', 'efectivo', 'tarjeta'], 'Credit y Debit son solo «tarjeta»');
  assert.equal(r.filas[0]!.total, 54900, 'en centavos');
  assert.equal(r.filas[0]!.pago_original, 'Credit Card', 'se conserva lo que decía el archivo');
  assert.deepEqual([r.resumen.tickets, r.resumen.piezas, r.resumen.total], [8, 9, 54900 + 169800 + 20300 + 65400 + 3000 + 0 - 15000 + 39900]);
  assert.deepEqual([r.resumen.por_tipo.fee.tickets, r.resumen.por_tipo.cambio.tickets, r.resumen.por_pago.tarjeta.tickets, r.resumen.por_pago.mixto.tickets], [2, 1, 3, 1]);
  assert.deepEqual([r.resumen.desde, r.resumen.hasta, r.resumen.folio_inicial, r.resumen.folio_final, r.resumen.dias_con_ventas], ['2026-09-01', '2026-09-30', 1001, 1008, 6]);
  assert.ok(r.avisos.some((a) => /3 fecha\(s\)/.test(a)));
  assert.ok(!r.avisos.some((a) => /Faltan folios/.test(a)), 'los folios 1001 a 1008 van seguidos');
  const huecos = revisarReporteAnterior([ENCABEZADO, fila('13/09/2026', 10, 'Sales', 1, 100, 'Cash'), fila('13/09/2026', 13, 'Sales', 1, 100, 'Cash')]);
  assert.ok(huecos.avisos.some((a) => /Faltan folios en la serie: 11, 12/.test(a)));
  assert.deepEqual(r.para_revisar.map((x) => x.folio), [1004, 1005, 1006, 1007], 'mixto, fees y cambio piden mirada');
  assert.match(r.para_revisar.find((x) => x.folio === 1007)!.nota, /NEGATIVO/);
});

it('HV2 errores claros: archivo equivocado, folio repetido, tipo de recibo desconocido, fecha ilegible', () => {
  assert.match(revisarReporteAnterior([['Producto', 'Precio'], ['A', 1]]).errores[0]!, /no encuentro las columnas/);
  assert.match(revisarReporteAnterior([ENCABEZADO]).errores[0]!, /ningún ticket/);
  const dup = revisarReporteAnterior([ENCABEZADO, fila('13/09/2026', 5, 'Sales', 1, 100, 'Cash'), fila('13/09/2026', 5, 'Sales', 1, 100, 'Cash')]);
  assert.match(dup.errores.join(' '), /folio 5 aparece más de una vez/);
  assert.match(revisarReporteAnterior([ENCABEZADO, fila('13/09/2026', 6, 'Returns', 1, -100, 'Cash')]).errores.join(' '), /tipo de recibo desconocido/);
  assert.match(revisarReporteAnterior([ENCABEZADO, fila('mañana', 7, 'Sales', 1, 100, 'Cash')]).errores.join(' '), /fecha ilegible/);
});

porAlmacen('Ventas históricas: se importan una vez, entran a los reportes con su origen y no tocan inventario ni folios', (alm) => {
  const admin = (ctx: ReturnType<typeof nuevoMundo>) => new ServicioAdmin({ central: ctx.m.central, actor: { rol: 'admin', usuario: 'galo' }, fuente: () => ctx.m.central.repo.ops(), cajas: [{ tienda: 'DUO', caja: 1 }, { tienda: 'LON', caja: 1 }] as never, tiendas: () => ['DUO', 'LON'] } as never);

  it('HV3 vista previa sin guardar, importar, reimportar sin duplicar, y reporte con/sin históricas por caja y fechas', (t) => {
    const ctx = nuevoMundo(alm, politica());
    t.after(ctx.limpiar);
    const a = admin(ctx);
    const antes = ctx.m.central.repo.ops().length;
    const prev = a.revisarVentasHistoricas(HOJA, { tienda: 'DUO', caja: 1 });
    assert.deepEqual([prev.nuevas, prev.ya_importadas, prev.revision.resumen.tickets], [8, 0, 8]);
    assert.equal(ctx.m.central.repo.ops().length, antes, 'la vista previa no guarda nada');
    assert.throws(() => a.revisarVentasHistoricas(HOJA, { tienda: 'XXX', caja: 1 }), /no existe/);
    assert.throws(() => a.revisarVentasHistoricas(HOJA, { tienda: 'DUO', caja: 0 }), /número de caja/);

    const r1 = a.importarVentasHistoricas({ filas: HOJA, tienda: 'DUO', caja: 1, nombre: 'prueba.xlsx' });
    assert.deepEqual([r1.nuevas, r1.existentes], [8, 0]);
    ctx.m.pump();
    const r2 = a.importarVentasHistoricas({ filas: HOJA, tienda: 'DUO', caja: 1, nombre: 'prueba.xlsx' });
    assert.deepEqual([r2.nuevas, r2.existentes], [0, 8], 'el mismo archivo otra vez no duplica nada');
    assert.equal(a.revisarVentasHistoricas(HOJA, { tienda: 'DUO', caja: 1 }).ya_importadas, 8);
    assert.equal(ctx.m.central.repo.ops().filter((o) => o.tipo === 'venta.historica').length, 8);
    assert.ok(ctx.m.central.repo.ops().filter((o) => o.tipo === 'venta.historica').every((o) => o.tienda === null), 'quedan en Administración: las cajas no las descargan');

    const rep = a.reporte({ desde: '2026-09-01', hasta: '2026-09-30' });
    assert.equal(rep.filas.length, 8);
    assert.ok(rep.filas.every((f) => f.historico && f.tienda === 'DUO' && f.caja === 1));
    assert.deepEqual(rep.porCaja.map((c) => [c.tienda, c.caja, c.tickets, c.historico]), [['DUO', 1, 8, true]]);
    assert.equal(rep.total, 54900 + 169800 + 20300 + 65400 + 3000 - 15000 + 39900);
    const f1005 = rep.filas.find((f) => f.folio === 1005)!;
    assert.deepEqual([f1005.tipo_ticket, f1005.piezas, f1005.pago, f1005.fecha_local, f1005.total_mercancia], ['fee', 0, 'Efectivo', '2026-09-13', 0], 'un fee no es venta de mercancía');
    assert.equal(rep.filas.find((f) => f.folio === 1004)!.pago, 'Mixto');
    assert.equal(a.reporte({ historicas: false }).filas.length, 0, 'se pueden excluir');
    assert.equal(a.reporte({ desde: '2026-09-13', hasta: '2026-09-14' }).filas.length, 3, 'filtro por fechas');
    assert.equal(a.reporte({ cajas: [{ tienda: 'LON', caja: 1 }] }).filas.length, 0, 'filtro por caja');
    assert.equal(a.reporte({ cajas: [{ tienda: 'DUO', caja: 1 }] }).filas.length, 8);
    assert.throws(() => a.importarVentasHistoricas({ filas: [ENCABEZADO], tienda: 'DUO', caja: 1 }), /ningún ticket/);
  });
});

porAlmacen('Reporte para la contadora: Excel con detalle y resumen por día, históricas y ventas nuevas juntas', (alm) => {
  it('HV4 el Excel trae fechas reales, importes numéricos, tipo y forma de pago; los fees cuentan como cobro y no como piezas', async (t) => {
    const ctx = nuevoMundo(alm, politica());
    t.after(ctx.limpiar);
    const a = new ServicioAdmin({ central: ctx.m.central, actor: { rol: 'admin', usuario: 'galo' }, fuente: () => ctx.m.central.repo.ops(), cajas: [{ tienda: 'DUO', caja: 1 }] as never, tiendas: () => ['DUO', 'LON'] } as never);
    a.importarVentasHistoricas({ filas: HOJA, tienda: 'DUO', caja: 1, nombre: 'prueba.xlsx' });
    const hojas = a.hojasVentas({ desde: '2026-09-01', hasta: '2026-09-30' });
    assert.deepEqual(hojas.map((h) => h.nombre), ['Detalle de ventas', 'Resumen por día']);
    const { escribirXlsxNode, leerXlsxNode } = await import('../src/xlsx-node.ts');
    const leidas = await leerXlsxNode(await escribirXlsxNode(hojas));
    const det = leidas[0]!.filas;
    assert.deepEqual(det[0], ['Fecha', 'Folio', 'Tipo', 'Piezas', 'Total', 'Forma de pago', 'Tienda', 'Caja', 'Hora', 'Vendedora-Cajera', 'Vendió', 'Estado', 'Origen']);
    assert.equal(det.length, 9, 'encabezado y 8 tickets');
    assert.match(String(det[1]![0]), /^2026-09-01T/, 'la fecha es una fecha real de Excel');
    assert.deepEqual([det[1]![1], det[1]![2], det[1]![3], det[1]![4], det[1]![5], det[1]![6], det[1]![7], det[1]![12]], [1001, 'Venta', 1, 549, 'Tarjeta', 'DÚO', 1, 'POS anterior']);
    assert.deepEqual([det[5]![1], det[5]![2], det[5]![3], det[5]![4]], [1005, 'Fee por daño', 0, 30]);
    assert.deepEqual([det[6]![2], det[6]![4]], ['Cambio', 0]);
    assert.equal(det[7]![4], -150, 'el fee negativo conserva su signo');
    const res = leidas[1]!.filas;
    assert.deepEqual(res[0], ['Fecha', 'Tienda', 'Tickets', 'Piezas', 'Efectivo', 'Tarjeta', 'Dólares (equivalente MXN)', 'Tarjeta de regalo', 'Otros', 'Mixto (sin desglose)', 'Fees por daño', 'Total']);
    const dia14 = res.find((f) => String(f[0]).startsWith('2026-09-14'))!;
    assert.deepEqual([dia14[2], dia14[3], dia14[4], dia14[10], dia14[11]], [2, 0, -150, -150, -150], '14/09: un cambio de $0 y un fee de −$150');
    const total = res.find((f) => f[0] === 'TOTAL')!;
    assert.deepEqual([total[2], total[3], total[4], total[5], total[9], total[10], total[11]], [8, 9, 203 + 30 - 150, 549 + 1698 + 399, 654, 30 - 150, 3383], 'tickets, piezas, efectivo, tarjeta, mixto, fees y total del periodo');

    // Una venta nueva de la caja (hoy) entra al mismo reporte, con su hora y su forma de pago, y se distingue del histórico.
    const v = vender(ctx.m, 'DUO', 1, ctx.items[2]!.item_id).venta;
    ctx.m.pump();
    const todo = a.reporte({});
    const nueva = todo.filas.find((f) => !f.historico)!;
    assert.deepEqual([nueva.folio, nueva.tipo_ticket, nueva.pago, nueva.piezas, nueva.total], [v.folio, 'venta', 'Efectivo', 1, v.total]);
    assert.match(nueva.hora, /^\d\d:\d\d$/);
    assert.equal(nueva.montos.efectivo, v.total);
    assert.deepEqual(todo.porCaja.map((c) => [c.caja, c.historico ?? false, c.tickets]).sort(), [[1, false, 1], [1, true, 8]], 'la serie nueva y la histórica no se mezclan');
    const det2 = (await leerXlsxNode(await escribirXlsxNode(a.hojasVentas({})))) [0]!.filas;
    assert.equal(det2.filter((f) => f[12] === 'POS nuevo').length, 1);
  });
});

it('HV3 un reporte de varios años: las fechas intercambiadas se corrigen con los folios vecinos (no solo las de un mes)', () => {
  // Folios consecutivos desde el 1 de enero de 2024, 3 tickets por día. Excel deja como fecha (ISO) las de día ≤ 12 con día y mes intercambiados; las de día > 12 quedan como texto dd/mm/aaaa.
  const filas: unknown[][] = [ENCABEZADO];
  const esperadas = new Map<number, string>();
  let folio = 43000;
  for (let t = Date.UTC(2024, 0, 1); t <= Date.UTC(2025, 11, 31); t += 86_400_000) {
    const d = new Date(t), y = d.getUTCFullYear(), m = d.getUTCMonth() + 1, dd = d.getUTCDate();
    for (let k = 0; k < 3; k++, folio++) {
      esperadas.set(folio, `${y}-${String(m).padStart(2, '0')}-${String(dd).padStart(2, '0')}`);
      const p2 = (n: number) => String(n).padStart(2, '0');
      filas.push(fila(dd > 12 || dd === m ? `${p2(dd)}/${p2(m)}/${y}` : `${y}-${p2(dd)}-${p2(m)}T00:00:00.000Z`, folio, 'Sales', 1, 100 + (folio % 7), 'Cash'));
    }
  }
  const r = revisarReporteAnterior(filas);
  assert.deepEqual(r.errores, []);
  const malas = r.filas.filter((f) => f.fecha !== esperadas.get(f.folio));
  assert.equal(malas.length, 0, `fechas mal: ${malas.slice(0, 3).map((f) => `${f.folio}→${f.fecha} (esperada ${esperadas.get(f.folio)})`).join('; ')}`);
  assert.equal(r.resumen.desde, '2024-01-01');
  assert.equal(r.resumen.hasta, '2025-12-31');
  assert.ok(r.resumen.fechas_corregidas > 600, 'se corrigieron muchas fechas dudosas');
  assert.ok(!r.avisos.some((a) => /no van en orden/.test(a)), 'con las fechas bien, van en orden respecto a los folios');
});
