-- LonDuo POS · migración 0006 · permisos mínimos del servidor para la función `notificar`
-- La función corre con service_role: lee la bitácora y los supervisores, maneja los dispositivos y guarda sus llaves VAPID y su clave
-- en pos.ajustes_internos (tabla sin acceso para anon ni authenticated). No puede escribir en la bitácora.
grant usage on schema pos to service_role;
grant select on pos.ops, pos.admins to service_role;
grant select, insert, update on pos.ajustes_internos to service_role;
grant select, update on pos.suscripciones_push to service_role;
