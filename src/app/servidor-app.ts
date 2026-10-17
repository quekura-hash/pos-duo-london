import { readFileSync } from 'node:fs';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { extname, join } from 'node:path';
import { ErrorDominio } from '../errores.ts';
import type { ServicioAdmin, ServicioCaja } from './servicio.ts';

const PUBLICO = join(import.meta.dirname, 'publico');
const TIPOS: Record<string, string> = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8' };

function leer(req: IncomingMessage): Promise<any> {
  return new Promise((res) => {
    let s = '';
    req.on('data', (d) => (s += d));
    req.on('end', () => {
      try { res(s ? JSON.parse(s) : {}); } catch { res({}); }
    });
  });
}
function json(res: ServerResponse, status: number, cuerpo: unknown) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(JSON.stringify(cuerpo));
}

const STATUS: Record<string, number> = { PROHIBIDO: 403, ARTICULO_INEXISTENTE: 404, CARRITO_INEXISTENTE: 404, LINEA_INEXISTENTE: 404 };

/**
 * Servidor local de la aplicación (HTTP en 127.0.0.1; se podrá alojar dentro de una ventana Electron).
 * Una instancia sirve UNA sesión: cajero (atada a su caja) o Administración. USUARIOS SINTÉTICOS, SIN AUTENTICACIÓN:
 * cualquier proceso local puede llamar a estas rutas. Esto es un prototipo operativo, no un sistema de acceso.
 */
export function crearServidorApp(o: { cajero?: ServicioCaja; admin?: ServicioAdmin }): Server {
  return createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? '/', 'http://localhost');
      const ruta = url.pathname;
      if (!ruta.startsWith('/api/')) {
        const archivo = ruta === '/' ? 'index.html' : ruta.slice(1);
        if (!/^[\w.-]+$/.test(archivo)) return json(res, 404, { ok: false });
        let contenido: Buffer;
        try {
          contenido = readFileSync(join(PUBLICO, archivo)); // se lee ANTES de escribir encabezados
        } catch {
          return json(res, 404, { ok: false });
        }
        res.writeHead(200, { 'content-type': TIPOS[extname(archivo)] ?? 'application/octet-stream', 'cache-control': 'no-store' });
        return void res.end(contenido);
      }
      const b = req.method === 'POST' ? await leer(req) : {};
      const q = url.searchParams;
      const C = o.cajero;
      const A = o.admin;
      const exigirCajero = () => {
        if (!C) throw new ErrorDominio('PROHIBIDO', 'esta sesión no es de cajero');
        return C;
      };
      const exigirAdmin = () => {
        if (!A) throw new ErrorDominio('PROHIBIDO', 'esta sesión no es de Administración');
        return A;
      };
      const cajasParam = (v: string | null) => (v ? v.split(',').map((x) => ({ tienda: x.split('/')[0]!, caja: Number(x.split('/')[1]) })) : undefined);

      switch (`${req.method} ${ruta}`) {
        case 'GET /api/sesion':
          return json(res, 200, C
            ? { ok: true, rol: 'cajero', usuario: C.actor.usuario, tienda: C.caja.tienda, caja: C.caja.caja, nav: ['venta', 'corte', 'ventas'] }
            : { ok: true, rol: 'admin', usuario: A!.actor.usuario, cajas: A!.cajas, nav: ['reportes'] });
        // ── cajero ──
        case 'GET /api/estado': return json(res, 200, { ok: true, estado: exigirCajero().estado() });
        case 'POST /api/venta/actual': { const c = exigirCajero(); const cart = c.carritoActual(); return json(res, 200, { ok: true, cart, carrito: c.vista(cart) }); }
        case 'POST /api/venta/nueva': { const c = exigirCajero(); const cart = c.nuevaVenta(); return json(res, 200, { ok: true, cart, carrito: c.vista(cart) }); }
        case 'POST /api/venta/escanear': return json(res, 200, { ok: true, ...exigirCajero().escanear(b.cart, String(b.codigo ?? '')) });
        case 'POST /api/venta/agregar': return json(res, 200, { ok: true, ...exigirCajero().agregarArticulo(b.cart, b.item_id) });
        case 'POST /api/venta/cantidad': return json(res, 200, { ok: true, carrito: exigirCajero().cambiarCantidad(b.cart, b.linea_id, Number(b.qty)) });
        case 'POST /api/venta/quitar': return json(res, 200, { ok: true, carrito: exigirCajero().quitarLinea(b.cart, b.linea_id) });
        case 'POST /api/venta/cobrar-efectivo': return json(res, 200, { ok: true, ...(await exigirCajero().cobrarEfectivo(b.cart, Number(b.recibido))) });
        case 'POST /api/venta/reimprimir': return json(res, 200, { ok: true, ...(await exigirCajero().reimprimir(b.sale_id)) });
        case 'GET /api/buscar': return json(res, 200, { ok: true, resultados: exigirCajero().buscar(q.get('q') ?? '') });
        case 'GET /api/ventas': {
          const c = exigirCajero();
          // Cualquier intento de pedir otra caja se rechaza con 403; el cajero nunca recibe datos ajenos.
          const cajas = cajasParam(q.get('cajas'));
          if (cajas) c.ventasPropias({ cajas });
          return json(res, 200, { ok: true, ventas: c.ventasDelDia(q.get('fecha') ?? c.estado().fecha_local) });
        }
        case 'GET /api/ticket': return json(res, 200, { ok: true, ticket_texto: exigirCajero().ticketTexto(q.get('sale_id') ?? '') });
        case 'GET /api/corte': {
          const c = exigirCajero();
          const cajas = cajasParam(q.get('cajas'));
          if (cajas) c.cortesPropios({ cajas });
          return json(res, 200, { ok: true, ...c.corte(q.get('fecha') ?? c.estado().fecha_local) });
        }
        case 'POST /api/corte/cerrar': { const c = exigirCajero(); return json(res, 200, { ok: true, corte: c.cerrarCorte(b.fecha ?? c.estado().fecha_local) }); }
        case 'POST /api/sincronizar': return json(res, 200, { ok: true, conexion: await exigirCajero().sincronizar() });
        // ── administración ──
        case 'GET /api/admin/cajas': return json(res, 200, { ok: true, cajas: exigirAdmin().cajas });
        case 'POST /api/admin/reporte': return json(res, 200, { ok: true, reporte: exigirAdmin().reporte({ cajas: b.cajas, desde: b.desde, hasta: b.hasta }) });
        case 'POST /api/admin/cortes': return json(res, 200, { ok: true, cortes: exigirAdmin().cortes({ cajas: b.cajas, desde: b.desde, hasta: b.hasta }) });
        default: return json(res, 404, { ok: false, error: { codigo: 'RUTA_INEXISTENTE', mensaje: ruta } });
      }
    } catch (e) {
      if (res.headersSent) return void res.end();
      if (e instanceof ErrorDominio) return json(res, STATUS[e.codigo] ?? 409, { ok: false, error: { codigo: e.codigo, mensaje: e.message, detalle: e.detalle } });
      return json(res, 500, { ok: false, error: { codigo: 'ERROR', mensaje: String(e) } });
    }
  });
}
