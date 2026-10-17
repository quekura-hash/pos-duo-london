import assert from 'node:assert/strict';
import { it } from 'node:test';
import { conciliarLote, detectar } from '../src/incidencias.ts';
import { intentos, ventas } from '../src/proyecciones.ts';
import { nuevoMundo, politica, porAlmacen, vender, type Ctx } from './ayudas/comun.ts';

function carritoCon(ctx: Ctx, qty = 1, itemIdx = 0) {
  const c = ctx.m.caja('DUO', 1);
  const cart = c.abrirCarrito();
  const l = c.agregarLinea(cart, { item_id: ctx.items[itemIdx]!.item_id, qty });
  return { cart, total: l.importe };
}

porAlmacen('Cobro con tarjeta pendiente de conciliar', (alm) => {
  it('T1 el intento pendiente se conserva y no se vuelve a cobrar; el carrito queda protegido', (t) => {
    const ctx = nuevoMundo(alm, politica());
    t.after(ctx.limpiar);
    const c = ctx.m.caja('DUO', 1);
    const { cart, total } = carritoCon(ctx);
    const a = c.iniciarCobroTarjeta(cart);
    assert.equal(a.reutilizado, false);
    // doble clic / reintento: NO se crea un segundo intento
    const b = c.iniciarCobroTarjeta(cart);
    assert.equal(b.reutilizado, true);
    assert.equal(b.intento.intent_id, a.intento.intent_id);
    assert.equal(c.ops().filter((o) => o.tipo === 'card.intent').length, 1);
    // mientras esté pendiente, ese carrito no se completa por ningún medio ni se modifica
    assert.throws(() => c.cobrar(cart, [{ metodo: 'efectivo', monto: total }]), { codigo: 'COBRO_PENDIENTE' });
    assert.throws(() => c.agregarLinea(cart, { item_id: ctx.items[2]!.item_id, qty: 1 }), { codigo: 'COBRO_PENDIENTE' });
    assert.equal(c.pendientesDeConciliar().length, 1);
  });

  it('T2 un pendiente NO bloquea las operaciones independientes de la caja', (t) => {
    const ctx = nuevoMundo(alm, politica({ P12_tarjeta_con_pendiente: 'bloquear_solo_tarjeta' }));
    t.after(ctx.limpiar);
    const { m, items } = ctx;
    const c = m.caja('DUO', 1);
    const v0 = vender(m, 'DUO', 1, items[2]!.item_id, 2).venta; // venta previa (folio 1) para devolver después
    const { cart } = carritoCon(ctx);
    c.iniciarCobroTarjeta(cart);
    // venta en efectivo de otro carrito: sigue funcionando y consume el siguiente folio
    assert.equal(vender(m, 'DUO', 1, items[2]!.item_id, 1).venta.folio, 2);
    // devolución y corte siguen disponibles
    assert.doesNotThrow(() => c.devolver({ sale_id: v0.sale_id, renglones: [{ linea_id: v0.lineas[0]!.linea_id, qty: 1 }], motivo: 'prueba' }));
    assert.doesNotThrow(() => c.generarCorte('2026-10-01'));
    // la otra caja ni se entera
    assert.equal(vender(m, 'DUO', 2, items[2]!.item_id, 1).venta.folio, 1);
    // P-12 en ensayo "bloquear_solo_tarjeta": solo un NUEVO cobro con tarjeta se frena
    const otro = carritoCon(ctx, 1, 2);
    assert.throws(() => c.iniciarCobroTarjeta(otro.cart), { codigo: 'TARJETA_BLOQUEADA' });
    assert.equal(c.cobrar(otro.cart, [{ metodo: 'efectivo', monto: otro.total }]).folio, 4, 'ese mismo cliente puede pagar en efectivo (el folio 3 lo usó la devolución: P-08)');
  });

  it('T2b P-12=permitir_con_aviso: otro cobro con tarjeta es posible y avisa del pendiente', (t) => {
    const ctx = nuevoMundo(alm, politica({ P12_tarjeta_con_pendiente: 'permitir_con_aviso' }));
    t.after(ctx.limpiar);
    const c = ctx.m.caja('DUO', 1);
    c.iniciarCobroTarjeta(carritoCon(ctx).cart);
    const r = c.iniciarCobroTarjeta(carritoCon(ctx, 1, 2).cart);
    assert.deepEqual(r.avisos, ['hay_otros_cobros_pendientes']);
    assert.equal(c.pendientesDeConciliar().length, 2);
  });

  it('T3 resolver como aprobado completa la venta una sola vez (idempotente) con un solo folio', (t) => {
    const ctx = nuevoMundo(alm, politica());
    t.after(ctx.limpiar);
    const c = ctx.m.caja('DUO', 1);
    const { cart, total } = carritoCon(ctx);
    const { intento } = c.iniciarCobroTarjeta(cart);
    const aprob = { resultado: 'aprobado' as const, autorizacion: 'AUT-001', marca: 'VISA', ultimos4: '0000' };
    const v1 = c.resolverIntento(intento.intent_id, aprob)!;
    const v2 = c.resolverIntento(intento.intent_id, aprob)!;
    assert.equal(v1.folio, 1);
    assert.equal(v2.folio, 1);
    assert.deepEqual(v1.pagos, [{ metodo: 'tarjeta', monto: total, autorizacion: 'AUT-001', marca: 'VISA', ultimos4: '0000' }]);
    assert.equal(c.ops().filter((o) => o.tipo === 'sale.confirmed').length, 1);
    assert.equal(c.estadoFolios().ultimo, 1);
    assert.equal(c.pendientesDeConciliar().length, 0);
    assert.throws(() => c.iniciarCobroTarjeta(cart), { codigo: 'VENTA_YA_CONFIRMADA' }, 'no se puede cobrar de nuevo');
  });

  it('T4 no cobrado: el intento se cierra y el carrito puede pagarse de otra forma', (t) => {
    const ctx = nuevoMundo(alm, politica());
    t.after(ctx.limpiar);
    const c = ctx.m.caja('DUO', 1);
    const { cart, total } = carritoCon(ctx);
    const { intento } = c.iniciarCobroTarjeta(cart);
    c.resolverIntento(intento.intent_id, { resultado: 'no_cobrado' });
    assert.equal(c.pendientesDeConciliar().length, 0);
    assert.throws(() => c.resolverIntento(intento.intent_id, { resultado: 'aprobado', autorizacion: 'X' }), { codigo: 'INTENTO_CERRADO' });
    assert.equal(c.cobrar(cart, [{ metodo: 'efectivo', monto: total }]).folio, 1);
  });

  it('T5 estado desconocido: sigue pendiente, abre incidencia, y puede resolverse después', (t) => {
    const ctx = nuevoMundo(alm, politica());
    t.after(ctx.limpiar);
    const c = ctx.m.caja('DUO', 1);
    const { cart, total } = carritoCon(ctx);
    const { intento } = c.iniciarCobroTarjeta(cart);
    c.resolverIntento(intento.intent_id, { resultado: 'desconocido' });
    assert.equal(c.pendientesDeConciliar().length, 1);
    assert.throws(() => c.cobrar(cart, [{ metodo: 'efectivo', monto: total }]), { codigo: 'COBRO_PENDIENTE' });
    ctx.m.pump();
    assert.ok(detectar(ctx.m.central.repo.ops()).some((i) => i.tipo === 'cobro_tarjeta_pendiente' && i.estado === 'desconocido'));
    assert.equal(c.resolverIntento(intento.intent_id, { resultado: 'aprobado', autorizacion: 'AUT-9' })!.folio, 1);
  });

  it('T6 mixto: tarjeta aprobada + efectivo suman el total en una sola venta', (t) => {
    const ctx = nuevoMundo(alm, politica());
    t.after(ctx.limpiar);
    const c = ctx.m.caja('DUO', 1);
    const { cart, total } = carritoCon(ctx); // 899.00
    const { intento } = c.iniciarCobroTarjeta(cart, 60000);
    const v = c.resolverIntento(intento.intent_id, { resultado: 'aprobado', autorizacion: 'AUT-2', efectivo_adicional: total - 60000 })!;
    assert.deepEqual(v.pagos.map((p) => [p.metodo, p.monto]), [['tarjeta', 60000], ['efectivo', total - 60000]]);
    assert.throws(() => c.resolverIntento(c.iniciarCobroTarjeta(carritoCon(ctx).cart, 1000).intento.intent_id, { resultado: 'aprobado', autorizacion: 'A', efectivo_adicional: 5 }), { codigo: 'PAGO_INVALIDO' });
  });

  it('T7 con el hub caído y P-01=bloquear_ventas_nuevas, un cobro ya aprobado en la terminal sí se completa', (t) => {
    const ctx = nuevoMundo(alm, politica({ P01_hub_no_disponible: 'bloquear_ventas_nuevas' }));
    t.after(ctx.limpiar);
    const c = ctx.m.caja('DUO', 1);
    const { cart } = carritoCon(ctx);
    const { intento } = c.iniciarCobroTarjeta(cart);
    ctx.m.caerHub('DUO');
    const otro = carritoCon(ctx, 1, 2);
    assert.throws(() => c.cobrar(otro.cart, [{ metodo: 'efectivo', monto: otro.total }]), { codigo: 'VENTA_BLOQUEADA' }, 'una venta NUEVA sí se bloquea');
    assert.equal(c.resolverIntento(intento.intent_id, { resultado: 'aprobado', autorizacion: 'AUT-3' })!.folio, 1, 'el dinero ya se cobró: no se bloquea');
  });

  it('T8 pérdida de disco con cobro aprobado: el lote de la terminal lo delata aunque no exista el intento local', (t) => {
    const ctx = nuevoMundo(alm, politica());
    t.after(ctx.limpiar);
    const { m, items } = ctx;
    const c = m.caja('DUO', 1);
    // venta con tarjeta ya sincronizada
    const a = carritoCon(ctx, 1, 2);
    c.resolverIntento(c.iniciarCobroTarjeta(a.cart).intento.intent_id, { resultado: 'aprobado', autorizacion: 'AUT-OK' });
    m.pump();
    // segundo cobro: aprobado en la terminal, el disco se pierde antes de registrar la venta (el intento nunca llegó al hub)
    m.cortarLan('DUO', 1);
    const b = carritoCon(ctx, 1, 3);
    c.iniciarCobroTarjeta(b.cart);
    m.perderDiscoCaja('DUO', 1);
    m.restablecerLan('DUO', 1);
    m.pump();
    const lote = [
      { autorizacion: 'AUT-OK', importe: a.total, tienda: 'DUO', caja: 1 },
      { autorizacion: 'AUT-PERDIDA', importe: b.total, tienda: 'DUO', caja: 1 },
    ];
    const inc = conciliarLote(lote, m.central.repo.ops());
    assert.deepEqual(inc.map((i) => [i.tipo, (i as any).autorizacion]), [['cobro_sin_venta', 'AUT-PERDIDA']]);
    assert.equal(intentos(m.central.repo.ops()).size, 1, 'el central solo conoce el intento sincronizado');
    assert.equal(ventas(m.central.repo.ops()).size, 1);
    void items;
  });
});

