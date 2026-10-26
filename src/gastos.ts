/** Gasto de caja: pago en efectivo desde el cajón (por ejemplo al barrendero) con recibo firmado por quien recibe. */
export interface GastoRegistrado {
  gasto_id: string; folio_gasto: string; tienda: string; caja: number; fecha: string; ocurrio_en: string;
  monto: number; concepto: string; recibio: string; usuario: string; autorizado_por: string | null;
}
