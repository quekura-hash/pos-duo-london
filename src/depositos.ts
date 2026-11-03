// ── Depósitos en garantía (pruebas de vestidos de noche) ──
// Un depósito NO es una venta: es dinero que la clienta deja como garantía. Su saldo se calcula SIEMPRE desde las operaciones (nunca se edita):
//   saldo = recibido − devuelto − retenido (fee por daño) − aplicado a una compra + reintegrado (compra cancelada).
// El efectivo físico entra y sale por `cash.movement` (tipos `deposito_recibido` / `deposito_devuelto`); aplicar o retener NO mueve efectivo.
import type { Op } from './tipos.ts';
import { fechaLocal } from './util.ts';

export type EstadoDeposito = 'pendiente' | 'parcial' | 'cerrado';
export interface MovDeposito {
  op_id: string;
  tipo: 'recibido' | 'devuelto' | 'fee' | 'aplicado' | 'reintegrado';
  monto: number;
  ocurrio_en: string;
  tienda: string;
  caja: number;
  usuario?: string;
  autorizado_por?: string | null;
  /** Cómo se comprobó que quien resuelve el depósito es quien debe: con el código del comprobante o con doble clave (comprobante extraviado). */
  verificado_con?: 'ticket' | 'doble_clave';
  motivo?: string;
  sale_id?: string;
}
export interface Deposito {
  deposito_id: string;
  /** Código secreto del comprobante (viaja dentro del código de barras junto con el folio). Nunca sale por la API de la interfaz. */
  secreto: string;
  /** Folio único en todo el sistema (serie propia por caja, nunca el contador de ventas). Es también el texto del código de barras. */
  folio: string;
  tienda: string;
  caja: number;
  cajero: string;
  clienta: string;
  concepto: string;
  /** Importe original recibido. */
  monto: number;
  fecha: string;
  ocurrio_en: string;
  devuelto: number;
  retenido: number;
  aplicado: number;
  reintegrado: number;
  saldo: number;
  estado: EstadoDeposito;
  /** Dos cajas resolvieron el mismo depósito sin verse: el saldo quedaría negativo. Se marca para revisión de Administración. */
  inconsistente: boolean;
  movimientos: MovDeposito[];
}
/** Texto del código de barras del comprobante: folio + secreto. Quien lo escanea demuestra que tiene el comprobante. */
export const codigoTicketDeposito = (d: { folio: string; secreto: string }) => `${d.folio}-${d.secreto}`;
const ALFABETO = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
/** Secreto aleatorio de 6 caracteres (sin letras ambiguas): se imprime en el comprobante, así que también se puede teclear. */
export function generarSecretoDeposito(): string {
  const b = new Uint8Array(6);
  globalThis.crypto.getRandomValues(b);
  return [...b].map((x) => ALFABETO[x % ALFABETO.length]).join('');
}
/** Separa lo que leyó el lector (`DEP-D1-0001-K7M2Q9`) o escribió la cajera (`DEP-D1-0001`) en folio y, si lo trae, secreto. */
export function interpretarCodigoDeposito(s: string): { folio: string; secreto: string | null } | null {
  const m = /^(DEP-[A-Z0-9]+-\d+)(?:-([A-Z0-9]{6}))?$/i.exec(s.trim());
  return m ? { folio: m[1]!.toUpperCase(), secreto: m[2] ? m[2].toUpperCase() : null } : null;
}

export const TIPOS_DEPOSITO = ['deposito.recibido', 'deposito.devuelto', 'deposito.fee', 'deposito.aplicado', 'deposito.reintegrado'] as const;
/** Prefijo de los tipos de operación de depósitos. */
export const esOpDeposito = (tipo: string) => tipo.startsWith('deposito.');

/** Folio de depósito: DEP-<tienda><caja>-<n>. Cada caja lleva su propia serie, así que es único aunque las cajas trabajen sin conexión. */
export function folioDeposito(tienda: string, caja: number, n: number): string {
  const t = tienda === 'DUO' ? 'D' : tienda === 'LON' ? 'L' : tienda.slice(0, 1).toUpperCase();
  return `DEP-${t}${caja}-${String(n).padStart(4, '0')}`;
}
/** ¿El texto parece un folio de depósito? (los códigos de ticket de venta son D1-000001, sin «DEP-»). */
export const esFolioDeposito = (s: string) => interpretarCodigoDeposito(s) !== null;