porAlmacen('Cobro pendiente tras reinicio (solo SQLite)', (alm) => {
  it('T9 el intento y el carrito sobreviven a un reinicio; resolver después continúa el folio', (t) => {
    const ctx = nuevoMundo(alm, politica());
    t.after(ctx.limpiar);
    const c0 = ctx.m.caja('DUO', 1);
    const { cart, total } = carritoCon(ctx);
    const { intento } = c0.iniciarCobroTarjeta(cart);
    const c = ctx.m.reiniciarCaja('DUO', 1); // el proceso se cayó con el cobro en la terminal
    assert.equal(c.pendientesDeConciliar().length, 1);
    assert.equal(c.carrito(cart).lineas.length, 1);
    assert.equal(c.iniciarCobroTarjeta(cart).reutilizado, true, 'no se genera otro cobro');
    assert.throws(() => c.cobrar(cart, [{ metodo: 'efectivo', monto: total }]), { codigo: 'COBRO_PENDIENTE' });
    assert.equal(vender(ctx.m, 'DUO', 1, ctx.items[2]!.item_id).venta.folio, 1, 'otra venta independiente continúa');
    assert.equal(c.resolverIntento(intento.intent_id, { resultado: 'aprobado', autorizacion: 'AUT-R' })!.folio, 2);
  });
}, 'sqlite');
