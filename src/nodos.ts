import type { BusquedaVentas, VentaLocalizada } from './consultas.ts';
import { ErrorDominio } from './errores.ts';
import { buscarRecompensa, esCodigoRecompensa, promoDeRecompensa, recompensasGanadas, reglasVigentes, validarRegla, type EstadoRecompensa, type ReglaRecompensa } from './recompensas.ts';
import { calcularDescuentos, type ConfigVip, esCanje, aPesosEnteros, normCodigo, repartir, repartirPesos, validarPromocion, type ErrorPromo, type Promocion, type ResultadoDescuentos } from './promociones.ts';
/** Quien autoriza: otra persona (nombre + clave) o, si no hay nadie más, quien cobra con su propia clave (`sin_segundo`). */
export type Autoriza = { nombre: string; clave: string; sin_segundo?: boolean };
import { adminDueno, adminProtegido, mezclarPerfil, claveAdminValida, claveValida, hashClave, nombreClave, supervisorPorClave, type Cajero, type Perfil, type RolAdmin, type Supervisor } from './supervisores.ts';
import { correccionesEntradas } from './almacen.ts';
import type { GastoRegistrado } from './gastos.ts';
import { estimarFeria, type ReporteFeria } from './feria.ts';
import { BILLETES_RETIRO_MXN, BILLETES_RETIRO_USD, efectivoDeVentaEnCaja, MINIMO_RETIRO, UMBRAL_AVISO_RETIRO, type RetiroRegistrado } from './retiros.ts';
import { DESTINOS_FALTANTE_ESPECIALES, existenciaAlmacen, faltantes, fechaValida, recepcionesPendientes, type Faltante, type AltaManual, type RecepcionPendiente } from './almacen.ts';
import { slug, validarCambioDepto, type CambioDepto, type ErrorDepto } from './departamentos.ts';
import { DENOMINACIONES_USD, esImporteEnBilletesUsd, superaUmbralTasa, totalDenominacionesMxn, totalDenominacionesUsd, usdAMxn, variacionTasaPb } from './dinero.ts';
import { TASA_SIN_VERIFICAR_OMISION, type Politicas } from './politicas.ts';
import { Indice } from './indice.ts';
import { localizarVentas } from './consultas.ts';
import { addDias } from './util.ts';
import { mesesVigenciaTarjetas, sumarMeses, historicasDuplicadas, reglasDuplicadosHistoricos, type ReglaDuplicadosHistoricos } from './proyecciones.ts';
import { avanceMetas, CONFIG_METAS_INICIAL, historicoPorDia, horaValida, lunesDe, metasDias, metasPublicadas, totalesPorDia, type AvancePeriodo, type ConfigMetas, type MetaTienda, type MetasPublicadas, type PeriodoMeta } from './metas.ts';
import { CRITERIOS_EXPEDIENTE, expedientesDe, expedienteVacio, clientesVip, excepcionesVip, type ClienteVip, type ExcepcionesVip, type Expediente } from './proyecciones.ts';
import { type ConfigEmpleadas, type CuentaEmpleada, configEmpleadas, cuentasEmpleadas, CAMPOS_EDITABLES, CAMPOS_TIENDA, type CampoEditable, departamentos, promocionesDe, recompensasDe, supervisoresDe, cajerosDe, personalConCuenta, administradoresDe, efectivoDeVenta, movimientosCaja, tipoCambioVigente, catalogo, devoluciones, devueltoPorLinea, existenciaVerificada, intentos, perdidasDocumentales, stock, ventas, type Devolucion, type ExistenciaVerificada, type Intento, type PerdidaDocumental, type TarjetaRegalo, type TipoCambio } from './proyecciones.ts';
import type { Repo } from './repo.ts';
import { validarOpEntrante } from './reglas.ts';
import { LIMBO, type Articulo, type CajaCfg, type Linea, type Op, type Pago, type Venta } from './tipos.ts';
import { crearOp, fechaLocal, uuid } from './util.ts';
import { idVentaHistorica, payloadVentaHistorica, type VentaHistorica } from './ventas-historicas.ts';

export interface Ctx {
  reloj: { now(): string };
  /** Parámetro técnico (no comercial): vigencia de una reserva del hub que nadie confirmó. */
  ttlReservaMs: number;
  politicas: Politicas;
  cajasCfg: CajaCfg[];
  tiendas: string[];
  catalogoCompartido: boolean;
  /** Inyección de fallos dentro de transacciones (pruebas de atomicidad). */
  fallo?: (punto: string) => void;
}

export interface Anclas {
  ceiling: number | null;
  hwm: number;
  fuente: string;
}

/** Lo que una caja puede pedirle a su hub / al central. Devuelve null si el destino no es alcanzable. */
export interface Enlace {
  hubAlcanzable(): boolean;
  arrendarFolios(ultimo: number, k: number): number | null;
  anclasFolios(): Anclas | null;
  bloqueItemNo(k: number): { desde: number; hasta: number } | null;
  consultarVenta(saleId: string): Venta | null;
  devueltoAutoritativo(saleId: string): Map<string, { qty: number; importe: number }> | null;
  /** Qué sabe el hub de un cupón de recompensa (emisión, canje, cancelación) con las ventas de las dos cajas. null = sin hub. */
  consultarRecompensa(codigo: string): EstadoRecompensa | null;
  /** Arbitraje del hub sobre existencias. null = el hub no respondió. Idempotente por `ref`. */
  reservar(ref: string, caja: number, lineas: { item_id: string; qty: number }[], tarjetas?: TarjetaApartada[]): ResultadoReserva | null;
  liberar(ref: string): void;
  /** Ventas de la tienda (todas sus cajas) para localizar en qué caja se hizo una; null = sin hub. */
  buscarVentas(q: BusquedaVentas): VentaLocalizada[] | null;
  /** Total vendido por día de la tienda (las dos cajas), entre dos fechas AAAA-MM-DD. Opcional: sin hub se usa solo lo de esta caja. */
  totalesVentas?(desde: string, hasta: string): Record<string, number> | null;
  /** Fija el tipo de cambio global en el servicio central. null = sin conexión con el central. */
  fijarTipoCambio(tasa: number, usuario: string, versionBase: number, confirmarVariacion?: boolean): ResultadoTipoCambio | null;
}

export interface ResultadoTipoCambio {
  ok: boolean;
  motivo?: 'tasa_invalida' | 'config_desactualizada' | 'confirmacion_requerida';
  /** Variación en puntos base respecto a la vigente (positiva = sube). */
  variacion_pb?: number;
  op?: Op;
  vigente?: TipoCambio | null;
}

/** Saldo de una tarjeta de regalo que una venta en curso aparta (el dinero no se puede conceder dos veces). */
export interface TarjetaApartada {
  codigo: string;
  monto: number;
}

export interface ResultadoReserva {
  ok: boolean;
  motivo?: string;
  /** Artículos con existencia insuficiente que se concedieron de todos modos (P-02=permitir_y_conciliar). */
  sobreventa?: string[];
  faltantes?: string[];
  /** Tarjetas de regalo sin saldo suficiente o inexistentes. */
  tarjetas_sin_saldo?: string[];
  /** Tarjetas de regalo vencidas (12 meses desde la venta o la última recarga). */
  tarjetas_vencidas?: string[];
  idempotente?: boolean;
}

interface Reserva {
  ref: string;
  caja: number;
  lineas: { item_id: string; qty: number }[];
  tarjetas?: TarjetaApartada[];
  hasta: number;
  estado: 'abierta' | 'cerrada' | 'liberada';
  resultado: ResultadoReserva;
}

/** Lo que se vende de El Limbo descuenta una existencia compartida: todas las tiendas y cajas deben enterarse. */
const esMovimientoLimbo = (op: Op) => op.tipo === 'inv.movement' && op.payload.tienda === LIMBO;
/** Corrección de existencias hecha por el propietario en Administración: la tienda y sus cajas deben enterarse (no pasa por la confirmación de recepción). */
const esAjusteAdmin = (op: Op) => (op.tipo === 'inv.movement' && op.payload.tipo === 'ajuste_admin') || (op.tipo === 'inv.conteo' && op.payload.admin === true);
const BROADCAST_TIENDA = new Set(['cajero.ubicacion', 'alm.recibida', 'inv.movement', 'inv.conteo', 'inv.verificacion_pendiente', 'doc.perdida_posible', 'item.created', 'item.item_no_assigned', 'giftcard.emitida', 'giftcard.recarga', 'giftcard.uso', 'giftcard.reintegro']);
// Lo que el central baja a hubs y cajas (catálogo y resoluciones administrativas).
const CATALOGO = new Set(['cajero.ubicacion', 'item.created', 'item.item_no_assigned', 'item.codigo_corregido', 'doc.perdida_resuelta', 'giftcard.emitida', 'giftcard.recarga', 'giftcard.uso', 'giftcard.reintegro', 'config.tipo_cambio', 'permiso.asignado', 'depto.alta', 'depto.editado', 'alm.entrega', 'alm.faltante', 'promo.guardada', 'recompensa.guardada', 'supervisor.guardado', 'cajero.guardado', 'config.sesion', 'config.negocio', 'item.editado', 'caja.fondo_autorizado', 'cash.ajuste_admin', 'empleadas.config', 'empleada.credito', 'empleada.movimiento', 'venta.consulta', 'folio.continuacion', 'vip.guardado', 'vip.excepciones', 'metas.config', 'giftcard.config', 'caja.limite_efectivo']);
/** Días de ventas del POS anterior que las cajas conservan para consulta. */
export const DIAS_CONSULTA_HISTORICA = 60;
/** Fondo fijo de cada caja mientras Administración no asigne otro (centavos). */
export const FONDO_AUTORIZADO_DEFECTO = 500000;
/** Monedas y billetes con los que se cuenta el fondo (en centavos): sin la moneda de 50 centavos. */
export const DENOMINACIONES_FONDO = [100000, 50000, 20000, 10000, 5000, 2000, 1000, 500, 200, 100] as const;

/** Lo que llega del central (Supabase) y debe repartirse al hub de esa tienda: catálogo y configuración, El Limbo y lo de inventario/almacén/tarjetas de la tienda. */
export function relevanteParaHub(op: Op, tienda: string): boolean {
  if (CATALOGO.has(op.tipo) || esMovimientoLimbo(op)) return true;
  // Las ventas de la OTRA caja de la tienda (otro equipo, su propio hub): sin ellas la barra de metas de cada caja solo cuenta lo que cobró ella.
  if ((op.tipo === 'sale.confirmed' || op.tipo === 'sale.cancelled') && op.tienda === tienda) return true;
  const inventario = op.tipo.startsWith('inv.') || op.tipo.startsWith('doc.') || op.tipo.startsWith('giftcard.') || op.tipo.startsWith('alm.');
  return inventario && op.payload?.tienda === tienda;
}

/**
 * Mayor folio de una caja que el central ya conoce: ventas de esa caja, huecos documentados y la continuación del sistema anterior (`folio.continuacion`,
 * que Administración emite al importar las ventas viejas). El contador de la caja nunca queda por debajo.
 */
export function folioMaximoConocido(ops: Op[], tienda: string, caja: number): number {
  let maximo = 0;
  for (const op of ops) {
    if (op.tipo === 'folio.continuacion') { if (op.payload.tienda === tienda && op.payload.caja === caja) maximo = Math.max(maximo, Number(op.payload.hasta) || 0); continue; }
    if (op.tienda !== tienda || op.caja !== caja) continue;
    if (op.tipo === 'sale.confirmed') { if (!op.payload.serie) maximo = Math.max(maximo, Number(op.payload.folio) || 0); }
    else if (op.tipo === 'folio.gap') maximo = Math.max(maximo, Number(op.payload.hasta) || 0);
  }
  return maximo;
}

// ───────────────────────────── Hub ─────────────────────────────

export class Hub {
  readonly id: string;
  readonly tienda: string;
  readonly repo: Repo;
  readonly ctx: Ctx;
  private idx: Indice;
  constructor(tienda: string, repo: Repo, ctx: Ctx) {
    this.idx = new Indice(repo);
    this.id = `hub:${tienda}`;
    this.tienda = tienda;
    this.repo = repo;
    this.ctx = ctx;
  }
  destinos(): string[] {
    return ['central', ...this.ctx.cajasCfg.filter((c) => c.tienda === this.tienda).map((c) => `caja:${c.tienda}/${c.caja}`)];
  }
  private cajasDeTienda() {
    return this.ctx.cajasCfg.filter((c) => c.tienda === this.tienda).map((c) => c.caja);
  }

  recibir(op: Op, desde: string): void {
    if (this.repo.tieneOp(op.op_id)) return; // deduplicación: se confirma sin reprocesar
    const rech = validarOpEntrante(op, this.ctx.cajasCfg);
    this.repo.tx(() => {
      if (rech) {
        const r = crearOp('op.rechazada', op.tienda, op.caja, this.id, this.ctx.reloj.now(), { op_id: op.op_id, tipo: op.tipo, motivo: rech, op }, `rej:${op.op_id}`);
        if (this.repo.appendOp(r)) this.repo.encolar(r.op_id, 'central');
        return;
      }
      this.repo.appendOp(op);
      if (op.tipo === 'inv.movement' && op.payload.tipo === 'venta') this.consumirReserva(op.payload.doc, op.payload.item_id, -op.payload.delta);
      if (op.tipo === 'giftcard.uso') this.consumirTarjeta(op.payload.sale_id, op.payload.codigo);
      if (desde.startsWith('caja:')) {
        this.repo.encolar(op.op_id, 'central');
        if (BROADCAST_TIENDA.has(op.tipo)) {
          for (const n of this.cajasDeTienda()) if (`caja:${this.tienda}/${n}` !== desde) this.repo.encolar(op.op_id, `caja:${this.tienda}/${n}`);
        }
      } else if (desde === 'central' && (CATALOGO.has(op.tipo) || esMovimientoLimbo(op) || esAjusteAdmin(op))) {
        for (const n of this.cajasDeTienda()) this.repo.encolar(op.op_id, `caja:${this.tienda}/${n}`);
      }
    });
  }

  // ── arbitraje de existencias ──
  private reservas(): Reserva[] {
    return this.repo.kvGet<Reserva[]>('reservas') ?? [];
  }
  /**
   * Serializa la concesión de existencias entre cajas. Disponible = saldo del hub − reservas abiertas y vigentes.
   * La reserva se cierra renglón por renglón cuando llega el movimiento de venta correspondiente, así que no hay
   * ventana en la que la pieza esté libre mientras la venta viaja de la caja al hub.
   */
  reservar(ref: string, caja: number, lineas: { item_id: string; qty: number }[], tarjetas: TarjetaApartada[] = []): ResultadoReserva {
    const ahora = Date.parse(this.ctx.reloj.now());
    const previa = this.reservas().find((r) => r.ref === ref);
    // Solo se repite la respuesta de lo que sigue vigente (reserva abierta o ya consumida por su venta).
    // Un rechazo, una liberación o una vigencia vencida se vuelven a evaluar: reintentar no hereda un "no" viejo
    // ni un "sí" que ya no aparta existencia.
    const mismasTarjetas = JSON.stringify(previa?.tarjetas ?? []) === JSON.stringify(tarjetas);
    if (previa && mismasTarjetas && (previa.estado === 'cerrada' || (previa.estado === 'abierta' && previa.hasta > ahora))) return { ...previa.resultado, idempotente: true };
    const todas = this.reservas().filter((r) => r.ref !== ref);
    const abiertas = todas.filter((r) => r.estado === 'abierta' && r.hasta > ahora);
    const pedido = new Map<string, number>();
    for (const l of lineas) pedido.set(l.item_id, (pedido.get(l.item_id) ?? 0) + l.qty);
    const faltantes: string[] = [];
    for (const [item, q] of pedido) {
      const apartado = abiertas.reduce((a, r) => a + r.lineas.filter((l) => l.item_id === item).reduce((b, l) => b + l.qty, 0), 0);
      if (this.idx.disponible(this.tienda, item) - apartado < q) faltantes.push(item);
    }
    // Dinero: una tarjeta de regalo nunca se sobregira (no depende de P-02, que es solo de existencias).
    const sinSaldo: string[] = [];
    const vencidas: string[] = [];
    const porTarjeta = new Map<string, number>();
    for (const t of tarjetas) porTarjeta.set(t.codigo, (porTarjeta.get(t.codigo) ?? 0) + t.monto);
    for (const [codigo, monto] of porTarjeta) {
      const apartado = abiertas.reduce((a, r) => a + (r.tarjetas ?? []).filter((t) => t.codigo === codigo).reduce((b, t) => b + t.monto, 0), 0);
      const tj = this.idx.tarjeta(codigo);
      if (tj && Date.parse(tj.vigente_hasta) <= ahora) vencidas.push(codigo);
      else if ((tj?.saldo ?? 0) - apartado < monto) sinSaldo.push(codigo);
    }
    if (vencidas.length) {
      this.repo.kvSet('reservas', todas);
      return { ok: false, motivo: 'tarjeta_vencida', tarjetas_vencidas: vencidas };
    }
    if (sinSaldo.length) {
      this.repo.kvSet('reservas', todas);
      return { ok: false, motivo: 'tarjeta_sin_saldo', tarjetas_sin_saldo: sinSaldo };
    }
    if (faltantes.length && this.ctx.politicas.P02_existencia_insuficiente === 'bloquear') {
      this.repo.kvSet('reservas', todas); // un rechazo no se guarda
      return { ok: false, motivo: 'existencia_insuficiente', faltantes };
    }
    const resultado: ResultadoReserva = faltantes.length ? { ok: true, sobreventa: faltantes } : { ok: true };
    this.repo.kvSet('reservas', [...todas, { ref, caja, lineas: [...pedido].map(([item_id, qty]) => ({ item_id, qty })), tarjetas: [...porTarjeta].map(([codigo, monto]) => ({ codigo, monto })), hasta: ahora + this.ctx.ttlReservaMs, estado: 'abierta' as const, resultado }]);
    return resultado;
  }
  liberar(ref: string): void {
    this.repo.kvSet('reservas', this.reservas().map((r) => (r.ref === ref && r.estado === 'abierta' ? { ...r, estado: 'liberada' as const } : r)));
  }
  private consumirReserva(ref: string, itemId: string, qty: number) {
    const todas = this.reservas();
    if (!todas.some((r) => r.ref === ref && r.estado === 'abierta')) return;
    this.repo.kvSet('reservas', todas.map((r) => {
      if (r.ref !== ref || r.estado !== 'abierta') return r;
      const lineas = r.lineas.map((l) => (l.item_id === itemId ? { ...l, qty: Math.max(0, l.qty - qty) } : l)).filter((l) => l.qty > 0);
      return lineas.length || r.tarjetas?.length ? { ...r, lineas } : { ...r, lineas, estado: 'cerrada' as const };
    }));
  }
  private consumirTarjeta(ref: string, codigo: string) {
    const todas = this.reservas();
    if (!todas.some((r) => r.ref === ref && r.estado === 'abierta')) return;
    this.repo.kvSet('reservas', todas.map((r) => {
      if (r.ref !== ref || r.estado !== 'abierta') return r;
      const tarjetas = (r.tarjetas ?? []).filter((t) => t.codigo !== codigo);
      return r.lineas.length || tarjetas.length ? { ...r, tarjetas } : { ...r, tarjetas, estado: 'cerrada' as const };
    }));
  }
  reservasAbiertas(): Reserva[] {
    const ahora = Date.parse(this.ctx.reloj.now());
    return this.reservas().filter((r) => r.estado === 'abierta' && r.hasta > ahora);
  }

  /**
   * Tras reconstruir este hub desde el central abre DOS registros separados: existencias no verificadas (se cierran con
   * conteo físico) y pérdida documental posible (no se cierra con conteo).
   */
  registrarRehidratacion(informe: object) {
    const inv = crearOp('inv.verificacion_pendiente', this.tienda, null, this.id, this.ctx.reloj.now(), { tienda: this.tienda, caja: null, motivo: 'hub_reconstruido_desde_central', ...informe });
    const doc = crearOp('doc.perdida_posible', this.tienda, null, this.id, this.ctx.reloj.now(), { tienda: this.tienda, caja: null, alcance: 'ventas_pagos_y_folios_de_las_cajas_y_del_hub', folios_sin_evidencia: null, evidencia: 'ninguna', ...informe });
    for (const op of [inv, doc]) {
      if (this.repo.appendOp(op)) {
        this.repo.encolar(op.op_id, 'central');
        for (const n of this.cajasDeTienda()) this.repo.encolar(op.op_id, `caja:${this.tienda}/${n}`);
      }
    }
    return { inventario: inv, documental: doc };
  }

  hwm(caja: number): number {
    let m = 0;
    for (const o of this.repo.opsDeTipos(['sale.confirmed', 'return.registered'])) if (o.payload.tienda === this.tienda && o.payload.caja === caja && o.payload.folio != null && !o.payload.serie) m = Math.max(m, o.payload.folio);
    return m;
  }
  anclas(caja: number): Anclas {
    return { ceiling: this.repo.kvGet<number>(`techo:${caja}`) ?? null, hwm: this.hwm(caja), fuente: 'hub' };
  }
  /** Concede un techo de folios. Se persiste ANTES de entregarse a la caja. */
  arrendar(caja: number, ultimo: number, k: number): number {
    const techo = Math.max(this.repo.kvGet<number>(`techo:${caja}`) ?? 0, ultimo, this.hwm(caja)) + k;
    this.repo.tx(() => {
      this.repo.kvSet(`techo:${caja}`, techo);
      const op = crearOp('folio.lease_granted', this.tienda, caja, this.id, this.ctx.reloj.now(), { tienda: this.tienda, caja, techo });
      this.repo.appendOp(op);
      this.repo.encolar(op.op_id, 'central');
    });
    return techo;
  }
}

// ───────────────────────────── Central ─────────────────────────────

export class Central {
  readonly id = 'central';
  readonly repo: Repo;
  readonly ctx: Ctx;
  constructor(repo: Repo, ctx: Ctx) {
    this.repo = repo;
    this.ctx = ctx;
  }
  destinos(): string[] {
    return this.ctx.tiendas.map((t) => `hub:${t}`);
  }
  private maxItemNoNumerico(): number {
    let m = 0;
    for (const a of catalogo(this.repo.ops()).values()) if (a.item_no != null && /^\d+$/.test(a.item_no)) m = Math.max(m, Number(a.item_no));
    return m;
  }

  recibir(op: Op, desde: string): void {
    if (this.repo.tieneOp(op.op_id)) return;
    const rech = validarOpEntrante(op, this.ctx.cajasCfg);
    this.repo.tx(() => {
      if (rech) {
        this.repo.appendOp(crearOp('op.rechazada', op.tienda, op.caja, this.id, this.ctx.reloj.now(), { op_id: op.op_id, tipo: op.tipo, motivo: rech, op }, `rej:${op.op_id}`));
        return;
      }
      this.repo.appendOp(op);
      // P-23 (ensayo): una tarjeta de regalo vale en las dos tiendas, así que el central reparte su libro mayor a los demás hubs.
      if (op.tipo.startsWith('giftcard.') && (this.ctx.politicas.P23_tarjeta_regalo_entre_tiendas ?? 'solo_tienda_emisora') === 'compartida') {
        for (const t of this.ctx.tiendas) if (`hub:${t}` !== desde) this.repo.encolar(op.op_id, `hub:${t}`);
      }
      if (esMovimientoLimbo(op) || op.tipo === 'cajero.ubicacion') for (const t of this.ctx.tiendas) if (`hub:${t}` !== desde) this.repo.encolar(op.op_id, `hub:${t}`);
      if (op.tipo === 'item.created') {
        if (this.ctx.catalogoCompartido) for (const t of this.ctx.tiendas) if (`hub:${t}` !== desde) this.repo.encolar(op.op_id, `hub:${t}`);
        if (this.ctx.politicas.P07_item_no === 'a_central' && op.payload.item_no == null) {
          // Estrategia (a): consecutivo asignado por el central, en orden de llegada, sin saltos.
          const asign = crearOp('item.item_no_assigned', null, null, this.id, this.ctx.reloj.now(),
            { item_id: op.payload.item_id, item_no: String(this.maxItemNoNumerico() + 1) }, `itemno:${op.payload.item_id}`);
          this.repo.appendOp(asign);
          for (const t of this.ctx.tiendas) this.repo.encolar(asign.op_id, `hub:${t}`);
        }
      }
    });
  }

  /** Consola de Administración: operaciones del central que se propagan a todos los hubs y cajas. */
  emitirAdmin(tipo: string, payload: unknown, opId?: string): Op {
    const op = crearOp(tipo, null, null, this.id, this.ctx.reloj.now(), payload, opId);
    this.repo.tx(() => {
      this.repo.appendOp(op);
      for (const t of this.ctx.tiendas) this.repo.encolar(op.op_id, `hub:${t}`);
    });
    return op;
  }

  /**
   * Tipo de cambio comercial (MXN por 1 USD ×10000) fijado por el negocio. Solo el central le asigna VERSIÓN (consecutiva):
   * quien edita parte de la versión que vio (`versionBase`); si el central ya tiene otra, rechaza para que una edición vieja no pise una nueva.
   */
  fijarTipoCambio(tasa: number, usuario: string, versionBase: number, confirmarVariacion = false): ResultadoTipoCambio {
    const vigente = tipoCambioVigente(this.repo.ops());
    if (!Number.isInteger(tasa) || tasa <= 0) return { ok: false, motivo: 'tasa_invalida', vigente };
    if (versionBase !== (vigente?.version ?? 0)) return { ok: false, motivo: 'config_desactualizada', vigente };
    // Un cambio mayor al 10 % pide una confirmación adicional (no una doble autorización): queda registrado en el historial.
    const variacion_pb = vigente ? variacionTasaPb(vigente.tasa, tasa) : 0;
    const grande = !!vigente && superaUmbralTasa(vigente.tasa, tasa);
    if (grande && !confirmarVariacion) return { ok: false, motivo: 'confirmacion_requerida', vigente, variacion_pb };
    const version = (vigente?.version ?? 0) + 1;
    const op = this.emitirAdmin('config.tipo_cambio', { version, tasa, usuario, variacion_pb, variacion_confirmada: grande, anterior: vigente ? { version: vigente.version, tasa: vigente.tasa } : null }, `config.tipo_cambio:v${version}`);
    return { ok: true, op, vigente: { version, tasa, usuario, ocurrio_en: op.ocurrio_en, anterior: vigente ? { version: vigente.version, tasa: vigente.tasa } : null } };
  }
  /** Permiso por usuario (p. ej. `editar_tipo_cambio`), configurable desde Administración y propagado a todas las cajas. */
  asignarPermiso(usuario: string, permiso: string, valor: boolean, por: string): Op {
    return this.emitirAdmin('permiso.asignado', { usuario, permiso, valor, por });
  }

  /**
   * Alta o edición de un departamento (renombrar, activar/desactivar, alias). Renombrar actualiza los artículos que lo usan.
   * Sin `id` es un alta. El central valida que nombres y alias no se repitan entre departamentos.
   */
  guardarDepto(c: CambioDepto, por: string): { ok: true; op: Op } | { ok: false; error: ErrorDepto } {
    const lista = departamentos(this.repo.ops());
    const error = validarCambioDepto(lista, c);
    if (error) return { ok: false, error };
    if (!c.id) {
      const nombre = c.nombre!.trim().replace(/\s+/g, ' ');
      const id = slug(nombre);
      return { ok: true, op: this.emitirAdmin('depto.alta', { id, nombre, alias: (c.alias ?? []).map((a) => a.trim()).filter(Boolean), por }) };
    }
    const actual = lista.find((d) => d.id === c.id)!;
    const payload: Record<string, unknown> = { id: c.id, por };
    if (c.nombre !== undefined && c.nombre.trim().replace(/\s+/g, ' ') !== actual.nombre) { payload.nombre = c.nombre.trim().replace(/\s+/g, ' '); payload.nombre_anterior = actual.nombre; }
    if (c.activo !== undefined && c.activo !== actual.activo) payload.activo = c.activo;
    if (c.alias) payload.alias = c.alias.map((a) => a.trim()).filter(Boolean);
    return { ok: true, op: this.emitirAdmin('depto.editado', payload) };
  }

  /**
   * Edición de un artículo del catálogo desde Administración (marca, descripción, estilo, lote, departamento y precio). Queda
   * registrada con el valor anterior y el nuevo (historial) y llega a todas las cajas. El código no se edita aquí. Un cambio de
   * precio vale para las ventas siguientes: lo ya vendido conserva su precio.
   */
  editarArticulo(itemId: string, nuevos: Partial<Record<CampoEditable, string | number>>, por: string): Articulo {
    const actual = catalogo(this.repo.ops()).get(itemId);
    if (!actual) throw new ErrorDominio('ARTICULO_INEXISTENTE', itemId);
    const activos = departamentos(this.repo.ops()).filter((d) => d.activo).map((d) => d.nombre);
    const cambios: Record<string, { antes: unknown; despues: unknown }> = {};
    for (const campo of CAMPOS_EDITABLES) {
      if (!(campo in nuevos)) continue;
      const v = nuevos[campo];
      if (campo === 'precio') {
        if (typeof v !== 'number' || !Number.isInteger(v) || v < 0) throw new ErrorDominio('PRECIO_INVALIDO', 'el precio debe ser un importe en pesos de 0 en adelante');
        if (v !== actual.precio) cambios.precio = { antes: actual.precio, despues: v };
        continue;
      }
      const t = String(v ?? '').trim().replace(/\s+/g, ' ');
      if (campo === 'departamento' && t !== actual.departamento && !activos.includes(t)) throw new ErrorDominio('DEPARTAMENTO_INVALIDO', `el departamento «${t}» no existe o está desactivado`);
      if (t !== (actual as any)[campo]) cambios[campo] = { antes: (actual as any)[campo], despues: t };
    }
    if (!Object.keys(cambios).length) return actual;
    this.emitirAdmin('item.editado', { item_id: itemId, cambios, por });
    return { ...actual, ...Object.fromEntries(Object.entries(cambios).map(([k, c]) => [k, c.despues])) } as Articulo;
  }

  /**
   * Datos de una tienda (nombre comercial, razón social, RFC, dirección, ciudad, teléfono y política de devolución): salen en el
   * ticket y las imágenes de cupón. Solo cambian los campos enviados; una cadena vacía quita ese dato del ticket. Se propaga a todas las cajas.
   */
  guardarDatosTienda(tienda: string, datos: Partial<Record<(typeof CAMPOS_TIENDA)[number], string>>, por: string): { ok: true } | { ok: false; mensaje: string } {
    if (!this.ctx.tiendas.includes(tienda)) return { ok: false, mensaje: 'tienda desconocida' };
    const limites: Record<string, number> = { nombre: 40, razon_social: 80, rfc: 20, direccion: 120, ciudad: 80, telefono: 30, politica: 1500 };
    const payload: Record<string, string> = {};
    for (const c of CAMPOS_TIENDA) {
      if (!(c in datos)) continue;
      const v = c === 'politica' ? String(datos[c] ?? '').split('\n').map((l) => l.trim().replace(/\s+/g, ' ')).filter(Boolean).join('\n') : String(datos[c] ?? '').trim().replace(/\s+/g, ' ');
      if (c === 'nombre' && !v) return { ok: false, mensaje: 'falta el nombre de la tienda' };
      if (v.length > limites[c]!) return { ok: false, mensaje: `«${c.replace('_', ' ')}» es demasiado largo (máximo ${limites[c]} caracteres)` };
      payload[c] = v;
    }
    if (!Object.keys(payload).length) return { ok: true };
    this.emitirAdmin('config.negocio', { tienda, ...payload, por });
    return { ok: true };
  }

