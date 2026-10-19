// Versión de PRUEBA que corre completa dentro del navegador: el MISMO motor, servicio, enrutador, ticket y pantalla,
// con almacenamiento en memoria. No hay hub real, ni SQLite, ni impresora: los datos se pierden al recargar.
import type { Impresora, TrabajoImpresion } from '../impresion.ts';
import { CAJAS_ESTANDAR, fabricaMemoria, Mundo } from '../mundo.ts';
import { crearPoliticasEnsayo } from '../politicas.ts';
import { aplicarDepartamentos, DEPARTAMENTOS_BASE } from '../departamentos.ts';
import { aOperacionesInventario, leerInventario, perfilConCantidad, PERFILES } from '../inventario.ts';
import { MemoriaRepo, type EstadoRepo } from '../repo.ts';
import type { Op } from '../tipos.ts';
import { escribirXlsx, leerXlsx } from '../xlsx.ts';
import { atender } from './rutas.ts';
import { ServicioAdmin, ServicioCaja } from './servicio.ts';

class ImpresoraMemoria implements Impresora {
  falla: string | null = null;
  trabajos: TrabajoImpresion[] = [];
  async imprimir(t: TrabajoImpresion) {
    // La falla simulada ocurre UNA vez: así el tester puede pulsar "Reintentar impresión" con el diálogo abierto.
    if (this.falla) { const m = this.falla; this.falla = null; throw new Error(m); }
    this.trabajos.push(t);
  }
}

export const ARTICULOS_DE_PRUEBA: { codigo: string; item_no: string; marca: string; descripcion: string; estilo: string; lote: string; departamento: string; precio: number; existencias: Record<string, number> }[] = [
  { codigo: '0002026090782', item_no: '1001', marca: 'LEVIS', descripcion: 'JEANS', estilo: '726-', lote: '20260913', departamento: 'CABALLERO', precio: 89900, existencias: { DUO: 5, LON: 3 } },
  { codigo: '0002026090799', item_no: '1002', marca: 'LEVIS', descripcion: 'JEANS', estilo: '726-', lote: '20261014', departamento: 'CABALLERO', precio: 89900, existencias: { DUO: 3 } },
  { codigo: '7501234567890', item_no: '1003', marca: 'EFENTUS', descripcion: 'MASCADA', estilo: 'A-12', lote: '20260913', departamento: 'ACCESORIOS', precio: 12000, existencias: { DUO: 50, LON: 50 } },
  { codigo: '0000000000017', item_no: '1004', marca: 'ZESTINI', descripcion: 'BOLSA', estilo: 'Z9', lote: '20261014', departamento: 'BOLSAS', precio: 45000, existencias: { DUO: 1 } },
  // Código duplicado A PROPÓSITO, para probar que el POS no adivina:
  { codigo: '7508888888888', item_no: '1005', marca: 'MARCA A', descripcion: 'FALDA', estilo: 'F-1', lote: '20261016', departamento: 'DAMA', precio: 30000, existencias: { DUO: 2 } },
  { codigo: '7508888888888', item_no: '1006', marca: 'MARCA B', descripcion: 'FALDA', estilo: 'F-1', lote: '20261016', departamento: 'DAMA', precio: 30000, existencias: { DUO: 2 } },
];

/** Lo que se guarda del banco de pruebas en el navegador: lo que ocurrió DESPUÉS de cargar el catálogo base. */
export interface EstadoBanco { conInventario: boolean; repos: Record<string, EstadoRepo> }

export function crearBanco(opsCatalogo?: Op[], estado?: EstadoBanco) {
  const fab = fabricaMemoria();
  const m = new Mundo({
    fabrica: fab,
    politicas: crearPoliticasEnsayo({
      P01_hub_no_disponible: 'vender_autonomo_con_aviso', P02_existencia_insuficiente: 'permitir_y_conciliar', P03_devolucion_venta_no_local: 'permitir_con_incidencia',
      P06_huecos_de_folio: 'no_aceptados', P07_item_no: 'a_central', P12_tarjeta_con_pendiente: 'permitir_con_aviso',
      P14_venta_con_inventario_no_verificado: 'permitir_con_aviso', K_folios: 30, K_item_no: 50,
    }),
  });
  m.fijarTipoCambioInicial(180000, 'Administración'); // tipo de cambio comercial inicial de ensayo (se edita desde la pantalla)
  m.central.asignarPermiso('Cajero DUO-1', 'editar_tipo_cambio', true, 'Administración'); // un usuario con permiso para probar el lápiz
  m.pump();
  if (opsCatalogo) m.sembrarOps(opsCatalogo);
  else m.sembrar(ARTICULOS_DE_PRUEBA.map(({ existencias: _e, ...a }) => a), ARTICULOS_DE_PRUEBA.map((a) => a.existencias));
  const ahora = () => new Date(Date.now() + desfaseMs).toISOString();
  m.reloj.fijar(ahora());
  const impresoras = new Map<string, ImpresoraMemoria>();
  const ultimaSync = new Map<string, string | null>();
  const servicios = new Map<string, ServicioCaja>();
  for (const c of CAJAS_ESTANDAR) {
    const id = `${c.tienda}/${c.caja}`;
    const caja = m.caja(c.tienda, c.caja);
    const imp = new ImpresoraMemoria();
    impresoras.set(id, imp);
    ultimaSync.set(id, null);
    servicios.set(id, new ServicioCaja({
      caja, actor: { rol: 'cajero', usuario: `Cajero ${c.tienda}-${c.caja}`, tienda: c.tienda, caja: c.caja }, impresora: imp,
      conexion: {
        hubAlcanzable: () => caja.enlace.hubAlcanzable(), internet: () => m.internet.get(c.tienda) !== false,
        pendientes: () => caja.repo.pendientes(`hub:${c.tienda}`).length, ultimaSync: () => ultimaSync.get(id) ?? null,
        sincronizar: () => { m.pump(); ultimaSync.set(id, ahora()); },
      },
      reloj: { now: ahora },
    }));
  }
  const admin = new ServicioAdmin({ central: m.central, actor: { rol: 'admin', usuario: 'Administración' }, fuente: () => m.central.repo.ops(), cajas: CAJAS_ESTANDAR.map((c) => ({ tienda: c.tienda, caja: c.caja })), inventario: m.inventarioCentral(), reloj: { now: ahora } });
  // Base = configuración inicial + catálogo; todo lo posterior (altas, ventas, entregas…) es lo que vale la pena conservar.
  const bases = new Map<string, number>((fab.todos?.() ?? []).map(([n, r]) => [n, r.seqMax()]));
  if (estado && estado.conInventario === !!opsCatalogo) {
    for (const [n, r] of fab.todos?.() ?? []) { const e = estado.repos[n]; if (e && r instanceof MemoriaRepo) r.importar(e); }
  }
  const exportar = (): EstadoBanco => ({ conInventario: !!opsCatalogo, repos: Object.fromEntries((fab.todos?.() ?? []).filter(([, r]) => r instanceof MemoriaRepo).map(([n, r]) => [n, (r as MemoriaRepo).exportar(bases.get(n) ?? 0)])) });
  const version = () => (fab.todos?.() ?? []).reduce((a, [, r]) => a + r.seqMax(), 0);
  return { m, servicios, admin, impresoras, ultimaSync, ahora, exportar, version };
}

