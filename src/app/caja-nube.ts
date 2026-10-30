// Caja de producción conectada al central (Supabase). Una PC = un hub local de su tienda + su caja, con el MISMO motor de siempre.
// El central (Supabase) reparte catálogo y configuración; la caja vende aunque no haya internet y sube sus ventas cuando puede.
// La identidad es la de la caja (un usuario de Supabase por caja, rol «caja» en pos.admins), no la de la cajera: las cajeras entran con su clave local.
import type { Impresora, TrabajoImpresion } from '../impresion.ts';
import type { Op } from '../tipos.ts';
import { CAJAS_ESTANDAR, fabricaMemoria, Mundo } from '../mundo.ts';
import { folioMaximoConocido, relevanteParaHub } from '../nodos.ts';
import { crearPoliticasEnsayo } from '../politicas.ts';
import { MemoriaRepo } from '../repo.ts';
import { fechaLocal } from '../util.ts';
import { lunesDe } from '../metas.ts';
import { PuenteCentral, type ClienteCentral } from '../transporte/puente-central.ts';
import { atender } from './rutas.ts';
import { ServicioCaja } from './servicio.ts';

export interface ClienteCaja extends ClienteCentral {
  iniciarSesion(correo: string, clave: string): Promise<void>;
  miPerfil(): Promise<{ rol: 'supervisor' | 'almacenista' | 'caja'; alias: string; usuario_id: string; tienda?: string | null; caja?: number | null } | null>;
  cerrarSesion(): void;
  readonly conSesion: boolean;
}

export interface IdentidadCaja { tienda: string; caja: number; usuario_id: string }
/** Almacén clave/valor de ESTE equipo (IndexedDB en el navegador). */
export interface AlmacenCaja {
  leer(clave: string): Promise<unknown>;
  escribir(clave: string, valor: unknown): Promise<void>;
  /** Quién es esta caja (se guarda al conectar; permite abrir sin internet). */
  leerIdentidad(): Promise<IdentidadCaja | undefined>;
  guardarIdentidad(id: IdentidadCaja): Promise<void>;
}
// Persistencia INCREMENTAL: cada guardado agrega un trozo con solo las operaciones nuevas de cada repositorio y luego actualiza el «meta» (que es el punto de
// confirmación). Así guardar tras cada venta cuesta lo que pesa la venta, no todo el catálogo. Si el equipo se apaga entre el trozo y el meta, el trozo se ignora.
interface MetaGuardado { trozos: number; contadas: Record<string, number>; colas: Record<string, { outbox: [string, boolean][]; kv: [string, string][] }> }
type Trozo = Record<string, Op[]>;
const COMPACTAR_DESDE = 60;

/** Impresora de la caja: manda los bytes ESC/POS al equipo (app de Windows). Sin app, el trabajo no se imprime y se avisa. */
export class ImpresoraEquipo implements Impresora {
  async imprimir(t: TrabajoImpresion): Promise<void> {
    const hw = (globalThis as { posHardware?: { imprimirRaw(b: Uint8Array): Promise<void> } }).posHardware;
    if (!hw) throw new Error('Esta pantalla no está dentro de la app de Windows: no hay impresora.');
    await hw.imprimirRaw(t.bytes);
  }
}

export interface EstadoCaja {
  dentro: boolean;
  tienda: string | null;
  caja: number | null;
  /** Operaciones que aún no llegan al central (de esta caja, del hub local o de la réplica). */
  pendientes: number;
  sincronizando: boolean;
  ultimaSync: string | null;
  /** null = todo bien; texto = último problema con el central (se sigue vendiendo). */
  error: string | null;
  /** Hay sesión vigente con el central (si no, se reintenta sola con las credenciales de la caja). */
  conectada: boolean;
}

export const CADA_MS = 10_000;

