// Almacén: entradas de lotes, existencia del almacén, entregas a tiendas y recepción confirmada por la tienda.
// Todo es una proyección de operaciones inmutables (`alm.entrada`, `alm.entrega`, `alm.recibida`); nada se edita.
// Módulo puro: la lectura del archivo vive en inventario.ts / xlsx.ts.
import { claveDeEscaneo, clavesDeCatalogo } from './codigos.ts';
import { aplicarDepartamentos, normalizarDepto, type Departamento } from './departamentos.ts';
import type { ResultadoInventario } from './inventario.ts';
import type { Articulo, Op } from './tipos.ts';
import { fechaLocal } from './util.ts';

export const TIENDAS_ENTREGA = ['DUO', 'LON'] as const;

export interface EntradaAlmacen { entrada_id: string; item_id: string; qty: number; pedimento: string | null; lote_doc: string; fuente: string; ocurrio_en: string }
export interface EntregaAlmacen { entrega_id: string; item_id: string; tienda: string; qty: number; etiqueta_precio: boolean; etiqueta_costura: boolean; exceso: boolean; ocurrio_en: string; por: string }
export interface ExistenciaAlmacen { item_id: string; recibido: number; entregado: number; /** Piezas faltantes que aparecieron en el almacén. */ recuperado: number; /** Correcciones del propietario (suma de `alm.ajuste`). */ ajustes: number; existencia: number; pedimentos: string[]; entregas: EntregaAlmacen[] }

/** Existencia del almacén por artículo: lo recibido menos lo entregado a tiendas. Puede quedar negativa (se entrega con aviso). */
export function existenciaAlmacen(ops: Op[]): Map<string, ExistenciaAlmacen> {
  const m = new Map<string, ExistenciaAlmacen>();
  const de = (id: string) => { let x = m.get(id); if (!x) m.set(id, (x = { item_id: id, recibido: 0, entregado: 0, recuperado: 0, ajustes: 0, existencia: 0, pedimentos: [], entregas: [] })); return x; };
  const corr = correccionesEntradas(ops);
  for (const o of ops) {
    if (o.tipo === 'alm.entrada') {
      const x = de(o.payload.item_id);
      const c = corr.get(o.payload.entrada_id);
      const qty = c?.qty ?? o.payload.qty;
      const pedimento = c && c.pedimento !== undefined ? c.pedimento : o.payload.pedimento;
      x.recibido += qty;
      if (pedimento && !x.pedimentos.includes(pedimento)) x.pedimentos.push(pedimento);
    } else if (o.tipo === 'alm.ajuste') {
      // Corrección del propietario (Inventario → Existencias reales): suma o resta piezas del almacén sin pasar por una entrada.
      de(o.payload.item_id).ajustes += o.payload.delta;
    } else if (o.tipo === 'alm.entrega') {
      const x = de(o.payload.item_id);
      x.entregado += o.payload.qty;
      x.entregas.push({ ...o.payload, ocurrio_en: o.ocurrio_en });
    }
  }
  for (const r of resolucionesFaltantes(ops).values()) if (r.destino === 'almacen' && r.qty > 0) de(r.item_id).recuperado += r.qty;
  for (const x of m.values()) x.existencia = x.recibido - x.entregado + x.recuperado + x.ajustes;
  return m;
}

