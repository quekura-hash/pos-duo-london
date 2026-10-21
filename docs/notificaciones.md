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

## Qué falta para que lleguen avisos reales (requiere autorización del propietario)

1. Aplicar la migración 0005 en Supabase.
2. Generar el par de llaves VAPID. La **privada** y `NOTIFICAR_CLAVE` se guardan solo como secretos de la función (nunca en el repo ni en el chat); la **pública** va en el build (`LONDUO_VAPID_PUBLICA`).
3. Desplegar la función `notificar` con `verify_jwt: false` (se autentica con la cabecera `x-londuo-secret`).
4. Ejecutar `pos.configurar_notificaciones(url, clave)` para guardar la URL de la función y programar el resumen (cada 15 min).
5. Publicar `dist/admin-web/` (`node scripts/construir-admin.mjs --pwa`) en un hosting HTTPS (p. ej. Cloudflare Pages). iOS ≥ 16.4 solo permite push desde la app agregada a la pantalla de inicio.

## En el iPhone

Safari › abrir la dirección › Compartir › Agregar a pantalla de inicio › abrir desde el icono › Avisos › Activar avisos.

## Verificado y no verificado

Verificado: redacción y filtros (`test/64`), trigger y RLS con Postgres real (`test/54` CS10), pantalla en iPhone emulado con push simulado (`test/65`), service worker (`test/63`). **No verificado**: entrega real a un iPhone, `pg_net`/`pg_cron` reales y la función desplegada.
