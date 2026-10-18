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

## 0.1 Reglas de negocio confirmadas sobre cajas, folios y reportes [C]

- Cada una de las cuatro cajas lleva sus propias ventas, folios consecutivos y cortes, independientes de las demás.
- Los folios continúan mes con mes, sin reiniciarse.
- El cajero consulta únicamente las ventas y cortes de **su** caja.
- Solo Administración genera reportes consolidados de todas las cajas, o de una o varias cajas seleccionadas (incluso de tiendas distintas), por el periodo requerido.
- Cada venta conserva tienda, caja y folio originales al consultar, sincronizar o exportar; nunca se renumera para un reporte.
- Las dos cajas de cada tienda comparten el inventario de esa tienda.
- Caja 1 admite efectivo, tarjeta bancaria, mixto y tarjeta de regalo; Caja 2, solo efectivo (P-25 decidido: sin tarjetas de regalo).

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

Regla: **si no se puede asegurar que un folio no se reutilizará, se bloquea su emisión hasta resolverlo.**
Nunca se promete una recuperación sin huecos cuando la evidencia es incompleta. Lo que se garantiza es
*no reutilización*, no *no pérdida*: las ventas que nunca salieron de la caja y se perdieron con su disco
no se pueden reconstruir (ver limitaciones en `pruebas-sinteticas-etapa-0.md`).

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
4. **Atestación manual (alternativa sin arrendamiento)**: un administrador declara el siguiente folio
   citando evidencia física (último ticket impreso, corte impreso, bitácora de papel). El sistema
   **no puede verificarla**: solo rechaza valores menores o iguales a lo conocido (HWM / techo), exige
   una referencia de evidencia, exige confirmación explícita si no hay acceso a hub ni central, y
   deja un registro marcado `verificable: false`. Puede dejar huecos documentados; no los evita.
5. **Cerco por ticket escaneado**: si se escanea un ticket de la serie de una caja con folio mayor
   que su contador, se bloquea la emisión y se abre incidencia.
6. Una caja restaurada (disco nuevo o respaldo) entra en estado `recuperación`: no emite folios hasta
   completar 3 o 4. La recuperación automática (3) solo procede si existe un **techo registrado** en
   hub o central; sin techo (evidencia incompleta) o sin acceso a ninguno, la emisión sigue bloqueada.
7. Una caja con disco nuevo debe **rehidratarse** desde el hub (catálogo, existencias, sus operaciones
   ya recibidas) antes de poder vender; lo que nunca llegó al hub no vuelve y las existencias quedan
   sobreestimadas hasta un conteo físico.

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
   resolver. Se conserva y **no se vuelve a cobrar**: reintentar sobre el mismo carrito devuelve el
   mismo intento. El bloqueo se limita a ese carrito (no se modifica ni se completa por ningún medio
   mientras esté pendiente). Las operaciones independientes de la caja continúan (ventas en efectivo de
   otros carritos, devoluciones, corte). Cómo tratar un *nuevo* cobro con tarjeta mientras hay un
   pendiente es política pendiente (P-12). Resolución:
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

> Actualización 17-oct-2026: el propietario contestó el cuestionario de decisiones. Lo decidido está en la sección 15; esta tabla conserva el texto original de cada pendiente.

| ID | Pendiente |
|---|---|
| P-01 | Comportamiento en situación B: `bloquear_ventas_nuevas` o `vender_autonomo_con_aviso` |
| P-02 | Existencia insuficiente / última pieza |
| P-03 | Devolución de una venta de otra caja o tienda; excepciones sin ticket |
| P-04 | Reparto del límite de crédito entre tiendas desconectadas |
| P-05 | Regla de sospecha de abono duplicado |
| P-06 | Huecos documentados de folio tras recuperación (activa el arrendamiento; sin ella solo hay atestación manual) |
| P-07 | Estrategia de Item # para altas nuevas (a, b o c) |
| P-08 | Series para devoluciones/abonos y momento exacto de asignación del folio |
| P-09 | Hub en Caja 1 o equipo dedicado |
| P-10 | Flujo de almacén y confirmación al primer escaneo: construido (sección 18) |
| P-11 | Excel reales (catálogo, existencias, ventas) |
| P-14 | Vender con existencia marcada no verificada: `permitir_con_aviso` o `bloquear_articulo_no_verificado` (alternativas de ensayo) |
| P-15 | Procedimiento para reconstruir ventas y pagos a partir de tickets/comprobantes tras una pérdida documental |
| P-16 | **Mapeo de «Item Name» e «Item Description»** frente al archivo real: la especificación confirmó Item Name = Marca / Item Description = Descripción, pero en el inventario de DÚO «Item Name» suele traer la prenda (a veces con la marca, p. ej. «BLUSA AMBIANCE») y «Item Description» está vacío en 8,810 de 21,220 artículos. Hay dos perfiles de lectura (confirmado y alternativa); ninguno está decidido |
| P-17 | Cupones, certificados y tarjetas de regalo (precio negativo en el catálogo: 133 en el archivo) y artículos con precio 0 (54): hoy se importan y **no se pueden agregar a una venta**; falta definir su flujo |
| P-18 | Artículos sin UPC (655): hoy se importan, se encuentran por Item #, código alterno o texto, y no se escanean |
| P-19 | Item # repetido en el archivo (3 valores, 6 filas): hoy se conservan ambas filas, señaladas; falta decidir cuál se corrige y cómo |
| P-20 | Existencias: el archivo no trae cantidades. Las de prueba son sintéticas y marcadas; falta la existencia inicial real por ubicación |
| P-21 | Significado de «Etiqt-Costura» (Yes en 21,220) y «Etiqt- precio» (vacío en todos) para la migración: se conservan tal cual; la regla "lo cargado antes entra como etiquetado" cubre ambos checks o solo el de costura |
| P-22 | Decidido y construido: catálogo de departamentos editable (sección 17). Zapatos y Niños se eliminaron (ya no se venden); «Bolsas y Equipaje» pasó a «Bolsos y Carteras»; se agregó «Envolturas y Bolsas de regalo». Al importar, los nombres distintos se agrupan y se sugiere el destino |
| P-23 | Tarjeta de regalo entre tiendas: en ensayo vale en DÚO y London (el central reparte el libro de tarjetas). Configurable `P23_tarjeta_regalo_entre_tiendas` = `compartida` / `solo_tienda_emisora`; sin aprobar |
| P-24 | El alta de una tarjeta de regalo es un ingreso de efectivo **sin folio de ticket** (se imprime un comprobante aparte). Falta decidir si debe tener serie/folio propio y cómo se reporta fiscal y contablemente |
| P-25 | Decidido: la Caja 2 NO maneja tarjetas de regalo (sección 15) |
| P-26 | Devoluciones de una venta pagada con tarjeta de regalo: hoy una **devolución** se registra como reembolso en efectivo; una **cancelación** sí reintegra el saldo a la tarjeta. Falta la regla (¿reintegrar a la tarjeta, vale, efectivo?) y la política de vigencia/vencimiento y cargos de la tarjeta |
| P-13 | Mientras un código esté duplicado: ¿se permite la elección provisional del cajero (hoy, marcada y revisable) o se bloquea la venta de esos artículos hasta que Administración resuelva? |
| P-12 | Nuevo cobro con tarjeta mientras hay otro intento pendiente: `permitir_con_aviso` o `bloquear_solo_tarjeta` |

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

