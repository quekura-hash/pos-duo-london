# Pruebas sintéticas — Etapa 0

Simulador determinista en proceso (2 tiendas × 2 cajas, un hub por tienda, un central) con datos
**sintéticos**. Este documento describe qué se ejecutó, qué demuestra y qué **no** demuestra.
No valida recuperación de datos real, ni red real, ni equipo real.

Ejecutar: `npm install && npm test` (Node ≥ 22.18; usa `node:sqlite`, experimental). Tipos: `npm run typecheck`.

## Tipos de prueba (no mezclar)

| Etiqueta | Qué es | Pruebas |
|---|---|---|
| `[memoria]` | Motor completo sobre almacenamiento en memoria, todo en un proceso. Sin disco; "reinicio" no aplica. | 100 |
| `[sqlite]` | El **mismo** motor sobre archivos SQLite (WAL, `synchronous=FULL`), en un proceso, con cierre y reapertura (reinicio), pérdida de archivo y copia de respaldo. | 106 |
| `[procesos reales]` | **Un hub real y dos procesos de caja separados** (procesos del sistema operativo), cada uno con su archivo SQLite, hablando por HTTP en `127.0.0.1`; `kill -9` reales. | 11 |
| `[navegador real]` | Chromium (Playwright) manejando la interfaz real. 6 contra el servidor local (motor en el proceso de la prueba, sobre SQLite) y 1 contra la **versión de una sola página** (motor en memoria dentro del navegador). | 7 |
| `[sqlite — proceso real]` | Un proceso hijo inicia una transacción y se le envía `SIGKILL`; disparador de la base. | 3 |
| `[memoria — lógica pura]` | Importación de catálogo, centavos, políticas, ticket (texto y ESC/POS). | 19 |

Total: **263 pruebas** (265 con el archivo real, ver abajo), 0 fallos (última ejecución; `npm test` ≈ 35 s). Las pruebas de procesos y de navegador se repitieron 3 veces seguidas sin variación.
En las pruebas en un solo proceso, la "pérdida de conexión" es un interruptor del transporte simulado.

## Políticas pendientes: configuración explícita de ensayo

Las políticas P-01, P-02, P-03, P-06, P-07 y P-12 **no tienen valor por omisión** (`crearPoliticasEnsayo`
falla si falta una) y todo objeto creado queda marcado `ENSAYO_NO_APROBADO`; `exigirPoliticasAprobadas`
siempre falla. Que una prueba use una alternativa **no** la aprueba ni la recomienda para producción.

## Escenarios y resultados

### Independencia de folios y ventas por caja (`01`, `[memoria]`/`[sqlite]`)
- F1 cuatro series consecutivas e independientes con ventas intercaladas; tienda+caja+folio única; la sincronización no renumera. ✔
- F2 el folio continúa al cambiar de mes; el límite de mes usa la hora de Hermosillo. ✔
- F3 cancelación conserva folio y estado y devuelve existencias por movimiento; el número no se reutiliza. ✔
- F4 doble clic/reintento sobre el mismo carrito: misma venta, mismo folio, un movimiento. ✔
- F5 entrega repetida con confirmaciones perdidas: un solo efecto en hub y central. ✔
- F6 Caja 2 rechaza tarjeta y mixto en la lógica de dominio y sin consumir folio. ✔
- F7 el hub rechaza una venta con tarjeta de Caja 2 aunque la caja la hubiera emitido; queda un registro de rechazo. ✔
- F9 fallo inyectado en tres puntos de la venta: ni folio, ni venta, ni movimientos; sin hueco posterior. ✔
- P1/P2 `[sqlite]` guardar, perder conexión, reiniciar, reenviar: sin duplicados, contador y carrito sobreviven. ✔

### Inventario compartido (`02`)
- I1 venta en Caja 2 visible en Caja 1 por LAN sin internet; el central se pone al día al volver internet. ✔
- I2 las tiendas no comparten inventario. ✔
- I3/I3b última pieza con hub disponible bajo P-02 `bloquear` y `permitir_y_conciliar`. ✔
- I4 última pieza con hub caído (P-01 `vender_autonomo_con_aviso`): ambas venden, existencia −1 señalada, ninguna operación se pierde. ✔
- I5 P-01 `bloquear_ventas_nuevas`: no vende, conserva el carrito, completa al volver. ✔
- I6 internet caído no es hub caído: se sigue vendiendo aun con P-01 `bloquear_ventas_nuevas`. ✔

