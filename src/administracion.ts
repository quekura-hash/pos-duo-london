import { ErrorDominio } from './errores.ts';
import type { Central } from './nodos.ts';
import { catalogo, stock, ventas } from './proyecciones.ts';
import type { Actor, Op } from './tipos.ts';

/**
 * Resolución ADMINISTRATIVA de códigos duplicados.
 *
 * Mientras un código esté duplicado, el POS no adivina: escanearlo da CODIGO_AMBIGUO. La elección manual de un
 * candidato por el cajero es un recurso provisional: la línea queda marcada y aparece aquí para revisión.
 * La solución definitiva solo la aplica Administración, con una de dos decisiones explícitas y auditadas:
 *   - reasignar_codigo: uno de los artículos recibe otro código (p. ej. se re-etiqueta físicamente);
 *   - fusionar: Administración declara que son el MISMO artículo; el absorbido queda como alias (no se borra).
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
  const cat = [...catalogo(ops).values()].filter((a) => !a.alias_de);
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
  if (!a || a.alias_de) throw new ErrorDominio('ARTICULO_INEXISTENTE', d.item_id);
  const grupo = [...cat.values()].filter((x) => !x.alias_de && x.codigo === a.codigo);
  if (grupo.length < 2) throw new ErrorDominio('NO_ES_DUPLICADO', `el código ${a.codigo} no está duplicado`);
  if (typeof d.codigo_nuevo !== 'string' || d.codigo_nuevo.length === 0) throw new ErrorDominio('CODIGO_INVALIDO', 'el código es texto no vacío');
  if ([...cat.values()].some((x) => !x.alias_de && x.codigo === d.codigo_nuevo)) throw new ErrorDominio('CODIGO_EXISTE', `${d.codigo_nuevo} ya pertenece a otro artículo`);
  return central.emitirAdmin('item.codigo_corregido', {
    item_id: d.item_id, codigo_anterior: a.codigo, codigo_nuevo: d.codigo_nuevo, motivo: d.motivo, usuario: actor.usuario,
  });
}

export function fusionarArticulos(actor: Actor, central: Central, d: { conservar_id: string; absorber_id: string; motivo: string }): Op {
  exigirAdmin(actor);
  exigirMotivo(d.motivo);
  const ops = central.repo.ops();
  const cat = catalogo(ops);
  const c = cat.get(d.conservar_id);
  const x = cat.get(d.absorber_id);
  if (!c || !x || c.alias_de || x.alias_de) throw new ErrorDominio('ARTICULO_INEXISTENTE', 'ambos artículos deben existir y estar vigentes');
  if (d.conservar_id === d.absorber_id) throw new ErrorDominio('FUSION_INVALIDA', 'no se fusiona un artículo consigo mismo');
  if (c.codigo !== x.codigo) throw new ErrorDominio('NO_ES_DUPLICADO', 'solo se fusionan artículos que comparten código');
  const tiendas = [...new Set(ops.filter((o) => o.tipo === 'inv.movement').map((o) => o.payload.tienda as string))];
  return central.emitirAdmin('item.fusion', {
    conservado_id: d.conservar_id, absorbido_id: d.absorber_id, codigo: c.codigo,
    item_no_absorbido: x.item_no, // el Item # del absorbido no se pierde: queda en el registro de la fusión
    existencias_absorbido_al_fusionar: Object.fromEntries(tiendas.map((t) => [t, stock(ops, t).get(d.absorber_id) ?? 0])),
    motivo: d.motivo, usuario: actor.usuario,
  });
}

export function historialResoluciones(actor: Actor, ops: Op[]) {
  exigirAdmin(actor);
  return ops.filter((o) => o.tipo === 'item.codigo_corregido' || o.tipo === 'item.fusion').map((o) => ({ tipo: o.tipo, ocurrio_en: o.ocurrio_en, ...o.payload }));
}
