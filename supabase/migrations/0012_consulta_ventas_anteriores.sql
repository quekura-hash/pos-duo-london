-- 0012: las cajas reciben (solo para consultar) las ventas del POS anterior de los últimos 60 días (`venta.consulta`).
-- El historial completo (`venta.historica`) sigue únicamente en Administración. Solo Administración puede escribirlas.

create or replace function pos.tipo_para_cajas(t text) returns boolean
language sql immutable as
$$ select t in ('item.created', 'item.item_no_assigned', 'item.codigo_corregido', 'item.editado', 'doc.perdida_resuelta', 'config.tipo_cambio', 'config.sesion', 'config.negocio',
                'permiso.asignado', 'depto.alta', 'depto.editado', 'alm.entrega', 'alm.faltante', 'promo.guardada', 'recompensa.guardada', 'supervisor.guardado', 'cajero.guardado',
                'cajero.ubicacion', 'caja.fondo_autorizado', 'cash.ajuste_admin', 'empleadas.config', 'empleada.credito', 'empleada.movimiento', 'venta.consulta')
          or t like 'giftcard.%' $$;

create or replace function pos.tipo_solo_admin(t text) returns boolean
language sql immutable as
$$ select t in ('item.editado', 'item.codigo_corregido', 'doc.perdida_resuelta', 'alm.entrega', 'alm.faltante', 'admin.guardado', 'supervisor.guardado', 'cajero.guardado', 'promo.guardada', 'recompensa.guardada',
                'permiso.asignado', 'depto.alta', 'depto.editado', 'config.sesion', 'config.negocio', 'trabajadora.expediente', 'caja.fondo_autorizado', 'cash.ajuste_admin',
                'empleadas.config', 'empleada.credito', 'empleada.movimiento', 'venta.consulta')
          or (t like 'config.%' and t <> 'config.tipo_cambio') $$;
