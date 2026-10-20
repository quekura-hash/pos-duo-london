-- LonDuo POS · migración 0003 · cajas como dispositivos del central
-- Cada caja (PC) entra con su PROPIO usuario de Supabase Auth (p. ej. caja-duo-1@…), registrado en pos.admins con rol 'caja', su tienda y su número.
-- Una caja puede: leer el catálogo y la configuración (lo que ya se reparte a las cajas) y lo de SU tienda; subir lo que una caja produce (ventas, movimientos…) solo de su tienda.
-- Una caja NO puede: subir ni leer cuentas de administradores, ni crear promociones, usuarios, permisos, departamentos o recompensas, ni editar artículos.
-- Ejecutar UNA vez, después de 0001 (y 0002 si aplica).

alter table pos.admins drop constraint if exists admins_rol_check;
alter table pos.admins add constraint admins_rol_check check (rol in ('supervisor', 'almacenista', 'caja'));
alter table pos.admins add column if not exists tienda text;
alter table pos.admins add column if not exists caja integer;
alter table pos.admins add constraint admins_caja_datos check (rol <> 'caja' or (tienda is not null and caja is not null));

-- «Administrador de la web» = supervisor o almacenista (una caja no lo es).
create or replace function pos.es_admin() returns boolean
language sql stable security definer set search_path = pos, public as
$$ select exists (select 1 from pos.admins a where a.user_id = auth.uid() and a.activo and a.rol in ('supervisor', 'almacenista')) $$;

create or replace function pos.es_caja() returns boolean
language sql stable security definer set search_path = pos, public as
$$ select exists (select 1 from pos.admins a where a.user_id = auth.uid() and a.activo and a.rol = 'caja') $$;

create or replace function pos.mi_tienda() returns text
language sql stable security definer set search_path = pos, public as
$$ select a.tienda from pos.admins a where a.user_id = auth.uid() and a.activo and a.rol = 'caja' $$;

create or replace function pos.mi_caja() returns integer
language sql stable security definer set search_path = pos, public as
$$ select a.caja from pos.admins a where a.user_id = auth.uid() and a.activo and a.rol = 'caja' $$;

-- Lo que el central reparte a TODAS las cajas (catálogo, configuración y usuarios de caja).
create or replace function pos.tipo_para_cajas(t text) returns boolean
language sql immutable as
$$ select t in ('item.created', 'item.item_no_assigned', 'item.codigo_corregido', 'item.editado', 'doc.perdida_resuelta', 'config.tipo_cambio', 'config.sesion', 'config.negocio',
                'permiso.asignado', 'depto.alta', 'depto.editado', 'alm.entrega', 'alm.faltante', 'promo.guardada', 'recompensa.guardada', 'supervisor.guardado', 'cajero.guardado')
          or t like 'giftcard.%' $$;

-- Lo que una caja NUNCA puede subir (es de Administración).
create or replace function pos.tipo_solo_admin(t text) returns boolean
language sql immutable as
$$ select t in ('item.editado', 'item.codigo_corregido', 'doc.perdida_resuelta', 'alm.entrega', 'alm.faltante', 'admin.guardado', 'supervisor.guardado', 'cajero.guardado', 'promo.guardada', 'recompensa.guardada',
                'permiso.asignado', 'depto.alta', 'depto.editado', 'config.sesion', 'config.negocio')
          or (t like 'config.%' and t <> 'config.tipo_cambio') $$;

drop policy if exists ops_leer_caja on pos.ops;
create policy ops_leer_caja on pos.ops for select to authenticated
  using (pos.es_caja() and tipo <> 'admin.guardado' and (pos.tipo_para_cajas(tipo) or tienda = pos.mi_tienda() or payload ->> 'tienda' in (pos.mi_tienda(), 'LIMBO')));

-- subir_ops: ahora también para cajas, con sus límites. Las operaciones de una caja quedan con origen `caja:<tienda>/<n>`.
create or replace function pos.subir_ops(p_ops jsonb) returns jsonb
language plpgsql security definer set search_path = pos, public as $$
declare
  nuevas integer := 0;
  ultimo bigint;
  o jsonb;
  caja boolean := pos.es_caja();
  origen text;
begin
  if not (pos.es_admin() or caja) then raise exception 'sin permiso' using errcode = '42501'; end if;
  if caja then origen := 'caja:' || pos.mi_tienda() || '/' || pos.mi_caja(); else origen := 'admin:' || auth.uid()::text; end if;
  for o in select * from jsonb_array_elements(p_ops) loop
    if caja then
      if pos.tipo_solo_admin(o ->> 'tipo') then raise exception 'tipo de operación no permitido para una caja: %', o ->> 'tipo' using errcode = '42501'; end if;
      if (o ->> 'tienda') is not null and (o ->> 'tienda') <> pos.mi_tienda() and (o ->> 'tienda') <> 'LIMBO' then
        raise exception 'una caja solo sube operaciones de su tienda' using errcode = '42501';
      end if;
    elsif not pos.es_supervisor() and not pos.tipo_de_almacen(o ->> 'tipo') then
      raise exception 'tipo de operación no permitido para este rol: %', o ->> 'tipo' using errcode = '42501';
    end if;
    insert into pos.ops (op_id, tipo, tienda, caja, origen, ocurrio_en, payload)
    values (o ->> 'op_id', o ->> 'tipo', o ->> 'tienda', nullif(o ->> 'caja', '')::integer, origen, (o ->> 'ocurrio_en')::timestamptz, o -> 'payload')
    on conflict (op_id) do nothing;
    if found then nuevas := nuevas + 1; end if;
  end loop;
  select coalesce(max(seq), 0) into ultimo from pos.ops;
  return jsonb_build_object('nuevas', nuevas, 'ultimo_seq', ultimo);
end $$;

-- bajar_ops es security invoker: la RLS de arriba decide qué ve cada quien. Una caja puede pedir un bloque de Item #.
create or replace function pos.reservar_item_no(p_k integer) returns jsonb
language plpgsql security definer set search_path = pos, public as $$
declare hasta bigint;
begin
  if not (pos.es_admin() or pos.es_caja()) then raise exception 'sin permiso' using errcode = '42501'; end if;
  if p_k < 1 or p_k > 1000 then raise exception 'bloque inválido'; end if;
  update pos.contadores set valor = valor + p_k where clave = 'item_no' returning valor into hasta;
  return jsonb_build_object('desde', hasta - p_k + 1, 'hasta', hasta);
end $$;

grant execute on function pos.es_caja(), pos.mi_tienda(), pos.mi_caja(), pos.tipo_para_cajas(text), pos.tipo_solo_admin(text) to authenticated;