  /** Alta o edición de una promoción o cupón (con `id` es edición). Se propaga a todas las cajas. */
  guardarPromocion(p: Promocion, por: string): { ok: true; promo: Promocion } | { ok: false; error: ErrorPromo } {
    const otras = promocionesDe(this.repo.ops());
    if (p.id && !otras.some((o) => o.id === p.id) && !recompensasDe(this.repo.ops()).some((o) => o.id === p.id)) return { ok: false, error: { codigo: 'NO_EXISTE', mensaje: 'la promoción no existe' } };
    const id = p.id || `promo-${uuid().slice(0, 8)}`;
    const r = validarPromocion({ ...p, id }, otras, this.ctx.tiendas);
    if (!r.ok) return r;
    this.emitirAdmin('promo.guardada', { ...r.promo, por });
    return r;
  }
  /** Elimina una promoción o cupón (también una regla del formato anterior). Las ventas ya hechas conservan el descuento que llevaron. */
  eliminarPromocion(id: string, por: string): { ok: true } | { ok: false; error: { codigo: 'NO_EXISTE'; mensaje: string } } {
    const ops = this.repo.ops();
    if (!promocionesDe(ops).some((o) => o.id === id) && !recompensasDe(ops).some((o) => o.id === id)) return { ok: false, error: { codigo: 'NO_EXISTE', mensaje: 'la promoción no existe' } };
    this.emitirAdmin('promo.guardada', { id, eliminada: true, por }, `promo.eliminada:${id}:${uuid().slice(0, 8)}`);
    return { ok: true };
  }
  /** Alta o edición de una regla de recompensa (cupón regalado en el ticket). Se propaga a todas las cajas. */
  guardarRecompensa(r: ReglaRecompensa, por: string): { ok: true; regla: ReglaRecompensa } | { ok: false; error: { codigo: 'DATOS_INVALIDOS' | 'NO_EXISTE'; mensaje: string } } {
    const otras = recompensasDe(this.repo.ops());
    if (r.id && !otras.some((o) => o.id === r.id)) return { ok: false, error: { codigo: 'NO_EXISTE', mensaje: 'la recompensa no existe' } };
    const id = r.id || `rec-${uuid().slice(0, 8)}`;
    const v = validarRegla({ ...r, id }, this.ctx.tiendas);
    if (!v.ok) return { ok: false, error: { codigo: 'DATOS_INVALIDOS', mensaje: v.mensaje } };
    this.emitirAdmin('recompensa.guardada', { ...v.regla, por });
    return { ok: true, regla: v.regla };
  }
  /** Porcentajes del descuento de empleada (solo Administración). */
  /** Alta o cambio de un cliente VIP (nombre completo, teléfono opcional, su porcentaje de descuento, si está activo y hasta cuándo vale). Solo Administración. */
  guardarVip(d: { id?: string; nombre?: string; telefono?: string; pct?: number; activo?: boolean; vigente_hasta?: string | null }, por: string): { ok: true; vip: ClienteVip } | { ok: false; error: { codigo: 'DATOS_INVALIDOS' | 'NO_EXISTE'; mensaje: string } } {
    const lista = clientesVip(this.repo.ops());
    const actual = d.id ? lista.find((v) => v.id === d.id) : undefined;
    if (d.id && !actual) return { ok: false, error: { codigo: 'NO_EXISTE', mensaje: 'el cliente VIP no existe' } };
    const nombre = String(d.nombre ?? actual?.nombre ?? '').trim().replace(/\s+/g, ' ');
    if (nombre.length < 5 || !nombre.includes(' ')) return { ok: false, error: { codigo: 'DATOS_INVALIDOS', mensaje: 'escriba el nombre completo del cliente (nombre y apellido)' } };
    const telefono = String(d.telefono ?? actual?.telefono ?? '').replace(/[^\d+]/g, '');
    if (telefono && !/^\+?\d{7,15}$/.test(telefono)) return { ok: false, error: { codigo: 'DATOS_INVALIDOS', mensaje: 'el teléfono lleva de 7 a 15 dígitos' } };
    const pct = d.pct ?? actual?.pct;
    if (!Number.isInteger(pct) || pct! < 1 || pct! > 100) return { ok: false, error: { codigo: 'DATOS_INVALIDOS', mensaje: 'el descuento es un porcentaje entero de 1 a 100' } };
    const vigente_hasta = d.vigente_hasta === undefined ? (actual?.vigente_hasta ?? null) : (d.vigente_hasta || null);
    if (vigente_hasta !== null && !fechaValida(vigente_hasta)) return { ok: false, error: { codigo: 'DATOS_INVALIDOS', mensaje: 'la vigencia debe ser una fecha válida (AAAA-MM-DD)' } };
    const id = actual?.id ?? `vip-${uuid().slice(0, 8)}`;
    const activo = d.activo ?? actual?.activo ?? true;
    this.emitirAdmin('vip.guardado', { id, nombre, telefono, pct, activo, vigente_hasta, por });
    return { ok: true, vip: { id, nombre, telefono, pct: pct!, activo, vigente_hasta } };
  }
  eliminarVip(id: string, por: string): { ok: true } | { ok: false; error: { codigo: 'NO_EXISTE'; mensaje: string } } {
    const v = clientesVip(this.repo.ops()).find((x) => x.id === id);
    if (!v) return { ok: false, error: { codigo: 'NO_EXISTE', mensaje: 'el cliente VIP no existe' } };
    this.emitirAdmin('vip.guardado', { id, nombre: v.nombre, telefono: v.telefono, pct: v.pct, activo: false, vigente_hasta: v.vigente_hasta, eliminado: true, por });
    return { ok: true };
  }
  /** Lo que NO lleva descuento VIP: marcas y departamentos (basta con que el nombre del artículo contenga el texto). Aplica a todos los clientes VIP. */
  fijarExcepcionesVip(d: { marcas?: string[]; departamentos?: string[] }, por: string): { ok: true; excepciones: ExcepcionesVip } | { ok: false; error: { codigo: 'DATOS_INVALIDOS'; mensaje: string } } {
    const limpiar = (xs: unknown) => [...new Set((Array.isArray(xs) ? xs : []).map((x) => String(x ?? '').trim().replace(/\s+/g, ' ')).filter((x) => x.length > 0))];
    const marcas = limpiar(d.marcas), departamentos = limpiar(d.departamentos);
    if ([...marcas, ...departamentos].some((x) => x.length < 2 || x.length > 60)) return { ok: false, error: { codigo: 'DATOS_INVALIDOS', mensaje: 'cada excepción lleva de 2 a 60 caracteres' } };
    this.emitirAdmin('vip.excepciones', { marcas, departamentos, por });
    return { ok: true, excepciones: { marcas, departamentos } };
  }
  /** Porcentajes del descuento de empleada y artículos que NO lo llevan (por marca o departamento). Lo que no se manda se conserva como estaba. */
  fijarConfigEmpleadas(d: { pct?: number; pct_uniforme?: number; marcas?: string[]; departamentos?: string[] }, por: string): { ok: true } | { ok: false; error: { codigo: 'DATOS_INVALIDOS'; mensaje: string } } {
    const mal = (mensaje: string) => ({ ok: false as const, error: { codigo: 'DATOS_INVALIDOS' as const, mensaje } });
    const actual = configEmpleadas(this.repo.ops());
    const pct = d.pct ?? actual.pct, pctU = d.pct_uniforme ?? actual.pct_uniforme;
    for (const [n, v] of [['el descuento de empleada', pct], ['el descuento de uniformes', pctU]] as const) if (!Number.isInteger(v) || v < 1 || v > 100) return mal(`${n} es un porcentaje entero de 1 a 100`);
    const limpia = (l: unknown) => [...new Set((Array.isArray(l) ? l : []).map((x) => String(x ?? '').trim()).filter(Boolean))].slice(0, 100);
    const marcas = d.marcas === undefined ? actual.marcas : limpia(d.marcas), departamentos = d.departamentos === undefined ? actual.departamentos : limpia(d.departamentos);
    this.emitirAdmin('empleadas.config', { pct, pct_uniforme: pctU, marcas, departamentos, por });
    return { ok: true };
  }
  // ── Ventas históricas duplicadas (el mismo ticket importado con dos cajas): se revisan y, con la decisión de Administración, dejan de contar ──
  /** Qué tickets históricos de `caja` son copia exacta (folio, fecha, total y tipo) de los de `igual_a_caja`, con totales y por mes. No cambia nada. */
  duplicadosHistoricos(r: ReglaDuplicadosHistoricos) {
    const ops = this.repo.ops();
    const fuera = historicasDuplicadas(ops, [r]);
    const filas = ops.filter((o) => o.tipo === 'venta.historica' && fuera.has(o.payload.hist_id)).map((o) => o.payload as { hist_id: string; folio: number; fecha: string; total: number; tipo_hist: string });
    const porMes = new Map<string, { mes: string; tickets: number; total: number }>();
    for (const p of filas) { const k = p.fecha.slice(0, 7); const a = porMes.get(k) ?? { mes: k, tickets: 0, total: 0 }; a.tickets++; a.total += p.total; porMes.set(k, a); }
    const fechas = filas.map((p) => p.fecha).sort();
    return {
      regla: r, tickets: filas.length, total: filas.reduce((a, p) => a + p.total, 0), desde: fechas[0] ?? null, hasta: fechas.at(-1) ?? null,
      por_mes: [...porMes.values()].sort((a, b) => a.mes.localeCompare(b.mes)),
      muestra: filas.slice(0, 8).map((p) => ({ folio: p.folio, fecha: p.fecha, total: p.total, tipo: p.tipo_hist })),
      ya_descartados: reglasDuplicadosHistoricos(ops).some((x) => x.tienda === r.tienda && x.caja === r.caja && x.igual_a_caja === r.igual_a_caja),
    };
  }
  /** Deja de contar las copias duplicadas (el dato se conserva) y vuelve a publicar las metas con el historial ya limpio. */
  descartarDuplicadosHistoricos(r: ReglaDuplicadosHistoricos, por: string): { ok: true; tickets: number; total: number } | { ok: false; error: { codigo: 'DATOS_INVALIDOS'; mensaje: string } } {
    const mal = (mensaje: string) => ({ ok: false as const, error: { codigo: 'DATOS_INVALIDOS' as const, mensaje } });
    if (!r.tienda || !Number.isInteger(r.caja) || !Number.isInteger(r.igual_a_caja) || r.caja < 1 || r.igual_a_caja < 1) return mal('indique la tienda y las dos cajas');
    if (r.caja === r.igual_a_caja) return mal('la caja a limpiar y la caja de referencia deben ser distintas');
    const v = this.duplicadosHistoricos(r);
    if (!v.tickets) return mal('no hay tickets duplicados entre esas dos cajas');
    this.emitirUna('historico.duplicados', { tienda: r.tienda, caja: r.caja, igual_a_caja: r.igual_a_caja, tickets: v.tickets, total: v.total, desde: v.desde, hasta: v.hasta, motivo: 'tickets importados dos veces con otra caja', por }, `historico.duplicados:${r.tienda}/${r.caja}/${r.igual_a_caja}`, false);
    const pub = this.metasVigentes();
    if (pub) this.publicarMetas(pub.config, por);
    return { ok: true, tickets: v.tickets, total: v.total };
  }
  /** Meses de vigencia de las tarjetas de regalo nuevas y de las recargas en efectivo. Las ya emitidas conservan su fecha de vencimiento. Solo Administración. */
  fijarVigenciaTarjetas(d: { meses_vigencia: number }, por: string): { ok: true; meses_vigencia: number } | { ok: false; error: { codigo: 'DATOS_INVALIDOS'; mensaje: string } } {
    if (!Number.isInteger(d.meses_vigencia) || d.meses_vigencia < 1 || d.meses_vigencia > 60) return { ok: false, error: { codigo: 'DATOS_INVALIDOS', mensaje: 'la vigencia es un número entero de meses, de 1 a 60' } };
    this.emitirAdmin('giftcard.config', { meses_vigencia: d.meses_vigencia, por });
    return { ok: true, meses_vigencia: d.meses_vigencia };
  }
  // ── Metas de venta por tienda: el incremento sobre el año pasado y los límites de color los fija Administración; la meta de cada día se publica a las cajas ──
  /** Configuración y metas publicadas vigentes (null si Administración aún no publica nada). */
  metasVigentes(): MetasPublicadas | null {
    return metasPublicadas(this.repo.ops());
  }
  /** ¿Las metas publicadas cubren desde el lunes del mes actual hasta el fin del mes siguiente? Si no, hay que volver a publicarlas. */
  metasNecesitanPublicar(hoy: string): boolean {
    const pub = this.metasVigentes();
    const { desde, hasta } = this.ventanaMetas(hoy);
    return !pub || pub.desde > desde || pub.hasta < hasta;
  }
  private ventanaMetas(hoy: string): { desde: string; hasta: string } {
    const [y, m] = hoy.split('-').map(Number) as [number, number];
    const finSiguiente = new Date(Date.UTC(y, m + 1, 0)).toISOString().slice(0, 10); // último día del mes siguiente
    return { desde: lunesDe(`${hoy.slice(0, 7)}-01`), hasta: addDias(lunesDe(finSiguiente), 6) };
  }
  /** Calcula la meta de cada día de cada tienda (año pasado + incremento) y la publica con la configuración. Las tiendas sin historial quedan sin meta. */
  publicarMetas(config: ConfigMetas, por: string): MetasPublicadas {
    const ahora = this.ctx.reloj.now();
    const { desde, hasta } = this.ventanaMetas(fechaLocal(ahora));
    const ops = this.repo.ops();
    const dias: Record<string, Record<string, number>> = {};
    const historico: Record<string, Record<string, number>> = {};
    const hoy = fechaLocal(ahora);
    for (const [t, c] of Object.entries(config.tiendas)) {
      if (!c.activa) continue;
      const d = metasDias(totalesPorDia(ops, t), c.incremento_pct, desde, hasta);
      if (Object.keys(d).length) dias[t] = d;
      // lo importado del sistema anterior del mes en curso: las cajas no lo reciben, así que va aquí para que su barra lo cuente
      const h = Object.fromEntries([...historicoPorDia(ops, t)].filter(([f]) => f >= desde && f <= hoy));
      if (Object.keys(h).length) historico[t] = h;
    }
    this.emitirAdmin('metas.config', { config, desde, hasta, generado_en: ahora, dias, historico, por });
    return { config, desde, hasta, generado_en: ahora, dias, historico };
  }
  /** Cambia el incremento, el horario o los colores de las metas y las vuelve a publicar. Lo que no se manda se conserva. */
  guardarMetas(d: { tiendas?: Record<string, Partial<MetaTienda>>; verde_pct?: number; amarillo_pct?: number }, por: string): { ok: true; metas: MetasPublicadas } | { ok: false; error: { codigo: 'DATOS_INVALIDOS'; mensaje: string } } {
    const mal = (mensaje: string) => ({ ok: false as const, error: { codigo: 'DATOS_INVALIDOS' as const, mensaje } });
    const actual = this.metasVigentes()?.config ?? CONFIG_METAS_INICIAL;
    const tiendas: Record<string, MetaTienda> = JSON.parse(JSON.stringify(actual.tiendas));
    for (const [t, c] of Object.entries(d.tiendas ?? {})) {
      const base = tiendas[t] ?? { activa: true, incremento_pct: 0, apertura: '10:00', cierre: '20:00' };
      const nuevo = { ...base, ...c } as MetaTienda;
      if (typeof nuevo.activa !== 'boolean') return mal(`indique si la meta de ${t} está activa`);
      if (typeof nuevo.incremento_pct !== 'number' || !Number.isFinite(nuevo.incremento_pct) || nuevo.incremento_pct < -90 || nuevo.incremento_pct > 500) return mal(`el incremento de ${t} es un porcentaje entre -90 y 500`);
      if (!horaValida(nuevo.apertura) || !horaValida(nuevo.cierre)) return mal(`el horario de ${t} se escribe como 10:00 y 20:00`);
      if (nuevo.apertura.padStart(5, '0') >= nuevo.cierre.padStart(5, '0')) return mal(`en ${t} la hora de cierre debe ser después de la de apertura`);
      tiendas[t] = nuevo;
    }
    const verde = d.verde_pct ?? actual.verde_pct, amarillo = d.amarillo_pct ?? actual.amarillo_pct;
    if (![verde, amarillo].every((x) => Number.isInteger(x) && x >= 1 && x <= 200) || amarillo >= verde) return mal('los límites de color son porcentajes enteros: verde debe ser mayor que amarillo');
    return { ok: true, metas: this.publicarMetas({ tiendas, verde_pct: verde, amarillo_pct: amarillo }, por) };
  }
  /** Límite de crédito de una empleada (0 = sin crédito). Solo Administración. */
  fijarLimiteEmpleada(d: { empleada_id: string; limite: number; motivo: string }, por: string): { ok: true } | { ok: false; error: { codigo: 'DATOS_INVALIDOS'; mensaje: string } } {
    const mal = (mensaje: string) => ({ ok: false as const, error: { codigo: 'DATOS_INVALIDOS' as const, mensaje } });
    if (!personalConCuenta(this.repo.ops()).some((c) => c.id === d.empleada_id)) return mal('esa empleada no existe');
    if (!Number.isInteger(d.limite) || d.limite < 0) return mal('el límite es un importe en pesos (0 = sin crédito)');
    if (String(d.motivo ?? '').trim().length < 3) return mal('escriba el motivo del cambio de límite');
    this.emitirAdmin('empleada.credito', { empleada_id: d.empleada_id, limite: d.limite, motivo: String(d.motivo).trim(), por });
    return { ok: true };
  }
  /** Abono de nómina o ajuste en la cuenta de una empleada (con motivo y referencia única: reintentar no lo duplica). Solo Administración. */
  registrarMovimientoEmpleada(d: { empleada_id: string; tipo: 'abono' | 'ajuste_cargo' | 'ajuste_abono'; monto: number; motivo: string; periodo?: string; ref: string }, por: string): { ok: true } | { ok: false; error: { codigo: 'DATOS_INVALIDOS'; mensaje: string } } {
    const mal = (mensaje: string) => ({ ok: false as const, error: { codigo: 'DATOS_INVALIDOS' as const, mensaje } });
    if (!personalConCuenta(this.repo.ops()).some((c) => c.id === d.empleada_id)) return mal('esa empleada no existe');
    if (!['abono', 'ajuste_cargo', 'ajuste_abono'].includes(d.tipo)) return mal('indique si es un abono de nómina o un ajuste');
    if (!Number.isInteger(d.monto) || d.monto <= 0) return mal('el monto es un importe en pesos mayor que 0');
    if (String(d.motivo ?? '').trim().length < 3) return mal('escriba el motivo');
    if (!d.ref) return mal('falta la referencia de la operación');
    this.emitirAdmin('empleada.movimiento', { empleada_id: d.empleada_id, tipo: d.tipo, monto: d.monto, motivo: String(d.motivo).trim(), ...(d.periodo ? { periodo: String(d.periodo).trim().slice(0, 40) } : {}), por, ref: d.ref, fecha: fechaLocal(this.ctx.reloj.now()) }, `empleada-mov:${d.ref}`);
    return { ok: true };
  }
  /** Solo Administración fija el fondo fijo autorizado de una caja (queda el historial de cambios con quién y por qué). */
  fijarFondoCaja(d: { tienda: string; caja: number; monto: number; motivo: string }, por: string): { ok: true } | { ok: false; error: { codigo: 'DATOS_INVALIDOS'; mensaje: string } } {
    const mal = (mensaje: string) => ({ ok: false as const, error: { codigo: 'DATOS_INVALIDOS' as const, mensaje } });
    if (!this.ctx.tiendas.includes(d.tienda)) return mal('tienda desconocida');
    if (!Number.isInteger(d.caja) || d.caja < 1) return mal('caja inválida');
    if (!Number.isInteger(d.monto) || d.monto <= 0) return mal('el fondo es un importe en pesos mayor que 0');
    const motivo = String(d.motivo ?? '').trim();
    if (motivo.length < 3) return mal('escriba el motivo del cambio de fondo');
    this.emitirAdmin('caja.fondo_autorizado', { tienda: d.tienda, caja: d.caja, monto: d.monto, motivo, por });
    return { ok: true };
  }
  /** Límite de ventas en efectivo del día de una caja (centavos; 0 = sin límite). Al llegarlo, la caja muestra un aviso permanente para cobrar en la otra. Solo Administración. */
  fijarLimiteEfectivo(d: { tienda: string; caja: number; limite: number }, por: string): { ok: true } | { ok: false; error: { codigo: 'DATOS_INVALIDOS'; mensaje: string } } {
    const mal = (mensaje: string) => ({ ok: false as const, error: { codigo: 'DATOS_INVALIDOS' as const, mensaje } });
    if (!this.ctx.tiendas.includes(d.tienda)) return mal('tienda desconocida');
    if (!Number.isInteger(d.caja) || d.caja < 1) return mal('caja inválida');
    if (!Number.isInteger(d.limite) || d.limite < 0) return mal('el límite es un importe en pesos (0 = sin límite)');
    this.emitirAdmin('caja.limite_efectivo', { tienda: d.tienda, caja: d.caja, limite: d.limite, por });
    return { ok: true };
  }
  /** Entrega o ajuste administrativo de efectivo en una caja (entrada o salida en pesos), con motivo y referencia única. */
  registrarAjusteCaja(d: { tienda: string; caja: number; tipo: 'entrada' | 'salida'; monto: number; motivo: string; ref: string }, por: string): { ok: true } | { ok: false; error: { codigo: 'DATOS_INVALIDOS'; mensaje: string } } {
    const mal = (mensaje: string) => ({ ok: false as const, error: { codigo: 'DATOS_INVALIDOS' as const, mensaje } });
    if (!this.ctx.tiendas.includes(d.tienda)) return mal('tienda desconocida');
    if (!Number.isInteger(d.caja) || d.caja < 1) return mal('caja inválida');
    if (d.tipo !== 'entrada' && d.tipo !== 'salida') return mal('indique si es una entrega o una salida de efectivo');
    if (!Number.isInteger(d.monto) || d.monto <= 0) return mal('el monto es un importe en pesos mayor que 0');
    const motivo = String(d.motivo ?? '').trim();
    if (motivo.length < 3) return mal('escriba el motivo');
    if (!d.ref) return mal('falta la referencia de la operación');
    this.emitirAdmin('cash.ajuste_admin', { tienda: d.tienda, caja: d.caja, tipo: d.tipo, monto: d.monto, motivo, por, ref: d.ref, fecha: fechaLocal(this.ctx.reloj.now()) }, `ajuste:${d.ref}`);
    return { ok: true };
  }
  /** Alta o edición de un supervisor que autoriza descuentos con clave numérica. La clave se guarda con sal y hash. */
  guardarSupervisor(d: { id?: string; id_nuevo?: string; nombre?: string; clave?: string; activo?: boolean; solo_caja?: boolean; dueno?: boolean; foto?: string | null }, por: string): { ok: true; supervisor: Omit<Supervisor, 'sal' | 'hash'> } | { ok: false; error: { codigo: 'DATOS_INVALIDOS' | 'CLAVE_REPETIDA' | 'NO_EXISTE'; mensaje: string } } {
    const lista = supervisoresDe(this.repo.ops());
    const actual = d.id ? lista.find((s) => s.id === d.id) : undefined;
    if (d.id && !actual) return { ok: false, error: { codigo: 'NO_EXISTE', mensaje: 'el supervisor no existe' } };
    const nombre = (d.nombre ?? actual?.nombre ?? '').trim().replace(/\s+/g, ' ');
    if (!nombre) return { ok: false, error: { codigo: 'DATOS_INVALIDOS', mensaje: 'falta el nombre del supervisor' } };
    if (!actual && !claveValida(d.clave)) return { ok: false, error: { codigo: 'DATOS_INVALIDOS', mensaje: 'la clave lleva de 4 a 8 dígitos' } };
    if (d.clave !== undefined && d.clave !== '' && !claveValida(d.clave)) return { ok: false, error: { codigo: 'DATOS_INVALIDOS', mensaje: 'la clave lleva de 4 a 8 dígitos' } };
    const activo = d.activo ?? actual?.activo ?? true;
    if (actual?.dueno && !activo) return { ok: false, error: { codigo: 'DATOS_INVALIDOS', mensaje: 'la cuenta del dueño no se puede desactivar' } };
    let sal = actual?.sal ?? uuid(), hash = actual?.hash ?? '';
    if (d.clave) {
      sal = uuid();
      hash = hashClave(sal, d.clave); // la misma clave puede repetirse entre personas: avisar «ya está usada» le diría a quien la teclea que otra persona la tiene
    }
    const id = actual?.id ?? d.id_nuevo ?? `sup-${uuid().slice(0, 8)}`;
    const solo_caja = d.solo_caja ?? actual?.solo_caja;
    const dueno = d.dueno ?? actual?.dueno;
    const foto = d.foto === undefined ? actual?.foto : (d.foto || undefined); // la foto del perfil viaja a la caja para mostrarla junto al nombre
    this.emitirAdmin('supervisor.guardado', { id, nombre, activo, sal, hash, ...(solo_caja ? { solo_caja: true } : {}), ...(dueno ? { dueno: true } : {}), ...(foto ? { foto } : {}), por });
    return { ok: true, supervisor: { id, nombre, activo } };
  }

  /** Alta o edición de un cajero con clave propia (4 a 8 dígitos). El nombre es el del usuario de la caja y no se repite. */
  guardarCajero(d: { id?: string; nombre?: string; clave?: string; activo?: boolean; perfil?: Partial<Perfil>; tienda?: string }, por: string): { ok: true; cajero: Omit<Cajero, 'sal' | 'hash'> } | { ok: false; error: { codigo: 'DATOS_INVALIDOS' | 'NOMBRE_REPETIDO' | 'NO_EXISTE'; mensaje: string } } {
    const lista = cajerosDe(this.repo.ops());
    const actual = d.id ? lista.find((c) => c.id === d.id) : undefined;
    if (d.id && !actual) return { ok: false, error: { codigo: 'NO_EXISTE', mensaje: 'la Vendedora-Cajera no existe' } };
    const nombre = (d.nombre ?? actual?.nombre ?? '').trim().replace(/\s+/g, ' ');
    if (!nombre) return { ok: false, error: { codigo: 'DATOS_INVALIDOS', mensaje: 'falta el nombre de la Vendedora-Cajera' } };
    if ([...lista.filter((c) => c.id !== actual?.id), ...administradoresDe(this.repo.ops())].some((c) => nombreClave(c.nombre) === nombreClave(nombre))) return { ok: false, error: { codigo: 'NOMBRE_REPETIDO', mensaje: 'ya hay un usuario con ese nombre' } };
    if (!actual && !claveValida(d.clave)) return { ok: false, error: { codigo: 'DATOS_INVALIDOS', mensaje: 'la clave lleva de 4 a 8 dígitos' } };
    if (d.clave !== undefined && d.clave !== '' && !claveValida(d.clave)) return { ok: false, error: { codigo: 'DATOS_INVALIDOS', mensaje: 'la clave lleva de 4 a 8 dígitos' } };
    const activo = d.activo ?? actual?.activo ?? true;
    let sal = actual?.sal ?? uuid(), hash = actual?.hash ?? '';
    if (d.clave) { sal = uuid(); hash = hashClave(sal, d.clave); }
    const id = actual?.id ?? `caj-${uuid().slice(0, 8)}`;
    const pf = mezclarPerfil(actual?.perfil, d.perfil);
    if (!pf.ok) return { ok: false, error: { codigo: 'DATOS_INVALIDOS', mensaje: pf.mensaje } };
    // Tienda donde trabaja: vacía = en todas. Si no se indica se conserva la de hoy (que ya incluye si inició sesión en otra tienda).
    const tienda = d.tienda === undefined ? actual?.tienda : String(d.tienda).trim();
    if (tienda && !this.ctx.tiendas.includes(tienda)) return { ok: false, error: { codigo: 'DATOS_INVALIDOS', mensaje: `la tienda «${tienda}» no existe` } };
    this.emitirAdmin('cajero.guardado', { id, nombre, activo, sal, hash, ...(pf.perfil ? { perfil: pf.perfil } : {}), ...(tienda !== undefined ? { tienda } : {}), por });
    // Inactividad: al desactivarla queda la fecha en su expediente (el registro se conserva); al reactivarla se quita.
    if (actual && actual.activo !== activo) this.guardarExpediente({ cajero_id: id, fecha_baja: activo ? null : fechaLocal(this.ctx.reloj.now()) }, por);
    return { ok: true, cajero: { id, nombre, activo, ...(pf.perfil ? { perfil: pf.perfil } : {}), ...(tienda !== undefined ? { tienda } : {}) } };
  }

  /**
   * Elimina a una Vendedora-Cajera: desaparece de las listas, de «Vendió por» y de las cajas, y ya no puede iniciar sesión (su alias queda libre).
   * Lo ya vendido conserva su nombre. La bitácora es solo de agregar: el registro anterior (y su ficha) sigue ahí, sin mostrarse.
   */
  eliminarCajero(id: string, por: string): { ok: true } | { ok: false; error: { codigo: 'NO_EXISTE'; mensaje: string } } {
    const actual = cajerosDe(this.repo.ops()).find((c) => c.id === id);
    if (!actual) return { ok: false, error: { codigo: 'NO_EXISTE', mensaje: 'la Vendedora-Cajera no existe' } };
    this.emitirAdmin('cajero.guardado', { id, nombre: actual.nombre, activo: false, sal: actual.sal, hash: actual.hash, eliminado: true, por });
    return { ok: true };
  }

  /**
   * Elimina a un supervisor o almacenista de Administración (y su clave de caja). No se elimina: una cuenta protegida (los dueños), la propia sesión ni al
   * último supervisor activo. Sus ventas anteriores conservan su nombre.
   */
  eliminarAdmin(id: string, por: string): { ok: true } | { ok: false; error: { codigo: 'NO_EXISTE' | 'PROTEGIDO' | 'ULTIMO_SUPERVISOR' | 'PROPIO'; mensaje: string } } {
    const ops = this.repo.ops();
    const lista = administradoresDe(ops);
    const a = lista.find((x) => x.id === id);
    if (!a) return { ok: false, error: { codigo: 'NO_EXISTE', mensaje: 'el usuario no existe' } };
    if (adminProtegido(a) || this.esDueno(ops, a)) return { ok: false, error: { codigo: 'PROTEGIDO', mensaje: `«${a.nombre}» es una cuenta protegida: no se puede eliminar` } };
    if (nombreClave(a.nombre) === nombreClave(por)) return { ok: false, error: { codigo: 'PROPIO', mensaje: 'no puede eliminar su propio usuario' } };
    if ((a.rol ?? 'supervisor') === 'supervisor' && a.activo && !lista.some((x) => x.id !== id && x.activo && (x.rol ?? 'supervisor') === 'supervisor')) return { ok: false, error: { codigo: 'ULTIMO_SUPERVISOR', mensaje: 'debe quedar al menos un supervisor activo' } };
    this.emitirUna('admin.guardado', { id, nombre: a.nombre, activo: false, sal: a.sal, hash: a.hash, rol: a.rol ?? 'supervisor', eliminado: true, por }, `admin.guardado:${uuid()}`, false);
    const enlazado = `sup-${id.slice(4)}`;
    const sup = supervisoresDe(ops).find((s) => s.id === enlazado);
    if (sup) this.emitirAdmin('supervisor.guardado', { id: enlazado, nombre: sup.nombre, activo: false, sal: sup.sal, hash: sup.hash, eliminado: true, por });
    return { ok: true };
  }
  /** Elimina a un supervisor que solo existe como «supervisor de caja» (sin acceso a Administración). */
  eliminarSupervisorCaja(id: string, por: string): { ok: true } | { ok: false; error: { codigo: 'NO_EXISTE'; mensaje: string } } {
    const s = supervisoresDe(this.repo.ops()).find((x) => x.id === id);
    if (!s) return { ok: false, error: { codigo: 'NO_EXISTE', mensaje: 'el supervisor no existe' } };
    if (s.dueno) return { ok: false, error: { codigo: 'NO_EXISTE', mensaje: 'la cuenta del dueño no se puede eliminar' } };
    this.emitirAdmin('supervisor.guardado', { id, nombre: s.nombre, activo: false, sal: s.sal, hash: s.hash, eliminado: true, por });
    return { ok: true };
  }

  /**
   * Expediente PRIVADO de una trabajadora: fecha de alta (la captura el propietario), fecha de inactividad, ¿recontratable?, calificaciones de 1 a 5 y notas.
   * Lo no enviado se conserva; `null` o texto vacío lo borra. Solo vive en el central (no se reparte a tiendas ni cajas).
   */
  guardarExpediente(d: { cajero_id: string; fecha_alta?: string | null; fecha_baja?: string | null; recontratable?: boolean | null; notas?: string; calificaciones?: Partial<Record<string, number | null>> }, por: string): Expediente {
    const ops = this.repo.ops();
    if (!cajerosDe(ops).some((c) => c.id === d.cajero_id)) throw new ErrorDominio('NO_ENCONTRADO', 'la trabajadora no existe');
    const actual = expedientesDe(ops).get(d.cajero_id) ?? expedienteVacio(d.cajero_id);
    const fecha = (v: unknown, rotulo: string): string | null => {
      if (v === null || v === '') return null;
      if (typeof v !== 'string' || !fechaValida(v)) throw new ErrorDominio('FECHA_INVALIDA', `${rotulo}: la fecha debe ser un día válido (AAAA-MM-DD)`);
      return v;
    };
    const nuevo: Expediente = { ...actual, calificaciones: { ...actual.calificaciones }, por };
    if (d.fecha_alta !== undefined) nuevo.fecha_alta = fecha(d.fecha_alta, 'Fecha de alta');
    if (d.fecha_baja !== undefined) nuevo.fecha_baja = fecha(d.fecha_baja, 'Fecha de inactividad');
    if (nuevo.fecha_alta && nuevo.fecha_baja && nuevo.fecha_baja < nuevo.fecha_alta) throw new ErrorDominio('FECHA_INVALIDA', 'la fecha de inactividad no puede ser anterior a la de alta');
    if (d.recontratable !== undefined) {
      if (d.recontratable !== null && typeof d.recontratable !== 'boolean') throw new ErrorDominio('DATOS_INVALIDOS', 'recontratable es sí, no o sin definir');
      nuevo.recontratable = d.recontratable;
    }
    if (d.notas !== undefined) {
      const n = String(d.notas).replace(/\r/g, '').trim();
      if (n.length > 4000) throw new ErrorDominio('DATOS_INVALIDOS', 'las notas admiten hasta 4,000 caracteres');
      nuevo.notas = n;
    }
    for (const [k, v] of Object.entries(d.calificaciones ?? {})) {
      if (!(CRITERIOS_EXPEDIENTE as readonly string[]).includes(k)) throw new ErrorDominio('DATOS_INVALIDOS', `criterio desconocido: ${k}`);
      if (v !== null && (!Number.isInteger(v) || (v as number) < 1 || (v as number) > 5)) throw new ErrorDominio('DATOS_INVALIDOS', 'las calificaciones van de 1 a 5');
      nuevo.calificaciones[k as keyof Expediente['calificaciones']] = v as number | null;
    }
    const { actualizado_en: _omitido, ...payload } = nuevo;
    void _omitido;
    // Se guarda la foto completa del expediente en cada cambio (la última manda); no lleva `tienda`, por eso las cajas nunca la reciben.
    const op = this.emitirUna('trabajadora.expediente', payload, `trabajadora.expediente:${uuid()}`, false)!;
    return { ...nuevo, actualizado_en: op.ocurrio_en };
  }

