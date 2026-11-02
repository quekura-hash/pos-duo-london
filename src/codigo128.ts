// Código de barras Code128 (juego B) como SVG: se usa en la vista previa del comprobante de depósito. Los patrones son los de la especificación
// (ancho de barras/espacios alternados); la prueba los compara con los del lector ZXing.
export const PATRONES_CODE128 = [
  '212222', '222122', '222221', '121223', '121322', '131222', '122213', '122312', '132212', '221213', '221312', '231212', '112232', '122132', '122231', '113222',
  '123122', '123221', '223211', '221132', '221231', '213212', '223112', '312131', '311222', '321122', '321221', '312212', '322112', '322211', '212123', '212321',
  '232121', '111323', '131123', '131321', '112313', '132113', '132311', '211313', '231113', '231311', '112133', '112331', '132131', '113123', '113321', '133121',
  '313121', '211331', '231131', '213113', '213311', '213131', '311123', '311321', '331121', '312113', '312311', '332111', '314111', '221411', '431111', '111224',
  '111422', '121124', '121421', '141122', '141221', '112214', '112412', '122114', '122411', '142112', '142211', '241211', '221114', '413111', '241112', '134111',
  '111242', '121142', '121241', '114212', '124112', '124211', '411212', '421112', '421211', '212141', '214121', '412121', '111143', '111341', '131141', '114113',
  '114311', '411113', '411311', '113141', '114131', '311141', '411131', '211412', '211214', '211232', '2331112',
];
/** Valores (0-106) del Code128 juego B de un texto ASCII imprimible: inicio, caracteres, dígito de control y fin. */
export function valoresCode128B(texto: string): number[] {
  const v = [104];
  for (const ch of texto) {
    const c = ch.charCodeAt(0);
    if (c < 32 || c > 126) throw new Error(`carácter no válido en un Code128-B: ${ch}`);
    v.push(c - 32);
  }
  v.push(v.reduce((a, x, i) => a + (i === 0 ? x : x * i), 0) % 103, 106);
  return v;
}
/** SVG del código de barras (barras negras sobre fondo blanco, con la zona de silencio que pide el estándar). */
export function svgCode128(texto: string, alto = 70, modulo = 2): string {
  const anchos = valoresCode128B(texto).flatMap((x) => [...PATRONES_CODE128[x]!].map(Number));
  const silencio = 10 * modulo;
  let x = silencio;
  let barras = '';
  anchos.forEach((w, i) => { if (i % 2 === 0) barras += `<rect x="${x}" y="0" width="${w * modulo}" height="${alto}"/>`; x += w * modulo; });
  const ancho = x + silencio;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${ancho} ${alto}" width="${ancho}" height="${alto}" role="img" aria-label="Código de barras ${texto}"><rect width="${ancho}" height="${alto}" fill="#fff"/><g fill="#000">${barras}</g></svg>`;
}
