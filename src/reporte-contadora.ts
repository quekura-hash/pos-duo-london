// Reporte mensual para la contadora: qué se manda, cuándo y con qué texto. Código PURO (sin red ni base de datos): lo usan la Edge Function
// `reporte-contadora` y las pruebas. Un correo por CAJA (cada una con sus propios destinatarios), con el Excel «Detalle de ventas» + «Resumen por día» (ver hojaDetalleVentas).
import { reporteConsolidado } from './consultas.ts';
import { hojaDetalleVentas, hojaResumenVentas, type Hoja } from './inventario.ts';
import type { Op } from './tipos.ts';
import { fechaLocal } from './util.ts';

export const NOMBRE_NEGOCIO: Record<string, string> = { DUO: 'DÚO New York', LON: 'London Love' };
const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
const dos = (n: number) => String(n).padStart(2, '0');

export const diasDelMes = (periodo: string) => new Date(Date.UTC(Number(periodo.slice(0, 4)), Number(periodo.slice(5, 7)), 0)).getUTCDate();
export const nombreDelMes = (periodo: string) => `${MESES[Number(periodo.slice(5, 7)) - 1]} de ${periodo.slice(0, 4)}`;
export const esUltimoDiaDelMes = (fecha: string) => Number(fecha.slice(8, 10)) === diasDelMes(fecha.slice(0, 7));
export function mesAnterior(periodo: string): string {
  const y = Number(periodo.slice(0, 4)), m = Number(periodo.slice(5, 7));
  return m === 1 ? `${y - 1}-12` : `${y}-${dos(m - 1)}`;
}
export const rangoDelPeriodo = (periodo: string) => ({ desde: `${periodo}-01`, hasta: `${periodo}-${dos(diasDelMes(periodo))}` });

/**
 * Qué mes y qué tiendas toca enviar «ahora» (la función corre todos los días a las 9 p. m. hora de Hermosillo):
 *  · el último día del mes: el mes en curso completo;
 *  · los días 1 al 3: el mes anterior, si por una falla no salió (así un corte de internet o de correo no deja a la contadora sin reporte).
 * `enviados` trae «periodo|tienda/caja» de lo que ya salió: nunca se manda dos veces.
 */
export const claveCaja = (tienda: string, caja: number) => `${tienda}/${caja}`;
export const nombreCaja = (tienda: string, caja: number) => `${NOMBRE_NEGOCIO[tienda] ?? tienda} · Caja ${caja}`;
export function porEnviar(ahoraIso: string, cajasActivas: { tienda: string; caja: number }[], enviados: Set<string>): { periodo: string; tienda: string; caja: number }[] {
  const fecha = fechaLocal(ahoraIso);
  const dia = Number(fecha.slice(8, 10));
  const periodo = esUltimoDiaDelMes(fecha) ? fecha.slice(0, 7) : dia <= 3 ? mesAnterior(fecha.slice(0, 7)) : null;
  if (!periodo) return [];
  return cajasActivas.filter((c) => !enviados.has(`${periodo}|${claveCaja(c.tienda, c.caja)}`)).map((c) => ({ periodo, tienda: c.tienda, caja: c.caja }));
}

export interface ReporteCaja {
  tienda: string;
  caja: number;
  periodo: string;
  desde: string;
  hasta: string;
  tickets: number;
  piezas: number;
  total: number;
  efectivo: number;
  tarjeta: number;
  dolares: number;
  tarjeta_regalo: number;
  otros: number;
  mixto: number;
  fees: number;
  cambios: number;
  historicos: number;
  hojas: Hoja[];
  archivo: string;
}

/** Reporte de UNA caja y UN mes (o de lo que va del mes, con `hastaFecha`). Incluye las ventas históricas del POS anterior de esa caja. Nunca cuenta cancelados. */
export function reporteDeCaja(ops: Op[], tienda: string, caja: number, periodo: string, hastaFecha?: string): ReporteCaja {
  const { desde, hasta: finMes } = rangoDelPeriodo(periodo);
  const hasta = hastaFecha && hastaFecha < finMes ? hastaFecha : finMes;
  const r = reporteConsolidado({ rol: 'admin', usuario: 'reporte-mensual' } as never, ops, { desde, hasta, cajas: [{ tienda, caja }], historicas: true });
  const vivas = r.filas.filter((f) => f.estado !== 'cancelada');
  const suma = (k: 'efectivo' | 'tarjeta' | 'dolares' | 'tarjeta_regalo' | 'otro' | 'mixto') => vivas.reduce((a, f) => a + f.montos[k], 0);
  return {
    tienda, caja, periodo, desde, hasta, tickets: vivas.length, piezas: vivas.reduce((a, f) => a + f.piezas, 0), total: vivas.reduce((a, f) => a + f.total, 0),
    efectivo: suma('efectivo'), tarjeta: suma('tarjeta'), dolares: suma('dolares'), tarjeta_regalo: suma('tarjeta_regalo'), otros: suma('otro'), mixto: suma('mixto'),
    fees: vivas.filter((f) => f.tipo_ticket === 'fee').reduce((a, f) => a + f.total, 0), cambios: vivas.filter((f) => f.tipo_ticket === 'cambio').length,
    historicos: vivas.filter((f) => f.historico).length,
    hojas: [hojaDetalleVentas(r), hojaResumenVentas(r)],
    archivo: `reporte-de-ventas-${tienda === 'DUO' ? 'duo' : tienda === 'LON' ? 'london' : tienda.toLowerCase()}-caja-${caja}-${periodo}.xlsx`,
  };
}

