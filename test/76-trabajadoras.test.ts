import assert from 'node:assert/strict';
import { it } from 'node:test';
import { api, appAdmin, appCajero } from './ayudas/app.ts';
import { nuevoMundo, politica, porAlmacen, servicioDe } from './ayudas/comun.ts';

porAlmacen('Trabajadoras: tienda donde trabajan, «vendió por» por tienda y expediente privado', (alm) => {
  const preparar = async (t: { after(f: () => void): void }) => {
    const ctx = nuevoMundo(alm, politica());
    t.after(ctx.limpiar);
    const adm = await appAdmin(ctx); t.after(() => adm.cerrar());
    await api(adm.url, '/api/admin/administradores', { nombre: 'Edgardo', clave: 'clave-segura' });
    await api(adm.url, '/api/admin/cajeros', { nombre: 'Ana', clave: '1111', tienda: 'DUO' });
    await api(adm.url, '/api/admin/cajeros', { nombre: 'Bea', clave: '2222', tienda: 'LON' });
    await api(adm.url, '/api/admin/cajeros', { nombre: 'Cris', clave: '3333' });
    ctx.m.pump(); ctx.m.pump(); ctx.m.pump();
    return { ctx, adm };
  };
  const alias = (ctx: ReturnType<typeof nuevoMundo>, tienda: string, caja = 1) => servicioDe(ctx, tienda, caja, 'Ana').svc.vendedoras().vendedoras.filter((v) => v.tipo === 'cajero').map((v) => v.alias).sort();

  it('TR1 «vendió por» muestra en cada tienda solo a las activas de esa tienda (y a las sin tienda asignada)', async (t) => {
    const { ctx, adm } = await preparar(t);
    assert.deepEqual(alias(ctx, 'DUO'), ['Ana', 'Cris']);
    assert.deepEqual(alias(ctx, 'LON'), ['Bea', 'Cris']);
    // una inactiva no sale en ninguna
    const ana = (await api(adm.url, '/api/admin/cajeros')).json.cajeros.find((c: any) => c.nombre === 'Ana');
    assert.equal(ana.tienda, 'DUO');
    await api(adm.url, '/api/admin/cajeros', { id: ana.id, activo: false });
    ctx.m.pump(); ctx.m.pump(); ctx.m.pump();
    assert.deepEqual(alias(ctx, 'DUO'), ['Cris']);
    // la tienda que no existe se rechaza
    assert.equal((await api(adm.url, '/api/admin/cajeros', { id: ana.id, tienda: 'MARTE' })).status >= 400, true);
  });

  it('TR2 al iniciar sesión en otra tienda pasa a trabajar ahí: sale en su «vendió por» y deja de salir en la anterior; sin tienda queda asignada a la primera donde entra', async (t) => {
    const { ctx, adm } = await preparar(t);
    // Ana (DÚO) inicia sesión en London
    servicioDe(ctx, 'LON', 1, 'Ana').svc.iniciarSesion('Ana', '1111');
    ctx.m.pump(); ctx.m.pump(); ctx.m.pump();
    assert.deepEqual(alias(ctx, 'LON'), ['Ana', 'Bea', 'Cris']);
    assert.deepEqual(alias(ctx, 'DUO'), ['Cris'], 'en DÚO ya no sale');
    assert.deepEqual(alias(ctx, 'LON', 2), ['Ana', 'Bea', 'Cris'], 'la otra caja de London también se entera');
    // Cris (sin tienda) entra en DÚO: queda asignada a DÚO
    servicioDe(ctx, 'DUO', 2, 'Cris').svc.iniciarSesion('Cris', '3333');
    ctx.m.pump(); ctx.m.pump(); ctx.m.pump();
    assert.deepEqual(alias(ctx, 'DUO'), ['Cris']);
    assert.deepEqual(alias(ctx, 'LON'), ['Ana', 'Bea']);
    // la lista de Administración refleja dónde está cada una
    const lista = (await api(adm.url, '/api/admin/cajeros')).json.cajeros;
    assert.deepEqual(lista.map((c: any) => [c.nombre, c.tienda]).sort(), [['Ana', 'LON'], ['Bea', 'LON'], ['Cris', 'DUO']]);
    // editar otro dato suyo no la regresa a la tienda anterior; y Administración puede moverla a mano
    const ana = lista.find((c: any) => c.nombre === 'Ana');
    await api(adm.url, '/api/admin/cajeros', { id: ana.id, perfil: { nombres: 'Ana', apellidos: 'López' } });
    assert.equal((await api(adm.url, '/api/admin/cajeros')).json.cajeros.find((c: any) => c.nombre === 'Ana').tienda, 'LON');
    await api(adm.url, '/api/admin/cajeros', { id: ana.id, tienda: 'DUO' });
    ctx.m.pump(); ctx.m.pump(); ctx.m.pump();
    assert.deepEqual(alias(ctx, 'DUO'), ['Ana', 'Cris']);
    // iniciar sesión en la misma tienda no genera movimientos de más
    const n = ctx.m.central.repo.ops().filter((o) => o.tipo === 'cajero.ubicacion').length;
    servicioDe(ctx, 'DUO', 1, 'Ana').svc.iniciarSesion('Ana', '1111');
    ctx.m.pump(); ctx.m.pump(); ctx.m.pump();
    assert.equal(ctx.m.central.repo.ops().filter((o) => o.tipo === 'cajero.ubicacion').length, n);
  });

  /** Crea la clave corta de quien tiene la sesión y deja la ficha cerrada. */
  const conClave = async (adm: { url: string }, clave = '2468') => { assert.equal((await api(adm.url, '/api/admin/expediente/clave', { clave })).status, 200); await api(adm.url, '/api/admin/expediente/bloquear', {}); };

  it('TR3 la ficha es privada: bloqueada aunque se sea supervisor, se abre con la clave corta propia, se cierra sola y al cerrar sesión', async (t) => {
    const { adm } = await preparar(t);
    const ana = (await api(adm.url, '/api/admin/cajeros')).json.cajeros.find((c: any) => c.nombre === 'Ana');
    assert.equal((await api(adm.url, '/api/admin/expediente/desbloquear', { clave: '2468' })).json.error.codigo, 'SIN_CLAVE_CORTA', 'sin clave corta primero se crea');
    await conClave(adm);
    assert.equal((await api(adm.url, `/api/admin/expediente?cajero_id=${ana.id}`)).json.error.codigo, 'EXPEDIENTE_BLOQUEADO');
    assert.equal((await api(adm.url, '/api/admin/expediente', { cajero_id: ana.id, notas: 'x' })).json.error.codigo, 'EXPEDIENTE_BLOQUEADO');
    assert.equal((await api(adm.url, '/api/admin/expediente/desbloquear', { clave: '0000' })).json.error.codigo, 'CLAVE_INVALIDA');
    assert.equal((await api(adm.url, '/api/admin/expediente/desbloquear', { clave: '2468' })).status, 200);
    const e = (await api(adm.url, `/api/admin/expediente?cajero_id=${ana.id}`)).json;
    assert.equal(e.cajero.nombre, 'Ana');
    assert.match(e.registrada_en, /^\d{4}-\d\d-\d\dT/, 'fecha de registro en el sistema');
    assert.deepEqual([e.expediente.fecha_alta, e.expediente.recontratable, e.promedio], [null, null, null]);
    await api(adm.url, '/api/admin/expediente/bloquear', {});
    assert.equal((await api(adm.url, `/api/admin/expediente?cajero_id=${ana.id}`)).json.error.codigo, 'EXPEDIENTE_BLOQUEADO');
    // 5 claves equivocadas bloquean los intentos 5 minutos (aun con la clave buena)
    for (let i = 0; i < 5; i++) await api(adm.url, '/api/admin/expediente/desbloquear', { clave: '9999' });
    assert.equal((await api(adm.url, '/api/admin/expediente/desbloquear', { clave: '2468' })).json.error.codigo, 'CLAVE_BLOQUEADA');
  });

  it('TR3b la clave corta: se crea una vez, es de 4 a 8 dígitos, cambiarla exige la actual y no depende de la contraseña de Supabase', async (t) => {
    const { adm } = await preparar(t);
    assert.deepEqual((await api(adm.url, '/api/admin/expediente/clave')).json.tiene, false);
    assert.equal((await api(adm.url, '/api/admin/expediente/clave', { clave: '12' })).json.error.codigo, 'CLAVE_INVALIDA');
    assert.equal((await api(adm.url, '/api/admin/expediente/clave', { clave: 'abcd' })).json.error.codigo, 'CLAVE_INVALIDA');
    assert.equal((await api(adm.url, '/api/admin/expediente/clave', { clave: '2468' })).json.abierto, true, 'al crearla queda abierta');
    assert.equal((await api(adm.url, '/api/admin/expediente/clave')).json.tiene, true);
    // cambiarla exige la actual
    assert.equal((await api(adm.url, '/api/admin/expediente/clave', { clave: '1357' })).json.error.codigo, 'CLAVE_INVALIDA');
    assert.equal((await api(adm.url, '/api/admin/expediente/clave', { clave: '1357', actual: '0000' })).json.error.codigo, 'CLAVE_INVALIDA');
    assert.equal((await api(adm.url, '/api/admin/expediente/clave', { clave: '1357', actual: '2468' })).status, 200);
    await api(adm.url, '/api/admin/expediente/bloquear', {});
    assert.equal((await api(adm.url, '/api/admin/expediente/desbloquear', { clave: '2468' })).json.error.codigo, 'CLAVE_INVALIDA', 'la anterior ya no sirve');
    assert.equal((await api(adm.url, '/api/admin/expediente/desbloquear', { clave: '1357' })).status, 200);
    // la clave corta también es la de supervisor de la caja: no se puede repetir la de otra persona
    await api(adm.url, '/api/admin/supervisores', { nombre: 'Karina', clave: '9753' });
    assert.equal((await api(adm.url, '/api/admin/expediente/clave', { clave: '9753', actual: '1357' })).json.error.codigo, 'CLAVE_INVALIDA');
  });

  it('TR4 guardar el expediente: fechas, recontratable, calificaciones 1 a 5 y notas; validaciones; la baja se anota sola', async (t) => {
    const { ctx, adm } = await preparar(t);
    const ana = (await api(adm.url, '/api/admin/cajeros')).json.cajeros.find((c: any) => c.nombre === 'Ana');
    await conClave(adm);
    await api(adm.url, '/api/admin/expediente/desbloquear', { clave: '2468' });
    const guardar = (d: object) => api(adm.url, '/api/admin/expediente', { cajero_id: ana.id, ...d });
    const r = await guardar({ fecha_alta: '2025-03-10', recontratable: true, notas: 'Buena vendedora.\nFaltaba mucho.', calificaciones: { puntualidad: 4, presentacion: 5, inasistencias: 2, facilidad_palabra: 5, vendedora: 5, humildad: 3 } });
    assert.equal(r.status, 200);
    assert.deepEqual([r.json.expediente.fecha_alta, r.json.expediente.recontratable, r.json.promedio], ['2025-03-10', true, 4]);
    assert.equal(r.json.expediente.notas, 'Buena vendedora.\nFaltaba mucho.');
    // parcial: lo no enviado se conserva
    const r2 = await guardar({ calificaciones: { puntualidad: 5 } });
    assert.deepEqual([r2.json.expediente.calificaciones.puntualidad, r2.json.expediente.calificaciones.presentacion, r2.json.expediente.fecha_alta], [5, 5, '2025-03-10']);
    // validaciones
    assert.equal((await guardar({ calificaciones: { puntualidad: 6 } })).json.error.codigo, 'DATOS_INVALIDOS');
    assert.equal((await guardar({ calificaciones: { puntualidad: 0 } })).json.error.codigo, 'DATOS_INVALIDOS');
    assert.equal((await guardar({ calificaciones: { simpatia: 3 } })).json.error.codigo, 'DATOS_INVALIDOS');
    assert.equal((await guardar({ fecha_alta: '10/03/2025' })).json.error.codigo, 'FECHA_INVALIDA');
    assert.equal((await guardar({ fecha_baja: '2024-01-01' })).json.error.codigo, 'FECHA_INVALIDA', 'no puede ser anterior al alta');
    assert.equal((await guardar({ recontratable: 'tal vez' })).json.error.codigo, 'DATOS_INVALIDOS');
    assert.equal((await guardar({ notas: 'x'.repeat(4001) })).json.error.codigo, 'DATOS_INVALIDOS');
    assert.equal((await api(adm.url, '/api/admin/expediente', { cajero_id: 'no-existe', notas: 'x' })).status >= 400, true);
    // borrar un dato
    assert.equal((await guardar({ fecha_alta: null, recontratable: null })).json.expediente.fecha_alta, null);
    // inactividad: desactivarla anota la fecha y se conserva todo; reactivarla la quita
    await guardar({ fecha_alta: '2025-03-10' });
    await api(adm.url, '/api/admin/cajeros', { id: ana.id, activo: false });
    const baja = (await api(adm.url, `/api/admin/expediente?cajero_id=${ana.id}`)).json;
    assert.match(baja.expediente.fecha_baja, /^\d{4}-\d\d-\d\d$/);
    assert.equal(baja.cajero.activo, false);
    assert.equal(baja.expediente.notas, 'Buena vendedora.\nFaltaba mucho.', 'el registro se conserva');
    await api(adm.url, '/api/admin/cajeros', { id: ana.id, activo: true });
    assert.equal((await api(adm.url, `/api/admin/expediente?cajero_id=${ana.id}`)).json.expediente.fecha_baja, null);
    // lo privado nunca viaja a las tiendas ni a las cajas
    ctx.m.pump(); ctx.m.pump(); ctx.m.pump();
    for (const [t2, c] of [['DUO', 1], ['LON', 1]] as const) assert.equal(ctx.m.caja(t2, c).repo.ops().filter((o) => o.tipo === 'trabajadora.expediente').length, 0, `${t2}/${c} no recibe el expediente`);
    assert.ok(ctx.m.central.repo.ops().some((o) => o.tipo === 'trabajadora.expediente'));
    // ni la lista pública de usuarios lo trae
    assert.doesNotMatch(JSON.stringify((await api(adm.url, '/api/admin/cajeros')).json), /Buena vendedora|recontratable|calificaciones/);
  });

  it('TR5 el almacenista no ve el expediente', async (t) => {
    const { adm } = await preparar(t);
    await api(adm.url, '/api/admin/administradores', { nombre: 'Gabo', clave: 'clave-gabo', rol: 'almacenista' });
    const ana = (await api(adm.url, '/api/admin/cajeros')).json.cajeros.find((c: any) => c.nombre === 'Ana');
    await api(adm.url, '/api/logout', {});
    await api(adm.url, '/api/login', { usuario: 'Gabo', clave: 'clave-gabo' });
    assert.equal((await api(adm.url, `/api/admin/expediente?cajero_id=${ana.id}`)).status, 403);
    assert.equal((await api(adm.url, '/api/admin/expediente/desbloquear', { clave: '2468' })).status, 403);
    assert.equal((await api(adm.url, '/api/admin/expediente/clave', { clave: '2468' })).status, 403);
  });

  it('TR6 una caja no puede escribir expedientes ni ve el de nadie (la caja arma «vendió por» solo con lo público)', async (t) => {
    const { ctx } = await preparar(t);
    const caja = await appCajero(ctx, 'DUO', 1, 'Ana'); t.after(() => caja.cerrar());
    assert.equal((await api(caja.url, '/api/admin/expediente?cajero_id=x')).status >= 400, true);
    const sesion = await api(caja.url, '/api/login', { usuario: 'Ana', clave: '1111' });
    assert.equal(sesion.status, 200);
    const r = await api(caja.url, '/api/venta/vendedoras');
    const v = r.json;
    assert.deepEqual(v.vendedoras.filter((x: any) => x.tipo === 'cajero').map((x: any) => x.alias).sort(), ['Ana', 'Cris']);
    assert.doesNotMatch(JSON.stringify(v), /fecha_alta|recontratable|notas/);
  });
});
