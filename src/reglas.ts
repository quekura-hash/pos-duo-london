import { esImporteEnBilletesUsd, usdAMxn } from './dinero.ts';
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
      // El efectivo en dólares es efectivo: lo admite toda caja que admita efectivo.
      if (!c.metodos.includes(p.metodo === 'efectivo_usd' ? 'efectivo' : p.metodo)) return `metodo_no_permitido:${p.metodo}@${op.tienda}/${op.caja}`;
      if (p.metodo === 'efectivo_usd') {
        const bad = !Number.isInteger(p.usd) || p.usd <= 0 || !Number.isInteger(p.tasa) || p.tasa <= 0 || !Number.isInteger(p.tasa_version) || p.tasa_version < 1
          || !Number.isInteger(p.pesos_recibidos) || p.pesos_recibidos < 0 || !Number.isInteger(p.cambio_mxn) || p.cambio_mxn < 0;
        if (bad) return 'efectivo_usd_incompleto';
        if (!esImporteEnBilletesUsd(p.usd)) return 'efectivo_usd_no_billetes'; // solo billetes: dólares enteros, sin monedas
        // El hub recalcula: el equivalente y el cambio deben cuadrar exactamente con lo recibido.
        const eq = usdAMxn(p.usd, p.tasa);
        if (p.equivalente !== eq) return 'efectivo_usd_equivalente_incorrecto';
        if (eq + p.pesos_recibidos - p.cambio_mxn !== p.monto) return 'efectivo_usd_no_cuadra';
      }
      if (p.metodo === 'tarjeta_regalo' && !p.tarjeta) return 'tarjeta_regalo_sin_codigo';
    }
    if (op.payload.tienda !== op.tienda || op.payload.caja !== op.caja) return 'identidad_inconsistente';
    const suma = (op.payload.pagos ?? []).reduce((a: number, p: any) => a + p.monto, 0);
    if (suma !== op.payload.total) return 'pagos_no_suman_total';
  }
  return null;
}
