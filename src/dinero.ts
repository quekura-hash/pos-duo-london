// Dinero exacto. Todo en enteros: pesos y dólares en CENTAVOS; el tipo de cambio en diezmilésimas de peso por dólar.
// No se usa coma flotante en ningún cálculo que llegue a pantalla, ticket, almacenamiento o corte.

/** Escala del tipo de cambio: 18.0000 MXN por USD se guarda como 180000. */
export const ESCALA_TASA = 10000;

/**
 * Regla de redondeo (única y explícita): el equivalente en pesos de unos dólares se redondea al CENTAVO, mitad hacia arriba.
 * equivalente_centavos_mxn = floor((usd_centavos × tasa + 5000) / 10000).
 */
export function usdAMxn(usdCentavos: number, tasa: number): number {
  if (!Number.isInteger(usdCentavos) || usdCentavos < 0) throw new RangeError('dólares inválidos');
  if (!Number.isInteger(tasa) || tasa <= 0) throw new RangeError('tipo de cambio inválido');
  return Math.floor((usdCentavos * tasa + ESCALA_TASA / 2) / ESCALA_TASA);
}

/** "18", "18.5", "18.1234" → diezmilésimas; null si no es un número positivo con hasta 4 decimales. */
export function parseTasa(texto: string): number | null {
  const m = /^(\d{1,6})(?:\.(\d{1,4}))?$/.exec(String(texto).replace(/[$,\s]/g, ''));
  if (!m) return null;
  const v = Number(m[1]) * ESCALA_TASA + Number((m[2] ?? '').padEnd(4, '0') || 0);
  return v > 0 ? v : null;
}

/** 180000 → "18.00"; 181250 → "18.125" (siempre al menos 2 decimales, sin ceros de sobra después). */
export function formatoTasa(tasa: number): string {
  const ent = Math.floor(tasa / ESCALA_TASA);
  let dec = String(tasa % ESCALA_TASA).padStart(4, '0').replace(/0+$/, '');
  if (dec.length < 2) dec = dec.padEnd(2, '0');
  return `${ent}.${dec}`;
}

/** Billetes de dólar que se cuentan en el cajón (denominaciones en dólares enteros). */
export const DENOMINACIONES_USD = [100, 50, 20, 10, 5, 2, 1] as const;

export function totalDenominacionesUsd(d: Record<string, number>): number {
  let total = 0;
  for (const [k, n] of Object.entries(d)) {
    if (!(DENOMINACIONES_USD as readonly number[]).includes(Number(k))) throw new RangeError(`denominación no válida: ${k}`);
    if (!Number.isInteger(n) || n < 0) throw new RangeError(`cantidad inválida de billetes de ${k}`);
    total += Number(k) * 100 * n;
  }
  return total;
}
