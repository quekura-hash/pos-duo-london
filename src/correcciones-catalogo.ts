import { normalizarDepto } from './departamentos.ts';
import { leerInventario, PERFIL_CONFIRMADO, type Perfil } from './inventario.ts';
import type { Articulo, Op } from './tipos.ts';

/**
 * Corrección en bloque de departamento y marca a partir de un Excel que llena el propietario:
 *   Departamento (texto del archivo) | ¿Es marca? | Departamento correcto | Artículos
 * El texto original del departamento NO se guardó al importar (solo el departamento asignado), así que se vuelve a leer del MISMO archivo
 * de inventario: cada artículo se ubica por su fila de origen. Reglas:
 *  - La marca se llena sin importar el departamento actual, pero SOLO si el artículo no tiene marca.
 *  - El departamento solo se cambia en artículos que siguen en «Sin clasificar» (lo ya clasificado o editado se respeta).
 *  - «¿Es marca? = Sí»: el texto pasa a Marca; el departamento se cambia si se eligió uno.
 *  - Sin «Sí»: solo cambia el departamento.
 *  - Renglones sin departamento ni marca: no se toca nada.
 */
export interface FilaCorreccion { texto: string; esMarca: boolean; departamento: string; fila: number }
export interface LecturaCorrecciones { filas: FilaCorreccion[]; errores: string[] }

const t = (v: unknown) => (v === null || v === undefined ? '' : String(v).trim());
const sinAcentos = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '');
const SI = new Set(['si', 'yes', 'true', '1', 'x']);

/** Lee la hoja de correcciones (encabezados en la primera fila; el orden de las columnas no importa). */
export function leerCorrecciones(filas: unknown[][]): LecturaCorrecciones {
  const out: LecturaCorrecciones = { filas: [], errores: [] };
  const enc = (filas[0] ?? []).map((h) => sinAcentos(t(h)).toLowerCase());
  const iTexto = enc.findIndex((h) => h.startsWith('departamento (texto'));
  const iMarca = enc.findIndex((h) => h.includes('es marca'));
  const iDepto = enc.findIndex((h) => h.includes('departamento correcto'));
  if (iTexto < 0 || iMarca < 0 || iDepto < 0) {
    out.errores.push('No parece el archivo de correcciones: faltan las columnas «Departamento (texto en el archivo)», «¿Es marca?» y «Departamento correcto».');
    return out;
  }
  filas.slice(1).forEach((r, i) => {
    const texto = t(r[iTexto]);
    if (!texto) return;
    out.filas.push({ texto: texto === '(vacío)' ? '' : texto, esMarca: SI.has(sinAcentos(t(r[iMarca])).toLowerCase()), departamento: t(r[iDepto]), fila: i + 2 });
  });
  return out;
}

export interface ResumenCorrecciones {
  renglones: number;
  /** Renglones sin nada elegido (se dejan como están). */
  sinDecision: number;
  articulosCambiados: number;
  marcasPuestas: number;
  departamentosCambiados: number;
  /** Artículos cuyo departamento se quería cambiar pero ya no estaban en «Sin clasificar»: se respeta el que tienen. */
  yaClasificados: number;
  /** Artículos de marca con marca propia: se conserva la que tienen. */
  conMarcaPropia: number;
  /** Renglones con un departamento que no existe o está desactivado (no se aplican). */
  deptosInvalidos: { fila: number; texto: string; departamento: string }[];
  /** Renglones cuyo texto no aparece en el archivo original (¿es otro archivo?). */
  sinCoincidencia: { fila: number; texto: string }[];
  /** Artículos del archivo original que ya no están en el catálogo del central. */
  noEncontrados: number;
}

export interface PlanCorrecciones { ops: Op[]; resumen: ResumenCorrecciones }

/** Texto corto estable (no criptográfico) para que repetir la misma corrección no duplique operaciones. */
const huella = (s: string) => { let h = 5381; for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0; return h.toString(36); };

export function planCorrecciones(o: {
  correcciones: FilaCorreccion[];
  /** Filas del Excel de inventario ORIGINAL (con encabezados), el mismo que se importó. */
  inventarioOriginal: unknown[][];
  perfil?: Perfil;
  catalogo: Articulo[];
  deptosActivos: string[];
  idImportacion?: string;
  por: string;
  ahora: string;
}): PlanCorrecciones {
  const id = o.idImportacion ?? 'imp1';
  const lectura = leerInventario(o.inventarioOriginal, o.perfil ?? PERFIL_CONFIRMADO);
  const porId = new Map(o.catalogo.map((a) => [a.item_id, a]));
  const activos = new Set(o.deptosActivos);
  const grupos = new Map<string, number[]>(); // texto normalizado -> filas de origen
  for (const a of lectura.articulos) {
    const k = normalizarDepto(a.departamento);
    (grupos.get(k) ?? grupos.set(k, []).get(k)!).push(a.fila_origen);
  }
  const resumen: ResumenCorrecciones = { renglones: o.correcciones.length, sinDecision: 0, articulosCambiados: 0, marcasPuestas: 0, departamentosCambiados: 0, yaClasificados: 0, conMarcaPropia: 0, deptosInvalidos: [], sinCoincidencia: [], noEncontrados: 0 };
  const cambios = new Map<string, Record<string, { antes: unknown; despues: unknown }>>();
  for (const c of o.correcciones) {
    if (!c.esMarca && !c.departamento) { resumen.sinDecision++; continue; }
    if (c.departamento && !activos.has(c.departamento)) { resumen.deptosInvalidos.push({ fila: c.fila, texto: c.texto, departamento: c.departamento }); continue; }
    const filas = grupos.get(normalizarDepto(c.texto));
    if (!filas) { resumen.sinCoincidencia.push({ fila: c.fila, texto: c.texto }); continue; }
    for (const f of filas) {
      const a = porId.get(`${id}-f${f}`);
      if (!a) { resumen.noEncontrados++; continue; }
      const previo = cambios.get(a.item_id) ?? {};
      const nuevo = { ...previo };
      if (c.esMarca) {
        if (a.marca.trim()) resumen.conMarcaPropia++;
        else nuevo.marca = { antes: a.marca, despues: c.texto };
      }
      if (c.departamento) {
        if (a.departamento !== 'Sin clasificar') resumen.yaClasificados++;
        else if (c.departamento !== a.departamento) nuevo.departamento = { antes: a.departamento, despues: c.departamento };
      }
      if (Object.keys(nuevo).length) cambios.set(a.item_id, nuevo);
    }
  }
  const ops: Op[] = [];
  for (const [item_id, c] of cambios) {
    if (c.marca) resumen.marcasPuestas++;
    if (c.departamento) resumen.departamentosCambiados++;
    resumen.articulosCambiados++;
    ops.push({
      op_id: `item.editado:corr:${item_id}:${huella(JSON.stringify(c))}`, tipo: 'item.editado', tienda: null, caja: null, origen: 'central', ocurrio_en: o.ahora,
      payload: { item_id, cambios: c, por: o.por, motivo: 'correccion_en_bloque' },
    });
  }
  return { ops, resumen };
}
