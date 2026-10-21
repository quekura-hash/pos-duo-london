import type { ClienteCentral, FilaCentral } from './puente-central.ts';
import type { Op } from '../tipos.ts';

type Fetch = typeof fetch;
interface Sesion { access_token: string; refresh_token: string; expira: number; usuario_id: string | null }

/**
 * Cliente del central por la API de Supabase (PostgREST + Auth). Solo usa la llave PÚBLICA (anon) y la sesión del usuario:
 * lo que cada quien puede ver o hacer lo decide la RLS del central, no este código. La contraseña se usa una vez y no se guarda.
 */
export class ClienteSupabase implements ClienteCentral {
  readonly url: string;
  private anon: string;
  private f: Fetch;
  private sesion: Sesion | null = null;
  /** Tiempo máximo de cada petición: una red que no contesta no debe dejar colgada a la caja ni a la Administración. */
  timeoutMs = 30_000;

  constructor(url: string, llavePublica: string, f: Fetch = fetch.bind(globalThis)) {
    this.url = url.replace(/\/+$/, '');
    this.anon = llavePublica;
    this.f = f;
  }

  get conSesion(): boolean {
    return this.sesion !== null;
  }

  async iniciarSesion(correo: string, clave: string): Promise<void> {
    await this.pedirToken({ email: correo, password: clave }, 'password');
  }

  /** Restaura una sesión guardada (solo los tokens, nunca la contraseña). */
  restaurarSesion(refreshToken: string): Promise<void> {
    return this.pedirToken({ refresh_token: refreshToken }, 'refresh_token');
  }

  tokenDeRenovacion(): string | null {
    return this.sesion?.refresh_token ?? null;
  }

  cerrarSesion(): void {
    this.sesion = null;
  }

  private async pedirToken(cuerpo: object, tipo: 'password' | 'refresh_token'): Promise<void> {
    const r = await this.f(`${this.url}/auth/v1/token?grant_type=${tipo}`, {
      method: 'POST', signal: AbortSignal.timeout(this.timeoutMs),
      headers: { apikey: this.anon, 'Content-Type': 'application/json' },
      body: JSON.stringify(cuerpo),
    });
    const j = (await r.json().catch(() => ({}))) as { access_token?: string; refresh_token?: string; expires_in?: number; user?: { id?: string } };
    if (!r.ok || !j.access_token || !j.refresh_token) throw new Error('No se pudo iniciar sesión en el central: revisa correo y contraseña.');
    this.sesion = { access_token: j.access_token, refresh_token: j.refresh_token, expira: Date.now() + (j.expires_in ?? 3600) * 1000 - 60_000, usuario_id: j.user?.id ?? this.sesion?.usuario_id ?? null };
  }

  private async rpc<T>(nombre: string, args: object): Promise<T> {
    if (!this.sesion) throw new Error('Sin sesión en el central.');
    if (Date.now() >= this.sesion.expira) await this.restaurarSesion(this.sesion.refresh_token);
    const r = await this.f(`${this.url}/rest/v1/rpc/${nombre}`, {
      method: 'POST', signal: AbortSignal.timeout(this.timeoutMs),
      headers: { apikey: this.anon, Authorization: `Bearer ${this.sesion!.access_token}`, 'Content-Type': 'application/json', 'Content-Profile': 'pos', 'Accept-Profile': 'pos' },
      body: JSON.stringify(args),
    });
    if (!r.ok) {
      const e = (await r.json().catch(() => ({}))) as { message?: string };
      throw new Error(`Central: ${e.message ?? r.status}`);
    }
    return (await r.json()) as T;
  }

  subirOps(ops: Pick<Op, 'op_id' | 'tipo' | 'tienda' | 'caja' | 'ocurrio_en' | 'payload'>[]) {
    const p_ops = ops.map((o) => ({ op_id: o.op_id, tipo: o.tipo, tienda: o.tienda, caja: o.caja, ocurrio_en: o.ocurrio_en, payload: o.payload }));
    return this.rpc<{ nuevas: number; ultimo_seq: number }>('subir_ops', { p_ops });
  }

