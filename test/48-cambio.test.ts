import assert from 'node:assert/strict';
import { it } from 'node:test';
import { appAdmin, appCajero, api } from './ayudas/app.ts';
import { nuevoMundo, politica, porAlmacen } from './ayudas/comun.ts';

porAlmacen('Cambio: las piezas que regresa la clienta son crédito en negativo dentro de una venta nueva', (alm) => {
  const preparar = async (t: { after(f: () => void): void }, conClaves = true) => {
    const ctx = nuevoMundo(alm, politica());
    t.after(ctx.limpiar);
    const adm = await appAdmin(ctx); t.after(() => adm.cerrar());
    const caja = await appCajero(ctx, 'DUO', 1, 'Ana'); t.after(() => caja.cerrar());
    if (conClaves) {
      await api(adm.url, '/api/admin/administradores', { nombre: 'Edgardo', clave: 'clave-segura', clave_caja: '2468' });
      await api(adm.url, '/api/admin/cajeros', { nombre: 'Lupe', clave: '4321' });
      await api(adm.url, '/api/admin/cajeros', { nombre: 'Rosa', clave: '8765' });
      ctx.m.pump(); ctx.m.pump(); ctx.m.pump();
      await api(caja.url, '/api/login', { usuario: 'Lupe', clave: '4321' });
    }
    return { ctx, adm, caja };
  };
  /** Vende `codigo` y devuelve la venta cobrada en efectivo. */
  const vender = async (caja: any, codigo = '0002026090782', qty = 1) => {
    const cart = (await api(caja.url, '/api/venta/nueva', {})).json.cart;
    const l = (await api(caja.url, '/api/venta/escanear', { cart, codigo })).json.linea;
    if (qty > 1) await api(caja.url, '/api/venta/cantidad', { cart, linea_id: l.linea_id, qty });
    return (await api(caja.url, '/api/venta/cobrar-efectivo', { cart, recibido: 5000000 })).json.venta;
  };
  const iniciar = async (caja: any, v: any, qty = 1) => {
    const cart = (await api(caja.url, '/api/venta/nueva', {})).json.cart;
    const r = await api(caja.url, '/api/venta/cambio/iniciar', { cart, sale_id: v.sale_id, renglones: [{ linea_id: v.lineas[0].linea_id, qty }], clienta: { nombre: 'Ana López', telefono: '6531234567' }, motivo: 'no le quedó' });
    return { cart, r };
  };
  const corte = async (caja: any) => { const j = (await api(caja.url, '/api/corte')).json; return { corte: j.vivo }; };

  it('CM1 aceptar el cambio deja la pieza en negativo y es crédito: sin clave, sin dinero ni inventario hasta cobrar', async (t) => {
    const { caja } = await preparar(t);
    const v = await vender(caja);
    const { r } = await iniciar(caja, v);
    assert.equal(r.status, 200);
    const c = r.json.carrito;
    assert.equal(c.cambio.credito, 89900);
    assert.equal(c.cambio.lineas[0].qty, 1);
    assert.equal(c.cambio.folio_origen, v.folio);
    assert.equal(c.total, 0);
    assert.equal(c.cambio.saldo_favor, 89900, 'sin artículos nuevos todo el crédito está a favor de la clienta');
  });

  it('CM2 cambio por un artículo más caro: el crédito se descuenta y la clienta paga la diferencia; el ticket muestra el crédito', async (t) => {
    const { caja } = await preparar(t);
    const v = await vender(caja, '7501234567890'); // mascada $120
    const { cart } = await iniciar(caja, v);
    const e = await api(caja.url, '/api/venta/escanear', { cart, codigo: '0000000000017' }); // bolsa $450
    assert.equal(e.json.carrito.total, 45000 - 12000, 'paga solo la diferencia');
    const antes = (await corte(caja)).corte;
    const p = await api(caja.url, '/api/venta/cobrar-efectivo', { cart, recibido: 40000 });
    assert.equal(p.status, 200);
    assert.equal(p.json.venta.total, 45000, 'la venta es de la bolsa completa');
    assert.deepEqual(p.json.venta.pagos.map((x: any) => [x.metodo, x.monto]), [['credito_cambio', 12000], ['efectivo', 33000]]);
    assert.match(p.json.ticket_texto, /Crédito por cambio \(folio 0000\d\d\)/);
    const c = (await corte(caja)).corte;
    assert.equal(c.devoluciones_en_efectivo, 0, 'no sale dinero');
    assert.equal(c.devoluciones, antes.devoluciones + 12000, 'el crédito cuenta como devolución de la mascada, sin salida de efectivo');
    assert.equal(c.ventas_netas, antes.ventas_netas + 33000, 'netas = lo realmente cobrado de más');
    // la pieza regresada ya no se puede devolver otra vez
    const otra = await iniciar(caja, v);
    assert.equal(otra.r.json.error.codigo, 'DEVOLUCION_EXCEDE');
  });

  it('CM3 cambio por uno más barato: queda saldo a favor, cobrar se bloquea y el dinero solo sale con la clave de quien autoriza (la misma cajera u otra)', async (t) => {
    const { caja } = await preparar(t);
    const v = await vender(caja); // jeans $899
    const { cart } = await iniciar(caja, v);
    const e = await api(caja.url, '/api/venta/escanear', { cart, codigo: '7501234567890' }); // mascada $120
    assert.equal(e.json.carrito.total, 0);
    assert.equal(e.json.carrito.cambio.saldo_favor, 89900 - 12000);
    const cobro = await api(caja.url, '/api/venta/cobrar-efectivo', { cart, recibido: 0 });
    assert.equal(cobro.json.error.codigo, 'SALDO_A_FAVOR');
    const a = (await api(caja.url, '/api/venta/autorizadores-efectivo')).json;
    assert.deepEqual([a.pide_clave, a.actual, a.autorizadores.map((x: any) => x.nombre).sort()], [true, 'Lupe', ['Edgardo', 'Lupe', 'Rosa']], 'incluye a la propia cajera');
    const sin = await api(caja.url, '/api/venta/cambio/devolver-dinero', { cart });
    assert.equal(sin.json.error.codigo, 'AUTORIZACION_REQUERIDA');
    const mala = await api(caja.url, '/api/venta/cambio/devolver-dinero', { cart, autoriza: { nombre: 'Lupe', clave: '0000' } });
    assert.equal(mala.json.error.codigo, 'CLAVE_INVALIDA');
    assert.equal((await corte(caja)).corte.devoluciones_en_efectivo, 0, 'con clave mala no sale nada');
    const ok = await api(caja.url, '/api/venta/cambio/devolver-dinero', { cart, autoriza: { nombre: 'Lupe', clave: '4321' } }); // la misma cajera
    assert.equal(ok.status, 200);
    assert.equal(ok.json.devolucion.reembolsos[0].monto, 77900);
    assert.equal(ok.json.devolucion.autorizado_por, 'Lupe');
    assert.match(ok.json.ticket_texto, /Devolución de efectivo autorizada por Lupe/);
    assert.deepEqual(ok.json.venta.pagos.map((x: any) => [x.metodo, x.monto]), [['credito_cambio', 12000]]);
    const c = (await corte(caja)).corte;
    assert.equal(c.devoluciones_en_efectivo, 77900);
    // reintento: mismo resultado, sin duplicar
    const re = await api(caja.url, '/api/venta/cambio/devolver-dinero', { cart, autoriza: { nombre: 'Lupe', clave: '4321' } });
    assert.equal(re.json.devolucion.folio, ok.json.devolucion.folio);
    assert.equal((await corte(caja)).corte.devoluciones_en_efectivo, 77900);
  });

  it('CM4 la clienta no se lleva nada: se devuelve todo el dinero (otra cajera o supervisor autoriza) y la pieza vuelve al inventario', async (t) => {
    const { caja } = await preparar(t);
    const v = await vender(caja);
    const ex0 = (await api(caja.url, '/api/venta/escanear', { cart: (await api(caja.url, '/api/venta/nueva', {})).json.cart, codigo: '0002026090782' })).json.carrito.existencias;
    const { cart } = await iniciar(caja, v);
    const ok = await api(caja.url, '/api/venta/cambio/devolver-dinero', { cart, autoriza: { nombre: 'Edgardo', clave: '2468' } });
    assert.equal(ok.status, 200);
    assert.equal(ok.json.venta, null, 'sin artículos nuevos no hay venta');
    assert.equal(ok.json.devolucion.reembolsos[0].monto, 89900);
    assert.equal(ok.json.devolucion.autorizado_por, 'Edgardo');
    const ex1 = (await api(caja.url, '/api/venta/escanear', { cart: (await api(caja.url, '/api/venta/nueva', {})).json.cart, codigo: '0002026090782' })).json.carrito.existencias;
    const id = Object.keys(ex1)[0];
    assert.equal(ex1[id].saldo, ex0[id].saldo + 1 - 0, 'la pieza regresó al inventario');
  });

  it('CM5 cambio exacto (mismo precio): se cobra $0 y quedan la venta nueva y el crédito; quitar el cambio descarta el crédito', async (t) => {
    const { caja } = await preparar(t);
    const v = await vender(caja);
    const { cart } = await iniciar(caja, v);
    const e = await api(caja.url, '/api/venta/escanear', { cart, codigo: '0002026090799' }); // mismo precio, otro lote
    assert.equal(e.json.carrito.total, 0);
    assert.equal(e.json.carrito.cambio.saldo_favor, 0);
    const p = await api(caja.url, '/api/venta/cobrar-efectivo', { cart, recibido: 0 });
    assert.equal(p.status, 200);
    assert.deepEqual(p.json.venta.pagos.map((x: any) => x.metodo), ['credito_cambio']);
    // quitar el cambio antes de cobrar
    const n = await iniciar(caja, await vender(caja));
    const q = await api(caja.url, '/api/venta/cambio/quitar', { cart: n.cart });
    assert.equal(q.json.carrito.cambio, null);
  });

  it('CM6 sin Vendedoras-Cajeras registradas el cambio y la devolución de efectivo no piden clave; un segundo cambio en la misma venta se rechaza', async (t) => {
    const { caja } = await preparar(t, false);
    const v = await vender(caja);
    const { cart } = await iniciar(caja, v);
    assert.equal((await api(caja.url, '/api/venta/cambio/iniciar', { cart, sale_id: v.sale_id, renglones: [{ linea_id: v.lineas[0].linea_id, qty: 1 }], clienta: { nombre: 'Ana López', telefono: '6531234567' }, motivo: 'no le quedó' })).json.error.codigo, 'CAMBIO_YA_INICIADO');
    const ok = await api(caja.url, '/api/venta/cambio/devolver-dinero', { cart });
    assert.equal(ok.status, 200);
    assert.equal(ok.json.devolucion.reembolsos[0].monto, 89900);
  });
});
