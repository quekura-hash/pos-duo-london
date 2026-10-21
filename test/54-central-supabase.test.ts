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

test('CS7 cajas: cada caja ve el catálogo y lo de su tienda, sube solo lo de su tienda y nunca toca lo de Administración', async () => {
  const db = await centralLocal();
  const sup = await usuario(db, 'edgardo@x.mx', 'supervisor');
  const duo1 = await usuario(db, 'caja-duo-1@x.mx', 'caja', true, { tienda: 'DUO', caja: 1 });
  const lon1 = await usuario(db, 'caja-lon-1@x.mx', 'caja', true, { tienda: 'LON', caja: 1 });
  const baja = await usuario(db, 'caja-baja@x.mx', 'caja', false, { tienda: 'DUO', caja: 2 });
  const venta = (n: number, tienda: string) => ({ ...crearOp('sale.confirmed', tienda, 1, `caja:${tienda}/1`, T0, { n }, `venta:${tienda}:${n}`) });
  await new ClientePglite(db, sup).subirOps([op('item.created', 1), op('promo.guardada', 2), op('admin.guardado', 3, { hash: 'secreto' }), op('cajero.guardado', 4), venta(1, 'DUO'), venta(1, 'LON'), op('config.negocio', 5)]);
  const cDuo = new ClientePglite(db, duo1);
  const vistas = (await cDuo.bajarOps(0, 100)).map((f) => f.tipo).sort();
  assert.deepEqual(vistas, ['cajero.guardado', 'config.negocio', 'item.created', 'promo.guardada', 'sale.confirmed'], 'catálogo y configuración + las ventas de SU tienda; nunca admin.guardado ni ventas de otra tienda');
  assert.ok(!(await cDuo.bajarOps(0, 100)).some((f) => f.tipo === 'admin.guardado' || f.op_id === 'venta:LON:1'));
  // Sube lo suyo: queda con origen de caja, aunque el lote traiga otro.
  assert.equal((await cDuo.subirOps([venta(2, 'DUO'), op('inv.movement', 9, { tienda: 'LIMBO' })])).nuevas, 2);
  const [{ origen }] = (await como(db, sup, (q) => q(`select origen from pos.ops where op_id = 'venta:DUO:2'`))) as { origen: string }[];
  assert.equal(origen, 'caja:DUO/1');
  // No sube operaciones de otra tienda ni de Administración (el lote completo se rechaza).
  await assert.rejects(cDuo.subirOps([venta(3, 'DUO'), venta(3, 'LON')]), /solo sube operaciones de su tienda/);
  for (const tipo of ['promo.guardada', 'admin.guardado', 'supervisor.guardado', 'permiso.asignado', 'config.sesion', 'item.editado', 'depto.alta']) {
    await assert.rejects(cDuo.subirOps([op(tipo, 50)]), /no permitido para una caja/, tipo);
  }
  assert.equal((await cDuo.subirOps([op('config.tipo_cambio', 60)])).nuevas, 1, 'el tipo de cambio sí lo puede fijar quien tiene el permiso en la caja');
  const [{ n }] = (await como(db, sup, (q) => q(`select count(*)::int as n from pos.ops where op_id in ('venta:DUO:3', 'venta:LON:3')`))) as { n: number }[];
  assert.equal(n, 0, 'un lote rechazado no deja nada a medias');
  // Otra tienda no ve las ventas de DÚO; una caja dada de baja no ve ni sube nada; ninguna caja lee otras cuentas ni dispositivos.
  assert.ok(!(await new ClientePglite(db, lon1).bajarOps(0, 100)).some((f) => f.op_id.startsWith('venta:DUO')));
  assert.deepEqual(await new ClientePglite(db, baja).bajarOps(0, 10), []);
  await assert.rejects(new ClientePglite(db, baja).subirOps([venta(9, 'DUO')]), /sin permiso/);
  assert.equal(((await como(db, duo1, (q) => q('select * from pos.admins'))) as unknown[]).length, 1);
  assert.equal(((await como(db, duo1, (q) => q(`update pos.admins set rol = 'supervisor' where user_id = $1 returning 1`, [duo1]))) as unknown[]).length, 0, 'una caja no puede subirse el rol');
  // Una caja no es «administrador de la web»: no usa la bitácora completa ni las versiones de edición.
  const [{ es }] = (await como(db, duo1, (q) => q('select pos.es_admin() as es'))) as { es: boolean }[];
  assert.equal(es, false);
  // Item #: la caja puede pedir un bloque.
  const [{ r }] = (await como(db, duo1, (q) => q('select pos.reservar_item_no(5) as r'))) as { r: { desde: number; hasta: number } }[];
  assert.deepEqual(r, { desde: 1, hasta: 5 });
});

