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
      method: 'POST',
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
      method: 'POST',
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
  async miPerfil(): Promise<{ rol: 'supervisor' | 'almacenista'; alias: string; usuario_id: string } | null> {
    if (!this.sesion?.usuario_id) throw new Error('Sin sesión en el central.');
    const id = this.sesion.usuario_id;
    const filas = await this.leer<{ rol: 'supervisor' | 'almacenista'; alias: string; activo: boolean }[]>(`admins?select=rol,alias,activo&user_id=eq.${encodeURIComponent(id)}`);
    const a = filas[0];
    return a && a.activo ? { rol: a.rol, alias: a.alias, usuario_id: id } : null;
  }

  private async leer<T>(ruta: string): Promise<T> {
    if (Date.now() >= this.sesion!.expira) await this.restaurarSesion(this.sesion!.refresh_token);
    const r = await this.f(`${this.url}/rest/v1/${ruta}`, { headers: { apikey: this.anon, Authorization: `Bearer ${this.sesion!.access_token}`, 'Accept-Profile': 'pos' } });
    if (!r.ok) throw new Error(`Central: ${r.status}`);
    return (await r.json()) as T;
  }

  /** Reserva un bloque de Item # (lo asigna solo el central). */
  reservarItemNo(k: number) {
    return this.rpc<{ desde: number; hasta: number }>('reservar_item_no', { p_k: k });
  }
}
