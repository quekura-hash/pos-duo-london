import assert from 'node:assert/strict';
import { it } from 'node:test';
import * as administracion from '../src/administracion.ts';
import { codigosDuplicados, historialResoluciones, reasignarCodigo } from '../src/administracion.ts';
import { detectar } from '../src/incidencias.ts';
import { catalogo, ventas } from '../src/proyecciones.ts';
import type { Actor } from '../src/tipos.ts';
import { nuevoMundo, politica, porAlmacen, type Ctx } from './ayudas/comun.ts';

const admin: Actor = { rol: 'admin', usuario: 'galo' };
const cajero: Actor = { rol: 'cajero', usuario: 'c1', tienda: 'DUO', caja: 1 };
const CODIGO = '0007509999999999';
const nuevo = (marca: string, existencia: number) => ({ codigo: CODIGO, marca, descripcion: 'BLUSA', estilo: 'B-1', lote: '20261016', departamento: 'DAMA', precio: 25000, existencia_inicial: existencia });

/** Crea el conflicto real: el mismo código dado de alta sin conexión en dos tiendas. */
function crearDuplicado(ctx: Ctx) {
  const { m } = ctx;
  m.cortarInternet('DUO');
  m.cortarInternet('LON');
  const duo = m.caja('DUO', 2).altaArticulo(nuevo('DUOMARCA', 10));
  const lon = m.caja('LON', 1).altaArticulo(nuevo('LONMARCA', 4));
  m.restablecerInternet('DUO');
  m.restablecerInternet('LON');
  m.pump();
  m.pump();
  return { duo, lon };
}

