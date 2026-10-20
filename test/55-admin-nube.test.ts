import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { EstadoRepo } from '../src/repo.ts';
import { crearOp } from '../src/util.ts';
import { iniciarAdminNube, type AlmacenReplica, type ClienteNube } from '../src/app/admin-nube.ts';
import { centralLocal, ClientePglite, usuario } from './ayudas/central-pglite.ts';
import type { PGlite } from '@electric-sql/pglite';

/** Cliente de Supabase simulado sobre el Postgres local: «correo|clave» → usuario. */
function clienteDe(db: PGlite, cuentas: Record<string, { id: string; rol: 'supervisor' | 'almacenista' | null; alias: string }>): ClienteNube & { token: string | null } {
  let actual: string | null = null;
  const c = () => new ClientePglite(db, actual!);
  return {
    token: null,
    async iniciarSesion(correo, clave) {
      const u = cuentas[correo];
      if (!u || clave !== 'buena') throw new Error('No se pudo iniciar sesión en el central: revisa correo y contraseña.');
      actual = u.id;
    },
    async miPerfil() { const u = Object.values(cuentas).find((x) => x.id === actual)!; return u.rol ? { rol: u.rol, alias: u.alias, usuario_id: u.id } : null; },
    cerrarSesion() { actual = null; },
    subirOps: (ops) => c().subirOps(ops),
    bajarOps: (d, l) => c().bajarOps(d, l),
  };
}
const memoriaDe = (): AlmacenReplica & { datos: Map<string, EstadoRepo> } => {
  const datos = new Map<string, EstadoRepo>();
  return { datos, async leer(k) { return datos.get(k); }, async escribir(k, e) { datos.set(k, e); }, async borrar(k) { datos.delete(k); } };
};
const T0 = '2026-10-20T12:00:00.000Z';
const articulo = (n: number) => crearOp('item.created', 'DUO', null, 'admin', T0, { item_id: `art-${n}`, codigo: `750000000000${n}`, item_no: String(n), marca: 'LEVIS', descripcion: 'JEANS', estilo: '', lote: '', departamento: 'CABALLERO', precio: 89900 }, `item.created:${n}`);

async function escenario() {
  const db = await centralLocal();
  const edgardo = await usuario(db, 'edgardo@x.mx', 'supervisor');
  const bodega = await usuario(db, 'bodega@x.mx', 'almacenista');
  const intruso = await usuario(db, 'intruso@x.mx');
  const cuentas = { 'edgardo@x.mx': { id: edgardo, rol: 'supervisor' as const, alias: 'Edgardo' }, 'bodega@x.mx': { id: bodega, rol: 'almacenista' as const, alias: 'Bodega' }, 'intruso@x.mx': { id: intruso, rol: null, alias: 'x' } };
  return { db, cuentas };
}

test('AN1 entrar: contraseña mala, sin acceso a la Administración y entrada correcta con su rol', async () => {
  const { db, cuentas } = await escenario();
  const a = iniciarAdminNube({ cliente: clienteDe(db, cuentas) });
  await assert.rejects(a.entrar('edgardo@x.mx', 'mala'), /No se pudo iniciar sesión/);
  await assert.rejects(a.entrar('intruso@x.mx', 'buena'), /no tiene acceso a la Administración/);
  assert.equal(a.estado().dentro, false);
  assert.equal((await a.atender('GET', '/api/sesion', undefined)).status, 401);
  assert.deepEqual(await a.entrar('edgardo@x.mx', 'buena'), { rol: 'supervisor', alias: 'Edgardo' });
  const s = (await a.atender('GET', '/api/sesion', undefined)).json as { rol: string; autenticado: boolean; usuario: string; rol_usuario: string; nav: string[] };
  assert.deepEqual([s.rol, s.autenticado, s.usuario, s.rol_usuario], ['admin', true, 'Edgardo', 'supervisor']);
  assert.equal(s.nav[0], 'inventario');
  assert.equal(a.estado().error, null);
});

