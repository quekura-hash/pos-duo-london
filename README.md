# POS DÚO / London

Punto de venta para DÚO New York y London Love (almacén central, 2 tiendas, 4 cajas). Proyecto separado de ORBL.

Estado: **Etapa 0 — diseño y simulador con datos sintéticos.** No es un POS listo para operar.

- `docs/arquitectura-etapa-0.md` — arquitectura propuesta, políticas pendientes (P-01…P-26).
- `docs/pruebas-sinteticas-etapa-0.md` — escenarios ejecutados, resultados, hallazgos y limitaciones.
- `src/` — motor y simulador (cajas, hub, central, almacenamiento en memoria y SQLite).
- `src/app/` — servicio de venta, servidor local y la interfaz (`publico/`).
- `src/ticket.ts`, `src/impresion.ts` — ticket (texto y ESC/POS) e impresora simulada.
- `src/transporte/` — hub y caja como procesos reales con HTTP local (solo para pruebas de integración).
- `test/` — pruebas (`npm test`, Node ≥ 22.18; `npm run typecheck`; las de navegador usan Chromium: variable `POS_CHROMIUM` si no está en la ruta habitual).

Primera operación completa (escanear → cobrar en efectivo → ticket → corte): `npm run demo` levanta 4 cajas y Administración con datos sintéticos en `127.0.0.1:3001-3004` y `:3010`. Para probar sin instalar un servidor: `npm run build:prueba` genera `dist/pos-venta-prueba.html`, una sola página con el motor en memoria. Para cargar su inventario real en la demostración local: `npm run demo -- --inventario ruta/inventario.xlsx` (opciones `--perfil`, `--duo`, `--lon`). El archivo no se guarda en el repositorio. Capturas en `docs/capturas/`. El mockup visual aprobado **no** se ha recibido: la interfaz sigue la descripción textual y debe compararse con él.

Pantalla de venta según la maqueta aprobada, con logo por tienda, iconos y **tarjetas de regalo** (venta con folio, recarga, vigencia de 12 meses, consulta de saldo y cobro total o con resto en efectivo), devoluciones con folio de la misma serie y solo en la caja de origen; Apartados está fuera de la interfaz por ahora.

Las políticas comerciales pendientes se configuran de forma explícita y están marcadas `ENSAYO_NO_APROBADO`.
