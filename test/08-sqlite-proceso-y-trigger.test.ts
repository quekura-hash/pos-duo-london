import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { SqliteRepo } from '../src/repo.ts';
import type { Op } from '../src/tipos.ts';

const HIJO = join(import.meta.dirname, 'ayudas', 'hijo-crash.ts');
const CAJAS = [
  { tienda: 'DUO', caja: 1, metodos: ['efectivo', 'tarjeta'] as ('efectivo' | 'tarjeta')[] },
  { tienda: 'DUO', caja: 2, metodos: ['efectivo'] as ('efectivo' | 'tarjeta')[] },
];

function matarEnTransaccion(ruta: string, modo: string): Promise<void> {
  return new Promise((res, rej) => {
    const p = spawn(process.execPath, ['--no-warnings', HIJO, ruta, modo], { stdio: ['ignore', 'pipe', 'inherit'] });
    p.stdout.on('data', (d) => {
      if (String(d).includes('EN_TRANSACCION')) p.kill('SIGKILL');
    });
    p.on('exit', () => res());
    p.on('error', rej);
  });
}

const venta = (caja: number, pagos: object[]): Op => ({
  op_id: `sale:x${caja}${pagos.length}`, tipo: 'sale.confirmed', tienda: 'DUO', caja, origen: `caja:DUO/${caja}`,
  ocurrio_en: '2026-10-01T00:00:00Z', payload: { sale_id: 'x', tienda: 'DUO', caja, folio: 1, total: 1, pagos },
});

describe('[sqlite — proceso real] kill -9 a mitad de transacción y restricciones de base', () => {
  it('S1 matar el proceso (SIGKILL) a mitad de una venta no deja venta, folio ni cola a medias', async (t) => {
    const dir = mkdtempSync(join(tmpdir(), 'pos-crash-'));
    t.after(() => rmSync(dir, { recursive: true, force: true }));
    const ruta = join(dir, 'caja.db');
    await matarEnTransaccion(ruta, 'solo-incompleta');
    const repo = new SqliteRepo(ruta, CAJAS);
    t.after(() => repo.cerrar());
    assert.equal(repo.tieneOp('sale:b'), false);
    assert.equal(repo.kvGet('folio:ultimo'), undefined);
    assert.deepEqual(repo.pendientes('hub:DUO'), []);
  });

  it('S2 lo ya confirmado antes del kill sobrevive y lo incompleto no aparece', async (t) => {
    const dir = mkdtempSync(join(tmpdir(), 'pos-crash-'));
    t.after(() => rmSync(dir, { recursive: true, force: true }));
    const ruta = join(dir, 'caja.db');
    await matarEnTransaccion(ruta, 'commit-primero');
    const repo = new SqliteRepo(ruta, CAJAS);
    t.after(() => repo.cerrar());
    assert.equal(repo.tieneOp('sale:a'), true);
    assert.equal(repo.tieneOp('sale:b'), false);
    assert.equal(repo.kvGet('folio:ultimo'), 1, 'el contador y la venta confirmada son consistentes');
  });

  it('S3 la base misma rechaza tarjeta en una caja solo-efectivo (tercera barrera, aun sin pasar por el dominio)', (t) => {
    const dir = mkdtempSync(join(tmpdir(), 'pos-trg-'));
    t.after(() => rmSync(dir, { recursive: true, force: true }));
    const repo = new SqliteRepo(join(dir, 'c.db'), CAJAS);
    t.after(() => repo.cerrar());
    assert.throws(() => repo.appendOp(venta(2, [{ metodo: 'tarjeta', monto: 1 }])), /caja_solo_efectivo/);
    assert.throws(() => repo.appendOp(venta(2, [{ metodo: 'efectivo', monto: 1 }, { metodo: 'tarjeta', monto: 0 }])), /caja_solo_efectivo/);
    assert.equal(repo.appendOp(venta(2, [{ metodo: 'efectivo', monto: 1 }])), true);
    assert.equal(repo.appendOp(venta(1, [{ metodo: 'tarjeta', monto: 1 }])), true, 'Caja 1 sí admite tarjeta');
  });
});
