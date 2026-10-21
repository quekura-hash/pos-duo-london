-- LonDuo POS · migración 0005 · notificaciones push al teléfono del supervisor
-- Qué crea:
--  · pos.suscripciones_push: un dispositivo (iPhone en la pantalla de inicio, Mac…) por fila, con SUS preferencias (cada venta, corte, resumen del día…).
--  · pos.ajustes_internos: dirección de la función de avisos y su clave compartida (sin acceso para nadie más que el servidor).
--  · Un disparador en pos.ops: cuando entra una venta, devolución, cancelación, retiro, corte o alerta, avisa a la Edge Function `notificar`.
--    Una falla de aviso NUNCA frena ni revierte una venta.
--  · Un trabajo programado cada 15 minutos que dispara el resumen del día (a la hora que cada dispositivo eligió).
-- Después de correrla hay que desplegar la función `notificar` y ejecutar pos.configurar_notificaciones(url, clave) (ver docs/notificaciones.md).
-- Requiere las extensiones pg_net y pg_cron (incluidas en Supabase).

create extension if not exists pg_net with schema extensions;
create extension if not exists pg_cron;

create table if not exists pos.suscripciones_push (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users (id) on delete cascade,
  endpoint     text not null unique,                         -- dirección que el navegador del dispositivo da para recibir avisos
  p256dh       text not null,                                -- llaves públicas del dispositivo (cifrado del aviso)
  auth         text not null,
  dispositivo  text,                                         -- p. ej. «iPhone de Edgardo»
  prefs        jsonb not null default '{}'::jsonb,           -- ver supabase/functions/notificar/formato.ts (Prefs)
  pausa_hasta  timestamptz,                                  -- «no molestar» hasta…
  ultimo_resumen date,                                       -- último día (local) en que se mandó el resumen
  activa       boolean not null default true,
  creada_en    timestamptz not null default now(),
  ultima_ok    timestamptz,
  ultimo_error text
);
create index if not exists suscripciones_push_user on pos.suscripciones_push (user_id);

alter table pos.suscripciones_push enable row level security;
-- Cada supervisor ve y maneja SOLO sus dispositivos.
create policy suscripciones_propias on pos.suscripciones_push for all to authenticated
  using (user_id = auth.uid() and pos.es_supervisor()) with check (user_id = auth.uid() and pos.es_supervisor());
grant select, insert, update, delete on pos.suscripciones_push to authenticated;

create table if not exists pos.ajustes_internos (clave text primary key, valor text not null);
alter table pos.ajustes_internos enable row level security;   -- sin políticas y sin permisos: solo el servidor la lee

-- Avisa a la función cuando entra algo que merece notificación.
create or replace function pos.notificar_op() returns trigger
language plpgsql security definer set search_path = pos, public, extensions as $$
declare
  v_url text;
  v_clave text;
begin
  select valor into v_url from pos.ajustes_internos where clave = 'notificar_url';
  select valor into v_clave from pos.ajustes_internos where clave = 'notificar_clave';
  if v_url is null or v_clave is null then return new; end if;   -- sin configurar: no hace nada
  perform net.http_post(
    url := v_url,
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-londuo-secret', v_clave),
    body := jsonb_build_object('op_id', new.op_id, 'tipo', new.tipo),
    timeout_milliseconds := 5000);
  return new;
exception when others then
  return new;                                                   -- un aviso fallido no debe frenar la venta
end $$;

drop trigger if exists ops_notificar on pos.ops;
create trigger ops_notificar after insert on pos.ops
  for each row when (new.tipo in ('sale.confirmed', 'sale.cancelled', 'return.registered', 'cash.retiro', 'corte.generado', 'doc.perdida_posible', 'alm.faltante'))
  execute function pos.notificar_op();

-- Se corre UNA vez, con el servidor (SQL Editor o herramienta de administración), después de desplegar la función.
create or replace function pos.configurar_notificaciones(p_url text, p_clave text) returns void
language plpgsql security definer set search_path = pos, public, extensions as $$
begin
  if p_url !~ '^https://' or length(p_clave) < 24 then raise exception 'dirección o clave inválidas'; end if;
  insert into pos.ajustes_internos (clave, valor) values ('notificar_url', p_url) on conflict (clave) do update set valor = excluded.valor;
  insert into pos.ajustes_internos (clave, valor) values ('notificar_clave', p_clave) on conflict (clave) do update set valor = excluded.valor;
  perform cron.unschedule(jobid) from cron.job where jobname = 'londuo-resumen-dia';
  perform cron.schedule('londuo-resumen-dia', '*/15 * * * *',
    format($c$select net.http_post(url := %L, headers := jsonb_build_object('Content-Type', 'application/json', 'x-londuo-secret', %L), body := jsonb_build_object('accion', 'resumen'), timeout_milliseconds := 20000)$c$, p_url, p_clave));
end $$;
revoke all on function pos.configurar_notificaciones(text, text) from public, anon, authenticated;
revoke all on function pos.notificar_op() from public, anon, authenticated;
