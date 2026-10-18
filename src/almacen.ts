// Almacén: entradas de lotes, existencia del almacén, entregas a tiendas y recepción confirmada por la tienda.
// Todo es una proyección de operaciones inmutables (`alm.entrada`, `alm.entrega`, `alm.recibida`); nada se edita.
// Módulo puro: la lectura del archivo vive en inventario.ts / xlsx.ts.
import { aplicarDepartamentos, normalizarDepto, type Departamento } from './departamentos.ts';
import type { ResultadoInventario } from './inventario.ts';
import type { Articulo, Op } from './tipos.ts';

export const TIENDAS_ENTREGA = ['DUO', 'LON'] as const;

export interface EntradaAlmacen { entrada_id: string; item_id: string; qty: number; pedimento: string | null; lote_doc: string; fuente: string; ocurrio_en: string }
export interface EntregaAlmacen { entrega_id: string; item_id: string; tienda: string; qty: number; etiqueta_precio: boolean; etiqueta_costura: boolean; exceso: boolean; ocurrio_en: string; por: string }
export interface ExistenciaAlmacen { item_id: string; recibido: number; entregado: number; existencia: number; pedimentos: string[]; entregas: EntregaAlmacen[] }

/** Existencia del almacén por artículo: lo recibido menos lo entregado a tiendas. Puede quedar negativa (se entrega con aviso). */
export function existenciaAlmacen(ops: Op[]): Map<string, ExistenciaAlmacen> {
  const m = new Map<string, ExistenciaAlmacen>();
  const de = (id: string) => { let x = m.get(id); if (!x) m.set(id, (x = { item_id: id, recibido: 0, entregado: 0, existencia: 0, pedimentos: [], entregas: [] })); return x; };
  for (const o of ops) {
    if (o.tipo === 'alm.entrada') {
      const x = de(o.payload.item_id);
      x.recibido += o.payload.qty;
      if (o.payload.pedimento && !x.pedimentos.includes(o.payload.pedimento)) x.pedimentos.push(o.payload.pedimento);
    } else if (o.tipo === 'alm.entrega') {
      const x = de(o.payload.item_id);
      x.entregado += o.payload.qty;
      x.entregas.push({ ...o.payload, ocurrio_en: o.ocurrio_en });
    }
  }
  for (const x of m.values()) x.existencia = x.recibido - x.entregado;
  return m;
}

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
  for (const a of catalogo) {
    if (a.codigo) porCodigo.set(a.codigo, a);
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
    const existente = a.codigo ? porCodigo.get(a.codigo) : undefined;
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
