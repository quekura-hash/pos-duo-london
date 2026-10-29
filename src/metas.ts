// Metas de venta por tienda: la meta de un día es la venta de ese mismo día de la semana 52 semanas atrás (364 días antes) más el incremento que fije
// Administración. La barra de la caja compara lo vendido contra la meta del día, de la semana (lunes a domingo) o del mes, y se pinta según el RITMO: lo
// vendido contra lo que ya se debería llevar a esta hora (la semana y el mes pesan cada día por su propia meta).
// Código PURO: lo usan Administración, la caja y las pruebas. Importes en centavos; fechas «AAAA-MM-DD» en hora de Hermosillo.
import type { Op } from './tipos.ts';
import { addDias, fechaLocal } from './util.ts';
import { historicasDuplicadas, ventas } from './proyecciones.ts';

export interface MetaTienda { activa: boolean; incremento_pct: number; apertura: string; cierre: string }
export interface ConfigMetas { tiendas: Record<string, MetaTienda>; verde_pct: number; amarillo_pct: number }
export const CONFIG_METAS_INICIAL: ConfigMetas = {
  tiendas: { DUO: { activa: true, incremento_pct: 0, apertura: '10:00', cierre: '20:00' }, LON: { activa: true, incremento_pct: 0, apertura: '10:00', cierre: '20:00' } },
  verde_pct: 90, amarillo_pct: 60,
};
export type ColorMeta = 'verde' | 'amarillo' | 'rojo';
export type PeriodoMeta = 'dia' | 'semana' | 'mes';

/** Lo que Administración publica y las cajas usan: la configuración y la meta de cada día (en centavos) de cada tienda con historial. */
export interface MetasPublicadas {
  config: ConfigMetas;
  desde: string;
  hasta: string;
  generado_en: string;
  dias: Record<string, Record<string, number>>;
}

export interface AvancePeriodo {
  periodo: PeriodoMeta;
  desde: string;
  hasta: string;
  meta: number;
  vendido: number;
  /** Lo que ya se debería llevar vendido a esta hora (según la meta de cada día). */
  esperado: number;
  /** Vendido sobre la meta, en porcentaje (puede pasar de 100). */
  pct: number;
  /** Vendido sobre lo esperado a esta hora (1 = justo al ritmo). */
  ritmo: number;
  color: ColorMeta;
}

export const AÑO_ATRAS_DIAS = 364;
export const diaEquivalente = (fecha: string): string => addDias(fecha, -AÑO_ATRAS_DIAS);
const aMin = (hhmm: string): number => { const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm); return m ? Number(m[1]) * 60 + Number(m[2]) : 0; };
export const horaValida = (hhmm: unknown): hhmm is string => typeof hhmm === 'string' && /^([01]?\d|2[0-3]):[0-5]\d$/.test(hhmm);

/** Lunes de la semana (lunes a domingo) que contiene la fecha. */
export function lunesDe(fecha: string): string {
  const dow = new Date(`${fecha}T12:00:00Z`).getUTCDay(); // 0 = domingo
  return addDias(fecha, -((dow + 6) % 7));
}
export const diasDelPeriodo = (periodo: PeriodoMeta, fecha: string): string[] => {
  if (periodo === 'dia') return [fecha];
  if (periodo === 'semana') { const l = lunesDe(fecha); return Array.from({ length: 7 }, (_, i) => addDias(l, i)); }
  const [y, m] = fecha.split('-').map(Number) as [number, number];
  const n = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return Array.from({ length: n }, (_, i) => `${fecha.slice(0, 7)}-${String(i + 1).padStart(2, '0')}`);
};

