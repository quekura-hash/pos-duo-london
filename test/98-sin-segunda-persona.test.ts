import assert from 'node:assert/strict';
import { it } from 'node:test';
import { api, appAdmin, appCajero } from './ayudas/app.ts';
import { ALMACENES, nuevoMundo, politica } from './ayudas/comun.ts';

const sqlite = ALMACENES.find((a) => a.nombre === 'sqlite')!;
const JEANS = '0002026090782';

it('SS1 si no hay nadie más, quien cobra autoriza con su propia clave (cancelar, cambiar precio, entrada de efectivo) y queda anotado', async (t) => {
  const ctx = nuevoMundo(sqlite, politica());
  const adm = await appAdmin(ctx);
  const caja = await appCajero(ctx, 'DUO', 1, 'Lupe');
  t.after(async () => { await adm.cerrar(); await caja.cerrar(); ctx.limpiar(); });
  assert.equal((await api(adm.url, '/api/admin/administradores', { nombre: 'Edgardo', clave: 'clave-segura', clave_caja: '2468' })).status, 200);
  assert.equal((await api(adm.url, '/api/admin/cajeros', { nombre: 'Lupe', clave: '4321' })).status, 200);
  for (let i = 0; i < 4; i++) ctx.m.pump();
  assert.equal((await api(caja.url, '/api/login', { usuario: 'Lupe', clave: '4321' })).status, 200);

  // cancelar una venta cobrada: sin la casilla, no puede autorizarse a sí misma
  const c1 = (await api(caja.url, '/api/venta/nueva', {})).json.cart;
  await api(caja.url, '/api/venta/escanear', { cart: c1, codigo: JEANS });
  const v = await api(caja.url, '/api/venta/cobrar-efectivo', { cart: c1, recibido: 100000 });
  const sale = v.json.venta.sale_id;
  const propia = await api(caja.url, '/api/venta/cancelar', { sale_id: sale, motivo: 'prueba', clienta: { nombre: 'Marta', telefono: '6861234567' }, autoriza: { nombre: 'Lupe', clave: '4321' } });
  assert.equal(propia.status >= 400, true, 'sin «no hay nadie más» no se autoriza a sí misma');
  const mala = await api(caja.url, '/api/venta/cancelar', { sale_id: sale, motivo: 'prueba', clienta: { nombre: 'Marta', telefono: '6861234567' }, autoriza: { nombre: 'Lupe', clave: '0000', sin_segundo: true } });
  assert.equal(mala.status >= 400, true, 'la clave propia debe ser correcta');
  const ok = await api(caja.url, '/api/venta/cancelar', { sale_id: sale, motivo: 'prueba', clienta: { nombre: 'Marta', telefono: '6861234567' }, autoriza: { nombre: 'Lupe', clave: '4321', sin_segundo: true } });
  assert.equal(ok.status, 200, JSON.stringify(ok.json));
  assert.match(JSON.stringify(ok.json), /Lupe \(sin segunda persona\)/);

  // cambiar un precio en la venta: supervisor, o «supervisor ausente» con la clave propia
  const c2 = (await api(caja.url, '/api/venta/nueva', {})).json.cart;
  const l2 = (await api(caja.url, '/api/venta/escanear', { cart: c2, codigo: JEANS })).json.linea;
  const sin = await api(caja.url, '/api/venta/editar-linea', { cart: c2, linea_id: l2.linea_id, precio_unit: 50000, clave: '4321' });
  assert.equal(sin.status >= 400, true, 'la clave de una cajera no basta sin la casilla');
  const con = await api(caja.url, '/api/venta/editar-linea', { cart: c2, linea_id: l2.linea_id, precio_unit: 50000, clave: '4321', sin_supervisor: true });
  assert.equal(con.status, 200, JSON.stringify(con.json));
  const v2 = await api(caja.url, '/api/venta/cobrar-efectivo', { cart: c2, recibido: 100000 });
  assert.equal(v2.status, 200, JSON.stringify(v2.json));
  assert.match(JSON.stringify(v2.json), /Lupe \(supervisor ausente\)/);

  // entrada extraordinaria de efectivo
  const e1 = await api(caja.url, '/api/efectivo/entrada', { monto: 10000, motivo: 'cambio de la tienda de junto', ref: 'ent-1', clave: '4321' });
  assert.equal(e1.status >= 400, true);
  const e2 = await api(caja.url, '/api/efectivo/entrada', { monto: 10000, motivo: 'cambio de la tienda de junto', ref: 'ent-2', clave: '4321', sin_supervisor: true });
  assert.equal(e2.status, 200, JSON.stringify(e2.json));
});
