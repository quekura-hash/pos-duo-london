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
- «Venta en espera» ya funciona (sección 24).

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
- **Cada artículo en dos renglones**: «1 MASCADA EFENTUS A-12» (cantidad, descripción, marca y estilo; sin rótulos ni lote) y «#1003 7501234567890 … $120.00» (Item # y código, sin las palabras «Item» ni «Código», y el importe a la derecha; con varias piezas, «4 x $55.00  $220.00»). Si el importe no cabe en ese renglón pasa al siguiente. Un Item # pendiente no se imprime. Las promociones, cupones y descuentos agregan un renglón cada uno con su nombre. El ticket de devolución usa el mismo formato.

## 23. Ticket de regalo [P]

- **Qué es**: un segundo ticket de una venta ya cobrada con la mercancía **sin precios, descuentos, pagos ni cajero**: logo y datos de la tienda, «*** TICKET DE REGALO ***», fecha y **código de la compra** (el mismo del ticket de venta, con código de barras al imprimir, para buscarla en «Cambio o devolución»), cada artículo en el formato de dos renglones, «Para cambios presente este ticket», teléfono y política de devolución de la tienda.
- **Cómo se pide**: (1) botón **Ticket de regalo** bajo Cobrar, que se enciende antes de cobrar y hace que salga junto con el ticket de la venta (se apaga solo para la siguiente venta); (2) botón en el diálogo de la venta recién cobrada; (3) botón al ver una venta del historial. Se puede imprimir otra vez cuantas veces haga falta.
- **Reglas**: solo de ventas de la propia caja; una venta cancelada no tiene ticket de regalo; las tarjetas de regalo no salen (una venta de solo tarjetas no tiene ticket de regalo); no abre el cajón y no cuenta como reimpresión del ticket de venta; queda en la bitácora de impresión como `regalo`.
- **Sin validar**: la impresión (logo y código de barras) con una impresora térmica real.

## 24. Venta en espera [P]

- **Para qué**: guardar la venta en pantalla (el cliente fue por algo más) y atender a otro cliente. Botón **Venta en espera (n)** en la pantalla de venta; abre un diálogo con una nota opcional (nombre o referencia, hasta 80 caracteres) y la lista de ventas guardadas (hora, nota, primeros artículos, piezas y total).
- **Reglas**: solo una venta con artículos y sin cobro con tarjeta pendiente; al guardarla se abre una venta nueva. Se guarda en la propia caja (sobrevive a un reinicio) y **no es compartida entre cajas**. **No reserva existencias**. Al retomarla los precios, promociones y cupón se **recalculan** y el tipo de cambio de un cobro en dólares se vuelve a fijar. Si al retomar hay una venta con artículos en pantalla, esa pasa a espera; si está vacía, se descarta sin constancia.
- **Descartar** una venta guardada (con confirmación en dos pasos) deja la constancia de anulación (`sale.voided`, motivo «venta en espera descartada») con lo que tenía.
- **Bitácora**: `cart.en_espera` y `cart.retomada` (solo auditoría; no mueven dinero ni inventario).
- **Verificado**: pruebas del motor (VE1–VE4, ambos almacenes) y prueba en navegador (B9). Sin hardware involucrado.

## 25. Tarjeta con captura manual [P]

- **Qué es**: mientras la terminal bancaria no esté integrada, el cajero cobra en la terminal y, ya aprobada, captura en el POS la **autorización del comprobante** (obligatoria, 4 a 12 letras o números), la marca y los últimos 4 dígitos (opcionales). **El POS no habla con la terminal: no verifica que el cobro sea real**; la autorización queda como constancia para conciliar contra el estado de cuenta.
- **Formas de pago**: **Tarjeta** (por el total) y **Mixto** (un monto con tarjeta, mayor que 0 y menor que el total, y el resto en efectivo **exacto**; sin cambio ni dólares en el mixto). Disponible solo en las cajas que tienen terminal (hoy la Caja 1 de cada tienda); en las demás los botones siguen deshabilitados.
- **Motor**: se crea el intento de cobro y se resuelve como aprobado en un solo paso (`Caja.cobrarConTarjetaManual`), así una captura interrumpida o rechazada no deja cobros pendientes de conciliar. Doble clic = misma venta y mismo folio.
- **Ticket**: renglón «Aut. XXXX  MARCA ****1234» bajo el pago con tarjeta. El corte ya separa tarjeta de efectivo.
- **Pendiente**: integración real con la terminal (modelo y protocolo por definir) y, con ella, el flujo de intento/conciliación para cobros dudosos que ya existe en el motor.
- **Verificado**: pruebas del motor (TM1–TM3, ambos almacenes) y de navegador (B10). Sin terminal real.