## 9. Resolución administrativa de códigos duplicados [P]

Un código duplicado nunca se fusiona ni se corrige solo. Flujo:
1. **Detección**: al sincronizar, el central reporta `codigo_duplicado`. El POS no adivina: escanear ese código da `CODIGO_AMBIGUO`.
2. **Contingencia provisional** (política P-13 pendiente): el cajero puede elegir el artículo por identificador; esa línea queda marcada `ambiguo` con los candidatos y aparece en la bandeja de Administración. No es la solución: es un registro para corregir después.
3. **Resolución**: solo Administración, con motivo obligatorio y auditoría (usuario, valor anterior y nuevo), mediante **una** decisión:
   - **Reasignar código**: un artículo recibe otro código (el nuevo no puede existir ya; se conserva como texto, con ceros).
   - **La fusión de artículos NO está aprobada y NO se implementa** (se retiró del alcance implementable). Una operación `item.fusion` que llegara a la bitácora no surte efecto: el catálogo la ignora y el conflicto sigue abierto.
4. **Propagación**: la resolución viaja del central a hubs y cajas como cualquier operación de catálogo. Una caja aislada sigue viendo el conflicto hasta recibirla.
5. **Historia**: los tickets conservan el `item_id` y el código con los que se vendieron; ninguna resolución reescribe ventas pasadas.
No existe "archivar" ni "descartar un alta" en esta etapa (sigue siendo propuesta sin aprobar).

## 10. Arbitraje de existencias del hub [P]

Con hub alcanzable, la caja pide al hub una **reserva** por venta antes de confirmar; el hub serializa a las dos cajas. Disponible = saldo del hub − reservas abiertas y vigentes. La reserva se cierra renglón por renglón al llegar el movimiento de venta, se libera si la confirmación falla y vence por vigencia técnica si la caja desaparece. Reintentos con el mismo identificador son idempotentes mientras la reserva siga vigente; un rechazo o una reserva liberada se vuelven a evaluar. Con P-02 `bloquear` el hub rechaza; con `permitir_y_conciliar` concede y avisa la sobreventa. Sin hub no hay arbitraje: rige la vista local y P-01/P-02.

## 11. Recuperación: tres registros independientes [P]

Ver `pruebas-sinteticas-etapa-0.md`. Tras reconstruir una caja o un hub, lo recuperable (lo que existe en hub/central) se restaura completo y lo que nunca salió de la caja se declara `desconocido`. Eso abre **dos registros separados que no se cierran entre sí**:

| Registro | Qué cubre | Cómo se cierra | Qué NO hace |
|---|---|---|---|
| **Inventario** (`inv.verificacion_pendiente`) | Existencias de toda la tienda quedan **no verificadas** | Conteo físico, artículo por artículo, mediante movimiento | No restablece ventas, pagos ni folios |
| **Documental** (`doc.perdida_posible`) | Ventas, pagos y folios que pudieron perderse con el disco | Solo una decisión de Administración con evidencia y nota: `declarada_irrecuperable` | Un conteo **no** la cierra; declararla tampoco limpia el inventario ni devuelve la venta |
| **Folios** (`folio.gap` / atestación) | Folios que no se pueden volver a emitir | Recuperación automática (techo registrado) o atestación manual | Ver §3 |

La reconstrucción de ventas a partir de tickets o comprobantes es un procedimiento aparte, **no aprobado ni implementado** (P-15). Los cortes de la caja afectada muestran la pérdida documental abierta. Acotar la marca de inventario requeriría una secuencia por caja en cada operación (propuesta, no implementada).

**Vender con existencia no verificada (P-14)** no es una política aprobada. El motor lo trata como alternativa de ensayo: `permitir_con_aviso` (vende y avisa `inventario_no_verificado:*`) o `bloquear_articulo_no_verificado`. No hay valor por omisión.

## 12. Primera operación completa [P]

Escanear → agregar → cobrar en efectivo → guardar venta, pago y folio → descontar inventario → imprimir ticket → reflejarla en el corte de esa caja.

