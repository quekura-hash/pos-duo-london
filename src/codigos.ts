// Códigos de barras UPC: el sistema anterior (QuickBooks) completaba los códigos cortos hasta un UPC válido, y las etiquetas nuevas
// traen el código corto. Estas funciones relacionan las dos formas sin tocar el código guardado en el catálogo.

/** Dígito verificador de un UPC-A: base de 11 dígitos. */
export function digitoVerificadorUpc(base11: string): number {
  let suma = 0;
  for (let i = 0; i < 11; i++) suma += Number(base11[i]) * (i % 2 === 0 ? 3 : 1);
  return (10 - (suma % 10)) % 10;
}

const soloDigitos = (c: string) => /^\d+$/.test(c);
const sinCeros = (c: string) => c.replace(/^0+/, '');
/** Un código escaneado más corto que esto no se relaciona con otros por aproximación (evita que «17» encuentre un UPC con ceros). */
export const LARGO_MINIMO_APROXIMADO = 8;

/**
 * Claves con las que se puede encontrar un artículo de catálogo con código numérico: el código sin ceros a la izquierda y, si es un UPC-A
 * (12 dígitos, o 13 con un cero a la izquierda) con dígito verificador válido, la base sin el dígito verificador. Vacío si no aplica.
 */
export function clavesDeCatalogo(codigo: string): string[] {
  if (!soloDigitos(codigo)) return [];
  const s = sinCeros(codigo);
  if (s.length < LARGO_MINIMO_APROXIMADO) return [];
  const claves = [s];
  if (codigo.length >= 12 && codigo.length <= 13) {
    const base = s.slice(0, -1);
    if (base.length >= LARGO_MINIMO_APROXIMADO && digitoVerificadorUpc(base.padStart(11, '0')) === Number(s.slice(-1))) claves.push(base);
  }
  return claves;
}

/**
 * Año de alta que lleva el código (los códigos de los años 2015 a 2029 empiezan con el año o lo contienen: 0002026090782, 202610212).
 * Si aparecen varios años toma el mayor; 0 si no hay ninguno. Solo códigos numéricos.
 */
export function anioDeCodigo(codigo: string): number {
  if (!soloDigitos(codigo)) return 0;
  let mejor = 0;
  for (const m of sinCeros(codigo).matchAll(/(?=(20(?:1[5-9]|2\d)))/g)) mejor = Math.max(mejor, Number(m[1]));
  return mejor;
}

/** Clave con la que se busca un código escaneado o tecleado, o null si no se busca por aproximación. */
export function claveDeEscaneo(codigo: string): string | null {
  if (!soloDigitos(codigo)) return null;
  const s = sinCeros(codigo);
  return s.length >= LARGO_MINIMO_APROXIMADO ? s : null;
}
