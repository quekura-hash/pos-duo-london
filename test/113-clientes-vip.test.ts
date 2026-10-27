import assert from 'node:assert/strict';
import { it } from 'node:test';
import { calcularDescuentos, ID_DESCUENTO_VIP, excluidoDelVip } from '../src/promociones.ts';
import { api, appAdmin, appCajero } from './ayudas/app.ts';
import { ALMACENES, nuevoMundo, politica } from './ayudas/comun.ts';

const sqlite = ALMACENES.find((a) => a.nombre === 'sqlite')!;
const linea = (id: string, marca: string, departamento: string, precio: number, qty = 1) => ({ linea_id: id, item_id: id, item_no: id, codigo: id, descripcion: id, marca, estilo: '', lote: '', departamento, qty, precio_unit: precio, descuento: 0, importe: precio * qty }) as any;

it('VIP1 el motor: el porcentaje del cliente en pesos enteros, las excepciones por marca o departamento y una sola gana (VIP o empleada)', () => {
  const vip = { id: 'vip-1', nombre: 'María López', pct: 15, marcas: ['victoria'], departamentos: ['noche'] };
  const lineas = [linea('a', 'LEVIS', 'CABALLERO', 89900), linea('b', "VICTORIA'S SECRET", 'LENCERIA', 50000), linea('c', 'X', 'Accesorios de noche', 30000), linea('d', 'EFENTUS', 'ACCESORIOS', 12000)];
  const r = calcularDescuentos(lineas, [], null, '2026-10-27', () => 0, 'DUO', null, vip);
  const por = Object.fromEntries(r.lineas.map((l) => [l.linea_id, l.descuento]));
  assert.deepEqual(por, { a: 13500, b: 0, c: 0, d: 1800 }); // 134.85 → $135; 18.00; las excepciones no llevan descuento
  assert.deepEqual(r.lineas[0]!.descuento_detalle![0], { tipo: 'vip', ref: 'vip-1', nombre: 'Descuento VIP 15%: María López', monto: 13500 });
  assert.equal(excluidoDelVip({ marca: "Victoria's Secret", departamento: 'X' }, vip), true);
  assert.equal(excluidoDelVip({ marca: 'Levis', departamento: 'Caballero' }, vip), false);
  // no se combina con el descuento de empleada: aplica el que da más
  const mayorVip = calcularDescuentos([linea('a', 'LEVIS', 'C', 100000)], [], null, '2026-10-27', () => 0, 'DUO', { pct: 15, pct_uniforme: 30 }, { ...vip, pct: 20, marcas: [], departamentos: [] });
  assert.deepEqual([mayorVip.lineas[0]!.descuento, mayorVip.lineas[0]!.descuento_detalle![0]!.tipo], [20000, 'vip']);
  const mayorEmp = calcularDescuentos([linea('a', 'LEVIS', 'C', 100000)], [], null, '2026-10-27', () => 0, 'DUO', { pct: 15, pct_uniforme: 30 }, { ...vip, pct: 10, marcas: [], departamentos: [] });
  assert.deepEqual([mayorEmp.lineas[0]!.descuento, mayorEmp.lineas[0]!.descuento_detalle![0]!.tipo], [15000, 'empleada']);
  assert.equal(ID_DESCUENTO_VIP, 'descuento-vip');
});

