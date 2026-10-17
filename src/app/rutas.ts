import { ErrorDominio } from '../errores.ts';
import type { ServicioAdmin, ServicioCaja } from './servicio.ts';

const STATUS: Record<string, number> = { PROHIBIDO: 403, ARTICULO_INEXISTENTE: 404, CARRITO_INEXISTENTE: 404, LINEA_INEXISTENTE: 404 };

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
          ? { rol: 'cajero', usuario: C.actor.usuario, tienda: C.caja.tienda, caja: C.caja.caja, nav: ['venta', 'corte', 'ventas'] }
          : { rol: 'admin', usuario: A!.actor.usuario, cajas: A!.cajas, nav: ['reportes'] });
      // ── cajero ──
      case 'GET /api/estado': return ok({ estado: exigirCajero().estado() });
      case 'POST /api/venta/actual': { const c = exigirCajero(); const cart = c.carritoActual(); return ok({ cart, carrito: c.vista(cart) }); }
      case 'POST /api/venta/nueva': { const c = exigirCajero(); const cart = c.nuevaVenta(); return ok({ cart, carrito: c.vista(cart) }); }
      case 'POST /api/venta/escanear': return ok(exigirCajero().escanear(b.cart, String(b.codigo ?? '')));
      case 'POST /api/venta/agregar': return ok(exigirCajero().agregarArticulo(b.cart, b.item_id));
      case 'POST /api/venta/cantidad': return ok({ carrito: exigirCajero().cambiarCantidad(b.cart, b.linea_id, Number(b.qty)) });
      case 'POST /api/venta/quitar': return ok({ carrito: exigirCajero().quitarLinea(b.cart, b.linea_id) });
      case 'POST /api/venta/cobrar-efectivo': return ok(await exigirCajero().cobrarEfectivo(b.cart, Number(b.recibido)));
      case 'POST /api/venta/reimprimir': return ok(await exigirCajero().reimprimir(b.sale_id));
      case 'GET /api/buscar': return ok({ resultados: exigirCajero().buscar(q.get('q') ?? '') });
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
      case 'POST /api/admin/cortes': return ok({ cortes: exigirAdmin().cortes({ cajas: b.cajas, desde: b.desde, hasta: b.hasta }) });
      default: return { status: 404, json: { ok: false, error: { codigo: 'RUTA_INEXISTENTE', mensaje: url.pathname } } };
    }
  } catch (e) {
    if (e instanceof ErrorDominio) return { status: STATUS[e.codigo] ?? 409, json: { ok: false, error: { codigo: e.codigo, mensaje: e.message, detalle: e.detalle } } };
    return { status: 500, json: { ok: false, error: { codigo: 'ERROR', mensaje: String(e) } } };
  }
}
