import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe } from 'node:test';
import { crearPoliticasEnsayo, type Politicas } from '../../src/politicas.ts';
import { fabricaMemoria, fabricaSqlite, Mundo, type FabricaRepo } from '../../src/mundo.ts';
import type { Articulo } from '../../src/tipos.ts';

/**
 * CONFIGURACIÓN DE ENSAYO. Cada valor se escribe explícitamente; ninguno está aprobado.
 * Una prueba que usa un valor NO lo recomienda ni lo habilita para producción.
 */
export const BASE_ENSAYO: Omit<Politicas, 'estado'> = {
  P01_hub_no_disponible: 'vender_autonomo_con_aviso',
  P02_existencia_insuficiente: 'permitir_y_conciliar',
  P03_devolucion_venta_no_local: 'bloquear',
  P06_huecos_de_folio: 'no_aceptados',
  P07_item_no: 'a_central',
  P12_tarjeta_con_pendiente: 'permitir_con_aviso',
  P14_venta_con_inventario_no_verificado: 'permitir_con_aviso',
  K_folios: 6,
  K_item_no: 5,
};
export const politica = (o: Partial<Omit<Politicas, 'estado'>> = {}) => crearPoliticasEnsayo({ ...BASE_ENSAYO, ...o });

export const CATALOGO_SINTETICO: Omit<Articulo, 'item_id' | 'origen'>[] = [
  { codigo: '0002026090782', item_no: '1001', marca: 'LEVIS', descripcion: 'JEANS', estilo: '726-', lote: '20260913', departamento: 'CABALLERO', precio: 89900 },
  { codigo: '0002026090799', item_no: '1002', marca: 'LEVIS', descripcion: 'JEANS', estilo: '726-', lote: '20261014', departamento: 'CABALLERO', precio: 89900 },
  { codigo: '7501234567890', item_no: '1003', marca: 'EFENTUS', descripcion: 'MASCADA', estilo: 'A-12', lote: '20260913', departamento: 'ACCESORIOS', precio: 12000 },
  { codigo: '0000000000017', item_no: '1004', marca: 'ZESTINI', descripcion: 'BOLSA', estilo: 'Z9', lote: '20261014', departamento: 'BOLSAS', precio: 45000 },
];
// existencias por tienda de cada artículo anterior
export const EXISTENCIAS: Record<string, number>[] = [{ DUO: 5, LON: 3 }, { DUO: 3 }, { DUO: 50, LON: 50 }, { DUO: 1 }];

export interface Almacen {
  nombre: 'memoria' | 'sqlite';
  crear(): { fabrica: FabricaRepo; limpiar(): void };
}
export const ALMACENES: Almacen[] = [
  { nombre: 'memoria', crear: () => ({ fabrica: fabricaMemoria(), limpiar() {} }) },
  {
    nombre: 'sqlite',
    crear() {
      const dir = mkdtempSync(join(tmpdir(), 'pos-sim-'));
      return { fabrica: fabricaSqlite(dir), limpiar: () => rmSync(dir, { recursive: true, force: true }) };
    },
  },
];

export interface Ctx {
  m: Mundo;
  items: Articulo[];
  limpiar: () => void;
}
export function nuevoMundo(a: Almacen, pol: Politicas, sembrar = true): Ctx {
  const { fabrica, limpiar } = a.crear();
  const m = new Mundo({ fabrica, politicas: pol });
  const items = sembrar ? m.sembrar(CATALOGO_SINTETICO, EXISTENCIAS) : [];
  return { m, items, limpiar: () => { m.cerrar(); limpiar(); } };
}

/** Define la suite una vez por almacenamiento, etiquetando [memoria] / [sqlite]. */
export function porAlmacen(nombre: string, f: (a: Almacen) => void, solo?: 'memoria' | 'sqlite') {
  for (const a of ALMACENES) {
    if (solo && a.nombre !== solo) continue;
    describe(`[${a.nombre}] ${nombre}`, () => f(a));
  }
}

/** Venta en efectivo de `qty` unidades del artículo `item`. */
export function vender(m: Mundo, t: string, c: number, itemId: string, qty = 1, extra: { precio?: number; descuento?: number } = {}) {
  const caja = m.caja(t, c);
  const cart = caja.abrirCarrito();
  const l = caja.agregarLinea(cart, { item_id: itemId, qty, precio_unit: extra.precio, descuento: extra.descuento });
  const total = l.importe;
  return { cart, venta: caja.cobrar(cart, [{ metodo: 'efectivo', monto: total }]), linea: l };
}

// ── servicio de venta (capa que usa la UI) ──
import { mkdirSync } from 'node:fs';
import { ServicioCaja, type Conexion } from '../../src/app/servicio.ts';
import { ImpresoraArchivo } from '../../src/impresion.ts';

export interface Servicio {
  svc: ServicioCaja;
  impresora: ImpresoraArchivo;
  /** "Sincronizar" = entregar pendientes en la red simulada; registra la hora de la última actualización. */
  sync(): void;
}
/** Servicio de la caja (tienda, n) con una impresora SIMULADA que escribe archivos. */
export function servicioDe(ctx: Ctx, tienda: string, n: number, usuario = 'Ana'): Servicio {
  const dir = mkdtempSync(join(tmpdir(), `pos-imp-${tienda}${n}-`));
  mkdirSync(dir, { recursive: true });
  const impresora = new ImpresoraArchivo(dir);
  let ultima: string | null = null;
  const caja = () => ctx.m.caja(tienda, n);
  const sync = () => { ctx.m.pump(); ultima = ctx.m.reloj.now(); };
  const conexion: Conexion = {
    hubAlcanzable: () => caja().enlace.hubAlcanzable(),
    internet: () => ctx.m.internet.get(tienda) !== false,
    pendientes: () => caja().repo.pendientes(`hub:${tienda}`).length,
    ultimaSync: () => ultima,
    sincronizar: sync,
  };
  const prev = ctx.limpiar;
  ctx.limpiar = () => { prev(); rmSync(dir, { recursive: true, force: true }); };
  const svc = new ServicioCaja({ caja: caja(), actor: { rol: 'cajero', usuario, tienda, caja: n }, impresora, conexion, reloj: ctx.m.reloj });
  return { svc, impresora, sync };
}
