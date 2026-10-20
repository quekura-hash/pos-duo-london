import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import type { ClienteCentral, FilaCentral } from '../../src/transporte/puente-central.ts';

const MIGRACION = new URL('../../supabase/migrations/0001_central.sql', import.meta.url);

/** Postgres local (PGlite) con la migración REAL y un `auth` mínimo que imita Supabase (auth.uid() sale del JWT simulado). */
export async function centralLocal(): Promise<PGlite> {
  const db = new PGlite();
  await db.exec(`
    create role anon nologin; create role authenticated nologin;
    create schema auth;
    create table auth.users (id uuid primary key default gen_random_uuid(), email text);
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    grant usage on schema auth to anon, authenticated;
    grant execute on function auth.uid() to anon, authenticated;
  `);
  await db.exec(readFileSync(MIGRACION, 'utf8'));
  return db;
}

export async function usuario(db: PGlite, correo: string, rol?: 'supervisor' | 'almacenista', activo = true): Promise<string> {
  const r = await db.query<{ id: string }>('insert into auth.users (email) values ($1) returning id', [correo]);
  const id = r.rows[0]!.id;
  if (rol) await db.query('insert into pos.admins (user_id, rol, alias, activo) values ($1, $2, $3, $4)', [id, rol, correo, activo]);
  return id;
}

/** Ejecuta como el rol `authenticated` con ese usuario, igual que PostgREST con su JWT. `uid` null = anónimo. */
export async function como<T>(db: PGlite, uid: string | null, f: (q: (sql: string, p?: unknown[]) => Promise<unknown[]>) => Promise<T>): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.exec(`set local role ${uid ? 'authenticated' : 'anon'}`);
    await tx.query(`select set_config('request.jwt.claim.sub', $1, true)`, [uid ?? '']);
    return f(async (sql, p) => (await tx.query(sql, p)).rows);
  });
}

export class ClientePglite implements ClienteCentral {
  private db: PGlite;
  private uid: string;
  constructor(db: PGlite, uid: string) {
    this.db = db;
    this.uid = uid;
  }
  async subirOps(ops: unknown[]) {
    const p_ops = (ops as { op_id: string; tipo: string; tienda: string | null; caja: number | null; ocurrio_en: string; payload: unknown }[])
      .map((o) => ({ op_id: o.op_id, tipo: o.tipo, tienda: o.tienda, caja: o.caja, ocurrio_en: o.ocurrio_en, payload: o.payload }));
    const [r] = (await como(this.db, this.uid, (q) => q('select pos.subir_ops($1::jsonb) as r', [JSON.stringify(p_ops)]))) as { r: { nuevas: number; ultimo_seq: number } }[];
    return r!.r;
  }
  async bajarOps(desde: number, limite: number) {
    const filas = (await como(this.db, this.uid, (q) => q('select * from pos.bajar_ops($1, $2)', [desde, limite]))) as unknown as (Omit<FilaCentral, 'seq' | 'ocurrio_en'> & { seq: number | bigint; ocurrio_en: Date | string })[];
    return filas.map((f) => ({ ...f, seq: Number(f.seq), ocurrio_en: new Date(f.ocurrio_en).toISOString() }));
  }
}