it('VIP2 de punta a punta: Administración da de alta al cliente y sus excepciones, la caja lo elige con la clave de quien cobra, el ticket y los reportes lo muestran', async (t) => {
  const ctx = nuevoMundo(sqlite, politica());
  const adm = await appAdmin(ctx);
  const caja = await appCajero(ctx, 'DUO', 1, 'Lupe');
  t.after(async () => { await adm.cerrar(); await caja.cerrar(); ctx.limpiar(); });
  assert.equal((await api(adm.url, '/api/admin/cajeros', { nombre: 'Lupe', clave: '4321' })).status, 200);
  // validaciones del alta
  assert.equal((await api(adm.url, '/api/admin/vip', { nombre: 'María', pct: 15 })).status >= 400, true, 'nombre completo');
  assert.equal((await api(adm.url, '/api/admin/vip', { nombre: 'María López', pct: 0 })).status >= 400, true, 'porcentaje de 1 a 100');
  assert.equal((await api(adm.url, '/api/admin/vip', { nombre: 'María López', pct: 15, telefono: '12' })).status >= 400, true, 'teléfono');
  const alta = await api(adm.url, '/api/admin/vip', { nombre: 'María López', telefono: '686 123 4567', pct: 15 });
  assert.equal(alta.status, 200, JSON.stringify(alta.json));
  const vip = alta.json.clientes[0];
  assert.deepEqual([vip.nombre, vip.telefono, vip.pct, vip.activo], ['María López', '6861234567', 15, true]);
  const ex = await api(adm.url, '/api/admin/vip/excepciones', { marcas: ['efentus'], departamentos: [] });
  assert.equal(ex.status, 200, JSON.stringify(ex.json));
  for (let i = 0; i < 4; i++) ctx.m.pump();
  assert.equal((await api(caja.url, '/api/login', { usuario: 'Lupe', clave: '4321' })).status, 200);
  // la caja ve la lista (sin teléfono) y elige
  const lista = (await api(caja.url, '/api/venta/vip')).json;
  assert.deepEqual(lista.vips, [{ id: vip.id, nombre: 'María López', pct: 15 }]);
  assert.equal(lista.pide_clave, true);
  const c = (await api(caja.url, '/api/venta/nueva', {})).json.cart;
  await api(caja.url, '/api/venta/escanear', { cart: c, codigo: '0002026090782' }); // jeans $899
  await api(caja.url, '/api/venta/escanear', { cart: c, codigo: '7501234567890' }); // mascada $120 (marca excluida)
  assert.equal((await api(caja.url, '/api/venta/vip', { cart: c, vip_id: vip.id, clave: '0000' })).status >= 400, true, 'pide la clave de quien cobra');
  const ok = await api(caja.url, '/api/venta/vip', { cart: c, vip_id: vip.id, clave: '4321' });
  assert.equal(ok.status, 200, JSON.stringify(ok.json));
  assert.deepEqual([ok.json.carrito.vip.nombre, ok.json.carrito.descuentos, ok.json.carrito.total], ['María López', 13500, 89900 + 12000 - 13500]);
  // cobra, el ticket lo dice y el reporte de descuentos lo registra
  const v = await api(caja.url, '/api/venta/cobrar-efectivo', { cart: c, recibido: 100000 });
  assert.equal(v.status, 200, JSON.stringify(v.json));
  assert.match(v.json.ticket_texto, /Cliente VIP: María López/);
  assert.equal(v.json.venta.vip.aplico, 'Lupe');
  for (let i = 0; i < 4; i++) ctx.m.pump();
  const rep = (await api(adm.url, '/api/admin/descuentos?desde=2026-10-01&hasta=2026-10-31')).json;
  assert.ok(JSON.stringify(rep).includes('Descuento VIP 15%'), JSON.stringify(rep).slice(0, 300));
  // quitar el VIP y desactivarlo: ya no se puede elegir
  const c2 = (await api(caja.url, '/api/venta/nueva', {})).json.cart;
  await api(caja.url, '/api/venta/escanear', { cart: c2, codigo: '0002026090782' });
  assert.equal((await api(caja.url, '/api/venta/vip', { cart: c2, vip_id: vip.id, clave: '4321' })).status, 200);
  assert.equal((await api(caja.url, '/api/venta/vip/quitar', { cart: c2 })).json.carrito.descuentos, 0);
  assert.equal((await api(adm.url, '/api/admin/vip', { id: vip.id, activo: false })).status, 200);
  for (let i = 0; i < 4; i++) ctx.m.pump();
  assert.deepEqual((await api(caja.url, '/api/venta/vip')).json.vips, []);
  assert.equal((await api(caja.url, '/api/venta/vip', { cart: c2, vip_id: vip.id, clave: '4321' })).status >= 400, true, 'un VIP desactivado no se elige');
});
