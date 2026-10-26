import assert from 'node:assert/strict';
import { it } from 'node:test';
import { api, appAdmin, appCajero } from './ayudas/app.ts';
import { ALMACENES, nuevoMundo, politica } from './ayudas/comun.ts';

const sqlite = ALMACENES.find((a) => a.nombre === 'sqlite')!;
const JEANS = '0002026090782';

it('GC1 gasto de caja: recibo para firmar, resta del efectivo esperado del corte, sin duplicar y con la regla de «nadie más»', async (t) => {
  const ctx = nuevoMundo(sqlite, politica());
  const adm = await appAdmin(ctx);
  const caja = await appCajero(ctx, 'DUO', 2, 'Laura');
  t.after(async () => { await adm.cerrar(); await caja.cerrar(); ctx.limpiar(); });
  assert.equal((await api(adm.url, '/api/admin/administradores', { nombre: 'Edgardo', clave: 'clave-segura', clave_caja: '2468' })).status, 200);
  assert.equal((await api(adm.url, '/api/admin/cajeros', { nombre: 'Laura', clave: '4321' })).status, 200);
  for (let i = 0; i < 4; i++) ctx.m.pump();
  assert.equal((await api(caja.url, '/api/login', { usuario: 'Laura', clave: '4321' })).status, 200);
  const c = (await api(caja.url, '/api/venta/nueva', {})).json.cart;
  await api(caja.url, '/api/venta/escanear', { cart: c, codigo: JEANS });
  assert.equal((await api(caja.url, '/api/venta/cobrar-efectivo', { cart: c, recibido: 100000 })).status, 200);

  const g = { ref: 'g-1', monto: 15000, concepto: 'Pago de limpieza', recibio: 'Juan Pérez' };
  // sin autorización de otra persona no pasa; ella sola tampoco sin la casilla
  assert.equal((await api(caja.url, '/api/gasto', g)).status >= 400, true);
  assert.equal((await api(caja.url, '/api/gasto', { ...g, autoriza: { nombre: 'Laura', clave: '4321' } })).status >= 400, true);
  // un supervisor autoriza
  const ok = await api(caja.url, '/api/gasto', { ...g, autoriza: { nombre: 'Edgardo', clave: '2468' } });
  assert.equal(ok.status, 200, JSON.stringify(ok.json));
  assert.equal(ok.json.gasto.folio_gasto, 'D2-G0001');
  assert.match(ok.json.ticket_texto, /GASTO DE CAJA[\s\S]*RECIBO[\s\S]*Pago de limpieza[\s\S]*Juan Pérez[\s\S]*\$150\.00[\s\S]*Firma de quien recibe[\s\S]*Entrega \(Vendedora-Cajera\)[\s\S]*Autorizó: Edgardo/);
  // reintento con la misma referencia no se duplica
  await api(caja.url, '/api/gasto', { ...g, autoriza: { nombre: 'Edgardo', clave: '2468' } });
  const ex = (await api(caja.url, '/api/efectivo/extraordinarias')).json.operaciones.filter((o: any) => o.tipo === 'gasto');
  assert.equal(ex.length, 1);
  // «no hay nadie más»: quien cobra autoriza con su propia clave y queda anotado
  const sola = await api(caja.url, '/api/gasto', { ...g, ref: 'g-2', monto: 5000, autoriza: { nombre: 'Laura', clave: '4321', sin_segundo: true } });
  assert.equal(sola.status, 200, JSON.stringify(sola.json));
  assert.match(sola.json.ticket_texto, /Autorizó: Laura \(sin segunda persona\)/);
  // no puede gastar más de lo que hay en el cajón
  assert.equal((await api(caja.url, '/api/gasto', { ...g, ref: 'g-3', monto: 99999999, autoriza: { nombre: 'Edgardo', clave: '2468' } })).json.error.codigo, 'GASTO_EXCEDE_EFECTIVO');
  // el corte los resta y los muestra
  const corte = (await api(caja.url, '/api/corte')).json;
  assert.equal(JSON.stringify(corte).includes('"gastos":20000'), true, 'el corte suma los gastos: $200');
  // Administración los ve en el historial y en el resumen del día
  for (let i = 0; i < 4; i++) ctx.m.pump();
  const hoy = '2026-10-01';
  const h = (await api(adm.url, `/api/admin/ventas?desde=${hoy}&hasta=${hoy}`)).json;
  assert.equal(h.gastos.length, 2);
  assert.deepEqual(h.gastos.map((x: any) => x.monto).sort((a: number, b: number) => a - b), [5000, 15000]);
  const d = (await api(adm.url, `/api/admin/resumen-dia?fecha=${hoy}`)).json;
  assert.equal(d.total.gastos, 20000);
  // reimpresión
  const re = await api(caja.url, '/api/gasto/reimprimir', { gasto_id: 'g-1' });
  assert.match(re.json.ticket_texto, /REIMPRESIÓN 1/);
});
