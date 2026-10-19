import assert from 'node:assert/strict';
import { it } from 'node:test';
import { appAdmin, appCajero, api } from './ayudas/app.ts';
import { nuevoMundo, politica, porAlmacen } from './ayudas/comun.ts';

porAlmacen('Claves en la caja: retiro con la propia, cancelar y devolver con la de otra persona', (alm) => {
  const preparar = async (t: { after(f: () => void): void }) => {
    const ctx = nuevoMundo(alm, politica());
    t.after(ctx.limpiar);
    const adm = await appAdmin(ctx); t.after(() => adm.cerrar());
    const caja = await appCajero(ctx, 'DUO', 1, 'Ana'); t.after(() => caja.cerrar());
    return { ctx, adm, caja };
  };
  const registrar = async (ctx: any, adm: any) => {
    await api(adm.url, '/api/admin/administradores', { nombre: 'Edgardo', clave: 'clave-segura', clave_caja: '2468' });
    await api(adm.url, '/api/admin/cajeros', { nombre: 'Lupe', clave: '4321' });
    await api(adm.url, '/api/admin/cajeros', { nombre: 'Rosa', clave: '8765' });
    ctx.m.pump(); ctx.m.pump(); ctx.m.pump();
  };
  const vender = async (caja: any, n = 1) => {
    const cart = (await api(caja.url, '/api/venta/nueva', {})).json.cart;
    for (let i = 0; i < n; i++) await api(caja.url, '/api/venta/escanear', { cart, codigo: '0002026090782' });
    return (await api(caja.url, '/api/venta/cobrar-efectivo', { cart, recibido: 2000000 })).json.venta;
  };

  it('AU1 sin cajeros registrados la caja trabaja abierta: cancelar, devolver y retirar no piden clave', async (t) => {
    const { caja } = await preparar(t);
    const v = await vender(caja);
    const d = await api(caja.url, '/api/venta/devolver', { sale_id: v.sale_id, renglones: [{ linea_id: v.lineas[0].linea_id, qty: 1 }], motivo: 'talla' });
    assert.equal(d.status, 200);
    const v2 = await vender(caja);
    assert.equal((await api(caja.url, '/api/venta/cancelar', { sale_id: v2.sale_id, motivo: 'error' })).status, 200);
    const a = await api(caja.url, '/api/venta/autorizadores');
    assert.deepEqual([a.json.pide_clave, a.json.autorizadores], [false, []]);
  });

  it('AU2 el retiro pide la clave del propio cajero (la de otro no vale) y el bloqueo por intentos aplica', async (t) => {
    const { ctx, adm, caja } = await preparar(t);
    await registrar(ctx, adm);
    await api(caja.url, '/api/login', { usuario: 'Lupe', clave: '4321' });
    await vender(caja, 12); // $10,788 de venta
    const retiro = (clave?: string) => api(caja.url, '/api/retiro', { retiro_id: `r-${Math.random()}`, mxn: { '100000': 8 }, ...(clave === undefined ? {} : { clave }) });
    assert.equal((await retiro()).json.error.codigo, 'CLAVE_INVALIDA');
    assert.equal((await retiro('8765')).json.error.codigo, 'CLAVE_INVALIDA', 'la clave de Rosa no vale a nombre de Lupe');
    assert.equal((await api(caja.url, '/api/retiro')).json.retiro.retiros.length, 0, 'sin clave correcta no se registra nada');
    assert.equal((await api(caja.url, '/api/retiro')).json.retiro.pide_clave, true);
    const ok = await retiro('4321');
    assert.deepEqual([ok.status, ok.json.retiro.usuario], [200, 'Lupe']);
    // 5 claves equivocadas seguidas bloquean aun con la correcta
    for (let i = 0; i < 5; i++) assert.equal((await retiro('0000')).json.error.codigo, 'CLAVE_INVALIDA');
    assert.equal((await retiro('4321')).json.error.codigo, 'CLAVE_BLOQUEADA');
  });

  it('AU3 cancelar una venta cobrada y devolver piden la clave de OTRA persona (otro cajero o un supervisor); nadie se autoriza a sí mismo', async (t) => {
    const { ctx, adm, caja } = await preparar(t);
    await registrar(ctx, adm);
    await api(caja.url, '/api/login', { usuario: 'Lupe', clave: '4321' });
    const aut = (await api(caja.url, '/api/venta/autorizadores')).json;
    assert.deepEqual([aut.pide_clave, aut.autorizadores.map((x: any) => [x.nombre, x.tipo]).sort()], [true, [['Edgardo', 'supervisor'], ['Rosa', 'cajero']]], 'sin Lupe, que es quien opera');
    const v = await vender(caja);
    const cancelar = (autoriza?: unknown) => api(caja.url, '/api/venta/cancelar', { sale_id: v.sale_id, motivo: 'error de captura', ...(autoriza ? { autoriza } : {}) });
    assert.equal((await cancelar()).json.error.codigo, 'AUTORIZACION_REQUERIDA');
    assert.equal((await cancelar({ nombre: 'Lupe', clave: '4321' })).json.error.codigo, 'AUTORIZADOR_INVALIDO', 'no se autoriza a sí mismo');
    assert.equal((await cancelar({ nombre: ' lupe ', clave: '4321' })).json.error.codigo, 'AUTORIZADOR_INVALIDO');
    assert.equal((await cancelar({ nombre: 'Rosa', clave: '0000' })).json.error.codigo, 'CLAVE_INVALIDA');
    assert.equal((await cancelar({ nombre: 'Nadie', clave: '1234' })).json.error.codigo, 'AUTORIZADOR_INVALIDO');
    assert.equal((await cancelar({ nombre: 'Edgardo', clave: '4321' })).json.error.codigo, 'CLAVE_INVALIDA', 'la clave de cajero no vale como la del supervisor');
    assert.equal(ctx.m.caja('DUO', 1).opsDe('sale.cancelled').length, 0, 'ningún rechazo cancela nada');
    assert.equal((await cancelar({ nombre: 'Rosa', clave: '8765' })).status, 200);
    const c = ctx.m.caja('DUO', 1).opsDe('sale.cancelled')[0]!.payload;
    assert.deepEqual([c.cancelo, c.autorizado_por], ['Lupe', 'Rosa']);
    // devolución autorizada por el supervisor
    const v2 = await vender(caja, 2);
    const dev = (autoriza?: unknown) => api(caja.url, '/api/venta/devolver', { sale_id: v2.sale_id, renglones: [{ linea_id: v2.lineas[0].linea_id, qty: 1 }], motivo: 'talla', ...(autoriza ? { autoriza } : {}) });
    assert.equal((await dev()).json.error.codigo, 'AUTORIZACION_REQUERIDA');
    assert.equal((await dev({ nombre: 'Lupe', clave: '4321' })).json.error.codigo, 'AUTORIZADOR_INVALIDO');
    const ok = await dev({ nombre: 'Edgardo', clave: '2468' });
    assert.equal(ok.status, 200);
    assert.equal(ctx.m.caja('DUO', 1).opsDe('return.registered')[0]!.payload.autorizado_por, 'Edgardo');
    // bloqueo del autorizador tras 5 claves equivocadas
    for (let i = 0; i < 5; i++) await dev({ nombre: 'Rosa', clave: '1111' });
    assert.equal((await dev({ nombre: 'Rosa', clave: '8765' })).json.error.codigo, 'CLAVE_BLOQUEADA');
  });
});
