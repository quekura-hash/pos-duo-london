# Publicar una versión de la app de Windows

Guía para publicar LonDuo POS (app de Windows) en el almacén de actualizaciones de Supabase. Las cajas la reciben solas.

## Una sola vez (lo hace el propietario)

1. **Migración 0004** en el SQL Editor de Supabase (`supabase/migrations/0004_publicador.sql`), después de 0001, 0002 y 0003.
2. **Cuenta publicadora**: Authentication → Users → Add user → `publicador@londuo.mx` con una contraseña fuerte y *Auto Confirm User*. Después, en el SQL Editor:
   ```sql
   insert into pos.admins (user_id, rol, alias)
   select id, 'publicador', 'Publicador de versiones' from auth.users where email = 'publicador@londuo.mx';
   ```
   Esa cuenta **solo** puede escribir en el almacén `actualizaciones` (no ve ventas, inventario, usuarios ni configuración).
3. **Secretos en GitHub** (repositorio → Settings → Secrets and variables → Actions → New repository secret): `LONDUO_PUBLICADOR_CORREO` (`publicador@londuo.mx`) y `LONDUO_PUBLICADOR_CLAVE` (la contraseña de esa cuenta). Nunca en el chat. La app de Windows se arma en GitHub Actions (runner de Windows, sin wine), no en el entorno de Claude Code.

## Cada versión

1. Subir la versión en `package.json` de la raíz (p. ej. `0.2.5`), correr las pruebas (`npm test`), commit y push a la rama.
2. GitHub → Actions → **Publicar app de Windows** → *Run workflow* (elegir la rama). Marcar *estable* solo después de validar la versión en la caja de pruebas. El flujo (`.github/workflows/publicar-windows.yml`) corre `node windows/construir.mjs` y `node windows/publicar.mjs [--estable]`.
3. Comprobar: `https://zchgpakvhrdpabvsxpnn.supabase.co/storage/v1/object/public/actualizaciones/pruebas.yml` debe empezar con `version:` y el número nuevo.

También se puede hacer a mano en un Windows con Node 22: `npm ci`, `(cd windows && npm ci)`, `node windows/construir.mjs` y `node windows/publicar.mjs` (con las dos variables de entorno).

`publicar.mjs` sube primero el instalador y el `.blockmap` y **al final** el archivo de versión (ninguna caja ve una versión sin instalador), verifica lo que ve cualquiera en la dirección pública (versión y tamaño) y conserva las últimas 3 versiones. Si algo falla, no sube el archivo de versión.

## Cómo la recibe la caja

Cada caja revisa a los 15 s de abrir y cada 30 min (canal *pruebas* lee `pruebas.yml`; canal *estable* lee `latest.yml`), descarga en segundo plano (diferencial) y ofrece «Instalar ahora» o instala al cerrar la app. Se puede forzar en Hardware → Configurar impresora y cajón → Actualizaciones → Buscar actualización ahora.
