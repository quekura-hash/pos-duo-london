# Arquitectura — Etapa 0 (borrador v2)

Estado: **borrador para validación**. Nada de este documento está probado en equipo real.
Etiquetas: **[C]** confirmado por el propietario · **[P]** propuesta técnica · **[?]** política o dato pendiente.

Esta versión corrige la v1 en seis puntos. Las políticas comerciales siguen **sin aprobar**; el
código y las pruebas sintéticas las tratan como parámetros explícitos, nunca como comportamiento
por omisión silencioso.

## 0. Base técnica [P]

- App Windows: Electron + TypeScript. SQLite (WAL) local en cada caja. Servicio "hub" por tienda.
  Supabase (Postgres) como central y panel remoto.
- Cada caja confirma la venta en **su propia SQLite** (venta, renglones, pagos, folio, movimientos y
  cola de salida en una sola transacción) antes de imprimir. Después replica al hub y el hub al central.
- Sincronización por **bitácora de operaciones inmutables** con UUIDv7 creado en el origen.
- Importes en centavos enteros. Hora en UTC con zona `America/Hermosillo`; `ocurrió_en` y
  `sincronizado_en` separados.

## 1. Tres situaciones distintas (no mezclar)

| Situación | Qué falla | Estado |
|---|---|---|
| **A. Sin internet** | Solo el enlace hub ↔ central | **[C]** Operación normal: LAN y hub funcionan, las dos cajas se coordinan, la cola se acumula, panel remoto muestra "al corte de HH:MM". |
| **B. Red local u hub averiados** | Caja ↔ hub (cable, switch, equipo del hub apagado) | **[?] No aprobada.** Ver abajo. |
| **C. Caja averiada** | Una caja o su disco | Recuperación (sección 3) y cobros de tarjeta (sección 4). |

La interfaz muestra tres indicadores independientes: internet, hub y última sincronización. Una
caja no debe inferir "sin hub" a partir de "sin internet" ni al revés.

**Situación B.** Técnicamente el modelo "caja primero" permite seguir vendiendo, pero hacerlo
implica riesgos que el propietario no ha aceptado: inventario local desactualizado, sobreventa de la
última pieza, devoluciones contra ventas de la otra caja, cargos de crédito sin saldo compartido.
Hasta que se apruebe una política, el sistema expone un parámetro por tienda:

`hub_no_disponible` ∈ { `bloquear_ventas_nuevas`, `vender_autonomo_con_aviso` }

- Sin valor aprobado no hay valor por omisión en producción: la instalación exige elegirlo.
- Las pruebas sintéticas cubren **ambos** valores.
- Con `vender_autonomo_con_aviso`, además, cada operación de riesgo (devolución de venta ajena,
  cargo a crédito, apartado) tiene su propia regla pendiente (sección 2).

## 2. Deduplicación ≠ conflicto de negocio

Son dos capas con propósitos distintos.

**Capa 1 — Deduplicación (identidad de la entrega).** Un evento con el mismo `op_id` se inserta una
sola vez; reenviar no cambia nada. El `op_id` se crea al **iniciar la intención** (abrir el carrito,
abrir el formulario de abono/devolución), no al pulsar el botón, de modo que doble clic, reintento o
reinicio reutilizan el mismo identificador. Esto evita duplicados de *entrega*, nada más.

**Capa 2 — Invariantes de negocio.** Dos operaciones con `op_id` distintos pueden ser legítimas por
separado y violar una regla juntas. La deduplicación no las detecta. Cada invariante se clasifica:

| Invariante | Autoridad que puede *prevenir* | Si no hay acceso a la autoridad | Política |
|---|---|---|---|
| Devolver ≤ vendido − ya devuelto, por renglón de la venta original | Hub de la tienda donde se vendió, vía asignación de devolución por renglón | Solo se **detecta** al sincronizar; genera incidencia | [?] ¿Se permite devolver una venta de otra caja/tienda estando aislado? |
| Última pieza vendida en dos cajas | Hub (reserva al agregar) | Ambas ventas ocurrieron físicamente; saldo negativo "por conciliar" | [?] Política de existencia insuficiente |
| Cargo de crédito de empleada vs límite 25,000 | Central (saldo compartido) | Cupo offline por tienda | [?] Reparto del cupo y comportamiento al agotarse |
| Abono doble (dos intenciones, cada una con su `op_id`) | Pantalla de confirmación; clave natural (cliente, importe, minuto) → advertencia | Se detecta como posible duplicado | [?] Regla de sospecha de duplicado |
| Código duplicado creado en dos ubicaciones | Central al sincronizar | Ambos registros se conservan | Ver sección 5 |

Reglas de diseño:
1. Una operación que ya ocurrió físicamente (se entregó dinero, se llevó la prenda) **nunca se
   descarta ni se modifica** al detectar un conflicto. Se registra una **incidencia** vinculada
   (`abierta → revisada → resuelta`) con la operación afectada, la regla violada y quien resuelve.
