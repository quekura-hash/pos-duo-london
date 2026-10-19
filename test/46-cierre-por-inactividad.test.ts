import assert from 'node:assert/strict';
import { it } from 'node:test';
import { ServicioAdmin } from '../src/app/servicio.ts';
import { crearServidorApp } from '../src/app/servidor-app.ts';
import { appAdmin, appCajero, api, escuchar } from './ayudas/app.ts';
import { nuevoMundo, politica, porAlmacen } from './ayudas/comun.ts';

const MIN = 60000;

porAlmacen('Cierre de sesión por inactividad', (alm) => {
  const preparar = async (t: { after(f: () => void): void }) => {
    const ctx = nuevoMundo(alm, politica());
    t.after(ctx.limpiar);
    const adm = await appAdmin(ctx); t.after(() => adm.cerrar());
    const caja = await appCajero(ctx, 'DUO', 1, 'Ana'); t.after(() => caja.cerrar());
    await api(adm.url, '/api/admin/cajeros', { nombre: 'Lupe', clave: '4321' });
    await api(adm.url, '/api/admin/cajeros', { nombre: 'Rosa', clave: '8765' });
    ctx.m.pump(); ctx.m.pump(); ctx.m.pump();
    await api(caja.url, '/api/login', { usuario: 'Lupe', clave: '4321' });
    return { ctx, adm, caja };
  };

  it('IN1 la caja cierra la sesión a los 10 minutos sin actividad; las lecturas automáticas no cuentan y el latido sí', async (t) => {
    const { ctx, caja } = await preparar(t);
    let s = (await api(caja.url, '/api/sesion?pasivo=1')).json;
    assert.deepEqual([s.autenticado, s.inactividad.limite_seg, s.inactividad.restante_seg], [true, 600, 600]);
    ctx.m.reloj.avanzar(9 * MIN);
    s = (await api(caja.url, '/api/sesion?pasivo=1')).json;
    assert.equal(s.inactividad.restante_seg, 60);
    // una lectura automática (encabezado) no renueva el tiempo
    assert.equal((await api(caja.url, '/api/estado?pasivo=1')).status, 200);
    assert.equal((await api(caja.url, '/api/sesion?pasivo=1')).json.inactividad.restante_seg, 60);
    // el latido (la persona sigue trabajando) lo renueva
    s = (await api(caja.url, '/api/actividad', {})).json;
    assert.equal(s.inactividad.restante_seg, 600);
    ctx.m.reloj.avanzar(9 * MIN);
    assert.equal((await api(caja.url, '/api/venta/nueva', {})).status, 200, 'una operación también cuenta como actividad');
    ctx.m.reloj.avanzar(9 * MIN);
    assert.equal((await api(caja.url, '/api/estado')).status, 200);
    // sin actividad: se cierra
    ctx.m.reloj.avanzar(11 * MIN);
    s = (await api(caja.url, '/api/sesion?pasivo=1')).json;
    assert.deepEqual([s.autenticado, s.usuario, s.inactividad], [false, null, null]);
    const r = await api(caja.url, '/api/estado');
    assert.deepEqual([r.status, r.json.error.codigo], [401, 'NO_AUTENTICADO']);
    assert.equal((await api(caja.url, '/api/login', { usuario: 'Lupe', clave: '4321' })).json.autenticado, true);
  });

  it('IN2 la venta con artículos queda en «Venta en espera» a nombre de la sesión cerrada y la siguiente persona la retoma', async (t) => {
    const { ctx, caja } = await preparar(t);
    const cart = (await api(caja.url, '/api/venta/nueva', {})).json.cart;
    await api(caja.url, '/api/venta/escanear', { cart, codigo: '0002026090782' });
    ctx.m.reloj.avanzar(11 * MIN);
    assert.equal((await api(caja.url, '/api/estado')).status, 401);
    await api(caja.url, '/api/login', { usuario: 'Rosa', clave: '8765' });
    const espera = (await api(caja.url, '/api/venta/espera')).json.espera;
    assert.deepEqual(espera.map((e: any) => [e.cart_id, e.nota, e.piezas]), [[cart, 'Sesión de Lupe cerrada por inactividad', 1]]);
    // la venta en pantalla de Rosa es otra (no hereda el carrito de Lupe) y puede retomar la guardada
    const actual = (await api(caja.url, '/api/venta/actual', {})).json;
    assert.notEqual(actual.cart, cart);
    const r = (await api(caja.url, '/api/venta/retomar', { cart, actual: actual.cart })).json;
    assert.equal(r.carrito.piezas, 1);
    // cerrar sesión a mano también la guarda
    await api(caja.url, '/api/logout', {});
    await api(caja.url, '/api/login', { usuario: 'Lupe', clave: '4321' });
    assert.equal((await api(caja.url, '/api/venta/espera')).json.espera[0].nota, 'Sesión de Rosa cerrada');
  });

  it('IN3 los minutos se configuran (0 = nunca) y se reparten a las cajas; valores inválidos se rechazan', async (t) => {
    const { ctx, adm, caja } = await preparar(t);
    assert.deepEqual((await api(adm.url, '/api/admin/config-sesion')).json.config, { caja_min: 10, admin_min: 15 });
    for (const malo of [{ caja_min: -1, admin_min: 15 }, { caja_min: 481, admin_min: 15 }, { caja_min: 1.5, admin_min: 15 }, { caja_min: 10, admin_min: 'x' }]) assert.equal((await api(adm.url, '/api/admin/config-sesion', malo)).json.error.codigo, 'DATOS_INVALIDOS');
    await api(adm.url, '/api/admin/config-sesion', { caja_min: 2, admin_min: 15 });
    ctx.m.pump(); ctx.m.pump(); ctx.m.pump();
    let s = (await api(caja.url, '/api/actividad', {})).json;
    assert.equal(s.inactividad.limite_seg, 120);
    ctx.m.reloj.avanzar(3 * MIN);
    assert.equal((await api(caja.url, '/api/sesion?pasivo=1')).json.autenticado, false);
    await api(adm.url, '/api/admin/config-sesion', { caja_min: 0, admin_min: 15 });
    ctx.m.pump(); ctx.m.pump(); ctx.m.pump();
    await api(caja.url, '/api/login', { usuario: 'Lupe', clave: '4321' });
    s = (await api(caja.url, '/api/sesion?pasivo=1')).json;
    assert.equal(s.inactividad, null, '0 = nunca se cierra por inactividad');
    ctx.m.reloj.avanzar(5 * 60 * MIN);
    assert.equal((await api(caja.url, '/api/estado')).status, 200);
  });

  it('IN4 Administración también cierra su sesión por inactividad (15 minutos) y las lecturas automáticas no la renuevan', async (t) => {
    const ctx = nuevoMundo(alm, politica());
    t.after(ctx.limpiar);
    const admin = new ServicioAdmin({ central: ctx.m.central, actor: { rol: 'admin', usuario: 'galo' }, fuente: () => ctx.m.central.repo.ops(), cajas: ctx.m.ctx.cajasCfg.map((c) => ({ tienda: c.tienda, caja: c.caja })), inventario: ctx.m.inventarioCentral(), reloj: ctx.m.reloj });
    const adm = await escuchar(crearServidorApp({ admin })); t.after(() => adm.cerrar());
    await api(adm.url, '/api/admin/administradores', { nombre: 'Edgardo', clave: 'clave-segura' }); // queda dentro
    let s = (await api(adm.url, '/api/sesion?pasivo=1')).json;
    assert.deepEqual([s.autenticado, s.inactividad.limite_seg], [true, 900]);
    ctx.m.reloj.avanzar(14 * MIN);
    assert.equal((await api(adm.url, '/api/admin/tipo-cambio?pasivo=1')).status, 200);
    ctx.m.reloj.avanzar(2 * MIN);
    s = (await api(adm.url, '/api/sesion?pasivo=1')).json;
    assert.deepEqual([s.autenticado, s.requiere_login], [false, true]);
    assert.equal((await api(adm.url, '/api/admin/inventario')).status, 401);
    await api(adm.url, '/api/login', { usuario: 'Edgardo', clave: 'clave-segura' });
    ctx.m.reloj.avanzar(14 * MIN);
    assert.equal((await api(adm.url, '/api/admin/inventario')).status, 200, 'una operación renueva');
    ctx.m.reloj.avanzar(14 * MIN);
    assert.equal((await api(adm.url, '/api/actividad', {})).json.inactividad.restante_seg, 900);
  });
});
