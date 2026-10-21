// Mensajes y reglas de las notificaciones de LonDuo POS. Código PURO (sin red ni base de datos): lo usa la Edge Function `notificar` y las pruebas.
// Zona horaria del negocio: America/Hermosillo (UTC-7 fijo, sin horario de verano), igual que el resto del sistema.

export interface Prefs {
  /** Cada venta confirmada. */
  venta: boolean;
  /** Solo avisar de ventas desde este importe (centavos); 0 = todas. */
  venta_minima: number;
  corte: boolean;
  resumen_dia: boolean;
  /** Hora local HH:MM a la que llega el resumen del día. */
  resumen_hora: string;
  devolucion: boolean;
  cancelacion: boolean;
  retiro: boolean;
  /** Faltantes de almacén y posibles pérdidas de documentos. */
  alertas: boolean;
  /** Tiendas de las que se quiere saber. */
  tiendas: string[];
}
export type TipoAviso = 'venta' | 'corte' | 'resumen_dia' | 'devolucion' | 'cancelacion' | 'retiro' | 'alertas' | 'prueba';

export const PREFS_OMISION: Prefs = { venta: true, venta_minima: 0, corte: true, resumen_dia: true, resumen_hora: '21:00', devolucion: true, cancelacion: true, retiro: true, alertas: true, tiendas: ['DUO', 'LON'] };

export interface OpMin { op_id: string; tipo: string; tienda: string | null; caja: number | null; ocurrio_en: string; payload: any }
export interface Aviso { tipo: TipoAviso; tienda: string | null; titulo: string; cuerpo: string; tag: string; url: string; monto?: number }

const NOMBRE_TIENDA: Record<string, string> = { DUO: 'DÚO', LON: 'London' };
export const nombreTienda = (t: string | null | undefined) => (t ? (NOMBRE_TIENDA[t] ?? t) : '');
export const mxn = (centavos: number) => `${centavos < 0 ? '−' : ''}$${(Math.abs(centavos) / 100).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',')}`;
const folio6 = (n: unknown) => String(n ?? '').padStart(6, '0');
const METODOS: Record<string, string> = { efectivo: 'efectivo', tarjeta: 'tarjeta', tarjeta_regalo: 'tarjeta de regalo', efectivo_usd: 'dólares', credito_cambio: 'cambio' };

/** Fecha local (YYYY-MM-DD) y hora local (HH:MM) del negocio para un instante ISO. */
export function fechaHoraLocal(iso: string): { fecha: string; hora: string } {
  const d = new Date(Date.parse(iso) - 7 * 3600_000);
  const p = (n: number) => String(n).padStart(2, '0');
  return { fecha: `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())}`, hora: `${p(d.getUTCHours())}:${p(d.getUTCMinutes())}` };
}
/** Inicio (UTC) del día local `fecha`: las 00:00 de Hermosillo son las 07:00 UTC. */
export const inicioDiaUtc = (fecha: string) => new Date(`${fecha}T07:00:00.000Z`);
export const fechaCorta = (fecha: string) => `${fecha.slice(8, 10)}/${fecha.slice(5, 7)}`;

export interface VentaMin { sale_id: string; tienda: string; caja: number; folio: number; cajero: string; total: number; vendedora?: string; lineas?: { qty: number; tarjeta_regalo?: boolean }[]; pagos?: { metodo: string }[] }

