import assert from 'node:assert/strict';
import { test } from 'node:test';
import { MemoriaRepo } from '../src/repo.ts';
import { crearOp } from '../src/util.ts';
import { PuenteCentral, type ClienteCentral } from '../src/transporte/puente-central.ts';
import { ClienteSupabase } from '../src/transporte/cliente-supabase.ts';
import { centralLocal, ClientePglite, como, usuario } from './ayudas/central-pglite.ts';

const T0 = '2026-10-20T12:00:00.000Z';
const op = (tipo: string, n: number, extra: object = {}) => crearOp(tipo, 'DUO', null, 'admin', T0, { n, ...extra }, `${tipo}:${n}`);
const replica = (c: ClienteCentral) => { const repo = new MemoriaRepo(); return { repo, puente: new PuenteCentral(repo, c) }; };

test('CS1 migración real: dos réplicas convergen por el central, sin duplicar y con reintentos', async () => {
  const db = await centralLocal();
  const sup = await usuario(db, 'edgardo@x.mx', 'supervisor');
  const a = replica(new ClientePglite(db, sup));
  const b = replica(new ClientePglite(db, sup));
  a.repo.appendOp(op('promo.guardada', 1));
  a.repo.appendOp(op('item.created', 2));
  assert.equal(a.puente.pendientes(), 2);
  assert.deepEqual(await a.puente.sincronizar(), { ok: true, subidas: 2, bajadas: 0 });
  assert.equal(a.puente.pendientes(), 0);
  // B baja lo de A, agrega lo suyo; A lo recibe sin volver a subirlo.
  const rb = await b.puente.sincronizar();
  assert.equal(rb.bajadas, 2);
  b.repo.appendOp(op('depto.alta', 3));
  assert.equal((await b.puente.sincronizar()).subidas, 1);
  const ra = await a.puente.sincronizar();
  assert.deepEqual([ra.subidas, ra.bajadas], [0, 1]);
  assert.deepEqual(a.repo.ops().map((o) => o.op_id).sort(), b.repo.ops().map((o) => o.op_id).sort());
  // Idempotente: reenviar lo mismo no duplica en el central.
  const cli = new ClientePglite(db, sup);
  assert.equal((await cli.subirOps([op('promo.guardada', 1)])).nuevas, 0);
  const [{ n }] = (await como(db, sup, (q) => q('select count(*)::int as n from pos.ops'))) as { n: number }[];
  assert.equal(n, 3);
  // Nada que hacer: ciclo vacío.
  assert.deepEqual(await a.puente.sincronizar(), { ok: true, subidas: 0, bajadas: 0 });
});

test('CS2 una caída a mitad no pierde ni duplica: el siguiente ciclo continúa', async () => {
  const db = await centralLocal();
  const sup = await usuario(db, 'edgardo@x.mx', 'supervisor');
  const real = new ClientePglite(db, sup);
  let caido = true;
  const inestable: ClienteCentral = { subirOps: (o) => (caido ? Promise.reject(new Error('sin internet')) : real.subirOps(o)), bajarOps: (d, l) => real.bajarOps(d, l) };
  const a = replica(inestable);
  a.repo.appendOp(op('promo.guardada', 1));
  const r1 = await a.puente.sincronizar();
  assert.equal(r1.ok, false);
  assert.equal(a.puente.pendientes(), 1); // sigue pendiente
  caido = false;
  assert.deepEqual(await a.puente.sincronizar(), { ok: true, subidas: 1, bajadas: 0 });
  assert.equal(a.puente.pendientes(), 0);
});

test('CS3 seguridad: el almacenista solo mueve inventario; anónimos y desconocidos, nada', async () => {
  const db = await centralLocal();
  const sup = await usuario(db, 'edgardo@x.mx', 'supervisor');
  const alm = await usuario(db, 'almacen@x.mx', 'almacenista');
  const baja = await usuario(db, 'baja@x.mx', 'supervisor', false);
  const nadie = await usuario(db, 'nadie@x.mx');
  const cSup = new ClientePglite(db, sup);
  await cSup.subirOps([op('promo.guardada', 1), op('item.created', 2), op('alm.recibida', 3)]);
  // El almacenista ve solo inventario/almacén…
  const vistas = (await new ClientePglite(db, alm).bajarOps(0, 100)).map((f) => f.tipo).sort();
  assert.deepEqual(vistas, ['alm.recibida', 'item.created']);
  // …puede subir de inventario, pero no una promoción (se rechaza todo el lote).
  const cAlm = new ClientePglite(db, alm);
  assert.equal((await cAlm.subirOps([op('item.created', 4)])).nuevas, 1);
  await assert.rejects(cAlm.subirOps([op('item.created', 5), op('promo.guardada', 6)]), /no permitido/);
  const [{ n }] = (await como(db, sup, (q) => q(`select count(*)::int as n from pos.ops where op_id in ('item.created:5','promo.guardada:6')`))) as { n: number }[];
  assert.equal(n, 0); // el lote rechazado no dejó nada a medias
  // Sin rol, dado de baja o anónimo: sin permiso y sin lectura.
  for (const uid of [nadie, baja]) {
    await assert.rejects(new ClientePglite(db, uid).subirOps([op('item.created', 7)]), /sin permiso/);
    assert.deepEqual(await new ClientePglite(db, uid).bajarOps(0, 10), []);
  }
  await assert.rejects(como(db, null, (q) => q('select * from pos.ops')), /permission denied/);
  await assert.rejects(como(db, null, (q) => q(`select pos.subir_ops('[]'::jsonb)`)), /permission denied/);
  // Nadie escribe ni borra la bitácora por fuera de la función, ni siquiera el supervisor.
  await assert.rejects(como(db, sup, (q) => q(`insert into pos.ops (op_id, tipo, origen, ocurrio_en, payload) values ('x', 'promo.guardada', 'x', now(), '{}')`)), /permission denied/);
  await assert.rejects(como(db, sup, (q) => q(`delete from pos.ops`)), /permission denied/);
  await assert.rejects(como(db, sup, (q) => q(`update pos.ops set tipo = 'otro'`)), /permission denied/);
  // El almacenista no ve administradores de otros ni versiones editables.
  assert.equal(((await como(db, alm, (q) => q('select * from pos.admins'))) as unknown[]).length, 1);
  await assert.rejects(como(db, alm, (q) => q(`insert into pos.versiones (componente, version) values ('admin_web', '9')`)), /permission denied|row-level security/);
});