/** Todos los depósitos con su saldo y su historial (más recientes primero no: el orden lo decide quien consulta). */
export function depositos(ops: Op[]): Map<string, Deposito> {
  const m = new Map<string, Deposito>();
  const mov = (id: string): Deposito | undefined => m.get(id);
  for (const o of ops) {
    const p = o.payload;
    if (o.tipo === 'deposito.recibido') {
      if (m.has(p.deposito_id)) continue; // misma operación repetida: no se duplica
      m.set(p.deposito_id, {
        deposito_id: p.deposito_id, secreto: p.secreto ?? '', folio: p.folio, tienda: p.tienda, caja: p.caja, cajero: p.cajero, clienta: p.clienta, concepto: p.concepto ?? '', monto: p.monto,
        fecha: p.fecha ?? fechaLocal(o.ocurrio_en), ocurrio_en: o.ocurrio_en, devuelto: 0, retenido: 0, aplicado: 0, reintegrado: 0, saldo: p.monto, estado: 'pendiente', inconsistente: false,
        movimientos: [{ op_id: o.op_id, tipo: 'recibido', monto: p.monto, ocurrio_en: o.ocurrio_en, tienda: p.tienda, caja: p.caja, usuario: p.cajero }],
      });
      continue;
    }
    if (!esOpDeposito(o.tipo)) continue;
    const d = mov(p.deposito_id);
    if (!d) continue; // la resolución llegó antes que el depósito: se aplica cuando llegue (el orden de proyección es el de la bitácora)
    const tipo = o.tipo.slice('deposito.'.length) as MovDeposito['tipo'];
    d.movimientos.push({ op_id: o.op_id, tipo, monto: p.monto, ocurrio_en: o.ocurrio_en, tienda: p.tienda, caja: p.caja, usuario: p.usuario, autorizado_por: p.autorizado_por ?? null, ...(p.verificado_con ? { verificado_con: p.verificado_con } : {}), ...(p.motivo ? { motivo: p.motivo } : {}), ...(p.sale_id ? { sale_id: p.sale_id } : {}) });
    if (tipo === 'devuelto') d.devuelto += p.monto;
    else if (tipo === 'fee') d.retenido += p.monto;
    else if (tipo === 'aplicado') d.aplicado += p.monto;
    else if (tipo === 'reintegrado') d.reintegrado += p.monto;
  }
  for (const d of m.values()) {
    d.saldo = d.monto - d.devuelto - d.retenido - d.aplicado + d.reintegrado;
    d.inconsistente = d.saldo < 0;
    d.estado = d.saldo <= 0 ? 'cerrado' : d.movimientos.length > 1 ? 'parcial' : 'pendiente';
  }
  return m;
}

/** Búsqueda: folio exacto (o el que escaneó el lector), y para nombres, coincidencia parcial sin importar mayúsculas ni acentos. */
export function buscarDepositos(todos: Deposito[], q: string): Deposito[] {
  const limpio = q.trim();
  if (!limpio) return [];
  const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
  const cod = interpretarCodigoDeposito(limpio);
  if (cod) return todos.filter((d) => d.folio === cod.folio);
  const n = norm(limpio);
  return todos.filter((d) => norm(d.clienta).includes(n) || norm(d.folio).includes(n));
}

/** Resumen para el corte de caja de una fecha (solo depósitos y movimientos de ESA caja). */
export interface ResumenDepositosCaja {
  recibidos: number; recibidos_n: number;
  devueltos: number; devueltos_n: number;
  aplicados: number; aplicados_n: number;
  fees: number; fees_n: number;
  reintegrados: number;
  /** Lo que la caja todavía debe a clientas por depósitos abiertos (de los recibidos en esta caja, a hoy). */
  pendiente: number; pendiente_n: number;
}
export function resumenDepositosCaja(ops: Op[], tienda: string, caja: number, fecha: string): ResumenDepositosCaja {
  const r: ResumenDepositosCaja = { recibidos: 0, recibidos_n: 0, devueltos: 0, devueltos_n: 0, aplicados: 0, aplicados_n: 0, fees: 0, fees_n: 0, reintegrados: 0, pendiente: 0, pendiente_n: 0 };
  const todos = depositos(ops);
  for (const d of todos.values()) {
    for (const x of d.movimientos) {
      if (x.tienda !== tienda || x.caja !== caja || fechaLocal(x.ocurrio_en) !== fecha) continue;
      if (x.tipo === 'recibido') { r.recibidos += x.monto; r.recibidos_n++; }
      else if (x.tipo === 'devuelto') { r.devueltos += x.monto; r.devueltos_n++; }
      else if (x.tipo === 'aplicado') { r.aplicados += x.monto; r.aplicados_n++; }
      else if (x.tipo === 'fee') { r.fees += x.monto; r.fees_n++; }
      else if (x.tipo === 'reintegrado') r.reintegrados += x.monto;
    }
    if (d.tienda === tienda && d.caja === caja && d.saldo > 0 && d.fecha <= fecha) { r.pendiente += d.saldo; r.pendiente_n++; }
  }
  return r;
}

/** Movimientos de depósitos de un día para el resumen de Administración, de una tienda y caja o de todas (`null`). */
export function resumenDepositosDia(ops: Op[], fecha: string, tienda: string | null, caja: number | null = null): Omit<ResumenDepositosCaja, 'pendiente' | 'pendiente_n'> & { pendiente: number; pendiente_n: number } {
  const r = { recibidos: 0, recibidos_n: 0, devueltos: 0, devueltos_n: 0, aplicados: 0, aplicados_n: 0, fees: 0, fees_n: 0, reintegrados: 0, pendiente: 0, pendiente_n: 0 };
  const aqui = (t: string, c: number) => (tienda === null || t === tienda) && (caja === null || c === caja);
  for (const d of depositos(ops).values()) {
    for (const x of d.movimientos) {
      if (!aqui(x.tienda, x.caja) || fechaLocal(x.ocurrio_en) !== fecha) continue;
      if (x.tipo === 'recibido') { r.recibidos += x.monto; r.recibidos_n++; }
      else if (x.tipo === 'devuelto') { r.devueltos += x.monto; r.devueltos_n++; }
      else if (x.tipo === 'aplicado') { r.aplicados += x.monto; r.aplicados_n++; }
      else if (x.tipo === 'fee') { r.fees += x.monto; r.fees_n++; }
      else if (x.tipo === 'reintegrado') r.reintegrados += x.monto;
    }
    if (aqui(d.tienda, d.caja) && d.saldo > 0 && d.fecha <= fecha) { r.pendiente += d.saldo; r.pendiente_n++; }
  }
  return r;
}
