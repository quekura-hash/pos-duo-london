import assert from 'node:assert/strict';
import { it } from 'node:test';
import { existenciaAlmacen } from '../src/almacen.ts';
import { ServicioAdmin, analizarBusqueda } from '../src/app/servicio.ts';
import { LIMBO, type Op } from '../src/tipos.ts';
import { api, appAdmin } from './ayudas/app.ts';
import { nuevoMundo, politica, porAlmacen } from './ayudas/comun.ts';

const mov = (item_id: string, delta: number): Op => ({ op_id: `mov:limbo:${item_id}`, tipo: 'inv.movement', tienda: LIMBO, caja: null, origen: 'importacion:t', ocurrio_en: '2026-10-01T15:00:00Z', payload: { item_id, tienda: LIMBO, delta, tipo: 'limbo_inicial', doc: 'importacion:t' } });
const articulo = (item_id: string, item_no: string, lote: string, descripcion = 'CAMISA'): Op => ({
  op_id: `item:${item_id}`, tipo: 'item.created', tienda: null, caja: null, origen: 'migracion', ocurrio_en: '2026-10-01T15:00:00Z',
  payload: { item_id, codigo: `99${item_no}`, item_no, marca: 'TM', descripcion, estilo: '123L', lote, departamento: 'CABALLERO', precio: 25000, origen: 'migracion' },
});

const limbo = (ctx: { m: ReturnType<typeof nuevoMundo>['m'] }, item: string, t = 'DUO', c = 1) => ctx.m.caja(t, c).saldoLimbo(item);
const almacen = (ctx: { m: ReturnType<typeof nuevoMundo>['m'] }, item: string) => existenciaAlmacen(ctx.m.central.repo.ops()).get(item)?.existencia ?? 0;

