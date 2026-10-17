import assert from 'node:assert/strict';
import { it } from 'node:test';
import { aFilasExportables, cortesPorCaja, reporteConsolidado, ventasPorCaja } from '../src/consultas.ts';
import type { Actor } from '../src/tipos.ts';
import { nuevoMundo, politica, porAlmacen, vender, type Ctx } from './ayudas/comun.ts';

const admin: Actor = { rol: 'admin', usuario: 'galo' };
const cajeroDe = (tienda: string, caja: number): Actor => ({ rol: 'cajero', usuario: `c-${tienda}${caja}`, tienda, caja });

function escenario(ctx: Ctx) {
  const { m, items } = ctx;
  const x = items[2]!.item_id; // mascada $120.00
  const dias = ['2026-10-30T20:00:00Z', '2026-10-31T20:00:00Z', '2026-11-02T20:00:00Z'];
  for (const d of dias) {
    m.reloj.fijar(d);
    vender(m, 'DUO', 1, x, 1);
    vender(m, 'DUO', 2, x, 2);
    vender(m, 'LON', 1, x, 1);
    vender(m, 'LON', 2, x, 3);
  }
  m.pump();
}

porAlmacen('Permisos de reportes y cortes', (alm) => {
  it('PR1 el cajero solo ve ventas de su caja, aunque el origen de datos tenga todas', (t) => {
    const ctx = nuevoMundo(alm, politica());
    t.after(ctx.limpiar);
    escenario(ctx);
    const propio = ventasPorCaja(cajeroDe('DUO', 1), ctx.m.caja('DUO', 1).ops());
    assert.equal(propio.length, 3);
    // Misma consulta contra el central (que contiene las cuatro cajas): el filtro lo impone el permiso, no la ausencia de datos.
    const contraCentral = ventasPorCaja(cajeroDe('DUO', 1), ctx.m.central.repo.ops());
    assert.deepEqual(contraCentral, propio);
    assert.ok(contraCentral.every((r) => r.tienda === 'DUO' && r.caja === 1));
    assert.deepEqual(ventasPorCaja(cajeroDe('LON', 2), ctx.m.central.repo.ops()).map((r) => r.folio), [1, 2, 3]);
  });

  it('PR2 el cajero no puede pedir otra caja, varias cajas ni el consolidado', (t) => {
    const ctx = nuevoMundo(alm, politica());
    t.after(ctx.limpiar);
    escenario(ctx);
    const ops = ctx.m.central.repo.ops();
    const c = cajeroDe('DUO', 1);
    assert.throws(() => ventasPorCaja(c, ops, { cajas: [{ tienda: 'DUO', caja: 2 }] }), { codigo: 'PROHIBIDO' });
    assert.throws(() => ventasPorCaja(c, ops, { cajas: [{ tienda: 'LON', caja: 1 }] }), { codigo: 'PROHIBIDO' });
    assert.throws(() => ventasPorCaja(c, ops, { cajas: [{ tienda: 'DUO', caja: 1 }, { tienda: 'DUO', caja: 2 }] }), { codigo: 'PROHIBIDO' });
    assert.throws(() => reporteConsolidado(c, ops), { codigo: 'PROHIBIDO' });
    assert.throws(() => cortesPorCaja(c, ops, { cajas: [{ tienda: 'DUO', caja: 2 }] }), { codigo: 'PROHIBIDO' });
    assert.doesNotThrow(() => ventasPorCaja(c, ops, { cajas: [{ tienda: 'DUO', caja: 1 }] }));
  });

  it('PR3 Administración consolida todo o elige cajas de tiendas distintas, sin renumerar', (t) => {
    const ctx = nuevoMundo(alm, politica());
    t.after(ctx.limpiar);
    escenario(ctx);
    const ops = ctx.m.central.repo.ops();
    const todo = reporteConsolidado(admin, ops);
    assert.equal(todo.filas.length, 12);
    assert.equal(todo.porCaja.length, 4);
    assert.equal(todo.total, todo.porCaja.reduce((a, c) => a + c.total, 0));
    for (const caja of todo.porCaja) {
      const folios = todo.filas.filter((r) => r.tienda === caja.tienda && r.caja === caja.caja).map((r) => r.folio);
      assert.deepEqual(folios, [1, 2, 3], `${caja.tienda}/${caja.caja} conserva su folio original`);
    }
    const sel = reporteConsolidado(admin, ops, { cajas: [{ tienda: 'DUO', caja: 2 }, { tienda: 'LON', caja: 1 }] });
    assert.equal(sel.filas.length, 6);
    assert.deepEqual([...new Set(sel.filas.map((r) => `${r.tienda}/${r.caja}`))].sort(), ['DUO/2', 'LON/1']);
    assert.ok(sel.filas.every((r) => [1, 2, 3].includes(r.folio)), 'ningún folio fue sustituido por un ordinal del reporte');
    assert.equal(sel.total, 3 * 2 * 12000 + 3 * 1 * 12000);
  });

  it('PR4 el reporte mensual de una caja no contiene ventas de otras ni de otros meses', (t) => {
    const ctx = nuevoMundo(alm, politica());
    t.after(ctx.limpiar);
    escenario(ctx);
    const ops = ctx.m.central.repo.ops();
    const oct = ventasPorCaja(admin, ops, { cajas: [{ tienda: 'LON', caja: 2 }], desde: '2026-10-01', hasta: '2026-10-31' });
    assert.deepEqual(oct.map((r) => r.folio), [1, 2], 'octubre: folios 1 y 2');
    const nov = ventasPorCaja(admin, ops, { cajas: [{ tienda: 'LON', caja: 2 }], desde: '2026-11-01', hasta: '2026-11-30' });
    assert.deepEqual(nov.map((r) => r.folio), [3], 'noviembre continúa en el 3 (sin reinicio)');
    assert.ok([...oct, ...nov].every((r) => r.tienda === 'LON' && r.caja === 2));
  });

  it('PR5 el límite de mes usa la hora de Hermosillo (UTC-7)', (t) => {
    const ctx = nuevoMundo(alm, politica());
    t.after(ctx.limpiar);
    ctx.m.reloj.fijar('2026-11-01T05:00:00Z'); // 22:00 del 31 de octubre en Hermosillo
    vender(ctx.m, 'DUO', 1, ctx.items[2]!.item_id);
    ctx.m.reloj.fijar('2026-11-01T07:30:00Z'); // 00:30 del 1 de noviembre
    vender(ctx.m, 'DUO', 1, ctx.items[2]!.item_id);
    ctx.m.pump();
    const ops = ctx.m.central.repo.ops();
    assert.deepEqual(ventasPorCaja(admin, ops, { desde: '2026-10-01', hasta: '2026-10-31' }).map((r) => r.folio), [1]);
    assert.deepEqual(ventasPorCaja(admin, ops, { desde: '2026-11-01', hasta: '2026-11-30' }).map((r) => r.folio), [2]);
  });

  it('PR6 tienda, caja y folio originales idénticos al consultar localmente, en el central y al exportar', (t) => {
    const ctx = nuevoMundo(alm, politica());
    t.after(ctx.limpiar);
    escenario(ctx);
    const local = ventasPorCaja(cajeroDe('DUO', 2), ctx.m.caja('DUO', 2).ops());
    const central = ventasPorCaja(admin, ctx.m.central.repo.ops(), { cajas: [{ tienda: 'DUO', caja: 2 }] });
    assert.deepEqual(local, central);
    const filas = aFilasExportables(central);
    assert.deepEqual(filas.map((f) => [f.Tienda, f.Caja, f.Folio]), [['DUO', 2, 1], ['DUO', 2, 2], ['DUO', 2, 3]]);
    assert.equal(filas[0]!['Total MXN'], '240.00', 'importe exacto en texto decimal');
  });

  it('PR7 cada caja tiene su corte independiente y el cajero solo ve el suyo', (t) => {
    const ctx = nuevoMundo(alm, politica());
    t.after(ctx.limpiar);
    const { m, items } = ctx;
    m.reloj.fijar('2026-10-30T20:00:00Z');
    const c1 = m.caja('DUO', 1);
    const c2 = m.caja('DUO', 2);
    c1.movimientoEfectivo('fondo_inicial', 200000);
    c2.movimientoEfectivo('fondo_inicial', 100000);
    const v1 = vender(m, 'DUO', 1, items[2]!.item_id, 2).venta; // 240.00
    vender(m, 'DUO', 1, items[2]!.item_id, 1); // 120.00
    vender(m, 'DUO', 2, items[2]!.item_id, 1); // 120.00
    c1.devolver({ sale_id: v1.sale_id, renglones: [{ linea_id: v1.lineas[0]!.linea_id, qty: 1 }], motivo: 'talla' });
    c1.movimientoEfectivo('retiro', 15000);
    const k1 = c1.generarCorte('2026-10-30');
    const k2 = c2.generarCorte('2026-10-30');
    assert.equal(k1.tickets, 2);
    assert.equal(k1.ventas, 36000);
    assert.equal(k1.devoluciones, 12000);
    assert.equal(k1.ventas_netas, 24000);
    assert.equal(k1.efectivo_esperado, 200000 + 36000 - 12000 - 15000, 'fondo + cobros − reembolsos − retiros');
    assert.deepEqual([k1.folio_inicial, k1.folio_final], [1, 3], 'la devolución consume el folio 3 de la misma serie (P-08)');
    assert.equal(k1.folios_de_devolucion, 1);
    assert.equal(k2.tickets, 1);
    assert.equal(k2.efectivo_esperado, 100000 + 12000);
    assert.deepEqual([k2.folio_inicial, k2.folio_final], [1, 1]);
    assert.equal(c1.generarCorte('2026-10-30').efectivo_esperado, k1.efectivo_esperado, 'el corte del día es idempotente');
    m.pump();
    const ops = m.central.repo.ops();
    assert.equal(cortesPorCaja(cajeroDe('DUO', 2), ops).length, 1);
    assert.equal(cortesPorCaja(cajeroDe('DUO', 2), ops)[0]!.efectivo_esperado, k2.efectivo_esperado);
    assert.equal(cortesPorCaja(admin, ops).length, 2);
  });
});
