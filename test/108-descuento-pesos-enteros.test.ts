import assert from 'node:assert/strict';
import { it } from 'node:test';
import { aPesosEnteros, calcularDescuentos, repartirPesos } from '../src/promociones.ts';

it('PE1 no se manejan centavos: el porcentaje se redondea al peso entero más cercano', () => {
  assert.equal(aPesosEnteros(8990), 9000);   // 10 % de $899 = $89.90 → $90
  assert.equal(aPesosEnteros(13485), 13500); // 15 % de $899 = $134.85 → $135
  assert.equal(aPesosEnteros(13449), 13400);
  assert.equal(aPesosEnteros(13450), 13500); // la mitad sube
  // reparto en pesos enteros: la suma es exacta y cada parte es múltiplo de $1
  const partes = repartirPesos(20000, [89900, 12000, 5000]);
  assert.equal(partes.reduce((a, b) => a + b, 0), 20000);
  assert.ok(partes.every((p) => p % 100 === 0));
});

it('PE2 cupón de porcentaje y descuento de empleada también salen en pesos enteros', () => {
  const base = { id: 'k', tipo: 'cupon' as const, nombre: 'Verano', codigo: 'V', pct: 15, activa: true, inicio: null, fin: null, minimo: 0, usos_max: null };
  const lineas = [{ linea_id: 'a', item_id: 'X', codigo: 'x', qty: 1, precio_unit: 89900, descuento: 0, importe: 89900 }] as any;
  const r = calcularDescuentos(lineas, [base as any], 'V', '2026-10-01');
  assert.equal(r.cupon!.monto % 100, 0);
  assert.equal(r.cupon!.monto, 13500); // 134.85 → 135
  const e = calcularDescuentos(lineas, [], null, '2026-10-01', () => 0, '', { pct: 15, pct_uniforme: 30 });
  assert.equal(e.lineas[0]!.importe, 89900 - 13500);
});
