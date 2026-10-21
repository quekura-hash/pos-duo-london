// Edge Function `notificar` (Deno): manda las notificaciones push de LonDuo POS a los teléfonos de los supervisores.
//  · Disparada por la base de datos (pos.notificar_op, cada vez que entra una venta, devolución, cancelación, retiro, corte o alerta) y por un trabajo
//    programado cada 15 minutos (resumen del día). Ambos llevan la cabecera `x-londuo-secret`.
//  · También la llama un supervisor desde la app (con su sesión) para mandarse una notificación de PRUEBA a su propio dispositivo.
// Despliegue sin verificación de JWT del gateway (los disparadores no tienen sesión): la autenticación la hace esta función.
import { createClient } from 'npm:@supabase/supabase-js@2';
import webpush from 'npm:web-push@3.6.7';
import { avisoDeOp, debeEnviar, esReciente, fechaHoraLocal, inicioDiaUtc, resumenDelDia, sanearPrefs, tocaResumen, type Aviso, type DatosDia, type OpMin, type VentaMin } from './formato.ts';

const env = (k: string) => Deno.env.get(k) ?? '';
const db = createClient(env('SUPABASE_URL'), env('SUPABASE_SERVICE_ROLE_KEY'), { auth: { persistSession: false }, db: { schema: 'pos' } });
webpush.setVapidDetails(env('VAPID_SUJETO') || 'mailto:soporte@londuo.mx', env('VAPID_PUBLICA'), env('VAPID_PRIVADA'));

const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info', 'Access-Control-Allow-Methods': 'POST, OPTIONS' };
const responder = (estado: number, cuerpo: unknown) => new Response(JSON.stringify(cuerpo), { status: estado, headers: { ...CORS, 'Content-Type': 'application/json' } });

interface Suscripcion { id: string; user_id: string; endpoint: string; p256dh: string; auth: string; prefs: unknown; pausa_hasta: string | null; ultimo_resumen: string | null }

/** Dispositivos de supervisores activos. */
async function suscripciones(): Promise<Suscripcion[]> {
  const [{ data: subs }, { data: sups }] = await Promise.all([
    db.from('suscripciones_push').select('id, user_id, endpoint, p256dh, auth, prefs, pausa_hasta, ultimo_resumen').eq('activa', true),
    db.from('admins').select('user_id').eq('rol', 'supervisor').eq('activo', true),
  ]);
  const ok = new Set((sups ?? []).map((s: { user_id: string }) => s.user_id));
  return ((subs ?? []) as Suscripcion[]).filter((s) => ok.has(s.user_id));
}

async function enviar(s: Suscripcion, a: Aviso): Promise<boolean> {
  try {
    await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, JSON.stringify({ titulo: a.titulo, cuerpo: a.cuerpo, tag: a.tag, url: a.url, ts: Date.now() }), { TTL: 3600, urgency: 'high' });
    await db.from('suscripciones_push').update({ ultima_ok: new Date().toISOString(), ultimo_error: null }).eq('id', s.id);
    return true;
  } catch (e) {
    const codigo = (e as { statusCode?: number }).statusCode;
    // 404/410: el dispositivo ya no existe (se desinstaló la app o se revocó el permiso): se desactiva.
    await db.from('suscripciones_push').update(codigo === 404 || codigo === 410 ? { activa: false, ultimo_error: `desactivada (${codigo})` } : { ultimo_error: String((e as Error).message ?? e).slice(0, 300) }).eq('id', s.id);
    return false;
  }
}

async function notificarOp(opId: string) {
  const { data: op } = await db.from('ops').select('op_id, tipo, tienda, caja, ocurrio_en, payload').eq('op_id', opId).maybeSingle();
  if (!op) return { omitida: 'no existe' };
  const ahora = new Date().toISOString();
  if (!esReciente(op as OpMin, ahora)) return { omitida: 'vieja' }; // ventas que una caja subió al recuperar internet: sin avalancha
  let venta: VentaMin | null = null;
  if (op.tipo === 'sale.cancelled') {
    const { data } = await db.from('ops').select('payload').eq('tipo', 'sale.confirmed').filter('payload->>sale_id', 'eq', op.payload.sale_id).maybeSingle();
    venta = (data?.payload as VentaMin | undefined) ?? null;
  }
  const aviso = avisoDeOp(op as OpMin, { venta });
  if (!aviso) return { omitida: 'sin aviso' };
  const destinos = (await suscripciones()).filter((s) => debeEnviar(sanearPrefs(s.prefs), aviso, { pausaHasta: s.pausa_hasta, ahora }));
  const resultados = await Promise.all(destinos.map((s) => enviar(s, aviso)));
  return { aviso: aviso.titulo, enviadas: resultados.filter(Boolean).length, fallidas: resultados.filter((x) => !x).length };
}

