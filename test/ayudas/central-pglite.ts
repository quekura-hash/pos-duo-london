import { readFileSync } from 'node:fs';
import { after } from 'node:test';
import { PGlite } from '@electric-sql/pglite';
import type { ClienteCentral, FilaCentral } from '../../src/transporte/puente-central.ts';

const MIGRACIONES = ['0001_central.sql', '0002_actualizaciones.sql', '0003_cajas.sql', '0004_publicador.sql', '0005_notificaciones.sql', '0007_reporte_contadora.sql'].map((n) => new URL(`../../supabase/migrations/${n}`, import.meta.url));

const abiertas: PGlite[] = [];
// PGlite deja un temporizador interno por instancia: se cierran todas al terminar para que el proceso de pruebas salga.
after(async () => { await Promise.all(abiertas.map((d) => d.close().catch(() => undefined))); });

/** Postgres local (PGlite) con la migración REAL y un `auth` mínimo que imita Supabase (auth.uid() sale del JWT simulado). */
export async function centralLocal(): Promise<PGlite> {
  const db = new PGlite();
  abiertas.push(db);
  await db.exec(`
    create role anon nologin; create role authenticated nologin;
    create schema auth;
    create table auth.users (id uuid primary key default gen_random_uuid(), email text);
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    grant usage on schema auth to anon, authenticated;
    grant execute on function auth.uid() to anon, authenticated;
    -- Storage de Supabase, solo lo necesario para probar las políticas del almacén de actualizaciones.
    create schema storage;
    create table storage.buckets (id text primary key, name text not null, public boolean not null default false, file_size_limit bigint);
    create table storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text not null references storage.buckets (id), name text not null);
    alter table storage.objects enable row level security;
    grant usage on schema storage to anon, authenticated;
    grant select, insert, update, delete on storage.objects to authenticated;
    -- pg_net y pg_cron simulados: las llamadas quedan registradas para poder comprobarlas.
    create schema extensions; create schema net; create schema cron;
    create table net.llamadas (id serial primary key, url text, headers jsonb, body jsonb);
    create function net.http_post(url text, headers jsonb default '{}', body jsonb default '{}', timeout_milliseconds integer default 5000) returns bigint language plpgsql as $$
      begin if url like '%falla%' then raise exception 'red caída'; end if; insert into net.llamadas (url, headers, body) values (url, headers, body); return 1; end $$;
    create table cron.job (jobid bigserial primary key, jobname text, schedule text, command text);
    create function cron.schedule(nombre text, horario text, orden text) returns bigint language sql as $$ insert into cron.job (jobname, schedule, command) values (nombre, horario, orden) returning jobid $$;
    create function cron.unschedule(id bigint) returns boolean language sql as $$ delete from cron.job where jobid = id returning true $$;
  `);
  // Las líneas `create extension` se omiten: pg_net y pg_cron existen en Supabase; aquí están simulados arriba.
  for (const m of MIGRACIONES) await db.exec(readFileSync(m, 'utf8').replace(/^create extension .*$/gm, ''));
  return db;
}

export async function usuario(db: PGlite, correo: string, rol?: 'supervisor' | 'almacenista' | 'caja' | 'publicador', activo = true, caja?: { tienda: string; caja: number }): Promise<string> {
  const r = await db.query<{ id: string }>('insert into auth.users (email) values ($1) returning id', [correo]);
  const id = r.rows[0]!.id;
  if (rol) await db.query('insert into pos.admins (user_id, rol, alias, activo, tienda, caja) values ($1, $2, $3, $4, $5, $6)', [id, rol, correo, activo, caja?.tienda ?? null, caja?.caja ?? null]);
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
