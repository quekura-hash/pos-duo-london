# POS DÚO / London

Punto de venta para DÚO New York y London Love (almacén central, 2 tiendas, 4 cajas). Proyecto separado de ORBL.

Estado: **Etapa 0 — diseño y simulador con datos sintéticos.** No es un POS listo para operar.

- `docs/arquitectura-etapa-0.md` — arquitectura propuesta, políticas pendientes (P-01…P-12).
- `docs/pruebas-sinteticas-etapa-0.md` — escenarios ejecutados, resultados, hallazgos y limitaciones.
- `src/` — motor y simulador (cajas, hub, central, almacenamiento en memoria y SQLite).
- `src/transporte/` — hub y caja como procesos reales con HTTP local (solo para pruebas de integración).
- `test/` — pruebas (`npm test`, Node ≥ 22.18; `npm run typecheck`).

Las políticas comerciales pendientes se configuran de forma explícita y están marcadas `ENSAYO_NO_APROBADO`.