## 26. Reporte de entregas y diferencias de almacén [P]

- **Dónde**: Administración → Almacén → botón **Reporte de entregas** (el menú sigue marcando Almacén). Filtros: desde/hasta (fecha local de la entrega; por omisión el mes en curso) y tienda. **Exportar a Excel** incluye el detalle y, debajo, la sección de diferencias.
- **Contenido**: resumen por tienda (entregas, piezas, confirmadas, pendientes, piezas pendientes) y detalle de cada entrega: fecha y hora, tienda, artículo, piezas, estado (**Confirmada** con fecha y quién la confirmó, o **Pendiente** con los días de espera), si excedió lo registrado en el almacén, etiquetas y quién entregó.
- **Diferencias** (estado actual, no dependen del periodo): **sin confirmar** (entrega de 3 o más días que la tienda no ha confirmado; los 3 días son una **alternativa de ensayo**, `DIAS_ENTREGA_SIN_CONFIRMAR`), **más de lo registrado** (entrega confirmada con «exceso» por el almacén) y **almacén negativo** (existencia del almacén menor que 0). Filtrando por tienda no aparece el almacén negativo.
- **Piezas faltantes** (sección 27) también aparecen como diferencia mientras tengan piezas sin ubicar.
- **Verificado**: prueba del motor (RE1, ambos almacenes) y de navegador (continuación de B3: entrega, confirmación de una tienda, reporte y exportación).

## 27. Piezas faltantes en la recepción [P]

- **Tienda**: al confirmar una entrega, «Sí, recibí N» o **«Otra cantidad»** (entero de 0 a N−1). Solo entra a la existencia de la tienda lo que se recibió; `alm.recibida` guarda esa cantidad. Cantidades inválidas se rechazan sin confirmar nada.
- **Almacén** (Administración): si hay faltantes aparece un bloque **naranja «Piezas faltantes»** con las piezas por ubicar. Cada renglón (artículo, tienda, entregadas, recibidas, faltan) tiene cantidades por destino: **encontradas en almacén**, **en DÚO**, **en London** y **perdidas**, y «Sin ubicar». **Guardar** registra el total por destino; se puede volver a guardar para corregir (el último valor reemplaza al anterior; guardar lo mismo no duplica). La suma no puede exceder lo que faltó. Un renglón totalmente ubicado deja de estar naranja y se oculta salvo «Mostrar también los ya ubicados».
- **Efecto en existencias**: lo encontrado en el almacén suma a la existencia del almacén; lo encontrado en una tienda suma a la de esa tienda (op `alm.faltante`, se propaga a hubs y cajas); lo perdido solo queda registrado. Nada se borra: las correcciones son operaciones nuevas.
- **Reporte de entregas**: el renglón muestra «Confirmada: recibió X de Y» y el faltante sin ubicar aparece en Diferencias; el Excel trae piezas entregadas y recibidas.
- **No incluido**: aviso de faltantes en el menú lateral; confirmar de más de lo entregado (se rechaza).
- **Verificado**: pruebas del motor (FA1–FA2, ambos almacenes) y de navegador (continuación de B3 con London recibiendo 9 de 12).

## 28. Catálogo inicial y «El Limbo» [P]

