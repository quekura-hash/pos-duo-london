import assert from 'node:assert/strict';
import { it } from 'node:test';
import { appAdmin, appCajero, api } from './ayudas/app.ts';
import { nuevoMundo, politica, porAlmacen } from './ayudas/comun.ts';

porAlmacen('Roles de Administración: supervisor y almacenista; los cajeros no entran', (alm) => {
  const preparar = async (t: { after(f: () => void): void }) => {
    const ctx = nuevoMundo(alm, politica());
    t.after(ctx.limpiar);
    const adm = await appAdmin(ctx);
    t.after(() => adm.cerrar());
    return { ctx, adm };
  };

  it('RO1 el primer usuario debe ser supervisor; con un supervisor se crea al almacenista; siempre queda un supervisor activo', async (t) => {
    const { adm } = await preparar(t);
    let r = await api(adm.url, '/api/admin/administradores', { nombre: 'Gabo', clave: 'clave-gabo', rol: 'almacenista' });
    assert.equal(r.json.error.codigo, 'ADMIN_INVALIDO');
    assert.match(r.json.error.mensaje, /primer usuario.*supervisor/);
    r = await api(adm.url, '/api/admin/administradores', { nombre: 'Edgardo', clave: 'clave-segura', clave_caja: '2468' });
    assert.equal(r.status, 200);
    assert.deepEqual(r.json.administradores.map((a: any) => [a.nombre, a.rol, a.clave_caja]), [['Edgardo', 'supervisor', true]]);
    r = await api(adm.url, '/api/admin/administradores', { nombre: 'Gabo', clave: 'clave-gabo', rol: 'almacenista' });
    assert.deepEqual(r.json.administradores.map((a: any) => [a.nombre, a.rol, a.clave_caja]), [['Edgardo', 'supervisor', true], ['Gabo', 'almacenista', false]]);
    assert.equal((await api(adm.url, '/api/admin/administradores', { nombre: 'Raro', clave: 'clave-rara', rol: 'jefe' })).json.error.codigo, 'ADMIN_INVALIDO');
    // no se puede desactivar al único supervisor
    const ed = r.json.administradores.find((a: any) => a.nombre === 'Edgardo');
    r = await api(adm.url, '/api/admin/administradores', { id: ed.id, activo: false });
    assert.equal(r.json.error.codigo, 'ADMIN_INVALIDO');
    assert.match(r.json.error.mensaje, /al menos un supervisor activo/);
  });

  it('RO2 el almacenista solo ve Inventario y Almacén: el resto responde 403, no cambia precios ni administra usuarios; el supervisor ve todo', async (t) => {
    const { adm } = await preparar(t);
    await api(adm.url, '/api/admin/administradores', { nombre: 'Edgardo', clave: 'clave-segura' });
    await api(adm.url, '/api/admin/administradores', { nombre: 'Gabo', clave: 'clave-gabo', rol: 'almacenista' });
    await api(adm.url, '/api/logout', {});
    let s = (await api(adm.url, '/api/login', { usuario: 'Gabo', clave: 'clave-gabo' })).json;
    assert.deepEqual([s.autenticado, s.rol_usuario], [true, 'almacenista']);
    s = (await api(adm.url, '/api/sesion')).json;
    assert.deepEqual(s.nav, ['inventario', 'almacen']);
    for (const ruta of ['/api/admin/inventario', '/api/admin/almacen', '/api/admin/entregas', '/api/admin/limbo/conteos', '/api/admin/articulos?todos=1', '/api/admin/departamentos', '/api/admin/tipo-cambio']) assert.equal((await api(adm.url, ruta)).status, 200, ruta);
    for (const ruta of ['/api/admin/cajeros', '/api/admin/administradores', '/api/admin/supervisores', '/api/admin/promociones', '/api/admin/tiendas', '/api/admin/descuentos', '/api/admin/dolares', '/api/admin/tarjetas']) assert.equal((await api(adm.url, ruta)).status, 403, ruta);
    assert.equal((await api(adm.url, '/api/admin/cajeros', { nombre: 'Intruso', clave: '1234' })).status, 403);
    assert.equal((await api(adm.url, '/api/admin/tipo-cambio', { tasa: 180000, version_base: 0 })).status, 403, 'puede ver el dólar pero no cambiarlo');
    assert.equal((await api(adm.url, '/api/admin/departamentos', { nombre: 'Nuevo' })).status, 403, 'editar departamentos es de supervisor');
    // editar un artículo sí, pero no su precio
    const a = (await api(adm.url, '/api/admin/articulos?todos=1&limite=1')).json.articulos[0];
    assert.equal((await api(adm.url, '/api/admin/articulos', { item_id: a.item_id, cambios: { marca: 'NUEVA MARCA' } })).status, 200);
    const sinPrecio = await api(adm.url, '/api/admin/articulos', { item_id: a.item_id, cambios: { precio: 99900 } });
    assert.deepEqual([sinPrecio.status, sinPrecio.json.error.codigo], [403, 'PROHIBIDO']);
    // el supervisor sí
    await api(adm.url, '/api/logout', {});
    s = (await api(adm.url, '/api/login', { usuario: 'Edgardo', clave: 'clave-segura' })).json;
    assert.deepEqual([s.rol_usuario, (await api(adm.url, '/api/sesion')).json.nav.length], ['supervisor', 10]);
    assert.equal((await api(adm.url, '/api/admin/cajeros')).status, 200);
    assert.equal((await api(adm.url, '/api/admin/articulos', { item_id: a.item_id, cambios: { precio: 99900 } })).status, 200);
  });

  it('RO3 un cajero no entra a Administración con su clave; el supervisor registrado con clave de caja autoriza descuentos', async (t) => {
    const { ctx, adm } = await preparar(t);
    await api(adm.url, '/api/admin/administradores', { nombre: 'Edgardo', clave: 'clave-segura', clave_caja: '2468' });
    await api(adm.url, '/api/admin/cajeros', { nombre: 'Lupe', clave: '4321' });
    await api(adm.url, '/api/logout', {});
    const r = await api(adm.url, '/api/login', { usuario: 'Lupe', clave: '4321' });
    assert.deepEqual([r.status, r.json.error.codigo], [403, 'CLAVE_INVALIDA'], 'ni con su usuario y clave de cajero');
    assert.equal((await api(adm.url, '/api/admin/inventario')).status, 401);
    // en la caja, la clave del supervisor autoriza el descuento (a nombre de ese supervisor)
    ctx.m.pump(); ctx.m.pump(); ctx.m.pump();
    const caja = await appCajero(ctx, 'DUO', 1, 'Ana'); t.after(() => caja.cerrar());
    await api(caja.url, '/api/login', { usuario: 'Lupe', clave: '4321' });
    const cart = (await api(caja.url, '/api/venta/nueva', {})).json.cart;
    await api(caja.url, '/api/venta/escanear', { cart, codigo: '0002026090782' });
    const d = await api(caja.url, '/api/venta/descuento', { cart, linea_id: null, tipo: 'pct', valor: 10, clave: '2468' });
    assert.equal(d.status, 200);
    assert.equal(d.json.supervisor, 'Edgardo');
    // si el supervisor se desactiva (hay otro) su clave de caja deja de valer
    await api(adm.url, '/api/login', { usuario: 'Edgardo', clave: 'clave-segura' });
    await api(adm.url, '/api/admin/administradores', { nombre: 'Rosa', clave: 'clave-rosa1' });
    const ed = (await api(adm.url, '/api/admin/administradores')).json.administradores.find((a: any) => a.nombre === 'Edgardo');
    assert.equal((await api(adm.url, '/api/admin/administradores', { id: ed.id, activo: false })).status, 200);
    ctx.m.pump(); ctx.m.pump(); ctx.m.pump();
    const d2 = await api(caja.url, '/api/venta/descuento', { cart, linea_id: null, tipo: 'pct', valor: 5, clave: '2468' });
    assert.equal(d2.json.error.codigo, 'CLAVE_INVALIDA');
  });
});
