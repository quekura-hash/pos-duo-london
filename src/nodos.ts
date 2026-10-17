import { ErrorDominio } from './errores.ts';
import type { Politicas } from './politicas.ts';
import { catalogo, devoluciones, devueltoPorLinea, existenciaVerificada, intentos, perdidasDocumentales, stock, ventas, type Devolucion, type ExistenciaVerificada, type Intento, type PerdidaDocumental } from './proyecciones.ts';
import type { Repo } from './repo.ts';
import { validarOpEntrante } from './reglas.ts';
import type { Articulo, CajaCfg, Linea, Op, Pago, Venta } from './tipos.ts';
import { crearOp, fechaLocal, uuid } from './util.ts';

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
  /** Arbitraje del hub sobre existencias. null = el hub no respondió. Idempotente por `ref`. */
  reservar(ref: string, caja: number, lineas: { item_id: string; qty: number }[]): ResultadoReserva | null;
  liberar(ref: string): void;
}

export interface ResultadoReserva {
  ok: boolean;
  motivo?: string;
  /** Artículos con existencia insuficiente que se concedieron de todos modos (P-02=permitir_y_conciliar). */
  sobreventa?: string[];
  faltantes?: string[];
  idempotente?: boolean;
}

interface Reserva {
  ref: string;
  caja: number;
  lineas: { item_id: string; qty: number }[];
  hasta: number;
  estado: 'abierta' | 'cerrada' | 'liberada';
  resultado: ResultadoReserva;
}

const BROADCAST_TIENDA = new Set(['inv.movement', 'inv.conteo', 'inv.verificacion_pendiente', 'doc.perdida_posible', 'item.created', 'item.item_no_assigned']);
// Lo que el central baja a hubs y cajas (catálogo y resoluciones administrativas).
const CATALOGO = new Set(['item.created', 'item.item_no_assigned', 'item.codigo_corregido', 'doc.perdida_resuelta']);

// ───────────────────────────── Hub ─────────────────────────────

