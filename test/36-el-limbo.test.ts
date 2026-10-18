import assert from 'node:assert/strict';
import { it } from 'node:test';
import { ServicioAdmin } from '../src/app/servicio.ts';
import { detectar } from '../src/incidencias.ts';
import { aOperacionesInventario, leerInventario, perfilConCantidad, PERFIL_CONFIRMADO } from '../src/inventario.ts';
import { LIMBO, type Op } from '../src/tipos.ts';
import { nuevoMundo, politica, porAlmacen, servicioDe } from './ayudas/comun.ts';

const mov = (item_id: string, delta: number): Op => ({ op_id: `mov:limbo:${item_id}`, tipo: 'inv.movement', tienda: LIMBO, caja: null, origen: 'importacion:t', ocurrio_en: '2026-10-01T15:00:00Z', payload: { item_id, tienda: LIMBO, delta, tipo: 'limbo_inicial', doc: 'importacion:t' } });

porAlmacen('El Limbo: catálogo inicial que se vende en todas las tiendas y se descuenta de un almacén común', (alm) => {
  // 0: Limbo 10 y DÚO 5 / LON 3 · 1: Limbo 0 y DÚO 3 · 2: fuera del Limbo · 3: Limbo 0 y DÚO 1
  const mundo = (t: { after(f: () => void): void }) => {
    const ctx = nuevoMundo(alm, politica());
    t.after(ctx.limpiar);
    ctx.m.sembrarOps([mov(ctx.items[0]!.item_id, 10), mov(ctx.items[1]!.item_id, 0), mov(ctx.items[3]!.item_id, 0)]);
    return ctx;
  };
  const vender = async (ctx: ReturnType<typeof mundo>, tienda: string, caja: number, codigo: string, qty: number) => {
    const s = servicioDe(ctx, tienda, caja, 'Ana');
    const c = s.svc.nuevaVenta();
    for (let i = 0; i < qty; i++) s.svc.escanear(c, codigo);
    return { s, venta: (await s.svc.cobrarEfectivo(c, 999999, 0)).venta };
  };
  const limbo = (ctx: ReturnType<typeof mundo>, tienda: string, caja: number, item: string) => ctx.m.caja(tienda, caja).saldoLimbo(item);

  it('LI1 vender en cualquier tienda descuenta de El Limbo y todas las cajas ven el mismo saldo', async (t) => {
    const ctx = mundo(t);
    const i0 = ctx.items[0]!.item_id;
    const a = await vender(ctx, 'DUO', 1, '0002026090782', 4);
    assert.equal(a.venta.lineas[0]!.de_limbo, 4);
    assert.equal(ctx.m.caja('DUO', 1).stockLocal(i0), 5, 'la existencia de la tienda no se toca');
    const b = await vender(ctx, 'LON', 1, '0002026090782', 3);
    assert.equal(b.venta.lineas[0]!.de_limbo, 3);
    ctx.m.pump(); ctx.m.pump(); ctx.m.pump();
    for (const [t2, c] of [['DUO', 1], ['DUO', 2], ['LON', 1], ['LON', 2]] as const) assert.equal(limbo(ctx, t2, c, i0), 3, `${t2}/${c}`);
    assert.equal(ctx.m.caja('LON', 1).stockLocal(i0), 3);
  });

  it('LI2 si El Limbo no tiene existencia registrada se usa la de la tienda y lo que falte deja El Limbo en negativo', async (t) => {
    const ctx = mundo(t);
    const i1 = ctx.items[1]!.item_id;
    const a = await vender(ctx, 'DUO', 1, '0002026090799', 2); // El Limbo 0, DÚO 3 → sale de DÚO
    assert.equal(a.venta.lineas[0]!.de_limbo, undefined);
    assert.equal(ctx.m.caja('DUO', 1).stockLocal(i1), 1);
    const b = await vender(ctx, 'DUO', 1, '0002026090799', 3); // 1 de DÚO y 2 más que quedan en El Limbo
    assert.equal(b.venta.lineas[0]!.de_limbo, 2);
    assert.deepEqual([ctx.m.caja('DUO', 1).stockLocal(i1), limbo(ctx, 'DUO', 1, i1)], [0, -2]);
    // en London, sin existencia propia, todo sale de El Limbo
    const c = await vender(ctx, 'LON', 1, '0000000000017', 2);
    assert.equal(c.venta.lineas[0]!.de_limbo, 2);
    ctx.m.pump(); ctx.m.pump(); ctx.m.pump();
    assert.equal(limbo(ctx, 'DUO', 1, ctx.items[3]!.item_id), -2);
  });

  it('LI3 un artículo fuera del catálogo inicial sigue descontando de la tienda, y cancelar una venta regresa las piezas a El Limbo', async (t) => {
    const ctx = mundo(t);
    const i2 = ctx.items[2]!.item_id;
    assert.equal(limbo(ctx, 'DUO', 1, i2), null);
    const a = await vender(ctx, 'DUO', 1, '7501234567890', 2);
    assert.deepEqual([a.venta.lineas[0]!.de_limbo, ctx.m.caja('DUO', 1).stockLocal(i2)], [undefined, 48]);
    const i0 = ctx.items[0]!.item_id;
    const b = await vender(ctx, 'DUO', 1, '0002026090782', 4);
    assert.equal(limbo(ctx, 'DUO', 1, i0), 6);
    b.s.svc.cancelarVenta(b.venta.sale_id, 'prueba');
    assert.deepEqual([limbo(ctx, 'DUO', 1, i0), ctx.m.caja('DUO', 1).stockLocal(i0)], [10, 5]);
  });

  it('LI4 Administración ve la columna El Limbo, el Excel la trae y un saldo negativo no es una incidencia por artículo', async (t) => {
    const ctx = mundo(t);
    await vender(ctx, 'LON', 1, '0000000000017', 2);
    ctx.m.pump(); ctx.m.pump(); ctx.m.pump();
    const a = new ServicioAdmin({ central: ctx.m.central, actor: { rol: 'admin', usuario: 'galo' }, fuente: () => ctx.m.central.repo.ops(), cajas: ctx.m.ctx.cajasCfg.map((c) => ({ tienda: c.tienda, caja: c.caja })), inventario: ctx.m.inventarioCentral() });
    const r = a.buscarArticulos('BOLSA', 10, 0, true);
    assert.equal(r.articulos[0]!.limbo, -2);
    const inv = a.inventario(true);
    assert.ok(inv.hoja.encabezados.includes('Existencia El Limbo'));
    assert.equal((inv.resumen.por_tienda as any).LIMBO.piezas, 10 - 0 - 0 - 2);
    const inc = detectar(ctx.m.central.repo.ops());
    assert.ok(!inc.some((x: any) => x.tipo === 'stock_negativo' && x.tienda === LIMBO));
  });

  it('LI5 la cantidad que trae el archivo es la existencia inicial de El Limbo (columna reconocida o elegida) y las filas sin cantidad usan el valor de respaldo', () => {
    const enc = ['Item #', 'Item Name', 'Item Description', 'Estilo', 'Lote', 'Size', 'Regular Price', 'x', 'UPC', 'Department Name', 'Piezas'];
    const filas = [enc, [1, 'LEVIS', 'JEANS', '726', '1', '', 500, 0, '9001', 'DAMA', 7], [2, 'LEVIS', 'BLUSA', '727', '1', '', 300, 0, '9002', 'DAMA', -2], [3, 'LEVIS', 'FALDA', '728', '1', '', 300, 0, '9003', 'DAMA', ''], [4, 'LEVIS', 'GRATIS', '729', '1', '', 0, 0, '9004', 'DAMA', 4]];
    const movs = (perfil = PERFIL_CONFIRMADO) => aOperacionesInventario(leerInventario(filas, perfil).articulos, { ahora: '2026-10-01T15:00:00Z', idImportacion: 'x', limbo: { piezas: 3, delArchivo: true } }).ops.filter((o) => o.tipo === 'inv.movement').map((o) => o.payload.delta);
    assert.deepEqual(movs(), [3, 3, 3], 'la columna «Piezas» no se reconoce sola: todas usan el respaldo');
    assert.ok(leerInventario(filas, PERFIL_CONFIRMADO).columnas.faltantes.includes('existencia'));
    assert.deepEqual(movs(perfilConCantidad(PERFIL_CONFIRMADO, 'Piezas')), [7, -2, 3], 'con la columna elegida: la del archivo, tal cual (también negativas); sin cantidad → respaldo; sin precio vendible no se carga');
  });
});
