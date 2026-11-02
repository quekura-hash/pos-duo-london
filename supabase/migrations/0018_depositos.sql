-- 0018: depósitos en garantía (pruebas de vestidos de noche). PREPARADA, NO APLICADA: la ejecuta Edgardo en Supabase Studio cuando autorice el despliegue.
-- Las cajas deben recibir las operaciones `deposito.*` (recibido, devuelto, fee, aplicado, reintegrado) para ver los depósitos de las demás cajas y
-- poder verificar que un depósito sigue disponible antes de entregarlo o aplicarlo. Las suben las cajas (como giftcard.*): no son solo de Administración.
-- Sin esta migración cada caja solo ve sus propios depósitos: la devolución o aplicación en otra caja quedaría bloqueada por seguridad (DEPOSITO_INEXISTENTE).

create or replace function pos.tipo_para_cajas(t text) returns boolean
language sql immutable as
$$ select t in ('item.created', 'item.item_no_assigned', 'item.codigo_corregido', 'item.editado', 'doc.perdida_resuelta', 'config.tipo_cambio', 'config.sesion', 'config.negocio',
                'permiso.asignado', 'depto.alta', 'depto.editado', 'alm.entrega', 'alm.faltante', 'promo.guardada', 'recompensa.guardada', 'supervisor.guardado', 'cajero.guardado',
                'cajero.ubicacion', 'caja.fondo_autorizado', 'caja.limite_efectivo', 'cash.ajuste_admin', 'empleadas.config', 'empleada.credito', 'empleada.movimiento', 'venta.consulta',
                'vip.guardado', 'vip.excepciones', 'metas.config')
          or t like 'giftcard.%' or t like 'deposito.%' $$;
