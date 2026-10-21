// Orquesta el envío del reporte mensual a la contadora. Todo lo externo (base de datos, correo, Excel, aviso al teléfono) entra por `Dependencias`:
// así se prueba entero sin red y la Edge Function solo conecta cada pieza. Código PURO.
import { claveCaja, correoDelReporte, esUltimoDiaDelMes, MAX_INTENTOS, nombreCaja, nombreDelMes, porEnviar, reporteDeCaja, type ReporteCaja } from './reporte-contadora.ts';
import { fechaLocal } from './util.ts';
import type { Hoja } from './inventario.ts';
import type { Op } from './tipos.ts';

export interface ConfigCaja { tienda: string; caja: number; activo: boolean; correos: string[] }
export interface Fallo { periodo: string; tienda: string; caja: number; intentos: number; error: string }
export interface Dependencias {
  ahora(): string;
  cajasConfiguradas(): Promise<ConfigCaja[]>;
  /** «periodo|tienda/caja» de los envíos ya hechos. */
  enviados(): Promise<Set<string>>;
  /** «periodo|tienda/caja» de los envíos que ya gastaron sus intentos sin salir (no se insiste más). */
  agotados(): Promise<Set<string>>;
  /** Reserva el envío (periodo, caja): false si ya estaba reservado, enviado o sin intentos. Evita dos correos si la función corre dos veces a la vez. */
  reclamar(periodo: string, tienda: string, caja: number): Promise<boolean>;
  /** El intento falló: se anota (suma el intento y guarda el error) y se libera la reserva. Devuelve los intentos hechos hasta ahora. */
  fallar(periodo: string, tienda: string, caja: number, error: string): Promise<number>;
  /** Borra un envío que no salió para empezar de cero (reenvío manual de un mes). */
  reiniciar(periodo: string, tienda: string, caja: number): Promise<void>;
  registrar(periodo: string, tienda: string, caja: number, r: { correos: string[]; tickets: number; total: number; proveedor_id: string }): Promise<void>;
  /** Avisa al teléfono del supervisor que estos envíos no salieron tras todos sus intentos, y deja constancia de que ya se avisó. */
  avisarFallos(fallos: Fallo[]): Promise<void>;
  /** Operaciones de ventas que pueden entrar al periodo (con un día de margen por la zona horaria) y todas las cancelaciones e históricas. */
  leerOps(desde: string, hasta: string): Promise<Op[]>;
  generarXlsx(hojas: Hoja[]): Promise<Uint8Array>;
  enviarCorreo(c: { para: string[]; asunto: string; texto: string; html: string; adjunto: { nombre: string; bytes: Uint8Array } }): Promise<{ id: string }>;
}

export interface ResultadoEnvio { periodo: string; tienda: string; caja: number; estado: 'enviado' | 'sin_destinatarios' | 'ya_enviado' | 'fallo'; correos?: string[]; tickets?: number; total?: number; error?: string; intentos?: number }

async function armar(d: Dependencias, tienda: string, caja: number, periodo: string, hastaFecha?: string): Promise<ReporteCaja> {
  const y = Number(periodo.slice(0, 4)), m = Number(periodo.slice(5, 7));
  const desde = new Date(Date.UTC(y, m - 1, 1) - 86400000).toISOString(), hasta = new Date(Date.UTC(y, m, 2)).toISOString();
  return reporteDeCaja(await d.leerOps(desde, hasta), tienda, caja, periodo, hastaFecha);
}

/** Texto del aviso al teléfono cuando se agotaron los intentos. */
export function avisoDeFallos(fallos: Fallo[]): { titulo: string; cuerpo: string; tag: string } {
  const lista = fallos.map((f) => `${nombreCaja(f.tienda, f.caja)} · ${nombreDelMes(f.periodo)}`).join('; ');
  return {
    titulo: 'El reporte no se envió',
    cuerpo: `No se pudo mandar a la contadora: ${lista}. Se intentó ${MAX_INTENTOS} veces. Último error: ${fallos[0]!.error.slice(0, 140)}. Revísalo en Reportes.`,
    tag: `reporte-fallo:${fallos.map((f) => `${f.periodo}:${claveCaja(f.tienda, f.caja)}`).join(',')}`,
  };
}

