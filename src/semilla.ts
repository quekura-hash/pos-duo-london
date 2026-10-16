import type { Articulo, Op } from './tipos.ts';

/** Operaciones de migración inicial sintética: catálogo y existencia inicial como movimientos trazables. */
export function opsSemilla(
  items: Omit<Articulo, 'item_id' | 'origen'>[],
  existencias: Record<string, number>[],
  ahora: string,
): { articulos: Articulo[]; ops: Op[] } {
  const articulos: Articulo[] = items.map((x, i) => ({ ...x, item_id: `seed${i + 1}`, origen: 'migracion' }));
  const ops: Op[] = [];
  articulos.forEach((a, i) => {
    ops.push({ op_id: `item:${a.item_id}`, tipo: 'item.created', tienda: null, caja: null, origen: 'migracion', ocurrio_en: ahora, payload: a });
    for (const [t, q] of Object.entries(existencias[i] ?? {})) {
      ops.push({
        op_id: `seed:mov:${a.item_id}:${t}`, tipo: 'inv.movement', tienda: t, caja: null, origen: 'migracion', ocurrio_en: ahora,
        payload: { item_id: a.item_id, tienda: t, delta: q, tipo: 'existencia_inicial', doc: 'migracion' },
      });
    }
  });
  return { articulos, ops };
}
