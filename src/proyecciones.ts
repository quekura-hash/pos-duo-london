import type { Articulo, Op, Venta } from './tipos.ts';

// Proyecciones puras sobre la bitácora. El estado derivado nunca se sincroniza: se recalcula.

export function catalogo(ops: Op[]): Map<string, Articulo> {
  const m = new Map<string, Articulo>();
  for (const o of ops) {
    if (o.tipo === 'item.created') m.set(o.payload.item_id, { ...o.payload });
  }
  for (const o of ops) {
    if (o.tipo === 'item.item_no_assigned') {
      const a = m.get(o.payload.item_id);
      if (a && a.item_no == null) a.item_no = o.payload.item_no;
    }
  }
  return m;
}

/** Existencia = suma de movimientos de la tienda. Nunca "último saldo recibido". */
export function stock(ops: Op[], tienda: string): Map<string, number> {
  const m = new Map<string, number>();
  for (const o of ops) {
    if (o.tipo === 'inv.movement' && o.payload.tienda === tienda) {
      m.set(o.payload.item_id, (m.get(o.payload.item_id) ?? 0) + o.payload.delta);
    }
  }
  return m;
}

export function ventas(ops: Op[]): Map<string, Venta> {
  const m = new Map<string, Venta>();
  for (const o of ops) {
    if (o.tipo === 'sale.confirmed') {
      const p = o.payload;
      m.set(p.sale_id, {
        sale_id: p.sale_id, tienda: p.tienda, caja: p.caja, folio: p.folio, cajero: p.cajero,
        ocurrio_en: o.ocurrio_en, lineas: p.lineas, total: p.total, pagos: p.pagos, estado: 'confirmada',
      });
    }
  }
  for (const o of ops) {
    if (o.tipo === 'sale.cancelled') {
      const v = m.get(o.payload.sale_id);
      if (v) v.estado = 'cancelada';
    }
  }
  return m;
}

export interface Devolucion {
  devolucion_id: string;
  sale_id: string;
  tienda: string; // tienda que devuelve
  caja: number; // caja que entrega el dinero
  lineas: { linea_id: string; item_id: string; qty: number; importe: number }[];
  importe: number;
  metodo: 'efectivo';
  ocurrio_en: string;
  motivo: string;
}

export function devoluciones(ops: Op[]): Devolucion[] {
  return ops
    .filter((o) => o.tipo === 'return.registered')
    .map((o) => ({ ...o.payload, ocurrio_en: o.ocurrio_en }));
}

export function devueltoPorLinea(ops: Op[], saleId: string): Map<string, { qty: number; importe: number }> {
  const m = new Map<string, { qty: number; importe: number }>();
  for (const d of devoluciones(ops)) {
    if (d.sale_id !== saleId) continue;
    for (const l of d.lineas) {
      const a = m.get(l.linea_id) ?? { qty: 0, importe: 0 };
      a.qty += l.qty;
      a.importe += l.importe;
      m.set(l.linea_id, a);
    }
  }
  return m;
}

export interface Intento {
  intent_id: string;
  cart_id: string;
  tienda: string;
  caja: number;
  importe: number;
  estado: 'iniciado' | 'desconocido' | 'aprobado' | 'no_cobrado';
  autorizacion?: string;
}

export function intentos(ops: Op[]): Map<string, Intento> {
  const m = new Map<string, Intento>();
  for (const o of ops) {
    if (o.tipo === 'card.intent') m.set(o.payload.intent_id, { ...o.payload, estado: 'iniciado' });
    if (o.tipo === 'card.intent_resuelto') {
      const i = m.get(o.payload.intent_id);
      if (i) {
        i.estado = o.payload.resultado;
        if (o.payload.autorizacion) i.autorizacion = o.payload.autorizacion;
      }
    }
  }
  return m;
}