  /** ¿Es la cuenta del dueño? Por su perfil (Edgardo Morales) o porque su registro de caja ya lleva la marca de dueño: renombrarla o vaciar su perfil no se la quita. */
  esDueno(ops: Op[], a: { id: string; nombre: string; perfil?: { nombres?: string; apellidos?: string } }): boolean {
    return adminDueno(a) || !!supervisoresDe(ops).find((x) => x.id === `sup-${a.id.slice(4)}`)?.dueno;
  }
  /**
   * Alta o edición de un administrador (contraseña de 6 a 40 caracteres). Solo vive en el central: no se reparte a las tiendas ni a las cajas.
   * Los nombres no se repiten entre administradores ni con los cajeros.
   */
  guardarAdmin(d: { id?: string; nombre?: string; clave?: string; activo?: boolean; rol?: RolAdmin; clave_caja?: string; perfil?: Partial<Perfil> }, por: string): { ok: true; admin: Omit<Cajero, 'sal' | 'hash'> & { rol: RolAdmin } } | { ok: false; error: { codigo: 'DATOS_INVALIDOS' | 'NOMBRE_REPETIDO' | 'NO_EXISTE' | 'ULTIMO_SUPERVISOR'; mensaje: string } } {
    const ops = this.repo.ops();
    const lista = administradoresDe(ops);
    const actual = d.id ? lista.find((c) => c.id === d.id) : undefined;
    if (d.id && !actual) return { ok: false, error: { codigo: 'NO_EXISTE', mensaje: 'el administrador no existe' } };
    const nombre = (d.nombre ?? actual?.nombre ?? '').trim().replace(/\s+/g, ' ');
    if (!nombre) return { ok: false, error: { codigo: 'DATOS_INVALIDOS', mensaje: 'falta el nombre del administrador' } };
    if ([...lista.filter((c) => c.id !== actual?.id), ...cajerosDe(ops)].some((c) => nombreClave(c.nombre) === nombreClave(nombre))) return { ok: false, error: { codigo: 'NOMBRE_REPETIDO', mensaje: 'ya hay un usuario con ese nombre' } };
    if (!actual && !claveAdminValida(d.clave)) return { ok: false, error: { codigo: 'DATOS_INVALIDOS', mensaje: 'la contraseña lleva de 6 a 40 caracteres' } };
    if (d.clave !== undefined && d.clave !== '' && !claveAdminValida(d.clave)) return { ok: false, error: { codigo: 'DATOS_INVALIDOS', mensaje: 'la contraseña lleva de 6 a 40 caracteres' } };
    const activo = d.activo ?? actual?.activo ?? true;
    if (actual && !activo && this.esDueno(ops, actual)) return { ok: false, error: { codigo: 'DATOS_INVALIDOS', mensaje: 'la cuenta del dueño no se puede desactivar' } };
    let sal = actual?.sal ?? uuid(), hash = actual?.hash ?? '';
    if (d.clave) { sal = uuid(); hash = hashClave(sal, d.clave); }
    const id = actual?.id ?? `adm-${uuid().slice(0, 8)}`;
    const rol: RolAdmin = actual ? (actual.rol ?? 'supervisor') : (d.rol ?? 'supervisor');
    if (rol !== 'supervisor' && rol !== 'almacenista') return { ok: false, error: { codigo: 'DATOS_INVALIDOS', mensaje: 'el rol es supervisor o almacenista' } };
    if (!actual && lista.length === 0 && rol !== 'supervisor') return { ok: false, error: { codigo: 'DATOS_INVALIDOS', mensaje: 'el primer usuario de Administración debe ser supervisor: es quien crea a los demás' } };
    const supervisoresActivos = lista.filter((c) => c.id !== actual?.id && c.activo && (c.rol ?? 'supervisor') === 'supervisor').length + (rol === 'supervisor' && activo ? 1 : 0);
    if (supervisoresActivos === 0) return { ok: false, error: { codigo: 'ULTIMO_SUPERVISOR', mensaje: 'debe quedar al menos un supervisor activo (es quien administra a los demás)' } };
    const pf = mezclarPerfil(actual?.perfil, d.perfil);
    if (!pf.ok) return { ok: false, error: { codigo: 'DATOS_INVALIDOS', mensaje: pf.mensaje } };
    // Un supervisor también autoriza en la caja con una clave numérica: se registra (y se mantiene) como supervisor de caja con el mismo nombre.
    // La almacenista que también cobra recibe la misma clave de caja, pero no autoriza descuentos (`solo_caja`).
    {
      const enlazado = `sup-${id.slice(4)}`;
      const existe = supervisoresDe(ops).some((s) => s.id === enlazado);
      if (d.clave_caja || existe) {
        const r = this.guardarSupervisor({ ...(existe ? { id: enlazado } : { id_nuevo: enlazado }), nombre, clave: d.clave_caja || undefined, activo, solo_caja: rol === 'almacenista', dueno: rol === 'supervisor' && (adminDueno({ nombre, perfil: pf.perfil }) || (actual ? this.esDueno(ops, actual) : false)), foto: pf.perfil?.foto ?? null }, por);
        if (!r.ok) return { ok: false, error: { codigo: 'DATOS_INVALIDOS', mensaje: r.error.mensaje } };
      }
    }
    this.emitirUna('admin.guardado', { id, nombre, activo, sal, hash, rol, ...(pf.perfil ? { perfil: pf.perfil } : {}), por }, `admin.guardado:${uuid()}`, false);
    return { ok: true, admin: { id, nombre, activo, rol, ...(pf.perfil ? { perfil: pf.perfil } : {}) } };
  }

  /** Minutos de inactividad tras los que se cierra la sesión de la caja y la de Administración (0 = nunca, hasta 8 horas). Se reparte a las cajas. */
  guardarConfigSesion(d: { caja_min: number; admin_min: number }, por: string): { ok: true } | { ok: false; mensaje: string } {
    for (const [k, v] of Object.entries(d)) if (!Number.isInteger(v) || v < 0 || v > 480) return { ok: false, mensaje: `los minutos de ${k === 'caja_min' ? 'la caja' : 'Administración'} son un entero de 0 a 480 (0 = nunca)` };
    this.emitirAdmin('config.sesion', { caja_min: d.caja_min, admin_min: d.admin_min, por });
    return { ok: true };
  }

  /** Recordatorio interno de almacén: fecha para sacar el artículo a piso (null la quita). Solo del central, no viaja a las tiendas. */
  recordarSacarAPiso(itemId: string, fecha: string | null, por: string): Op | null {
    if (!catalogo(this.repo.ops()).has(itemId)) throw new ErrorDominio('ARTICULO_INEXISTENTE', itemId);
    if (fecha !== null && !fechaValida(fecha)) throw new ErrorDominio('FECHA_INVALIDA', 'la fecha debe ser un día válido (AAAA-MM-DD)');
    return this.emitirUna('alm.recordatorio', { item_id: itemId, fecha, por }, `alm.recordatorio:${uuid()}`, false);
  }
  /** Emite una operación del central solo si no existe (los reintentos de una alta o entrega no duplican nada). */
  private emitirUna(tipo: string, payload: unknown, opId: string, relevar = true): Op | null {
    if (this.repo.tieneOp(opId)) return null;
    if (relevar) return this.emitirAdmin(tipo, payload, opId);
    const op = crearOp(tipo, null, null, this.id, this.ctx.reloj.now(), payload, opId);
    this.repo.tx(() => { this.repo.appendOp(op); });
    return op;
  }

  /**
   * Alta de un lote en el almacén. Cada fila es un artículo NUEVO (otro código, lote y pedimento) o suma piezas a uno existente
   * (`item_id`). El `lote_id` hace que reintentar el mismo envío no duplique artículos ni piezas. Las piezas entran al almacén,
   * sin etiquetar y sin existencia en ninguna tienda.
   */
  altaLote(d: { lote_id: string; fuente: string; por: string; filas: (AltaManual & { fila: number; item_id?: string })[] }): { nuevos: number; sumados: number; piezas: number } {
    let siguiente = this.maxItemNoNumerico() + 1;
    let nuevos = 0, sumados = 0, piezas = 0;
    let cat: Map<string, Articulo> | undefined;
    for (const f of d.filas) {
      if (!Number.isInteger(f.cantidad) || f.cantidad <= 0) throw new ErrorDominio('CANTIDAD_INVALIDA', `fila ${f.fila}: la cantidad debe ser un entero mayor que 0`);
      let itemId = f.item_id;
      if (itemId) {
        if (!(cat ??= catalogo(this.repo.ops())).has(itemId)) throw new ErrorDominio('ARTICULO_INEXISTENTE', itemId);
        sumados++;
      } else {
        itemId = `alm-${d.lote_id}-f${f.fila}`;
        const art: Articulo = {
          item_id: itemId, codigo: f.codigo, item_no: String(siguiente), marca: f.marca, descripcion: f.descripcion, estilo: f.estilo, lote: f.lote,
          departamento: f.departamento, precio: f.precio, origen: `almacen:${d.lote_id}`,
        };
        if (this.emitirUna('item.created', art, `item:${itemId}`)) siguiente++;
        nuevos++;
      }
      this.emitirUna('alm.entrada', { entrada_id: `${d.lote_id}-f${f.fila}`, item_id: itemId, qty: f.cantidad, pedimento: f.pedimento?.trim() || null, lote_doc: d.lote_id, fuente: d.fuente, por: d.por }, `alm.entrada:${d.lote_id}-f${f.fila}`, false);
      piezas += f.cantidad;
    }
    return { nuevos, sumados, piezas };
  }

  /**
   * Ventas históricas del POS anterior (solo para reportes y contabilidad: no tocan existencias, caja, cortes ni los folios nuevos).
   * Cada ticket lleva un identificador estable (tienda/caja/folio): volver a importar el mismo archivo no duplica nada.
   * La operación no lleva tienda: queda en Administración y las cajas no la descargan.
   */
  importarVentasHistoricas(d: { tienda: string; caja: number; lote: string; por: string; filas: VentaHistorica[]; continuarFolios?: boolean }): { nuevas: number; existentes: number; folio_maximo: number; siguiente_folio: number } {
    let nuevas = 0;
    const limite = new Date(Date.parse(this.ctx.reloj.now()) - DIAS_CONSULTA_HISTORICA * 86400_000).toISOString().slice(0, 10);
    for (const f of d.filas) {
      if (this.emitirUna('venta.historica', payloadVentaHistorica(f, d), idVentaHistorica(d.tienda, d.caja, f.folio), false)) nuevas++;
      // Solo lo reciente baja a las cajas (para consultar un ticket si la clienta lo pide); el resto se consulta en Administración.
      if (f.fecha >= limite) {
        const id = `consulta:${idVentaHistorica(d.tienda, d.caja, f.folio)}`;
        if (!this.repo.tieneOp(id)) this.emitirAdmin('venta.consulta', payloadVentaHistorica(f, d), id);
      }
    }
    // Los folios nuevos de esta caja continúan después del último folio del sistema anterior (nunca baja el contador ni repite un número).
    const folio_maximo = this.folioMaximoHistorico(d.tienda, d.caja);
    // Si ya hay metas publicadas, se republican para que la barra de las cajas cuente lo recién importado.
    const metas = nuevas > 0 ? this.metasVigentes() : null;
    if (metas) this.publicarMetas(metas.config, d.por);
    if (d.continuarFolios && folio_maximo > 0) this.emitirAdmin('folio.continuacion', { tienda: d.tienda, caja: d.caja, hasta: folio_maximo, motivo: 'continuación del sistema anterior', por: d.por }, `folio.continuacion:${d.tienda}/${d.caja}:${folio_maximo}`);
    return { nuevas, existentes: d.filas.length - nuevas, folio_maximo, siguiente_folio: d.continuarFolios ? folio_maximo + 1 : 0 };
  }
  /** Mayor folio de las ventas importadas del sistema anterior para una caja (0 si no hay). */
  folioMaximoHistorico(tienda: string, caja: number): number {
    const prefijo = `hist:${tienda}/${caja}:`;
    return this.repo.opsDeTipos(['venta.historica']).filter((o) => o.op_id.startsWith(prefijo)).reduce((m, o) => Math.max(m, Number(o.payload.folio) || 0), 0);
  }

  /**
   * Entrega de piezas del almacén a una o varias tiendas. Exige confirmar que el artículo ya lleva sus etiquetas de precio y de
   * costura. Entregar más de lo registrado en el almacén requiere confirmación explícita (queda marcado `exceso`).
   * La tienda no recibe existencia hasta que su personal confirma la recepción al escanear el artículo.
   */
  entregar(d: { item_id: string; destinos: Record<string, number>; etiqueta_precio: boolean; etiqueta_costura: boolean; confirmar_exceso?: boolean; ref?: string; por: string }):
    { ok: true; existencia_almacen: number; ops: Op[] } | { ok: false; motivo: 'articulo_inexistente' | 'cantidad_invalida' | 'etiquetas_pendientes' | 'tienda_invalida' | 'excede'; disponible?: number; pedido?: number } {
    if (!catalogo(this.repo.ops()).has(d.item_id)) return { ok: false, motivo: 'articulo_inexistente' };
    const tiendas = Object.entries(d.destinos).filter(([, q]) => q !== 0);
    if (!tiendas.length || tiendas.some(([, q]) => !Number.isInteger(q) || q < 0)) return { ok: false, motivo: 'cantidad_invalida' };
    if (tiendas.some(([t]) => !this.ctx.tiendas.includes(t))) return { ok: false, motivo: 'tienda_invalida' };
    if (!d.etiqueta_precio || !d.etiqueta_costura) return { ok: false, motivo: 'etiquetas_pendientes' };
    const disponible = existenciaAlmacen(this.repo.opsDeTipos(['alm.entrada', 'alm.entrega', 'alm.faltante', 'alm.correccion', 'alm.ajuste'])).get(d.item_id)?.existencia ?? 0;
    // Reintento de una entrega ya registrada (misma referencia): se confirma sin moverla otra vez ni pedir confirmación.
    if (d.ref && tiendas.every(([t]) => this.repo.tieneOp(`alm.entrega:${d.ref}:${t}`))) return { ok: true, existencia_almacen: disponible, ops: [] };
    const pedido = tiendas.reduce((a, [, q]) => a + q, 0);
    const exceso = pedido > disponible;
    if (exceso && !d.confirmar_exceso) return { ok: false, motivo: 'excede', disponible, pedido };
    const base = d.ref ?? uuid();
    const ops: Op[] = [];
    for (const [tienda, qty] of tiendas) {
      const entrega_id = `${base}:${tienda}`;
      const op = this.emitirUna('alm.entrega', { entrega_id, item_id: d.item_id, tienda, qty, etiqueta_precio: true, etiqueta_costura: true, exceso, por: d.por }, `alm.entrega:${entrega_id}`);
      if (op) ops.push(op);
    }
    return { ok: true, existencia_almacen: disponible - (ops.length ? pedido : 0), ops };
  }

  /**
   * Corrige una entrada de almacén mal capturada (cantidad y/o pedimento) con motivo obligatorio. La entrada original no se edita: queda una
   * corrección que la reemplaza (el último registro manda; corregir a 0 equivale a anularla). Si la corrección deja la existencia del almacén en
   * negativo (ya se entregaron piezas de más) pide confirmación explícita. `correccion_id` hace que reintentar no repita nada.
   */
  corregirEntrada(d: { correccion_id: string; entrada_id: string; qty?: number; pedimento?: string | null; motivo: string; confirmar_negativo?: boolean }, por: string):
    { ok: true; existencia: number } | { ok: false; motivo: 'deja_negativo'; existencia: number } {
    if (!d.correccion_id) throw new ErrorDominio('DATOS_REQUERIDOS', 'falta la referencia de la corrección');
    const ops = this.repo.opsDeTipos(['alm.entrada', 'alm.entrega', 'alm.faltante', 'alm.correccion', 'alm.ajuste']);
    const entrada = ops.find((o) => o.tipo === 'alm.entrada' && o.payload.entrada_id === d.entrada_id);
    if (!entrada) throw new ErrorDominio('ENTRADA_INEXISTENTE', 'esa entrada de almacén no existe');
    const itemId = entrada.payload.item_id as string;
    if (this.repo.tieneOp(`alm.correccion:${d.correccion_id}`)) return { ok: true, existencia: existenciaAlmacen(ops).get(itemId)?.existencia ?? 0 };
    const motivo = String(d.motivo ?? '').trim();
    if (!motivo) throw new ErrorDominio('DATOS_REQUERIDOS', 'escriba el motivo de la corrección');
    if (d.qty === undefined && d.pedimento === undefined) throw new ErrorDominio('DATOS_REQUERIDOS', 'indique la cantidad o el pedimento correctos');
    if (d.qty !== undefined && (!Number.isInteger(d.qty) || d.qty < 0)) throw new ErrorDominio('CANTIDAD_INVALIDA', 'la cantidad es un entero de 0 o más');
    const pedimento = d.pedimento === undefined ? undefined : (String(d.pedimento ?? '').trim() || null);
    const actual = existenciaAlmacen(ops).get(itemId)?.existencia ?? 0;
    const previa = correccionesEntradas(ops).get(d.entrada_id)?.qty ?? entrada.payload.qty;
    const resultante = actual - previa + (d.qty ?? previa);
    if (resultante < 0 && actual >= 0 && !d.confirmar_negativo) return { ok: false, motivo: 'deja_negativo', existencia: resultante };
    this.emitirUna('alm.correccion', { entrada_id: d.entrada_id, item_id: itemId, ...(d.qty !== undefined ? { qty: d.qty } : {}), ...(pedimento !== undefined ? { pedimento } : {}), motivo, por }, `alm.correccion:${d.correccion_id}`, false);
    return { ok: true, existencia: resultante };
  }
  /**
   * Ubica las piezas faltantes de una entrega: `destinos` es el TOTAL por destino (`almacen`, `perdida` o una tienda). Guardar de nuevo
   * corrige lo anterior (el último valor reemplaza). La suma no puede exceder lo que faltó. Las piezas ubicadas en el almacén o en una
   * tienda se suman a su existencia; las perdidas solo quedan registradas.
   */
  resolverFaltante(entregaId: string, destinos: Record<string, number>, por: string): Faltante {
    const ops = this.repo.ops();
    const f = faltantes(ops).find((x) => x.entrega_id === entregaId);
    if (!f) throw new ErrorDominio('FALTANTE_INEXISTENTE', 'esa entrega no tiene piezas faltantes');
    const validos = new Set<string>([...DESTINOS_FALTANTE_ESPECIALES, ...this.ctx.tiendas]);
    for (const [d, q] of Object.entries(destinos)) {
      if (!validos.has(d)) throw new ErrorDominio('DESTINO_INVALIDO', `destino desconocido: ${d}`);
      if (!Number.isInteger(q) || q < 0) throw new ErrorDominio('CANTIDAD_INVALIDA', 'las cantidades deben ser enteros de 0 o más');
    }
    const nuevo = { ...f.ubicadas, ...destinos };
    const total = Object.values(nuevo).reduce((a, q) => a + q, 0);
    if (total > f.faltan) throw new ErrorDominio('EXCEDE_FALTANTE', `se ubicaron ${total} pieza(s) y solo faltaron ${f.faltan}`);
    for (const [d, q] of Object.entries(destinos)) {
      if ((f.ubicadas[d] ?? 0) === q) continue;
      this.emitirAdmin('alm.faltante', { entrega_id: entregaId, item_id: f.item_id, destino: d, qty: q, por }, `alm.faltante:${uuid()}`);
    }
    return faltantes(this.repo.ops()).find((x) => x.entrega_id === entregaId)!;
  }

  /**
   * Conteo físico de El Limbo: deja la existencia de cada artículo contado en lo que se contó (movimiento `conteo` por la diferencia contra lo que
   * el central sabe) y guarda el registro del conteo. Los artículos que no vienen en el conteo no se tocan. Reintentar el mismo `conteo_id` no repite nada.
   * La diferencia se calcula con lo que el central ha recibido: una venta que aún no ha sincronizado se descuenta al llegar.
   */
  contarLimbo(conteoId: string, lineas: { item_id: string; contado: number }[], por: string) {
    if (!conteoId) throw new ErrorDominio('DATOS_REQUERIDOS', 'falta la referencia del conteo');
    const previo = this.repo.getOp(`limbo.conteo:${conteoId}`);
    if (previo) return { ...previo.payload, ocurrio_en: previo.ocurrio_en, repetido: true };
    const porArticulo = new Map<string, number>();
    for (const l of lineas) porArticulo.set(l.item_id, l.contado);
    if (!porArticulo.size) throw new ErrorDominio('DATOS_REQUERIDOS', 'el conteo no tiene artículos');
    const ops = this.repo.ops();
    const cat = catalogo(ops);
    const saldos = stock(ops, LIMBO);
    for (const [item, q] of porArticulo) {
      if (!cat.has(item)) throw new ErrorDominio('ARTICULO_INEXISTENTE', item);
      if (!Number.isInteger(q) || q < 0) throw new ErrorDominio('CANTIDAD_INVALIDA', 'lo contado es un entero de 0 o más');
    }
    const detalle = [...porArticulo].map(([item_id, contado]) => ({ item_id, sistema: saldos.get(item_id) ?? 0, contado, delta: contado - (saldos.get(item_id) ?? 0) }));
    for (const l of detalle) if (l.delta !== 0) this.emitirAdmin('inv.movement', { item_id: l.item_id, tienda: LIMBO, delta: l.delta, tipo: 'conteo', doc: `conteo_limbo:${conteoId}` }, `mov:conteoL:${conteoId}:${l.item_id}`);
    const op = this.emitirUna('limbo.conteo', { conteo_id: conteoId, por, lineas: detalle }, `limbo.conteo:${conteoId}`, false)!;
    return { ...op.payload, ocurrio_en: op.ocurrio_en, repetido: false };
  }

  /**
   * Da su ubicación real a piezas que hoy figuran en El Limbo: las pasa al **almacén** (desde ahí se sacan a piso con la entrega de siempre, que la tienda confirma
   * al escanear) o las da de **baja** (ya no existen).
   * `qty` omitida = todo lo que El Limbo tiene de ese artículo (los que no tienen existencia se omiten); con `qty` se mueve exactamente esa cantidad
   * (El Limbo puede quedar en negativo: es el mismo criterio de las ventas sin existencia registrada). `movimiento_id` hace que reintentar no repita nada.
   * Con `solo_revisar` no se guarda nada: solo devuelve lo que pasaría.
   */
  reubicarLimbo(d: { movimiento_id: string; destino: string; items: { item_id: string; qty?: number }[]; por: string; solo_revisar?: boolean }): ResultadoReubicacion {
    const destino = String(d.destino ?? '');
    if (!d.movimiento_id) throw new ErrorDominio('DATOS_REQUERIDOS', 'falta la referencia del movimiento');
    if (destino !== 'almacen' && destino !== 'baja') throw new ErrorDominio('DESTINO_INVALIDO', `destino desconocido: ${destino}`);
    const previo = this.repo.getOp(`limbo.reubicacion:${d.movimiento_id}`);
    if (previo && !d.solo_revisar) return { ...(previo.payload as Omit<ResultadoReubicacion, 'repetido' | 'ocurrio_en'>), ocurrio_en: previo.ocurrio_en, repetido: true };
    const ops = this.repo.ops();
    const cat = catalogo(ops);
    const saldos = stock(ops, LIMBO);
    const lineas: ResultadoReubicacion['lineas'] = [];
    const omitidos: ResultadoReubicacion['omitidos'] = [];
    const vistos = new Set<string>();
    for (const it of d.items) {
      if (vistos.has(it.item_id)) continue;
      vistos.add(it.item_id);
      if (!cat.has(it.item_id)) { omitidos.push({ item_id: it.item_id, motivo: 'no existe en el catálogo' }); continue; }
      const saldo = saldos.get(it.item_id) ?? 0;
      if (it.qty !== undefined && (!Number.isInteger(it.qty) || it.qty <= 0)) throw new ErrorDominio('CANTIDAD_INVALIDA', 'la cantidad es un entero mayor que 0');
      const qty = it.qty ?? saldo;
      if (qty <= 0) { omitidos.push({ item_id: it.item_id, motivo: 'El Limbo no tiene piezas de este artículo' }); continue; }
      lineas.push({ item_id: it.item_id, qty, limbo_antes: saldo });
    }
    const resumen = {
      movimiento_id: d.movimiento_id, destino, por: d.por, lineas, omitidos,
      articulos: lineas.length, piezas: lineas.reduce((a, l) => a + l.qty, 0), quedan_negativos: lineas.filter((l) => l.limbo_antes - l.qty < 0).length,
    };
    if (d.solo_revisar || !lineas.length) return { ...resumen, ocurrio_en: this.ctx.reloj.now(), repetido: false, aplicado: false };
    const doc = `limbo_reubicacion:${d.movimiento_id}`;
    const tipo = destino === 'almacen' ? 'limbo_a_almacen' : 'baja_limbo';
    for (const l of lineas) {
      this.emitirAdmin('inv.movement', { item_id: l.item_id, tienda: LIMBO, delta: -l.qty, tipo, doc }, `mov:reubL:${d.movimiento_id}:${l.item_id}`);
      if (destino === 'almacen') this.emitirUna('alm.entrada', { entrada_id: `${d.movimiento_id}:${l.item_id}`, item_id: l.item_id, qty: l.qty, pedimento: null, lote_doc: doc, fuente: 'limbo', por: d.por }, `alm.entrada:${d.movimiento_id}:${l.item_id}`, false);
    }
    const op = this.emitirUna('limbo.reubicacion', resumen, `limbo.reubicacion:${d.movimiento_id}`, false)!;
    return { ...resumen, ocurrio_en: op.ocurrio_en, repetido: false, aplicado: true };
  }

  /**
   * «Existencias reales» (solo propietario/administradores): deja el artículo con EXACTAMENTE estas cantidades por ubicación, tal cual, sin escáner ni
   * confirmación de recepción. `cantidades` trae `limbo`, `almacen` y/o una tienda (DUO, LON…) con la cantidad que de verdad hay (entero ≥ 0); lo que
   * no se menciona no se toca. Se guarda la diferencia contra lo que conoce el central como un movimiento `ajuste_admin` (las tiendas y sus cajas lo
   * reciben) y, en el almacén, un `alm.ajuste`. Un conteo de tienda también limpia la marca «sin verificar» de ese artículo.
   * `ajuste_id` hace que reintentar no repita nada; con `solo_revisar` solo devuelve lo que cambiaría.
   */
  fijarExistencias(d: { ajuste_id: string; item_id: string; cantidades: Record<string, number>; motivo?: string; por: string; solo_revisar?: boolean }): ResultadoAjuste {
    if (!d.ajuste_id) throw new ErrorDominio('DATOS_REQUERIDOS', 'falta la referencia del ajuste');
    const previo = this.repo.getOp(`inv.ajuste:${d.ajuste_id}`);
    if (previo && !d.solo_revisar) return { ...(previo.payload as Omit<ResultadoAjuste, 'repetido' | 'ocurrio_en'>), ocurrio_en: previo.ocurrio_en, repetido: true };
    const ops = this.repo.ops();
    if (!catalogo(ops).has(d.item_id)) throw new ErrorDominio('ARTICULO_INEXISTENTE', d.item_id);
    const pedidos = Object.entries(d.cantidades ?? {});
    if (!pedidos.length) throw new ErrorDominio('DATOS_REQUERIDOS', 'indique las cantidades');
    for (const [lugar, q] of pedidos) {
      if (lugar !== 'limbo' && lugar !== 'almacen' && !this.ctx.tiendas.includes(lugar)) throw new ErrorDominio('UBICACION_INVALIDA', `ubicación desconocida: ${lugar}`);
      if (!Number.isInteger(q) || q < 0) throw new ErrorDominio('CANTIDAD_INVALIDA', 'las cantidades son enteros de 0 o más');
    }
    const actual = (lugar: string) => (lugar === 'limbo' ? stock(ops, LIMBO).get(d.item_id) ?? 0 : lugar === 'almacen' ? existenciaAlmacen(ops.filter((o) => o.tipo.startsWith('alm.'))).get(d.item_id)?.existencia ?? 0 : stock(ops, lugar).get(d.item_id) ?? 0);
    const cambios = pedidos.map(([lugar, despues]) => ({ lugar, antes: actual(lugar), despues })).map((c) => ({ ...c, delta: c.despues - c.antes }));
    const resumen = { ajuste_id: d.ajuste_id, item_id: d.item_id, por: d.por, motivo: String(d.motivo ?? '').trim().slice(0, 200), cambios, con_cambio: cambios.filter((c) => c.delta !== 0).length };
    if (d.solo_revisar || !resumen.con_cambio) return { ...resumen, ocurrio_en: this.ctx.reloj.now(), repetido: false, aplicado: false };
    const doc = `ajuste_admin:${d.ajuste_id}`;
    for (const c of cambios) {
      if (c.delta === 0) continue;
      if (c.lugar === 'almacen') this.emitirUna('alm.ajuste', { ajuste_id: d.ajuste_id, item_id: d.item_id, delta: c.delta, motivo: resumen.motivo, por: d.por }, `alm.ajuste:${d.ajuste_id}`, false);
      else {
        this.emitirAdmin('inv.movement', { item_id: d.item_id, tienda: c.lugar === 'limbo' ? LIMBO : c.lugar, delta: c.delta, tipo: 'ajuste_admin', doc }, `mov:ajuste:${d.ajuste_id}:${c.lugar}`);
        if (c.lugar !== 'limbo') {
          const pendientes = existenciaVerificada(ops, c.lugar, d.item_id).pendientes;
          if (pendientes.length) this.emitirAdmin('inv.conteo', { item_id: d.item_id, tienda: c.lugar, contado: c.despues, saldo_previo: c.antes, delta: c.delta, usuario: d.por, cubre: pendientes, admin: true }, `conteo:ajuste:${d.ajuste_id}:${c.lugar}`);
        }
      }
    }
    const op = this.emitirUna('inv.ajuste', resumen, `inv.ajuste:${d.ajuste_id}`, false)!;
    return { ...resumen, ocurrio_en: op.ocurrio_en, repetido: false, aplicado: true };
  }

  anclas(tienda: string, caja: number): Anclas {
    let ceiling: number | null = null;
    let hwm = 0;
    for (const o of this.repo.ops()) {
      if (o.tipo === 'folio.lease_granted' && o.payload.tienda === tienda && o.payload.caja === caja) ceiling = Math.max(ceiling ?? 0, o.payload.techo);
      if ((o.tipo === 'sale.confirmed' || o.tipo === 'return.registered') && o.payload.tienda === tienda && o.payload.caja === caja && o.payload.folio != null && !o.payload.serie) hwm = Math.max(hwm, o.payload.folio);
    }
    return { ceiling, hwm, fuente: 'central' };
  }
  bloqueItemNo(k: number): { desde: number; hasta: number } {
    const libre = this.repo.kvGet<number>('itemno:libre') ?? this.maxItemNoNumerico() + 1;
    this.repo.kvSet('itemno:libre', libre + k);
    return { desde: libre, hasta: libre + k - 1 };
  }
}

// ───────────────────────────── Caja ─────────────────────────────

export interface ResultadoAjuste {
  ajuste_id: string;
  item_id: string;
  por: string;
  motivo: string;
  cambios: { lugar: string; antes: number; despues: number; delta: number }[];
  con_cambio: number;
  ocurrio_en: string;
  repetido: boolean;
  /** false = solo se revisó (o no había nada que cambiar). */
  aplicado?: boolean;
}

export interface ResultadoReubicacion {
  movimiento_id: string;
  destino: string;
  por: string;
  lineas: { item_id: string; qty: number; limbo_antes: number }[];
  omitidos: { item_id: string; motivo: string }[];
  articulos: number;
  piezas: number;
  /** Artículos que quedarían (o quedaron) con El Limbo en negativo. */
  quedan_negativos: number;
  ocurrio_en: string;
  repetido: boolean;
  /** false = solo se revisó (o no había nada que mover). */
  aplicado?: boolean;
}

export interface CambioEnCurso {
  sale_id: string;
  folio_origen: number;
  renglones: { linea_id: string; qty: number }[];
  /** Lo que se regresa, tal como se vendió (para mostrarlo en negativo). */
  lineas: { linea_id: string; item_id: string; item_no: string | null; codigo: string; descripcion: string; marca: string; estilo: string; qty: number; precio_unit: number; importe: number }[];
  /** Importe realmente pagado por esas piezas (descuento incluido). */
  credito: number;
  /** Quién es la clienta y por qué se cambia (se capturan al aceptar el cambio; faltan en cambios iniciados antes de esta regla). */
  clienta?: { nombre: string; telefono: string };
  motivo?: string;
}

interface Carrito {
  id: string;
  lineas: Linea[];
  estado: 'abierto' | 'confirmado' | 'descartado';
  intent_id?: string;
  /** Tipo de cambio con que se inició el cobro en dólares: el cobro lo conserva aunque cambie el global. */
  tasa?: { version: number; tasa: number; bloqueada_en: string };
  /** Código de cupón capturado en esta venta (se vuelve a validar cada vez que cambia el carrito). */
  cupon?: string;
  /** Resultado del último cálculo de promociones y cupón (solo para mostrar). */
  descuentos?: { aplicadas: ResultadoDescuentos['aplicadas']; cupon: ResultadoDescuentos['cupon'] };
  /** Quién atendió a la clienta (`id` null = «Autocompra»: nadie la ayudó). Se elige en la venta, sin clave; queda en la venta y en los reportes. */
  vendedora?: { id: string | null; alias: string };
  /** Venta a una empleada: descuento de empleada (15 %, o 30 % en uniformes) y, si quiere, cargo a su cuenta. Se confirma con la clave de la empleada. */
  empleada?: { id: string; nombre: string; sin_supervisor?: boolean };
  /** Cliente VIP elegido en la venta (su porcentaje queda fijo en esta venta) y quién lo aplicó con su clave. */
  vip?: { id: string; nombre: string; pct: number; aplico: string };
  /** Cambio en curso: piezas que la clienta regresa de una venta anterior; su importe es un crédito que se descuenta de lo que se lleve en ESTA venta. */
  cambio?: CambioEnCurso;
  /** Venta en espera: el cliente se fue un momento y la caja atiende a otro. No reserva existencias; se recalcula al retomarla. */
  espera?: { desde: string; nota: string; por: string };
}

export type EstadoFolios = { estado: 'activa' | 'recuperacion'; motivo: string | null; ultimo: number; techo: number | null };

