import assert from 'node:assert/strict';
import { it } from 'node:test';
import { api, appAdmin, appCajero } from './ayudas/app.ts';
import { ALMACENES, nuevoMundo, politica } from './ayudas/comun.ts';

const sqlite = ALMACENES.find((a) => a.nombre === 'sqlite')!;
const JEANS = '0002026090782', MASCADA = '7501234567890';

it('CE1 un cambio ya aceptado (la prenda regresó, aún sin la nueva) se pone en espera, se atiende a otra clienta y se retoma para escoger la prenda nueva', async (t) => {
  const ctx = nuevoMundo(sqlite, politica());
  const adm = await appAdmin(ctx);
  const caja = await appCajero(ctx, 'DUO', 1, 'Ana');
  t.after(async () => { await adm.cerrar(); await caja.cerrar(); ctx.limpiar(); });
  // venta original de una mascada
  const c0 = (await api(caja.url, '/api/venta/nueva', {})).json.cart;
  await api(caja.url, '/api/venta/escanear', { cart: c0, codigo: MASCADA });
  const orig = (await api(caja.url, '/api/venta/cobrar-efectivo', { cart: c0, recibido: 100000 })).json.venta;
  // la clienta pide el cambio: se acepta (la prenda regresa) y todavía no hay prenda nueva
  const cart = (await api(caja.url, '/api/venta/nueva', {})).json.cart;
  const ini = await api(caja.url, '/api/venta/cambio/iniciar', { cart, sale_id: orig.sale_id, renglones: [{ linea_id: orig.lineas[0].linea_id, qty: 1 }], clienta: { nombre: 'Ana López', telefono: '653 123 4567' }, motivo: 'no le quedó' });
  assert.equal(ini.status, 200, JSON.stringify(ini.json));
  assert.equal(ini.json.carrito.lineas.length, 0);
  // a) se puede poner en espera
  const esp = await api(caja.url, '/api/venta/espera', { cart, nota: 'Ana López cambio' });
  assert.equal(esp.status, 200, JSON.stringify(esp.json));
  assert.equal(esp.json.espera.length, 1);
  assert.deepEqual([esp.json.espera[0].piezas, esp.json.espera[0].total, esp.json.espera[0].cambio_de_folio], [-1, -orig.total, orig.folio]);
  assert.match(esp.json.espera[0].articulos[0].descripcion, /cambio del folio/);
  // b) se atiende a otra clienta (la venta nueva en pantalla es otra) y no se pierde el cambio
  const otra = esp.json.cart;
  await api(caja.url, '/api/venta/escanear', { cart: otra, codigo: JEANS });
  const ret = await api(caja.url, '/api/venta/retomar', { cart, actual: otra });
  assert.equal(ret.status, 200, JSON.stringify(ret.json));
  assert.equal((await api(caja.url, '/api/venta/espera')).json.espera.length, 1, 'la venta de la otra clienta quedó en espera');
  // c) ya con el cambio en pantalla, la clienta escoge su prenda nueva y se cobra la diferencia
  assert.ok(ret.json.carrito.cambio, 'el cambio sigue en la venta retomada');
  await api(caja.url, '/api/venta/escanear', { cart, codigo: JEANS });
  const pago = await api(caja.url, '/api/venta/cobrar-efectivo', { cart, recibido: 100000 });
  assert.equal(pago.status, 200, JSON.stringify(pago.json));
  assert.ok(pago.json.venta.pagos.some((p: any) => p.metodo === 'credito_cambio' && p.folio_origen === orig.folio), 'la venta quedó ligada al cambio');
});

it('CE2 un cambio aceptado no se descarta como «vacío» al retomar otra venta', async (t) => {
  const ctx = nuevoMundo(sqlite, politica());
  const adm = await appAdmin(ctx);
  const caja = await appCajero(ctx, 'DUO', 1, 'Ana');
  t.after(async () => { await adm.cerrar(); await caja.cerrar(); ctx.limpiar(); });
  const c0 = (await api(caja.url, '/api/venta/nueva', {})).json.cart;
  await api(caja.url, '/api/venta/escanear', { cart: c0, codigo: MASCADA });
  const orig = (await api(caja.url, '/api/venta/cobrar-efectivo', { cart: c0, recibido: 100000 })).json.venta;
  // una venta en espera cualquiera
  const a = (await api(caja.url, '/api/venta/nueva', {})).json.cart;
  await api(caja.url, '/api/venta/escanear', { cart: a, codigo: JEANS });
  const e1 = await api(caja.url, '/api/venta/espera', { cart: a, nota: 'otra' });
  // el cambio se acepta en la venta nueva y, sin ponerla en espera, se retoma la otra: el cambio pasa a espera, no se pierde
  const cambio = e1.json.cart;
  await api(caja.url, '/api/venta/cambio/iniciar', { cart: cambio, sale_id: orig.sale_id, renglones: [{ linea_id: orig.lineas[0].linea_id, qty: 1 }], clienta: { nombre: 'Ana López', telefono: '653 123 4567' }, motivo: 'no le quedó' });
  const r = await api(caja.url, '/api/venta/retomar', { cart: a, actual: cambio });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  const lista = (await api(caja.url, '/api/venta/espera')).json.espera;
  assert.deepEqual(lista.map((v: any) => v.cambio_de_folio ?? null), [orig.folio]);
});
