import assert from 'node:assert/strict';
import { it } from 'node:test';
import { api, appAdmin, appCajero } from './ayudas/app.ts';
import { ALMACENES, nuevoMundo, politica } from './ayudas/comun.ts';

const sqlite = ALMACENES.find((a) => a.nombre === 'sqlite')!;

it('EP1 una promoción eliminada desaparece de Administración y de las cajas; se puede reutilizar su nombre y no existe la inexistente', async (t) => {
  const ctx = nuevoMundo(sqlite, politica());
  const adm = await appAdmin(ctx);
  const caja = await appCajero(ctx, 'DUO', 1, 'Ana');
  t.after(async () => { await adm.cerrar(); await caja.cerrar(); ctx.limpiar(); });
  const base = { activa: true, tiendas: ['DUO'], inicio: null, fin: null, tipo: 'cupon', codigo: 'V20', pct: 20, minimo: 0, usos_max: null };
  const a = (await api(adm.url, '/api/admin/promociones', { ...base, nombre: 'Veinte' })).json.guardada;
  await api(adm.url, '/api/admin/promociones', { ...base, nombre: 'Otra', codigo: 'OTRA' });
  for (let i = 0; i < 4; i++) ctx.m.pump();
  const e = await api(adm.url, '/api/admin/promociones/eliminar', { id: a.id });
  assert.equal(e.status, 200, JSON.stringify(e.json));
  assert.deepEqual(e.json.promociones.map((p: any) => p.nombre), ['Otra']);
  assert.deepEqual((await api(adm.url, '/api/admin/promociones')).json.promociones.map((p: any) => p.nombre), ['Otra']);
  assert.equal((await api(adm.url, '/api/admin/promociones/eliminar', { id: a.id })).status, 404, 'ya no existe');
  assert.equal((await api(adm.url, '/api/admin/promociones', { ...base, id: a.id, nombre: 'Veinte' })).status >= 400, true, 'no se puede editar una eliminada');
  // el código y el nombre quedan libres
  assert.equal((await api(adm.url, '/api/admin/promociones', { ...base, nombre: 'Veinte' })).status, 200);
});
