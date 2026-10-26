import assert from 'node:assert/strict';
import { it } from 'node:test';
import { api, appAdmin, appCajero } from './ayudas/app.ts';
import { ALMACENES, nuevoMundo, politica } from './ayudas/comun.ts';

const sqlite = ALMACENES.find((a) => a.nombre === 'sqlite')!;
const JEANS = '0002026090782';

it('SC1 el supervisor y la almacenista con clave de caja inician sesión y cobran; el descuento lo autoriza quien atiende con su clave o un supervisor', async (t) => {
  const ctx = nuevoMundo(sqlite, politica());
  const adm = await appAdmin(ctx);
  const caja = await appCajero(ctx, 'DUO', 1, 'Ana');
  t.after(async () => { await adm.cerrar(); await caja.cerrar(); ctx.limpiar(); });
  const crear = (b: object) => api(adm.url, '/api/admin/administradores', b);
  assert.equal((await crear({ nombre: 'Edgardo', clave: 'clave-segura', clave_caja: '2468' })).status, 200);
  assert.equal((await crear({ nombre: 'Evelin', clave: 'clave-evelin', rol: 'supervisor', clave_caja: '1357' })).status, 200);
  const mario = await crear({ nombre: 'Mario', clave: 'clave-mario', rol: 'almacenista', clave_caja: '9753' });
  assert.equal(mario.status, 200, JSON.stringify(mario.json));
  assert.equal((await api(adm.url, '/api/admin/cajeros', { nombre: 'Lupe', clave: '4321' })).status, 200);
  for (let i = 0; i < 4; i++) ctx.m.pump();
  // la pantalla de inicio de la caja las lista a todas
  const s = (await api(caja.url, '/api/sesion')).json;
  assert.deepEqual([...s.cajeros].sort(), ['Edgardo', 'Evelin', 'Lupe', 'Mario']);
  // clave equivocada: no entra
  assert.equal((await api(caja.url, '/api/login', { usuario: 'Evelin', clave: '0000' })).status >= 400, true);
  // Evelin (supervisora) entra y cobra una venta
  assert.equal((await api(caja.url, '/api/login', { usuario: 'Evelin', clave: '1357' })).status, 200);
  const c1 = (await api(caja.url, '/api/venta/nueva', {})).json.cart;
  await api(caja.url, '/api/venta/escanear', { cart: c1, codigo: JEANS });
  const v = await api(caja.url, '/api/venta/cobrar-efectivo', { cart: c1, recibido: 100000 });
  assert.equal(v.status, 200, JSON.stringify(v.json));
  assert.equal(v.json.venta.cajero, 'Evelin');
  // Mario (almacenista) entra y cobra
  await api(caja.url, '/api/logout', {});
  assert.equal((await api(caja.url, '/api/login', { usuario: 'Mario', clave: '9753' })).status, 200);
  const c2 = (await api(caja.url, '/api/venta/nueva', {})).json.cart;
  const l2 = (await api(caja.url, '/api/venta/escanear', { cart: c2, codigo: JEANS })).json.linea;
  // …un descuento lo autoriza con su PROPIA clave (queda anotado quién) o con la de un supervisor; la clave de otra persona que no es supervisora no sirve
  const ajena = await api(caja.url, '/api/venta/descuento', { cart: c2, linea_id: l2.linea_id, tipo: 'pct', valor: 10, clave: '4321' });
  assert.equal(ajena.status >= 400, true, 'la clave de otra cajera no autoriza');
  const propia = await api(caja.url, '/api/venta/descuento', { cart: c2, linea_id: l2.linea_id, tipo: 'pct', valor: 10, clave: '9753' });
  assert.equal(propia.status, 200, JSON.stringify(propia.json));
  assert.equal(propia.json.supervisor, 'Mario');
  const bueno = await api(caja.url, '/api/venta/descuento', { cart: c2, linea_id: l2.linea_id, tipo: 'pct', valor: 15, clave: '1357' });
  assert.equal(bueno.status, 200, JSON.stringify(bueno.json));
  assert.equal(bueno.json.supervisor, 'Evelin');
  const v2 = await api(caja.url, '/api/venta/cobrar-efectivo', { cart: c2, recibido: 100000 });
  assert.equal(v2.json.venta.cajero, 'Mario');
  // la lista «Supervisores que autorizan descuentos» no incluye a la almacenista
  const sups = (await api(adm.url, '/api/admin/supervisores')).json.supervisores.map((x: any) => x.nombre);
  assert.deepEqual(sups.sort(), ['Edgardo', 'Evelin']);
});