2. La prevención solo existe donde hay una autoridad alcanzable. Donde no la hay, el diseño promete
   *detección y trazabilidad*, no prevención.
3. Reportes de incidencias abiertas visibles para administración.

## 3. Recuperación sin reutilizar folios

Objetivo: tras perder el disco de una caja, **ningún folio emitido pudo haber sido reutilizado**,
incluso si hubo ventas que nunca llegaron al hub ni al central.

Mecanismos acumulables:

1. **Contador durable** en la misma transacción que la venta (ya definido).
2. **Marca de agua (HWM)** del folio: cada operación enviada y cada latido a hub/central la lleva.
   Hub y central guardan el máximo conocido por caja.
3. **Arrendamiento de folios por adelantado [P]**: la caja pide al hub un *techo* (`N + K`). El hub
   lo registra durablemente antes de concedérselo y lo replica al central cuando hay internet. La
   caja solo emite folios ≤ techo y renueva cuando le queda menos de la mitad. Tras una pérdida
   total de la caja, el contador reinicia en `techo + 1`: nunca hay reutilización, aunque se hayan
   emitido folios que nadie más conoce.
   - Costo: tras una pérdida pueden quedar **huecos** (folios del techo no emitidos). Se registran
     como `folio_no_emitido_por_recuperación`, nunca se renumera ni se rellena.
   - `K` provisional: 30 (en el corte de referencia hay ~13 tickets/día/caja; se afinará).
   - **[?] Requiere que el propietario acepte huecos documentados.** Sin esa aceptación, este
     mecanismo no se activa.
4. **Recuperación manual (alternativa sin huecos)**: un administrador declara el siguiente folio
   tras revisar evidencia física (último ticket impreso, corte impreso, bitácora de papel). El
   sistema rechaza cualquier valor menor o igual a cualquier HWM conocido y exige confirmación.
5. **Cerco por ticket escaneado**: si se escanea un ticket de la serie de una caja con folio mayor
   que su contador, se bloquea la emisión y se abre incidencia.
6. Una caja restaurada entra en estado `recuperación`: no emite folios hasta completar 3 o 4.

Límite honesto: si se perdieran *a la vez* la caja, el hub, el respaldo y no hubiera conexión al
central, el folio solo se podría reconstruir con evidencia física (mecanismo 4). Los respaldos
cifrados en un segundo equipo de la LAN reducen ese caso.

## 4. Cobros con tarjeta aprobados antes de un fallo local

La terminal bancaria es un efecto externo irreversible desde la caja. Orden obligatorio:

1. El **carrito en curso** se guarda de forma durable en cada cambio (borrador recuperable).
2. Al elegir "Cobrar con tarjeta" se crea y guarda un `intento_cobro_tarjeta` con `op_id`, importe,
   caja y referencia del borrador, en estado `iniciado`, **antes** de usar la terminal.
3. El cajero captura el resultado de la terminal (aprobado/rechazado, marca, últimos 4, autorización).
   Con aprobación, una sola transacción pasa el intento a `aprobado` y confirma venta, pago, folio y
   movimientos. Nunca se simula una aprobación.
4. Si el equipo se apaga o falla entre 2 y 3, al reiniciar existe un intento `iniciado` sin
   resolver. La caja muestra **"Cobro pendiente de conciliar"** y no permite seguir sin resolverlo:
   - **Aprobado en la terminal** → capturar los datos del comprobante, recuperar el borrador y
     completar la venta (o registrar el pago contra la venta recuperada).
   - **No aprobado / cancelado en la terminal** → marcar el intento como `no_cobrado`.
   - **No se sabe** → queda `desconocido`, abre incidencia y entra al cierre de lote.
5. El corte y el cierre de lote de la terminal se concilian: un cobro del lote sin venta asociada es
   incidencia; una venta con tarjeta sin cobro en el lote también.
6. Si el disco se pierde, la evidencia es el comprobante y el lote de la terminal; la conciliación
   del punto 5 lo detecta aunque el intento local no exista.
7. Con la futura integración EVO [?], el `op_id` del intento viajará como referencia de la
   transacción. Hasta verificar modelo y acceso, no se promete.

Efectivo mixto: la parte en efectivo se registra solo cuando la venta se confirma, junto con la parte
de tarjeta, para no contar dinero de una venta que quedó sin confirmar.

## 5. Identidad de artículos y Item # — sin fusiones ni saltos sin acuerdo

Reglas **[C]**: el código determina la identidad comercial; mismo nombre, descripción, marca o
estilo **no** justifican fusionar; el Item # original se conserva; los conflictos se muestran.

Reglas de importación y alta (sin decisiones nuevas de negocio):

