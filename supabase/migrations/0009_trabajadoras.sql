-- LonDuo POS · migración 0009 · trabajadoras: tienda donde trabajan y expediente privado
-- Qué cambia (solo reglas de qué operaciones viajan a las cajas y quién puede escribirlas; no toca datos):
--  · `cajero.ubicacion` (una Vendedora-Cajera inició sesión en otra tienda y pasa a trabajar ahí) se reparte a TODAS las cajas: así «Vendió por»
--    deja de mostrarla en la tienda anterior. La sube la propia caja.
--  · `trabajadora.expediente` (fechas, recontratable, calificaciones y notas) es SOLO de Administración: una caja no puede escribirla. Tampoco la lee:
--    no está en la lista de lo que se reparte a las cajas y no lleva tienda; el almacenista tampoco (solo ve inventario y almacén).
-- Después de correrla no hay nada más que configurar. Es idempotente (create or replace).

create or replace function pos.tipo_para_cajas(t text) returns boolean
language sql immutable as
$$ select t in ('item.created', 'item.item_no_assigned', 'item.codigo_corregido', 'item.editado', 'doc.perdida_resuelta', 'config.tipo_cambio', 'config.sesion', 'config.negocio',
                'permiso.asignado', 'depto.alta', 'depto.editado', 'alm.entrega', 'alm.faltante', 'promo.guardada', 'recompensa.guardada', 'supervisor.guardado', 'cajero.guardado',
                'cajero.ubicacion')
          or t like 'giftcard.%' $$;

create or replace function pos.tipo_solo_admin(t text) returns boolean
language sql immutable as
$$ select t in ('item.editado', 'item.codigo_corregido', 'doc.perdida_resuelta', 'alm.entrega', 'alm.faltante', 'admin.guardado', 'supervisor.guardado', 'cajero.guardado', 'promo.guardada', 'recompensa.guardada',
                'permiso.asignado', 'depto.alta', 'depto.editado', 'config.sesion', 'config.negocio', 'trabajadora.expediente')
          or (t like 'config.%' and t <> 'config.tipo_cambio') $$;
