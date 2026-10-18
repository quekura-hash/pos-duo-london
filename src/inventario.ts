import { DEPARTAMENTOS_BASE, esEnvoltura, revisarDepartamentos, type Departamento, type GrupoDepto } from './departamentos.ts';
import { formatoTasa } from './dinero.ts';
import type { Articulo, Op } from './tipos.ts';
import { aCentavos, aMXN } from './util.ts';

// Importación y exportación de INVENTARIO en tablas (Excel). Este módulo es puro: trabaja con filas ya leídas.
// Leer y escribir el archivo .xlsx vive en xlsx.ts.

export type Campo =
  | 'item_no' | 'codigo' | 'marca' | 'descripcion' | 'estilo' | 'lote' | 'departamento' | 'precio' | 'precio_alterno'
  | 'codigo_alterno' | 'etiqueta_costura' | 'etiqueta_precio' | 'pedimento' | 'codigo_2' | 'existencia';

export interface Perfil {
  id: string;
  titulo: string;
  explicacion: string;
  /** Encabezados aceptados por campo (se comparan sin acentos, sin mayúsculas ni espacios sobrantes). */
  columnas: Record<Campo, string[]>;
}

const BASE: Omit<Record<Campo, string[]>, 'marca' | 'descripcion'> = {
  item_no: ['item number', 'item #', 'item no', 'item'],
  codigo: ['upc', 'codigo'],
  estilo: ['estilo', 'attribute', 'atributo'],
  lote: ['lote', 'size'],
  departamento: ['department name', 'department', 'dept name', 'departamento'],
  precio: ['regular price', 'precio de venta', 'precio'],
  precio_alterno: ['custom price 1', 'precio alterno'],
  codigo_alterno: ['alternate lookup', 'codigo alterno'],
  etiqueta_costura: ['etiqt-costura', 'etiqueta costura', 'etiqueta de costura', 'etiq costura'],
  etiqueta_precio: ['etiqt- precio', 'etiqt-precio', 'etiqueta precio', 'etiqueta de precio', 'etiq precio'],
  pedimento: ['no. pedimento', 'pedimento'],
  codigo_2: ['upc 2', 'codigo 2'],
  existencia: ['on-hand qty', 'existencia', 'cantidad'],
};

/** Mapeo CONFIRMADO en la especificación: Item Name → Marca, Item Description → Descripción. */
export const PERFIL_CONFIRMADO: Perfil = {
  id: 'confirmado',
  titulo: 'Mapeo confirmado: Item Name = Marca, Item Description = Descripción',
  explicacion: 'Es el mapeo que el propietario confirmó. Verifique que coincida con su archivo: compare las columnas Marca y Descripción de la vista previa.',
  columnas: { ...BASE, marca: ['item name', 'marca'], descripcion: ['item description', 'descripcion'] },
};

/** Alternativa a validar con el propietario: en el inventario real Item Name suele traer la prenda (y a veces la marca). */
export const PERFIL_PRENDA_EN_NOMBRE: Perfil = {
  id: 'prenda_en_nombre',
  titulo: 'Alternativa: Item Name = Descripción, Item Description = Marca',
  explicacion: 'Item Name se toma como la descripción del artículo (p. ej. «BLUSA AMBIANCE») y Item Description como marca cuando existe. NO está aprobado.',
  columnas: { ...BASE, marca: ['item description', 'marca'], descripcion: ['item name', 'descripcion'] },
};
export const PERFILES = [PERFIL_CONFIRMADO, PERFIL_PRENDA_EN_NOMBRE];

const sinAcentos = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '');
const normEnc = (h: unknown) => sinAcentos(String(h ?? '')).toLowerCase().replace(/\s+/g, ' ').trim();

export type Severidad = 'bloquea_venta' | 'revisar' | 'info';
export interface Anomalia {
  tipo: string;
  severidad: Severidad;
  fila: number; // fila del archivo (1 = encabezados)
  item_no: string | null;
  codigo: string;
  detalle: string;
}

