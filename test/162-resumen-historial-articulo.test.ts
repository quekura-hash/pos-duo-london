import assert from 'node:assert/strict';
import { it } from 'node:test';
import { ServicioAdmin } from '../src/app/servicio.ts';
import { nuevoMundo, politica, porAlmacen, servicioDe } from './ayudas/comun.ts';

porAlmacen('Historial de un artículo: resumen arriba (alta, cambios de precio y vendidas por tienda)', (alm) => {
  const mundo = (t: { after(f: () => void): void }, conCajera = true) => {
    const ctx = nuevoMundo(alm, politica());
    t.after(ctx.limpiar);
    const admin = new ServicioAdmin({ central: ctx.m.central, actor: { rol: 'admin', usuario: 'galo' }, fuente: () => ctx.m.central.repo.ops(), cajas: ctx.m.ctx.cajasCfg.map((c) => ({ tienda: c.tienda, caja: c.caja })), inventario: ctx.m.inventarioCentral(), reloj: { now: () => ctx.m.reloj.now() } });
    if (conCajera) admin.guardarCajero({ nombre: 'Ana', clave: '1234' });
    ctx.m.pump(); ctx.m.pump();
    return { ctx, admin };
  };
  const ENC = ['CANTIDAD', 'DESCRIPCION', 'ESTILO', 'MARCA', 'CODIGO', 'PRECIO', 'LOTE', 'DEPARTAMENTO'];
  const datos = { codigo: '202610555', descripcion: 'TARJETA DE REGALO', marca: 'ROPA', estilo: 'X', lote: 'ROPA', departamento: 'Dama', precio: 40000 };

  it('RA1 alta en una caja: dice cuándo, dónde (tienda y caja) y quién (la cajera); sin cambios de precio y sin ventas', (t) => {
    const { ctx, admin } = mundo(t);
    const lon = servicioDe(ctx, 'LON', 1, 'Ana');
    const r = lon.svc.nuevoArticulo(lon.svc.nuevaVenta(), datos, '1234');
    ctx.m.pump(); ctx.m.pump(); ctx.m.pump();
    const h = admin.historialArticulo(r.articulo.item_id);
    assert.equal(h.resumen.alta!.por, 'Ana');
    assert.match(h.resumen.alta!.donde!, / · caja 1$/);
    assert.match(h.resumen.alta!.ocurrio_en, /^\d{4}-\d{2}-\d{2}T/);
    assert.deepEqual([h.resumen.precio.inicial, h.resumen.precio.actual, h.resumen.precio.cambios, h.resumen.precio.ultimo], [40000, 40000, 0, null]);
    assert.deepEqual(h.resumen.vendidas!.map((v) => [v.tienda, v.neto]), [['DUO', 0], ['LON', 0]]);
    // en el renglón del evento, «Quién» ya no es «LON/1» sino la cajera
    assert.equal(h.eventos.find((e) => e.tipo === 'alta')!.por, 'Ana');
  });

  it('RA2 alta en Administración (almacén), cambios de precio con quién y vendidas por tienda, netas de cancelaciones y devoluciones', async (t) => {
    const { ctx, admin } = mundo(t, false);
        admin.altaLote({ lote_id: 'L1', filas: [ENC, [10, 'CAMISA', 'C1', 'ACME', '777001', 200, '1', 'DAMA']] as never });
    const art = admin.buscarArticulos('777001').articulos[0]!;
    admin.editarArticulo(art.item_id, { precio: 25000 });
    admin.editarArticulo(art.item_id, { precio: 27000 });
    admin.entregarAlmacen({ item_id: art.item_id, destinos: { DUO: 4, LON: 4 }, etiqueta_precio: true, etiqueta_costura: true });
    ctx.m.pump();
    const venderEn = async (tienda: 'DUO' | 'LON', piezas: number) => {
      const s = servicioDe(ctx, tienda, 1);
      const cart = s.svc.nuevaVenta();
      const e = s.svc.escanear(cart, '777001') as any;
      s.svc.confirmarRecepcion(e.recepcion[0].entrega_id);
      for (let i = 1; i < piezas; i++) s.svc.escanear(cart, '777001');
      const v = await s.svc.cobrarEfectivo(cart, 100000, 0);
      ctx.m.pump(); ctx.m.pump();
      return { s, v };
    };
    const d1 = await venderEn('DUO', 1);
    await venderEn('LON', 2);
    ctx.m.pump(); ctx.m.pump(); ctx.m.pump();
    let r = admin.historialArticulo(art.item_id).resumen;
    assert.deepEqual([r.alta!.donde, r.alta!.por], ['Administración (almacén)', 'Administración']);
    assert.deepEqual([r.precio.inicial, r.precio.actual, r.precio.cambios, r.precio.ultimo!.antes, r.precio.ultimo!.despues, r.precio.ultimo!.por], [20000, 27000, 2, 25000, 27000, 'galo']);
    assert.deepEqual(r.vendidas!.map((v) => [v.tienda, v.vendidas, v.neto]), [['DUO', 1, 1], ['LON', 2, 2]]);
    // una cancelación en DÚO resta; no cuenta como vendida
    d1.s.svc.cancelarVenta(d1.v.venta.sale_id, 'error de captura');
    ctx.m.pump(); ctx.m.pump(); ctx.m.pump();
    r = admin.historialArticulo(art.item_id).resumen;
    assert.deepEqual(r.vendidas!.map((v) => [v.tienda, v.vendidas, v.canceladas, v.neto]), [['DUO', 1, 1, 0], ['LON', 2, 0, 2]]);
  });

  it('RA3 quien no ve las ventas (almacenista y asistente) no recibe las vendidas: no se muestra un cero que no es cierto', (t) => {
    const { ctx, admin } = mundo(t);
    admin.altaLote({ lote_id: 'L1', filas: [ENC, [10, 'CAMISA', 'C1', 'ACME', '777001', 200, '1', 'DAMA']] as never });
    const art = admin.buscarArticulos('777001').articulos[0]!;
    const comoAlmacen = new ServicioAdmin({ central: ctx.m.central, actor: { rol: 'admin', usuario: 'gabo' }, fuente: () => ctx.m.central.repo.ops(), cajas: ctx.m.ctx.cajasCfg.map((c) => ({ tienda: c.tienda, caja: c.caja })), inventario: ctx.m.inventarioCentral(), reloj: { now: () => ctx.m.reloj.now() } });
    comoAlmacen.abrirSesionNube('Gabo', 'almacenista', () => undefined);
    const h = comoAlmacen.historialArticulo(art.item_id);
    assert.equal(h.resumen.vendidas, null);
    assert.equal(h.resumen.alta!.por, 'Administración');
  });
});