### Permisos de reportes y cortes (`03`)
- El cajero ve solo su caja, aun cuando la fuente (central) contiene las cuatro. ✔
- El cajero no puede pedir otra caja, varias cajas, el consolidado ni cortes ajenos. ✔
- Administración consolida todo o selecciona cajas de tiendas distintas; folios originales intactos. ✔
- Reporte mensual de una caja sin ventas de otras ni de otros meses; octubre/noviembre sin reinicio de folio. ✔
- Mismas llaves tienda/caja/folio local, en central y exportadas (importe como texto decimal exacto). ✔
- Cortes independientes por caja, con fondo, devoluciones, retiros y efectivo esperado. ✔

### Recuperación de folios (`04`)
- R1 pérdida de disco con 4 ventas jamás sincronizadas (P-06 aceptada): bloquea; sin hub sigue bloqueada; con hub recupera sin reutilizar 1–4 (siguiente folio 7) y documenta el hueco 1–6. ✔
- R2 sin acceso a hub/central la emisión sigue bloqueada, también tras reiniciar. ✔
- R3 sin techo registrado (evidencia incompleta) no hay recuperación automática. ✔ R3b con el techo en el central sí. ✔
- R4/R5 sin P-06: no hay recuperación automática; la atestación rechaza folios ≤ lo conocido, exige evidencia y confirmación sin anclas; queda `verificable:false`. ✔
- R6 ticket con folio mayor al contador bloquea la serie. ✔
- R7 costo del arrendamiento: aislada y con el techo agotado la caja deja de vender. ✔
- R8/R9 `[sqlite]` respaldo viejo restaurado: detecta atraso y bloquea; un respaldo con ventas pendientes las reenvía sin duplicar. ✔

### Tarjeta pendiente (`05`)
- T1 el intento se conserva, no se vuelve a cobrar, el carrito queda protegido. ✔
- T2 un pendiente **no** bloquea ventas en efectivo de otros carritos, devoluciones ni corte; P-12 `bloquear_solo_tarjeta` solo frena otro cobro con tarjeta. ✔ T2b P-12 `permitir_con_aviso`. ✔
- T3 aprobar es idempotente (una venta, un folio). T4 no cobrado. T5 desconocido con incidencia. T6 mixto. ✔
- T7 con hub caído y P-01 bloqueando ventas nuevas, un cobro ya aprobado se completa. ✔
- T8 con disco perdido, la conciliación contra el lote de la terminal detecta el cobro sin venta. ✔
- T9 `[sqlite]` el intento y el carrito sobreviven a un reinicio. ✔

### Altas sin internet con cada estrategia de Item # (`06`)
Para a (central al sincronizar), b (bloques) y c (espacios por caja): alta y venta con Caja 2 sin LAN ni internet;
la existencia inicial es un movimiento; al sincronizar el artículo conserva `item_id` y código en todos los nodos,
el ticket sigue apuntando al mismo artículo, y los Item # sembrados no cambian. ✔
Hallazgos por estrategia:
- (a) sin saltos (1005, 1006, 1007…), pero el Item # queda **pendiente** mientras no hay internet.
- (b) deja **saltos** (1006–1009 en la prueba) y una caja sin bloque y aislada **no puede dar altas**.
- (c) sin coordinación y sin saltos dentro de cada espacio, pero tras perder el disco queda **bloqueada** hasta una resolución humana.
- Mismo código creado sin conexión en dos tiendas: no se fusiona, se reporta `codigo_duplicado`, el POS exige elegir. ✔
- Mismo marca/estilo con código distinto: artículos distintos. Alta con código existente: rechazada. Alta sin perder el carrito. Precio editado solo en el ticket no toca el catálogo. ✔

### Importación, políticas, devoluciones, proceso real (`07`–`10`)
- Mapeo UPC→Código, Size→Lote, Attribute→Estilo con `0002026090782`, `20260913`, `726-` intactos; conflictos de código/Item # reportados; código numérico de Excel advertido sin reconstruir ceros. ✔
- Devolución parcial proporcional al descuento pagado (35000 = 11666+11666+11668), reintento idempotente, y bloqueo de exceso. ✔
- Con hub, la autoridad **previene** la doble devolución. Con ambas cajas aisladas **no se puede prevenir**: ambas operaciones se conservan y se señala `devolucion_excede_vendido`. ✔
- `kill -9` a mitad de una transacción: sin venta, folio ni cola parcial; lo confirmado antes sobrevive. La base rechaza tarjeta en caja solo-efectivo. ✔

