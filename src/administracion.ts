import { ErrorDominio } from './errores.ts';
import type { Central } from './nodos.ts';
import { catalogo, perdidasDocumentales, stock, ventas } from './proyecciones.ts';
import type { Actor, Op } from './tipos.ts';

/**
 * Resolución ADMINISTRATIVA de códigos duplicados.
 *
 * Mientras un código esté duplicado, el POS no adivina: escanearlo da CODIGO_AMBIGUO. La elección manual de un
 * candidato por el cajero es un recurso provisional: la línea queda marcada y aparece aquí para revisión.
 * La solución definitiva solo la aplica Administración, con una decisión explícita y auditada:
 *   - reasignar_codigo: uno de los artículos recibe otro código (p. ej. se re-etiquetó físicamente).
 * La FUSIÓN de artículos NO está aprobada y NO se implementa: dos registros con el mismo código se corrigen
 * cambiando uno de ellos, nunca declarándolos el mismo artículo.
 * Los tickets históricos conservan el item_id con el que se vendieron.
 */

function exigirAdmin(actor: Actor) {
  if (actor.rol !== 'admin') throw new ErrorDominio('PROHIBIDO', 'la resolución de códigos duplicados es solo de Administración');
}

export interface ArticuloEnConflicto {
  item_id: string;
  item_no: string | null;
  marca: string;
  descripcion: string;
  estilo: string;
  lote: string;
  origen: string;
  existencias: Record<string, number>;
  lineas_vendidas: number;
}
export interface CodigoDuplicado {
  codigo: string;
  articulos: ArticuloEnConflicto[];
  ventas_con_eleccion_provisional: { sale_id: string; tienda: string; caja: number; folio: number; linea_id: string; item_id: string }[];
}

export function codigosDuplicados(actor: Actor, ops: Op[]): CodigoDuplicado[] {
  exigirAdmin(actor);
  const cat = [...catalogo(ops).values()];
  const porCodigo = new Map<string, typeof cat>();
  for (const a of cat) (porCodigo.get(a.codigo) ?? porCodigo.set(a.codigo, []).get(a.codigo)!).push(a);
  const tiendas = [...new Set(ops.filter((o) => o.tipo === 'inv.movement').map((o) => o.payload.tienda as string))];
  const vs = [...ventas(ops).values()];
  const out: CodigoDuplicado[] = [];
  for (const [codigo, arts] of porCodigo) {
    if (arts.length < 2) continue;
    out.push({
      codigo,
      articulos: arts.map((a) => ({
        item_id: a.item_id, item_no: a.item_no, marca: a.marca, descripcion: a.descripcion, estilo: a.estilo, lote: a.lote, origen: a.origen,
        existencias: Object.fromEntries(tiendas.map((t) => [t, stock(ops, t).get(a.item_id) ?? 0]).filter(([, q]) => q !== 0)),
        lineas_vendidas: vs.reduce((n, v) => n + v.lineas.filter((l) => l.item_id === a.item_id).length, 0),
      })),
      ventas_con_eleccion_provisional: vs.flatMap((v) =>
        v.lineas.filter((l) => l.ambiguo?.codigo === codigo).map((l) => ({ sale_id: v.sale_id, tienda: v.tienda, caja: v.caja, folio: v.folio, linea_id: l.linea_id, item_id: l.item_id })),
      ),
    });
  }
  return out;
}

function exigirMotivo(motivo: string) {
  if (!motivo?.trim()) throw new ErrorDominio('MOTIVO_REQUERIDO', 'toda resolución exige motivo');
}

export function reasignarCodigo(actor: Actor, central: Central, d: { item_id: string; codigo_nuevo: string; motivo: string }): Op {
  exigirAdmin(actor);
  exigirMotivo(d.motivo);
  const ops = central.repo.ops();
  const cat = catalogo(ops);
  const a = cat.get(d.item_id);
  if (!a) throw new ErrorDominio('ARTICULO_INEXISTENTE', d.item_id);
  const grupo = [...cat.values()].filter((x) => x.codigo === a.codigo);
  if (grupo.length < 2) throw new ErrorDominio('NO_ES_DUPLICADO', `el código ${a.codigo} no está duplicado`);
  if (typeof d.codigo_nuevo !== 'string' || d.codigo_nuevo.length === 0) throw new ErrorDominio('CODIGO_INVALIDO', 'el código es texto no vacío');
  if ([...cat.values()].some((x) => x.codigo === d.codigo_nuevo)) throw new ErrorDominio('CODIGO_EXISTE', `${d.codigo_nuevo} ya pertenece a otro artículo`);
  return central.emitirAdmin('item.codigo_corregido', {
    item_id: d.item_id, codigo_anterior: a.codigo, codigo_nuevo: d.codigo_nuevo, motivo: d.motivo, usuario: actor.usuario,
  });
}

export function historialResoluciones(actor: Actor, ops: Op[]) {
  exigirAdmin(actor);
  return ops.filter((o) => o.tipo === 'item.codigo_corregido').map((o) => ({ tipo: o.tipo, ocurrio_en: o.ocurrio_en, ...o.payload }));
}

/** Pérdidas documentales (ventas, pagos, folios) abiertas o declaradas. Independientes del inventario. */
export function consultarPerdidasDocumentales(actor: Actor, ops: Op[]) {
  exigirAdmin(actor);
  return perdidasDocumentales(ops);
}

/**
 * Decisión administrativa sobre una pérdida documental. NO es un conteo ni restablece ventas, pagos ni folios: solo deja
 * constancia, con evidencia, de que se acepta que esa documentación no se pudo recuperar. La reconstrucción de ventas a
 * partir de tickets/comprobantes es un procedimiento aparte (no aprobado ni implementado).
 */
export function declararPerdidaIrrecuperable(actor: Actor, central: Central, d: { perdida_id: string; evidencia: { tipo: string; referencia: string }; nota: string }): Op {
  exigirAdmin(actor);
  const p = perdidasDocumentales(central.repo.ops()).find((x) => x.perdida_id === d.perdida_id);
  if (!p) throw new ErrorDominio('PERDIDA_INEXISTENTE', d.perdida_id);
  if (p.estado !== 'abierta') throw new ErrorDominio('PERDIDA_YA_RESUELTA', d.perdida_id);
  if (!d.evidencia?.referencia?.trim() || !d.evidencia?.tipo?.trim()) throw new ErrorDominio('EVIDENCIA_REQUERIDA', 'se requiere tipo y referencia de la evidencia');
  exigirMotivo(d.nota);
  return central.emitirAdmin('doc.perdida_resuelta', {
    perdida_id: d.perdida_id, tienda: p.tienda, caja: p.caja, modo: 'declarada_irrecuperable', evidencia: d.evidencia, nota: d.nota,
    usuario: actor.usuario, aviso: 'no restablece ventas, pagos ni folios; no modifica existencias',
  });
}