export type Banco = ReturnType<typeof crearBanco>;

export { aplicarDepartamentos, DEPARTAMENTOS_BASE, aOperacionesInventario, perfilConCantidad, escribirXlsx, leerInventario, leerXlsx, PERFILES };

let desfaseMs = 0;
export function iniciarBanco(opciones: { alCambiar: () => void; estadoInicial?: EstadoBanco }) {
  let opsCatalogo: Op[] | undefined;
  let etiqueta = '';
  let muestra: { codigo: string; descripcion: string; marca: string; precio: number; item_no: string | null }[] = [];
  let banco = crearBanco(undefined, opciones.estadoInicial);
  let sesion = 'DUO/1';
  const atenderSesion = async (metodo: string, ruta: string, cuerpo: unknown) => {
    banco.m.reloj.fijar(banco.ahora());
    if (sesion === 'admin') banco.m.pump(); // Administración ve lo último que llegó al central
    const o = sesion === 'admin' ? { admin: banco.admin } : { cajero: banco.servicios.get(sesion)! };
    return atender(o, metodo, new URL(ruta, 'http://local'), (cuerpo as object) ?? {});
  };
  setInterval(() => { for (const [id, s] of banco.servicios) { void s.sincronizar(); void id; } }, 2000);
  return {
    atender: atenderSesion,
    get sesion() { return sesion; },
    // Al cambiar de sesión se entrega lo pendiente (si la red simulada lo permite), como haría la sincronización en segundo plano.
    seleccionar(id: string) { banco.m.pump(); sesion = id; opciones.alCambiar(); },
    reiniciar() { desfaseMs = 0; banco = crearBanco(opsCatalogo); opciones.alCambiar(); },
    /** Solo para probar: adelanta el reloj de toda la página de prueba (p. ej. para ver el cierre por inactividad sin esperar). */
    avanzarReloj(ms: number) { desfaseMs += ms; banco.m.reloj.fijar(banco.ahora()); },
    /** Carga un inventario importado (operaciones de catálogo y existencia de prueba) en lugar de los datos de ejemplo. */
    cargarInventario(ops: Op[], texto: string, ejemplos: typeof muestra, estado?: EstadoBanco) { opsCatalogo = ops; etiqueta = texto; muestra = ejemplos; banco = crearBanco(opsCatalogo, estado); opciones.alCambiar(); },
    /** Foto del estado para guardarla (null si no cambió desde la última vez que se pidió). */
    estadoParaGuardar(): { version: number; estado: EstadoBanco } { return { version: banco.version(), estado: banco.exportar() }; },
    /** Recupera lo guardado (altas, ventas, entregas…) sobre los datos de ejemplo. */
    restaurar(estado: EstadoBanco) { banco = crearBanco(opsCatalogo, estado); opciones.alCambiar(); },
    quitarInventario() { opsCatalogo = undefined; etiqueta = ''; muestra = []; banco = crearBanco(); opciones.alCambiar(); },
    inventarioCargado: () => ({ etiqueta, muestra, conInventario: !!opsCatalogo }),
    /** Solo para probar: simula que se escaneó un ticket de esta caja con ese folio (si supera el contador, la serie se bloquea). */
    ticketEscaneado(folio: number) { if (sesion === 'admin') return; const [t, c] = sesion.split('/'); banco.m.caja(t!, Number(c)).registrarTicketEscaneado({ tienda: t!, caja: Number(c), folio }); opciones.alCambiar(); },
    caerHub(t: string, v: boolean) { if (v) banco.m.caerHub(t); else banco.m.levantarHub(t); },
    fallaImpresora(id: string, v: boolean) { const i = banco.impresoras.get(id); if (i) i.falla = v ? 'sin papel (falla simulada)' : null; },
    tienda: () => (sesion === 'admin' ? null : sesion.split('/')[0]!),
    hubCaidoActivo: () => (sesion === 'admin' ? false : banco.m.hubCaido.has(sesion.split('/')[0]!)),
    fallaImpresoraActiva: () => banco.impresoras.get(sesion)?.falla != null,
  };
}
