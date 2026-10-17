import assert from 'node:assert/strict';
import { it } from 'node:test';
import { nuevoMundo, politica, porAlmacen } from './ayudas/comun.ts';
import { api, appAdmin, appCajero } from './ayudas/app.ts';

porAlmacen('API HTTP local de la aplicación (cajero y Administración)', (alm) => {
  it('H1 flujo completo por HTTP: escanear, cobrar en efectivo, ticket, corte', async (t) => {
    const ctx = nuevoMundo(alm, politica());
    const app = await appCajero(ctx, 'DUO', 1, 'Ana');
    t.after(async () => { await app.cerrar(); ctx.limpiar(); });
    const s = await api(app.url, '/api/sesion');
    assert.deepEqual([s.json.rol, s.json.tienda, s.json.caja, s.json.nav], ['cajero', 'DUO', 1, ['venta', 'corte', 'ventas']]);
    const { cart } = (await api(app.url, '/api/venta/actual', {})).json;
    const e = (await api(app.url, '/api/venta/escanear', { cart, codigo: '0002026090782' })).json;
    assert.equal(e.resultado, 'agregado');
    assert.equal(e.carrito.total, 89900);
    const mal = await api(app.url, '/api/venta/cobrar-efectivo', { cart, recibido: 100 });
    assert.deepEqual([mal.status, mal.json.error.codigo], [409, 'EFECTIVO_INSUFICIENTE']);
    const r = (await api(app.url, '/api/venta/cobrar-efectivo', { cart, recibido: 90000 })).json;
    assert.equal(r.venta.folio, 1);
    assert.equal(r.cambio, 100);
    assert.equal(r.impresion.ok, true);
    assert.match(r.ticket_texto, /Folio: 000001/);
    assert.doesNotMatch(r.ticket_texto, /iva|tax|impuesto|%/i);
    const c = (await api(app.url, '/api/corte?fecha=2026-10-01')).json;
    assert.equal(c.vivo.tickets, 1);
    assert.equal(c.vivo.cobros_efectivo, 89900);
    const v = (await api(app.url, '/api/ventas?fecha=2026-10-01')).json.ventas;
    assert.deepEqual(v.map((x: any) => x.folio), [1]);
    const est = (await api(app.url, '/api/estado')).json.estado;
    assert.equal(est.ultimo_folio, 1);
  });

  it('H2 el cajero no puede pedir ventas ni cortes de otra caja, ni usar rutas de Administración', async (t) => {
    const ctx = nuevoMundo(alm, politica());
    const app = await appCajero(ctx, 'DUO', 1);
    t.after(async () => { await app.cerrar(); ctx.limpiar(); });
    for (const ruta of ['/api/ventas?cajas=DUO/2', '/api/ventas?cajas=LON/1', '/api/ventas?cajas=DUO/1,DUO/2', '/api/corte?cajas=LON/2']) {
      const r = await api(app.url, ruta);
      assert.deepEqual([ruta, r.status, r.json.error.codigo], [ruta, 403, 'PROHIBIDO']);
    }
    assert.equal((await api(app.url, '/api/ventas?cajas=DUO/1')).status, 200);
    for (const [ruta, cuerpo] of [['/api/admin/reporte', {}], ['/api/admin/cortes', {}]] as const) {
      assert.equal((await api(app.url, ruta, cuerpo)).status, 403);
    }
    assert.equal((await api(app.url, '/api/admin/cajas')).status, 403);
  });

  it('H3 Administración elige una, varias o todas las cajas; no puede operar ventas', async (t) => {
    const ctx = nuevoMundo(alm, politica());
    const a1 = await appCajero(ctx, 'DUO', 1);
    const a2 = await appCajero(ctx, 'LON', 2, 'Luis');
    const adm = await appAdmin(ctx);
    t.after(async () => { await a1.cerrar(); await a2.cerrar(); await adm.cerrar(); ctx.limpiar(); });
    for (const [app, n] of [[a1, 2], [a2, 1], [a1, 1]] as const) {
      for (let i = 0; i < n; i++) {
        const { cart } = (await api(app.url, '/api/venta/nueva', {})).json;
        await api(app.url, '/api/venta/escanear', { cart, codigo: '7501234567890' });
        await api(app.url, '/api/venta/cobrar-efectivo', { cart, recibido: 12000 });
      }
    }
    ctx.m.pump();
    const todas = (await api(adm.url, '/api/admin/reporte', {})).json.reporte;
    assert.equal(todas.filas.length, 4);
    assert.equal(todas.total, 4 * 12000);
    const una = (await api(adm.url, '/api/admin/reporte', { cajas: [{ tienda: 'DUO', caja: 1 }] })).json.reporte;
    assert.deepEqual(una.filas.map((f: any) => f.folio), [1, 2, 3]);
    const varias = (await api(adm.url, '/api/admin/reporte', { cajas: [{ tienda: 'DUO', caja: 1 }, { tienda: 'LON', caja: 2 }] })).json.reporte;
    assert.deepEqual(varias.porCaja.map((c: any) => [c.tienda, c.caja, c.tickets]).sort(), [['DUO', 1, 3], ['LON', 2, 1]]);
    assert.equal((await api(adm.url, '/api/venta/actual', {})).status, 403, 'Administración no opera la caja');
    assert.equal((await api(adm.url, '/api/estado')).status, 403);
    assert.deepEqual((await api(adm.url, '/api/sesion')).json.nav, ['reportes']);
  });

  it('H4 impresora que falla: HTTP 200, la venta existe, y /reimprimir la reenvía con el mismo folio', async (t) => {
    const ctx = nuevoMundo(alm, politica());
    const app = await appCajero(ctx, 'DUO', 2);
    t.after(async () => { await app.cerrar(); ctx.limpiar(); });
    app.s.impresora.falla = 'cubierta abierta';
    const { cart } = (await api(app.url, '/api/venta/actual', {})).json;
    await api(app.url, '/api/venta/escanear', { cart, codigo: '7501234567890' });
    const r = (await api(app.url, '/api/venta/cobrar-efectivo', { cart, recibido: 12000 })).json;
    assert.equal(r.impresion.ok, false);
    app.s.impresora.falla = null;
    const re = (await api(app.url, '/api/venta/reimprimir', { sale_id: r.venta.sale_id })).json;
    assert.equal(re.impresion.ok, true);
    assert.match(re.ticket_texto, /REIMPRESIÓN 1/);
    assert.equal((await api(app.url, '/api/ventas?fecha=2026-10-01')).json.ventas.length, 1);
  });

  it('H5 un código duplicado: el servidor devuelve candidatos y el alta desde búsqueda se rechaza', async (t) => {
    const ctx = nuevoMundo(alm, politica());
    const app = await appCajero(ctx, 'DUO', 1);
    t.after(async () => { await app.cerrar(); ctx.limpiar(); });
    ctx.m.cortarInternet('DUO');
    ctx.m.cortarInternet('LON');
    const dup = (marca: string) => ({ codigo: '7508888888888', marca, descripcion: 'FALDA', estilo: 'F-1', lote: '20261016', departamento: 'DAMA', precio: 30000, existencia_inicial: 2 });
    const a = ctx.m.caja('DUO', 2).altaArticulo(dup('A'));
    ctx.m.caja('LON', 1).altaArticulo(dup('B'));
    ctx.m.restablecerInternet('DUO'); ctx.m.restablecerInternet('LON');
    ctx.m.pump(); ctx.m.pump();
    const { cart } = (await api(app.url, '/api/venta/actual', {})).json;
    const e = (await api(app.url, '/api/venta/escanear', { cart, codigo: '7508888888888' })).json;
    assert.equal(e.resultado, 'ambiguo');
    assert.equal(e.candidatos.length, 2);
    assert.equal(e.carrito.lineas.length, 0);
    const b = (await api(app.url, '/api/buscar?q=falda')).json.resultados;
    assert.ok(b.every((x: any) => x.duplicado));
    const r = await api(app.url, '/api/venta/agregar', { cart, item_id: a.item_id });
    assert.deepEqual([r.status, r.json.error.codigo], [409, 'CODIGO_AMBIGUO']);
  });
});
