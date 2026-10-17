// Tipos compartidos. Importes siempre en centavos enteros (MXN).

export type Metodo = 'efectivo' | 'tarjeta';

export interface Op {
  op_id: string;
  tipo: string;
  tienda: string | null;
  caja: number | null;
  origen: string;
  ocurrio_en: string; // ISO UTC
  payload: any;
}

export interface Pago {
  metodo: Metodo;
  /** Importe APLICADO a la venta (en efectivo: lo que queda en caja, ya sin el cambio). */
  monto: number;
  /** Solo efectivo: lo que entregó el cliente y el cambio devuelto. */
  recibido?: number;
  cambio?: number;
  autorizacion?: string;
  marca?: string;
  ultimos4?: string;
}

export interface Linea {
  linea_id: string;
  item_id: string;
  /** Fotografía del artículo al momento de la venta: el ticket no cambia si después se edita el catálogo. */
  item_no: string | null;
  codigo: string;
  descripcion: string;
  marca: string;
  estilo: string;
  lote: string;
  departamento: string;
  qty: number;
  precio_unit: number;
  descuento: number;
  importe: number;
  /** Vendida mientras su código estaba duplicado: la elección fue provisional y queda para revisión administrativa. */
  ambiguo?: { codigo: string; candidatos: string[] };
}

export interface Venta {
  sale_id: string;
  tienda: string;
  caja: number;
  folio: number;
  cajero: string;
  ocurrio_en: string;
  lineas: Linea[];
  total: number;
  pagos: Pago[];
  estado: 'confirmada' | 'cancelada';
  /** Avisos del arbitraje del hub al confirmar (p. ej. sobreventa). No forman parte de la operación persistida. */
  avisos?: string[];
}

export interface Articulo {
  item_id: string;
  codigo: string; // texto: conserva ceros iniciales
  item_no: string | null; // null = pendiente de asignar
  marca: string;
  descripcion: string;
  estilo: string; // texto ("726-")
  lote: string; // texto ("20260913"), nunca fecha ni talla
  departamento: string;
  precio: number;
  origen: string;
}

export interface CajaCfg {
  tienda: string;
  caja: number;
  metodos: Metodo[];
}

export type Actor =
  | { rol: 'cajero'; usuario: string; tienda: string; caja: number }
  | { rol: 'admin'; usuario: string };
