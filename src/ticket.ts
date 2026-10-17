import type { Venta } from './tipos.ts';
import { fechaLocal } from './util.ts';

/** MXN desde centavos enteros, sin coma flotante: 123450 -> "$1,234.50". */
export function formatoMXN(centavos: number): string {
  const neg = centavos < 0;
  const a = Math.abs(centavos);
  const ent = String(Math.floor(a / 100)).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${neg ? '-' : ''}$${ent}.${String(a % 100).padStart(2, '0')}`;
}

export interface NegocioCfg {
  nombre: string;
  /** Letra que identifica la tienda en el código del ticket. */
  letra: string;
  /** Leyendas al pie, CONFIGURABLES. "No hacemos devoluciones de efectivo" es un aviso al cliente, no un bloqueo del programa. */
  leyendas: string[];
  /** Caracteres por renglón. 42 es un supuesto para 58 mm; el ancho real depende del papel y la fuente de la impresora (pendiente). */
  columnas: number;
}

export const NEGOCIOS: Record<string, NegocioCfg> = {
  DUO: { nombre: 'DÚO New York', letra: 'D', leyendas: ['No hacemos devoluciones de efectivo'], columnas: 42 },
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
  pagos: { etiqueta: string; monto: number; recibido?: number; cambio?: number; tarjeta?: string; saldo_despues?: number }[];
  leyendas: string[];
  columnas: number;
  reimpresion: number;
}

export function construirTicket(v: Venta, cfg: NegocioCfg = NEGOCIOS[v.tienda]!, reimpresion = 0, negocios = NEGOCIOS): Ticket {
  const local = new Date(Date.parse(v.ocurrio_en) - 7 * 3600_000).toISOString();
  const [y, mo, d] = fechaLocal(v.ocurrio_en).split('-');
  return {
    negocio: cfg.nombre, tienda: v.tienda, caja: v.caja, cajero: v.cajero,
    fecha: `${d}/${mo}/${y}`, hora: local.slice(11, 16), folio: v.folio, codigo_ticket: codigoTicket(v.tienda, v.caja, v.folio, negocios),
    lineas: v.lineas.map((l) => ({
      item_no: l.item_no, codigo: l.codigo, descripcion: l.descripcion, marca: l.marca, estilo: l.estilo, lote: l.lote,
      qty: l.qty, precio_unit: l.precio_unit, descuento: l.descuento, importe: l.importe,
    })),
    total: v.total,
    pagos: v.pagos.map((p) => ({ etiqueta: p.metodo === 'efectivo' ? 'Efectivo MXN' : p.metodo === 'tarjeta_regalo' ? 'Tarjeta de regalo' : 'Tarjeta', monto: p.monto, recibido: p.recibido, cambio: p.cambio, tarjeta: p.tarjeta, saldo_despues: p.saldo_despues })),
    leyendas: cfg.leyendas, columnas: cfg.columnas, reimpresion,
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
const centrar = (t: string, cols: number) => ' '.repeat(Math.max(0, Math.floor((cols - t.length) / 2))) + t;
const dos = (izq: string, der: string, cols: number) => izq + ' '.repeat(Math.max(1, cols - izq.length - der.length)) + der;

/**
 * Texto del ticket. Precios finales y total neto: NO hay renglón de IVA, impuesto ni porcentaje alguno (presentación
 * comercial; no implica que los productos sean fiscalmente exentos). Los campos del artículo van separados y rotulados.
 */
export function renderTicketTexto(t: Ticket): string {
  const c = t.columnas;
  const regla = '-'.repeat(c);
  const L: string[] = [];
  L.push(centrar(t.negocio, c), centrar(`Tienda ${t.tienda} - Caja ${t.caja}`, c));
  L.push(`Cajero: ${t.cajero}`, `Fecha: ${t.fecha}  Hora: ${t.hora}`, `Folio: ${String(t.folio).padStart(6, '0')}`);
  if (t.reimpresion > 0) L.push(centrar(`*** REIMPRESIÓN ${t.reimpresion} ***`, c));
  L.push(regla);
  for (const l of t.lineas) {
    L.push(...envolver(l.descripcion, c));
    L.push(...empaquetar([`Item #: ${l.item_no ?? 'pendiente'}`, `Código: ${l.codigo}`], c));
    L.push(...empaquetar([`Marca: ${l.marca}`, `Estilo: ${l.estilo}`, `Lote: ${l.lote}`], c));
    L.push(dos(`${l.qty} x ${formatoMXN(l.precio_unit)}`, formatoMXN(l.qty * l.precio_unit), c));
    if (l.descuento > 0) L.push(dos('Descuento', `-${formatoMXN(l.descuento)}`, c));
  }
  L.push(regla, dos('TOTAL', formatoMXN(t.total), c));
  for (const p of t.pagos) {
    L.push(dos(p.etiqueta, formatoMXN(p.monto), c));
    if (p.tarjeta) L.push(dos(`  Tarjeta: ${p.tarjeta}`, p.saldo_despues !== undefined ? `Saldo ${formatoMXN(p.saldo_despues)}` : '', c));
    if (p.recibido !== undefined) L.push(dos('Recibido', formatoMXN(p.recibido), c), dos('Cambio', formatoMXN(p.cambio ?? 0), c));
  }
  L.push(regla);
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