- **Qué es**: El Limbo es un almacén virtual (`LIMBO`) donde vive la existencia del **catálogo inicial** (20,000+ artículos ya etiquetados con precio y costura). Todas las tiendas y cajas pueden vender esos artículos y **lo vendido se descuenta de El Limbo**, no de la tienda.
- **Carga**: al importar el archivo, la opción por omisión es «Catálogo inicial en El Limbo». **La cantidad de cada fila del archivo es la existencia inicial de El Limbo** (movimiento `limbo_inicial` por artículo con precio vendible; las cantidades negativas se cargan tal cual y se avisan). Si el encabezado de la cantidad no se reconoce solo (se reconocen «On-Hand Qty», «Existencia» y «Cantidad»), el diálogo permite elegir la columna. Las filas sin cantidad entera usan un valor de respaldo (0 por omisión: no se inventan). La otra opción sigue siendo la existencia de prueba por tienda. (Corrige la nota anterior de P-20 que decía que el archivo no traía cantidades.)
- **Regla de venta** (por renglón de un artículo del catálogo inicial): primero lo que haya en El Limbo, luego la existencia propia de la tienda, y lo que sobre vuelve a El Limbo y lo deja **negativo** (= vendido sin existencia registrada; P-02 permite vender sin existencia y se concilia después). Un artículo fuera del catálogo inicial descuenta de la tienda como siempre. El renglón de la venta guarda `de_limbo` (cuántas piezas salieron de ahí).
- **Compartido entre tiendas**: los movimientos de El Limbo viajan caja → hub → central → los demás hubs y cajas, así que todas ven el mismo saldo cuando hay conexión. Con una tienda sin conexión puede venderse la misma pieza en dos tiendas y el saldo queda más bajo al sincronizar (misma conciliación posterior que P-02).
- **Cancelar una venta** regresa a El Limbo las piezas que salieron de ahí. Una **devolución** de mercancía entra a la existencia de la tienda donde se devolvió (la pieza está físicamente ahí).
- **Dónde se ve**: chip «El Limbo: N» en la venta (solo artículos del catálogo inicial), columna «El Limbo» en Administración → Inventario y en la edición del artículo, resumen del inventario y columna «Existencia El Limbo» en el Excel. Un saldo negativo de El Limbo no se reporta como incidencia por artículo.
- **Pendiente**: cargar el archivo real de 20,000+ artículos (los datos reales no van al repositorio) y medir su velocidad; verificar con el propietario que las cantidades del archivo son confiables (P-02 dice que la existencia del archivo anterior era errónea).
- **Verificado**: pruebas del motor (LI1–LI5, ambos almacenes) y de navegador (B11–B12: importación con y sin cantidades, venta en DÚO y London, columna en Inventario). Sin archivo real.

## 29. Retiro de efectivo [P]

- **Menú**: «Retiro» en el menú lateral de la caja, junto a Venta.
- **Aviso**: cuando el **efectivo de venta** de la caja llega a **$10,000** (pesos de venta + dólares al tipo de cambio vigente; **el fondo inicial y las entradas de efectivo no cuentan**; el día se toma como el del corte), aparece una ventana flotante «Es hora de un retiro». **No es modal ni bloquea**: se puede seguir escaneando y cobrando. «Más tarde» la oculta 15 minutos (valor de ensayo); «Hacer el retiro» abre la pantalla. Se revisa al entrar a Venta y al abrir una venta nueva.
- **Retiro**: se capturan los billetes que se toman (pesos: **$1,000, $500 y $200**; dólares: todos). El total (dólares al tipo de cambio vigente) debe ser **al menos $8,000**; no tiene que ser $10,000 exactos. No puede exceder el efectivo que registra la caja por moneda. *Los «billetes grandes» de pesos son una alternativa de ensayo por confirmar con el propietario* (`BILLETES_RETIRO_MXN` en `src/retiros.ts`, igual que el umbral y el mínimo).
- **Registro**: un movimiento `retiro` por moneda en el libro de la caja (así el corte descuenta pesos y dólares por separado) y un registro `cash.retiro` con el desglose, el tipo de cambio, el equivalente, el efectivo de venta antes y después y un folio de retiro por caja (`D1-R0001`). Reintentar el mismo envío no duplica nada.
- **Impresión**: se imprimen los datos del retiro (tienda y caja, folio, fecha, cajero, desglose por billete, tipo de cambio, total en pesos, efectivo de venta antes/después y renglones de firma de quien retira y quien recibe). Una falla de la impresora no deshace el retiro; «Reimprimir» desde «Retiros de hoy». **Impresión no validada con una impresora real.**
- **Alcance**: lo registrado en el día; el efectivo de venta de días anteriores sin retirar no se suma al aviso.
- **Verificado**: pruebas del motor (RT1–RT4, ambos almacenes) y de navegador (B13: aviso sin bloquear, mínimo, retiro, ticket e historial).

## 30. Código corto de la etiqueta y UPC completo [P]

