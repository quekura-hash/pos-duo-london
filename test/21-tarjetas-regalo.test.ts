import assert from 'node:assert/strict';
import { it } from 'node:test';
import { detectar } from '../src/incidencias.ts';
import { tarjetasRegalo } from '../src/proyecciones.ts';
import { construirComprobanteRegalo, construirTicket, renderComprobanteRegaloTexto, renderTicketTexto } from '../src/ticket.ts';
import { nuevoMundo, politica, porAlmacen } from './ayudas/comun.ts';

const MASCADA = 12000; // item 3 del catálogo sintético ($120.00)

porAlmacen('Tarjetas de regalo: alta, cobro, cancelación, arbitraje y conflictos', (alm) => {
  const carrito = (m: ReturnType<typeof nuevoMundo>['m'], items: ReturnType<typeof nuevoMundo>['items'], t: string, n: number, qty = 1) => {
    const caja = m.caja(t, n);
    const cart = caja.abrirCarrito();
    caja.agregarLinea(cart, { item_id: items[2]!.item_id, qty });
    return { caja, cart };
  };

  it('TR1 el alta es un ingreso de efectivo, no una venta: sin folio, con saldo y reflejada en el corte', (t) => {
    const { m, limpiar } = nuevoMundo(alm, politica());
    t.after(limpiar);
    const c = m.caja('DUO', 1);
    const tj = c.altaTarjetaRegalo({ codigo: 'TR-0001', monto: 50000, cajero: 'Ana' });
    assert.deepEqual([tj.codigo, tj.saldo, tj.emitido], ['TR-0001', 50000, 50000]);
    assert.equal(c.estadoFolios().ultimo, 0, 'no consume folio de ticket (P-24, sin aprobar)');
    assert.equal(c.ops().filter((o) => o.tipo === 'sale.confirmed').length, 0);
    const corte = c.corteEnVivo('2026-10-01');
    assert.deepEqual([corte.tickets, corte.ventas, corte.tarjetas_regalo_emitidas, corte.tarjetas_regalo_emitidas_n, corte.efectivo_esperado], [0, 0, 50000, 1, 50000]);
    assert.throws(() => c.altaTarjetaRegalo({ codigo: 'TR-0001', monto: 100 }), { codigo: 'TARJETA_EXISTE' });
    assert.throws(() => c.altaTarjetaRegalo({ codigo: '  ', monto: 100 }), { codigo: 'DATOS_REQUERIDOS' });
    assert.throws(() => c.altaTarjetaRegalo({ codigo: 'X', monto: 0 }), { codigo: 'PAGO_INVALIDO' });
    assert.throws(() => c.altaTarjetaRegalo({ codigo: 'X', monto: 10.5 }), { codigo: 'PAGO_INVALIDO' });
  });

  it('TR2 pagar con la tarjeta: descuenta el saldo, no entra al efectivo y el ticket lo muestra', (t) => {
    const { m, items, limpiar } = nuevoMundo(alm, politica());
    t.after(limpiar);
    const c = m.caja('DUO', 1);
    c.altaTarjetaRegalo({ codigo: 'TR-0001', monto: 50000 });
    m.pump(); // el hub conoce la tarjeta tras la sincronización (el servicio la dispara al dar de alta)
    const { cart } = carrito(m, items, 'DUO', 1);
    const v = c.cobrarConTarjetaRegalo(cart, 'TR-0001', undefined);
    assert.deepEqual(v.pagos, [{ metodo: 'tarjeta_regalo', monto: MASCADA, tarjeta: 'TR-0001', saldo_despues: 38000 }]);
    assert.equal(c.saldoTarjeta('TR-0001'), 38000);
    const corte = c.corteEnVivo('2026-10-01');
    assert.deepEqual([corte.cobros_tarjeta_regalo, corte.cobros_efectivo, corte.efectivo_esperado], [MASCADA, 0, 50000], 'el dinero de la tarjeta se recibió al darla de alta, no al usarla');
    const txt = renderTicketTexto(construirTicket(v));
    assert.match(txt, /Tarjeta de regalo +\$120\.00/);
    assert.match(txt, /Tarjeta: TR-0001 +Saldo \$380\.00/);
    assert.doesNotMatch(txt, /iva|tax|impuesto|%/i);
    // reintento idempotente: misma venta, no vuelve a descontar
    assert.equal(c.cobrarConTarjetaRegalo(cart, 'TR-0001', undefined).folio, v.folio);
    assert.equal(c.saldoTarjeta('TR-0001'), 38000);
  });

  it('TR3 saldo menor al total: el resto se cobra en efectivo; sin saldo o sin efectivo suficiente se rechaza', (t) => {
    const { m, items, limpiar } = nuevoMundo(alm, politica());
    t.after(limpiar);
    const c = m.caja('DUO', 1);
    c.altaTarjetaRegalo({ codigo: 'TR-5', monto: 5000 });
    m.pump();
    const { cart } = carrito(m, items, 'DUO', 1);
    assert.throws(() => c.cobrarConTarjetaRegalo(cart, 'TR-5', undefined), { codigo: 'EFECTIVO_INSUFICIENTE' });
    assert.throws(() => c.cobrarConTarjetaRegalo(cart, 'TR-5', 6000), { codigo: 'EFECTIVO_INSUFICIENTE' });
    assert.throws(() => c.cobrarConTarjetaRegalo(cart, 'NO-EXISTE', 12000), { codigo: 'TARJETA_INEXISTENTE' });
    const v = c.cobrarConTarjetaRegalo(cart, 'TR-5', 10000);
    assert.deepEqual(v.pagos.map((p) => [p.metodo, p.monto, p.recibido ?? null, p.cambio ?? null]), [['tarjeta_regalo', 5000, null, null], ['efectivo', 7000, 10000, 3000]]);
    assert.equal(c.saldoTarjeta('TR-5'), 0);
    const { cart: otro } = carrito(m, items, 'DUO', 1);
    assert.throws(() => c.cobrarConTarjetaRegalo(otro, 'TR-5', 12000), { codigo: 'SALDO_INSUFICIENTE' });
    const corte = c.corteEnVivo('2026-10-01');
    assert.deepEqual([corte.cobros_efectivo, corte.cobros_tarjeta_regalo, corte.efectivo_esperado], [7000, 5000, 7000 + 5000], 'efectivo esperado = efectivo cobrado + altas');
  });

  it('TR4 no se puede sobregirar ni listar dos veces la misma tarjeta en un cobro', (t) => {
    const { m, items, limpiar } = nuevoMundo(alm, politica());
    t.after(limpiar);
    const c = m.caja('DUO', 1);
    c.altaTarjetaRegalo({ codigo: 'A', monto: 5000 });
    const { cart } = carrito(m, items, 'DUO', 1);
    assert.throws(() => c.cobrar(cart, [{ metodo: 'tarjeta_regalo', monto: MASCADA, tarjeta: 'A' }]), { codigo: 'SALDO_INSUFICIENTE' });
    assert.throws(() => c.cobrar(cart, [{ metodo: 'tarjeta_regalo', monto: 6000, tarjeta: 'A' }, { metodo: 'tarjeta_regalo', monto: 6000, tarjeta: 'A' }]), { codigo: 'PAGO_INVALIDO' });
    assert.throws(() => c.cobrar(cart, [{ metodo: 'tarjeta_regalo', monto: MASCADA }]), { codigo: 'TARJETA_REGALO_REQUERIDA' });
    assert.equal(c.estadoFolios().ultimo, 0, 'nada de lo rechazado consumió folio');
    assert.equal(c.saldoTarjeta('A'), 5000);
  });

  it('TR5 cancelar la venta reintegra el saldo a la tarjeta (una sola vez)', (t) => {
    const { m, items, limpiar } = nuevoMundo(alm, politica());
    t.after(limpiar);
    const c = m.caja('DUO', 1);
    c.altaTarjetaRegalo({ codigo: 'TR-9', monto: 30000 });
    m.pump();
    const { cart } = carrito(m, items, 'DUO', 1);
    const v = c.cobrarConTarjetaRegalo(cart, 'TR-9', undefined);
    assert.equal(c.saldoTarjeta('TR-9'), 18000);
    c.cancelarVenta(v.sale_id, 'error de captura');
    c.cancelarVenta(v.sale_id, 'otra vez');
    assert.equal(c.saldoTarjeta('TR-9'), 30000);
    assert.equal(c.ops().filter((o) => o.tipo === 'giftcard.reintegro').length, 1);
  });

  it('TR6 arbitraje del hub: dos cajas no pueden gastar el mismo saldo aunque no se hayan sincronizado', (t) => {
    const { m, items, limpiar } = nuevoMundo(alm, politica({ P02_existencia_insuficiente: 'permitir_y_conciliar' }));
    t.after(limpiar);
    m.caja('DUO', 1).altaTarjetaRegalo({ codigo: 'UNICA', monto: MASCADA });
    m.pump();
    assert.equal(m.caja('DUO', 2).saldoTarjeta('UNICA'), MASCADA, 'la Caja 2 conoce la tarjeta tras sincronizar');
    const a = carrito(m, items, 'DUO', 1);
    const b = carrito(m, items, 'DUO', 2);
    assert.equal(a.caja.cobrarConTarjetaRegalo(a.cart, 'UNICA', undefined).pagos[0]!.saldo_despues, 0);
    // SIN pump: la Caja 2 todavía cree que hay saldo, pero el hub ya lo tiene apartado/consumido
    assert.equal(b.caja.saldoTarjeta('UNICA'), MASCADA);
    assert.throws(() => b.caja.cobrarConTarjetaRegalo(b.cart, 'UNICA', undefined), { codigo: 'SALDO_INSUFICIENTE' });
    assert.equal(b.caja.estadoFolios().ultimo, 0);
    m.pump();
    assert.equal(m.hub('DUO').reservasAbiertas().length, 0, 'la reserva de la tarjeta se cerró con su uso');
    assert.deepEqual(detectar(m.central.repo.ops()).filter((i) => i.tipo.startsWith('tarjeta_regalo')), []);
  });

  it('TR7 la reserva del hub aparta saldo y se libera: un rechazo no se hereda', (t) => {
    const { m, limpiar } = nuevoMundo(alm, politica());
    t.after(limpiar);
    m.caja('DUO', 1).altaTarjetaRegalo({ codigo: 'K', monto: 10000 });
    m.pump();
    const hub = m.hub('DUO');
    assert.equal(hub.reservar('R1', 1, [], [{ codigo: 'K', monto: 7000 }]).ok, true);
    const no = hub.reservar('R2', 2, [], [{ codigo: 'K', monto: 4000 }]);
    assert.deepEqual([no.ok, no.motivo, no.tarjetas_sin_saldo], [false, 'tarjeta_sin_saldo', ['K']]);
    assert.equal(hub.reservar('R1', 1, [], [{ codigo: 'K', monto: 7000 }]).idempotente, true);
    hub.liberar('R1');
    assert.equal(hub.reservar('R2', 2, [], [{ codigo: 'K', monto: 4000 }]).ok, true);
    assert.equal(hub.reservar('R3', 1, [], [{ codigo: 'inventada', monto: 1 }]).ok, false, 'una tarjeta que el hub no conoce no tiene saldo');
  });

  it('TR8 P-23 (ensayo): la tarjeta vale en la otra tienda; con "solo_tienda_emisora" no se reparte', (t) => {
    for (const [pol, esperado] of [['compartida', 20000], ['solo_tienda_emisora', null]] as const) {
      const { m, items, limpiar } = nuevoMundo(alm, politica({ P23_tarjeta_regalo_entre_tiendas: pol }));
      t.after(limpiar);
      m.caja('DUO', 1).altaTarjetaRegalo({ codigo: 'VIAJERA', monto: 20000 });
      m.pump(); m.pump(); m.pump();
      assert.equal(m.caja('LON', 1).saldoTarjeta('VIAJERA'), esperado, pol);
      if (esperado) {
        const { caja, cart } = carrito(m, items, 'LON', 1);
        const v = caja.cobrarConTarjetaRegalo(cart, 'VIAJERA', undefined);
        assert.equal(v.pagos[0]!.saldo_despues, 8000);
        m.pump(); m.pump(); m.pump();
        assert.equal(m.caja('DUO', 1).saldoTarjeta('VIAJERA'), 8000, 'el uso en London llega a DÚO');
        assert.equal(tarjetasRegalo(m.central.repo.ops()).get('VIAJERA')!.saldo, 8000);
      }
    }
  });

  it('TR9 Caja 2 (sin terminal bancaria) acepta tarjeta de regalo pero no tarjeta bancaria', (t) => {
    const { m, items, limpiar } = nuevoMundo(alm, politica());
    t.after(limpiar);
    const c2 = m.caja('DUO', 2);
    c2.altaTarjetaRegalo({ codigo: 'C2', monto: 20000 });
    m.pump();
    const { cart } = carrito(m, items, 'DUO', 2);
    assert.throws(() => c2.cobrar(cart, [{ metodo: 'tarjeta', monto: MASCADA, autorizacion: 'X' }]), { codigo: 'PAGO_NO_PERMITIDO' });
    assert.equal(c2.cobrarConTarjetaRegalo(cart, 'C2', undefined).estado, 'confirmada');
  });

  it('TR10 conflictos: el mismo código dado de alta en dos tiendas aisladas se señala; dos cajas sin hub que gastan lo mismo sobregiran y se señala', (t) => {
    const { m, items, limpiar } = nuevoMundo(alm, politica({ P01_hub_no_disponible: 'vender_autonomo_con_aviso' }));
    t.after(limpiar);
    m.cortarInternet('DUO'); m.cortarInternet('LON');
    m.caja('DUO', 1).altaTarjetaRegalo({ codigo: 'DUP', monto: 10000 });
    m.caja('LON', 1).altaTarjetaRegalo({ codigo: 'DUP', monto: 99900 });
    m.restablecerInternet('DUO'); m.restablecerInternet('LON');
    for (let i = 0; i < 4; i++) m.pump();
    const inc = detectar(m.central.repo.ops());
    const dup = inc.find((i) => i.tipo === 'tarjeta_regalo_duplicada');
    assert.ok(dup, 'alta repetida señalada');
    const t0 = tarjetasRegalo(m.central.repo.ops()).get('DUP')!;
    assert.equal(t0.duplicadas.length, 1);
    assert.equal(t0.saldo, t0.emitido, 'la alta repetida NO suma saldo: no se inventa dinero');
    // sin hub, cada caja ve el saldo que conoce y puede gastarlo: el conflicto aparece después como sobregiro
    m.caja('DUO', 1).altaTarjetaRegalo({ codigo: 'DOBLE', monto: MASCADA });
    m.pump(); m.pump();
    m.lan.set('DUO/1', false); m.lan.set('DUO/2', false);
    const a = carrito(m, items, 'DUO', 1);
    const b = carrito(m, items, 'DUO', 2);
    a.caja.cobrarConTarjetaRegalo(a.cart, 'DOBLE', undefined);
    b.caja.cobrarConTarjetaRegalo(b.cart, 'DOBLE', undefined);
    m.lan.set('DUO/1', true); m.lan.set('DUO/2', true);
    for (let i = 0; i < 4; i++) m.pump();
    const sob = detectar(m.central.repo.ops()).find((i) => i.tipo === 'tarjeta_regalo_sobregirada');
    assert.deepEqual([sob?.codigo, sob?.saldo], ['DOBLE', -MASCADA]);
  });

  it('TR11 comprobante de alta: sin folio de venta, sin IVA, con código y saldo', () => {
    const c = construirComprobanteRegalo({ codigo: 'TR-0001', monto: 50000, tienda: 'DUO', caja: 1, cajero: 'Ana', ocurrio_en: '2026-10-01T15:00:00Z' });
    const txt = renderComprobanteRegaloTexto(c);
    assert.match(txt, /TARJETA DE REGALO/);
    assert.match(txt, /Código: TR-0001/);
    assert.match(txt, /Saldo cargado +\$500\.00/);
    assert.match(txt, /No es un ticket de venta/);
    assert.doesNotMatch(txt, /folio|iva|tax|impuesto|%/i);
  });

  it('TR12 limitación documentada: una tarjeta que el hub aún no conoce se rechaza (no se arriesga gastar saldo sin árbitro)', (t) => {
    const { m, items, limpiar } = nuevoMundo(alm, politica());
    t.after(limpiar);
    const c = m.caja('DUO', 1);
    c.altaTarjetaRegalo({ codigo: 'NUEVA', monto: 50000 });
    const { cart } = carrito(m, items, 'DUO', 1);
    assert.throws(() => c.cobrarConTarjetaRegalo(cart, 'NUEVA', undefined), { codigo: 'SALDO_INSUFICIENTE' });
    m.pump();
    assert.equal(c.cobrarConTarjetaRegalo(cart, 'NUEVA', undefined).estado, 'confirmada');
  });
});