test('CS4 Item #: el central entrega bloques consecutivos sin traslape', async () => {
  const db = await centralLocal();
  const sup = await usuario(db, 'edgardo@x.mx', 'supervisor');
  const alm = await usuario(db, 'almacen@x.mx', 'almacenista');
  const pedir = async (uid: string, k: number) => ((await como(db, uid, (q) => q('select pos.reservar_item_no($1) as r', [k]))) as { r: { desde: number; hasta: number } }[])[0]!.r;
  assert.deepEqual(await pedir(sup, 50), { desde: 1, hasta: 50 });
  assert.deepEqual(await pedir(alm, 10), { desde: 51, hasta: 60 });
  await assert.rejects(pedir(sup, 0), /bloque inválido/);
});

test('CS5 solicitudes de autorización: solo un supervisor las ve y las resuelve, una sola vez', async () => {
  const db = await centralLocal();
  const sup = await usuario(db, 'edgardo@x.mx', 'supervisor');
  const alm = await usuario(db, 'almacen@x.mx', 'almacenista');
  await db.query(`insert into pos.solicitudes_autorizacion (tienda, caja, tipo, solicitado_por) values ('DUO', 1, 'descuento', 'Ana')`);
  assert.equal(((await como(db, alm, (q) => q('select * from pos.solicitudes_autorizacion'))) as unknown[]).length, 0);
  assert.equal(((await como(db, sup, (q) => q('select * from pos.solicitudes_autorizacion'))) as unknown[]).length, 1);
  const act = (uid: string, e: string) => como(db, uid, (q) => q(`update pos.solicitudes_autorizacion set estado = $1, resuelto_por = $2, resuelta_en = now() returning id`, [e, uid]));
  assert.equal((await act(alm, 'aprobada')).length, 0);
  assert.equal((await act(sup, 'aprobada')).length, 1);
  assert.equal((await act(sup, 'rechazada')).length, 0); // ya resuelta: no se reabre
});

test('CS6 cliente de Supabase: inicia sesión, usa solo la llave pública y renueva el token', async () => {
  const llamadas: { url: string; headers: Record<string, string>; cuerpo: unknown }[] = [];
  let n = 0;
  const falso = (async (url: string, init: { headers: Record<string, string>; body: string }) => {
    llamadas.push({ url, headers: init.headers, cuerpo: JSON.parse(init.body) });
    const json = (o: unknown, status = 200) => ({ ok: status < 400, status, json: async () => o });
    if (url.includes('/auth/v1/token')) return json({ access_token: `at${++n}`, refresh_token: `rt${n}`, expires_in: n === 1 ? 0 : 3600 });
    if (url.endsWith('/rpc/subir_ops')) return json({ nuevas: 1, ultimo_seq: 7 });
    if (url.endsWith('/rpc/bajar_ops')) return json([]);
    return json({ message: 'nope' }, 400);
  }) as unknown as typeof fetch;
  const c = new ClienteSupabase('https://abc.supabase.co/', 'ANON', falso);
  await assert.rejects(c.subirOps([]), /Sin sesión/);
  await c.iniciarSesion('edgardo@x.mx', 'secreta');
  assert.equal(llamadas[0]!.url, 'https://abc.supabase.co/auth/v1/token?grant_type=password');
  assert.equal(llamadas[0]!.headers.apikey, 'ANON');
  assert.deepEqual(await c.subirOps([op('item.created', 1)]), { nuevas: 1, ultimo_seq: 7 });
  // El primer token expiró al instante: se renovó con el refresh token antes de llamar, sin reenviar la contraseña.
  assert.equal(llamadas[1]!.url, 'https://abc.supabase.co/auth/v1/token?grant_type=refresh_token');
  assert.deepEqual(llamadas[1]!.cuerpo, { refresh_token: 'rt1' });
  const rpc = llamadas[2]!;
  assert.equal(rpc.url, 'https://abc.supabase.co/rest/v1/rpc/subir_ops');
  assert.equal(rpc.headers.Authorization, 'Bearer at2');
  assert.equal(rpc.headers['Content-Profile'], 'pos');
  assert.ok(!JSON.stringify(llamadas.slice(1)).includes('secreta'));
  assert.deepEqual(await c.bajarOps(0, 10), []);
  const mal = new ClienteSupabase('https://abc.supabase.co', 'ANON', (async () => ({ ok: false, status: 400, json: async () => ({}) })) as unknown as typeof fetch);
  await assert.rejects(mal.iniciarSesion('a@b.c', 'x'), /No se pudo iniciar sesión/);
});
