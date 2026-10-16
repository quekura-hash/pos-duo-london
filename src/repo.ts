import { DatabaseSync } from 'node:sqlite';
import type { CajaCfg, Op } from './tipos.ts';

/** Almacenamiento de un nodo: bitácora de operaciones inmutables + cola de salida + clave/valor. */
export interface Repo {
  readonly tipo: 'memoria' | 'sqlite';
  tx<T>(f: () => T): T;
  /** false si el op_id ya existía (deduplicación). */
  appendOp(op: Op): boolean;
  tieneOp(id: string): boolean;
  getOp(id: string): Op | undefined;
  ops(): Op[];
  encolar(opId: string, destino: string): void;
  pendientes(destino: string): Op[];
  ack(opId: string, destino: string): void;
  kvGet<T>(k: string): T | undefined;
  kvSet(k: string, v: unknown): void;
  cerrar(): void;
}

export class MemoriaRepo implements Repo {
  readonly tipo = 'memoria' as const;
  private e = {
    ops: [] as Op[],
    idx: new Map<string, Op>(),
    outbox: new Map<string, boolean>(), // `${opId}|${destino}` -> acked
    kv: new Map<string, string>(),
  };
  private prof = 0;
  private cajas: CajaCfg[];

  constructor(cajas: CajaCfg[] = []) {
    this.cajas = cajas;
  }

  tx<T>(f: () => T): T {
    if (this.prof > 0) return f();
    const snap = structuredClone(this.e);
    this.prof++;
    try {
      return f();
    } catch (err) {
      this.e = snap;
      throw err;
    } finally {
      this.prof--;
    }
  }
  appendOp(op: Op): boolean {
    if (this.e.idx.has(op.op_id)) return false;
    const copia = structuredClone(op);
    this.e.ops.push(copia);
    this.e.idx.set(op.op_id, copia);
    return true;
  }
  tieneOp(id: string) {
    return this.e.idx.has(id);
  }
  getOp(id: string) {
    return this.e.idx.get(id);
  }
  ops() {
    return this.e.ops.map((o) => structuredClone(o));
  }
  encolar(opId: string, destino: string) {
    const k = `${opId}|${destino}`;
    if (!this.e.outbox.has(k)) this.e.outbox.set(k, false);
  }
  pendientes(destino: string) {
    const r: Op[] = [];
    for (const [k, acked] of this.e.outbox) {
      const [opId, d] = k.split('|');
      if (d === destino && !acked) r.push(structuredClone(this.e.idx.get(opId!)!));
    }
    return r;
  }
  ack(opId: string, destino: string) {
    this.e.outbox.set(`${opId}|${destino}`, true);
  }
  kvGet<T>(k: string) {
    const v = this.e.kv.get(k);
    return v === undefined ? undefined : (JSON.parse(v) as T);
  }
  kvSet(k: string, v: unknown) {
    this.e.kv.set(k, JSON.stringify(v));
  }
  cerrar() {}
}

export class SqliteRepo implements Repo {
  readonly tipo = 'sqlite' as const;
  private db: DatabaseSync;
  private prof = 0;

