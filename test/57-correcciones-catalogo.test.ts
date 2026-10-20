import assert from 'node:assert/strict';
import { test } from 'node:test';
import { aplicarDepartamentos, DEPARTAMENTOS_BASE } from '../src/departamentos.ts';
import { leerCorrecciones, planCorrecciones } from '../src/correcciones-catalogo.ts';
import { aOperacionesInventario, leerInventario } from '../src/inventario.ts';
import { catalogo } from '../src/proyecciones.ts';
import type { Op } from '../src/tipos.ts';

const ENC = ['Item Number', 'Descripcion', 'Marca', 'Estilo', 'Lote', 'Precio', 'UPC', 'departamento', 'cantidad'];
const FILAS: unknown[][] = [
  ENC,
  [1, 'BLUSA', '', 'MW1', '20251007', 499, '0002025101274', 'ORGANIC G', 6],
  [2, 'BLUSA', 'LEVIS', 'MW2', '20251007', 499, '0002025101281', 'ORGANIC G', 3],
  [3, 'VESTIDO', '', 'V1', '20251007', 899, '0002025101298', 'ROPA MUJER CASUAL', 2],
  [4, 'FALDA', '', 'F1', '20251007', 399, '0002025101304', 'Dama', 1],
  [5, 'PLAYERA', '', 'P1', '20251007', 199, '0002025101311', 'Feb 17', 4],
  [6, 'CAMISA', '', 'C1', '20251007', 299, '0002025101328', 'VICTORIAS SECRET', 5],
  [7, 'SUDADERA', '', 'S1', '20251007', 599, '0002025101335', 'ORGANIC G', 2],
];
const ACTIVOS = DEPARTAMENTOS_BASE.filter((d) => d.activo).map((d) => d.nombre);
const AHORA = '2026-10-21T10:00:00.000Z';

function importar(decisiones: Record<string, string> = {}) {
  const r = leerInventario(FILAS);
  const dep = aplicarDepartamentos(r.articulos, DEPARTAMENTOS_BASE, { decisiones, reglaEnvolturas: false });
  return aOperacionesInventario(dep.articulos, { ahora: AHORA, idImportacion: 'imp1', limbo: { piezas: 0, delArchivo: true } }).ops;
}
const CORR = (filas: (string | null)[][]) => leerCorrecciones([['Departamento (texto en el archivo)', '¿Es marca?', 'Departamento correcto', 'Artículos'], ...filas.map((f) => [...f, 1])]);
const plan = (ops: Op[], filas: (string | null)[][]) => planCorrecciones({ correcciones: CORR(filas).filas, inventarioOriginal: FILAS, catalogo: [...catalogo(ops).values()], deptosActivos: ACTIVOS, por: 'Edgardo', ahora: AHORA });
const dama = ACTIVOS.find((d) => /^dama$/i.test(d))!;
const caballero = ACTIVOS.find((d) => /^caballero$/i.test(d))!;

test('CC1 lectura: encabezados en cualquier orden, «(vacío)» y errores de archivo equivocado', () => {
  const l = leerCorrecciones([['Artículos', 'Departamento correcto', '¿Es marca?', 'Departamento (texto en el archivo)'], [3, 'Dama', 'Sí', 'ORGANIC G'], [1, '', '', '(vacío)'], [1, '', '', '']]);
  assert.deepEqual(l.filas.map((f) => [f.texto, f.esMarca, f.departamento]), [['ORGANIC G', true, 'Dama'], ['', false, '']]);
  assert.match(leerCorrecciones([['UPC', 'Precio']]).errores[0]!, /No parece el archivo de correcciones/);
});

test('CC2 marca = Sí: la marca se llena solo si está vacía y el departamento cambia; sin decisión no se toca', () => {
  const ops = importar();
  assert.equal(catalogo(ops).get('imp1-f2')!.departamento, 'Sin clasificar');
  const p = plan(ops, [['ORGANIC G', 'Sí', dama], ['ROPA MUJER CASUAL', '', dama], ['Feb 17', '', ''], ['VICTORIAS SECRET', 'Sí', null]]);
  assert.deepEqual([p.resumen.articulosCambiados, p.resumen.marcasPuestas, p.resumen.departamentosCambiados, p.resumen.conMarcaPropia, p.resumen.sinDecision], [5, 3, 4, 1, 1]);
  const cat = catalogo([...ops, ...p.ops]);
  const g = (n: number) => cat.get(`imp1-f${n + 1}`)!;
  assert.deepEqual([g(1).marca, g(1).departamento], ['ORGANIC G', dama]);
  assert.deepEqual([g(2).marca, g(2).departamento], ['LEVIS', dama], 'conserva su marca');
  assert.deepEqual([g(7).marca, g(7).departamento], ['ORGANIC G', dama]);
  assert.deepEqual([g(3).marca, g(3).departamento], ['', dama], 'sin «Sí» solo cambia el departamento');
  assert.deepEqual([g(5).marca, g(5).departamento], ['', 'Sin clasificar'], 'sin decisión queda como está');
  assert.deepEqual([g(6).marca, g(6).departamento], ['VICTORIAS SECRET', 'Sin clasificar'], 'marca sin departamento: solo la marca');
  assert.equal(g(4).departamento, dama, 'lo ya reconocido no se toca');
});