const mxn = (c: number) => `${c < 0 ? '−' : ''}$${(Math.abs(c) / 100).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',')}`;
const fechaCorta = (f: string) => `${f.slice(8, 10)}/${f.slice(5, 7)}/${f.slice(0, 4)}`;
const esc = (x: string) => x.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));

/** Asunto y cuerpo del correo (texto y HTML sencillo), en español. `prueba` marca el correo como de prueba. */
export function correoDelReporte(r: ReporteCaja, o: { prueba?: boolean; corteA?: string } = {}) {
  const negocio = nombreCaja(r.tienda, r.caja);
  const parcial = r.hasta < rangoDelPeriodo(r.periodo).hasta;
  const asunto = `${o.prueba ? '[PRUEBA] ' : ''}${negocio} · Reporte de ventas de ${nombreDelMes(r.periodo)}${parcial ? ` (al ${fechaCorta(r.hasta)})` : ''}`;
  const lineas: [string, string][] = [
    ['Tickets', String(r.tickets)], ['Piezas vendidas', String(r.piezas)], ['Total cobrado', mxn(r.total)], ['Efectivo', mxn(r.efectivo)], ['Tarjeta', mxn(r.tarjeta)],
    ...(r.dolares ? [['Dólares (equivalente en pesos)', mxn(r.dolares)] as [string, string]] : []), ...(r.tarjeta_regalo ? [['Tarjetas de regalo', mxn(r.tarjeta_regalo)] as [string, string]] : []),
    ...(r.mixto ? [['Pagos mixtos sin desglose', mxn(r.mixto)] as [string, string]] : []), ...(r.fees ? [['Fees por daño (incluidos en el total)', mxn(r.fees)] as [string, string]] : []),
    ...(r.cambios ? [['Cambios sin diferencia', String(r.cambios)] as [string, string]] : []),
  ];
  const intro = `Adjunto el reporte de ventas de ${negocio} del ${fechaCorta(r.desde)} al ${fechaCorta(r.hasta)}.`;
  const corte = o.corteA ? `Corte: ${o.corteA}. Lo que se venda después no está en este archivo.` : '';
  const pie = 'El archivo trae dos hojas: «Detalle de ventas» (una fila por ticket, con folio, fecha, piezas, total y forma de pago) y «Resumen por día». Los cancelados no se cuentan. Enviado automáticamente por LonDuo POS.';
  const texto = [`Hola,`, '', intro, '', ...lineas.map(([k, v]) => `${k}: ${v}`), '', corte, pie].filter((x, i, a) => !(x === '' && a[i - 1] === '')).join('\n');
  const html = `<p>Hola,</p><p>${esc(intro)}</p><table cellpadding="4" style="border-collapse:collapse">${lineas.map(([k, v]) => `<tr><td>${esc(k)}</td><td align="right"><b>${esc(v)}</b></td></tr>`).join('')}</table>${corte ? `<p>${esc(corte)}</p>` : ''}<p style="color:#555">${esc(pie)}</p>`;
  return { asunto, texto, html };
}

/** Correo válido a simple vista (el proveedor lo valida de verdad). Devuelve la lista limpia y sin repetidos. */
export function limpiarCorreos(entrada: string | string[]): { correos: string[]; invalidos: string[] } {
  const partes = (Array.isArray(entrada) ? entrada : String(entrada ?? '').split(/[\s,;]+/)).map((x) => x.trim().toLowerCase()).filter(Boolean);
  const ok = /^[^\s@<>"]+@[^\s@<>"]+\.[^\s@<>"]{2,}$/;
  return { correos: [...new Set(partes.filter((x) => ok.test(x)))], invalidos: [...new Set(partes.filter((x) => !ok.test(x)))] };
}
