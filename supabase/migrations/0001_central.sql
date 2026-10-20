-- LonDuo POS · Central en Supabase · migración 0001
-- ESTADO: ESCRITA Y REVISADA A MANO, NO EJECUTADA. Se ejecuta en un proyecto NUEVO y vacío de Supabase (SQL Editor), por el propietario.
-- Qué crea: la bitácora de operaciones (la fuente de verdad), los dispositivos (hub/cajas), los administradores, contadores atómicos,
-- las versiones publicadas (actualizaciones) y las solicitudes de autorización en tiempo real (iPhone).
-- Seguridad: todo en el esquema `pos`, con RLS activa. Los clientes (web de Administración) usan Supabase Auth; los hubs y cajas entran por
-- una Edge Function con su llave (service role SOLO en el servidor, nunca en un cliente).

create schema if not exists pos;

-- ─────────── bitácora de operaciones ───────────
create table if not exists pos.ops (
  seq         bigint generated always as identity primary key,   -- orden de llegada al central (para sincronizar con un cursor)
  op_id       text        not null unique,                       -- identidad de la operación (UUID creado en el origen): reenviar no duplica
  tipo        text        not null,                              -- sale.confirmed, return.registered, item.created, cajero.guardado…
  tienda      text,
  caja        integer,
  origen      text        not null,                              -- caja:DUO/1, hub:DUO, central, admin:<uid>
  ocurrio_en  timestamptz not null,                              -- cuándo ocurrió (hora del origen)
  recibido_en timestamptz not null default now(),                -- cuándo llegó al central
  payload     jsonb       not null
);
create index if not exists ops_tipo_seq        on pos.ops (tipo, seq);
create index if not exists ops_tienda_caja_seq on pos.ops (tienda, caja, seq);
create index if not exists ops_ocurrio_en      on pos.ops (ocurrio_en);

-- ─────────── dispositivos (hubs, cajas, PCs) ───────────
create table if not exists pos.dispositivos (
  id          text primary key,                                  -- p. ej. caja:DUO/1
  tipo        text not null check (tipo in ('hub', 'caja', 'pc_admin')),
  tienda      text,
  caja        integer,
  llave_hash  text not null,                                     -- SHA-256 de la llave; la llave solo la ve quien la genera
  activo      boolean not null default true,
  version     text,                                              -- versión del programa que reportó la última vez
  ultima_vez  timestamptz,
  creado_en   timestamptz not null default now()
);

-- ─────────── administradores de la web (Supabase Auth) ───────────
create table if not exists pos.admins (
  user_id uuid primary key references auth.users (id) on delete cascade,
  rol     text not null check (rol in ('supervisor', 'almacenista')),
  alias   text not null,
  activo  boolean not null default true
);

create or replace function pos.es_supervisor() returns boolean
language sql stable security definer set search_path = pos, public as
$$ select exists (select 1 from pos.admins a where a.user_id = auth.uid() and a.activo and a.rol = 'supervisor') $$;

create or replace function pos.es_admin() returns boolean
language sql stable security definer set search_path = pos, public as
$$ select exists (select 1 from pos.admins a where a.user_id = auth.uid() and a.activo) $$;

-- Tipos de operación que puede leer/escribir un almacenista (inventario y almacén); el supervisor puede todo.
create or replace function pos.tipo_de_almacen(t text) returns boolean
language sql immutable as
$$ select t like 'item.%' or t like 'alm.%' or t like 'inv.%' or t like 'depto.%' or t = 'doc.perdida_resuelta' $$;

