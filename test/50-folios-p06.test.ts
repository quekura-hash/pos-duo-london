import assert from 'node:assert/strict';
import { it } from 'node:test';
import { appAdmin, appCajero, api } from './ayudas/app.ts';
import { nuevoMundo, politica, porAlmacen } from './ayudas/comun.ts';

porAlmacen('P-06: pantalla de folios (último folio bueno, siguiente sugerido y confirmación)', (alm) => {
  const preparar = async (t: { after(f: () => void): void }, pol = politica(), conClaves = true) => {
    const ctx = nuevoMundo(alm, pol);
    t.after(ctx.limpiar);
    const adm = await appAdmin(ctx); t.after(() => adm.cerrar());
    const caja = await appCajero(ctx, 'DUO', 1, 'Ana'); t.after(() => caja.cerrar());
    if (conClaves) {
      await api(adm.url, '/api/admin/administradores', { nombre: 'Edgardo', clave: 'clave-segura', clave_caja: '2468' });
      await api(adm.url, '/api/admin/cajeros', { nombre: 'Lupe', clave: '4321' });
      ctx.m.pump(); ctx.m.pump(); ctx.m.pump();
      await api(caja.url, '/api/login', { usuario: 'Lupe', clave: '4321' });
    }
    return { ctx, adm, caja };
  };
  const vender = async (caja: any) => {
    const cart = (await api(caja.url, '/api/venta/nueva', {})).json.cart;
    await api(caja.url, '/api/venta/escanear', { cart, codigo: '7501234567890' });
    return (await api(caja.url, '/api/venta/cobrar-efectivo', { cart, recibido: 100000 })).json;
  };
  const evid = { tipo: 'ticket_impreso', referencia: 'último ticket impreso D1-000005' };

  it('FO1 con la serie en orden no hay nada que resolver; un ticket con folio mayor la bloquea y la pantalla informa último folio bueno y siguiente sugerido', async (t) => {
    const { ctx, caja } = await preparar(t);
    await vender(caja); await vender(caja);
    ctx.m.pump(); ctx.m.pump();
    const ok = (await api(caja.url, '/api/folios')).json;
    assert.deepEqual([ok.estado, ok.ultimo, ok.sugerido], ['activa', 2, 3]);
    ctx.m.caja('DUO', 1).registrarTicketEscaneado({ tienda: 'DUO', caja: 1, folio: 5 });
    const b = (await api(caja.url, '/api/folios')).json;
    assert.equal(b.estado, 'recuperacion');
    assert.equal(b.motivo, 'ticket_con_folio_mayor_al_contador');
    assert.deepEqual([b.ultimo, b.visto_en_ticket, b.sugerido], [2, 5, 6], 'el ticket escaneado prueba que existen folios hasta el 5');
    assert.equal((await api(caja.url, '/api/venta/nueva', {})).status, 200);
    const cart = (await api(caja.url, '/api/venta/nueva', {})).json.cart;
    await api(caja.url, '/api/venta/escanear', { cart, codigo: '7501234567890' });
    const v = await api(caja.url, '/api/venta/cobrar-efectivo', { cart, recibido: 100000 });
    assert.equal(v.json.error.codigo, 'FOLIO_BLOQUEADO', 'no se vende con la serie bloqueada');
  });

  it('FO2 continuar exige evidencia, un folio mayor a todo lo conocido y la clave de un supervisor; queda documentado quién y los huecos', async (t) => {
    const { ctx, caja } = await preparar(t);
    await vender(caja); await vender(caja);
    ctx.m.pump(); ctx.m.pump();
    ctx.m.caja('DUO', 1).registrarTicketEscaneado({ tienda: 'DUO', caja: 1, folio: 5 });
    const conf = (d: object) => api(caja.url, '/api/folios/confirmar', d);
    assert.equal((await conf({ siguiente: 6, evidencia: { tipo: 'ticket_impreso', referencia: '' }, autoriza: { nombre: 'Edgardo', clave: '2468' } })).json.error.codigo, 'EVIDENCIA_REQUERIDA');
    assert.equal((await conf({ siguiente: 5, evidencia: evid, autoriza: { nombre: 'Edgardo', clave: '2468' } })).json.error.codigo, 'FOLIO_REUTILIZABLE', 'no puede reutilizar el 5');
    assert.equal((await conf({ siguiente: 6, evidencia: evid })).json.error.codigo, 'AUTORIZACION_REQUERIDA');
    assert.equal((await conf({ siguiente: 6, evidencia: evid, autoriza: { nombre: 'Edgardo', clave: '0000' } })).json.error.codigo, 'CLAVE_INVALIDA');
    assert.equal((await conf({ siguiente: 6, evidencia: evid, autoriza: { nombre: 'Lupe', clave: '4321' } })).json.error.codigo, 'AUTORIZADOR_INVALIDO', 'una Vendedora-Cajera no confirma folios');
    const r = await conf({ siguiente: 6, evidencia: evid, autoriza: { nombre: 'Edgardo', clave: '2468' } });
    assert.equal(r.status, 200);
    assert.deepEqual([r.json.folios.estado, r.json.folios.ultimo, r.json.folios.sugerido], ['activa', 5, 6]);
    assert.deepEqual(r.json.folios.huecos.map((h: any) => [h.desde, h.hasta, h.motivo]), [[3, 5, 'atestacion_manual']], 'los folios 3 a 5 quedan documentados como sin comprobar');
    const aut = ctx.m.caja('DUO', 1).ops().find((o) => o.tipo === 'folio.atestacion_manual')!.payload;
    assert.deepEqual([aut.autorizado_por, aut.usuario, aut.evidencia.referencia, aut.verificable], ['Edgardo', 'Lupe', evid.referencia, false]);
    assert.equal((await vender(caja)).venta.folio, 6, 'la siguiente venta usa el folio confirmado');
  });

  it('FO3 sin acceso al hub no se puede contrastar: hay que confirmar expresamente que se continúa sin contraste', async (t) => {
    const { ctx, caja } = await preparar(t, politica(), false);
    await vender(caja);
    ctx.m.caja('DUO', 1).registrarTicketEscaneado({ tienda: 'DUO', caja: 1, folio: 4 });
    ctx.m.caerHub('DUO');
    const s = (await api(caja.url, '/api/folios')).json;
    assert.equal(s.hub.disponible, false);
    assert.equal(s.pide_clave, false);
    const conf = (d: object) => api(caja.url, '/api/folios/confirmar', { siguiente: 5, evidencia: evid, ...d });
    assert.equal((await conf({})).json.error.codigo, 'EVIDENCIA_INSUFICIENTE');
    const r = await conf({ sin_anclas: true });
    assert.equal(r.status, 200);
    assert.equal(r.json.folios.estado, 'activa');
  });

  it('FO4 con P-06 aceptada y el hub con su techo, la caja se recupera sola y documenta el hueco; sin P-06 no hay recuperación automática', async (t) => {
    const sin = await preparar(t, politica(), false);
    sin.ctx.m.caja('DUO', 1).registrarTicketEscaneado({ tienda: 'DUO', caja: 1, folio: 9 });
    const s0 = (await api(sin.caja.url, '/api/folios')).json;
    assert.equal(s0.recuperacion_automatica, false);
    assert.equal((await api(sin.caja.url, '/api/folios/recuperar', {})).json.error.codigo, 'FOLIO_BLOQUEADO');
    const con = await preparar(t, politica({ P06_huecos_de_folio: 'aceptados' }), false);
    con.ctx.m.caja('DUO', 1).iniciarArrendamiento();
    await vender(con.caja);
    con.ctx.m.caja('DUO', 1).registrarTicketEscaneado({ tienda: 'DUO', caja: 1, folio: 9 });
    const s1 = (await api(con.caja.url, '/api/folios')).json;
    assert.equal(s1.estado, 'recuperacion');
    assert.equal(s1.recuperacion_automatica, true, 'el hub conoce el techo concedido');
    const r = await api(con.caja.url, '/api/folios/recuperar', {});
    assert.equal(r.status, 200);
    assert.equal(r.json.folios.estado, 'activa');
    assert.ok(r.json.folios.huecos.length >= 1 || r.json.resultado.modo === 'automatica');
  });
});
