import assert from 'node:assert/strict';
import { it } from 'node:test';
import { api, appAdmin, appCajero } from './ayudas/app.ts';
import { ALMACENES, nuevoMundo, politica } from './ayudas/comun.ts';

const FOTO = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

it('AV1 la foto del perfil de quien tiene la sesión llega a la caja (cajera y supervisor) para mostrarla en la barra', async (t) => {
  const ctx = nuevoMundo(ALMACENES.find((a) => a.nombre === 'sqlite')!, politica());
  const adm = await appAdmin(ctx);
  const caja = await appCajero(ctx, 'DUO', 1, 'Lupe');
  t.after(async () => { await adm.cerrar(); await caja.cerrar(); ctx.limpiar(); });
  assert.equal((await api(adm.url, '/api/admin/administradores', { nombre: 'Edgardo', clave: 'clave-segura', clave_caja: '2468', perfil: { nombres: 'Edgardo', apellidos: 'Morales', foto: FOTO } })).status, 200);
  assert.equal((await api(adm.url, '/api/admin/cajeros', { nombre: 'Lupe', clave: '4321', perfil: { nombres: 'Lupe', apellidos: 'Pérez', foto: FOTO } })).status, 200);
  assert.equal((await api(adm.url, '/api/admin/cajeros', { nombre: 'Rosa', clave: '8765' })).status, 200);
  for (let i = 0; i < 4; i++) ctx.m.pump();
  const estado = async () => (await api(caja.url, '/api/estado')).json.estado;
  assert.equal((await api(caja.url, '/api/login', { usuario: 'Lupe', clave: '4321' })).status, 200);
  assert.equal((await estado()).usuario_foto, FOTO);
  await api(caja.url, '/api/logout', {});
  assert.equal((await api(caja.url, '/api/login', { usuario: 'Edgardo', clave: '2468' })).status, 200);
  assert.equal((await estado()).usuario_foto, FOTO, 'la foto del supervisor viaja en su registro de caja');
  await api(caja.url, '/api/logout', {});
  assert.equal((await api(caja.url, '/api/login', { usuario: 'Rosa', clave: '8765' })).status, 200);
  assert.equal((await estado()).usuario_foto, null, 'sin foto: la barra muestra su inicial');
});