/** Corrección de una entrada mal capturada: el último registro por entrada manda (cantidad y/o pedimento). La entrada original nunca se edita. */
export interface CorreccionEntrada { entrada_id: string; qty?: number; pedimento?: string | null; motivo: string; por: string; ocurrio_en: string }
export function correccionesEntradas(ops: Op[]): Map<string, CorreccionEntrada> {
  const m = new Map<string, CorreccionEntrada>();
  for (const o of ops) {
    if (o.tipo !== 'alm.correccion') continue;
    const previa = m.get(o.payload.entrada_id);
    m.set(o.payload.entrada_id, {
      entrada_id: o.payload.entrada_id, qty: o.payload.qty ?? previa?.qty, pedimento: o.payload.pedimento !== undefined ? o.payload.pedimento : previa?.pedimento,
      motivo: o.payload.motivo, por: o.payload.por ?? '', ocurrio_en: o.ocurrio_en,
    });
  }
  return m;
}
export interface EntradaConCorreccion extends EntradaAlmacen { por: string; qty_original: number; pedimento_original: string | null; corregida: boolean; motivo: string | null; corregida_por: string | null; corregida_en: string | null }
/** Entradas de un artículo con su corrección vigente (la más reciente primero). */
export function entradasDeArticulo(ops: Op[], itemId: string): EntradaConCorreccion[] {
  const corr = correccionesEntradas(ops);
  const l: EntradaConCorreccion[] = [];
  for (const o of ops) {
    if (o.tipo !== 'alm.entrada' || o.payload.item_id !== itemId) continue;
    const c = corr.get(o.payload.entrada_id);
    l.push({
      entrada_id: o.payload.entrada_id, item_id: itemId, qty: c?.qty ?? o.payload.qty, pedimento: c && c.pedimento !== undefined ? c.pedimento : (o.payload.pedimento ?? null), lote_doc: o.payload.lote_doc ?? '', fuente: o.payload.fuente ?? '', ocurrio_en: o.ocurrio_en,
      por: o.payload.por ?? '', qty_original: o.payload.qty, pedimento_original: o.payload.pedimento ?? null, corregida: !!c, motivo: c?.motivo ?? null, corregida_por: c?.por ?? null, corregida_en: c?.ocurrio_en ?? null,
    });
  }
  return l.reverse();
}

// ── piezas faltantes: la tienda recibe menos de lo entregado y Administración las ubica o las da por perdidas ──
export const DESTINOS_FALTANTE_ESPECIALES = ['almacen', 'perdida'] as const;
export interface ResolucionFaltante { entrega_id: string; item_id: string; destino: string; qty: number }
/** Cantidad vigente por (entrega, destino): el último registro gana, así una corrección reemplaza a la anterior. */
export function resolucionesFaltantes(ops: Op[]): Map<string, ResolucionFaltante> {
  const m = new Map<string, ResolucionFaltante>();
  for (const o of ops) if (o.tipo === 'alm.faltante') m.set(`${o.payload.entrega_id}|${o.payload.destino}`, { entrega_id: o.payload.entrega_id, item_id: o.payload.item_id, destino: o.payload.destino, qty: o.payload.qty });
  return m;
}
export interface Faltante {
  entrega_id: string; item_id: string; tienda: string; entregadas: number; recibidas: number; faltan: number;
  reportada_en: string; reportada_por: string;
  /** Piezas ubicadas por destino: `almacen`, `perdida` o el código de una tienda. */
  ubicadas: Record<string, number>;
  pendiente: number; estado: 'pendiente' | 'resuelto';
}
/** Faltantes de todas las entregas confirmadas con menos piezas que las entregadas. */
export function faltantes(ops: Op[]): Faltante[] {
  const entregas = new Map<string, { item_id: string; tienda: string; qty: number }>();
  for (const o of ops) if (o.tipo === 'alm.entrega') entregas.set(o.payload.entrega_id, { item_id: o.payload.item_id, tienda: o.payload.tienda, qty: o.payload.qty });
  const res = resolucionesFaltantes(ops);
  const l: Faltante[] = [];
  for (const o of ops) {
    if (o.tipo !== 'alm.recibida') continue;
    const e = entregas.get(o.payload.entrega_id);
    if (!e || o.payload.qty >= e.qty) continue;
    const ubicadas: Record<string, number> = {};
    let suma = 0;
    for (const r of res.values()) if (r.entrega_id === o.payload.entrega_id && r.qty > 0) { ubicadas[r.destino] = r.qty; suma += r.qty; }
    const faltan = e.qty - o.payload.qty;
    l.push({ entrega_id: o.payload.entrega_id, item_id: e.item_id, tienda: e.tienda, entregadas: e.qty, recibidas: o.payload.qty, faltan, reportada_en: o.ocurrio_en, reportada_por: o.payload.cajero ?? '', ubicadas, pendiente: faltan - suma, estado: faltan - suma > 0 ? 'pendiente' : 'resuelto' });
  }
  return l;
}