export function renderTicketEscPos(t: Ticket, opts: { abrirCajon?: boolean } = {}): Uint8Array {
  const b: number[] = [];
  b.push(0x1b, 0x40); // ESC @ inicializar
  b.push(0x1b, 0x74, 19); // ESC t 19: página de códigos PC858 (acentos del español)
  if (opts.abrirCajon) b.push(0x1b, 0x70, 0x00, 25, 250); // ESC p: pulso al cajón
  b.push(...aCP858(renderTicketTexto(t).replace(/\n$/, '')), 0x0a);
  const datos = aCP858(`{B${t.codigo_ticket}`); // Code128 juego B
  b.push(0x1b, 0x61, 1); // centrar
  b.push(0x1d, 0x68, 80, 0x1d, 0x77, 2, 0x1d, 0x48, 0); // alto, ancho, sin texto HRI (ya va impreso)
  b.push(0x1d, 0x6b, 73, datos.length, ...datos); // GS k 73 n d1..dn
  b.push(0x0a, 0x0a, 0x0a);
  b.push(0x1d, 0x56, 66, 0); // GS V 66 0: avance y corte parcial
  return Uint8Array.from(b);
}

// ── comprobante de emisión de una tarjeta de regalo (NO es un ticket de venta: sin folio de venta ni serie) ──
export interface ComprobanteRegalo {
  negocio: string;
  tienda: string;
  caja: number;
  cajero: string;
  fecha: string;
  hora: string;
  codigo: string;
  monto: number;
  columnas: number;
}

export function construirComprobanteRegalo(e: { codigo: string; monto: number; tienda: string; caja: number; cajero: string; ocurrio_en: string }, negocios = NEGOCIOS): ComprobanteRegalo {
  const cfg = negocios[e.tienda]!;
  const local = new Date(Date.parse(e.ocurrio_en) - 7 * 3600_000).toISOString();
  const [y, mo, d] = fechaLocal(e.ocurrio_en).split('-');
  return { negocio: cfg.nombre, tienda: e.tienda, caja: e.caja, cajero: e.cajero, fecha: `${d}/${mo}/${y}`, hora: local.slice(11, 16), codigo: e.codigo, monto: e.monto, columnas: cfg.columnas };
}

export function renderComprobanteRegaloTexto(t: ComprobanteRegalo): string {
  const c = t.columnas;
  const regla = '-'.repeat(c);
  return [
    centrar(t.negocio, c), centrar(`Tienda ${t.tienda} - Caja ${t.caja}`, c), centrar('TARJETA DE REGALO', c), regla,
    `Cajero: ${t.cajero}`, `Fecha: ${t.fecha}  Hora: ${t.hora}`, `Código: ${t.codigo}`,
    dos('Saldo cargado', formatoMXN(t.monto), c), regla,
    ...envolver('Comprobante de alta de tarjeta de regalo. No es un ticket de venta.', c).map((x) => centrar(x, c)),
  ].join('\n') + '\n';
}

/** Texto plano a ESC/POS (mismo supuesto de página de códigos que el ticket; sin validar en equipo real). */
export function renderTextoEscPos(texto: string, opts: { abrirCajon?: boolean } = {}): Uint8Array {
  const b: number[] = [0x1b, 0x40, 0x1b, 0x74, 19];
  if (opts.abrirCajon) b.push(0x1b, 0x70, 0x00, 25, 250);
  b.push(...aCP858(texto.replace(/\n$/, '')), 0x0a, 0x0a, 0x0a, 0x1d, 0x56, 66, 0);
  return Uint8Array.from(b);
}
