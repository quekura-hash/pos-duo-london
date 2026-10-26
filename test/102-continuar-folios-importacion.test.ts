import assert from 'node:assert/strict';
import { it } from 'node:test';
import { folioMaximoConocido } from '../src/nodos.ts';
import { revisarReporteAnterior } from '../src/ventas-historicas.ts';
import { api, appAdmin, appCajero } from './ayudas/app.ts';
import { ALMACENES, nuevoMundo, politica } from './ayudas/comun.ts';

const sqlite = ALMACENES.find((a) => a.nombre === 'sqlite')!;
const fila = (fecha: string, folio: number, total: number) => [null, fecha, null, folio, null, 'Sales', null, 'X', null, 1, null, total, null, 'Cash', null, null];
const ENCABEZADO = [null, 'Date', null, 'Receipt #', null, 'Receipt Type', null, 'Full Name', null, 'Qty Sold', null, 'Total', null, 'Payment', null, null];
const HOJA: unknown[][] = [[null, '2026-09-30T00:00:00.000Z'], [], [], [], [], ENCABEZADO, fila('13/09/2026', 71001, 899), fila('14/09/2026', 71002, 549), fila('15/09/2026', 71010, 120)];

it('CF1 al importar las ventas viejas de una caja, sus folios nuevos continúan después del último folio del sistema anterior (solo si se pide)', async (t) => {
  const ctx = nuevoMundo(sqlite, politica());
  const adm = await appAdmin(ctx);
  const caja = await appCajero(ctx, 'DUO', 2, 'Laura');
  t.after(async () => { await adm.cerrar(); await caja.cerrar(); ctx.limpiar(); });
  assert.equal(revisarReporteAnterior(HOJA).errores.length, 0);
  // sin pedirlo no se toca el contador
  const sin = await api(adm.url, '/api/admin/ventas-historicas/importar', { filas: HOJA, tienda: 'DUO', caja: 2, nombre: 'a.xlsx' });
  assert.equal(sin.status, 200, JSON.stringify(sin.json));
  assert.equal(sin.json.siguiente_folio, 0);
  assert.equal(ctx.m.central.repo.ops().filter((o) => o.tipo === 'folio.continuacion').length, 0);
  // pidiéndolo: el siguiente folio es 71011
  const con = await api(adm.url, '/api/admin/ventas-historicas/importar', { filas: HOJA, tienda: 'DUO', caja: 2, nombre: 'a.xlsx', continuar_folios: true });
  assert.equal(con.status, 200, JSON.stringify(con.json));
  assert.deepEqual([con.json.folio_maximo, con.json.siguiente_folio, con.json.existentes], [71010, 71011, 3]);
  for (let i = 0; i < 4; i++) ctx.m.pump();
  const ops = ctx.m.central.repo.ops();
  assert.equal(ops.filter((o) => o.tipo === 'folio.continuacion').length, 1);
  assert.equal(folioMaximoConocido(ops, 'DUO', 2), 71010);
  assert.equal(folioMaximoConocido(ops, 'DUO', 1), 0, 'otra caja no se afecta');
  // la caja sube su contador y la siguiente venta sale con el 71011
  assert.equal(ctx.m.caja('DUO', 2).continuarFoliosDesde(folioMaximoConocido(ops, 'DUO', 2)), true);
  assert.equal((await api(caja.url, '/api/login', { usuario: 'Laura', clave: '' })).status >= 0, true);
  const c = (await api(caja.url, '/api/venta/nueva', {})).json.cart;
  await api(caja.url, '/api/venta/escanear', { cart: c, codigo: '0002026090782' });
  const v = await api(caja.url, '/api/venta/cobrar-efectivo', { cart: c, recibido: 100000 });
  assert.equal(v.json.venta.folio, 71011);
  // volver a importar el mismo archivo (o uno más viejo) no baja nada
  assert.equal(ctx.m.caja('DUO', 2).continuarFoliosDesde(100), false);
});