test('CS8 almacén de actualizaciones: solo supervisor y publicador escriben ahí; el publicador no ve nada del negocio', async () => {
  const db = await centralLocal();
  const sup = await usuario(db, 'edgardo@x.mx', 'supervisor');
  const pub = await usuario(db, 'publicador@x.mx', 'publicador');
  const alm = await usuario(db, 'almacen@x.mx', 'almacenista');
  const caja = await usuario(db, 'caja@x.mx', 'caja', true, { tienda: 'DUO', caja: 1 });
  const baja = await usuario(db, 'viejo@x.mx', 'publicador', false);
  const [{ public: esPublico, file_size_limit: limite }] = (await db.query(`select public, file_size_limit from storage.buckets where id = 'actualizaciones'`)).rows as { public: boolean; file_size_limit: number | string }[];
  assert.deepEqual([esPublico, Number(limite)], [true, 314572800]);
  const subir = (uid: string, bucket: string, nombre: string) => como(db, uid, (q) => q(`insert into storage.objects (bucket_id, name) values ($1, $2) returning name`, [bucket, nombre]));
  await db.query(`insert into storage.buckets (id, name) values ('otro', 'otro')`);
  for (const uid of [sup, pub]) assert.equal((await subir(uid, 'actualizaciones', `Setup-${uid.slice(0, 4)}.exe`)).length, 1);
  for (const uid of [alm, caja, baja]) await assert.rejects(subir(uid, 'actualizaciones', 'malo.exe'), /row-level security/);
  await assert.rejects(subir(pub, 'otro', 'x.exe'), /row-level security/, 'el publicador solo escribe en el almacén de actualizaciones');
  // Reemplazar y borrar (upsert de una versión): permitido al publicador, no a los demás.
  assert.equal(((await como(db, pub, (q) => q(`update storage.objects set name = name where bucket_id = 'actualizaciones' returning 1`))) as unknown[]).length, 2);
  assert.equal(((await como(db, caja, (q) => q(`delete from storage.objects where bucket_id = 'actualizaciones' returning 1`))) as unknown[]).length, 0);
  assert.equal(((await como(db, pub, (q) => q(`delete from storage.objects where bucket_id = 'actualizaciones' returning 1`))) as unknown[]).length, 2);
  // Sin acceso a nada del negocio: ni la bitácora, ni subir operaciones, ni la lista de administradores, ni solicitudes.
  assert.deepEqual(await new ClientePglite(db, pub).bajarOps(0, 10), []);
  await assert.rejects(new ClientePglite(db, pub).subirOps([op('item.created', 1)]), /sin permiso/);
  assert.equal(((await como(db, pub, (q) => q('select * from pos.admins'))) as unknown[]).length, 1);
  assert.equal(((await como(db, pub, (q) => q('select * from pos.solicitudes_autorizacion'))) as unknown[]).length, 0);
  const [{ es }] = (await como(db, pub, (q) => q('select pos.es_admin() as es'))) as { es: boolean }[];
  assert.equal(es, false);
});

test('CS9 una red que no contesta no deja colgado al cliente: la petición se corta por tiempo', async () => {
  const colgado = ((_url: string, init: { signal?: AbortSignal }) => new Promise((_res, rej) => { init.signal?.addEventListener('abort', () => rej(new Error('sin respuesta'))); })) as unknown as typeof fetch;
  const c = new ClienteSupabase('https://abc.supabase.co', 'ANON', colgado);
  c.timeoutMs = 30;
  await assert.rejects(c.iniciarSesion('a@b.c', 'x'), /sin respuesta/);
});