export function iniciarCajaNube(o: { cliente: ClienteCaja; almacen?: AlmacenCaja; impresora?: Impresora; alCambiar?: () => void; reloj?: { now(): string } }) {
  const { cliente } = o;
  const ahora = () => (o.reloj ? o.reloj.now() : new Date().toISOString());
  let m: Mundo | null = null;
  let puente: PuenteCentral | null = null;
  let servicio: ServicioCaja | null = null;
  let identidad: { tienda: string; caja: number; usuario_id: string } | null = null;
  let credenciales: { correo: string; clave: string } | null = null;
  let ultimaSync: string | null = null;
  let error: string | null = null;
  let sincronizando = false;
  let temporizador: ReturnType<typeof setInterval> | null = null;
  let enCurso: Promise<boolean> | null = null;

  const clave = (sufijo: string) => `caja:${identidad!.usuario_id}:${sufijo}`;
  const repos = () => (m ? (m.fabrica.todos?.() ?? []).filter((x): x is [string, MemoriaRepo] => x[1] instanceof MemoriaRepo) : []);
  const version = () => repos().reduce((a, [, r]) => a + r.seqMax(), 0);
  let meta: MetaGuardado | null = null;
  let guardando: Promise<void> = Promise.resolve();

  /** Restaura lo guardado en este equipo (repositorios completos). Devuelve false si no había nada. */
  async function cargarGuardado(): Promise<boolean> {
    if (!o.almacen) return false;
    const guardado = (await o.almacen.leer(clave('meta')).catch(() => undefined)) as MetaGuardado | undefined;
    if (!guardado) return false;
    const porRepo = new Map(repos());
    for (let i = 1; i <= guardado.trozos; i++) {
      const t = (await o.almacen.leer(clave(`t${i}`))) as Trozo | undefined;
      if (!t) throw new Error(`Falta un trozo de los datos guardados en este equipo (${i} de ${guardado.trozos}).`);
      for (const [n, ops] of Object.entries(t)) { const r = porRepo.get(n); if (r) for (const op of ops) r.appendOp(op); }
    }
    for (const [n, c] of Object.entries(guardado.colas)) porRepo.get(n)?.importar({ desde: 0, ops: [], outbox: c.outbox, kv: c.kv });
    meta = guardado;
    guardado_ = version();
    // Si se acumularon muchos trozos, se juntan en uno solo (se hace al abrir, cuando nadie está vendiendo).
    if (guardado.trozos > COMPACTAR_DESDE) {
      const junto: Trozo = Object.fromEntries(repos().map(([n, r]) => [n, r.exportar(0, true).ops]));
      await o.almacen.escribir(clave('t1'), junto);
      meta = { ...guardado, trozos: 1 };
      await o.almacen.escribir(clave('meta'), meta);
    }
    return true;
  }
  let guardado_ = -1;

  function guardarEstado(): Promise<void> {
    // Guardados en fila: nunca dos a la vez (cada uno parte de lo que dejó el anterior).
    guardando = guardando.then(async () => {
      if (!o.almacen || !identidad || !m) return;
      const v = version();
      if (v === guardado_) return;
      const previo = meta ?? { trozos: 0, contadas: {}, colas: {} };
      const trozo: Trozo = {};
      const contadas: Record<string, number> = {};
      const colas: MetaGuardado['colas'] = {};
      for (const [n, r] of repos()) {
        const desde = previo.contadas[n] ?? 0;
        const e = r.exportar(desde, true);
        if (e.ops.length) trozo[n] = e.ops;
        contadas[n] = r.seqMax();
        colas[n] = { outbox: e.outbox, kv: e.kv };
      }
      const siguiente = previo.trozos + 1;
      try {
        if (Object.keys(trozo).length) await o.almacen.escribir(clave(`t${siguiente}`), trozo);
        const nuevo: MetaGuardado = { trozos: Object.keys(trozo).length ? siguiente : previo.trozos, contadas, colas };
        await o.almacen.escribir(clave('meta'), nuevo); // punto de confirmación
        meta = nuevo;
        guardado_ = v;
      } catch { /* sin espacio o almacén cerrado: se reintenta en el siguiente ciclo */ }
    });
    return guardando;
  }

  /**
   * Los folios de ESTA caja que el central ya conoce (de este u otro equipo) no se repiten: si el central tiene un folio mayor que el contador local,
   * el contador salta después de él. Solo sube, nunca baja.
   */
  function alinearFolios() {
    if (!m || !identidad) return;
    const maximo = folioMaximoConocido(m.central.repo.ops(), identidad.tienda, identidad.caja);
    m.caja(identidad.tienda, identidad.caja).continuarFoliosDesde(maximo);
  }

  /** Ventas por día del mes calculadas en el central: la barra de metas de la caja marca lo mismo que Administración. Si falla (sin internet o sin la función), se usa el cálculo local. */
  async function totalesDelCentral(): Promise<void> {
    if (!m || !identidad || !cliente.ventasPorDia) return;
    try {
      const hoy = fechaLocal(ahora());
      const desde = [lunesDe(hoy), `${hoy.slice(0, 7)}-01`].sort()[0]!;
      const filas = await cliente.ventasPorDia(desde, hoy);
      const dias: Record<string, number> = {};
      for (const f of filas) if (f.tienda === identidad.tienda) dias[f.fecha] = (dias[f.fecha] ?? 0) + f.total;
      m.caja(identidad.tienda, identidad.caja).totalesCentral = { dias, ms: Date.parse(ahora()) };
    } catch { /* sin internet: queda el cálculo local */ }
  }

  /** Un ciclo completo: lo local sube al hub y a la réplica; la réplica se sincroniza con el central; lo nuevo del central baja al hub y a la caja. */
  function sincronizar(): Promise<boolean> {
    enCurso ??= (async () => {
      if (!m || !puente) return false;
      sincronizando = true;
      o.alCambiar?.();
      try {
        m.reloj.fijar(ahora());
        m.pump();
        if (!cliente.conSesion && credenciales) {
          try { await cliente.iniciarSesion(credenciales.correo, credenciales.clave); } catch (e) { throw new Error(`sin conexión con el central: ${e instanceof Error ? e.message : String(e)}`); }
        }
        const r = await puente.sincronizar();
        m.pump();
        m.pump();
        error = r.ok ? null : (r.error ?? 'sin conexión');
        if (r.ok) { ultimaSync = ahora(); alinearFolios(); await totalesDelCentral(); }
        return r.ok;
      } catch (e) {
        error = e instanceof Error ? e.message : String(e);
        return false;
      } finally {
        await guardarEstado();
        sincronizando = false;
        o.alCambiar?.();
      }
    })().finally(() => { enCurso = null; });
    return enCurso;
  }

  return {
    /**
     * Inicia sesión con la cuenta de ESTA caja, recupera lo guardado en el equipo y sincroniza. Sin internet pero con datos guardados, la caja abre y vende;
     * sin datos guardados necesita internet la primera vez (para descargar el catálogo).
     */
    async entrar(correo: string, clave: string): Promise<{ tienda: string; caja: number }> {
      credenciales = { correo, clave };
      let perfil: Awaited<ReturnType<ClienteCaja['miPerfil']>> = null;
      let sinRed: string | null = null;
      try {
        await cliente.iniciarSesion(correo, clave);
        perfil = await cliente.miPerfil();
      } catch (e) {
        const texto = e instanceof Error ? e.message : String(e);
        if (/revisa correo y contraseña/.test(texto)) throw e; // credenciales mal: no es un problema de red
        sinRed = texto;
      }
      if (!sinRed) {
        if (!perfil) { cliente.cerrarSesion(); throw new Error('Esta cuenta no está dada de alta como caja. Pídale a un supervisor que la registre.'); }
        if (perfil.rol !== 'caja' || !perfil.tienda || !perfil.caja) { cliente.cerrarSesion(); throw new Error('Esta cuenta no es de una caja: use la cuenta de la caja, no la de Administración.'); }
      }
      // Sin red al arrancar: la identidad sale de lo último guardado en este equipo.
      const id: IdentidadCaja | undefined = !sinRed && perfil ? { tienda: perfil.tienda!, caja: perfil.caja!, usuario_id: perfil.usuario_id } : await o.almacen?.leerIdentidad();
      if (!id) throw new Error(`No se pudo conectar con el central${sinRed ? ` (${sinRed})` : ''}. La primera vez hace falta internet para descargar el catálogo.`);
      identidad = id;
      m = new Mundo({
        fabrica: fabricaMemoria(),
        politicas: crearPoliticasEnsayo({
          P01_hub_no_disponible: 'vender_autonomo_con_aviso', P02_existencia_insuficiente: 'permitir_y_conciliar', P03_devolucion_venta_no_local: 'permitir_con_incidencia',
          P06_huecos_de_folio: 'no_aceptados', P07_item_no: 'a_central', P12_tarjeta_con_pendiente: 'permitir_con_aviso',
          P14_venta_con_inventario_no_verificado: 'permitir_con_aviso', K_folios: 30, K_item_no: 50,
        }),
      });
      const guardada = await cargarGuardado();
      if (!guardada && sinRed) { m = null; identidad = null; throw new Error('Sin internet y sin datos guardados en este equipo: no se puede abrir la caja todavía.'); }
      if (!sinRed) await o.almacen?.guardarIdentidad(id).catch(() => undefined);
      puente = new PuenteCentral(m.central.repo, cliente);
      const tienda = id.tienda;
      // Lo que baja del central y le toca a esta tienda se reparte al hub (y de ahí a la caja) con la misma cola de siempre.
      puente.alBajar = (ops) => { for (const op of ops) if (relevanteParaHub(op, tienda)) m!.central.repo.encolar(op.op_id, `hub:${tienda}`); };
      m.reloj.fijar(ahora());
      const caja = m.caja(id.tienda, id.caja);
      servicio = new ServicioCaja({
        caja, actor: { rol: 'cajero', usuario: `Caja ${id.tienda}-${id.caja}`, tienda: id.tienda, caja: id.caja }, impresora: o.impresora ?? new ImpresoraEquipo(),
        conexion: {
          hubAlcanzable: () => caja.enlace.hubAlcanzable(), internet: () => (cliente.conSesion && error === null ? true : error ? false : null),
          pendientes: () => (m ? m.pendientesTotales() : 0) + (puente ? puente.pendientes() : 0), ultimaSync: () => ultimaSync,
          sincronizar: () => { void sincronizar(); },
        },
        reloj: { now: ahora },
      });
      // Con datos guardados la caja abre YA (aunque la red tarde o no conteste); sin ellos hay que esperar la primera descarga.
      const ok = guardada ? true : await sincronizar();
      // Equipo sin datos propios (PC nueva, disco vacío) para una caja que ya vendió: la serie de folios sigue donde la dejó la anterior.
      if (!guardada && ok) alinearFolios();
      if (guardada) void sincronizar();
      if (!ok && !guardada) { const e = error; m = null; puente = null; servicio = null; identidad = null; throw new Error(`No se pudo descargar el catálogo del central${e ? `: ${e}` : ''}. Revise la conexión e intente de nuevo.`); }
      temporizador = setInterval(() => { void sincronizar(); }, CADA_MS);
      (temporizador as { unref?: () => void }).unref?.();
      o.alCambiar?.();
      return { tienda: id.tienda, caja: id.caja };
    },
    async atender(metodo: string, ruta: string, cuerpo: unknown) {
      if (!servicio || !m) return { status: 401, json: { ok: false, error: { codigo: 'SIN_SESION', mensaje: 'La caja no está abierta.' } } };
      m.reloj.fijar(ahora());
      const r = await atender({ cajero: servicio }, metodo, new URL(ruta, 'http://local'), (cuerpo as object) ?? {});
      if (metodo !== 'GET' && r.status < 400 && !/^\/api\/(actividad|login|logout)/.test(ruta)) {
        await guardarEstado(); // lo vendido queda en el disco ANTES de contestar, sin esperar a la red
        void sincronizar();
      }
      return r;
    },
    sincronizar,
    guardarEstado,
    detener() { if (temporizador) clearInterval(temporizador); temporizador = null; },
    estado(): EstadoCaja {
      return {
        dentro: servicio !== null, tienda: identidad?.tienda ?? null, caja: identidad?.caja ?? null, pendientes: (m ? m.pendientesTotales() : 0) + (puente ? puente.pendientes() : 0),
        sincronizando, ultimaSync, error, conectada: cliente.conSesion,
      };
    },
    get servicio() { return servicio; },
    get mundo() { return m; },
  };
}

export type CajaNube = ReturnType<typeof iniciarCajaNube>;
export { CAJAS_ESTANDAR };