### Recuperación con movimientos disponibles vs. operaciones nunca replicadas (`11`)
El informe de rehidratación separa dos clases y nunca estima la segunda:
- **Recuperable** (existe en hub/central): catálogo, *todos* los movimientos de la tienda y las operaciones propias que sí llegaron. RP1 verifica el conteo exacto contra el hub.
- **No replicado** (se perdió con el disco): contenido `desconocido`; se informa la evidencia disponible (rango de folios cubierto por el techo, o `ninguna`).
- **Existencias**: toda la tienda queda `no_verificadas` (lo perdido no se puede atribuir a artículos). Las ventas no se frenan. Solo un **conteo físico** limpia la marca, artículo por artículo, mediante movimiento (contar 46 con saldo 50 → delta −4; contar de nuevo no suma). RP3–RP5. ✔
- **Hub reconstruido desde el central** (RP6/RP7): restaura techos, reenvía el relevo perdido a las cajas y pide a las cajas reenviar lo que ellas conservan; si ninguna caja se perdió no hay existencias dudosas; si una caja también se perdió, se marca. ✔

### Arbitraje del hub (`12`, en proceso; y `14`, con procesos reales)
- AR1 carrera sin sincronizar: el hub concede la última pieza a una sola caja (P-02 `bloquear`); la rechazada no consume folio. ✔
- AR2 `permitir_y_conciliar`: se conceden ambas, la segunda recibe `sobreventa:*` y queda −1 señalado. ✔
- AR3/AR3b reintento idempotente; un rechazo o una liberación **no** se heredan en el reintento. AR4 fallo → reserva liberada. AR5 reserva huérfana vence por vigencia técnica. AR6 sin hub no hay reservas. ✔

### Integración con procesos reales (`14`)
Un proceso hub (servidor HTTP, SQLite) + dos procesos caja (motor completo, SQLite, cliente HTTP). Cada prueba crea archivos nuevos.
- X1 venta de Caja 2 llega al hub y se refleja en Caja 1; series independientes. ✔
- X2 24 ventas disparadas a la vez desde los dos procesos: folios 1..12 por caja sin huecos ni duplicados; existencias exactas en hub y cajas; reporte por caja conserva su serie. ✔
- X3 8 rondas de la última pieza pedida simultáneamente (P-02 `bloquear`): **exactamente una** venta por ronda, la otra `SIN_EXISTENCIA`, sin saldo negativo, sin huecos de folio, reservas cerradas. ✔
- X4 mismo escenario con `permitir_y_conciliar`: ambas proceden, solo una recibe el aviso, −1 señalado en las 4 rondas. ✔
- X5 el hub procesa pero pierde 3 respuestas (conexión destruida) y doble envío simultáneo del mismo cobro: una venta, un movimiento, un folio. ✔
- X6 **hub muerto con `kill -9`** y P-01 `vender_autonomo_con_aviso`: se vende aislado, al relanzar el hub (mismo archivo y puerto) convergen; sobreventa señalada, no perdida. ✔
- X7 hub muerto con P-01 `bloquear_ventas_nuevas`: `VENTA_BLOQUEADA`, folio intacto, el carrito completa al volver. ✔
- X8 el hub reiniciado conserva sus reservas; una reserva huérfana vence y la pieza vuelve a estar disponible. ✔
- X9 **caja muerta con `kill -9`** con venta pendiente y carrito abierto: folio, carrito y cola sobreviven; reenvío sin duplicar. ✔
- X10 partición de una caja (interruptor): converge. X11 el techo de folios del hub persiste a su reinicio. ✔

### Resolución administrativa de códigos duplicados (`13`)
Ver `arquitectura-etapa-0.md` §9. CD1 Administración ve artículos en conflicto, existencias por tienda y ventas con elección provisional; CD2 el cajero no
puede listar ni resolver; CD3 reasignar código (se propaga a todas las cajas, conserva ceros, no toca tickets históricos); CD4 validaciones; CD5 **la fusión no existe**: no hay función y una operación `item.fusion` inyectada no surte efecto (el conflicto sigue abierto);
CD7 una caja aislada sigue viendo el conflicto hasta recibir la resolución. ✔

