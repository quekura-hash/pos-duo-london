import assert from 'node:assert/strict';
import type { PGlite } from '@electric-sql/pglite';
import { aplicarDepartamentos, DEPARTAMENTOS_BASE } from '../../src/departamentos.ts';
import { aOperacionesInventario, leerInventario } from '../../src/inventario.ts';
import { iniciarAdminNube, type ClienteNube } from '../../src/app/admin-nube.ts';
import type { AlmacenCaja, ClienteCaja, IdentidadCaja } from '../../src/app/caja-nube.ts';
import { centralLocal, ClientePglite, usuario } from './central-pglite.ts';

export type Cuentas = Record<string, { id: string; rol: 'supervisor' | 'almacenista' | 'caja' | null; alias: string; tienda?: string; caja?: number }>;
/** Cliente de Supabase simulado sobre el Postgres local; `red.caida` corta la conexión (la sesión se pierde igual que sin internet). */
export function clienteDe(db: PGlite, cuentas: Cuentas, red = { caida: false }): ClienteNube & ClienteCaja {
  let actual: string | null = null;
  const c = () => { if (red.caida) throw new Error('Failed to fetch'); return new ClientePglite(db, actual!); };
  return {
    get conSesion() { return actual !== null && !red.caida; },
    async iniciarSesion(correo: string, clave: string) {
      if (red.caida) throw new Error('Failed to fetch');
      const u = cuentas[correo];
      if (!u || clave !== 'buena') throw new Error('No se pudo iniciar sesión en el central: revisa correo y contraseña.');
      actual = u.id;
    },
    async miPerfil() { const u = Object.values(cuentas).find((x) => x.id === actual)!; return u.rol ? { rol: u.rol, alias: u.alias, usuario_id: u.id, tienda: u.tienda ?? null, caja: u.caja ?? null } : null; },
    cerrarSesion() { actual = null; },
    async subirOps(ops) { return c().subirOps(ops); },
    async bajarOps(d, l) { return c().bajarOps(d, l); },
    async ventasPorDia(d, h) { return c().ventasPorDia(d, h); },
  };
}
export function almacenMemoria(): AlmacenCaja & { datos: Map<string, unknown>; identidad?: IdentidadCaja } {
  const datos = new Map<string, unknown>();
  const a: AlmacenCaja & { datos: Map<string, unknown>; identidad?: IdentidadCaja } = {
    datos,
    async leer(k) { return datos.get(k); },
    async escribir(k, e) { datos.set(k, structuredClone(e)); },
    async leerIdentidad() { return a.identidad; },
    async guardarIdentidad(i) { a.identidad = i; },
  };
  return a;
}
const ENC = ['Item Number', 'Descripcion', 'Marca', 'Estilo', 'Lote', 'Precio', 'UPC', 'departamento', 'cantidad'];
const FILAS: unknown[][] = [ENC, [1, 'BLUSA', 'LEVIS', 'MW1', '20251007', 499, '0002025101274', 'Dama', 6], [2, 'CAMISA', 'DUO', 'C1', '20251007', 299, '0002025101281', 'Caballero', 3]];
export const ESCANEAR = '0002025101274';

export async function escenario(o: { cajera?: boolean } = {}) {
  const db = await centralLocal();
  const cuentas: Cuentas = {
    'edgardo@x.mx': { id: await usuario(db, 'edgardo@x.mx', 'supervisor'), rol: 'supervisor', alias: 'Edgardo' },
    'caja-duo-1@x.mx': { id: await usuario(db, 'caja-duo-1@x.mx', 'caja', true, { tienda: 'DUO', caja: 1 }), rol: 'caja', alias: 'caja-duo-1', tienda: 'DUO', caja: 1 },
    'caja-lon-1@x.mx': { id: await usuario(db, 'caja-lon-1@x.mx', 'caja', true, { tienda: 'LON', caja: 1 }), rol: 'caja', alias: 'caja-lon-1', tienda: 'LON', caja: 1 },
  };
  // Administración deja listo el negocio: artículos con existencia en El Limbo y una cajera.
  const admin = iniciarAdminNube({ cliente: clienteDe(db, cuentas) });
  await admin.entrar('edgardo@x.mx', 'buena');
  const dep = aplicarDepartamentos(leerInventario(FILAS).articulos, DEPARTAMENTOS_BASE, {});
  admin.agregarOps(aOperacionesInventario(dep.articulos, { ahora: '2026-10-20T12:00:00.000Z', idImportacion: 'imp1', limbo: { piezas: 0, delArchivo: true } }).ops);
  if (o.cajera !== false) {
    const r = await admin.atender('POST', '/api/admin/cajeros', { nombre: 'Ana', clave: '1234', activo: true, perfil: { nombres: 'Ana', apellidos: 'Pérez' } });
    assert.equal(r.status, 200, JSON.stringify(r.json));
  }
  await admin.sincronizar();
  return { db, cuentas, admin };
}
