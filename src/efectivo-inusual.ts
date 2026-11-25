// Efectivo «inusual»: avisos de la caja ANTES de cobrar cuando lo recibido en efectivo se ve raro (p. ej. el número de autorización de una tarjeta
// escrito en «Pesos recibidos»). Código PURO y en centavos. El aviso no bloquea: la cajera revisa y confirma o corrige.

/** Cambio a partir del cual siempre se pide confirmar: $1,000. */
export const CAMBIO_GRANDE = 100_000;
/** Debajo de este cambio no se revisa si el monto es extraño ($20). */
const CAMBIO_MINIMO_REVISION = 2_000;
const DIEZ_PESOS = 1_000;

export type MotivoInusual = 'cambio_grande' | 'monto_extrano' | 'dolares_con_centavos';

export interface EfectivoRevisado {
  inusual: boolean;
  motivos: MotivoInusual[];
  /** Pesos recibidos más el equivalente de los dólares. */
  recibido: number;
  /** Lo que se cobra en efectivo (todo el total, o el resto después de tarjeta o tarjeta de regalo). */
  aplicar: number;
  cambio: number;
}

/**
 * ¿Es raro lo que se recibió?
 *  · `cambio_grande`: el cambio a devolver pasa de $1,000.
 *  · `monto_extrano` (solo pesos): lo recibido no es múltiplo de $10 y el cambio no sale en múltiplos de $10 (con cambio de $20 o más). Pagar con un billete
 *    redondo ($5,000), pagar justo, o dar monedas para recibir cambio redondo ($5,018 por $4,818) NO se marca; $5,531 por $4,818 sí.
 *  · `dolares_con_centavos`: los dólares solo se reciben en billetes enteros.
 * `pesos`, `usd` y `equivalente` (de los dólares, en pesos) son lo que escribió la cajera; todo en centavos.
 */
export function revisarEfectivo(d: { aplicar: number; pesos: number; usd?: number; equivalente?: number }): EfectivoRevisado {
  const usd = d.usd ?? 0;
  const recibido = d.pesos + (d.equivalente ?? 0);
  const cambio = Math.max(0, recibido - d.aplicar);
  const motivos: MotivoInusual[] = [];
  if (usd % 100 !== 0) motivos.push('dolares_con_centavos');
  if (cambio > CAMBIO_GRANDE) motivos.push('cambio_grande');
  if (usd === 0 && d.pesos % DIEZ_PESOS !== 0 && cambio >= CAMBIO_MINIMO_REVISION && cambio % DIEZ_PESOS !== 0) motivos.push('monto_extrano');
  return { inusual: motivos.length > 0, motivos, recibido, aplicar: d.aplicar, cambio };
}

export const TEXTO_MOTIVO_INUSUAL: Record<MotivoInusual, string> = {
  cambio_grande: 'El cambio a dar es mayor a $1,000.',
  monto_extrano: 'Es un monto poco común para pagar en efectivo.',
  dolares_con_centavos: 'Los dólares solo se reciben en billetes enteros.',
};
