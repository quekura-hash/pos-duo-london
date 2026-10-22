import type { Devolucion } from './proyecciones.ts';
import type { RetiroRegistrado } from './retiros.ts';
import type { Venta } from './tipos.ts';
import { formatoTasa } from './dinero.ts';
import { fechaLocal } from './util.ts';

/** MXN desde centavos enteros, sin coma flotante: 123450 -> "$1,234.50". */
export function formatoMXN(centavos: number): string {
  const neg = centavos < 0;
  const a = Math.abs(centavos);
  const ent = String(Math.floor(a / 100)).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${neg ? '-' : ''}$${ent}.${String(a % 100).padStart(2, '0')}`;
}

/** USD desde centavos de dólar: 5000 -> "US$50.00". */
export function formatoUSD(centavos: number): string {
  return `US${formatoMXN(centavos)}`;
}

export interface NegocioCfg {
  nombre: string;
  /** Letra que identifica la tienda en el código del ticket. */
  letra: string;
  /** Datos de la tienda que salen en el encabezado del ticket (editables en Administración → Configuración → Tiendas). */
  razon_social?: string;
  rfc?: string;
  direccion?: string;
  ciudad?: string;
  telefono?: string;
  /** Leyendas al pie, CONFIGURABLES. "No hacemos devoluciones de efectivo" es un aviso al cliente, no un bloqueo del programa. */
  leyendas: string[];
  /** Caracteres por renglón. 48 = papel de 80 mm con la fuente A de la Epson TM-T20II (576 puntos); 42 dejaba un margen vacío a la derecha. */
  columnas: number;
}

/** Política de devolución de DÚO (del ticket vigente; se edita en Administración). */
export const POLITICA_DUO = [
  'PÓLIZA DE DEVOLUCIÓN',
  'Las prendas y/o artículos tienen una garantía de (5) días a partir de la compra en defectos de fabricación, siempre y cuando no haya sido usada.',
  '***NO HAY CAMBIOS SIN RECIBO***',
  'No hacemos devoluciones de efectivo',
  'EN VESTIDOS Y ACCESORIOS DE NOCHE NO HAY CAMBIOS NI DEVOLUCIONES SIN EXCEPCIÓN',
];
export const NEGOCIOS: Record<string, NegocioCfg> = {
  DUO: {
    nombre: 'DÚO New York', letra: 'D', columnas: 48, leyendas: POLITICA_DUO,
    razon_social: 'KARINA PALAFOX VILLALOBOS', rfc: 'PAVK-781208-TB9', direccion: 'AV. LIBERTAD entre calles 8 y 9 #803', ciudad: 'San Luis Río Colorado, Sonora', telefono: '534-0607',
  },
  // London Love: sin datos de fábrica; se capturan en Administración → Configuración → Tiendas.
  LON: { nombre: 'London Love', letra: 'L', leyendas: ['No hacemos devoluciones de efectivo'], columnas: 48 },
};

/** Código que identifica la venta sin ambigüedad entre las cuatro series: tienda + caja + folio. */
export function codigoTicket(tienda: string, caja: number, folio: number, negocios = NEGOCIOS): string {
  const letra = negocios[tienda]?.letra;
  if (!letra) throw new Error(`tienda sin letra de ticket: ${tienda}`);
  return `${letra}${caja}-${String(folio).padStart(6, '0')}`;
}

/** Interpreta un código escaneado de un ticket. Un folio suelto (tickets antiguos) NO se interpreta: falta el contexto. */
export function interpretarCodigoTicket(texto: string, negocios = NEGOCIOS): { tienda: string; caja: number; folio: number } | null {
  const m = /^([A-Z])(\d)-(\d{6,})$/.exec(texto.trim());
  if (!m) return null;
  const tienda = Object.keys(negocios).find((t) => negocios[t]!.letra === m[1]);
  return tienda ? { tienda, caja: Number(m[2]), folio: Number(m[3]) } : null;
}

/**
 * Lo que alguien teclea para buscar un ticket: el código impreso (D2-000003, D2000003) o solo el folio (3, 000003).
 * Con el código se sabe de qué tienda y caja es; con el folio suelto no. null = no es un folio.
 */
export function interpretarFolio(texto: unknown, negocios = NEGOCIOS): { folio: number; tienda?: string; caja?: number } | null {
  const t = String(texto ?? '').trim();
  if (/^\d{1,9}$/.test(t)) return Number(t) > 0 ? { folio: Number(t) } : null;
  const m = /^([A-Za-z])\s*(\d)\s*-?\s*(\d{1,9})$/.exec(t);
  if (!m) return null;
  const tienda = Object.keys(negocios).find((k) => negocios[k]!.letra === m[1]!.toUpperCase());
  return tienda && Number(m[3]) > 0 ? { folio: Number(m[3]), tienda, caja: Number(m[2]) } : null;
}

export interface LineaTicket {
  item_no: string | null;
  codigo: string;
  descripcion: string;
  marca: string;
  estilo: string;
  lote: string;
  qty: number;
  precio_unit: number;
  descuento: number;
  importe: number;
  /** Origen del descuento (promoción, cupón o descuento autorizado). */
  descuentos?: { tipo: 'manual' | 'promo' | 'cupon'; nombre: string; monto: number }[];
  /** Venta o recarga de tarjeta de regalo: no lleva Item #, marca, estilo ni lote. */
  tarjeta_regalo?: boolean;
}
/** Cambio de mercancía: lo recibido a cambio se muestra DENTRO del ticket de la venta nueva (no hay un comprobante aparte de crédito). */
export interface CambioTicket {
  /** Código de la venta original (D2-000007). */
  origen: string;
  recibidas: { qty: number; descripcion: string; marca: string; estilo: string; item_no: string | null; codigo: string; precio_unit: number; importe: number }[];
  /** Valor de lo recibido a cambio. */
  recibido: number;
  /** Diferencia final: total de lo nuevo − lo recibido. Positiva = la clienta paga; negativa = se le devuelve. */
  neto: number;
  /** Dinero que sale de la tienda por la diferencia a favor de la clienta (solo si se autorizó). */
  reembolsos: Devolucion['reembolsos'];
  autorizado_por?: string;
}
export interface Ticket {
  cambio?: CambioTicket;
  /** Cupones de recompensa que se imprimen al final (cada uno con su QR). */
  recompensas?: import('./recompensas.ts').RecompensaEmitida[];
  /** Quién atendió la venta (no se imprime si fue «Autocompra» o no se registró). */
  vendio?: string;
  negocio: string;
  tienda: string;
  caja: number;
  cajero: string;
  fecha: string; // DD/MM/YYYY (America/Hermosillo)
  hora: string; // HH:MM
  folio: number;
  codigo_ticket: string;
  lineas: LineaTicket[];
  total: number;
  pagos: { etiqueta: string; monto: number; recibido?: number; cambio?: number; tarjeta?: string; saldo_despues?: number; autorizacion?: string; marca?: string; ultimos4?: string; dolares?: { usd: number; tasa: number; version: number; equivalente: number; pesos: number; cambio: number } }[];
  /** Encabezado bajo el nombre: dirección, ciudad, razón social y RFC (lo que esté capturado). */
  encabezado: string[];
  telefono: string;
  leyendas: string[];
  columnas: number;
  reimpresion: number;
  /** Ticket de regalo: sin precios, pagos ni descuentos; lleva el código de la compra para el cambio. */
  regalo?: boolean;
}

/** Configuración de fábrica del negocio con lo editado en Administración encima (cadena vacía = no mostrar; la política se parte en renglones). */
export function aplicarDatosTienda(base: NegocioCfg, d?: import('./proyecciones.ts').DatosTienda): NegocioCfg {
  if (!d) return base;
  const c: NegocioCfg = { ...base };
  if (d.nombre) c.nombre = d.nombre;
  for (const k of ['razon_social', 'rfc', 'direccion', 'ciudad', 'telefono'] as const) if (d[k] !== undefined) c[k] = d[k];
  if (d.politica !== undefined) c.leyendas = d.politica.split('\n').map((x) => x.trim()).filter(Boolean);
  return c;
}
/** Líneas del encabezado de la tienda (las vacías no salen). */
export const encabezadoDe = (cfg: NegocioCfg): string[] => [cfg.direccion, cfg.ciudad, cfg.razon_social, cfg.rfc ? `RFC: ${cfg.rfc}` : ''].map((x) => (x ?? '').trim()).filter(Boolean);

export function construirTicket(v: Venta, cfg: NegocioCfg = NEGOCIOS[v.tienda]!, reimpresion = 0, negocios = NEGOCIOS, cambio?: { dev: Devolucion; origen: Venta }): Ticket {
  const local = new Date(Date.parse(v.ocurrio_en) - 7 * 3600_000).toISOString();
  const [y, mo, d] = fechaLocal(v.ocurrio_en).split('-');
  return {
    negocio: cfg.nombre, tienda: v.tienda, caja: v.caja, cajero: v.cajero, vendio: v.vendedora_id ? v.vendedora : undefined, recompensas: v.recompensas,
    fecha: `${d}/${mo}/${y}`, hora: local.slice(11, 16), folio: v.folio, codigo_ticket: codigoTicket(v.tienda, v.caja, v.folio, negocios),
    lineas: v.lineas.map((l) => ({
      item_no: l.item_no, codigo: l.codigo, descripcion: l.descripcion, marca: l.marca, estilo: l.estilo, lote: l.lote,
      qty: l.qty, precio_unit: l.precio_unit, descuento: l.descuento, importe: l.importe, descuentos: l.descuento_detalle?.map((d) => ({ tipo: d.tipo, nombre: d.nombre, monto: d.monto })), tarjeta_regalo: l.tarjeta_regalo ? true : undefined,
    })),
    total: v.total,
    ...(cambio ? { cambio: cambioDeTicket(v, cambio.dev, cambio.origen, negocios) } : {}),
    pagos: v.pagos.filter((p) => !(cambio && p.metodo === 'credito_cambio')).map((p) => ({ etiqueta: p.metodo === 'efectivo' ? 'Efectivo MXN' : p.metodo === 'efectivo_usd' ? 'Efectivo (dólares)' : p.metodo === 'tarjeta_regalo' ? 'Tarjeta de regalo' : p.metodo === 'credito_cambio' ? `Mercancía recibida a cambio (folio ${String(p.folio_origen ?? 0).padStart(6, '0')})` : 'Tarjeta', monto: p.monto, recibido: p.recibido, cambio: p.cambio, tarjeta: p.tarjeta, saldo_despues: p.saldo_despues, autorizacion: p.autorizacion, marca: p.marca, ultimos4: p.ultimos4, dolares: p.metodo === 'efectivo_usd' ? { usd: p.usd!, tasa: p.tasa!, version: p.tasa_version!, equivalente: p.equivalente!, pesos: p.pesos_recibidos!, cambio: p.cambio_mxn! } : undefined })),
    encabezado: encabezadoDe(cfg), telefono: cfg.telefono ?? '', leyendas: cfg.leyendas, columnas: cfg.columnas, reimpresion,
  };
}

function cambioDeTicket(v: Venta, dev: Devolucion, origen: Venta, negocios: Record<string, NegocioCfg>): CambioTicket {
  return {
    origen: codigoTicket(origen.tienda, origen.caja, origen.folio, negocios),
    recibidas: dev.lineas.map((dl) => {
      const l = origen.lineas.find((x) => x.linea_id === dl.linea_id)!;
      return { qty: dl.qty, descripcion: l.descripcion, marca: l.marca, estilo: l.estilo, item_no: l.item_no, codigo: l.codigo, precio_unit: l.precio_unit, importe: dl.importe };
    }),
    recibido: dev.importe, neto: v.total - dev.importe, reembolsos: dev.reembolsos, ...(dev.autorizado_por ? { autorizado_por: dev.autorizado_por } : {}),
  };
}

function envolver(texto: string, cols: number): string[] {
  const out: string[] = [];
  let linea = '';
  for (const palabra of texto.split(' ')) {
    if (linea && (linea + ' ' + palabra).length > cols) { out.push(linea); linea = palabra; }
    else linea = linea ? `${linea} ${palabra}` : palabra;
  }
  if (linea) out.push(linea);
  return out;
}
/** Empaqueta campos completos ("Marca: X", "Estilo: Y"…) en renglones sin partir un campo entre dos renglones. */
function empaquetar(campos: string[], cols: number): string[] {
  const out: string[] = [];
  let linea = '';
  for (const c of campos) {
    if (linea && (linea + '  ' + c).length > cols) { out.push(linea); linea = c; }
    else linea = linea ? `${linea}  ${c}` : c;
  }
  if (linea) out.push(linea);
  return out;
}
/**
 * Ticket de regalo de una venta: la mercancía SIN precios, descuentos, pagos ni cajero, con el código de la compra (para el cambio) y la
 * política de la tienda. Las tarjetas de regalo no se incluyen (no tienen cambio). Devuelve null si no hay mercancía.
 */
export function construirTicketRegalo(v: Venta, cfg: NegocioCfg = NEGOCIOS[v.tienda]!, negocios = NEGOCIOS): Ticket | null {
  const base = construirTicket(v, cfg, 0, negocios);
  const lineas = base.lineas.filter((l) => !l.tarjeta_regalo);
  return lineas.length ? { ...base, lineas, pagos: [], total: 0, regalo: true } : null;
}
function renderTicketRegaloTexto(t: Ticket): string {
  const c = t.columnas;
  const regla = '-'.repeat(c);
  const L: string[] = [centrar(t.negocio, c)];
  for (const x of t.encabezado) L.push(...envolver(x, c).map((y) => centrar(y, c)));
  L.push(centrar(`Tienda ${t.tienda} - Caja ${t.caja}`, c), '', centrar('*** TICKET DE REGALO ***', c), '');
  L.push(`Fecha de compra: ${t.fecha}`, `Compra: ${t.codigo_ticket}`, regla);
  for (const l of t.lineas) {
    L.push(...renglonArticulo(l, c));
    const id = [l.item_no ? `#${l.item_no}` : '', l.codigo].filter(Boolean).join(' ');
    if (id) L.push(id);
  }
  L.push(regla, ...envolver('Para cambios presente este ticket.', c).map((x) => centrar(x, c)));
  if (t.telefono) L.push('', centrar(`TELÉFONO ${t.telefono}`, c));
  if (t.leyendas.length) L.push('');
  for (const leyenda of t.leyendas) L.push(...envolver(leyenda, c).map((x) => centrar(x, c)));
  L.push(regla, centrar(t.codigo_ticket, c));
  return L.join('\n') + '\n';
}

