import { cortesPorCaja, dolaresPorCaja, reporteConsolidado, ventasPorCaja, type Filtro } from '../consultas.ts';
import { existenciaAlmacen, recepcionesPendientes, revisarAlta, type AltaManual } from '../almacen.ts';
import { DEPARTAMENTOS_BASE, resolverDepartamento } from '../departamentos.ts';
import { formatoTasa } from '../dinero.ts';
import { ErrorDominio } from '../errores.ts';
import type { Impresora } from '../impresion.ts';
import type { Caja } from '../nodos.ts';
import { catalogo, departamentos as proyDepartamentos, permisos as proyPermisos, tarjetasRegalo, tiposDeCambio, tipoCambioVigente, ventas, type TipoCambio } from '../proyecciones.ts';
import { hojaDolares, hojaInventario, leerInventario, PERFIL_CONFIRMADO, type Hoja } from '../inventario.ts';
import { codigoTicket, construirTicket, NEGOCIOS, renderTextoEscPos, renderTicketDevolucionTexto, renderTicketEscPos, renderTicketTexto, type NegocioCfg } from '../ticket.ts';
import type { Actor, Articulo, Linea, Op, Venta } from '../tipos.ts';
import { fechaLocal } from '../util.ts';

export interface Conexion {
  hubAlcanzable(): boolean;
  /** null = sin dato (la caja no mide el enlace hub↔central por sí misma). */
  internet(): boolean | null;
  pendientes(): number;
  ultimaSync(): string | null;
  sincronizar?(): void | Promise<void>;
}

export type ActorCajero = Extract<Actor, { rol: 'cajero' }>;

export interface VistaCarrito {
  id: string;
  lineas: Linea[];
  piezas: number;
  ventas_brutas: number;
  descuentos: number;
  total: number;
  /** Existencia de ESTA tienda por artículo de la venta (para el panel de detalle). */
  existencias: Record<string, { saldo: number; verificada: boolean }>;
  /** Tasa bloqueada de este cobro (si ya se empezó a recibir dólares) y si hay una más reciente. */
  tasa: { version: number; tasa: number; texto: string; hay_nueva: boolean } | null;
}

/**
 * Operación de venta de UNA caja. El servicio está atado a la caja y al actor de la sesión: no existe ninguna ruta para
 * leer ventas o cortes de otra caja. Los datos de usuario son SINTÉTICOS; no hay autenticación en esta etapa.
 */
export class ServicioCaja {
  readonly caja: Caja;
  readonly actor: ActorCajero;
  private impresora: Impresora;
  private conexion: Conexion;
  private reloj: { now(): string };
  private negocios: Record<string, NegocioCfg>;

  constructor(o: { caja: Caja; actor: ActorCajero; impresora: Impresora; conexion: Conexion; reloj: { now(): string }; negocios?: Record<string, NegocioCfg> }) {
    if (o.actor.tienda !== o.caja.tienda || o.actor.caja !== o.caja.caja) throw new ErrorDominio('PROHIBIDO', 'el usuario no pertenece a esta caja');
    this.caja = o.caja;
    this.actor = o.actor;
    this.impresora = o.impresora;
    this.conexion = o.conexion;
    this.reloj = o.reloj;
    this.negocios = o.negocios ?? NEGOCIOS;
  }

  estado() {
    const ahora = this.reloj.now();
    return {
      tienda: this.caja.tienda, caja: this.caja.caja, usuario: this.actor.usuario,
      negocio: this.negocios[this.caja.tienda]!.nombre,
      metodos: this.caja.cfg.metodos,
      ahora, fecha_local: fechaLocal(ahora),
      tipo_cambio: this.vistaTipoCambio(),
      // Pesos que se SABE que hay en el cajón (solo con fondo del día registrado); null = no se puede saber.
      efectivo: { mxn: this.caja.efectivoMxnConocido() },
      ultimo_folio: this.caja.estadoFolios().ultimo,
      folios: this.caja.estadoFolios().estado,
      conexion: { hub: this.conexion.hubAlcanzable(), internet: this.conexion.internet(), pendientes: this.conexion.pendientes(), ultima_sync: this.conexion.ultimaSync() },
      alertas: {
        perdida_documental_abierta: this.caja.perdidasDocumentalesAbiertas().length,
        articulos_no_verificados: this.caja.articulosNoVerificados().length,
      },
    };
  }

