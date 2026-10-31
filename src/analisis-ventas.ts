// Análisis de ventas: cuánto se vende por mes, semana, día, día de la semana, hora (y su mapa de calor), forma de pago o caja.
// Código PURO sobre las filas del reporte consolidado (ya sin tickets cancelados). Horas y fechas son las locales del negocio (Hermosillo).
//  · «Tickets» y «Ticket promedio» cuentan solo ventas de mercancía; los cambios ($0) no cuentan y los fees por daño suman al total pero no son tickets.
//  · Las ventas del POS anterior no traen hora: entran a todo menos a las vistas por hora (se avisa cuántas se dejaron fuera).
import type { FilaVenta } from './consultas.ts';

export type Agrupar = 'anio' | 'mes' | 'semana' | 'dia' | 'dia_semana' | 'hora' | 'mapa_calor' | 'forma_pago' | 'caja' | 'tienda';
export const AGRUPACIONES: Agrupar[] = ['anio', 'mes', 'semana', 'dia', 'dia_semana', 'hora', 'mapa_calor', 'forma_pago', 'caja', 'tienda'];

export interface FilaAnalisis {
  clave: string;
  etiqueta: string;
  tickets: number;
  piezas: number;
  /** Centavos: ventas + fees por daño. */
  total: number;
  /** Centavos: solo ventas de mercancía. */
  total_ventas: number;
  fees: number;
  /** Centavos por ticket (ventas ÷ tickets). */
  promedio_ticket: number;
  /** Centavos por día del periodo en que cae esa categoría (p. ej. por cada lunes del rango, por cada día del mes en esa hora). Null si no aplica. */
  promedio_dia: number | null;
  /** % del total del periodo (0–100, un decimal). */
  porcentaje: number;
}

export interface ResultadoAnalisis {
  agrupar: Agrupar;
  desde: string;
  hasta: string;
  filas: FilaAnalisis[];
  resumen: { tickets: number; piezas: number; total: number; total_ventas: number; fees: number; promedio_ticket: number; dias: number; dias_con_ventas: number };
  /** La categoría con más ventas ($) y la de más tickets. */
  mejor: { por_total: { clave: string; etiqueta: string; total: number } | null; por_tickets: { clave: string; etiqueta: string; tickets: number } | null };
  /** Solo en `mapa_calor`: total en centavos [día de la semana 0=lunes … 6=domingo][hora 0–23]. */
  matriz?: number[][];
  /** Tickets que no trae hora (ventas del POS anterior) y por eso no entran a las vistas por hora. */
  sin_hora: number;
}

const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
const MESES_CORTO = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
export const DIAS_SEMANA = ['lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado', 'domingo'];
const DIAS_CORTO = ['lun', 'mar', 'mié', 'jue', 'vie', 'sáb', 'dom'];
const dos = (n: number) => String(n).padStart(2, '0');

const aUtc = (f: string) => Date.UTC(Number(f.slice(0, 4)), Number(f.slice(5, 7)) - 1, Number(f.slice(8, 10)));
const deUtc = (ms: number) => { const d = new Date(ms); return `${d.getUTCFullYear()}-${dos(d.getUTCMonth() + 1)}-${dos(d.getUTCDate())}`; };
/** 0 = lunes … 6 = domingo. */
export const diaSemana = (f: string) => (new Date(aUtc(f)).getUTCDay() + 6) % 7;
const sumaDias = (f: string, n: number) => deUtc(aUtc(f) + n * 86400000);
export const diasEntre = (desde: string, hasta: string) => Math.round((aUtc(hasta) - aUtc(desde)) / 86400000) + 1;

