import { cortesPorCaja, reporteConsolidado, ventasPorCaja, type Filtro } from '../consultas.ts';
import { ErrorDominio } from '../errores.ts';
import type { Impresora } from '../impresion.ts';
import type { Caja } from '../nodos.ts';
import { catalogo, ventas } from '../proyecciones.ts';
import { hojaInventario, type Hoja } from '../inventario.ts';
import { construirTicket, NEGOCIOS, renderTicketEscPos, renderTicketTexto, type NegocioCfg } from '../ticket.ts';
import type { Actor, Articulo, Linea, Op } from '../tipos.ts';
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
      ahora, fecha_local: fechaLocal(ahora),
      ultimo_folio: this.caja.estadoFolios().ultimo,
      folios: this.caja.estadoFolios().estado,
      conexion: { hub: this.conexion.hubAlcanzable(), internet: this.conexion.internet(), pendientes: this.conexion.pendientes(), ultima_sync: this.conexion.ultimaSync() },
      alertas: {
        perdida_documental_abierta: this.caja.perdidasDocumentalesAbiertas().length,
        articulos_no_verificados: this.caja.articulosNoVerificados().length,
      },
    };
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
    };
  }

  escanear(cartId: string, codigo: string) {
    return { ...this.caja.escanear(cartId, codigo), carrito: this.vista(cartId) };
  }
  /**
   * Agregar desde un resultado de búsqueda. Un artículo con código duplicado NO se ofrece al cajero: la elección
   * provisional (alternativa de ensayo, P-13 pendiente) existe en el motor pero esta capa no la expone.
   */
  agregarArticulo(cartId: string, itemId: string) {
    const art = this.caja.idx.articulo(itemId);
    if (!art) throw new ErrorDominio('ARTICULO_INEXISTENTE', itemId);
    if (this.caja.buscarPorCodigo(art.codigo).length > 1) {
      throw new ErrorDominio('CODIGO_AMBIGUO', 'código duplicado: requiere resolución de Administración');
    }
    return { ...this.caja.agregarPorId(cartId, itemId), carrito: this.vista(cartId) };
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
  async cobrarEfectivo(cartId: string, recibido: number) {
    const venta = this.caja.cobrarEfectivo(cartId, recibido, this.actor.usuario);
    const yaImpreso = this.caja.impresionesDe(venta.sale_id).some((i) => i.resultado === 'ok');
    const imp = yaImpreso
      ? { ticket_texto: renderTicketTexto(construirTicket(venta, this.negocios[venta.tienda]!, 0, this.negocios)), codigo_ticket: construirTicket(venta, undefined, 0, this.negocios).codigo_ticket, impresion: { ok: true } }
      : await this.imprimirVenta(venta.sale_id, 'original', 0);
    return { venta, avisos: venta.avisos ?? [], ...imp, cambio: (venta.pagos[0]?.cambio ?? 0) };
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
  constructor(o: { actor: Extract<Actor, { rol: 'admin' }>; fuente: () => Op[]; cajas: { tienda: string; caja: number }[]; inventario?: FuenteInventario }) {
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