/** Datos de un día local para el resumen: ventas, cancelaciones y devoluciones. */
async function datosDelDia(fecha: string): Promise<DatosDia> {
  const desde = inicioDiaUtc(fecha), hasta = new Date(desde.getTime() + 24 * 3600_000);
  const filas: { tipo: string; payload: any }[] = [];
  for (let pagina = 0; ; pagina++) {
    const { data } = await db.from('ops').select('tipo, payload').in('tipo', ['sale.confirmed', 'sale.cancelled', 'return.registered']).gte('ocurrio_en', desde.toISOString()).lt('ocurrio_en', hasta.toISOString()).order('seq').range(pagina * 1000, pagina * 1000 + 999);
    filas.push(...(data ?? []));
    if (!data || data.length < 1000) break;
  }
  return {
    fecha,
    ventas: filas.filter((f) => f.tipo === 'sale.confirmed').map((f) => f.payload as VentaMin),
    canceladas: filas.filter((f) => f.tipo === 'sale.cancelled').map((f) => f.payload.sale_id as string),
    devoluciones: filas.filter((f) => f.tipo === 'return.registered').map((f) => ({ tienda: f.payload.tienda as string, importe: f.payload.importe as number })),
  };
}

async function resumenTick() {
  const ahora = new Date().toISOString();
  const { fecha } = fechaHoraLocal(ahora);
  const pendientes = (await suscripciones()).filter((s) => tocaResumen(sanearPrefs(s.prefs), s.ultimo_resumen, ahora));
  if (!pendientes.length) return { enviadas: 0 };
  const datos = await datosDelDia(fecha);
  let enviadas = 0;
  for (const s of pendientes) {
    const prefs = sanearPrefs(s.prefs);
    const aviso = resumenDelDia(datos, prefs.tiendas);
    if (!aviso || !debeEnviar(prefs, aviso, { pausaHasta: s.pausa_hasta, ahora })) continue; // en pausa: se intenta de nuevo en el siguiente ciclo
    if (await enviar(s, aviso)) { enviadas++; await db.from('suscripciones_push').update({ ultimo_resumen: fecha }).eq('id', s.id); }
  }
  return { enviadas };
}

/** Un supervisor con sesión se manda una prueba a SU dispositivo. */
async function prueba(req: Request, endpoint: string) {
  const jwt = (req.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '');
  const { data: u } = await db.auth.getUser(jwt);
  if (!u?.user) return responder(401, { error: 'sin sesión' });
  const { data: adm } = await db.from('admins').select('rol, activo').eq('user_id', u.user.id).maybeSingle();
  if (!adm || !adm.activo || adm.rol !== 'supervisor') return responder(403, { error: 'solo supervisores' });
  const { data: s } = await db.from('suscripciones_push').select('id, user_id, endpoint, p256dh, auth, prefs, pausa_hasta, ultimo_resumen').eq('endpoint', endpoint).eq('user_id', u.user.id).maybeSingle();
  if (!s) return responder(404, { error: 'este dispositivo no está registrado' });
  const ok = await enviar(s as Suscripcion, { tipo: 'prueba', tienda: null, tag: 'prueba', url: './', titulo: 'Notificación de prueba', cuerpo: 'Así llegarán los avisos de LonDuo POS a este dispositivo.' });
  return responder(ok ? 200 : 502, { ok });
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  if (req.method !== 'POST') return responder(405, { error: 'método no permitido' });
  const cuerpo = (await req.json().catch(() => ({}))) as { op_id?: string; accion?: string; endpoint?: string };
  try {
    if (req.headers.get('x-londuo-secret') && req.headers.get('x-londuo-secret') === env('NOTIFICAR_CLAVE')) {
      if (cuerpo.op_id) return responder(200, await notificarOp(cuerpo.op_id));
      if (cuerpo.accion === 'resumen') return responder(200, await resumenTick());
      return responder(400, { error: 'petición desconocida' });
    }
    if (cuerpo.accion === 'prueba' && cuerpo.endpoint) return await prueba(req, cuerpo.endpoint);
    return responder(401, { error: 'no autorizado' });
  } catch (e) {
    return responder(500, { error: String((e as Error).message ?? e).slice(0, 300) });
  }
});
