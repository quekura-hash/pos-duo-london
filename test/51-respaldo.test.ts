import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { cifrarRespaldo, descifrarRespaldo, ErrorRespaldo, nombreRespaldo, sobrantes, type PaqueteRespaldo } from '../src/respaldo.ts';

describe('Respaldo cifrado', () => {
  const xlsx = Uint8Array.from({ length: 5000 }, (_, i) => (i * 7) % 256);
  const paquete: PaqueteRespaldo = { version: 1, creado: '2026-10-19T21:05:00Z', inventario: { nombre: 'inv.xlsx', bytes: xlsx, hoja: 0, modo: 'limbo' }, estado: { conInventario: true, repos: { 'DUO/1': { desde: 0, ops: [{ tipo: 'sale.confirmed', payload: { total: 89900, nota: 'Pérez ñandú' } }], outbox: [], kv: [] } } } };

  it('RB1 se cifra y se descifra sin perder nada (incluido el archivo .xlsx en bytes y los acentos)', async () => {
    const c = await cifrarRespaldo(paquete, 'clave-del-respaldo');
    assert.ok(c.length > 100);
    const p = await descifrarRespaldo(c, 'clave-del-respaldo');
    assert.deepEqual(p.estado, paquete.estado);
    const inv = p.inventario as { bytes: Uint8Array; nombre: string };
    assert.equal(inv.nombre, 'inv.xlsx');
    assert.ok(inv.bytes instanceof Uint8Array);
    assert.deepEqual([...inv.bytes], [...xlsx]);
  });

  it('RB2 el archivo no deja ver nada legible; cada respaldo usa sal e IV distintos; la clave equivocada o un archivo dañado se rechazan', async () => {
    const a = await cifrarRespaldo(paquete, 'clave-del-respaldo');
    const b = await cifrarRespaldo(paquete, 'clave-del-respaldo');
    assert.notDeepEqual([...a], [...b]);
    const texto = new TextDecoder('latin1').decode(a);
    assert.doesNotMatch(texto, /sale\.confirmed|Pérez|inv\.xlsx|89900/);
    await assert.rejects(descifrarRespaldo(a, 'otra-clave-distinta'), (e) => e instanceof ErrorRespaldo && e.codigo === 'CLAVE_INCORRECTA');
    const dañado = Uint8Array.from(a); dañado[dañado.length - 5]! ^= 0xff;
    await assert.rejects(descifrarRespaldo(dañado, 'clave-del-respaldo'), (e) => e instanceof ErrorRespaldo && e.codigo === 'CLAVE_INCORRECTA');
    await assert.rejects(descifrarRespaldo(new TextEncoder().encode('esto no es un respaldo de la caja, nada que ver'), 'clave-del-respaldo'), (e) => e instanceof ErrorRespaldo && e.codigo === 'FORMATO_INVALIDO');
    await assert.rejects(cifrarRespaldo(paquete, 'corta'), (e) => e instanceof ErrorRespaldo && e.codigo === 'CLAVE_CORTA');
  });

  it('RB3 el nombre lleva fecha y hora locales y la rotación conserva solo los más recientes', () => {
    assert.equal(nombreRespaldo(new Date(2026, 9, 9, 8, 5)), 'respaldo-pos-2026-10-09-0805.posbak');
    const nombres = ['respaldo-pos-2026-10-01-0900.posbak', 'respaldo-pos-2026-10-03-0900.posbak', 'respaldo-pos-2026-10-02-0900.posbak', 'foto.png', 'respaldo-pos-2026-10-04-0900.posbak'];
    assert.deepEqual(sobrantes(nombres, 2), ['respaldo-pos-2026-10-01-0900.posbak', 'respaldo-pos-2026-10-02-0900.posbak']);
    assert.deepEqual(sobrantes(nombres, 30), []);
  });
});
