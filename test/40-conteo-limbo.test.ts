import assert from 'node:assert/strict';
import { it } from 'node:test';
import { ServicioAdmin } from '../src/app/servicio.ts';
import { LIMBO, type Op } from '../src/tipos.ts';
import { nuevoMundo, politica, porAlmacen, servicioDe } from './ayudas/comun.ts';

const mov = (item_id: string, delta: number): Op => ({ op_id: `mov:limbo:${item_id}`, tipo: 'inv.movement', tienda: LIMBO, caja: null, origen: 'importacion:t', ocurrio_en: '2026-10-01T15:00:00Z', payload: { item_id, tienda: LIMBO, delta, tipo: 'limbo_inicial', doc: 'importacion:t' } });

porAlmacen('Conteo físico de El Limbo', (alm) => {
  const mundo = (t: { after(f: () => void): void }) => {
    const ctx = nuevoMundo(alm, politica());
    t.after(ctx.limpiar);
    ctx.m.sembrarOps([mov(ctx.items[0]!.item_id, 10), mov(ctx.items[1]!.item_id, 4), mov(ctx.items[3]!.item_id, 0)]);
    const admin = new ServicioAdmin({ central: ctx.m.central, actor: { rol: 'admin', usuario: 'galo' }, fuente: () => ctx.m.central.repo.ops(), cajas: ctx.m.ctx.cajasCfg.map((c) => ({ tienda: c.tienda, caja: c.caja })), inventario: ctx.m.inventarioCentral() });
    return { ctx, admin };
  };
  const limbo = (ctx: ReturnType<typeof mundo>['ctx'], t: string, c: number, item: string) => ctx.m.caja(t, c).saldoLimbo(item);

  it('CL1 el conteo deja El Limbo en lo contado, lo ven todas las cajas, no toca lo no contado y reintentar no repite', (t) => {
    const { ctx, admin } = mundo(t);
    const [i0, i1, , i3] = [ctx.items[0]!.item_id, ctx.items[1]!.item_id, '', ctx.items[3]!.item_id];
    const r = admin.contarLimbo({ conteo_id: 'c1', lineas: [{ item_id: i0, contado: 7 }, { item_id: i3, contado: 12 }] });
    assert.deepEqual([r.conteo.articulos, r.conteo.con_diferencia, r.conteo.sobrantes, r.conteo.faltantes], [2, 2, 12, 3]);
    ctx.m.pump(); ctx.m.pump(); ctx.m.pump();
    for (const [tt, c] of [['DUO', 1], ['DUO', 2], ['LON', 1], ['LON', 2]] as const) assert.deepEqual([limbo(ctx, tt, c, i0), limbo(ctx, tt, c, i3), limbo(ctx, tt, c, i1)], [7, 12, 4], `${tt}/${c}: lo no contado queda igual`);
    const n = ctx.m.central.repo.ops().length;
    const otra = admin.contarLimbo({ conteo_id: 'c1', lineas: [{ item_id: i0, contado: 1 }] });
    assert.equal(otra.conteos.length, 1);
    assert.equal(ctx.m.central.repo.ops().length, n, 'reintento con el mismo conteo: nada se duplica ni se cambia');
    // contar lo mismo no genera movimientos; una diferencia posterior es contra el saldo vigente
    admin.contarLimbo({ conteo_id: 'c2', lineas: [{ item_id: i0, contado: 7 }, { item_id: i1, contado: 0 }] });
    ctx.m.pump(); ctx.m.pump(); ctx.m.pump();
    assert.deepEqual([limbo(ctx, 'LON', 1, i0), limbo(ctx, 'LON', 1, i1)], [7, 0]);
    assert.deepEqual(admin.conteosLimbo().map((c) => [c.conteo_id, c.articulos, c.con_diferencia, c.faltantes]), [['c2', 2, 1, 4], ['c1', 2, 2, 3]]);
  });

  it('CL2 una venta posterior descuenta del conteo y un artículo fuera del conteo (o inválido) no se toca', async (t) => {
    const { ctx, admin } = mundo(t);
    const i0 = ctx.items[0]!.item_id;
    assert.throws(() => admin.contarLimbo({ conteo_id: 'x', lineas: [{ item_id: i0, contado: -1 }] }), { codigo: 'CANTIDAD_INVALIDA' });
    assert.throws(() => admin.contarLimbo({ conteo_id: 'x', lineas: [{ item_id: i0, contado: 1.5 }] }), { codigo: 'CANTIDAD_INVALIDA' });
    assert.throws(() => admin.contarLimbo({ conteo_id: 'x', lineas: [{ item_id: 'no-existe', contado: 1 }] }), { codigo: 'ARTICULO_INEXISTENTE' });
    assert.throws(() => admin.contarLimbo({ conteo_id: 'x', lineas: [] }), { codigo: 'DATOS_REQUERIDOS' });
    assert.equal(admin.conteosLimbo().length, 0);
    admin.contarLimbo({ conteo_id: 'c1', lineas: [{ item_id: i0, contado: 20 }] });
    ctx.m.pump(); ctx.m.pump(); ctx.m.pump();
    const s = servicioDe(ctx, 'LON', 1, 'Luis');
    const c = s.svc.nuevaVenta();
    s.svc.escanear(c, '0002026090782'); s.svc.escanear(c, '0002026090782');
    await s.svc.cobrarEfectivo(c, 999999, 0);
    ctx.m.pump(); ctx.m.pump(); ctx.m.pump();
    assert.equal(limbo(ctx, 'DUO', 1, i0), 18);
    // el historial del artículo muestra el conteo
    assert.ok(admin.historialArticulo(i0).eventos.some((e: any) => e.evento === 'Conteo físico' && /El Limbo/.test(e.detalle)));
  });

  it('CL3 buscar por código (exacto, UPC o código alterno) y revisar un archivo de conteo: reconoce, suma repetidos y separa lo que no entiende', (t) => {
    const { admin } = mundo(t);
    const b = admin.buscarLimbo('0002026090782');
    assert.deepEqual([b.articulos.length, b.articulos[0]!.sistema, b.articulos[0]!.item_no], [1, 10, '1001']);
    assert.equal(admin.buscarLimbo('202609078').articulos.length, 1, 'el código corto de la etiqueta');
    assert.equal(admin.buscarLimbo('9999999999999').articulos.length, 0);
    const r = admin.revisarConteoLimbo([
      { codigo: '0002026090782', cantidad: 3 }, { codigo: '0002026090782', cantidad: 2 }, // se suman
      { codigo: '0002026090799', cantidad: '4' }, { codigo: 'NOEXISTE1234', cantidad: 1 }, { codigo: '0000000000017', cantidad: -2 }, { codigo: '0000000000017', cantidad: 'abc' },
    ]);
    assert.deepEqual(r.reconocidas.map((x) => [x.item_no, x.contado, x.sistema]), [['1001', 5, 10], ['1002', 4, 4]]);
    assert.deepEqual([r.noEncontradas.length, r.invalidas.length], [1, 2]);
  });
});
