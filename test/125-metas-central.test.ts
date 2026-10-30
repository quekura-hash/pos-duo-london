import assert from 'node:assert/strict';
import { test } from 'node:test';
import { iniciarCajaNube } from '../src/app/caja-nube.ts';
import { totalesPorDia, diaEquivalente } from '../src/metas.ts';
import type { Op } from '../src/tipos.ts';
import { crearOp, addDias, fechaLocal } from '../src/util.ts';
import { idVentaHistorica, payloadVentaHistorica, type VentaHistorica } from '../src/ventas-historicas.ts';
import { centralLocal, ClientePglite, usuario } from './ayudas/central-pglite.ts';
import { almacenMemoria, clienteDe, escenario, ESCANEAR } from './ayudas/escenario-central.ts';

const hist = (tienda: string, caja: number, folio: number, fecha: string, total: number, tipo: VentaHistorica['tipo'] = 'venta') =>
  crearOp('venta.historica', null, null, 'admin', '2026-10-01T15:00:00.000Z', payloadVentaHistorica({ folio, fecha, tipo, piezas: 1, total, pago: 'efectivo', pago_original: 'Cash' }, { tienda, caja, lote: 'L', por: 'E' }), idVentaHistorica(tienda, caja, folio));
const venta = (id: string, tienda: string, caja: number, iso: string, total: number) =>
  crearOp('sale.confirmed', tienda, caja, `caja:${tienda}/${caja}`, iso, { sale_id: id, tienda, caja, folio: 1, cajero: 'x', lineas: [], total, pagos: [] }, `sale:${id}`);

test('MC1 la función del central da exactamente los mismos totales por día que Administración: ventas no canceladas, importadas, sin copias descartadas; la caja solo ve su tienda', async () => {
  const db = await centralLocal();
  const edgardo = await usuario(db, 'edgardo@x.mx', 'supervisor');
  const cajaDuo = await usuario(db, 'caja-duo-1@x.mx', 'caja', true, { tienda: 'DUO', caja: 1 });
  const ops: Op[] = [
    hist('DUO', 1, 1, '2026-10-01', 10000), hist('DUO', 1, 2, '2026-10-02', 20000), hist('DUO', 2, 1, '2026-10-01', 10000), hist('DUO', 2, 2, '2026-10-02', 20000), hist('DUO', 2, 9, '2026-10-02', 5000, 'fee'),
    hist('LON', 1, 1, '2026-10-01', 7000),
    crearOp('historico.duplicados', null, null, 'admin', '2026-10-05T15:00:00.000Z', { tienda: 'DUO', caja: 2, igual_a_caja: 1 }, 'dup:DUO/2/1'),
    venta('a', 'DUO', 1, '2026-10-02T19:00:00.000Z', 30000), venta('b', 'DUO', 2, '2026-10-02T20:00:00.000Z', 15000), venta('c', 'DUO', 2, '2026-10-03T02:00:00.000Z', 99900), // 02Z del 3 = 19:00 del 2 en Hermosillo
    venta('x', 'LON', 1, '2026-10-02T19:00:00.000Z', 4000),
    crearOp('sale.cancelled', 'DUO', 2, 'caja:DUO/2', '2026-10-02T21:00:00.000Z', { sale_id: 'c' }, 'cancel:c'),
  ];
  await new ClientePglite(db, edgardo).subirOps(ops);
  const esperado = (t: string) => Object.fromEntries([...totalesPorDia(ops, t)].sort());
  const delCentral = async (uid: string) => (await new ClientePglite(db, uid).ventasPorDia('2026-10-01', '2026-10-31'));
  const adm = await delCentral(edgardo);
  const porTienda = (t: string) => Object.fromEntries(adm.filter((f) => f.tienda === t).map((f) => [f.fecha, f.total]).sort());
  assert.deepEqual(porTienda('DUO'), esperado('DUO'));
  assert.deepEqual(porTienda('LON'), esperado('LON'));
  assert.equal(porTienda('DUO')['2026-10-02'], 20000 + 5000 + 30000 + 15000, 'importadas (la copia de la caja 2 no cuenta; la «fee» propia de la caja 2 sí) + ventas no canceladas');
  const caja = await delCentral(cajaDuo);
  assert.ok(caja.every((f) => f.tienda === 'DUO'), 'una caja solo ve su tienda');
  assert.deepEqual(Object.fromEntries(caja.map((f) => [f.fecha, f.total]).sort()), esperado('DUO'));
  assert.deepEqual((await new ClientePglite(db, edgardo).ventasPorDia('2026-10-03', '2026-10-31')), [], 'respeta el rango de fechas');
  await assert.rejects(new ClientePglite(db, '00000000-0000-0000-0000-000000000000').ventasPorDia('2026-10-01', '2026-10-31'), /sin permiso/);
});

