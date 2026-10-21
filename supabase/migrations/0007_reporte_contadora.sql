-- LonDuo POS · migración 0007 · reporte mensual de ventas por correo a la contadora
-- Qué crea:
--  · pos.reporte_contadora: por CAJA (tienda + número), si el envío está activo y a qué correos va (lo edita un supervisor desde Reportes).
--  · pos.envios_reporte: bitácora de lo enviado (periodo + caja), con reserva atómica para no mandar dos veces.
--  · pos.reclamar_envio_reporte / liberar_envio_reporte / registrar_envio_reporte: las usa SOLO la función `reporte-contadora` (servidor).
--  · pos.configurar_reporte_contadora(url): programa la corrida diaria a las 9 p. m. de Hermosillo (04:00 UTC); la función decide si toca enviar
--    (último día del mes, o días 1 al 3 si faltó el mes anterior). Reutiliza la clave compartida de `notificar` (pos.ajustes_internos).
-- Después de correrla: desplegar la función, guardar RESEND_API_KEY como secreto de la función y ejecutar pos.configurar_reporte_contadora(url).

create table if not exists pos.reporte_contadora (
  tienda         text not null check (tienda in ('DUO', 'LON')),
  caja           integer not null check (caja >= 1),
  activo         boolean not null default false,
  correos        text[] not null default '{}',
  actualizado_en timestamptz not null default now(),
  actualizado_por uuid references auth.users (id) on delete set null,
  primary key (tienda, caja)
);
alter table pos.reporte_contadora enable row level security;
drop policy if exists reporte_contadora_supervisor on pos.reporte_contadora;
create policy reporte_contadora_supervisor on pos.reporte_contadora for all to authenticated
  using (pos.es_supervisor()) with check (pos.es_supervisor());
grant select, insert, update on pos.reporte_contadora to authenticated;

create table if not exists pos.envios_reporte (
  periodo      text not null check (periodo ~ '^\d{4}-\d{2}$'),
  tienda       text not null,
  caja         integer not null,
  reservado_en timestamptz not null default now(),
  enviado_en   timestamptz,
  correos      text[] not null default '{}',
  tickets      integer,
  total        bigint,                                     -- centavos
  proveedor_id text,                                       -- id del correo en Resend
  primary key (periodo, tienda, caja)
);
alter table pos.envios_reporte enable row level security;
drop policy if exists envios_reporte_supervisor on pos.envios_reporte;
create policy envios_reporte_supervisor on pos.envios_reporte for select to authenticated using (pos.es_supervisor());
grant select on pos.envios_reporte to authenticated;

-- Reserva (periodo, tienda, caja): true solo para quien la obtiene. Una reserva que nunca se completó (la función se cayó) se puede retomar a los 30 minutos.
create or replace function pos.reclamar_envio_reporte(p_periodo text, p_tienda text, p_caja integer) returns boolean
language plpgsql security definer set search_path = pos, public as $$
declare ok boolean;
begin
  insert into pos.envios_reporte (periodo, tienda, caja) values (p_periodo, p_tienda, p_caja)
  on conflict (periodo, tienda, caja) do update set reservado_en = now()
    where pos.envios_reporte.enviado_en is null and pos.envios_reporte.reservado_en < now() - interval '30 minutes'
  returning true into ok;
  return coalesce(ok, false);
end $$;
create or replace function pos.liberar_envio_reporte(p_periodo text, p_tienda text, p_caja integer) returns void
language sql security definer set search_path = pos, public as $$
  delete from pos.envios_reporte where periodo = p_periodo and tienda = p_tienda and caja = p_caja and enviado_en is null $$;
create or replace function pos.registrar_envio_reporte(p_periodo text, p_tienda text, p_caja integer, p_correos text[], p_tickets integer, p_total bigint, p_proveedor text) returns void
language sql security definer set search_path = pos, public as $$
  update pos.envios_reporte set enviado_en = now(), correos = p_correos, tickets = p_tickets, total = p_total, proveedor_id = p_proveedor
  where periodo = p_periodo and tienda = p_tienda and caja = p_caja $$;
revoke all on function pos.reclamar_envio_reporte(text, text, integer), pos.liberar_envio_reporte(text, text, integer), pos.registrar_envio_reporte(text, text, integer, text[], integer, bigint, text) from public, anon, authenticated;

-- Permisos del servidor (si el rol existe: en Supabase siempre; en las pruebas locales no).
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant select, insert, update on pos.reporte_contadora to service_role;
    grant select, insert, update, delete on pos.envios_reporte to service_role;
    grant execute on function pos.reclamar_envio_reporte(text, text, integer), pos.liberar_envio_reporte(text, text, integer), pos.registrar_envio_reporte(text, text, integer, text[], integer, bigint, text) to service_role;
  end if;
end $$;

-- Se corre UNA vez, con el servidor, después de desplegar la función. Usa la clave compartida que ya dejó configurar_notificaciones.
create or replace function pos.configurar_reporte_contadora(p_url text) returns void
language plpgsql security definer set search_path = pos, public, extensions as $$
declare v_clave text;
begin
  if p_url !~ '^https://' then raise exception 'dirección inválida'; end if;
  select valor into v_clave from pos.ajustes_internos where clave = 'notificar_clave';
  if v_clave is null then raise exception 'primero ejecute pos.configurar_notificaciones (define la clave compartida)'; end if;
  insert into pos.ajustes_internos (clave, valor) values ('reporte_url', p_url) on conflict (clave) do update set valor = excluded.valor;
  perform cron.unschedule(jobid) from cron.job where jobname = 'londuo-reporte-mensual';
  perform cron.schedule('londuo-reporte-mensual', '0 4 * * *',
    format($c$select net.http_post(url := %L, headers := jsonb_build_object('Content-Type', 'application/json', 'x-londuo-secret', %L), body := jsonb_build_object('accion', 'mensual'), timeout_milliseconds := 120000)$c$, p_url, v_clave));
end $$;
revoke all on function pos.configurar_reporte_contadora(text) from public, anon, authenticated;
