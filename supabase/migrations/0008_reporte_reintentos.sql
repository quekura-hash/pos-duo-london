-- LonDuo POS · migración 0008 · reintentos del correo a la contadora y aviso al teléfono
-- Reglas: el último día del mes se intenta a las 9, 10 y 11 p. m. (hora de Hermosillo) y, si siguen sin salir, a las 9 a. m. del día siguiente
-- (4 intentos en total). Si los 4 fallan se le manda un aviso al teléfono del supervisor («El reporte no se envió») y ya no se insiste.
-- Qué cambia:
--  · pos.envios_reporte: intentos, último error y cuándo se avisó.
--  · pos.reclamar_envio_reporte: no reserva si ya se agotaron los 4 intentos.
--  · pos.fallar_envio_reporte: anota el fallo (suma el intento, guarda el error y libera la reserva para el siguiente intento).
--  · pos.marcar_aviso_reporte: deja constancia de que ya se avisó (un solo aviso por envío).
--  · pos.configurar_reporte_contadora: la corrida pasa a 04:00, 05:00, 06:00 y 16:00 UTC (21:00, 22:00, 23:00 y 09:00 de Hermosillo).

alter table pos.envios_reporte add column if not exists intentos integer not null default 0;
alter table pos.envios_reporte add column if not exists ultimo_error text;
alter table pos.envios_reporte add column if not exists avisado_en timestamptz;
-- El supervisor ve en Reportes también lo que falló o está pendiente (ya tenía permiso de lectura sobre toda la tabla).

create or replace function pos.reclamar_envio_reporte(p_periodo text, p_tienda text, p_caja integer) returns boolean
language plpgsql security definer set search_path = pos, public as $$
declare ok boolean;
begin
  insert into pos.envios_reporte (periodo, tienda, caja) values (p_periodo, p_tienda, p_caja)
  on conflict (periodo, tienda, caja) do update set reservado_en = now()
    where pos.envios_reporte.enviado_en is null and pos.envios_reporte.intentos < 4 and pos.envios_reporte.reservado_en < now() - interval '30 minutes'
  returning true into ok;
  return coalesce(ok, false);
end $$;

-- Un fallo: suma el intento, guarda el error y libera la reserva (el siguiente intento puede tomarla enseguida). Devuelve los intentos hechos.
create or replace function pos.fallar_envio_reporte(p_periodo text, p_tienda text, p_caja integer, p_error text) returns integer
language sql security definer set search_path = pos, public as $$
  update pos.envios_reporte set intentos = intentos + 1, ultimo_error = left(p_error, 300), reservado_en = now() - interval '1 day'
  where periodo = p_periodo and tienda = p_tienda and caja = p_caja and enviado_en is null
  returning intentos $$;

create or replace function pos.marcar_aviso_reporte(p_periodo text, p_tienda text, p_caja integer) returns void
language sql security definer set search_path = pos, public as $$
  update pos.envios_reporte set avisado_en = now() where periodo = p_periodo and tienda = p_tienda and caja = p_caja and avisado_en is null $$;

revoke all on function pos.reclamar_envio_reporte(text, text, integer), pos.fallar_envio_reporte(text, text, integer, text), pos.marcar_aviso_reporte(text, text, integer) from public, anon, authenticated;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function pos.reclamar_envio_reporte(text, text, integer), pos.fallar_envio_reporte(text, text, integer, text), pos.marcar_aviso_reporte(text, text, integer) to service_role;
  end if;
end $$;

create or replace function pos.configurar_reporte_contadora(p_url text) returns void
language plpgsql security definer set search_path = pos, public, extensions as $$
declare v_clave text;
begin
  if p_url !~ '^https://' then raise exception 'dirección inválida'; end if;
  select valor into v_clave from pos.ajustes_internos where clave = 'notificar_clave';
  if v_clave is null then raise exception 'primero ejecute pos.configurar_notificaciones (define la clave compartida)'; end if;
  insert into pos.ajustes_internos (clave, valor) values ('reporte_url', p_url) on conflict (clave) do update set valor = excluded.valor;
  perform cron.unschedule(jobid) from cron.job where jobname = 'londuo-reporte-mensual';
  perform cron.schedule('londuo-reporte-mensual', '0 4,5,6,16 * * *',
    format($c$select net.http_post(url := %L, headers := jsonb_build_object('Content-Type', 'application/json', 'x-londuo-secret', %L), body := jsonb_build_object('accion', 'mensual'), timeout_milliseconds := 120000)$c$, p_url, v_clave));
end $$;
revoke all on function pos.configurar_reporte_contadora(text) from public, anon, authenticated;
