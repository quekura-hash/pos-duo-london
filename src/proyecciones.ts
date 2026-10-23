import type { Articulo, Op, Venta } from './tipos.ts';
import { aplicarOpDepto, copiarBase, type Departamento } from './departamentos.ts';
import { fechaLocal } from './util.ts';

// Proyecciones puras sobre la bitácora. El estado derivado nunca se sincroniza: se recalcula.

import { resolucionesFaltantes } from './almacen.ts';
export function catalogo(ops: Op[]): Map<string, Articulo> {
  const m = new Map<string, Articulo>();
  for (const o of ops) {
    if (o.tipo === 'item.created') m.set(o.payload.item_id, { ...o.payload });
    // Renombrar un departamento actualiza los artículos que ya lo usan.
    if (o.tipo === 'depto.editado' && o.payload.nombre_anterior != null) {
      for (const a of m.values()) if (a.departamento === o.payload.nombre_anterior) a.departamento = o.payload.nombre;
    }
  }
  for (const o of ops) {
    if (o.tipo === 'item.item_no_assigned') {
      const a = m.get(o.payload.item_id);
      if (a && a.item_no == null) a.item_no = o.payload.item_no;
    }
    // Ediciones del catálogo hechas en Administración (marca, descripción, estilo, lote, departamento, precio).
    if (o.tipo === 'item.editado') {
      const a = m.get(o.payload.item_id);
      if (a) for (const [campo, c] of Object.entries(o.payload.cambios as Record<string, { despues: unknown }>)) (a as any)[campo] = c.despues;
    }
    // Resoluciones administrativas de códigos duplicados (con auditoría en el payload).
    if (o.tipo === 'item.codigo_corregido') {
      const a = m.get(o.payload.item_id);
      if (a) a.codigo = o.payload.codigo_nuevo;
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
  // Piezas faltantes que Administración ubicó en esta tienda.
  for (const r of resolucionesFaltantes(ops).values()) if (r.destino === tienda && r.qty > 0) m.set(r.item_id, (m.get(r.item_id) ?? 0) + r.qty);
  return m;
}

export interface ExistenciaVerificada {
  saldo: number;
  verificada: boolean;
  /** Ids de las marcas `inv.verificacion_pendiente` que aún cubren este artículo. */
  pendientes: string[];
}

/**
 * Una existencia es NO verificada mientras haya una marca de verificación pendiente de la tienda que no haya
 * sido cubierta por un conteo físico de ese artículo. Solo un conteo físico la limpia.
 */
export function existenciaVerificada(ops: Op[], tienda: string, itemId: string): ExistenciaVerificada {
  const pend = ops.filter((o) => o.tipo === 'inv.verificacion_pendiente' && o.payload.tienda === tienda).map((o) => o.op_id);
  const cubiertas = new Set<string>();
  for (const o of ops) {
    if (o.tipo === 'inv.conteo' && o.payload.tienda === tienda && o.payload.item_id === itemId) for (const id of o.payload.cubre) cubiertas.add(id);
  }
  const pendientes = pend.filter((id) => !cubiertas.has(id));
  return { saldo: stock(ops, tienda).get(itemId) ?? 0, verificada: pendientes.length === 0, pendientes };
}

export function ventas(ops: Op[]): Map<string, Venta> {
  const m = new Map<string, Venta>();
  for (const o of ops) {
    if (o.tipo === 'sale.confirmed') {
      const p = o.payload;
      m.set(p.sale_id, {
        sale_id: p.sale_id, tienda: p.tienda, caja: p.caja, folio: p.folio, cajero: p.cajero,
        ocurrio_en: o.ocurrio_en, lineas: p.lineas, total: p.total, pagos: p.pagos, estado: 'confirmada',
        ...(p.vendedora !== undefined ? { vendedora_id: p.vendedora_id ?? null, vendedora: p.vendedora } : {}),
        ...(p.recompensas?.length ? { recompensas: p.recompensas } : {}),
        ...(p.empleada ? { empleada: p.empleada } : {}),
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
  /** Folio de la MISMA serie que las ventas de la caja (P-08). Las devoluciones anteriores a esta regla no lo tienen. */
  folio?: number;
  /** Cómo se regresó el dinero: a la tarjeta de regalo con que se pagó y, el resto, en efectivo. */
  /** `efectivo` = pesos que salen del cajón; `tarjeta` = reverso a la tarjeta bancaria original (no sale efectivo); `tarjeta_regalo` = saldo a la misma tarjeta. */
  reembolsos: { metodo: 'efectivo' | 'tarjeta' | 'tarjeta_regalo' | 'credito_empleada'; monto: number; tarjeta?: string }[];
  ocurrio_en: string;
  motivo: string;
  cajero: string;
  folio_origen: number;
  /** Cambio: las piezas se usaron como crédito de otra venta (`venta_cambio`); `reembolsos` solo trae el saldo entregado en efectivo. */
  por_cambio?: boolean;
  venta_cambio?: string;
  autorizado_por?: string;
  /** Cambios: quién es la clienta y por qué se cambia (se piden al aceptar el cambio). */
  clienta?: { nombre: string; telefono: string };
  motivo_cambio?: string;
}

export function devoluciones(ops: Op[]): Devolucion[] {
  return ops
    .filter((o) => o.tipo === 'return.registered')
    .map((o) => ({ ...o.payload, reembolsos: o.payload.reembolsos ?? [{ metodo: 'efectivo', monto: o.payload.importe }], ocurrio_en: o.ocurrio_en }));
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

export interface PerdidaDocumental {
  perdida_id: string;
  tienda: string;
  caja: number | null;
  ocurrio_en: string;
  alcance: string;
  folios_sin_evidencia: { desde: number; hasta: number } | null;
  evidencia: string;
  estado: 'abierta' | 'declarada_irrecuperable';
  resolucion?: { usuario: string; evidencia: { tipo: string; referencia: string }; nota: string; ocurrio_en: string };
}

/**
 * Pérdida DOCUMENTAL posible: ventas, pagos y folios que nunca salieron de una caja y se perdieron con su disco.
 * Es un registro independiente de la verificación de INVENTARIO: un conteo físico ajusta existencias, pero no
 * devuelve ni reemplaza ventas, pagos ni folios, así que no la cierra. Solo una decisión administrativa
 * documentada cambia su estado (y aun así la venta sigue sin existir en el sistema).
 */
export function perdidasDocumentales(ops: Op[]): PerdidaDocumental[] {
  const m = new Map<string, PerdidaDocumental>();
  for (const o of ops) {
    if (o.tipo === 'doc.perdida_posible') {
      m.set(o.op_id, {
        perdida_id: o.op_id, tienda: o.payload.tienda, caja: o.payload.caja ?? null, ocurrio_en: o.ocurrio_en,
        alcance: o.payload.alcance, folios_sin_evidencia: o.payload.folios_sin_evidencia ?? null, evidencia: o.payload.evidencia, estado: 'abierta',
      });
    }
  }
  for (const o of ops) {
    if (o.tipo === 'doc.perdida_resuelta') {
      const p = m.get(o.payload.perdida_id);
      if (p) {
        p.estado = 'declarada_irrecuperable';
        p.resolucion = { usuario: o.payload.usuario, evidencia: o.payload.evidencia, nota: o.payload.nota, ocurrio_en: o.ocurrio_en };
      }
    }
  }
  return [...m.values()];
}

export interface TarjetaRegalo {
  codigo: string;
  emitido: number;
  recargado: number;
  usado: number;
  reintegrado: number;
  /** Saldo = emitido + recargas − usos + reintegros. */
  saldo: number;
  tienda: string;
  caja: number;
  cajero: string;
  ocurrio_en: string;
  /** Vence 12 meses después de la venta o de la última recarga en efectivo (P-26b). Devoluciones y cancelaciones NO la reinician. */
  vigente_hasta: string;
  /** Altas posteriores con el mismo código (conflicto de negocio: no suman saldo, se señalan). */
  duplicadas: { op_id: string; tienda: string; caja: number; monto: number }[];
}

/** Libro mayor de tarjetas de regalo: el saldo nunca se guarda, se deriva de emisiones, usos y reintegros. */
export function tarjetasRegalo(ops: Op[]): Map<string, TarjetaRegalo> {
  const m = new Map<string, TarjetaRegalo>();
  for (const o of ops) aplicarTarjeta(m, o);
  return m;
}

/** P-26b (decidido): las tarjetas de regalo vencen a los 12 meses. */
export const MESES_VIGENCIA_TARJETA = 12;
export function sumarMeses(iso: string, n: number): string {
  const d = new Date(iso);
  d.setUTCMonth(d.getUTCMonth() + n);
  return d.toISOString();
}

export function aplicarTarjeta(m: Map<string, TarjetaRegalo>, o: { tipo: string; op_id: string; payload: any; ocurrio_en: string }) {
  const p = o.payload;
  if (o.tipo === 'giftcard.emitida') {
    const t = m.get(p.codigo);
    if (t) t.duplicadas.push({ op_id: o.op_id, tienda: p.tienda, caja: p.caja, monto: p.monto });
    else m.set(p.codigo, { codigo: p.codigo, emitido: p.monto, recargado: 0, usado: 0, reintegrado: 0, saldo: p.monto, tienda: p.tienda, caja: p.caja, cajero: p.cajero, ocurrio_en: o.ocurrio_en, vigente_hasta: sumarMeses(o.ocurrio_en, MESES_VIGENCIA_TARJETA), duplicadas: [] });
  } else if (o.tipo === 'giftcard.uso' || o.tipo === 'giftcard.reintegro' || o.tipo === 'giftcard.recarga') {
    const t = m.get(p.codigo);
    if (!t) return;
    if (o.tipo === 'giftcard.uso') t.usado += p.monto;
    else if (o.tipo === 'giftcard.reintegro') t.reintegrado += p.monto;
    else { t.recargado += p.monto; t.vigente_hasta = sumarMeses(o.ocurrio_en, MESES_VIGENCIA_TARJETA); }
    t.saldo = t.emitido + t.recargado - t.usado + t.reintegrado;
  }
}

/** Configuración global versionada: el tipo de cambio comercial (MXN por 1 USD) que fija el negocio. */
export interface TipoCambio {
  version: number;
  /** MXN por 1 USD ×10000 (ver dinero.ts). */
  tasa: number;
  usuario: string;
  ocurrio_en: string;
  anterior: { version: number; tasa: number } | null;
}
export function tiposDeCambio(ops: Op[]): TipoCambio[] {
  const m = new Map<number, TipoCambio>();
  for (const o of ops) if (o.tipo === 'config.tipo_cambio') m.set(o.payload.version, { ...o.payload, ocurrio_en: o.ocurrio_en });
  return [...m.values()].sort((a, b) => a.version - b.version);
}
/** La vigente es la de MAYOR versión, sin importar en qué orden llegaron: una actualización vieja nunca pisa una nueva. */
export const tipoCambioVigente = (ops: Op[]): TipoCambio | null => tiposDeCambio(ops).at(-1) ?? null;

/** Permisos por usuario asignados desde Administración (`permiso.asignado`); el último gana. */
export function permisos(ops: Op[]): Map<string, Set<string>> {
  const m = new Map<string, Set<string>>();
  for (const o of ops) aplicarPermiso(m, o);
  return m;
}
export function aplicarPermiso(m: Map<string, Set<string>>, o: { tipo: string; payload: any }) {
  if (o.tipo !== 'permiso.asignado') return;
  const s = m.get(o.payload.usuario) ?? new Set<string>();
  if (o.payload.valor) s.add(o.payload.permiso); else s.delete(o.payload.permiso);
  m.set(o.payload.usuario, s);
}

/**
 * Libro de movimientos FÍSICOS de una caja, por moneda. Es una proyección de operaciones inmutables: nada se borra ni se edita,
 * así que ningún corte se cuadra quitando movimientos. Signo: + entra al cajón, − sale.
 *  - cobro: lo recibido (pesos o dólares); cambio: pesos entregados; devolucion / cancelacion: pesos que salen por un reembolso.
 *  - Una venta cancelada DESPUÉS de recibir dinero conserva su cobro y su cambio y suma el movimiento de la cancelación.
 */
export interface MovimientoCaja {
  ocurrio_en: string;
  fecha: string;
  moneda: 'MXN' | 'USD';
  tipo: 'fondo_inicial' | 'entrada' | 'retiro' | 'cobro' | 'cambio' | 'devolucion' | 'cancelacion' | 'ajuste';
  monto: number;
  ref?: string;
  /** Solo dólares de un cobro: tasa de ESA operación. */
  tasa?: number;
  tasa_version?: number;
}
export function efectivoDeVenta(v: Venta): number {
  return v.pagos.filter((p) => p.metodo === 'efectivo' || p.metodo === 'efectivo_usd').reduce((a, p) => a + p.monto, 0);
}
export function movimientosCaja(ops: Op[], tienda: string, caja: number): MovimientoCaja[] {
  const out: MovimientoCaja[] = [];
  const vs = ventas(ops);
  const propia = (t: string | null | undefined, c: number | null | undefined) => t === tienda && c === caja;
  for (const o of ops) {
    const p = o.payload;
    if (o.tipo === 'cash.movement' && propia(p.tienda, p.caja)) {
      out.push({ ocurrio_en: o.ocurrio_en, fecha: p.fecha, moneda: p.moneda ?? 'MXN', tipo: p.tipo, monto: p.tipo === 'retiro' ? -p.monto : p.monto, ref: o.op_id });
    } else if (o.tipo === 'cash.ajuste_admin' && propia(p.tienda, p.caja)) {
      // Entrega o ajuste hecho por Administración: suma (entrega) o resta (salida) en pesos; no es venta ni retiro.
      out.push({ ocurrio_en: o.ocurrio_en, fecha: p.fecha, moneda: 'MXN', tipo: 'ajuste', monto: p.tipo === 'salida' ? -p.monto : p.monto, ref: o.op_id });
    } else if (o.tipo === 'sale.confirmed' && propia(p.tienda, p.caja)) {
      const fecha = fechaLocal(o.ocurrio_en);
      for (const pg of p.pagos as Venta['pagos']) {
        if (pg.metodo === 'efectivo') {
          out.push({ ocurrio_en: o.ocurrio_en, fecha, moneda: 'MXN', tipo: 'cobro', monto: pg.recibido ?? pg.monto, ref: p.sale_id });
          if ((pg.cambio ?? 0) > 0) out.push({ ocurrio_en: o.ocurrio_en, fecha, moneda: 'MXN', tipo: 'cambio', monto: -pg.cambio!, ref: p.sale_id });
        } else if (pg.metodo === 'efectivo_usd') {
          out.push({ ocurrio_en: o.ocurrio_en, fecha, moneda: 'USD', tipo: 'cobro', monto: pg.usd!, ref: p.sale_id, tasa: pg.tasa, tasa_version: pg.tasa_version });
          if (pg.pesos_recibidos! > 0) out.push({ ocurrio_en: o.ocurrio_en, fecha, moneda: 'MXN', tipo: 'cobro', monto: pg.pesos_recibidos!, ref: p.sale_id });
          if (pg.cambio_mxn! > 0) out.push({ ocurrio_en: o.ocurrio_en, fecha, moneda: 'MXN', tipo: 'cambio', monto: -pg.cambio_mxn!, ref: p.sale_id });
        }
      }
    } else if (o.tipo === 'return.registered' && propia(p.tienda, p.caja)) {
      const efectivo = ((p.reembolsos ?? [{ metodo: 'efectivo', monto: p.importe }]) as { metodo: string; monto: number }[]).filter((r) => r.metodo === 'efectivo').reduce((a, r) => a + r.monto, 0);
      if (efectivo > 0) out.push({ ocurrio_en: o.ocurrio_en, fecha: fechaLocal(o.ocurrio_en), moneda: 'MXN', tipo: 'devolucion', monto: -efectivo, ref: p.devolucion_id });
    } else if (o.tipo === 'sale.cancelled') {
      const v = vs.get(p.sale_id);
      if (!v || !propia(v.tienda, v.caja)) continue;
      // Cancelada después de recibir efectivo: los pesos reembolsados salen del cajón (importes originales, sin recalcular con otra tasa).
      const efectivo = p.reembolsos ? (p.reembolsos as { metodo: string; monto: number }[]).filter((r) => r.metodo === 'efectivo').reduce((a, r) => a + r.monto, 0) : efectivoDeVenta(v);
      if (efectivo > 0) out.push({ ocurrio_en: o.ocurrio_en, fecha: fechaLocal(o.ocurrio_en), moneda: 'MXN', tipo: 'cancelacion', monto: -efectivo, ref: p.sale_id });
    }
  }
  return out;
}

/** Catálogo de departamentos: el inicial más las operaciones `depto.alta` / `depto.editado` del central, en orden. */
export function departamentos(ops: Op[]): Departamento[] {
  const l = copiarBase();
  for (const o of ops) aplicarOpDepto(l, o);
  return l;
}

/** Promociones y cupones: el último `promo.guardada` de cada id. */
export function promocionesDe(ops: Op[]): import('./promociones.ts').Promocion[] {
  const m = new Map<string, import('./promociones.ts').Promocion>();
  for (const o of ops) if (o.tipo === 'promo.guardada') m.set(o.payload.id, o.payload);
  return [...m.values()];
}
/** Minutos de inactividad tras los que se cierra la sesión (0 = nunca). El último registro manda. Sin registro: caja 10 y Administración 15. */
export interface ConfigSesion { caja_min: number; admin_min: number }
export const CONFIG_SESION_INICIAL: ConfigSesion = { caja_min: 10, admin_min: 15 };
export function configSesionDe(ops: Op[]): ConfigSesion {
  const c = { ...CONFIG_SESION_INICIAL };
  for (const o of ops) if (o.tipo === 'config.sesion') { c.caja_min = o.payload.caja_min; c.admin_min = o.payload.admin_min; }
  return c;
}
export function administradoresDe(ops: Op[]): import('./supervisores.ts').Administrador[] {
  const m = new Map<string, import('./supervisores.ts').Administrador>();
  for (const o of ops) if (o.tipo === 'admin.guardado') m.set(o.payload.id, o.payload);
  return [...m.values()];
}
export function cajerosDe(ops: Op[]): import('./supervisores.ts').Cajero[] {
  const m = new Map<string, import('./supervisores.ts').Cajero>();
  const tienda = new Map<string, { tienda: string; en: string }>();
  for (const o of ops) {
    if (o.tipo === 'cajero.guardado') {
      if (o.payload.eliminado) { m.delete(o.payload.id); tienda.delete(o.payload.id); } // eliminada: ya no existe para nadie (la bitácora conserva lo que pasó)
      else { m.set(o.payload.id, o.payload); if (typeof o.payload.tienda === 'string') tienda.set(o.payload.id, { tienda: o.payload.tienda, en: o.ocurrio_en }); }
    }
    else if (o.tipo === 'cajero.ubicacion' && typeof o.payload.tienda === 'string') { const p = tienda.get(o.payload.cajero_id); if (!p || p.en <= o.ocurrio_en) tienda.set(o.payload.cajero_id, { tienda: o.payload.tienda, en: o.ocurrio_en }); }
  }
  return [...m.values()].map((c) => { const t = tienda.get(c.id)?.tienda; return t === undefined ? c : { ...c, tienda: t }; });
}

/**
 * Expediente PRIVADO de una trabajadora (solo Administración, y solo con la clave de un supervisor): fechas, recontratable, calificaciones y notas.
 * Vive en operaciones `trabajadora.expediente` que no se reparten a las tiendas ni a las cajas; la última de cada trabajadora manda.
 */
export const CRITERIOS_EXPEDIENTE = ['puntualidad', 'presentacion', 'inasistencias', 'facilidad_palabra', 'vendedora', 'humildad'] as const;
export type CriterioExpediente = (typeof CRITERIOS_EXPEDIENTE)[number];
export interface Expediente {
  cajero_id: string;
  /** Día en que empezó a trabajar (lo captura el propietario; puede ser anterior al registro en el sistema). */
  fecha_alta: string | null;
  /** Día en que dejó de trabajar (inactividad). Se conserva el registro. */
  fecha_baja: string | null;
  recontratable: boolean | null;
  notas: string;
  /** 1 (muy mal) a 5 (excelente) en cada criterio; null = sin calificar. En «inasistencias» 5 = nunca falta. */
  calificaciones: Record<CriterioExpediente, number | null>;
  actualizado_en: string;
  por: string;
}
export const expedienteVacio = (cajeroId: string): Expediente => ({ cajero_id: cajeroId, fecha_alta: null, fecha_baja: null, recontratable: null, notas: '', calificaciones: { puntualidad: null, presentacion: null, inasistencias: null, facilidad_palabra: null, vendedora: null, humildad: null }, actualizado_en: '', por: '' });
export function expedientesDe(ops: Op[]): Map<string, Expediente> {
  const m = new Map<string, Expediente>();
  for (const o of ops) if (o.tipo === 'trabajadora.expediente') m.set(o.payload.cajero_id, { ...expedienteVacio(o.payload.cajero_id), ...o.payload, actualizado_en: o.ocurrio_en });
  return m;
}
/** Cuándo se dio de alta en el sistema (primer registro de la trabajadora). */
export function registradaEn(ops: Op[], cajeroId: string): string | null {
  for (const o of ops) if (o.tipo === 'cajero.guardado' && o.payload.id === cajeroId) return o.ocurrio_en;
  return null;
}
export function supervisoresDe(ops: Op[]): import('./supervisores.ts').Supervisor[] {
  const m = new Map<string, import('./supervisores.ts').Supervisor>();
  for (const o of ops) if (o.tipo === 'supervisor.guardado') m.set(o.payload.id, o.payload);
  return [...m.values()];
}

/** Datos de cada tienda editados en Administración. Cada campo es opcional: sin dato vale el de fábrica; cadena vacía = «no mostrar». */
export interface DatosTienda { nombre?: string; razon_social?: string; rfc?: string; direccion?: string; ciudad?: string; telefono?: string; politica?: string }
export const CAMPOS_TIENDA = ['nombre', 'razon_social', 'rfc', 'direccion', 'ciudad', 'telefono', 'politica'] as const;
export function datosTiendas(ops: Op[]): Map<string, DatosTienda> {
  const m = new Map<string, DatosTienda>();
  for (const o of ops) if (o.tipo === 'config.negocio') {
    const x = m.get(o.payload.tienda) ?? {};
    for (const c of CAMPOS_TIENDA) if (typeof o.payload[c] === 'string') x[c] = o.payload[c];
    m.set(o.payload.tienda, x);
  }
  return m;
}
/** Nombres comerciales de tienda editados en Administración (el último de cada tienda). */
export function nombresTienda(ops: Op[]): Map<string, string> {
  const m = new Map<string, string>();
  for (const [t, d] of datosTiendas(ops)) if (d.nombre) m.set(t, d.nombre);
  return m;
}

export const CAMPOS_EDITABLES = ['marca', 'descripcion', 'estilo', 'lote', 'departamento', 'precio'] as const;
export type CampoEditable = (typeof CAMPOS_EDITABLES)[number];

export interface EventoArticulo {
  ocurrio_en: string;
  tipo: 'alta' | 'cambio' | 'almacen_correccion' | 'almacen_entrada' | 'almacen_entrega' | 'recepcion' | 'venta' | 'venta_cancelada' | 'devolucion' | 'conteo' | 'limbo_ubicacion' | 'ajuste_existencias';
  /** Magnitudes en crudo; el texto lo arma quien lo muestra. */
  datos: Record<string, unknown>;
  por: string;
}
/** Historia de un artículo: alta, cambios del catálogo, movimientos del almacén, ventas, cancelaciones, devoluciones y conteos. Más reciente primero. */
export function historialArticulo(ops: Op[], itemId: string): EventoArticulo[] {
  const ev: EventoArticulo[] = [];
  const entradas = new Map<string, { qty: number; pedimento: string | null }>();
  const ventasDe = new Map<string, { tienda: string; caja: number; folio: number; lineas: { item_id: string; qty: number; importe: number }[] }>();
  for (const o of ops) {
    const p = o.payload;
    switch (o.tipo) {
      case 'item.created':
        if (p.item_id === itemId) ev.push({ ocurrio_en: o.ocurrio_en, tipo: 'alta', datos: { origen: p.origen, precio: p.precio, codigo: p.codigo }, por: String(p.origen ?? '') });
        break;
      case 'item.editado':
        if (p.item_id === itemId) ev.push({ ocurrio_en: o.ocurrio_en, tipo: 'cambio', datos: { cambios: p.cambios }, por: p.por ?? '' });
        break;
      case 'alm.entrada':
        if (p.item_id === itemId) { ev.push({ ocurrio_en: o.ocurrio_en, tipo: 'almacen_entrada', datos: { qty: p.qty, pedimento: p.pedimento, fuente: p.fuente }, por: p.por ?? '' }); entradas.set(p.entrada_id, { qty: p.qty, pedimento: p.pedimento ?? null }); }
        break;
      case 'alm.correccion':
        if (p.item_id === itemId) {
          const e = entradas.get(p.entrada_id);
          ev.push({ ocurrio_en: o.ocurrio_en, tipo: 'almacen_correccion', datos: { qty: p.qty, qty_antes: e?.qty, pedimento: p.pedimento, pedimento_antes: e?.pedimento, motivo: p.motivo }, por: p.por ?? '' });
          if (e) { if (p.qty !== undefined) e.qty = p.qty; if (p.pedimento !== undefined) e.pedimento = p.pedimento; }
        }
        break;
      case 'alm.entrega':
        if (p.item_id === itemId) ev.push({ ocurrio_en: o.ocurrio_en, tipo: 'almacen_entrega', datos: { qty: p.qty, tienda: p.tienda, exceso: !!p.exceso }, por: p.por ?? '' });
        break;
      case 'alm.recibida':
        if (p.item_id === itemId) ev.push({ ocurrio_en: o.ocurrio_en, tipo: 'recepcion', datos: { qty: p.qty, tienda: p.tienda, caja: p.caja }, por: p.cajero ?? '' });
        break;
      case 'sale.confirmed': {
        const ls = (p.lineas as { item_id: string; qty: number; importe: number }[]).filter((l) => l.item_id === itemId);
        ventasDe.set(p.sale_id, { tienda: p.tienda, caja: p.caja, folio: p.folio, lineas: p.lineas });
        if (ls.length) ev.push({ ocurrio_en: o.ocurrio_en, tipo: 'venta', datos: { qty: ls.reduce((a, l) => a + l.qty, 0), importe: ls.reduce((a, l) => a + l.importe, 0), tienda: p.tienda, caja: p.caja, folio: p.folio }, por: p.cajero ?? '' });
        break;
      }
      case 'sale.cancelled': {
        const v = ventasDe.get(p.sale_id);
        const ls = v?.lineas.filter((l) => l.item_id === itemId) ?? [];
        if (v && ls.length) ev.push({ ocurrio_en: o.ocurrio_en, tipo: 'venta_cancelada', datos: { qty: ls.reduce((a, l) => a + l.qty, 0), tienda: v.tienda, caja: v.caja, folio: v.folio, motivo: p.motivo }, por: '' });
        break;
      }
      case 'return.registered': {
        const ls = (p.lineas as { item_id: string; qty: number; importe: number }[]).filter((l) => l.item_id === itemId);
        if (ls.length) ev.push({ ocurrio_en: o.ocurrio_en, tipo: 'devolucion', datos: { qty: ls.reduce((a, l) => a + l.qty, 0), importe: ls.reduce((a, l) => a + l.importe, 0), tienda: p.tienda, caja: p.caja, folio: p.folio, motivo: p.motivo }, por: p.cajero ?? '' });
        break;
      }
      case 'inv.ajuste':
        if (p.item_id === itemId) ev.push({ ocurrio_en: o.ocurrio_en, tipo: 'ajuste_existencias', datos: { cambios: p.cambios, motivo: p.motivo }, por: p.por ?? '' });
        break;
      case 'limbo.reubicacion': {
        const l = (p.lineas as { item_id: string; qty: number }[]).find((x) => x.item_id === itemId);
        if (l) ev.push({ ocurrio_en: o.ocurrio_en, tipo: 'limbo_ubicacion', datos: { qty: l.qty, destino: p.destino }, por: p.por ?? '' });
        break;
      }
      case 'inv.movement':
        if (p.item_id === itemId && p.tipo === 'conteo') ev.push({ ocurrio_en: o.ocurrio_en, tipo: 'conteo', datos: { delta: p.delta, tienda: p.tienda }, por: '' });
        break;
    }
  }
  // más reciente primero; a igual hora, el que ocurrió después en la bitácora
  return ev.map((e, i) => ({ e, i })).sort((a, b) => b.e.ocurrio_en.localeCompare(a.e.ocurrio_en) || b.i - a.i).map((x) => x.e);
}

export function recompensasDe(ops: Op[]): import('./recompensas.ts').ReglaRecompensa[] {
  const m = new Map<string, import('./recompensas.ts').ReglaRecompensa>();
  for (const o of ops) if (o.tipo === 'recompensa.guardada') m.set(o.payload.id, o.payload);
  return [...m.values()];
}

// ── Empleadas: descuento de empleada y crédito (cuenta por cobrar que se descuenta de la nómina) ──
export interface ConfigEmpleadas { pct: number; pct_uniforme: number }
export const CONFIG_EMPLEADAS_INICIAL: ConfigEmpleadas = { pct: 15, pct_uniforme: 30 };
/** Porcentajes del descuento de empleada (el último `empleadas.config` de Administración; sin registro, 15 % y 30 % en uniformes). */
export function configEmpleadas(ops: Op[]): ConfigEmpleadas {
  const o = ops.filter((x) => x.tipo === 'empleadas.config').at(-1);
  return o ? { pct: o.payload.pct, pct_uniforme: o.payload.pct_uniforme } : CONFIG_EMPLEADAS_INICIAL;
}
export interface MovimientoEmpleada {
  ocurrio_en: string;
  fecha: string;
  tipo: 'cargo' | 'devolucion' | 'abono' | 'ajuste_cargo' | 'ajuste_abono';
  /** Siempre positivo: el tipo dice si suma o resta al saldo. */
  monto: number;
  detalle: string;
  tienda?: string;
  folio?: number;
  sale_id?: string;
  por?: string;
  periodo?: string;
}
export interface CuentaEmpleada {
  id: string;
  limite: number;
  cargos: number;
  devoluciones: number;
  abonos: number;
  ajustes_cargo: number;
  ajustes_abono: number;
  /** Lo que la empleada debe: cargos + ajustes de cargo − devoluciones − abonos − ajustes de abono. */
  saldo: number;
  disponible: number;
  movimientos: MovimientoEmpleada[];
}
/**
 * Cuenta de cada empleada: los cargos salen de las ventas pagadas con «Crédito de empleada» (una venta cancelada ya no cuenta), las devoluciones de
 * esas ventas bajan el saldo, y los abonos de nómina y ajustes los registra Administración. El crédito NO es dinero cobrado: no entra al corte.
 */
export function cuentasEmpleadas(ops: Op[]): Map<string, CuentaEmpleada> {
  const m = new Map<string, CuentaEmpleada>();
  const de = (id: string) => {
    let c = m.get(id);
    if (!c) { c = { id, limite: 0, cargos: 0, devoluciones: 0, abonos: 0, ajustes_cargo: 0, ajustes_abono: 0, saldo: 0, disponible: 0, movimientos: [] }; m.set(id, c); }
    return c;
  };
  for (const o of ops) if (o.tipo === 'empleada.credito') de(o.payload.empleada_id).limite = o.payload.limite;
  const vs = ventas(ops);
  for (const v of vs.values()) {
    if (v.estado !== 'confirmada') continue;
    for (const p of v.pagos) {
      if (p.metodo !== 'credito_empleada' || !p.empleada_id) continue;
      const c = de(p.empleada_id);
      c.cargos += p.monto;
      c.movimientos.push({ ocurrio_en: v.ocurrio_en, fecha: fechaLocal(v.ocurrio_en), tipo: 'cargo', monto: p.monto, detalle: `Venta a crédito ${v.tienda}-${v.caja} folio ${String(v.folio).padStart(6, '0')}`, tienda: v.tienda, folio: v.folio, sale_id: v.sale_id });
    }
  }
  for (const d of devoluciones(ops)) {
    const v = vs.get(d.sale_id);
    const pago = v?.pagos.find((p) => p.metodo === 'credito_empleada' && p.empleada_id);
    if (!v || !pago || v.estado !== 'confirmada') continue;
    const monto = d.reembolsos.filter((r) => r.metodo === 'credito_empleada').reduce((a, r) => a + r.monto, 0);
    if (monto <= 0) continue;
    const c = de(pago.empleada_id!);
    c.devoluciones += monto;
    c.movimientos.push({ ocurrio_en: d.ocurrio_en, fecha: fechaLocal(d.ocurrio_en), tipo: 'devolucion', monto, detalle: `Devolución de la venta folio ${String(v.folio).padStart(6, '0')}`, tienda: v.tienda, folio: v.folio, sale_id: v.sale_id });
  }
  for (const o of ops) {
    if (o.tipo !== 'empleada.movimiento') continue;
    const p = o.payload;
    const c = de(p.empleada_id);
    if (p.tipo === 'abono') c.abonos += p.monto; else if (p.tipo === 'ajuste_abono') c.ajustes_abono += p.monto; else c.ajustes_cargo += p.monto;
    c.movimientos.push({ ocurrio_en: o.ocurrio_en, fecha: p.fecha, tipo: p.tipo, monto: p.monto, detalle: p.motivo, por: p.por, ...(p.periodo ? { periodo: p.periodo } : {}) });
  }
  for (const c of m.values()) {
    c.saldo = c.cargos + c.ajustes_cargo - c.devoluciones - c.abonos - c.ajustes_abono;
    c.disponible = Math.max(0, c.limite - c.saldo);
    c.movimientos.sort((a, b) => b.ocurrio_en.localeCompare(a.ocurrio_en));
  }
  return m;
}