### Ajustes pedidos antes de la primera operación
- **Fusión retirada** del alcance: se eliminaron `fusionarArticulos`, los alias y su tratamiento en existencias; CD5 ahora comprueba que no existe. ✔
- **Inventario y documentos separados** (`11`, RP8–RP12): el informe de reconstrucción abre dos registros distintos. Un conteo físico de **todos** los artículos deja el inventario verificado pero **no** cierra la pérdida documental (RP9); declararla irrecuperable (solo Administración, con evidencia y nota, nunca "recuperada") **no** limpia el inventario ni devuelve la venta (RP10); el corte de la caja afectada la muestra (RP12). ✔
- **P-14** (`11`, RP5/RP13): vender con existencia no verificada es una alternativa de ensayo con dos valores explícitos, sin valor por omisión; ninguna está aprobada. ✔

### Primera operación completa (`15`–`18`)
- `15` **Ticket** (K1–K8): MXN exactos; Item #, Código, Descripción, Marca, Estilo y Lote separados y rotulados; sin IVA/Tax/impuestos/%/subtotal; folio y código `D2-000012`; leyenda configurable; reimpresión rotulada; ESC/POS (inicialización, PC858, Code128, corte, pulso de cajón opcional); un renglón largo se parte entre campos, no a mitad de uno. ✔
- `16` **Servicio de venta** (V1–V9, `[memoria]`/`[sqlite]`): escaneo con ceros iniciales, incremento de cantidad, quitar, efectivo insuficiente sin consumir folio, venta+pago+folio+movimientos guardados, inventario descontado y visible en la otra caja y el central (London intacto), ticket impreso (archivos simulados, pulso de cajón solo en el original), corte en vivo y cierre, falla de impresora (venta una sola vez, reimpresión con el mismo folio, sin abrir cajón), cuatro series independientes con inventario compartido solo dentro de cada tienda, cajero solo su caja y Administración una/varias/todas, código ambiguo sin adivinar, búsqueda por código/Item #/texto, venta sin hub, encabezado, reinicio. ✔
- `17` **API HTTP** (H1–H5): flujo completo, 403 al pedir otra caja o rutas de Administración (y viceversa), impresora que falla con HTTP 200 y venta guardada, duplicados. ✔
- `18` **Navegador real** (UI1–UI6, Chromium): flujo completo desde la pantalla con capturas; encabezado con tienda/caja/usuario/fecha/folio/hub/internet/pendientes/última sincronización; navegación por permisos; columnas en el orden pedido; botón de regalo visible, deshabilitado y debajo de Cobrar; cobro deshabilitado hasta cubrir el total; falla de impresora y reintento; duplicado sin opción de elegir; Administración con una, varias o todas las cajas y folios originales; las diez columnas sin desplazamiento horizontal en 1366, 1280 y 1024 px; sin errores de consola. ✔
- Capturas en `docs/capturas/` (generadas por las pruebas): `01-venta-en-curso`, `02-ticket`, `03-corte`, `04-falla-de-impresora`, `05-administracion-todas`, `06-pantalla-angosta`, `07-venta-1024`.
- Demostración manual con datos sintéticos: `npm run demo` (4 cajas y Administración en `127.0.0.1`, servidor real con SQLite).
- **Versión de prueba en una sola página** (`npm run build:prueba` → `dist/pos-venta-prueba.html`): el mismo motor, servicio, enrutador, ticket y pantalla empaquetados con esbuild y con almacenamiento en memoria; selector de sesión (4 cajas y Administración), hub caído simulado, siguiente impresión con falla (una vez) y reinicio de datos. No hay hub real, SQLite ni impresora, y los datos se pierden al recargar. Prueba `19` (B1). Hallazgo al construirla: la falla simulada de impresora debía ser de **una sola vez**, porque con el diálogo del ticket abierto el probador no puede apagarla para reintentar.

### Inventario real de DÚO en Excel (`20`, `19`, `18`)
Archivo recibido: `inventario_duo_oct.xlsx` (1 hoja, 21,220 artículos, 14 columnas). **El archivo real no se guarda en el repositorio** (`*.xlsx` está en `.gitignore`): las pruebas generan un Excel sintético con la misma estructura y los mismos defectos, y las pruebas con el archivo real corren solo si `POS_INVENTARIO_REAL` apunta a él.

