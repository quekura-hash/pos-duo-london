// Edge Function `reporte-contadora` (Deno): manda por correo (Resend) el reporte de ventas del mes a la contadora, un correo por CAJA (cada caja con sus destinatarios).
//  · La dispara pg_cron a las 9, 10 y 11 p. m. y a las 9 a. m. de Hermosillo con la cabecera `x-londuo-secret`; ella decide si toca (último día del mes de 9 p. m. en adelante, o el día 1 de 9 a. m. en adelante).
//    Un envío fallido se reintenta en la siguiente corrida; al cuarto fallo avisa al teléfono del supervisor (función `notificar`).
//  · Un supervisor con sesión la llama con { accion: 'prueba', tienda, caja } para recibir, SOLO él, el reporte de lo que va del mes.
// Despliegue sin verificación de JWT del gateway (el cron no tiene sesión): la autenticación la hace esta función.
// Se despliega EMPAQUETADA (scripts/empaquetar-funcion.mjs): importa la lógica de src/ (puro, probado en test/68).
import { createClient } from 'npm:@supabase/supabase-js@2';
import ExcelJS from 'npm:exceljs@4.4.0';
import { avisoDeFallos, ejecutarMensual, ejecutarPrueba, type Dependencias } from '../../../src/reporte-contadora-envio.ts';
import { limpiarCorreos } from '../../../src/reporte-contadora.ts';
import { escribirXlsx } from '../../../src/xlsx.ts';

const env = (k: string) => Deno.env.get(k) ?? '';
const db = createClient(env('SUPABASE_URL'), env('SUPABASE_SERVICE_ROLE_KEY'), { auth: { persistSession: false }, db: { schema: 'pos' } });
const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info', 'Access-Control-Allow-Methods': 'POST, OPTIONS' };
const responder = (estado: number, cuerpo: unknown) => new Response(JSON.stringify(cuerpo), { status: estado, headers: { ...CORS, 'Content-Type': 'application/json' } });

const ajuste = async (clave: string) => ((await db.from('ajustes_internos').select('valor').eq('clave', clave).maybeSingle()).data?.valor as string | undefined) ?? '';
const aBase64 = (b: Uint8Array) => { let s = ''; for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000)); return btoa(s); };