export type ArticuloImportado = Omit<Articulo, 'item_id' | 'origen'> & { fila_origen: number; existencia?: number | null };

export interface ResultadoInventario {
  perfil: string;
  /** Campo → encabezado del archivo que se usó. */
  columnas: { usadas: Partial<Record<Campo, string>>; ignoradas: string[]; faltantes: Campo[] };
  articulos: ArticuloImportado[];
  anomalias: Anomalia[];
  /** Textos de departamento distintos del archivo y qué departamento se propone para cada uno (para revisar antes de importar). */
  departamentos: GrupoDepto[];
  /** Artículos que por su descripción son bolsas o cajas de regalo. */
  envolturas: number;
  porTipo: { tipo: string; severidad: Severidad; cantidad: number; ejemplos: Anomalia[] }[];
  estadisticas: {
    filas: number; con_codigo: number; sin_codigo: number; con_codigo_alterno: number; descripcion_vacia: number; marca_vacia: number;
    estilo_vacio: number; lote_vacio: number; departamento_sin_clasificar: number; precio_no_vendible: number; con_precio_alterno: number;
    etiqueta_costura_si: number; etiqueta_precio_vacia: number; item_no_duplicados: number; codigos_duplicados: number;
    /** Cupones y certificados del sistema anterior (precio negativo): ya no se importan. */
    cupones_omitidos: number;
  };
  /** Errores que impiden importar (p. ej. falta una columna indispensable). */
  errores: string[];
}

const texto = (v: unknown): string => (v === null || v === undefined ? '' : typeof v === 'string' ? v : String(v));
const recorte = (v: unknown) => texto(v).trim();
const booleano = (v: unknown): boolean | null => {
  const t = sinAcentos(recorte(v)).toLowerCase();
  if (['yes', 'si', 'true', '1', 'x', 'y'].includes(t)) return true;
  if (['no', 'false', '0', 'n'].includes(t)) return false;
  return null;
};

/**
 * Lee las filas de una hoja (la primera fila son los encabezados) y devuelve los artículos y el REPORTE. Nada se descarta
 * por una anomalía: cada fila se importa y la anomalía se señala. Los códigos y lotes se conservan como texto, con sus
 * ceros; un código que Excel entregó como número se advierte y NO se reconstruye. Item # repetidos, códigos repetidos
 * y artículos sin código se REPORTAN, nunca se fusionan ni se renumeran.
 */