/** Total vendido por día de UNA tienda (centavos): todos los tickets confirmados (no cancelados) de las dos cajas y las ventas importadas del POS anterior. */
export function totalesPorDia(ops: Op[], tienda: string): Map<string, number> {
  const m = new Map<string, number>();
  for (const v of ventas(ops).values()) {
    if (v.tienda !== tienda || v.estado !== 'confirmada') continue;
    const f = fechaLocal(v.ocurrio_en);
    m.set(f, (m.get(f) ?? 0) + v.total);
  }
  const descartadas = historicasDuplicadas(ops);
  for (const o of ops) {
    if (o.tipo !== 'venta.historica' || o.payload.tienda_hist !== tienda || descartadas.has(o.payload.hist_id)) continue;
    m.set(o.payload.fecha, (m.get(o.payload.fecha) ?? 0) + (Number(o.payload.total) || 0));
  }
  return m;
}

/** Meta de cada día entre `desde` y `hasta`: lo vendido el día equivalente del año pasado más el incremento, a pesos enteros. Solo días con historial (> 0). */
export function metasDias(totales: Map<string, number>, incrementoPct: number, desde: string, hasta: string): Record<string, number> {
  const out: Record<string, number> = {};
  for (let f = desde; f <= hasta; f = addDias(f, 1)) {
    const base = totales.get(diaEquivalente(f)) ?? 0;
    if (base > 0) out[f] = Math.round((base * (1 + incrementoPct / 100)) / 100) * 100;
  }
  return out;
}

/** Fracción del día transcurrida según el horario de la tienda (0 antes de abrir, 1 después de cerrar). */
export function fraccionDelDia(horaLocal: string, apertura: string, cierre: string): number {
  const a = aMin(apertura), c = aMin(cierre), h = aMin(horaLocal);
  if (c <= a) return 1;
  return Math.min(1, Math.max(0, (h - a) / (c - a)));
}

export function colorDeRitmo(ritmo: number, c: Pick<ConfigMetas, 'verde_pct' | 'amarillo_pct'>): ColorMeta {
  return ritmo >= c.verde_pct / 100 ? 'verde' : ritmo >= c.amarillo_pct / 100 ? 'amarillo' : 'rojo';
}

/** Avance de la tienda en el día, la semana y el mes. null en un periodo = no hay meta (la tienda no tiene historial de ese periodo). */
export function avanceMetas(o: {
  tienda: string; fecha: string; hora: string; config: ConfigMetas; metas: Record<string, number>; totales: Map<string, number>;
}): Record<PeriodoMeta, AvancePeriodo | null> {
  const t = o.config.tiendas[o.tienda];
  const frac = t ? fraccionDelDia(o.hora, t.apertura, t.cierre) : 1;
  const res = {} as Record<PeriodoMeta, AvancePeriodo | null>;
  for (const p of ['dia', 'semana', 'mes'] as const) {
    const dias = diasDelPeriodo(p, o.fecha);
    const meta = dias.reduce((a, d) => a + (o.metas[d] ?? 0), 0);
    if (meta <= 0) { res[p] = null; continue; }
    const vendido = dias.filter((d) => d <= o.fecha).reduce((a, d) => a + (o.totales.get(d) ?? 0), 0);
    const esperado = dias.reduce((a, d) => a + (d < o.fecha ? (o.metas[d] ?? 0) : d === o.fecha ? (o.metas[d] ?? 0) * frac : 0), 0);
    const ritmo = esperado > 0 ? vendido / esperado : 1;
    res[p] = { periodo: p, desde: dias[0]!, hasta: dias[dias.length - 1]!, meta, vendido, esperado: Math.round(esperado), pct: (vendido / meta) * 100, ritmo, color: colorDeRitmo(ritmo, o.config) };
  }
  return res;
}

/** La última publicación de metas (`metas.config`), o null si Administración todavía no ha publicado ninguna. */
export function metasPublicadas(ops: Op[]): MetasPublicadas | null {
  const o = ops.filter((x) => x.tipo === 'metas.config').at(-1);
  if (!o) return null;
  const p = o.payload;
  return { config: { ...CONFIG_METAS_INICIAL, ...(p.config ?? {}), tiendas: { ...CONFIG_METAS_INICIAL.tiendas, ...(p.config?.tiendas ?? {}) } }, desde: p.desde, hasta: p.hasta, generado_en: p.generado_en, dias: p.dias ?? {} };
}
