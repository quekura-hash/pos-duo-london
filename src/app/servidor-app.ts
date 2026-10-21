import { readFileSync } from 'node:fs';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { extname, join } from 'node:path';
import { escribirXlsxNode, leerXlsxNode } from '../xlsx-node.ts';
import { atender } from './rutas.ts';
import type { ServicioAdmin, ServicioCaja } from './servicio.ts';

const PUBLICO = join(import.meta.dirname, 'publico');
const TIPOS: Record<string, string> = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.png': 'image/png' };

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

/**
 * Servidor local de la aplicación (HTTP en 127.0.0.1; se podrá alojar dentro de una ventana Electron).
 * Una instancia sirve UNA sesión: cajero (atada a su caja) o Administración. USUARIOS SINTÉTICOS, SIN AUTENTICACIÓN:
 * cualquier proceso local puede llamar a estas rutas. Esto es un prototipo operativo, no un sistema de acceso.
 */
export function crearServidorApp(o: { cajero?: ServicioCaja; admin?: ServicioAdmin }): Server {
  return createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? '/', 'http://localhost');
      if (!url.pathname.startsWith('/api/')) {
        const archivo = url.pathname === '/' ? 'index.html' : url.pathname.slice(1);
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
      const xlsx = /^\/api\/admin\/(inventario|dolares|descuentos|entregas|reporte-ventas)\.xlsx$/.exec(url.pathname);
      if (req.method === 'GET' && xlsx) {
        const q = new URLSearchParams(url.searchParams);
        q.set('completo', '1');
        const r = await atender(o, 'GET', new URL(`/api/admin/${xlsx[1]}?${q}`, 'http://localhost'), {});
        if (r.status !== 200) return json(res, r.status, r.json);
        const bytes = await escribirXlsxNode(r.json.hojas ?? [r.json.hoja]);
        res.writeHead(200, {
          'content-type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          'content-disposition': `attachment; filename="${({ dolares: 'dolares-recibidos', descuentos: 'descuentos', entregas: 'entregas-almacen', inventario: 'inventario', 'reporte-ventas': 'reporte-de-ventas' } as Record<string, string>)[xlsx[1]!]}.xlsx"`, 'cache-control': 'no-store',
        });
        return void res.end(Buffer.from(bytes));
      }
      if (req.method === 'POST' && url.pathname === '/api/admin/almacen/leer-archivo') {
        // El navegador manda el .xlsx tal cual; aquí solo se lee (no se guarda). Solo Administración.
        if (!o.admin) return json(res, 403, { ok: false, error: { codigo: 'PROHIBIDO', mensaje: 'esta sesión no es de Administración' } });
        if (!o.admin.autenticada()) return json(res, 401, { ok: false, error: { codigo: 'NO_AUTENTICADO', mensaje: 'inicie sesión con su usuario y contraseña' } });
        const partes: Buffer[] = [];
        for await (const d of req) partes.push(d as Buffer);
        try { return json(res, 200, { ok: true, hojas: await leerXlsxNode(new Uint8Array(Buffer.concat(partes))) }); } catch (e) { return json(res, 400, { ok: false, error: { codigo: 'ARCHIVO_ILEGIBLE', mensaje: `no se pudo leer el archivo: ${(e as Error).message}` } }); }
      }
      const b = req.method === 'POST' ? await leer(req) : {};
      const r = await atender(o, req.method ?? 'GET', url, b);
      return json(res, r.status, r.json);
    } catch (e) {
      if (res.headersSent) return void res.end();
      return json(res, 500, { ok: false, error: { codigo: 'ERROR', mensaje: String(e) } });
    }
  });
}