export function leerInventario(filas: unknown[][], perfil: Perfil = PERFIL_CONFIRMADO, deptos: Departamento[] = DEPARTAMENTOS_BASE): ResultadoInventario {
  const res: ResultadoInventario = {
    perfil: perfil.id, columnas: { usadas: {}, ignoradas: [], faltantes: [] }, articulos: [], anomalias: [], departamentos: [], envolturas: 0, porTipo: [],
    estadisticas: {
      filas: 0, con_codigo: 0, sin_codigo: 0, con_codigo_alterno: 0, descripcion_vacia: 0, marca_vacia: 0, estilo_vacio: 0, lote_vacio: 0,
      departamento_sin_clasificar: 0, precio_no_vendible: 0, con_precio_alterno: 0, etiqueta_costura_si: 0, etiqueta_precio_vacia: 0,
      item_no_duplicados: 0, codigos_duplicados: 0, cupones_omitidos: 0,
    },
    errores: [],
  };
  if (!filas.length) { res.errores.push('el archivo no tiene filas'); return res; }
  const enc = filas[0]!.map((h) => texto(h));
  const idx = {} as Record<Campo, number>;
  const usados = new Set<number>();
  for (const campo of Object.keys(perfil.columnas) as Campo[]) {
    const alias = perfil.columnas[campo];
    const j = enc.findIndex((h, i) => !usados.has(i) && alias.includes(normEnc(h)));
    if (j >= 0) { idx[campo] = j; usados.add(j); res.columnas.usadas[campo] = enc[j]!; } else { idx[campo] = -1; res.columnas.faltantes.push(campo); }
  }
  res.columnas.ignoradas = enc.filter((h, i) => !usados.has(i) && h.trim() !== '');
  if (idx.codigo < 0) res.errores.push('falta la columna del código (UPC)');
  if (idx.precio < 0) res.errores.push('falta la columna del precio (Regular Price)');
  if (idx.item_no < 0 && idx.codigo < 0) res.errores.push('faltan Item Number y UPC: no hay forma de identificar los artículos');
  if (res.errores.length) return res;

  const cel = (r: unknown[], c: Campo) => (idx[c] >= 0 ? r[idx[c]] : null);
  const anom = (tipo: string, severidad: Severidad, a: ArticuloImportado, detalle: string) =>
    res.anomalias.push({ tipo, severidad, fila: a.fila_origen, item_no: a.item_no, codigo: a.codigo, detalle });
  const vistosItemNo = new Map<string, ArticuloImportado[]>();
  const vistosCodigo = new Map<string, ArticuloImportado[]>();

  for (let n = 1; n < filas.length; n++) {
    const r = filas[n]!;
    if (r.every((v) => v === null || v === undefined || (typeof v === 'string' && v.trim() === ''))) continue; // fila vacía
    const fila = n + 1;
    const rawCodigo = cel(r, 'codigo');
    const codigo = texto(rawCodigo);
    const rawNo = cel(r, 'item_no');
    const item_no = recorte(rawNo) === '' ? null : recorte(rawNo);
    let precio = 0;
    let precioIlegible = false;
    const rawPrecio = cel(r, 'precio');
    try { precio = recorte(rawPrecio) === '' ? 0 : aCentavos(texto(rawPrecio)); } catch { precioIlegible = true; }
    let precio_alterno: number | null = null;
    const rawAlt = cel(r, 'precio_alterno');
    try { precio_alterno = recorte(rawAlt) === '' ? null : aCentavos(texto(rawAlt)); } catch { precio_alterno = null; }
    const alterno = texto(cel(r, 'codigo_alterno'));
    const existencia = idx.existencia >= 0 && recorte(cel(r, 'existencia')) !== '' ? Number(texto(cel(r, 'existencia'))) : null;
    const a: ArticuloImportado = {
      codigo, item_no, marca: recorte(cel(r, 'marca')), descripcion: recorte(cel(r, 'descripcion')), estilo: recorte(cel(r, 'estilo')), lote: recorte(cel(r, 'lote')),
      departamento: recorte(cel(r, 'departamento')), precio,
      codigo_alterno: alterno === '' ? null : alterno, precio_alterno,
      etiqueta_costura: booleano(cel(r, 'etiqueta_costura')), etiqueta_precio: booleano(cel(r, 'etiqueta_precio')),
      pedimento: recorte(cel(r, 'pedimento')) || null, codigo_2: texto(cel(r, 'codigo_2')) || null,
      fila_origen: fila, existencia: Number.isFinite(existencia as number) ? existencia : null,
    };
    // Los cupones y certificados del sistema anterior (precio negativo) quedaron obsoletos: se omiten y se informa cuántos.
    if (!precioIlegible && precio < 0) {
      res.estadisticas.cupones_omitidos++;
      res.anomalias.push({ tipo: 'cupon_obsoleto', severidad: 'info', fila, item_no, codigo, detalle: `precio ${precio / 100}: cupón o certificado del sistema anterior; no se importa (los descuentos ahora son promociones y cupones nuevos)` });
      continue;
    }
    res.articulos.push(a);
    const e = res.estadisticas;
    e.filas++;
    if (codigo) e.con_codigo++; else e.sin_codigo++;
    if (a.codigo_alterno) e.con_codigo_alterno++;
    if (!a.descripcion) e.descripcion_vacia++;
    if (!a.marca) e.marca_vacia++;
    if (!a.estilo) e.estilo_vacio++;
    if (!a.lote) e.lote_vacio++;
    if (/^system$/i.test(a.departamento)) e.departamento_sin_clasificar++;
    if (a.precio_alterno) e.con_precio_alterno++;
    if (a.etiqueta_costura) e.etiqueta_costura_si++;
    if (a.etiqueta_precio === null) e.etiqueta_precio_vacia++;

    // anomalías por fila
    if (!codigo) anom('sin_codigo', 'revisar', a, 'sin UPC: no se puede escanear; solo se encuentra por Item #, código alterno o texto');
    else {
      if (typeof rawCodigo === 'number') anom('codigo_numerico_posible_truncamiento', 'revisar', a, 'Excel entregó el código como número: pudo perder ceros (no se reconstruyen)');
      if (codigo !== codigo.trim()) anom('codigo_con_espacios', 'revisar', a, 'el código tiene espacios al inicio o al final');
      const l = vistosCodigo.get(codigo);
      if (l) l.push(a); else vistosCodigo.set(codigo, [a]);
    }
    if (item_no === null) anom('item_no_ausente', 'revisar', a, 'sin Item Number: quedará pendiente de asignar');
    else { const l = vistosItemNo.get(item_no); if (l) l.push(a); else vistosItemNo.set(item_no, [a]); }
    if (precioIlegible) { anom('precio_ilegible', 'bloquea_venta', a, `el precio «${texto(rawPrecio)}» no se pudo leer`); e.precio_no_vendible++; }
    else if (precio < 0) { anom('precio_negativo', 'bloquea_venta', a, `precio ${precio / 100}: parece cupón o certificado; requiere un tratamiento propio`); e.precio_no_vendible++; }
    else if (precio === 0) { anom('precio_cero', 'bloquea_venta', a, 'precio 0: no se puede vender con el precio del catálogo'); e.precio_no_vendible++; }
    else if (precio % 100 !== 0) anom('precio_con_centavos', 'info', a, `precio ${precio / 100} con centavos`);
    if (idx.existencia >= 0 && recorte(cel(r, 'existencia')) !== '' && a.existencia === null) anom('existencia_ilegible', 'revisar', a, `existencia «${texto(cel(r, 'existencia'))}» no numérica`);
  }
  // repetidos: se señalan TODAS las filas involucradas
  for (const [no, l] of vistosItemNo) if (l.length > 1) { res.estadisticas.item_no_duplicados++; for (const a of l) anom('item_no_duplicado', 'revisar', a, `el Item # ${no} aparece en ${l.length} filas (códigos: ${l.map((x) => x.codigo || '(sin código)').join(', ')}); no se fusionan ni se renumeran`); }
  for (const [c, l] of vistosCodigo) if (l.length > 1) { res.estadisticas.codigos_duplicados++; for (const a of l) anom('codigo_duplicado', 'revisar', a, `el código ${c} aparece en ${l.length} filas; el POS no adivina cuál es hasta que Administración lo resuelva`); }
  for (const a of res.articulos) if (a.codigo_alterno && vistosCodigo.has(a.codigo_alterno) && vistosCodigo.get(a.codigo_alterno)![0] !== a) anom('alterno_coincide_con_codigo', 'revisar', a, `el código alterno ${a.codigo_alterno} es el UPC de otro artículo`);

  res.departamentos = revisarDepartamentos(res.articulos, deptos);
  res.envolturas = res.articulos.filter(esEnvoltura).length;
  const grupos = new Map<string, Anomalia[]>();
  for (const x of res.anomalias) { const l = grupos.get(x.tipo); if (l) l.push(x); else grupos.set(x.tipo, [x]); }
  res.porTipo = [...grupos].map(([tipo, l]) => ({ tipo, severidad: l[0]!.severidad, cantidad: l.length, ejemplos: l.slice(0, 5) }))
    .sort((x, y) => ({ bloquea_venta: 0, revisar: 1, info: 2 }[x.severidad] - { bloquea_venta: 0, revisar: 1, info: 2 }[y.severidad]) || y.cantidad - x.cantidad);
  return res;
}

