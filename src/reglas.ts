import type { CajaCfg, Op } from './tipos.ts';

/**
 * Reglas DURAS que ninguna operación legítima puede violar (no son políticas pendientes).
 * Hub y central las revalidan al recibir: no confían en que la caja de origen las aplicó.
 */
export function validarOpEntrante(op: Op, cfg: CajaCfg[]): string | null {
  if (op.tipo === 'sale.confirmed') {
    const c = cfg.find((x) => x.tienda === op.tienda && x.caja === op.caja);
    if (!c) return `caja_desconocida:${op.tienda}/${op.caja}`;
    for (const p of op.payload.pagos ?? []) {
      if (!c.metodos.includes(p.metodo)) return `metodo_no_permitido:${p.metodo}@${op.tienda}/${op.caja}`;
    }
    if (op.payload.tienda !== op.tienda || op.payload.caja !== op.caja) return 'identidad_inconsistente';
    const suma = (op.payload.pagos ?? []).reduce((a: number, p: any) => a + p.monto, 0);
    if (suma !== op.payload.total) return 'pagos_no_suman_total';
  }
  return null;
}
