// Administración conectada al central (Supabase): el MISMO servicio y pantalla de Administración, con una réplica local de la
// bitácora que se mantiene al día con el central. Quien entra se identifica con Supabase; su rol sale de pos.admins.
import { CAJAS_ESTANDAR, fabricaMemoria, Mundo } from '../mundo.ts';
import { crearPoliticasEnsayo } from '../politicas.ts';
import { MemoriaRepo, type EstadoRepo } from '../repo.ts';
import type { Op } from '../tipos.ts';
import { PuenteCentral, type ClienteCentral } from '../transporte/puente-central.ts';
import { atender } from './rutas.ts';
import { ServicioAdmin } from './servicio.ts';

export interface ClienteNube extends ClienteCentral {
  iniciarSesion(correo: string, clave: string): Promise<void>;
  miPerfil(): Promise<{ rol: 'supervisor' | 'almacenista' | 'caja'; alias: string; usuario_id: string; tienda?: string | null; caja?: number | null } | null>;
  cerrarSesion(): void;
}

/** Dónde se guarda la réplica en este equipo (IndexedDB en el navegador), una por usuario. */
export interface AlmacenReplica {
  leer(clave: string): Promise<EstadoRepo | undefined>;
  escribir(clave: string, estado: EstadoRepo): Promise<void>;
  borrar(clave: string): Promise<void>;
}

export interface EstadoNube {
  dentro: boolean;
  usuario: string | null;
  rol: 'supervisor' | 'almacenista' | null;
  pendientes: number;
  sincronizando: boolean;
  ultimaSync: string | null;
  /** Último error de sincronización (null = todo bien). */
  error: string | null;
}

export const CADA_MS = 15_000;
const claveReplica = (usuarioId: string) => `replica:${usuarioId}`;

