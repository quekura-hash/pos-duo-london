import assert from 'node:assert/strict';
import { it } from 'node:test';
import { appAdmin, appCajero, api } from './ayudas/app.ts';
import { nuevoMundo, politica, porAlmacen } from './ayudas/comun.ts';

porAlmacen('Editar un renglón solo en esta venta y cancelar la venta en curso', (alm) => {
  const preparar = async (t: { after(f: () => void): void }) => {
    const ctx = nuevoMundo(alm, politica());
    t.after(ctx.limpiar);
    const adm = await appAdmin(ctx); t.after(() => adm.cerrar());
    const caja = await appCajero(ctx, 'DUO', 1, 'Ana'); t.after(() => caja.cerrar());
    await api(adm.url, '/api/admin/administradores', { nombre: 'Edgardo', clave: 'clave-segura', clave_caja: '2468' });
    await api(adm.url, '/api/admin/cajeros', { nombre: 'Lupe', clave: '4321' });
    ctx.m.pump(); ctx.m.pump(); ctx.m.pump();
    await api(caja.url, '/api/login', { usuario: 'Lupe', clave: '4321' });
    return { ctx, adm, caja };
  };
  const agregar = async (caja: any) => {
    const cart = (await api(caja.url, '/api/venta/nueva', {})).json.cart;
    const l = (await api(caja.url, '/api/venta/escanear', { cart, codigo: '0002026090782' })).json.linea;
    return { cart, l };
  };

  it('ED1 la descripción se edita sin clave; el precio exige la clave de un supervisor y queda anotado quién lo autorizó', async (t) => {
    const { caja } = await preparar(t);
    const { cart, l } = await agregar(caja);
    const d = await api(caja.url, '/api/venta/editar-linea', { cart, linea_id: l.linea_id, descripcion: 'CAMISA CON DEFECTO' });
    assert.equal(d.status, 200);
    assert.equal(d.json.carrito.lineas[0].descripcion, 'CAMISA CON DEFECTO');
    assert.equal(d.json.carrito.total, l.precio_unit, 'el precio no cambió');
    const sin = (await api(caja.url, '/api/venta/editar-linea', { cart, linea_id: l.linea_id, precio_unit: 5000 })).json.error.codigo;
    assert.equal(sin, 'CLAVE_INVALIDA');
    const mala = (await api(caja.url, '/api/venta/editar-linea', { cart, linea_id: l.linea_id, precio_unit: 5000, clave: '4321' })).json.error.codigo;
    assert.equal(mala, 'CLAVE_INVALIDA', 'la clave de una Vendedora-Cajera no autoriza precios');
    const ok = await api(caja.url, '/api/venta/editar-linea', { cart, linea_id: l.linea_id, precio_unit: 5000, clave: '2468' });
    assert.equal(ok.status, 200);
    assert.equal(ok.json.carrito.total, 5000);
    assert.equal(ok.json.carrito.lineas[0].editado.autorizo, 'Edgardo');
    assert.equal(ok.json.carrito.lineas[0].editado.precio_lista, l.precio_unit);
    assert.equal((await api(caja.url, '/api/venta/editar-linea', { cart, linea_id: l.linea_id, precio_unit: 0, clave: '2468' })).json.error.codigo, 'PRECIO_INVALIDO');
    // volver al original quita la marca de editado
    const vuelta = await api(caja.url, '/api/venta/editar-linea', { cart, linea_id: l.linea_id, descripcion: l.descripcion, precio_unit: l.precio_unit, clave: '2468' });
    assert.equal(vuelta.json.carrito.lineas[0].editado, undefined);
    assert.equal(vuelta.json.carrito.total, l.precio_unit);
  });

  it('ED2 el precio editado es el que se cobra y el catálogo no cambia', async (t) => {
    const { caja } = await preparar(t);
    const { cart, l } = await agregar(caja);
    await api(caja.url, '/api/venta/editar-linea', { cart, linea_id: l.linea_id, precio_unit: 5000, clave: '2468' });
    const v = (await api(caja.url, '/api/venta/cobrar-efectivo', { cart, recibido: 500000 })).json.venta;
    assert.equal(v.total, 5000);
    const otra = await agregar(caja);
    assert.equal(otra.l.precio_unit, l.precio_unit, 'el catálogo conserva su precio');
  });

  it('CV1 cancelar la venta en curso no pide clave, deja una venta nueva vacía y una venta ya cobrada no se puede anular así', async (t) => {
    const { caja } = await preparar(t);
    const { cart } = await agregar(caja);
    const r = await api(caja.url, '/api/venta/anular', { cart, motivo: 'cancelada antes de cobrar' });
    assert.equal(r.status, 200);
    assert.equal(r.json.carrito.lineas.length, 0);
    assert.notEqual(r.json.cart, cart);
    const c2 = await agregar(caja);
    await api(caja.url, '/api/venta/cobrar-efectivo', { cart: c2.cart, recibido: 2000000 });
    assert.notEqual((await api(caja.url, '/api/venta/anular', { cart: c2.cart, motivo: 'x' })).status, 200);
  });
});
