import assert from 'node:assert/strict';
import { it } from 'node:test';
import { api, appAdmin, appCajero } from './ayudas/app.ts';
import { ALMACENES, nuevoMundo, politica } from './ayudas/comun.ts';

const JEANS = '0002026090782'; // $899

it('TC1 el cobro con tarjeta se confirma sin número de autorización: queda como transacción confirmada por quien cobra, completo y mixto', async (t) => {
  const ctx = nuevoMundo(ALMACENES.find((a) => a.nombre === 'sqlite')!, politica());
  const adm = await appAdmin(ctx);
  const caja = await appCajero(ctx, 'DUO', 1, 'Lupe');
  t.after(async () => { await adm.cerrar(); await caja.cerrar(); ctx.limpiar(); });
  assert.equal((await api(adm.url, '/api/admin/cajeros', { nombre: 'Lupe', clave: '4321' })).status, 200);
  for (let i = 0; i < 4; i++) ctx.m.pump();
  assert.equal((await api(caja.url, '/api/login', { usuario: 'Lupe', clave: '4321' })).status, 200);
  const nueva = async () => { const c = (await api(caja.url, '/api/venta/nueva', {})).json.cart; await api(caja.url, '/api/venta/escanear', { cart: c, codigo: JEANS }); return c; };
  // completo, sin autorización
  const c1 = await nueva();
  const v1 = await api(caja.url, '/api/venta/cobrar-tarjeta', { cart: c1 });
  assert.equal(v1.status, 200, JSON.stringify(v1.json));
  const p1 = v1.json.venta.pagos[0];
  assert.deepEqual([p1.metodo, p1.monto, p1.confirmada, p1.autorizacion], ['tarjeta', 89900, true, undefined]);
  assert.doesNotMatch(v1.json.ticket_texto, /Aut\./);
  // mixto: $300 con tarjeta y el resto en efectivo
  const c2 = await nueva();
  const v2 = await api(caja.url, '/api/venta/cobrar-tarjeta', { cart: c2, importe: 30000 });
  assert.equal(v2.status, 200, JSON.stringify(v2.json));
  assert.deepEqual(v2.json.venta.pagos.map((p: any) => [p.metodo, p.monto]), [['tarjeta', 30000], ['efectivo', 59900]]);
  // si aun así se manda un número (cobros de antes), se valida y se conserva
  const c3 = await nueva();
  const v3 = await api(caja.url, '/api/venta/cobrar-tarjeta', { cart: c3, autorizacion: 'ab1234' });
  assert.equal(v3.json.venta.pagos[0].autorizacion, 'AB1234');
  const c4 = await nueva();
  assert.equal((await api(caja.url, '/api/venta/cobrar-tarjeta', { cart: c4, autorizacion: '12' })).status >= 400, true, 'un número mal escrito se rechaza');
  // el cierre cuenta la tarjeta como siempre
  const k = (await api(caja.url, '/api/corte')).json.vivo;
  assert.equal(k.cobros_tarjeta, 89900 + 30000 + 89900);
});