test('CS10 notificaciones: el disparador avisa solo de lo relevante y nunca frena una venta; cada supervisor maneja solo sus dispositivos', async () => {
  const db = await centralLocal();
  const sup = await usuario(db, 'edgardo@x.mx', 'supervisor');
  const sup2 = await usuario(db, 'otra@x.mx', 'supervisor');
  const alm = await usuario(db, 'almacen@x.mx', 'almacenista');
  const caja = await usuario(db, 'caja@x.mx', 'caja', true, { tienda: 'DUO', caja: 1 });
  const llamadas = async () => (await db.query<{ url: string; headers: Record<string, string>; body: { op_id: string; tipo: string } }>('select url, headers, body from net.llamadas order by id')).rows;
  const subir = (uid: string, tipos: string[]) => new ClientePglite(db, uid).subirOps(tipos.map((t, i) => ({ ...crearOp(t, 'DUO', 1, 'caja:DUO/1', T0, { i }, `${t}:${Math.random()}`) })));
  // Sin configurar no hace nada (y la venta entra igual).
  await subir(caja, ['sale.confirmed']);
  assert.equal((await llamadas()).length, 0);
  // Se configura (como lo haría el servidor): queda la dirección y la clave, y un trabajo programado cada 15 minutos.
  await db.query(`select pos.configurar_notificaciones('https://x.supabase.co/functions/v1/notificar', 'clave-compartida-de-prueba-123456')`);
  const [{ jobname, schedule, command }] = (await db.query<{ jobname: string; schedule: string; command: string }>('select jobname, schedule, command from cron.job')).rows;
  assert.deepEqual([jobname, schedule], ['londuo-resumen-dia', '*/15 * * * *']);
  assert.match(command, /'accion', 'resumen'/);
  await db.query(`select pos.configurar_notificaciones('https://x.supabase.co/functions/v1/notificar', 'clave-compartida-de-prueba-123456')`);
  assert.equal(((await db.query('select 1 from cron.job')).rows).length, 1, 'configurar otra vez no duplica el trabajo');
  await subir(caja, ['sale.confirmed', 'inv.movement', 'return.registered', 'cash.retiro', 'ticket.impresion', 'corte.generado', 'sale.cancelled', 'doc.perdida_posible']);
  const l = await llamadas();
  assert.deepEqual(l.map((x) => x.body.tipo), ['sale.confirmed', 'return.registered', 'cash.retiro', 'corte.generado', 'sale.cancelled', 'doc.perdida_posible']);
  assert.ok(l.every((x) => x.url === 'https://x.supabase.co/functions/v1/notificar' && x.headers['x-londuo-secret'] === 'clave-compartida-de-prueba-123456' && x.body.op_id));
  // Si la red de avisos falla, la operación se guarda igual.
  await db.query(`update pos.ajustes_internos set valor = 'https://falla.supabase.co/f' where clave = 'notificar_url'`);
  assert.equal((await subir(caja, ['sale.confirmed'])).nuevas, 1);
  assert.equal(((await como(db, sup, (q) => q(`select 1 from pos.ops where tipo = 'sale.confirmed'`))) as unknown[]).length, 3);
  // Dispositivos: cada supervisor ve y maneja solo los suyos; los demás roles y los anónimos, ninguno. La configuración interna no se lee ni se ejecuta.
  const alta = (uid: string, ep: string) => como(db, uid, (q) => q(`insert into pos.suscripciones_push (user_id, endpoint, p256dh, auth, dispositivo) values ($1, $2, 'pk', 'au', 'iPhone') returning id`, [uid, ep]));
  assert.equal((await alta(sup, 'https://push.example/a')).length, 1);
  assert.equal((await alta(sup2, 'https://push.example/b')).length, 1);
  assert.equal(((await como(db, sup, (q) => q('select * from pos.suscripciones_push'))) as unknown[]).length, 1);
  await assert.rejects(alta(alm, 'https://push.example/c'), /row-level security/);
  await assert.rejects(alta(caja, 'https://push.example/d'), /row-level security/);
  await assert.rejects(como(db, sup, (q) => q(`insert into pos.suscripciones_push (user_id, endpoint, p256dh, auth) values ($1, 'https://push.example/e', 'pk', 'au')`, [sup2])), /row-level security/, 'no se puede registrar un dispositivo a nombre de otro');
  assert.equal(((await como(db, sup2, (q) => q(`update pos.suscripciones_push set activa = false where endpoint = 'https://push.example/a' returning 1`))) as unknown[]).length, 0, 'no toca los de otro');
  assert.equal(((await como(db, sup, (q) => q(`update pos.suscripciones_push set prefs = '{"venta": false}', pausa_hasta = now() where endpoint = 'https://push.example/a' returning 1`))) as unknown[]).length, 1);
  await assert.rejects(como(db, sup, (q) => q('select * from pos.ajustes_internos')), /permission denied/);
  await assert.rejects(como(db, sup, (q) => q(`select pos.configurar_notificaciones('https://x.supabase.co/f', 'clave-compartida-de-prueba-123456')`)), /permission denied/);
  await assert.rejects(como(db, null, (q) => q('select * from pos.suscripciones_push')), /permission denied/);
});

