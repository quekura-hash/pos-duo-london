# Avisos al teléfono (Administración)

La Administración se instala en la pantalla de inicio del iPhone (PWA) y recibe avisos push: cada venta, corte, resumen del día, devoluciones, cancelaciones, retiros y alertas. Cada dispositivo tiene sus propias preferencias y puede pausarlas.

## Piezas

| Pieza | Dónde |
|---|---|
| Tabla de dispositivos, trigger sobre `pos.ops`, cron del resumen | `supabase/migrations/0005_notificaciones.sql` |
| Qué avisar y cómo se redacta (puro, con pruebas) | `supabase/functions/notificar/formato.ts` |
| Función que envía el push (Web Push / VAPID) | `supabase/functions/notificar/index.ts` |
| Service worker que muestra el aviso | `src/app/publico/pwa/sw.js` |
| Pantalla «Avisos» y suscripción del dispositivo | `src/app/publico/app.js` (`vistaAvisos`), `scripts/arranque-admin.js` (`__POS_NOTIF__`) |

El trigger nunca frena una venta: si el aviso falla, la bitácora queda igual.

## Estado del servidor (londuo-pos)

Aplicado y desplegado con autorización del propietario: migraciones 0005 y 0006, función `notificar` (sin verificación de JWT del gateway; se autentica sola) y el resumen programado cada 15 min. Las llaves VAPID y la clave compartida **las genera la propia función/la base y viven en `pos.ajustes_internos`** (sin acceso para anon ni authenticated): no están en el repo ni pasaron por el chat. La llave pública se obtiene con `POST /functions/v1/notificar {"accion":"vapid"}`.

## Para publicar la página

1. Construir con la llave pública: `LONDUO_SUPABASE_URL=… LONDUO_SUPABASE_KEY=… LONDUO_VAPID_PUBLICA=$(curl -s -X POST …/functions/v1/notificar -d '{"accion":"vapid"}' | …) node scripts/construir-admin.mjs --pwa`.
2. Subir `dist/admin-web/` a un hosting HTTPS (Cloudflare Pages). iOS ≥ 16.4 solo permite push desde la app agregada a la pantalla de inicio.

## En el iPhone

Safari › abrir la dirección › Compartir › Agregar a pantalla de inicio › abrir desde el icono › Avisos › Activar avisos.

## Verificado y no verificado

Verificado: redacción y filtros (`test/64`), trigger y RLS con Postgres real (`test/54` CS10), pantalla en iPhone emulado con push simulado (`test/65`), service worker (`test/63`). **No verificado**: entrega real a un iPhone, `pg_net`/`pg_cron` reales y la función desplegada.
