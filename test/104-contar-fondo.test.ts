import assert from 'node:assert/strict';
import { it } from 'node:test';
import { api, appAdmin, appCajero } from './ayudas/app.ts';
import { ALMACENES, nuevoMundo, politica } from './ayudas/comun.ts';

const JEANS = '0002026090782'; // $899

it('CF1 contar el cajón a cualquier hora: espera fondo + efectivo, pide nota si no cuadra y la feria queda con lo contado', async (t) => {
  const ctx = nuevoMundo(ALMACENES.find((a) => a.nombre === 'sqlite')!, politica());
  const adm = await appAdmin(ctx);
  const caja = await appCajero(ctx, 'DUO', 1, 'Ana');
  t.after(async () => { await adm.cerrar(); await caja.cerrar(); ctx.limpiar(); });
  const fondo = { '100': 30, '200': 10, '500': 10, '1000': 5, '2000': 10, '5000': 8, '10000': 10, '20000': 5, '50000': 2, '100000': 2 };
  // sin fondo confirmado no hay con qué comparar
  const antes = await api(caja.url, '/api/arqueo', { denominaciones: fondo });
  assert.equal(antes.status >= 400, true);
  assert.equal(antes.json.error.codigo, 'FONDO_PENDIENTE');
  assert.equal((await api(caja.url, '/api/cierre/fondo', { denominaciones: fondo, nota: 'fondo de prueba' })).status, 200);
  const c = (await api(caja.url, '/api/venta/nueva', {})).json.cart;
  await api(caja.url, '/api/venta/escanear', { cart: c, codigo: JEANS });
  assert.equal((await api(caja.url, '/api/venta/cobrar-efectivo', { cart: c, recibido: 100000 })).status, 200); // cambio $101
  const est = (await api(caja.url, '/api/arqueo')).json;
  assert.equal(est.fondo, 575000);
  assert.equal(est.esperado, 575000 + 89900);
  // lo que de verdad hay: la feria estimada decía 9 de $100 y 29 de $1; faltan dos billetes de $100
  const real = { ...fondo, '100000': 3, '10000': 7, '100': 29 };
  const sin = await api(caja.url, '/api/arqueo', { denominaciones: real });
  assert.equal(sin.status >= 400, true);
  assert.equal(sin.json.error.codigo, 'ARQUEO_NO_COINCIDE');
  const ok = await api(caja.url, '/api/arqueo', { denominaciones: real, nota: 'cambié dos billetes de $100 con la tienda de junto' });
  assert.equal(ok.status, 200, JSON.stringify(ok.json));
  assert.equal(ok.json.arqueo.estado, 'faltante');
  assert.equal(ok.json.arqueo.diferencia, -20000);
  // la feria ya no es estimación: es lo contado
  const f = ok.json.estado.feria;
  assert.equal(f.estimado, false);
  assert.equal(f.inventario['10000'], 7);
  assert.equal(ok.json.estado.conteos.length, 1);
  // cuadra exacto sin nota
  const exacto = { ...fondo, '100000': 3, '10000': 9, '100': 29 };
  const cuadra = await api(caja.url, '/api/arqueo', { denominaciones: exacto });
  assert.equal(cuadra.status, 200, JSON.stringify(cuadra.json));
  assert.equal(cuadra.json.arqueo.estado, 'cuadra');
  // llega a Administración (feria) y queda en el corte vivo
  for (let i = 0; i < 4; i++) ctx.m.pump();
  const fa = (await api(adm.url, '/api/admin/feria?fecha=2026-10-01')).json.cajas.find((x: any) => x.tienda === 'DUO' && x.caja === 1);
  assert.equal(fa.estimado, false);
  assert.equal(fa.inventario['10000'], 9);
  assert.equal((await api(caja.url, '/api/corte')).json.vivo.arqueos.length, 2);
  // un conteo vacío o con denominaciones inválidas se rechaza
  assert.equal((await api(caja.url, '/api/arqueo', { denominaciones: {} })).status >= 400, true);
  assert.equal((await api(caja.url, '/api/arqueo', { denominaciones: { '7': 3 } })).status >= 400, true);
});

it('CF2 con Vendedoras-Cajeras registradas, contar el cajón exige la clave de quien lo hace', async (t) => {
  const ctx = nuevoMundo(ALMACENES.find((a) => a.nombre === 'sqlite')!, politica());
  const adm = await appAdmin(ctx);
  const caja = await appCajero(ctx, 'DUO', 1, 'Lupe');
  t.after(async () => { await adm.cerrar(); await caja.cerrar(); ctx.limpiar(); });
  assert.equal((await api(adm.url, '/api/admin/cajeros', { nombre: 'Lupe', clave: '4321' })).status, 200);
  for (let i = 0; i < 4; i++) ctx.m.pump();
  assert.equal((await api(caja.url, '/api/login', { usuario: 'Lupe', clave: '4321' })).status, 200);
  const fondo = { '100': 30, '200': 10, '500': 10, '1000': 5, '2000': 10, '5000': 8, '10000': 10, '20000': 5, '50000': 2, '100000': 2 };
  assert.equal((await api(caja.url, '/api/cierre/fondo', { denominaciones: fondo, nota: 'fondo de prueba' })).status, 200);
  assert.equal((await api(caja.url, '/api/arqueo')).json.pide_clave, true);
  const sinClave = await api(caja.url, '/api/arqueo', { denominaciones: fondo });
  assert.equal(sinClave.status >= 400, true);
  const mala = await api(caja.url, '/api/arqueo', { denominaciones: fondo, clave: '0000' });
  assert.equal(mala.status >= 400, true);
  assert.equal((await api(caja.url, '/api/arqueo', { denominaciones: fondo, clave: '4321' })).status, 200);
});
