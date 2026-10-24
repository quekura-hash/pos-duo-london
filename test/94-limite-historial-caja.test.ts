import assert from 'node:assert/strict';
import { it } from 'node:test';
import { api, appAdmin, appCajero } from './ayudas/app.ts';
import { ALMACENES, nuevoMundo, politica } from './ayudas/comun.ts';

const sqlite = ALMACENES.find((a) => a.nombre === 'sqlite')!;
const MASCADA = '7501234567890';
const DIA = 86400_000;

it('LH1 la caja solo consulta un día a la vez y los últimos 2 meses; Administración consulta sin límite', async (t) => {
  const ctx = nuevoMundo(sqlite, politica());
  const adm = await appAdmin(ctx);
  const caja = await appCajero(ctx, 'DUO', 1, 'Ana');
  t.after(async () => { await adm.cerrar(); await caja.cerrar(); ctx.limpiar(); });
  const vender = async () => {
    const cart = (await api(caja.url, '/api/venta/nueva', {})).json.cart;
    await api(caja.url, '/api/venta/escanear', { cart, codigo: MASCADA });
    return (await api(caja.url, '/api/venta/cobrar-efectivo', { cart, recibido: 100000 })).json.venta;
  };
  const vieja = await vender(); // 2026-10-01 (reloj de pruebas)
  const fechaVieja = (await api(caja.url, '/api/estado')).json.estado.fecha_local as string;
  ctx.m.reloj.avanzar(30 * DIA);
  const mediana = await vender(); // hace 30 días al final
  ctx.m.reloj.avanzar(40 * DIA); // ahora: la primera tiene 70 días y la segunda 40
  const reciente = await vender();
  const hoy = (await api(caja.url, '/api/estado')).json.estado.fecha_local as string;
  for (let i = 0; i < 4; i++) ctx.m.pump();

  // un día reciente: se ve
  assert.equal((await api(caja.url, `/api/ventas?fecha=${hoy}`)).status, 200);
  assert.equal((await api(caja.url, `/api/ventas?fecha=${hoy}`)).json.ventas.length, 1);
  // 40 días: dentro de los 2 meses
  const hace40 = new Date(Date.parse(hoy + 'T12:00:00Z') - 40 * DIA).toISOString().slice(0, 10);
  assert.equal((await api(caja.url, `/api/ventas?fecha=${hace40}`)).status, 200);
  // 70 días: la caja ya no lo consulta
  const viejaFecha = (await api(adm.url, `/api/admin/ventas?desde=2026-01-01&hasta=${hoy}`)).json.ventas.find((v: any) => v.sale_id === vieja.sale_id).fecha_local as string;
  assert.equal(viejaFecha, fechaVieja);
  const d = await api(caja.url, `/api/ventas?fecha=${viejaFecha}`);
  assert.equal(d.status >= 400, true);
  assert.equal(d.json.error.codigo, 'FUERA_DE_LIMITE');
  // buscar sin fecha, folio ni artículo = un listado por periodo: no se permite
  assert.equal((await api(caja.url, '/api/ventas/buscar')).status >= 400, true);
  // buscar por un día viejo: no
  assert.equal((await api(caja.url, `/api/ventas/buscar?fecha=${viejaFecha}`)).json.error.codigo, 'FUERA_DE_LIMITE');
  // por folio: lo reciente aparece; la venta de más de 2 meses no
  const fRec = await api(caja.url, `/api/ventas/buscar?folio=${reciente.folio}`);
  assert.deepEqual(fRec.json.resultados.map((v: any) => v.sale_id), [reciente.sale_id]);
  const fViejo = await api(caja.url, `/api/ventas/buscar?folio=${vieja.folio}`);
  assert.deepEqual(fViejo.json.resultados.map((v: any) => v.sale_id), []);
  // detalle, ticket, reimpresión, devolución y cambio de la venta vieja: no; de la de 40 días: sí
  assert.equal((await api(caja.url, `/api/ticket?sale_id=${vieja.sale_id}`)).json.error.codigo, 'FUERA_DE_LIMITE');
  assert.equal((await api(caja.url, '/api/venta/reimprimir', { sale_id: vieja.sale_id })).json.error.codigo, 'FUERA_DE_LIMITE');
  assert.equal((await api(caja.url, `/api/ticket?sale_id=${mediana.sale_id}`)).status, 200);
  const cart = (await api(caja.url, '/api/venta/nueva', {})).json.cart;
  const cam = await api(caja.url, '/api/venta/cambio/iniciar', { cart, sale_id: vieja.sale_id, renglones: [{ linea_id: vieja.lineas[0].linea_id, qty: 1 }], clienta: { nombre: 'Ana López', telefono: '653 123 4567' }, motivo: 'x' });
  assert.equal(cam.json.error?.codigo, 'FUERA_DE_LIMITE');
  // Administración sigue viendo todo, sin límite de periodo ni de antigüedad
  const todas = (await api(adm.url, `/api/admin/ventas?desde=2026-01-01&hasta=${hoy}`)).json.ventas;
  assert.equal(todas.length, 3);
});