export class Caja {
  readonly id: string;
  readonly nodoId: string;
  readonly tienda: string;
  readonly caja: number;
  readonly repo: Repo;
  readonly ctx: Ctx;
  readonly enlace: Enlace;
  readonly cfg: CajaCfg;
  readonly idx: Indice;

  constructor(tienda: string, caja: number, repo: Repo, ctx: Ctx, enlace: Enlace, opts: { restaurado?: 'disco_nuevo' | 'respaldo' } = {}) {
    this.tienda = tienda;
    this.caja = caja;
    this.id = `${tienda}/${caja}`;
    this.nodoId = `caja:${this.id}`;
    this.repo = repo;
    this.idx = new Indice(repo);
    this.ctx = ctx;
    this.enlace = enlace;
    this.cfg = ctx.cajasCfg.find((c) => c.tienda === tienda && c.caja === caja)!;
    const nueva = this.repo.kvGet('identidad') === undefined;
    this.repo.tx(() => {
      if (nueva) {
        this.repo.kvSet('identidad', { tienda, caja });
        this.repo.kvSet('folio:ultimo', 0);
        this.repo.kvSet('folio:techo', null);
        if (opts.restaurado) {
          // Un equipo "nuevo" para una caja que ya existía: no se sabe qué folios se emitieron.
          this.repo.kvSet('folio:estado', 'recuperacion');
          this.repo.kvSet('folio:motivo', 'disco_nuevo_en_caja_existente');
          this.repo.kvSet('itemno:bloqueado', true);
        } else {
          this.repo.kvSet('folio:estado', 'activa');
          this.repo.kvSet('folio:motivo', null);
        }
      } else if (opts.restaurado === 'respaldo') {
        this.repo.kvSet('folio:estado', 'recuperacion');
        this.repo.kvSet('folio:motivo', 'restaurado_desde_respaldo');
        this.repo.kvSet('itemno:bloqueado', true);
      }
    });
    this.verificarContraAnclas();
  }

  // ── folios ──
  estadoFolios(): EstadoFolios {
    return {
      estado: this.repo.kvGet<'activa' | 'recuperacion'>('folio:estado')!,
      motivo: this.repo.kvGet<string | null>('folio:motivo') ?? null,
      ultimo: this.repo.kvGet<number>('folio:ultimo') ?? 0,
      techo: this.repo.kvGet<number | null>('folio:techo') ?? null,
    };
  }
  private arrendamientoActivo() {
    return this.ctx.politicas.P06_huecos_de_folio === 'aceptados';
  }
  /** P-06 aceptada: con hub se puede recuperar solo; si no, solo por atestación manual. */
  arrendamientoFolios(): boolean { return this.arrendamientoActivo(); }
  /** Lo que el hub o el central saben de esta serie (mayor folio recibido y techo concedido); null si no hay acceso. */
  anclasDeFolios(): { hwm: number; ceiling: number | null } | null { return this.enlace.anclasFolios(); }
  /**
   * Equipo nuevo para una caja que ya había vendido (otra PC, disco vacío): la serie continúa después del mayor folio que el central ya conoce de esta
   * caja, para no repetir números. Solo sube el contador, nunca lo baja.
   */
  continuarFoliosDesde(maximo: number): boolean {
    const st = this.estadoFolios();
    if (st.estado !== 'activa' || !Number.isInteger(maximo) || maximo <= st.ultimo) return false;
    this.repo.kvSet('folio:ultimo', maximo);
    if (this.arrendamientoActivo()) this.repo.kvSet('folio:techo', maximo);
    return true;
  }
  /** Rangos de folios que quedaron sin comprobar tras una recuperación (documentados, nunca reutilizados). */
  huecosDeFolio(): { desde: number; hasta: number; motivo: string; ocurrio_en: string }[] {
    return this.opsDe('folio.gap').filter((o) => o.payload.tienda === this.tienda && o.payload.caja === this.caja).map((o) => ({ desde: o.payload.desde, hasta: o.payload.hasta, motivo: o.payload.motivo, ocurrio_en: o.ocurrio_en }));
  }
  /** Mayor folio de esta serie visto en un ticket escaneado que superaba el contador (prueba de que se emitieron folios que la caja no tiene). */
  folioMaximoVisto(): number {
    return this.opsDe('incidencia.ticket_fuera_de_rango').filter((o) => o.payload.tienda === this.tienda && o.payload.caja === this.caja).reduce((m, o) => Math.max(m, o.payload.folio), 0);
  }
  /** La confirmación de un folio la da un supervisor con su clave (sin controles con clave, la caja trabaja abierta). */
  verificarSupervisor(autoriza: Autoriza | undefined, usuario = ''): string | null {
    const nombre = this.verificarAutorizador(usuario, autoriza, true);
    if (nombre === null) return null;
    if (autoriza?.sin_segundo) return nombre; // no hay supervisor: confirma quien cobra con su clave y queda anotado
    if (!this.idx.supervisores().some((x) => x.activo && nombreClave(x.nombre) === nombreClave(nombre))) throw new ErrorDominio('AUTORIZADOR_INVALIDO', 'la continuación de folios la confirma un supervisor con su clave');
    return nombre;
  }
  private bloquearFolios(motivo: string) {
    this.repo.kvSet('folio:estado', 'recuperacion');
    this.repo.kvSet('folio:motivo', motivo);
  }
  /** Si hay evidencia (hub/central) de que el contador local está atrasado, no se emite hasta resolverlo. */
  private verificarContraAnclas() {
    const st = this.estadoFolios();
    if (st.estado !== 'activa') return;
    const a = this.enlace.anclasFolios();
    if (a && (a.hwm > st.ultimo || (a.ceiling != null && st.techo != null && a.ceiling > st.techo))) {
      this.bloquearFolios('contador_local_atrasado_respecto_a_hub_o_central');
    }
  }
  iniciarArrendamiento() {
    this.renovarSiHaceFalta();
  }
  private renovarSiHaceFalta() {
    if (!this.arrendamientoActivo() || this.estadoFolios().estado !== 'activa') return;
    const st = this.estadoFolios();
    const k = this.ctx.politicas.K_folios;
    if (st.techo == null || st.techo - st.ultimo < k / 2) {
      const nuevo = this.enlace.arrendarFolios(st.ultimo, k);
      if (nuevo != null) this.repo.kvSet('folio:techo', nuevo);
    }
  }
  /**
   * Folio de una compra a crédito de empleada: serie CR propia de ESTA caja (cada caja tiene su contador; el código del ticket lleva tienda y caja, así que
   * no se repite entre cajas). Nunca baja del mayor CR que la caja ya conoce (p. ej. tras restaurar el equipo y sincronizar).
   */
  private siguienteFolioCredito(): number {
    const st = this.estadoFolios();
    if (st.estado !== 'activa') throw new ErrorDominio('FOLIO_BLOQUEADO', `emisión bloqueada (${st.motivo}); resolver la recuperación`);
    const conocido = this.repo.opsDeTipos(['sale.confirmed']).reduce((m, o) => (o.payload.serie === 'CR' && o.payload.tienda === this.tienda && o.payload.caja === this.caja ? Math.max(m, Number(o.payload.folio) || 0) : m), 0);
    const n = Math.max(this.repo.kvGet<number>('foliocr:ultimo') ?? 0, conocido) + 1;
    this.repo.kvSet('foliocr:ultimo', n);
    return n;
  }
  /** Cómo queda la cuenta de la empleada tras este cargo: límite, saldo, disponible y sus últimos abonos (queda en la venta, para el ticket y su reimpresión). */
  private resumenCreditoTras(empleadaId: string, cargo: number) {
    const cuenta = this.cuentaEmpleada(empleadaId);
    const saldo = cuenta.saldo + cargo;
    return { limite: cuenta.limite, saldo, disponible: Math.max(0, cuenta.limite - saldo), abonos: this.abonosRecientes(empleadaId, 3) };
  }
  /** Últimos abonos de nómina de una empleada (el más reciente primero). */
  abonosRecientes(empleadaId: string, n = 5): { fecha: string; monto: number }[] {
    return this.cuentaEmpleada(empleadaId).movimientos.filter((m) => m.tipo === 'abono').slice(0, n).map((m) => ({ fecha: m.fecha, monto: m.monto }));
  }
  private siguienteFolio(): number {
    const st = this.estadoFolios();
    if (st.estado !== 'activa') throw new ErrorDominio('FOLIO_BLOQUEADO', `emisión bloqueada (${st.motivo}); resolver la recuperación`);
    const n = st.ultimo + 1;
    if (this.arrendamientoActivo() && (st.techo == null || n > st.techo)) {
      throw new ErrorDominio('FOLIO_BLOQUEADO', 'techo de folios agotado y sin acceso al hub para renovarlo');
    }
    this.repo.kvSet('folio:ultimo', n);
    return n;
  }

  /** Recuperación automática: SOLO con arrendamiento vigente (P-06) y un techo registrado en hub/central. */
  recuperarFolios() {
    const st = this.estadoFolios();
    if (st.estado === 'activa') return { modo: 'ninguna' as const };
    if (!this.arrendamientoActivo()) {
      throw new ErrorDominio('FOLIO_BLOQUEADO', 'recuperación automática no disponible (P-06 no aceptada): requiere atestación manual');
    }
    const a = this.enlace.anclasFolios();
    if (!a) throw new ErrorDominio('FOLIO_BLOQUEADO', 'sin acceso a hub ni central: no se puede asegurar que no se reutilicen folios');
    if (a.ceiling == null) throw new ErrorDominio('FOLIO_BLOQUEADO', 'no hay techo registrado: evidencia incompleta, no se puede asegurar');
    const conocido = Math.max(a.hwm, st.ultimo);
    const nuevo = Math.max(a.ceiling, conocido);
    this.repo.tx(() => {
      if (nuevo > conocido) this.emitir('folio.gap', { tienda: this.tienda, caja: this.caja, desde: conocido + 1, hasta: nuevo, motivo: 'recuperacion_sin_evidencia' });
      this.repo.kvSet('folio:ultimo', nuevo);
      this.repo.kvSet('folio:techo', nuevo);
      this.repo.kvSet('folio:estado', 'activa');
      this.repo.kvSet('folio:motivo', null);
    });
    this.renovarSiHaceFalta();
    return { modo: 'automatica' as const, desde: conocido + 1, hasta: nuevo };
  }

  /** Resolución humana. El sistema NO puede verificarla: se registra como atestación. */
  atestarSiguienteFolio(a: { siguiente: number; usuario: string; evidencia: { tipo: string; referencia: string }; sinAnclasConfirmado?: boolean; autorizo?: string | null }) {
    const st = this.estadoFolios();
    if (st.estado === 'activa') throw new ErrorDominio('FOLIO_ACTIVO', 'no hay recuperación pendiente');
    if (!a.evidencia?.referencia?.trim()) throw new ErrorDominio('EVIDENCIA_REQUERIDA', 'se requiere una referencia a evidencia física');
    const an = this.enlace.anclasFolios();
    if (!an && !a.sinAnclasConfirmado) {
      throw new ErrorDominio('EVIDENCIA_INSUFICIENTE', 'sin acceso a hub/central no se puede contrastar el folio; confirmar explícitamente que se atesta sin anclas');
    }
    const registrado = Math.max(st.ultimo, an?.hwm ?? 0, an?.ceiling ?? 0);
    const conocido = Math.max(registrado, this.folioMaximoVisto()); // un ticket escaneado también prueba que existen folios
    if (a.siguiente <= conocido) throw new ErrorDominio('FOLIO_REUTILIZABLE', `el folio ${a.siguiente} no supera lo conocido (${conocido})`);
    this.repo.tx(() => {
      this.emitir('folio.atestacion_manual', {
        tienda: this.tienda, caja: this.caja, siguiente: a.siguiente, usuario: a.usuario, evidencia: a.evidencia,
        verificable: false, hwm_conocido: registrado, anclas_disponibles: an !== null, ...(a.autorizo ? { autorizado_por: a.autorizo } : {}),
      });
      if (a.siguiente - 1 > registrado) this.emitir('folio.gap', { tienda: this.tienda, caja: this.caja, desde: registrado + 1, hasta: a.siguiente - 1, motivo: 'atestacion_manual' });
      this.repo.kvSet('folio:ultimo', a.siguiente - 1);
      this.repo.kvSet('folio:techo', this.arrendamientoActivo() ? a.siguiente - 1 : null);
      this.repo.kvSet('folio:estado', 'activa');
      this.repo.kvSet('folio:motivo', null);
    });
    this.renovarSiHaceFalta();
  }

  /** Cerco: un ticket de esta serie con folio mayor al contador prueba que el contador está atrasado. */
  registrarTicketEscaneado(t: { tienda: string; caja: number; folio: number; serie?: 'CR' }) {
    if (t.tienda !== this.tienda || t.caja !== this.caja || t.serie) return { ok: true }; // la serie CR (crédito de empleada) no es la de ventas
    const st = this.estadoFolios();
    if (t.folio > st.ultimo) {
      this.repo.tx(() => {
        this.bloquearFolios('ticket_con_folio_mayor_al_contador');
        this.emitir('incidencia.ticket_fuera_de_rango', { tienda: this.tienda, caja: this.caja, folio: t.folio, ultimo: st.ultimo });
      });
      return { ok: false };
    }
    return { ok: true };
  }

  // ── infraestructura ──
  private emitir(tipo: string, payload: unknown, opId?: string): Op {
    const op = crearOp(tipo, this.tienda, this.caja, this.nodoId, this.ctx.reloj.now(), payload, opId);
    if (this.repo.appendOp(op)) this.repo.encolar(op.op_id, `hub:${this.tienda}`);
    return op;
  }
  ops(): Op[] {
    return this.repo.ops();
  }
  /** Solo operaciones de estos tipos (rutas calientes: no recorre toda la bitácora). */
  opsDe(...tipos: string[]): Op[] {
    return this.repo.opsDeTipos(tipos);
  }
  opsVentas(): Op[] {
    return this.opsDe('sale.confirmed', 'sale.cancelled');
  }
  stockLocal(itemId: string): number {
    return this.idx.saldo(this.tienda, itemId);
  }
  recibir(op: Op, _desde: string): void {
    if (this.repo.tieneOp(op.op_id)) return;
    this.repo.appendOp(op);
  }

  // ── catálogo y altas (incluye alta sin internet) ──
  buscarPorCodigo(codigo: string): Articulo[] {
    return this.idx.buscarCodigo(codigo); // un código vacío no identifica nada
  }

  altaArticulo(d: { codigo: string; marca: string; descripcion: string; estilo: string; lote: string; departamento: string; precio: number; existencia_inicial?: number }): Articulo {
    if (this.buscarPorCodigo(d.codigo).length > 0) throw new ErrorDominio('CODIGO_EXISTE', `el código ${d.codigo} ya existe localmente`);
    const pol = this.ctx.politicas.P07_item_no;
    let item_no: string | null = null;
    if (pol === 'b_bloques') {
      let b = this.repo.kvGet<{ next: number; fin: number }>('itemno:bloque');
      if (!b || b.next > b.fin) {
        const nuevo = this.enlace.bloqueItemNo(this.ctx.politicas.K_item_no);
        if (!nuevo) throw new ErrorDominio('ITEMNO_BLOQUEADO', 'sin bloque de Item # vigente y sin acceso al central');
        b = { next: nuevo.desde, fin: nuevo.hasta };
      }
      item_no = String(b.next);
      this.repo.kvSet('itemno:bloque', { next: b.next + 1, fin: b.fin });
    } else if (pol === 'c_espacios') {
      if (this.repo.kvGet('itemno:bloqueado')) throw new ErrorDominio('ITEMNO_BLOQUEADO', 'contador local de Item # perdido: no se puede asegurar que no se reutilice');
      const n = (this.repo.kvGet<number>('itemno:local') ?? 0) + 1;
      this.repo.kvSet('itemno:local', n);
      item_no = `${this.tienda}${this.caja}-${n}`;
    }
    const art: Articulo = {
      item_id: uuid(), codigo: d.codigo, item_no, marca: d.marca, descripcion: d.descripcion, estilo: d.estilo,
      lote: d.lote, departamento: d.departamento, precio: d.precio, origen: this.id,
    };
    this.repo.tx(() => {
      this.emitir('item.created', art, `item:${art.item_id}`);
      if (d.existencia_inicial) {
        // Existencia inicial como movimiento trazable, no como alteración silenciosa.
        this.emitir('inv.movement', { item_id: art.item_id, tienda: this.tienda, delta: d.existencia_inicial, tipo: 'existencia_inicial', doc: `alta:${art.item_id}` }, `mov:alta:${art.item_id}`);
      }
    });
    return art;
  }
  /**
   * Confirma con la clave PROPIA del cajero (la del usuario de la sesión, no la de otro): un tercero no puede hacer la operación a su nombre.
   * Cinco claves equivocadas seguidas bloquean al cajero 5 minutos en esta caja (una clave de 4 dígitos no debe poder adivinarse probando).
   */
  verificarClaveCajero(usuario: string, clave: string): Cajero {
    const llave = `clavefallos:${nombreClave(usuario)}`;
    const fallos = this.repo.kvGet<{ n: number; hasta: number }>(llave) ?? { n: 0, hasta: 0 };
    const ahora = Date.parse(this.ctx.reloj.now());
    if (fallos.hasta > ahora) throw new ErrorDominio('CLAVE_BLOQUEADA', `demasiados intentos con una clave equivocada: espere ${Math.ceil((fallos.hasta - ahora) / 60000)} minuto(s)`);
    const cajero = this.idx.cajeros().find((c) => c.activo && nombreClave(c.nombre) === nombreClave(usuario));
    if (!cajero) throw new ErrorDominio('CAJERO_SIN_CLAVE', `«${usuario}» no tiene una clave registrada: pida a Administración que la dé de alta en Personal → Perfiles`);
    if (!claveValida(clave) || cajero.hash !== hashClave(cajero.sal, clave)) {
      const n = fallos.n + 1;
      this.repo.kvSet(llave, n >= 5 ? { n: 0, hasta: ahora + 5 * 60000 } : { n, hasta: 0 });
      throw new ErrorDominio('CLAVE_INVALIDA', 'la clave no es correcta');
    }
    this.repo.kvSet(llave, { n: 0, hasta: 0 });
    return cajero;
  }
  /** Los controles con clave (retiros, cancelar una venta cobrada, devoluciones) se activan en cuanto hay cajeros registrados con clave. */
  controlesConClave(): boolean {
    return this.idx.cajerasRegistradas().some((c) => c.activo);
  }
  /**
   * Autorización de OTRA persona: otro cajero activo o un supervisor activo (por su clave de caja) con su nombre y su clave. Quien hace la operación
   * no puede autorizarse a sí mismo. Las claves equivocadas se cuentan por autorizador (5 fallos = 5 minutos de bloqueo). Devuelve el nombre registrado.
   */
  verificarAutorizador(usuarioActual: string, autoriza: Autoriza | undefined, permitirPropio = false): string | null {
    if (!this.controlesConClave()) return null; // sin cajeros registrados no hay a quién pedirle clave: la caja trabaja abierta
    // El dueño con sesión iniciada no necesita a nadie más: autoriza con su PROPIA clave (sin leyenda de «sin segunda persona»).
    if (this.esSupervisorActivo(usuarioActual) && autoriza?.clave && (autoriza.sin_segundo || !String(autoriza.nombre ?? '').trim() || nombreClave(String(autoriza.nombre)) === nombreClave(usuarioActual))) return this.verificarClaveCajero(usuarioActual, String(autoriza.clave)).nombre;
    // «No hay nadie más»: quien cobra autoriza con su PROPIA clave y queda anotado que no hubo segunda persona.
    if (autoriza?.sin_segundo) return `${this.verificarClaveCajero(usuarioActual, String(autoriza.clave ?? '')).nombre} (sin segunda persona)`;
    const nombre = String(autoriza?.nombre ?? '').trim();
    if (!nombre || !autoriza?.clave) throw new ErrorDominio('AUTORIZACION_REQUERIDA', 'esta operación necesita la clave de otra Vendedora-Cajera o de un supervisor');
    if (!permitirPropio && nombreClave(nombre) === nombreClave(usuarioActual)) throw new ErrorDominio('AUTORIZADOR_INVALIDO', 'la autorización debe darla otra persona, no quien hace la operación');
    if (this.idx.cajeros().some((c) => c.activo && nombreClave(c.nombre) === nombreClave(nombre))) return this.verificarClaveCajero(nombre, String(autoriza.clave)).nombre;
    const sup = this.idx.supervisores().find((s) => s.activo && nombreClave(s.nombre) === nombreClave(nombre));
    if (!sup) throw new ErrorDominio('AUTORIZADOR_INVALIDO', `«${nombre}» no es un cajero ni un supervisor activo con clave`);
    const llave = `clavefallos:sup:${nombreClave(sup.nombre)}`;
    const fallos = this.repo.kvGet<{ n: number; hasta: number }>(llave) ?? { n: 0, hasta: 0 };
    const ahora = Date.parse(this.ctx.reloj.now());
    if (fallos.hasta > ahora) throw new ErrorDominio('CLAVE_BLOQUEADA', `demasiados intentos con una clave equivocada: espere ${Math.ceil((fallos.hasta - ahora) / 60000)} minuto(s)`);
    if (!claveValida(autoriza.clave) || sup.hash !== hashClave(sup.sal, autoriza.clave)) {
      const n = fallos.n + 1;
      this.repo.kvSet(llave, n >= 5 ? { n: 0, hasta: ahora + 5 * 60000 } : { n, hasta: 0 });
      throw new ErrorDominio('CLAVE_INVALIDA', 'la clave de quien autoriza no es correcta');
    }
    this.repo.kvSet(llave, { n: 0, hasta: 0 });
    return sup.nombre;
  }
  /** Foto del perfil de quien tiene la sesión (data URL) o null: se muestra junto a su nombre en la barra de la caja. */
  fotoDe(usuario: string): string | null {
    const c = this.idx.cajeros().find((x) => nombreClave(x.nombre) === nombreClave(usuario));
    return c?.perfil?.foto ?? null;
  }
  /** ¿Quien tiene la sesión es el dueño del sistema (Edgardo Morales, con clave de caja)? Solo él tiene autoridad plena en la caja; los demás supervisores siguen como antes. */
  esSupervisorActivo(usuario: string): boolean {
    return !!usuario && this.idx.supervisores().some((s) => s.activo && s.dueno && nombreClave(s.nombre) === nombreClave(usuario));
  }
  /** Quién puede autorizar al cajero actual: los demás cajeros activos y los supervisores activos. */
  autorizadoresPosibles(usuarioActual: string, incluirPropio = false): { nombre: string; tipo: 'cajero' | 'supervisor' }[] {
    const otro = (n: string) => incluirPropio || this.esSupervisorActivo(usuarioActual) || nombreClave(n) !== nombreClave(usuarioActual);
    const sups = new Set(this.idx.supervisores().map((s) => nombreClave(s.nombre)));
    const lista = this.idx.cajeros().filter((c) => c.activo && otro(c.nombre)).map((c) => ({ nombre: c.nombre, tipo: (sups.has(nombreClave(c.nombre)) ? 'supervisor' : 'cajero') as 'cajero' | 'supervisor' }));
    // Un supervisor se autoriza a sí mismo: aparece primero y queda elegido por omisión.
    return this.esSupervisorActivo(usuarioActual) ? [...lista.filter((x) => nombreClave(x.nombre) === nombreClave(usuarioActual)), ...lista.filter((x) => nombreClave(x.nombre) !== nombreClave(usuarioActual))] : lista;
  }
  /** Minutos de inactividad que cierran la sesión de la caja (0 = nunca). */
  configSesion() {
    return this.idx.configSesion();
  }
  /** Cajeros activos con clave: si hay al menos uno, la caja pide usuario y clave para abrir. */
  cajerosActivos(): string[] {
    return this.idx.cajeros().filter((c) => c.activo).map((c) => c.nombre);
  }
  /** Inicio de sesión de un cajero (mismo control de claves equivocadas que el alta de artículos). Devuelve el nombre registrado. */
  iniciarSesionCajero(usuario: string, clave: string): string {
    const c = this.verificarClaveCajero(usuario, clave);
    // Quien inicia sesión en esta tienda pasa a trabajar aquí: «vendió por» la muestra en esta tienda y deja de mostrarla en la otra.
    if ((c.tienda ?? '') !== this.tienda) this.emitir('cajero.ubicacion', { cajero_id: c.id, tienda: this.tienda, caja: this.caja });
    return c.nombre;
  }
  cajeroActivo(usuario: string): boolean {
    return this.idx.cajeros().some((c) => c.activo && nombreClave(c.nombre) === nombreClave(usuario));
  }
  /** Departamentos activos (para elegir al dar de alta un artículo en la caja). */
  departamentosActivos(): string[] {
    return this.idx.departamentos().filter((d) => d.activo).map((d) => d.nombre);
  }
  /**
   * Alta de un artículo desde la caja, autorizada con la clave del propio cajero. Llega al catálogo de todas las tiendas (item.created se
   * reparte) y queda un registro de quién lo dio de alta. Rechaza un código que ya existe (exacto o su forma corta/UPC completo).
   */
  altaArticuloAutorizada(d: { codigo: string; marca?: string; descripcion: string; estilo?: string; lote?: string; departamento: string; precio: number }, usuario: string, clave: string): Articulo {
    const cajero = this.verificarClaveCajero(usuario, clave);
    const codigo = String(d.codigo ?? '').trim();
    const descripcion = String(d.descripcion ?? '').trim();
    if (!codigo) throw new ErrorDominio('DATOS_REQUERIDOS', 'falta el código del artículo');
    if (!descripcion) throw new ErrorDominio('DATOS_REQUERIDOS', 'falta la descripción');
    if (!Number.isInteger(d.precio) || d.precio <= 0) throw new ErrorDominio('DATOS_REQUERIDOS', 'el precio debe ser mayor que 0');
    if (!this.departamentosActivos().includes(d.departamento)) throw new ErrorDominio('DATOS_REQUERIDOS', 'elija un departamento de la lista');
    if (this.idx.buscarCodigo(codigo).length || this.idx.buscarCodigoAproximado(codigo).length) throw new ErrorDominio('CODIGO_EXISTE', `el código ${codigo} ya existe en el catálogo`);
    const art = this.altaArticulo({ codigo, marca: String(d.marca ?? '').trim(), descripcion, estilo: String(d.estilo ?? '').trim(), lote: String(d.lote ?? '').trim(), departamento: d.departamento, precio: d.precio });
    this.emitir('articulo.alta_autorizada', { item_id: art.item_id, cajero: cajero.nombre, tienda: this.tienda, caja: this.caja }, `alta_aut:${art.item_id}`);
    return art;
  }
  /** Entregas del almacén a esta tienda que nadie ha confirmado todavía. */
  recepcionesPendientes(itemId?: string): RecepcionPendiente[] {
    const l = recepcionesPendientes(this.repo.opsDeTipos(['alm.entrega', 'alm.recibida']), this.tienda);
    return itemId ? l.filter((x) => x.item_id === itemId) : l;
  }
  /**
   * La tienda confirma la recepción: entra a su existencia lo que realmente recibió (`qty`, por omisión todo lo entregado). Si recibió
   * menos, la recepción queda con esa cantidad y Administración ve un faltante que debe ubicar. Idempotente entre cajas.
   */
  confirmarRecepcion(entregaId: string, cajero: string, qty?: number): { item_id: string; qty: number; entregadas: number; faltan: number } {
    const p = this.recepcionesPendientes().find((x) => x.entrega_id === entregaId);
    if (!p) throw new ErrorDominio('RECEPCION_INEXISTENTE', 'esa entrega no existe o ya fue confirmada');
    const recibidas = qty === undefined ? p.qty : qty;
    if (!Number.isInteger(recibidas) || recibidas < 0 || recibidas > p.qty) throw new ErrorDominio('CANTIDAD_INVALIDA', `la cantidad recibida debe ser un entero de 0 a ${p.qty}`);
    this.repo.tx(() => {
      this.emitir('alm.recibida', { entrega_id: entregaId, item_id: p.item_id, tienda: this.tienda, caja: this.caja, qty: recibidas, cajero }, `alm.recibida:${entregaId}`);
      if (recibidas > 0) this.emitir('inv.movement', { item_id: p.item_id, tienda: this.tienda, delta: recibidas, tipo: 'entrada_almacen', doc: `entrega:${entregaId}`, caja: this.caja }, `mov:alm:${entregaId}`);
    });
    return { item_id: p.item_id, qty: recibidas, entregadas: p.qty, faltan: p.qty - recibidas };
  }
  atestarItemNoLocal(siguiente: number) {
    this.repo.tx(() => {
      this.repo.kvSet('itemno:local', siguiente - 1);
      this.repo.kvSet('itemno:bloqueado', false);
    });
  }

  // ── verificación de existencias ──
  /**
   * Abre DOS registros independientes tras una reconstrucción:
   *  - inv.verificacion_pendiente: TODA la existencia de la tienda queda no verificada (lo perdido no se puede atribuir
   *    a artículos concretos); se cierra por artículo con un conteo físico;
   *  - doc.perdida_posible: ventas, pagos y folios que pudieron perderse; NO se cierra con un conteo.
   */
  registrarRehidratacion(informe: { no_replicado: { folios_sin_evidencia: unknown; evidencia: string; alcance: string } } & Record<string, unknown>): { inventario: Op; documental: Op } {
    const inventario = this.emitir('inv.verificacion_pendiente', { tienda: this.tienda, caja: this.caja, motivo: 'operaciones_no_replicadas_posibles', ...informe });
    const documental = this.emitir('doc.perdida_posible', {
      tienda: this.tienda, caja: this.caja, alcance: 'ventas_pagos_y_folios_de_la_caja',
      folios_sin_evidencia: informe.no_replicado.folios_sin_evidencia, evidencia: informe.no_replicado.evidencia, ...informe,
    });
    return { inventario, documental };
  }
  perdidasDocumentalesAbiertas(): PerdidaDocumental[] {
    return this.idx.perdidasAbiertas(this.tienda, this.caja);
  }
  existenciaVerificada(itemId: string): ExistenciaVerificada {
    return { saldo: this.idx.saldo(this.tienda, itemId), ...this.idx.verificada(this.tienda, itemId) };
  }
  /** Existencia de El Limbo del artículo, o null si no pertenece al catálogo inicial. */
  saldoLimbo(itemId: string): number | null {
    return this.idx.esDeLimbo(itemId) ? this.idx.saldo(LIMBO, itemId) : null;
  }
  /** Cuántas piezas de cada renglón salen de El Limbo: lo que haya ahí, luego la existencia de la tienda, y lo que sobre vuelve a El Limbo (queda negativo, sin existencia registrada). */
  private repartoLimbo(lineas: Linea[]): Map<string, number> {
    const libreLimbo = new Map<string, number>();
    const libreTienda = new Map<string, number>();
    const out = new Map<string, number>();
    for (const l of lineas) {
      if (l.tarjeta_regalo || !this.idx.esDeLimbo(l.item_id)) continue;
      let enLimbo = libreLimbo.get(l.item_id) ?? Math.max(0, this.idx.saldo(LIMBO, l.item_id));
      let enTienda = libreTienda.get(l.item_id) ?? Math.max(0, this.idx.saldo(this.tienda, l.item_id));
      const deLimbo = Math.min(l.qty, enLimbo);
      enLimbo -= deLimbo;
      const deTienda = Math.min(l.qty - deLimbo, enTienda);
      enTienda -= deTienda;
      libreLimbo.set(l.item_id, enLimbo);
      libreTienda.set(l.item_id, enTienda);
      out.set(l.linea_id, l.qty - deTienda);
    }
    return out;
  }
  articulosNoVerificados(): string[] {
    return this.idx.noVerificados(this.tienda);
  }
  /** Conteo físico: ajusta a lo contado mediante movimiento (contar 10 deja 10) y limpia SOLO la marca de ese artículo. */
  contarFisico(itemId: string, contado: number, usuario: string) {
    const previo = this.existenciaVerificada(itemId);
    const delta = contado - previo.saldo;
    this.repo.tx(() => {
      this.emitir('inv.conteo', { item_id: itemId, tienda: this.tienda, contado, saldo_previo: previo.saldo, delta, usuario, cubre: previo.pendientes });
      this.emitir('inv.movement', { item_id: itemId, tienda: this.tienda, delta, tipo: 'conteo', doc: `conteo:${itemId}`, caja: this.caja });
    });
    return { saldo_previo: previo.saldo, delta };
  }

