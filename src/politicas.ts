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
};

export function crearPoliticasEnsayo(v: Omit<Politicas, 'estado'>): Politicas {
  for (const [k, validos] of Object.entries(VALORES)) {
    const val = (v as any)[k];
    if (val === undefined) throw new ErrorDominio('POLITICA_FALTANTE', `falta ${k}: no hay valor por omisión`);
    if (!validos.includes(val)) throw new ErrorDominio('POLITICA_INVALIDA', `${k}=${val}`);
  }
  for (const k of ['K_folios', 'K_item_no'] as const) {
    if (!Number.isInteger(v[k]) || v[k] < 1) throw new ErrorDominio('POLITICA_INVALIDA', `${k} debe ser entero >= 1`);
  }
  return { ...v, estado: 'ENSAYO_NO_APROBADO' };
}

/** Ninguna política de este repositorio está aprobada para producción. */
export function exigirPoliticasAprobadas(p: Politicas): never {
  throw new ErrorDominio('POLITICAS_NO_APROBADAS', `estado=${p.estado}: requieren aprobación explícita del propietario`);
}