test('CS11 reporte a la contadora: solo un supervisor configura los destinatarios de cada caja; el envío mensual se reserva una sola vez por caja y se puede reintentar; nada de esto lo ven cajas ni anónimos', async () => {
  const db = await centralLocal();
  const sup = await usuario(db, 'edgardo@x.mx', 'supervisor');
  const alm = await usuario(db, 'almacen@x.mx', 'almacenista');
  const caja = await usuario(db, 'caja@x.mx', 'caja', true, { tienda: 'DUO', caja: 1 });
  // Configuración por caja: solo supervisor.
  const guardar = (uid: string, tienda: string, n: number, correos: string[]) => como(db, uid, (q) => q(`insert into pos.reporte_contadora (tienda, caja, activo, correos, actualizado_por) values ($1, $2, true, $3, $4) on conflict (tienda, caja) do update set activo = true, correos = excluded.correos returning tienda`, [tienda, n, correos, uid]));
  assert.equal(((await guardar(sup, 'DUO', 1, ['conta@despacho.mx', 'dueno@x.mx'])) as unknown[]).length, 1);
  assert.equal(((await guardar(sup, 'DUO', 2, ['otra@despacho.mx'])) as unknown[]).length, 1, 'cada caja tiene su propia lista');
  assert.equal(((await guardar(sup, 'DUO', 1, ['conta@despacho.mx'])) as unknown[]).length, 1, 'guardar otra vez la misma caja la actualiza');
  await assert.rejects(guardar(alm, 'LON', 1, ['x@x.mx']), /row-level security/);
  await assert.rejects(guardar(caja, 'LON', 1, ['x@x.mx']), /row-level security/);
  await assert.rejects(guardar(sup, 'XXX', 1, ['x@x.mx']), /check/, 'solo DUO o LON');
  await assert.rejects(guardar(sup, 'DUO', 0, ['x@x.mx']), /check/, 'la caja es 1 o más');
  assert.deepEqual(((await como(db, sup, (q) => q('select tienda, caja, correos from pos.reporte_contadora order by tienda, caja'))) as { tienda: string; caja: number; correos: string[] }[]).map((r) => [r.tienda, r.caja, r.correos]), [['DUO', 1, ['conta@despacho.mx']], ['DUO', 2, ['otra@despacho.mx']]]);
  assert.equal(((await como(db, alm, (q) => q('select * from pos.reporte_contadora'))) as unknown[]).length, 0, 'el almacenista no ve los correos');
  assert.equal(((await como(db, caja, (q) => q('select * from pos.reporte_contadora'))) as unknown[]).length, 0);
  await assert.rejects(como(db, null, (q) => q('select * from pos.reporte_contadora')), /permission denied/);
  // Reserva atómica del envío por caja (la usa solo el servidor).
  const reclamar = async (p = '2026-10', t = 'DUO', c = 1) => (await db.query<{ r: boolean }>('select pos.reclamar_envio_reporte($1, $2, $3) as r', [p, t, c])).rows[0]!.r;
  assert.equal(await reclamar(), true);
  assert.equal(await reclamar(), false, 'una segunda corrida a la vez no manda otro correo');
  assert.equal(await reclamar('2026-10', 'DUO', 2), true, 'otra caja de la misma tienda es otro envío');
  assert.equal(await reclamar('2026-10', 'LON', 1), true, 'y otra tienda también');
  await db.query(`select pos.liberar_envio_reporte('2026-10', 'DUO', 1)`);
  assert.equal(await reclamar(), true, 'si el correo falló se libera y se puede reintentar');
  await db.query(`select pos.registrar_envio_reporte('2026-10', 'DUO', 1, array['conta@despacho.mx'], 41, 322152, 're_123')`);
  const fila = (await db.query<{ enviado: boolean; tickets: number; total: string; proveedor_id: string }>(`select enviado_en is not null as enviado, tickets, total::text, proveedor_id from pos.envios_reporte where periodo = '2026-10' and tienda = 'DUO' and caja = 1`)).rows[0]!;
  assert.deepEqual([fila.enviado, fila.tickets, fila.total, fila.proveedor_id], [true, 41, '322152', 're_123']);
  assert.equal(await reclamar(), false, 'lo ya enviado no se vuelve a reservar');
  await db.query(`select pos.liberar_envio_reporte('2026-10', 'DUO', 1)`);
  assert.equal((await db.query(`select 1 from pos.envios_reporte where periodo = '2026-10' and tienda = 'DUO' and caja = 1`)).rows.length, 1, 'liberar no borra lo ya enviado');
  // Una reserva que quedó a medias (la función se cayó) se retoma a los 30 minutos.
  assert.equal(await reclamar('2026-10', 'DUO', 2), false);
  await db.query(`update pos.envios_reporte set reservado_en = now() - interval '31 minutes' where periodo = '2026-10' and tienda = 'DUO' and caja = 2`);
  assert.equal(await reclamar('2026-10', 'DUO', 2), true);
  // Bitácora: el supervisor la lee; los demás no; nadie ejecuta las funciones del servidor.
  assert.equal(((await como(db, sup, (q) => q('select * from pos.envios_reporte'))) as unknown[]).length, 3);
  assert.equal(((await como(db, alm, (q) => q('select * from pos.envios_reporte'))) as unknown[]).length, 0);
  for (const uid of [sup, alm]) await assert.rejects(como(db, uid, (q) => q(`select pos.reclamar_envio_reporte('2026-11', 'DUO', 1)`)), /permission denied/);
  // Programación: usa la clave compartida de los avisos, a las 04, 05, 06 y 16 UTC (21, 22, 23 y 9 h de Hermosillo) y sin duplicarse.
  await assert.rejects(db.query(`select pos.configurar_reporte_contadora('https://x.supabase.co/functions/v1/reporte-contadora')`), /primero ejecute pos\.configurar_notificaciones/);
  await db.query(`select pos.configurar_notificaciones('https://x.supabase.co/functions/v1/notificar', 'clave-compartida-de-prueba-123456')`);
  await db.query(`select pos.configurar_reporte_contadora('https://x.supabase.co/functions/v1/reporte-contadora')`);
  await db.query(`select pos.configurar_reporte_contadora('https://x.supabase.co/functions/v1/reporte-contadora')`);
  const jobs = (await db.query<{ jobname: string; schedule: string; command: string }>(`select jobname, schedule, command from cron.job where jobname = 'londuo-reporte-mensual'`)).rows;
  assert.deepEqual(jobs.map((j) => [j.jobname, j.schedule]), [['londuo-reporte-mensual', '0 4,5,6,16 * * *']]);
  assert.match(jobs[0]!.command, /'accion', 'mensual'/);
  await assert.rejects(como(db, sup, (q) => q(`select pos.configurar_reporte_contadora('https://x.supabase.co/f')`)), /permission denied/);
});

