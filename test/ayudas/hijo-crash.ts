// Proceso hijo: abre la base, inicia una transacción de venta a medias y se queda esperando para ser matado con SIGKILL.
import { SqliteRepo } from '../../src/repo.ts';

const [, , ruta, modo] = process.argv;
const repo = new SqliteRepo(ruta!, [{ tienda: 'DUO', caja: 1, metodos: ['efectivo', 'tarjeta'] }]);
if (modo === 'commit-primero') {
  repo.tx(() => {
    repo.kvSet('folio:ultimo', 1);
    repo.appendOp({ op_id: 'sale:a', tipo: 'sale.confirmed', tienda: 'DUO', caja: 1, origen: 'caja:DUO/1', ocurrio_en: '2026-10-01T00:00:00Z', payload: { folio: 1, pagos: [{ metodo: 'efectivo', monto: 1 }], total: 1 } });
  });
}
repo.tx(() => {
  repo.kvSet('folio:ultimo', 2);
  repo.appendOp({ op_id: 'sale:b', tipo: 'sale.confirmed', tienda: 'DUO', caja: 1, origen: 'caja:DUO/1', ocurrio_en: '2026-10-01T00:00:00Z', payload: { folio: 2, pagos: [{ metodo: 'efectivo', monto: 1 }], total: 1 } });
  repo.encolar('sale:b', 'hub:DUO');
  process.stdout.write('EN_TRANSACCION\n');
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 60_000); // bloquea dentro de la transacción, sin COMMIT
});