/** Envuelve con sangría francesa: los renglones siguientes empiezan bajo el texto, no bajo la cantidad. */
function envolverConSangria(prefijo: string, texto: string, cols: number): string[] {
  const sangria = ' '.repeat(prefijo.length);
  const [primero = '', ...resto] = envolver(texto, cols - prefijo.length);
  return [prefijo + primero, ...resto.map((x) => sangria + x)];
}
/** Primer renglón de un artículo: «1 MASCADA EFENTUS A-12» (cantidad, descripción, marca y estilo; sin rótulos ni lote). */
export function renglonArticulo(l: { qty: number; descripcion: string; marca: string; estilo: string; tarjeta_regalo?: boolean }, cols: number): string[] {
  const texto = (l.tarjeta_regalo ? [l.descripcion] : [l.descripcion, l.marca, l.estilo]).map((x) => (x ?? '').trim()).filter(Boolean).join(' ');
  return envolverConSangria(`${l.qty} `, texto, cols);
}
/**
 * Segundo renglón de un artículo: «#1003 7501234567890» y a la derecha el importe («4 x $55.00  $220.00» con varias piezas).
 * Va en UN solo renglón cuando cabe; si no, el importe pasa al siguiente. Sin Item # no se imprime nada de más.
 */
export function renglonIdentificacion(l: { item_no: string | null; codigo: string; qty: number; precio_unit: number; tarjeta_regalo?: boolean }, importe: number, cols: number, conPrecioUnitario = true): string[] {
  const id = [l.tarjeta_regalo || !l.item_no ? '' : `#${l.item_no}`, l.codigo].filter(Boolean).join(' ');
  const der = l.qty === 1 || !conPrecioUnitario ? formatoMXN(importe) : `${l.qty} x ${formatoMXN(l.precio_unit)}  ${formatoMXN(importe)}`;
  return id.length + 1 + der.length <= cols ? [dos(id, der, cols)] : [id, dos('', der, cols)];
}
const centrar = (t: string, cols: number) => ' '.repeat(Math.max(0, Math.floor((cols - t.length) / 2))) + t;
const dos = (izq: string, der: string, cols: number) => izq + ' '.repeat(Math.max(1, cols - izq.length - der.length)) + der;