  bajarOps(desde: number, limite: number) {
    return this.rpc<FilaCentral[]>('bajar_ops', { p_desde: desde, p_limite: limite });
  }

  /** Rol y alias de quien inició sesión, según pos.admins (null = no es administrador del negocio o está dado de baja). */
  async miPerfil(): Promise<{ rol: 'supervisor' | 'almacenista' | 'caja'; alias: string; usuario_id: string; tienda: string | null; caja: number | null } | null> {
    if (!this.sesion?.usuario_id) throw new Error('Sin sesión en el central.');
    const id = this.sesion.usuario_id;
    const filas = await this.leer<{ rol: 'supervisor' | 'almacenista' | 'caja'; alias: string; activo: boolean; tienda: string | null; caja: number | null }[]>(`admins?select=rol,alias,activo,tienda,caja&user_id=eq.${encodeURIComponent(id)}`);
    const a = filas[0];
    return a && a.activo ? { rol: a.rol, alias: a.alias, usuario_id: id, tienda: a.tienda ?? null, caja: a.caja ?? null } : null;
  }

  private async leer<T>(ruta: string): Promise<T> {
    if (Date.now() >= this.sesion!.expira) await this.restaurarSesion(this.sesion!.refresh_token);
    const r = await this.f(`${this.url}/rest/v1/${ruta}`, { signal: AbortSignal.timeout(this.timeoutMs), headers: { apikey: this.anon, Authorization: `Bearer ${this.sesion!.access_token}`, 'Accept-Profile': 'pos' } });
    if (!r.ok) throw new Error(`Central: ${r.status}`);
    return (await r.json()) as T;
  }


