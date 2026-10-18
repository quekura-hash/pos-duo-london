import { ErrorDominio } from '../errores.ts';
import type { ServicioAdmin, ServicioCaja } from './servicio.ts';

const STATUS: Record<string, number> = { PROHIBIDO: 403, ARTICULO_INEXISTENTE: 404, CARRITO_INEXISTENTE: 404, LINEA_INEXISTENTE: 404, NO_ENCONTRADO: 404, CLAVE_INVALIDA: 403 };

export interface Respuesta {
  status: number;
  json: any;
}

/**
 * Enrutador de la API de la aplicación, independiente del transporte: lo usan el servidor HTTP local y la versión que corre
 * dentro del navegador. Una sesión es de cajero (atada a su caja) o de Administración.
 */
export async function atender(o: { cajero?: ServicioCaja; admin?: ServicioAdmin }, metodo: string, url: URL, b: any): Promise<Respuesta> {
  const C = o.cajero;
  const A = o.admin;
  const q = url.searchParams;
  const ok = (cuerpo: object): Respuesta => ({ status: 200, json: { ok: true, ...cuerpo } });
  try {
    const exigirCajero = () => {
      if (!C) throw new ErrorDominio('PROHIBIDO', 'esta sesión no es de cajero');
      return C;
    };
    const exigirAdmin = () => {
      if (!A) throw new ErrorDominio('PROHIBIDO', 'esta sesión no es de Administración');
      return A;
    };
    const cajasParam = (v: string | null) => (v ? v.split(',').map((x) => ({ tienda: x.split('/')[0]!, caja: Number(x.split('/')[1]) })) : undefined);

    switch (`${metodo} ${url.pathname}`) {
      case 'GET /api/sesion':
        return ok(C
          ? { rol: 'cajero', usuario: C.actor.usuario, tienda: C.caja.tienda, caja: C.caja.caja, nav: ['venta', 'ventas', 'corte', ...(C.caja.cfg.metodos.includes('tarjeta_regalo') ? ['tarjetas'] : [])] }
          : { rol: 'admin', usuario: A!.actor.usuario, cajas: A!.cajas, nav: ['reportes', 'cortes', 'dolares', 'descuentos', 'inventario', 'almacen', 'promociones', 'tiendas', 'departamentos', 'tarjetas', 'tipo_cambio'] });
      // ── cajero ──
      case 'GET /api/estado': return ok({ estado: exigirCajero().estado() });
      case 'POST /api/venta/actual': { const c = exigirCajero(); const cart = c.carritoActual(); return ok({ cart, carrito: c.vista(cart) }); }
      case 'POST /api/venta/nueva': { const c = exigirCajero(); const cart = c.nuevaVenta(); return ok({ cart, carrito: c.vista(cart) }); }
      case 'POST /api/venta/escanear': return ok(exigirCajero().escanear(b.cart, String(b.codigo ?? '')));
      case 'POST /api/venta/agregar': return ok(exigirCajero().agregarArticulo(b.cart, b.item_id));
      case 'POST /api/venta/cupon': return ok(exigirCajero().aplicarCupon(b.cart, String(b.codigo ?? '')));
      case 'POST /api/venta/cupon/quitar': return ok(exigirCajero().quitarCupon(b.cart));
      case 'POST /api/venta/descuento': return ok(exigirCajero().aplicarDescuento(b.cart, { linea_id: b.linea_id ?? null, tipo: b.tipo === 'monto' ? 'monto' : 'pct', valor: Number(b.valor) }, String(b.clave ?? '')));
      case 'POST /api/venta/descuento/quitar': return ok(exigirCajero().quitarDescuento(b.cart, b.linea_id ?? null));
      case 'POST /api/venta/cantidad': return ok({ carrito: exigirCajero().cambiarCantidad(b.cart, b.linea_id, Number(b.qty)) });
      case 'POST /api/venta/quitar': return ok({ carrito: exigirCajero().quitarLinea(b.cart, b.linea_id) });
      case 'POST /api/venta/cobrar-efectivo': return ok(await exigirCajero().cobrarEfectivo(b.cart, Number(b.recibido ?? 0), Number(b.usd ?? 0)));
      case 'POST /api/venta/tasa': return ok(exigirCajero().bloquearTasa(b.cart, !!b.renovar));
      case 'GET /api/tipo-cambio': return ok({ tipo_cambio: exigirCajero().tipoCambio() });
      case 'POST /api/tipo-cambio': return ok({ tipo_cambio: await exigirCajero().fijarTipoCambio(Number(b.tasa), !!b.confirmar) });
      case 'POST /api/efectivo/movimiento': return ok({ corte: exigirCajero().movimientoEfectivo(b.tipo, Number(b.monto), b.moneda ?? 'MXN') });
      case 'POST /api/efectivo/conteo-usd': return ok(exigirCajero().registrarConteoUsd(b.denominaciones ?? {}));
      case 'POST /api/efectivo/conteo': return ok(exigirCajero().registrarConteo(b.moneda === 'USD' ? 'USD' : 'MXN', b.denominaciones ?? {}));
      case 'POST /api/efectivo/billete-rechazado': return ok(exigirCajero().billeteRechazado(Number(b.denominacion), b.motivo, b.nota, b.cantidad === undefined ? 1 : Number(b.cantidad)));
      case 'POST /api/venta/anular': return ok(exigirCajero().anularVenta(b.cart, String(b.motivo ?? 'anulada')));
      case 'POST /api/venta/cancelar': return ok(exigirCajero().cancelarVenta(b.sale_id, String(b.motivo ?? 'cancelada')));
      case 'POST /api/venta/cobrar-regalo': return ok(await exigirCajero().cobrarTarjetaRegalo(b.cart, String(b.codigo ?? ''), b.recibido === undefined || b.recibido === null ? undefined : Number(b.recibido), Number(b.usd ?? 0)));
      case 'GET /api/tarjeta': return ok({ tarjeta: exigirCajero().consultarTarjeta(q.get('codigo') ?? '') });
      case 'POST /api/tarjeta/alta': return ok(await exigirCajero().altaTarjetaRegalo(String(b.codigo ?? ''), Number(b.monto), b.recibido === undefined ? undefined : Number(b.recibido), b.ref));
      case 'GET /api/tarjetas': return ok({ tarjetas: exigirCajero().tarjetasPropias() });
      case 'GET /api/ventas/buscar': {
        const c = exigirCajero();
        return ok(c.buscarVentas({ fecha: q.get('fecha') || undefined, desde: q.get('desde') || undefined, hasta: q.get('hasta') || undefined, codigo: q.get('codigo') || undefined, folio: q.get('folio') ? Number(q.get('folio')) : undefined }));
      }
      case 'POST /api/venta/devolver': return ok(await exigirCajero().devolver(b.sale_id, b.renglones ?? [], String(b.motivo ?? 'devolución')));
      case 'POST /api/tarjeta/recargar': return ok(await exigirCajero().recargarTarjetaRegalo(String(b.codigo ?? ''), Number(b.monto), b.recibido === undefined ? undefined : Number(b.recibido), b.ref));
      case 'POST /api/venta/reimprimir': return ok(await exigirCajero().reimprimir(b.sale_id));
      case 'GET /api/buscar': return ok({ ...exigirCajero().buscarConTotal(q.get('q') ?? '') });
      case 'GET /api/ventas': {
        const c = exigirCajero();
        // Cualquier intento de pedir otra caja se rechaza con 403; el cajero nunca recibe datos ajenos.
        const cajas = cajasParam(q.get('cajas'));
        if (cajas) c.ventasPropias({ cajas });
        return ok({ ventas: c.ventasDelDia(q.get('fecha') ?? c.estado().fecha_local) });
      }
      case 'GET /api/ticket': return ok({ ticket_texto: exigirCajero().ticketTexto(q.get('sale_id') ?? '') });
      case 'GET /api/corte': {
        const c = exigirCajero();
        const cajas = cajasParam(q.get('cajas'));
        if (cajas) c.cortesPropios({ cajas });
        return ok({ ...c.corte(q.get('fecha') ?? c.estado().fecha_local) });
      }
      case 'POST /api/corte/cerrar': { const c = exigirCajero(); return ok({ corte: c.cerrarCorte(b.fecha ?? c.estado().fecha_local) }); }
      case 'POST /api/sincronizar': return ok({ conexion: await exigirCajero().sincronizar() });
      // ── administración ──
      case 'GET /api/admin/cajas': return ok({ cajas: exigirAdmin().cajas });
      case 'POST /api/admin/reporte': return ok({ reporte: exigirAdmin().reporte({ cajas: b.cajas, desde: b.desde, hasta: b.hasta }) });
      case 'GET /api/admin/tipo-cambio': return ok(exigirAdmin().tipoCambio());
      case 'POST /api/admin/tipo-cambio': return ok(exigirAdmin().fijarTipoCambio(Number(b.tasa), !!b.confirmar));
      case 'POST /api/admin/permisos': return ok(exigirAdmin().asignarPermisoTipoCambio(String(b.usuario ?? ''), !!b.editar_tipo_cambio));
      case 'GET /api/admin/tiendas': return ok({ tiendas: exigirAdmin().tiendasInfo() });
      case 'POST /api/admin/tiendas': return ok(exigirAdmin().guardarNombreTienda(String(b.tienda ?? ''), String(b.nombre ?? '')));
      case 'GET /api/admin/articulos': return ok(exigirAdmin().buscarArticulos(q.get('q') ?? '', Math.min(200, Number(q.get('limite')) || 30), Number(q.get('desde')) || 0, q.get('todos') === '1'));
      case 'POST /api/admin/articulos': return ok(exigirAdmin().editarArticulo(String(b.item_id ?? ''), b.cambios ?? {}));
      case 'GET /api/admin/articulo/historial': return ok(exigirAdmin().historialArticulo(q.get('item_id') ?? ''));
      case 'GET /api/admin/promociones': return ok(exigirAdmin().promociones());
      case 'POST /api/admin/promociones': return ok(exigirAdmin().guardarPromocion(b as any));
      case 'GET /api/admin/supervisores': return ok(exigirAdmin().supervisores());
      case 'POST /api/admin/supervisores': return ok(exigirAdmin().guardarSupervisor({ id: b.id, nombre: b.nombre, clave: b.clave === undefined ? undefined : String(b.clave), activo: b.activo === undefined ? undefined : !!b.activo }));
      case 'GET /api/admin/almacen': return ok(exigirAdmin().almacen());
      case 'POST /api/admin/almacen/revisar': return ok(exigirAdmin().revisarAltaLote(b.filas, { decisiones: b.decisiones, regla: b.regla }));
      case 'POST /api/admin/almacen/alta': return ok(exigirAdmin().altaLote({ lote_id: String(b.lote_id ?? ''), nombre: b.nombre, filas: b.filas, decisiones: b.decisiones, regla: b.regla, pedimento_lote: b.pedimento_lote }));
      case 'POST /api/admin/almacen/piso': return ok(exigirAdmin().fijarSacarAPiso(String(b.item_id ?? ''), b.fecha ? String(b.fecha) : null));
      case 'POST /api/admin/almacen/manual': return ok(exigirAdmin().altaManual(b));
      case 'POST /api/admin/almacen/entregar': return ok(exigirAdmin().entregarAlmacen({ item_id: String(b.item_id ?? ''), destinos: b.destinos ?? {}, etiqueta_precio: !!b.etiqueta_precio, etiqueta_costura: !!b.etiqueta_costura, confirmar_exceso: !!b.confirmar_exceso, ref: b.ref }));
      case 'GET /api/recepciones': return ok({ recepciones: exigirCajero().recepcionesPendientes() });
      case 'POST /api/recepciones/confirmar': return ok(exigirCajero().confirmarRecepcion(String(b.entrega_id ?? '')));
      case 'GET /api/admin/departamentos': return ok(exigirAdmin().departamentos());
      case 'POST /api/admin/departamentos': return ok(exigirAdmin().guardarDepartamento({
        id: b.id === undefined ? undefined : String(b.id), nombre: b.nombre === undefined ? undefined : String(b.nombre),
        activo: b.activo === undefined ? undefined : !!b.activo, alias: Array.isArray(b.alias) ? b.alias.map(String) : undefined,
      }));
      case 'GET /api/admin/descuentos': {
        const A3 = exigirAdmin();
        const f = { cajas: cajasParam(q.get('cajas')), desde: q.get('desde') || undefined, hasta: q.get('hasta') || undefined };
        return ok({ reporte: A3.descuentos(f), ...(q.get('completo') === '1' ? { hoja: A3.hojaDescuentos(f) } : {}) });
      }
      case 'GET /api/admin/dolares': {
        const A2 = exigirAdmin();
        const f = { cajas: cajasParam(q.get('cajas')), desde: q.get('desde') || undefined, hasta: q.get('hasta') || undefined };
        return ok({ reporte: A2.dolares(f), ...(q.get('completo') === '1' ? { hoja: A2.hojaDolares(f) } : {}) });
      }
      case 'GET /api/admin/tarjetas': return ok({ tarjetas: exigirAdmin().tarjetasRegalo() });
      case 'GET /api/admin/inventario': return ok(exigirAdmin().inventario(q.get('completo') === '1'));
      case 'POST /api/admin/cortes': return ok({ cortes: exigirAdmin().cortes({ cajas: b.cajas, desde: b.desde, hasta: b.hasta }) });
      default: return { status: 404, json: { ok: false, error: { codigo: 'RUTA_INEXISTENTE', mensaje: url.pathname } } };
    }
  } catch (e) {
    if (e instanceof ErrorDominio) return { status: STATUS[e.codigo] ?? 409, json: { ok: false, error: { codigo: e.codigo, mensaje: e.message, detalle: e.detalle } } };
    return { status: 500, json: { ok: false, error: { codigo: 'ERROR', mensaje: String(e) } } };
  }
}
