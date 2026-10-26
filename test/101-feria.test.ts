import assert from 'node:assert/strict';
import { it } from 'node:test';
import { desglosarCambio, desglosarRecibido, estimarFeria, estadoDe } from '../src/feria.ts';
import type { Op } from '../src/tipos.ts';

it('FE1 el cambio y lo recibido se reparten en el menor número de piezas', () => {
  assert.deepEqual(desglosarCambio(34900), { '20000': 1, '10000': 1, '2000': 2, '500': 1, '200': 2 }); // 349 = 200 + 100 + 2×20 + 5 + 2×2
  assert.deepEqual(desglosarRecibido(250000), { '100000': 2, '50000': 1 }); // 2,500 = 2×1,000 + 500
  assert.deepEqual(desglosarCambio(0), {});
});

it('FE2 estado: bajo con una denominación agotada o por debajo del mínimo; crítico con dos agotadas', () => {
  const lleno = { '20000': 5, '10000': 10, '5000': 11, '2000': 25, '1000': 40, '500': 50, '200': 100, '100': 100 };
  assert.equal(estadoDe(lleno).estado, 'bien');
  assert.equal(estadoDe({ ...lleno, '2000': 3 }).estado, 'bajo');
  assert.deepEqual(estadoDe({ ...lleno, '500': 0 }), { estado: 'bajo', agotadas: [500], bajas: [] });
  assert.equal(estadoDe({ ...lleno, '2000': 0, '500': 0 }).estado, 'critico');
});

const op = (tipo: string, ocurrio_en: string, payload: any): Op => ({ op_id: `${tipo}-${ocurrio_en}`, tipo, ocurrio_en, payload } as unknown as Op);
it('FE3 recorre el día: fondo, ventas con cambio estimado, retiro exacto y conteo que confirma', () => {
  const fondo = { '100': 5, '200': 5, '500': 5, '1000': 5, '2000': 5, '5000': 5, '10000': 5, '20000': 5, '50000': 2, '100000': 2 };
  const ops: Op[] = [
    op('cash.fondo', '2026-10-25T16:00:00.000Z', { tienda: 'DUO', caja: 1, fecha: '2026-10-25', denominaciones: fondo, total: 0 }),
    // venta de $651 pagada con $1,000: cambio $349
    op('sale.confirmed', '2026-10-25T17:00:00.000Z', { tienda: 'DUO', caja: 1, sale_id: 's1', folio: 1, pagos: [{ metodo: 'efectivo', monto: 65100, recibido: 100000, cambio: 34900 }] }),
  ];
  let r = estimarFeria(ops, 'DUO', 1, '2026-10-25');
  assert.equal(r.estimado, true);
  assert.deepEqual([r.inventario['100000'], r.inventario['20000'], r.inventario['10000'], r.inventario['2000'], r.inventario['500'], r.inventario['200']], [3, 4, 4, 3, 4, 3]);
  assert.equal(r.estado, 'bajo'); // quedan 3 de $20 (mínimo 6)
  assert.equal(r.eventos.length, 2);
  // retiro con billetes exactos
  ops.push(op('cash.retiro', '2026-10-25T18:00:00.000Z', { tienda: 'DUO', caja: 1, fecha: '2026-10-25', folio_retiro: 'D1-R0001', mxn: { denominaciones: { '100000': 2 }, total: 200000 } }));
  r = estimarFeria(ops, 'DUO', 1, '2026-10-25');
  assert.equal(r.inventario['100000'], 1);
  // el conteo del cierre confirma billete por billete: ya no es estimación
  ops.push(op('cash.conteo', '2026-10-25T23:00:00.000Z', { tienda: 'DUO', caja: 1, fecha: '2026-10-25', moneda: 'MXN', alcance: 'ventas', denominaciones: { '2000': 10, '100': 20 }, total: 0 }));
  r = estimarFeria(ops, 'DUO', 1, '2026-10-25');
  assert.equal(r.estimado, false);
  assert.deepEqual([r.inventario['2000'], r.inventario['100']], [15, 25]); // fondo + lo contado
  // otra caja o sin fondo: sin dato
  assert.equal(estimarFeria(ops, 'DUO', 2, '2026-10-25').estado, 'sin_dato');
});

import { api, appAdmin, appCajero } from './ayudas/app.ts';
import { ALMACENES, nuevoMundo, politica } from './ayudas/comun.ts';

it('FE4 en la caja: el cambio de cada venta baja la feria, avisa una sola vez al empeorar y Administración la ve', async (t) => {
  const ctx = nuevoMundo(ALMACENES.find((a) => a.nombre === 'sqlite')!, politica());
  const adm = await appAdmin(ctx);
  const caja = await appCajero(ctx, 'DUO', 1, 'Ana');
  t.after(async () => { await adm.cerrar(); await caja.cerrar(); ctx.limpiar(); });
  // fondo con poca feria: 7 de $20 (mínimo 6) y lo demás suficiente
  const fondo = { '100': 20, '200': 20, '500': 20, '1000': 20, '2000': 7, '5000': 10, '10000': 10, '20000': 10, '50000': 2, '100000': 2 };
  assert.equal((await api(caja.url, '/api/cierre/fondo', { denominaciones: fondo, nota: 'fondo de prueba con poca feria' })).status, 200);
  const JEANS = '0002026090782'; // $899: paga con $1,000 → cambio $101 (1 de $100, 1 de $1)
  const vender = async () => { const c = (await api(caja.url, '/api/venta/nueva', {})).json.cart; await api(caja.url, '/api/venta/escanear', { cart: c, codigo: JEANS }); return api(caja.url, '/api/venta/cobrar-efectivo', { cart: c, recibido: 100000 }); };
  assert.equal((await vender()).status, 200);
  for (let i = 0; i < 4; i++) ctx.m.pump();
  let f = (await api(adm.url, '/api/admin/feria?fecha=2026-10-01')).json.cajas.find((c: any) => c.tienda === 'DUO' && c.caja === 1);
  assert.equal(f.estimado, true, JSON.stringify({ e: f.estado, ev: f.eventos.map((x: any) => x.tipo) }));
  assert.equal(f.inventario['10000'], 9); // $100 de cambio
  assert.equal(f.inventario['100'], 19);  // $1 de cambio
  const alertas = () => ctx.m.caja('DUO', 1).opsDe('caja.alerta_feria');
  assert.equal(alertas().length, 0, 'con feria suficiente no avisa');
  // se agotan los billetes de $100 poco a poco: cada venta da uno
  for (let i = 0; i < 12; i++) await vender();
  for (let i = 0; i < 4; i++) ctx.m.pump();
  f = (await api(adm.url, '/api/admin/feria?fecha=2026-10-01')).json.cajas.find((c: any) => c.tienda === 'DUO' && c.caja === 1);
  assert.equal(f.inventario['10000'], 0);
  assert.equal(f.estado, 'bajo'); // sólo una agotada
  assert.equal(alertas().length, 1, 'avisa una sola vez al pasar a «bajo»');
  assert.equal(alertas()[0]!.payload.estado, 'bajo');
});
