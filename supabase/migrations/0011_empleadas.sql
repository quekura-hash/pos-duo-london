-- LonDuo POS · migración 0011 · empleadas: descuento de empleada y crédito (cuenta que se descuenta de la nómina)
-- Qué cambia (solo reglas de qué operaciones viajan a las cajas y quién puede escribirlas; no toca datos):
--  · `empleadas.config` (porcentajes del descuento), `empleada.credito` (límite de crédito) y `empleada.movimiento` (abonos de nómina y ajustes) son
--    SOLO de Administración: una caja no puede escribirlas, pero sí las recibe para calcular el descuento y revisar el límite al vender.
--  · Las ventas a crédito de empleada son ventas normales (`sale.confirmed`, con su pago «credito_empleada»): las sube la propia caja.
-- Después de correrla no hay nada más que configurar. Es idempotente (create or replace).

create or replace function pos.tipo_para_cajas(t text) returns boolean
language sql immutable as
$$ select t in ('item.created', 'item.item_no_assigned', 'item.codigo_corregido', 'item.editado', 'doc.perdida_resuelta', 'config.tipo_cambio', 'config.sesion', 'config.negocio',
                'permiso.asignado', 'depto.alta', 'depto.editado', 'alm.entrega', 'alm.faltante', 'promo.guardada', 'recompensa.guardada', 'supervisor.guardado', 'cajero.guardado',
                'cajero.ubicacion', 'caja.fondo_autorizado', 'cash.ajuste_admin', 'empleadas.config', 'empleada.credito', 'empleada.movimiento')
          or t like 'giftcard.%' $$;

create or replace function pos.tipo_solo_admin(t text) returns boolean
language sql immutable as
$$ select t in ('item.editado', 'item.codigo_corregido', 'doc.perdida_resuelta', 'alm.entrega', 'alm.faltante', 'admin.guardado', 'supervisor.guardado', 'cajero.guardado', 'promo.guardada', 'recompensa.guardada',
                'permiso.asignado', 'depto.alta', 'depto.editado', 'config.sesion', 'config.negocio', 'trabajadora.expediente', 'caja.fondo_autorizado', 'cash.ajuste_admin',
                'empleadas.config', 'empleada.credito', 'empleada.movimiento')
          or (t like 'config.%' and t <> 'config.tipo_cambio') $$;
