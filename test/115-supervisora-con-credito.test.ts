import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { api, appAdmin, appCajero } from './ayudas/app.ts';
import { ALMACENES, nuevoMundo, politica } from './ayudas/comun.ts';

const sqlite = ALMACENES.find((a) => a.nombre === 'sqlite')!;

describe('[sqlite] Una supervisora también es empleada con crédito', () => {
  it('SC1 Administración la lista en Empleadas, le fija el límite y registra su abono; la caja le vende a crédito con su clave', async (t) => {
    const ctx = nuevoMundo(sqlite, politica());
    const adm = await appAdmin(ctx);
    const caja = await appCajero(ctx, 'DUO', 1, 'Lupe');
    t.after(async () => { await adm.cerrar(); await caja.cerrar(); ctx.limpiar(); });
    assert.equal((await api(adm.url, '/api/admin/cajeros', { nombre: 'Lupe', clave: '4321' })).status, 200);
    assert.equal((await api(adm.url, '/api/admin/supervisores', { nombre: 'Evelyn', clave: '1357' })).status, 200);
    ctx.m.pump(); ctx.m.pump(); ctx.m.pump();
    const cuentas = async () => (await api(adm.url, '/api/admin/empleadas')).json.empleadas as { id: string; nombre: string; limite: number; disponible: number }[];
    const eve = (await cuentas()).find((e) => e.nombre === 'Evelyn');
    assert.ok(eve, 'la supervisora aparece en Empleadas');
    assert.equal((await api(adm.url, '/api/admin/empleadas/limite', { empleada_id: eve.id, limite: 100000, motivo: 'crédito de supervisora' })).status, 200);
    assert.equal((await cuentas()).find((e) => e.nombre === 'Evelyn')!.limite, 100000);
    assert.equal((await api(adm.url, '/api/admin/empleadas/movimiento', { empleada_id: eve.id, tipo: 'ajuste_cargo', monto: 5000, motivo: 'ajuste', ref: 'r-1' })).status, 200);
    assert.equal((await api(adm.url, '/api/admin/empleadas/limite', { empleada_id: 'no-existe', limite: 10, motivo: 'prueba' })).status >= 400, true);
    ctx.m.pump(); ctx.m.pump(); ctx.m.pump();
    // la caja la lista y le vende a crédito con la clave de ella
    assert.equal((await api(caja.url, '/api/login', { usuario: 'Lupe', clave: '4321' })).status, 200);
    assert.ok((await api(caja.url, '/api/empleadas')).json.empleadas.some((e: { id: string }) => e.id === eve.id));
    const c = (await api(caja.url, '/api/venta/nueva', {})).json.cart;
    await api(caja.url, '/api/venta/escanear', { cart: c, codigo: '7501234567890' }); // mascada $120
    assert.equal((await api(caja.url, '/api/venta/empleada', { cart: c, empleada_id: eve.id, clave: '1357' })).status, 200);
    const cr = await api(caja.url, '/api/venta/cobrar-credito-empleada', { cart: c }); assert.equal(cr.status, 200, JSON.stringify(cr.json));
    ctx.m.pump(); ctx.m.pump(); ctx.m.pump();
    const e2 = (await cuentas()).find((e) => e.nombre === 'Evelyn')!;
    assert.ok(e2.disponible < 100000 - 5000, `el crédito se descuenta de su disponible: ${e2.disponible}`);
  });
});