/** Recordatorio interno del almacén: fecha (AAAA-MM-DD) en que hay que sacar el artículo a piso. El último registro gana; null lo quita. */
export function recordatoriosPiso(ops: Op[]): Map<string, string> {
  const m = new Map<string, string>();
  for (const o of ops) if (o.tipo === 'alm.recordatorio') { if (o.payload.fecha) m.set(o.payload.item_id, o.payload.fecha); else m.delete(o.payload.item_id); }
  return m;
}
export const fechaValida = (f: unknown): f is string => {
  if (typeof f !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(f)) return false;
  const d = new Date(`${f}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === f;
};
/** Días de `hoy` a `fecha` (negativo = ya pasó). */
export const diasHasta = (hoy: string, fecha: string) => Math.round((Date.parse(`${fecha}T00:00:00Z`) - Date.parse(`${hoy}T00:00:00Z`)) / 86400000);
export const DIAS_URGENTE = 7;

export interface RecepcionPendiente { entrega_id: string; item_id: string; tienda: string; qty: number; ocurrio_en: string }
/** Entregas dirigidas a una tienda que su personal aún no confirmó. */
export function recepcionesPendientes(ops: Op[], tienda: string): RecepcionPendiente[] {
  const hechas = new Set<string>();
  for (const o of ops) if (o.tipo === 'alm.recibida' && o.payload.tienda === tienda) hechas.add(o.payload.entrega_id);
  const l: RecepcionPendiente[] = [];
  for (const o of ops) if (o.tipo === 'alm.entrega' && o.payload.tienda === tienda && !hechas.has(o.payload.entrega_id)) l.push({ entrega_id: o.payload.entrega_id, item_id: o.payload.item_id, tienda, qty: o.payload.qty, ocurrio_en: o.ocurrio_en });
  return l;
}

// ── revisión del archivo de alta ──
export type EstadoFilaAlta = 'nuevo' | 'codigo_existente' | 'invalido';
export interface FilaAlta {
  fila: number;
  cantidad: number;
  codigo: string; marca: string; descripcion: string; estilo: string; lote: string; precio: number;
  departamento_original: string;
  departamento: string;
  pedimento: string | null;
  estado: EstadoFilaAlta;
  /** Artículo existente con el mismo código (se sumará a él). */
  existente?: { item_id: string; item_no: string | null; descripcion: string; precio: number };
  /** Otros artículos con el mismo estilo y marca pero otro código (alta nueva; solo informativo). */
  mismo_estilo: { item_id: string; item_no: string | null; codigo: string; lote: string }[];
  avisos: string[];
}
export interface RevisionAlta {
  filas: FilaAlta[];
  resumen: { filas: number; nuevos: number; codigo_existente: number; invalidos: number; con_estilo_existente: number; piezas: number; sin_pedimento: number; por_envoltura: number };
  trae_pedimento: boolean;
  /** Mensajes de encabezados que faltan o errores de lectura. */
  errores: string[];
}

const k = (s: string) => normalizarDepto(s);

/**
 * Revisa un archivo de alta contra el catálogo: valida cantidad/código/precio, aplica los departamentos elegidos y busca
 * artículos que ya existen (mismo código → se suma al existente; mismo estilo y marca con otro código → informativo).
 */
export function revisarAlta(
  lectura: ResultadoInventario, catalogo: Articulo[], deptos: Departamento[],
  o: { decisiones?: Record<string, string>; reglaEnvolturas?: boolean } = {},
): RevisionAlta {
  const errores = [...lectura.errores];
  if (lectura.columnas.faltantes.includes('existencia')) errores.push('falta la columna CANTIDAD');
  if (lectura.columnas.faltantes.includes('descripcion')) errores.push('falta la columna DESCRIPCION');
  const aplicados = aplicarDepartamentos(lectura.articulos, deptos, { decisiones: o.decisiones, reglaEnvolturas: o.reglaEnvolturas });
  const porCodigo = new Map<string, Articulo>();
  const porEstilo = new Map<string, Articulo[]>();
  const porClave = new Map<string, Articulo>();
  for (const a of catalogo) {
    if (a.codigo) porCodigo.set(a.codigo, a);
    for (const k of clavesDeCatalogo(a.codigo)) if (!porClave.has(k)) porClave.set(k, a);
    const ke = a.estilo ? `${k(a.estilo)}|${k(a.marca)}` : '';
    if (ke) { const l = porEstilo.get(ke); if (l) l.push(a); else porEstilo.set(ke, [a]); }
  }
  const vistos = new Map<string, number>();
  for (const a of lectura.articulos) if (a.codigo) vistos.set(a.codigo, (vistos.get(a.codigo) ?? 0) + 1);
  const filas: FilaAlta[] = aplicados.articulos.map((a, i) => {
    const original = lectura.articulos[i]!;
    const avisos: string[] = [];
    const cantidad = original.existencia ?? NaN;
    let invalido = false;
    if (!Number.isInteger(cantidad) || cantidad <= 0) { avisos.push('la cantidad debe ser un entero mayor que 0'); invalido = true; }
    if (!a.codigo) { avisos.push('sin código: no se puede dar de alta (el almacén etiqueta con un código nuevo por lote)'); invalido = true; }
    if (!(a.precio > 0)) { avisos.push('el precio debe ser mayor que 0'); invalido = true; }
    if ((vistos.get(a.codigo) ?? 0) > 1) { avisos.push('el código se repite en el archivo'); invalido = true; }
    const clave = a.codigo ? claveDeEscaneo(a.codigo) : null;
    const existente = a.codigo ? (porCodigo.get(a.codigo) ?? (clave ? porClave.get(clave) : undefined)) : undefined; // el UPC completo del sistema anterior y el código corto de la etiqueta son el mismo artículo
    if (existente) {
      avisos.push('el código ya existe en el inventario: las piezas se suman a ese artículo');
      if (existente.precio !== a.precio) avisos.push(`el precio del archivo ($${(a.precio / 100).toFixed(2)}) difiere del inventario ($${(existente.precio / 100).toFixed(2)}); se conserva el del inventario`);
    }
    const similares = !existente && a.estilo ? (porEstilo.get(`${k(a.estilo)}|${k(a.marca)}`) ?? []) : [];
    if (similares.length) avisos.push(`ya existe este estilo y marca con otro código (${similares.length} artículo${similares.length === 1 ? '' : 's'}): se da de alta uno nuevo`);
    if (original.departamento !== a.departamento && k(original.departamento) !== k(a.departamento)) avisos.push(`departamento «${original.departamento || '(vacío)'}» → «${a.departamento}»`);
    return {
      fila: original.fila_origen, cantidad: Number.isInteger(cantidad) ? cantidad : 0, codigo: a.codigo, marca: a.marca, descripcion: a.descripcion, estilo: a.estilo, lote: a.lote, precio: a.precio,
      departamento_original: original.departamento, departamento: a.departamento, pedimento: a.pedimento ?? null,
      estado: invalido ? 'invalido' : existente ? 'codigo_existente' : 'nuevo',
      ...(existente ? { existente: { item_id: existente.item_id, item_no: existente.item_no, descripcion: existente.descripcion, precio: existente.precio } } : {}),
      mismo_estilo: similares.slice(0, 5).map((s) => ({ item_id: s.item_id, item_no: s.item_no, codigo: s.codigo, lote: s.lote })), avisos,
    };
  });
  const validas = filas.filter((f) => f.estado !== 'invalido');
  return {
    filas, errores, trae_pedimento: !lectura.columnas.faltantes.includes('pedimento'),
    resumen: {
      filas: filas.length, nuevos: filas.filter((f) => f.estado === 'nuevo').length, codigo_existente: filas.filter((f) => f.estado === 'codigo_existente').length,
      invalidos: filas.filter((f) => f.estado === 'invalido').length, con_estilo_existente: filas.filter((f) => f.mismo_estilo.length).length,
      piezas: validas.reduce((a, f) => a + f.cantidad, 0), sin_pedimento: validas.filter((f) => !f.pedimento).length, por_envoltura: aplicados.porEnvoltura,
    },
  };
}

/** Datos de un alta manual (una fila a la vez). */
export interface AltaManual { cantidad: number; codigo: string; marca: string; descripcion: string; estilo: string; lote: string; precio: number; departamento: string; pedimento?: string }

// ── reporte de entregas y diferencias ──
/** Días sin confirmar a partir de los cuales una entrega se marca como diferencia. ALTERNATIVA DE ENSAYO: pendiente de definir con el dueño. */
export const DIAS_ENTREGA_SIN_CONFIRMAR = 3;

export interface FilaEntrega {
  entrega_id: string; fecha_local: string; hora: string; item_id: string; item_no: string | null; codigo: string; descripcion: string; marca: string; estilo: string; departamento: string;
  tienda: string; qty: number; estado: 'confirmada' | 'pendiente'; exceso: boolean; etiqueta_precio: boolean; etiqueta_costura: boolean; por: string;
  recibida_local: string | null; recibida_por: string | null; recibida_qty: number | null; dias_espera: number;
}
export type TipoDiferencia = 'sin_confirmar' | 'faltante' | 'exceso' | 'almacen_negativo';
export interface Diferencia { tipo: TipoDiferencia; item_id: string; item_no: string | null; codigo: string; descripcion: string; tienda: string | null; entrega_id: string | null; detalle: string; piezas: number }
export interface ReporteEntregas {
  desde: string | null; hasta: string | null; hoy: string; dias_sin_confirmar: number;
  filas: FilaEntrega[];
  resumen: { entregas: number; piezas: number; confirmadas: number; pendientes: number; piezas_pendientes: number; con_exceso: number };
  porTienda: { tienda: string; entregas: number; piezas: number; confirmadas: number; pendientes: number; piezas_pendientes: number }[];
  diferencias: Diferencia[];
}

/**
 * Entregas del almacén a las tiendas en un periodo (por la fecha local de la entrega) con su estado de recepción, y las diferencias detectadas:
 * entregas sin confirmar de más de `DIAS_ENTREGA_SIN_CONFIRMAR` días, entregas que excedieron lo
 * registrado en el almacén y artículos con existencia negativa en el almacén. Las diferencias son del estado actual (no dependen del periodo).
 */
export function reporteEntregas(ops: Op[], cat: Map<string, Articulo>, f: { desde?: string; hasta?: string; tienda?: string }, hoy: string): ReporteEntregas {
  const recibidas = new Map<string, Op>();
  for (const o of ops) if (o.tipo === 'alm.recibida') recibidas.set(o.payload.entrega_id, o);
  const dias = (a: string, b: string) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86400000);
  const hora = (iso: string) => new Date(Date.parse(iso) - 7 * 3600_000).toISOString().slice(11, 16);
  const todas: FilaEntrega[] = [];
  for (const o of ops) {
    if (o.tipo !== 'alm.entrega') continue;
    const p = o.payload;
    const a = cat.get(p.item_id);
    const r = recibidas.get(p.entrega_id);
    const fecha = fechaLocal(o.ocurrio_en);
    todas.push({
      entrega_id: p.entrega_id, fecha_local: fecha, hora: hora(o.ocurrio_en), item_id: p.item_id, item_no: a?.item_no ?? null, codigo: a?.codigo ?? '', descripcion: a?.descripcion ?? p.item_id, marca: a?.marca ?? '', estilo: a?.estilo ?? '', departamento: a?.departamento ?? '',
      tienda: p.tienda, qty: p.qty, estado: r ? 'confirmada' : 'pendiente', exceso: !!p.exceso, etiqueta_precio: !!p.etiqueta_precio, etiqueta_costura: !!p.etiqueta_costura, por: p.por ?? '',
      recibida_local: r ? `${fechaLocal(r.ocurrio_en)} ${hora(r.ocurrio_en)}` : null, recibida_por: r ? (r.payload.cajero ?? '') : null, recibida_qty: r ? r.payload.qty : null,
      dias_espera: dias(fecha, r ? fechaLocal(r.ocurrio_en) : hoy),
    });
  }
  const deTienda = todas.filter((x) => !f.tienda || x.tienda === f.tienda);
  const filas = deTienda.filter((x) => (!f.desde || x.fecha_local >= f.desde) && (!f.hasta || x.fecha_local <= f.hasta))
    .sort((a, b) => (b.fecha_local + b.hora).localeCompare(a.fecha_local + a.hora));
  const suma = (l: FilaEntrega[]) => l.reduce((n, x) => n + x.qty, 0);
  const pend = (l: FilaEntrega[]) => l.filter((x) => x.estado === 'pendiente');
  const tiendas = [...new Set(filas.map((x) => x.tienda))].sort();
  const diferencias: Diferencia[] = [];
  const dif = (tipo: TipoDiferencia, x: { item_id: string; item_no: string | null; codigo: string; descripcion: string }, tienda: string | null, entrega_id: string | null, detalle: string, piezas: number) =>
    diferencias.push({ tipo, item_id: x.item_id, item_no: x.item_no, codigo: x.codigo, descripcion: x.descripcion, tienda, entrega_id, detalle, piezas });
  const pendientesFaltante = new Map(faltantes(ops).filter((q) => q.pendiente > 0).map((q) => [q.entrega_id, q.pendiente]));
  for (const x of deTienda) {
    if (x.estado === 'pendiente' && x.dias_espera >= DIAS_ENTREGA_SIN_CONFIRMAR) dif('sin_confirmar', x, x.tienda, x.entrega_id, `Entregada el ${x.fecha_local}; lleva ${x.dias_espera} días sin que la tienda la confirme`, x.qty);
    if (x.recibida_qty !== null && x.recibida_qty < x.qty) {
      const fa = pendientesFaltante.get(x.entrega_id);
      if (fa) dif('faltante', x, x.tienda, x.entrega_id, `Se entregaron ${x.qty} y la tienda recibió ${x.recibida_qty}; faltan por ubicar ${fa}`, fa);
    }
    if (x.exceso) dif('exceso', x, x.tienda, x.entrega_id, `Se entregaron ${x.qty} pieza(s) por encima de lo registrado en el almacén`, x.qty);
  }
  if (!f.tienda) for (const e of existenciaAlmacen(ops).values()) {
    const a = cat.get(e.item_id);
    if (e.existencia < 0) dif('almacen_negativo', { item_id: e.item_id, item_no: a?.item_no ?? null, codigo: a?.codigo ?? '', descripcion: a?.descripcion ?? e.item_id }, null, null, `Existencia en almacén: ${e.existencia} (recibido ${e.recibido}, entregado ${e.entregado})`, -e.existencia);
  }
  return {
    desde: f.desde ?? null, hasta: f.hasta ?? null, hoy, dias_sin_confirmar: DIAS_ENTREGA_SIN_CONFIRMAR, filas, diferencias,
    resumen: { entregas: filas.length, piezas: suma(filas), confirmadas: filas.filter((x) => x.estado === 'confirmada').length, pendientes: pend(filas).length, piezas_pendientes: suma(pend(filas)), con_exceso: filas.filter((x) => x.exceso).length },
    porTienda: tiendas.map((t) => { const l = filas.filter((x) => x.tienda === t); return { tienda: t, entregas: l.length, piezas: suma(l), confirmadas: l.length - pend(l).length, pendientes: pend(l).length, piezas_pendientes: suma(pend(l)) }; }),
  };
}
