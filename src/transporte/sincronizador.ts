import type { Caja } from '../nodos.ts';
import type { SyncHttp } from './http-sync.ts';

/** Empuja la cola de salida de la caja al hub y trae lo que el hub tiene pendiente para ella. Reintentable. */
export function sincronizar(caja: Caja, http: SyncHttp, hubUrl: string, limite = 50): { ok: boolean; enviadas: number; recibidas: number } {
  const destino = `hub:${caja.tienda}`;
  let enviadas = 0;
  let recibidas = 0;
  for (;;) {
    const lote = caja.repo.pendientes(destino).slice(0, limite);
    if (!lote.length) break;
    const r = http.post(`${hubUrl}/recibir`, { desde: caja.nodoId, ops: lote }, 5000);
    if (!r || r.status !== 200) return { ok: false, enviadas, recibidas };
    for (const id of r.json.acks as string[]) caja.repo.ack(id, destino);
    enviadas += (r.json.acks as string[]).length;
    if (!(r.json.acks as string[]).length) break;
  }
  for (;;) {
    const r = http.post(`${hubUrl}/pendientes`, { destino: caja.nodoId, limite }, 5000);
    if (!r || r.status !== 200) return { ok: false, enviadas, recibidas };
    const ops = r.json.ops as Parameters<Caja['recibir']>[0][];
    if (!ops.length) break;
    for (const op of ops) caja.recibir(op, 'hub');
    const a = http.post(`${hubUrl}/ack`, { destino: caja.nodoId, op_ids: ops.map((o) => o.op_id) }, 5000);
    if (!a || a.status !== 200) return { ok: false, enviadas, recibidas };
    recibidas += ops.length;
  }
  return { ok: true, enviadas, recibidas };
}