test('CS12 reintentos del reporte: cada fallo suma un intento y libera la reserva; a los 4 ya no se reserva; el aviso se marca una sola vez; la programación pasa a 21, 22, 23 y 9 h', async () => {
  const db = await centralLocal();
  const sup = await usuario(db, 'edgardo@x.mx', 'supervisor');
  const q = async <T>(sql: string, p: unknown[] = []) => (await db.query<T>(sql, p)).rows;
  const reclamar = async () => (await q<{ r: boolean }>(`select pos.reclamar_envio_reporte('2026-10', 'DUO', 1) as r`))[0]!.r;
  const fallar = async (e: string) => (await q<{ n: number }>(`select pos.fallar_envio_reporte('2026-10', 'DUO', 1, $1) as n`, [e]))[0]!.n;
  assert.equal(await reclamar(), true);
  assert.equal(await reclamar(), false, 'reservada: otra corrida no la toma');
  assert.equal(await fallar('Resend: 503'), 1, 'primer fallo: 1 intento');
  assert.equal(await reclamar(), true, 'el fallo libera la reserva: la siguiente corrida (una hora después) puede intentar');
  assert.equal(await fallar('Resend: 429'), 2);
  assert.equal(await reclamar(), true);
  assert.equal(await fallar('tiempo agotado'), 3);
  assert.equal(await reclamar(), true);
  assert.equal(await fallar('Resend: 500 ' + 'x'.repeat(400)), 4, 'cuarto fallo');
  assert.equal(await reclamar(), false, 'con 4 intentos ya no se reserva');
  const fila = (await q<{ intentos: number; ultimo_error: string; enviado_en: string | null }>(`select intentos, ultimo_error, enviado_en from pos.envios_reporte where periodo = '2026-10' and tienda = 'DUO' and caja = 1`))[0]!;
  assert.deepEqual([fila.intentos, fila.enviado_en, fila.ultimo_error.length], [4, null, 300], 'el error se guarda recortado');
  // Aviso: una sola vez.
  await db.query(`select pos.marcar_aviso_reporte('2026-10', 'DUO', 1)`);
  const primero = (await q<{ avisado_en: string }>(`select avisado_en::text from pos.envios_reporte where caja = 1`))[0]!.avisado_en;
  await db.query(`select pos.marcar_aviso_reporte('2026-10', 'DUO', 1)`);
  assert.equal((await q<{ avisado_en: string }>(`select avisado_en::text from pos.envios_reporte where caja = 1`))[0]!.avisado_en, primero, 'no se vuelve a marcar');
  // Reinicio manual: borra el envío que no salió y se puede empezar de cero.
  await db.query(`select pos.liberar_envio_reporte('2026-10', 'DUO', 1)`);
  assert.equal(await reclamar(), true);
  await db.query(`select pos.registrar_envio_reporte('2026-10', 'DUO', 1, array['a@x.mx'], 3, 1000, 're_1')`);
  assert.equal(await fallar('tarde'), null, 'un envío ya enviado no suma fallos');
  assert.equal(await reclamar(), false);
  await db.query(`select pos.liberar_envio_reporte('2026-10', 'DUO', 1)`);
  assert.equal((await q(`select 1 from pos.envios_reporte where periodo = '2026-10'`)).length, 1, 'lo enviado no se borra');
  // El supervisor ve intentos y error; nadie más; las funciones son solo del servidor.
  const como2 = (uid: string, sql: string) => como(db, uid, (qq) => qq(sql)) as Promise<{ intentos: number }[]>;
  assert.equal((await como2(sup, 'select intentos from pos.envios_reporte')).length, 1);
  await assert.rejects(como(db, sup, (qq) => qq(`select pos.fallar_envio_reporte('2026-10', 'DUO', 1, 'x')`)), /permission denied/);
  // Programación: 04, 05, 06 y 16 UTC (21, 22, 23 y 9 h de Hermosillo), sin duplicar.
  await db.query(`select pos.configurar_notificaciones('https://x.supabase.co/functions/v1/notificar', 'clave-compartida-de-prueba-123456')`);
  await db.query(`select pos.configurar_reporte_contadora('https://x.supabase.co/functions/v1/reporte-contadora')`);
  await db.query(`select pos.configurar_reporte_contadora('https://x.supabase.co/functions/v1/reporte-contadora')`);
  const jobs = await q<{ schedule: string }>(`select schedule from cron.job where jobname = 'londuo-reporte-mensual'`);
  assert.deepEqual(jobs.map((j) => j.schedule), ['0 4,5,6,16 * * *']);
});
