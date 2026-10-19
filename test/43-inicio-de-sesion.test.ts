import assert from 'node:assert/strict';
import { it } from 'node:test';
import { appAdmin, appCajero, api } from './ayudas/app.ts';
import { nuevoMundo, politica, porAlmacen } from './ayudas/comun.ts';

porAlmacen('Inicio de sesión de la caja y de Administración', (alm) => {
  it('IS1 sin cajeros registrados la caja trabaja como siempre; con uno, pide usuario y clave antes de cualquier operación', async (t) => {
    const ctx = nuevoMundo(alm, politica());
    t.after(ctx.limpiar);
    const adm = await appAdmin(ctx);
    t.after(() => adm.cerrar());
    const caja = await appCajero(ctx, 'DUO', 1, 'Ana');
    t.after(() => caja.cerrar());
    // sin cajeros: abierta
    let s = await api(caja.url, '/api/sesion');
    assert.deepEqual([s.json.requiere_login, s.json.autenticado, s.json.usuario], [false, true, 'Ana']);
    assert.equal((await api(caja.url, '/api/estado')).status, 200);
    // Administración (aún sin administradores: abierta) registra un cajero
    assert.equal((await api(adm.url, '/api/admin/cajeros', { nombre: 'Lupe', clave: '4321' })).status, 200);
    ctx.m.pump(); ctx.m.pump();
    s = await api(caja.url, '/api/sesion');
    assert.deepEqual([s.json.requiere_login, s.json.autenticado, s.json.usuario, s.json.cajeros], [true, false, null, ['Lupe']]);
    // ninguna operación pasa sin sesión
    for (const [ruta, cuerpo] of [['/api/estado'], ['/api/venta/actual', {}], ['/api/venta/nueva', {}], ['/api/retiro'], ['/api/buscar?q=jeans']] as [string, unknown?][]) {
      const r = await api(caja.url, ruta, cuerpo);
      assert.deepEqual([r.status, r.json.error.codigo], [401, 'NO_AUTENTICADO'], ruta);
    }
    // clave equivocada / usuario inexistente
    let r = await api(caja.url, '/api/login', { usuario: 'Lupe', clave: '0000' });
    assert.deepEqual([r.status, r.json.error.codigo], [403, 'CLAVE_INVALIDA']);
    r = await api(caja.url, '/api/login', { usuario: 'Nadie', clave: '4321' });
    assert.equal(r.json.error.codigo, 'CAJERO_SIN_CLAVE');
    // entra con el nombre sin importar mayúsculas; el usuario de la caja pasa a ser el registrado
    r = await api(caja.url, '/api/login', { usuario: ' lupe ', clave: '4321' });
    assert.deepEqual([r.status, r.json.autenticado, r.json.usuario], [200, true, 'Lupe']);
    assert.equal((await api(caja.url, '/api/estado')).json.estado.usuario, 'Lupe');
    const cart = (await api(caja.url, '/api/venta/nueva', {})).json.cart;
    await api(caja.url, '/api/venta/escanear', { cart, codigo: '0002026090782' });
    const venta = (await api(caja.url, '/api/venta/cobrar-efectivo', { cart, recibido: 100000 })).json;
    assert.equal(venta.venta.cajero, 'Lupe', 'la venta queda a nombre de quien inició sesión');
    // cerrar sesión
    r = await api(caja.url, '/api/logout', {});
    assert.deepEqual([r.json.autenticado, r.json.usuario], [false, null]);
    assert.equal((await api(caja.url, '/api/estado')).status, 401);
  });

  it('IS2 cinco claves equivocadas bloquean al cajero 5 minutos, también con la clave correcta', async (t) => {
    const ctx = nuevoMundo(alm, politica());
    t.after(ctx.limpiar);
    const adm = await appAdmin(ctx); t.after(() => adm.cerrar());
    const caja = await appCajero(ctx, 'DUO', 1, 'Ana'); t.after(() => caja.cerrar());
    await api(adm.url, '/api/admin/cajeros', { nombre: 'Lupe', clave: '4321' });
    ctx.m.pump(); ctx.m.pump();
    for (let i = 0; i < 5; i++) assert.equal((await api(caja.url, '/api/login', { usuario: 'Lupe', clave: '1111' })).json.error.codigo, 'CLAVE_INVALIDA');
    const r = await api(caja.url, '/api/login', { usuario: 'Lupe', clave: '4321' });
    assert.deepEqual([r.status, r.json.error.codigo], [429, 'CLAVE_BLOQUEADA']);
    ctx.m.reloj.avanzar(5 * 60000 + 1000);
    assert.equal((await api(caja.url, '/api/login', { usuario: 'Lupe', clave: '4321' })).json.autenticado, true);
  });

  it('IS3 un cajero desactivado pierde la sesión; el registro de cajeros no deja nombres repetidos con administradores', async (t) => {
    const ctx = nuevoMundo(alm, politica());
    t.after(ctx.limpiar);
    const adm = await appAdmin(ctx); t.after(() => adm.cerrar());
    const caja = await appCajero(ctx, 'DUO', 1, 'Ana'); t.after(() => caja.cerrar());
    await api(adm.url, '/api/admin/cajeros', { nombre: 'Lupe', clave: '4321' });
    await api(adm.url, '/api/admin/cajeros', { nombre: 'Rosa', clave: '8765' });
    ctx.m.pump(); ctx.m.pump();
    await api(caja.url, '/api/login', { usuario: 'Lupe', clave: '4321' });
    assert.equal((await api(caja.url, '/api/estado')).status, 200);
    const lupe = (await api(adm.url, '/api/admin/cajeros')).json.cajeros.find((c: any) => c.nombre === 'Lupe');
    await api(adm.url, '/api/admin/cajeros', { id: lupe.id, activo: false });
    ctx.m.pump(); ctx.m.pump(); ctx.m.pump();
    assert.equal((await api(caja.url, '/api/estado')).status, 401, 'desactivar al cajero cierra su sesión');
    assert.equal((await api(adm.url, '/api/admin/administradores', { nombre: 'rosa', clave: 'secreta1' })).json.error.codigo, 'ADMIN_INVALIDO');
  });

  it('IS4 Administración: abierta mientras no haya administradores; con uno pide usuario y contraseña (6 a 40), bloquea y puede cerrar sesión', async (t) => {
    const ctx = nuevoMundo(alm, politica());
    t.after(ctx.limpiar);
    const adm = await appAdmin(ctx); t.after(() => adm.cerrar());
    let s = await api(adm.url, '/api/sesion');
    assert.deepEqual([s.json.requiere_login, s.json.autenticado, s.json.sin_administradores], [false, true, true]);
    assert.equal((await api(adm.url, '/api/admin/administradores', { nombre: 'Edgardo', clave: '123' })).json.error.codigo, 'ADMIN_INVALIDO');
    assert.equal((await api(adm.url, '/api/admin/administradores', { nombre: 'Edgardo', clave: 'clave-segura' })).status, 200);
    s = await api(adm.url, '/api/sesion');
    assert.deepEqual([s.json.requiere_login, s.json.autenticado, s.json.usuario], [true, true, 'Edgardo'], 'quien crea al primer administrador queda dentro');
    assert.equal((await api(adm.url, '/api/logout', {})).json.autenticado, false);
    for (const ruta of ['/api/admin/inventario', '/api/admin/cajeros', '/api/admin/administradores']) assert.equal((await api(adm.url, ruta)).status, 401, ruta);
    assert.equal((await api(adm.url, '/api/admin/administradores', { nombre: 'Otro', clave: 'clave-segura' })).status, 401, 'sin sesión no se crean administradores');
    let r = await api(adm.url, '/api/login', { usuario: 'Edgardo', clave: 'otra-cosa' });
    assert.equal(r.json.error.codigo, 'CLAVE_INVALIDA');
    r = await api(adm.url, '/api/login', { usuario: 'EDGARDO', clave: 'clave-segura' });
    assert.deepEqual([r.json.autenticado, r.json.usuario], [true, 'Edgardo']);
    assert.equal((await api(adm.url, '/api/admin/inventario')).status, 200);
    // lo que hace Administración queda a su nombre
    await api(adm.url, '/api/admin/cajeros', { nombre: 'Lupe', clave: '4321' });
    assert.equal(ctx.m.central.repo.ops().filter((o) => o.tipo === 'cajero.guardado').at(-1)!.payload.por, 'Edgardo');
    // los administradores no se reparten a las cajas
    ctx.m.pump(); ctx.m.pump(); ctx.m.pump();
    assert.equal(ctx.m.caja('DUO', 1).repo.ops().some((o) => o.tipo === 'admin.guardado'), false);
    assert.equal(ctx.m.central.repo.ops().some((o) => o.tipo === 'admin.guardado'), true);
    assert.equal((await api(adm.url, '/api/logout', {})).json.autenticado, false);
    assert.equal((await api(adm.url, '/api/admin/inventario')).status, 401);
    for (let i = 0; i < 5; i++) await api(adm.url, '/api/login', { usuario: 'Edgardo', clave: 'mal-mal' });
    assert.equal((await api(adm.url, '/api/login', { usuario: 'Edgardo', clave: 'clave-segura' })).json.error.codigo, 'CLAVE_BLOQUEADA');
  });
});