test('CC3 la marca se llena aunque el artículo ya esté clasificado; el departamento ya elegido se respeta, un departamento inexistente no se aplica y repetir no duplica', () => {
  const ops = importar({ 'organic g': caballero }); // al importar se eligió Caballero para ORGANIC G
  const p = plan(ops, [['ORGANIC G', 'Sí', dama], ['ROPA MUJER CASUAL', '', 'Departamento inventado'], ['Otro texto', 'Sí', dama]]);
  assert.equal(p.resumen.yaClasificados, 3, 'el departamento elegido al importar se respeta');
  assert.deepEqual([p.resumen.articulosCambiados, p.resumen.marcasPuestas, p.resumen.departamentosCambiados, p.resumen.conMarcaPropia], [2, 2, 0, 1], 'pero la marca sí se llena (solo donde está vacía)');
  assert.deepEqual(p.resumen.deptosInvalidos.map((d) => d.texto), ['ROPA MUJER CASUAL']);
  assert.deepEqual(p.resumen.sinCoincidencia.map((d) => d.texto), ['Otro texto']);
  const c3 = catalogo([...ops, ...p.ops]);
  assert.deepEqual([c3.get('imp1-f2')!.departamento, c3.get('imp1-f2')!.marca], [caballero, 'ORGANIC G']);
  assert.deepEqual([c3.get('imp1-f3')!.departamento, c3.get('imp1-f3')!.marca], [caballero, 'LEVIS']);
  // Repetir la misma corrección genera las mismas operaciones (mismos op_id): se deduplican al subirlas.
  const base = importar();
  const a = plan(base, [['ORGANIC G', 'Sí', dama]]);
  const b = plan(base, [['ORGANIC G', 'Sí', dama]]);
  assert.deepEqual(a.ops.map((o) => o.op_id), b.ops.map((o) => o.op_id));
  assert.equal(new Set(a.ops.map((o) => o.op_id)).size, a.ops.length);
});

test('CC4 marcas por artículo: solo con el archivo de marcas; verifica el código y no pisa marcas existentes', async () => {
  const { leerMarcasPorArticulo, planMarcasPorArticulo } = await import('../src/correcciones-catalogo.ts');
  const ops = importar({ 'organic g': caballero });
  const cat = [...catalogo(ops).values()];
  const l = leerMarcasPorArticulo([['Fila de origen', 'Item #', 'Código', 'Marca'], [2, 1, '0002025101274', 'ORGANIC G'], [3, 2, '0002025101281', 'ORGANIC G'], [4, 3, '9999999999999', 'DRESS DAY'], [99, 9, '1', 'X'], [5, 4, '', '']]);
  assert.deepEqual(l.errores, []);
  assert.equal(l.filas.length, 4);
  const p = planMarcasPorArticulo({ marcas: l.filas, catalogo: cat, por: 'Edgardo', ahora: AHORA });
  assert.deepEqual([p.resumen.marcasPuestas, p.resumen.conMarcaPropia, p.resumen.sinCoincidencia.length, p.resumen.noEncontrados, p.resumen.departamentosCambiados], [1, 1, 1, 1, 0]);
  const c = catalogo([...ops, ...p.ops]);
  assert.deepEqual([c.get('imp1-f2')!.marca, c.get('imp1-f2')!.departamento], ['ORGANIC G', caballero], 'la marca entra y el departamento elegido no cambia');
  assert.equal(c.get('imp1-f3')!.marca, 'LEVIS');
  assert.equal(c.get('imp1-f4')!.marca, '', 'el código no coincide: no se toca');
  assert.match(leerMarcasPorArticulo([['UPC']]).errores[0]!, /No parece el archivo de marcas/);
});
