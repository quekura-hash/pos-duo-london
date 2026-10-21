// Ventas históricas: lector del reporte «Sales Detail» del POS anterior (una fila por ticket) y su conversión a operaciones `venta.historica`.
// Son registros para reportes y contabilidad: NO tocan existencias, caja, cortes ni la serie de folios de la caja nueva.

export type TipoHistorica = 'venta' | 'cambio' | 'fee';
export type PagoHistorico = 'efectivo' | 'tarjeta' | 'mixto' | 'sin_pago';

export interface VentaHistorica {
  folio: number;
  /** YYYY-MM-DD (día local de la venta; el reporte anterior no trae hora). */
  fecha: string;
  tipo: TipoHistorica;
  piezas: number;
  /** Centavos. Un fee devuelto o un ajuste puede ser negativo. */
  total: number;
  pago: PagoHistorico;
  /** Lo que decía el archivo (p. ej. «Credit Card»): se conserva por trazabilidad. */
  pago_original: string;
}

export interface RevisionHistorica {
  filas: VentaHistorica[];
  errores: string[];
  avisos: string[];
  resumen: {
    tickets: number;
    piezas: number;
    total: number;
    por_tipo: Record<TipoHistorica, { tickets: number; total: number }>;
    por_pago: Record<PagoHistorico, { tickets: number; total: number }>;
    desde: string | null;
    hasta: string | null;
    folio_inicial: number | null;
    folio_final: number | null;
    dias_con_ventas: number;
    fechas_corregidas: number;
  };
  /** Tickets que conviene mirar antes de confirmar (cambios, fees, mixtos, negativos). */
  para_revisar: { folio: number; fecha: string; tipo: TipoHistorica; pago: PagoHistorico; piezas: number; total: number; nota: string }[];
}

