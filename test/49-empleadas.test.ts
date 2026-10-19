import assert from 'node:assert/strict';
import { it } from 'node:test';
import { appAdmin, appCajero, api } from './ayudas/app.ts';
import { nuevoMundo, politica, porAlmacen } from './ayudas/comun.ts';

const FOTO = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAAAP/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==';

porAlmacen('Registro de empleadas con alias y ventas por vendedora', (alm) => {
  const preparar = async (t: { after(f: () => void): void }) => {
    const ctx = nuevoMundo(alm, politica());
    t.after(ctx.limpiar);
    const adm = await appAdmin(ctx); t.after(() => adm.cerrar());
    const caja = await appCajero(ctx, 'DUO', 1, 'Ana'); t.after(() => caja.cerrar());
    await api(adm.url, '/api/admin/administradores', { nombre: 'Edgardo', clave: 'clave-segura', clave_caja: '2468', perfil: { nombres: 'Edgardo', apellidos: 'Morales Ruiz', telefono: '662 123 4567' } });
    await api(adm.url, '/api/admin/cajeros', { nombre: 'Lupe', clave: '4321', perfil: { nombres: 'Guadalupe', apellidos: 'Pérez López', telefono: '6621234567', direccion: 'Calle 5 #123, Col. Centro', foto: FOTO } });
    await api(adm.url, '/api/admin/cajeros', { nombre: 'Rosa', clave: '8765', perfil: { nombres: 'Rosa María', apellidos: 'Díaz' } });
    ctx.m.pump(); ctx.m.pump(); ctx.m.pump();
    await api(caja.url, '/api/login', { usuario: 'Lupe', clave: '4321' });
    return { ctx, adm, caja };
  };
  const vender = async (caja: any, vendedora?: string | null, codigo = '0002026090782') => {
    const cart = (await api(caja.url, '/api/venta/nueva', {})).json.cart;
    if (vendedora !== undefined) await api(caja.url, '/api/venta/vendedora', { cart, vendedora_id: vendedora });
    await api(caja.url, '/api/venta/escanear', { cart, codigo });
    return (await api(caja.url, '/api/venta/cobrar-efectivo', { cart, recibido: 5000000 })).json;
  };

  it('EM1 el perfil se guarda completo (nombres, apellidos, teléfono, dirección y foto), se edita sin perder lo demás y se valida', async (t) => {
    const { adm } = await preparar(t);
    const l = (await api(adm.url, '/api/admin/cajeros')).json.cajeros;
    const lupe = l.find((x: any) => x.nombre === 'Lupe');
    assert.deepEqual(lupe.perfil, { nombres: 'Guadalupe', apellidos: 'Pérez López', telefono: '6621234567', direccion: 'Calle 5 #123, Col. Centro', foto: FOTO });
    assert.equal(l.find((x: any) => x.nombre === 'Rosa').perfil.telefono, '');
    // editar solo el teléfono conserva el resto; '' en la foto la quita
    const e = await api(adm.url, '/api/admin/cajeros', { id: lupe.id, perfil: { telefono: '6629999999' } });
    assert.deepEqual([e.json.cajeros.find((x: any) => x.id === lupe.id).perfil.telefono, e.json.cajeros.find((x: any) => x.id === lupe.id).perfil.apellidos], ['6629999999', 'Pérez López']);
    const sf = await api(adm.url, '/api/admin/cajeros', { id: lupe.id, perfil: { foto: '' } });
    assert.equal(sf.json.cajeros.find((x: any) => x.id === lupe.id).perfil.foto, undefined);
    // validaciones
    assert.equal((await api(adm.url, '/api/admin/cajeros', { id: lupe.id, perfil: { telefono: 'abc' } })).json.error.codigo, 'CAJERO_INVALIDO');
    assert.equal((await api(adm.url, '/api/admin/cajeros', { id: lupe.id, perfil: { foto: 'http://x/y.jpg' } })).json.error.codigo, 'CAJERO_INVALIDO');
    assert.equal((await api(adm.url, '/api/admin/cajeros', { id: lupe.id, perfil: { nombres: 'x'.repeat(61) } })).json.error.codigo, 'CAJERO_INVALIDO');
    // el alias (nombre) no se repite, ni con un administrador
    assert.equal((await api(adm.url, '/api/admin/cajeros', { nombre: 'lupe', clave: '1111' })).json.error.codigo, 'CAJERO_INVALIDO');
    assert.equal((await api(adm.url, '/api/admin/cajeros', { nombre: 'Edgardo', clave: '1111' })).json.error.codigo, 'CAJERO_INVALIDO');
    // administradores también llevan perfil
    const a = (await api(adm.url, '/api/admin/administradores')).json.administradores[0];
    assert.equal(a.perfil.apellidos, 'Morales Ruiz');
  });

  it('EM2 «Vendió por»: la vendedora se elige sin clave, «Autocompra» es nadie, queda en la venta, el ticket y el historial', async (t) => {
    const { caja } = await preparar(t);
    const v = (await api(caja.url, '/api/venta/vendedoras')).json;
    assert.deepEqual(v.vendedoras.map((x: any) => [x.alias, x.tipo]), [['Edgardo', 'supervisor'], ['Lupe', 'cajero'], ['Rosa', 'cajero']]);
    const cart = (await api(caja.url, '/api/venta/nueva', {})).json;
    assert.equal(cart.carrito.vendedora, null, 'todavía no se elige');
    const rosa = v.vendedoras.find((x: any) => x.alias === 'Rosa');
    assert.equal((await api(caja.url, '/api/venta/vendedora', { cart: cart.cart, vendedora_id: 'caj-noexiste' })).json.error.codigo, 'VENDEDORA_INEXISTENTE');
    const r = await api(caja.url, '/api/venta/vendedora', { cart: cart.cart, vendedora_id: rosa.id });
    assert.deepEqual(r.json.carrito.vendedora, { id: rosa.id, alias: 'Rosa' });
    await api(caja.url, '/api/venta/escanear', { cart: cart.cart, codigo: '0002026090782' });
    const c = await api(caja.url, '/api/venta/cobrar-efectivo', { cart: cart.cart, recibido: 5000000 });
    assert.equal(c.json.venta.vendedora, 'Rosa');
    assert.match(c.json.ticket_texto, /Vendedora-Cajera: Lupe\nVendió: Rosa/);
    // sin ayuda: Autocompra (no se imprime en el ticket)
    const k = await vender(caja, null);
    assert.equal(k.venta.vendedora, 'Autocompra');
    assert.equal(k.venta.vendedora_id, null);
    assert.doesNotMatch(k.ticket_texto, /Vendió:/);
    const h = (await api(caja.url, '/api/ventas')).json.ventas;
    assert.deepEqual(h.map((x: any) => x.vendedora), ['Rosa', 'Autocompra']);
  });

  it('EM3 reporte por vendedora: tickets, piezas, vendido, devuelto/cambiado y neto; Autocompra y ventas sin registro aparte', async (t) => {
    const { ctx, adm, caja } = await preparar(t);
    const v = (await api(caja.url, '/api/venta/vendedoras')).json.vendedoras;
    const id = (a: string) => v.find((x: any) => x.alias === a).id;
    await vender(caja, id('Rosa'));                                  // $899
    const v1 = await vender(caja, id('Rosa'), '7501234567890');      // $120
    await vender(caja, id('Lupe'));                                  // $899
    await vender(caja, null, '0000000000017');                       // $450 Autocompra
    await vender(caja);                                              // sin elegir (API): sin registrar
    // la clienta cambia la mascada de Rosa por una bolsa atendida por Lupe
    const cart = (await api(caja.url, '/api/venta/nueva', {})).json.cart;
    await api(caja.url, '/api/venta/vendedora', { cart, vendedora_id: id('Lupe') });
    await api(caja.url, '/api/venta/cambio/iniciar', { cart, sale_id: v1.venta.sale_id, renglones: [{ linea_id: v1.venta.lineas[0].linea_id, qty: 1 }] });
    await api(caja.url, '/api/venta/escanear', { cart, codigo: '0000000000017' });
    await api(caja.url, '/api/venta/cobrar-efectivo', { cart, recibido: 5000000 });
    ctx.m.pump(); ctx.m.pump(); ctx.m.pump();
    const r = (await api(adm.url, '/api/admin/reporte-vendedoras', {})).json.vendedoras;
    const f = (c: string) => r.find((x: any) => x.clave === c || x.alias === c);
    assert.deepEqual([f('Rosa').tickets, f('Rosa').piezas, f('Rosa').vendido, f('Rosa').devuelto, f('Rosa').neto], [2, 2, 89900 + 12000, 12000, 89900], 'el cambio resta a quien vendió la pieza');
    assert.deepEqual([f('Lupe').tickets, f('Lupe').vendido, f('Lupe').neto, f('Lupe').nombre_completo], [2, 89900 + 45000, 134900, 'Guadalupe Pérez López'], 'la bolsa del cambio suma a quien la vendió');
    assert.deepEqual([f('Autocompra').tickets, f('Autocompra').vendido], [1, 45000]);
    assert.deepEqual([f('Sin registrar').tickets, f('Sin registrar').vendido], [1, 89900]);
  });
});