export interface OpcionesCarga {
  ahora: string;
  /** Identifica esta importación: los item_id y las operaciones salen de aquí y de la fila de origen. */
  idImportacion: string;
  /** Existencia SINTÉTICA de prueba por tienda (el archivo no trae cantidades). Se registra como `existencia_prueba`, jamás como inicial. */
  existenciaPrueba?: Record<string, number>;
  /** Solo si el archivo trae una columna de existencia: la ubicación la elige quien importa; nunca se infiere. */
  ubicacionExistencia?: string;
}

/** Convierte lo leído en operaciones de catálogo y movimientos trazables. */
export function aOperacionesInventario(articulos: ArticuloImportado[], o: OpcionesCarga): { ops: Op[]; ids: string[] } {
  const ops: Op[] = [];
  const ids: string[] = [];
  for (const a of articulos) {
    const { existencia, ...rest } = a;
    const item_id = `${o.idImportacion}-f${a.fila_origen}`;
    ids.push(item_id);
    ops.push({
      op_id: `item:${item_id}`, tipo: 'item.created', tienda: null, caja: null, origen: `importacion:${o.idImportacion}`, ocurrio_en: o.ahora,
      payload: { ...rest, item_id, origen: `importacion:${o.idImportacion}` },
    });
    if (o.ubicacionExistencia && existencia !== null && existencia !== undefined && existencia !== 0) {
      ops.push({
        op_id: `mov:imp:${item_id}`, tipo: 'inv.movement', tienda: o.ubicacionExistencia, caja: null, origen: `importacion:${o.idImportacion}`, ocurrio_en: o.ahora,
        payload: { item_id, tienda: o.ubicacionExistencia, delta: existencia, tipo: 'existencia_inicial', doc: `importacion:${o.idImportacion}` },
      });
    }
    for (const [tienda, q] of Object.entries(o.existenciaPrueba ?? {})) {
      if (q > 0 && a.precio > 0) {
        ops.push({
          op_id: `mov:prueba:${item_id}:${tienda}`, tipo: 'inv.movement', tienda, caja: null, origen: `importacion:${o.idImportacion}`, ocurrio_en: o.ahora,
          payload: { item_id, tienda, delta: q, tipo: 'existencia_prueba', doc: `prueba_sintetica:${o.idImportacion}` },
        });
      }
    }
  }
  return { ops, ids };
}