- **Qué pasaba**: el sistema anterior (QuickBooks) completaba los códigos cortos hasta un UPC válido (ceros a la izquierda y dígito verificador), pero las etiquetas nuevas traen el código corto (por ejemplo `202610212`). En el catálogo importado el mismo artículo está como `0002026102126`, así que el escaneo exacto no lo encontraba.
- **Regla**: el código exacto siempre manda. Si no hay coincidencia exacta ni por código alterno, se busca por aproximación: el código escaneado sin ceros a la izquierda contra el código del catálogo sin ceros y, si el código del catálogo es un UPC-A (12 dígitos, o 13 con un cero) con **dígito verificador válido**, contra su base sin ese dígito. Solo para códigos numéricos de **8 dígitos o más** (así «17» no encuentra nada por aproximación). Si hay varios candidatos se pregunta cuál (mismo flujo de código ambiguo).
- **Dónde aplica**: escaneo en la venta, buscador de la venta y Alta Lote (una fila con el código corto de un artículo ya existente con UPC completo se suma a ese artículo en lugar de crear otro). El código guardado en el catálogo no se modifica.
- **Verificado**: pruebas UPC1–UPC4 (ambos almacenes). Los dígitos verificadores de los códigos de prueba y del archivo real que se revisaron coinciden con esta fórmula.

## 31. Búsqueda por texto en la venta [P]

- **Palabras**: cada palabra escrita debe aparecer (en cualquier orden) en marca, descripción, estilo, lote o departamento. Un número también coincide con el **precio en pesos** («pantimedias 189», «189.00»).
- **Orden**: primero código, Item # o código alterno exactos; luego los artículos cuya descripción **empieza** con lo escrito, después los que tienen una palabra que empieza así y al final el resto. Dentro de cada nivel:
  1. **Año de alta que lleva el código** (los códigos de 2015 a 2029 empiezan con el año o lo contienen: `0002026090782`, `202610212`): 2026 antes que 2025, etc.; los códigos sin año van al final.
  2. Los artículos con la **misma descripción y estilo** se agrupan (el grupo se ordena por su año más reciente) y dentro del grupo va primero el de **mayor precio**, que se toma como el más actualizado.
  3. A igual todo, el Item # más alto.
  Antes salían en el orden del catálogo y un artículo nuevo quedaba fuera de los primeros 20. *El criterio «mayor precio = más actualizado» y el año tomado del código son decisiones del propietario; mientras se depura el catálogo.*
- **Limpiar la búsqueda**: botón «Limpiar búsqueda» junto a «Nuevo artículo» (y la tecla Esc en el campo) borra el texto, los resultados y el mensaje sin tocar los artículos de la venta.
- **Cantidad**: se muestran 20 y el botón «Mostrar más resultados» pide 40 más (hasta 200). El mensaje indica el total.
- **Verificado**: pruebas BT1–BT3 y UPC1 (año del código), ambos almacenes.

## 32. Conteo físico de El Limbo [P]

- **Dónde**: Administración → Inventario → **Conteo de El Limbo**.
- **Cómo se cuenta**: escanear o teclear el código de cada artículo (**cada escaneo cuenta una pieza**; el código corto de la etiqueta y el UPC completo valen igual) o **importar un Excel** con las columnas CODIGO y CANTIDAD (lo contado; un mismo código en varios renglones se suma). La tabla muestra lo que dice el sistema, lo contado y la diferencia; la cantidad contada se puede corregir a mano. El conteo en curso se conserva al cambiar de pantalla y, si el navegador lo permite, al recargar (almacenamiento local de ese navegador).
- **Aplicar**: pide confirmación con el resumen (sobrantes y faltantes). Cada artículo contado queda en El Limbo con **lo contado** (movimiento `conteo` por la diferencia contra el saldo que conoce el central); **los artículos que no se contaron no se tocan** (un conteo parcial nunca los pone en 0). Los saldos viajan a todas las tiendas y cajas como cualquier movimiento de El Limbo. Reintentar el mismo conteo no repite nada. Queda el registro `limbo.conteo` (artículos, sistema, contado y diferencia) y el historial «Conteos anteriores». En el historial del artículo aparece como «Conteo físico … en El Limbo».
- **Límites**: la diferencia se calcula con lo que el central ha recibido: una venta que aún no se sincroniza se descuenta al llegar, así que conviene contar con las tiendas sincronizadas. Un código duplicado no se cuenta hasta resolverlo. No hay todavía detalle por conteo ni exportación del conteo a Excel.
- **Verificado**: pruebas del motor (CL1–CL3, ambos almacenes) y de navegador (B14: escanear, corregir, aplicar, saldos en Inventario).

