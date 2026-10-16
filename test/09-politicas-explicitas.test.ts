import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { crearPoliticasEnsayo, exigirPoliticasAprobadas } from '../src/politicas.ts';
import { BASE_ENSAYO, politica } from './ayudas/comun.ts';

describe('[memoria — lógica pura] Políticas pendientes como configuración explícita', () => {
  it('PO1 no existe valor por omisión: faltar una política es error', () => {
    for (const k of ['P01_hub_no_disponible', 'P02_existencia_insuficiente', 'P03_devolucion_venta_no_local', 'P06_huecos_de_folio', 'P07_item_no', 'P12_tarjeta_con_pendiente'] as const) {
      const { [k]: _omitida, ...resto } = BASE_ENSAYO;
      assert.throws(() => crearPoliticasEnsayo(resto as any), { codigo: 'POLITICA_FALTANTE' }, k);
    }
  });
  it('PO2 valores inválidos se rechazan', () => {
    assert.throws(() => crearPoliticasEnsayo({ ...BASE_ENSAYO, P07_item_no: 'd_inventada' as any }), { codigo: 'POLITICA_INVALIDA' });
    assert.throws(() => crearPoliticasEnsayo({ ...BASE_ENSAYO, K_folios: 0 }), { codigo: 'POLITICA_INVALIDA' });
  });
  it('PO3 toda política creada queda marcada como ensayo y NO puede usarse como aprobada', () => {
    const p = politica();
    assert.equal(p.estado, 'ENSAYO_NO_APROBADO');
    assert.throws(() => exigirPoliticasAprobadas(p), { codigo: 'POLITICAS_NO_APROBADAS' });
  });
});
