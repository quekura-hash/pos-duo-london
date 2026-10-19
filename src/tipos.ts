// Tipos compartidos. Importes siempre en centavos enteros (MXN).

/** `efectivo_usd` = efectivo recibido en dólares (y, si hay, pesos): liquida un solo importe en MXN y guarda el detalle físico. */
/** Almacén virtual del catálogo inicial: su existencia se descuenta directamente al vender en cualquier tienda o caja. */
export const LIMBO = 'LIMBO';
export const NOMBRE_LIMBO = 'El Limbo';
export type Metodo = 'efectivo' | 'efectivo_usd' | 'tarjeta' | 'tarjeta_regalo' | 'credito_cambio';

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
  /** Solo tarjeta de regalo: código de la tarjeta y saldo que le queda después de este pago. */
  tarjeta?: string;
  saldo_despues?: number;
  // ── Solo `efectivo_usd` (todo en enteros: dólares y pesos en centavos, tasa en diezmilésimas) ──
  /** Dólares físicos recibidos, en centavos de dólar. */
  usd?: number;
  /** Tipo de cambio aplicado (MXN por 1 USD ×10000) y la versión de la configuración de donde salió. */
  tasa?: number;
  tasa_version?: number;
  /** Equivalente en MXN de los dólares recibidos a esa tasa (redondeo al centavo, mitad hacia arriba). */
  equivalente?: number;
  /** Pesos físicos recibidos junto con los dólares (puede ser 0). */
  pesos_recibidos?: number;
  /** Cambio entregado en PESOS por todo el efectivo de este cobro. */
  cambio_mxn?: number;
  /** Solo `credito_cambio`: folio de la venta cuyas piezas regresó la clienta; su importe liquida parte de esta venta. */
  folio_origen?: number;
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
  /** De dónde sale `descuento`: manual (autorizado por un supervisor), promoción o cupón. `descuento` es la suma. */
  descuento_detalle?: { tipo: 'manual' | 'promo' | 'cupon'; ref: string; nombre: string; monto: number }[];
  /** Vendida mientras su código estaba duplicado: la elección fue provisional y queda para revisión administrativa. */
  ambiguo?: { codigo: string; candidatos: string[] };
  /** Renglón de venta o recarga de una tarjeta de regalo: no es mercancía (sin inventario ni existencia). */
  tarjeta_regalo?: { codigo: string; tipo: 'alta' | 'recarga' };
  /** Precio o descripción editados SOLO en esta venta (el catálogo no cambia): el precio de lista, la descripción original y el supervisor que autorizó el cambio de precio. */
  editado?: { precio_lista: number; descripcion_original: string; autorizo?: string };
  /** Piezas de este renglón que salieron de El Limbo al vender (el resto salió de la existencia de la tienda). */
  de_limbo?: number;
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
  /** Quién atendió la venta: `vendedora_id` null y `vendedora` «Autocompra» = nadie ayudó a la clienta. Ausentes en ventas anteriores. */
  vendedora_id?: string | null;
  vendedora?: string;
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
  // ── campos que traen los archivos de Excel de inventario (se conservan; ninguno es identidad) ──
  /** "Alternate Lookup": segundo código de búsqueda. NO es la identidad del artículo. */
  codigo_alterno?: string | null;
  /** "Custom Price 1": nivel de precio alterno (centavos). No se usa para vender. */
  precio_alterno?: number | null;
  /** "Etiqt-Costura" / "Etiqt- precio": valores tal como vienen; null = sin dato. */
  etiqueta_costura?: boolean | null;
  etiqueta_precio?: boolean | null;
  pedimento?: string | null;
  codigo_2?: string | null;
  /** Fila (Excel) de donde se importó, para rastrear una anomalía hasta el archivo. */
  fila_origen?: number | null;
}

export interface CajaCfg {
  tienda: string;
  caja: number;
  metodos: Metodo[];
}

export type Actor =
  | { rol: 'cajero'; usuario: string; tienda: string; caja: number }
  | { rol: 'admin'; usuario: string };