  // ── carrito (borrador durable) ──
  private cartGet(id: string): Carrito {
    const c = this.repo.kvGet<Carrito>(`cart:${id}`);
    if (!c) throw new ErrorDominio('CARRITO_INEXISTENTE', id);
    if (c.estado === 'abierto') this.recalcular(c);
    return c;
  }
  /**
   * Promociones, cupón y descuentos manuales del carrito. Se recalcula en cada lectura de un carrito abierto: así una promoción
   * nueva (o vencida) y un cambio de cantidades se reflejan en el total que se cobra, y nunca queda un descuento viejo.
   */
  private recalcular(c: Carrito): void {
    let promos = this.idx.promociones();
    const conDetalle = c.lineas.some((l) => l.descuento_detalle !== undefined);
    if (!promos.length && !c.cupon && !conDetalle && !c.empleada && !c.vip) { delete c.descuentos; return; }
    const hoy = fechaLocal(this.ctx.reloj.now());
    // Un cupón de recompensa (RC-…) se arma con lo que se sabe de su emisión: vale una sola vez y solo en la tienda que lo regaló.
    const rc = c.cupon && esCodigoRecompensa(c.cupon) ? this.estadoRecompensa(c.cupon) : null;
    if (rc?.emitida) promos = [...promos, promoDeRecompensa(rc.emitida)];
    const usos = (codigo: string) => {
      if (rc?.emitida && rc.emitida.codigo === codigo) return rc.canjeada || rc.cancelada ? 1 : 0;
      const p = promos.find((x) => esCanje(x) && x.codigo === codigo);
      if (!p) return 0;
      let n = 0;
      for (const v of ventas(this.opsVentas()).values()) if (v.estado === 'confirmada' && v.lineas.some((l) => l.descuento_detalle?.some((d) => d.tipo === 'cupon' && d.ref === p.id))) n++;
      return n;
    };
    const r = calcularDescuentos(c.lineas, promos, c.cupon ?? null, hoy, usos, this.tienda, c.empleada ? this.configEmpleadas() : null, this.vipDeCarrito(c));
    c.lineas = r.lineas;
    c.descuentos = { aplicadas: r.aplicadas, cupon: r.cupon };
  }
  /** Emisión, canje y cancelación de un cupón de recompensa según las ventas de esta caja y las del hub (las dos cajas de la tienda). */
  estadoRecompensa(codigo: string): EstadoRecompensa {
    const cod = codigo.trim().toUpperCase();
    const local = buscarRecompensa(ventas(this.opsVentas()), cod);
    const remoto = this.enlace.consultarRecompensa(cod);
    return { emitida: local.emitida ?? remoto?.emitida ?? null, canjeada: local.canjeada || !!remoto?.canjeada, cancelada: local.cancelada || !!remoto?.cancelada };
  }
  abrirCarrito(): string {
    const id = uuid();
    this.repo.tx(() => {
      this.repo.kvSet(`cart:${id}`, { id, lineas: [], estado: 'abierto' } satisfies Carrito);
      this.repo.kvSet('carts', [...this.carritoIds(), id]);
    });
    return id;
  }
  carrito(id: string): Carrito {
    return this.cartGet(id);
  }
  carritosAbiertos(): string[] {
    return this.carritoIds().filter((id) => this.cartGet(id).estado === 'abierto');
  }
  /** Ventas abiertas que NO están en espera (la venta "en pantalla" se elige solo entre estas). */
  carritosActivos(): string[] {
    return this.carritosAbiertos().filter((id) => !this.cartGet(id).espera);
  }
  /** Ventas en espera de esta caja, de la más antigua a la más reciente. */
  ventasEnEspera() {
    return this.carritosAbiertos().map((id) => this.cartGet(id)).filter((c) => c.espera).map((c) => ({
      cart_id: c.id, desde: c.espera!.desde, nota: c.espera!.nota, por: c.espera!.por,
      // Un cambio en curso cuenta con lo que regresa la clienta (piezas en negativo y su importe a favor).
      piezas: c.lineas.reduce((a, l) => a + l.qty, 0) - (c.cambio?.renglones.reduce((a, r) => a + r.qty, 0) ?? 0), total: c.lineas.reduce((a, l) => a + l.importe, 0) - (c.cambio?.credito ?? 0),
      articulos: [...(c.cambio ? [{ qty: -c.cambio.renglones.reduce((a, r) => a + r.qty, 0), descripcion: `cambio del folio ${String(c.cambio.folio_origen).padStart(6, '0')}` }] : []), ...c.lineas.map((l) => ({ qty: l.qty, descripcion: l.descripcion }))].slice(0, 3),
      ...(c.cambio ? { cambio_de_folio: c.cambio.folio_origen } : {}),
    }));
  }
  /** Pone la venta en espera (queda guardada, también tras un reinicio). Exige que tenga artículos y que no haya un cobro a medias. */
  ponerEnEspera(cartId: string, nota = '', por = 'cajero') {
    const c = this.cartGet(cartId);
    this.exigirAbierto(c);
    this.exigirSinCobroPendiente(c);
    if (c.espera) return;
    if (c.lineas.length === 0 && !c.cambio) throw new ErrorDominio('CARRITO_VACIO', 'una venta sin artículos no se pone en espera');
    this.repo.tx(() => {
      delete c.tasa; // el tipo de cambio se vuelve a fijar al retomar el cobro
      c.espera = { desde: this.ctx.reloj.now(), nota: nota.trim().slice(0, 80), por };
      this.repo.kvSet(`cart:${cartId}`, c);
      this.emitir('cart.en_espera', { cart_id: cartId, tienda: this.tienda, caja: this.caja, nota: c.espera.nota, piezas: c.lineas.reduce((a, l) => a + l.qty, 0), total: c.lineas.reduce((a, l) => a + l.importe, 0), ...(c.cambio ? { cambio_de: { sale_id: c.cambio.sale_id, folio: c.cambio.folio_origen } } : {}), por });
    });
  }
  /** Retoma una venta en espera: pasa a ser la venta en pantalla (la última de la lista). */
  retomar(cartId: string, por = 'cajero') {
    const c = this.cartGet(cartId);
    this.exigirAbierto(c);
    if (!c.espera) return;
    this.repo.tx(() => {
      delete c.espera;
      this.repo.kvSet(`cart:${cartId}`, c);
      this.repo.kvSet('carts', [...this.carritoIds().filter((x) => x !== cartId), cartId]);
      this.emitir('cart.retomada', { cart_id: cartId, tienda: this.tienda, caja: this.caja, por });
    });
  }
  /** Descarta sin registro una venta abierta vacía (sin artículos ni dinero): no es una anulación. */
  descartarVacio(cartId: string) {
    const c = this.cartGet(cartId);
    if (c.estado === 'abierto' && !c.espera && c.lineas.length === 0 && !c.cambio && !c.intent_id) this.repo.kvSet(`cart:${cartId}`, { ...c, estado: 'descartado' });
  }
  private carritoIds(): string[] {
    return this.repo.kvGet<string[]>('carts') ?? [];
  }
  private exigirAbierto(c: Carrito) {
    if (c.estado !== 'abierto') throw new ErrorDominio('CARRITO_CERRADO', 'la venta ya se confirmó');
  }
  /**
   * Resultado de escanear un código. NO adivina: un código ambiguo devuelve los candidatos y no agrega nada;
   * resolver el conflicto es tarea administrativa (ver administracion.ts).
   */
  escanear(cartId: string, codigo: string):
    | { resultado: 'agregado' | 'cantidad_incrementada'; linea: Linea }
    | { resultado: 'no_encontrado'; codigo: string }
    | { resultado: 'ambiguo'; codigo: string; candidatos: { item_id: string; item_no: string | null; marca: string; descripcion: string; estilo: string; lote: string }[] } {
    const cod = codigo.replace(/[\r\n]+$/g, ''); // el lector termina con Enter; los ceros iniciales se conservan
    const c = this.cartGet(cartId);
    this.exigirAbierto(c);
    let r = this.buscarPorCodigo(cod);
    if (r.length === 0) r = this.idx.buscarAlterno(cod); // "Alternate Lookup": segundo código de búsqueda (no es la identidad)
    if (r.length === 0) r = this.idx.buscarCodigoAproximado(cod); // la etiqueta trae el código corto y el catálogo el UPC completo (o al revés)
    if (r.length === 0) return { resultado: 'no_encontrado', codigo: cod };
    if (r.length > 1) return { resultado: 'ambiguo', codigo: cod, candidatos: r.map((a) => ({ item_id: a.item_id, item_no: a.item_no, marca: a.marca, descripcion: a.descripcion, estilo: a.estilo, lote: a.lote })) };
    return this.sumarArticulo(cartId, r[0]!);
  }
  /** Agrega una pieza de un artículo identificado (por escaneo o elegido de una búsqueda; también los que no tienen código). */
  agregarPorId(cartId: string, itemId: string) {
    const art = this.idx.articulo(itemId);
    if (!art) throw new ErrorDominio('ARTICULO_INEXISTENTE', itemId);
    this.exigirAbierto(this.cartGet(cartId));
    return this.sumarArticulo(cartId, art);
  }
  private sumarArticulo(cartId: string, art: Articulo): { resultado: 'agregado' | 'cantidad_incrementada'; linea: Linea } {
    const c = this.cartGet(cartId);
    // Mismo artículo, sin precio ni descuento editados: se suma una pieza a la línea existente.
    const existente = c.lineas.find((x) => x.item_id === art.item_id && x.precio_unit === art.precio && x.descuento === 0);
    if (existente) return { resultado: 'cantidad_incrementada', linea: this.cambiarCantidad(cartId, existente.linea_id, existente.qty + 1) };
    return { resultado: 'agregado', linea: this.agregarLinea(cartId, { item_id: art.item_id, qty: 1 }) };
  }
  /**
   * «Editar en esta venta»: cambia el precio unitario y/o la descripción de UN renglón solo para esta venta (el catálogo no se toca). **Cambiar el
   * precio exige la clave de un supervisor** (es lo mismo que un descuento o un recargo); la descripción se edita sin clave. Quedan guardados el
   * precio de lista, la descripción original y quién autorizó, dentro de la venta.
   */
  editarLinea(cartId: string, lineaId: string, d: { precio_unit?: number; descripcion?: string }, clave?: string, extra: { usuario?: string; sinSupervisor?: boolean } = {}): Linea {
    const c = this.cartGet(cartId);
    this.exigirAbierto(c);
    this.exigirSinCobroPendiente(c);
    const l = c.lineas.find((x) => x.linea_id === lineaId);
    if (!l) throw new ErrorDominio('LINEA_INEXISTENTE', lineaId);
    if (l.tarjeta_regalo) throw new ErrorDominio('PROHIBIDO', 'una tarjeta de regalo no se edita');
    const art = this.idx.articulo(l.item_id);
    const original = l.editado ?? { precio_lista: art?.precio ?? l.precio_unit, descripcion_original: l.descripcion };
    const descripcion = d.descripcion === undefined ? l.descripcion : String(d.descripcion).trim();
    if (!descripcion || descripcion.length > 60) throw new ErrorDominio('DATOS_REQUERIDOS', 'la descripción lleva de 1 a 60 caracteres');
    const cambiaPrecio = d.precio_unit !== undefined && d.precio_unit !== l.precio_unit;
    let autorizo = l.editado?.autorizo;
    if (cambiaPrecio) {
      if (!Number.isInteger(d.precio_unit) || (d.precio_unit as number) <= 0) throw new ErrorDominio('PRECIO_INVALIDO', 'el precio es un entero de centavos mayor que 0');
      autorizo = this.supervisorOPropio(String(clave ?? ''), extra.usuario ?? '', extra.sinSupervisor, 'cambiar un precio lo autoriza un supervisor con su clave').nombre;
    }
    const precio = cambiaPrecio ? (d.precio_unit as number) : l.precio_unit;
    l.descripcion = descripcion;
    l.precio_unit = precio;
    l.importe = l.qty * precio - l.descuento;
    // Si no cambió nada respecto al catálogo, el renglón vuelve a ser el de siempre.
    if (precio === original.precio_lista && descripcion === original.descripcion_original) delete l.editado;
    else l.editado = { precio_lista: original.precio_lista, descripcion_original: original.descripcion_original, ...(autorizo ? { autorizo } : {}) };
    this.recalcular(c);
    this.repo.tx(() => { this.repo.kvSet(`cart:${cartId}`, c); });
    return c.lineas.find((x) => x.linea_id === lineaId)!;
  }
  cambiarCantidad(cartId: string, lineaId: string, qty: number): Linea {
    const c = this.cartGet(cartId);
    this.exigirAbierto(c);
    this.exigirSinCobroPendiente(c);
    if (!Number.isInteger(qty) || qty < 1) throw new ErrorDominio('CANTIDAD_INVALIDA', 'la cantidad es un entero positivo');
    const l = c.lineas.find((x) => x.linea_id === lineaId);
    if (!l) throw new ErrorDominio('LINEA_INEXISTENTE', lineaId);
    l.qty = qty;
    l.importe = qty * l.precio_unit - l.descuento;
    this.recalcular(c);
    this.repo.kvSet(`cart:${cartId}`, c);
    return c.lineas.find((x) => x.linea_id === lineaId)!;
  }
  quitarLinea(cartId: string, lineaId: string): void {
    const c = this.cartGet(cartId);
    this.exigirAbierto(c);
    this.exigirSinCobroPendiente(c);
    if (!c.lineas.some((x) => x.linea_id === lineaId)) throw new ErrorDominio('LINEA_INEXISTENTE', lineaId);
    c.lineas = c.lineas.filter((x) => x.linea_id !== lineaId);
    this.recalcular(c);
    this.repo.kvSet(`cart:${cartId}`, c);
  }