  constructor(ruta: string, cajas: CajaCfg[] = []) {
    this.db = new DatabaseSync(ruta);
    this.db.exec('PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL;');
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS ops(
        seq INTEGER PRIMARY KEY AUTOINCREMENT,
        op_id TEXT NOT NULL UNIQUE,
        tipo TEXT NOT NULL, tienda TEXT, caja INTEGER, origen TEXT NOT NULL,
        ocurrio_en TEXT NOT NULL, payload TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS outbox(
        op_id TEXT NOT NULL, destino TEXT NOT NULL, acked INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY(op_id, destino));
      CREATE TABLE IF NOT EXISTS kv(k TEXT PRIMARY KEY, v TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS cajas(
        tienda TEXT NOT NULL, caja INTEGER NOT NULL, solo_efectivo INTEGER NOT NULL,
        PRIMARY KEY(tienda, caja));
      -- Tercera barrera (además del dominio y la validación del hub): la base rechaza
      -- ventas con tarjeta en una caja configurada solo-efectivo.
      CREATE TRIGGER IF NOT EXISTS ops_caja_solo_efectivo BEFORE INSERT ON ops
      WHEN NEW.tipo = 'sale.confirmed'
        AND EXISTS (SELECT 1 FROM cajas c WHERE c.tienda = NEW.tienda AND c.caja = NEW.caja AND c.solo_efectivo = 1)
        AND EXISTS (SELECT 1 FROM json_each(json_extract(NEW.payload, '$.pagos'))
                    WHERE json_extract(value, '$.metodo') <> 'efectivo')
      BEGIN SELECT RAISE(ABORT, 'caja_solo_efectivo'); END;
    `);
    for (const c of cajas) {
      this.db
        .prepare('INSERT OR REPLACE INTO cajas(tienda,caja,solo_efectivo) VALUES (?,?,?)')
        .run(c.tienda, c.caja, c.metodos.every((m) => m === 'efectivo') ? 1 : 0);
    }
  }

  tx<T>(f: () => T): T {
    if (this.prof > 0) return f();
    this.db.exec('BEGIN IMMEDIATE');
    this.prof++;
    try {
      const r = f();
      this.db.exec('COMMIT');
      return r;
    } catch (err) {
      this.db.exec('ROLLBACK');
      throw err;
    } finally {
      this.prof--;
    }
  }
  appendOp(op: Op): boolean {
    if (this.tieneOp(op.op_id)) return false;
    this.db
      .prepare('INSERT INTO ops(op_id,tipo,tienda,caja,origen,ocurrio_en,payload) VALUES (?,?,?,?,?,?,?)')
      .run(op.op_id, op.tipo, op.tienda, op.caja, op.origen, op.ocurrio_en, JSON.stringify(op.payload));
    return true;
  }
  tieneOp(id: string) {
    return this.db.prepare('SELECT 1 AS x FROM ops WHERE op_id=?').get(id) !== undefined;
  }
  private fila(r: any): Op {
    return {
      op_id: r.op_id, tipo: r.tipo, tienda: r.tienda, caja: r.caja,
      origen: r.origen, ocurrio_en: r.ocurrio_en, payload: JSON.parse(r.payload),
    };
  }
  getOp(id: string) {
    const r = this.db.prepare('SELECT * FROM ops WHERE op_id=?').get(id);
    return r ? this.fila(r) : undefined;
  }
  ops() {
    return this.db.prepare('SELECT * FROM ops ORDER BY seq').all().map((r) => this.fila(r));
  }
  encolar(opId: string, destino: string) {
    this.db.prepare('INSERT OR IGNORE INTO outbox(op_id,destino,acked) VALUES (?,?,0)').run(opId, destino);
  }
  pendientes(destino: string) {
    return this.db
      .prepare(
        'SELECT o.* FROM outbox b JOIN ops o ON o.op_id=b.op_id WHERE b.destino=? AND b.acked=0 ORDER BY o.seq',
      )
      .all(destino)
      .map((r) => this.fila(r));
  }
  ack(opId: string, destino: string) {
    this.db.prepare('UPDATE outbox SET acked=1 WHERE op_id=? AND destino=?').run(opId, destino);
  }
  kvGet<T>(k: string) {
    const r = this.db.prepare('SELECT v FROM kv WHERE k=?').get(k) as { v: string } | undefined;
    return r ? (JSON.parse(r.v) as T) : undefined;
  }
  kvSet(k: string, v: unknown) {
    this.db.prepare('INSERT OR REPLACE INTO kv(k,v) VALUES (?,?)').run(k, JSON.stringify(v));
  }
  /** Copia consistente de la base completa (incluye la cola de salida). */
  vacuumInto(destino: string) {
    this.db.exec(`VACUUM INTO '${destino.replace(/'/g, "''")}'`);
  }
  cerrar() {
    this.db.close();
  }
}