async function paginas<T>(consulta: (desde: number, hasta: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>): Promise<T[]> {
  const todo: T[] = [];
  for (let p = 0; ; p++) {
    const { data, error } = await consulta(p * 1000, p * 1000 + 999);
    if (error) throw new Error(`base de datos: ${error.message}`);
    todo.push(...(data ?? []));
    if (!data || data.length < 1000) return todo;
  }
}

function dependencias(): Dependencias {
  return {
    ahora: () => new Date().toISOString(),
    cajasConfiguradas: async () => ((await db.from('reporte_contadora').select('tienda, caja, activo, correos')).data ?? []) as { tienda: string; caja: number; activo: boolean; correos: string[] }[],
    enviados: async () => new Set(((await db.from('envios_reporte').select('periodo, tienda, caja').not('enviado_en', 'is', null)).data ?? []).map((r: { periodo: string; tienda: string; caja: number }) => `${r.periodo}|${r.tienda}/${r.caja}`)),
    agotados: async () => new Set(((await db.from('envios_reporte').select('periodo, tienda, caja').is('enviado_en', null).gte('intentos', 4)).data ?? []).map((r: { periodo: string; tienda: string; caja: number }) => `${r.periodo}|${r.tienda}/${r.caja}`)),
    reclamar: async (p, t, c) => ((await db.rpc('reclamar_envio_reporte', { p_periodo: p, p_tienda: t, p_caja: c })).data as boolean) === true,
    fallar: async (p, t, c, error) => (((await db.rpc('fallar_envio_reporte', { p_periodo: p, p_tienda: t, p_caja: c, p_error: error })).data as number | null) ?? 1),
    reiniciar: async (p, t, c) => { await db.rpc('liberar_envio_reporte', { p_periodo: p, p_tienda: t, p_caja: c }); },
    avisarFallos: async (fallos) => {
      // Aviso al teléfono con la función `notificar` (misma clave compartida): llega a los dispositivos del supervisor que tengan activadas las alertas.
      const [url, clave] = await Promise.all([ajuste('notificar_url'), ajuste('notificar_clave')]);
      if (url && clave) {
        const a = avisoDeFallos(fallos);
        await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-londuo-secret': clave }, body: JSON.stringify({ accion: 'alerta', titulo: a.titulo, cuerpo: a.cuerpo, tag: a.tag, url: './#reportes' }) }).catch(() => undefined);
      }
      for (const f of fallos) await db.rpc('marcar_aviso_reporte', { p_periodo: f.periodo, p_tienda: f.tienda, p_caja: f.caja });
    },
    registrar: async (p, t, c, r) => { await db.rpc('registrar_envio_reporte', { p_periodo: p, p_tienda: t, p_caja: c, p_correos: r.correos, p_tickets: r.tickets, p_total: r.total, p_proveedor: r.proveedor_id }); },
    leerOps: async (desde, hasta) => {
      const cols = 'op_id, tipo, tienda, caja, origen, ocurrio_en, payload';
      const [ventas, cancelaciones, historicas, reglas] = await Promise.all([
        paginas((a, b) => db.from('ops').select(cols).eq('tipo', 'sale.confirmed').gte('ocurrio_en', desde).lt('ocurrio_en', hasta).order('seq').range(a, b)),
        paginas((a, b) => db.from('ops').select(cols).eq('tipo', 'sale.cancelled').order('seq').range(a, b)),
        paginas((a, b) => db.from('ops').select(cols).eq('tipo', 'venta.historica').order('seq').range(a, b)),
        paginas((a, b) => db.from('ops').select(cols).eq('tipo', 'historico.duplicados').order('seq').range(a, b)), // copias duplicadas que ya no cuentan
      ]);
      return [...ventas, ...cancelaciones, ...historicas, ...reglas] as never;
    },
    generarXlsx: (hojas) => escribirXlsx(ExcelJS, hojas),
    enviarCorreo: async (c) => {
      const llave = env('RESEND_API_KEY');
      if (!llave) throw new Error('falta el secreto RESEND_API_KEY en la función');
      const de = (await ajuste('reporte_remitente')) || env('REPORTE_REMITENTE') || 'LonDuo POS <onboarding@resend.dev>';
      const r = await fetch('https://api.resend.com/emails', {
        method: 'POST', headers: { Authorization: `Bearer ${llave}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ from: de, to: c.para, subject: c.asunto, text: c.texto, html: c.html, attachments: [{ filename: c.adjunto.nombre, content: aBase64(c.adjunto.bytes) }] }),
      });
      const j = (await r.json().catch(() => ({}))) as { id?: string; message?: string; name?: string };
      if (!r.ok || !j.id) throw new Error(`Resend ${r.status}: ${j.message ?? j.name ?? 'sin detalle'}`);
      return { id: j.id };
    },
  };
}

async function prueba(req: Request, tienda: string, caja: number) {
  const jwt = (req.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '');
  const { data: u } = await db.auth.getUser(jwt);
  if (!u?.user?.email) return responder(401, { error: 'sin sesión' });
  const { data: adm } = await db.from('admins').select('rol, activo').eq('user_id', u.user.id).maybeSingle();
  if (!adm || !adm.activo || adm.rol !== 'supervisor') return responder(403, { error: 'solo supervisores' });
  if ((tienda !== 'DUO' && tienda !== 'LON') || !Number.isInteger(caja) || caja < 1) return responder(400, { error: 'tienda o caja inválida' });
  const { correos } = limpiarCorreos(u.user.email);
  if (!correos.length) return responder(400, { error: 'tu cuenta no tiene un correo válido' });
  return responder(200, { ok: true, correo: correos[0], ...(await ejecutarPrueba(dependencias(), tienda, caja, correos[0]!)) });
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  if (req.method !== 'POST') return responder(405, { error: 'método no permitido' });
  const cuerpo = (await req.json().catch(() => ({}))) as { accion?: string; tienda?: string; caja?: number; periodo?: string };
  try {
    const clave = await ajuste('notificar_clave');
    if (clave && req.headers.get('x-londuo-secret') === clave && cuerpo.accion === 'mensual') {
      return responder(200, await ejecutarMensual(dependencias(), { periodo: /^\d{4}-\d{2}$/.test(cuerpo.periodo ?? '') ? cuerpo.periodo : undefined, tienda: cuerpo.tienda, caja: cuerpo.caja }));
    }
    if (cuerpo.accion === 'prueba' && cuerpo.tienda) return await prueba(req, cuerpo.tienda, Number(cuerpo.caja));
    return responder(401, { error: 'no autorizado' });
  } catch (e) {
    return responder(500, { error: String((e as Error).message ?? e).slice(0, 300) });
  }
});
