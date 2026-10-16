import assert from 'node:assert/strict';
import { it } from 'node:test';
import { detectar } from '../src/incidencias.ts';
import { stock, ventas } from '../src/proyecciones.ts';
import { nuevoMundo, politica, porAlmacen, vender } from './ayudas/comun.ts';

porAlmacen('Inventario compartido por tienda', (alm) => {
  it('I1 venta en Caja 2 se ve en Caja 1 por LAN sin internet; las series avanzan por separado', (t) => {
    const { m, items, limpiar } = nuevoMundo(alm, politica());
    t.after(limpiar);
    const x = items[0]!.item_id;
    m.cortarInternet('DUO');
    m.cortarInternet('LON');
    const v2 = vender(m, 'DUO', 2, x, 2).venta;
    m.pump();
    assert.equal(m.caja('DUO', 1).stockLocal(x), 3, 'Caja 1 ve el descuento hecho por Caja 2 (5 - 2)');
    assert.equal(m.caja('DUO', 2).stockLocal(x), 3);
    const v1 = vender(m, 'DUO', 1, x, 1).venta;
    m.pump();
    assert.equal(m.caja('DUO', 2).stockLocal(x), 2);
    assert.deepEqual([v2.folio, v1.folio], [1, 1], 'cada caja con su propia serie');
    assert.equal(stock(m.central.repo.ops(), 'DUO').get(x), 5, 'el central aún no sabe nada: sin internet');
    assert.equal(ventas(m.central.repo.ops()).size, 0);
    m.restablecerInternet('DUO');
    m.restablecerInternet('LON');
    m.pump();
    assert.equal(stock(m.central.repo.ops(), 'DUO').get(x), 2);
    assert.equal(ventas(m.central.repo.ops()).size, 2);
  });

  it('I2 las tiendas no comparten inventario entre sí', (t) => {
    const { m, items, limpiar } = nuevoMundo(alm, politica());
    t.after(limpiar);
    const x = items[0]!.item_id;
    vender(m, 'DUO', 1, x, 2);
    m.pump();
    assert.equal(m.caja('DUO', 2).stockLocal(x), 3);
    assert.equal(m.caja('LON', 1).stockLocal(x), 3, 'London conserva sus 3');
    assert.equal(m.caja('LON', 2).stockLocal(x), 3);
  });

  it('I3 última pieza con hub disponible — P-02=bloquear: la segunda caja no vende', (t) => {
    const { m, items, limpiar } = nuevoMundo(alm, politica({ P02_existencia_insuficiente: 'bloquear' }));
    t.after(limpiar);
    const ultima = items[3]!.item_id;
    vender(m, 'DUO', 2, ultima, 1);
    m.pump();
    const c1 = m.caja('DUO', 1);
    const cart = c1.abrirCarrito();
    const l = c1.agregarLinea(cart, { item_id: ultima, qty: 1 });
    assert.throws(() => c1.cobrar(cart, [{ metodo: 'efectivo', monto: l.importe }]), { codigo: 'SIN_EXISTENCIA' });
    assert.equal(c1.estadoFolios().ultimo, 0);
  });

  it('I3b última pieza con hub disponible — P-02=permitir_y_conciliar: vende y queda saldo negativo señalado', (t) => {
    const { m, items, limpiar } = nuevoMundo(alm, politica({ P02_existencia_insuficiente: 'permitir_y_conciliar' }));
    t.after(limpiar);
    const ultima = items[3]!.item_id;
    vender(m, 'DUO', 2, ultima, 1);
    m.pump();
    vender(m, 'DUO', 1, ultima, 1);
    m.pump();
    assert.equal(m.caja('DUO', 1).stockLocal(ultima), -1);
    const inc = detectar(m.central.repo.ops()).filter((i) => i.tipo === 'stock_negativo');
    assert.equal(inc.length, 1);
    assert.equal(ventas(m.central.repo.ops()).size, 2, 'ninguna venta se pierde');
  });

  it('I4 última pieza con hub caído — P-01=vender_autonomo_con_aviso: ambas venden; al volver, ninguna operación se pierde', (t) => {
    const { m, items, limpiar } = nuevoMundo(alm, politica({ P01_hub_no_disponible: 'vender_autonomo_con_aviso' }));
    t.after(limpiar);
    const ultima = items[3]!.item_id;
    m.caerHub('DUO');
    vender(m, 'DUO', 1, ultima, 1);
    vender(m, 'DUO', 2, ultima, 1);
    assert.equal(m.caja('DUO', 1).stockLocal(ultima), 0, 'cada caja solo ve lo suyo mientras está aislada');
    assert.equal(m.caja('DUO', 2).stockLocal(ultima), 0);
    m.levantarHub('DUO');
    m.pump();
    assert.equal(m.caja('DUO', 1).stockLocal(ultima), -1);
    assert.equal(m.caja('DUO', 2).stockLocal(ultima), -1);
    assert.equal(ventas(m.central.repo.ops()).size, 2);
    assert.ok(detectar(m.hub('DUO').repo.ops()).some((i) => i.tipo === 'stock_negativo'));
  });

  it('I5 hub caído — P-01=bloquear_ventas_nuevas: no vende, conserva el carrito y completa al volver', (t) => {
    const { m, items, limpiar } = nuevoMundo(alm, politica({ P01_hub_no_disponible: 'bloquear_ventas_nuevas' }));
    t.after(limpiar);
    const c = m.caja('DUO', 1);
    const cart = c.abrirCarrito();
    const l = c.agregarLinea(cart, { item_id: items[2]!.item_id, qty: 1 });
    m.caerHub('DUO');
    assert.throws(() => c.cobrar(cart, [{ metodo: 'efectivo', monto: l.importe }]), { codigo: 'VENTA_BLOQUEADA' });
    assert.equal(c.estadoFolios().ultimo, 0);
    m.levantarHub('DUO');
    assert.equal(c.cobrar(cart, [{ metodo: 'efectivo', monto: l.importe }]).folio, 1);
  });

  it('I6 internet caído NO es hub caído: con P-01=bloquear_ventas_nuevas se sigue vendiendo', (t) => {
    const { m, items, limpiar } = nuevoMundo(alm, politica({ P01_hub_no_disponible: 'bloquear_ventas_nuevas' }));
    t.after(limpiar);
    m.cortarInternet('DUO');
    assert.equal(vender(m, 'DUO', 1, items[2]!.item_id).venta.folio, 1);
    assert.equal(vender(m, 'DUO', 2, items[2]!.item_id).venta.folio, 1);
  });
});
