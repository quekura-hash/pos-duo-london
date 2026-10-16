import assert from 'node:assert/strict';
import { it } from 'node:test';
import { detectar } from '../src/incidencias.ts';
import { stock, ventas } from '../src/proyecciones.ts';
import { crearOp } from '../src/util.ts';
import { nuevoMundo, politica, porAlmacen, vender } from './ayudas/comun.ts';

porAlmacen('Folios e independencia por caja', (alm) => {
  it('F1 cuatro series independientes y consecutivas; la sincronización no renumera', (t) => {
    const { m, items, limpiar } = nuevoMundo(alm, politica());
    t.after(limpiar);
    const orden: [string, number][] = [['DUO', 1], ['LON', 2], ['DUO', 2], ['DUO', 1], ['LON', 1], ['DUO', 1], ['LON', 2], ['DUO', 2], ['DUO', 2], ['LON', 1]];
    const emitidos = new Map<string, number[]>();
    for (const [tienda, caja] of orden) {
      const { venta } = vender(m, tienda, caja, items[2]!.item_id);
      (emitidos.get(`${tienda}/${caja}`) ?? emitidos.set(`${tienda}/${caja}`, []).get(`${tienda}/${caja}`)!).push(venta.folio);
    }
    assert.deepEqual(emitidos.get('DUO/1'), [1, 2, 3]);
    assert.deepEqual(emitidos.get('DUO/2'), [1, 2, 3]);
    assert.deepEqual(emitidos.get('LON/1'), [1, 2]);
    assert.deepEqual(emitidos.get('LON/2'), [1, 2]);
    m.pump();
    const central = ventas(m.central.repo.ops());
    assert.equal(central.size, 10);
    for (const v of central.values()) assert.ok(emitidos.get(`${v.tienda}/${v.caja}`)!.includes(v.folio));
    const claves = new Set([...central.values()].map((v) => `${v.tienda}/${v.caja}#${v.folio}`));
    assert.equal(claves.size, 10, 'tienda+caja+folio es única');
    assert.deepEqual(detectar(m.central.repo.ops()).filter((i) => i.tipo.startsWith('folio')), []);
  });

  it('F2 el folio continúa al cambiar de mes y respeta la hora de Hermosillo', (t) => {
    const { m, items, limpiar } = nuevoMundo(alm, politica());
    t.after(limpiar);
    m.reloj.fijar('2026-10-31T20:00:00Z');
    assert.equal(vender(m, 'DUO', 1, items[2]!.item_id).venta.folio, 1);
    assert.equal(vender(m, 'DUO', 1, items[2]!.item_id).venta.folio, 2);
    m.reloj.fijar('2026-11-02T20:00:00Z');
    assert.equal(vender(m, 'DUO', 1, items[2]!.item_id).venta.folio, 3, 'octubre termina en 2, noviembre empieza en 3');
    assert.equal(vender(m, 'DUO', 2, items[2]!.item_id).venta.folio, 1, 'otra caja, otra serie');
  });

  it('F3 una cancelación conserva folio y estado, y el número no se reutiliza', (t) => {
    const { m, items, limpiar } = nuevoMundo(alm, politica());
    t.after(limpiar);
    const a = vender(m, 'DUO', 1, items[2]!.item_id, 2);
    const b = vender(m, 'DUO', 1, items[2]!.item_id, 1);
    const antes = m.caja('DUO', 1).stockLocal(items[2]!.item_id);
    m.caja('DUO', 1).cancelarVenta(a.venta.sale_id, 'error de captura');
    assert.equal(m.caja('DUO', 1).stockLocal(items[2]!.item_id), antes + 2, 'la cancelación regresa existencias por movimiento');
    const c = vender(m, 'DUO', 1, items[2]!.item_id);
    assert.deepEqual([a.venta.folio, b.venta.folio, c.venta.folio], [1, 2, 3]);
    const v = ventas(m.caja('DUO', 1).ops()).get(a.venta.sale_id)!;
    assert.equal(v.folio, 1);
    assert.equal(v.estado, 'cancelada');
  });

  it('F4 doble clic / reintento sobre el mismo carrito no duplica venta, folio ni movimientos', (t) => {
    const { m, items, limpiar } = nuevoMundo(alm, politica());
    t.after(limpiar);
    const caja = m.caja('DUO', 1);
    const cart = caja.abrirCarrito();
    const l = caja.agregarLinea(cart, { item_id: items[2]!.item_id, qty: 2 });
    const pagos = [{ metodo: 'efectivo' as const, monto: l.importe }];
    const v1 = caja.cobrar(cart, pagos);
    const v2 = caja.cobrar(cart, pagos);
    const v3 = caja.cobrar(cart, pagos);
    assert.deepEqual([v1.folio, v2.folio, v3.folio], [1, 1, 1]);
    assert.equal(caja.ops().filter((o) => o.tipo === 'sale.confirmed').length, 1);
    assert.equal(caja.ops().filter((o) => o.tipo === 'inv.movement' && o.payload.tipo === 'venta').length, 1);
    assert.equal(caja.estadoFolios().ultimo, 1);
  });

  it('F5 reenvío múltiple con confirmaciones perdidas: un solo efecto en hub y central', (t) => {
    const { m, items, limpiar } = nuevoMundo(alm, politica());
    t.after(limpiar);
    const perdidos = new Map<string, number>();
    m.dropAck = (op, destino) => {
      const k = `${op.op_id}|${destino}`;
      const n = (perdidos.get(k) ?? 0) + 1;
      perdidos.set(k, n);
      return n <= 3; // las 3 primeras confirmaciones de cada entrega se pierden
    };
    vender(m, 'DUO', 2, items[2]!.item_id, 3);
    for (let i = 0; i < 6; i++) m.pump();
    assert.ok(m.acksPerdidos > 0 && m.entregas > m.acksPerdidos / 2, 'hubo reenvíos reales');
    for (const repo of [m.hub('DUO').repo, m.central.repo]) {
      const ops = repo.ops();
      assert.equal(ops.filter((o) => o.tipo === 'sale.confirmed').length, 1);
      assert.equal(stock(ops, 'DUO').get(items[2]!.item_id), 47, '50 - 3, descontado una sola vez');
    }
    assert.equal(m.pendientesTotales(), 0);
  });

  it('F6 Caja 2 rechaza tarjeta y mixto en la lógica de operación (no solo ocultando botones)', (t) => {
    const { m, items, limpiar } = nuevoMundo(alm, politica());
    t.after(limpiar);
    const c2 = m.caja('DUO', 2);
    const cart = c2.abrirCarrito();
    const l = c2.agregarLinea(cart, { item_id: items[2]!.item_id, qty: 1 });
    assert.throws(() => c2.cobrar(cart, [{ metodo: 'tarjeta', monto: l.importe, autorizacion: 'A1' }]), { codigo: 'PAGO_NO_PERMITIDO' });
    assert.throws(() => c2.cobrar(cart, [{ metodo: 'efectivo', monto: 5000 }, { metodo: 'tarjeta', monto: l.importe - 5000, autorizacion: 'A1' }]), { codigo: 'PAGO_NO_PERMITIDO' });
    assert.throws(() => c2.iniciarCobroTarjeta(cart), { codigo: 'PAGO_NO_PERMITIDO' });
    assert.equal(c2.estadoFolios().ultimo, 0, 'ningún intento consumió folio');
    assert.equal(c2.ops().filter((o) => o.tipo === 'sale.confirmed').length, 0);
  });

  it('F7 el hub rechaza una venta con tarjeta de Caja 2 aunque la caja la hubiera emitido', (t) => {
    const { m, items, limpiar } = nuevoMundo(alm, politica());
    t.after(limpiar);
    const hostil = crearOp('sale.confirmed', 'DUO', 2, 'caja:DUO/2', m.reloj.now(), {
      sale_id: 'hostil', tienda: 'DUO', caja: 2, folio: 1, cajero: 'x',
      lineas: [{ linea_id: 'l', item_id: items[2]!.item_id, codigo: 'c', descripcion: 'd', qty: 1, precio_unit: 100, descuento: 0, importe: 100 }],
      total: 100, pagos: [{ metodo: 'tarjeta', monto: 100 }],
    }, 'sale:hostil');
    m.hub('DUO').recibir(hostil, 'caja:DUO/2');
    m.pump();
    assert.equal(ventas(m.hub('DUO').repo.ops()).size, 0);
    assert.equal(ventas(m.central.repo.ops()).size, 0);
    const inc = detectar(m.central.repo.ops());
    assert.ok(inc.some((i) => i.tipo === 'op_rechazada' && String(i.motivo).startsWith('metodo_no_permitido')), 'la operación rechazada queda registrada, no se pierde en silencio');
  });

  it('F9 atomicidad: un fallo a mitad de la venta no deja folio, venta ni movimientos', (t) => {
    const { m, items, limpiar } = nuevoMundo(alm, politica());
    t.after(limpiar);
    const caja = m.caja('DUO', 1);
    const cart = caja.abrirCarrito();
    const l = caja.agregarLinea(cart, { item_id: items[2]!.item_id, qty: 1 });
    for (const punto of ['tras_folio', 'tras_venta', 'tras_movimientos']) {
      m.ctx.fallo = (p) => { if (p === punto) throw new Error(`corte en ${punto}`); };
      assert.throws(() => caja.cobrar(cart, [{ metodo: 'efectivo', monto: l.importe }]), /corte en/);
      assert.equal(caja.estadoFolios().ultimo, 0, `${punto}: el folio no se consumió`);
      assert.equal(caja.ops().filter((o) => o.tipo === 'sale.confirmed').length, 0);
      assert.equal(caja.ops().filter((o) => o.tipo === 'inv.movement' && o.payload.tipo === 'venta').length, 0);
      assert.equal(m.pendientesTotales(), 0);
    }
    m.ctx.fallo = undefined;
    assert.equal(caja.cobrar(cart, [{ metodo: 'efectivo', monto: l.importe }]).folio, 1, 'sin huecos tras los fallos');
  });
});