  // ── Notificaciones push: el dispositivo se registra en pos.suscripciones_push (solo supervisores; la RLS lo garantiza) ──
  private async escribir(ruta: string, metodo: 'POST' | 'PATCH' | 'DELETE', cuerpo: unknown, extra: Record<string, string> = {}): Promise<void> {
    if (!this.sesion) throw new Error('Sin sesión en el central.');
    if (Date.now() >= this.sesion.expira) await this.restaurarSesion(this.sesion.refresh_token);
    const r = await this.f(`${this.url}/rest/v1/${ruta}`, {
      method: metodo, signal: AbortSignal.timeout(this.timeoutMs),
      headers: { apikey: this.anon, Authorization: `Bearer ${this.sesion.access_token}`, 'Content-Type': 'application/json', 'Content-Profile': 'pos', 'Accept-Profile': 'pos', ...extra },
      body: cuerpo === undefined ? undefined : JSON.stringify(cuerpo),
    });
    if (!r.ok) throw new Error(`Central: ${((await r.json().catch(() => ({}))) as { message?: string }).message ?? r.status}`);
  }
  /** Registra (o actualiza) este dispositivo para recibir avisos. */
  guardarSuscripcion(s: { endpoint: string; p256dh: string; auth: string; dispositivo?: string; prefs?: unknown; pausa_hasta?: string | null; activa?: boolean }): Promise<void> {
    if (!this.sesion?.usuario_id) throw new Error('Sin sesión en el central.');
    return this.escribir('suscripciones_push?on_conflict=endpoint', 'POST', { ...s, user_id: this.sesion.usuario_id }, { Prefer: 'resolution=merge-duplicates,return=minimal' });
  }
  async leerSuscripcion(endpoint: string): Promise<{ prefs: unknown; pausa_hasta: string | null; activa: boolean } | null> {
    if (!this.sesion) throw new Error('Sin sesión en el central.');
    const filas = await this.leer<{ prefs: unknown; pausa_hasta: string | null; activa: boolean }[]>(`suscripciones_push?select=prefs,pausa_hasta,activa&endpoint=eq.${encodeURIComponent(endpoint)}`);
    return filas[0] ?? null;
  }
  cambiarSuscripcion(endpoint: string, cambios: { prefs?: unknown; pausa_hasta?: string | null; activa?: boolean }): Promise<void> {
    return this.escribir(`suscripciones_push?endpoint=eq.${encodeURIComponent(endpoint)}`, 'PATCH', cambios, { Prefer: 'return=minimal' });
  }
  borrarSuscripcion(endpoint: string): Promise<void> {
    return this.escribir(`suscripciones_push?endpoint=eq.${encodeURIComponent(endpoint)}`, 'DELETE', undefined);
  }
  /** Le pide al central un aviso de prueba para este dispositivo. */
  async probarNotificacion(endpoint: string): Promise<void> {
    if (!this.sesion) throw new Error('Sin sesión en el central.');
    if (Date.now() >= this.sesion.expira) await this.restaurarSesion(this.sesion.refresh_token);
    const r = await this.f(`${this.url}/functions/v1/notificar`, { method: 'POST', signal: AbortSignal.timeout(this.timeoutMs), headers: { apikey: this.anon, Authorization: `Bearer ${this.sesion.access_token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ accion: 'prueba', endpoint }) });
    if (!r.ok) throw new Error(((await r.json().catch(() => ({}))) as { error?: string }).error ?? `No se pudo enviar la prueba (${r.status})`);
  }

  /** Envío mensual del reporte a la contadora: destinatarios por CAJA (solo supervisor). */
  leerReporteContadora(): Promise<{ tienda: string; caja: number; activo: boolean; correos: string[] }[]> {
    if (!this.sesion) throw new Error('Sin sesión en el central.');
    return this.leer('reporte_contadora?select=tienda,caja,activo,correos&order=tienda,caja');
  }
  guardarReporteContadora(tienda: string, caja: number, d: { activo: boolean; correos: string[] }): Promise<void> {
    if (!this.sesion?.usuario_id) throw new Error('Sin sesión en el central.');
    return this.escribir('reporte_contadora?on_conflict=tienda,caja', 'POST', { tienda, caja, activo: d.activo, correos: d.correos, actualizado_en: new Date().toISOString(), actualizado_por: this.sesion.usuario_id }, { Prefer: 'resolution=merge-duplicates,return=minimal' });
  }
  /** Últimos envíos (periodo, caja, cuándo salió o por qué no, intentos, tickets y total). */
  leerEnviosReporte(): Promise<{ periodo: string; tienda: string; caja: number; enviado_en: string | null; intentos: number; ultimo_error: string | null; avisado_en: string | null; tickets: number | null; total: number | null; correos: string[] }[]> {
    if (!this.sesion) throw new Error('Sin sesión en el central.');
    return this.leer('envios_reporte?select=periodo,tienda,caja,enviado_en,intentos,ultimo_error,avisado_en,tickets,total,correos&order=periodo.desc,tienda,caja&limit=24');
  }
  /** Le pide a la función un correo de PRUEBA (lo que va del mes de una caja) al correo de quien está en sesión. */
  async probarReporteContadora(tienda: string, caja: number): Promise<{ correo: string; asunto: string; tickets: number; total: number }> {
    if (!this.sesion) throw new Error('Sin sesión en el central.');
    if (Date.now() >= this.sesion.expira) await this.restaurarSesion(this.sesion.refresh_token);
    const r = await this.f(`${this.url}/functions/v1/reporte-contadora`, { method: 'POST', signal: AbortSignal.timeout(60000), headers: { apikey: this.anon, Authorization: `Bearer ${this.sesion.access_token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ accion: 'prueba', tienda, caja }) });
    const j = (await r.json().catch(() => ({}))) as { error?: string; correo?: string; asunto?: string; tickets?: number; total?: number };
    if (!r.ok) throw new Error(j.error ?? `No se pudo enviar la prueba (${r.status})`);
    return { correo: j.correo ?? '', asunto: j.asunto ?? '', tickets: j.tickets ?? 0, total: j.total ?? 0 };
  }

  /** Reserva un bloque de Item # (lo asigna solo el central). */
  reservarItemNo(k: number) {
    return this.rpc<{ desde: number; hasta: number }>('reservar_item_no', { p_k: k });
  }
}
