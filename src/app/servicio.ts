import { cortesPorCaja, descuentosPorCaja, dolaresPorCaja, reporteConsolidado, ventasPorCaja, ventasPorVendedora, type Filtro } from '../consultas.ts';
import { DIAS_URGENTE, diasHasta, entradasDeArticulo, existenciaAlmacen, faltantes, recepcionesPendientes, recordatoriosPiso, reporteEntregas, revisarAlta, type AltaManual } from '../almacen.ts';
import { DEPARTAMENTOS_BASE, resolverDepartamento } from '../departamentos.ts';
import { formatoTasa } from '../dinero.ts';
import { ErrorDominio } from '../errores.ts';
import type { Impresora } from '../impresion.ts';
import type { Caja } from '../nodos.ts';
import { estadoPromo, type Promocion } from '../promociones.ts';
import { CAMPOS_EDITABLES, catalogo, historialArticulo, nombresTienda, datosTiendas, departamentos as proyDepartamentos, promocionesDe, recompensasDe, supervisoresDe, cajerosDe, administradoresDe, configSesionDe, permisos as proyPermisos, tarjetasRegalo, tiposDeCambio, tipoCambioVigente, ventas, type TipoCambio } from '../proyecciones.ts';
import { hojaDescuentos, hojaEntregas, hojaDolares, hojaInventario, leerInventario, PERFIL_CONFIRMADO, type Hoja } from '../inventario.ts';
import { LOGOS_TICKET } from '../logos-ticket.ts';
import { aplicarDatosTienda, codigoTicket, construirTicket, construirTicketRegalo, formatoMXN, NEGOCIOS, renderTextoEscPos, renderTicketDevolucionTexto, renderTicketRetiroTexto, renderTicketEscPos, renderTicketTexto, type NegocioCfg } from '../ticket.ts';
import type { ReglaRecompensa } from '../recompensas.ts';
import { hashClave, nombreClave, type Perfil, type RolAdmin } from '../supervisores.ts';
import { LIMBO, type Actor, type Articulo, type Linea, type Op, type Venta } from '../tipos.ts';
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
  /** Lo que se cobra ahora (ya sin el crédito del cambio; nunca negativo). */
  total: number;
  /** Cambio en curso: piezas que regresa la clienta (se muestran en negativo) y su crédito. `saldo_favor` es lo que sobra si el crédito supera la venta. */
  cambio: { sale_id: string; folio_origen: number; credito: number; aplicado: number; saldo_favor: number; lineas: { linea_id: string; item_id: string; item_no: string | null; codigo: string; descripcion: string; marca: string; estilo: string; qty: number; precio_unit: number; importe: number }[] } | null;
  /** Quién atendió esta venta (null = todavía no se elige; `id` null = «Autocompra»). */
  vendedora: { id: string | null; alias: string } | null;
  /** Promociones aplicadas y estado del cupón de esta venta. */
  promos: { promo_id: string; nombre: string; tipo: string; monto: number }[];
  cupon: { codigo: string; nombre: string; monto: number; aplicado: boolean; motivo?: string } | null;
  /** Existencia de ESTA tienda por artículo de la venta (para el panel de detalle). */
  existencias: Record<string, { saldo: number; verificada: boolean; limbo: number | null }>;
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
  private usuarioInicial: string;
  private autenticado = false;
  private ultimaActividad = 0;

  constructor(o: { caja: Caja; actor: ActorCajero; impresora: Impresora; conexion: Conexion; reloj: { now(): string }; negocios?: Record<string, NegocioCfg> }) {
    if (o.actor.tienda !== o.caja.tienda || o.actor.caja !== o.caja.caja) throw new ErrorDominio('PROHIBIDO', 'el usuario no pertenece a esta caja');
    this.caja = o.caja;
    this.actor = o.actor;
    this.usuarioInicial = o.actor.usuario;
    this.impresora = o.impresora;
    this.conexion = o.conexion;
    this.reloj = o.reloj;
    this.negocios = o.negocios ?? NEGOCIOS;
  }

  // ── inicio de sesión ──
  /** La caja pide usuario y clave en cuanto hay al menos un cajero con clave registrado; mientras no haya ninguno trabaja como siempre. */
  requiereLogin(): boolean {
    return this.caja.cajerosActivos().length > 0;
  }
  autenticada(): boolean {
    if (!this.requiereLogin()) return true;
    if (this.autenticado && !this.caja.cajeroActivo(this.actor.usuario)) this.cerrarSesion(); // un cajero desactivado pierde la sesión
    const limite = this.caja.configSesion().caja_min * 60000;
    if (this.autenticado && limite > 0 && this.ahoraMs() - this.ultimaActividad > limite) this.cerrarSesion(true); // inactividad
    return this.autenticado;
  }
  private ahoraMs() { return Date.parse(this.reloj.now()); }
  /** Marca actividad de quien usa la caja (cualquier operación suya y el latido de la pantalla; las lecturas automáticas no cuentan). */
  tocar() { this.ultimaActividad = this.ahoraMs(); }
  sesionInfo() {
    const dentro = this.autenticada();
    const limite = this.caja.configSesion().caja_min * 60;
    return {
      requiere_login: this.requiereLogin(), autenticado: dentro, usuario: dentro ? this.actor.usuario : null, cajeros: dentro ? [] : this.caja.cajerosActivos(),
      // Sin cajeras registradas no hay sesión que cerrar: no hay cuenta regresiva.
      inactividad: dentro && this.requiereLogin() && limite > 0 ? { limite_seg: limite, restante_seg: Math.max(0, Math.ceil((this.ultimaActividad + limite * 1000 - this.ahoraMs()) / 1000)) } : null,
    };
  }
  iniciarSesion(usuario: string, clave: string) {
    this.actor.usuario = this.caja.iniciarSesionCajero(String(usuario ?? ''), String(clave ?? ''));
    this.autenticado = true;
    this.tocar();
    return this.sesionInfo();
  }
  /**
   * Cierra la sesión. La venta en curso con artículos NO se pierde ni pasa a la siguiente persona: queda en «Venta en espera» a nombre de la
   * sesión que se cerró, para retomarla.
   */
  cerrarSesion(porInactividad = false) {
    if (this.autenticado) {
      for (const id of this.caja.carritosActivos()) {
        try { if (this.caja.carrito(id).lineas.length) this.caja.ponerEnEspera(id, `Sesión de ${this.actor.usuario} ${porInactividad ? 'cerrada por inactividad' : 'cerrada'}`, this.actor.usuario); } catch { /* cobro con tarjeta pendiente: se queda como está */ }
      }
    }
    this.autenticado = false;
    this.actor.usuario = this.usuarioInicial;
    return this.sesionInfo();
  }

  estado() {
    const ahora = this.reloj.now();
    return {
      tienda: this.caja.tienda, caja: this.caja.caja, usuario: this.actor.usuario,
      negocio: this.negociosVivos()[this.caja.tienda]!.nombre,
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
  /** Efectivo de venta en la caja y si ya toca un retiro, más los retiros de hoy. */
  estadoRetiro() {
    const e = this.caja.estadoRetiro();
    return { ...e, retiros: this.caja.retiros(e.fecha), pide_clave: this.caja.controlesConClave() };
  }
  /** Registra el retiro y manda a imprimir sus datos. Una falla de impresión no deshace el retiro: se reimprime después. */
  async registrarRetiro(d: { retiro_id: string; mxn?: Record<string, number>; usd?: Record<string, number>; clave?: string }) {
    const retiro = this.caja.registrarRetiro({ ...d, usuario: this.actor.usuario });
    return { retiro, ...(await this.imprimirRetiro(retiro, 0)), estado: this.estadoRetiro() };
  }
  async reimprimirRetiro(retiroId: string) {
    const retiro = this.caja.retiros(fechaLocal(this.reloj.now())).find((r) => r.retiro_id === retiroId)
      ?? this.caja.retiros(fechaLocal(new Date(Date.parse(this.reloj.now()) - 86400000).toISOString())).find((r) => r.retiro_id === retiroId);
    if (!retiro) throw new ErrorDominio('RETIRO_INEXISTENTE', 'ese retiro no existe en esta caja');
    return { retiro, ...(await this.imprimirRetiro(retiro, 1)) };
  }
  private async imprimirRetiro(r: ReturnType<Caja['retiros']>[number], reimpresion: number) {
    const texto = renderTicketRetiroTexto(r, this.negociosVivos()[r.tienda]!, reimpresion);
    try {
      await this.impresora.imprimir({ ref: `retiro:${r.retiro_id}${reimpresion ? `:re${Date.now()}` : ''}`, texto, bytes: renderTextoEscPos(texto) });
      return { ticket_texto: texto, impresion: { ok: true as boolean, error: undefined as string | undefined } };
    } catch (e) {
      return { ticket_texto: texto, impresion: { ok: false, error: e instanceof Error ? e.message : String(e) } };
    }
  }
  /** Cancela la venta EN CURSO (aún sin cobrar): no pide clave. Queda el registro de auditoría con lo que tenía y se abre una venta nueva. */
  anularVenta(cartId: string, motivo: string) {
    this.caja.anularCarrito(cartId, motivo, this.actor.usuario);
    const cart = this.caja.abrirCarrito();
    return { cart, carrito: this.vista(cart) };
  }
  /** Venta cancelada DESPUÉS de recibir efectivo: conserva el cobro y suma la salida de pesos. */
  cancelarVenta(saleId: string, motivo: string, autoriza?: { nombre: string; clave: string }) {
    const v = this.caja.cancelarVenta(saleId, motivo, this.actor.usuario, autoriza);
    return { venta: v };
  }
  /** Quién puede autorizar una cancelación o una devolución (otro cajero o un supervisor) y si hace falta pedir la clave. */
  autorizadores() {
    return { pide_clave: this.caja.controlesConClave(), autorizadores: this.caja.controlesConClave() ? this.caja.autorizadoresPosibles(this.actor.usuario) : [] };
  }

  /** Configuración de cada negocio con el nombre editado en Administración (si lo hay). */
  private negociosVivos(): Record<string, NegocioCfg> {
    const datos = this.caja.idx.datosDeTienda();
    return Object.fromEntries(Object.entries(this.negocios).map(([t, c]) => [t, aplicarDatosTienda(c, datos.get(t))]));
  }

  /** Reutiliza la venta en curso (sobrevive a reinicios) o abre una nueva. */
  carritoActual(): string {
    const abiertos = this.caja.carritosActivos();
    return abiertos.length ? abiertos[abiertos.length - 1]! : this.caja.abrirCarrito();
  }
  ventasEnEspera() {
    return this.caja.ventasEnEspera();
  }
  /** Guarda la venta en espera y abre una nueva para atender al siguiente cliente. */
  ponerEnEspera(cartId: string, nota: string) {
    this.caja.ponerEnEspera(cartId, nota, this.actor.usuario);
    const cart = this.caja.abrirCarrito();
    return { cart, carrito: this.vista(cart), espera: this.caja.ventasEnEspera() };
  }
  /** Retoma una venta en espera; la venta en pantalla pasa a espera si tiene artículos, o se descarta si está vacía. */
  retomarVenta(cartEspera: string, cartActual?: string) {
    if (cartActual && cartActual !== cartEspera) {
      const actual = this.caja.carrito(cartActual);
      if (actual.estado === 'abierto' && !actual.espera) {
        if (actual.lineas.length) this.caja.ponerEnEspera(cartActual, '', this.actor.usuario);
        else this.caja.descartarVacio(cartActual);
      }
    }
    this.caja.retomar(cartEspera, this.actor.usuario);
    return { cart: cartEspera, carrito: this.vista(cartEspera), espera: this.caja.ventasEnEspera() };
  }
  /** Descarta una venta en espera (queda la constancia de anulación con lo que tenía). */
  descartarEnEspera(cartId: string) {
    this.caja.retomar(cartId, this.actor.usuario);
    this.caja.anularCarrito(cartId, 'venta en espera descartada', this.actor.usuario);
    return { espera: this.caja.ventasEnEspera() };
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
      total: Math.max(0, c.lineas.reduce((a, l) => a + l.importe, 0) - (c.cambio?.credito ?? 0)),
      cambio: c.cambio ? (() => {
        const bruto = c.lineas.reduce((a, l) => a + l.importe, 0);
        return { sale_id: c.cambio.sale_id, folio_origen: c.cambio.folio_origen, credito: c.cambio.credito, aplicado: Math.min(c.cambio.credito, bruto), saldo_favor: Math.max(0, c.cambio.credito - bruto), lineas: c.cambio.lineas };
      })() : null,
      vendedora: c.vendedora ?? null,
      promos: c.descuentos?.aplicadas ?? [], cupon: c.descuentos?.cupon ?? null,
      tasa: c.tasa ? { version: c.tasa.version, tasa: c.tasa.tasa, texto: formatoTasa(c.tasa.tasa), hay_nueva: (this.caja.tipoCambio()?.version ?? 0) > c.tasa.version } : null,
      existencias: Object.fromEntries(c.lineas.map((l) => { const e = this.caja.existenciaVerificada(l.item_id); return [l.item_id, { saldo: e.saldo, verificada: e.verificada, limbo: this.caja.saldoLimbo(l.item_id) }]; })),
    };
  }

  aplicarCupon(cartId: string, codigo: string) {
    const cupon = this.caja.aplicarCupon(cartId, codigo);
    return { cupon, carrito: this.vista(cartId) };
  }
  quitarCupon(cartId: string) {
    this.caja.quitarCupon(cartId);
    return { carrito: this.vista(cartId) };
  }
  /** Descuento manual: lo autoriza un supervisor con su clave. */
  aplicarDescuento(cartId: string, d: { linea_id?: string | null; tipo: 'pct' | 'monto'; valor: number }, clave: string) {
    const r = this.caja.aplicarDescuentoManual(cartId, d, clave);
    return { ...r, carrito: this.vista(cartId) };
  }
  /** «Editar en esta venta»: precio (con la clave de un supervisor) y/o descripción de un renglón, solo para esta venta. */
  editarLinea(cartId: string, lineaId: string, d: { precio_unit?: number; descripcion?: string }, clave?: string) {
    this.caja.editarLinea(cartId, lineaId, d, clave);
    return { carrito: this.vista(cartId) };
  }
  /** Departamentos entre los que se elige al dar de alta un artículo en la caja. */
  departamentosAlta() {
    return { departamentos: this.caja.departamentosActivos() };
  }
  /** Alta de un artículo desde la venta: pide la clave del propio cajero y agrega el artículo nuevo a la venta en curso. */
  nuevoArticulo(cartId: string, d: { codigo: string; marca?: string; descripcion: string; estilo?: string; lote?: string; departamento: string; precio: number }, clave: string) {
    const art = this.caja.altaArticuloAutorizada(d, this.actor.usuario, String(clave ?? ''));
    return { articulo: { item_id: art.item_id, item_no: art.item_no, codigo: art.codigo, descripcion: art.descripcion }, ...this.agregarArticulo(cartId, art.item_id) };
  }
  quitarDescuento(cartId: string, lineaId?: string | null) {
    this.caja.quitarDescuentoManual(cartId, lineaId);
    return { carrito: this.vista(cartId) };
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
  confirmarRecepcion(entregaId: string, qty?: number) {
    return this.caja.confirmarRecepcion(entregaId, this.actor.usuario, qty);
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
  buscarConTotal(texto: string, limite = 20) {
    const { resultados, total } = this.caja.buscarConTotal(texto, limite);
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
    const cfg = this.negociosVivos()[v.tienda]!;
    const ticket = construirTicket(v, cfg, n, this.negociosVivos());
    const texto = renderTicketTexto(ticket);
    // El cajón se abre con el cobro en efectivo original, no al reimprimir.
    const bytes = renderTicketEscPos(ticket, { abrirCajon: tipo === 'original', logo: LOGOS_TICKET[v.tienda] });
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
  /** Tarjeta con captura manual del comprobante (la terminal bancaria aún no está integrada). */
  async cobrarTarjetaManual(cartId: string, d: { importe?: number; autorizacion: string; marca?: string; ultimos4?: string }) {
    return this.finalizarCobro(this.caja.cobrarConTarjetaManual(cartId, d, this.actor.usuario));
  }
  private async finalizarCobro(venta: Venta) {
    const yaImpreso = this.caja.impresionesDe(venta.sale_id).some((i) => i.resultado === 'ok');
    const imp = yaImpreso
      ? { ticket_texto: renderTicketTexto(construirTicket(venta, this.negociosVivos()[venta.tienda]!, 0, this.negociosVivos())), codigo_ticket: construirTicket(venta, this.negociosVivos()[venta.tienda]!, 0, this.negociosVivos()).codigo_ticket, impresion: { ok: true } }
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
        sale_id: v.sale_id, caja: v.caja, folio: v.folio, propia: v.propia, codigo_ticket: codigoTicket(v.tienda, v.caja, v.folio, this.negociosVivos()),
        ocurrio_en: v.ocurrio_en, total: v.total ?? null,
        lineas: (v.lineas_detalle ?? v.lineas).map((l: any) => ({ linea_id: l.linea_id, item_id: l.item_id, descripcion: l.descripcion, qty: l.qty, devuelto: l.devuelto ?? null, importe: l.importe ?? null, marca: l.marca ?? null, item_no: l.item_no ?? null, codigo: l.codigo ?? null, tarjeta_regalo: !!l.tarjeta_regalo })),
      })),
    };
  }
  /** «Abrir caja»: manda el pulso al cajón por la impresora sin hacer una venta. Siempre queda registrado (quién, cuándo, motivo y si salió). */
  async abrirCajon(motivo?: string, clave?: string) {
    // Con Vendedoras-Cajeras registradas pide la clave de la propia persona (5 fallos = 5 minutos de bloqueo, como en un retiro).
    if (this.caja.controlesConClave()) {
      if (!clave) throw new ErrorDominio('CLAVE_INVALIDA', 'para abrir la caja teclee su clave');
      this.caja.verificarClaveCajero(this.actor.usuario, String(clave));
    }
    try {
      await this.impresora.imprimir({ ref: `cajon-${Date.now()}`, texto: '', bytes: new Uint8Array([0x1b, 0x70, 0x00, 25, 250]) });
    } catch (e) {
      const error = e instanceof Error ? e.message : String(e);
      this.caja.registrarAperturaCajon({ usuario: this.actor.usuario, motivo, resultado: 'error', error });
      throw new ErrorDominio('CAJON_NO_ABRIO', `no se pudo abrir la caja: ${error}`);
    }
    this.caja.registrarAperturaCajon({ usuario: this.actor.usuario, motivo, resultado: 'ok' });
    return { abierta: true };
  }

  // ── P-06: folios ──
  /** Estado de la serie de folios de esta caja y lo necesario para decidir cómo continuar si está bloqueada. */
  estadoFolios() {
    const st = this.caja.estadoFolios();
    const an = this.caja.anclasDeFolios();
    const visto = this.caja.folioMaximoVisto();
    const conocido = Math.max(st.ultimo, an?.hwm ?? 0, an?.ceiling ?? 0, visto);
    return {
      estado: st.estado, motivo: st.motivo, ultimo: st.ultimo, techo: st.techo,
      hub: { disponible: an !== null, hwm: an?.hwm ?? null, techo: an?.ceiling ?? null },
      visto_en_ticket: visto || null, conocido, sugerido: conocido + 1,
      huecos: this.caja.huecosDeFolio(),
      recuperacion_automatica: this.caja.arrendamientoFolios() && an?.ceiling != null,
      pide_clave: this.caja.controlesConClave(),
      supervisores: this.caja.idx.supervisores().filter((x) => x.activo).map((x) => x.nombre),
    };
  }
  recuperarFolios() {
    const resultado = this.caja.recuperarFolios();
    return { resultado, folios: this.estadoFolios() };
  }
  /** Continuar la serie tras una pérdida: un supervisor confirma el folio siguiente y deja la evidencia en la que se apoya. */
  confirmarFolio(d: { siguiente: number; evidencia: { tipo: string; referencia: string }; sin_anclas?: boolean; autoriza?: { nombre: string; clave: string } }) {
    const autorizo = this.caja.verificarSupervisor(d.autoriza);
    this.caja.atestarSiguienteFolio({ siguiente: d.siguiente, usuario: this.actor.usuario, evidencia: d.evidencia, sinAnclasConfirmado: !!d.sin_anclas, autorizo });
    return { folios: this.estadoFolios() };
  }

  /** «Vendió por»: las personas que pueden figurar como vendedoras (más «Autocompra» = nadie ayudó). */
  vendedoras() {
    return { vendedoras: this.caja.vendedoras(), pide: this.caja.vendedoras().length > 0 };
  }
  asignarVendedora(cartId: string, vendedoraId: string | null) {
    this.caja.asignarVendedora(cartId, vendedoraId);
    return { carrito: this.vista(cartId) };
  }
  /** Cambio: las piezas que regresa la clienta quedan en negativo como crédito de ESTA venta. Sin clave; el dinero solo sale con «devolver dinero». */
  iniciarCambio(cartId: string, saleId: string, renglones: { linea_id: string; qty: number }[]) {
    this.caja.iniciarCambio(cartId, saleId, renglones);
    return { carrito: this.vista(cartId) };
  }
  quitarCambio(cartId: string) {
    this.caja.quitarCambio(cartId);
    return { carrito: this.vista(cartId) };
  }
  /** Quién puede autorizar la devolución de efectivo de un cambio: cualquier Vendedora-Cajera (incluida quien atiende) o supervisor. */
  autorizadoresEfectivo() {
    return { pide_clave: this.caja.controlesConClave(), actual: this.actor.usuario, autorizadores: this.caja.controlesConClave() ? this.caja.autorizadoresPosibles(this.actor.usuario, true) : [] };
  }
  /** «No hay cambio posible, devolver dinero»: entrega en efectivo el saldo del cambio, con la clave de quien lo autoriza. */
  async devolverEfectivoCambio(cartId: string, autoriza?: { nombre: string; clave: string }) {
    const { venta, devolucion: d } = this.caja.devolverEfectivoDeCambio(cartId, this.actor.usuario, autoriza);
    const origen = ventas(this.caja.opsVentas()).get(d.sale_id)!;
    const texto = renderTicketDevolucionTexto(d, origen, this.negociosVivos()[origen.tienda]!, this.negociosVivos());
    let impresion: { ok: boolean; error?: string };
    try {
      await this.impresora.imprimir({ ref: `dev:${d.devolucion_id}`, texto, bytes: renderTextoEscPos(texto, { abrirCajon: d.reembolsos.some((r) => r.metodo === 'efectivo') }) });
      impresion = { ok: true };
    } catch (e) {
      impresion = { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
    const cobro = venta ? await this.finalizarCobro(venta) : null;
    return { devolucion: d, ticket_texto: texto, impresion, venta: cobro?.venta ?? null, ticket_venta: cobro?.ticket_texto ?? null, impresion_venta: cobro?.impresion ?? null };
  }
  async devolver(saleId: string, renglones: { linea_id: string; qty: number }[], motivo: string, autoriza?: { nombre: string; clave: string }) {
    const d = this.caja.devolver({ sale_id: saleId, renglones, motivo, cajero: this.actor.usuario, autoriza });
    const v = ventas(this.caja.opsVentas()).get(saleId)!;
    const texto = renderTicketDevolucionTexto(d, v, this.negociosVivos()[v.tienda]!, this.negociosVivos());
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

  /**
   * Imprime el ticket de regalo de una venta ya cobrada de ESTA caja: la mercancía sin precios y con el código de la compra para el
   * cambio. No abre el cajón ni cuenta como reimpresión del ticket de venta. Una venta cancelada o sin mercancía no tiene ticket de regalo.
   */
  async ticketRegalo(saleId: string) {
    const v = ventas(this.caja.opsVentas()).get(saleId);
    if (!v || v.tienda !== this.caja.tienda || v.caja !== this.caja.caja) throw new ErrorDominio('PROHIBIDO', 'solo se imprimen tickets de regalo de ventas de la propia caja');
    if (v.estado === 'cancelada') throw new ErrorDominio('VENTA_CANCELADA', 'la venta está cancelada: no tiene ticket de regalo');
    const neg = this.negociosVivos();
    const ticket = construirTicketRegalo(v, neg[v.tienda]!, neg);
    if (!ticket) throw new ErrorDominio('SIN_MERCANCIA', 'la venta no tiene mercancía (las tarjetas de regalo no llevan ticket de regalo)');
    const texto = renderTicketTexto(ticket);
    let impresion: { ok: boolean; error?: string };
    try {
      await this.impresora.imprimir({ ref: `regalo-${ticket.codigo_ticket}`, texto, bytes: renderTicketEscPos(ticket, { logo: LOGOS_TICKET[v.tienda] }) });
      impresion = { ok: true };
    } catch (e) {
      impresion = { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
    this.caja.registrarImpresion({ sale_id: saleId, tipo: 'regalo', resultado: impresion.ok ? 'ok' : 'error', error: impresion.error, usuario: this.actor.usuario });
    return { ticket_texto: texto, codigo_ticket: ticket.codigo_ticket, impresion };
  }

  ticketTexto(saleId: string): string {
    const v = ventas(this.caja.opsVentas()).get(saleId);
    if (!v || v.tienda !== this.caja.tienda || v.caja !== this.caja.caja) throw new ErrorDominio('PROHIBIDO', 'solo se consultan tickets de la propia caja');
    const n = this.caja.impresionesDe(saleId).filter((i) => i.tipo === 'reimpresion').length;
    return renderTicketTexto(construirTicket(v, this.negociosVivos()[v.tienda]!, n, this.negociosVivos()));
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
  buscarCodigo?(codigo: string): Articulo[];
}

export class ServicioAdmin {
  readonly actor: Extract<Actor, { rol: 'admin' }>;
  private usuarioInicial: string;
  private autenticado = false;
  /** Con el central en la nube, quien entra ya se identificó con Supabase: aquí solo se le asigna su rol. */
  private nube: { alCerrar: () => void } | null = null;
  /** Rol de quien inició sesión (null con la consola abierta o antes de entrar: se trata como supervisor). */
  private rolUsuario: RolAdmin | null = null;
  private ultimaActividad = 0;
  private reloj: { now(): string };
  private fallos = new Map<string, { n: number; hasta: number }>();
  private fuente: () => Op[];
  readonly cajas: { tienda: string; caja: number }[];
  private inv?: FuenteInventario;
  private central?: { fijarTipoCambio(tasa: number, usuario: string, versionBase: number, confirmarVariacion?: boolean): import('../nodos.ts').ResultadoTipoCambio; asignarPermiso(usuario: string, permiso: string, valor: boolean, por: string): Op; guardarDepto(c: import('../departamentos.ts').CambioDepto, por: string): { ok: true; op: Op } | { ok: false; error: import('../departamentos.ts').ErrorDepto };
    guardarDatosTienda: import('../nodos.ts').Central['guardarDatosTienda']; editarArticulo: import('../nodos.ts').Central['editarArticulo']; guardarPromocion: import('../nodos.ts').Central['guardarPromocion']; guardarRecompensa: import('../nodos.ts').Central['guardarRecompensa']; guardarSupervisor: import('../nodos.ts').Central['guardarSupervisor']; guardarCajero: import('../nodos.ts').Central['guardarCajero']; guardarAdmin: import('../nodos.ts').Central['guardarAdmin']; guardarConfigSesion: import('../nodos.ts').Central['guardarConfigSesion']; recordarSacarAPiso: import('../nodos.ts').Central['recordarSacarAPiso']; resolverFaltante: import('../nodos.ts').Central['resolverFaltante']; contarLimbo: import('../nodos.ts').Central['contarLimbo']; corregirEntrada: import('../nodos.ts').Central['corregirEntrada']; altaLote: import('../nodos.ts').Central['altaLote']; entregar: import('../nodos.ts').Central['entregar'] };
  constructor(o: { actor: Extract<Actor, { rol: 'admin' }>; fuente: () => Op[]; cajas: { tienda: string; caja: number }[]; inventario?: FuenteInventario; central?: ServicioAdmin['central']; reloj?: { now(): string } }) {
    this.central = o.central;
    this.actor = o.actor;
    this.usuarioInicial = o.actor.usuario;
    this.reloj = o.reloj ?? { now: () => new Date().toISOString() };
    this.fuente = o.fuente;
    this.cajas = o.cajas;
    this.inv = o.inventario;
  }
  /** Inventario para Administración: resumen y la tabla lista para Excel. Solo Administración. */
  inventario(completo = false): { resumen: Record<string, unknown>; hoja: Hoja } {
    if (this.actor.rol !== 'admin') throw new ErrorDominio('PROHIBIDO', 'el inventario consolidado es solo de Administración');
    if (!this.inv) throw new ErrorDominio('SIN_INVENTARIO', 'esta sesión no tiene fuente de inventario');
    const arts = this.inv.articulos();
    const ubicaciones = [...this.inv.tiendas, LIMBO]; // El Limbo es una existencia más, compartida por todas las tiendas
    const hoja = hojaInventario(arts, { tiendas: ubicaciones, saldo: this.inv.saldo, verificada: this.inv.verificada });
    const porTienda = Object.fromEntries(ubicaciones.map((t) => {
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
  // ── tiendas: nombre comercial, datos del ticket y política de devolución (editables) ──
  tiendasInfo() {
    const datos = datosTiendas(this.fuente());
    return this.tiendas().map((t) => {
      const f = NEGOCIOS[t];
      const vivo = aplicarDatosTienda(f ?? { nombre: t, letra: t[0] ?? '?', leyendas: [], columnas: 42 }, datos.get(t));
      const fab = f ?? { nombre: t, leyendas: [] as string[] };
      return {
        tienda: t, nombre: vivo.nombre, razon_social: vivo.razon_social ?? '', rfc: vivo.rfc ?? '', direccion: vivo.direccion ?? '', ciudad: vivo.ciudad ?? '', telefono: vivo.telefono ?? '', politica: vivo.leyendas.join('\n'),
        de_fabrica: { nombre: fab.nombre, razon_social: f?.razon_social ?? '', rfc: f?.rfc ?? '', direccion: f?.direccion ?? '', ciudad: f?.ciudad ?? '', telefono: f?.telefono ?? '', politica: fab.leyendas.join('\n') },
      };
    });
  }
  guardarDatosTienda(tienda: string, datos: Record<string, unknown>) {
    if (!this.central) throw new ErrorDominio('SIN_CENTRAL', 'esta sesión no tiene acceso al servicio central');
    const lim: Record<string, string> = {};
    for (const c of ['nombre', 'razon_social', 'rfc', 'direccion', 'ciudad', 'telefono', 'politica']) if (c in datos) lim[c] = String(datos[c] ?? '');
    const r = this.central.guardarDatosTienda(tienda, lim, this.actor.usuario);
    if (!r.ok) throw new ErrorDominio('TIENDA_INVALIDA', r.mensaje);
    return { tiendas: this.tiendasInfo() };
  }
  /** Solo el nombre comercial. */
  guardarNombreTienda(tienda: string, nombre: string) {
    return this.guardarDatosTienda(tienda, { nombre });
  }
  /**
   * Lista y búsqueda de artículos (Inventario y selector de promociones). Sin texto devuelve TODO el catálogo (con `todos`),
   * ordenado por Item #, en páginas: `desde` y `limite`. Cada artículo trae su existencia por tienda y en el almacén.
   */
  buscarArticulos(texto: string, limite = 30, desde = 0, todos = false) {
    const sin = (x: string) => x.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
    const palabras = sin(String(texto ?? '')).split(/\s+/).filter(Boolean);
    const vacio = { articulos: [] as ReturnType<ServicioAdmin['vistaArticulo']>[], total: 0 };
    if (!palabras.length && !todos) return vacio;
    const ops = this.fuente();
    const orden = (a: Articulo) => (a.item_no !== null && /^\d+$/.test(a.item_no) ? Number(a.item_no) : Number.MAX_SAFE_INTEGER);
    const hallados = [...catalogo(ops).values()]
      .filter((a) => !palabras.length || palabras.every((w) => sin(`${a.codigo} ${a.item_no ?? ''} ${a.descripcion} ${a.marca} ${a.estilo} ${a.lote} ${a.departamento}`).includes(w)))
      .sort((x, y) => orden(x) - orden(y) || x.item_id.localeCompare(y.item_id));
    const ex = existenciaAlmacen(ops);
    return { articulos: hallados.slice(Math.max(0, desde), Math.max(0, desde) + limite).map((a) => this.vistaArticulo(a, ex.get(a.item_id)?.existencia ?? 0)), total: hallados.length, tiendas: this.tiendas() };
  }
  private vistaArticulo(a: Articulo, almacen?: number) {
    const existencias: Record<string, number> = {};
    if (this.inv) for (const t of this.inv.tiendas) existencias[t] = this.inv.saldo(t, a.item_id);
    return {
      item_id: a.item_id, item_no: a.item_no, codigo: a.codigo, descripcion: a.descripcion, marca: a.marca, estilo: a.estilo, lote: a.lote, departamento: a.departamento,
      precio: a.precio, existencias, almacen: almacen ?? 0, limbo: this.inv ? this.inv.saldo(LIMBO, a.item_id) : 0,
    };
  }
  // ── conteo físico de El Limbo ──
  private lineaLimbo(a: Articulo) {
    return { item_id: a.item_id, item_no: a.item_no, codigo: a.codigo, descripcion: a.descripcion, marca: a.marca, estilo: a.estilo, precio: a.precio, sistema: this.inv!.saldo(LIMBO, a.item_id) };
  }
  /** Artículo(s) de un código escaneado o tecleado y lo que El Limbo tiene registrado de cada uno. */
  buscarLimbo(codigo: string) {
    if (!this.inv?.buscarCodigo) throw new ErrorDominio('SIN_INVENTARIO', 'esta sesión no tiene fuente de inventario');
    const c = String(codigo ?? '').replace(/[\r\n]+$/g, '').trim();
    return { articulos: c ? this.inv.buscarCodigo(c).map((a) => this.lineaLimbo(a)) : [] };
  }
  /** Revisa un archivo de conteo (CODIGO y CANTIDAD contada): qué artículos reconoce, cuáles no y la diferencia contra El Limbo. No guarda nada. */
  revisarConteoLimbo(filas: { codigo: string; cantidad: unknown }[]) {
    if (!this.inv?.buscarCodigo) throw new ErrorDominio('SIN_INVENTARIO', 'esta sesión no tiene fuente de inventario');
    const reconocidas: (ReturnType<ServicioAdmin['lineaLimbo']> & { contado: number })[] = [];
    const noEncontradas: { codigo: string }[] = [];
    const invalidas: { codigo: string; cantidad: unknown }[] = [];
    const ambiguas: { codigo: string; candidatos: number }[] = [];
    const vistos = new Map<string, number>();
    for (const f of filas) {
      const codigo = String(f.codigo ?? '').trim();
      const cant = typeof f.cantidad === 'number' ? f.cantidad : Number(String(f.cantidad ?? '').trim());
      if (!codigo) continue;
      if (!Number.isInteger(cant) || cant < 0) { invalidas.push({ codigo, cantidad: f.cantidad }); continue; }
      const hallados = this.inv.buscarCodigo(codigo);
      if (!hallados.length) { noEncontradas.push({ codigo }); continue; }
      if (hallados.length > 1) { ambiguas.push({ codigo, candidatos: hallados.length }); continue; }
      const a = hallados[0]!;
      const i = vistos.get(a.item_id);
      if (i === undefined) { vistos.set(a.item_id, reconocidas.length); reconocidas.push({ ...this.lineaLimbo(a), contado: cant }); } else reconocidas[i]!.contado += cant; // el mismo código en varios renglones se suma
    }
    return { reconocidas, noEncontradas, invalidas, ambiguas };
  }
  /** Aplica un conteo: deja El Limbo de cada artículo contado en lo contado (los no contados no se tocan). */
  contarLimbo(d: { conteo_id: string; lineas: { item_id: string; contado: number }[] }) {
    if (!this.central) throw new ErrorDominio('SIN_CENTRAL', 'esta sesión no tiene acceso al servicio central');
    const r = this.central.contarLimbo(String(d.conteo_id ?? ''), (d.lineas ?? []).map((l) => ({ item_id: String(l.item_id), contado: Number(l.contado) })), this.actor.usuario);
    return { conteo: this.resumenConteoLimbo(r), conteos: this.conteosLimbo() };
  }
  private resumenConteoLimbo(c: { conteo_id: string; por: string; ocurrio_en: string; lineas: { delta: number }[] }) {
    return {
      conteo_id: c.conteo_id, por: c.por, ocurrio_en: c.ocurrio_en, articulos: c.lineas.length,
      con_diferencia: c.lineas.filter((l) => l.delta !== 0).length, sobrantes: c.lineas.filter((l) => l.delta > 0).reduce((a, l) => a + l.delta, 0), faltantes: -c.lineas.filter((l) => l.delta < 0).reduce((a, l) => a + l.delta, 0),
    };
  }
  /** Conteos de El Limbo, el más reciente primero. */
  conteosLimbo() {
    return this.fuente().filter((o) => o.tipo === 'limbo.conteo').map((o) => this.resumenConteoLimbo({ ...o.payload, ocurrio_en: o.ocurrio_en })).reverse();
  }
  /** Edita un artículo del catálogo (marca, descripción, estilo, lote, departamento, precio en pesos). */
  editarArticulo(itemId: string, cambios: Record<string, unknown>) {
    if (!this.central) throw new ErrorDominio('SIN_CENTRAL', 'esta sesión no tiene acceso al servicio central');
    if ('precio' in cambios && this.rol() !== 'supervisor') throw new ErrorDominio('PROHIBIDO', 'solo un supervisor puede cambiar el precio de un artículo');
    const lim: Record<string, string | number> = {};
    for (const k of CAMPOS_EDITABLES) if (k in cambios) lim[k] = k === 'precio' ? Number(cambios[k]) : String(cambios[k] ?? '');
    const a = this.central.editarArticulo(itemId, lim, this.actor.usuario);
    return { articulo: this.vistaArticulo(a, existenciaAlmacen(this.fuente()).get(itemId)?.existencia ?? 0) };
  }
  /** Qué le ha pasado a un artículo: alta, cambios, almacén, ventas, cancelaciones, devoluciones y conteos. */
  historialArticulo(itemId: string) {
    const ops = this.fuente();
    const a = catalogo(ops).get(itemId);
    if (!a) throw new ErrorDominio('ARTICULO_INEXISTENTE', itemId);
    const nombres = nombresTienda(ops);
    const t = (c: string) => nombres.get(c) ?? NEGOCIOS[c]?.nombre ?? c;
    const NOM: Record<string, string> = { descripcion: 'Descripción', marca: 'Marca', estilo: 'Estilo', lote: 'Lote', departamento: 'Departamento', precio: 'Precio' };
    const val = (campo: string, v: unknown) => (campo === 'precio' ? formatoMXN(Number(v)) : `«${String(v ?? '')}»`);
    const pza = (n: number) => `${n} pieza${n === 1 ? '' : 's'}`;
    const eventos = historialArticulo(ops, itemId).map((e) => {
      const d = e.datos as any;
      let evento = '', detalle = '';
      switch (e.tipo) {
        case 'alta': evento = 'Alta en el catálogo'; detalle = `Origen: ${d.origen ?? '—'} · código ${d.codigo || '(sin código)'} · precio ${formatoMXN(d.precio ?? 0)}`; break;
        case 'cambio': evento = 'Cambio en el catálogo'; detalle = Object.entries(d.cambios as Record<string, { antes: unknown; despues: unknown }>).map(([k, c]) => `${NOM[k] ?? k}: ${val(k, c.antes)} → ${val(k, c.despues)}`).join(' · '); break;
        case 'almacen_correccion': evento = 'Corrección de una entrada al almacén'; detalle = `${d.qty !== undefined ? `cantidad ${d.qty_antes} → ${d.qty}` : ''}${d.pedimento !== undefined ? ` pedimento «${d.pedimento_antes ?? ''}» → «${d.pedimento ?? ''}»` : ''} · ${String(d.motivo ?? '')}`.trim(); break;
        case 'almacen_entrada': evento = 'Entrada al almacén'; detalle = `${pza(d.qty)}${d.pedimento ? ` · pedimento ${d.pedimento}` : ''} · ${String(d.fuente ?? '')}`; break;
        case 'almacen_entrega': evento = 'Entrega a tienda'; detalle = `${pza(d.qty)} para ${t(d.tienda)}${d.exceso ? ' · más de lo registrado en el almacén' : ''}`; break;
        case 'recepcion': evento = 'Recepción confirmada'; detalle = `${pza(d.qty)} en ${t(d.tienda)} (caja ${d.caja})`; break;
        case 'venta': evento = 'Venta'; detalle = `${pza(d.qty)} por ${formatoMXN(d.importe)} · ${t(d.tienda)} caja ${d.caja}, folio ${String(d.folio).padStart(6, '0')}`; break;
        case 'venta_cancelada': evento = 'Venta cancelada'; detalle = `${pza(d.qty)} · ${t(d.tienda)} caja ${d.caja}, folio ${String(d.folio).padStart(6, '0')}${d.motivo ? ` · ${d.motivo}` : ''}`; break;
        case 'devolucion': evento = 'Devolución'; detalle = `${pza(d.qty)} por ${formatoMXN(d.importe)} · ${t(d.tienda)} caja ${d.caja}, folio ${String(d.folio).padStart(6, '0')}${d.motivo ? ` · ${d.motivo}` : ''}`; break;
        case 'conteo': evento = 'Conteo físico'; detalle = `Ajuste de ${d.delta > 0 ? '+' : ''}${d.delta} en ${d.tienda === LIMBO ? 'El Limbo' : t(d.tienda)}`; break;
      }
      return { ocurrio_en: e.ocurrio_en, tipo: e.tipo, evento, detalle, por: e.por };
    });
    return { articulo: { item_id: a.item_id, item_no: a.item_no, codigo: a.codigo, descripcion: a.descripcion, marca: a.marca }, eventos };
  }

  // ── promociones, cupones y supervisores ──
  promociones() {
    const ops = this.fuente();
    const hoy = fechaLocal(new Date().toISOString());
    const usos = new Map<string, number>();
    for (const v of ventas(ops).values()) if (v.estado === 'confirmada') for (const id of new Set(v.lineas.flatMap((l) => (l.descuento_detalle ?? []).filter((d) => d.tipo !== 'manual').map((d) => d.ref)))) usos.set(id, (usos.get(id) ?? 0) + 1);
    const promos = promocionesDe(ops);
    const cat = catalogo(ops);
    const articulos: Record<string, ReturnType<ServicioAdmin['vistaArticulo']>> = {};
    for (const p of promos) for (const id of p.alcance?.item_ids ?? []) { const a = cat.get(id); if (a) articulos[id] = this.vistaArticulo(a); }
    return { hoy, tiendas: this.tiendasInfo(), articulos, promociones: promos.map((p) => ({ ...p, estado: estadoPromo(p, hoy), usos: usos.get(p.id) ?? 0 })) };
  }
  /** Reglas de recompensa (cupones que se imprimen en el ticket), con cuántos cupones se han regalado y canjeado de cada una. */
  recompensas() {
    const ops = this.fuente();
    const vs = [...ventas(ops).values()];
    const regaladas = new Map<string, number>(), canjeadas = new Map<string, number>();
    const emitidas = new Map<string, string>(); // código → regla
    for (const v of vs) if (v.estado === 'confirmada') for (const e of v.recompensas ?? []) { regaladas.set(e.regla_id, (regaladas.get(e.regla_id) ?? 0) + 1); emitidas.set(e.codigo, e.regla_id); }
    for (const v of vs) if (v.estado === 'confirmada') for (const cod of new Set(v.lineas.flatMap((l) => (l.descuento_detalle ?? []).filter((d) => d.tipo === 'cupon').map((d) => d.ref)))) { const r = emitidas.get(cod); if (r) canjeadas.set(r, (canjeadas.get(r) ?? 0) + 1); }
    const hoy = fechaLocal(new Date().toISOString());
    return { hoy, tiendas: this.tiendasInfo(), recompensas: recompensasDe(ops).map((r) => ({ ...r, regaladas: regaladas.get(r.id) ?? 0, canjeadas: canjeadas.get(r.id) ?? 0, estado: !r.activa ? 'inactiva' : r.inicio && hoy < r.inicio ? 'programada' : r.fin && hoy > r.fin ? 'vencida' : 'activa' })) };
  }
  guardarRecompensa(r: ReglaRecompensa) {
    if (!this.central) throw new ErrorDominio('SIN_CENTRAL', 'esta sesión no tiene acceso al servicio central');
    const g = this.central.guardarRecompensa(r, this.actor.usuario);
    if (!g.ok) throw new ErrorDominio(g.error.codigo === 'NO_EXISTE' ? 'NO_ENCONTRADO' : 'RECOMPENSA_INVALIDA', g.error.mensaje, { motivo: g.error.codigo });
    return { ...this.recompensas(), guardada: g.regla };
  }
  guardarPromocion(p: Promocion) {
    if (!this.central) throw new ErrorDominio('SIN_CENTRAL', 'esta sesión no tiene acceso al servicio central');
    const r = this.central.guardarPromocion(p, this.actor.usuario);
    if (!r.ok) throw new ErrorDominio(r.error.codigo === 'NO_EXISTE' ? 'NO_ENCONTRADO' : 'PROMOCION_INVALIDA', r.error.mensaje, { motivo: r.error.codigo });
    return { ...this.promociones(), guardada: r.promo };
  }
  // ── inicio de sesión de Administración ──
  /** Con al menos un administrador activo se pide usuario y contraseña; mientras no haya ninguno, la consola está abierta para crear el primero. */
  requiereLogin(): boolean {
    return this.nube !== null || administradoresDe(this.fuente()).some((a) => a.activo);
  }
  /** Central en la nube: la identidad y el rol los da Supabase (tabla pos.admins); `alCerrar` se llama al cerrar la sesión (también por inactividad). */
  abrirSesionNube(alias: string, rol: RolAdmin, alCerrar: () => void) {
    this.nube = { alCerrar };
    this.actor.usuario = alias;
    this.rolUsuario = rol;
    this.autenticado = true;
    this.tocar();
    return this.sesionInfo();
  }
  autenticada(): boolean {
    if (!this.requiereLogin()) return true;
    if (this.autenticado && !this.nube && !administradoresDe(this.fuente()).some((a) => a.activo && nombreClave(a.nombre) === nombreClave(this.actor.usuario))) this.cerrarSesion();
    const limite = configSesionDe(this.fuente()).admin_min * 60000;
    if (this.autenticado && limite > 0 && this.ahoraMs() - this.ultimaActividad > limite) this.cerrarSesion(); // inactividad
    return this.autenticado;
  }
  private ahoraMs() { return Date.parse(this.reloj.now()); }
  tocar() { this.ultimaActividad = this.ahoraMs(); }
  /** Minutos de inactividad que cierran la sesión de la caja y la de Administración (0 = nunca). */
  configSesion() { return configSesionDe(this.fuente()); }
  guardarConfigSesion(d: { caja_min: number; admin_min: number }) {
    if (!this.central) throw new ErrorDominio('SIN_CENTRAL', 'esta sesión no tiene acceso al servicio central');
    const r = this.central.guardarConfigSesion(d, this.actor.usuario);
    if (!r.ok) throw new ErrorDominio('DATOS_INVALIDOS', r.mensaje);
    return this.configSesion();
  }
  sesionInfo() {
    const dentro = this.autenticada();
    const limite = configSesionDe(this.fuente()).admin_min * 60;
    return {
      requiere_login: this.requiereLogin(), autenticado: dentro, usuario: dentro ? this.actor.usuario : null, rol_usuario: dentro ? this.rol() : null, sin_administradores: !this.requiereLogin(),
      inactividad: dentro && this.requiereLogin() && limite > 0 ? { limite_seg: limite, restante_seg: Math.max(0, Math.ceil((this.ultimaActividad + limite * 1000 - this.ahoraMs()) / 1000)) } : null,
    };
  }
  /** Cinco contraseñas equivocadas seguidas bloquean ese usuario 5 minutos. */
  iniciarSesion(usuario: string, clave: string) {
    const nombre = String(usuario ?? '').trim();
    const llave = nombreClave(nombre);
    const f = this.fallos.get(llave) ?? { n: 0, hasta: 0 };
    const ahora = Date.now();
    if (f.hasta > ahora) throw new ErrorDominio('CLAVE_BLOQUEADA', `demasiados intentos con una contraseña equivocada: espere ${Math.ceil((f.hasta - ahora) / 60000)} minuto(s)`);
    const a = administradoresDe(this.fuente()).find((x) => x.activo && nombreClave(x.nombre) === llave);
    if (!a || a.hash !== hashClave(a.sal, String(clave ?? ''))) {
      const n = f.n + 1;
      this.fallos.set(llave, n >= 5 ? { n: 0, hasta: ahora + 5 * 60000 } : { n, hasta: 0 });
      throw new ErrorDominio('CLAVE_INVALIDA', 'usuario o contraseña incorrectos');
    }
    this.fallos.delete(llave);
    this.actor.usuario = a.nombre;
    this.rolUsuario = a.rol ?? 'supervisor';
    this.autenticado = true;
    this.tocar();
    return this.sesionInfo();
  }
  cerrarSesion() {
    const estaba = this.autenticado;
    this.autenticado = false;
    this.actor.usuario = this.usuarioInicial;
    this.rolUsuario = null;
    const info = this.sesionInfo();
    if (estaba) this.nube?.alCerrar();
    return info;
  }
  rol(): RolAdmin { return this.rolUsuario ?? 'supervisor'; }
  /** Pantallas de Administración que ve cada rol (el almacenista solo trabaja Inventario y Almacén). */
  nav(): string[] {
    return this.rol() === 'almacenista' ? ['inventario', 'almacen'] : ['inventario', 'almacen', 'promociones', 'tarjetas', 'reportes', 'cortes', 'configuracion'];
  }
  /** ¿El rol de la sesión puede llamar a esta ruta de Administración? El supervisor, todo; el almacenista, solo lo de Inventario y Almacén. */
  puede(metodo: string, ruta: string): boolean {
    if (this.rol() === 'supervisor') return true;
    return /^(GET|POST) \/api\/admin\/(almacen|limbo)(\/|$)/.test(`${metodo} ${ruta}`) || /^GET \/api\/admin\/(inventario|entregas|articulos|articulo\/historial|departamentos|tipo-cambio)$/.test(`${metodo} ${ruta}`) || `${metodo} ${ruta}` === 'POST /api/admin/articulos';
  }
  administradores() {
    return { administradores: administradoresDe(this.fuente()).map(({ id, nombre, activo, rol, perfil }) => ({ id, nombre, activo, perfil: perfil ?? null, rol: rol ?? 'supervisor', clave_caja: supervisoresDe(this.fuente()).some((s) => s.id === `sup-${id.slice(4)}`) })) };
  }
  guardarAdmin(d: { id?: string; nombre?: string; clave?: string; activo?: boolean; rol?: RolAdmin; clave_caja?: string; perfil?: Partial<Perfil> }) {
    if (!this.central) throw new ErrorDominio('SIN_CENTRAL', 'esta sesión no tiene acceso al servicio central');
    const abierta = !this.requiereLogin();
    const r = this.central.guardarAdmin(d, this.actor.usuario);
    if (!r.ok) throw new ErrorDominio(r.error.codigo === 'NO_EXISTE' ? 'NO_ENCONTRADO' : 'ADMIN_INVALIDO', r.error.mensaje, { motivo: r.error.codigo });
    // Quien crea al primer administrador desde la consola abierta queda dentro como ese administrador: no se queda fuera de su propia pantalla.
    if (abierta && r.admin.activo) { this.autenticado = true; this.actor.usuario = r.admin.nombre; this.rolUsuario = r.admin.rol; this.tocar(); }
    return this.administradores();
  }
  cajeros() {
    return { cajeros: cajerosDe(this.fuente()).map(({ id, nombre, activo, perfil }) => ({ id, nombre, activo, perfil: perfil ?? null })) };
  }
  guardarCajero(d: { id?: string; nombre?: string; clave?: string; activo?: boolean; perfil?: Partial<Perfil> }) {
    if (!this.central) throw new ErrorDominio('SIN_CENTRAL', 'esta sesión no tiene acceso al servicio central');
    const r = this.central.guardarCajero(d, this.actor.usuario);
    if (!r.ok) throw new ErrorDominio(r.error.codigo === 'NO_EXISTE' ? 'NO_ENCONTRADO' : 'CAJERO_INVALIDO', r.error.mensaje, { motivo: r.error.codigo });
    return this.cajeros();
  }
  supervisores() {
    return { supervisores: supervisoresDe(this.fuente()).map(({ id, nombre, activo }) => ({ id, nombre, activo })) };
  }
  guardarSupervisor(d: { id?: string; nombre?: string; clave?: string; activo?: boolean }) {
    if (!this.central) throw new ErrorDominio('SIN_CENTRAL', 'esta sesión no tiene acceso al servicio central');
    const r = this.central.guardarSupervisor(d, this.actor.usuario);
    if (!r.ok) throw new ErrorDominio(r.error.codigo === 'NO_EXISTE' ? 'NO_ENCONTRADO' : 'SUPERVISOR_INVALIDO', r.error.mensaje, { motivo: r.error.codigo });
    return this.supervisores();
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
    const piso = recordatoriosPiso(ops);
    const items = [...ex.values()].filter((e) => cat.has(e.item_id)).map((e) => {
      const a = cat.get(e.item_id)!;
      return {
        item_id: a.item_id, item_no: a.item_no, codigo: a.codigo, marca: a.marca, descripcion: a.descripcion, estilo: a.estilo, lote: a.lote, departamento: a.departamento, precio: a.precio,
        pedimentos: e.pedimentos, recibido: e.recibido, entregado: e.entregado, existencia: e.existencia, pendiente_por_tienda: pend.get(a.item_id) ?? {},
        sacar_a_piso: piso.get(a.item_id) ?? null,
      };
    }).sort((x, y) => Number(y.item_no ?? 0) - Number(x.item_no ?? 0));
    const hoy = fechaLocal(new Date().toISOString());
    const faltantes = this.faltantesVista(ops, cat);
    const pendientes = faltantes.filter((f) => f.estado === 'pendiente');
    return { tiendas, hoy, items, avisos: this.avisosPiso(items, hoy), faltantes, aviso_faltantes: { entregas: pendientes.length, piezas: pendientes.reduce((n, f) => n + f.pendiente, 0) } };
  }
  /** Piezas faltantes (la tienda recibió menos de lo entregado): primero las pendientes, luego las resueltas. */
  private faltantesVista(ops: Op[], cat: ReturnType<typeof catalogo>) {
    return faltantes(ops).map((f) => {
      const a = cat.get(f.item_id);
      return { ...f, item_no: a?.item_no ?? null, codigo: a?.codigo ?? '', descripcion: a?.descripcion ?? f.item_id, marca: a?.marca ?? '' };
    }).sort((x, y) => Number(x.estado === 'resuelto') - Number(y.estado === 'resuelto') || y.reportada_en.localeCompare(x.reportada_en));
  }
  /** Entradas de almacén de un artículo (con su corrección vigente) para revisarlas o corregirlas. */
  entradasAlmacen(itemId: string) {
    return { entradas: entradasDeArticulo(this.fuente(), itemId) };
  }
  /** Corrige una entrada de almacén mal capturada (cantidad y/o pedimento). */
  corregirEntrada(d: { correccion_id: string; entrada_id: string; qty?: number; pedimento?: string | null; motivo: string; confirmar_negativo?: boolean }) {
    if (!this.central) throw new ErrorDominio('SIN_CENTRAL', 'esta sesión no tiene acceso al servicio central');
    const r = this.central.corregirEntrada(d, this.actor.usuario);
    if (!r.ok) throw new ErrorDominio('CONFIRMACION_REQUERIDA', `con esta corrección el almacén quedaría en ${r.existencia} pieza(s): ya se entregaron piezas de más`, { existencia: r.existencia });
    return { existencia: r.existencia, almacen: this.almacen() };
  }
  /** Ubica (o corrige) las piezas faltantes de una entrega: total por destino (almacen, perdida o tienda). */
  resolverFaltante(entregaId: string, destinos: Record<string, number>) {
    if (!this.central) throw new ErrorDominio('SIN_CENTRAL', 'esta sesión no tiene acceso al servicio central');
    this.central.resolverFaltante(entregaId, destinos, this.actor.usuario);
    return this.almacen();
  }
  /** Fechas de «sacar a piso» con artículos que aún tienen piezas en el almacén. Urgente: faltan 7 días o menos, o ya pasó. */
  private avisosPiso(items: { sacar_a_piso: string | null; existencia: number }[], hoy: string) {
    const por = new Map<string, number>();
    for (const i of items) if (i.sacar_a_piso && i.existencia > 0) por.set(i.sacar_a_piso, (por.get(i.sacar_a_piso) ?? 0) + 1);
    return [...por].sort((a, b) => a[0].localeCompare(b[0])).map(([fecha, articulos]) => ({ fecha, articulos, dias: diasHasta(hoy, fecha), urgente: diasHasta(hoy, fecha) <= DIAS_URGENTE }));
  }
  /** Entregas del almacén a las tiendas (por periodo y tienda) con su recepción y las diferencias detectadas. */
  entregasAlmacen(f: { desde?: string; hasta?: string; tienda?: string } = {}) {
    const ops = this.fuente();
    return reporteEntregas(ops, catalogo(ops), f, fechaLocal(new Date().toISOString()));
  }
  hojaEntregas(f: { desde?: string; hasta?: string; tienda?: string } = {}): Hoja {
    return hojaEntregas(this.entregasAlmacen(f));
  }
  /** Recordatorio interno: fecha en que se debe sacar el artículo a piso. */
  fijarSacarAPiso(itemId: string, fecha: string | null) {
    if (!this.central) throw new ErrorDominio('SIN_CENTRAL', 'esta sesión no tiene acceso al servicio central');
    this.central.recordarSacarAPiso(itemId, fecha || null, this.actor.usuario);
    return this.almacen();
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
  /** Promociones, cupones y descuentos autorizados por supervisor, con el ticket de cada uno. */
  descuentos(f: Filtro = {}) {
    return descuentosPorCaja(this.actor, this.fuente(), f);
  }
  hojaDescuentos(f: Filtro = {}): Hoja {
    return hojaDescuentos(this.descuentos(f));
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
  /** Ventas por vendedora con su nombre completo (el alias es lo que se ve en caja; aquí también nombres y apellidos). */
  reporteVendedoras(f: Filtro = {}) {
    const ops = this.fuente();
    const nombres = new Map<string, string>();
    for (const c of cajerosDe(ops)) if (c.perfil) nombres.set(c.id, `${c.perfil.nombres} ${c.perfil.apellidos}`.trim());
    for (const a of administradoresDe(ops)) if (a.perfil) nombres.set(`sup-${a.id.slice(4)}`, `${a.perfil.nombres} ${a.perfil.apellidos}`.trim());
    return { vendedoras: ventasPorVendedora(this.actor, ops, f).map((r) => ({ ...r, nombre_completo: nombres.get(r.clave) ?? '' })) };
  }
  ventas(f: Filtro = {}) {
    return ventasPorCaja(this.actor, this.fuente(), f);
  }
  cortes(f: Filtro = {}) {
    return cortesPorCaja(this.actor, this.fuente(), f);
  }
}
