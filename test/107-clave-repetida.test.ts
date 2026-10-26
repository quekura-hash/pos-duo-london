import assert from 'node:assert/strict';
import { it } from 'node:test';
import { api, appAdmin, appCajero } from './ayudas/app.ts';
import { ALMACENES, nuevoMundo, politica } from './ayudas/comun.ts';

it('CR1 dos personas pueden tener la misma clave sin que el sistema avise que ya está usada; quien tiene la sesión queda como autorizador', async (t) => {
  const ctx = nuevoMundo(ALMACENES.find((a) => a.nombre === 'sqlite')!, politica());
  const adm = await appAdmin(ctx);
  const caja = await appCajero(ctx, 'DUO', 1, 'Evelyn');
  t.after(async () => { await adm.cerrar(); await caja.cerrar(); ctx.limpiar(); });
  assert.equal((await api(adm.url, '/api/admin/administradores', { nombre: 'Edgardo', clave: 'clave-segura', clave_caja: '2468' })).status, 200);
  // la segunda supervisora elige la misma clave de caja: se acepta, sin revelar que otra persona la tiene
  const ev = await api(adm.url, '/api/admin/administradores', { nombre: 'Evelyn', clave: 'clave-segura2', clave_caja: '2468' });
  assert.equal(ev.status, 200, JSON.stringify(ev.json));
  // dos cajeras con la misma clave
  assert.equal((await api(adm.url, '/api/admin/cajeros', { nombre: 'Lupe', clave: '4321' })).status, 200);
  assert.equal((await api(adm.url, '/api/admin/cajeros', { nombre: 'Rosa', clave: '4321' })).status, 200);
  for (let i = 0; i < 4; i++) ctx.m.pump();
  // Evelyn inicia sesión y autoriza un descuento con la clave compartida: queda anotada ella, no la primera de la lista
  assert.equal((await api(caja.url, '/api/login', { usuario: 'Evelyn', clave: '2468' })).status, 200);
  const cart = (await api(caja.url, '/api/venta/nueva', {})).json.cart;
  const lin = (await api(caja.url, '/api/venta/escanear', { cart, codigo: '0002026090782' })).json.linea;
  const d = await api(caja.url, '/api/venta/descuento', { cart, linea_id: lin.linea_id, tipo: 'pct', valor: 10, clave: '2468' });
  assert.equal(d.status, 200, JSON.stringify(d.json));
  assert.equal(d.json.supervisor, 'Evelyn');
  // una clave que nadie tiene sigue sin valer
  assert.equal((await api(caja.url, '/api/venta/descuento', { cart, linea_id: lin.linea_id, tipo: 'pct', valor: 10, clave: '9999' })).status >= 400, true);
});