/** Un aviso por operación. `venta` es el contexto de una cancelación (la operación solo trae el `sale_id`). null = esa operación no genera aviso. */
export function avisoDeOp(op: OpMin, ctx: { venta?: VentaMin | null } = {}): Aviso | null {
  const p = op.payload ?? {};
  switch (op.tipo) {
    case 'sale.confirmed': {
      const piezas = (p.lineas ?? []).reduce((a: number, l: { qty: number; tarjeta_regalo?: boolean }) => a + (l.tarjeta_regalo ? 0 : l.qty), 0);
      const metodos = [...new Set<string>((p.pagos ?? []).map((x: { metodo: string }) => METODOS[x.metodo] ?? x.metodo))].join(' + ');
      const vendio = p.vendedora && p.vendedora !== 'Autocompra' ? ` · vendió ${p.vendedora}` : '';
      return {
        tipo: 'venta', tienda: p.tienda, monto: p.total, tag: `venta:${p.sale_id ?? op.op_id}`, url: './#ventas',
        titulo: `Venta ${nombreTienda(p.tienda)} · ${mxn(p.total)}`,
        cuerpo: `Caja ${p.caja} · folio ${folio6(p.folio)} · ${p.cajero}${vendio}${piezas ? ` · ${piezas} pza${piezas === 1 ? '' : 's'}` : ''}${metodos ? ` · ${metodos}` : ''}`,
      };
    }
    case 'sale.cancelled': {
      const v = ctx.venta;
      return {
        tipo: 'cancelacion', tienda: v?.tienda ?? null, monto: v?.total, tag: `cancelacion:${p.sale_id}`, url: './#ventas',
        titulo: `Venta cancelada${v ? ` ${nombreTienda(v.tienda)} · ${mxn(v.total)}` : ''}`,
        cuerpo: `${v ? `Caja ${v.caja} · folio ${folio6(v.folio)} · ` : ''}cancela ${p.cancelo ?? '—'}${p.autorizado_por ? ` (autoriza ${typeof p.autorizado_por === 'string' ? p.autorizado_por : p.autorizado_por.nombre ?? ''})` : ''} · ${p.motivo ?? 'sin motivo'}`,
      };
    }
    case 'return.registered':
      return {
        tipo: 'devolucion', tienda: p.tienda, monto: p.importe, tag: `devolucion:${p.devolucion_id}`, url: './#ventas',
        titulo: `Devolución ${nombreTienda(p.tienda)} · ${mxn(p.importe)}`,
        cuerpo: `Caja ${p.caja} · ${p.cajero ?? '—'} · ${p.motivo ?? 'sin motivo'}${(p.reembolsos ?? []).some((r: { metodo: string }) => r.metodo === 'efectivo') ? ' · sale efectivo' : ''}`,
      };
    case 'cash.retiro':
      return {
        tipo: 'retiro', tienda: p.tienda, monto: p.equivalente_mxn, tag: `retiro:${p.retiro_id}`, url: './#cortes',
        titulo: `Retiro de efectivo ${nombreTienda(p.tienda)} · ${mxn(p.equivalente_mxn ?? p.mxn?.total ?? 0)}`,
        cuerpo: `Caja ${p.caja} · ${p.usuario} · retiro ${p.folio_retiro ?? ''}`.trim(),
      };
    case 'corte.generado': {
      const c = p;
      const dif = typeof c.diferencia_mxn === 'number' && c.diferencia_mxn !== 0 ? ` · diferencia en efectivo ${mxn(c.diferencia_mxn)}` : '';
      return {
        tipo: 'corte', tienda: c.tienda, monto: c.ventas, tag: `corte:${c.tienda}:${c.caja}:${c.fecha}`, url: './#cortes',
        titulo: `Corte ${nombreTienda(c.tienda)} caja ${c.caja} · ${fechaCorta(c.fecha)}`,
        cuerpo: `${c.tickets} ticket${c.tickets === 1 ? '' : 's'} · ventas ${mxn(c.ventas)} · efectivo ${mxn(c.cobros_efectivo)} · tarjeta ${mxn(c.cobros_tarjeta)}${c.cobros_efectivo_usd ? ` · dólares ${mxn(c.cobros_efectivo_usd)}` : ''}${dif}`,
      };
    }
    case 'doc.perdida_posible':
      return { tipo: 'alertas', tienda: op.tienda, tag: `perdida:${op.op_id}`, url: './#cortes', titulo: `Posible pérdida de ventas ${nombreTienda(op.tienda)}`, cuerpo: `Caja ${op.caja ?? ''}: puede faltar información de ventas, pagos o folios. Revise en Administración.` };
    case 'alm.faltante':
      return { tipo: 'alertas', tienda: p.tienda ?? op.tienda, tag: `faltante:${op.op_id}`, url: './#almacen', titulo: 'Faltante de almacén', cuerpo: `Una entrega a ${nombreTienda(p.tienda ?? op.tienda)} reportó piezas faltantes. Revise Almacén.` };
    default:
      return null;
  }
}