export class Hub {
  readonly id: string;
  readonly tienda: string;
  readonly repo: Repo;
  readonly ctx: Ctx;
  constructor(tienda: string, repo: Repo, ctx: Ctx) {
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
      if (desde.startsWith('caja:')) {
        this.repo.encolar(op.op_id, 'central');
        if (BROADCAST_TIENDA.has(op.tipo)) {
          for (const n of this.cajasDeTienda()) if (`caja:${this.tienda}/${n}` !== desde) this.repo.encolar(op.op_id, `caja:${this.tienda}/${n}`);
        }
      } else if (desde === 'central' && CATALOGO.has(op.tipo)) {
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
  reservar(ref: string, caja: number, lineas: { item_id: string; qty: number }[]): ResultadoReserva {
    const ahora = Date.parse(this.ctx.reloj.now());
    const previa = this.reservas().find((r) => r.ref === ref);
    // Solo se repite la respuesta de lo que sigue vigente (reserva abierta o ya consumida por su venta).
    // Un rechazo, una liberación o una vigencia vencida se vuelven a evaluar: reintentar no hereda un "no" viejo
    // ni un "sí" que ya no aparta existencia.
    if (previa && (previa.estado === 'cerrada' || (previa.estado === 'abierta' && previa.hasta > ahora))) return { ...previa.resultado, idempotente: true };
    const todas = this.reservas().filter((r) => r.ref !== ref);
    const abiertas = todas.filter((r) => r.estado === 'abierta' && r.hasta > ahora);
    const saldo = stock(this.repo.ops(), this.tienda);
    const pedido = new Map<string, number>();
    for (const l of lineas) pedido.set(l.item_id, (pedido.get(l.item_id) ?? 0) + l.qty);
    const faltantes: string[] = [];
    for (const [item, q] of pedido) {
      const apartado = abiertas.reduce((a, r) => a + r.lineas.filter((l) => l.item_id === item).reduce((b, l) => b + l.qty, 0), 0);
      if ((saldo.get(item) ?? 0) - apartado < q) faltantes.push(item);
    }
    if (faltantes.length && this.ctx.politicas.P02_existencia_insuficiente === 'bloquear') {
      this.repo.kvSet('reservas', todas); // un rechazo no se guarda
      return { ok: false, motivo: 'existencia_insuficiente', faltantes };
    }
    const resultado: ResultadoReserva = faltantes.length ? { ok: true, sobreventa: faltantes } : { ok: true };
    this.repo.kvSet('reservas', [...todas, { ref, caja, lineas: [...pedido].map(([item_id, qty]) => ({ item_id, qty })), hasta: ahora + this.ctx.ttlReservaMs, estado: 'abierta' as const, resultado }]);
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
      return lineas.length ? { ...r, lineas } : { ...r, lineas, estado: 'cerrada' as const };
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
    for (const o of this.repo.ops()) if (o.tipo === 'sale.confirmed' && o.payload.tienda === this.tienda && o.payload.caja === caja) m = Math.max(m, o.payload.folio);
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
  emitirAdmin(tipo: string, payload: unknown): Op {
    const op = crearOp(tipo, null, null, this.id, this.ctx.reloj.now(), payload);
    this.repo.tx(() => {
      this.repo.appendOp(op);
      for (const t of this.ctx.tiendas) this.repo.encolar(op.op_id, `hub:${t}`);
    });
    return op;
  }

  anclas(tienda: string, caja: number): Anclas {
    let ceiling: number | null = null;
    let hwm = 0;
    for (const o of this.repo.ops()) {
      if (o.tipo === 'folio.lease_granted' && o.payload.tienda === tienda && o.payload.caja === caja) ceiling = Math.max(ceiling ?? 0, o.payload.techo);
      if (o.tipo === 'sale.confirmed' && o.payload.tienda === tienda && o.payload.caja === caja) hwm = Math.max(hwm, o.payload.folio);
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

interface Carrito {
  id: string;
  lineas: Linea[];
  estado: 'abierto' | 'confirmado';
  intent_id?: string;
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

  constructor(tienda: string, caja: number, repo: Repo, ctx: Ctx, enlace: Enlace, opts: { restaurado?: 'disco_nuevo' | 'respaldo' } = {}) {
    this.tienda = tienda;
    this.caja = caja;
    this.id = `${tienda}/${caja}`;
    this.nodoId = `caja:${this.id}`;
    this.repo = repo;
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
  atestarSiguienteFolio(a: { siguiente: number; usuario: string; evidencia: { tipo: string; referencia: string }; sinAnclasConfirmado?: boolean }) {
    const st = this.estadoFolios();
    if (st.estado === 'activa') throw new ErrorDominio('FOLIO_ACTIVO', 'no hay recuperación pendiente');
    if (!a.evidencia?.referencia?.trim()) throw new ErrorDominio('EVIDENCIA_REQUERIDA', 'se requiere una referencia a evidencia física');
    const an = this.enlace.anclasFolios();
    if (!an && !a.sinAnclasConfirmado) {
      throw new ErrorDominio('EVIDENCIA_INSUFICIENTE', 'sin acceso a hub/central no se puede contrastar el folio; confirmar explícitamente que se atesta sin anclas');
    }
    const conocido = Math.max(st.ultimo, an?.hwm ?? 0, an?.ceiling ?? 0);
    if (a.siguiente <= conocido) throw new ErrorDominio('FOLIO_REUTILIZABLE', `el folio ${a.siguiente} no supera lo conocido (${conocido})`);
    this.repo.tx(() => {
      this.emitir('folio.atestacion_manual', {
        tienda: this.tienda, caja: this.caja, siguiente: a.siguiente, usuario: a.usuario, evidencia: a.evidencia,
        verificable: false, hwm_conocido: conocido, anclas_disponibles: an !== null,
      });
      if (a.siguiente - 1 > conocido) this.emitir('folio.gap', { tienda: this.tienda, caja: this.caja, desde: conocido + 1, hasta: a.siguiente - 1, motivo: 'atestacion_manual' });
      this.repo.kvSet('folio:ultimo', a.siguiente - 1);
      this.repo.kvSet('folio:techo', this.arrendamientoActivo() ? a.siguiente - 1 : null);
      this.repo.kvSet('folio:estado', 'activa');
      this.repo.kvSet('folio:motivo', null);
    });
    this.renovarSiHaceFalta();
  }

  /** Cerco: un ticket de esta serie con folio mayor al contador prueba que el contador está atrasado. */
  registrarTicketEscaneado(t: { tienda: string; caja: number; folio: number }) {
    if (t.tienda !== this.tienda || t.caja !== this.caja) return { ok: true };
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
  stockLocal(itemId: string): number {
    return stock(this.ops(), this.tienda).get(itemId) ?? 0;
  }
  recibir(op: Op, _desde: string): void {
    if (this.repo.tieneOp(op.op_id)) return;
    this.repo.appendOp(op);
  }

  // ── catálogo y altas (incluye alta sin internet) ──
  buscarPorCodigo(codigo: string): Articulo[] {
    return [...catalogo(this.ops()).values()].filter((a) => a.codigo === codigo);
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
    return perdidasDocumentales(this.ops()).filter((p) => p.estado === 'abierta' && p.tienda === this.tienda && (p.caja === this.caja || p.caja === null));
  }
  existenciaVerificada(itemId: string): ExistenciaVerificada {
    return existenciaVerificada(this.ops(), this.tienda, itemId);
  }
  articulosNoVerificados(): string[] {
    const ops = this.ops();
    return [...catalogo(ops).values()].filter((a) => !existenciaVerificada(ops, this.tienda, a.item_id).verificada).map((a) => a.item_id);
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
    return c;
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
    const r = this.buscarPorCodigo(cod);
    if (r.length === 0) return { resultado: 'no_encontrado', codigo: cod };
    if (r.length > 1) return { resultado: 'ambiguo', codigo: cod, candidatos: r.map((a) => ({ item_id: a.item_id, item_no: a.item_no, marca: a.marca, descripcion: a.descripcion, estilo: a.estilo, lote: a.lote })) };
    const art = r[0]!;
    // Mismo artículo, sin precio ni descuento editados: se suma una pieza a la línea existente.
    const existente = c.lineas.find((x) => x.item_id === art.item_id && x.precio_unit === art.precio && x.descuento === 0);
    if (existente) return { resultado: 'cantidad_incrementada', linea: this.cambiarCantidad(cartId, existente.linea_id, existente.qty + 1) };
    return { resultado: 'agregado', linea: this.agregarLinea(cartId, { item_id: art.item_id, qty: 1 }) };
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
    this.repo.kvSet(`cart:${cartId}`, c);
    return l;
  }
  quitarLinea(cartId: string, lineaId: string): void {
    const c = this.cartGet(cartId);
    this.exigirAbierto(c);
    this.exigirSinCobroPendiente(c);
    if (!c.lineas.some((x) => x.linea_id === lineaId)) throw new ErrorDominio('LINEA_INEXISTENTE', lineaId);
    c.lineas = c.lineas.filter((x) => x.linea_id !== lineaId);
    this.repo.kvSet(`cart:${cartId}`, c);
  }
  /** Búsqueda por código exacto, Item # exacto o texto en marca, descripción, estilo y lote. */
  buscar(texto: string, limite = 20): Articulo[] {
    const q = texto.trim();
    if (!q) return [];
    const norm = (s: string) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
    const nq = norm(q);
    const todos = [...catalogo(this.ops()).values()];
    const exactos = todos.filter((a) => a.codigo === q || a.item_no === q);
    const texto_ = todos.filter((a) => !exactos.includes(a) && norm(`${a.marca} ${a.descripcion} ${a.estilo} ${a.lote}`).includes(nq));
    return [...exactos, ...texto_].slice(0, limite);
  }
  agregarLinea(cartId: string, l: { codigo?: string; item_id?: string; qty: number; precio_unit?: number; descuento?: number }): Linea {
    const c = this.cartGet(cartId);
    this.exigirAbierto(c);
    this.exigirSinCobroPendiente(c);
    let art: Articulo | undefined;
    if (l.item_id) art = catalogo(this.ops()).get(l.item_id);
    else {
      const r = this.buscarPorCodigo(l.codigo!);
      if (r.length > 1) throw new ErrorDominio('CODIGO_AMBIGUO', `el código ${l.codigo} corresponde a ${r.length} artículos`, r.map((a) => a.item_id));
      art = r[0];
    }
    if (!art) throw new ErrorDominio('ARTICULO_INEXISTENTE', String(l.codigo ?? l.item_id));
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
    this.repo.tx(() => {
      this.repo.kvSet(`cart:${cartId}`, c);
    });
    return linea;
  }

  // ── cobro en efectivo / mixto ──
  private exigirSinCobroPendiente(c: Carrito) {
    if (!c.intent_id) return;
    const i = intentos(this.ops()).get(c.intent_id);
    if (i && (i.estado === 'iniciado' || i.estado === 'desconocido')) {
      throw new ErrorDominio('COBRO_PENDIENTE', `este carrito tiene un cobro con tarjeta sin conciliar (${i.estado})`, i);
    }
  }
  private validarPagos(pagos: Pago[], total: number) {
    for (const p of pagos) {
      if (!this.cfg.metodos.includes(p.metodo)) {
        throw new ErrorDominio('PAGO_NO_PERMITIDO', `la caja ${this.id} no admite ${p.metodo}`);
      }
      if (!Number.isInteger(p.monto) || p.monto <= 0) throw new ErrorDominio('PAGO_INVALIDO', 'monto inválido');
    }
    if (pagos.reduce((a, p) => a + p.monto, 0) !== total) throw new ErrorDominio('PAGO_INVALIDO', 'los pagos no suman el total');
  }

  cobrar(cartId: string, pagos: Pago[], cajero = 'cajero'): Venta {
    const previa = this.repo.getOp(`sale:${cartId}`);
    if (previa) return ventas([previa]).get(cartId)!; // doble clic / reintento: misma venta, mismo folio
    const c = this.cartGet(cartId);
    this.exigirSinCobroPendiente(c);
    const hubOk = this.enlace.hubAlcanzable();
    if (!hubOk && this.ctx.politicas.P01_hub_no_disponible === 'bloquear_ventas_nuevas') {
      throw new ErrorDominio('VENTA_BLOQUEADA', 'hub no disponible (P-01 en ensayo: bloquear_ventas_nuevas); el carrito se conserva');
    }
    if (c.lineas.length === 0) throw new ErrorDominio('CARRITO_VACIO', cartId);
    const total = c.lineas.reduce((a, l) => a + l.importe, 0);
    this.validarPagos(pagos, total);
    if (pagos.some((p) => p.metodo === 'tarjeta')) {
      // Un cobro con tarjeta solo entra por un intento persistido y resuelto (iniciarCobroTarjeta/resolverIntento).
      throw new ErrorDominio('TARJETA_REQUIERE_INTENTO', 'el cobro con tarjeta debe pasar por un intento registrado antes de usar la terminal');
    }
    // Existencia marcada no verificada: ALTERNATIVA DE ENSAYO (P-14), no una política aprobada.
    const noVerificados = [...new Set(c.lineas.map((l) => l.item_id))].filter((id) => !this.existenciaVerificada(id).verificada);
    if (noVerificados.length && this.ctx.politicas.P14_venta_con_inventario_no_verificado === 'bloquear_articulo_no_verificado') {
      throw new ErrorDominio('INVENTARIO_NO_VERIFICADO', `existencia no verificada de ${noVerificados.join(', ')} (P-14 en ensayo)`, noVerificados);
    }
    // Arbitraje: con hub, la existencia la concede el hub (serializa a las dos cajas); sin hub, rige la vista local.
    let reservado = false;
    let avisos: string[] = noVerificados.map((i) => `inventario_no_verificado:${i}`);
    if (hubOk) {
      const r = this.enlace.reservar(c.id, this.caja, c.lineas.map((l) => ({ item_id: l.item_id, qty: l.qty })));
      if (r === null) {
        if (this.ctx.politicas.P01_hub_no_disponible === 'bloquear_ventas_nuevas') throw new ErrorDominio('VENTA_BLOQUEADA', 'el hub dejó de responder durante la venta');
        this.exigirExistenciaLocal(c);
      } else if (!r.ok) {
        throw new ErrorDominio('SIN_EXISTENCIA', `el hub no concede existencia de ${(r.faltantes ?? []).join(', ')}`, r);
      } else {
        reservado = true;
        avisos = [...avisos, ...(r.sobreventa ?? []).map((i) => `sobreventa:${i}`)];
      }
    } else {
      this.exigirExistenciaLocal(c);
    }
    try {
      this.renovarSiHaceFalta();
      const v = this.confirmar(c, pagos, cajero);
      return avisos.length ? { ...v, avisos } : v;
    } catch (e) {
      if (reservado) this.enlace.liberar(c.id);
      throw e;
    }
  }

  private exigirExistenciaLocal(c: Carrito) {
    if (this.ctx.politicas.P02_existencia_insuficiente !== 'bloquear') return;
    const st = stock(this.ops(), this.tienda);
    const pedido = new Map<string, number>();
    for (const l of c.lineas) pedido.set(l.item_id, (pedido.get(l.item_id) ?? 0) + l.qty);
    for (const [item, q] of pedido) if ((st.get(item) ?? 0) < q) throw new ErrorDominio('SIN_EXISTENCIA', `existencia insuficiente de ${item}`);
  }

  /** Cobro en efectivo MXN con recibido y cambio. El importe aplicado (y lo que cuenta en el corte) es el total, no lo recibido. */
  cobrarEfectivo(cartId: string, recibido: number, cajero = 'cajero'): Venta {
    const previa = this.repo.getOp(`sale:${cartId}`);
    if (previa) return ventas([previa]).get(cartId)!;
    const c = this.cartGet(cartId);
    const total = c.lineas.reduce((a, l) => a + l.importe, 0);
    if (!Number.isInteger(recibido) || recibido < total) {
      throw new ErrorDominio('EFECTIVO_INSUFICIENTE', `el efectivo recibido no cubre el total`, { recibido, total });
    }
    return this.cobrar(cartId, [{ metodo: 'efectivo', monto: total, recibido, cambio: recibido - total }], cajero);
  }

  /** Bitácora de impresión: una falla de impresora nunca duplica ni revierte la venta. */
  registrarImpresion(d: { sale_id: string; tipo: 'original' | 'reimpresion'; resultado: 'ok' | 'error'; error?: string; usuario: string }): Op {
    const v = ventas(this.ops()).get(d.sale_id);
    if (!v || v.tienda !== this.tienda || v.caja !== this.caja) throw new ErrorDominio('PROHIBIDO', 'solo se imprimen ventas de la propia caja');
    return this.emitir('ticket.impresion', { ...d, tienda: this.tienda, caja: this.caja, folio: v.folio });
  }
  impresionesDe(saleId: string) {
    return this.ops().filter((o) => o.tipo === 'ticket.impresion' && o.payload.sale_id === saleId).map((o) => ({ ...o.payload, ocurrio_en: o.ocurrio_en }));
  }

  /** Una sola transacción: folio + venta + movimientos + cola de salida. Todo o nada. */
  private confirmar(c: Carrito, pagos: Pago[], cajero: string): Venta {
    const total = c.lineas.reduce((a, l) => a + l.importe, 0);
    return this.repo.tx(() => {
      const folio = this.siguienteFolio();
      this.ctx.fallo?.('tras_folio');
      const op = this.emitir('sale.confirmed', {
        sale_id: c.id, tienda: this.tienda, caja: this.caja, folio, cajero, lineas: c.lineas, total, pagos,
      }, `sale:${c.id}`);
      this.ctx.fallo?.('tras_venta');
      for (const l of c.lineas) {
        this.emitir('inv.movement', { item_id: l.item_id, tienda: this.tienda, delta: -l.qty, tipo: 'venta', doc: c.id, caja: this.caja }, `mov:${c.id}:${l.linea_id}`);
      }
      this.ctx.fallo?.('tras_movimientos');
      this.repo.kvSet(`cart:${c.id}`, { ...c, estado: 'confirmado' });
      return ventas([op]).get(c.id)!;
    });
  }

  cancelarVenta(saleId: string, motivo: string) {
    const v = ventas(this.ops()).get(saleId);
    if (!v || v.tienda !== this.tienda || v.caja !== this.caja) throw new ErrorDominio('PROHIBIDO', 'solo se cancelan ventas de la propia caja');
    if (v.estado === 'cancelada') return v;
    this.repo.tx(() => {
      this.emitir('sale.cancelled', { sale_id: saleId, motivo }, `cancel:${saleId}`);
      for (const l of v.lineas) this.emitir('inv.movement', { item_id: l.item_id, tienda: this.tienda, delta: l.qty, tipo: 'cancelacion', doc: saleId, caja: this.caja }, `mov:cancel:${saleId}:${l.linea_id}`);
    });
    return ventas(this.ops()).get(saleId)!;
  }

  // ── tarjeta: intento persistido antes de usar la terminal ──
  iniciarCobroTarjeta(cartId: string, importe?: number) {
    if (!this.cfg.metodos.includes('tarjeta')) throw new ErrorDominio('PAGO_NO_PERMITIDO', `la caja ${this.id} no admite tarjeta`);
    if (this.repo.tieneOp(`sale:${cartId}`)) throw new ErrorDominio('VENTA_YA_CONFIRMADA', cartId);
    const c = this.cartGet(cartId);
    const todos = [...intentos(this.ops()).values()].filter((i) => i.tienda === this.tienda && i.caja === this.caja);
    const abierto = todos.find((i) => i.cart_id === cartId && (i.estado === 'iniciado' || i.estado === 'desconocido'));
    // Nunca se genera un segundo cobro para el mismo carrito mientras haya uno sin conciliar.
    if (abierto) return { intento: abierto, reutilizado: true, avisos: [] as string[] };
    const otros = todos.filter((i) => i.cart_id !== cartId && (i.estado === 'iniciado' || i.estado === 'desconocido'));
    if (otros.length > 0 && this.ctx.politicas.P12_tarjeta_con_pendiente === 'bloquear_solo_tarjeta') {
      throw new ErrorDominio('TARJETA_BLOQUEADA', 'hay un cobro con tarjeta pendiente de conciliar (P-12 en ensayo); efectivo y devoluciones siguen disponibles');
    }
    const total = c.lineas.reduce((a, l) => a + l.importe, 0);
    const intent_id = uuid();
    this.repo.tx(() => {
      this.emitir('card.intent', { intent_id, cart_id: cartId, tienda: this.tienda, caja: this.caja, importe: importe ?? total }, `intent:${intent_id}`);
      this.repo.kvSet(`cart:${cartId}`, { ...c, intent_id });
    });
    return { intento: intentos(this.ops()).get(intent_id)!, reutilizado: false, avisos: otros.length ? ['hay_otros_cobros_pendientes'] : [] };
  }

  pendientesDeConciliar(): Intento[] {
    return [...intentos(this.ops()).values()].filter((i) => i.tienda === this.tienda && i.caja === this.caja && (i.estado === 'iniciado' || i.estado === 'desconocido'));
  }

  resolverIntento(intentId: string, r: { resultado: 'aprobado' | 'no_cobrado' | 'desconocido'; autorizacion?: string; marca?: string; ultimos4?: string; efectivo_adicional?: number }, cajero = 'cajero'): Venta | null {
    const i = intentos(this.ops()).get(intentId);
    if (!i || i.tienda !== this.tienda || i.caja !== this.caja) throw new ErrorDominio('INTENTO_INEXISTENTE', intentId);
    if (i.estado === 'aprobado') {
      if (r.resultado !== 'aprobado') throw new ErrorDominio('INTENTO_CERRADO', 'el cobro ya fue aprobado');
      return ventas(this.ops()).get(i.cart_id) ?? null; // idempotente
    }
    if (i.estado === 'no_cobrado') {
      if (r.resultado === 'no_cobrado') return null;
      throw new ErrorDominio('INTENTO_CERRADO', 'el intento ya se cerró como no cobrado');
    }
    const c = this.cartGet(i.cart_id);
    if (r.resultado === 'aprobado') {
      if (!r.autorizacion) throw new ErrorDominio('DATOS_REQUERIDOS', 'falta autorización del comprobante');
      const total = c.lineas.reduce((a, l) => a + l.importe, 0);
      const extra = r.efectivo_adicional ?? 0;
      if (i.importe + extra !== total) throw new ErrorDominio('PAGO_INVALIDO', 'tarjeta + efectivo no suman el total');
      const pagos: Pago[] = [{ metodo: 'tarjeta', monto: i.importe, autorizacion: r.autorizacion, marca: r.marca, ultimos4: r.ultimos4 }];
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

  // ── devoluciones ──
  devolver(d: { sale_id: string; renglones: { linea_id: string; qty: number }[]; motivo: string; devolucion_id?: string; ventaSnapshot?: Venta; cajero?: string }): Devolucion {
    const id = d.devolucion_id ?? uuid();
    const previa = this.repo.getOp(`ret:${id}`);
    if (previa) return { ...previa.payload, ocurrio_en: previa.ocurrio_en };
    const local = this.ops();
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
    const importe = lineas.reduce((a, l) => a + l.importe, 0);
    const payload = {
      devolucion_id: id, sale_id: d.sale_id, tienda: this.tienda, caja: this.caja,
      tienda_origen: venta.tienda, caja_origen: venta.caja, folio_origen: venta.folio,
      lineas, importe, metodo: 'efectivo' as const, motivo: d.motivo, cajero: d.cajero ?? 'cajero', verificacion,
    };
    const op = this.repo.tx(() => {
      const o = this.emitir('return.registered', payload, `ret:${id}`);
      for (const l of lineas) this.emitir('inv.movement', { item_id: l.item_id, tienda: this.tienda, delta: l.qty, tipo: 'devolucion', doc: id, caja: this.caja }, `mov:${id}:${l.linea_id}`);
      return o;
    });
    return { ...payload, ocurrio_en: op.ocurrio_en };
  }

  // ── efectivo y corte (solo con datos de ESTA caja) ──
  movimientoEfectivo(tipo: 'fondo_inicial' | 'retiro' | 'entrada', monto: number) {
    this.emitir('cash.movement', { tienda: this.tienda, caja: this.caja, tipo, monto, fecha: fechaLocal(this.ctx.reloj.now()) });
  }
  /** Corte "en vivo": se calcula SOLO con las operaciones de esta caja y refleja todo lo ocurrido hasta ahora. No se guarda. */
  corteEnVivo(fecha: string) {
    const ops = this.ops();
    const propia = (t: string | null, c: number | null) => t === this.tienda && c === this.caja;
    const vs = [...ventas(ops).values()].filter((v) => propia(v.tienda, v.caja) && fechaLocal(v.ocurrio_en) === fecha);
    const confirmadas = vs.filter((v) => v.estado === 'confirmada');
    const devs = devoluciones(ops).filter((d) => propia(d.tienda, d.caja) && fechaLocal(d.ocurrio_en) === fecha);
    const mov = ops.filter((o) => o.tipo === 'cash.movement' && propia(o.payload.tienda, o.payload.caja) && o.payload.fecha === fecha).map((o) => o.payload);
    const suma = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
    const lineas = confirmadas.flatMap((v) => v.lineas);
    const efectivoCobrado = suma(confirmadas.flatMap((v) => v.pagos.filter((p) => p.metodo === 'efectivo').map((p) => p.monto)));
    const tarjeta = suma(confirmadas.flatMap((v) => v.pagos.filter((p) => p.metodo === 'tarjeta').map((p) => p.monto)));
    const fondo = suma(mov.filter((m) => m.tipo === 'fondo_inicial').map((m) => m.monto));
    const entradas = suma(mov.filter((m) => m.tipo === 'entrada').map((m) => m.monto));
    const retiros = suma(mov.filter((m) => m.tipo === 'retiro').map((m) => m.monto));
    const reembolsos = suma(devs.map((d) => d.importe));
    const folios = vs.map((v) => v.folio);
    return {
      tienda: this.tienda, caja: this.caja, fecha, tickets: confirmadas.length,
      tickets_cancelados: vs.length - confirmadas.length,
      ventas_brutas: suma(lineas.map((l) => l.qty * l.precio_unit)), descuentos: suma(lineas.map((l) => l.descuento)),
      ventas: suma(confirmadas.map((v) => v.total)), devoluciones: reembolsos,
      ventas_netas: suma(confirmadas.map((v) => v.total)) - reembolsos,
      cobros_efectivo: efectivoCobrado, cobros_tarjeta: tarjeta, fondo_inicial: fondo, entradas, retiros,
      efectivo_esperado: fondo + efectivoCobrado + entradas - reembolsos - retiros,
      folio_inicial: folios.length ? Math.min(...folios) : null, folio_final: folios.length ? Math.max(...folios) : null,
      perdida_documental_abierta: this.perdidasDocumentalesAbiertas().map((x) => x.perdida_id),
    };
  }
  /** Cierre del corte del día: se guarda UNA vez por caja y fecha; llamarlo otra vez devuelve el ya guardado. */
  generarCorte(fecha: string) {
    const previo = this.repo.getOp(`corte:${this.id}:${fecha}`);
    if (previo) return previo.payload as ReturnType<Caja['corteEnVivo']>;
    const corte = this.corteEnVivo(fecha);
    this.emitir('corte.generado', corte, `corte:${this.id}:${fecha}`);
    return corte;
  }
}