porAlmacen('Ubicación real de las piezas de El Limbo: almacén, tienda o baja', (alm) => {
  const mundo = (t: { after(f: () => void): void }) => {
    const ctx = nuevoMundo(alm, politica());
    t.after(ctx.limpiar);
    // cuatro camisas viejas (sin lote) con piezas en El Limbo, una con lote 202610 y una sin piezas
    ctx.m.sembrarOps([
      articulo('v1', '2001', ''), articulo('v2', '2002', ''), articulo('v3', '2003', '0'), articulo('n1', '2004', '202610'), articulo('v4', '2005', ''),
      mov('v1', 6), mov('v2', 3), mov('v3', 2), mov('n1', 9), mov('v4', 0),
    ]);
    const admin = new ServicioAdmin({ central: ctx.m.central, actor: { rol: 'admin', usuario: 'galo' }, fuente: () => ctx.m.central.repo.ops(), cajas: ctx.m.ctx.cajasCfg.map((c) => ({ tienda: c.tienda, caja: c.caja })), inventario: ctx.m.inventarioCentral() });
    return { ctx, admin };
  };

  it('LB1 pasar al almacén: El Limbo baja, el almacén sube, lo ven todas las cajas, reintentar no repite y el historial lo cuenta', (t) => {
    const { ctx, admin } = mundo(t);
    const rev = admin.reubicarLimbo({ movimiento_id: 'm1', destino: 'almacen', items: [{ item_id: 'v1' }, { item_id: 'v2' }, { item_id: 'v4' }], solo_revisar: true });
    assert.deepEqual([rev.articulos, rev.piezas, rev.omitidos_total, rev.aplicado], [2, 9, 1, false], 'revisar no guarda nada (v4 no tiene piezas)');
    assert.deepEqual([limbo(ctx, 'v1'), almacen(ctx, 'v1')], [6, 0]);
    const r = admin.reubicarLimbo({ movimiento_id: 'm1', destino: 'almacen', items: [{ item_id: 'v1' }, { item_id: 'v2' }, { item_id: 'v4' }] });
    assert.deepEqual([r.articulos, r.piezas, r.aplicado, r.repetido], [2, 9, true, false]);
    ctx.m.pump(); ctx.m.pump(); ctx.m.pump();
    assert.deepEqual([almacen(ctx, 'v1'), almacen(ctx, 'v2'), almacen(ctx, 'v4')], [6, 3, 0]);
    for (const [tt, c] of [['DUO', 1], ['LON', 2]] as const) assert.deepEqual([limbo(ctx, 'v1', tt, c), limbo(ctx, 'v2', tt, c), limbo(ctx, 'n1', tt, c)], [0, 0, 9], `${tt}/${c}: lo no seleccionado queda igual`);
    const n = ctx.m.central.repo.ops().length;
    const otra = admin.reubicarLimbo({ movimiento_id: 'm1', destino: 'almacen', items: [{ item_id: 'v3' }] });
    assert.equal(otra.repetido, true);
    assert.equal(ctx.m.central.repo.ops().length, n, 'reintentar el mismo movimiento no repite nada');
    // aparece en la pantalla de Almacén y de ahí se saca a piso con la entrega de siempre
    assert.equal(admin.almacen().items.find((i) => i.item_id === 'v1')?.existencia, 6);
    const e = ctx.m.central.entregar({ item_id: 'v1', destinos: { DUO: 2 }, etiqueta_precio: true, etiqueta_costura: true, por: 'galo' });
    assert.deepEqual([e.ok, e.ok && e.existencia_almacen], [true, 4]);
    const h = admin.historialArticulo('v1').eventos.map((e) => e.evento);
    assert.ok(h.includes('Ubicación real'), 'el historial del artículo cuenta la ubicación real');
  });

  it('LB2 «baja» solo quita de El Limbo; la cantidad fija mueve exactamente esa cantidad; una tienda no es destino (se saca a piso desde el almacén)', (t) => {
    const { ctx, admin } = mundo(t);
    admin.reubicarLimbo({ movimiento_id: 'b', destino: 'baja', items: [{ item_id: 'v2' }] });
    admin.reubicarLimbo({ movimiento_id: 'c', destino: 'almacen', cantidad: 1, items: [{ item_id: 'v3' }] });
    ctx.m.pump(); ctx.m.pump(); ctx.m.pump();
    assert.deepEqual([limbo(ctx, 'v2'), almacen(ctx, 'v2'), ctx.m.caja('DUO', 1).stockLocal('v2')], [0, 0, 0], 'dadas de baja: no aparecen en ningún lado');
    assert.deepEqual([limbo(ctx, 'v3'), almacen(ctx, 'v3')], [1, 1]);
    assert.throws(() => admin.reubicarLimbo({ movimiento_id: 'd', destino: 'DUO', items: [{ item_id: 'v1' }] }), { codigo: 'DESTINO_INVALIDO' });
    // más de lo que tiene El Limbo: se permite (queda negativo) y se avisa
    const r = admin.reubicarLimbo({ movimiento_id: 'e', destino: 'almacen', cantidad: 5, items: [{ item_id: 'v3' }] });
    assert.deepEqual([r.piezas, r.quedan_negativos], [5, 1]);
    ctx.m.pump(); ctx.m.pump(); ctx.m.pump();
    assert.deepEqual([limbo(ctx, 'v3'), almacen(ctx, 'v3')], [-4, 6]);
    assert.equal(ctx.m.central.repo.ops().filter((o) => o.tipo === 'limbo.reubicacion').length, 3);
  });

  it('LB3 el buscador entiende Lote=0 (sin lote), Limbo>0 y Almacén; «todo lo que muestra el buscador» menos los quitados', (t) => {
    const { ctx, admin } = mundo(t);
    const ids = (q: string) => admin.buscarArticulos(q, 50, 0, true).articulos.map((a) => a.item_id).sort();
    assert.deepEqual(ids('lote=0'), ['v1', 'v2', 'v3', 'v4'], 'Lote=0 son los sin lote; no confunde 202610 ni 20260913 (contienen un 0)');
    assert.deepEqual(ids('lote=sin camisa'), ['v1', 'v2', 'v3', 'v4']);
    assert.deepEqual(ids('lote=0 limbo>0'), ['v1', 'v2', 'v3'], 'sin lote y con piezas en El Limbo');
    assert.deepEqual(ids('lote=202610'), ['n1', 'seed2', 'seed4'], 'un lote real se sigue buscando por contenido (también 20261014)');
    assert.deepEqual(analizarBusqueda('limbo>0 almacen>=2').filtros.map((f) => [f.campo, f.op, f.valor]), [['limbo', '>', 0], ['almacen', '>=', 2]]);
    // seleccionar todo lo del buscador y quitar v2
    const r = admin.reubicarLimbo({ movimiento_id: 'f1', destino: 'almacen', filtro: 'lote=0 limbo>0', excluir: ['v2'] });
    assert.deepEqual([r.seleccionados, r.articulos, r.piezas], [2, 2, 8]);
    ctx.m.pump(); ctx.m.pump(); ctx.m.pump();
    assert.deepEqual([limbo(ctx, 'v1'), limbo(ctx, 'v2'), limbo(ctx, 'v3'), limbo(ctx, 'n1')], [0, 3, 0, 9], 'v2 (quitado) y la de lote 202610 no se tocaron');
    assert.deepEqual(ids('lote=0 limbo>0'), ['v2']);
    assert.deepEqual(ids('almacen>0'), ['v1', 'v3']);
  });

  it('LB4 validaciones: destino, cantidad, selección vacía; sin central no se puede', (t) => {
    const { admin } = mundo(t);
    assert.throws(() => admin.reubicarLimbo({ movimiento_id: 'x', destino: 'marte', items: [{ item_id: 'v1' }] }), { codigo: 'DESTINO_INVALIDO' });
    assert.throws(() => admin.reubicarLimbo({ movimiento_id: 'x', destino: 'almacen', cantidad: 0, items: [{ item_id: 'v1' }] }), { codigo: 'CANTIDAD_INVALIDA' });
    assert.throws(() => admin.reubicarLimbo({ movimiento_id: 'x', destino: 'almacen', cantidad: 1.5, items: [{ item_id: 'v1' }] }), { codigo: 'CANTIDAD_INVALIDA' });
    assert.throws(() => admin.reubicarLimbo({ movimiento_id: 'x', destino: 'almacen' }), { codigo: 'DATOS_REQUERIDOS' });
    assert.throws(() => admin.reubicarLimbo({ movimiento_id: 'x', destino: 'almacen', filtro: 'lote=99999' }), { codigo: 'DATOS_REQUERIDOS' });
    assert.throws(() => admin.reubicarLimbo({ movimiento_id: '', destino: 'almacen', items: [{ item_id: 'v1' }] }), { codigo: 'DATOS_REQUERIDOS' });
    const resultado = admin.reubicarLimbo({ movimiento_id: 'y', destino: 'almacen', items: [{ item_id: 'no-existe' }, { item_id: 'v1' }] });
    assert.deepEqual([resultado.articulos, resultado.omitidos.map((o) => o.item_id)], [1, ['no-existe']]);
  });

  it('LB5 por HTTP: el almacenista también puede ubicar piezas del Limbo', async (t) => {
    const { ctx } = mundo(t);
    const adm = await appAdmin(ctx); t.after(() => adm.cerrar());
    const r = await api(adm.url, '/api/admin/limbo/reubicar', { movimiento_id: 'h1', destino: 'almacen', filtro: 'lote=0 limbo>0', excluir: ['v3'] });
    assert.equal(r.status, 200);
    assert.deepEqual([r.json.articulos, r.json.piezas, r.json.destino], [2, 9, 'almacen']);
    assert.equal((await api(adm.url, '/api/admin/limbo/reubicar', { movimiento_id: 'h2', destino: 'marte', filtro: 'lote=0' })).status >= 400, true);
  });
});

