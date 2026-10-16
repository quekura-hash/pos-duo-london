import assert from 'node:assert/strict';
import { it } from 'node:test';
import { detectar } from '../src/incidencias.ts';
import { stock, ventas } from '../src/proyecciones.ts';
import { nuevoMundo, politica, porAlmacen, vender } from './ayudas/comun.ts';

porAlmacen('Arbitraje de existencias del hub (en proceso, sin red real)', (alm) => {
  it('AR1 carrera real: sin sincronizar entre ventas, el hub concede la última pieza a UNA sola caja (P-02=bloquear)', (t) => {
    const { m, items, limpiar } = nuevoMundo(alm, politica({ P02_existencia_insuficiente: 'bloquear' }));
    t.after(limpiar);
    const ultima = items[3]!.item_id;
    const c1 = m.caja('DUO', 1);
    const c2 = m.caja('DUO', 2);
    const k1 = c1.abrirCarrito();
    const l1 = c1.agregarLinea(k1, { item_id: ultima, qty: 1 });
    const k2 = c2.abrirCarrito();
    const l2 = c2.agregarLinea(k2, { item_id: ultima, qty: 1 });
    assert.equal(c2.cobrar(k2, [{ metodo: 'efectivo', monto: l2.importe }]).folio, 1);
    // NO hay pump: la caja 1 todavía cree que hay 1 pieza, pero el hub ya la tiene apartada
    assert.equal(c1.stockLocal(ultima), 1);
    assert.throws(() => c1.cobrar(k1, [{ metodo: 'efectivo', monto: l1.importe }]), { codigo: 'SIN_EXISTENCIA' });
    assert.equal(c1.estadoFolios().ultimo, 0, 'la venta rechazada no consumió folio');
    assert.equal(c1.ops().filter((o) => o.tipo === 'sale.confirmed').length, 0);
    m.pump();
    assert.equal(stock(m.hub('DUO').repo.ops(), 'DUO').get(ultima), 0, 'sin saldo negativo');
    assert.equal(m.hub('DUO').reservasAbiertas().length, 0, 'la reserva se cerró al llegar el movimiento');
  });

  it('AR2 P-02=permitir_y_conciliar: el hub concede ambas, avisa la sobreventa a la segunda y queda señalada', (t) => {
    const { m, items, limpiar } = nuevoMundo(alm, politica({ P02_existencia_insuficiente: 'permitir_y_conciliar' }));
    t.after(limpiar);
    const ultima = items[3]!.item_id;
    const a = vender(m, 'DUO', 2, ultima, 1).venta;
    const b = vender(m, 'DUO', 1, ultima, 1).venta;
    assert.equal(a.avisos, undefined);
    assert.deepEqual(b.avisos, [`sobreventa:${ultima}`]);
    m.pump();
    assert.equal(stock(m.hub('DUO').repo.ops(), 'DUO').get(ultima), -1);
    assert.ok(detectar(m.central.repo.ops()).some((i) => i.tipo === 'stock_negativo'));
    assert.equal(ventas(m.central.repo.ops()).size, 2);
  });

  it('AR3 reintentar la misma reserva es idempotente: no aparta dos veces', (t) => {
    const { m, items, limpiar } = nuevoMundo(alm, politica({ P02_existencia_insuficiente: 'bloquear' }));
    t.after(limpiar);
    const x = items[1]!.item_id; // 3 piezas en DÚO
    const hub = m.hub('DUO');
    assert.deepEqual(hub.reservar('R1', 1, [{ item_id: x, qty: 2 }]), { ok: true });
    assert.equal(hub.reservar('R1', 1, [{ item_id: x, qty: 2 }]).idempotente, true);
    assert.equal(hub.reservar('R2', 2, [{ item_id: x, qty: 1 }]).ok, true, 'queda 1 libre: 3 − 2');
    assert.equal(hub.reservar('R3', 2, [{ item_id: x, qty: 1 }]).ok, false);
    assert.equal(hub.reservar('R3', 2, [{ item_id: x, qty: 1 }]).idempotente, undefined, 'un rechazo no se hereda: se vuelve a evaluar');
    hub.liberar('R1');
    assert.equal(hub.reservar('R3', 2, [{ item_id: x, qty: 1 }]).ok, true, 'liberada R1, el reintento de R3 sí procede');
  });

  it('AR3b una reserva liberada no responde "sí" en un reintento: se vuelve a evaluar y vuelve a apartar', (t) => {
    const { m, items, limpiar } = nuevoMundo(alm, politica({ P02_existencia_insuficiente: 'bloquear' }));
    t.after(limpiar);
    const ultima = items[3]!.item_id;
    const hub = m.hub('DUO');
    assert.equal(hub.reservar('K', 1, [{ item_id: ultima, qty: 1 }]).ok, true);
    hub.liberar('K');
    assert.equal(hub.reservar('K', 1, [{ item_id: ultima, qty: 1 }]).idempotente, undefined);
    assert.equal(hub.reservasAbiertas().length, 1, 'el reintento vuelve a apartar la pieza');
    assert.equal(hub.reservar('OTRA', 2, [{ item_id: ultima, qty: 1 }]).ok, false);
  });

  it('AR4 si la confirmación falla, la reserva se libera y otra caja puede vender', (t) => {
    const { m, items, limpiar } = nuevoMundo(alm, politica({ P02_existencia_insuficiente: 'bloquear' }));
    t.after(limpiar);
    const ultima = items[3]!.item_id;
    const c1 = m.caja('DUO', 1);
    const k = c1.abrirCarrito();
    const l = c1.agregarLinea(k, { item_id: ultima, qty: 1 });
    m.ctx.fallo = (p) => { if (p === 'tras_venta') throw new Error('corte'); };
    assert.throws(() => c1.cobrar(k, [{ metodo: 'efectivo', monto: l.importe }]), /corte/);
    m.ctx.fallo = undefined;
    assert.equal(m.hub('DUO').reservasAbiertas().length, 0);
    assert.equal(vender(m, 'DUO', 2, ultima, 1).venta.folio, 1);
  });

  it('AR5 una reserva huérfana (la caja murió tras reservar) bloquea hasta que vence su vigencia técnica', (t) => {
    const { m, items, limpiar } = nuevoMundo(alm, politica({ P02_existencia_insuficiente: 'bloquear' }));
    t.after(limpiar);
    const ultima = items[3]!.item_id;
    assert.equal(m.hub('DUO').reservar('huerfana', 1, [{ item_id: ultima, qty: 1 }]).ok, true);
    assert.throws(() => vender(m, 'DUO', 2, ultima, 1), { codigo: 'SIN_EXISTENCIA' });
    m.reloj.avanzar(m.ctx.ttlReservaMs + 1);
    assert.equal(vender(m, 'DUO', 2, ultima, 1).venta.folio, 1);
  });

  it('AR6 sin hub no hay arbitraje: rige la vista local y la política P-01/P-02 (nada se reserva)', (t) => {
    const { m, items, limpiar } = nuevoMundo(alm, politica({ P02_existencia_insuficiente: 'bloquear' }));
    t.after(limpiar);
    m.caerHub('DUO');
    assert.equal(vender(m, 'DUO', 1, items[3]!.item_id, 1).venta.folio, 1);
    assert.throws(() => vender(m, 'DUO', 1, items[3]!.item_id, 1), { codigo: 'SIN_EXISTENCIA' }, 'vista local: ya no queda');
    assert.equal(m.hub('DUO').reservasAbiertas().length, 0);
  });
});