## 33. Nuevo artículo desde la venta y claves de cajero [P]

- **Botón «Nuevo artículo»** (junto a «Limpiar búsqueda») y, cuando una búsqueda no encuentra nada, «Dar de alta este artículo» con el código ya escrito. Se capturan código, descripción, marca, estilo, lote (opcionales), departamento (de la lista de activos) y precio.
- **Autorización**: cualquier cajero puede, pero **se le pide su propia clave** en el momento del alta (no la de un supervisor ni la de otro cajero): así nadie da de alta un artículo a nombre de otro. La clave se compara con la del cajero cuyo nombre es el usuario de la sesión; si no tiene clave registrada o está desactivado, no puede. **Cinco claves equivocadas seguidas bloquean a ese cajero 5 minutos** en esa caja.
- **Claves de cajero**: Administración → Configuración → **Cajeros** (nombre = el del usuario de la caja, clave de 4 a 8 dígitos, guardada con sal y hash como la de los supervisores; se puede cambiar, desactivar y reactivar; no se repiten nombres). *Prototipo: todavía no hay inicio de sesión con usuario y contraseña, así que la clave solo confirma esta operación; el usuario de la sesión lo da la caja.*
- **Resultado**: el artículo llega al **catálogo de todas las tiendas** (`item.created` se reparte), se agrega a la venta en curso y queda el registro `articulo.alta_autorizada` (quién, tienda y caja). Se rechaza un código que ya existe, incluida su forma corta o UPC completo, y precio 0, sin descripción o departamento fuera de lista. El Item # lo asigna la política vigente (P-07, en ensayo). Sin existencia inicial: se vende con la regla de P-02.
- **Verificado**: pruebas AA1–AA4 (ambos almacenes) y de navegador (B16: alta de la clave en Administración, alta en la caja con clave errónea y correcta, el artículo aparece en London).

## 34. Corrección de una entrada de almacén mal capturada [P]

- **Dónde**: Administración → Almacén → botón **Entradas** de cada artículo: lista sus entradas (fecha, lote o archivo, piezas, pedimento, quién capturó y la corrección vigente) con **Corregir**.
- **Qué se corrige**: la cantidad y/o el pedimento, con **motivo obligatorio**. La entrada original no se edita ni se borra: queda una corrección (`alm.correccion`) que la reemplaza; la más reciente manda, y una corrección que solo toca la cantidad conserva el pedimento ya corregido. Corregir a 0 equivale a anularla.
- **Efecto**: la existencia del almacén y los pedimentos se calculan con la corrección; las entregas siguientes se comparan contra la existencia corregida. Si la corrección deja el almacén en **negativo** (ya se entregaron piezas de más) se pide confirmación («Aplicar de todos modos»). Corregir hacia arriba no la pide. Reintentar la misma corrección no repite nada.
- **Trazabilidad**: en el historial del artículo aparece «Corrección de una entrada al almacén» con la cantidad o el pedimento antes y después y el motivo.
- **No incluido**: corregir la descripción, el precio o el departamento (eso se hace en Inventario) ni mover piezas ya entregadas a una tienda (para eso están las piezas faltantes y el conteo).
- **Verificado**: pruebas CE1–CE2 (ambos almacenes) y de navegador (continuación de B3: corregir un lote de 24 a 30 con motivo).

## 35. Inicio de sesión [P]