test('AN2 lo que se hace en una Administración llega a la otra por el central, y cada rol ve lo suyo', async () => {
  const { db, cuentas } = await escenario();
  const mac = iniciarAdminNube({ cliente: clienteDe(db, cuentas) });
  const pc = iniciarAdminNube({ cliente: clienteDe(db, cuentas) });
  const almacen = iniciarAdminNube({ cliente: clienteDe(db, cuentas) });
  await mac.entrar('edgardo@x.mx', 'buena');
  mac.agregarOps([articulo(1), articulo(2)]);
  const cfg = await mac.atender('POST', '/api/admin/config-sesion', { caja_min: 7, admin_min: 25 });
  assert.equal(cfg.status, 200);
  await mac.sincronizar();
  assert.equal(mac.estado().pendientes, 0);
  // La PC entra después y descarga todo; la configuración guardada es la misma.
  await pc.entrar('edgardo@x.mx', 'buena');
  const cs = (await pc.atender('GET', '/api/admin/config-sesion', undefined)).json as { config: { caja_min: number; admin_min: number } };
  assert.deepEqual([cs.config.caja_min, cs.config.admin_min], [7, 25]);
  const inv = (await pc.atender('GET', '/api/admin/inventario', undefined)).json as { resumen: { articulos: number } };
  assert.equal(inv.resumen.articulos, 2);
  // El almacenista ve el inventario, pero no la configuración ni puede guardarla.
  await almacen.entrar('bodega@x.mx', 'buena');
  const invA = (await almacen.atender('GET', '/api/admin/inventario', undefined)).json as { resumen: { articulos: number } };
  assert.equal(invA.resumen.articulos, 2);
  const nav = ((await almacen.atender('GET', '/api/sesion', undefined)).json as { nav: string[] }).nav;
  assert.deepEqual(nav, ['inventario', 'almacen']);
  const prohibido = await almacen.atender('POST', '/api/admin/config-sesion', { caja_min: 1, admin_min: 1 });
  assert.equal(prohibido.status, 403);
  // Un cambio hecho en la PC aparece en la Mac al sincronizar.
  await pc.atender('POST', '/api/admin/config-sesion', { caja_min: 9, admin_min: 25 });
  await pc.sincronizar();
  await mac.sincronizar();
  assert.equal(((await mac.atender('GET', '/api/admin/config-sesion', undefined)).json as { config: { caja_min: number } }).config.caja_min, 9);
});

test('AN3 sin internet: se trabaja con la réplica guardada y todo se sube al volver', async () => {
  const { db, cuentas } = await escenario();
  const base = clienteDe(db, cuentas);
  const almacen = memoriaDe();
  const a1 = iniciarAdminNube({ cliente: base, almacen });
  await a1.entrar('edgardo@x.mx', 'buena');
  a1.agregarOps([articulo(1)]);
  await a1.sincronizar();
  a1.salir();
  assert.ok(almacen.datos.size === 1);
  // Reabre sin internet: entra con lo guardado (el inicio de sesión sí necesita al central; la descarga puede fallar).
  let caido = false;
  const flaky: ClienteNube = { ...base, subirOps: (o) => (caido ? Promise.reject(new Error('sin internet')) : base.subirOps(o)), bajarOps: (d, l) => (caido ? Promise.reject(new Error('sin internet')) : base.bajarOps(d, l)) };
  caido = true;
  const a2 = iniciarAdminNube({ cliente: flaky, almacen });
  await a2.entrar('edgardo@x.mx', 'buena');
  assert.match(a2.estado().error ?? '', /sin internet/);
  assert.equal(((await a2.atender('GET', '/api/admin/inventario', undefined)).json as { resumen: { articulos: number } }).resumen.articulos, 1);
  a2.agregarOps([articulo(2)]);
  assert.equal(a2.estado().pendientes, 1);
  await a2.sincronizar(); // deja terminar el intento que quedó en vuelo con la red caída
  caido = false;
  assert.equal(await a2.sincronizar(), true);
  assert.equal(a2.estado().pendientes, 0);
  assert.equal(a2.estado().error, null);
  // Sin réplica guardada y sin internet no se puede entrar (no hay con qué trabajar).
  caido = true;
  const a3 = iniciarAdminNube({ cliente: flaky });
  await assert.rejects(a3.entrar('edgardo@x.mx', 'buena'), /No se pudo descargar/);
});

test('AN4 cerrar sesión (o inactividad) devuelve a la pantalla de entrada y suelta la sesión del central', async () => {
  const { db, cuentas } = await escenario();
  let salidas = 0;
  const a = iniciarAdminNube({ cliente: clienteDe(db, cuentas), alSalir: () => { salidas++; } });
  await a.entrar('edgardo@x.mx', 'buena');
  await a.atender('POST', '/api/logout', {});
  assert.equal(salidas, 1);
  assert.equal(a.estado().dentro, false);
  assert.equal((await a.atender('GET', '/api/sesion', undefined)).status, 401);
});