  /**
   * Tipo de cambio comercial para la barra lateral. `verificado` es true solo si la tienda alcanza hub e internet (o sea, puede enterarse
   * de una actualización); false = sigue con su última tasa guardada sin poder verificarla; null = esta instalación no mide el enlace.
   */
  private vistaTipoCambio() {
    const t = this.caja.tipoCambio();
    const hub = this.conexion.hubAlcanzable();
    const internet = this.conexion.internet();
    if (t && hub && internet === true) this.caja.registrarVerificacionTasa();
    return {
      configurado: !!t, version: t?.version ?? null, tasa: t?.tasa ?? null, texto: t ? formatoTasa(t.tasa) : null,
      actualizado_en: t?.ocurrio_en ?? null, cambiado_por: t?.usuario ?? null,
      verificado: !hub ? false : internet === null ? null : internet,
      puede_editar: this.caja.puedeEditarTipoCambio(this.actor.usuario),
      // Antigüedad de la última verificación contra el central y qué dice la política (advertencia / bloqueo de dólares, no de pesos).
      sin_verificar: t ? this.caja.estadoTasa() : null,
    };
  }
  tipoCambio() {
    return this.vistaTipoCambio();
  }
  /** Edita la tasa global (permiso por usuario y conexión con el central). Devuelve la nueva vista para actualizar la pantalla. */
  async fijarTipoCambio(tasa: number, confirmarVariacion = false) {
    this.caja.fijarTipoCambio(tasa, this.actor.usuario, false, confirmarVariacion);
    try { await this.conexion.sincronizar?.(); } catch { /* el cambio ya quedó en el central; llegará a las demás cajas al sincronizar */ }
    return this.vistaTipoCambio();
  }
  /** Fija (o renueva) la tasa de este cobro al empezar a recibir dólares. */
  bloquearTasa(cartId: string, renovar = false) {
    const r = this.caja.bloquearTasa(cartId, renovar);
    return { bloqueada: { version: r.bloqueada.version, tasa: r.bloqueada.tasa, texto: formatoTasa(r.bloqueada.tasa) }, vigente: { version: r.vigente.version, tasa: r.vigente.tasa, texto: formatoTasa(r.vigente.tasa) }, hay_nueva: r.hay_nueva };
  }
  movimientoEfectivo(tipo: 'fondo_inicial' | 'retiro' | 'entrada', monto: number, moneda: 'MXN' | 'USD') {
    this.caja.movimientoEfectivo(tipo, monto, moneda);
    return this.caja.corteEnVivo(fechaLocal(this.reloj.now()));
  }
  registrarConteo(moneda: 'MXN' | 'USD', denominaciones: Record<string, number>) {
    return this.caja.registrarConteo({ moneda, denominaciones, usuario: this.actor.usuario });
  }
  registrarConteoUsd(denominaciones: Record<string, number>) {
    return this.registrarConteo('USD', denominaciones);
  }
  /** Procedimiento operativo: billete dañado o sospechoso rechazado (solo constancia; no hay detección automática de falsificaciones). */
  billeteRechazado(denominacion: number, motivo: 'danado' | 'sospechoso', nota?: string, cantidad = 1) {
    this.caja.registrarBilleteRechazado({ denominacion, cantidad, motivo, nota, usuario: this.actor.usuario });
    return { ok: true };
  }
  /** Venta anulada ANTES de recibir dinero (sin folio ni movimiento físico). */
  anularVenta(cartId: string, motivo: string) {
    this.caja.anularCarrito(cartId, motivo, this.actor.usuario);
    return { cart: this.caja.abrirCarrito() };
  }
  /** Venta cancelada DESPUÉS de recibir efectivo: conserva el cobro y suma la salida de pesos. */
  cancelarVenta(saleId: string, motivo: string) {
    const v = this.caja.cancelarVenta(saleId, motivo);
    return { venta: v };
  }

  /** Reutiliza la venta en curso (sobrevive a reinicios) o abre una nueva. */
  carritoActual(): string {
    const abiertos = this.caja.carritosAbiertos();
    return abiertos.length ? abiertos[abiertos.length - 1]! : this.caja.abrirCarrito();
  }
  nuevaVenta(): string {
    return this.caja.abrirCarrito();
  }
  vista(cartId: string): VistaCarrito {
    const c = this.caja.carrito(cartId);
    return {
      id: c.id, lineas: c.lineas, piezas: c.lineas.reduce((a, l) => a + l.qty, 0),
      ventas_brutas: c.lineas.reduce((a, l) => a + l.qty * l.precio_unit, 0),
      descuentos: c.lineas.reduce((a, l) => a + l.descuento, 0),
      total: c.lineas.reduce((a, l) => a + l.importe, 0),
      tasa: c.tasa ? { version: c.tasa.version, tasa: c.tasa.tasa, texto: formatoTasa(c.tasa.tasa), hay_nueva: (this.caja.tipoCambio()?.version ?? 0) > c.tasa.version } : null,
      existencias: Object.fromEntries(c.lineas.map((l) => { const e = this.caja.existenciaVerificada(l.item_id); return [l.item_id, { saldo: e.saldo, verificada: e.verificada }]; })),
    };
  }

