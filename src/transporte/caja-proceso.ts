import { createServer, type IncomingMessage } from 'node:http';
import { ErrorDominio } from '../errores.ts';
import { Caja, type Ctx } from '../nodos.ts';
import { crearPoliticasEnsayo } from '../politicas.ts';
import { SqliteRepo } from '../repo.ts';
import { EnlaceHttp } from './enlace-http.ts';
import { SyncHttp } from './http-sync.ts';
import { sincronizar } from './sincronizador.ts';

// Proceso de una caja: motor completo + SQLite persistente + enlace HTTP al hub real.
// El puerto de control sirve SOLO para que la prueba dirija la operación de la caja.
const a = JSON.parse(process.argv[2]!);
const ctx: Ctx = {
  reloj: { now: () => new Date().toISOString() },
  ttlReservaMs: a.ttlReservaMs,
  politicas: crearPoliticasEnsayo(a.politicas),
  cajasCfg: a.cajasCfg,
  tiendas: [a.tienda],
  catalogoCompartido: true,
};
const http = new SyncHttp();
const enlace = new EnlaceHttp(a.hubUrl, a.caja, http);
const repo = new SqliteRepo(a.db, a.cajasCfg);
const caja = new Caja(a.tienda, a.caja, repo, ctx, enlace);

const PERMITIDOS = new Set([
  'abrirCarrito', 'agregarLinea', 'cobrar', 'cancelarVenta', 'devolver', 'generarCorte', 'stockLocal', 'estadoFolios', 'carrito',
  'carritosAbiertos', 'iniciarArrendamiento', 'iniciarCobroTarjeta', 'resolverIntento', 'contarFisico', 'existenciaVerificada',
  'recuperarFolios', 'buscarPorCodigo', 'ops',
]);

function leer(req: IncomingMessage): Promise<any> {
  return new Promise((res) => {
    let s = '';
    req.on('data', (d) => (s += d));
    req.on('end', () => res(s ? JSON.parse(s) : {}));
  });
}

const server = createServer(async (req, res) => {
  const b = await leer(req);
  let salida: object;
  try {
    if (b.metodo === '__sync') salida = { ok: true, valor: sincronizar(caja, http, a.hubUrl) };
    else if (b.metodo === '__desconectar') { enlace.desconectado = !!b.args[0]; salida = { ok: true, valor: enlace.desconectado }; }
    else if (!PERMITIDOS.has(b.metodo)) throw new Error(`método no permitido: ${b.metodo}`);
    else salida = { ok: true, valor: (caja as any)[b.metodo](...(b.args ?? [])) ?? null };
  } catch (e) {
    salida = e instanceof ErrorDominio ? { ok: false, error: { codigo: e.codigo, mensaje: e.message, detalle: e.detalle } } : { ok: false, error: { codigo: 'ERROR', mensaje: String(e) } };
  }
  res.writeHead(200, { 'content-type': 'application/json' });
  res.end(JSON.stringify(salida));
});
server.listen(0, '127.0.0.1', () => process.stdout.write(`LISTO ${(server.address() as { port: number }).port}\n`));