| Caso | Resultado |
|---|---|
| Mismo código y mismo Item # | Mismo artículo (actualizar por código, como indica el propietario) |
| Mismo código, distinto Item # | **Conflicto**: se conservan ambos registros de origen; no se fusiona ni renumera |
| Mismo Item #, distinto código | **Conflicto**: igual |
| Mismo marca/estilo/descripción, distinto código | **Dos artículos distintos** |
| Código sin Item # en el origen | Se importa con Item # ausente, no se inventa |

Asignación de Item # para altas nuevas — **ninguna estrategia está aprobada** y por eso el modelo no
asume una:

| Opción | Efecto | Costo |
|---|---|---|
| a. Item # asignado por el central al sincronizar, en orden de llegada | Consecutivo sin saltos | El artículo creado sin conexión muestra "Item # pendiente" hasta sincronizar; vende por código |
| b. Bloques reservados por ubicación | Disponible al instante | Puede dejar **saltos** en el consecutivo |
| c. Espacios de numeración separados por ubicación | Disponible al instante, sin saltos dentro de cada espacio | Cambia el significado del consecutivo único |

- `item_no` admite valor nulo y es único cuando existe.
- El simulador parametriza la estrategia; las pruebas corren con las tres.
- **[?]** El propietario elige. Hasta entonces, el desarrollo no emite Item # nuevos en producción.
- Dos códigos iguales creados sin conexión en ubicaciones distintas se conservan como dos registros
  con una incidencia; al escanear ese código el POS pide elegir cuál, hasta que un administrador
  resuelva. Nunca se fusionan en silencio.

## 6. Hub: opciones y dependencias (sin asumir compras)

El hub es un **rol de software**, no un equipo específico. El mismo código se despliega en cualquiera
de las dos formas; elegir es una decisión de instalación y puede tomarse más tarde.

| | **A. Hub en Caja 1** | **B. Equipo dedicado** |
|---|---|---|
| Equipo | Ya existe | Debe existir un equipo adicional (nuevo, reutilizado o existente: decisión del propietario) |
| Dependencias | Caja 1 encendida y con sesión/servicio iniciado durante todo el horario de Caja 2; reinicios de Windows y apagados afectan a Caja 2; carga del POS compartida con el hub | Equipo encendido siempre; ubicación física con corriente y acceso; alguien responsable de actualizaciones |
| Si falla | Cae también la coordinación de Caja 2 → situación B (política pendiente) | Cae la coordinación de ambas cajas → situación B |
| Efecto en aislamiento | Caja 1 sola sigue con su BD; Caja 2 queda aislada | Ambas quedan aisladas |
| Común a ambas | Red cableada, IP reservada, hora sincronizada, servicio de Windows de inicio automático, destino de respaldo en otro dispositivo, UPS recomendado | igual |

No se recomienda una opción ni se da por hecha ninguna compra. Para decidir, el propietario necesita
responder solo: ¿qué equipo(s) existen y quién se hace responsable de mantenerlo encendido y
actualizado?

## 7. Políticas y datos pendientes (explícitos)

| ID | Pendiente |
|---|---|
| P-01 | Comportamiento en situación B: `bloquear_ventas_nuevas` o `vender_autonomo_con_aviso` |
| P-02 | Existencia insuficiente / última pieza |
| P-03 | Devolución de una venta de otra caja o tienda; excepciones sin ticket |
| P-04 | Reparto del límite de crédito entre tiendas desconectadas |
| P-05 | Regla de sospecha de abono duplicado |
| P-06 | Huecos documentados de folio tras recuperación (activa el arrendamiento) |
| P-07 | Estrategia de Item # para altas nuevas (a, b o c) |
| P-08 | Series para devoluciones/abonos y momento exacto de asignación del folio |
| P-09 | Hub en Caja 1 o equipo dedicado |
| P-10 | Catálogos de DÚO y London: ¿comparten Item # y códigos? |
| P-11 | Excel reales (catálogo, existencias, ventas) |

## 8. Pruebas sintéticas previstas (Etapa 0 → 1)

Simulador determinista (2 cajas, hub, central; particiones, reinicios, reenvíos, caída de disco).
Todo con datos sintéticos; sin datos personales de tickets reales.

- Deduplicación: reenvío múltiple, corte tras guardar, reinicio (prueba de aceptación 6).
- Invariantes: doble devolución concurrente y cargo de crédito simultáneo producen incidencia y no
  pierden operaciones.
- Folios: pérdida de disco con ventas no sincronizadas no reutiliza folios (con arrendamiento y con
  recuperación manual).
- Tarjeta: fallo entre intento y confirmación recupera el borrador y exige conciliación.
- Identidad: importación con conflictos de código/Item #; ninguna fusión automática; Item # no se
  modifica.
- Situaciones A, B y C por separado, con ambas políticas de P-01.
