-- LonDuo POS · revisión (SOLO LECTURA) de lo que una caja subió durante la práctica.
-- No modifica nada. Sirve para decidir qué se borra antes de importar el reporte real.
-- Cambie los tres valores de la CTE `p` y ejecute cada bloque por separado (Supabase Studio).

with p as (select 'DUO'::text as tienda, 2::int as caja, timestamptz '2026-10-01 00:00:00+00' as desde)

-- 1) Resumen por tipo de evento de esa caja desde la fecha dada.
select o.tipo, count(*) as eventos, min(o.ocurrio_en) as primero, max(o.ocurrio_en) as ultimo
from pos.ops o, p
where o.tienda = p.tienda and o.caja = p.caja and o.ocurrio_en >= p.desde
group by o.tipo order by o.tipo;

-- 2) Ventas de esa caja: cantidad y total (centavos) de las confirmadas, y cuántas se cancelaron.
with p as (select 'DUO'::text as tienda, 2::int as caja, timestamptz '2026-10-01 00:00:00+00' as desde)
select
  count(*) filter (where o.tipo = 'sale.confirmed') as ventas_confirmadas,
  count(*) filter (where o.tipo = 'sale.cancelled') as ventas_canceladas,
  count(*) filter (where o.tipo = 'return.registered') as devoluciones,
  count(*) filter (where o.tipo in ('corte.generado', 'cash.retiro', 'cash.conteo')) as cortes_y_retiros,
  min(o.ocurrio_en) filter (where o.tipo = 'sale.confirmed') as primera_venta,
  max(o.ocurrio_en) filter (where o.tipo = 'sale.confirmed') as ultima_venta
from pos.ops o, p
where o.tienda = p.tienda and o.caja = p.caja and o.ocurrio_en >= p.desde;

-- 3) Eventos SIN caja (catálogo, almacén, configuración) hechos en el mismo periodo: NO se borrarían, solo se listan para que usted decida.
with p as (select 'DUO'::text as tienda, 2::int as caja, timestamptz '2026-10-01 00:00:00+00' as desde)
select o.tipo, count(*) as eventos, min(o.ocurrio_en) as primero, max(o.ocurrio_en) as ultimo
from pos.ops o, p
where o.caja is null and o.ocurrio_en >= p.desde and o.tipo not in ('item.created', 'venta.historica')
group by o.tipo order by o.tipo;

-- 4) Folios usados por esa caja (rango) para comprobar que no chocan con el reporte real.
with p as (select 'DUO'::text as tienda, 2::int as caja, timestamptz '2026-10-01 00:00:00+00' as desde)
select min((o.payload->>'folio')) as folio_min, max((o.payload->>'folio')) as folio_max, count(*) as tickets
from pos.ops o, p
where o.tipo = 'sale.confirmed' and o.tienda = p.tienda and o.caja = p.caja and o.ocurrio_en >= p.desde;