// ── exportación ──
export interface Hoja {
  nombre: string;
  encabezados: string[];
  filas: (string | number | boolean | null)[][];
  /** Columnas que deben ir como TEXTO (códigos, lotes, estilos): no pierden ceros ni se vuelven notación científica. */
  textoCols: number[];
  /** Formato numérico por columna (p. ej. precios). */
  formatoCols?: Record<number, string>;
}

export const NOMBRE_TIENDA: Record<string, string> = { DUO: 'DÚO', LON: 'London' };

/**
 * Inventario para Excel. Los encabezados "Marca" y "Descripción" se leen igual con cualquier perfil, así que un archivo
 * exportado se vuelve a importar sin ambigüedad. Los textos se escriben como texto: una celda que empiece con = + - @ no
 * se ejecuta como fórmula.
 */
export function hojaInventario(
  articulos: Articulo[],
  o: { tiendas: string[]; saldo: (tienda: string, itemId: string) => number; verificada: (tienda: string, itemId: string) => boolean },
): Hoja {
  const enc = [
    'Item #', 'Código', 'Marca', 'Descripción', 'Estilo', 'Lote', 'Departamento', 'Precio de venta', 'Precio alterno', 'Código alterno',
    'Etiqueta costura', 'Etiqueta precio',
    ...o.tiendas.map((t) => `Existencia ${NOMBRE_TIENDA[t] ?? t}`), ...o.tiendas.map((t) => `Verificada ${NOMBRE_TIENDA[t] ?? t}`),
  ];
  const si = (b: boolean | null | undefined) => (b === true ? 'Sí' : b === false ? 'No' : '');
  const filas = articulos.map((a) => [
    a.item_no !== null && /^\d+$/.test(a.item_no) ? Number(a.item_no) : (a.item_no ?? ''),
    a.codigo, a.marca, a.descripcion, a.estilo, a.lote, a.departamento,
    a.precio / 100, a.precio_alterno === null || a.precio_alterno === undefined ? '' : a.precio_alterno / 100, a.codigo_alterno ?? '',
    si(a.etiqueta_costura), si(a.etiqueta_precio),
    ...o.tiendas.map((t) => o.saldo(t, a.item_id)), ...o.tiendas.map((t) => (o.verificada(t, a.item_id) ? 'Sí' : 'No')),
  ]);
  return { nombre: 'Inventario', encabezados: enc, filas, textoCols: [1, 2, 3, 4, 5, 6, 9, 10, 11], formatoCols: { 7: '#,##0.00', 8: '#,##0.00' } };
}

