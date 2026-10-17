import type { Hoja } from './inventario.ts';

// Lectura y escritura de .xlsx con ExcelJS. La biblioteca se RECIBE como parámetro: en Node se importa, en el navegador
// va incluida en la página. Así este módulo no depende de ninguna de las dos.

export interface HojaLeida {
  nombre: string;
  filas: unknown[][];
  /** Celdas que eran fórmulas: se toma su último valor calculado y se avisa. */
  formulas: number;
}

function valorCelda(v: any): { valor: unknown; formula: boolean } {
  if (v === null || v === undefined) return { valor: null, formula: false };
  if (v instanceof Date) return { valor: v.toISOString(), formula: false };
  if (typeof v === 'object') {
    if (Array.isArray(v.richText)) return { valor: v.richText.map((t: { text: string }) => t.text).join(''), formula: false };
    if ('formula' in v || 'sharedFormula' in v) return { valor: v.result === undefined ? null : valorCelda(v.result).valor, formula: true };
    if ('text' in v) return { valor: String(v.text), formula: false };
    if ('error' in v) return { valor: null, formula: false };
  }
  return { valor: v, formula: false };
}

export async function leerXlsx(ExcelJS: any, bytes: ArrayBuffer | Uint8Array): Promise<HojaLeida[]> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes));
  const out: HojaLeida[] = [];
  for (const ws of wb.worksheets) {
    const filas: unknown[][] = [];
    let formulas = 0;
    const cols = ws.columnCount as number;
    ws.eachRow({ includeEmpty: true }, (row: any, n: number) => {
      while (filas.length < n - 1) filas.push([]);
      const r: unknown[] = [];
      for (let c = 1; c <= cols; c++) {
        const { valor, formula } = valorCelda(row.getCell(c).value);
        if (formula) formulas++;
        r.push(valor);
      }
      filas.push(r);
    });
    out.push({ nombre: ws.name as string, filas, formulas });
  }
  return out;
}

export async function escribirXlsx(ExcelJS: any, hojas: Hoja[]): Promise<Uint8Array> {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'POS DÚO / London';
  for (const h of hojas) {
    const ws = wb.addWorksheet(h.nombre, { views: [{ state: 'frozen', ySplit: 1 }] });
    const texto = new Set(h.textoCols);
    ws.columns = h.encabezados.map((e, i) => ({
      header: e, key: `c${i}`,
      width: Math.min(40, Math.max(10, e.length + 2, ...h.filas.slice(0, 200).map((f) => String(f[i] ?? '').length + 1))),
      style: texto.has(i) ? { numFmt: '@' } : h.formatoCols?.[i] ? { numFmt: h.formatoCols[i] } : {},
    }));
    ws.getRow(1).font = { bold: true };
    for (const f of h.filas) {
      // Un texto se escribe SIEMPRE como cadena: ExcelJS solo crea una fórmula si se le entrega {formula}.
      ws.addRow(f.map((v, i) => (texto.has(i) && v !== null && v !== '' ? String(v) : v)));
    }
    ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: h.encabezados.length } };
  }
  const buf = await wb.xlsx.writeBuffer();
  return new Uint8Array(buf as ArrayBuffer);
}
