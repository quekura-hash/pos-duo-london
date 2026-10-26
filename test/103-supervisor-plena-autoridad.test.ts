import assert from 'node:assert/strict';
import { it } from 'node:test';
import { api, appAdmin, appCajero } from './ayudas/app.ts';
import { ALMACENES, nuevoMundo, politica } from './ayudas/comun.ts';

const sqlite = ALMACENES.find((a) => a.nombre === 'sqlite')!;
const JEANS = '0002026090782';

it('SP1 un supervisor con sesión iniciada autoriza con su propia clave, sin segunda persona ni casilla, y se vende a sí mismo como empleado', async (t) => {
  const ctx = nuevoMundo(sqlite, politica());
  const adm = await appAdmin(ctx);
  const caja = await appCajero(ctx, 'DUO', 1, 'Edgardo');
  t.after(async () => { await adm.cerrar(); await caja.cerrar(); ctx.limpiar(); });
  assert.equal((await api(adm.url, '/api/admin/administradores', { nombre: 'Edgardo', clave: 'clave-segura', clave_caja: '2468' })).status, 200);
  assert.equal((await api(adm.url, '/api/admin/cajeros', { nombre: 'Lupe', clave: '4321' })).status, 200);
  for (let i = 0; i < 4; i++) ctx.m.pump();
  assert.equal((await api(caja.url, '/api/login', { usuario: 'Edgardo', clave: '2468' })).status, 200);
  const ses = (await api(caja.url, '/api/sesion')).json;
  assert.equal(ses.supervisor, true);
  const aut = (await api(caja.url, '/api/venta/autorizadores')).json.autorizadores;
  assert.equal(aut[0].nombre, 'Edgardo');
  assert.equal(aut[0].tipo, 'supervisor');

  // cancelar su propia venta con su clave (sin «sin_segundo»), anotado con su nombre a secas
  const c1 = (await api(caja.url, '/api/venta/nueva', {})).json.cart;
  await api(caja.url, '/api/venta/escanear', { cart: c1, codigo: JEANS });
  const sale = (await api(caja.url, '/api/venta/cobrar-efectivo', { cart: c1, recibido: 100000 })).json.venta.sale_id;
  const mala = await api(caja.url, '/api/venta/cancelar', { sale_id: sale, motivo: 'prueba', clienta: { nombre: 'Marta', telefono: '6861234567' }, autoriza: { nombre: 'Edgardo', clave: '0000' } });
  assert.equal(mala.status >= 400, true, 'la clave propia debe ser correcta');
  const ok = await api(caja.url, '/api/venta/cancelar', { sale_id: sale, motivo: 'prueba', clienta: { nombre: 'Marta', telefono: '6861234567' }, autoriza: { nombre: 'Edgardo', clave: '2468' } });
  assert.equal(ok.status, 200, JSON.stringify(ok.json));
  assert.doesNotMatch(JSON.stringify(ok.json), /sin segunda persona/);

  // se vende a sí mismo como empleado, sin pedir a otro supervisor
  const emp = (await api(caja.url, '/api/empleadas')).json.empleadas as { id: string; nombre: string }[];
  const yo = emp.find((e) => e.nombre === 'Edgardo');
  assert.ok(yo, 'el supervisor figura entre las empleadas');
  const c2 = (await api(caja.url, '/api/venta/nueva', {})).json.cart;
  await api(caja.url, '/api/venta/escanear', { cart: c2, codigo: JEANS });
  const e = await api(caja.url, '/api/venta/empleada', { cart: c2, empleada_id: yo!.id, clave: '2468' });
  assert.equal(e.status, 200, JSON.stringify(e.json));

  // una cajera sigue sin poder autorizarse sola
  assert.equal((await api(caja.url, '/api/logout', {})).status, 200);
  assert.equal((await api(caja.url, '/api/login', { usuario: 'Lupe', clave: '4321' })).status, 200);
  assert.equal((await api(caja.url, '/api/sesion')).json.supervisor, false);
});