porAlmacen('Existencias reales: el propietario deja las cantidades como las contó, sin escáner ni confirmación', (alm) => {
  const mundo = (t: { after(f: () => void): void }) => {
    const ctx = nuevoMundo(alm, politica());
    t.after(ctx.limpiar);
    ctx.m.sembrarOps([articulo('p1', '4001', '202610', 'CAMISA TM'), mov('p1', 71)]);
    const admin = new ServicioAdmin({ central: ctx.m.central, actor: { rol: 'admin', usuario: 'galo' }, fuente: () => ctx.m.central.repo.ops(), cajas: ctx.m.ctx.cajasCfg.map((c) => ({ tienda: c.tienda, caja: c.caja })), inventario: ctx.m.inventarioCentral() });
    return { ctx, admin };
  };
  const pump = (ctx: ReturnType<typeof mundo>['ctx']) => { ctx.m.pump(); ctx.m.pump(); ctx.m.pump(); };

  it('EX1 «de estas 71, 41 están en DÚO»: Limbo 30, DÚO 41; la tienda y sus cajas lo ven sin confirmar nada; London no cambia', (t) => {
    const { ctx, admin } = mundo(t);
    const r = admin.fijarExistencias({ ajuste_id: 'a1', item_id: 'p1', cantidades: { limbo: 30, DUO: 41, LON: 0 }, motivo: 'Conteo del propietario' });
    assert.deepEqual(r.cambios.map((c) => [c.lugar, c.antes, c.despues]), [['limbo', 71, 30], ['DUO', 0, 41], ['LON', 0, 0]]);
    assert.deepEqual([r.aplicado, r.con_cambio, r.repetido], [true, 2, false]);
    pump(ctx);
    assert.deepEqual([ctx.m.caja('DUO', 1).stockLocal('p1'), ctx.m.caja('DUO', 2).stockLocal('p1'), ctx.m.caja('LON', 1).stockLocal('p1')], [41, 41, 0]);
    for (const [tt, c] of [['DUO', 1], ['LON', 2]] as const) assert.equal(limbo(ctx, 'p1', tt, c), 30, `${tt}/${c} ve El Limbo en 30`);
    assert.deepEqual(r.existencias.ubicaciones.map((u) => [u.clave, u.cantidad]), [['limbo', 30], ['almacen', 0], ['DUO', 41], ['LON', 0]]);
    // el historial lo cuenta
    const h = admin.historialArticulo('p1').eventos.find((e) => e.evento === 'Existencias corregidas')!;
    assert.match(h.detalle, /El Limbo: 71 → 30[\s\S]*DÚO New York: 0 → 41[\s\S]*Conteo del propietario/);
  });

  it('EX2 contar London: «hay 35» sube o baja tal cual; el almacén también; agregar piezas que no existían; reintentar o repetir no cambia nada', (t) => {
    const { ctx, admin } = mundo(t);
    admin.fijarExistencias({ ajuste_id: 'a1', item_id: 'p1', cantidades: { LON: 35, almacen: 12 } });
    pump(ctx);
    assert.deepEqual([ctx.m.caja('LON', 1).stockLocal('p1'), almacen(ctx, 'p1'), limbo(ctx, 'p1')], [35, 12, 71], 'solo se tocó lo indicado');
    const n = ctx.m.central.repo.ops().length;
    assert.equal(admin.fijarExistencias({ ajuste_id: 'a1', item_id: 'p1', cantidades: { LON: 1 } }).repetido, true);
    assert.equal(ctx.m.central.repo.ops().length, n, 'el mismo ajuste no se repite');
    assert.equal(admin.fijarExistencias({ ajuste_id: 'a2', item_id: 'p1', cantidades: { LON: 35, almacen: 12 } }).aplicado, false, 'sin diferencia no se guarda nada');
    assert.equal(ctx.m.central.repo.ops().length, n);
    // bajar: hay 30 en London y 0 en el almacén
    admin.fijarExistencias({ ajuste_id: 'a3', item_id: 'p1', cantidades: { LON: 30, almacen: 0 } });
    pump(ctx);
    assert.deepEqual([ctx.m.caja('LON', 2).stockLocal('p1'), almacen(ctx, 'p1')], [30, 0]);
    // el almacén ajustado se puede seguir entregando con el flujo normal
    admin.fijarExistencias({ ajuste_id: 'a4', item_id: 'p1', cantidades: { almacen: 10 } });
    const e = ctx.m.central.entregar({ item_id: 'p1', destinos: { DUO: 4 }, etiqueta_precio: true, etiqueta_costura: true, por: 'galo' });
    assert.deepEqual([e.ok, e.ok && e.existencia_almacen], [true, 6]);
  });

  it('EX3 solo revisar no guarda; validaciones; limpia la marca «sin verificar» de la tienda', (t) => {
    const { ctx, admin } = mundo(t);
    const n = ctx.m.central.repo.ops().length;
    const rev = admin.fijarExistencias({ ajuste_id: 'x', item_id: 'p1', cantidades: { DUO: 5 }, solo_revisar: true });
    assert.deepEqual([rev.aplicado, rev.con_cambio], [false, 1]);
    assert.equal(ctx.m.central.repo.ops().length, n);
    assert.throws(() => admin.fijarExistencias({ ajuste_id: 'x', item_id: 'p1', cantidades: { DUO: -1 } }), { codigo: 'CANTIDAD_INVALIDA' });
    assert.throws(() => admin.fijarExistencias({ ajuste_id: 'x', item_id: 'p1', cantidades: { DUO: 1.5 } }), { codigo: 'CANTIDAD_INVALIDA' });
    assert.throws(() => admin.fijarExistencias({ ajuste_id: 'x', item_id: 'p1', cantidades: { marte: 1 } }), { codigo: 'UBICACION_INVALIDA' });
    assert.throws(() => admin.fijarExistencias({ ajuste_id: 'x', item_id: 'no-existe', cantidades: { DUO: 1 } }), { codigo: 'ARTICULO_INEXISTENTE' });
    assert.throws(() => admin.fijarExistencias({ ajuste_id: 'x', item_id: 'p1', cantidades: {} }), { codigo: 'DATOS_REQUERIDOS' });
    assert.throws(() => admin.fijarExistencias({ ajuste_id: '', item_id: 'p1', cantidades: { DUO: 1 } }), { codigo: 'DATOS_REQUERIDOS' });
  });

  it('EX4 por HTTP: el supervisor ve y corrige las existencias; el almacenista no', async (t) => {
    const { ctx } = mundo(t);
    const adm = await appAdmin(ctx); t.after(() => adm.cerrar());
    await api(adm.url, '/api/admin/administradores', { nombre: 'Edgardo', clave: 'clave-segura' });
    await api(adm.url, '/api/admin/administradores', { nombre: 'Gabo', clave: 'clave-gabo', rol: 'almacenista' });
    const g = await api(adm.url, '/api/admin/existencias?item_id=p1');
    assert.equal(g.status, 200);
    assert.deepEqual(g.json.ubicaciones.map((u: any) => [u.clave, u.cantidad]), [['limbo', 71], ['almacen', 0], ['DUO', 0], ['LON', 0]]);
    const r = await api(adm.url, '/api/admin/existencias', { ajuste_id: 'h1', item_id: 'p1', cantidades: { limbo: 30, DUO: 41 } });
    assert.equal(r.status, 200);
    assert.deepEqual(r.json.existencias.ubicaciones.map((u: any) => u.cantidad), [30, 0, 41, 0]);
    await api(adm.url, '/api/logout', {});
    await api(adm.url, '/api/login', { usuario: 'Gabo', clave: 'clave-gabo' });
    assert.equal((await api(adm.url, '/api/admin/existencias?item_id=p1')).status, 403);
    assert.equal((await api(adm.url, '/api/admin/existencias', { ajuste_id: 'h2', item_id: 'p1', cantidades: { DUO: 1 } })).status, 403);
  });
});
