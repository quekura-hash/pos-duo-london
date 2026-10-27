import assert from 'node:assert/strict';
import { it } from 'node:test';
import { api, appAdmin, appCajero } from './ayudas/app.ts';
import { ALMACENES, nuevoMundo, politica } from './ayudas/comun.ts';

const sqlite = ALMACENES.find((a) => a.nombre === 'sqlite')!;
const idDe = async (url: string, nombre: string) => ((await api(url, '/api/admin/administradores')).json.administradores as { id: string; nombre: string }[]).find((a) => a.nombre === nombre)!.id;
const ultimos = (ctx: any) => { const m = new Map<string, any>(); for (const o of ctx.m.central.repo.ops()) if (o.tipo === 'supervisor.guardado') m.set(o.payload.id, o.payload); return [...m.values()].filter((p) => !p.eliminado); };

it('DB1 la cuenta del dueño no se pierde: renombrarla o cambiar su perfil no le quita la marca, no se puede desactivar ni eliminar, y la clave corta no duplica su usuario', async (t) => {
  const ctx = nuevoMundo(sqlite, politica());
  const adm = await appAdmin(ctx);
  const caja = await appCajero(ctx, 'DUO', 1, 'Evelyn');
  t.after(async () => { await adm.cerrar(); await caja.cerrar(); ctx.limpiar(); });
  // el dueño, con clave de caja
  const alta = await api(adm.url, '/api/admin/administradores', { nombre: 'Edgardo', clave: 'clave-segura', clave_caja: '2468', perfil: { nombres: 'Edgardo', apellidos: 'Morales' } });
  assert.equal(alta.status, 200, JSON.stringify(alta.json));
  const id = await idDe(adm.url, 'Edgardo');
  assert.equal(ultimos(ctx).find((p) => p.id === `sup-${id.slice(4)}`)!.dueno, true);
  // le cambian el nombre (con emoji) y los datos de su perfil: la marca se conserva
  assert.equal((await api(adm.url, '/api/admin/administradores', { id, nombre: 'Edgardo 😎' })).status, 200);
  assert.equal((await api(adm.url, '/api/admin/administradores', { id, perfil: { nombres: 'E.', apellidos: 'M.' } })).status, 200);
  const sup = ultimos(ctx).find((p) => p.id === `sup-${id.slice(4)}`)!;
  assert.deepEqual([sup.nombre, sup.dueno], ['Edgardo 😎', true]);
  // no se puede desactivar ni eliminar, ni desde Administración ni desde la lista de supervisores de caja
  const des = await api(adm.url, '/api/admin/administradores', { id, activo: false });
  assert.equal(des.status >= 400, true, 'el dueño no se desactiva');
  assert.match(JSON.stringify(des.json), /dueño/);
  const del = await api(adm.url, '/api/admin/administradores/eliminar', { id });
  assert.equal(del.status >= 400, true, 'el dueño no se elimina');
  const delSup = await api(adm.url, '/api/admin/supervisores/eliminar', { id: `sup-${id.slice(4)}` });
  assert.equal(delSup.status >= 400, true, 'tampoco su registro de caja');
  const desSup = await api(adm.url, '/api/admin/supervisores', { id: `sup-${id.slice(4)}`, activo: false });
  assert.equal(desSup.status >= 400, true);
  assert.equal(ultimos(ctx).filter((p) => p.activo).length, 1);
  // otra cuenta (Evelyn) sí se puede desactivar: la protección es solo del dueño
  const ev = await api(adm.url, '/api/admin/administradores', { nombre: 'Evelyn', clave: 'clave-segura2', clave_caja: '1357', perfil: { nombres: 'Evelyn', apellidos: 'Quevedo' } });
  assert.equal(ev.status, 200, JSON.stringify(ev.json));
  assert.equal((await api(adm.url, '/api/admin/administradores', { id: await idDe(adm.url, 'Evelyn'), activo: false })).status, 200);
});

it('DB2 si le cambian el nombre con la sesión abierta, su clave corta se crea sobre SU usuario enlazado y no duplica nada', async (t) => {
  const ctx = nuevoMundo(sqlite, politica());
  const adm = await appAdmin(ctx);
  t.after(async () => { await adm.cerrar(); ctx.limpiar(); });
  // el dueño todavía sin clave de caja ni registro de supervisor
  const alta = await api(adm.url, '/api/admin/administradores', { nombre: 'Edgardo', clave: 'clave-segura', perfil: { nombres: 'Edgardo', apellidos: 'Morales' } });
  assert.equal(alta.status, 200, JSON.stringify(alta.json));
  const id = await idDe(adm.url, 'Edgardo');
  assert.equal((await api(adm.url, '/api/login', { usuario: 'Edgardo', clave: 'clave-segura' })).status, 200);
  assert.equal((await api(adm.url, '/api/admin/administradores', { id, nombre: 'Edgardo 😎' })).status, 200); // se renombra con la sesión abierta
  const clave = await api(adm.url, '/api/admin/expediente/clave', { clave: '2468' });
  assert.equal(clave.status, 200, JSON.stringify(clave.json));
  const lista = ultimos(ctx);
  assert.equal(lista.length, 1, 'un solo usuario de caja');
  assert.deepEqual([lista[0].id, lista[0].nombre, lista[0].dueno], [`sup-${id.slice(4)}`, 'Edgardo 😎', true]);
  // y puede abrir las fichas con esa clave
  assert.equal((await api(adm.url, '/api/admin/expediente/desbloquear', { clave: '2468' })).status, 200);
});
