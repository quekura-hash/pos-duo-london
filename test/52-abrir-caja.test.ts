import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { it } from 'node:test';
import { appCajero, api } from './ayudas/app.ts';
import { nuevoMundo, politica, porAlmacen } from './ayudas/comun.ts';

porAlmacen('Abrir caja sin venta', (alm) => {
  it('AC1 manda el pulso ESC p al cajón, queda registrado (quién y cuándo) y cuenta en el corte; una falla de impresora no cuenta pero se registra', async (t) => {
    const ctx = nuevoMundo(alm, politica());
    t.after(ctx.limpiar);
    const caja = await appCajero(ctx, 'DUO', 1, 'Ana'); t.after(() => caja.cerrar());
    const corte = async () => (await api(caja.url, '/api/corte')).json.vivo;
    assert.equal((await corte()).aperturas_cajon_sin_venta, 0);
    const r = await api(caja.url, '/api/caja/abrir', { motivo: 'dar cambio' });
    assert.equal(r.status, 200);
    const archivos = readdirSync(caja.s.impresora.dir).filter((f) => f.endsWith('.bin'));
    assert.equal(archivos.length, 1);
    assert.deepEqual([...readFileSync(join(caja.s.impresora.dir, archivos[0]!))], [0x1b, 0x70, 0x00, 25, 250], 'solo el pulso al cajón, sin ticket');
    const op = ctx.m.caja('DUO', 1).ops().find((o) => o.tipo === 'cash.cajon_abierto')!.payload;
    assert.deepEqual([op.usuario, op.motivo, op.resultado], ['Ana', 'dar cambio', 'ok']);
    assert.equal((await corte()).aperturas_cajon_sin_venta, 1);
    // la impresora falla: se avisa, queda el intento registrado y no suma
    caja.s.impresora.falla = 'sin papel';
    const f = await api(caja.url, '/api/caja/abrir', {});
    assert.equal(f.json.error.codigo, 'CAJON_NO_ABRIO');
    const ops = ctx.m.caja('DUO', 1).ops().filter((o) => o.tipo === 'cash.cajon_abierto');
    assert.deepEqual(ops.map((o) => o.payload.resultado), ['ok', 'error']);
    assert.equal((await corte()).aperturas_cajon_sin_venta, 1);
  });
});
