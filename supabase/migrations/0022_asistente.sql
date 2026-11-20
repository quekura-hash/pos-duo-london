-- LonDuo POS · migración 0022 · rol «asistente» (Inventario, Almacén y Empleadas)
-- Qué hace (solo reglas de acceso; no toca datos):
--  · Nuevo rol de Administración `asistente`: trabaja Inventario y Almacén como el almacenista y, además, las cuentas de crédito de empleadas
--    (ver cuentas y movimientos, ver la nómina y registrar ABONOS de nómina). Los ajustes, el límite de crédito y la configuración siguen siendo solo del supervisor.
--  · LEE (pos.bajar_ops, para el asistente): lo de inventario y almacén (igual que el almacenista) y, nada más, lo que necesita Empleadas:
--      - empleada.credito, empleada.movimiento, empleadas.config y cajero.ubicacion;
--      - las compras a crédito de empleada (sale.confirmed con pago credito_empleada) y sus cancelaciones y devoluciones;
--      - la lista de personal (cajero.guardado y supervisor.guardado) SIN la sal ni la huella de la clave ni el perfil: solo id, nombre, activo, eliminado, tienda.
--    Nunca ve ventas normales, cortes, reportes ni claves.
--  · ESCRIBE (pos.subir_ops, para el asistente): lo de inventario y almacén y empleada.movimiento de tipo `abono`. Cualquier otra cosa se rechaza.
-- Es idempotente. Misma firma que las funciones actuales. Aplicada a producción.

alter table pos.admins drop constraint if exists admins_rol_check;
alter table pos.admins add constraint admins_rol_check check (rol in ('supervisor', 'almacenista', 'asistente', 'caja', 'publicador'));

create or replace function pos.es_asistente() returns boolean
language sql stable security definer set search_path = pos, public as
$$ select exists (select 1 from pos.admins a where a.user_id = auth.uid() and a.activo and a.rol = 'asistente') $$;

-- «Administrador de la web» = supervisor, almacenista o asistente (una caja no lo es).
create or replace function pos.es_admin() returns boolean
language sql stable security definer set search_path = pos, public as
$$ select exists (select 1 from pos.admins a where a.user_id = auth.uid() and a.activo and a.rol in ('supervisor', 'almacenista', 'asistente')) $$;

-- Lo que baja un asistente (además de lo de almacén, que la RLS ya le deja leer). Corre con permisos del dueño de la función para poder quitar datos sensibles.
create or replace function pos.ops_para_asistente(p_desde bigint, p_limite integer) returns setof pos.ops
language sql stable security definer set search_path = pos, public as $$
  with credito as (
    select o.payload ->> 'sale_id' as sale_id
    from pos.ops o
    where o.tipo = 'sale.confirmed' and o.payload -> 'pagos' @> '[{"metodo": "credito_empleada"}]'::jsonb
  )
  select o.seq, o.op_id, o.tipo, o.tienda, o.caja, o.origen, o.ocurrio_en, o.recibido_en,
         case when o.tipo in ('cajero.guardado', 'supervisor.guardado')
              then jsonb_strip_nulls(jsonb_build_object('id', o.payload -> 'id', 'nombre', o.payload -> 'nombre', 'activo', o.payload -> 'activo', 'eliminado', o.payload -> 'eliminado', 'tienda', o.payload -> 'tienda'))
              else o.payload end
  from pos.ops o
  where pos.es_asistente() and o.seq > p_desde
    and (pos.tipo_de_almacen(o.tipo)
         or o.tipo in ('empleada.credito', 'empleada.movimiento', 'empleadas.config', 'cajero.ubicacion', 'cajero.guardado', 'supervisor.guardado')
         or (o.tipo = 'sale.confirmed' and o.payload -> 'pagos' @> '[{"metodo": "credito_empleada"}]'::jsonb)
         or (o.tipo in ('sale.cancelled', 'return.registered') and o.payload ->> 'sale_id' in (select sale_id from credito)))
  order by o.seq
  limit least(greatest(p_limite, 1), 5000)
$$;
-- Quien no es asistente recibe cero filas (la propia consulta lo exige).
grant execute on function pos.ops_para_asistente(bigint, integer) to authenticated;
revoke execute on function pos.ops_para_asistente(bigint, integer) from public, anon;

-- bajar_ops: igual que antes (la RLS decide qué ve cada quien), salvo el asistente, que recibe la versión recortada de arriba.
create or replace function pos.bajar_ops(p_desde bigint default 0, p_limite integer default 1000) returns setof pos.ops
language plpgsql stable set search_path = pos, public as $$
begin
  if pos.es_asistente() then
    return query select * from pos.ops_para_asistente(p_desde, p_limite);
  else
    return query select * from pos.ops where seq > p_desde order by seq limit least(greatest(p_limite, 1), 5000);
  end if;
end $$;
grant execute on function pos.es_asistente() to authenticated;
grant execute on function pos.bajar_ops(bigint, integer) to authenticated;
revoke execute on function pos.bajar_ops(bigint, integer) from public, anon;

-- subir_ops: el asistente, además de lo de almacén, solo puede registrar abonos de nómina.
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
    elsif not pos.es_supervisor()
          and not pos.tipo_de_almacen(o ->> 'tipo')
          and not (pos.es_asistente() and (o ->> 'tipo') = 'empleada.movimiento' and (o -> 'payload' ->> 'tipo') = 'abono') then
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