/**
 * Texto del ticket. Precios finales y total neto: NO hay renglón de IVA, impuesto ni porcentaje alguno (presentación
 * comercial; no implica que los productos sean fiscalmente exentos). Cada artículo en dos renglones: «cantidad descripción marca estilo» y «#Item código … importe».
 */
export function renderTicketTexto(t: Ticket): string {
  if (t.regalo) return renderTicketRegaloTexto(t);
  const c = t.columnas;
  const regla = '-'.repeat(c);
  const L: string[] = [];
  L.push(centrar(t.negocio, c));
  for (const x of t.encabezado) L.push(...envolver(x, c).map((y) => centrar(y, c)));
  L.push(centrar(`Tienda ${t.tienda} - Caja ${t.caja}`, c));
  L.push(`Vendedora-Cajera: ${t.cajero}`.slice(0, c), ...(t.vendio ? [`Vendió: ${t.vendio}`.slice(0, c)] : []), `Fecha: ${t.fecha}  Hora: ${t.hora}`, `Folio: ${String(t.folio).padStart(6, '0')}`);
  if (t.reimpresion > 0) L.push(centrar(`*** REIMPRESIÓN ${t.reimpresion} ***`, c));
  L.push(regla);
  if (t.cambio) L.push('ARTÍCULO NUEVO:');
  for (const l of t.lineas) {
    L.push(...renglonArticulo(l, c));
    L.push(...renglonIdentificacion(l, l.qty * l.precio_unit, c));
    if (l.tarjeta_regalo) L.push('Vigencia: 12 meses desde la compra o la última recarga');
    if (l.descuento > 0) {
      if (l.descuentos?.length) {
        for (const d of l.descuentos) {
          const rot = d.tipo === 'cupon' ? `Cupón ${d.nombre}` : d.tipo === 'promo' ? d.nombre : d.nombre;
          const [a, ...resto] = envolver(rot, Math.max(10, c - formatoMXN(d.monto).length - 2));
          L.push(dos(a ?? '', `-${formatoMXN(d.monto)}`, c), ...resto);
        }
      } else L.push(dos('Descuento', `-${formatoMXN(l.descuento)}`, c));
    }
  }
  if (t.cambio) {
    // Lo recibido a cambio baja el total de la operación en este mismo ticket; no es dinero ni un saldo a favor.
    L.push(regla, 'SE RECIBIÓ A CAMBIO:');
    for (const r of t.cambio.recibidas) {
      L.push(...renglonArticulo({ ...r, tarjeta_regalo: false }, c));
      L.push(...renglonIdentificacion({ ...r, tarjeta_regalo: false }, -r.importe, c, false));
    }
    L.push(`Venta original: ${t.cambio.origen}`, regla);
    L.push(t.cambio.neto >= 0 ? dos('TOTAL A PAGAR', formatoMXN(t.cambio.neto), c) : dos('DIFERENCIA A DEVOLVER', formatoMXN(-t.cambio.neto), c));
  } else L.push(regla, dos('TOTAL', formatoMXN(t.total), c));
  for (const r of t.cambio?.reembolsos ?? []) L.push(dos(textoReembolso(r), formatoMXN(r.monto), c));
  if (t.cambio?.autorizado_por && t.cambio.reembolsos.some((r) => r.metodo === 'efectivo')) L.push(...envolver(`Devolución de efectivo autorizada por ${t.cambio.autorizado_por}`, c));
  for (const p of t.pagos) {
    L.push(dos(p.etiqueta, formatoMXN(p.monto), c));
    if (p.tarjeta) L.push(dos(`  Tarjeta: ${p.tarjeta}`, p.saldo_despues !== undefined ? `Saldo ${formatoMXN(p.saldo_despues)}` : '', c));
    if (p.autorizacion) L.push(dos(`  Aut. ${p.autorizacion}`, [p.marca?.toUpperCase(), p.ultimos4 ? `****${p.ultimos4}` : ''].filter(Boolean).join(' '), c));
    if (p.dolares) {
      // El total sigue en MXN; aquí solo se documenta lo que se recibió y con qué tasa (la de ESE cobro, aunque hoy sea otra).
      const d = p.dolares;
      L.push(dos('  USD recibidos', formatoUSD(d.usd), c), dos(`  Tasa ${formatoTasa(d.tasa)} MXN/USD (v${d.version})`, '', c), dos('  Equivalente MXN', formatoMXN(d.equivalente), c));
      if (d.pesos > 0) L.push(dos('  Pesos recibidos', formatoMXN(d.pesos), c));
      L.push(dos('  Cambio MXN', formatoMXN(d.cambio), c));
    }
    if (p.recibido !== undefined) L.push(dos('Recibido', formatoMXN(p.recibido), c), dos('Cambio', formatoMXN(p.cambio ?? 0), c));
  }
  L.push(regla);
  if (t.telefono) L.push('', centrar(`TELÉFONO ${t.telefono}`, c));
  if (t.leyendas.length) L.push('');
  for (const leyenda of t.leyendas) L.push(...envolver(leyenda, c).map((x) => centrar(x, c)));
  L.push(centrar(t.codigo_ticket, c));
  for (const r of t.recompensas ?? []) L.push('', ...textoCupon(r, t));
  return L.join('\n') + '\n';
}

