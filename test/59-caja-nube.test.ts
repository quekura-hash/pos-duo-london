import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Impresora, TrabajoImpresion } from '../src/impresion.ts';
import { iniciarCajaNube } from '../src/app/caja-nube.ts';
import type { PGlite } from '@electric-sql/pglite';
import { centralLocal, como, usuario } from './ayudas/central-pglite.ts';
import { almacenMemoria, clienteDe, escenario, ESCANEAR } from './ayudas/escenario-central.ts';

class ImpresoraProbada implements Impresora { trabajos: TrabajoImpresion[] = []; async imprimir(t: TrabajoImpresion) { this.trabajos.push(t); } }

const venta = async (c: ReturnType<typeof iniciarCajaNube>, recibido = 50000) => {
  const { cart } = (await c.atender('POST', '/api/venta/nueva', {})).json as { cart: unknown };
  const e = (await c.atender('POST', '/api/venta/escanear', { cart, codigo: ESCANEAR })).json as { resultado: string };
  assert.equal(e.resultado, 'agregado');
  return (await c.atender('POST', '/api/venta/cobrar-efectivo', { cart, recibido })).json as { ok: boolean; venta: { folio: number }; impresion: { ok: boolean } };
};
const contar = async (db: PGlite, uid: string, tipo: string) => ((await como(db, uid, (q) => q(`select count(*)::int as n from pos.ops where tipo = $1`, [tipo]))) as { n: number }[])[0]!.n;

test('CN1 la caja baja el catálogo y las cajeras del central, vende, imprime y sube la venta', async () => {
  const { db, cuentas, admin } = await escenario();
  const imp = new ImpresoraProbada();
  const caja = iniciarCajaNube({ cliente: clienteDe(db, cuentas), impresora: imp, almacen: almacenMemoria() });
  await assert.rejects(caja.entrar('caja-duo-1@x.mx', 'mala'), /revisa correo y contraseña/);
  await assert.rejects(caja.entrar('edgardo@x.mx', 'buena'), /no es de una caja/);
  assert.deepEqual(await caja.entrar('caja-duo-1@x.mx', 'buena'), { tienda: 'DUO', caja: 1 });
  const ses = (await caja.atender('GET', '/api/sesion', undefined)).json as { rol: string; tienda: string; caja: number; requiere_login: boolean; cajeros: string[] };
  assert.deepEqual([ses.rol, ses.tienda, ses.caja, ses.requiere_login, ses.cajeros], ['cajero', 'DUO', 1, true, ['Ana']]);
  assert.equal((await caja.atender('POST', '/api/login', { usuario: 'Ana', clave: '0000' })).status, 403);
  assert.equal((await caja.atender('POST', '/api/login', { usuario: 'Ana', clave: '1234' })).status, 200);
  const r = await venta(caja);
  assert.deepEqual([r.ok, r.venta.folio, r.impresion.ok], [true, 1, true]);
  assert.ok(imp.trabajos.length >= 1 && imp.trabajos[0]!.bytes[0] === 0x1b, 'el ticket salió como ESC/POS');
  await caja.sincronizar();
  await caja.sincronizar();
  assert.equal(caja.estado().error, null);
  assert.equal(await contar(db, cuentas['edgardo@x.mx']!.id, 'sale.confirmed'), 1);
  const [{ origen }] = (await como(db, cuentas['edgardo@x.mx']!.id, (q) => q(`select origen from pos.ops where tipo = 'sale.confirmed'`))) as { origen: string }[];
  assert.equal(origen, 'caja:DUO/1');
  // Administración ve la venta de la caja tras sincronizar.
  await admin.sincronizar();
  const rep = (await admin.atender('POST', '/api/admin/reporte', {})).json as { reporte: unknown };
  assert.match(JSON.stringify(rep), /DUO/);
  assert.equal(caja.estado().pendientes, 0);
  assert.equal(caja.estado().error, null);
  caja.detener();
});

