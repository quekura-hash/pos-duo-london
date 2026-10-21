// Detalle de UNA venta para la ventana de «Historial» (caja y Administración): hora, cajera, prendas, pagos y todo lo que le pasó después
// (cambios, devoluciones y cancelación, con los datos de la clienta y el motivo). Código PURO sobre la bitácora.
import { ErrorDominio } from './errores.ts';
import { devoluciones, devueltoPorLinea, ventas } from './proyecciones.ts';
import type { Op, Pago } from './tipos.ts';
import { fechaLocal } from './util.ts';

export interface DatosClienta { nombre: string; telefono: string }

export interface DetalleVenta {
  sale_id: string;
  tienda: string;
  caja: number;
  folio: number;
  ocurrio_en: string;
  fecha_local: string;
  /** HH:MM, hora de Hermosillo. */
  hora: string;
  cajero: string;
  vendedora: string;
  estado: 'confirmada' | 'cancelada';
  total: number;
  lineas: { linea_id: string; qty: number; devuelto: number; descripcion: string; marca: string; estilo: string; item_no: string | null; codigo: string; precio_unit: number; descuento: number; importe: number; tarjeta_regalo: boolean }[];
  pagos: Pago[];
  /** Solo si la venta se canceló. */
  cancelacion: null | { ocurrio_en: string; motivo: string; cancelo: string; autorizado_por: string | null; clienta: DatosClienta | null };
  /** Cambios y devoluciones que ya tuvo la venta. */
  devoluciones: { folio: number | null; ocurrio_en: string; importe: number; motivo: string; por_cambio: boolean; cajero: string; autorizado_por: string | null; clienta: DatosClienta | null; piezas: number }[];
  /** ¿Se puede cancelar completa? (confirmada, sin tarjetas de regalo y sin devoluciones previas). */
  cancelable: boolean;
  /** ¿Quedan piezas por cambiar o devolver? */
  con_piezas_disponibles: boolean;
}

const hora = (iso: string) => new Date(Date.parse(iso) - 7 * 3600_000).toISOString().slice(11, 16);

export function detalleDeVenta(ops: Op[], saleId: string): DetalleVenta | null {
  const v = ventas(ops).get(saleId);
  if (!v) return null;
  const dev = devueltoPorLinea(ops, saleId);
  const devs = devoluciones(ops).filter((d) => d.sale_id === saleId);
  const canc = ops.find((o) => o.tipo === 'sale.cancelled' && o.payload.sale_id === saleId);
  const lineas = v.lineas.map((l) => ({
    linea_id: l.linea_id, qty: l.qty, devuelto: dev.get(l.linea_id)?.qty ?? 0, descripcion: l.descripcion, marca: l.marca, estilo: l.estilo, item_no: l.item_no, codigo: l.codigo,
    precio_unit: l.precio_unit, descuento: l.descuento, importe: l.importe, tarjeta_regalo: !!l.tarjeta_regalo,
  }));
  const conTarjetaRegalo = lineas.some((l) => l.tarjeta_regalo);
  return {
    sale_id: v.sale_id, tienda: v.tienda, caja: v.caja, folio: v.folio, ocurrio_en: v.ocurrio_en, fecha_local: fechaLocal(v.ocurrio_en), hora: hora(v.ocurrio_en),
    cajero: v.cajero, vendedora: v.vendedora ?? '', estado: v.estado, total: v.total, lineas, pagos: v.pagos,
    cancelacion: canc
      ? { ocurrio_en: canc.ocurrio_en, motivo: String(canc.payload.motivo ?? ''), cancelo: String(canc.payload.cancelo ?? ''), autorizado_por: canc.payload.autorizado_por ?? null, clienta: canc.payload.clienta ?? null }
      : null,
    devoluciones: devs.map((d) => ({
      folio: d.folio ?? null, ocurrio_en: d.ocurrio_en, importe: d.importe, motivo: d.por_cambio && d.motivo_cambio ? d.motivo_cambio : d.motivo, por_cambio: !!d.por_cambio, cajero: d.cajero,
      autorizado_por: d.autorizado_por ?? null, clienta: d.clienta ?? null, piezas: d.lineas.reduce((a, l) => a + l.qty, 0),
    })),
    cancelable: v.estado === 'confirmada' && !conTarjetaRegalo && devs.length === 0,
    con_piezas_disponibles: v.estado === 'confirmada' && lineas.some((l) => !l.tarjeta_regalo && l.qty - l.devuelto > 0),
  };
}

/** Nombre, teléfono y motivo que se piden al revertir una venta o hacer un cambio. Falla con un mensaje claro si falta algo. */
export function validarDatosClienta(d: { clienta?: Partial<DatosClienta> | null; motivo?: string } | undefined): { clienta: DatosClienta; motivo: string } {
  const nombre = String(d?.clienta?.nombre ?? '').trim().replace(/\s+/g, ' ');
  const telefono = String(d?.clienta?.telefono ?? '').trim();
  const motivo = String(d?.motivo ?? '').trim().replace(/\s+/g, ' ');
  if (nombre.length < 2) throw new ErrorDominio('DATOS_REQUERIDOS', 'escriba el nombre de la clienta');
  if (telefono.replace(/\D/g, '').length < 7) throw new ErrorDominio('DATOS_REQUERIDOS', 'escriba el teléfono de la clienta (al menos 7 dígitos)');
  if (motivo.length < 3) throw new ErrorDominio('DATOS_REQUERIDOS', 'escriba el motivo');
  return { clienta: { nombre: nombre.slice(0, 80), telefono: telefono.slice(0, 30) }, motivo: motivo.slice(0, 300) };
}