porAlmacen('Persistencia, reinicio y pérdida de conexión', (alm) => {
  it('P1 guardar la venta, perder conexión, reiniciar y reenviar no duplica nada', (t) => {
    const { m, items, limpiar } = nuevoMundo(alm, politica());
    t.after(limpiar);
    m.cortarLan('DUO', 1); // la venta se guarda localmente; el hub no se entera
    const { venta } = vender(m, 'DUO', 1, items[2]!.item_id, 2);
    assert.equal(m.pump(), 0, 'nada llega mientras el enlace está caído');
    assert.ok(m.pendientesTotales() > 0);
    const c = m.reiniciarCaja('DUO', 1);
    assert.equal(c.estadoFolios().ultimo, 1, 'el contador sobrevivió al reinicio');
    assert.equal(ventas(c.ops()).get(venta.sale_id)!.folio, 1);
    m.restablecerLan('DUO', 1);
    m.pump();
    m.pump();
    assert.equal(ventas(m.central.repo.ops()).size, 1);
    assert.equal(stock(m.central.repo.ops(), 'DUO').get(items[2]!.item_id), 48);
    assert.equal(vender(m, 'DUO', 1, items[2]!.item_id).venta.folio, 2, 'el siguiente folio continúa tras el reinicio');
  });

  it('P2 el carrito en curso sobrevive a un reinicio', (t) => {
    const { m, items, limpiar } = nuevoMundo(alm, politica());
    t.after(limpiar);
    const cart = m.caja('DUO', 1).abrirCarrito();
    m.caja('DUO', 1).agregarLinea(cart, { item_id: items[2]!.item_id, qty: 2 });
    const c = m.reiniciarCaja('DUO', 1);
    assert.deepEqual(c.carritosAbiertos(), [cart]);
    assert.equal(c.carrito(cart).lineas.length, 1);
  });
}, 'sqlite');