porAlmacen('Resolución administrativa de códigos duplicados', (alm) => {
  it('CD1 Administración ve el conflicto completo: artículos, existencias por tienda y ventas con elección provisional', (t) => {
    const ctx = nuevoMundo(alm, politica());
    t.after(ctx.limpiar);
    const { duo, lon } = crearDuplicado(ctx);
    // el cajero escanea, el sistema NO adivina; elige provisionalmente por item_id y la línea queda marcada
    const c = ctx.m.caja('DUO', 1);
    const cart = c.abrirCarrito();
    assert.throws(() => c.agregarLinea(cart, { codigo: CODIGO, qty: 1 }), { codigo: 'CODIGO_AMBIGUO' });
    const l = c.agregarLinea(cart, { item_id: duo.item_id, qty: 1 });
    assert.equal(l.ambiguo?.codigo, CODIGO);
    assert.deepEqual([...l.ambiguo!.candidatos].sort(), [duo.item_id, lon.item_id].sort());
    const v = c.cobrar(cart, [{ metodo: 'efectivo', monto: l.importe }]);
    ctx.m.pump();
    const lista = codigosDuplicados(admin, ctx.m.central.repo.ops());
    assert.equal(lista.length, 1);
    const g = lista[0]!;
    assert.equal(g.codigo, CODIGO);
    assert.deepEqual(g.articulos.map((a) => a.item_id).sort(), [duo.item_id, lon.item_id].sort());
    const aduo = g.articulos.find((a) => a.item_id === duo.item_id)!;
    const alon = g.articulos.find((a) => a.item_id === lon.item_id)!;
    assert.deepEqual(aduo.existencias, { DUO: 9 });
    assert.deepEqual(alon.existencias, { LON: 4 });
    assert.deepEqual(g.ventas_con_eleccion_provisional.map((x) => [x.sale_id, x.folio, x.item_id]), [[v.sale_id, v.folio, duo.item_id]]);
    assert.ok(g.articulos.every((a) => a.item_no !== null), 'ya recibieron Item # del central');
  });

  it('CD2 el cajero no puede listar ni resolver: es una función solo de Administración', (t) => {
    const ctx = nuevoMundo(alm, politica());
    t.after(ctx.limpiar);
    const { lon } = crearDuplicado(ctx);
    assert.throws(() => codigosDuplicados(cajero, ctx.m.central.repo.ops()), { codigo: 'PROHIBIDO' });
    assert.throws(() => reasignarCodigo(cajero, ctx.m.central, { item_id: lon.item_id, codigo_nuevo: 'X', motivo: 'm' }), { codigo: 'PROHIBIDO' });
    assert.throws(() => historialResoluciones(cajero, ctx.m.central.repo.ops()), { codigo: 'PROHIBIDO' });
  });

  it('CD3 reasignar código: se propaga a todas las cajas, conserva ceros y no toca tickets históricos', (t) => {
    const ctx = nuevoMundo(alm, politica());
    t.after(ctx.limpiar);
    const { duo, lon } = crearDuplicado(ctx);
    const c = ctx.m.caja('LON', 2);
    const cart = c.abrirCarrito();
    const l = c.agregarLinea(cart, { item_id: lon.item_id, qty: 1 }); // venta histórica con elección provisional
    const v = c.cobrar(cart, [{ metodo: 'efectivo', monto: l.importe }]);
    ctx.m.pump();

    const op = reasignarCodigo(admin, ctx.m.central, { item_id: lon.item_id, codigo_nuevo: '0007509999999001', motivo: 'se re-etiquetó la mercancía de London' });
    assert.deepEqual([op.payload.codigo_anterior, op.payload.codigo_nuevo, op.payload.usuario], [CODIGO, '0007509999999001', 'galo']);
    ctx.m.pump();
    ctx.m.pump();
    for (const caja of [ctx.m.caja('DUO', 1), ctx.m.caja('DUO', 2), ctx.m.caja('LON', 1), ctx.m.caja('LON', 2)]) {
      assert.deepEqual(caja.buscarPorCodigo(CODIGO).map((a) => a.item_id), [duo.item_id], `${caja.id}: el código original ya no es ambiguo`);
      assert.deepEqual(caja.buscarPorCodigo('0007509999999001').map((a) => a.item_id), [lon.item_id]);
    }
    assert.deepEqual(detectar(ctx.m.central.repo.ops()).filter((i) => i.tipo === 'codigo_duplicado'), []);
    assert.deepEqual(codigosDuplicados(admin, ctx.m.central.repo.ops()), []);
    const hist = ventas(ctx.m.central.repo.ops()).get(v.sale_id)!;
    assert.equal(hist.lineas[0]!.item_id, lon.item_id, 'el ticket histórico conserva su artículo');
    assert.equal(hist.lineas[0]!.codigo, CODIGO, 'y el código con el que se vendió');
    assert.equal(historialResoluciones(admin, ctx.m.central.repo.ops()).length, 1);
  });

  it('CD4 reasignar valida: código ya existente, artículo que no está duplicado y motivo obligatorio', (t) => {
    const ctx = nuevoMundo(alm, politica());
    t.after(ctx.limpiar);
    const { lon } = crearDuplicado(ctx);
    assert.throws(() => reasignarCodigo(admin, ctx.m.central, { item_id: lon.item_id, codigo_nuevo: '7501234567890', motivo: 'm' }), { codigo: 'CODIGO_EXISTE' });
    assert.throws(() => reasignarCodigo(admin, ctx.m.central, { item_id: lon.item_id, codigo_nuevo: 'N1', motivo: '  ' }), { codigo: 'MOTIVO_REQUERIDO' });
    assert.throws(() => reasignarCodigo(admin, ctx.m.central, { item_id: ctx.items[2]!.item_id, codigo_nuevo: 'N2', motivo: 'm' }), { codigo: 'NO_ES_DUPLICADO' });
    assert.equal(historialResoluciones(admin, ctx.m.central.repo.ops()).length, 0, 'los intentos inválidos no dejan resolución');
  });

  it('CD5 la fusión de artículos NO está implementada: no existe la función ni una operación de fusión surte efecto', (t) => {
    const ctx = nuevoMundo(alm, politica());
    t.after(ctx.limpiar);
    const { duo, lon } = crearDuplicado(ctx);
    assert.equal('fusionarArticulos' in administracion, false);
    // aunque alguien inyectara una operación `item.fusion`, el catálogo la ignora: los dos artículos siguen distintos
    ctx.m.central.emitirAdmin('item.fusion', { conservado_id: duo.item_id, absorbido_id: lon.item_id });
    ctx.m.pump();
    ctx.m.pump();
    const cat = catalogo(ctx.m.central.repo.ops());
    assert.ok(cat.has(duo.item_id) && cat.has(lon.item_id));
    assert.equal(codigosDuplicados(admin, ctx.m.central.repo.ops()).length, 1, 'el conflicto sigue abierto');
    for (const caja of ctx.m.cajas.values()) assert.equal(caja.buscarPorCodigo(CODIGO).length, 2);
  });

  it('CD7 una caja aislada sigue viendo el conflicto hasta recibir la resolución; sus ventas quedan marcadas', (t) => {
    const ctx = nuevoMundo(alm, politica());
    t.after(ctx.limpiar);
    const { duo, lon } = crearDuplicado(ctx);
    ctx.m.cortarLan('DUO', 1);
    reasignarCodigo(admin, ctx.m.central, { item_id: lon.item_id, codigo_nuevo: '0007509999999002', motivo: 'm' });
    ctx.m.pump();
    const c = ctx.m.caja('DUO', 1);
    assert.equal(c.buscarPorCodigo(CODIGO).length, 2, 'aún sin la resolución');
    const cart = c.abrirCarrito();
    assert.equal(c.agregarLinea(cart, { item_id: duo.item_id, qty: 1 }).ambiguo?.codigo, CODIGO);
    ctx.m.restablecerLan('DUO', 1);
    ctx.m.pump();
    assert.equal(c.buscarPorCodigo(CODIGO).length, 1);
    void lon;
  });
});