- **Caja**: en cuanto hay **al menos un cajero activo con clave** (Configuración → Usuarios), la caja pide **cajero y clave** antes de cualquier operación: se elige el cajero de la lista y se teclea su clave de 4 a 8 dígitos. Mientras no haya cajeros registrados, la caja trabaja como antes (así se puede montar la tienda y registrar a los cajeros). Las ventas, retiros, descuentos, devoluciones, etc. quedan a nombre de quien inició sesión (el «Cajero(a)» del encabezado y del ticket). **Cerrar sesión** en el encabezado vuelve a la pantalla de inicio. Un cajero **desactivado** pierde la sesión en su siguiente operación. Cinco claves equivocadas seguidas lo bloquean 5 minutos (el mismo control del alta de artículos).
- **Administración**: **abierta mientras no exista un administrador**; la pantalla Usuarios lo avisa en un recuadro. Con al menos un administrador activo pide **usuario y contraseña** (6 a 40 caracteres) y bloquea 5 minutos tras cinco fallos. Quien crea al **primer** administrador queda dentro como ese administrador. Lo que hace Administración queda a su nombre (`por`). Los administradores **solo viven en el servidor central** (no se reparten a tiendas ni cajas); sus contraseñas se guardan con sal y hash. Los nombres no se repiten entre cajeros y administradores.
- **API**: `POST /api/login`, `POST /api/logout`; `GET /api/sesion` informa `requiere_login`, `autenticado`, el usuario y, en la caja, la lista de cajeros activos. Cualquier otra ruta sin sesión responde 401 `NO_AUTENTICADO` (429 `CLAVE_BLOQUEADA`) y la pantalla vuelve al inicio de sesión. La sesión vive en la memoria del servicio de esa caja o de Administración: reiniciarlo la cierra.
- **Qué NO es todavía**: no hay cierre automático por inactividad, ni cookies o tokens por navegador (el servicio local de cada caja atiende un solo puesto), ni roles distintos dentro de Administración, ni recuperación de una contraseña olvidada si solo hay un administrador (hoy la salvaguarda es tener dos). El hash es SHA-256 con sal, suficiente para un prototipo pero no un derivador lento de claves.
- **Verificado**: pruebas IS1–IS4 (ambos almacenes: sesión, 401, bloqueo, desactivación, administradores solo en el central) y de navegador (B16–B17: alta de usuarios, inicio y cierre de sesión en Administración y en la caja, venta a nombre del cajero).

## 36. Roles: cajero, supervisor y almacenista [P]

Reemplaza lo dicho de «administradores» en la sección 35: quien entra a Administración es un **supervisor** o un **almacenista**; **los cajeros no entran** (su usuario y clave de cajero no sirven en Administración).

| Rol | Dónde entra | Qué puede |
|---|---|---|
| **Cajero** | solo la caja (usuario y clave de 4 a 8 dígitos) | vender, cobrar, retiros, devoluciones, etc.; da de alta artículos con su propia clave |
| **Supervisor** | Administración completa (usuario y contraseña de 6 a 40 caracteres) | todo Administración (reportes, cortes, inventario, almacén, promociones, tarjetas, configuración y usuarios) y **autoriza operaciones en la caja** con su **clave de caja** (4 a 8 dígitos): hoy los descuentos |
| **Almacenista** | solo **Inventario y Almacén** (incluye entregas, piezas faltantes, corrección de entradas, conteo de El Limbo) | editar artículos **sin cambiar el precio**, ver el historial y el dólar del día; sin promociones, reportes, cortes, tarjetas, configuración ni usuarios |

- **Alta** en Configuración → Usuarios (solo supervisores). El **primer usuario debe ser supervisor** (es quien crea a los demás). El rol no cambia después. Siempre debe quedar **al menos un supervisor activo**.
- **Supervisor ↔ caja**: al crear un supervisor se captura su clave de caja; se registra como supervisor de caja con el **mismo nombre** y se mantiene al editar o desactivar al usuario (desactivarlo invalida su clave de caja). Los supervisores que ya existían por separado en Promociones siguen funcionando.
- **Cumplimiento en el servidor**: cada ruta de Administración revisa el rol (403 `PROHIBIDO`); el menú del almacenista solo muestra Inventario y Almacén, el campo de precio queda de solo lectura y no ve «Crear promoción». El encabezado muestra el rol.
- **Pendiente de definir con el propietario**: qué otras operaciones de la caja deben pedir la clave de un supervisor (hoy solo los descuentos). Candidatas: cancelar una venta ya cobrada, devoluciones, retiros, fondo y entradas de efectivo, anular una venta con artículos, cambiar un precio en la venta.
- **Verificado**: pruebas RO1–RO3 (ambos almacenes) y de navegador (B18: roles, menú del almacenista, precio de solo lectura, cajero rechazado, supervisor completo).
