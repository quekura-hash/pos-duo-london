import { ErrorDominio } from './errores.ts';

// Políticas comerciales PENDIENTES de aprobación del propietario.
// No existe ningún valor por omisión: cada valor debe darse explícitamente, y todo objeto
// creado aquí queda marcado como ENSAYO. Probar una alternativa NO equivale a aprobarla.

export interface Politicas {
  readonly estado: 'ENSAYO_NO_APROBADO';
  /** P-01: red local u hub averiados. */
  P01_hub_no_disponible: 'bloquear_ventas_nuevas' | 'vender_autonomo_con_aviso';
  /** P-02: existencia insuficiente / última pieza. */
  P02_existencia_insuficiente: 'bloquear' | 'permitir_y_conciliar';
  /** P-03: devolver una venta que la caja no conoce localmente. */
  P03_devolucion_venta_no_local: 'bloquear' | 'permitir_con_incidencia';
  /** P-06: huecos documentados de folio (activa el arrendamiento de folios). */
  P06_huecos_de_folio: 'no_aceptados' | 'aceptados';
  /** P-07: estrategia de Item # para altas nuevas. */
  P07_item_no: 'a_central' | 'b_bloques' | 'c_espacios';
  /** P-12: nuevo cobro con tarjeta mientras hay otro intento pendiente. */
  P12_tarjeta_con_pendiente: 'permitir_con_aviso' | 'bloquear_solo_tarjeta';
  /** P-14: vender artículos cuya existencia está marcada no verificada (ALTERNATIVA DE ENSAYO, no aprobada). */
  P14_venta_con_inventario_no_verificado: 'permitir_con_aviso' | 'bloquear_articulo_no_verificado';
  /**
   * P-23 (opcional; decidido por el propietario): ¿una tarjeta de regalo vale en las dos tiendas? Decisión del propietario (17-oct-2026): 'solo_tienda_emisora', que es lo que rige si se omite.
   * Con 'solo_tienda_emisora' el central no la reparte a los demás hubs.
   */
  P23_tarjeta_regalo_entre_tiendas?: 'compartida' | 'solo_tienda_emisora';
  /**
   * Tasa de dólar sin verificar (tienda desconectada del central). Opcional; por omisión solo advierte después de 12 h y nunca bloquea.
   * `advertir_horas`: desde cuántas horas sin verificar se muestra una advertencia clara.
   * `bloquear_usd_horas`: desde cuántas horas sin verificar se dejan de recibir DÓLARES (null = nunca). Los cobros en pesos jamás se afectan.
   */
  tasa_sin_verificar?: { advertir_horas: number; bloquear_usd_horas: number | null };
  /** Parámetros numéricos del arrendamiento / bloques. */
  K_folios: number;
  K_item_no: number;
}

const VALORES: Record<string, readonly string[]> = {
  P01_hub_no_disponible: ['bloquear_ventas_nuevas', 'vender_autonomo_con_aviso'],
  P02_existencia_insuficiente: ['bloquear', 'permitir_y_conciliar'],
  P03_devolucion_venta_no_local: ['bloquear', 'permitir_con_incidencia'],
  P06_huecos_de_folio: ['no_aceptados', 'aceptados'],
  P07_item_no: ['a_central', 'b_bloques', 'c_espacios'],
  P12_tarjeta_con_pendiente: ['permitir_con_aviso', 'bloquear_solo_tarjeta'],
  P14_venta_con_inventario_no_verificado: ['permitir_con_aviso', 'bloquear_articulo_no_verificado'],
};

export function crearPoliticasEnsayo(v: Omit<Politicas, 'estado'>): Politicas {
  for (const [k, validos] of Object.entries(VALORES)) {
    const val = (v as any)[k];
    if (val === undefined) throw new ErrorDominio('POLITICA_FALTANTE', `falta ${k}: no hay valor por omisión`);
    if (!validos.includes(val)) throw new ErrorDominio('POLITICA_INVALIDA', `${k}=${val}`);
  }
  if (v.P23_tarjeta_regalo_entre_tiendas !== undefined && !['compartida', 'solo_tienda_emisora'].includes(v.P23_tarjeta_regalo_entre_tiendas)) throw new ErrorDominio('POLITICA_INVALIDA', `P23=${v.P23_tarjeta_regalo_entre_tiendas}`);
  const tv = v.tasa_sin_verificar;
  if (tv !== undefined) {
    if (!Number.isInteger(tv.advertir_horas) || tv.advertir_horas < 1) throw new ErrorDominio('POLITICA_INVALIDA', 'tasa_sin_verificar.advertir_horas debe ser entero >= 1');
    if (tv.bloquear_usd_horas !== null && (!Number.isInteger(tv.bloquear_usd_horas) || tv.bloquear_usd_horas < tv.advertir_horas)) throw new ErrorDominio('POLITICA_INVALIDA', 'tasa_sin_verificar.bloquear_usd_horas debe ser null o un entero >= advertir_horas');
  }
  for (const k of ['K_folios', 'K_item_no'] as const) {
    if (!Number.isInteger(v[k]) || v[k] < 1) throw new ErrorDominio('POLITICA_INVALIDA', `${k} debe ser entero >= 1`);
  }
  return { ...v, estado: 'ENSAYO_NO_APROBADO' };
}

/** Valores por omisión de la tasa sin verificar (ensayo, sin aprobar): advertir a las 12 h, no bloquear. */
export const TASA_SIN_VERIFICAR_OMISION = { advertir_horas: 12, bloquear_usd_horas: null } as const;

/** Ninguna política de este repositorio está aprobada para producción. */
export function exigirPoliticasAprobadas(p: Politicas): never {
  throw new ErrorDominio('POLITICAS_NO_APROBADAS', `estado=${p.estado}: requieren aprobación explícita del propietario`);
}
