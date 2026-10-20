export interface Ajustes { impresora: string; canal: 'pruebas' | 'estable'; urlActualizaciones: string; pantallaCompleta: boolean; revisarCadaMin: number }
export function crearAjustes(dir: string, sistema?: unknown): { leer(): Ajustes; guardar(cambios: Partial<Ajustes>): Ajustes };
export const OMISION: Ajustes;
export const URL_ACTUALIZACIONES: string;