const fechaCorta = (iso: string) => iso.split('-').reverse().join('/');
/** Texto del cupón de recompensa impreso al final del ticket (el QR va aparte). */
export function textoCupon(r: import('./recompensas.ts').RecompensaEmitida, t: Pick<Ticket, 'columnas' | 'negocio'>): string[] {
  const c = t.columnas;
  const q = r.promo;
  const premio = q ? (q.tipo === 'nxm' ? `Lleva ${q.lleva} y paga ${q.paga}` : q.tipo === 'paquete' ? `Lleva ${q.lleva} por ${formatoMXN(q.precio!)}` : `${formatoMXN(q.descuenta!)} de descuento por cada ${formatoMXN(q.cada!)} de compra`)
    : r.pct !== undefined ? `${r.pct}% de descuento` : `${formatoMXN(r.monto!)} de descuento`;
  return [
    '='.repeat(c), centrar('¡TE GANASTE UN CUPÓN!', c), ...envolver(r.nombre, c).map((x) => centrar(x, c)),
    ...envolver(`${premio}${q && q.tipo !== 'por_cada' ? ' (en la mercancía de la promoción)' : ''} en tu próxima compra`, c).map((x) => centrar(x, c)),
    ...(r.minimo > 0 ? [centrar(`Compra mínima: ${formatoMXN(r.minimo)}`, c)] : []),
    centrar(`Válido del ${fechaCorta(r.valido_desde)} al ${fechaCorta(r.valido_hasta)}`, c),
    ...envolver(`Solo en ${t.negocio}. Un solo uso, no acumulable con otras promociones.`, c).map((x) => centrar(x, c)),
    centrar(`Código: ${r.codigo}`, c), '='.repeat(c),
  ];
}

