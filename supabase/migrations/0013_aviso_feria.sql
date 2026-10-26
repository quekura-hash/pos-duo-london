-- 0013: aviso al teléfono cuando la feria (billetes y monedas de cambio) de una caja empeora (`caja.alerta_feria`).
-- Solo agrega el tipo al disparador de avisos; la Edge Function `notificar` debe desplegarse con el formato nuevo (supabase/functions/notificar/formato.ts).
-- NO se ha ejecutado contra la base real: requiere autorización explícita.

drop trigger if exists ops_notificar on pos.ops;
create trigger ops_notificar after insert on pos.ops
  for each row when (new.tipo in ('sale.confirmed', 'sale.cancelled', 'return.registered', 'cash.retiro', 'corte.generado', 'doc.perdida_posible', 'alm.faltante', 'caja.alerta_feria'))
  execute function pos.notificar_op();
