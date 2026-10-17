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
- Caja 1 admite efectivo, tarjeta y mixto; Caja 2, solo efectivo.

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
| P-10 | Catálogos de DÚO y London: ¿comparten Item # y códigos? |
| P-11 | Excel reales (catálogo, existencias, ventas) |
| P-14 | Vender con existencia marcada no verificada: `permitir_con_aviso` o `bloquear_articulo_no_verificado` (alternativas de ensayo) |
| P-15 | Procedimiento para reconstruir ventas y pagos a partir de tickets/comprobantes tras una pérdida documental |
| P-16 | **Mapeo de «Item Name» e «Item Description»** frente al archivo real: la especificación confirmó Item Name = Marca / Item Description = Descripción, pero en el inventario de DÚO «Item Name» suele traer la prenda (a veces con la marca, p. ej. «BLUSA AMBIANCE») y «Item Description» está vacío en 8,810 de 21,220 artículos. Hay dos perfiles de lectura (confirmado y alternativa); ninguno está decidido |
| P-17 | Cupones, certificados y tarjetas de regalo (precio negativo en el catálogo: 133 en el archivo) y artículos con precio 0 (54): hoy se importan y **no se pueden agregar a una venta**; falta definir su flujo |
| P-18 | Artículos sin UPC (655): hoy se importan, se encuentran por Item #, código alterno o texto, y no se escanean |
| P-19 | Item # repetido en el archivo (3 valores, 6 filas): hoy se conservan ambas filas, señaladas; falta decidir cuál se corrige y cómo |
| P-20 | Existencias: el archivo no trae cantidades. Las de prueba son sintéticas y marcadas; falta la existencia inicial real por ubicación |
| P-21 | Significado de «Etiqt-Costura» (Yes en 21,220) y «Etiqt- precio» (vacío en todos) para la migración: se conservan tal cual; la regla "lo cargado antes entra como etiquetado" cubre ambos checks o solo el de costura |
| P-22 | Departamentos: 199 valores distintos, 9,926 con «System» (sin clasificar) y sinónimos (Women's, WOMEN, DAMA…); se conservan sin normalizar |
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