/**
 * Corrida programada (9, 10 y 11 p. m. del último día del mes y 9 a. m. del día siguiente): manda lo que toque según `porEnviar`.
 * Un fallo se anota y se reintenta en la siguiente corrida; al cuarto fallo se avisa al teléfono y ya no se insiste.
 * Con `periodo` (y opcionalmente tienda/caja) se reenvía a mano un mes (empieza de cero; sigue sin duplicar lo que ya salió).
 */
export async function ejecutarMensual(d: Dependencias, o: { periodo?: string; tienda?: string; caja?: number } = {}): Promise<{ omitido?: string; resultados: ResultadoEnvio[] }> {
  const config = (await d.cajasConfiguradas()).filter((c) => c.activo && (!o.tienda || c.tienda === o.tienda) && (!o.caja || c.caja === o.caja));
  if (!config.length) return { omitido: 'no hay cajas activas', resultados: [] };
  const enviados = await d.enviados();
  let pendientes: { periodo: string; tienda: string; caja: number }[];
  if (o.periodo) {
    pendientes = config.map((c) => ({ periodo: o.periodo!, tienda: c.tienda, caja: c.caja })).filter((p) => !enviados.has(`${p.periodo}|${claveCaja(p.tienda, p.caja)}`));
    for (const p of pendientes) await d.reiniciar(p.periodo, p.tienda, p.caja);
  } else {
    pendientes = porEnviar(d.ahora(), config, new Set([...enviados, ...(await d.agotados())]));
  }
  if (!pendientes.length) {
    const hoy = fechaLocal(d.ahora());
    return { omitido: o.periodo || esUltimoDiaDelMes(hoy) || hoy.endsWith('-01') ? 'nada pendiente' : `hoy (${hoy}) no toca enviar`, resultados: [] };
  }
  const resultados: ResultadoEnvio[] = [];
  const agotados: Fallo[] = [];
  for (const p of pendientes) {
    const cfg = config.find((c) => c.tienda === p.tienda && c.caja === p.caja)!;
    if (!cfg.correos.length) { resultados.push({ ...p, estado: 'sin_destinatarios' }); continue; }
    if (!(await d.reclamar(p.periodo, p.tienda, p.caja))) { resultados.push({ ...p, estado: 'ya_enviado' }); continue; }
    try {
      const r = await armar(d, p.tienda, p.caja, p.periodo);
      const c = correoDelReporte(r, { corteA: `${fechaLocal(d.ahora()).split('-').reverse().join('/')} (hora de Hermosillo)` });
      const { id } = await d.enviarCorreo({ para: cfg.correos, asunto: c.asunto, texto: c.texto, html: c.html, adjunto: { nombre: r.archivo, bytes: await d.generarXlsx(r.hojas) } });
      await d.registrar(p.periodo, p.tienda, p.caja, { correos: cfg.correos, tickets: r.tickets, total: r.total, proveedor_id: id });
      resultados.push({ ...p, estado: 'enviado', correos: cfg.correos, tickets: r.tickets, total: r.total });
    } catch (e) {
      const error = String((e as Error)?.message ?? e).slice(0, 300);
      const intentos = await d.fallar(p.periodo, p.tienda, p.caja, error);
      resultados.push({ ...p, estado: 'fallo', error, intentos });
      if (intentos >= MAX_INTENTOS) agotados.push({ ...p, intentos, error });
    }
  }
  if (agotados.length) await d.avisarFallos(agotados);
  return { resultados };
}

/** Prueba: el reporte de lo que va del mes de una caja, SOLO al correo de quien la pide. No reserva ni registra nada. */
export async function ejecutarPrueba(d: Dependencias, tienda: string, caja: number, correoDestino: string): Promise<{ asunto: string; tickets: number; total: number }> {
  const hoy = fechaLocal(d.ahora());
  const r = await armar(d, tienda, caja, hoy.slice(0, 7), hoy);
  const c = correoDelReporte(r, { prueba: true, corteA: `${hoy.split('-').reverse().join('/')} (hasta este momento)` });
  await d.enviarCorreo({ para: [correoDestino], asunto: c.asunto, texto: c.texto, html: c.html, adjunto: { nombre: r.archivo, bytes: await d.generarXlsx(r.hojas) } });
  return { asunto: c.asunto, tickets: r.tickets, total: r.total };
}