/** Semana ISO (lunes a domingo): año y número. La del 1 de enero puede ser de la semana 52/53 del año anterior. */
export function semanaIso(f: string): { anio: number; semana: number; lunes: string } {
  const lunes = sumaDias(f, -diaSemana(f));
  const jueves = sumaDias(lunes, 3);
  const anio = Number(jueves.slice(0, 4));
  const enero4 = `${anio}-01-04`;
  const lunesSem1 = sumaDias(enero4, -diaSemana(enero4));
  return { anio, semana: Math.floor(diasEntre(lunesSem1, lunes) / 7) + 1, lunes };
}

const etiquetaMes = (k: string) => `${MESES[Number(k.slice(5, 7)) - 1]} ${k.slice(0, 4)}`;
const rangoCorto = (lunes: string) => { const dom = sumaDias(lunes, 6); return lunes.slice(5, 7) === dom.slice(5, 7) ? `${Number(lunes.slice(8))}–${Number(dom.slice(8))} ${MESES_CORTO[Number(lunes.slice(5, 7)) - 1]}` : `${Number(lunes.slice(8))} ${MESES_CORTO[Number(lunes.slice(5, 7)) - 1]} – ${Number(dom.slice(8))} ${MESES_CORTO[Number(dom.slice(5, 7)) - 1]}`; };
const etiquetaHora = (h: number) => `${h}:00 – ${h + 1}:00`;

interface Acum { clave: string; etiqueta: string; tickets: number; piezas: number; total_ventas: number; fees: number; dias: Set<string> }
const nuevo = (clave: string, etiqueta: string): Acum => ({ clave, etiqueta, tickets: 0, piezas: 0, total_ventas: 0, fees: 0, dias: new Set() });