/** QR nativo de la impresora (GS ( k, modelo 2). NO validado con una impresora real. */
export function qrEscPos(texto: string): number[] {
  const d = aCP858(texto);
  const n = d.length + 3;
  return [
    0x1b, 0x61, 1,
    0x1d, 0x28, 0x6b, 4, 0, 0x31, 0x41, 0x32, 0, // modelo 2
    0x1d, 0x28, 0x6b, 3, 0, 0x31, 0x43, 6, // tamaño del módulo
    0x1d, 0x28, 0x6b, 3, 0, 0x31, 0x45, 0x31, // corrección de errores M
    0x1d, 0x28, 0x6b, n & 255, n >> 8, 0x31, 0x50, 0x30, ...d, // guardar datos
    0x1d, 0x28, 0x6b, 3, 0, 0x31, 0x51, 0x30, // imprimir
    0x0a, 0x1b, 0x61, 0,
  ];
}

// ── ESC/POS (Epson TM-T20II según lectura fotográfica de la etiqueta; NO validado en equipo real) ──
const CP858: Record<string, number> = {
  'á': 0xa0, 'é': 0x82, 'í': 0xa1, 'ó': 0xa2, 'ú': 0xa3, 'ñ': 0xa4, 'Ñ': 0xa5, 'Á': 0xb5, 'É': 0x90, 'Í': 0xd6, 'Ó': 0xe0, 'Ú': 0xe9,
  'ü': 0x81, 'Ü': 0x9a, '¿': 0xa8, '¡': 0xad, '°': 0xf8, '€': 0xd5,
};
export function aCP858(s: string): number[] {
  const out: number[] = [];
  for (const ch of s) {
    const cp = ch.codePointAt(0)!;
    if (cp < 0x80) out.push(cp);
    else out.push(CP858[ch] ?? 0x3f); // carácter no representable -> '?'
  }
  return out;
}

export function renderTicketEscPos(t: Ticket, opts: { abrirCajon?: boolean; logo?: import('./logos-ticket.ts').LogoRaster } = {}): Uint8Array {
  const b: number[] = [];
  b.push(0x1b, 0x40); // ESC @ inicializar
  b.push(0x1b, 0x74, 19); // ESC t 19: página de códigos PC858 (acentos del español)
  if (opts.abrirCajon) b.push(0x1b, 0x70, 0x00, 25, 250); // ESC p: pulso al cajón
  if (opts.logo) b.push(...rasterEscPos(opts.logo)); // logo de la tienda arriba, centrado (GS v 0)
  b.push(...aCP858(renderTicketTexto({ ...t, recompensas: undefined }).replace(/\n$/, '')), 0x0a);
  const datos = aCP858(`{B${t.codigo_ticket}`); // Code128 juego B
  b.push(0x1b, 0x61, 1); // centrar
  b.push(0x1d, 0x68, 80, 0x1d, 0x77, 2, 0x1d, 0x48, 0); // alto, ancho, sin texto HRI (ya va impreso)
  b.push(0x1d, 0x6b, 73, datos.length, ...datos); // GS k 73 n d1..dn
  b.push(0x0a);
  // Cupones de recompensa: al final del MISMO ticket, cada uno con su texto y su QR (el código es lo que lee el lector 2D).
  for (const r of t.recompensas ?? []) { b.push(0x0a, ...aCP858(textoCupon(r, t).join('\n')), 0x0a, ...qrEscPos(r.codigo)); }
  b.push(0x0a, 0x0a);
  b.push(0x1d, 0x56, 66, 0); // GS V 66 0: avance y corte parcial
  return Uint8Array.from(b);
}

/** Imagen en 1 bit como ESC/POS «GS v 0» (modo normal), centrada. NO validado con una impresora real. */
export function rasterEscPos(l: import('./logos-ticket.ts').LogoRaster): number[] {
  const bytes = Array.from(atob(l.datos), (c) => c.charCodeAt(0));
  const bpr = Math.ceil(l.ancho / 8);
  return [0x1b, 0x61, 1, 0x1d, 0x76, 0x30, 0, bpr & 255, bpr >> 8, l.alto & 255, l.alto >> 8, ...bytes, 0x0a, 0x1b, 0x61, 0];
}

// ── ticket de devolución: lleva folio de la MISMA serie que las ventas (P-08) ──
export function renderTicketDevolucionTexto(d: Devolucion, v: Venta, cfg: NegocioCfg = NEGOCIOS[v.tienda]!, negocios = NEGOCIOS): string {
  const c = cfg.columnas;
  const regla = '-'.repeat(c);
  const local = new Date(Date.parse(d.ocurrio_en) - 7 * 3600_000).toISOString();
  const [y, mo, dd] = fechaLocal(d.ocurrio_en).split('-');
  const L: string[] = [centrar(cfg.nombre, c), ...encabezadoDe(cfg).flatMap((x) => envolver(x, c).map((y) => centrar(y, c))), centrar(`Tienda ${d.tienda} - Caja ${d.caja}`, c), centrar(d.por_cambio && d.venta_cambio ? TITULO_COMPROBANTE.cambio : TITULO_COMPROBANTE.devolucion, c)];
  L.push(`Vendedora-Cajera: ${d.cajero}`.slice(0, c), `Fecha: ${dd}/${mo}/${y}  Hora: ${local.slice(11, 16)}`, `Folio: ${String(d.folio ?? 0).padStart(6, '0')}`);
  L.push(`Venta original: ${codigoTicket(v.tienda, v.caja, v.folio, negocios)}`, regla);
  for (const dl of d.lineas) {
    const l = v.lineas.find((x) => x.linea_id === dl.linea_id)!;
    L.push(...renglonArticulo({ ...l, qty: dl.qty, tarjeta_regalo: !!l.tarjeta_regalo }, c));
    L.push(...renglonIdentificacion({ ...l, qty: dl.qty, tarjeta_regalo: !!l.tarjeta_regalo }, dl.importe, c, false));
  }
  L.push(regla, dos('TOTAL DEVUELTO', formatoMXN(d.importe), c));
  for (const r of d.reembolsos) L.push(dos(r.metodo === 'efectivo' ? 'Reembolso en efectivo MXN' : r.metodo === 'tarjeta' ? 'Reverso a tarjeta bancaria' : `A tarjeta de regalo ${r.tarjeta}`, formatoMXN(r.monto), c));
  if (d.autorizado_por && d.reembolsos.some((r) => r.metodo === 'efectivo')) L.push(...envolver(`Devolución de efectivo autorizada por ${d.autorizado_por}`, c));
  L.push(regla, centrar(codigoTicket(d.tienda, d.caja, d.folio ?? 0, negocios), c));
  return L.join('\n') + '\n';
}