test('MC2 dos cajas en equipos distintos y Administración marcan EXACTAMENTE lo mismo en la barra de metas (día, semana y mes), con ventas importadas y ventas nuevas', async () => {
  const { db, cuentas, admin } = await escenario();
  (cuentas as Record<string, unknown>)['caja-duo-2@x.mx'] = { id: await usuario(db, 'caja-duo-2@x.mx', 'caja', true, { tienda: 'DUO', caja: 2 }), rol: 'caja', alias: 'caja-duo-2', tienda: 'DUO', caja: 2 };
  const hoy = fechaLocal(new Date().toISOString());
  const dias = Array.from({ length: 31 }, (_, i) => `${hoy.slice(0, 7)}-${String(i + 1).padStart(2, '0')}`).filter((d) => d.slice(0, 7) === hoy.slice(0, 7));
  const filas: Op[] = []; let n = 1;
  for (const d of dias) filas.push(hist('DUO', 1, n++, diaEquivalente(d), 50000)); // el año pasado: de ahí sale la meta
  for (const d of dias.filter((x) => x < hoy)) { filas.push(hist('DUO', 1, n++, d, 20000)); filas.push(hist('DUO', 2, n - 1 + 5000, d, 7000)); } // lo importado de este mes (las dos cajas)
  admin.agregarOps(filas);
  await admin.sincronizar();
  await admin.atender('POST', '/api/admin/metas', { tiendas: { DUO: { incremento_pct: 5 } } });
  await admin.sincronizar();
  const c1 = iniciarCajaNube({ cliente: clienteDe(db, cuentas), almacen: almacenMemoria() });
  const c2 = iniciarCajaNube({ cliente: clienteDe(db, cuentas), almacen: almacenMemoria() });
  await c1.entrar('caja-duo-1@x.mx', 'buena');
  await c2.entrar('caja-duo-2@x.mx', 'buena');
  for (const c of [c1, c2]) await c.atender('POST', '/api/login', { usuario: 'Ana', clave: '1234' });
  const cobrar = async (c: typeof c1) => {
    const { cart } = (await c.atender('POST', '/api/venta/nueva', {})).json as { cart: unknown };
    await c.atender('POST', '/api/venta/escanear', { cart, codigo: ESCANEAR });
    await c.atender('POST', '/api/venta/cobrar-efectivo', { cart, recibido: 50000 });
  };
  await cobrar(c1); await cobrar(c2); await cobrar(c2);
  for (const c of [c2, c2, c1, c1, c2, c1]) await c.sincronizar(); // cada caja sube lo suyo y luego baja lo de la otra
  await admin.sincronizar();
  const reporte = (await admin.atender('GET', '/api/admin/metas', undefined)).json as { tiendas: { tienda: string; periodos: Record<string, { pct: number } | null> }[] };
  const adm = reporte.tiendas.find((x) => x.tienda === 'DUO')!.periodos;
  const de = (c: typeof c1) => c.mundo!.caja('DUO', c.estado().caja!).metasAvance()!;
  for (const p of ['dia', 'semana', 'mes'] as const) {
    assert.equal(de(c1)[p]!.pct, Math.round(adm[p]!.pct), `caja 1 = Administración (${p})`);
    assert.equal(de(c2)[p]!.pct, Math.round(adm[p]!.pct), `caja 2 = Administración (${p})`);
  }
  assert.ok(c1.mundo!.caja('DUO', 1).totalesCentral, 'la caja trajo los totales del central');
  // sin los totales del central (sin internet o función ausente) la barra sigue funcionando con el cálculo local
  c1.mundo!.caja('DUO', 1).totalesCentral = null;
  assert.ok(de(c1).mes!.pct > 0);
  c1.detener(); c2.detener();
  void addDias;
});