  // ── cupón y descuentos autorizados ──
  /** Captura (o reemplaza) el cupón de la venta. Si no se puede aplicar, avisa por qué y el carrito queda sin cupón. */
  aplicarCupon(cartId: string, codigo: string): NonNullable<ResultadoDescuentos['cupon']> {
    const c = this.cartGet(cartId);
    this.exigirAbierto(c);
    this.exigirSinCobroPendiente(c);
    const cod = normCodigo(codigo);
    if (!cod) throw new ErrorDominio('DATOS_REQUERIDOS', 'falta el código del cupón');
    if (esCodigoRecompensa(cod)) {
      const e = this.estadoRecompensa(cod);
      if (!e.emitida) throw new ErrorDominio('CUPON_NO_APLICA', this.enlace.hubAlcanzable() ? 'el cupón no existe' : 'no se pudo verificar el cupón: sin conexión con el hub (si lo regalaron en la otra caja, espere a que se sincronice)', { codigo: cod });
      if (e.cancelada) throw new ErrorDominio('CUPON_NO_APLICA', 'ese cupón se anuló: se canceló la venta que lo regaló', { codigo: cod });
    }
    c.cupon = cod;
    this.recalcular(c);
    const r = c.descuentos?.cupon ?? { codigo: cod, nombre: cod, monto: 0, aplicado: false, motivo: 'el cupón no existe' };
    if (!r.aplicado) { delete c.cupon; this.recalcular(c); throw new ErrorDominio('CUPON_NO_APLICA', r.motivo ?? 'el cupón no se puede aplicar', { codigo: cod }); }
    this.repo.kvSet(`cart:${cartId}`, c);
    return r;
  }
  quitarCupon(cartId: string): void {
    const c = this.cartGet(cartId);
    this.exigirAbierto(c);
    this.exigirSinCobroPendiente(c);
    delete c.cupon;
    this.recalcular(c);
    this.repo.kvSet(`cart:${cartId}`, c);
  }
  /** Un supervisor con su clave o, con `sinSupervisor`, quien cobra con la SUYA (queda anotado «supervisor ausente»). */
  private supervisorOPropio(clave: string, usuario: string, sinSupervisor: boolean | undefined, mensaje: string, codigo = 'CLAVE_INVALIDA'): { id: string; nombre: string } {
    if (sinSupervisor) { const cj = this.verificarClaveCajero(usuario, clave); return { id: cj.id, nombre: `${cj.nombre} (supervisor ausente)` }; }
    const sup = supervisorPorClave(this.idx.supervisores(), clave, usuario);
    if (!sup) throw new ErrorDominio(codigo, mensaje);
    return sup;
  }
  /**
   * Descuento manual autorizado con la clave de un supervisor o con la propia de quien atiende (sin tope: hasta 100 %). `linea_id` = una línea; sin él, toda la venta
   * (repartido proporcionalmente). Reemplaza el descuento manual anterior de esas líneas. Queda anotado quién lo autorizó.
   */
  aplicarDescuentoManual(cartId: string, d: { linea_id?: string | null; tipo: 'pct' | 'monto'; valor: number }, clave: string, usuario = ''): { supervisor: string } {
    const c = this.cartGet(cartId);
    this.exigirAbierto(c);
    this.exigirSinCobroPendiente(c);
    // Autoriza un supervisor con su clave o, si no es la de un supervisor, quien tiene la sesión con la SUYA (Vendedora-Cajera o almacenista que cobra): queda anotado quién lo hizo.
    const supClave = supervisorPorClave(this.idx.supervisores(), String(clave ?? ''), usuario);
    let sup: { id: string; nombre: string };
    if (supClave) sup = supClave;
    else if (usuario && this.idx.cajeros().some((x) => x.activo && nombreClave(x.nombre) === nombreClave(usuario))) { const cj = this.verificarClaveCajero(usuario, String(clave ?? '')); sup = { id: cj.id, nombre: cj.nombre }; }
    else throw new ErrorDominio('CLAVE_INVALIDA', 'la clave de quien autoriza no es válida');
    const objetivo = d.linea_id ? c.lineas.filter((l) => l.linea_id === d.linea_id && !l.tarjeta_regalo) : c.lineas.filter((l) => !l.tarjeta_regalo);
    if (!objetivo.length) throw new ErrorDominio('LINEA_INEXISTENTE', d.linea_id ? 'la línea no existe o es una tarjeta de regalo' : 'no hay mercancía a la que aplicar el descuento');
    if (!Number.isInteger(d.valor) || d.valor <= 0) throw new ErrorDominio('DESCUENTO_INVALIDO', 'el descuento debe ser mayor que 0');
    if (d.tipo === 'pct' && d.valor > 100) throw new ErrorDominio('DESCUENTO_INVALIDO', 'el porcentaje no puede pasar de 100');
    const lista = objetivo.map((l) => l.qty * l.precio_unit);
    const totalLista = lista.reduce((a, b) => a + b, 0);
    const monto = d.tipo === 'pct' ? aPesosEnteros((totalLista * d.valor) / 100) : d.valor; // sin centavos: el porcentaje se redondea al peso
    if (monto > totalLista) throw new ErrorDominio('DESCUENTO_INVALIDO', 'el descuento no puede pasar del importe');
    const partes = (monto % 100 === 0 ? repartirPesos : repartir)(monto, lista);
    objetivo.forEach((l, i) => {
      const resto = (l.descuento_detalle ?? (l.descuento > 0 ? [{ tipo: 'manual' as const, ref: '', nombre: 'Descuento', monto: l.descuento }] : [])).filter((x) => x.tipo !== 'manual');
      l.descuento_detalle = [...resto, ...(partes[i]! > 0 ? [{ tipo: 'manual' as const, ref: sup.id, nombre: `Descuento autorizado por ${sup.nombre}`, monto: partes[i]! }] : [])];
    });
    this.recalcular(c);
    this.repo.kvSet(`cart:${cartId}`, c);
    return { supervisor: sup.nombre };
  }
  // ── ventas a empleadas ──
  /** Porcentajes del descuento de empleada (los fija Administración; sin cambio, 15 % y 30 % en uniformes). */
  configEmpleadas(): ConfigEmpleadas {
    return configEmpleadas(this.opsDe('empleadas.config'));
  }
  /** Cuenta de una empleada con lo que ESTA caja sabe (sus ventas y las del hub, más lo que Administración registró). La oficial es la de Administración. */
  cuentaEmpleada(id: string): CuentaEmpleada {
    const cuentas = cuentasEmpleadas(this.opsDe('sale.confirmed', 'sale.cancelled', 'return.registered', 'empleada.credito', 'empleada.movimiento'));
    return cuentas.get(id) ?? { id, limite: 0, cargos: 0, devoluciones: 0, abonos: 0, ajustes_cargo: 0, ajustes_abono: 0, saldo: 0, disponible: 0, movimientos: [] };
  }
  /** Empleadas a quienes se puede vender (las Vendedoras-Cajeras activas). */
  empleadasActivas(): { id: string; nombre: string }[] {
    return this.idx.cajeros().filter((c) => c.activo).map((c) => ({ id: c.id, nombre: c.nombre })).sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));
  }
  // ── Metas de venta: la caja solo ve el porcentaje y el color de su tienda (las cantidades son de Administración) ──
  /** Avance de la tienda contra su meta del día, la semana y el mes. null = no hay metas publicadas para esta tienda (la barra no se muestra). */
  metasAvance(): Record<PeriodoMeta, { pct: number; color: AvancePeriodo['color'] } | null> | null {
    const pub = metasPublicadas(this.opsDe('metas.config'));
    const conf = pub?.config.tiendas[this.tienda];
    const metas = pub?.dias[this.tienda];
    if (!pub || !conf?.activa || !metas) return null;
    const ahora = this.ctx.reloj.now();
    const fecha = fechaLocal(ahora);
    const hora = new Date(Date.parse(ahora) - 7 * 3600_000).toISOString().slice(11, 16);
    const desde = [lunesDe(fecha), `${fecha.slice(0, 7)}-01`].sort()[0]!;
    // Las dos cajas de la tienda suman juntas: se toma lo que sabe el hub y, por si aún no llegó una venta de esta caja, lo de esta caja (lo mayor de cada día).
    const totales = totalesPorDia(this.opsDe('sale.confirmed', 'sale.cancelled'), this.tienda);
    const remotos = this.enlace.totalesVentas?.(desde, fecha) ?? null;
    for (const [f, v] of Object.entries(remotos ?? {})) totales.set(f, Math.max(totales.get(f) ?? 0, v));
    for (const [f, v] of Object.entries(pub.historico?.[this.tienda] ?? {})) if (f >= desde && f <= fecha) totales.set(f, (totales.get(f) ?? 0) + v);
    const a = avanceMetas({ tienda: this.tienda, fecha, hora, config: pub.config, metas, totales });
    const r = {} as Record<PeriodoMeta, { pct: number; color: AvancePeriodo['color'] } | null>;
    for (const p of ['dia', 'semana', 'mes'] as const) r[p] = a[p] ? { pct: Math.round(a[p]!.pct), color: a[p]!.color } : null;
    return r;
  }
  // ── Clientes VIP: descuento especial fijado por Administración, con excepciones; la caja solo lo elige (con la clave de quien cobra) ──
  /** Clientes VIP que se pueden elegir hoy: activos y dentro de su vigencia. */
  vipsDisponibles(): ClienteVip[] {
    const hoy = fechaLocal(this.ctx.reloj.now());
    return clientesVip(this.opsDe('vip.guardado')).filter((v) => v.activo && (!v.vigente_hasta || hoy <= v.vigente_hasta));
  }
  excepcionesVip(): ExcepcionesVip {
    return excepcionesVip(this.opsDe('vip.excepciones'));
  }
  /** El cliente VIP de la venta con las excepciones de hoy (para calcular el descuento). */
  private vipDeCarrito(c: Carrito): ConfigVip | null {
    return c.vip ? { id: c.vip.id, nombre: c.vip.nombre, pct: c.vip.pct, ...this.excepcionesVip() } : null;
  }
  /** Aplica el descuento de un cliente VIP a la venta: pide la clave de quien cobra (queda anotado) y compite con las promociones (aplica el que más le convenga a la clienta). */
  asignarVip(cartId: string, d: { vip_id: string; clave?: string; usuario: string }): NonNullable<Carrito['vip']> {
    const c = this.cartGet(cartId);
    this.exigirAbierto(c);
    this.exigirSinCobroPendiente(c);
    const v = this.vipsDisponibles().find((x) => x.id === d.vip_id);
    if (!v) throw new ErrorDominio('VIP_INEXISTENTE', 'ese cliente VIP no está activo');
    if (this.controlesConClave()) this.verificarClaveCajero(d.usuario, String(d.clave ?? ''));
    c.vip = { id: v.id, nombre: v.nombre, pct: v.pct, aplico: d.usuario };
    this.recalcular(c);
    this.repo.kvSet(`cart:${cartId}`, c);
    return c.vip;
  }
  quitarVip(cartId: string): void {
    const c = this.cartGet(cartId);
    this.exigirAbierto(c);
    this.exigirSinCobroPendiente(c);
    delete c.vip;
    this.recalcular(c);
    this.repo.kvSet(`cart:${cartId}`, c);
  }
  /**
   * Marca la venta como venta a una empleada: ella confirma con SU clave. Una cajera no puede venderse a sí misma sin que un supervisor lo autorice
   * con su clave. Desde ahí el descuento de empleada se calcula solo (compite con las promociones: aplica el que más le convenga).
   */
  asignarEmpleada(cartId: string, d: { empleada_id: string; clave: string; claveSupervisor?: string; usuario: string; sinSupervisor?: boolean }): { id: string; nombre: string } {
    const c = this.cartGet(cartId);
    this.exigirAbierto(c);
    this.exigirSinCobroPendiente(c);
    const emp = this.empleadasActivas().find((e) => e.id === d.empleada_id);
    if (!emp) throw new ErrorDominio('EMPLEADA_INEXISTENTE', 'esa empleada no está activa');
    this.verificarClaveCajero(emp.nombre, String(d.clave ?? ''));
    if (nombreClave(emp.nombre) === nombreClave(d.usuario) && !d.sinSupervisor && !this.esSupervisorActivo(d.usuario) && !supervisorPorClave(this.idx.supervisores(), String(d.claveSupervisor ?? ''))) {
      throw new ErrorDominio('AUTORIZACION_REQUERIDA', 'una cajera no puede venderse a sí misma: un supervisor debe autorizarlo con su clave');
    }
    c.empleada = { id: emp.id, nombre: emp.nombre, ...(d.sinSupervisor && nombreClave(emp.nombre) === nombreClave(d.usuario) ? { sin_supervisor: true } : {}) };
    this.recalcular(c);
    this.repo.kvSet(`cart:${cartId}`, c);
    return c.empleada;
  }
  quitarEmpleada(cartId: string): void {
    const c = this.cartGet(cartId);
    this.exigirAbierto(c);
    this.exigirSinCobroPendiente(c);
    delete c.empleada;
    for (const l of c.lineas) delete l.uniforme;
    this.recalcular(c);
    this.repo.kvSet(`cart:${cartId}`, c);
  }
  /** La cajera marca (o desmarca) un artículo como uniforme de la tienda: lleva el descuento mayor. */
  marcarUniforme(cartId: string, lineaId: string, uniforme: boolean): void {
    const c = this.cartGet(cartId);
    this.exigirAbierto(c);
    this.exigirSinCobroPendiente(c);
    if (!c.empleada) throw new ErrorDominio('SIN_EMPLEADA', 'primero elija a la empleada');
    const l = c.lineas.find((x) => x.linea_id === lineaId && !x.tarjeta_regalo);
    if (!l) throw new ErrorDominio('LINEA_INEXISTENTE', lineaId);
    if (uniforme) l.uniforme = true; else delete l.uniforme;
    this.recalcular(c);
    this.repo.kvSet(`cart:${cartId}`, c);
  }
  /**
   * Cobra la venta a crédito de la empleada: no entra dinero (se descuenta de su nómina); la venta cuenta como venta del día y baja el inventario.
   * Respeta el límite de crédito que fijó Administración.
   */
  cobrarConCreditoEmpleada(cartId: string, cajero = 'cajero'): Venta {
    const previa = this.repo.getOp(`sale:${cartId}`);
    if (previa) return ventas([previa]).get(cartId)!;
    const c = this.cartGet(cartId);
    if (!c.empleada) throw new ErrorDominio('SIN_EMPLEADA', 'primero elija a la empleada');
    this.exigirAbierto(c);
    if (c.cambio) throw new ErrorDominio('PAGO_INVALIDO', 'una venta con cambio de mercancía no se carga a crédito de empleada');
    const total = this.totalNeto(c);
    if (total <= 0) throw new ErrorDominio('PAGO_INVALIDO', 'la venta no tiene importe que cargar a crédito');
    const cuenta = this.cuentaEmpleada(c.empleada.id);
    if (!(cuenta.limite > 0)) throw new ErrorDominio('SIN_CREDITO', `${c.empleada.nombre} no tiene crédito autorizado: Administración debe fijarle un límite`);
    if (cuenta.saldo + total > cuenta.limite) throw new ErrorDominio('LIMITE_EXCEDIDO', `la compra pasa del crédito disponible de ${c.empleada.nombre} (${(cuenta.disponible / 100).toFixed(2)} pesos)`, { disponible: cuenta.disponible, total });
    return this.cobrar(cartId, [{ metodo: 'credito_empleada', monto: total, empleada_id: c.empleada.id, empleada: c.empleada.nombre }], cajero);
  }
  quitarDescuentoManual(cartId: string, lineaId?: string | null): void {
    const c = this.cartGet(cartId);
    this.exigirAbierto(c);
    this.exigirSinCobroPendiente(c);
    for (const l of c.lineas) {
      if (lineaId && l.linea_id !== lineaId) continue;
      l.descuento_detalle = (l.descuento_detalle ?? []).filter((x) => x.tipo !== 'manual');
    }
    this.recalcular(c);
    this.repo.kvSet(`cart:${cartId}`, c);
  }
  /** Búsqueda por código exacto, Item # exacto, código alterno o texto en marca, descripción, estilo, lote y departamento. */
  buscar(texto: string, limite = 20): Articulo[] {
    return this.buscarConTotal(texto, limite).resultados;
  }
  buscarConTotal(texto: string, limite = 20): { resultados: Articulo[]; total: number } {
    const q = texto.trim();
    return q ? this.idx.buscar(q, limite) : { resultados: [], total: 0 };
  }
  agregarLinea(cartId: string, l: { codigo?: string; item_id?: string; qty: number; precio_unit?: number; descuento?: number }): Linea {
    const c = this.cartGet(cartId);
    this.exigirAbierto(c);
    this.exigirSinCobroPendiente(c);
    let art: Articulo | undefined;
    if (l.item_id) art = this.idx.articulo(l.item_id);
    else {
      const r = this.buscarPorCodigo(l.codigo!);
      if (r.length > 1) throw new ErrorDominio('CODIGO_AMBIGUO', `el código ${l.codigo} corresponde a ${r.length} artículos`, r.map((a) => a.item_id));
      art = r[0];
    }
    if (!art) throw new ErrorDominio('ARTICULO_INEXISTENTE', String(l.codigo ?? l.item_id));
    if (l.precio_unit === undefined && !(art.precio > 0)) {
      throw new ErrorDominio('PRECIO_INVALIDO', `${[art.descripcion, art.marca].filter(Boolean).join(' ') || 'El artículo'} (Item # ${art.item_no ?? 'pendiente'}) tiene precio ${art.precio / 100} en el catálogo: corríjalo antes de venderlo`, { item_id: art.item_id, precio: art.precio });
    }
    const precio = l.precio_unit ?? art.precio; // editar precio "solo en esta venta" no toca el catálogo
    const descuento = l.descuento ?? 0;
    if (!Number.isInteger(l.qty) || l.qty < 1) throw new ErrorDominio('CANTIDAD_INVALIDA', 'la cantidad es un entero positivo');
    const linea: Linea = {
      linea_id: uuid(), item_id: art.item_id, item_no: art.item_no, codigo: art.codigo, descripcion: art.descripcion,
      marca: art.marca, estilo: art.estilo, lote: art.lote, departamento: art.departamento,
      qty: l.qty, precio_unit: precio, descuento, importe: l.qty * precio - descuento,
    };
    const candidatos = this.buscarPorCodigo(art.codigo).map((a) => a.item_id);
    // Elección provisional ante un código duplicado: se marca para que Administración la revise.
    if (candidatos.length > 1) linea.ambiguo = { codigo: art.codigo, candidatos };
    c.lineas.push(linea);
    this.recalcular(c);
    this.repo.tx(() => {
      this.repo.kvSet(`cart:${cartId}`, c);
    });
    return c.lineas.find((x) => x.linea_id === linea.linea_id)!;
  }

  // ── cobro en efectivo / mixto ──
  /** Lo que se cobra: los artículos de la venta menos el crédito del cambio (negativo = saldo a favor de la clienta). */
  private totalNeto(c: Carrito): number {
    return c.lineas.reduce((a, l) => a + l.importe, 0) - (c.cambio?.credito ?? 0);
  }
  private exigirSinCobroPendiente(c: Carrito) {
    if (!c.intent_id) return;
    const i = intentos(this.opsDe('card.intent', 'card.intent_resuelto')).get(c.intent_id);
    if (i && (i.estado === 'iniciado' || i.estado === 'desconocido')) {
      throw new ErrorDominio('COBRO_PENDIENTE', `este carrito tiene un cobro con tarjeta sin conciliar (${i.estado})`, i);
    }
  }
  private validarPagos(pagos: Pago[], total: number) {
    for (const p of pagos) {
      if (p.metodo !== 'credito_empleada' && !this.cfg.metodos.includes(p.metodo === 'efectivo_usd' ? 'efectivo' : p.metodo)) {
        throw new ErrorDominio('PAGO_NO_PERMITIDO', `la caja ${this.id} no admite ${p.metodo}`);
      }
      if (!Number.isInteger(p.monto) || p.monto <= 0) throw new ErrorDominio('PAGO_INVALIDO', 'monto inválido');
    }
    if (pagos.reduce((a, p) => a + p.monto, 0) !== total) throw new ErrorDominio('PAGO_INVALIDO', 'los pagos no suman el total');
    const vistas = new Set<string>();
    for (const p of pagos) {
      if (p.metodo !== 'tarjeta_regalo') continue;
      if (!p.tarjeta?.trim()) throw new ErrorDominio('TARJETA_REGALO_REQUERIDA', 'falta el código de la tarjeta de regalo');
      if (vistas.has(p.tarjeta)) throw new ErrorDominio('PAGO_INVALIDO', `la tarjeta ${p.tarjeta} aparece dos veces en el cobro`);
      vistas.add(p.tarjeta);
    }
  }
  private tarjetasDe(pagos: Pago[]): TarjetaApartada[] {
    return pagos.filter((p) => p.metodo === 'tarjeta_regalo').map((p) => ({ codigo: p.tarjeta!, monto: p.monto }));
  }
  /** Vista local del saldo (puede ir atrasada respecto a otra tienda; con hub, el hub es quien concede). */
  saldoTarjeta(codigo: string): number | null {
    const t = this.idx.tarjeta(codigo.trim());
    return t ? t.saldo : null;
  }
  tarjetaRegalo(codigo: string): TarjetaRegalo | null {
    return this.idx.tarjeta(codigo.trim()) ?? null;
  }
  tarjetasRegaloTodas(): TarjetaRegalo[] {
    return this.idx.tarjetasTodas();
  }

  /**
   * Alta (venta) de una tarjeta de regalo: P-24 decidido, lleva FOLIO NORMAL de la serie de la caja y se paga en efectivo.
   * El renglón no es mercancía (sin inventario). El corte la separa de las ventas de mercancía.
   */
  altaTarjetaRegalo(d: { codigo: string; monto: number; recibido?: number; cajero?: string; ref?: string }): { tarjeta: TarjetaRegalo; venta: Venta } {
    return this.ventaDeTarjeta('alta', d);
  }
  /** Recarga en efectivo de una tarjeta existente: también lleva folio y reinicia los 12 meses de vigencia. */
  recargarTarjetaRegalo(d: { codigo: string; monto: number; recibido?: number; cajero?: string; ref?: string }): { tarjeta: TarjetaRegalo; venta: Venta } {
    return this.ventaDeTarjeta('recarga', d);
  }
  private ventaDeTarjeta(tipo: 'alta' | 'recarga', d: { codigo: string; monto: number; recibido?: number; cajero?: string; ref?: string }): { tarjeta: TarjetaRegalo; venta: Venta } {
    if (!this.cfg.metodos.includes('tarjeta_regalo')) throw new ErrorDominio('PAGO_NO_PERMITIDO', `la caja ${this.id} no maneja tarjetas de regalo`);
    const codigo = String(d.codigo ?? '').trim();
    const id = d.ref ?? uuid();
    const previa = this.repo.getOp(`sale:${id}`);
    if (previa) return { venta: ventas([previa]).get(id)!, tarjeta: this.idx.tarjeta(codigo)! }; // doble clic: misma venta, mismo folio
    if (!codigo) throw new ErrorDominio('DATOS_REQUERIDOS', 'falta el código de la tarjeta');
    if (!Number.isInteger(d.monto) || d.monto <= 0) throw new ErrorDominio('PAGO_INVALIDO', 'el monto es un entero positivo en centavos');
    const existente = this.idx.tarjeta(codigo);
    if (tipo === 'alta' && existente) throw new ErrorDominio('TARJETA_EXISTE', `la tarjeta ${codigo} ya está dada de alta`);
    if (tipo === 'recarga' && !existente) throw new ErrorDominio('TARJETA_INEXISTENTE', `la tarjeta ${codigo} no está dada de alta (o aún no llega a esta caja)`);
    const recibido = d.recibido ?? d.monto;
    if (!Number.isInteger(recibido) || recibido < d.monto) throw new ErrorDominio('EFECTIVO_INSUFICIENTE', 'el efectivo recibido no cubre el monto', { recibido, monto: d.monto });
    const linea: Linea = {
      linea_id: uuid(), item_id: `tarjeta_regalo:${codigo}`, item_no: null, codigo,
      descripcion: `${tipo === 'alta' ? 'Tarjeta de regalo' : 'Recarga de tarjeta de regalo'} ${codigo}`, marca: '', estilo: '', lote: '', departamento: 'TARJETAS DE REGALO',
      qty: 1, precio_unit: d.monto, descuento: 0, importe: d.monto, tarjeta_regalo: { codigo, tipo, meses: mesesVigenciaTarjetas(this.opsDe('giftcard.config')) },
    };
    this.repo.kvSet(`cart:${id}`, { id, lineas: [linea], estado: 'abierto' } satisfies Carrito);
    try {
      const venta = this.cobrar(id, [{ metodo: 'efectivo', monto: d.monto, recibido, cambio: recibido - d.monto }], d.cajero ?? 'cajero');
      return { venta, tarjeta: this.idx.tarjeta(codigo)! };
    } catch (e) {
      this.repo.kvSet(`cart:${id}`, { id, lineas: [linea], estado: 'descartado' } satisfies Carrito); // no queda como "venta en curso"
      throw e;
    }
  }

  /**
   * Cobro con tarjeta de regalo: aplica el saldo (todo o parte) y el resto se cobra en efectivo.
   * `recibido` es el efectivo entregado para el resto; si el saldo cubre el total no hace falta.
   */
  cobrarConTarjetaRegalo(cartId: string, codigo: string, recibido: number | undefined, cajero = 'cajero', usd = 0): Venta {
    const previa = this.repo.getOp(`sale:${cartId}`);
    if (previa) return ventas([previa]).get(cartId)!;
    const cod = codigo.trim();
    const t = this.idx.tarjeta(cod);
    if (!t) throw new ErrorDominio('TARJETA_INEXISTENTE', `la tarjeta ${cod} no está dada de alta`);
    const c = this.cartGet(cartId);
    const total = this.totalNeto(c);
    if (Date.parse(t.vigente_hasta) <= Date.parse(this.ctx.reloj.now())) throw new ErrorDominio('TARJETA_VENCIDA', `la tarjeta ${cod} venció el ${t.vigente_hasta.slice(0, 10)}`);
    if (t.saldo <= 0) throw new ErrorDominio('SALDO_INSUFICIENTE', `la tarjeta ${cod} no tiene saldo`, { saldo: 0 });
    const aplicado = Math.min(t.saldo, total);
    const pagos: Pago[] = [{ metodo: 'tarjeta_regalo', monto: aplicado, tarjeta: cod, saldo_despues: t.saldo - aplicado }];
    const resto = total - aplicado;
    if (resto > 0) {
      if (usd === 0 && (!Number.isInteger(recibido) || recibido! < resto)) throw new ErrorDominio('EFECTIVO_INSUFICIENTE', 'el saldo no cubre el total: falta cobrar el resto en efectivo', { saldo: t.saldo, total, resto, recibido: recibido ?? null });
      // Solo la parte recibida en dólares se convierte; la tarjeta de regalo sigue en pesos.
      pagos.push(this.pagoEfectivo(cartId, resto, { usd, pesos: recibido ?? 0 }));
    }
    return this.cobrar(cartId, pagos, cajero);
  }

  cobrar(cartId: string, pagos: Pago[], cajero = 'cajero', opts: { devolverEfectivo?: { monto: number; autorizo: string | null } } = {}): Venta {
    const previa = this.repo.getOp(`sale:${cartId}`);
    if (previa) return ventas([previa]).get(cartId)!; // doble clic / reintento: misma venta, mismo folio
    const c = this.cartGet(cartId);
    this.exigirSinCobroPendiente(c);
    if (this.totalNeto(c) < 0 && !opts.devolverEfectivo) throw new ErrorDominio('SALDO_A_FAVOR', 'la clienta tiene saldo a favor: se le entrega en efectivo con «No hay cambio posible, devolver dinero»');
    const hubOk = this.enlace.hubAlcanzable();
    if (!hubOk && this.ctx.politicas.P01_hub_no_disponible === 'bloquear_ventas_nuevas') {
      throw new ErrorDominio('VENTA_BLOQUEADA', 'hub no disponible (P-01 en ensayo: bloquear_ventas_nuevas); el carrito se conserva');
    }
    if (c.lineas.length === 0) throw new ErrorDominio('CARRITO_VACIO', cartId);
    const total = this.totalNeto(c);
    if (opts.devolverEfectivo) {
      if (pagos.length > 0 || total !== -opts.devolverEfectivo.monto) throw new ErrorDominio('PAGO_INVALIDO', 'el saldo a favor no coincide con la devolución en efectivo');
    } else this.validarPagos(pagos, total);
    if (pagos.some((p) => p.metodo === 'tarjeta')) {
      // Un cobro con tarjeta solo entra por un intento persistido y resuelto (iniciarCobroTarjeta/resolverIntento).
      throw new ErrorDominio('TARJETA_REQUIERE_INTENTO', 'el cobro con tarjeta debe pasar por un intento registrado antes de usar la terminal');
    }
    // Existencia marcada no verificada: ALTERNATIVA DE ENSAYO (P-14), no una política aprobada.
    const mercancia = c.lineas.filter((l) => !l.tarjeta_regalo);
    const noVerificados = [...new Set(mercancia.map((l) => l.item_id))].filter((id) => !this.existenciaVerificada(id).verificada);
    if (noVerificados.length && this.ctx.politicas.P14_venta_con_inventario_no_verificado === 'bloquear_articulo_no_verificado') {
      throw new ErrorDominio('INVENTARIO_NO_VERIFICADO', `existencia no verificada de ${noVerificados.join(', ')} (P-14 en ensayo)`, noVerificados);
    }
    // Arbitraje: con hub, la existencia la concede el hub (serializa a las dos cajas); sin hub, rige la vista local.
    let reservado = false;
    const tarjetas = this.tarjetasDe(pagos);
    let avisos: string[] = noVerificados.map((i) => `inventario_no_verificado:${i}`);
    // Advertencia (no bloqueo): el cambio en pesos supera los pesos que se SABE que hay en el cajón. Sin fondo registrado no se inventa disponibilidad.
    const cambioPesos = pagos.reduce((a, p) => a + (p.metodo === 'efectivo' ? p.cambio ?? 0 : p.metodo === 'efectivo_usd' ? p.cambio_mxn ?? 0 : 0), 0);
    const pesosEntran = pagos.reduce((a, p) => a + (p.metodo === 'efectivo' ? p.recibido ?? p.monto : p.metodo === 'efectivo_usd' ? p.pesos_recibidos ?? 0 : 0), 0);
    if (cambioPesos > pesosEntran) {
      const ef = this.efectivoMxnConocido();
      if (ef.conocido && cambioPesos > ef.disponible! + pesosEntran) avisos = [...avisos, `cambio_excede_efectivo_mxn:${cambioPesos - (ef.disponible! + pesosEntran)}`];
    }
    if (hubOk && (mercancia.length > 0 || tarjetas.length > 0)) {
      const r = this.enlace.reservar(c.id, this.caja, mercancia.map((l) => ({ item_id: l.item_id, qty: l.qty })), tarjetas);
      if (r === null) {
        if (this.ctx.politicas.P01_hub_no_disponible === 'bloquear_ventas_nuevas') throw new ErrorDominio('VENTA_BLOQUEADA', 'el hub dejó de responder durante la venta');
        this.exigirExistenciaLocal(c);
        this.exigirSaldoLocal(tarjetas);
      } else if (!r.ok && r.motivo === 'tarjeta_vencida') {
        throw new ErrorDominio('TARJETA_VENCIDA', `la tarjeta de regalo ${r.tarjetas_vencidas!.join(', ')} está vencida (12 meses desde la venta o la última recarga)`, r);
      } else if (!r.ok && r.motivo === 'tarjeta_sin_saldo') {
        throw new ErrorDominio('SALDO_INSUFICIENTE', `la tarjeta de regalo ${r.tarjetas_sin_saldo!.join(', ')} no existe o no tiene saldo suficiente`, r);
      } else if (!r.ok) {
        throw new ErrorDominio('SIN_EXISTENCIA', `el hub no concede existencia de ${this.nombresDe(r.faltantes ?? [])}`, r);
      } else {
        reservado = true;
        avisos = [...avisos, ...(r.sobreventa ?? []).map((i) => `sobreventa:${i}`)];
      }
    } else if (hubOk) {
      // venta solo de tarjeta de regalo (sin mercancía ni pago con tarjeta): nada que arbitrar
    } else {
      this.exigirExistenciaLocal(c);
      this.exigirSaldoLocal(tarjetas);
    }
    try {
      this.renovarSiHaceFalta();
      const v = this.confirmar(c, pagos, cajero, opts.devolverEfectivo);
      return avisos.length ? { ...v, avisos } : v;
    } catch (e) {
      if (reservado) this.enlace.liberar(c.id);
      throw e;
    }
  }

  /** Nombres legibles (descripción, marca, Item #) para mensajes; nunca identificadores internos. */
  private nombresDe(ids: string[]): string {
    return ids.map((id) => {
      const a = this.idx.articulo(id);
      return a ? `${[a.descripcion, a.marca].filter(Boolean).join(' ') || 'artículo'} (Item # ${a.item_no ?? 'pendiente'})` : id;
    }).join(', ');
  }

  /** Sin hub: solo se puede validar contra lo que esta caja conoce (limitación documentada; ver P-01). */
  private exigirSaldoLocal(tarjetas: TarjetaApartada[]) {
    for (const t of tarjetas) {
      const s = this.idx.tarjeta(t.codigo);
      if (!s) throw new ErrorDominio('TARJETA_INEXISTENTE', `la tarjeta ${t.codigo} no está dada de alta en esta caja`);
      if (Date.parse(s.vigente_hasta) <= Date.parse(this.ctx.reloj.now())) throw new ErrorDominio('TARJETA_VENCIDA', `la tarjeta ${t.codigo} venció el ${s.vigente_hasta.slice(0, 10)}`);
      if (s.saldo < t.monto) throw new ErrorDominio('SALDO_INSUFICIENTE', `la tarjeta ${t.codigo} tiene saldo ${s.saldo / 100}`, { saldo: s.saldo });
    }
  }

  private exigirExistenciaLocal(c: Carrito) {
    if (this.ctx.politicas.P02_existencia_insuficiente !== 'bloquear') return;
    const pedido = new Map<string, number>();
    for (const l of c.lineas) if (!l.tarjeta_regalo) pedido.set(l.item_id, (pedido.get(l.item_id) ?? 0) + l.qty);
    const faltan = [...pedido].filter(([item, q]) => this.idx.disponible(this.tienda, item) < q).map(([item]) => item);
    if (faltan.length) throw new ErrorDominio('SIN_EXISTENCIA', `existencia insuficiente de ${this.nombresDe(faltan)}`, { faltantes: faltan });
  }

  /** Cobro en efectivo MXN con recibido y cambio. El importe aplicado (y lo que cuenta en el corte) es el total, no lo recibido. */
  cobrarEfectivo(cartId: string, recibido: number, cajero = 'cajero'): Venta {
    const previa = this.repo.getOp(`sale:${cartId}`);
    if (previa) return ventas([previa]).get(cartId)!;
    const c = this.cartGet(cartId);
    const total = this.totalNeto(c);
    if (total === 0 && c.lineas.length) return this.cobrar(cartId, [], cajero); // descuento del 100 %: venta registrada sin cobro
    if (!Number.isInteger(recibido) || recibido < total) {
      throw new ErrorDominio('EFECTIVO_INSUFICIENTE', `el efectivo recibido no cubre el total`, { recibido, total });
    }
    return this.cobrar(cartId, [{ metodo: 'efectivo', monto: total, recibido, cambio: recibido - total }], cajero);
  }

  // ── dólares en efectivo (el catálogo, los precios y los reportes siguen en MXN; los dólares solo se reciben) ──
  tipoCambio(): TipoCambio | null {
    return this.idx.tipoCambio();
  }
  historialTipoCambio(): TipoCambio[] {
    return this.idx.historialTipoCambio();
  }
  puedeEditarTipoCambio(usuario: string): boolean {
    return this.idx.tienePermiso(usuario, 'editar_tipo_cambio');
  }
  /**
   * Edita la tasa GLOBAL: exige el permiso del usuario y conexión con el central (que le asigna la versión). Sin esa conexión
   * la caja sigue cobrando con su última tasa guardada. La tasa vigente no cambia los cobros ya iniciados ni las ventas anteriores.
   */
  fijarTipoCambio(tasa: number, usuario: string, esAdmin = false, confirmarVariacion = false): TipoCambio {
    if (!esAdmin && !this.puedeEditarTipoCambio(usuario)) throw new ErrorDominio('PERMISO_DENEGADO', `${usuario} no tiene permiso para editar el tipo de cambio`);
    if (!Number.isInteger(tasa) || tasa <= 0) throw new ErrorDominio('TASA_INVALIDA', 'el tipo de cambio debe ser un número positivo');
    const base = this.tipoCambio()?.version ?? 0;
    const r = this.enlace.fijarTipoCambio(tasa, usuario, base, confirmarVariacion);
    if (r === null) throw new ErrorDominio('SIN_CENTRAL', 'editar el tipo de cambio global requiere conexión con el servicio central; esta tienda sigue cobrando con su última tasa guardada');
    if (!r.ok) {
      if (r.motivo === 'tasa_invalida') throw new ErrorDominio('TASA_INVALIDA', 'el tipo de cambio debe ser un número positivo');
      if (r.motivo === 'confirmacion_requerida') throw new ErrorDominio('CONFIRMACION_REQUERIDA', `el cambio es de ${(r.variacion_pb! / 100).toFixed(2)} % respecto a la tasa vigente: confirme para continuar`, { variacion_pb: r.variacion_pb, anterior: r.vigente!.tasa, nueva: tasa });
      throw new ErrorDominio('CONFIG_DESACTUALIZADA', 'alguien más cambió el tipo de cambio mientras se editaba: revise el valor vigente', r.vigente);
    }
    this.recibir(r.op!, 'central'); // se aplica de inmediato aquí; al resto llega por el flujo normal sin reiniciar
    return r.vigente!;
  }
  /** Anota que esta caja pudo verificar la tasa contra el central (lo llama la capa de servicio cuando hay hub e internet). */
  registrarVerificacionTasa() {
    this.repo.kvSet('tc:verificada_en', this.ctx.reloj.now());
  }
  /**
   * Antigüedad de la última verificación de la tasa y qué política aplica (configurable; por omisión solo advierte a las 12 h).
   * Si nunca se verificó, cuenta desde que se fijó la tasa. Los cobros en pesos no dependen de esto.
   */
  estadoTasa(): { horas: number; nivel: 'ok' | 'advertencia' | 'bloqueada_usd'; verificada_en: string | null; advertir_horas: number; bloquear_usd_horas: number | null } {
    const pol = this.ctx.politicas.tasa_sin_verificar ?? TASA_SIN_VERIFICAR_OMISION;
    const t = this.tipoCambio();
    const verificada = this.repo.kvGet<string>('tc:verificada_en') ?? null;
    const base = verificada && (!t || verificada > t.ocurrio_en) ? verificada : (t?.ocurrio_en ?? this.ctx.reloj.now());
    const horas = Math.max(0, Math.floor((Date.parse(this.ctx.reloj.now()) - Date.parse(base)) / 3_600_000));
    const nivel = pol.bloquear_usd_horas !== null && horas >= pol.bloquear_usd_horas ? 'bloqueada_usd' : horas >= pol.advertir_horas ? 'advertencia' : 'ok';
    return { horas, nivel, verificada_en: verificada, advertir_horas: pol.advertir_horas, bloquear_usd_horas: pol.bloquear_usd_horas };
  }
  /**
   * Fija la tasa de ESTE cobro (la vigente) al empezar a recibir dólares; no cambia aunque el global cambie después.
   * `renovar` descarta la tasa bloqueada y toma la vigente (acción explícita del cajero).
   */
  bloquearTasa(cartId: string, renovar = false): { bloqueada: { version: number; tasa: number }; vigente: TipoCambio; hay_nueva: boolean } {
    const c = this.cartGet(cartId);
    this.exigirAbierto(c);
    const vigente = this.tipoCambio();
    if (!vigente) throw new ErrorDominio('SIN_TIPO_DE_CAMBIO', 'no hay tipo de cambio fijado: no se pueden recibir dólares');
    const est = this.estadoTasa();
    if (est.nivel === 'bloqueada_usd' && !c.tasa) {
      throw new ErrorDominio('TASA_SIN_VERIFICAR', `esta tienda lleva ${est.horas} h sin verificar el tipo de cambio (política: máximo ${est.bloquear_usd_horas} h): por ahora no se reciben dólares; los cobros en pesos siguen normales`, est);
    }
    if (!c.tasa || renovar) {
      c.tasa = { version: vigente.version, tasa: vigente.tasa, bloqueada_en: this.ctx.reloj.now() };
      this.repo.kvSet(`cart:${cartId}`, c);
    }
    return { bloqueada: { version: c.tasa.version, tasa: c.tasa.tasa }, vigente, hay_nueva: vigente.version > c.tasa.version };
  }
  /**
   * Arma el pago en efectivo de un importe en MXN con pesos y/o dólares recibidos. Sin dólares es el efectivo de siempre.
   * Con dólares: equivalente con la tasa BLOQUEADA del cobro (redondeo al centavo, mitad hacia arriba); el cambio se entrega
   * en PESOS. El importe aplicado es el MXN que liquida este efectivo; el detalle físico queda en el propio pago.
   */
  private pagoEfectivo(cartId: string, aplicar: number, e: { usd?: number; pesos?: number }): Pago {
    const usd = e.usd ?? 0;
    const pesos = e.pesos ?? 0;
    if (!Number.isInteger(usd) || usd < 0 || !Number.isInteger(pesos) || pesos < 0) throw new ErrorDominio('PAGO_INVALIDO', 'importes recibidos inválidos');
    if (usd > 0 && !esImporteEnBilletesUsd(usd)) throw new ErrorDominio('USD_SOLO_BILLETES', 'solo se aceptan billetes de dólar (1, 2, 5, 10, 20, 50 y 100): sin centavos ni monedas');
    if (usd === 0) {
      if (pesos < aplicar) throw new ErrorDominio('EFECTIVO_INSUFICIENTE', 'el efectivo recibido no cubre el total', { recibido: pesos, total: aplicar, faltan: aplicar - pesos });
      return { metodo: 'efectivo', monto: aplicar, recibido: pesos, cambio: pesos - aplicar };
    }
    const { bloqueada } = this.bloquearTasa(cartId);
    const equivalente = usdAMxn(usd, bloqueada.tasa);
    const recibidoEq = equivalente + pesos;
    if (recibidoEq < aplicar) throw new ErrorDominio('EFECTIVO_INSUFICIENTE', 'lo recibido no cubre el total', { equivalente, recibido_equivalente: recibidoEq, total: aplicar, faltan: aplicar - recibidoEq });
    return { metodo: 'efectivo_usd', monto: aplicar, usd, tasa: bloqueada.tasa, tasa_version: bloqueada.version, equivalente, pesos_recibidos: pesos, cambio_mxn: recibidoEq - aplicar };
  }
  /** Cobro en efectivo con pesos, dólares o ambos. Reintentar el mismo carrito devuelve la misma venta. */
  cobrarEfectivoMixto(cartId: string, e: { usd?: number; pesos?: number }, cajero = 'cajero'): Venta {
    const previa = this.repo.getOp(`sale:${cartId}`);
    if (previa) return ventas([previa]).get(cartId)!;
    const c = this.cartGet(cartId);
    const total = this.totalNeto(c);
    return this.cobrar(cartId, [this.pagoEfectivo(cartId, total, e)], cajero);
  }

  /** Bitácora de impresión: una falla de impresora nunca duplica ni revierte la venta. */
  registrarImpresion(d: { sale_id: string; tipo: 'original' | 'reimpresion' | 'regalo'; resultado: 'ok' | 'error'; error?: string; usuario: string }): Op {
    const v = ventas(this.opsVentas()).get(d.sale_id);
    if (!v || v.tienda !== this.tienda || v.caja !== this.caja) throw new ErrorDominio('PROHIBIDO', 'solo se imprimen ventas de la propia caja');
    return this.emitir('ticket.impresion', { ...d, tienda: this.tienda, caja: this.caja, folio: v.folio });
  }
  impresionesDe(saleId: string) {
    return this.opsDe('ticket.impresion').filter((o) => o.payload.sale_id === saleId).map((o) => ({ ...o.payload, ocurrio_en: o.ocurrio_en }));
  }

  /** Una sola transacción: folio + venta + movimientos + cola de salida. Todo o nada. */
  private confirmar(c: Carrito, pagos: Pago[], cajero: string, devolverEfectivo?: { monto: number; autorizo: string | null }): Venta {
    const total = c.lineas.reduce((a, l) => a + l.importe, 0);
    // El crédito del cambio liquida parte (o todo) el total como un pago más; el resto lo paga la clienta con los pagos recibidos.
    const credito = c.cambio ? Math.min(c.cambio.credito, total) : 0;
    if (credito > 0) pagos = [{ metodo: 'credito_cambio', monto: credito, folio_origen: c.cambio!.folio_origen }, ...pagos];
    // Compra a crédito de una empleada: no entra dinero, así que NO consume folio de venta; lleva su propia serie (CR) por caja.
    const esCredito = !!c.empleada && pagos.length > 0 && pagos.every((p) => p.metodo === 'credito_empleada');
    return this.repo.tx(() => {
      const folio = esCredito ? this.siguienteFolioCredito() : this.siguienteFolio();
      const resumenCredito = esCredito ? this.resumenCreditoTras(c.empleada!.id, total) : null;
      this.ctx.fallo?.('tras_folio');
      const limbo = this.repartoLimbo(c.lineas);
      const lineas = c.lineas.map((l) => (limbo.get(l.linea_id) ? { ...l, de_limbo: limbo.get(l.linea_id) } : l));
      // Recompensas: con lo que la clienta PAGA (mercancía, ya con descuentos y crédito de cambio) se gana el cupón impreso al final del ticket.
      const pagadoMerc = Math.max(0, c.lineas.filter((l) => !l.tarjeta_regalo).reduce((a, l) => a + l.importe, 0) - credito);
      const recompensas = esCredito ? [] : recompensasGanadas(reglasVigentes(this.idx.recompensas(), this.idx.promociones()), this.tienda, this.caja, folio, fechaLocal(this.ctx.reloj.now()), pagadoMerc);
      const op = this.emitir('sale.confirmed', {
        sale_id: c.id, tienda: this.tienda, caja: this.caja, folio, ...(esCredito ? { serie: 'CR', credito: resumenCredito } : {}), cajero, lineas, total, pagos,
        ...(recompensas.length ? { recompensas } : {}),
        ...(c.empleada ? { empleada: c.empleada } : {}),
        ...(c.vip ? { vip: c.vip } : {}),
        ...(c.cambio ? { cambio_de: { sale_id: c.cambio.sale_id, folio: c.cambio.folio_origen } } : {}),
        ...(c.vendedora ? { vendedora_id: c.vendedora.id, vendedora: c.vendedora.alias } : {}),
      }, `sale:${c.id}`);
      this.ctx.fallo?.('tras_venta');
      for (const p of pagos) {
        if (p.metodo === 'tarjeta_regalo') this.emitir('giftcard.uso', { codigo: p.tarjeta, monto: p.monto, sale_id: c.id, tienda: this.tienda, caja: this.caja }, `gcuso:${c.id}:${p.tarjeta}`);
      }
      for (const l of c.lineas) {
        if (l.tarjeta_regalo) {
          // La venta o recarga de una tarjeta no mueve inventario: crea o aumenta el saldo (y reinicia los 12 meses en efectivo).
          this.emitir(l.tarjeta_regalo.tipo === 'alta' ? 'giftcard.emitida' : 'giftcard.recarga',
            { codigo: l.tarjeta_regalo.codigo, monto: l.importe, tienda: this.tienda, caja: this.caja, cajero, sale_id: c.id, folio, medio: 'efectivo', vigente_hasta: sumarMeses(this.ctx.reloj.now(), l.tarjeta_regalo.meses ?? 12) }, `gc:${c.id}:${l.linea_id}`);
          continue;
        }
        const deLimbo = limbo.get(l.linea_id) ?? 0;
        if (deLimbo > 0) this.emitir('inv.movement', { item_id: l.item_id, tienda: LIMBO, delta: -deLimbo, tipo: 'venta', doc: c.id, caja: this.caja, origen_tienda: this.tienda }, `mov:${c.id}:${l.linea_id}:limbo`);
        if (l.qty - deLimbo > 0) this.emitir('inv.movement', { item_id: l.item_id, tienda: this.tienda, delta: -(l.qty - deLimbo), tipo: 'venta', doc: c.id, caja: this.caja }, `mov:${c.id}:${l.linea_id}`);
      }
      if (c.cambio) this.registrarDevolucionDeCambio(c, cajero, c.lineas.length > 0 ? c.id : null, devolverEfectivo);
      this.ctx.fallo?.('tras_movimientos');
      this.repo.kvSet(`cart:${c.id}`, { ...c, estado: 'confirmado' });
      return ventas([op]).get(c.id)!;
    });
  }

  /**
   * Cancela una venta YA COBRADA. Los movimientos físicos del cobro NO se borran: se agrega la salida de pesos de la cancelación
   * (importes originales, sin recalcular con otra tasa; un cobro con dólares conserva los dólares recibidos). Para algo anulado ANTES de recibir
   * dinero usar `anularCarrito`.
   */
  cancelarVenta(saleId: string, motivo: string, usuario = 'cajero', autoriza?: Autoriza, clienta?: { nombre: string; telefono: string }) {
    const v = ventas(this.opsVentas()).get(saleId);
    if (!v || v.tienda !== this.tienda || v.caja !== this.caja) throw new ErrorDominio('PROHIBIDO', 'solo se cancelan ventas de la propia caja');
    if (v.estado === 'cancelada') return v;
    if (v.lineas.some((l) => l.tarjeta_regalo)) throw new ErrorDominio('CANCELACION_BLOQUEADA', 'la venta o recarga de una tarjeta de regalo no se cancela (pendiente de definir)');
    if (devoluciones(this.opsDe('return.registered')).some((x) => x.sale_id === saleId)) throw new ErrorDominio('CANCELACION_BLOQUEADA', 'la venta ya tiene devoluciones: no se cancela completa, se sigue devolviendo');
    const autorizo = this.verificarAutorizador(usuario, autoriza); // cancelar una venta ya cobrada la autoriza otra persona
    const reembolsos = this.repartirReembolso(v, v.total, [], 0);
    this.repo.tx(() => {
      this.emitir('sale.cancelled', { sale_id: saleId, motivo, reembolsos, cancelo: usuario, ...(clienta ? { clienta } : {}), ...(autorizo ? { autorizado_por: autorizo } : {}) }, `cancel:${saleId}`);
      for (const p of v.pagos) {
        if (p.metodo === 'tarjeta_regalo') this.emitir('giftcard.reintegro', { codigo: p.tarjeta, monto: p.monto, sale_id: saleId, tienda: this.tienda, caja: this.caja, motivo: 'cancelacion' }, `gcre:${saleId}:${p.tarjeta}`);
      }
      for (const l of v.lineas) {
        const deLimbo = l.de_limbo ?? 0;
        if (deLimbo > 0) this.emitir('inv.movement', { item_id: l.item_id, tienda: LIMBO, delta: deLimbo, tipo: 'cancelacion', doc: saleId, caja: this.caja, origen_tienda: this.tienda }, `mov:cancel:${saleId}:${l.linea_id}:limbo`);
        if (l.qty - deLimbo > 0) this.emitir('inv.movement', { item_id: l.item_id, tienda: this.tienda, delta: l.qty - deLimbo, tipo: 'cancelacion', doc: saleId, caja: this.caja }, `mov:cancel:${saleId}:${l.linea_id}`);
      }
    });
    return ventas(this.opsVentas()).get(saleId)!;
  }

  /**
   * Anula una venta en curso ANTES de recibir dinero (carrito abandonado o cancelado en caja). No hay cobro, folio, pagos ni movimiento
   * físico: queda solo el registro de auditoría con lo que se había capturado.
   */
  anularCarrito(cartId: string, motivo: string, usuario = 'cajero') {
    if (this.repo.tieneOp(`sale:${cartId}`)) throw new ErrorDominio('VENTA_YA_CONFIRMADA', 'la venta ya recibió dinero: se cancela, no se anula');
    const c = this.cartGet(cartId);
    this.exigirAbierto(c);
    this.exigirSinCobroPendiente(c);
    this.repo.tx(() => {
      this.emitir('sale.voided', { cart_id: cartId, motivo, usuario, lineas: c.lineas, total: c.lineas.reduce((a, l) => a + l.importe, 0), tienda: this.tienda, caja: this.caja }, `void:${cartId}`);
      this.repo.kvSet(`cart:${cartId}`, { ...c, estado: 'descartado' });
    });
  }

  // ── tarjeta: intento persistido antes de usar la terminal ──
  iniciarCobroTarjeta(cartId: string, importe?: number) {
    if (!this.cfg.metodos.includes('tarjeta')) throw new ErrorDominio('PAGO_NO_PERMITIDO', `la caja ${this.id} no admite tarjeta`);
    if (this.repo.tieneOp(`sale:${cartId}`)) throw new ErrorDominio('VENTA_YA_CONFIRMADA', cartId);
    const c = this.cartGet(cartId);
    const todos = [...intentos(this.opsDe('card.intent', 'card.intent_resuelto')).values()].filter((i) => i.tienda === this.tienda && i.caja === this.caja);
    const abierto = todos.find((i) => i.cart_id === cartId && (i.estado === 'iniciado' || i.estado === 'desconocido'));
    // Nunca se genera un segundo cobro para el mismo carrito mientras haya uno sin conciliar.
    if (abierto) return { intento: abierto, reutilizado: true, avisos: [] as string[] };
    const otros = todos.filter((i) => i.cart_id !== cartId && (i.estado === 'iniciado' || i.estado === 'desconocido'));
    if (otros.length > 0 && this.ctx.politicas.P12_tarjeta_con_pendiente === 'bloquear_solo_tarjeta') {
      throw new ErrorDominio('TARJETA_BLOQUEADA', 'hay un cobro con tarjeta pendiente de conciliar (P-12 en ensayo); efectivo y devoluciones siguen disponibles');
    }
    const total = this.totalNeto(c);
    const intent_id = uuid();
    this.repo.tx(() => {
      this.emitir('card.intent', { intent_id, cart_id: cartId, tienda: this.tienda, caja: this.caja, importe: importe ?? total }, `intent:${intent_id}`);
      this.repo.kvSet(`cart:${cartId}`, { ...c, intent_id });
    });
    return { intento: intentos(this.opsDe('card.intent', 'card.intent_resuelto')).get(intent_id)!, reutilizado: false, avisos: otros.length ? ['hay_otros_cobros_pendientes'] : [] };
  }

  /**
   * Captura MANUAL de tarjeta (sin integración con la terminal): el cajero ya cobró en la terminal bancaria y teclea los datos del
   * comprobante. Crea el intento y lo resuelve como aprobado en un solo paso, así nunca queda un cobro pendiente por una captura a medias.
   * El resto (si el importe de tarjeta es menor al total) se cobra en efectivo exacto.
   */
  cobrarConTarjetaManual(cartId: string, d: { importe?: number; autorizacion?: string; marca?: string; ultimos4?: string }, cajero = 'cajero'): Venta {
    const previa = this.repo.getOp(`sale:${cartId}`);
    if (previa) return ventas([previa]).get(cartId)!;
    // El número de autorización ya no se captura: quien cobra confirma que la terminal aprobó. Si viene, se valida y se guarda (ventas con número, de antes).
    const autorizacion = (d.autorizacion ?? '').trim().toUpperCase();
    if (autorizacion && !/^[A-Z0-9]{4,12}$/.test(autorizacion)) throw new ErrorDominio('DATOS_REQUERIDOS', 'la autorización del comprobante debe tener de 4 a 12 letras o números');
    const ultimos4 = (d.ultimos4 ?? '').trim();
    if (ultimos4 && !/^\d{4}$/.test(ultimos4)) throw new ErrorDominio('DATOS_REQUERIDOS', 'los últimos 4 dígitos de la tarjeta deben ser 4 números');
    const marca = (d.marca ?? '').trim().slice(0, 20) || undefined;
    const c = this.cartGet(cartId);
    this.exigirAbierto(c);
    if (c.lineas.length === 0) throw new ErrorDominio('CARRITO_VACIO', cartId);
    const total = this.totalNeto(c);
    if (total <= 0) throw new ErrorDominio('PAGO_INVALIDO', 'la venta no tiene importe que cobrar con tarjeta');
    const importe = d.importe ?? total;
    if (!Number.isInteger(importe) || importe <= 0 || importe > total) throw new ErrorDominio('PAGO_INVALIDO', 'el importe de la tarjeta debe ser mayor que 0 y no exceder el total');
    const { intento } = this.iniciarCobroTarjeta(cartId, importe);
    try {
      const v = this.resolverIntento(intento.intent_id, { resultado: 'aprobado', autorizacion: autorizacion || undefined, confirmada: !autorizacion, marca, ultimos4: ultimos4 || undefined, efectivo_adicional: total - importe }, cajero);
      return v!;
    } catch (e) {
      this.resolverIntento(intento.intent_id, { resultado: 'no_cobrado' }, cajero);
      throw e;
    }
  }

  pendientesDeConciliar(): Intento[] {
    return [...intentos(this.opsDe('card.intent', 'card.intent_resuelto')).values()].filter((i) => i.tienda === this.tienda && i.caja === this.caja && (i.estado === 'iniciado' || i.estado === 'desconocido'));
  }

  resolverIntento(intentId: string, r: { resultado: 'aprobado' | 'no_cobrado' | 'desconocido'; autorizacion?: string; confirmada?: boolean; marca?: string; ultimos4?: string; efectivo_adicional?: number }, cajero = 'cajero'): Venta | null {
    const i = intentos(this.opsDe('card.intent', 'card.intent_resuelto')).get(intentId);
    if (!i || i.tienda !== this.tienda || i.caja !== this.caja) throw new ErrorDominio('INTENTO_INEXISTENTE', intentId);
    if (i.estado === 'aprobado') {
      if (r.resultado !== 'aprobado') throw new ErrorDominio('INTENTO_CERRADO', 'el cobro ya fue aprobado');
      return ventas(this.opsVentas()).get(i.cart_id) ?? null; // idempotente
    }
    if (i.estado === 'no_cobrado') {
      if (r.resultado === 'no_cobrado') return null;
      throw new ErrorDominio('INTENTO_CERRADO', 'el intento ya se cerró como no cobrado');
    }
    const c = this.cartGet(i.cart_id);
    if (r.resultado === 'aprobado') {
      if (!r.autorizacion && !r.confirmada) throw new ErrorDominio('DATOS_REQUERIDOS', 'falta autorización del comprobante');
      const total = this.totalNeto(c);
      const extra = r.efectivo_adicional ?? 0;
      if (i.importe + extra !== total) throw new ErrorDominio('PAGO_INVALIDO', 'tarjeta + efectivo no suman el total');
      const pagos: Pago[] = [{ metodo: 'tarjeta', monto: i.importe, ...(r.autorizacion ? { autorizacion: r.autorizacion } : { confirmada: true }), marca: r.marca, ultimos4: r.ultimos4 }];
      if (extra > 0) pagos.push({ metodo: 'efectivo', monto: extra });
      // El dinero ya se cobró: completar la venta no se frena por P-01 ni por existencia (P-02).
      return this.repo.tx(() => {
        this.emitir('card.intent_resuelto', { intent_id: intentId, resultado: 'aprobado', autorizacion: r.autorizacion }, `cardres:${intentId}:aprobado`);
        return this.confirmar(c, pagos, cajero);
      });
    }
    this.emitir('card.intent_resuelto', { intent_id: intentId, resultado: r.resultado }, `cardres:${intentId}:${r.resultado}`);
    return null;
  }

  /** Ventas del POS anterior de esta tienda que la caja conserva para consultar (últimos `DIAS_CONSULTA_HISTORICA` días), por folio. */
  ventasAnteriores(folio: number): { hist_id: string; folio: number; caja_hist: number; fecha: string; tipo_hist: string; piezas: number; total: number; pago: string }[] {
    const limite = new Date(Date.parse(this.ctx.reloj.now()) - DIAS_CONSULTA_HISTORICA * 86400_000).toISOString().slice(0, 10);
    return this.opsDe('venta.consulta')
      .map((o) => o.payload)
      .filter((p) => p.tienda_hist === this.tienda && p.folio === folio && p.fecha >= limite)
      .map((p) => ({ hist_id: p.hist_id, folio: p.folio, caja_hist: p.caja_hist, fecha: p.fecha, tipo_hist: p.tipo_hist, piezas: p.piezas, total: p.total, pago: p.pago }));
  }

  // ── localizar ventas (devoluciones: solo se devuelve en la caja donde se vendió) ──
  /**
   * Busca ventas de la TIENDA por fecha/hora, artículo o folio. Las de esta caja salen completas (se pueden devolver aquí);
   * las de la otra caja solo salen para saber en cuál se vendió (sin importes ni pagos): ahí se hace la devolución.
   */
  buscarVentas(q: BusquedaVentas): { resultados: (VentaLocalizada & { propia: boolean; total?: number; lineas_detalle?: (Linea & { devuelto: number })[] })[]; hub: boolean } {
    const local = this.opsDe('sale.confirmed', 'sale.cancelled', 'return.registered');
    const devuelto = new Map<string, number>();
    for (const dv of devoluciones(local)) for (const l of dv.lineas) devuelto.set(`${dv.sale_id}|${l.linea_id}`, (devuelto.get(`${dv.sale_id}|${l.linea_id}`) ?? 0) + l.qty);
    const propias = localizarVentas(local, this.tienda, q).filter((v) => v.caja === this.caja);
    const mapa = new Map<string, VentaLocalizada & { propia: boolean; total?: number; lineas_detalle?: (Linea & { devuelto: number })[] }>();
    const completas = ventas(local);
    for (const v of propias) {
      const full = completas.get(v.sale_id)!;
      mapa.set(v.sale_id, { ...v, propia: true, total: full.total, lineas_detalle: full.lineas.map((l) => ({ ...l, devuelto: devuelto.get(`${v.sale_id}|${l.linea_id}`) ?? 0 })) });
    }
    const remotas = this.enlace.buscarVentas(q);
    for (const v of remotas ?? []) if (!mapa.has(v.sale_id)) mapa.set(v.sale_id, { ...v, propia: v.caja === this.caja && v.tienda === this.tienda });
    const resultados = [...mapa.values()].sort((a, b) => b.ocurrio_en.localeCompare(a.ocurrio_en));
    return { resultados, hub: remotas !== null };
  }

  // ── reparto de un reembolso entre los métodos con que se pagó ──
  private repartirReembolso(venta: Venta, importe: number, previas: Devolucion['reembolsos'], devueltoAntes: number): Devolucion['reembolsos'] {
    type Cubeta = { clave: string; metodo: 'efectivo' | 'tarjeta' | 'tarjeta_regalo' | 'credito_empleada'; tarjeta?: string; pagado: number; antes: number; monto: number };
    const cubetas = new Map<string, Cubeta>();
    const claveDe = (metodo: string, tarjeta?: string) => (metodo === 'tarjeta_regalo' ? `rg:${tarjeta}` : metodo === 'tarjeta' ? 'tarjeta' : metodo === 'credito_empleada' ? 'ce' : 'efectivo');
    for (const p of venta.pagos) {
      const clave = claveDe(p.metodo, p.tarjeta);
      const c = cubetas.get(clave) ?? { clave, metodo: p.metodo === 'tarjeta_regalo' ? 'tarjeta_regalo' : p.metodo === 'tarjeta' ? 'tarjeta' : p.metodo === 'credito_empleada' ? 'credito_empleada' : 'efectivo', tarjeta: p.tarjeta, pagado: 0, antes: 0, monto: 0 };
      c.pagado += p.monto;
      cubetas.set(clave, c);
    }
    for (const r of previas) {
      const c = cubetas.get(claveDe(r.metodo, r.tarjeta));
      if (c) c.antes += r.monto;
    }
    const orden = [...cubetas.values()].sort((a, b) => ['efectivo', 'tarjeta', 'tarjeta_regalo', 'credito_empleada'].indexOf(a.metodo) - ['efectivo', 'tarjeta', 'tarjeta_regalo', 'credito_empleada'].indexOf(b.metodo));
    const ultima = devueltoAntes + importe >= venta.total;
    for (const c of orden) {
      const resta = c.pagado - c.antes;
      c.monto = Math.max(0, Math.min(resta, ultima ? resta : Math.floor((importe * c.pagado) / venta.total)));
    }
    let falta = importe - orden.reduce((a, c) => a + c.monto, 0);
    for (const c of orden) { // el residuo del redondeo va al primer método con capacidad (efectivo primero)
      if (falta <= 0) break;
      const t = Math.min(c.pagado - c.antes - c.monto, falta);
      c.monto += t;
      falta -= t;
    }
    if (falta > 0) throw new ErrorDominio('DEVOLUCION_EXCEDE', 'la devolución excede lo pagado por los métodos originales');
    return orden.filter((c) => c.monto > 0).map((c) => (c.metodo === 'tarjeta_regalo' ? { metodo: c.metodo, monto: c.monto, tarjeta: c.tarjeta } : { metodo: c.metodo, monto: c.monto }));
  }

  // ── devoluciones ──
  /** Valida qué piezas de una venta se regresan y cuánto vale cada una (descuento incluido). Solo en la caja donde se vendió (P-03). */
  private validarRenglonesDevolucion(d: { sale_id: string; renglones: { linea_id: string; qty: number }[]; ventaSnapshot?: Venta }) {
    const local = this.opsDe('sale.confirmed', 'sale.cancelled', 'return.registered');
    let venta = ventas(local).get(d.sale_id) ?? null;
    let verificacion = 'local';
    if (!venta) {
      venta = this.enlace.consultarVenta(d.sale_id);
      verificacion = venta ? 'hub_o_central' : 'ninguna';
    }
    if (!venta) {
      if (this.ctx.politicas.P03_devolucion_venta_no_local === 'bloquear' || !d.ventaSnapshot) {
        throw new ErrorDominio('DEVOLUCION_BLOQUEADA', 'la venta original no es consultable desde esta caja (P-03 en ensayo)');
      }
      venta = d.ventaSnapshot;
      verificacion = 'ticket_sin_verificar';
    }
    if (venta.estado === 'cancelada') throw new ErrorDominio('DEVOLUCION_BLOQUEADA', 'venta cancelada');
    // P-03 (decidido): una devolución se hace SOLO en la caja donde se vendió; el ticket dice Caja 1 o Caja 2 para saber cuál.
    if (venta.tienda !== this.tienda || venta.caja !== this.caja) {
      throw new ErrorDominio('DEVOLUCION_OTRA_CAJA', `esa venta se hizo en ${venta.tienda === this.tienda ? '' : `${venta.tienda}, `}la Caja ${venta.caja}: la devolución se hace en esa caja`, { tienda: venta.tienda, caja: venta.caja });
    }
    if (venta.lineas.some((l) => d.renglones.some((r) => r.linea_id === l.linea_id) && l.tarjeta_regalo)) {
      throw new ErrorDominio('DEVOLUCION_BLOQUEADA', 'la venta o recarga de una tarjeta de regalo no se devuelve (pendiente de definir)');
    }
    const propio = devueltoPorLinea(local, d.sale_id);
    const auto = this.enlace.devueltoAutoritativo(d.sale_id);
    const lineas: Devolucion['lineas'] = [];
    for (const r of d.renglones) {
      const l = venta.lineas.find((x) => x.linea_id === r.linea_id);
      if (!l) throw new ErrorDominio('LINEA_INEXISTENTE', r.linea_id);
      if (!Number.isInteger(r.qty) || r.qty <= 0) throw new ErrorDominio('DEVOLUCION_INVALIDA', 'cantidad inválida');
      const ya = Math.max(propio.get(r.linea_id)?.qty ?? 0, auto?.get(r.linea_id)?.qty ?? 0);
      const yaImporte = Math.max(propio.get(r.linea_id)?.importe ?? 0, auto?.get(r.linea_id)?.importe ?? 0);
      if (r.qty + ya > l.qty) throw new ErrorDominio('DEVOLUCION_EXCEDE', `se vendieron ${l.qty}, ya se devolvieron ${ya}`);
      // Importe realmente pagado (descuento incluido); la última unidad absorbe el redondeo.
      const importe = r.qty + ya === l.qty ? l.importe - yaImporte : Math.floor((l.importe * r.qty) / l.qty);
      lineas.push({ linea_id: r.linea_id, item_id: l.item_id, qty: r.qty, importe });
    }
    return { venta, verificacion, lineas, importe: lineas.reduce((a, l) => a + l.importe, 0), local };
  }

  devolver(d: { sale_id: string; renglones: { linea_id: string; qty: number }[]; motivo: string; devolucion_id?: string; ventaSnapshot?: Venta; cajero?: string; autoriza?: Autoriza }): Devolucion {
    const id = d.devolucion_id ?? uuid();
    const previa = this.repo.getOp(`ret:${id}`);
    if (previa) return { ...previa.payload, ocurrio_en: previa.ocurrio_en };
    const autorizo = this.verificarAutorizador(d.cajero ?? 'cajero', d.autoriza); // una devolución la autoriza otra persona
    const { venta, verificacion, lineas, importe, local } = this.validarRenglonesDevolucion(d);
    // Cada método de pago se devuelve por su propia vía y NUNCA por más de lo que pagó: tarjeta de regalo → al saldo de la misma tarjeta;
    // tarjeta bancaria → reverso a esa tarjeta (no sale efectivo); efectivo (pesos o con dólares) → SOLO en pesos y con los importes
    // originales de la venta, sin recalcular con el tipo de cambio de hoy. Parcial: proporcional; la última devolución absorbe el redondeo.
    const previas = devoluciones(local).filter((x) => x.sale_id === d.sale_id);
    const devueltoAntes = previas.reduce((a, x) => a + x.importe, 0);
    const reembolsos = this.repartirReembolso(venta, importe, previas.flatMap((x) => x.reembolsos), devueltoAntes);
    this.renovarSiHaceFalta();
    const op = this.repo.tx(() => {
      // P-08 (decidido): la devolución consume folio de la MISMA serie que las ventas de esta caja.
      const folio = this.siguienteFolio();
      const payload = {
        devolucion_id: id, sale_id: d.sale_id, tienda: this.tienda, caja: this.caja, folio,
        tienda_origen: venta.tienda, caja_origen: venta.caja, folio_origen: venta.folio,
        lineas, importe, reembolsos, motivo: d.motivo, cajero: d.cajero ?? 'cajero', verificacion, ...(autorizo ? { autorizado_por: autorizo } : {}),
      };
      const o = this.emitir('return.registered', payload, `ret:${id}`);
      for (const r of reembolsos) {
        if (r.metodo === 'tarjeta_regalo') this.emitir('giftcard.reintegro', { codigo: r.tarjeta, monto: r.monto, sale_id: d.sale_id, devolucion_id: id, tienda: this.tienda, caja: this.caja, motivo: 'devolucion' }, `gcre:ret:${id}:${r.tarjeta}`);
      }
      for (const l of lineas) this.emitir('inv.movement', { item_id: l.item_id, tienda: this.tienda, delta: l.qty, tipo: 'devolucion', doc: id, caja: this.caja }, `mov:${id}:${l.linea_id}`);
      return o;
    });
    return { ...op.payload, ocurrio_en: op.ocurrio_en };
  }

  // ── «Vendió por»: la vendedora que atendió la venta (sin clave) ──
  /** Quién puede figurar como vendedora: las Vendedoras-Cajeras y los supervisores activos. */
  vendedoras(): { id: string; alias: string; tipo: 'cajero' | 'supervisor' }[] {
    const sups = new Set(this.idx.supervisores().map((s) => nombreClave(s.nombre)));
    return [...this.idx.cajeros().filter((c) => c.activo && (!c.tienda || c.tienda === this.tienda)).map((c) => ({ id: c.id, alias: c.nombre, tipo: (sups.has(nombreClave(c.nombre)) ? 'supervisor' : 'cajero') as 'cajero' | 'supervisor' }))]
      .sort((a, b) => a.alias.localeCompare(b.alias, 'es'));
  }
  /** `null` = «Autocompra» (nadie ayudó a la clienta). */
  asignarVendedora(cartId: string, vendedoraId: string | null): { id: string | null; alias: string } {
    const c = this.cartGet(cartId);
    this.exigirAbierto(c);
    let v: { id: string | null; alias: string };
    if (vendedoraId === null || vendedoraId === '') v = { id: null, alias: 'Autocompra' };
    else {
      const e = this.vendedoras().find((x) => x.id === vendedoraId);
      if (!e) throw new ErrorDominio('VENDEDORA_INEXISTENTE', 'esa vendedora no está activa');
      v = { id: e.id, alias: e.alias };
    }
    c.vendedora = v;
    this.repo.tx(() => { this.repo.kvSet(`cart:${cartId}`, c); });
    return v;
  }

  // ── cambios: las piezas que regresa la clienta quedan como crédito (en negativo) dentro de una venta nueva ──
  /** Empieza un cambio en esta venta: valida las piezas y deja su importe como crédito. No mueve inventario ni dinero hasta cobrar. */
  iniciarCambio(cartId: string, saleId: string, renglones: { linea_id: string; qty: number }[], datos?: { clienta: { nombre: string; telefono: string }; motivo: string }): CambioEnCurso {
    const c = this.cartGet(cartId);
    this.exigirAbierto(c); this.exigirSinCobroPendiente(c);
    if (c.cambio) throw new ErrorDominio('CAMBIO_YA_INICIADO', 'esta venta ya lleva un cambio: termínelo o quítelo antes de empezar otro');
    if (!renglones.length) throw new ErrorDominio('DATOS_REQUERIDOS', 'indique cuántas piezas se cambian');
    const r = this.validarRenglonesDevolucion({ sale_id: saleId, renglones });
    c.cambio = {
      sale_id: saleId, folio_origen: r.venta.folio, renglones: renglones.map((x) => ({ linea_id: x.linea_id, qty: x.qty })), credito: r.importe,
      lineas: r.lineas.map((dl) => {
        const l = r.venta.lineas.find((x) => x.linea_id === dl.linea_id)!;
        return { linea_id: l.linea_id, item_id: l.item_id, item_no: l.item_no, codigo: l.codigo, descripcion: l.descripcion, marca: l.marca, estilo: l.estilo, qty: dl.qty, precio_unit: l.precio_unit, importe: dl.importe };
      }),
      ...(datos ? { clienta: datos.clienta, motivo: datos.motivo } : {}),
    };
    this.repo.tx(() => { this.repo.kvSet(`cart:${cartId}`, c); });
    return c.cambio;
  }
  quitarCambio(cartId: string): void {
    const c = this.cartGet(cartId);
    this.exigirAbierto(c); this.exigirSinCobroPendiente(c);
    delete c.cambio;
    this.repo.tx(() => { this.repo.kvSet(`cart:${cartId}`, c); });
  }
  /**
   * Deja registradas las piezas que regresaron (dentro de la misma transacción que la venta, o sola si la clienta no se llevó nada). La devolución
   * consume folio de la serie (P-08) y NO regresa dinero salvo el saldo en efectivo autorizado; `reembolsos` vacío = todo se usó como crédito.
   */
  private registrarDevolucionDeCambio(c: Carrito, cajero: string, ventaCambioId: string | null, devolverEfectivo?: { monto: number; autorizo: string | null }): Devolucion {
    const cambio = c.cambio!;
    const id = `cambio-${c.id}`;
    const r = this.validarRenglonesDevolucion({ sale_id: cambio.sale_id, renglones: cambio.renglones });
    if (r.importe !== cambio.credito) throw new ErrorDominio('CAMBIO_DESACTUALIZADO', 'las piezas del cambio ya se devolvieron en otra operación: empiece el cambio de nuevo');
    const efectivo = devolverEfectivo?.monto ?? 0;
    const folio = this.siguienteFolio();
    const o = this.emitir('return.registered', {
      devolucion_id: id, sale_id: cambio.sale_id, tienda: this.tienda, caja: this.caja, folio,
      tienda_origen: r.venta.tienda, caja_origen: r.venta.caja, folio_origen: r.venta.folio,
      lineas: r.lineas, importe: r.importe, reembolsos: efectivo > 0 ? [{ metodo: 'efectivo', monto: efectivo }] : [],
      motivo: 'cambio', cajero, verificacion: r.verificacion, por_cambio: true, ...(ventaCambioId ? { venta_cambio: ventaCambioId } : {}),
      ...(cambio.clienta ? { clienta: cambio.clienta } : {}), ...(cambio.motivo ? { motivo_cambio: cambio.motivo } : {}),
      ...(devolverEfectivo?.autorizo ? { autorizado_por: devolverEfectivo.autorizo } : {}),
    }, `ret:${id}`);
    for (const l of r.lineas) this.emitir('inv.movement', { item_id: l.item_id, tienda: this.tienda, delta: l.qty, tipo: 'devolucion', doc: id, caja: this.caja }, `mov:${id}:${l.linea_id}`);
    return { ...o.payload, reembolsos: o.payload.reembolsos, ocurrio_en: o.ocurrio_en };
  }
  /**
   * «No hay cambio posible, devolver dinero»: lo que queda a favor de la clienta (o todo, si no se llevó nada) se entrega en efectivo. La misma
   * Vendedora-Cajera u otra autoriza con su clave. Si hay artículos en la venta se cobran con el crédito en el mismo paso.
   */
  devolverEfectivoDeCambio(cartId: string, cajero: string, autoriza?: Autoriza): { venta: Venta | null; devolucion: Devolucion } {
    const ya = this.repo.getOp(`ret:cambio-${cartId}`);
    if (ya) {
      const vp = this.repo.getOp(`sale:${cartId}`);
      return { venta: vp ? ventas([vp]).get(cartId)! : null, devolucion: { ...ya.payload, ocurrio_en: ya.ocurrio_en } };
    }
    const c = this.cartGet(cartId);
    this.exigirAbierto(c); this.exigirSinCobroPendiente(c);
    if (!c.cambio) throw new ErrorDominio('SIN_CAMBIO', 'esta venta no lleva un cambio');
    const neto = this.totalNeto(c);
    if (neto >= 0) throw new ErrorDominio('SIN_SALDO_A_FAVOR', 'la clienta no tiene saldo a favor: se cobra la diferencia');
    const autorizo = this.verificarAutorizador(cajero, autoriza, true);
    const dev = { monto: -neto, autorizo };
    this.renovarSiHaceFalta();
    let venta: Venta | null = null;
    if (c.lineas.length > 0) venta = this.cobrar(cartId, [], cajero, { devolverEfectivo: dev });
    else {
      this.repo.tx(() => {
        this.registrarDevolucionDeCambio(c, cajero, null, dev);
        this.repo.kvSet(`cart:${c.id}`, { ...c, estado: 'confirmado' });
      });
    }
    const op = this.repo.getOp(`ret:cambio-${cartId}`)!;
    return { venta, devolucion: { ...op.payload, ocurrio_en: op.ocurrio_en } };
  }

  // ── efectivo y corte (solo con datos de ESTA caja) ──
  movimientoEfectivo(tipo: 'fondo_inicial' | 'retiro' | 'entrada', monto: number, moneda: 'MXN' | 'USD' = 'MXN') {
    if (moneda !== 'MXN' && moneda !== 'USD') throw new ErrorDominio('PAGO_INVALIDO', `moneda no soportada: ${moneda}`);
    if (!Number.isInteger(monto) || monto <= 0) throw new ErrorDominio('PAGO_INVALIDO', 'el monto es un entero positivo en centavos');
    this.emitir('cash.movement', { tienda: this.tienda, caja: this.caja, tipo, monto, moneda, fecha: fechaLocal(this.ctx.reloj.now()) });
  }
  /**
   * Entrada extraordinaria de efectivo (operación fuera del cierre): la autoriza un supervisor con su clave, lleva motivo y una referencia única
   * (reintentar con la misma referencia no la duplica).
   */
  registrarEntrada(d: { ref: string; monto: number; moneda: 'MXN' | 'USD'; motivo: string; claveSupervisor: string; usuario: string; sinSupervisor?: boolean }) {
    if (!d.ref) throw new ErrorDominio('DATOS_REQUERIDOS', 'falta la referencia de la operación');
    const previo = this.repo.getOp(`entrada:${d.ref}`);
    if (previo) return { ...previo.payload, ocurrio_en: previo.ocurrio_en };
    const motivo = String(d.motivo ?? '').trim();
    if (motivo.length < 3) throw new ErrorDominio('DATOS_REQUERIDOS', 'escriba el motivo de la entrada de efectivo');
    const sup = this.supervisorOPropio(String(d.claveSupervisor ?? ''), d.usuario, d.sinSupervisor, 'una entrada de efectivo la autoriza un supervisor con su clave', 'AUTORIZACION_REQUERIDA');
    if (d.moneda !== 'MXN' && d.moneda !== 'USD') throw new ErrorDominio('PAGO_INVALIDO', `moneda no soportada: ${d.moneda}`);
    if (!Number.isInteger(d.monto) || d.monto <= 0) throw new ErrorDominio('PAGO_INVALIDO', 'el monto es un entero positivo en centavos');
    const op = this.emitir('cash.movement', { tienda: this.tienda, caja: this.caja, tipo: 'entrada', monto: d.monto, moneda: d.moneda, fecha: fechaLocal(this.ctx.reloj.now()), motivo, autorizado_por: sup.nombre, usuario: d.usuario, ref: d.ref }, `entrada:${d.ref}`);
    return { ...op.payload, ocurrio_en: op.ocurrio_en };
  }

  // ── cierre guiado: fondo fijo, conteo de ventas y cierre ──
  /**
   * Límite de ventas en efectivo del día de ESTA caja (lo fija Administración; 0 = sin límite) y lo cobrado en efectivo hoy en ella (pesos y dólares,
   * sin contar cancelaciones). `alcanzado` enciende el aviso permanente de la barra lateral: hay que cobrar en la otra caja de la tienda.
   */
  limiteEfectivo(): { limite: number; vendido: number; alcanzado: boolean; cobrar_en: number } {
    const a = this.opsDe('caja.limite_efectivo').filter((o) => o.payload.tienda === this.tienda && o.payload.caja === this.caja).at(-1);
    const limite = a ? Math.max(0, Number(a.payload.limite) || 0) : 0;
    const hoy = fechaLocal(this.ctx.reloj.now());
    const vendido = [...ventas(this.opsDe('sale.confirmed', 'sale.cancelled')).values()]
      .filter((v) => v.estado === 'confirmada' && v.tienda === this.tienda && v.caja === this.caja && fechaLocal(v.ocurrio_en) === hoy)
      .reduce((s, v) => s + v.pagos.filter((p) => p.metodo === 'efectivo' || p.metodo === 'efectivo_usd').reduce((x, p) => x + p.monto, 0), 0);
    return { limite, vendido, alcanzado: limite > 0 && vendido >= limite, cobrar_en: this.caja === 1 ? 2 : 1 };
  }
  /** Fondo fijo autorizado por Administración para ESTA caja (el último asignado; sin asignación, $5,000). */
  fondoAutorizado(): number {
    const a = this.opsDe('caja.fondo_autorizado').filter((o) => o.payload.tienda === this.tienda && o.payload.caja === this.caja).at(-1);
    return a ? (a.payload.monto as number) : FONDO_AUTORIZADO_DEFECTO;
  }
  /** Última confirmación del fondo de una fecha (o null). */
  fondoDelDia(fecha: string) {
    const o = this.opsDe('cash.fondo').filter((x) => x.payload.tienda === this.tienda && x.payload.caja === this.caja && x.payload.fecha === fecha).at(-1);
    return o ? { ...o.payload, ocurrio_en: o.ocurrio_en } as { total: number; autorizado: number; diferencia: number; estado: 'completo' | 'faltante' | 'sobrante'; nota: string; denominaciones: Record<string, number>; usuario: string; fecha: string; ocurrio_en: string } : null;
  }
  /** Composición del último fondo confirmado ANTES de esta fecha: referencia para armar el del turno siguiente. */
  fondoReferencia(fecha: string) {
    const o = this.opsDe('cash.fondo').filter((x) => x.payload.tienda === this.tienda && x.payload.caja === this.caja && x.payload.fecha < fecha).at(-1);
    return o ? { fecha: o.payload.fecha as string, total: o.payload.total as number, denominaciones: o.payload.denominaciones as Record<string, number> } : null;
  }
  /**
   * Confirma la composición física del fondo. Separarlo del cajón NO es ingreso ni venta: no genera movimiento de efectivo. Solo es «fondo completo»
   * con el importe autorizado exacto; con faltante o sobrante la cajera lo registra con una nota (queda en el corte, nunca se corrige solo).
   */
  confirmarFondo(d: { denominaciones: Record<string, number>; nota?: string; usuario: string }) {
    const fecha = fechaLocal(this.ctx.reloj.now());
    if (this.corteAlDia(fecha)) throw new ErrorDominio('CORTE_CERRADO', 'el corte de hoy ya está cerrado: el fondo no se modifica');
    const den: Record<string, number> = {};
    for (const [k, n] of Object.entries(d.denominaciones ?? {})) {
      if (!n) continue;
      if (!(DENOMINACIONES_FONDO as readonly number[]).includes(Number(k))) throw new ErrorDominio('CONTEO_INVALIDO', `en el fondo no se admite la denominación ${k}`);
      if (!Number.isInteger(n) || n < 0) throw new ErrorDominio('CONTEO_INVALIDO', `cantidad inválida de ${k}`);
      den[k] = n;
    }
    const total = totalDenominacionesMxn(den);
    if (total <= 0) throw new ErrorDominio('CONTEO_INVALIDO', 'cuente el fondo: no hay monedas ni billetes registrados');
    const autorizado = this.fondoAutorizado();
    const diferencia = total - autorizado;
    const nota = String(d.nota ?? '').trim().slice(0, 300);
    if (diferencia !== 0 && nota.length < 3) throw new ErrorDominio('FONDO_NO_COINCIDE', `el fondo suma ${diferencia < 0 ? 'menos' : 'más'} que lo autorizado (${diferencia < 0 ? 'faltan' : 'sobran'} ${Math.abs(diferencia) / 100} pesos): registre el ${diferencia < 0 ? 'faltante' : 'sobrante'} con una nota`, { diferencia });
    const estado = diferencia === 0 ? 'completo' : diferencia < 0 ? 'faltante' : 'sobrante';
    const op = this.emitir('cash.fondo', { tienda: this.tienda, caja: this.caja, fecha, denominaciones: den, total, autorizado, diferencia, estado, nota, usuario: d.usuario });
    return { ...op.payload, ocurrio_en: op.ocurrio_en };
  }
  /** Lo que el sistema espera que haya en el cajón en pesos ahora: el fondo confirmado de hoy más el efectivo de las ventas y movimientos. Null sin fondo confirmado. */
  efectivoEsperadoCajon(fecha = fechaLocal(this.ctx.reloj.now())): number | null {
    const f = this.fondoDelDia(fecha);
    return f ? f.total + this.estadoRetiro().en_cajon.mxn : null;
  }
  /**
   * Conteo de TODO el cajón en pesos a cualquier hora, para rectificar feria y efectivo: billetes y monedas tal como quedaron. Reemplaza la estimación de la
   * feria con lo contado y deja constancia de la diferencia contra lo que esperaba el sistema (con nota si no coincide). No mueve dinero ni cambia el corte.
   */
  registrarArqueo(d: { denominaciones: Record<string, number>; nota?: string; usuario: string; clave?: string }) {
    // Con Vendedoras-Cajeras registradas, contar el cajón exige la propia clave de quien lo hace (la misma con que abrió el cajón).
    if (this.controlesConClave()) this.verificarClaveCajero(d.usuario, String(d.clave ?? ''));
    const fecha = fechaLocal(this.ctx.reloj.now());
    if (this.corteAlDia(fecha)) throw new ErrorDominio('CORTE_CERRADO', 'el corte de hoy ya está cerrado: el cajón no se cuenta');
    if (!this.fondoDelDia(fecha)) throw new ErrorDominio('FONDO_PENDIENTE', 'primero cuente y confirme el fondo del día (en el cierre de caja)');
    const den: Record<string, number> = {};
    for (const [k, n] of Object.entries(d.denominaciones ?? {})) {
      if (!n) continue;
      if (!Number.isInteger(n) || n < 0) throw new ErrorDominio('CONTEO_INVALIDO', `cantidad inválida de ${k}`);
      den[k] = n;
    }
    let total: number;
    try { total = totalDenominacionesMxn(den); } catch (e) { throw new ErrorDominio('CONTEO_INVALIDO', (e as Error).message); }
    if (total <= 0) throw new ErrorDominio('CONTEO_INVALIDO', 'cuente el cajón: no hay monedas ni billetes registrados');
    const esperado = this.efectivoEsperadoCajon(fecha)!;
    const diferencia = total - esperado;
    const nota = String(d.nota ?? '').trim().slice(0, 300);
    if (diferencia !== 0 && nota.length < 3) throw new ErrorDominio('ARQUEO_NO_COINCIDE', `el cajón suma ${diferencia < 0 ? 'menos' : 'más'} que lo esperado (${diferencia < 0 ? 'faltan' : 'sobran'} ${Math.abs(diferencia) / 100} pesos): escriba una nota que explique la diferencia`);
    const op = this.emitir('cash.arqueo', { tienda: this.tienda, caja: this.caja, fecha, denominaciones: den, total, esperado, diferencia, estado: diferencia === 0 ? 'cuadra' : diferencia < 0 ? 'faltante' : 'sobrante', nota, usuario: d.usuario });
    return { ...op.payload, ocurrio_en: op.ocurrio_en };
  }
  /** Conteos del cajón de una fecha en esta caja (el más reciente primero). */
  arqueos(fecha: string) {
    return this.opsDe('cash.arqueo').filter((o) => o.payload.tienda === this.tienda && o.payload.caja === this.caja && o.payload.fecha === fecha).map((o) => ({ ...o.payload, ocurrio_en: o.ocurrio_en })).reverse();
  }
  /** Efectivo de venta en el cajón hoy (sin fondo ni entradas), lo disponible por moneda y si ya toca un retiro. */
  estadoRetiro() {
    const fecha = fechaLocal(this.ctx.reloj.now());
    const libro = movimientosCaja(this.opsDe('sale.confirmed', 'sale.cancelled', 'return.registered', 'cash.movement', 'cash.ajuste_admin'), this.tienda, this.caja).filter((m) => m.fecha === fecha);
    const tc = this.tipoCambio();
    const venta = efectivoDeVentaEnCaja(libro, tc?.tasa ?? null);
    const en = (moneda: 'MXN' | 'USD') => libro.filter((m) => m.moneda === moneda).reduce((a, m) => a + m.monto, 0);
    return {
      fecha, venta, umbral: UMBRAL_AVISO_RETIRO, minimo: MINIMO_RETIRO, avisar: venta.equivalente >= UMBRAL_AVISO_RETIRO,
      en_cajon: { mxn: en('MXN'), usd: en('USD') },
      tasa: tc ? { version: tc.version, tasa: tc.tasa } : null,
      billetes: { mxn: [...BILLETES_RETIRO_MXN], usd: [...BILLETES_RETIRO_USD] },
    };
  }
  /** Retiros registrados por esta caja en una fecha (la más reciente primero). */
  retiros(fecha: string): RetiroRegistrado[] {
    return this.opsDe('cash.retiro').filter((o) => o.payload.tienda === this.tienda && o.payload.caja === this.caja && o.payload.fecha === fecha)
      .map((o) => ({ ...o.payload, ocurrio_en: o.ocurrio_en }) as RetiroRegistrado).reverse();
  }
  /**
   * Retiro de efectivo: billetes grandes de pesos y/o dólares hasta completar al menos el mínimo (en pesos o su equivalente en dólares al tipo de
   * cambio vigente). NO bloquea la venta y no tiene que ser exactamente el umbral. Cada moneda sale del libro con su movimiento `retiro`, así
   * el corte lo descuenta; el registro `cash.retiro` guarda el desglose y el efectivo de venta antes y después. Reintentar con el mismo
   * `retiro_id` devuelve el mismo retiro.
   */
  registrarRetiro(d: { retiro_id: string; mxn?: Record<string, number>; usd?: Record<string, number>; usuario: string; clave?: string }): RetiroRegistrado {
    if (!d.retiro_id) throw new ErrorDominio('DATOS_REQUERIDOS', 'falta la referencia del retiro');
    const previo = this.repo.getOp(`retiro:${d.retiro_id}`);
    if (previo) return { ...previo.payload, ocurrio_en: previo.ocurrio_en } as RetiroRegistrado;
    if (this.controlesConClave()) this.verificarClaveCajero(d.usuario, String(d.clave ?? '')); // un retiro lo confirma el propio cajero con su clave
    const limpia = (x: Record<string, number> | undefined, permitidas: readonly number[], moneda: string) => {
      const out: Record<string, number> = {};
      for (const [k, n] of Object.entries(x ?? {})) {
        if (n === 0) continue;
        if (!permitidas.includes(Number(k))) throw new ErrorDominio('RETIRO_INVALIDO', `en un retiro de ${moneda} no se admite el billete ${k}`);
        if (!Number.isInteger(n) || n < 0) throw new ErrorDominio('RETIRO_INVALIDO', `cantidad inválida del billete ${k}`);
        out[k] = n;
      }
      return out;
    };
    const mxn = limpia(d.mxn, BILLETES_RETIRO_MXN, 'pesos');
    const usd = limpia(d.usd, BILLETES_RETIRO_USD, 'dólares');
    const totalMxn = totalDenominacionesMxn(mxn);
    const totalUsd = totalDenominacionesUsd(usd);
    const est = this.estadoRetiro();
    if (totalUsd > 0 && !est.tasa) throw new ErrorDominio('SIN_TIPO_DE_CAMBIO', 'no hay tipo de cambio fijado: no se puede calcular el equivalente de los dólares');
    const equivalente = totalMxn + (totalUsd > 0 ? usdAMxn(totalUsd, est.tasa!.tasa) : 0);
    if (equivalente < MINIMO_RETIRO) throw new ErrorDominio('RETIRO_INSUFICIENTE', `el retiro debe sumar al menos ${MINIMO_RETIRO / 100} pesos (o su equivalente en dólares)`, { minimo: MINIMO_RETIRO, equivalente });
    if (totalMxn > est.en_cajon.mxn || totalUsd > est.en_cajon.usd) throw new ErrorDominio('RETIRO_EXCEDE_EFECTIVO', 'el retiro es mayor que el efectivo que registra la caja', { pesos_en_cajon: est.en_cajon.mxn, usd_en_cajon: est.en_cajon.usd });
    const fecha = est.fecha;
    return this.repo.tx(() => {
      const n = this.opsDe('cash.retiro').filter((o) => o.payload.tienda === this.tienda && o.payload.caja === this.caja).length + 1;
      const folio_retiro = `${this.tienda === 'DUO' ? 'D' : this.tienda === 'LON' ? 'L' : this.tienda.slice(0, 1)}${this.caja}-R${String(n).padStart(4, '0')}`;
      const retiro: Omit<RetiroRegistrado, 'ocurrio_en'> = {
        retiro_id: d.retiro_id, folio_retiro, tienda: this.tienda, caja: this.caja, usuario: d.usuario, fecha,
        mxn: { denominaciones: mxn, total: totalMxn }, usd: { denominaciones: usd, total: totalUsd },
        tasa: totalUsd > 0 ? est.tasa!.tasa : null, tasa_version: totalUsd > 0 ? est.tasa!.version : null, equivalente_mxn: equivalente,
        venta_antes: est.venta.equivalente, venta_despues: est.venta.equivalente - equivalente,
      };
      if (totalMxn > 0) this.emitir('cash.movement', { tienda: this.tienda, caja: this.caja, tipo: 'retiro', monto: totalMxn, moneda: 'MXN', fecha, retiro_id: d.retiro_id }, `retiro:${d.retiro_id}:mxn`);
      if (totalUsd > 0) this.emitir('cash.movement', { tienda: this.tienda, caja: this.caja, tipo: 'retiro', monto: totalUsd, moneda: 'USD', fecha, retiro_id: d.retiro_id }, `retiro:${d.retiro_id}:usd`);
      const op = this.emitir('cash.retiro', retiro, `retiro:${d.retiro_id}`);
      return { ...retiro, ocurrio_en: op.ocurrio_en };
    });
  }
  /** Estado de la feria (billetes y monedas de cambio) de esta caja hoy: estimado venta por venta y confirmado en el conteo del cierre. */
  estadoFeria(fecha = fechaLocal(this.ctx.reloj.now())): ReporteFeria {
    return estimarFeria(this.opsDe('cash.fondo', 'cash.arqueo', 'cash.conteo', 'cash.movement', 'cash.retiro', 'cash.ajuste_admin', 'sale.confirmed', 'sale.cancelled', 'return.registered'), this.tienda, this.caja, fecha);
  }
  /**
   * Avisa a Administración (op `caja.alerta_feria`) cuando la feria EMPEORA: de bien a bajo, de bajo a crítico o de bien a crítico. Mejorar o seguir igual no
   * repite el aviso; al recuperarse vuelve a poder avisar. Nunca interrumpe la operación de la caja.
   */
  revisarFeria(): void {
    try {
      const f = this.estadoFeria();
      if (f.estado === 'sin_dato') return;
      const rango = { bien: 0, bajo: 1, critico: 2, sin_dato: 0 } as const;
      // Un solo registro que se reescribe cada día: no se acumula nada de días anteriores.
      const previo = this.repo.kvGet<{ fecha: string; estado: string }>('feria:estado');
      const antes = (previo && previo.fecha === f.fecha ? previo.estado : 'bien') as keyof typeof rango;
      this.repo.kvSet('feria:estado', { fecha: f.fecha, estado: f.estado });
      if (rango[f.estado] > rango[antes]) this.emitir('caja.alerta_feria', { tienda: this.tienda, caja: this.caja, fecha: f.fecha, estado: f.estado, agotadas: f.agotadas, bajas: f.bajas });
    } catch { /* la feria es una ayuda: no debe frenar una venta */ }
  }
  /** Gastos de caja de una fecha en esta caja (los más recientes primero). */
  gastos(fecha: string): GastoRegistrado[] {
    return this.opsDe('cash.gasto').filter((o) => o.payload.tienda === this.tienda && o.payload.caja === this.caja && o.payload.fecha === fecha)
      .map((o) => ({ ...o.payload, ocurrio_en: o.ocurrio_en }) as GastoRegistrado).reverse();
  }
  /**
   * Gasto de caja: se paga con efectivo del cajón (por ejemplo al barrendero) y queda un recibo que firma quien recibe. Sin tope de monto; lo autoriza
   * otra persona o un supervisor con su clave (o, si no hay nadie más, quien cobra con la suya: `sin_segundo`). Resta del efectivo esperado del corte.
   * Reintentar con la misma referencia no lo duplica.
   */
  registrarGasto(d: { ref: string; monto: number; concepto: string; recibio: string; usuario: string; autoriza?: Autoriza }): GastoRegistrado {
    if (!d.ref) throw new ErrorDominio('DATOS_REQUERIDOS', 'falta la referencia del gasto');
    const previo = this.repo.getOp(`gasto:${d.ref}`);
    if (previo) return { ...previo.payload, ocurrio_en: previo.ocurrio_en } as GastoRegistrado;
    const concepto = String(d.concepto ?? '').trim().replace(/\s+/g, ' ');
    const recibio = String(d.recibio ?? '').trim().replace(/\s+/g, ' ');
    if (concepto.length < 3 || concepto.length > 80) throw new ErrorDominio('DATOS_REQUERIDOS', 'escriba en qué se gastó (de 3 a 80 caracteres)');
    if (recibio.length < 2 || recibio.length > 60) throw new ErrorDominio('DATOS_REQUERIDOS', 'escriba el nombre de quien recibe el dinero');
    if (!Number.isInteger(d.monto) || d.monto <= 0) throw new ErrorDominio('PAGO_INVALIDO', 'el monto es un entero positivo en centavos');
    const autorizo = this.verificarAutorizador(d.usuario, d.autoriza);
    const est = this.estadoRetiro();
    if (d.monto > est.en_cajon.mxn) throw new ErrorDominio('GASTO_EXCEDE_EFECTIVO', 'el gasto es mayor que los pesos que registra la caja', { pesos_en_cajon: est.en_cajon.mxn });
    return this.repo.tx(() => {
      const n = this.opsDe('cash.gasto').filter((o) => o.payload.tienda === this.tienda && o.payload.caja === this.caja).length + 1;
      const folio_gasto = `${this.tienda === 'DUO' ? 'D' : this.tienda === 'LON' ? 'L' : this.tienda.slice(0, 1)}${this.caja}-G${String(n).padStart(4, '0')}`;
      const g: Omit<GastoRegistrado, 'ocurrio_en'> = { gasto_id: d.ref, folio_gasto, tienda: this.tienda, caja: this.caja, fecha: est.fecha, monto: d.monto, concepto, recibio, usuario: d.usuario, autorizado_por: autorizo };
      this.emitir('cash.movement', { tienda: this.tienda, caja: this.caja, tipo: 'gasto', monto: d.monto, moneda: 'MXN', fecha: est.fecha, gasto_id: d.ref }, `gasto:${d.ref}:mov`);
      const op = this.emitir('cash.gasto', g, `gasto:${d.ref}`);
      return { ...g, ocurrio_en: op.ocurrio_en };
    });
  }
  /** Conteo físico por denominación (USD: billetes en dólares; MXN: billetes y monedas en centavos). El corte lo compara con lo esperado. */
  registrarConteo(d: { moneda: 'MXN' | 'USD'; denominaciones: Record<string, number>; usuario: string; alcance?: 'ventas' }) {
    let total: number;
    try { total = d.moneda === 'USD' ? totalDenominacionesUsd(d.denominaciones) : totalDenominacionesMxn(d.denominaciones); } catch (e) { throw new ErrorDominio('CONTEO_INVALIDO', (e as Error).message); }
    const fecha = fechaLocal(this.ctx.reloj.now());
    // `alcance: 'ventas'` = efectivo restante SIN el fondo (cierre guiado); sin alcance = cajón completo (conteos anteriores).
    if (d.alcance === 'ventas' && d.moneda === 'MXN' && !this.fondoDelDia(fecha)) throw new ErrorDominio('FONDO_PENDIENTE', 'primero cuente y confirme el fondo');
    this.emitir('cash.conteo', { tienda: this.tienda, caja: this.caja, moneda: d.moneda, denominaciones: d.denominaciones, total, usuario: d.usuario, fecha, ...(d.alcance && d.moneda === 'MXN' ? { alcance: d.alcance } : {}) });
    return { total };
  }
  registrarConteoUsd(d: { denominaciones: Record<string, number>; usuario: string }) {
    return this.registrarConteo({ moneda: 'USD', ...d });
  }
  /**
   * Procedimiento operativo: el cajero rechaza un billete dañado o sospechoso y se lo devuelve al cliente. El sistema NO detecta falsificaciones;
   * solo deja constancia (sin movimiento de dinero) para que Administración revise el patrón.
   */
  registrarBilleteRechazado(d: { denominacion: number; cantidad?: number; motivo: 'danado' | 'sospechoso'; nota?: string; usuario: string }) {
    if (!(DENOMINACIONES_USD as readonly number[]).includes(d.denominacion)) throw new ErrorDominio('CONTEO_INVALIDO', 'solo se manejan billetes de 1, 2, 5, 10, 20, 50 y 100 dólares');
    const cantidad = d.cantidad ?? 1;
    if (!Number.isInteger(cantidad) || cantidad < 1) throw new ErrorDominio('CONTEO_INVALIDO', 'la cantidad de billetes es un entero positivo');
    if (d.motivo !== 'danado' && d.motivo !== 'sospechoso') throw new ErrorDominio('DATOS_REQUERIDOS', 'indique si el billete está dañado o es sospechoso');
    this.emitir('cash.billete_rechazado', { tienda: this.tienda, caja: this.caja, moneda: 'USD', denominacion: d.denominacion, cantidad, motivo: d.motivo, nota: d.nota ?? '', usuario: d.usuario, fecha: fechaLocal(this.ctx.reloj.now()) });
  }
  /**
   * Pesos que se SABE que hay en el cajón: solo si hoy se registró un fondo inicial en pesos (saldo conciliado). Sin él, no se inventa:
   * `conocido` es false y no hay advertencia de cambio. Suma el libro de movimientos físicos del día.
   */
  efectivoMxnConocido(fecha = fechaLocal(this.ctx.reloj.now())): { conocido: boolean; disponible: number | null } {
    const mov = movimientosCaja(this.opsDe('sale.confirmed', 'sale.cancelled', 'return.registered', 'cash.movement', 'cash.ajuste_admin'), this.tienda, this.caja).filter((m) => m.fecha === fecha && m.moneda === 'MXN');
    const conocido = mov.some((m) => m.tipo === 'fondo_inicial');
    return { conocido, disponible: conocido ? mov.reduce((a, m) => a + m.monto, 0) : null };
  }
  /** Apertura del cajón sin venta (el pulso lo manda la impresora): queda registrada con quién, cuándo y si salió bien. */
  registrarAperturaCajon(d: { usuario: string; motivo?: string; resultado: 'ok' | 'error'; error?: string }) {
    this.emitir('cash.cajon_abierto', { tienda: this.tienda, caja: this.caja, usuario: d.usuario, motivo: (d.motivo ?? '').trim().slice(0, 60), resultado: d.resultado, ...(d.error ? { error: d.error } : {}), fecha: fechaLocal(this.ctx.reloj.now()) });
  }
  /** Corte "en vivo": se calcula SOLO con las operaciones de esta caja y refleja todo lo ocurrido hasta ahora. No se guarda. */
  corteEnVivo(fecha: string) {
    const ops = this.opsDe('sale.confirmed', 'sale.cancelled', 'sale.voided', 'return.registered', 'cash.movement', 'cash.ajuste_admin', 'cash.conteo', 'cash.billete_rechazado', 'cash.cajon_abierto');
    const propia = (t: string | null, c: number | null) => t === this.tienda && c === this.caja;
    const vs = [...ventas(ops).values()].filter((v) => propia(v.tienda, v.caja) && fechaLocal(v.ocurrio_en) === fecha);
    const confirmadas = vs.filter((v) => v.estado === 'confirmada');
    const devs = devoluciones(ops).filter((d) => propia(d.tienda, d.caja) && fechaLocal(d.ocurrio_en) === fecha);
    const suma = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
    const lineas = confirmadas.flatMap((v) => v.lineas);
    const mercancia = lineas.filter((l) => !l.tarjeta_regalo);
    const deTarjeta = lineas.filter((l) => l.tarjeta_regalo);
    const efectivoCobrado = suma(confirmadas.flatMap((v) => v.pagos.filter((p) => p.metodo === 'efectivo').map((p) => p.monto)));
    const tarjeta = suma(confirmadas.flatMap((v) => v.pagos.filter((p) => p.metodo === 'tarjeta').map((p) => p.monto)));
    const regalo = suma(confirmadas.flatMap((v) => v.pagos.filter((p) => p.metodo === 'tarjeta_regalo').map((p) => p.monto)));
    const creditoEmpleadas = suma(confirmadas.flatMap((v) => v.pagos.filter((p) => p.metodo === 'credito_empleada').map((p) => p.monto)));
    const pagosUsd = confirmadas.flatMap((v) => v.pagos.filter((p) => p.metodo === 'efectivo_usd'));
    const cobrosUsd = suma(pagosUsd.map((p) => p.monto));
    // Los dólares de una venta CANCELADA siguen físicamente en el cajón (el reembolso es en pesos): cuentan como recibidos.
    const pagosUsdFisicos = vs.flatMap((v) => v.pagos.filter((p) => p.metodo === 'efectivo_usd'));
    // ── Libro de movimientos físicos por moneda (inmutable): cada moneda se concilia POR SEPARADO ──
    const libro = movimientosCaja(ops, this.tienda, this.caja).filter((m) => m.fecha === fecha);
    const porMoneda = (moneda: 'MXN' | 'USD') => {
      const m = libro.filter((x) => x.moneda === moneda);
      const de = (tipo: string) => suma(m.filter((x) => x.tipo === tipo).map((x) => x.monto));
      const esperado = suma(m.map((x) => x.monto));
      const conteo = ops.filter((o) => o.tipo === 'cash.conteo' && propia(o.payload.tienda, o.payload.caja) && o.payload.fecha === fecha && o.payload.moneda === moneda).at(-1);
      // Un conteo «de ventas» (cierre guiado) no incluye el fondo: se compara con el esperado sin él. Los conteos anteriores eran del cajón completo.
      const deVentas = conteo?.payload.alcance === 'ventas';
      const comparable = deVentas ? esperado - de('fondo_inicial') : esperado;
      return {
        fondo: de('fondo_inicial'), cobros: de('cobro'), cambio: -de('cambio'), entradas: de('entrada'), ajustes: de('ajuste'), devoluciones: -de('devolucion'), cancelaciones: -de('cancelacion'), retiros: -de('retiro'), gastos: -de('gasto'),
        esperado,
        contado: conteo ? (conteo.payload.total as number) : null,
        diferencia: conteo ? (conteo.payload.total as number) - comparable : null,
        alcance: (deVentas ? 'ventas' : conteo ? 'cajon' : null) as 'ventas' | 'cajon' | null,
        desactualizado: conteo ? m.some((x) => x.ocurrio_en > conteo.ocurrio_en) : false,
        conteo: conteo ? { denominaciones: conteo.payload.denominaciones as Record<string, number>, usuario: conteo.payload.usuario as string, ocurrio_en: conteo.ocurrio_en } : null,
      };
    };
    const mxn = porMoneda('MXN');
    const usd = porMoneda('USD');
    const fondoDia = this.fondoDelDia(fecha);
    const refFondo = this.fondoReferencia(fecha);
    const usdRecibidos = usd.cobros;
    const usdEquivalenteHistorico = suma(pagosUsdFisicos.map((p) => p.equivalente!)); // contable: cada operación con SU tasa; NO es dinero físico
    const pesosConUsd = suma(pagosUsdFisicos.map((p) => p.pesos_recibidos!));
    const cambioConUsd = suma(pagosUsdFisicos.map((p) => p.cambio_mxn!));
    const reembolsos = suma(devs.map((d) => d.importe));
    // Cambios: lo recibido a cambio se aplica dentro de la venta nueva (no es dinero que sale); solo el saldo entregado en efectivo es un reembolso real.
    const devsCambio = devs.filter((d) => d.por_cambio);
    const reembolsadoEnCambios = suma(devsCambio.flatMap((d) => d.reembolsos.map((r) => r.monto)));
    const recibidaPorCambio = suma(devsCambio.map((d) => d.importe)) - reembolsadoEnCambios;
    const ventasDeCambio = new Set(devsCambio.map((d) => d.venta_cambio).filter(Boolean));
    const diferenciasCobradas = suma(confirmadas.filter((v) => ventasDeCambio.has(v.sale_id)).flatMap((v) => v.pagos.filter((p) => p.metodo !== 'credito_cambio').map((p) => p.monto)));
    const enReembolsos = (metodo: string) => suma(devs.flatMap((d) => d.reembolsos.filter((r) => r.metodo === metodo).map((r) => r.monto)));
    const cancelacionesPosteriores = vs.filter((v) => v.estado === 'cancelada');
    const anuladas = ops.filter((o) => o.tipo === 'sale.voided' && propia(o.payload.tienda, o.payload.caja) && fechaLocal(o.ocurrio_en) === fecha);
    const rechazados = ops.filter((o) => o.tipo === 'cash.billete_rechazado' && propia(o.payload.tienda, o.payload.caja) && o.payload.fecha === fecha);
    // Las devoluciones también consumen folio de la serie (P-08).
    const folios = [...vs.filter((v) => !v.serie).map((v) => v.folio), ...devs.map((d) => d.folio).filter((f): f is number => f != null)];
    const ventasMercancia = suma(mercancia.map((l) => l.importe));
    return {
      tienda: this.tienda, caja: this.caja, fecha, tickets: confirmadas.length,
      tickets_cancelados: cancelacionesPosteriores.length,
      // Distinción: anulada = antes de recibir dinero (sin movimiento físico); cancelada = después de recibir efectivo (el cobro queda y se suma la salida).
      ventas_anuladas_antes_de_cobro: anuladas.length, cancelaciones_posteriores_al_cobro: cancelacionesPosteriores.length,
      ventas_brutas: suma(mercancia.map((l) => l.qty * l.precio_unit)), descuentos: suma(mercancia.map((l) => l.descuento)),
      // "ventas" = todo lo que pasó por la caja con folio; "ventas_mercancia" excluye las tarjetas de regalo (son un pasivo, no ingreso por mercancía).
      ventas: suma(confirmadas.map((v) => v.total)), ventas_mercancia: ventasMercancia,
      tarjetas_regalo_vendidas: suma(deTarjeta.map((l) => l.importe)), tarjetas_regalo_vendidas_n: deTarjeta.length,
      devoluciones: reembolsos, devoluciones_en_efectivo: enReembolsos('efectivo'), devoluciones_a_tarjeta: enReembolsos('tarjeta'), devoluciones_a_tarjeta_regalo: enReembolsos('tarjeta_regalo'),
      mercancia_recibida_por_cambio: recibidaPorCambio, devoluciones_con_reembolso: reembolsos - recibidaPorCambio,
      diferencias_cobradas_en_cambios: diferenciasCobradas, diferencias_devueltas_en_cambios: reembolsadoEnCambios,
      folios_de_devolucion: devs.length,
      ventas_netas: ventasMercancia - reembolsos,
      cobros_efectivo: efectivoCobrado, cobros_tarjeta: tarjeta, cobros_tarjeta_regalo: regalo, ventas_a_credito_empleadas: creditoEmpleadas, fondo_inicial: mxn.fondo, entradas: mxn.entradas, retiros: mxn.retiros, gastos: mxn.gastos, arqueos: this.arqueos(fecha),
      // Pesos FÍSICOS en el cajón (libro MXN): cobros recibidos − cambio entregado + fondo + entradas − devoluciones − cancelaciones − retiros.
      efectivo_esperado: mxn.esperado,
      // Cierre guiado: efectivo de ventas esperado SIN el fondo, y el fondo fijo (autorizado, confirmado y composición). El fondo no es movimiento de efectivo.
      efectivo_ventas_esperado: mxn.esperado - mxn.fondo, ajustes_admin: mxn.ajustes,
      fondo_autorizado: this.fondoAutorizado(),
      fondo_confirmado: fondoDia ? fondoDia.total : null, fondo_estado: fondoDia ? fondoDia.estado : null, fondo_diferencia: fondoDia ? fondoDia.diferencia : null,
      fondo_nota: fondoDia ? fondoDia.nota : null, fondo_denominaciones: fondoDia ? fondoDia.denominaciones : null, fondo_referencia: refFondo,
      conteo_alcance: mxn.alcance, conteo_desactualizado: { mxn: mxn.desactualizado, usd: usd.desactualizado },
      // Dólares recibidos en efectivo: tickets, importe MXN que liquidan, y detalle físico.
      tickets_con_usd: pagosUsd.length, cobros_efectivo_usd: cobrosUsd, usd_recibidos: usdRecibidos, usd_equivalente_mxn_historico: usdEquivalenteHistorico,
      // Tipo de cambio: el de cada operación con dólares (agrupadas por tasa) y el vigente al cerrar; el equivalente en pesos de los dólares recibidos es la suma de cada operación con SU tasa.
      usd_por_tasa: [...pagosUsdFisicos.reduce((m, p) => { const k = `${p.tasa}|${p.tasa_version}`; const a = m.get(k) ?? { tasa: p.tasa!, version: p.tasa_version!, usd: 0, equivalente: 0 }; a.usd += p.usd ?? 0; a.equivalente += p.equivalente ?? 0; return m.set(k, a); }, new Map<string, { tasa: number; version: number; usd: number; equivalente: number }>()).values()],
      tipo_cambio: (() => { const tc = this.tipoCambio(); return tc ? { tasa: tc.tasa, version: tc.version } : null; })(),
      pesos_recibidos_con_usd: pesosConUsd, cambio_mxn_con_usd: cambioConUsd,
      fondo_inicial_usd: usd.fondo, entradas_usd: usd.entradas, retiros_usd: usd.retiros, efectivo_usd_esperado: usd.esperado,
      conteo_usd: usd.conteo ? { contado: usd.contado!, denominaciones: usd.conteo.denominaciones, usuario: usd.conteo.usuario, ocurrio_en: usd.conteo.ocurrio_en } : null,
      diferencia_usd: usd.diferencia,
      conteo_mxn: mxn.conteo ? { contado: mxn.contado!, denominaciones: mxn.conteo.denominaciones, usuario: mxn.conteo.usuario, ocurrio_en: mxn.conteo.ocurrio_en } : null,
      diferencia_mxn: mxn.diferencia,
      // Detalle por moneda para Administración (columnas separadas). `usd.equivalente_historico_mxn` es contable, no dinero físico.
      mxn, usd: { ...usd, equivalente_historico_mxn: usdEquivalenteHistorico },
      billetes_usd_rechazados: suma(rechazados.map((o) => o.payload.cantidad as number)),
      aperturas_cajon_sin_venta: ops.filter((o) => o.tipo === 'cash.cajon_abierto' && propia(o.payload.tienda, o.payload.caja) && o.payload.fecha === fecha && o.payload.resultado === 'ok').length,
      folio_inicial: folios.length ? Math.min(...folios) : null, folio_final: folios.length ? Math.max(...folios) : null,
      perdida_documental_abierta: this.perdidasDocumentalesAbiertas().map((x) => x.perdida_id),
    };
  }
  /** Qué falta para cerrar el corte: fondo confirmado, conteo de pesos (sin fondo) y, si hubo dólares, su conteo; todos vigentes. */
  estadoCierre(fecha: string) {
    const v = this.corteEnVivo(fecha);
    const cerrado = this.corteAlDia(fecha, v);
    const usdRequerido = v.usd.cobros !== 0 || v.usd.esperado !== 0 || v.usd.contado !== null;
    const faltan: string[] = [];
    if (v.fondo_confirmado === null) faltan.push('fondo');
    else {
      // Con un cierre anterior del día, el fondo se vuelve a contar y confirmar: la feria y los billetes ya no son los mismos.
      const previo = this.corteVigente(fecha), fondo = this.fondoDelDia(fecha);
      if (previo && fondo && fondo.ocurrio_en <= previo.ocurrio_en) faltan.push('fondo');
    }
    if (v.conteo_alcance !== 'ventas') faltan.push('conteo_ventas');
    else if (v.conteo_desactualizado.mxn) faltan.push('recontar_ventas');
    if (usdRequerido) { if (v.usd.contado === null) faltan.push('conteo_usd'); else if (v.conteo_desactualizado.usd) faltan.push('recontar_usd'); }
    return { cerrado, usd_requerido: usdRequerido, faltan, puede_cerrar: !cerrado && faltan.length === 0 };
  }
  /** Cierres del día en orden (el primero conserva el identificador de siempre; los siguientes llevan un número). */
  cortesDelDia(fecha: string): Op[] {
    const r: Op[] = [];
    for (let n = 1; ; n++) {
      const o = this.repo.getOp(n === 1 ? `corte:${this.id}:${fecha}` : `corte:${this.id}:${fecha}:${n}`);
      if (!o) return r;
      r.push(o);
    }
  }
  /** El cierre vigente del día (el último) o null. */
  corteVigente(fecha: string): Op | null {
    return this.cortesDelDia(fecha).at(-1) ?? null;
  }
  /** ¿El día está cerrado Y sin operaciones posteriores al último cierre? Con operaciones nuevas el corte se vuelve a abrir: se puede cerrar otra vez con todo el día. */
  corteAlDia(fecha: string, vivo: ReturnType<Caja['corteEnVivo']> = this.corteEnVivo(fecha)): boolean {
    const o = this.corteVigente(fecha);
    if (!o) return false;
    const sinDatosDelCierre = (c: any) => { const { cerrado_por: _a, observaciones: _b, cierres_previos: _c, ...resto } = c ?? {}; return resto; };
    return JSON.stringify(sinDatosDelCierre(o.payload)) === JSON.stringify(sinDatosDelCierre(vivo));
  }
  /**
   * Cierra el corte del día con el flujo guiado: exige los conteos al día y la clave de quien cierra; guarda observaciones y quién cerró.
   * Se puede cerrar más de una vez al día: el nuevo cierre cubre TODO el día y lleva una nota por cada cierre anterior (hora, venta de ese momento y que se confirmó el fondo).
   */
  cerrarCorteGuiado(fecha: string, d: { usuario: string; clave?: string; observaciones?: string }) {
    const previos = this.cortesDelDia(fecha);
    if (previos.length && this.corteAlDia(fecha)) return previos.at(-1)!.payload as ReturnType<Caja['corteEnVivo']>;
    const est = this.estadoCierre(fecha);
    if (!est.puede_cerrar) {
      const texto: Record<string, string> = { fondo: 'confirme el fondo', conteo_ventas: 'cuente el efectivo de ventas', recontar_ventas: 'hubo movimientos después del conteo de pesos: vuelva a contar', conteo_usd: 'cuente los dólares', recontar_usd: 'hubo movimientos después del conteo de dólares: vuelva a contar' };
      throw new ErrorDominio('CIERRE_INCOMPLETO', `no se puede cerrar el corte: ${est.faltan.map((f) => texto[f]).join('; ')}`, { faltan: est.faltan });
    }
    if (this.controlesConClave()) this.verificarClaveCajero(d.usuario, String(d.clave ?? ''));
    const cierres_previos = previos.map((o) => ({ cerrado_en: o.ocurrio_en, cerrado_por: (o.payload.cerrado_por as string | undefined) ?? '', ventas: o.payload.ventas_mercancia as number, fondo_confirmado: o.payload.fondo_confirmado !== null && o.payload.fondo_confirmado !== undefined, fondo_estado: (o.payload.fondo_estado as string | null) ?? null, fondo_diferencia: (o.payload.fondo_diferencia as number | null) ?? 0 }));
    const corte = { ...this.corteEnVivo(fecha), cerrado_por: d.usuario, observaciones: String(d.observaciones ?? '').trim().slice(0, 500), ...(cierres_previos.length ? { cierres_previos } : {}) };
    this.emitir('corte.generado', corte, previos.length ? `corte:${this.id}:${fecha}:${previos.length + 1}` : `corte:${this.id}:${fecha}`);
    return corte;
  }
  /** Cierre del corte del día: se guarda UNA vez por caja y fecha; llamarlo otra vez devuelve el ya guardado. */
  generarCorte(fecha: string) {
    const previo = this.corteVigente(fecha);
    if (previo) return previo.payload as ReturnType<Caja['corteEnVivo']>;
    const corte = this.corteEnVivo(fecha);
    this.emitir('corte.generado', corte, `corte:${this.id}:${fecha}`);
    return corte;
  }
}