/** Datos de lo que se imprime al revertir una venta o al hacer un cambio / devolución. */
export interface ComprobanteClienta {
  tipo: 'cambio' | 'devolucion' | 'cancelacion';
  tienda: string;
  caja: number;
  /** Folio del documento (el de la devolución); las cancelaciones no consumen folio: se usa el de la venta original. */
  folio: number;
  ocurrio_en: string;
  cajero: string;
  autorizado_por?: string | null;
  clienta?: { nombre: string; telefono: string } | null;
  motivo?: string | null;
  /** Venta de origen. */
  venta: Venta;
  /** Lo que regresa la clienta. */
  lineas: { linea_id: string; qty: number; importe: number }[];
  importe: number;
  reembolsos: { metodo: 'efectivo' | 'tarjeta' | 'tarjeta_regalo'; monto: number; tarjeta?: string }[];
  /** Cambio: lo que se lleva a cambio (de la venta nueva). */
  se_lleva?: { descripcion: string; qty: number; importe?: number }[];
  /** Cambio: total de la mercancía nueva (para mostrar la diferencia en el comprobante de control). */
  nuevo_total?: number;
}
const TITULO_COMPROBANTE = { cambio: 'SE HIZO CAMBIO', devolucion: 'RECIBÍ DEVOLUCIÓN', cancelacion: 'VENTA CANCELADA' } as const;
const textoReembolso = (r: ComprobanteClienta['reembolsos'][number]) => (r.metodo === 'efectivo' ? 'Reembolso en efectivo MXN' : r.metodo === 'tarjeta' ? 'Reverso a tarjeta bancaria' : `A tarjeta de regalo ${r.tarjeta}`);

/** Ticket de la clienta al revertir una venta: dice VENTA CANCELADA (los cambios y devoluciones usan renderTicketDevolucionTexto). */
export function renderTicketCancelacionTexto(x: ComprobanteClienta, cfg: NegocioCfg = NEGOCIOS[x.venta.tienda]!, negocios = NEGOCIOS): string {
  const c = cfg.columnas;
  const regla = '-'.repeat(c);
  const local = new Date(Date.parse(x.ocurrio_en) - 7 * 3600_000).toISOString();
  const [y, mo, dd] = fechaLocal(x.ocurrio_en).split('-');
  const L: string[] = [centrar(cfg.nombre, c), ...encabezadoDe(cfg).flatMap((t) => envolver(t, c).map((u) => centrar(u, c))), centrar(`Tienda ${x.tienda} - Caja ${x.caja}`, c), centrar(TITULO_COMPROBANTE.cancelacion, c)];
  L.push(`Vendedora-Cajera: ${x.cajero}`.slice(0, c), `Fecha: ${dd}/${mo}/${y}  Hora: ${local.slice(11, 16)}`, `Venta cancelada: ${codigoTicket(x.venta.tienda, x.venta.caja, x.venta.folio, negocios)}`, regla);
  for (const dl of x.lineas) {
    const l = x.venta.lineas.find((q) => q.linea_id === dl.linea_id)!;
    L.push(...renglonArticulo({ ...l, qty: dl.qty, tarjeta_regalo: !!l.tarjeta_regalo }, c));
    L.push(...renglonIdentificacion({ ...l, qty: dl.qty, tarjeta_regalo: !!l.tarjeta_regalo }, dl.importe, c, false));
  }
  L.push(regla, dos('TOTAL DEVUELTO', formatoMXN(x.importe), c));
  for (const r of x.reembolsos) L.push(dos(textoReembolso(r), formatoMXN(r.monto), c));
  if (x.motivo) L.push(...envolver(`Motivo: ${x.motivo}`, c));
  if (x.autorizado_por) L.push(...envolver(`Autorizó: ${x.autorizado_por}`, c));
  L.push(regla, centrar(codigoTicket(x.venta.tienda, x.venta.caja, x.venta.folio, negocios), c));
  return L.join('\n') + '\n';
}

