import assert from 'node:assert/strict';
import { it } from 'node:test';
import { api, appAdmin, appCajero } from './ayudas/app.ts';
import { ALMACENES, nuevoMundo, politica } from './ayudas/comun.ts';

const sqlite = ALMACENES.find((a) => a.nombre === 'sqlite')!;
const fila = (fecha: string, folio: number, tipo: string, piezas: number, total: number, pago: string) => [null, fecha, null, folio, null, tipo, null, null, null, piezas, null, total, null, pago, null, null];
const HOJA: unknown[][] = [
  [null, '2026-09-30T00:00:00.000Z'], [], [], [], [], [null, 'Date', null, 'Receipt #', null, 'Receipt Type', null, 'Full Name', null, 'Qty Sold', null, 'Total', null, 'Payment', null, null],
  fila('13/09/2026', 1001, 'Sales', 2, 899, 'Cash'), fila('01/06/2026', 1002, 'Sales', 1, 549, 'Credit Card'),
];

it('CA1 las cajas reciben solo los últimos 60 días de ventas del POS anterior para consultar; el resto queda en Administración', async (t) => {
  const ctx = nuevoMundo(sqlite, politica());
  const adm = await appAdmin(ctx);
  const caja = await appCajero(ctx, 'DUO', 1, 'Ana');
  t.after(async () => { await adm.cerrar(); await caja.cerrar(); ctx.limpiar(); });
  const imp = await api(adm.url, '/api/admin/ventas-historicas/importar', { filas: HOJA, tienda: 'DUO', caja: 1, nombre: 'prueba.xlsx' });
  assert.equal(imp.status, 200, JSON.stringify(imp.json));
  for (let i = 0; i < 4; i++) ctx.m.pump();
  const r = (await api(caja.url, '/api/ventas/anteriores?folio=1001')).json.ventas;
  assert.deepEqual(r.map((v: any) => [v.folio, v.fecha, v.total, v.piezas, v.pago]), [[1001, '2026-09-13', 89900, 2, 'efectivo']]);
  assert.deepEqual((await api(caja.url, '/api/ventas/anteriores?folio=1002')).json.ventas, [], 'la de junio es de hace más de 2 meses: solo en Administración');
  // Administración sigue teniendo las dos y sus reportes no se duplican
  const todas = (await api(adm.url, '/api/admin/ventas?desde=2026-05-01&hasta=2026-10-31&origen=anterior')).json.ventas;
  assert.equal(todas.length, 2);
  // reimportar no duplica
  await api(adm.url, '/api/admin/ventas-historicas/importar', { filas: HOJA, tienda: 'DUO', caja: 1, nombre: 'prueba.xlsx' });
  for (let i = 0; i < 4; i++) ctx.m.pump();
  assert.equal((await api(caja.url, '/api/ventas/anteriores?folio=1001')).json.ventas.length, 1);
});