/** Agrupa las filas del reporte (que ya traen `estado`, `tipo_ticket`, `hora`, etc.) según `agrupar`. `desde`/`hasta` (YYYY-MM-DD) acotan y rellenan con ceros los huecos. */
export function analizarVentas(filas: FilaVenta[], o: { agrupar: Agrupar; desde?: string; hasta?: string }): ResultadoAnalisis {
  const vivas = filas.filter((f) => f.estado !== 'cancelada' && f.tipo_ticket !== 'cambio');
  const fechas = vivas.map((f) => f.fecha_local).sort();
  const desde = o.desde ?? fechas[0] ?? deUtc(Date.now());
  const hasta = o.hasta ?? fechas[fechas.length - 1] ?? desde;
  const ent = vivas.filter((f) => f.fecha_local >= desde && f.fecha_local <= hasta);
  const dias = Math.max(1, diasEntre(desde, hasta));
  const porHora = o.agrupar === 'hora' || o.agrupar === 'mapa_calor';
  const sinHora = porHora ? ent.filter((f) => !f.hora).length : 0;
  const datos = porHora ? ent.filter((f) => f.hora) : ent;

  const mapa = new Map<string, Acum>();
  const get = (clave: string, etiqueta: string) => mapa.get(clave) ?? mapa.set(clave, nuevo(clave, etiqueta)).get(clave)!;
  const matriz = Array.from({ length: 7 }, () => Array.from({ length: 24 }, () => 0));

  // Categorías que deben aparecer aunque no haya ventas (para ver los huecos): meses, semanas, días, días de la semana y horas del rango.
  if (o.agrupar === 'anio') for (let y = Number(desde.slice(0, 4)); y <= Number(hasta.slice(0, 4)); y++) get(String(y), String(y));
  if (o.agrupar === 'mes') for (let k = desde.slice(0, 7); k <= hasta.slice(0, 7); k = Number(k.slice(5, 7)) === 12 ? `${Number(k.slice(0, 4)) + 1}-01` : `${k.slice(0, 4)}-${dos(Number(k.slice(5, 7)) + 1)}`) get(k, etiquetaMes(k));
  if (o.agrupar === 'semana') for (let d = sumaDias(desde, -diaSemana(desde)); d <= hasta; d = sumaDias(d, 7)) { const s = semanaIso(d); get(`${s.anio}-S${dos(s.semana)}`, `Sem ${s.semana} · ${rangoCorto(d)}`); }
  if (o.agrupar === 'dia' && dias <= 400) for (let d = desde; d <= hasta; d = sumaDias(d, 1)) get(d, `${DIAS_CORTO[diaSemana(d)]} ${Number(d.slice(8))} ${MESES_CORTO[Number(d.slice(5, 7)) - 1]}`);
  if (o.agrupar === 'dia_semana') DIAS_SEMANA.forEach((n, i) => get(String(i), n[0]!.toUpperCase() + n.slice(1)));

  for (const f of datos) {
    const h = f.hora ? Number(f.hora.slice(0, 2)) : -1;
    let a: Acum;
    switch (o.agrupar) {
      case 'anio': a = get(f.fecha_local.slice(0, 4), f.fecha_local.slice(0, 4)); break;
      case 'mes': a = get(f.fecha_local.slice(0, 7), etiquetaMes(f.fecha_local.slice(0, 7))); break;
      case 'semana': { const s = semanaIso(f.fecha_local); a = get(`${s.anio}-S${dos(s.semana)}`, `Sem ${s.semana} · ${rangoCorto(s.lunes)}`); break; }
      case 'dia': a = get(f.fecha_local, `${DIAS_CORTO[diaSemana(f.fecha_local)]} ${Number(f.fecha_local.slice(8))} ${MESES_CORTO[Number(f.fecha_local.slice(5, 7)) - 1]}`); break;
      case 'dia_semana': { const n = diaSemana(f.fecha_local); a = get(String(n), DIAS_SEMANA[n]![0]!.toUpperCase() + DIAS_SEMANA[n]!.slice(1)); break; }
      case 'hora': case 'mapa_calor': a = get(dos(h), etiquetaHora(h)); matriz[diaSemana(f.fecha_local)]![h]! += f.total; break;
      case 'forma_pago': a = get(f.pago, f.pago); break;
      case 'caja': a = get(`${f.tienda}/${f.caja}`, `${f.tienda === 'DUO' ? 'DÚO' : f.tienda === 'LON' ? 'London' : f.tienda} · Caja ${f.caja}`); break;
      default: a = get(f.tienda, f.tienda === 'DUO' ? 'DÚO New York' : f.tienda === 'LON' ? 'London Love' : f.tienda);
    }
    if (f.tipo_ticket === 'fee') a.fees += f.total;
    else { a.tickets++; a.piezas += f.piezas; a.total_ventas += f.total; }
    a.dias.add(f.fecha_local);
  }

  // Horas: se muestran de la primera a la última hora con ventas (sin cortar huecos en medio).
  let claves = [...mapa.keys()];
  if (porHora) {
    const horas = claves.map(Number);
    if (horas.length) { const [a, b] = [Math.min(...horas), Math.max(...horas)]; for (let h = a; h <= b; h++) get(dos(h), etiquetaHora(h)); }
    claves = [...mapa.keys()];
  }
  const orden: Record<Agrupar, (a: Acum, b: Acum) => number> = {
    anio: (a, b) => a.clave.localeCompare(b.clave), mes: (a, b) => a.clave.localeCompare(b.clave), semana: (a, b) => a.clave.localeCompare(b.clave), dia: (a, b) => a.clave.localeCompare(b.clave),
    dia_semana: (a, b) => Number(a.clave) - Number(b.clave), hora: (a, b) => Number(a.clave) - Number(b.clave), mapa_calor: (a, b) => Number(a.clave) - Number(b.clave),
    forma_pago: (a, b) => (b.total_ventas + b.fees) - (a.total_ventas + a.fees), caja: (a, b) => a.clave.localeCompare(b.clave), tienda: (a, b) => a.clave.localeCompare(b.clave),
  };
  const lista = claves.map((k) => mapa.get(k)!).sort(orden[o.agrupar]);
  const total = lista.reduce((s, a) => s + a.total_ventas + a.fees, 0);
  // Promedio por día: lo que se vende, en promedio, en cada día del periodo que le toca a la categoría.
  const diasDe = (clave: string): number | null => {
    if (o.agrupar === 'dia_semana') { let n = 0; for (let d = desde; d <= hasta; d = sumaDias(d, 1)) if (diaSemana(d) === Number(clave)) n++; return n || null; }
    if (porHora) return dias;
    if (o.agrupar === 'mes') { const k = clave; const ini = `${k}-01` > desde ? `${k}-01` : desde; const fin = `${k}-${dos(new Date(Date.UTC(Number(k.slice(0, 4)), Number(k.slice(5, 7)), 0)).getUTCDate())}`; return diasEntre(ini, fin < hasta ? fin : hasta); }
    if (o.agrupar === 'anio') { const ini = `${clave}-01-01` > desde ? `${clave}-01-01` : desde, fin = `${clave}-12-31` < hasta ? `${clave}-12-31` : hasta; return diasEntre(ini, fin); }
    if (o.agrupar === 'semana') return 7;
    return null;
  };
  const filasOut: FilaAnalisis[] = lista.map((a) => {
    const t = a.total_ventas + a.fees, nd = diasDe(a.clave);
    return { clave: a.clave, etiqueta: a.etiqueta, tickets: a.tickets, piezas: a.piezas, total: t, total_ventas: a.total_ventas, fees: a.fees, promedio_ticket: a.tickets ? Math.round(a.total_ventas / a.tickets) : 0, promedio_dia: nd ? Math.round(t / nd) : null, porcentaje: total ? Math.round((t / total) * 1000) / 10 : 0 };
  });
  const tickets = filasOut.reduce((s, a) => s + a.tickets, 0);
  const totalVentas = filasOut.reduce((s, a) => s + a.total_ventas, 0);
  const mejorT = filasOut.length ? filasOut.reduce((m, a) => (a.total > m.total ? a : m)) : null;
  const mejorK = filasOut.length ? filasOut.reduce((m, a) => (a.tickets > m.tickets ? a : m)) : null;
  return {
    agrupar: o.agrupar, desde, hasta, filas: filasOut,
    resumen: { tickets, piezas: filasOut.reduce((s, a) => s + a.piezas, 0), total, total_ventas: totalVentas, fees: filasOut.reduce((s, a) => s + a.fees, 0), promedio_ticket: tickets ? Math.round(totalVentas / tickets) : 0, dias, dias_con_ventas: new Set(datos.map((f) => f.fecha_local)).size },
    mejor: { por_total: mejorT && mejorT.total > 0 ? { clave: mejorT.clave, etiqueta: mejorT.etiqueta, total: mejorT.total } : null, por_tickets: mejorK && mejorK.tickets > 0 ? { clave: mejorK.clave, etiqueta: mejorK.etiqueta, tickets: mejorK.tickets } : null },
    ...(o.agrupar === 'mapa_calor' ? { matriz } : {}),
    sin_hora: sinHora,
  };
}

