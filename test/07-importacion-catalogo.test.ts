import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { importarCatalogo } from '../src/importacion.ts';
import type { Articulo } from '../src/tipos.ts';
import { aCentavos, aMXN } from '../src/util.ts';

const existente = (o: Partial<Articulo>): Articulo => ({
  item_id: 'e1', codigo: '0002026090782', item_no: '1001', marca: 'LEVIS', descripcion: 'JEANS', estilo: '726-', lote: '20260913',
  departamento: 'CABALLERO', precio: 89900, origen: 'migracion', ...o,
});

describe('[memoria — lógica pura] Importación de catálogo y mapeos', () => {
  it('M1 mapeo: UPC→Código, Size→Lote, Attribute→Estilo; sin pérdida de ceros ni conversión a fecha/talla', () => {
    const r = importarCatalogo([{ 'Item #': '1001', UPC: '0002026090782', 'Dept Name': 'CABALLERO', 'Item Name': 'LEVIS', 'Item Description': 'JEANS', Attribute: '726-', Size: '20260913', 'Regular Price': '$899.00' }], []);
    assert.deepEqual(r.errores, []);
    assert.deepEqual(r.altas[0], {
      codigo: '0002026090782', item_no: '1001', marca: 'LEVIS', descripcion: 'JEANS', estilo: '726-', lote: '20260913', departamento: 'CABALLERO', precio: 89900,
    });
    assert.equal(typeof r.altas[0]!.lote, 'string');
  });

  it('M2 mismo estilo/marca con código distinto: dos altas, sin fusión', () => {
    const r = importarCatalogo([
      { 'Item #': '1001', UPC: '0002026090782', 'Item Name': 'LEVIS', Attribute: '726-', Size: '20260913' },
      { 'Item #': '1002', UPC: '0002026090799', 'Item Name': 'LEVIS', Attribute: '726-', Size: '20261014' },
    ], []);
    assert.equal(r.altas.length, 2);
    assert.deepEqual(r.conflictos, []);
  });

  it('M3 mismo código con otro Item # → conflicto; mismo Item # con otro código → conflicto; nada se fusiona', () => {
    const r = importarCatalogo([
      { 'Item #': '9999', UPC: '0002026090782' },
      { 'Item #': '1001', UPC: '0002026090888' },
    ], [existente({})]);
    assert.deepEqual(r.conflictos.map((c) => c.tipo), ['codigo_con_otro_item_no', 'item_no_con_otro_codigo']);
    assert.equal(r.altas.length, 0);
    assert.equal(r.actualizaciones.length, 0);
  });

  it('M4 mismo código y mismo Item # actualiza datos (crear o actualizar por código) conservando el Item #', () => {
    const r = importarCatalogo([{ 'Item #': '1001', UPC: '0002026090782', 'Item Name': 'LEVIS', 'Item Description': 'JEANS', Attribute: '726-', Size: '20260913', 'Dept Name': 'CABALLERO', 'Regular Price': '950.00' }], [existente({})]);
    assert.deepEqual(r.actualizaciones, [{ codigo: '0002026090782', cambios: ['precio'] }]);
  });

  it('M5 un código que Excel entregó como número se advierte, no se "repara" con ceros inventados', () => {
    const r = importarCatalogo([{ 'Item #': '1', UPC: 2026090782 }], []);
    assert.equal(r.altas[0]!.codigo, '2026090782');
    assert.deepEqual(r.advertencias, [{ fila: 1, tipo: 'codigo_numerico_posible_truncamiento', valor: 2026090782 }]);
  });

  it('M6 filas sin código o con precio inválido son errores reportados; código repetido en el archivo es conflicto', () => {
    const r = importarCatalogo([{ 'Item #': '5' }, { UPC: '123', 'Regular Price': 'abc' }, { UPC: '777' }, { UPC: '777' }], []);
    assert.deepEqual(r.errores.map((e) => e.fila), [1, 2]);
    assert.equal(r.altas.length, 1);
    assert.equal(r.conflictos[0]!.tipo, 'codigo_repetido_en_archivo');
  });

  it('M7 importes en centavos exactos, sin coma flotante', () => {
    assert.equal(aCentavos('$1,234.5'), 123450);
    assert.equal(aCentavos(0.1 + 0.2 === 0.3 ? '0.30' : '0.30'), 30);
    assert.equal(aCentavos('19.99'), 1999);
    assert.equal(aMXN(1999), '19.99');
    assert.equal(aMXN(-5), '-0.05');
    assert.throws(() => aCentavos('1.234'));
  });
});
