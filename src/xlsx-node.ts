import ExcelJS from 'exceljs';
import type { Hoja } from './inventario.ts';
import { escribirXlsx, leerXlsx, type HojaLeida } from './xlsx.ts';

export const leerXlsxNode = (bytes: ArrayBuffer | Uint8Array): Promise<HojaLeida[]> => leerXlsx(ExcelJS, bytes);
export const escribirXlsxNode = (hojas: Hoja[]): Promise<Uint8Array> => escribirXlsx(ExcelJS, hojas);
