# Reporte mensual a la contadora (correo automático)

El último día de cada mes a las 9:00 p. m. (hora de Hermosillo) se manda por correo, **un correo por caja y cada caja a sus propios destinatarios** (DÚO Caja 1, DÚO Caja 2, London Caja 1…), el Excel del mes de esa caja (hojas «Detalle de ventas» y «Resumen por día»; las ventas del POS anterior van en la Caja 1 de DÚO). Si falla, reintenta a las 10 p. m., a las 11 p. m. y a las 9 a. m. del día siguiente (4 intentos en total); si los 4 fallan manda un aviso al teléfono del supervisor («El reporte no se envió») y ya no insiste. Lo que se venda después de las 9:00 p. m. del último día no entra en ese archivo (se puede descargar el mes completo desde Reportes → Exportar a Excel).

## Piezas

| Pieza | Dónde |
|---|---|
| Qué se manda, cuándo toca y el texto del correo (puro, con pruebas) | `src/reporte-contadora.ts`, `src/reporte-contadora-envio.ts` (`test/68`) |
| Tablas, reserva atómica del envío y programación | `supabase/migrations/0007_reporte_contadora.sql` (`test/54` CS11) |
| Función que arma el Excel y manda el correo (Resend) | `supabase/functions/reporte-contadora/index.ts`; se despliega empaquetada con `node scripts/empaquetar-funcion.mjs reporte-contadora` → `dist/funciones/reporte-contadora/index.ts` |
| Pantalla: correos por caja, últimos envíos y «Enviarme una prueba» | Reportes (solo supervisor): `pintarPanelContadora` en `app.js` (`test/67` RH2) |

## Para activarlo en producción (requiere autorización del propietario)

1. Aplicar la migración 0007 (en el SQL Editor, o con autorización expresa).
2. Cuenta en Resend (https://resend.com). **La llave de API se escribe en el panel de Supabase** (Edge Functions → Secrets → `RESEND_API_KEY`), nunca en el chat ni en el repo.
3. Para escribirle a la contadora hay que verificar un dominio en Resend (registros DNS). Mientras tanto, con el remitente de pruebas de Resend solo se puede escribir al correo de la propia cuenta de Resend.
4. Remitente: `insert into pos.ajustes_internos (clave, valor) values ('reporte_remitente', 'LonDuo POS <reportes@tu-dominio>') on conflict (clave) do update set valor = excluded.valor;`
5. Desplegar la función `reporte-contadora` con `verify_jwt: false` (se autentica sola: clave compartida del cron o sesión de supervisor).
6. Aplicar también la migración 0008 (reintentos) y redesplegar `notificar` (acción `alerta`) y `reporte-contadora`.
7. `select pos.configurar_reporte_contadora('https://<proyecto>.supabase.co/functions/v1/reporte-contadora');` (programa las corridas de las 04, 05, 06 y 16 UTC = 21, 22, 23 y 9 h de Hermosillo; reutiliza la clave de `configurar_notificaciones`).
8. En Reportes: escribir los correos de cada caja, activar «Enviar el informe mensual de esta caja» y usar «Enviarme una prueba» (llega solo a tu correo).

## Verificado y no verificado

Verificado: calendario y reglas de cuándo toca, un solo envío por mes y caja, reintento tras fallo, prueba solo al correo de quien la pide, contenido del Excel adjunto, RLS y reserva atómica con Postgres real simulado, pantalla en navegador. **No verificado**: envío real por Resend, la función desplegada, `pg_cron`/`pg_net` reales.