/** Segundo ticket: el que firma la clienta («Recibí devolución…» / «Recibí cambio del artículo…»). Se queda en la tienda. */
export function renderTicketFirmaTexto(x: ComprobanteClienta, cfg: NegocioCfg = NEGOCIOS[x.venta.tienda]!, negocios = NEGOCIOS): string {
  const c = cfg.columnas;
  const regla = '-'.repeat(c);
  const local = new Date(Date.parse(x.ocurrio_en) - 7 * 3600_000).toISOString();
  const [y, mo, dd] = fechaLocal(x.ocurrio_en).split('-');
  const L: string[] = [centrar(cfg.nombre, c), centrar(`Tienda ${x.tienda} - Caja ${x.caja}`, c), centrar(TITULO_COMPROBANTE[x.tipo], c), centrar('COPIA PARA LA TIENDA (FIRMA)', c)];
  L.push(`Fecha: ${dd}/${mo}/${y}  Hora: ${local.slice(11, 16)}`, `Folio: ${String(x.folio).padStart(6, '0')}`, `Venta original: ${codigoTicket(x.venta.tienda, x.venta.caja, x.venta.folio, negocios)}`, `Vendedora-Cajera: ${x.cajero}`.slice(0, c));
  if (x.autorizado_por) L.push(...envolver(`Autorizó: ${x.autorizado_por}`, c));
  L.push(regla);
  if (x.clienta) L.push(...envolver(`Clienta: ${x.clienta.nombre}`, c), `Teléfono: ${x.clienta.telefono}`.slice(0, c));
  if (x.motivo) L.push(...envolver(`Motivo: ${x.motivo}`, c));
  L.push(regla);
  const articulos = x.lineas.flatMap((dl) => {
    const l = x.venta.lineas.find((q) => q.linea_id === dl.linea_id)!;
    return [...renglonArticulo({ ...l, qty: dl.qty, tarjeta_regalo: !!l.tarjeta_regalo }, c), ...(x.tipo === 'cambio' ? [dos('', formatoMXN(dl.importe), c)] : [])];
  });
  if (x.tipo === 'cambio') {
    L.push(...envolver('Recibí cambio del artículo:', c), ...articulos);
    if (x.se_lleva?.length) L.push('Me llevo a cambio:', ...x.se_lleva.flatMap((p) => [...envolverConSangria(`${p.qty} `, p.descripcion, c), ...(p.importe !== undefined ? [dos('', formatoMXN(p.importe), c)] : [])]));
    if (x.nuevo_total !== undefined) {
      const neto = x.nuevo_total - x.importe;
      L.push(regla, dos('Mercancía nueva', formatoMXN(x.nuevo_total), c), dos('Mercancía recibida a cambio', formatoMXN(-x.importe), c), dos(neto >= 0 ? 'TOTAL A PAGAR' : 'DIFERENCIA A DEVOLVER', formatoMXN(Math.abs(neto)), c));
    }
  } else {
    L.push(...envolver(`Recibí devolución por ${formatoMXN(x.importe)} de:`, c), ...articulos);
  }
  for (const r of x.reembolsos) L.push(dos(textoReembolso(r), formatoMXN(r.monto), c));
  L.push('', '', '_'.repeat(Math.min(c, 32)), 'Nombre y firma de la clienta', regla);
  return L.join('\n') + '\n';
}

/** Texto plano a ESC/POS (mismo supuesto de página de códigos que el ticket; sin validar en equipo real). */
export function renderTextoEscPos(texto: string, opts: { abrirCajon?: boolean } = {}): Uint8Array {
  const b: number[] = [0x1b, 0x40, 0x1b, 0x74, 19];
  if (opts.abrirCajon) b.push(0x1b, 0x70, 0x00, 25, 250);
  b.push(...aCP858(texto.replace(/\n$/, '')), 0x0a, 0x0a, 0x0a, 0x1d, 0x56, 66, 0);
  return Uint8Array.from(b);
}

// ── ticket de retiro de efectivo ──
/** Datos del retiro para el cajón y el supervisor: desglose por billete, tipo de cambio, total en pesos y el efectivo de venta antes y después. */
export function renderTicketRetiroTexto(r: RetiroRegistrado, cfg: NegocioCfg, reimpresion = 0): string {
  const c = cfg.columnas;
  const regla = '-'.repeat(c);
  const local = new Date(Date.parse(r.ocurrio_en) - 7 * 3600_000).toISOString();
  const [y, mo, dd] = fechaLocal(r.ocurrio_en).split('-');
  const L: string[] = [centrar(cfg.nombre, c)];
  for (const x of encabezadoDe(cfg)) L.push(...envolver(x, c).map((y2) => centrar(y2, c)));
  L.push(centrar(`Tienda ${r.tienda} - Caja ${r.caja}`, c), '', centrar('*** RETIRO DE EFECTIVO ***', c));
  if (reimpresion > 0) L.push(centrar(`REIMPRESIÓN ${reimpresion}`, c));
  L.push('', `Retiro: ${r.folio_retiro}`, `Fecha: ${dd}/${mo}/${y}  ${local.slice(11, 16)}`, `Vendedora-Cajera: ${r.usuario}`.slice(0, c), regla);
  const denoms = (d: Record<string, number>, valor: (k: number) => number, fmt: (v: number) => string) => Object.keys(d).map(Number).sort((a, b) => b - a)
    .map((k) => dos(`${d[String(k)]} x ${fmt(valor(k))}`, fmt(valor(k) * d[String(k)]!), c));
  if (r.mxn.total > 0) L.push('PESOS', ...denoms(r.mxn.denominaciones, (k) => k, formatoMXN), dos('Total pesos', formatoMXN(r.mxn.total), c));
  if (r.usd.total > 0) {
    L.push('DÓLARES', ...denoms(r.usd.denominaciones, (k) => k * 100, formatoUSD), dos('Total dólares', formatoUSD(r.usd.total), c));
    L.push(`Tipo de cambio ${formatoTasa(r.tasa!)} MXN/USD (v${r.tasa_version})`, dos('Equivalente en pesos', formatoMXN(r.equivalente_mxn - r.mxn.total), c));
  }
  L.push(regla, dos('TOTAL RETIRADO (MXN)', formatoMXN(r.equivalente_mxn), c), regla);
  L.push('Efectivo de venta en caja:', dos('  Antes del retiro', formatoMXN(r.venta_antes), c), dos('  Después del retiro', formatoMXN(r.venta_despues), c));
  L.push('', '', 'Firma de quien retira:', '', '_'.repeat(c), '', 'Firma de quien recibe:', '', '_'.repeat(c));
  return L.join('\n') + '\n';
}

