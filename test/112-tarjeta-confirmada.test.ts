import assert from 'node:assert/strict';
import { it } from 'node:test';
import { api, appAdmin, appCajero } from './ayudas/app.ts';
import { ALMACENES, nuevoMundo, politica } from './ayudas/comun.ts';

const JEANS = '0002026090782'; // $899

it('TC1 el cobro con tarjeta exige los últimos 4 de la autorización de la terminal (completo y mixto)', async (t) => {
  const ctx = nuevoMundo(ALMACENES.find((a) => a.nombre === 'sqlite')!, politica());
  const adm = await appAdmin(ctx);
  const caja = await appCajero(ctx, 'DUO', 1, 'Lupe');
  t.after(async () => { await adm.cerrar(); await caja.cerrar(); ctx.limpiar(); });
  assert.equal((await api(adm.url, '/api/admin/cajeros', { nombre: 'Lupe', clave: '4321' })).status, 200);
  for (let i = 0; i < 4; i++) ctx.m.pump();
  assert.equal((await api(caja.url, '/api/login', { usuario: 'Lupe', clave: '4321' })).status, 200);
  const nueva = async () => { const c = (await api(caja.url, '/api/venta/nueva', {})).json.cart; await api(caja.url, '/api/venta/escanear', { cart: c, codigo: JEANS }); return c; };
  // sin los últimos 4 de la autorización NO se confirma el cobro (así nadie confirma «a lo baboso»)
  const c0 = await nueva();
  const sin = await api(caja.url, '/api/venta/cobrar-tarjeta', { cart: c0 });
  assert.equal(sin.status >= 400, true);
  assert.equal(sin.json.error?.codigo ?? sin.json.codigo, 'AUTORIZACION_REQUERIDA_TARJETA');
  assert.equal((await api(caja.url, '/api/venta/cobrar-tarjeta', { cart: c0, autorizacion: '12' })).status >= 400, true, 'un número mal escrito se rechaza');
  assert.equal(caja.s.svc.caja.opsVentas().filter((o) => o.tipo === 'sale.confirmed').length, 0, 'no se registró ninguna venta');
  // completo, con la autorización
  const v1 = await api(caja.url, '/api/venta/cobrar-tarjeta', { cart: c0, autorizacion: '9f31' });
  assert.equal(v1.status, 200, JSON.stringify(v1.json));
  const p1 = v1.json.venta.pagos[0];
  assert.deepEqual([p1.metodo, p1.monto, p1.autorizacion], ['tarjeta', 89900, '9F31']);
  // mixto: $300 con tarjeta y el resto en efectivo
  const c2 = await nueva();
  const v2 = await api(caja.url, '/api/venta/cobrar-tarjeta', { cart: c2, importe: 30000, autorizacion: 'A123' });
  assert.equal(v2.status, 200, JSON.stringify(v2.json));
  assert.deepEqual(v2.json.venta.pagos.map((p: any) => [p.metodo, p.monto]), [['tarjeta', 30000], ['efectivo', 59900]]);
  const c3 = await nueva();
  const v3 = await api(caja.url, '/api/venta/cobrar-tarjeta', { cart: c3, autorizacion: 'ab1234' });
  assert.equal(v3.json.venta.pagos[0].autorizacion, 'AB1234');
  // el cierre cuenta la tarjeta como siempre
  const k = (await api(caja.url, '/api/corte')).json.vivo;
  assert.equal(k.cobros_tarjeta, 89900 + 30000 + 89900);
});
