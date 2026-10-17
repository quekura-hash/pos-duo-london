import assert from 'node:assert/strict';
import { it } from 'node:test';
import { detectar } from '../src/incidencias.ts';
import { tarjetasRegalo } from '../src/proyecciones.ts';
import { construirTicket, renderTicketDevolucionTexto, renderTicketTexto } from '../src/ticket.ts';
import { devoluciones, ventas } from '../src/proyecciones.ts';
import { nuevoMundo, politica, porAlmacen } from './ayudas/comun.ts';

const MASCADA = 12000; // item 3 del catálogo sintético ($120.00)

porAlmacen('Tarjetas de regalo: alta, cobro, cancelación, arbitraje y conflictos', (alm) => {
  const carrito = (m: ReturnType<typeof nuevoMundo>['m'], items: ReturnType<typeof nuevoMundo>['items'], t: string, n: number, qty = 1) => {
    const caja = m.caja(t, n);
    const cart = caja.abrirCarrito();
    caja.agregarLinea(cart, { item_id: items[2]!.item_id, qty });
    return { caja, cart };
  };

  it('TR1 P-24: vender una tarjeta es una venta en efectivo con folio normal, sin inventario, y el corte la separa de la mercancía', (t) => {
    const { m, items, limpiar } = nuevoMundo(alm, politica());
    t.after(limpiar);
    const c = m.caja('DUO', 1);
    const antes = c.stockLocal(items[2]!.item_id);
    const r = c.altaTarjetaRegalo({ codigo: 'TR-0001', monto: 50000, recibido: 60000, cajero: 'Ana' });
    assert.deepEqual([r.tarjeta.codigo, r.tarjeta.saldo, r.tarjeta.emitido], ['TR-0001', 50000, 50000]);
    assert.deepEqual([r.venta.folio, r.venta.total, r.venta.pagos[0]!.cambio], [1, 50000, 10000], 'folio normal y cambio');
    assert.equal(r.venta.lineas[0]!.tarjeta_regalo?.tipo, 'alta');
    assert.equal(c.ops().filter((o) => o.tipo === 'inv.movement' && o.payload.tipo === 'venta').length, 0, 'no mueve inventario');
    assert.equal(c.stockLocal(items[2]!.item_id), antes);
    const corte = c.corteEnVivo('2026-10-01');
    assert.deepEqual([corte.tickets, corte.ventas, corte.ventas_mercancia, corte.tarjetas_regalo_vendidas, corte.ventas_netas, corte.cobros_efectivo, corte.efectivo_esperado, corte.folio_final],
      [1, 50000, 0, 50000, 0, 50000, 50000, 1]);
    const txt = renderTicketTexto(construirTicket(r.venta));
    assert.match(txt, /Tarjeta de regalo TR-0001\n[^\n]*Código: TR-0001/);
    assert.match(txt, /1 x \$500\.00 +\$500\.00/);
    assert.match(txt, /Vigencia: 12 meses/);
    assert.doesNotMatch(txt, /Item #|Marca|iva|tax|impuesto|%/i);
    assert.throws(() => c.altaTarjetaRegalo({ codigo: 'TR-0001', monto: 100 }), { codigo: 'TARJETA_EXISTE' });
    assert.throws(() => c.altaTarjetaRegalo({ codigo: '  ', monto: 100 }), { codigo: 'DATOS_REQUERIDOS' });
    assert.throws(() => c.altaTarjetaRegalo({ codigo: 'X', monto: 0 }), { codigo: 'PAGO_INVALIDO' });
    assert.throws(() => c.altaTarjetaRegalo({ codigo: 'X', monto: 10.5 }), { codigo: 'PAGO_INVALIDO' });
    assert.throws(() => c.altaTarjetaRegalo({ codigo: 'X', monto: 5000, recibido: 100 }), { codigo: 'EFECTIVO_INSUFICIENTE' });
    assert.equal(c.estadoFolios().ultimo, 1, 'lo rechazado no consumió folio');
    assert.deepEqual(c.carritosAbiertos(), [], 'ningún intento fallido queda como venta en curso');
    // doble clic: la misma referencia devuelve la misma venta
    const x = c.altaTarjetaRegalo({ codigo: 'DOS', monto: 1000, ref: 'ref-1' });
    assert.equal(c.altaTarjetaRegalo({ codigo: 'DOS', monto: 1000, ref: 'ref-1' }).venta.folio, x.venta.folio);
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
    assert.deepEqual([corte.cobros_tarjeta_regalo, corte.cobros_efectivo, corte.efectivo_esperado], [MASCADA, 50000, 50000], 'el efectivo entró al vender la tarjeta, no al usarla');
    assert.deepEqual([corte.ventas, corte.ventas_mercancia, corte.tarjetas_regalo_vendidas, corte.ventas_netas], [50000 + MASCADA, MASCADA, 50000, MASCADA], 'la mercancía pagada con la tarjeta cuenta una sola vez');
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
    assert.deepEqual([corte.cobros_efectivo, corte.cobros_tarjeta_regalo, corte.efectivo_esperado], [5000 + 7000, 5000, 5000 + 7000], 'efectivo = el de vender la tarjeta + el resto de la compra');
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
    assert.equal(c.estadoFolios().ultimo, 1, 'nada de lo rechazado consumió folio (solo la venta de la tarjeta)');
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

  it('TR6 dos ventas en curso con la misma tarjeta no gastan el mismo saldo (el hub aparta y cierra la reserva)', (t) => {
    const { m, items, limpiar } = nuevoMundo(alm, politica());
    t.after(limpiar);
    m.caja('DUO', 1).altaTarjetaRegalo({ codigo: 'UNICA', monto: MASCADA });
    m.pump();
    const a = carrito(m, items, 'DUO', 1);
    const b = carrito(m, items, 'DUO', 1);
    assert.equal(a.caja.cobrarConTarjetaRegalo(a.cart, 'UNICA', undefined).pagos[0]!.saldo_despues, 0);
    assert.throws(() => b.caja.cobrarConTarjetaRegalo(b.cart, 'UNICA', undefined), { codigo: 'SALDO_INSUFICIENTE' });
    assert.equal(b.caja.estadoFolios().ultimo, 2, 'la venta rechazada no consumió folio');
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

  it('TR9 P-25 (decidido): la Caja 2 no maneja tarjetas de regalo (ni alta ni pago) y tampoco tarjeta bancaria', (t) => {
    const { m, items, limpiar } = nuevoMundo(alm, politica());
    t.after(limpiar);
    m.caja('DUO', 1).altaTarjetaRegalo({ codigo: 'C2', monto: 20000 });
    m.pump();
    const c2 = m.caja('DUO', 2);
    assert.throws(() => c2.altaTarjetaRegalo({ codigo: 'C2-NUEVA', monto: 100 }), { codigo: 'PAGO_NO_PERMITIDO' });
    const { cart } = carrito(m, items, 'DUO', 2);
    assert.throws(() => c2.cobrarConTarjetaRegalo(cart, 'C2', undefined), { codigo: 'PAGO_NO_PERMITIDO' });
    assert.throws(() => c2.cobrar(cart, [{ metodo: 'tarjeta', monto: MASCADA, autorizacion: 'X' }]), { codigo: 'PAGO_NO_PERMITIDO' });
    assert.equal(c2.estadoFolios().ultimo, 0);
    assert.equal(c2.cobrarEfectivo(cart, MASCADA).estado, 'confirmada', 'en efectivo sí');
  });

  it('TR10 conflictos: el mismo código dado de alta en dos tiendas aisladas se señala; dos cajas sin hub que gastan lo mismo sobregiran y se señala', (t) => {
    const { m, items, limpiar } = nuevoMundo(alm, politica({ P01_hub_no_disponible: 'vender_autonomo_con_aviso', P23_tarjeta_regalo_entre_tiendas: 'compartida' }));
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
    // con la tarjeta compartida entre tiendas e internet caído, cada tienda ve el saldo que conoce y lo puede gastar: el conflicto aparece después como sobregiro
    m.caja('DUO', 1).altaTarjetaRegalo({ codigo: 'DOBLE', monto: MASCADA });
    for (let i = 0; i < 4; i++) m.pump();
    m.cortarInternet('DUO'); m.cortarInternet('LON');
    const a = carrito(m, items, 'DUO', 1);
    const b = carrito(m, items, 'LON', 1);
    a.caja.cobrarConTarjetaRegalo(a.cart, 'DOBLE', undefined);
    b.caja.cobrarConTarjetaRegalo(b.cart, 'DOBLE', undefined);
    m.restablecerInternet('DUO'); m.restablecerInternet('LON');
    for (let i = 0; i < 4; i++) m.pump();
    const sob = detectar(m.central.repo.ops()).find((i) => i.tipo === 'tarjeta_regalo_sobregirada');
    assert.deepEqual([sob?.codigo, sob?.saldo], ['DOBLE', -MASCADA]);
  });

  it('TR11 P-26b/P-26c: vencen a los 12 meses de la venta; la recarga en efectivo los reinicia; devolver o cancelar no', (t) => {
    const { m, items, limpiar } = nuevoMundo(alm, politica());
    t.after(limpiar);
    const c = m.caja('DUO', 1);
    m.reloj.fijar('2026-10-01T15:00:00Z');
    c.altaTarjetaRegalo({ codigo: 'VENCE', monto: 100000 });
    m.pump();
    assert.equal(c.tarjetaRegalo('VENCE')!.vigente_hasta.slice(0, 10), '2027-10-01');
    // un día antes de vencer sirve; recargar reinicia los 12 meses desde la recarga
    m.reloj.fijar('2027-09-30T15:00:00Z');
    const { cart } = carrito(m, items, 'DUO', 1);
    const v = c.cobrarConTarjetaRegalo(cart, 'VENCE', undefined);
    assert.equal(c.tarjetaRegalo('VENCE')!.saldo, 100000 - MASCADA);
    m.reloj.fijar('2027-10-15T15:00:00Z');
    m.pump();
    const otro = carrito(m, items, 'DUO', 1);
    assert.throws(() => c.cobrarConTarjetaRegalo(otro.cart, 'VENCE', undefined), { codigo: 'TARJETA_VENCIDA' });
    // devolver NO reinicia la vigencia (el saldo vuelve, pero sigue vencida)
    c.devolver({ sale_id: v.sale_id, renglones: [{ linea_id: v.lineas[0]!.linea_id, qty: 1 }], motivo: 'x' });
    assert.equal(c.tarjetaRegalo('VENCE')!.vigente_hasta.slice(0, 10), '2027-10-01');
    assert.equal(c.saldoTarjeta('VENCE'), 100000);
    assert.throws(() => c.cobrarConTarjetaRegalo(otro.cart, 'VENCE', undefined), { codigo: 'TARJETA_VENCIDA' });
    // recargar en efectivo sí: 12 meses desde hoy
    const rec = c.recargarTarjetaRegalo({ codigo: 'VENCE', monto: 20000 });
    assert.deepEqual([rec.venta.lineas[0]!.tarjeta_regalo?.tipo, rec.venta.folio > 0], ['recarga', true]);
    assert.equal(c.tarjetaRegalo('VENCE')!.vigente_hasta.slice(0, 10), '2028-10-15');
    assert.equal(c.saldoTarjeta('VENCE'), 120000);
    m.pump();
    assert.equal(c.cobrarConTarjetaRegalo(otro.cart, 'VENCE', undefined).estado, 'confirmada');
    assert.throws(() => c.recargarTarjetaRegalo({ codigo: 'NOEXISTE', monto: 100 }), { codigo: 'TARJETA_INEXISTENTE' });
    assert.throws(() => m.caja('DUO', 2).recargarTarjetaRegalo({ codigo: 'VENCE', monto: 100 }), { codigo: 'PAGO_NO_PERMITIDO' });
    const corte = c.corteEnVivo('2027-10-15');
    assert.deepEqual([corte.tarjetas_regalo_vendidas, corte.tarjetas_regalo_vendidas_n], [20000, 1]);
  });

  it('TR12 P-26: devolver mercancía pagada con tarjeta regresa el dinero a la MISMA tarjeta (proporcional si fue mixto) y usa folio de la serie', (t) => {
    const { m, items, limpiar } = nuevoMundo(alm, politica());
    t.after(limpiar);
    const c = m.caja('DUO', 1);
    c.altaTarjetaRegalo({ codigo: 'DEV', monto: 5000 });
    m.pump();
    // 2 mascadas = 24000: 5000 con la tarjeta y 19000 en efectivo
    const { cart } = carrito(m, items, 'DUO', 1, 2);
    const v = c.cobrarConTarjetaRegalo(cart, 'DEV', 19000);
    assert.equal(c.saldoTarjeta('DEV'), 0);
    const lin = v.lineas[0]!.linea_id;
    const d1 = c.devolver({ sale_id: v.sale_id, renglones: [{ linea_id: lin, qty: 1 }], motivo: 'talla' });
    // 12000 devueltos: 12000*5000/24000 = 2500 a la tarjeta y 9500 en efectivo
    assert.deepEqual(d1.reembolsos, [{ metodo: 'tarjeta_regalo', monto: 2500, tarjeta: 'DEV' }, { metodo: 'efectivo', monto: 9500 }]);
    assert.equal(d1.folio, v.folio + 1, 'mismo consecutivo que las ventas');
    assert.equal(c.saldoTarjeta('DEV'), 2500);
    const d2 = c.devolver({ sale_id: v.sale_id, renglones: [{ linea_id: lin, qty: 1 }], motivo: 'talla' });
    assert.deepEqual(d2.reembolsos, [{ metodo: 'tarjeta_regalo', monto: 2500, tarjeta: 'DEV' }, { metodo: 'efectivo', monto: 9500 }]);
    assert.equal(c.saldoTarjeta('DEV'), 5000, 'la tarjeta recupera exactamente lo que pagó');
    const corte = c.corteEnVivo('2026-10-01');
    assert.deepEqual([corte.devoluciones, corte.devoluciones_en_efectivo, corte.devoluciones_a_tarjeta_regalo, corte.folios_de_devolucion], [24000, 19000, 5000, 2]);
    assert.equal(corte.efectivo_esperado, 5000 + 19000 - 19000, 'alta + cobro − lo devuelto en efectivo');
    const txt = renderTicketDevolucionTexto(d1, ventas(c.ops()).get(v.sale_id)!);
    assert.match(txt, /DEVOLUCIÓN/);
    assert.match(txt, new RegExp(`Folio: ${String(d1.folio).padStart(6, '0')}`));
    assert.match(txt, /Reembolso en efectivo MXN +\$95\.00/);
    assert.match(txt, /A tarjeta de regalo DEV +\$25\.00/);
    assert.equal(devoluciones(c.ops()).length, 2);
    assert.deepEqual(detectar(c.ops()).filter((i) => i.tipo.startsWith('folio_')), [], 'ventas y devoluciones no dejan huecos ni duplicados en la serie');
  });

  it('TR13 la venta de una tarjeta no se devuelve ni se cancela (pendiente de definir) y no consume existencias', (t) => {
    const { m, limpiar } = nuevoMundo(alm, politica());
    t.after(limpiar);
    const c = m.caja('DUO', 1);
    const { venta } = c.altaTarjetaRegalo({ codigo: 'FIJA', monto: 3000 });
    assert.throws(() => c.devolver({ sale_id: venta.sale_id, renglones: [{ linea_id: venta.lineas[0]!.linea_id, qty: 1 }], motivo: 'x' }), { codigo: 'DEVOLUCION_BLOQUEADA' });
    assert.throws(() => c.cancelarVenta(venta.sale_id, 'x'), { codigo: 'CANCELACION_BLOQUEADA' });
    assert.equal(c.saldoTarjeta('FIJA'), 3000);
  });

  it('TR14 el hub aparta saldo con el nuevo cálculo y no concede una tarjeta vencida', (t) => {
    const { m, limpiar } = nuevoMundo(alm, politica());
    t.after(limpiar);
    m.reloj.fijar('2026-10-01T15:00:00Z');
    m.caja('DUO', 1).altaTarjetaRegalo({ codigo: 'H', monto: 10000 });
    m.pump();
    m.reloj.fijar('2027-10-02T15:00:00Z');
    const r = m.hub('DUO').reservar('R', 1, [], [{ codigo: 'H', monto: 100 }]);
    assert.deepEqual([r.ok, r.motivo, r.tarjetas_vencidas], [false, 'tarjeta_vencida', ['H']]);
  });

  it('TR15 el redondeo del reintegro a la tarjeta lo absorbe la última devolución: la tarjeta recupera exactamente lo que pagó', (t) => {
    const { m, items, limpiar } = nuevoMundo(alm, politica());
    t.after(limpiar);
    const c = m.caja('DUO', 1);
    c.altaTarjetaRegalo({ codigo: 'RED', monto: 5000 });
    m.pump();
    const { cart } = carrito(m, items, 'DUO', 1, 3); // 36000: 5000 con la tarjeta, 31000 en efectivo
    const v = c.cobrarConTarjetaRegalo(cart, 'RED', 31000);
    const lin = v.lineas[0]!.linea_id;
    const aTarjeta = [1, 2, 3].map(() => c.devolver({ sale_id: v.sale_id, renglones: [{ linea_id: lin, qty: 1 }], motivo: 'x' }).reembolsos.find((r) => r.metodo === 'tarjeta_regalo')!.monto);
    assert.deepEqual(aTarjeta, [1666, 1666, 1668]);
    assert.equal(c.saldoTarjeta('RED'), 5000);
  });
});