// ── ticket de cierre de corte ──
/** Datos del corte que imprime el ticket (los de `Caja.corteEnVivo` / el corte guardado; lo que un corte viejo no trae sale «No disponible»). */
export type DatosCorte = Record<string, any>;
/** Ticket de cierre de caja: resumen del día, formas de pago, efectivo esperado contra contado (con la diferencia tal cual), fondo y firma. */
export function renderTicketCorteTexto(k: DatosCorte, cfg: NegocioCfg = NEGOCIOS[k.tienda]!, opts: { reimpresion?: number } = {}): string {
  const c = cfg.columnas;
  const regla = '-'.repeat(c);
  const doble = '='.repeat(c);
  const dato = (v: unknown, f: (n: number) => string = formatoMXN) => (typeof v === 'number' ? f(v) : 'No disponible');
  const [y, mo, dd] = String(k.fecha).split('-');
  const dif = (v: number | null | undefined, f: (n: number) => string = formatoMXN) => (typeof v !== 'number' ? '—' : v === 0 ? `${f(0)} SIN DIFERENCIA` : `${v > 0 ? '+' : '-'}${f(Math.abs(v))} ${v > 0 ? 'SOBRANTE' : 'FALTANTE'}`);
  const L: string[] = [centrar(cfg.nombre, c), centrar(`Tienda ${k.tienda} - Caja ${k.caja}`, c), '', centrar('*** CIERRE DE CAJA ***', c)];
  if (opts.reimpresion) L.push(centrar(`REIMPRESIÓN ${opts.reimpresion}`, c));
  L.push(`Fecha: ${dd}/${mo}/${y}`, ...(k.cerrado_por ? [`Cerró: ${k.cerrado_por}`.slice(0, c)] : []), `Folios: ${k.folio_inicial ? `${String(k.folio_inicial).padStart(6, '0')} al ${String(k.folio_final).padStart(6, '0')}` : 'sin movimientos'}`, doble);
  L.push('VENTAS', dos('Tickets de venta', String(k.tickets), c), dos('Mercancía antes de descuentos', formatoMXN(k.ventas_brutas), c));
  if (k.descuentos) L.push(dos('Descuentos', `-${formatoMXN(k.descuentos)}`, c));
  L.push(dos('Ventas de mercancía', formatoMXN(k.ventas_mercancia), c));
  if (k.tarjetas_regalo_vendidas) L.push(dos('Tarjetas de regalo vendidas', formatoMXN(k.tarjetas_regalo_vendidas), c));
  L.push(regla, 'CAMBIOS Y DEVOLUCIONES');
  L.push(dos('Mercancía recibida a cambio', dato(k.mercancia_recibida_por_cambio), c), dos('Diferencias cobradas en cambios', dato(k.diferencias_cobradas_en_cambios), c));
  L.push(dos('Devoluciones con reembolso', dato(k.devoluciones_con_reembolso), c));
  if (k.tickets_cancelados) L.push(dos(`Ventas canceladas (${k.tickets_cancelados})`, '', c));
  L.push(dos('VENTAS NETAS', formatoMXN(k.ventas_netas), c), regla, 'FORMAS DE PAGO');
  L.push(dos('Efectivo cobrado', formatoMXN(k.cobros_efectivo), c), dos('Tarjeta / banco', formatoMXN(k.cobros_tarjeta), c));
  if (k.cobros_tarjeta_regalo) L.push(dos('Tarjeta de regalo', formatoMXN(k.cobros_tarjeta_regalo), c));
  if (k.devoluciones_a_tarjeta) L.push(dos('Reembolsos a tarjeta / banco', `-${formatoMXN(k.devoluciones_a_tarjeta)}`, c));
  L.push('(tarjeta y banco no son efectivo del cajón)', doble, 'EFECTIVO EN PESOS');
  const m = k.mxn ?? {};
  L.push(dos('Cobros recibidos', formatoMXN(m.cobros ?? 0), c), dos('Cambio entregado', `-${formatoMXN(m.cambio ?? 0)}`, c));
  L.push(dos('Devoluciones en efectivo', `-${formatoMXN(m.devoluciones ?? 0)}`, c));
  if (m.cancelaciones) L.push(dos('Cancelaciones', `-${formatoMXN(m.cancelaciones)}`, c));
  if (m.retiros) L.push(dos('Retiros', `-${formatoMXN(m.retiros)}`, c));
  if (m.entradas) L.push(dos('Entradas extraordinarias', formatoMXN(m.entradas), c));
  if (m.ajustes) L.push(dos('Ajustes de Administración', formatoMXN(m.ajustes), c));
  L.push(regla, dos('EFECTIVO DE VENTAS ESPERADO', dato(k.efectivo_ventas_esperado), c));
  if (k.conteo_alcance === 'ventas' && k.conteo_mxn) L.push(dos('EFECTIVO DE VENTAS CONTADO', formatoMXN(k.conteo_mxn.contado), c), dos('DIFERENCIA', dif(k.diferencia_mxn), c));
  else L.push('Sin conteo de efectivo de ventas');
  const usdHubo = (k.usd?.cobros ?? 0) !== 0 || (k.efectivo_usd_esperado ?? 0) !== 0 || k.conteo_usd;
  if (usdHubo) {
    L.push(regla, 'EFECTIVO EN DÓLARES', dos('Esperado', formatoUSD(k.efectivo_usd_esperado ?? 0), c));
    if (k.conteo_usd) L.push(dos('Contado', formatoUSD(k.conteo_usd.contado), c), dos('DIFERENCIA', dif(k.diferencia_usd, formatoUSD), c));
  }
  L.push(doble, 'FONDO FIJO', dos('Autorizado por Administración', dato(k.fondo_autorizado), c), dos('Fondo confirmado', dato(k.fondo_confirmado), c));
  if (k.fondo_estado && k.fondo_estado !== 'completo') L.push(...envolver(`${k.fondo_estado === 'faltante' ? 'FALTANTE' : 'SOBRANTE'} de ${formatoMXN(Math.abs(k.fondo_diferencia))}: ${k.fondo_nota ?? ''}`, c));
  else if (k.fondo_estado === 'completo') L.push('Fondo completo');
  if (typeof k.efectivo_cajon_esperado === 'number') L.push(dos('Efectivo total en el cajón', formatoMXN(k.efectivo_cajon_esperado), c));
  if (k.observaciones) L.push(regla, ...envolver(`Observaciones: ${k.observaciones}`, c));
  L.push(regla, '', '', '_'.repeat(Math.min(c, 32)), 'Firma de la cajera', '', '_'.repeat(Math.min(c, 32)), 'Firma de quien revisa', regla);
  return L.join('\n') + '\n';
}
