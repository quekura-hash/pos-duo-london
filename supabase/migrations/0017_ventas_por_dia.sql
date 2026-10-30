-- 0017: ventas por día de la tienda, calculadas en el central con las MISMAS reglas que Administración (ventas confirmadas no canceladas + ventas importadas del
-- POS anterior sin las copias duplicadas descartadas). La barra de metas de la caja la consulta, así marca lo mismo que Administración.
-- Administración ve todas las tiendas; una caja, solo la suya. Solo lectura.

create or replace function pos.ventas_por_dia(p_desde date, p_hasta date)
returns table (tienda text, fecha date, total bigint)
language plpgsql stable security definer set search_path = pos, public as $$
declare
  solo_tienda text;
begin
  if pos.es_admin() then solo_tienda := null;
  elsif pos.es_caja() then solo_tienda := pos.mi_tienda();
  else raise exception 'sin permiso' using errcode = '42501';
  end if;
  return query
  with ventas as (
    select o.payload ->> 'tienda' as t, (o.ocurrio_en at time zone 'America/Hermosillo')::date as f, (o.payload ->> 'total')::bigint as v
    from pos.ops o
    where o.tipo = 'sale.confirmed'
      and (o.ocurrio_en at time zone 'America/Hermosillo')::date between p_desde and p_hasta
      and (solo_tienda is null or o.payload ->> 'tienda' = solo_tienda)
      and not exists (select 1 from pos.ops c where c.tipo = 'sale.cancelled' and c.payload ->> 'sale_id' = o.payload ->> 'sale_id')
  ), hist as (
    select h.payload ->> 'tienda_hist' as t, (h.payload ->> 'fecha')::date as f, (h.payload ->> 'total')::bigint as v
    from pos.ops h
    where h.tipo = 'venta.historica'
      and (h.payload ->> 'fecha')::date between p_desde and p_hasta
      and (solo_tienda is null or h.payload ->> 'tienda_hist' = solo_tienda)
      and not exists (
        select 1 from pos.ops r
        where r.tipo = 'historico.duplicados'
          and r.payload ->> 'tienda' = h.payload ->> 'tienda_hist'
          and r.payload ->> 'caja' = h.payload ->> 'caja_hist'
          and exists (
            select 1 from pos.ops ref
            where ref.tipo = 'venta.historica'
              and ref.payload ->> 'tienda_hist' = h.payload ->> 'tienda_hist'
              and ref.payload ->> 'caja_hist' = r.payload ->> 'igual_a_caja'
              and ref.payload ->> 'folio' = h.payload ->> 'folio'
              and ref.payload ->> 'fecha' = h.payload ->> 'fecha'
              and ref.payload ->> 'total' = h.payload ->> 'total'
              and ref.payload ->> 'tipo_hist' = h.payload ->> 'tipo_hist'))
  )
  select x.t, x.f, sum(x.v)::bigint from (select * from ventas union all select * from hist) x group by x.t, x.f;
end $$;

grant execute on function pos.ventas_por_dia(date, date) to authenticated;
revoke execute on function pos.ventas_por_dia(date, date) from public, anon;
