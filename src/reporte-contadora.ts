// Reporte mensual para la contadora: qué se manda, cuándo y con qué texto. Código PURO (sin red ni base de datos): lo usan la Edge Function
// `reporte-contadora` y las pruebas. Un correo por CAJA (cada una con sus propios destinatarios), con el Excel «Detalle de ventas» + «Resumen por día» (ver hojaDetalleVentas).
import { reporteConsolidado } from './consultas.ts';
import { hojaDetalleVentas, hojaDetalleVentasContadora, hojaResumenVentas, type Hoja } from './inventario.ts';
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

/** Intentos por envío: 9, 10 y 11 p. m. del último día y 9 a. m. del día siguiente (hora de Hermosillo). Si los 4 fallan se avisa al teléfono y ya no se insiste. */
export const MAX_INTENTOS = 4;
export const claveCaja = (tienda: string, caja: number) => `${tienda}/${caja}`;
/**
 * Reporte especial (para la auxiliar de la contadora): el mismo envío mensual, con otro formato, de la Caja 1 de cada tienda. Se guarda con el número de caja
 * 100 + N (101 = reporte especial de la Caja 1), así comparte tablas, programación y reintentos con los reportes por caja sin tocar la base de datos.
 */
export const BASE_ESPECIAL = 100;
export const esEspecial = (caja: number) => caja > BASE_ESPECIAL;
export const cajaEspecialDe = (caja: number) => BASE_ESPECIAL + caja;
export const SALUDO_ESPECIAL = 'Contadora Elva';
/** Nombre para pantallas internas (Administración y el aviso al teléfono); el correo y el Excel del especial NO llevan caja ni este rótulo. */
export const nombreCaja = (tienda: string, caja: number) => (esEspecial(caja) ? `Reporte Especial Caja ${caja - BASE_ESPECIAL} · ${NOMBRE_NEGOCIO[tienda] ?? tienda}` : `${NOMBRE_NEGOCIO[tienda] ?? tienda} · Caja ${caja}`);
/** Hora local (0–23) de un instante. */
export const horaLocalDe = (iso: string) => new Date(Date.parse(iso) - 7 * 3600_000).getUTCHours();

/**
 * Qué mes toca enviar «ahora» (la función corre a las 21, 22 y 23 h y a las 9 h de Hermosillo):
 *  · el último día del mes, de las 9 p. m. en adelante: el mes que termina;
 *  · el día 1, de las 9 a. m. en adelante: el mes anterior (el cuarto y último intento).
 * `cerrados` trae «periodo|tienda/caja» de lo que ya salió o ya agotó sus intentos: no se vuelve a intentar.
 */
export function porEnviar(ahoraIso: string, cajasActivas: { tienda: string; caja: number }[], cerrados: Set<string>): { periodo: string; tienda: string; caja: number }[] {
  const fecha = fechaLocal(ahoraIso);
  const dia = Number(fecha.slice(8, 10)), hora = horaLocalDe(ahoraIso);
  const periodo = esUltimoDiaDelMes(fecha) && hora >= 21 ? fecha.slice(0, 7) : dia === 1 && hora >= 9 ? mesAnterior(fecha.slice(0, 7)) : null;
  if (!periodo) return [];
  return cajasActivas.filter((c) => !cerrados.has(`${periodo}|${claveCaja(c.tienda, c.caja)}`)).map((c) => ({ periodo, tienda: c.tienda, caja: c.caja }));
}

export interface ReporteCaja {
  tienda: string;
  /** Caja real (en el reporte especial, la 1 aunque se guarde como 101). */
  caja: number;
  /** Formato para la auxiliar de la contadora: una sola hoja, siete columnas, sin mencionar la caja. */
  especial: boolean;
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
  /** Compras a crédito de empleadas (folios CR): están en el detalle, pero no son dinero cobrado. */
  credito_empleadas: number;
  creditos: number;
  fees: number;
  cambios: number;
  historicos: number;
  hojas: Hoja[];
  archivo: string;
}

/** Reporte de UNA caja y UN mes (o de lo que va del mes, con `hastaFecha`). Incluye las ventas históricas del POS anterior de esa caja. Nunca cuenta cancelados. */
export function reporteDeCaja(ops: Op[], tienda: string, cajaGuardada: number, periodo: string, hastaFecha?: string): ReporteCaja {
  const especial = esEspecial(cajaGuardada);
  const caja = especial ? cajaGuardada - BASE_ESPECIAL : cajaGuardada;
  const { desde, hasta: finMes } = rangoDelPeriodo(periodo);
  const hasta = hastaFecha && hastaFecha < finMes ? hastaFecha : finMes;
  const r = reporteConsolidado({ rol: 'admin', usuario: 'reporte-mensual' } as never, ops, { desde, hasta, cajas: [{ tienda, caja }], historicas: true });
  const vivas = r.filas.filter((f) => f.estado !== 'cancelada');
  const suma = (k: 'efectivo' | 'tarjeta' | 'dolares' | 'tarjeta_regalo' | 'otro' | 'mixto' | 'credito') => vivas.reduce((a, f) => a + f.montos[k], 0);
  return {
    tienda, caja, especial, periodo, desde, hasta, tickets: vivas.length, piezas: vivas.reduce((a, f) => a + f.piezas, 0), total: vivas.reduce((a, f) => a + f.total, 0),
    efectivo: suma('efectivo'), tarjeta: suma('tarjeta'), dolares: suma('dolares'), tarjeta_regalo: suma('tarjeta_regalo'), otros: suma('otro'), mixto: suma('mixto'), credito_empleadas: suma('credito'), creditos: vivas.filter((f) => f.serie === 'CR').length,
    fees: vivas.filter((f) => f.tipo_ticket === 'fee').reduce((a, f) => a + f.total, 0), cambios: vivas.filter((f) => f.tipo_ticket === 'cambio').length,
    historicos: vivas.filter((f) => f.historico).length,
    hojas: especial ? [hojaDetalleVentasContadora(r)] : [hojaDetalleVentas(r), hojaResumenVentas(r)],
    archivo: `reporte-de-ventas-${tienda === 'DUO' ? 'duo' : tienda === 'LON' ? 'london' : tienda.toLowerCase()}${especial ? '' : `-caja-${caja}`}-${periodo}.xlsx`,
  };
}

