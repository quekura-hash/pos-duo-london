import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { it } from 'node:test';
import { appAdmin, appCajero, api } from './ayudas/app.ts';
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

  it('AC2 con Vendedoras-Cajeras registradas pide la clave de la propia persona: la de otra o ninguna no abren y no se registra nada', async (t) => {
    const ctx = nuevoMundo(alm, politica());
    t.after(ctx.limpiar);
    const adm = await appAdmin(ctx); t.after(() => adm.cerrar());
    const caja = await appCajero(ctx, 'DUO', 1, 'Ana'); t.after(() => caja.cerrar());
    await api(adm.url, '/api/admin/cajeros', { nombre: 'Lupe', clave: '4321' });
    await api(adm.url, '/api/admin/cajeros', { nombre: 'Rosa', clave: '8765' });
    ctx.m.pump(); ctx.m.pump(); ctx.m.pump();
    await api(caja.url, '/api/login', { usuario: 'Lupe', clave: '4321' });
    const abrir = (clave?: string) => api(caja.url, '/api/caja/abrir', clave === undefined ? {} : { clave });
    assert.equal((await abrir()).json.error.codigo, 'CLAVE_INVALIDA');
    assert.equal((await abrir('8765')).json.error.codigo, 'CLAVE_INVALIDA', 'la clave de Rosa no vale a nombre de Lupe');
    assert.equal(ctx.m.caja('DUO', 1).ops().filter((o) => o.tipo === 'cash.cajon_abierto').length, 0);
    assert.equal(readdirSync(caja.s.impresora.dir).length, 0, 'sin clave correcta el cajón no se abre');
    assert.equal((await abrir('4321')).status, 200);
    assert.equal(readdirSync(caja.s.impresora.dir).filter((f) => f.endsWith('.bin')).length, 1);
    // cinco claves equivocadas bloquean
    for (let i = 0; i < 5; i++) await abrir('0000');
    assert.equal((await abrir('4321')).json.error.codigo, 'CLAVE_BLOQUEADA');
  });
});