/** ¿Este dispositivo debe recibir este aviso ahora? (preferencias, tienda, importe mínimo y pausa). */
export function debeEnviar(prefs: Partial<Prefs> | null | undefined, aviso: Pick<Aviso, 'tipo' | 'tienda' | 'monto'>, o: { pausaHasta?: string | null; ahora: string }): boolean {
  const pf: Prefs = { ...PREFS_OMISION, ...(prefs ?? {}) };
  if (aviso.tipo === 'prueba') return true;
  if (o.pausaHasta && Date.parse(o.pausaHasta) > Date.parse(o.ahora)) return false;
  if (!pf[aviso.tipo]) return false;
  if (aviso.tienda && !pf.tiendas.includes(aviso.tienda)) return false;
  if (aviso.tipo === 'venta' && pf.venta_minima > 0 && (aviso.monto ?? 0) < pf.venta_minima) return false;
  return true;
}

/** Una operación vieja (p. ej. ventas que una caja subió al recuperar internet) no avisa: sería una avalancha. */
export const esReciente = (op: Pick<OpMin, 'ocurrio_en'>, ahora: string, minutos = 15) => Date.parse(ahora) - Date.parse(op.ocurrio_en) <= minutos * 60_000;

export interface DatosDia { fecha: string; ventas: VentaMin[]; canceladas: string[]; devoluciones: { tienda: string; importe: number }[] }
/** Resumen del día por tienda y total (ventas netas de cancelaciones y devoluciones). */
export function resumenDelDia(d: DatosDia, tiendas: string[]): Aviso | null {
  const canceladas = new Set(d.canceladas);
  const filas = tiendas.map((t) => {
    const vs = d.ventas.filter((v) => v.tienda === t && !canceladas.has(v.sale_id));
    const bruto = vs.reduce((a, v) => a + v.total, 0);
    const devs = d.devoluciones.filter((x) => x.tienda === t).reduce((a, x) => a + x.importe, 0);
    return { t, tickets: vs.length, bruto, devs, neto: bruto - devs, canc: d.ventas.filter((v) => v.tienda === t && canceladas.has(v.sale_id)).length };
  });
  const tickets = filas.reduce((a, f) => a + f.tickets, 0);
  const neto = filas.reduce((a, f) => a + f.neto, 0);
  const lineas = filas.map((f) => `${nombreTienda(f.t)}: ${f.tickets} ticket${f.tickets === 1 ? '' : 's'} · ${mxn(f.neto)}${f.devs ? ` (dev. ${mxn(f.devs)})` : ''}${f.canc ? ` · ${f.canc} canc.` : ''}`);
  if (filas.length > 1) lineas.push(`Total: ${tickets} tickets · ${mxn(neto)}`);
  return { tipo: 'resumen_dia', tienda: null, monto: neto, tag: `resumen:${d.fecha}`, url: './#reportes', titulo: `Resumen del día ${fechaCorta(d.fecha)} · ${mxn(neto)}`, cuerpo: lineas.join('\n') };
}

/** ¿Toca enviar ya el resumen del día a este dispositivo? Una vez al día, a su hora local o después. */
export function tocaResumen(prefs: Partial<Prefs> | null | undefined, ultimoResumen: string | null, ahora: string): boolean {
  const pf: Prefs = { ...PREFS_OMISION, ...(prefs ?? {}) };
  if (!pf.resumen_dia) return false;
  const { fecha, hora } = fechaHoraLocal(ahora);
  return ultimoResumen !== fecha && hora >= pf.resumen_hora;
}

/** Limpia y valida preferencias que vienen del teléfono (nunca se confía en el formato). */
export function sanearPrefs(x: unknown): Prefs {
  const o = (x && typeof x === 'object' ? x : {}) as Record<string, unknown>;
  const b = (k: keyof Prefs) => (typeof o[k] === 'boolean' ? (o[k] as boolean) : (PREFS_OMISION[k] as boolean));
  const hora = typeof o.resumen_hora === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(o.resumen_hora) ? o.resumen_hora : PREFS_OMISION.resumen_hora;
  const minima = Number.isInteger(o.venta_minima) && (o.venta_minima as number) >= 0 && (o.venta_minima as number) <= 100_000_000 ? (o.venta_minima as number) : 0;
  const tiendas = Array.isArray(o.tiendas) ? o.tiendas.filter((t): t is string => t === 'DUO' || t === 'LON') : PREFS_OMISION.tiendas;
  return { venta: b('venta'), venta_minima: minima, corte: b('corte'), resumen_dia: b('resumen_dia'), resumen_hora: hora, devolucion: b('devolucion'), cancelacion: b('cancelacion'), retiro: b('retiro'), alertas: b('alertas'), tiendas: [...new Set(tiendas)] };
}
