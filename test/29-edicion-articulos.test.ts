import assert from 'node:assert/strict';
import { it } from 'node:test';
import { ServicioAdmin } from '../src/app/servicio.ts';
import { nuevoMundo, politica, porAlmacen, servicioDe } from './ayudas/comun.ts';

const ENC = ['CANTIDAD', 'DESCRIPCION', 'ESTILO', 'MARCA', 'CODIGO', 'PRECIO', 'LOTE', 'DEPARTAMENTO'];

porAlmacen('Inventario: lista completa por páginas, edición de artículos e historial', (alm) => {
  const admin = (ctx: ReturnType<typeof nuevoMundo>) => new ServicioAdmin({ central: ctx.m.central, actor: { rol: 'admin', usuario: 'galo' }, fuente: () => ctx.m.central.repo.ops(), cajas: [{ tienda: 'DUO', caja: 1 }, { tienda: 'LON', caja: 1 }], inventario: ctx.m.inventarioCentral() });

  it('IN1 lista todo el catálogo de 50 en 50 (o el tamaño pedido), ordenado por Item #, con existencias; el texto filtra', (t) => {
    const ctx = nuevoMundo(alm, politica());
    t.after(ctx.limpiar);
    const a = admin(ctx);
    const filas = [ENC, ...Array.from({ length: 120 }, (_, i) => [1, `PRENDA ${i + 1}`, `E${i}`, 'MARCA', `9000${String(i).padStart(3, '0')}`, 100 + i, '1', 'DAMA'])];
    a.altaLote({ lote_id: 'L1', filas: filas as never });
    ctx.m.pump();
    const p1 = a.buscarArticulos('', 50, 0, true);
    assert.deepEqual([p1.total, p1.articulos.length], [124, 50]);
    const p3 = a.buscarArticulos('', 50, 100, true);
    assert.equal(p3.articulos.length, 24);
    assert.deepEqual(p1.articulos.slice(0, 4).map((x) => x.item_no), ['1001', '1002', '1003', '1004'], 'por Item #');
    const todos = [...p1.articulos, ...a.buscarArticulos('', 50, 50, true).articulos, ...p3.articulos];
    assert.equal(new Set(todos.map((x) => x.item_id)).size, 124, 'ninguno se repite ni falta entre páginas');
    assert.deepEqual(p1.articulos[0]!.existencias, { DUO: 5, LON: 3 });
    assert.equal(p1.articulos[0]!.almacen, 0);
    assert.equal(a.buscarArticulos('e55', 50, 0, true).total, 1, 'el texto filtra por estilo');
    assert.equal(a.buscarArticulos('', 50, 0, false).total, 0, 'sin texto y sin «todos» no se lista nada (selector de promociones)');
    assert.equal(a.buscarArticulos('mascada').articulos[0]!.almacen, 0);
  });

  it('IN2 editar un artículo: valida, registra antes y después, llega a las cajas y cambia el precio de las ventas siguientes', async (t) => {
    const ctx = nuevoMundo(alm, politica());
    t.after(ctx.limpiar);
    const a = admin(ctx);
    const art = a.buscarArticulos('mascada').articulos[0]!;
    assert.throws(() => a.editarArticulo(art.item_id, { precio: -1 }), { codigo: 'PRECIO_INVALIDO' });
    assert.throws(() => a.editarArticulo(art.item_id, { precio: 12.5 }), { codigo: 'PRECIO_INVALIDO' });
    assert.throws(() => a.editarArticulo(art.item_id, { departamento: 'Marte' }), { codigo: 'DEPARTAMENTO_INVALIDO' });
    assert.throws(() => a.editarArticulo('nada', { precio: 100 }), { codigo: 'ARTICULO_INEXISTENTE' });
    const antes = ctx.m.central.repo.ops().length;
    a.editarArticulo(art.item_id, { precio: art.precio, descripcion: art.descripcion }); // sin cambios: no escribe nada
    assert.equal(ctx.m.central.repo.ops().length, antes);
    const r = a.editarArticulo(art.item_id, { descripcion: '  MASCADA   POPULAR ', precio: 5500, departamento: 'Accesorios', marca: 'EFENTUS' });
    assert.deepEqual([r.articulo.descripcion, r.articulo.precio, r.articulo.departamento], ['MASCADA POPULAR', 5500, 'Accesorios']);
    ctx.m.pump();
    // el cambio llega a las cajas: la siguiente venta usa el precio nuevo y la búsqueda por texto lo encuentra
    const s = servicioDe(ctx, 'DUO', 1);
    assert.equal(s.svc.buscar('popular').length, 1);
    const c = s.svc.nuevaVenta();
    assert.equal((s.svc.escanear(c, '7501234567890') as any).carrito.total, 5500);
    const venta = await s.svc.cobrarEfectivo(c, 10000, 0);
    // el cambio posterior no altera la venta ya hecha
    a.editarArticulo(art.item_id, { precio: 6000 });
    ctx.m.pump(); ctx.m.pump();
    assert.equal(venta.venta.total, 5500);
    assert.equal(a.buscarArticulos('popular').articulos[0]!.precio, 6000);
    assert.equal(ctx.m.caja('LON', 1).idx.articulo(art.item_id)!.precio, 6000, 'también en la otra tienda');
  });

  it('IN3 historial: alta, cambios con valores anteriores, almacén, ventas, cancelación y devolución, del más reciente al más antiguo', async (t) => {
    const ctx = nuevoMundo(alm, politica());
    t.after(ctx.limpiar);
    const a = admin(ctx);
    a.altaLote({ lote_id: 'L1', filas: [ENC, [10, 'CAMISA', 'C1', 'ACME', '777001', 200, '1', 'DAMA']] as never });
    const art = a.buscarArticulos('777001').articulos[0]!;
    a.editarArticulo(art.item_id, { precio: 25000, estilo: 'C2' });
    a.entregarAlmacen({ item_id: art.item_id, destinos: { DUO: 4 }, etiqueta_precio: true, etiqueta_costura: true });
    ctx.m.pump();
    const s = servicioDe(ctx, 'DUO', 1);
    const cart = s.svc.nuevaVenta();
    const esc = s.svc.escanear(cart, '777001') as any;
    s.svc.confirmarRecepcion(esc.recepcion[0].entrega_id);
    const v = await s.svc.cobrarEfectivo(cart, 30000, 0);
    ctx.m.pump(); ctx.m.pump();
    const h = a.historialArticulo(art.item_id).eventos;
    const tipos = h.map((e) => e.tipo);
    for (const t2 of ['alta', 'cambio', 'almacen_entrada', 'almacen_entrega', 'recepcion', 'venta']) assert.ok(tipos.includes(t2 as never), t2);
    assert.equal(tipos[0], 'venta', 'lo más reciente primero');
    assert.equal(tipos.at(-1), 'alta');
    const cambio = h.find((e) => e.tipo === 'cambio')!;
    assert.equal(cambio.detalle, 'Estilo: «C1» → «C2» · Precio: $200.00 → $250.00');
    assert.equal(cambio.por, 'galo');
    assert.match(h.find((e) => e.tipo === 'venta')!.detalle, /1 pieza por \$250\.00 · DÚO New York caja 1, folio 000001/);
    assert.match(h.find((e) => e.tipo === 'almacen_entrega')!.detalle, /4 piezas para DÚO New York/);
    assert.match(h.find((e) => e.tipo === 'almacen_entrada')!.detalle, /10 piezas/);
    // cancelación
    s.svc.cancelarVenta(v.venta.sale_id, 'error de captura');
    ctx.m.pump(); ctx.m.pump();
    assert.match(a.historialArticulo(art.item_id).eventos[0]!.detalle, /Venta cancelada|1 pieza · DÚO New York caja 1, folio 000001 · error de captura/);
    assert.equal(a.historialArticulo(art.item_id).eventos[0]!.evento, 'Venta cancelada');
    assert.throws(() => a.historialArticulo('nada'), { codigo: 'ARTICULO_INEXISTENTE' });
  });
});