const sinAcentos = (x: unknown) => String(x ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toLowerCase();
const CAMPOS: Record<string, string[]> = {
  fecha: ['date', 'fecha'], folio: ['receipt #', 'receipt', 'folio', 'recibo'], tipo: ['receipt type', 'tipo', 'tipo de recibo'],
  piezas: ['qty sold', 'piezas', 'cantidad'], total: ['total'], pago: ['payment', 'forma de pago', 'pago'],
};

function aFecha(v: unknown): { y: number; m: number; d: number; deTexto: boolean } | null {
  if (typeof v === 'string') {
    let m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(v.trim());
    if (m) return { d: Number(m[1]), m: Number(m[2]), y: Number(m[3]), deTexto: true };
    m = /^(\d{4})-(\d{2})-(\d{2})(?:T.*)?$/.exec(v.trim());
    if (m) return { y: Number(m[1]), m: Number(m[2]), d: Number(m[3]), deTexto: false };
  }
  return null;
}
const dosDig = (n: number) => String(n).padStart(2, '0');
const iso = (f: { y: number; m: number; d: number }) => `${f.y}-${dosDig(f.m)}-${dosDig(f.d)}`;
const diasDelMes = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate();

/** Lee las filas de la hoja del reporte anterior. Corrige las fechas que Excel dejó con día y mes intercambiados (ver `fechas_corregidas`). */
export function revisarReporteAnterior(filasHoja: unknown[][]): RevisionHistorica {
  const errores: string[] = [];
  const avisos: string[] = [];
  const vacio = (): RevisionHistorica['resumen'] => ({
    tickets: 0, piezas: 0, total: 0,
    por_tipo: { venta: { tickets: 0, total: 0 }, cambio: { tickets: 0, total: 0 }, fee: { tickets: 0, total: 0 } },
    por_pago: { efectivo: { tickets: 0, total: 0 }, tarjeta: { tickets: 0, total: 0 }, mixto: { tickets: 0, total: 0 }, sin_pago: { tickets: 0, total: 0 } },
    desde: null, hasta: null, folio_inicial: null, folio_final: null, dias_con_ventas: 0, fechas_corregidas: 0,
  });
  const fin = (filas: VentaHistorica[], resumen = vacio(), para_revisar: RevisionHistorica['para_revisar'] = []): RevisionHistorica => ({ filas, errores, avisos, resumen, para_revisar });

  // Encabezados: la fila que trae «Receipt #» (o «Folio») y «Total».
  let encab = -1;
  const col: Record<string, number> = {};
  for (let i = 0; i < Math.min(filasHoja.length, 40) && encab < 0; i++) {
    const celdas = (filasHoja[i] ?? []).map(sinAcentos);
    const mapa: Record<string, number> = {};
    for (const [campo, nombres] of Object.entries(CAMPOS)) { const j = celdas.findIndex((c) => nombres.includes(c)); if (j >= 0) mapa[campo] = j; }
    if (mapa.folio !== undefined && mapa.total !== undefined && mapa.fecha !== undefined) { encab = i; Object.assign(col, mapa); }
  }
  if (encab < 0) { errores.push('No es el reporte de ventas del POS anterior: no encuentro las columnas Fecha, Folio (Receipt #) y Total.'); return fin([]); }
  for (const campo of ['tipo', 'piezas', 'pago']) if (col[campo] === undefined) avisos.push(`El archivo no trae la columna de «${campo}»: se supone venta, 0 piezas o sin forma de pago según el caso.`);

  type Cruda = { fila: number; folio: number; f: ReturnType<typeof aFecha>; fechaTxt: unknown; tipoTxt: string; piezas: number; total: number; pagoTxt: string };
  const crudas: Cruda[] = [];
  for (let i = encab + 1; i < filasHoja.length; i++) {
    const r = filasHoja[i] ?? [];
    const folio = r[col.folio!];
    const total = r[col.total!];
    if (typeof folio !== 'number' || !Number.isInteger(folio) || typeof total !== 'number') continue; // renglones de totales o vacíos
    const piezas = col.piezas === undefined ? 0 : Number(r[col.piezas] ?? 0);
    crudas.push({ fila: i + 1, folio, f: aFecha(r[col.fecha!]), fechaTxt: r[col.fecha!], tipoTxt: col.tipo === undefined ? 'Sales' : String(r[col.tipo] ?? ''), piezas: Number.isFinite(piezas) ? piezas : 0, total, pagoTxt: col.pago === undefined ? '' : String(r[col.pago] ?? '') });
  }
  if (!crudas.length) { errores.push('El archivo no trae ningún ticket (renglones con folio y total).'); return fin([]); }

  // Mes de referencia: las fechas escritas como texto dd/mm/aaaa (días 13 al 31) no pueden estar intercambiadas.
  const meses = new Map<string, number>();
  for (const c of crudas) if (c.f?.deTexto && c.f.d > 12) meses.set(`${c.f.y}-${c.f.m}`, (meses.get(`${c.f.y}-${c.f.m}`) ?? 0) + 1);
  const ref = [...meses.entries()].sort((a, b) => b[1] - a[1])[0]?.[0]?.split('-').map(Number) as [number, number] | undefined;

  const filas: VentaHistorica[] = [];
  const revisar: RevisionHistorica['para_revisar'] = [];
  let corregidas = 0;
  const vistos = new Set<number>();
  for (const c of crudas) {
    if (!c.f) { errores.push(`Fila ${c.fila} (folio ${c.folio}): fecha ilegible «${String(c.fechaTxt)}».`); continue; }
    let { y, m, d } = c.f;
    if (!c.f.deTexto && ref && y === ref[0] && d === ref[1] && m !== ref[1]) { [m, d] = [d, m]; corregidas++; } // Excel leyó 01/09 como 9 de enero
    if (m < 1 || m > 12 || d < 1 || d > diasDelMes(y, m)) { errores.push(`Fila ${c.fila} (folio ${c.folio}): fecha inválida.`); continue; }
    if (vistos.has(c.folio)) { errores.push(`El folio ${c.folio} aparece más de una vez.`); continue; }
    vistos.add(c.folio);
    if (sinAcentos(c.tipoTxt) !== 'sales' && sinAcentos(c.tipoTxt) !== 'venta' && sinAcentos(c.tipoTxt) !== '') { errores.push(`Folio ${c.folio}: tipo de recibo desconocido «${c.tipoTxt}»; avíseme cómo tratarlo.`); continue; }
    const centavos = Math.round(c.total * 100);
    const p = sinAcentos(c.pagoTxt);
    const pago: PagoHistorico = p === 'cash' || p === 'efectivo' ? 'efectivo' : p === 'credit card' || p === 'debit card' || p === 'tarjeta' || p.includes('card') || p.includes('tarjeta') ? 'tarjeta' : p === 'split' || p === 'mixto' ? 'mixto' : 'sin_pago';
    // Regla del negocio: un ticket de $0 es un cambio (sin diferencia de precio); uno sin piezas es un fee (cobro por daño a una prenda).
    const tipo: TipoHistorica = c.piezas === 0 && centavos !== 0 ? 'fee' : centavos === 0 ? 'cambio' : 'venta';
    const fecha = iso({ y, m, d });
    const v: VentaHistorica = { folio: c.folio, fecha, tipo, piezas: c.piezas, total: centavos, pago, pago_original: c.pagoTxt };
    filas.push(v);
    const nota = tipo === 'cambio' ? 'cambio sin diferencia' : tipo === 'fee' ? (centavos < 0 ? 'fee NEGATIVO (devolución o ajuste de un fee)' : 'fee por daño a la prenda') : pago === 'mixto' ? 'pago mixto sin desglose' : centavos < 0 ? 'total negativo' : '';
    if (nota) revisar.push({ folio: v.folio, fecha, tipo, pago, piezas: v.piezas, total: v.total, nota });
  }
  filas.sort((a, b) => a.folio - b.folio);
  if (corregidas) avisos.push(`${corregidas} fecha(s) venían con el día y el mes intercambiados (Excel leyó, por ejemplo, 01/${dosDig(ref![1])} como 9 de enero); ya las corregí al mes ${dosDig(ref![1])}/${ref![0]}.`);
  if (!ref) avisos.push('No pude comprobar si hay fechas con el día y el mes intercambiados (no hay fechas escritas como texto con día mayor a 12). Revise el rango de fechas.');
  const fueraDeOrden = filas.some((f, i) => i > 0 && f.fecha < filas[i - 1]!.fecha);
  if (fueraDeOrden) avisos.push('Las fechas no van en orden creciente respecto a los folios: revise que estén bien.');
  const huecos: number[] = [];
  for (let i = 1; i < filas.length; i++) for (let n = filas[i - 1]!.folio + 1; n < filas[i]!.folio && huecos.length < 50; n++) huecos.push(n);
  if (huecos.length) avisos.push(`Faltan folios en la serie: ${huecos.slice(0, 10).join(', ')}${huecos.length > 10 ? '…' : ''} (${huecos.length}${huecos.length >= 50 ? '+' : ''}).`);

  const r = vacio();
  r.fechas_corregidas = corregidas;
  for (const f of filas) {
    r.tickets++; r.piezas += f.piezas; r.total += f.total;
    r.por_tipo[f.tipo].tickets++; r.por_tipo[f.tipo].total += f.total;
    r.por_pago[f.pago].tickets++; r.por_pago[f.pago].total += f.total;
  }
  if (filas.length) {
    const fechas = filas.map((f) => f.fecha).sort();
    r.desde = fechas[0]!; r.hasta = fechas[fechas.length - 1]!;
    r.folio_inicial = filas[0]!.folio; r.folio_final = filas[filas.length - 1]!.folio;
    r.dias_con_ventas = new Set(fechas).size;
  }
  return fin(filas, r, revisar);
}

/** Identificador estable: reimportar el mismo archivo no duplica nada. */
export const idVentaHistorica = (tienda: string, caja: number, folio: number) => `hist:${tienda}/${caja}:${folio}`;

/** Payload de la operación `venta.historica` (de Administración; las cajas no la reciben). */
export function payloadVentaHistorica(v: VentaHistorica, o: { tienda: string; caja: number; lote: string; por: string }) {
  return {
    hist_id: idVentaHistorica(o.tienda, o.caja, v.folio), tienda_hist: o.tienda, caja_hist: o.caja, folio: v.folio, fecha: v.fecha, tipo_hist: v.tipo,
    piezas: v.piezas, total: v.total, pago: v.pago, pago_original: v.pago_original, fuente: 'POS anterior', lote_importacion: o.lote, por: o.por,
  };
}
