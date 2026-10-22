// Retiros de efectivo de la caja: cuándo avisar, qué billetes se retiran y cuánto como mínimo. Módulo puro (sin lectura de bitácora).
import { DENOMINACIONES_USD, usdAMxn } from './dinero.ts';
import type { MovimientoCaja } from './proyecciones.ts';

/** Decisión del propietario: con $10,000 de efectivo de VENTA en la caja (sin contar el fondo) el sistema avisa que toca un retiro. */
export const UMBRAL_AVISO_RETIRO = 1_000_000;
/** El retiro no tiene que ser exacto: se toman los billetes grandes y los dólares hasta completar al menos $8,000 (o su equivalente en dólares). */
export const MINIMO_RETIRO = 800_000;
/** Billetes de pesos que se retiran (centavos): $1,000, $500 y $200. ALTERNATIVA DE ENSAYO: «billetes grandes» está por confirmar con el propietario. */
export const BILLETES_RETIRO_MXN = [100000, 50000, 20000] as const;
/** Todos los billetes de dólar se pueden retirar. */
export const BILLETES_RETIRO_USD = DENOMINACIONES_USD;

export interface EfectivoDeVenta {
  /** Pesos de venta en el cajón: cobros − cambio − reembolsos − cancelaciones − retiros (sin fondo ni entradas). */
  mxn: number;
  /** Dólares de venta (centavos de dólar): recibidos − retirados (sin fondo ni entradas). */
  usd: number;
  /** Total en pesos: los dólares al tipo de cambio vigente. */
  equivalente: number;
  tasa: number | null;
}

/** Efectivo que la caja ha juntado por VENTAS en el día; el fondo inicial y las entradas de efectivo no cuentan. */
export function efectivoDeVentaEnCaja(libro: MovimientoCaja[], tasa: number | null): EfectivoDeVenta {
  const de = (moneda: 'MXN' | 'USD') => libro.filter((m) => m.moneda === moneda && m.tipo !== 'fondo_inicial' && m.tipo !== 'entrada' && m.tipo !== 'ajuste').reduce((a, m) => a + m.monto, 0);
  const mxn = de('MXN');
  const usd = de('USD');
  const t = tasa ?? [...libro].reverse().find((m) => m.moneda === 'USD' && m.tasa)?.tasa ?? null; // sin tasa vigente, la de la última venta en dólares
  return { mxn, usd, equivalente: mxn + (usd > 0 && t ? usdAMxn(usd, t) : 0), tasa: t };
}

export interface RetiroRegistrado {
  retiro_id: string; folio_retiro: string; tienda: string; caja: number; usuario: string; fecha: string; ocurrio_en: string;
  mxn: { denominaciones: Record<string, number>; total: number };
  usd: { denominaciones: Record<string, number>; total: number };
  tasa: number | null; tasa_version: number | null;
  equivalente_mxn: number;
  venta_antes: number; venta_despues: number;
}
