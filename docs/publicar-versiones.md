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
3. **Entorno de Claude Code en la web** (menú del entorno en la barra de título de la sesión → Edit):
   - *Network access*: agregar el dominio `zchgpakvhrdpabvsxpnn.supabase.co` en *Allowed domains* (dejar marcada la casilla de gestores de paquetes).
   - *Variables de entorno* (nunca en el chat): `LONDUO_PUBLICADOR_CORREO` y `LONDUO_PUBLICADOR_CLAVE`.
   - *Setup script* (para poder armar el instalador de Windows en Linux):
     ```bash
     dpkg --add-architecture i386 && apt-get update
     DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends wine wine64 wine32:i386 xvfb
     cd windows && npm ci
     ```
   Una sesión **nueva** recoge estos cambios.

## Cada versión

1. Subir la versión en `package.json` de la raíz (p. ej. `0.2.3`), correr las pruebas (`npm test`), commit y push.
2. Armar: `WINEDEBUG=-all xvfb-run -a node windows/construir.mjs` → deja en `dist/windows/` el instalador, su `.blockmap` y `pruebas.yml`.
3. Publicar en el canal de pruebas: `node windows/publicar.mjs`. Para el canal estable (después de validar en la caja de pruebas): `node windows/publicar.mjs --estable`.

`publicar.mjs` sube primero el instalador y el `.blockmap` y **al final** el archivo de versión (ninguna caja ve una versión sin instalador), verifica lo que ve cualquiera en la dirección pública (versión y tamaño) y conserva las últimas 3 versiones. Si algo falla, no sube el archivo de versión.

## Cómo la recibe la caja

Cada caja revisa a los 15 s de abrir y cada 30 min (canal *pruebas* lee `pruebas.yml`; canal *estable* lee `latest.yml`), descarga en segundo plano (diferencial) y ofrece «Instalar ahora» o instala al cerrar la app. Se puede forzar en Hardware → Configurar impresora y cajón → Actualizaciones → Buscar actualización ahora.
