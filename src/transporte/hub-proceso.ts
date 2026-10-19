import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { Hub, type Ctx } from '../nodos.ts';
import { crearPoliticasEnsayo } from '../politicas.ts';
import { localizarVentas } from '../consultas.ts';
import { devueltoPorLinea, ventas } from '../proyecciones.ts';
import { buscarRecompensa } from '../recompensas.ts';
import { SqliteRepo } from '../repo.ts';

// Proceso del hub de una tienda: HTTP en 127.0.0.1, almacenamiento SQLite persistente.
const a = JSON.parse(process.argv[2]!);
const ctx: Ctx = {
  reloj: { now: () => new Date().toISOString() },
  ttlReservaMs: a.ttlReservaMs,
  politicas: crearPoliticasEnsayo(a.politicas),
  cajasCfg: a.cajasCfg,
  tiendas: [a.tienda],
  catalogoCompartido: true,
};
const repo = new SqliteRepo(a.db, a.cajasCfg);
const hub = new Hub(a.tienda, repo, ctx);
const fallas = { descartarRespuestas: 0 };

function leer(req: IncomingMessage): Promise<any> {
  return new Promise((res, rej) => {
    let s = '';
    req.on('data', (d) => (s += d));
    req.on('end', () => {
      try { res(s ? JSON.parse(s) : {}); } catch (e) { rej(e); }
    });
  });
}
const responder = (res: ServerResponse, status: number, cuerpo: unknown) => {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(cuerpo));
};

function rpc(metodo: string, args: any[]) {
  switch (metodo) {
    case 'arrendar': return hub.arrendar(args[0], args[1], args[2]);
    case 'anclas': return hub.anclas(args[0]);
    case 'consultarRecompensa': return buscarRecompensa(ventas(repo.ops()), args[0]);
    case 'consultarVenta': return ventas(repo.ops()).get(args[0]) ?? null;
    case 'devuelto': return [...devueltoPorLinea(repo.ops(), args[0])];
    case 'reservar': return hub.reservar(args[0], args[1], args[2], args[3] ?? []);
    case 'buscarVentas': return localizarVentas(repo.ops(), hub.tienda, args[0]);
    case 'liberar': hub.liberar(args[0]); return true;
    default: throw new Error(`rpc desconocido: ${metodo}`);
  }
}

const server = createServer(async (req, res) => {
  try {
    const b = await leer(req);
    switch (req.url) {
      case '/ping':
        return responder(res, 200, { ok: true });
      case '/recibir': {
        const acks: string[] = [];
        for (const op of b.ops) {
          hub.recibir(op, b.desde);
          acks.push(op.op_id);
        }
        if (fallas.descartarRespuestas > 0) {
          fallas.descartarRespuestas--; // el hub YA procesó; la respuesta se pierde (la caja reintentará)
          req.socket.destroy();
          return;
        }
        return responder(res, 200, { acks });
      }
      case '/pendientes':
        return responder(res, 200, { ops: repo.pendientes(b.destino).slice(0, b.limite ?? 50) });
      case '/ack':
        for (const id of b.op_ids) repo.ack(id, b.destino);
        return responder(res, 200, { ok: true });
      case '/rpc':
        return responder(res, 200, { ok: true, valor: rpc(b.metodo, b.args) });
      case '/admin': {
        if (b.accion === 'fallas') Object.assign(fallas, b.valores);
        if (b.accion === 'ops') return responder(res, 200, { ops: repo.ops() });
        if (b.accion === 'reservas') return responder(res, 200, { reservas: hub.reservasAbiertas() });
        return responder(res, 200, { ok: true, fallas });
      }
      default:
        return responder(res, 404, { ok: false });
    }
  } catch (e) {
    responder(res, 500, { ok: false, error: String(e) });
  }
});
server.listen(a.puerto, '127.0.0.1', () => process.stdout.write(`LISTO ${a.puerto}\n`));