- **Aplicación local**: servidor HTTP en `127.0.0.1` (alojable en una ventana Electron) con interfaz web sin dependencias. Una instancia atiende **una sesión**: cajero atado a su caja, o Administración. **Usuarios sintéticos y sin autenticación** (modo de prueba, rotulado en pantalla).
- **Diseño visual**: el mockup aprobado **no se recibió**. La interfaz sigue la estructura descrita en la especificación (navegación lateral por permisos, encabezado con tienda/caja/usuario/fecha/folio/conexión, tabla central con Item #, Código, Descripción, Marca, Estilo, Lote, Cantidad, Precio unitario, Descuento e Importe, resumen y cobro a la derecha, "Imprimir ticket de regalo" debajo de Cobrar). **Hay que compararla con el mockup cuando se tenga.** El ticket de regalo aparece visible pero deshabilitado (etapa posterior); "Venta en espera" no se implementó.
- **Datos del artículo**: Item #, Código, Descripción, Marca, Estilo y Lote son campos separados en pantalla, en la venta guardada (fotografía al vender) y en el ticket. El Item # pendiente se muestra como "pendiente", nunca inventado.
- **Efectivo**: se captura lo recibido; el pago aplicado es el total (lo que cuenta en el corte) y el cambio queda registrado. Sin pasar por coma flotante.
- **Ticket**: MXN, sin IVA/Tax/impuestos/porcentajes, identificador `D1-000012` (tienda+caja+folio) como Code128, leyendas configurables (la de "No hacemos devoluciones de efectivo" es un aviso, no un bloqueo), reimpresión rotulada y vinculada al mismo folio. Ancho de 42 columnas **supuesto**; ESC/POS (PC858, Code128, corte, pulso de cajón) generado **sin validar en la Epson**.
- **Impresión**: ocurre **después** de guardar. Si falla, la venta queda guardada y se reintenta con el mismo folio; la bitácora registra cada intento.
- **Corte**: "en vivo" (calculado con las operaciones de esa caja) y "cierre" (se guarda una vez por caja y día; una venta posterior no lo reescribe y se muestra como desactualizado).
- **Escaneo de un código duplicado**: no se agrega nada y se informa. La interfaz no ofrece elegir entre los candidatos (P-13 pendiente; la elección provisional existe en el motor).

## 13. Inventario en Excel: importar y exportar [P]

- **Entrada**: las altas llegan como tablas de Excel. `leerInventario` (puro) lee las filas de una hoja con un **perfil de mapeo** y devuelve los artículos y un **reporte**. Reconoce los encabezados del archivo de DÚO (Item Number, Item Name, Item Description, Alternate Lookup, Estilo, Lote, Regular Price, Custom Price 1, UPC, Department Name, Etiqt- precio, Etiqt-Costura, No. Pedimento, UPC 2) y los del propio sistema (Item #, Código, Marca, Descripción…), de modo que lo exportado se puede volver a importar.
- **Nada se descarta ni se corrige**: cada fila se importa y sus hallazgos se señalan (con fila del archivo): Item # repetido, código repetido, sin código, código guardado como número, precio 0/negativo/ilegible, código alterno igual al UPC de otro. Códigos, estilos y lotes se conservan como texto, con sus ceros. Un texto que parece fórmula se conserva como texto.
- **Qué se hace con los hallazgos hoy** (conservador, pendiente de aprobar): un artículo con precio ≤ 0 se importa pero no se puede agregar a una venta; un artículo sin código no se escanea (se encuentra por Item #, código alterno o texto); el código alterno ("Alternate Lookup") también se puede escanear pero no es la identidad.
- **Existencias**: si el archivo no trae cantidades no se inventan. Para probar la pantalla se puede cargar existencia **sintética de prueba**, registrada como movimiento `existencia_prueba`, solo para artículos con precio vendible. Si el archivo trajera una columna de existencia, la ubicación la elige quien importa; nunca se infiere.
- **Salida**: Administración exporta el inventario a `.xlsx` (Item #, Código, Marca, Descripción, Estilo, Lote, Departamento, Precio de venta, Precio alterno, Código alterno, etiquetas, y existencia y verificación por tienda). Texto como texto, precios numéricos exactos, sin fórmulas ejecutables.
- **No implementado todavía**: actualizar el catálogo por código desde un segundo archivo, entradas de mercancía, conteo físico por Excel, reporte de conflictos entre archivos, `.xls`.
- **Escala**: con ~21,000 artículos las proyecciones se mantienen de forma incremental (índice de catálogo, existencias y marcas) en lugar de recalcularse desde la bitácora en cada escaneo; la memoria ya no se copia en cada transacción.

## 14. Tarjetas de regalo [P]

- **Libro mayor, no un saldo guardado**: operaciones `giftcard.emitida`, `giftcard.recarga`, `giftcard.uso` y `giftcard.reintegro`. Saldo = emitido + recargas − usos + reintegros (proyección pura `tarjetasRegalo` y el mismo cálculo incremental en `Indice`).
- **Venta de una tarjeta** (`Caja.altaTarjetaRegalo`, P-24 decidido): es una **venta en efectivo con folio normal** de la serie de la caja. Su renglón (`tarjeta_regalo`) no es mercancía: no tiene Item #, no mueve inventario y no pasa por la existencia. Rechaza código vacío, monto no positivo, código ya dado de alta y efectivo insuficiente; una referencia (`ref`) hace idempotente el doble clic. El ticket dice «Tarjeta de regalo <código>» y la vigencia.
- **Recarga en efectivo** (`recargarTarjetaRegalo`, P-26c): también es una venta con folio; aumenta el saldo y **reinicia los 12 meses**. No existe reposición por pérdida.
- **Vigencia** (P-26b): 12 meses desde la venta o la última recarga en efectivo. Una tarjeta vencida no se puede usar (`TARJETA_VENCIDA`, validado también por el hub). Devoluciones y cancelaciones **no** reinician la vigencia.
- **Corte**: separa `ventas_mercancia`, `tarjetas_regalo_vendidas` (altas y recargas) y el total de tickets (`ventas`); `ventas_netas` = mercancía − devoluciones. El efectivo esperado cuenta una sola vez el efectivo de la venta de la tarjeta; lo pagado con la tarjeta (`cobros_tarjeta_regalo`) no mueve efectivo. El reporte consolidado muestra además el total sin tarjetas (`total_mercancia`) para no contar dos veces ese dinero.
- **Pagar con la tarjeta** (`cobrarConTarjetaRegalo`): aplica `min(saldo, total)` y el resto va en efectivo. La mercancía conserva su precio completo (no es un descuento del 100 %): el pago se registra como «Tarjeta de regalo» con su saldo restante.
- **Arbitraje**: igual que las existencias, el hub concede el saldo (`Hub.reservar` con tarjetas): aparta saldo, rechaza si no alcanza o está vencida, y cierra la reserva al llegar el `giftcard.uso`.
- **Dónde vale** (P-23 decidido): solo en la tienda que la emitió; el central no la reparte a la otra tienda (configurable `P23_tarjeta_regalo_entre_tiendas`, por omisión `solo_tienda_emisora`).
- **Caja 2** (P-25 decidido): no vende, recarga ni acepta tarjetas de regalo; tampoco tarjeta bancaria. Sin hub se valida solo contra lo que la caja conoce; una tarjeta que el hub aún no conoce se rechaza hasta sincronizar.
- **Cancelación**: reintegra el saldo (una sola vez). La venta o recarga de una tarjeta **no se cancela ni se devuelve** (pendiente de definir).
- **Devoluciones** (P-26 decidido, **sin vales**): lo pagado con tarjeta regresa al saldo de la **misma** tarjeta, en proporción a lo que se pagó con ella (la última devolución absorbe el redondeo); el resto, en efectivo.
- **Base de datos**: la restricción SQLite de la Caja 2 prohíbe solo la tarjeta **bancaria** (`caja_sin_tarjeta_bancaria`).

### Devoluciones y folios (P-03, P-08)

- **Solo en la caja donde se vendió.** La venta se puede **localizar** desde cualquier caja de la tienda (por fecha y hora, artículo escaneado o folio): de la otra caja solo se ve en cuál se hizo, sin importes ni pagos. Excepción acotada a la regla «el cajero solo ve su caja», pedida por el propietario para encontrar la venta cuando el cliente no trae el ticket.
- **Cada devolución consume folio de la misma serie que las ventas** y tiene su ticket (`DEVOLUCIÓN`, con la venta original y el reembolso). Hub, central, recuperación de folios, detección de huecos y corte cuentan los folios de ventas y devoluciones.
- Las devoluciones se limitan a la tienda; no se devuelve en otra tienda.

### Interfaz (maqueta aprobada)

Logo de la tienda arriba a la izquierda, navegación con iconos, forma de pago Efectivo / Tarjeta / Mixto / **Tarjeta de regalo**, y los botones de funciones inexistentes visibles, deshabilitados y rotulados «Próximamente». **No hay Apartados.** «Cambio o devolución» abre la búsqueda y la devolución. La Caja 2 no tiene el menú «Tarjetas de regalo».

## 15. Decisiones del propietario (cuestionario del 17-oct-2026) [C]

Respuestas dadas por el propietario. «Hecho» = ya está en el código y probado; «Falta» = decidido pero todavía no implementado.

| ID | Decisión | Estado |
|---|---|---|
| P-01 | Con el hub caído se sigue vendiendo con aviso (venta autónoma) | Hecho (configuración de la demo y del banco) |
| P-02 | Se permite vender aunque la existencia sea 0 o insuficiente y se concilia después. Aclaración: la existencia del archivo actual es errónea; se corregirá con el primer lote recibido en almacén | Hecho (el banco usaba «bloquear»; se cambió) |
| P-03 | Las devoluciones se aceptan solo en la misma tienda. Sin ticket, la venta debe poder buscarse por fecha y hora **en ambas cajas** y también escaneando el artículo (historial de cuándo y en qué caja se vendió). Al encontrar la caja, el cambio o devolución se hace en la caja correspondiente. Cada ticket debe decir Caja 1 o Caja 2. Aclarado 17-oct: **la devolución se hace solo en la caja donde se vendió** | Hecho: búsqueda por fecha y hora, artículo y folio; devolución solo en la caja de origen; el ticket dice Caja 1 o Caja 2 |
| P-04 | Crédito: dar crédito solo con conexión | Falta (crédito no se construye todavía) |
| P-05 | Abono duplicado: avisar al cajero y que decida | Falta (crédito) |
| P-06 | Folios: **no** se salta con huecos. El sistema debe informar hasta qué folio está bien registrado, sugerir el siguiente y pedir confirmación para continuar | Parcial: bloqueo y atestación existen; **falta** la pantalla que informa el último folio bueno, sugiere el siguiente y pide confirmación |
| P-07 | Item # de altas sin internet: lo asigna el central al sincronizar (opción a) | Hecho |
| P-08 | Devoluciones y cambios llevan folio **de la misma serie que las ventas** de la caja | Hecho para devoluciones (el «cambio» es devolver y vender) |
| P-09 | El hub vive en la computadora de la Caja 1 | Decidido (sin cambio de código) |
| P-10 | Flujo de almacén y confirmación al primer escaneo: construido (sección 18) |
| P-11 | Entregará existencias y ventas. Un artículo con cantidad 0 se debe poder seguir vendiendo | Hecho para la venta en 0 (ver P-02); archivos pendientes de recibir |
| P-12 | Tarjeta con cobro pendiente: permitir con aviso | Hecho |
| P-13 | No debería haber códigos duplicados (se resuelven por Administración); si aun así ocurre, **el cajero decide** y la venta queda marcada para revisión. Aclarado 17-oct: sustituye a la instrucción del 14-oct | Hecho |
| P-14 | Vender con inventario no verificado: permitir con aviso | Hecho |
| P-15 | Recuperación mediante **respaldo en cada corte**: copia local por caja y copia externa **cifrada en Google Drive** con retención de 7 días. La pérdida residual (lo no sincronizado ni respaldado) se registra como posible pérdida documental | Falta |
| P-16 | Entregará un archivo nuevo con los nombres de columna correctos que reemplaza al actual | Pendiente de recibir |
| P-17 | Los cupones/certificados (precio negativo) se aplican como descuento en la venta; ceros se revisan | Falta |
| P-18 | Artículos sin código se buscan por texto o Item # | Hecho (comportamiento actual) |
| P-19 | Administración decide cuál de los Item # repetidos se renumera | Hecho en lo señalado; la resolución administrativa de Item # repetido falta |
| P-20 | Existencia inicial real por archivo de Excel de cantidades | Pendiente de recibir; ver P-10/P-11 |
| P-21 | Todo lo cargado ya está etiquetado (costura y precio) | Decidido |
| P-22 | Departamentos: catálogo editable, avisos al importar, regla de envolturas | Hecho |
| P-23 | La tarjeta de regalo vale solo en la tienda que la emitió | Hecho |
| P-24 | La venta de una tarjeta de regalo **lleva folio normal**, como cualquier venta; el corte la separa de la mercancía (aclarado 17-oct: no entra dinero al pagar con ella, es forma de pago, no descuento) | Hecho |
| P-25 | La Caja 2 **no** maneja tarjetas de regalo (ni vender ni pagar) | Hecho |
| P-26 | Los **vales se eliminan**; lo pagado con tarjeta de regalo regresa al saldo de la misma tarjeta | Hecho |
| P-26b | Las tarjetas vencen a los 12 meses desde la venta; la recarga en efectivo reinicia el plazo; devoluciones y cambios no | Hecho |
| P-26c | Se permite recarga; no reposición por pérdida | Hecho (recarga) |

### Pendiente de construir

P-06 (pantalla de folio), P-15 (respaldos cifrados a Drive), P-17 (cupones como descuento), crédito (P-04, P-05) y los archivos de Excel (P-11, P-16, P-20).

## 16. Dólares estadounidenses en efectivo [P]

- **Moneda base**: precios, ventas, tarjetas, reportes comerciales y el catálogo siguen en MXN. Los dólares solo se **reciben** como efectivo; el cambio se entrega **en pesos** (no hay cambio en dólares ni otras divisas en esta versión).
- **Dinero exacto** (`src/dinero.ts`): pesos y dólares en **centavos enteros**, tipo de cambio en **diezmilésimas** de peso por dólar (hasta 4 decimales). Regla de redondeo única: el equivalente se redondea al centavo, **mitad hacia arriba** (`floor((usd × tasa + 5000) / 10000)`). Pantalla, ticket, almacenamiento y corte usan los mismos enteros; el hub y el central **recalculan** y rechazan un cobro cuyo equivalente o cambio no cuadre (`efectivo_usd_*`).
- **Tipo de cambio**: configuración global **versionada** (`config.tipo_cambio`, versión consecutiva asignada solo por el central). Es el tipo de cambio comercial que fija el negocio; no se usan cotizaciones externas. Quien edita parte de la versión que vio: si el central ya tiene otra, rechaza (`CONFIG_DESACTUALIZADA`); además la vigente es siempre la de mayor versión, así que una actualización vieja que llegue tarde nunca pisa una nueva. Solo acepta tasas positivas. Cada cambio guarda quién, cuándo, valor anterior y nuevo.
- **Permiso por usuario** (`editar_tipo_cambio`): lo asigna Administración (`permiso.asignado`) y se propaga a todas las cajas. Administración siempre puede editar. El lápiz de la barra izquierda solo aparece a quien tiene permiso.
- **Propagación**: del central a los hubs y de ahí a las cajas, sin reiniciar. Editar la tasa global requiere conexión con el central (`SIN_CENTRAL`); una tienda desconectada sigue cobrando con su última tasa, la barra dice que no puede verificar actualizaciones y, al reconectar, recibe la vigente. La barra izquierda muestra «Dólar: $18.00 MXN», fecha y hora, versión, quién y el estado de sincronización.
- **Tasa por cobro**: al pulsar «Agregar dólares USD» el cobro **bloquea** la tasa vigente; si la global cambia mientras se cobra, el cobro conserva la suya, lo avisa y ofrece «Usar la tasa vigente» (acción explícita). Los cobros nuevos usan la vigente y nunca se recalculan ventas anteriores.
- **Cobro**: efectivo en pesos, solo dólares, o dólares y pesos. El cajero solo captura lo recibido; la pantalla calcula equivalente, total recibido equivalente y «Faltan $…» o «Cambio: $…». Se guarda **un** pago `efectivo_usd` que liquida el importe en MXN y conserva el detalle físico: dólares recibidos, tasa y versión, equivalente, pesos recibidos y cambio en MXN. Con tarjeta de regalo se convierte solo la parte recibida en USD. Ambas cajas reciben dólares; las reglas de tarjeta bancaria y de regalo no cambian. Reintentar el mismo carrito devuelve la misma venta.
- **Ticket**: total en MXN; con dólares imprime USD recibidos, tasa y versión aplicadas, equivalente MXN, pesos recibidos (si hubo) y cambio MXN. La reimpresión conserva la tasa original. Sin renglones de IVA.
- **Corte**: pesos y dólares se concilian **por separado**. Pesos físicos = fondo + cobros en pesos + pesos recibidos con dólares − cambio entregado + entradas − reembolsos en efectivo − retiros. Dólares físicos = fondo USD + dólares recibidos + entradas USD − retiros USD. El cambio no es descuento ni reembolso. Fondos, entradas y retiros llevan su moneda; hay **conteo de dólares por denominación** (US$100, 50, 20, 10, 5, 2 y 1) con diferencia contra lo esperado.
- **Reportes**: «Dólares recibidos» (Administración) lista cada cobro con su tasa y versión y el equivalente **de esa operación** (no el de la última tasa del día), totales por caja (los cancelados no suman) y se exporta a Excel.

### Cierre de pendientes P-27 a P-30 (decididos por el propietario)

| ID | Decisión | Estado |
|---|---|---|
| P-27 | **Devoluciones**: el efectivo se reembolsa **exclusivamente en pesos**, con los **importes originales** de la venta (sin recalcular con la tasa de hoy); los dólares recibidos permanecen en el cajón. En pagos combinados cada método se devuelve por su vía: tarjeta de regalo → al saldo de la misma tarjeta; **tarjeta bancaria → reverso a esa tarjeta (no sale efectivo; se hace en la terminal)**. Parciales: proporcional por método, nunca más de lo pagado por cada uno; la última devolución absorbe el redondeo | Hecho |
| P-28 | **Billetes USD**: se aceptan billetes de 1, 2, 5, 10, 20, 50 y 100; **no monedas** (el importe recibido es un número entero de dólares; el hub también lo exige). El cajero puede **rechazar un billete dañado o sospechoso** con el procedimiento operativo (devolverlo al cliente, pedir otro y capturar solo lo aceptado); queda una constancia sin mover dinero. **El sistema no detecta falsificaciones** | Hecho |
| P-29 | **Tipo de cambio**: se conserva la edición rápida con el lápiz y los permisos por usuario; un cambio de **más del 10 %** (hacia arriba o abajo; exactamente 10 % no) pide una **confirmación adicional** (el central la exige y el historial guarda la variación y que fue confirmada). Sin doble autorización para cambios normales | Hecho |
| P-30 | **Cancelaciones**: *anulada* = antes de recibir dinero (sin folio, pagos ni movimiento; solo auditoría `sale.voided`); *cancelada* = después de recibir efectivo (el cobro y el cambio **se conservan** en el libro y se suma la salida de pesos de la cancelación, con los importes originales). Todo movimiento físico (fondo, cobro, cambio, entrada, retiro, devolución, cancelación) vive en un **libro por moneda inmutable** del que sale el efectivo esperado: nada se elimina ni se edita para cuadrar un corte | Hecho |
| — | **Cortes consolidados**: Administración tiene la vista «Cortes» con columnas separadas de PESOS y DÓLARES (fondo, cobros, cambio, entradas, devoluciones, cancelaciones, retiros, esperado, contado y diferencia por moneda). El equivalente histórico en MXN de los dólares va aparte y marcado como **contable**, no como dinero físico. Se agregó el conteo físico de **pesos** (billetes y monedas) porque la diferencia por moneda lo necesita | Hecho |
| — | **Cambio disponible**: se **advierte** (sin bloquear) cuando el cambio en pesos supera los pesos que se *sabe* que hay en la caja. «Se sabe» = hay un fondo inicial en pesos registrado hoy (saldo del libro del día); sin fondo no se inventa disponibilidad y no hay advertencia. El cobro ordinario en pesos nunca advierte | Hecho |
| — | **Tasa sin verificar** (tienda desconectada): política configurable `tasa_sin_verificar` = `{ advertir_horas, bloquear_usd_horas }` (por omisión advierte a las **12 h** y **nunca bloquea**). La antigüedad cuenta desde la última verificación contra el central (hub e internet) o, si nunca hubo, desde que se fijó la tasa. Con bloqueo configurado, pasado el límite **no se reciben dólares** en cobros nuevos (uno ya iniciado se completa); los cobros en pesos jamás se afectan. La barra izquierda y el cobro en dólares muestran la advertencia | Hecho; los valores por omisión son de ensayo |

### Límites y riesgos de esta versión

- **Reverso a tarjeta bancaria** no está integrado con la terminal: el sistema lo registra y el cajero lo hace a mano (antes, una devolución de una venta con tarjeta salía como efectivo).
- **Cancelar una venta con dólares** deja los dólares en el cajón y entrega pesos (decisión P-27); si en la práctica se devolvieran los dólares, hay que cambiar la regla.
- **Cancelación y permisos**: no hay permiso por usuario para cancelar una venta ya cobrada ni botón en pantalla; el servicio y la ruta existen. Falta decidir quién puede.
- **Efectivo conocido** solo con fondo del día; no se arrastra el saldo de un día al siguiente.
- La verificación de la tasa la anota la capa de servicio cuando hay hub e internet; en la demo local el enlace a internet es «sin dato», así que nunca verifica y la antigüedad crece.
- Los cortes guardados **antes** de esta versión no traen las columnas por moneda (se muestran con ceros en dólares y el esperado en pesos).
- Los billetes se capturan como un total en dólares enteros por cobro; el desglose por denominación se hace en el conteo del corte.

## 17. Departamentos [P]

- **Catálogo** (`src/departamentos.ts`): Dama, Dama Plus, Vestidos de noche, Caballero, Accesorios, Accesorios caballero, Bolsos y Carteras, Cosméticos y perfumes, Envolturas y Bolsas de regalo, Tarjetas de regalo y cupones, Electrónicos y Sin clasificar. No existen Zapatos ni Niños.
- **Administración** (vista «Departamentos»): alta, renombre, alias y activar/desactivar. Se guardan como operaciones `depto.alta` / `depto.editado` en el central y viajan a todas las tiendas como el tipo de cambio. Renombrar actualiza los artículos que ya usan el nombre; los nombres y alias no se pueden repetir; «Sin clasificar» no se desactiva.
- **Al importar**: los textos de departamento del archivo se agrupan y cada uno se clasifica como reconocido, otra forma de escribirlo (alias, p. ej. «mujer plus» → Dama Plus), ya no se vende (Zapatos, Niños: pasan a Sin clasificar), parecido a uno existente (sugerencia, p. ej. «Damma plus») o desconocido (Sin clasificar). La tabla del diálogo deja elegir el destino de cada uno antes de cargar; nada se pierde ni se inventa.
- **Regla de envolturas**: los artículos cuya descripción es bolsa o caja de regalo se mandan a «Envolturas y Bolsas de regalo»; se puede apagar en el diálogo. Las tarjetas de regalo no entran.
- El alta por lote y el alta manual del Almacén usan este mismo catálogo (sección 18).

## 18. Almacén [P]

- **Acceso**: la sesión de Administración tiene la pantalla «Almacén». En la página de prueba, el menú lateral de la caja trae el botón «Administración» y el de Administración trae «Caja» para volver a la misma caja. En la app real cada sesión es aparte; **falta definir usuarios y contraseñas** (hoy no hay autenticación).
- **Alta Lote de inventario**: se arrastra o se busca el .xlsx (CANTIDAD, DESCRIPCION, ESTILO, MARCA, CODIGO, PRECIO, LOTE, DEPARTAMENTO y, si aplica, PEDIMENTO). Antes de guardar se revisa: filas inválidas (cantidad, código o precio) no se dan de alta; un código que ya existe suma piezas a ese artículo; un estilo y marca ya existentes con otro código se avisan y se da de alta uno nuevo; los departamentos se confirman con la lógica de la sección 17; si falta la columna de pedimento se puede anotar uno para todo el lote. Reenviar el mismo lote no duplica nada.
- **Alta manual**: una fila a la vez, con el departamento del catálogo; si el código existe se suman piezas.
- **Qué entra**: artículos nuevos con Item # asignado por el central y piezas al almacén (`alm.entrada`), **sin existencia en tiendas y sin etiquetas**. Cada llegada es un registro propio (otro UPC, lote y pedimento).
- **Entrega a tiendas**: por artículo, se confirman las etiquetas de precio y de costura (escribir una cantidad las marca solas; sin ambas no se entrega) y se anotan las piezas para Tienda DÚO y Tienda London. Entregar más de lo registrado avisa y pide confirmación; queda marcado como exceso y el almacén queda en negativo. Reintentar con la misma referencia no duplica.
- **Recepción**: la tienda no recibe existencia hasta que su personal confirma. Al escanear por primera vez el artículo, la caja pregunta «¿Confirmas que recibiste N piezas?»; al aceptar entra el movimiento `entrada_almacen`. Ejemplo: Almacén 24 → entrega 12 y 12 → Almacén 0 / DÚO 12 / London 12. Si no confirman, la entrega sigue pendiente y visible en Administración.
- **Sacar a piso** (recordatorio interno del almacén, no viaja a las tiendas): columna con calendario por artículo. El renglón se marca en **morado** si faltan más de 7 días y en **rojo** si faltan 7 o menos (o ya pasó) y todavía hay piezas en el almacén; al entregar todo, la marca desaparece y la fecha queda como referencia. En el menú lateral de Administración aparece el aviso «Revise los artículos para sacar a piso el 12/nov/26 (N)», agrupado por fecha, rojo si alguna es urgente; al pulsarlo abre Almacén. Se guarda como `alm.recordatorio` (el último registro de cada artículo gana).
- **Pendiente**: reporte de entregas y diferencias, corrección de una entrada capturada mal, y el inventario inicial del catálogo sin existencias.

## 19. Promociones, cupones y descuentos con clave [P]

Decisiones del propietario (punto 5): sin desglose de IVA en el ticket (el precio del catálogo es el final); los cupones y certificados del sistema viejo quedan **obsoletos** (la importación los omite y avisa cuántos: «Cupón o certificado del sistema anterior (no se importa)»); Créditos salió del menú de venta y queda en Administración (deshabilitado, «Próximamente»).

- **Promociones** (Administración → Promociones; se guardan como `promo.guardada` en el central y viajan a todas las cajas).
  - **Por tienda**: cada promoción o cupón vale solo en la(s) tienda(s) que se elijan; lo de London no aplica en DÚO y viceversa. En una tienda equivocada el cupón responde «no es válido en esta tienda».
  - **Una sola por compra**: nunca se combinan. En cada compra aplica **una** promoción o cupón: la que más descuento le da al cliente (empate: la primera creada). Si se captura un cupón que da menos que una promoción vigente, se avisa y gana la promoción. (El descuento manual de un supervisor es aparte.)
  - **Vigencia**: toda promoción lleva fecha de inicio y de término, o **sin fecha límite** hasta que Administración la desactive (las permanentes). Estados: activa, programada, vencida, desactivada. Fechas locales, inclusive.
  - **Lleva X, paga Y** (2x1, 3x2…): las piezas más baratas de cada grupo salen gratis; las sueltas no cuentan.
  - **Paquete a precio fijo** («lleva 4 por $185», p. ej. el accesorio popular de $55): cada grupo completo de N piezas se cobra al precio del paquete; con 5 piezas de un paquete de 4, se cobra un paquete más una suelta a precio normal.
  - **Qué mercancía**: se eligen **artículos concretos con un buscador** (código, Item #, descripción, marca) dentro de la promoción, o desde **Inventario → buscar artículo → «Crear promoción»**; también se puede por departamento y/o palabras de la descripción.
  - **Por cada $X de compra, $Y de descuento**: escalones completos (por cada $500, $50: con $2,650 son 5 escalones = $250 de descuento).
  - **Acumulable** (casilla en lleva-paga, paquete y por-cada; marcada por omisión): se repite por cada grupo completo, así que 8 piezas de «4 por $185» son dos paquetes ($370). Sin marcar, aplica una sola vez por compra. No tiene que ver con combinar promociones distintas, que sigue prohibido.
  - **Promoción activa / desactivada**: la casilla de estado se rotula «Promoción activa» o «Promoción desactivada» según esté marcada.
  - **Cupón** con código, % o $ fijo, compra mínima ($X **o más**), usos máximos (vacío = sin límite; 1 = un solo uso; una venta cancelada libera el uso).
- **Cálculo** (`src/promociones.ts`, centavos enteros): se recalcula en cada cambio del carrito y antes de cobrar; nunca pasa del importe de la línea y los repartos entre líneas son exactos (mayor residuo). El ticket muestra cada descuento con su nombre.
- **Nombre de las tiendas** (Administración → Tiendas): el nombre comercial es editable y se actualiza en todas las cajas; sale en el ticket, en la pantalla y en la imagen del cupón (que muestra solo la(s) tienda(s) donde vale).
- **Cupón en caja**: botón «Cupón» (escribir el código) o escanear el QR, que trae `CUPON:CÓDIGO`. Si no aplica (vencido, mínimo no alcanzado, ya usado…) se explica por qué y la venta sigue sin cupón. **Un lector láser de barras normal no lee QR**: hace falta un lector 2D (no validado) o escribir el código.
- **Imagen del cupón** (Administración → «Imagen QR»): tarjeta PNG 1080×1350 con el nombre de la tienda donde vale, el descuento, condiciones, vigencia, código y QR, más el QR solo y un texto para acompañar el mensaje (WhatsApp, correo, redes). La distribución es manual. El QR se verificó con un decodificador independiente (jsQR).
- **Usos de cupón entre tiendas**: el conteo se hace con las ventas que cada caja conoce; con tiendas desconectadas un cupón de uso limitado podría canjearse una vez más de lo permitido hasta que se sincronicen.
- **Descuentos manuales**: solo los autoriza un **supervisor** tecleando su clave (4 a 8 dígitos), **sin tope (hasta 100 %)**, sobre una línea o sobre toda la venta, en % o en $. Queda anotado quién lo autorizó. Con 100 % la venta se registra sin cobro (folio normal, total $0). Los supervisores se administran en Promociones; la clave se guarda con sal y SHA-256 y nunca se muestra. Es un control de prototipo: sigue sin haber autenticación de usuarios ni bloqueo por intentos fallidos.
- **Reporte de promociones y descuentos** (Administración → Promociones → botón «Reporte de promociones», con periodo y exportación a Excel): total descontado y tickets, separado en promociones, cupones y descuentos autorizados por supervisor; tabla **por supervisor** (descuentos, monto, mayor % de una venta, cuántos al 100 %), tabla por promoción o cupón y detalle por ticket (caja, folio, cajero, concepto, quién autorizó, importe de la venta, descuento y % de la venta). Las ventas canceladas aparecen marcadas y **no suman** en los totales. Un descuento de una venta anterior al registro de supervisores sale «sin registro de supervisor».
- **Pendiente**: «Ticket de regalo» y «Venta en espera» siguen «Próximamente».

## 20. Inventario: lista completa, edición e historial [P]

- **Lista completa** (Administración → Inventario): todos los artículos del catálogo, **50 por página** (Anterior / Siguiente, «Artículos 51–100 de 120 · página 2 de 3»), ordenados por Item #, con existencia por tienda y en el almacén. El cuadro de búsqueda filtra por código, Item #, descripción, marca, estilo, lote o departamento.
- **Clic en un artículo** abre su edición: descripción, marca, estilo, lote, departamento (solo los activos del catálogo) y precio. El código no se edita aquí. Cada cambio se guarda como `item.editado` con el valor anterior y el nuevo, llega a todas las cajas y vale para las ventas siguientes (lo ya vendido conserva su precio). Sin cambios no se escribe nada.
- **Historial** (botón en la edición): alta, cambios con «antes → después» y quién los hizo, entradas al almacén (con pedimento), entregas a tiendas, recepciones, ventas con tienda/caja/folio, cancelaciones, devoluciones y conteos físicos; lo más reciente primero.
- **Crear promoción** (botón en la edición): abre la promoción con **ese artículo ya elegido**. Los tipos «lleva X paga Y» y «paquete a precio fijo» piden uno o varios artículos (o departamento / palabras); «por cada $X de compra» y los cupones no necesitan elegir artículos y lo dicen en pantalla.

## 21. Menú de Administración

Reportes · Cortes (con el botón «Dólares recibidos») · Inventario · Almacén · Promociones (con el botón «Reporte de promociones») · Tarjetas de regalo · **Configuración** · Créditos (próximamente) · Caja (solo en la página de prueba). **Configuración** reúne en pestañas **Tiendas** (nombre comercial editable), **Departamentos** y **Tipo de cambio** (con sus permisos). El tipo de cambio sigue editándose también con el lápiz de la barra lateral.

## 22. Datos de la tienda y logo en el ticket [P]

- **Editable** en Administración → Configuración → Tiendas (se propaga a todas las cajas como `config.negocio`): nombre comercial, razón social, RFC, dirección, ciudad y estado, teléfono y **política de devolución** (un renglón por línea). Lo que se deja vacío no se imprime; «Restablecer» vuelve a los datos de fábrica.
- **Ticket**: logo de la tienda arriba; nombre, dirección, ciudad, razón social y RFC bajo el logo; al pie el teléfono y la política de devolución (como el ticket vigente de DÚO). DÚO trae de fábrica los datos de su ticket actual (dirección, razón social, RFC, teléfono y política, con ortografía corregida); London Love sale sin datos hasta capturarlos y con la política «No hacemos devoluciones de efectivo».
- **Logos del ticket**: versiones de 1 bit para papel térmico (DÚO en negro sobre blanco, para ahorrar tinta; London con tramado), generadas con `scripts/generar-logos-ticket.py`. En pantalla se ven arriba del ticket; en la impresión salen como imagen ESC/POS (`GS v 0`, centrada). **El comando de imagen no se ha probado con una impresora real**: falta validar ancho, densidad y que el modelo de impresora lo acepte.
- El ticket de devolución también lleva el encabezado de la tienda (sin logo todavía).
- **Renglón de cada artículo**: «1 MASCADA EFENTUS A-12» (cantidad al principio, luego descripción, marca y estilo, sin rótulos y **sin lote**); debajo el Item # y el código; luego el importe (con «c/u» y el precio unitario cuando son varias piezas) y los descuentos con su nombre. Un renglón largo se parte entre palabras con sangría bajo la descripción. El ticket de devolución usa el mismo formato.