-- ─────────── contadores atómicos (Item #, techos de folios) ───────────
create table if not exists pos.contadores (
  clave text primary key,
  valor bigint not null default 0
);
insert into pos.contadores (clave, valor) values ('item_no', 0) on conflict (clave) do nothing;

-- ─────────── versiones publicadas (actualizaciones) ───────────
create table if not exists pos.versiones (
  id             bigint generated always as identity primary key,
  componente     text    not null check (componente in ('app_windows', 'admin_web')),
  version        text    not null,                               -- 1.0.3
  canal          text    not null default 'pruebas' check (canal in ('pruebas', 'estable')),
  notas          text    not null default '',
  url_descarga   text,                                           -- instalador (app_windows)
  sha256         text,                                           -- huella del instalador
  obligatoria    boolean not null default false,
  publicada_en   timestamptz not null default now(),
  unique (componente, version)
);

-- ─────────── solicitudes de autorización en tiempo real (iPhone) ───────────
create table if not exists pos.solicitudes_autorizacion (
  id            uuid primary key default gen_random_uuid(),
  tienda        text not null,
  caja          integer not null,
  tipo          text not null,                                   -- descuento, cancelar_venta, devolucion_efectivo, folios…
  detalle       jsonb not null default '{}'::jsonb,
  solicitado_por text not null,
  estado        text not null default 'pendiente' check (estado in ('pendiente', 'aprobada', 'rechazada', 'vencida')),
  resuelto_por  uuid references auth.users (id),
  creada_en     timestamptz not null default now(),
  resuelta_en   timestamptz
);
create index if not exists solicitudes_estado on pos.solicitudes_autorizacion (estado, creada_en desc);

-- ─────────── RLS ───────────
alter table pos.ops                       enable row level security;
alter table pos.dispositivos              enable row level security;
alter table pos.admins                    enable row level security;
alter table pos.contadores                enable row level security;
alter table pos.versiones                 enable row level security;
alter table pos.solicitudes_autorizacion  enable row level security;

-- bitácora: el supervisor lee todo; el almacenista solo lo de inventario y almacén. Nadie edita ni borra (solo se agrega, por la función subir_ops).
create policy ops_leer_supervisor  on pos.ops for select to authenticated using (pos.es_supervisor());
create policy ops_leer_almacen     on pos.ops for select to authenticated using (pos.es_admin() and pos.tipo_de_almacen(tipo));
-- sin políticas de insert/update/delete: las escrituras pasan solo por las funciones security definer de abajo.

create policy admins_leer_propio   on pos.admins for select to authenticated using (user_id = auth.uid() or pos.es_supervisor());
create policy admins_supervisor    on pos.admins for all    to authenticated using (pos.es_supervisor()) with check (pos.es_supervisor());

create policy disp_supervisor      on pos.dispositivos for all to authenticated using (pos.es_supervisor()) with check (pos.es_supervisor());

create policy contadores_ninguno   on pos.contadores for select to authenticated using (pos.es_supervisor());

create policy versiones_leer       on pos.versiones for select to authenticated using (pos.es_admin());
create policy versiones_supervisor on pos.versiones for all    to authenticated using (pos.es_supervisor()) with check (pos.es_supervisor());

create policy solic_leer           on pos.solicitudes_autorizacion for select to authenticated using (pos.es_supervisor());
create policy solic_resolver       on pos.solicitudes_autorizacion for update to authenticated using (pos.es_supervisor() and estado = 'pendiente') with check (pos.es_supervisor());

-- ─────────── funciones ───────────
-- Agrega operaciones (idempotente por op_id). Devuelve cuántas eran nuevas y el último seq.
create or replace function pos.subir_ops(p_ops jsonb) returns jsonb
language plpgsql security definer set search_path = pos, public as $$
declare
  nuevas integer := 0;
  ultimo bigint;
  o jsonb;
begin
  if not pos.es_admin() then raise exception 'sin permiso' using errcode = '42501'; end if;
  for o in select * from jsonb_array_elements(p_ops) loop
    if not pos.es_supervisor() and not pos.tipo_de_almacen(o->>'tipo') then
      raise exception 'tipo de operación no permitido para este rol: %', o->>'tipo' using errcode = '42501';
    end if;
    insert into pos.ops (op_id, tipo, tienda, caja, origen, ocurrio_en, payload)
    values (o->>'op_id', o->>'tipo', o->>'tienda', nullif(o->>'caja', '')::integer, 'admin:' || auth.uid()::text, (o->>'ocurrio_en')::timestamptz, o->'payload')
    on conflict (op_id) do nothing;
    if found then nuevas := nuevas + 1; end if;
  end loop;
  select coalesce(max(seq), 0) into ultimo from pos.ops;
  return jsonb_build_object('nuevas', nuevas, 'ultimo_seq', ultimo);
end $$;

-- Lee operaciones nuevas desde un cursor (para la web de Administración).
create or replace function pos.bajar_ops(p_desde bigint default 0, p_limite integer default 1000) returns setof pos.ops
language sql stable security invoker set search_path = pos, public as
$$ select * from pos.ops where seq > p_desde order by seq limit least(greatest(p_limite, 1), 5000) $$;

-- Reserva un bloque de Item # (lo asigna solo el central).
create or replace function pos.reservar_item_no(p_k integer) returns jsonb
language plpgsql security definer set search_path = pos, public as $$
declare hasta bigint;
begin
  if not pos.es_admin() then raise exception 'sin permiso' using errcode = '42501'; end if;
  if p_k < 1 or p_k > 1000 then raise exception 'bloque inválido'; end if;
  update pos.contadores set valor = valor + p_k where clave = 'item_no' returning valor into hasta;
  return jsonb_build_object('desde', hasta - p_k + 1, 'hasta', hasta);
end $$;

-- ─────────── tiempo real ───────────
-- Las solicitudes de autorización llegan al iPhone al instante; la bitácora permite avisar de cambios.
do $$ begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table pos.solicitudes_autorizacion;
    alter publication supabase_realtime add table pos.ops;
  end if;
end $$;
