import type { Op } from './tipos.ts';
import { catalogo, devoluciones, intentos, perdidasDocumentales, stock, ventas } from './proyecciones.ts';

export interface Incidencia {
  tipo: string;
  [k: string]: unknown;
}

/**
 * Detección POSTERIOR de conflictos de negocio sobre una bitácora (hub o central).
 * La deduplicación por op_id no los ve: son operaciones distintas y legítimas por separado.
 * Las operaciones nunca se descartan ni se modifican; solo se señalan.
 */
export function detectar(ops: Op[]): Incidencia[] {
  const out: Incidencia[] = [];

  // folio duplicado en una misma serie (nunca debe ocurrir)
  const porFolio = new Map<string, Set<string>>();
  for (const o of ops) {
    if (o.tipo !== 'sale.confirmed') continue;
    const k = `${o.payload.tienda}/${o.payload.caja}#${o.payload.folio}`;
    (porFolio.get(k) ?? porFolio.set(k, new Set()).get(k)!).add(o.payload.sale_id);
  }
  for (const [k, s] of porFolio) if (s.size > 1) out.push({ tipo: 'folio_duplicado', serie_folio: k, ventas: [...s] });

  // huecos de folio no explicados por un folio.gap documentado
  const series = new Map<string, number[]>();
  for (const o of ops) {
    if (o.tipo !== 'sale.confirmed') continue;
    const k = `${o.payload.tienda}/${o.payload.caja}`;
    (series.get(k) ?? series.set(k, []).get(k)!).push(o.payload.folio);
  }
  const gaps = ops.filter((o) => o.tipo === 'folio.gap').map((o) => o.payload);
  for (const [k, folios] of series) {
    const orden = [...new Set(folios)].sort((a, b) => a - b);
    let prev = 0;
    for (const f of orden) {
      for (let x = prev + 1; x < f; x++) {
        const explicado = gaps.some((g) => `${g.tienda}/${g.caja}` === k && x >= g.desde && x <= g.hasta);
        if (!explicado) out.push({ tipo: 'folio_hueco_sin_explicar', serie: k, folio: x });
      }
      prev = f;
    }
  }

  // devoluciones que exceden lo vendido (p. ej. dos cajas aisladas devolvieron lo mismo)
  const v = ventas(ops);
  const devuelto = new Map<string, number>();
  for (const d of devoluciones(ops)) {
    for (const l of d.lineas) {
      const k = `${d.sale_id}|${l.linea_id}`;
      devuelto.set(k, (devuelto.get(k) ?? 0) + l.qty);
    }
  }
  for (const [k, qty] of devuelto) {
    const [saleId, lineaId] = k.split('|');
    const linea = v.get(saleId!)?.lineas.find((l) => l.linea_id === lineaId);
    if (linea && qty > linea.qty) {
      out.push({ tipo: 'devolucion_excede_vendido', sale_id: saleId, linea_id: lineaId, vendido: linea.qty, devuelto: qty });
    }
  }

  // existencia negativa por tienda
  const tiendas = new Set(ops.filter((o) => o.tipo === 'inv.movement').map((o) => o.payload.tienda as string));
  for (const t of tiendas) {
    for (const [item, saldo] of stock(ops, t)) if (saldo < 0) out.push({ tipo: 'stock_negativo', tienda: t, item_id: item, saldo });
  }

  // identidad de artículos: se reportan, NUNCA se fusionan
  const cat = [...catalogo(ops).values()];
  const porCodigo = new Map<string, string[]>();
  for (const a of cat) (porCodigo.get(a.codigo) ?? porCodigo.set(a.codigo, []).get(a.codigo)!).push(a.item_id);
  for (const [codigo, ids] of porCodigo) if (ids.length > 1) out.push({ tipo: 'codigo_duplicado', codigo, item_ids: ids });
  const porNo = new Map<string, string[]>();
  for (const a of cat) if (a.item_no != null) (porNo.get(a.item_no) ?? porNo.set(a.item_no, []).get(a.item_no)!).push(a.item_id);
  for (const [item_no, ids] of porNo) if (ids.length > 1) out.push({ tipo: 'item_no_duplicado', item_no, item_ids: ids });

  // cobros con tarjeta sin resolver
  for (const i of intentos(ops).values()) {
    if (i.estado === 'iniciado' || i.estado === 'desconocido') out.push({ tipo: 'cobro_tarjeta_pendiente', intent_id: i.intent_id, estado: i.estado });
  }

  for (const p of perdidasDocumentales(ops)) if (p.estado === 'abierta') out.push({ tipo: 'perdida_documental_abierta', perdida_id: p.perdida_id, tienda: p.tienda, caja: p.caja, folios_sin_evidencia: p.folios_sin_evidencia });
  for (const o of ops) if (o.tipo === 'op.rechazada') out.push({ tipo: 'op_rechazada', op_id: o.payload.op_id, motivo: o.payload.motivo });
  return out;
}

/** Conciliación contra el lote de la terminal bancaria (datos capturados del comprobante/lote). */
export function conciliarLote(
  lote: { autorizacion: string; importe: number; tienda: string; caja: number }[],
  ops: Op[],
): Incidencia[] {
  const out: Incidencia[] = [];
  const pagos: { autorizacion: string; importe: number; tienda: string; caja: number; sale_id: string }[] = [];
  for (const v of ventas(ops).values()) {
    for (const p of v.pagos) if (p.metodo === 'tarjeta') pagos.push({ autorizacion: p.autorizacion ?? '', importe: p.monto, tienda: v.tienda, caja: v.caja, sale_id: v.sale_id });
  }
  for (const l of lote) {
    if (!pagos.some((p) => p.autorizacion === l.autorizacion && p.importe === l.importe)) out.push({ tipo: 'cobro_sin_venta', ...l });
  }
  for (const p of pagos) {
    if (!lote.some((l) => l.autorizacion === p.autorizacion && l.importe === p.importe)) out.push({ tipo: 'venta_sin_cobro_en_lote', ...p });
  }
  return out;
}