Hallazgos del archivo real (sin modificarlo):
| Hallazgo | Cantidad |
|---|---|
| Artículos | 21,220 (coincide con la lista de la foto) |
| Con UPC / **sin UPC** | 20,565 / **655** |
| Con «Alternate Lookup» | 107 (1 coincide con el UPC de otro artículo) |
| **Item Number repetido** | **3 valores (149, 1317, 1337), 6 filas, con UPC distintos** |
| UPC repetido | 0 (todos de 13 dígitos salvo 2 de 18 y 1 de 14; todos texto) |
| **Precio negativo** (cupones, gift cards…) / **precio 0** | **133 / 54** |
| Precio con centavos | 2 (563.5 y 0.5) |
| «Custom Price 1» | 0 en 14,433; en el resto es ≈ 90 % del precio (nivel de precio alterno) |
| «Item Description» vacío | **8,810** |
| «Etiqt-Costura» = Yes / «Etiqt- precio» vacío | 21,220 / 21,220 |
| «No. Pedimento» y «UPC 2» | vacíos |
| Estilo vacío / Lote vacío | 6,568 / 18,558 (21 lotes distintos; algunos parecen día-mes-año) |
| Departamento «System» | 9,926 (199 departamentos distintos, con sinónimos) |
| **Cantidades (On-Hand Qty)** | **ninguna columna** |

**Discrepancia con el mapeo confirmado**: la especificación dice Item Name = Marca e Item Description = Descripción, pero en este archivo «Item Name» suele ser la prenda (VESTIDO, BLUSA, PANTALON…), a veces con la marca («BLUSA AMBIANCE»), y «Item Description» está vacío en el 41 %. Por eso hay dos perfiles de lectura y el diálogo de importación muestra la vista previa de cada uno. Quedó el confirmado como predeterminado; **la decisión es del propietario (P-16)**.

Pruebas:
- `20` **IX1–IX15** (memoria): columnas reconocidas, ceros y lotes como texto, código guardado como número advertido y sin reconstruir, Item # repetido conservado y señalado (y detectado como incidencia), artículos sin código (no se escanean; se encuentran por Item #, alterno o texto; se agregan eligiéndolos), precios 0/negativos importados pero no vendibles, los dos perfiles, ausencia de cantidades sin inventar existencia y con mensaje legible (nombres, no identificadores internos), existencia de prueba marcada, carga idempotente, venta de un artículo importado con sus seis campos, exportación a Excel (texto como texto, precios numéricos, existencia y verificación por tienda, texto tipo fórmula sin ejecutar), ida y vuelta con ambos perfiles, y **21,220 filas** leídas, cargadas y escaneadas con tiempos acotados. ✔
- `20` **IR1** (archivo real, opcional): los números de la tabla anterior. ✔
- `18` **UI7**: Administración consulta el inventario y lo exporta con una **descarga real del navegador**; el cajero no tiene la ruta. ✔
- `19` **B2**: en la página de prueba, importar un `.xlsx` (vista previa, perfiles, hallazgos), cargarlo, vender (código, cupón rechazado, alterno, artículo sin código), exportar y que **persista al recargar** (guardado en el navegador). **BR1** (archivo real, opcional): 21,220 artículos reales en el navegador. ✔

Hallazgos de ingeniería al cargar el inventario real:
- **Rendimiento**: el motor recalculaba el catálogo y las existencias desde toda la bitácora en cada operación y copiaba toda la memoria en cada transacción. Con 21,220 artículos (42,253 operaciones por nodo) era inviable. Se añadieron proyecciones incrementales y un rollback sin copia. Medido en Node, memoria: 49 escaneos en ~6 ms, cobrar una venta de 50 líneas ~60 ms; SQLite: ~40 ms y ~290 ms; cargar el catálogo en 7 bases SQLite tarda ~14 s (una vez). En el navegador: leer el archivo ~0.9 s, cargarlo ~0.4 s, primer escaneo ~35 ms.
- **Mensaje de existencia**: decía el identificador interno del artículo; ahora nombra descripción, marca e Item #.

## Verificación de que las pruebas detectan fallos