// ── Ventas por empleada (vendedora: quien atendió a la clienta, «Venta por») ──
export type AgruparEmpleada = 'dia' | 'semana' | 'mes' | 'anio';
export const AGRUPACIONES_EMPLEADA: AgruparEmpleada[] = ['dia', 'semana', 'mes', 'anio'];
/** Ventas importadas del POS anterior: no traen quién atendió. */
export const SIN_VENDEDORA = 'Sin dato (POS anterior)';

export interface SerieEmpleada {
  clave: string;
  alias: string;
  tickets: number;
  piezas: number;
  /** Centavos de ventas de mercancía. */
  total: number;
  promedio_ticket: number;
  /** % del total vendido en el periodo (0–100, un decimal). */
  porcentaje: number;
  /** Una entrada por periodo, en el mismo orden que `periodos`. */
  periodos: { tickets: number; piezas: number; total: number }[];
}
export interface ResultadoEmpleadas {
  agrupar: AgruparEmpleada;
  desde: string;
  hasta: string;
  periodos: { clave: string; etiqueta: string }[];
  /** De la que más vendió a la que menos (el renglón «sin dato» al final). */
  empleadas: SerieEmpleada[];
  /** Suma de todas las empleadas por periodo. */
  totales: { tickets: number; piezas: number; total: number }[];
  resumen: { tickets: number; piezas: number; total: number; empleadas: number; mejor: { alias: string; total: number } | null };
}