const mxn = (c: number) => `${c < 0 ? '−' : ''}$${(Math.abs(c) / 100).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',')}`;
const fechaCorta = (f: string) => `${f.slice(8, 10)}/${f.slice(5, 7)}/${f.slice(0, 4)}`;
const esc = (x: string) => x.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));

/** Asunto y cuerpo del correo (texto y HTML sencillo), en español. `prueba` marca el correo como de prueba. */
export function correoDelReporte(r: ReporteCaja, o: { prueba?: boolean; corteA?: string } = {}) {
  // En el especial el correo no dice qué caja es ni que es un reporte especial.
  const negocio = r.especial ? (NOMBRE_NEGOCIO[r.tienda] ?? r.tienda) : nombreCaja(r.tienda, r.caja);
  const parcial = r.hasta < rangoDelPeriodo(r.periodo).hasta;
  const asunto = `${o.prueba ? '[PRUEBA] ' : ''}${negocio} · Reporte de ventas de ${nombreDelMes(r.periodo)}${parcial ? ` (al ${fechaCorta(r.hasta)})` : ''}`;
  const lineas: [string, string][] = [
    ['Tickets', String(r.tickets)], ['Piezas vendidas', String(r.piezas)], ['Total cobrado', mxn(r.total - r.credito_empleadas)], ['Efectivo', mxn(r.efectivo)], ['Tarjeta', mxn(r.tarjeta)],
    ...(r.dolares ? [['Dólares (equivalente en pesos)', mxn(r.dolares)] as [string, string]] : []), ...(r.tarjeta_regalo ? [['Tarjetas de regalo', mxn(r.tarjeta_regalo)] as [string, string]] : []),
    ...(r.mixto ? [['Pagos mixtos sin desglose', mxn(r.mixto)] as [string, string]] : []),
    ...(r.creditos ? [[`Compras a crédito de empleadas (${r.creditos}, folios CR; no es dinero cobrado, se descuenta de nómina)`, mxn(r.credito_empleadas)] as [string, string]] : []), ...(r.fees ? [['Fees por daño (incluidos en el total)', mxn(r.fees)] as [string, string]] : []),
    ...(r.cambios ? [['Cambios sin diferencia', String(r.cambios)] as [string, string]] : []),
  ];
  const intro = r.especial ? `Adjunto el reporte de ventas de ${negocio} · del ${fechaCorta(r.desde)} al ${fechaCorta(r.hasta)}.` : `Adjunto el reporte de ventas de ${negocio} del ${fechaCorta(r.desde)} al ${fechaCorta(r.hasta)}.`;
  const corte = o.corteA ? `Corte: ${o.corteA}. Lo que se venda después no está en este archivo.` : '';
  const saludo = r.especial ? `Hola, ${SALUDO_ESPECIAL}` : 'Hola,';
  const pie = r.especial ? 'El archivo trae la hoja «Detalle de ventas» (una fila por ticket, con folio, fecha, piezas, total y forma de pago). Los cancelados no se cuentan. Enviado automáticamente por LonDuo POS.' : 'El archivo trae dos hojas: «Detalle de ventas» (una fila por ticket, con folio, fecha, piezas, total y forma de pago) y «Resumen por día». Los cancelados no se cuentan. Enviado automáticamente por LonDuo POS.';
  const texto = [saludo, '', intro, '', ...lineas.map(([k, v]) => `${k}: ${v}`), '', corte, pie].filter((x, i, a) => !(x === '' && a[i - 1] === '')).join('\n');
  const html = `<p>${esc(saludo)}</p><p>${esc(intro)}</p><table cellpadding="4" style="border-collapse:collapse">${lineas.map(([k, v]) => `<tr><td>${esc(k)}</td><td align="right"><b>${esc(v)}</b></td></tr>`).join('')}</table>${corte ? `<p>${esc(corte)}</p>` : ''}<p style="color:#555">${esc(pie)}</p>`;
  return { asunto, texto, html };
}

/** Correo válido a simple vista (el proveedor lo valida de verdad). Devuelve la lista limpia y sin repetidos. */
export function limpiarCorreos(entrada: string | string[]): { correos: string[]; invalidos: string[] } {
  const partes = (Array.isArray(entrada) ? entrada : String(entrada ?? '').split(/[\s,;]+/)).map((x) => x.trim().toLowerCase()).filter(Boolean);
  const ok = /^[^\s@<>"]+@[^\s@<>"]+\.[^\s@<>"]{2,}$/;
  return { correos: [...new Set(partes.filter((x) => ok.test(x)))], invalidos: [...new Set(partes.filter((x) => !ok.test(x)))] };
}