test('CN2 sin internet la caja sigue vendiendo; al volver, todo sube una sola vez; al reabrir conserva sus folios', async () => {
  const { db, cuentas } = await escenario();
  const red = { caida: false };
  const almacen = almacenMemoria();
  const c1 = iniciarCajaNube({ cliente: clienteDe(db, cuentas, red), impresora: new ImpresoraProbada(), almacen });
  await c1.entrar('caja-duo-1@x.mx', 'buena');
  await c1.atender('POST', '/api/login', { usuario: 'Ana', clave: '1234' });
  red.caida = true;
  assert.equal((await venta(c1)).venta.folio, 1);
  assert.equal((await venta(c1)).venta.folio, 2);
  await c1.sincronizar();
  assert.match(c1.estado().error ?? '', /sin conexión|Failed to fetch/);
  assert.ok(c1.estado().pendientes > 0);
  assert.equal(await contar(db, cuentas['edgardo@x.mx']!.id, 'sale.confirmed'), 0);
  c1.detener();
  // La PC se apaga y se enciende SIN internet: abre con lo guardado y los folios siguen (no se repite el 1).
  const c2 = iniciarCajaNube({ cliente: clienteDe(db, cuentas, red), impresora: new ImpresoraProbada(), almacen });
  await c2.entrar('caja-duo-1@x.mx', 'buena');
  await c2.atender('POST', '/api/login', { usuario: 'Ana', clave: '1234' });
  assert.equal((await venta(c2)).venta.folio, 3);
  await c2.sincronizar(); // deja terminar el intento que quedó en vuelo con la red caída
  red.caida = false;
  assert.equal(await c2.sincronizar(), true, String(c2.estado().error));
  assert.equal(await contar(db, cuentas['edgardo@x.mx']!.id, 'sale.confirmed'), 3);
  assert.equal(c2.estado().pendientes, 0);
  await c2.sincronizar();
  assert.equal(await contar(db, cuentas['edgardo@x.mx']!.id, 'sale.confirmed'), 3, 'subir de nuevo no duplica');
  c2.detener();
  // Sin datos guardados y sin internet no se puede abrir.
  red.caida = true;
  await assert.rejects(iniciarCajaNube({ cliente: clienteDe(db, cuentas, red), almacen: almacenMemoria() }).entrar('caja-duo-1@x.mx', 'buena'), /No se pudo conectar con el central/);
});

test('CN3 lo que Administración cambia después (una cajera nueva) llega a la caja; las ventas de otra tienda no', async () => {
  const { db, cuentas, admin } = await escenario();
  const duo = iniciarCajaNube({ cliente: clienteDe(db, cuentas), impresora: new ImpresoraProbada(), almacen: almacenMemoria() });
  const lon = iniciarCajaNube({ cliente: clienteDe(db, cuentas), impresora: new ImpresoraProbada(), almacen: almacenMemoria() });
  await duo.entrar('caja-duo-1@x.mx', 'buena');
  await lon.entrar('caja-lon-1@x.mx', 'buena');
  await admin.atender('POST', '/api/admin/cajeros', { nombre: 'Luis', clave: '5678', activo: true, perfil: { nombres: 'Luis', apellidos: 'Gómez' } });
  await admin.sincronizar();
  await duo.sincronizar();
  const nombres = ((await duo.atender('GET', '/api/sesion', undefined)).json as { cajeros: string[] }).cajeros.sort();
  assert.deepEqual(nombres, ['Ana', 'Luis']);
  await duo.atender('POST', '/api/login', { usuario: 'Ana', clave: '1234' });
  await venta(duo);
  await duo.sincronizar();
  await lon.sincronizar();
  const ops = lon.mundo!.central.repo.ops();
  assert.ok(!ops.some((o) => o.tipo === 'sale.confirmed'), 'London no recibe las ventas de DÚO');
  assert.ok(ops.some((o) => o.tipo === 'item.created'));
  duo.detener(); lon.detener();
});


test('CN4 sin cajeras registradas la caja no muestra cuenta regresiva de inactividad; con cajeras sí, solo después de entrar', async () => {
  const db = await centralLocal();
  const sup = await usuario(db, 'edgardo@x.mx', 'supervisor');
  const cuentas = { 'edgardo@x.mx': { id: sup, rol: 'supervisor' as const, alias: 'Edgardo' }, 'caja-duo-1@x.mx': { id: await usuario(db, 'caja-duo-1@x.mx', 'caja', true, { tienda: 'DUO', caja: 1 }), rol: 'caja' as const, alias: 'caja', tienda: 'DUO', caja: 1 } };
  const sinCajeras = iniciarCajaNube({ cliente: clienteDe(db, cuentas), impresora: new ImpresoraProbada(), almacen: almacenMemoria() });
  await sinCajeras.entrar('caja-duo-1@x.mx', 'buena');
  const s = (await sinCajeras.atender('GET', '/api/sesion', undefined)).json as { requiere_login: boolean; autenticado: boolean; inactividad: unknown };
  assert.deepEqual([s.requiere_login, s.autenticado, s.inactividad], [false, true, null]);
  sinCajeras.detener();
  const { db: db2, cuentas: c2 } = await escenario();
  const conCajeras = iniciarCajaNube({ cliente: clienteDe(db2, c2), impresora: new ImpresoraProbada(), almacen: almacenMemoria() });
  await conCajeras.entrar('caja-duo-1@x.mx', 'buena');
  assert.equal(((await conCajeras.atender('GET', '/api/sesion', undefined)).json as { inactividad: unknown }).inactividad, null, 'antes de entrar no hay cuenta regresiva');
  await conCajeras.atender('POST', '/api/login', { usuario: 'Ana', clave: '1234' });
  assert.ok(((await conCajeras.atender('GET', '/api/sesion', undefined)).json as { inactividad: { restante_seg: number } }).inactividad.restante_seg > 0);
  conCajeras.detener();
});
