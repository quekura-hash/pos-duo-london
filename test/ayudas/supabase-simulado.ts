import type { BrowserContext } from 'playwright-core';
import type { PGlite } from '@electric-sql/pglite';
import { ClientePglite, como } from './central-pglite.ts';

export const URL_CENTRAL = 'https://prueba.supabase.co';
const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' };

/** Supabase simulado en el navegador: Auth y PostgREST contestan desde el Postgres local con la migración REAL. */
export async function simularSupabase(ctx: BrowserContext, db: PGlite, cuentas: Record<string, string>) {
  const uidDe = (h: Record<string, string>) => /^Bearer jwt-(.+)$/.exec(h.authorization ?? '')?.[1] ?? null;
  await ctx.route(`${URL_CENTRAL}/**`, async (ruta) => {
    const req = ruta.request();
    const u = new URL(req.url());
    const json = (status: number, cuerpo: unknown) => ruta.fulfill({ status, headers: { ...CORS, 'content-type': 'application/json' }, body: JSON.stringify(cuerpo) });
    if (req.method() === 'OPTIONS') return ruta.fulfill({ status: 204, headers: CORS });
    try {
      if (u.pathname === '/auth/v1/token') {
        const b = req.postDataJSON() as { email?: string; password?: string; refresh_token?: string };
        const uid = b.refresh_token ? b.refresh_token.replace('rt-', '') : (b.password === 'buena' ? cuentas[b.email ?? ''] : undefined);
        if (!uid) return json(400, { error: 'invalid_grant' });
        return json(200, { access_token: `jwt-${uid}`, refresh_token: `rt-${uid}`, expires_in: 3600, user: { id: uid } });
      }
      const uid = uidDe(req.headers());
      if (!uid) return json(401, { message: 'JWT requerido' });
      if (u.pathname === '/rest/v1/rpc/subir_ops') return json(200, await new ClientePglite(db, uid).subirOps((req.postDataJSON() as { p_ops: unknown[] }).p_ops));
      if (u.pathname === '/rest/v1/rpc/bajar_ops') { const b = req.postDataJSON() as { p_desde: number; p_limite: number }; return json(200, await new ClientePglite(db, uid).bajarOps(b.p_desde, b.p_limite)); }
      if (u.pathname === '/rest/v1/admins') return json(200, await como(db, uid, (q) => q('select rol, alias, activo, tienda, caja from pos.admins where user_id = $1', [uid])));
      return json(404, { message: 'no existe' });
    } catch (e) {
      return json(400, { message: e instanceof Error ? e.message : String(e) });
    }
  });
}