  escanear(cartId: string, codigo: string) {
    const r = this.caja.escanear(cartId, codigo);
    return { ...r, ...('linea' in r ? { recepcion: this.caja.recepcionesPendientes(r.linea.item_id) } : {}), carrito: this.vista(cartId) };
  }
  /** Entregas del almacén a esta tienda sin confirmar (el cajero las confirma al escanear el artículo). */
  recepcionesPendientes() {
    const cat = catalogo(this.caja.ops());
    return this.caja.recepcionesPendientes().map((r) => ({ ...r, descripcion: cat.get(r.item_id)?.descripcion ?? '', marca: cat.get(r.item_id)?.marca ?? '', codigo: cat.get(r.item_id)?.codigo ?? '' }));
  }
  confirmarRecepcion(entregaId: string) {
    return this.caja.confirmarRecepcion(entregaId, this.actor.usuario);
  }
  /**
   * Agregar desde un resultado de búsqueda. P-13 (decidido): un código duplicado no debería existir; si ocurre, el cajero
   * decide qué artículo es y el renglón queda marcado (`ambiguo`) para que Administración lo revise.
   */
  agregarArticulo(cartId: string, itemId: string) {
    const art = this.caja.idx.articulo(itemId);
    if (!art) throw new ErrorDominio('ARTICULO_INEXISTENTE', itemId);
    const r = this.caja.agregarPorId(cartId, itemId);
    return { ...r, recepcion: this.caja.recepcionesPendientes(itemId), carrito: this.vista(cartId) };
  }
  async sincronizar() {
    await this.conexion.sincronizar?.();
    return this.estado().conexion;
  }
  cambiarCantidad(cartId: string, lineaId: string, qty: number) {
    this.caja.cambiarCantidad(cartId, lineaId, qty);
    return this.vista(cartId);
  }
  quitarLinea(cartId: string, lineaId: string) {
    this.caja.quitarLinea(cartId, lineaId);
    return this.vista(cartId);
  }
  buscar(texto: string) {
    return this.buscarConTotal(texto).resultados;
  }
  buscarConTotal(texto: string) {
    const { resultados, total } = this.caja.buscarConTotal(texto);
    return {
      total,
      resultados: resultados.map((a) => ({
        item_id: a.item_id, item_no: a.item_no, codigo: a.codigo, descripcion: a.descripcion, marca: a.marca, estilo: a.estilo, lote: a.lote,
        departamento: a.departamento, precio: a.precio, codigo_alterno: a.codigo_alterno ?? null,
        existencia: this.caja.existenciaVerificada(a.item_id).saldo, existencia_verificada: this.caja.existenciaVerificada(a.item_id).verificada,
        duplicado: this.caja.buscarPorCodigo(a.codigo).length > 1,
        precio_valido: a.precio > 0,
      })),
    };
  }

