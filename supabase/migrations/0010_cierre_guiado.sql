-- LonDuo POS · migración 0010 · cierre de caja guiado: fondo fijo por caja y ajustes de efectivo de Administración
-- Qué cambia (solo reglas de qué operaciones viajan a las cajas y quién puede escribirlas; no toca datos):
--  · `caja.fondo_autorizado` (el fondo fijo de cada caja) y `cash.ajuste_admin` (entregas o ajustes de efectivo) son SOLO de Administración:
--    una caja no puede escribirlas, pero sí las recibe (se reparten a las cajas) para armar su cierre y su efectivo esperado.
--  · `cash.fondo` (la confirmación del fondo que hace la cajera al cerrar) la sube la propia caja como cualquier operación de caja: no necesita regla.
-- Después de correrla no hay nada más que configurar. Es idempotente (create or replace).

create or replace function pos.tipo_para_cajas(t text) returns boolean
language sql immutable as
$$ select t in ('item.created', 'item.item_no_assigned', 'item.codigo_corregido', 'item.editado', 'doc.perdida_resuelta', 'config.tipo_cambio', 'config.sesion', 'config.negocio',
                'permiso.asignado', 'depto.alta', 'depto.editado', 'alm.entrega', 'alm.faltante', 'promo.guardada', 'recompensa.guardada', 'supervisor.guardado', 'cajero.guardado',
                'cajero.ubicacion', 'caja.fondo_autorizado', 'cash.ajuste_admin')
          or t like 'giftcard.%' $$;

create or replace function pos.tipo_solo_admin(t text) returns boolean
language sql immutable as
$$ select t in ('item.editado', 'item.codigo_corregido', 'doc.perdida_resuelta', 'alm.entrega', 'alm.faltante', 'admin.guardado', 'supervisor.guardado', 'cajero.guardado', 'promo.guardada', 'recompensa.guardada',
                'permiso.asignado', 'depto.alta', 'depto.editado', 'config.sesion', 'config.negocio', 'trabajadora.expediente', 'caja.fondo_autorizado', 'cash.ajuste_admin')
          or (t like 'config.%' and t <> 'config.tipo_cambio') $$;
