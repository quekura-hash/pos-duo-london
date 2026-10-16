# Pruebas sintéticas — Etapa 0

Simulador determinista en proceso (2 tiendas × 2 cajas, un hub por tienda, un central) con datos
**sintéticos**. Este documento describe qué se ejecutó, qué demuestra y qué **no** demuestra.
No valida recuperación de datos real, ni red real, ni equipo real.

Ejecutar: `npm install && npm test` (Node ≥ 22.18; usa `node:sqlite`, experimental). Tipos: `npm run typecheck`.

## Tipos de prueba (no mezclar)

| Etiqueta | Qué es | Pruebas |
|---|---|---|
| `[memoria]` | Motor completo sobre un almacenamiento en memoria. Sin disco; "reinicio" no aplica. | 61 |
| `[sqlite]` | El **mismo** motor sobre archivos SQLite (WAL, `synchronous=FULL`), con cierre y reapertura de la base (reinicio), pérdida de archivo y copia de respaldo. | 66 |
| `[sqlite — proceso real]` | Un proceso hijo inicia una transacción y se le envía `SIGKILL`; se reabre el archivo. También el disparador de la base. | 3 |
| `[memoria — lógica pura]` | Importación de catálogo, centavos, objeto de políticas. Sin nodos ni red. | 10 |

Total: 140 pruebas, 0 fallos (última ejecución). La "pérdida de conexión" es un interruptor del
transporte simulado (los mensajes no viajan por sockets); no es una red real.

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

## Verificación de que las pruebas detectan fallos

Se rompió deliberadamente cada mecanismo y se confirmó que su prueba falla: deduplicación (receptor y almacenamiento),
atomicidad de la venta, permiso del cajero, regla de Caja 2, bloqueo por disco nuevo, reutilización del intento de tarjeta,
límite de devolución, relevo de inventario entre cajas, cerco por ticket y fusión por código. Las 10 mutaciones fueron
detectadas (la primera, de una sola capa, no: hub y almacenamiento deduplican por separado).

## Fallos y hallazgos durante el desarrollo

1. **Disco nuevo sin catálogo.** Una caja con almacenamiento nuevo no podía ni armar un carrito. Se añadió la rehidratación desde el hub. Consecuencia que queda expuesta: las existencias se reconstruyen sin las ventas perdidas y quedan **sobreestimadas** hasta un conteo físico.
2. **Arrendamiento de folios.** Garantiza no reutilización pero **bloquea la venta** si la caja está aislada y agota el techo (`K_folios`); `K` debe dimensionarse con datos reales.
3. **Item #.** Cada estrategia trae un costo distinto (pendiente, saltos, bloqueo tras pérdida); la elección es del propietario (P-07).
4. **Doble devolución aislada y crédito/abono:** solo detección, no prevención.
5. Tipos: un error de tipado en un auxiliar de pruebas, corregido. `npm run typecheck` pasa.

## Limitaciones (no se declara validado)

- **Sin concurrencia real.** El simulador es de un solo hilo; las "carreras" son entrelazados escritos a mano. No se modeló el arbitraje del hub ni dos procesos escribiendo el mismo SQLite.
- **Sin red real**: no hay sockets, latencia, pérdida parcial ni reloj desfasado. Un "hub caído" es un interruptor.
- **SQLite**: `node:sqlite` es experimental y no es necesariamente el controlador de producción. `kill -9` prueba atomicidad ante caída del proceso, **no** corte de energía ni fallo de disco.
- **Recuperación**: la restauración usa copias de archivo del propio simulador. **No se validó ningún procedimiento real de respaldo/restauración.** Las ventas perdidas con el disco no se recuperan.
- **Hub**: se probó perder hub y caja a la vez solo en dos casos (R3/R3b); la recuperación del propio hub no está modelada más allá de eso.
- **Permisos**: se imponen en las funciones de consulta con un `Actor` ya dado; no hay autenticación, PIN, ni propagación de cambios de permisos sin conexión.
- **Alcance no cubierto**: apartados, crédito de empleadas, descuentos programables, ticket de regalo/impresión, cambios con renglón negativo (sin serie propia: P-08), conteo por denominaciones, reembolso a tarjeta, exportación `.xlsx` real, panel remoto, UI.
- **Hardware**: nada probado con impresora, cajón, escáner ni terminal.
- **Catálogo compartido entre tiendas** se asumió en las pruebas de alta (P-10 pendiente).
- **Incidencias**: se detectan a demanda sobre la bitácora; no hay flujo de resolución persistente.