  private async imprimirVenta(saleId: string, tipo: 'original' | 'reimpresion', n: number) {
    const v = ventas(this.caja.opsVentas()).get(saleId)!;
    const cfg = this.negocios[v.tienda]!;
    const ticket = construirTicket(v, cfg, n, this.negocios);
    const texto = renderTicketTexto(ticket);
    // El cajón se abre con el cobro en efectivo original, no al reimprimir.
    const bytes = renderTicketEscPos(ticket, { abrirCajon: tipo === 'original' });
    let impresion: { ok: boolean; error?: string };
    try {
      await this.impresora.imprimir({ ref: ticket.codigo_ticket, texto, bytes });
      impresion = { ok: true };
    } catch (e) {
      impresion = { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
    this.caja.registrarImpresion({ sale_id: saleId, tipo, resultado: impresion.ok ? 'ok' : 'error', error: impresion.error, usuario: this.actor.usuario });
    return { ticket_texto: texto, codigo_ticket: ticket.codigo_ticket, impresion };
  }

  /**
   * Cobra en efectivo: guarda venta, pago, folio y movimientos de inventario en una sola transacción y SOLO DESPUÉS imprime.
   * Una falla de impresión no revierte ni duplica nada: la venta queda guardada y el ticket se reimprime con el mismo folio.
   */
  async cobrarEfectivo(cartId: string, recibido: number, usd = 0) {
    // Sin dólares es el cobro en pesos de siempre; con dólares, pesos y dólares (el cambio se entrega en pesos).
    if (usd > 0) return this.finalizarCobro(this.caja.cobrarEfectivoMixto(cartId, { usd, pesos: recibido }, this.actor.usuario));
    return this.finalizarCobro(this.caja.cobrarEfectivo(cartId, recibido, this.actor.usuario));
  }
  /** Tarjeta de regalo (todo el saldo necesario) y, si no alcanza, el resto en efectivo. */
  async cobrarTarjetaRegalo(cartId: string, codigo: string, recibido?: number, usd = 0) {
    return this.finalizarCobro(this.caja.cobrarConTarjetaRegalo(cartId, codigo, recibido, this.actor.usuario, usd));
  }
  private async finalizarCobro(venta: Venta) {
    const yaImpreso = this.caja.impresionesDe(venta.sale_id).some((i) => i.resultado === 'ok');
    const imp = yaImpreso
      ? { ticket_texto: renderTicketTexto(construirTicket(venta, this.negocios[venta.tienda]!, 0, this.negocios)), codigo_ticket: construirTicket(venta, undefined, 0, this.negocios).codigo_ticket, impresion: { ok: true } }
      : await this.imprimirVenta(venta.sale_id, 'original', 0);
    return { venta, avisos: venta.avisos ?? [], ...imp, cambio: venta.pagos.find((p) => p.metodo === 'efectivo')?.cambio ?? venta.pagos.find((p) => p.metodo === 'efectivo_usd')?.cambio_mxn ?? 0 };
  }

  // ── tarjetas de regalo ──
  consultarTarjeta(codigo: string) {
    const t = this.caja.tarjetaRegalo(codigo);
    if (!t) throw new ErrorDominio('TARJETA_INEXISTENTE', `la tarjeta ${codigo.trim()} no está dada de alta (o aún no llega a esta caja)`);
    return this.vistaTarjeta(t);
  }
  private vistaTarjeta(t: ReturnType<Caja['tarjetaRegalo']> & {}) {
    return {
      codigo: t.codigo, emitido: t.emitido, recargado: t.recargado, usado: t.usado, reintegrado: t.reintegrado, saldo: t.saldo,
      tienda: t.tienda, caja: t.caja, ocurrio_en: t.ocurrio_en, vigente_hasta: t.vigente_hasta,
      vencida: Date.parse(t.vigente_hasta) <= Date.parse(this.reloj.now()),
    };
  }
  /** Alta de una tarjeta: es una venta con folio normal, pagada en efectivo (P-24). */
  async altaTarjetaRegalo(codigo: string, monto: number, recibido?: number, ref?: string) {
    return this.ventaTarjeta('alta', codigo, monto, recibido, ref);
  }
  /** Recarga en efectivo: también con folio, y reinicia los 12 meses de vigencia. */
  async recargarTarjetaRegalo(codigo: string, monto: number, recibido?: number, ref?: string) {
    return this.ventaTarjeta('recarga', codigo, monto, recibido, ref);
  }
  private async ventaTarjeta(tipo: 'alta' | 'recarga', codigo: string, monto: number, recibido?: number, ref?: string) {
    const base = { codigo, monto, recibido, cajero: this.actor.usuario, ref };
    const { venta, tarjeta } = tipo === 'alta' ? this.caja.altaTarjetaRegalo(base) : this.caja.recargarTarjetaRegalo(base);
    // El hub concede el saldo: se intenta que conozca la tarjeta de inmediato (si no hay hub, queda en cola y se usa tras sincronizar).
    try { await this.conexion.sincronizar?.(); } catch { /* sin red: queda guardada localmente */ }
    const cobro = await this.finalizarCobro(venta);
    return { ...cobro, tarjeta: this.vistaTarjeta(tarjeta) };
  }
  /** Tarjetas dadas de alta POR ESTA caja (el cajero no ve el resto del libro). */
  tarjetasPropias() {
    return this.caja.tarjetasRegaloTodas().filter((t) => t.tienda === this.caja.tienda && t.caja === this.caja.caja).map((t) => this.vistaTarjeta(t));
  }

  // ── devoluciones (solo en la caja donde se vendió) ──
  /**
   * Localiza ventas de la tienda por fecha y hora, artículo escaneado o folio. `fecha` es local (YYYY-MM-DD) y las horas HH:MM;
   * America/Hermosillo es UTC-7 sin horario de verano.
   */
  buscarVentas(q: { fecha?: string; desde?: string; hasta?: string; item_id?: string; codigo?: string; folio?: number }) {
    let item_id = q.item_id;
    if (!item_id && q.codigo) {
      const art = this.caja.buscarPorCodigo(q.codigo.trim());
      if (!art.length) throw new ErrorDominio('ARTICULO_INEXISTENTE', `no hay artículo con el código ${q.codigo.trim()}`);
      if (art.length > 1) throw new ErrorDominio('CODIGO_AMBIGUO', 'código duplicado: busque por fecha y hora');
      item_id = art[0]!.item_id;
    }
    const aUtc = (hhmm: string) => new Date(Date.parse(`${q.fecha}T${hhmm}:00Z`) + 7 * 3600_000).toISOString();
    const desde = q.fecha ? aUtc(q.desde || '00:00') : undefined;
    const hasta = q.fecha ? aUtc(q.hasta || '23:59').replace(':00.000Z', ':59.999Z') : undefined;
    const r = this.caja.buscarVentas({ desde, hasta, item_id, folio: q.folio });
    const art = item_id ? this.caja.idx.articulo(item_id) : undefined;
    return {
      hub: r.hub, articulo: art ? { descripcion: art.descripcion, marca: art.marca, item_no: art.item_no } : null,
      resultados: r.resultados.map((v) => ({
        sale_id: v.sale_id, caja: v.caja, folio: v.folio, propia: v.propia, codigo_ticket: codigoTicket(v.tienda, v.caja, v.folio, this.negocios),
        ocurrio_en: v.ocurrio_en, total: v.total ?? null,
        lineas: (v.lineas_detalle ?? v.lineas).map((l: any) => ({ linea_id: l.linea_id, item_id: l.item_id, descripcion: l.descripcion, qty: l.qty, devuelto: l.devuelto ?? null, importe: l.importe ?? null, marca: l.marca ?? null, item_no: l.item_no ?? null, codigo: l.codigo ?? null, tarjeta_regalo: !!l.tarjeta_regalo })),
      })),
    };
  }
  async devolver(saleId: string, renglones: { linea_id: string; qty: number }[], motivo: string) {
    const d = this.caja.devolver({ sale_id: saleId, renglones, motivo, cajero: this.actor.usuario });
    const v = ventas(this.caja.opsVentas()).get(saleId)!;
    const texto = renderTicketDevolucionTexto(d, v, this.negocios[v.tienda]!, this.negocios);
    let impresion: { ok: boolean; error?: string };
    try {
      await this.impresora.imprimir({ ref: `dev:${d.devolucion_id}`, texto, bytes: renderTextoEscPos(texto, { abrirCajon: d.reembolsos.some((r) => r.metodo === 'efectivo') }) });
      impresion = { ok: true };
    } catch (e) {
      impresion = { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
    return { devolucion: d, ticket_texto: texto, impresion };
  }

  async reimprimir(saleId: string) {
    const v = ventas(this.caja.opsVentas()).get(saleId);
    if (!v || v.tienda !== this.caja.tienda || v.caja !== this.caja.caja) throw new ErrorDominio('PROHIBIDO', 'solo se reimprimen ventas de la propia caja');
    const n = this.caja.impresionesDe(saleId).filter((i) => i.tipo === 'reimpresion').length + 1;
    return this.imprimirVenta(saleId, 'reimpresion', n);
  }

  ticketTexto(saleId: string): string {
    const v = ventas(this.caja.opsVentas()).get(saleId);
    if (!v || v.tienda !== this.caja.tienda || v.caja !== this.caja.caja) throw new ErrorDominio('PROHIBIDO', 'solo se consultan tickets de la propia caja');
    const n = this.caja.impresionesDe(saleId).filter((i) => i.tipo === 'reimpresion').length;
    return renderTicketTexto(construirTicket(v, this.negocios[v.tienda]!, n, this.negocios));
  }

  /** Ventas de ESTA caja. El filtro por caja lo impone el permiso del actor, no la ausencia de datos. */
  ventasDelDia(fecha: string) {
    return ventasPorCaja(this.actor, this.caja.opsVentas(), { desde: fecha, hasta: fecha }).map((r) => ({
      ...r, impresiones: this.caja.impresionesDe(r.sale_id).length,
      ultima_impresion: this.caja.impresionesDe(r.sale_id).at(-1)?.resultado ?? null,
    }));
  }
  ventasPropias(filtro: Filtro = {}) {
    return ventasPorCaja(this.actor, this.caja.opsVentas(), filtro);
  }

  corte(fecha: string) {
    const vivo = this.caja.corteEnVivo(fecha);
    const cerrado = this.caja.repo.getOp(`corte:${this.caja.id}:${fecha}`)?.payload ?? null;
    return { vivo, cerrado, desactualizado: cerrado ? JSON.stringify(cerrado) !== JSON.stringify(vivo) : false };
  }
  cerrarCorte(fecha: string) {
    return this.caja.generarCorte(fecha);
  }
  cortesPropios(filtro: Filtro = {}) {
    return cortesPorCaja(this.actor, this.caja.opsDe('corte.generado'), filtro);
  }
}

/** Consola de Administración: puede elegir una, varias o todas las cajas, de cualquier tienda. */
export interface FuenteInventario {
  tiendas: string[];
  articulos(): Articulo[];
  saldo(tienda: string, itemId: string): number;
  verificada(tienda: string, itemId: string): boolean;
}

export class ServicioAdmin {
  readonly actor: Extract<Actor, { rol: 'admin' }>;
  private fuente: () => Op[];
  readonly cajas: { tienda: string; caja: number }[];
  private inv?: FuenteInventario;
  private central?: { fijarTipoCambio(tasa: number, usuario: string, versionBase: number, confirmarVariacion?: boolean): import('../nodos.ts').ResultadoTipoCambio; asignarPermiso(usuario: string, permiso: string, valor: boolean, por: string): Op; guardarDepto(c: import('../departamentos.ts').CambioDepto, por: string): { ok: true; op: Op } | { ok: false; error: import('../departamentos.ts').ErrorDepto };
    altaLote: import('../nodos.ts').Central['altaLote']; entregar: import('../nodos.ts').Central['entregar'] };
  constructor(o: { actor: Extract<Actor, { rol: 'admin' }>; fuente: () => Op[]; cajas: { tienda: string; caja: number }[]; inventario?: FuenteInventario; central?: ServicioAdmin['central'] }) {
    this.central = o.central;
    this.actor = o.actor;
    this.fuente = o.fuente;
    this.cajas = o.cajas;
    this.inv = o.inventario;
  }
  /** Inventario para Administración: resumen y la tabla lista para Excel. Solo Administración. */
  inventario(completo = false): { resumen: Record<string, unknown>; hoja: Hoja } {
    if (this.actor.rol !== 'admin') throw new ErrorDominio('PROHIBIDO', 'el inventario consolidado es solo de Administración');
    if (!this.inv) throw new ErrorDominio('SIN_INVENTARIO', 'esta sesión no tiene fuente de inventario');
    const arts = this.inv.articulos();
    const hoja = hojaInventario(arts, { tiendas: this.inv.tiendas, saldo: this.inv.saldo, verificada: this.inv.verificada });
    const porTienda = Object.fromEntries(this.inv.tiendas.map((t) => {
      let piezas = 0, conExistencia = 0, noVerificados = 0;
      for (const a of arts) { const q = this.inv!.saldo(t, a.item_id); piezas += q; if (q > 0) conExistencia++; if (!this.inv!.verificada(t, a.item_id)) noVerificados++; }
      return [t, { piezas, articulos_con_existencia: conExistencia, no_verificados: noVerificados }];
    }));
    const resumen = {
      articulos: arts.length, con_codigo: arts.filter((a) => a.codigo).length, sin_codigo: arts.filter((a) => !a.codigo).length,
      precio_no_vendible: arts.filter((a) => !(a.precio > 0)).length, por_tienda: porTienda,
    };
    return { resumen, hoja: completo ? hoja : { ...hoja, filas: hoja.filas.slice(0, 20) } };
  }
  // ── tipo de cambio y permisos (Administración trabaja en el central) ──
  tipoCambio() {
    const ops = this.fuente();
    const fila = (t: TipoCambio) => ({ version: t.version, tasa: t.tasa, texto: formatoTasa(t.tasa), usuario: t.usuario, ocurrio_en: t.ocurrio_en, anterior: t.anterior ? { version: t.anterior.version, tasa: t.anterior.tasa, texto: formatoTasa(t.anterior.tasa) } : null });
    const vigente = tipoCambioVigente(ops);
    const asignados = proyPermisos(ops);
    return {
      vigente: vigente ? fila(vigente) : null,
      historial: tiposDeCambio(ops).map(fila).reverse(),
      permisos: [...asignados].map(([usuario, p]) => ({ usuario, editar_tipo_cambio: p.has('editar_tipo_cambio') })),
    };
  }
  fijarTipoCambio(tasa: number, confirmarVariacion = false) {
    if (!this.central) throw new ErrorDominio('SIN_CENTRAL', 'esta sesión no tiene acceso al servicio central');
    const base = tipoCambioVigente(this.fuente())?.version ?? 0;
    const r = this.central.fijarTipoCambio(tasa, this.actor.usuario, base, confirmarVariacion);
    if (!r.ok) {
      if (r.motivo === 'confirmacion_requerida') throw new ErrorDominio('CONFIRMACION_REQUERIDA', `el cambio es de ${(r.variacion_pb! / 100).toFixed(2)} % respecto a la tasa vigente: confirme para continuar`, { variacion_pb: r.variacion_pb, anterior: r.vigente!.tasa, nueva: tasa });
      throw new ErrorDominio(r.motivo === 'tasa_invalida' ? 'TASA_INVALIDA' : 'CONFIG_DESACTUALIZADA', r.motivo === 'tasa_invalida' ? 'el tipo de cambio debe ser un número positivo' : 'el tipo de cambio cambió mientras se editaba');
    }
    return this.tipoCambio();
  }
  asignarPermisoTipoCambio(usuario: string, valor: boolean) {
    if (!this.central) throw new ErrorDominio('SIN_CENTRAL', 'esta sesión no tiene acceso al servicio central');
    const u = String(usuario ?? '').trim();
    if (!u) throw new ErrorDominio('DATOS_REQUERIDOS', 'falta el usuario');
    this.central.asignarPermiso(u, 'editar_tipo_cambio', valor, this.actor.usuario);
    return this.tipoCambio();
  }
  // ── departamentos (catálogo editable; los cambios viajan a todas las tiendas) ──
  departamentos() {
    const ops = this.fuente();
    const cuenta = new Map<string, number>();
    for (const a of catalogo(ops).values()) cuenta.set(a.departamento, (cuenta.get(a.departamento) ?? 0) + 1);
    return { departamentos: proyDepartamentos(ops).map((d) => ({ ...d, articulos: cuenta.get(d.nombre) ?? 0 })) };
  }
  guardarDepartamento(c: import('../departamentos.ts').CambioDepto) {
    if (!this.central) throw new ErrorDominio('SIN_CENTRAL', 'esta sesión no tiene acceso al servicio central');
    const r = this.central.guardarDepto(c, this.actor.usuario);
    if (!r.ok) throw new ErrorDominio(r.error.codigo === 'NO_EXISTE' ? 'NO_ENCONTRADO' : 'DEPARTAMENTO_INVALIDO', r.error.mensaje, { motivo: r.error.codigo });
    return this.departamentos();
  }
  // ── almacén ──
  private tiendas() { return [...new Set(this.cajas.map((c) => c.tienda))]; }
  /** Existencia del almacén por artículo, lo pendiente de confirmar por cada tienda y las entregas recientes. */
  almacen() {
    const ops = this.fuente();
    const cat = catalogo(ops);
    const ex = existenciaAlmacen(ops);
    const tiendas = this.tiendas();
    const pend = new Map<string, Record<string, number>>();
    for (const t of tiendas) for (const r of recepcionesPendientes(ops, t)) { const x = pend.get(r.item_id) ?? {}; x[t] = (x[t] ?? 0) + r.qty; pend.set(r.item_id, x); }
    const items = [...ex.values()].filter((e) => cat.has(e.item_id)).map((e) => {
      const a = cat.get(e.item_id)!;
      return {
        item_id: a.item_id, item_no: a.item_no, codigo: a.codigo, marca: a.marca, descripcion: a.descripcion, estilo: a.estilo, lote: a.lote, departamento: a.departamento, precio: a.precio,
        pedimentos: e.pedimentos, recibido: e.recibido, entregado: e.entregado, existencia: e.existencia, pendiente_por_tienda: pend.get(a.item_id) ?? {},
      };
    }).sort((x, y) => Number(y.item_no ?? 0) - Number(x.item_no ?? 0));
    return { tiendas, items };
  }
  private deptosActivos() { return proyDepartamentos(this.fuente()); }
  /** Lee y revisa un archivo de alta SIN guardar nada: columnas, departamentos a confirmar, artículos que ya existen. */
  revisarAltaLote(filas: unknown[][], o: { decisiones?: Record<string, string>; regla?: boolean } = {}) {
    if (!Array.isArray(filas)) throw new ErrorDominio('DATOS_REQUERIDOS', 'falta el contenido del archivo');
    const deptos = this.deptosActivos();
    const lectura = leerInventario(filas, PERFIL_CONFIRMADO, deptos);
    const revision = revisarAlta(lectura, [...catalogo(this.fuente()).values()], deptos, { decisiones: o.decisiones, reglaEnvolturas: o.regla !== false });
    return {
      revision, departamentos: lectura.departamentos, envolturas: lectura.envolturas, destinos: deptos.filter((d) => d.activo).map((d) => d.nombre),
      columnas: { usadas: lectura.columnas.usadas, ignoradas: lectura.columnas.ignoradas },
    };
  }
  /** Da de alta el lote revisado: artículos nuevos y/o piezas a existentes, todo al almacén. */
  altaLote(d: { lote_id: string; nombre?: string; filas: unknown[][]; decisiones?: Record<string, string>; regla?: boolean; pedimento_lote?: string }) {
    if (!this.central) throw new ErrorDominio('SIN_CENTRAL', 'esta sesión no tiene acceso al servicio central');
    if (!String(d.lote_id ?? '').trim()) throw new ErrorDominio('DATOS_REQUERIDOS', 'falta el identificador del lote');
    const r = this.revisarAltaLote(d.filas, { decisiones: d.decisiones, regla: d.regla });
    if (r.revision.errores.length) throw new ErrorDominio('ARCHIVO_INVALIDO', r.revision.errores.join('; '));
    const validas = r.revision.filas.filter((f) => f.estado !== 'invalido');
    if (!validas.length) throw new ErrorDominio('ARCHIVO_INVALIDO', 'el archivo no tiene filas válidas para dar de alta');
    const res = this.central.altaLote({
      lote_id: d.lote_id, fuente: `archivo:${d.nombre ?? 'sin nombre'}`, por: this.actor.usuario,
      filas: validas.map((f) => ({
        fila: f.fila, cantidad: f.cantidad, codigo: f.codigo, marca: f.marca, descripcion: f.descripcion, estilo: f.estilo, lote: f.lote, precio: f.precio,
        departamento: f.departamento, pedimento: f.pedimento || d.pedimento_lote || undefined, item_id: f.existente?.item_id,
      })),
    });
    return { ...res, omitidas: r.revision.resumen.invalidos, almacen: this.almacen() };
  }
  /** Alta manual de un artículo (o suma de piezas si el código ya existe). */
  altaManual(d: AltaManual & { lote_id?: string }) {
    if (!this.central) throw new ErrorDominio('SIN_CENTRAL', 'esta sesión no tiene acceso al servicio central');
    const t = (v: unknown) => String(v ?? '').trim();
    const cantidad = Number(d.cantidad), precio = Math.round(Number(d.precio) * 100);
    if (!Number.isInteger(cantidad) || cantidad <= 0) throw new ErrorDominio('CANTIDAD_INVALIDA', 'la cantidad debe ser un entero mayor que 0');
    if (!t(d.codigo)) throw new ErrorDominio('DATOS_REQUERIDOS', 'falta el código');
    if (!t(d.descripcion)) throw new ErrorDominio('DATOS_REQUERIDOS', 'falta la descripción');
    const deptos = this.deptosActivos();
    const rd = resolverDepartamento(t(d.departamento), deptos);
    if (rd.estado !== 'exacto' && rd.estado !== 'alias') throw new ErrorDominio('DEPARTAMENTO_INVALIDO', `el departamento «${t(d.departamento)}» no existe${rd.sugerencias[0] ? `; ¿quiso decir «${rd.sugerencias[0].nombre}»?` : ''}`, { sugerencias: rd.sugerencias });
    const existente = [...catalogo(this.fuente()).values()].find((a) => a.codigo === t(d.codigo));
    if (!existente && !(precio > 0)) throw new ErrorDominio('PRECIO_INVALIDO', 'el precio debe ser mayor que 0');
    const res = this.central.altaLote({
      lote_id: d.lote_id || `manual-${Date.now()}-${t(d.codigo)}`, fuente: 'manual', por: this.actor.usuario,
      filas: [{ fila: 1, cantidad, codigo: t(d.codigo), marca: t(d.marca), descripcion: t(d.descripcion), estilo: t(d.estilo), lote: t(d.lote), precio, departamento: rd.propuesto, pedimento: t(d.pedimento) || undefined, item_id: existente?.item_id }],
    });
    return { ...res, almacen: this.almacen() };
  }
  /** Entrega a tiendas. Sin etiquetas confirmadas no se entrega; entregar más de lo registrado pide confirmación. */
  entregarAlmacen(d: { item_id: string; destinos: Record<string, number>; etiqueta_precio: boolean; etiqueta_costura: boolean; confirmar_exceso?: boolean; ref?: string }) {
    if (!this.central) throw new ErrorDominio('SIN_CENTRAL', 'esta sesión no tiene acceso al servicio central');
    const r = this.central.entregar({ ...d, por: this.actor.usuario });
    if (!r.ok) {
      const msg = { articulo_inexistente: 'el artículo no existe', cantidad_invalida: 'indique cantidades enteras de 1 en adelante', tienda_invalida: 'tienda desconocida', etiquetas_pendientes: 'confirme que el artículo ya tiene etiqueta de precio y de costura', excede: `se entregarían ${r.pedido} pieza(s) y el almacén registra ${r.disponible}: confirme para entregar de todos modos` }[r.motivo];
      throw new ErrorDominio(r.motivo === 'excede' ? 'CONFIRMACION_REQUERIDA' : r.motivo === 'etiquetas_pendientes' ? 'ETIQUETAS_PENDIENTES' : 'ENTREGA_INVALIDA', msg, r.motivo === 'excede' ? { disponible: r.disponible, pedido: r.pedido } : undefined);
    }
    return { existencia_almacen: r.existencia_almacen, almacen: this.almacen() };
  }
  /** Dólares físicos recibidos y su equivalente con la tasa de cada operación (no la del día). */
  dolares(f: Filtro = {}) {
    return dolaresPorCaja(this.actor, this.fuente(), f);
  }
  hojaDolares(f: Filtro = {}): Hoja {
    return hojaDolares(this.dolares(f));
  }

  /** Libro mayor de tarjetas de regalo de todas las tiendas (solo Administración). */
  tarjetasRegalo() {
    const m = tarjetasRegalo(this.fuente());
    return [...m.values()].sort((a, b) => b.ocurrio_en.localeCompare(a.ocurrio_en)).map((t) => ({
      codigo: t.codigo, emitido: t.emitido, recargado: t.recargado, usado: t.usado, reintegrado: t.reintegrado, saldo: t.saldo,
      tienda: t.tienda, caja: t.caja, cajero: t.cajero, ocurrio_en: t.ocurrio_en, vigente_hasta: t.vigente_hasta,
      vencida: Date.parse(t.vigente_hasta) <= Date.now(), duplicadas: t.duplicadas.length,
    }));
  }
  reporte(f: Filtro = {}) {
    return reporteConsolidado(this.actor, this.fuente(), f);
  }
  ventas(f: Filtro = {}) {
    return ventasPorCaja(this.actor, this.fuente(), f);
  }
  cortes(f: Filtro = {}) {
    return cortesPorCaja(this.actor, this.fuente(), f);
  }
}