Se rompió deliberadamente cada mecanismo y se confirmó que su prueba falla: deduplicación (receptor y almacenamiento),
atomicidad de la venta, permiso del cajero, regla de Caja 2, bloqueo por disco nuevo, reutilización del intento de tarjeta,
límite de devolución, relevo de inventario entre cajas, cerco por ticket y fusión por código. Las 10 mutaciones fueron
detectadas (la de una sola capa de deduplicación no: hub y almacenamiento deduplican por separado).
En esta ronda se repitió con 7 mecanismos nuevos (arbitraje, cierre de reservas, marca de existencias, permiso de Administración, alcance del conteo, rechazo pegajoso, reenvío desde cajas): las 7 fueron detectadas.
En la ronda de la primera operación se rompieron otros 7 (P-14, cierre de pérdida documental por conteo, IVA en el ticket, API que deja ver otra caja, escaneo ambiguo que elige, fotografía del artículo sin marca, corte que no refleja el efectivo): los 7 fueron detectados. Una octava mutación estaba mal construida (no cambiaba el comportamiento) y se descartó.
En la ronda del inventario se rompieron 7 más (vender precio no vendible, código vacío como identidad, exportar sin ceros, descartar Item # repetidos, existencia inventada, mensajes con identificadores internos, perfil confirmado invertido): los 7 fueron detectados (el de código vacío solo al quitar sus dos protecciones a la vez).

## Fallos y hallazgos durante el desarrollo

1. **Disco nuevo sin catálogo.** Una caja con almacenamiento nuevo no podía ni armar un carrito. Se añadió la rehidratación desde el hub. Consecuencia que queda expuesta: las existencias se reconstruyen sin las ventas perdidas y quedan **sobreestimadas** hasta un conteo físico.
2. **Arrendamiento de folios.** Garantiza no reutilización pero **bloquea la venta** si la caja está aislada y agota el techo (`K_folios`); `K` debe dimensionarse con datos reales.
3. **Item #.** Cada estrategia trae un costo distinto (pendiente, saltos, bloqueo tras pérdida); la elección es del propietario (P-07).
4. **Doble devolución aislada y crédito/abono:** solo detección, no prevención.
5. Tipos: un error de tipado en un auxiliar de pruebas, corregido. `npm run typecheck` pasa.
6. **Rechazos y liberaciones pegajosos (hallado por X8 con procesos reales).** El hub devolvía el mismo "no" (y el mismo "sí" de una reserva ya liberada) al reintentar el mismo carrito. Corregido: solo se repite lo vigente; el resto se reevalúa. Las pruebas en un solo proceso no lo habían visto.
7. **Reconstruir un hub no basta con copiar del central.** Se pierden la cola de relevo hacia las cajas y las confirmaciones: se añadió el reenvío completo desde las cajas, que conservan sus operaciones y los movimientos de su par.
8. **Divergencia tras pérdida doble (RP7):** el *movimiento* de una venta puede sobrevivir en la caja par y la *venta* (folio, pagos) no. Existencias y registro de ventas quedan inconsistentes hasta un conteo físico.
9. **La marca de existencias es de toda la tienda** porque lo perdido no se puede atribuir a artículos. Acotarla exigiría numerar las operaciones de cada caja (secuencia propia) para detectar huecos; propuesto, no implementado.
10. **Error en el servidor de la aplicación (hallado por el navegador).** Una petición de archivo inexistente (p. ej. el ícono de la pestaña) escribía encabezados y luego fallaba, lo que tumbaba la respuesta. Corregido: se lee el archivo antes de responder.
11. **Tabla de venta cortada (hallada al mirar la captura).** Con 11 columnas, Item # y Código quedaban fuera de la vista y la columna de acciones se cortaba. Se compactó, se apila el resumen bajo el ancho de 1320 px y se añadió una prueba de que las diez columnas caben a 1366/1280/1024 px.
12. **Corte guardado vs. corte en vivo.** Antes, pedir el corte de nuevo recalculaba pero no reescribía el guardado, mezclando ambos. Ahora el en vivo no se guarda y el cierre se guarda una vez; una venta posterior lo marca desactualizado.
13. **Renglón de campos del ticket partido a mitad de un campo** (`Lote:` / `20260913`). Ahora se parte entre campos completos.

## Limitaciones (no se declara validado)

- **Concurrencia parcial.** Las pruebas `[procesos reales]` sí ejecutan dos cajas en paralelo contra un hub real. Aun así: el árbitro es correcto porque el hub procesa cada solicitud de forma síncrona en un solo hilo; no se probó un hub con varios hilos ni dos procesos escribiendo el mismo archivo SQLite. Las pruebas en un solo proceso siguen usando entrelazados escritos a mano.
- **Red local de laboratorio, no una red real.** Todo corre en una sola máquina Linux por `127.0.0.1`: sin latencia, pérdida parcial de paquetes, reordenamiento, reloj desfasado ni Windows. Las fallas son: `kill -9` de procesos (reales), conexión destruida tras procesar (real) y un interruptor de partición (simulado). Nunca se probó un cable desconectado ni un `switch` caído.
- **Sin autenticación ni cifrado**: cualquier proceso local puede llamar al hub. Un hub real requiere emparejamiento/credenciales por equipo.
- **Sincronización explícita**: en las pruebas la caja sincroniza cuando la prueba lo ordena; no hay sincronización automática en segundo plano, ni reintentos con espera creciente.
- **La llamada HTTP bloqueante de la caja** (hilo auxiliar + `Atomics.wait`) es una técnica de laboratorio para conservar el motor síncrono; no se recomienda como diseño final de la aplicación.
- **Sin central** en las pruebas de procesos: el enlace hub↔central solo existe en las pruebas de un solo proceso.
- **SQLite**: `node:sqlite` es experimental y no es necesariamente el controlador de producción. `kill -9` prueba atomicidad ante caída del proceso, **no** corte de energía ni fallo de disco.
- **Recuperación**: la restauración usa copias de archivo del propio simulador. **No se validó ningún procedimiento real de respaldo/restauración.** Las ventas perdidas con el disco no se recuperan.
- **Hub**: se probó perder hub y caja a la vez solo en dos casos (R3/R3b); la recuperación del propio hub no está modelada más allá de eso.
- **Permisos**: se imponen en las funciones de consulta con un `Actor` ya dado; no hay autenticación, PIN, ni propagación de cambios de permisos sin conexión.
- **Inventario**: solo se implementó la carga inicial del catálogo y la exportación. No hay actualización por código desde un segundo archivo, entradas de mercancía, conteo por Excel ni `.xls`. Las etiquetas (costura/precio), pedimento, precio alterno y departamentos se **conservan** pero no se usan. El archivo real no trae existencias: las de las pruebas son sintéticas.
- **Alcance no cubierto**: apartados, crédito de empleadas, descuentos programables, ticket de regalo (botón visible y deshabilitado), cambios con renglón negativo (sin serie propia: P-08), conteo por denominaciones, reembolso a tarjeta, exportación `.xlsx` real, panel remoto, venta en espera, edición de precio/descripción en la pantalla (existe en el motor, no en la interfaz), alta de artículo desde la pantalla, cobro con tarjeta desde la pantalla, devoluciones desde la pantalla.
- **Diseño visual**: el mockup aprobado no se recibió; la interfaz se construyó a partir de la descripción textual y **no se ha comparado con él**.
- **Hardware**: nada probado con impresora, cajón, escáner ni terminal. La "impresora" es un archivo; el ESC/POS está verificado solo por estructura de bytes. El ancho de 42 columnas es un supuesto. Un escáner se simula escribiendo el código y pulsando Enter.
- **Navegador y sistema**: solo Chromium en Linux; no Windows, no la ventana Electron, no pantallas táctiles ni teclado numérico físico.
- **Interfaz**: la prueba de navegador usa el motor en el mismo proceso (no el hub real por HTTP); usuarios sintéticos sin autenticación; el indicador de internet muestra "Sin dato" fuera de la simulación; la interfaz **no tiene botón de sincronización** (existe la ruta `/api/sincronizar`); en las pruebas la dispara la prueba y en `npm run demo` ocurre cada 2 s.
- **La regla de "pérdida documental" no reconstruye nada**: solo registra y permite declararla irrecuperable.
- **Marcas de existencias**: un conteo físico es manual; no hay flujo guiado ni importación de conteo (propósito 4 del Excel) todavía.
- **Catálogo compartido entre tiendas** se asumió en las pruebas de alta (P-10 pendiente).
- **Incidencias**: se detectan a demanda sobre la bitácora; no hay flujo de resolución persistente.