/** Detalle de cobros con dólares listo para Excel: importes como texto decimal exacto (sin coma flotante). */
export function hojaDolares(r: import('./consultas.ts').ReporteDolares): Hoja {
  const usd = (c: number) => aMXN(c);
  const encabezados = ['Tienda', 'Caja', 'Folio', 'Fecha', 'Hora', 'Cajero', 'USD recibidos', 'Tipo de cambio (MXN por USD)', 'Versión de la tasa', 'Equivalente MXN (tasa de la operación)', 'Pesos recibidos', 'Cambio entregado MXN', 'Total de la venta MXN', 'Estado'];
  const filas: Hoja['filas'] = r.filas.map((f) => [f.tienda, f.caja, f.folio, f.fecha_local, f.hora, f.cajero, usd(f.usd), formatoTasa(f.tasa), f.tasa_version, aMXN(f.equivalente), aMXN(f.pesos_recibidos), aMXN(f.cambio_mxn), aMXN(f.total_venta), f.estado]);
  filas.push([], ['TOTAL (sin cancelados)', '', '', '', '', '', usd(r.usd), '', '', aMXN(r.equivalente_historico), '', '', '', '']);
  return { nombre: 'Dólares recibidos', encabezados, filas, textoCols: [3, 4, 6, 7, 9, 10, 11, 12] };
}

/** Descuentos del periodo listos para Excel: importes como texto decimal exacto. */
export function hojaDescuentos(r: import('./consultas.ts').ReporteDescuentos): Hoja {
  const pct = (bp: number) => `${(bp / 100).toFixed(2)} %`;
  const tipo = { promo: 'Promoción', cupon: 'Cupón', manual: 'Manual (supervisor)' } as const;
  const encabezados = ['Tienda', 'Caja', 'Folio', 'Fecha', 'Hora', 'Cajero', 'Tipo', 'Concepto', 'Supervisor que autorizó', 'Importe de la venta', 'Descuento', '% de la venta', 'Estado'];
  const filas: Hoja['filas'] = r.filas.map((f) => [f.tienda, f.caja, f.folio, f.fecha_local, f.hora, f.cajero, tipo[f.tipo], f.concepto, f.supervisor ?? '', aMXN(f.importe_venta), aMXN(f.monto), pct(f.pct_bp), f.estado]);
  filas.push([], ['TOTAL (sin cancelados)', '', '', '', '', '', '', '', '', '', aMXN(r.resumen.monto), '', '']);
  return { nombre: 'Descuentos', encabezados, filas, textoCols: [3, 4, 6, 7, 8, 9, 10, 11] };
}
