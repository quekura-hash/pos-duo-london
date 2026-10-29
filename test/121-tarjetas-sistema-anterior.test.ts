import assert from 'node:assert/strict';
import { it } from 'node:test';
import { tarjetasRegalo } from '../src/proyecciones.ts';
import { crearOp } from '../src/util.ts';

it('TH1 una tarjeta del sistema anterior se da de alta con su fecha original y una vigencia explícita; sin vigencia explícita sigue siendo de 12 meses', () => {
  const alta = (codigo: string, extra: object) => crearOp('giftcard.emitida', 'DUO', 1, 'admin', '2026-07-23T19:00:00.000Z', { codigo, monto: 70000, tienda: 'DUO', caja: 1, cajero: 'Elena Lizarraga', medio: 'efectivo', ...extra }, `gc:test:${codigo}`);
  const t = tarjetasRegalo([alta('102251031', { vigente_hasta: '2027-04-29T06:59:00.000Z' }), alta('TR-12', {})]);
  const a = t.get('102251031')!, b = t.get('TR-12')!;
  assert.deepEqual([a.saldo, a.emitido, a.vigente_hasta, a.ocurrio_en], [70000, 70000, '2027-04-29T06:59:00.000Z', '2026-07-23T19:00:00.000Z']);
  assert.equal(b.vigente_hasta, '2027-07-23T19:00:00.000Z');
});

import { ServicioAdmin } from '../src/app/servicio.ts';
import { construirTicket, renderTicketTexto } from '../src/ticket.ts';
import { mesesVigenciaTarjetas } from '../src/proyecciones.ts';
import { nuevoMundo, politica, porAlmacen } from './ayudas/comun.ts';

porAlmacen('Vigencia de las tarjetas de regalo configurable desde Administración', (alm) => {
  const admin = (ctx: ReturnType<typeof nuevoMundo>) => new ServicioAdmin({ central: ctx.m.central as never, actor: { rol: 'admin', usuario: 'Edgardo' }, fuente: () => ctx.m.central.repo.ops(), cajas: [{ tienda: 'DUO', caja: 1 }], reloj: ctx.m.reloj });
  it('TH2 por omisión 12 meses; al fijar otra vigencia aplica a las tarjetas y recargas nuevas, el ticket la imprime y las ya emitidas conservan su fecha', (t) => {
    const ctx = nuevoMundo(alm, politica());
    t.after(ctx.limpiar);
    const a = admin(ctx);
    const caja = ctx.m.caja('DUO', 1);
    assert.equal(a.vigenciaTarjetas().meses_vigencia, 12);
    const vieja = caja.altaTarjetaRegalo({ codigo: 'TR-VIEJA', monto: 50000 });
    assert.match(renderTicketTexto(construirTicket(vieja.venta)), /Vigencia: 12 meses/);
    assert.deepEqual(a.fijarVigenciaTarjetas({ meses_vigencia: 6 }), { meses_vigencia: 6 });
    ctx.m.pump(); ctx.m.pump();
    const nueva = caja.altaTarjetaRegalo({ codigo: 'TR-NUEVA', monto: 30000 });
    assert.match(renderTicketTexto(construirTicket(nueva.venta)), /Vigencia: 6 meses/);
    ctx.m.pump(); ctx.m.pump();
    const lista = a.tarjetasRegalo();
    const ven = (c: string) => lista.find((x) => x.codigo === c)!.vigente_hasta.slice(0, 7);
    assert.equal(ven('TR-VIEJA'), '2027-10', 'la que ya existía conserva sus 12 meses');
    assert.equal(ven('TR-NUEVA'), '2027-04', 'la nueva vence a los 6 meses');
    caja.recargarTarjetaRegalo({ codigo: 'TR-VIEJA', monto: 10000 });
    ctx.m.pump(); ctx.m.pump();
    assert.equal(a.tarjetasRegalo().find((x) => x.codigo === 'TR-VIEJA')!.vigente_hasta.slice(0, 7), '2027-04', 'la recarga reinicia con la vigencia vigente');
    assert.equal(mesesVigenciaTarjetas(ctx.m.central.repo.ops()), 6);
    for (const mal of [0, 61, 1.5, Number.NaN]) assert.throws(() => a.fijarVigenciaTarjetas({ meses_vigencia: mal }), /entero de meses/);
  });
});
