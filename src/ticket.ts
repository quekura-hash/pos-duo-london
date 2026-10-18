import type { Devolucion } from './proyecciones.ts';
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
  /** Caracteres por renglón. 42 es un supuesto para 58 mm; el ancho real depende del papel y la fuente de la impresora (pendiente). */
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
    nombre: 'DÚO New York', letra: 'D', columnas: 42, leyendas: POLITICA_DUO,
    razon_social: 'KARINA PALAFOX VILLALOBOS', rfc: 'PAVK-781208-TB9', direccion: 'AV. LIBERTAD entre calles 8 y 9 #803', ciudad: 'San Luis Río Colorado, Sonora', telefono: '534-0607',
  },
  // London Love: sin datos de fábrica; se capturan en Administración → Configuración → Tiendas.
  LON: { nombre: 'London Love', letra: 'L', leyendas: ['No hacemos devoluciones de efectivo'], columnas: 42 },
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
export interface Ticket {
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
  pagos: { etiqueta: string; monto: number; recibido?: number; cambio?: number; tarjeta?: string; saldo_despues?: number; dolares?: { usd: number; tasa: number; version: number; equivalente: number; pesos: number; cambio: number } }[];
  /** Encabezado bajo el nombre: dirección, ciudad, razón social y RFC (lo que esté capturado). */
  encabezado: string[];
  telefono: string;
  leyendas: string[];
  columnas: number;
  reimpresion: number;
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

export function construirTicket(v: Venta, cfg: NegocioCfg = NEGOCIOS[v.tienda]!, reimpresion = 0, negocios = NEGOCIOS): Ticket {
  const local = new Date(Date.parse(v.ocurrio_en) - 7 * 3600_000).toISOString();
  const [y, mo, d] = fechaLocal(v.ocurrio_en).split('-');
  return {
    negocio: cfg.nombre, tienda: v.tienda, caja: v.caja, cajero: v.cajero,
    fecha: `${d}/${mo}/${y}`, hora: local.slice(11, 16), folio: v.folio, codigo_ticket: codigoTicket(v.tienda, v.caja, v.folio, negocios),
    lineas: v.lineas.map((l) => ({
      item_no: l.item_no, codigo: l.codigo, descripcion: l.descripcion, marca: l.marca, estilo: l.estilo, lote: l.lote,
      qty: l.qty, precio_unit: l.precio_unit, descuento: l.descuento, importe: l.importe, descuentos: l.descuento_detalle?.map((d) => ({ tipo: d.tipo, nombre: d.nombre, monto: d.monto })), tarjeta_regalo: l.tarjeta_regalo ? true : undefined,
    })),
    total: v.total,
    pagos: v.pagos.map((p) => ({ etiqueta: p.metodo === 'efectivo' ? 'Efectivo MXN' : p.metodo === 'efectivo_usd' ? 'Efectivo (dólares)' : p.metodo === 'tarjeta_regalo' ? 'Tarjeta de regalo' : 'Tarjeta', monto: p.monto, recibido: p.recibido, cambio: p.cambio, tarjeta: p.tarjeta, saldo_despues: p.saldo_despues, dolares: p.metodo === 'efectivo_usd' ? { usd: p.usd!, tasa: p.tasa!, version: p.tasa_version!, equivalente: p.equivalente!, pesos: p.pesos_recibidos!, cambio: p.cambio_mxn! } : undefined })),
    encabezado: encabezadoDe(cfg), telefono: cfg.telefono ?? '', leyendas: cfg.leyendas, columnas: cfg.columnas, reimpresion,
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
const centrar = (t: string, cols: number) => ' '.repeat(Math.max(0, Math.floor((cols - t.length) / 2))) + t;
const dos = (izq: string, der: string, cols: number) => izq + ' '.repeat(Math.max(1, cols - izq.length - der.length)) + der;

/**
 * Texto del ticket. Precios finales y total neto: NO hay renglón de IVA, impuesto ni porcentaje alguno (presentación
 * comercial; no implica que los productos sean fiscalmente exentos). Cada artículo: «cantidad descripción marca estilo», su Item # y código, y el precio.
 */
export function renderTicketTexto(t: Ticket): string {
  const c = t.columnas;
  const regla = '-'.repeat(c);
  const L: string[] = [];
  L.push(centrar(t.negocio, c));
  for (const x of t.encabezado) L.push(...envolver(x, c).map((y) => centrar(y, c)));
  L.push(centrar(`Tienda ${t.tienda} - Caja ${t.caja}`, c));
  L.push(`Cajero: ${t.cajero}`, `Fecha: ${t.fecha}  Hora: ${t.hora}`, `Folio: ${String(t.folio).padStart(6, '0')}`);
  if (t.reimpresion > 0) L.push(centrar(`*** REIMPRESIÓN ${t.reimpresion} ***`, c));
  L.push(regla);
  for (const l of t.lineas) {
    L.push(...renglonArticulo(l, c));
    if (l.tarjeta_regalo) L.push(`Código: ${l.codigo}`, 'Vigencia: 12 meses desde la compra o la última recarga');
    else L.push(...empaquetar([`Item #: ${l.item_no ?? 'pendiente'}`, `Código: ${l.codigo}`], c));
    L.push(dos(l.qty === 1 ? '' : `c/u ${formatoMXN(l.precio_unit)}`, formatoMXN(l.qty * l.precio_unit), c));
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
  L.push(regla, dos('TOTAL', formatoMXN(t.total), c));
  for (const p of t.pagos) {
    L.push(dos(p.etiqueta, formatoMXN(p.monto), c));
    if (p.tarjeta) L.push(dos(`  Tarjeta: ${p.tarjeta}`, p.saldo_despues !== undefined ? `Saldo ${formatoMXN(p.saldo_despues)}` : '', c));
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
  return L.join('\n') + '\n';
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
  b.push(...aCP858(renderTicketTexto(t).replace(/\n$/, '')), 0x0a);
  const datos = aCP858(`{B${t.codigo_ticket}`); // Code128 juego B
  b.push(0x1b, 0x61, 1); // centrar
  b.push(0x1d, 0x68, 80, 0x1d, 0x77, 2, 0x1d, 0x48, 0); // alto, ancho, sin texto HRI (ya va impreso)
  b.push(0x1d, 0x6b, 73, datos.length, ...datos); // GS k 73 n d1..dn
  b.push(0x0a, 0x0a, 0x0a);
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
  const L: string[] = [centrar(cfg.nombre, c), ...encabezadoDe(cfg).flatMap((x) => envolver(x, c).map((y) => centrar(y, c))), centrar(`Tienda ${d.tienda} - Caja ${d.caja}`, c), centrar('DEVOLUCIÓN', c)];
  L.push(`Cajero: ${d.cajero}`, `Fecha: ${dd}/${mo}/${y}  Hora: ${local.slice(11, 16)}`, `Folio: ${String(d.folio ?? 0).padStart(6, '0')}`);
  L.push(`Venta original: ${codigoTicket(v.tienda, v.caja, v.folio, negocios)}`, regla);
  for (const dl of d.lineas) {
    const l = v.lineas.find((x) => x.linea_id === dl.linea_id)!;
    L.push(...renglonArticulo({ ...l, qty: dl.qty, tarjeta_regalo: !!l.tarjeta_regalo }, c));
    L.push(...empaquetar([`Item #: ${l.item_no ?? 'pendiente'}`, `Código: ${l.codigo}`], c));
    L.push(dos('', formatoMXN(dl.importe), c));
  }
  L.push(regla, dos('TOTAL DEVUELTO', formatoMXN(d.importe), c));
  for (const r of d.reembolsos) L.push(dos(r.metodo === 'efectivo' ? 'Reembolso en efectivo MXN' : r.metodo === 'tarjeta' ? 'Reverso a tarjeta bancaria' : `A tarjeta de regalo ${r.tarjeta}`, formatoMXN(r.monto), c));
  L.push(regla, centrar(codigoTicket(d.tienda, d.caja, d.folio ?? 0, negocios), c));
  return L.join('\n') + '\n';
}

/** Texto plano a ESC/POS (mismo supuesto de página de códigos que el ticket; sin validar en equipo real). */
export function renderTextoEscPos(texto: string, opts: { abrirCajon?: boolean } = {}): Uint8Array {
  const b: number[] = [0x1b, 0x40, 0x1b, 0x74, 19];
  if (opts.abrirCajon) b.push(0x1b, 0x70, 0x00, 25, 250);
  b.push(...aCP858(texto.replace(/\n$/, '')), 0x0a, 0x0a, 0x0a, 0x1d, 0x56, 66, 0);
  return Uint8Array.from(b);
}