/**
 * Lo que vendió cada empleada por día, semana, mes o año. Cuenta por quien atendió (no por quien cobró), solo ventas de mercancía; no resta devoluciones
 * (igual que el resto del Análisis: lo devuelto o cambiado sí se resta en Reportes › Ventas por vendedora). Los periodos sin ventas salen en cero.
 */
export function analizarPorEmpleada(filas: FilaVenta[], o: { agrupar: AgruparEmpleada; desde?: string; hasta?: string }): ResultadoEmpleadas {
  const vivas = filas.filter((f) => f.estado !== 'cancelada' && f.tipo_ticket === 'venta');
  const base = analizarVentas(vivas, { agrupar: o.agrupar, desde: o.desde, hasta: o.hasta });
  const periodos = base.filas.map((f) => ({ clave: f.clave, etiqueta: f.etiqueta }));
  const nombres = new Map<string, FilaVenta[]>();
  for (const f of vivas) { if (f.fecha_local < base.desde || f.fecha_local > base.hasta) continue; const k = f.vendedora || SIN_VENDEDORA; (nombres.get(k) ?? nombres.set(k, []).get(k)!).push(f); }
  const total = base.resumen.total_ventas;
  const series: SerieEmpleada[] = [...nombres].map(([alias, rows]) => {
    const r = analizarVentas(rows, { agrupar: o.agrupar, desde: base.desde, hasta: base.hasta });
    const porClave = new Map(r.filas.map((f) => [f.clave, f]));
    const celdas = periodos.map((p) => { const f = porClave.get(p.clave); return { tickets: f?.tickets ?? 0, piezas: f?.piezas ?? 0, total: f?.total_ventas ?? 0 }; });
    const t = celdas.reduce((a, c) => a + c.total, 0), n = celdas.reduce((a, c) => a + c.tickets, 0);
    return { clave: alias, alias, tickets: n, piezas: celdas.reduce((a, c) => a + c.piezas, 0), total: t, promedio_ticket: n ? Math.round(t / n) : 0, porcentaje: total ? Math.round((t / total) * 1000) / 10 : 0, periodos: celdas };
  }).sort((a, b) => Number(a.alias === SIN_VENDEDORA) - Number(b.alias === SIN_VENDEDORA) || b.total - a.total || a.alias.localeCompare(b.alias, 'es'));
  const totales = periodos.map((_, i) => series.reduce((a, s) => ({ tickets: a.tickets + s.periodos[i]!.tickets, piezas: a.piezas + s.periodos[i]!.piezas, total: a.total + s.periodos[i]!.total }), { tickets: 0, piezas: 0, total: 0 }));
  const conVentas = series.filter((s) => s.alias !== SIN_VENDEDORA && s.total > 0);
  const mejor = conVentas.length ? conVentas.reduce((m, s) => (s.total > m.total ? s : m)) : null;
  return {
    agrupar: o.agrupar, desde: base.desde, hasta: base.hasta, periodos, empleadas: series, totales,
    resumen: { tickets: series.reduce((a, s) => a + s.tickets, 0), piezas: series.reduce((a, s) => a + s.piezas, 0), total: series.reduce((a, s) => a + s.total, 0), empleadas: series.filter((s) => s.alias !== SIN_VENDEDORA).length, mejor: mejor ? { alias: mejor.alias, total: mejor.total } : null },
  };
}