export function iniciarAdminNube(o: { cliente: ClienteNube; almacen?: AlmacenReplica; alCambiar?: () => void; alSalir?: () => void }) {
  const { cliente } = o;
  let m: Mundo | null = null;
  let puente: PuenteCentral | null = null;
  let servicio: ServicioAdmin | null = null;
  let perfil: { rol: 'supervisor' | 'almacenista'; alias: string; usuario_id: string } | null = null;
  let ultimaSync: string | null = null;
  let error: string | null = null;
  let sincronizando = false;
  let temporizador: ReturnType<typeof setInterval> | null = null;
  let guardado = -1;

  const repo = () => m!.central.repo as MemoriaRepo;
  const ahora = () => new Date().toISOString();

  async function guardarReplica(): Promise<void> {
    if (!o.almacen || !perfil || !m) return;
    const v = repo().seqMax() + JSON.stringify(repo().kvGet('puente_central') ?? 0).length;
    if (v === guardado) return;
    guardado = v;
    await o.almacen.escribir(claveReplica(perfil.usuario_id), repo().exportar(0)).catch(() => undefined);
  }

  async function sincronizar(): Promise<boolean> {
    if (!puente) return false;
    sincronizando = true;
    o.alCambiar?.();
    const r = await puente.sincronizar();
    sincronizando = false;
    error = r.ok ? null : (r.error ?? 'sin conexión');
    if (r.ok) ultimaSync = ahora();
    await guardarReplica();
    o.alCambiar?.();
    return r.ok;
  }

  function limpiar() {
    if (temporizador) clearInterval(temporizador);
    temporizador = null;
    m = null; puente = null; servicio = null; perfil = null; guardado = -1;
    cliente.cerrarSesion();
    o.alSalir?.();
    o.alCambiar?.();
  }

  return {
    /** Inicia sesión en el central, descarga (o actualiza) la réplica y abre la sesión de Administración con el rol de pos.admins. */
    async entrar(correo: string, clave: string): Promise<{ rol: 'supervisor' | 'almacenista'; alias: string }> {
      await cliente.iniciarSesion(correo, clave);
      const p0 = await cliente.miPerfil();
      const p = p0 && p0.rol !== 'caja' ? { rol: p0.rol, alias: p0.alias, usuario_id: p0.usuario_id } : null;
      if (!p) { cliente.cerrarSesion(); throw new Error('Este usuario no tiene acceso a la Administración de LonDuo POS. Pídale a un supervisor que lo dé de alta.'); }
      perfil = p;
      m = new Mundo({
        fabrica: fabricaMemoria(),
        politicas: crearPoliticasEnsayo({
          P01_hub_no_disponible: 'vender_autonomo_con_aviso', P02_existencia_insuficiente: 'permitir_y_conciliar', P03_devolucion_venta_no_local: 'permitir_con_incidencia',
          P06_huecos_de_folio: 'no_aceptados', P07_item_no: 'a_central', P12_tarjeta_con_pendiente: 'permitir_con_aviso',
          P14_venta_con_inventario_no_verificado: 'permitir_con_aviso', K_folios: 30, K_item_no: 50,
        }),
      });
      const guardada = await o.almacen?.leer(claveReplica(p.usuario_id)).catch(() => undefined);
      if (guardada) repo().importar(guardada);
      puente = new PuenteCentral(repo(), cliente);
      servicio = new ServicioAdmin({
        central: m.central, actor: { rol: 'admin', usuario: p.alias }, fuente: () => (m ? m.central.repo.ops() : []),
        cajas: CAJAS_ESTANDAR.map((c) => ({ tienda: c.tienda, caja: c.caja })), inventario: m.inventarioCentral(), reloj: { now: ahora },
      });
      // Si la descarga inicial falla (sin internet) pero hay réplica guardada, se trabaja con ella y se reintenta solo.
      const ok = await sincronizar();
      if (!ok && !guardada) { limpiar(); throw new Error('No se pudo descargar la información del central. Revise la conexión e intente de nuevo.'); }
      servicio.abrirSesionNube(p.alias, p.rol, limpiar);
      temporizador = setInterval(() => { void sincronizar(); }, CADA_MS);
      (temporizador as { unref?: () => void }).unref?.(); // en Node (pruebas) no mantiene vivo el proceso
      o.alCambiar?.();
      return { rol: p.rol, alias: p.alias };
    },
    /** Mismo contrato que el enrutador de la página de prueba. Antes de escribir se trae lo último del central; después se sube. */
    async atender(metodo: string, ruta: string, cuerpo: unknown) {
      if (!servicio || !m) return { status: 401, json: { ok: false, error: { codigo: 'SIN_SESION', mensaje: 'inicie sesión' } } };
      const escribe = metodo !== 'GET' && /^\/api\/admin\//.test(ruta);
      if (escribe) await sincronizar();
      const r = await atender({ admin: servicio }, metodo, new URL(ruta, 'http://local'), (cuerpo as object) ?? {});
      if (escribe && r.status < 400) void sincronizar();
      return r;
    },
    sincronizar,
    salir() { if (servicio) servicio.cerrarSesion(); else limpiar(); },
    /** Borra la réplica guardada de este usuario en este equipo (la información sigue en el central). */
    async olvidarReplica() { if (o.almacen && perfil) await o.almacen.borrar(claveReplica(perfil.usuario_id)); },
    estado(): EstadoNube {
      return { dentro: servicio !== null, usuario: perfil?.alias ?? null, rol: perfil?.rol ?? null, pendientes: puente?.pendientes() ?? 0, sincronizando, ultimaSync, error };
    },
    /** Agrega operaciones hechas aquí (p. ej. la carga del catálogo desde Excel): se suben en la siguiente sincronización. */
    agregarOps(ops: Op[]): number {
      if (!m) throw new Error('sin sesión');
      let n = 0;
      repo().tx(() => { for (const op of ops) if (repo().appendOp(op)) n++; });
      void sincronizar();
      return n;
    },
    get servicio() { return servicio; },
  };
}

export type AdminNube = ReturnType<typeof iniciarAdminNube>;
