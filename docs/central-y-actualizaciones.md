# LonDuo POS — Central en Supabase y actualizaciones

Estado: **migración 0001 ejecutada por el propietario en el proyecto `londuo-pos`; puente y cliente listos y probados contra Postgres local (§53 de la arquitectura)**. Falta conectar la pantalla de Administración y construir la sincronización de hubs y cajas.

## 1. Qué es cada parte

| Parte | Dónde corre | Qué guarda / hace |
|---|---|---|
| **Central** | Supabase (Postgres) | La bitácora de operaciones inmutable (`pos.ops`), dispositivos, administradores (Supabase Auth), contadores (Item #), versiones publicadas y solicitudes de autorización en tiempo real. |
| **Administración web** | Navegador (iPhone, Mac, PC Windows, PC de almacén) | La misma interfaz de hoy, leyendo y escribiendo operaciones en el central. Se actualiza sola al publicar. |
| **Hub** (Caja 1 de DÚO, luego London) | App de Windows | Replica el catálogo e inventario de su tienda, coordina las dos cajas y sube las ventas al central. |
| **Cajas** | App de Windows | Venden aunque no haya hub ni internet (SQLite local). |

Flujo: Administración cambia el catálogo → central → hub → cajas. Ventas: caja → hub → central. Es el mismo protocolo que ya existe y está probado (bitácora con `op_id`, idempotente).

## 2. Decisiones y por qué

1. **El central guarda la bitácora, no reglas nuevas en SQL.** La lógica de negocio (promociones, folios, cupones…) ya está probada en TypeScript; el central la aloja como datos. Escribir en la bitácora solo pasa por funciones (`subir_ops`), nunca por insert/update/delete directo; **nadie edita ni borra una operación**.
2. **Administración web = el mismo código** con un adaptador de repositorio que lee y escribe en Supabase (carga las operaciones con cursor `seq` y se mantiene al día con Realtime). Para el volumen de las dos tiendas es suficiente; si crece, se agregan resúmenes en el servidor.
3. **Roles con RLS**: supervisor lo ve y lo hace todo; almacenista solo operaciones de inventario y almacén (`tipo_de_almacen`). Los hubs y cajas **no** usan usuarios de Supabase Auth: entran por una Edge Function con la llave de su dispositivo (se guarda el hash); la `service_role` vive solo ahí.
4. **Item #** lo asigna el central (`reservar_item_no`), como ya decidimos (P-07).
5. **Autorizaciones en tiempo real** (`solicitudes_autorizacion`): la caja crea una solicitud, el iPhone la recibe por Realtime y un supervisor aprueba o rechaza; la caja sigue pudiendo autorizar con la clave local si no hay internet.
6. **Datos personales** (foto, teléfono, dirección de empleadas) viajan dentro de las operaciones: el acceso a leerlas es solo de supervisores.

## 3. Cómo se actualiza cada parte

| Parte | Mecanismo |
|---|---|
| Administración web | Se publica una versión nueva y todos la reciben al abrir (o al recargar). La tabla `pos.versiones` (componente `admin_web`) permite mostrar «hay versión nueva» y exigir una mínima. |
| App de Windows (hub y cajas) | Descarga automática desde el URL de `pos.versiones` (componente `app_windows`), verificación de la huella `sha256`, instalación **fuera de horario** o al cerrar el corte, y **respaldo cifrado antes de instalar**. |
| Central | Migraciones numeradas (`supabase/migrations/000N_*.sql`), ejecutadas por el propietario; nunca se edita una migración ya ejecutada: se agrega otra. |

Reglas de despliegue:
- **Orden**: central → Administración → hub → Caja 2. Cada parte revisa la versión mínima del central; si es menor, no opera y avisa.
- **Canal de pruebas**: toda versión se publica primero en `pruebas` (PC de pruebas o Caja 2) y se promueve a `estable` cuando se valida.
- **Datos separados del programa**: la base SQLite y la bitácora no se tocan al actualizar; si una versión cambia el esquema, la migración corre al arrancar, después del respaldo.
- **Regresar**: se conservan las dos últimas versiones instaladas y el respaldo anterior.
- **Versión visible**: la pantalla de inicio de sesión y la nota lateral muestran `vX.Y.Z · commit · fecha` (ya implementado en la página de prueba), para saber qué corre en cada equipo.

## 4. Plan por etapas

1. **Ahora** (sin ir a DÚO): proyecto de Supabase nuevo → ejecutar `0001_central.sql` → crear el primer supervisor (Supabase Auth) → **Administración web** conectada al central, probada desde la casa/oficina (Mac, iPhone, PC): cargar el catálogo desde el Excel, departamentos, usuarios y empleadas, promociones, recompensas, tipo de cambio.
2. **App de Windows** (hub + caja) con impresión directa a la Epson/Bixolon, lector y cajón; sincronización con el central.
3. **Instalación en DÚO** (Caja 1 = hub, Caja 2, PC de almacén, PC de administración) y **mes de prueba**.
4. **London**, con la misma app.
5. iPhone: Administración web instalada en la pantalla de inicio + notificaciones de autorización.

## 5. Qué necesita el propietario

- Crear el proyecto de Supabase **nuevo** («londuo-pos»).
- Conectar el conector de Supabase en claude.ai/customize/connectors (y abrir una sesión nueva) **o** guardar un token de solo lectura como secreto del entorno (nunca pegarlo en el chat). Sin acceso, Claude puede seguir escribiendo código y migraciones, pero **no probar contra el proyecto real**.
- Ejecutar él mismo cada migración en el SQL Editor (o autorizar expresamente una migración concreta).

## 6. Pendientes técnicos (no hechos)

- Adaptador `RepoSupabase` (lectura con cursor, escritura vía `subir_ops`, Realtime) y su prueba con un Postgres local.
- Empaquetar la Administración web (hoy es una página de prueba con motor en memoria).
- Edge Function de sincronización de hubs/cajas y registro de dispositivos.
- Publicación de versiones y actualizador de la app de Windows.

## 7. Actualizaciones de la app de Windows (estado)

Implementado en `windows/` (ver §56 de `docs/arquitectura-etapa-0.md`): `electron-updater` con un canal `pruebas` y otro `estable`, verificación sha512, instalación sin interrumpir ventas y respaldo previo. Los archivos de cada versión se publican en el bucket `actualizaciones` (migración 0002). Pendiente: una pantalla de «Publicar versión» en Administración para subirlos sin entrar al panel de Supabase, y registrar cada publicación en `pos.versiones`.
