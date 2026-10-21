// Orquesta el envío del reporte mensual a la contadora. Todo lo externo (base de datos, correo, Excel) entra por `Dependencias`:
// así se prueba entero sin red y la Edge Function solo conecta cada pieza. Código PURO.
import { claveCaja, correoDelReporte, esUltimoDiaDelMes, porEnviar, reporteDeCaja, type ReporteCaja } from './reporte-contadora.ts';
import { fechaLocal } from './util.ts';
import type { Hoja } from './inventario.ts';
import type { Op } from './tipos.ts';

export interface ConfigCaja { tienda: string; caja: number; activo: boolean; correos: string[] }
export interface Dependencias {
  ahora(): string;
  cajasConfiguradas(): Promise<ConfigCaja[]>;
  /** «periodo|tienda/caja» de los envíos ya hechos. */
  enviados(): Promise<Set<string>>;
  /** Reserva el envío (periodo, caja): false si ya estaba reservado o enviado. Evita dos correos si la función corre dos veces a la vez. */
  reclamar(periodo: string, tienda: string, caja: number): Promise<boolean>;
  /** Devuelve la reserva (el envío falló): se reintentará en la siguiente corrida. */
  liberar(periodo: string, tienda: string, caja: number): Promise<void>;
  registrar(periodo: string, tienda: string, caja: number, r: { correos: string[]; tickets: number; total: number; proveedor_id: string }): Promise<void>;
  /** Operaciones de ventas que pueden entrar al periodo (con un día de margen por la zona horaria) y todas las cancelaciones e históricas. */
  leerOps(desde: string, hasta: string): Promise<Op[]>;
  generarXlsx(hojas: Hoja[]): Promise<Uint8Array>;
  enviarCorreo(c: { para: string[]; asunto: string; texto: string; html: string; adjunto: { nombre: string; bytes: Uint8Array } }): Promise<{ id: string }>;
}

export interface ResultadoEnvio { periodo: string; tienda: string; caja: number; estado: 'enviado' | 'sin_destinatarios' | 'ya_enviado' | 'fallo'; correos?: string[]; tickets?: number; total?: number; error?: string }

async function armar(d: Dependencias, tienda: string, caja: number, periodo: string, hastaFecha?: string): Promise<ReporteCaja> {
  const y = Number(periodo.slice(0, 4)), m = Number(periodo.slice(5, 7));
  const desde = new Date(Date.UTC(y, m - 1, 1) - 86400000).toISOString(), hasta = new Date(Date.UTC(y, m, 2)).toISOString();
  return reporteDeCaja(await d.leerOps(desde, hasta), tienda, caja, periodo, hastaFecha);
}

/** Corrida diaria (9 p. m.): manda lo que toque según `porEnviar`. Con `periodo` (y opcionalmente tienda/caja) reenvía a mano (sigue sin duplicar si ya salió). */
export async function ejecutarMensual(d: Dependencias, o: { periodo?: string; tienda?: string; caja?: number } = {}): Promise<{ omitido?: string; resultados: ResultadoEnvio[] }> {
  const config = (await d.cajasConfiguradas()).filter((c) => c.activo && (!o.tienda || c.tienda === o.tienda) && (!o.caja || c.caja === o.caja));
  if (!config.length) return { omitido: 'no hay cajas activas', resultados: [] };
  const enviados = await d.enviados();
  const pendientes = o.periodo ? config.map((c) => ({ periodo: o.periodo!, tienda: c.tienda, caja: c.caja })).filter((p) => !enviados.has(`${p.periodo}|${claveCaja(p.tienda, p.caja)}`)) : porEnviar(d.ahora(), config, enviados);
  if (!pendientes.length) {
    const hoy = fechaLocal(d.ahora());
    return { omitido: o.periodo || esUltimoDiaDelMes(hoy) || Number(hoy.slice(8, 10)) <= 3 ? 'nada pendiente' : `hoy (${hoy}) no toca enviar`, resultados: [] };
  }
  const resultados: ResultadoEnvio[] = [];
  for (const p of pendientes) {
    const cfg = config.find((c) => c.tienda === p.tienda && c.caja === p.caja)!;
    if (!cfg.correos.length) { resultados.push({ ...p, estado: 'sin_destinatarios' }); continue; }
    if (!(await d.reclamar(p.periodo, p.tienda, p.caja))) { resultados.push({ ...p, estado: 'ya_enviado' }); continue; }
    try {
      const r = await armar(d, p.tienda, p.caja, p.periodo);
      const c = correoDelReporte(r, { corteA: `${fechaLocal(d.ahora()).split('-').reverse().join('/')} 21:00 (hora de Hermosillo)` });
      const { id } = await d.enviarCorreo({ para: cfg.correos, asunto: c.asunto, texto: c.texto, html: c.html, adjunto: { nombre: r.archivo, bytes: await d.generarXlsx(r.hojas) } });
      await d.registrar(p.periodo, p.tienda, p.caja, { correos: cfg.correos, tickets: r.tickets, total: r.total, proveedor_id: id });
      resultados.push({ ...p, estado: 'enviado', correos: cfg.correos, tickets: r.tickets, total: r.total });
    } catch (e) {
      await d.liberar(p.periodo, p.tienda, p.caja);
      resultados.push({ ...p, estado: 'fallo', error: String((e as Error)?.message ?? e).slice(0, 300) });
    }
  }
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
