import ExcelJS from 'exceljs';
import { aOperacionesInventario, leerInventario, PERFIL_CONFIRMADO, type Perfil } from '../../src/inventario.ts';
import { leerXlsxNode } from '../../src/xlsx-node.ts';

export const ENCABEZADOS_REALES = [
  'Item Number', 'Item Name', 'Item Description', 'Alternate Lookup', 'Estilo', 'Lote', 'Regular Price', 'Custom Price 1', 'UPC',
  'Department Name', 'Etiqt- precio', 'Etiqt-Costura', 'No. Pedimento', 'UPC 2',
];

type Fila = (string | number | null)[];
/**
 * Filas SINTÉTICAS con la misma estructura y los mismos defectos del inventario real (sin datos reales):
 * Item # repetido, artículos sin UPC, cupones con precio negativo, precio cero, código alterno, texto que parece fórmula,
 * código repetido, código de 18 caracteres y un código que Excel guardó como número.
 */
export const FILAS_REALISTAS: Fila[] = [
  [1, 'BLUSA', 'blusa seksy', null, null, null, 169, 152.1, '0021001403065', "Women's", null, 'Yes', null, null],
  [2, 'RHAPSODY', '', null, null, null, 189, 170.1, null, "Women's", null, 'Yes', null, null],
  [3, 'CAMISA', '', null, null, null, 449, 404.1, '0031001403033', "Men's", null, 'Yes', null, null],
  [149, 'VESTIDO MINIMI', '', null, null, null, 399, 0, '0021001404697', 'System', null, 'Yes', null, null],
  [149, 'ACCESORIO FASHION', '', null, null, null, 105, 0, '0090001405485', 'System', null, 'yes', null, null],
  [4918, 'CUPON', '', null, null, null, -50, 0, '0121020030001', 'CUPONES', null, 'Yes', null, null],
  [322, 'JOOP HOMME 2PC SET', '', null, null, null, 0, 0, '0000000000322', 'PERFUMES', null, 'Yes', null, null],
  [330, 'GORRA', '', null, null, null, 563.5, 0, '0000000003300', 'Accessories', null, 'Yes', null, null],
  [16, 'TORERA PLUS', '', '1010M3', 'T-9', '20260913', 299, 0, null, 'WOMAN +', null, 'Yes', null, null],
  [700, 'ZAPATO', 'NIKE', null, '=SUM(1,2)', '20261014', 999, 0, '7501234567890', 'ZAPATOS', null, 'Yes', null, null],
  [701, 'ZAPATO', 'NIKE', null, '123L', '27082005', 999, 0, '7501234567890', 'ZAPATOS', null, 'Yes', null, null],
  [702, 'LARGO', '', null, null, null, 100, 0, '123456789012345678', 'System', null, 'Yes', null, null],
  [703, 'NUMERICO', '', null, null, null, 100, 0, 7501234567, 'System', null, 'Yes', null, null],
  [704, 'CON ESPACIOS ', '', null, null, null, 120, 0, '7509990000001', 'System', null, 'Yes', null, null],
];

export async function xlsxDeFilas(filas: Fila[], encabezados = ENCABEZADOS_REALES): Promise<Uint8Array> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Hoja1');
  ws.addRow(encabezados);
  const textoCols = new Set([1, 2, 3, 4, 5, 8, 9, 10, 12, 13]); // como el archivo real: columnas de texto con formato @
  for (const f of filas) {
    const row = ws.addRow(f);
    row.eachCell({ includeEmpty: true }, (c, n) => { if (textoCols.has(n - 1) && typeof c.value === 'string') c.numFmt = '@'; });
  }
  return new Uint8Array((await wb.xlsx.writeBuffer()) as ArrayBuffer);
}

export async function filasDeXlsx(bytes: Uint8Array) {
  return (await leerXlsxNode(bytes))[0]!.filas;
}

/** Fixture completo → operaciones listas para sembrar en un mundo. */
export async function operacionesRealistas(perfil: Perfil = PERFIL_CONFIRMADO, existenciaPrueba: Record<string, number> = { DUO: 10 }) {
  const filas = await filasDeXlsx(await xlsxDeFilas(FILAS_REALISTAS));
  const lectura = leerInventario(filas, perfil);
  const { ops, ids } = aOperacionesInventario(lectura.articulos, { ahora: '2026-10-01T15:00:00Z', idImportacion: 'imp1', existenciaPrueba });
  return { lectura, ops, ids };
}
