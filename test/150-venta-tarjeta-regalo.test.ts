import assert from 'node:assert/strict';
import { it } from 'node:test';
import { reporteConsolidado } from '../src/consultas.ts';
import { totalesPorDia } from '../src/metas.ts';
import { canjeDeTarjetaRegalo, restaDeDevolucion, ventaDeTicket } from '../src/proyecciones.ts';
import { nuevoMundo, politica, porAlmacen } from './ayudas/comun.ts';

const MASCADA = 12000; // item 3 del catálogo sintético ($120.00)
const TARJETA = 5000; // la tarjeta de regalo del ejemplo ($50.00): menos que la compra, así el resto se paga en efectivo
const ADMIN = { rol: 'admin', usuario: 'Edgardo' } as never;

porAlmacen('La tarjeta de regalo es venta el día que se vende; pagar con ella no es venta otra vez', (alm) => {
  const carrito = (m: ReturnType<typeof nuevoMundo>['m'], items: ReturnType<typeof nuevoMundo>['items']) => {
    const caja = m.caja('DUO', 1);
    const cart = caja.abrirCarrito();
    caja.agregarLinea(cart, { item_id: items[2]!.item_id, qty: 1 });
    return { caja, cart };
  };

  it('VT1 tarjeta de $50 un día y compra de $120 pagada con ella y $70 en efectivo al siguiente: el día 1 vende $50, el día 2 solo $70, y todo cuadra en cada reporte', (t) => {
    const { m, items, limpiar } = nuevoMundo(alm, politica());
    t.after(limpiar);
    m.reloj.fijar('2026-10-01T15:00:00Z');
    const c = m.caja('DUO', 1);
    c.altaTarjetaRegalo({ codigo: 'TR-1', monto: TARJETA });
    m.pump();
    m.reloj.fijar('2026-10-02T15:00:00Z');
    const { cart } = carrito(m, items);
    const v = c.cobrarConTarjetaRegalo(cart, 'TR-1', MASCADA - TARJETA); // el saldo de la tarjeta ($50) se aplica primero y el resto ($70) en efectivo
    assert.deepEqual([canjeDeTarjetaRegalo(v.pagos), ventaDeTicket(v)], [TARJETA, MASCADA - TARJETA]);

    // el corte de cada día
    const d1 = c.corteEnVivo('2026-10-01');
    const d2 = c.corteEnVivo('2026-10-02');
    assert.deepEqual([d1.venta_total_dia, d1.ventas_netas, d1.tarjetas_regalo_vendidas], [TARJETA, TARJETA, TARJETA], 'día 1: la tarjeta vendida es venta');
    assert.deepEqual([d2.venta_total_dia, d2.ventas_netas, d2.cobros_tarjeta_regalo], [MASCADA - TARJETA, MASCADA - TARJETA, TARJETA], 'día 2: solo lo que no se pagó con la tarjeta');
    assert.equal(d2.ventas_mercancia, MASCADA, 'la mercancía vendida sigue siendo el ticket completo');

    // metas y consolidado: el mismo número, sin duplicar
    const dias = totalesPorDia(c.opsDe('sale.confirmed', 'sale.cancelled', 'return.registered'), 'DUO');
    assert.deepEqual([dias.get('2026-10-01'), dias.get('2026-10-02')], [TARJETA, MASCADA - TARJETA]);
    const r = reporteConsolidado(ADMIN, c.opsDe('sale.confirmed', 'sale.cancelled', 'return.registered'), { desde: '2026-10-01', hasta: '2026-10-02' });
    assert.equal(r.total, TARJETA + MASCADA - TARJETA, 'el dinero que entró: $50 de la tarjeta + $70 de la compra (= $120 de la mercancía), no $50 + $120');
    const porDia = (f: string) => r.filas.filter((x) => x.fecha_local === f).reduce((a, x) => a + x.venta_neta, 0);
    assert.deepEqual([porDia('2026-10-01'), porDia('2026-10-02')], [TARJETA, MASCADA - TARJETA]);
    const compra = r.filas.find((x) => x.folio === v.folio)!;
    assert.deepEqual([compra.total, compra.venta_neta], [MASCADA, MASCADA - TARJETA], 'el ticket muestra su total y la venta descuenta lo pagado con la tarjeta');
    const alta = r.filas.find((x) => x.vende_tarjeta_regalo)!;
    assert.deepEqual([alta.total, alta.venta_neta], [TARJETA, TARJETA]);
  });

  it('VT2 comprar con una tarjeta todo su saldo no registra venta: es solo un cobro', (t) => {
    const { m, items, limpiar } = nuevoMundo(alm, politica());
    t.after(limpiar);
    m.reloj.fijar('2026-10-01T15:00:00Z');
    const c = m.caja('DUO', 1);
    c.altaTarjetaRegalo({ codigo: 'TR-2', monto: MASCADA });
    m.pump();
    m.reloj.fijar('2026-10-02T15:00:00Z');
    const { cart } = carrito(m, items);
    c.cobrarConTarjetaRegalo(cart, 'TR-2', undefined);
    const d2 = c.corteEnVivo('2026-10-02');
    assert.deepEqual([d2.venta_total_dia, d2.ventas_netas, d2.tickets], [0, 0, 1]);
    assert.equal(c.corteEnVivo('2026-10-01').ventas_netas, MASCADA);
  });

  it('VT3 una devolución solo resta lo que no se reembolsó a una tarjeta de regalo; un cambio resta completo', () => {
    assert.equal(restaDeDevolucion({ importe: 10000, reembolsos: [{ metodo: 'efectivo', monto: 10000 }] }), 10000);
    assert.equal(restaDeDevolucion({ importe: 10000, reembolsos: [{ metodo: 'efectivo', monto: 6000 }, { metodo: 'tarjeta_regalo', monto: 4000 }] }), 6000);
    assert.equal(restaDeDevolucion({ importe: 10000, reembolsos: [] }), 10000, 'un cambio de mercancía: no sale dinero y el ticket nuevo cuenta completo');
    assert.equal(restaDeDevolucion({ importe: 10000 }), 10000);
  });

  it('VT4 lo pagado con tarjeta de regalo no se devuelve en dinero ni al devolver ni con «No hay cambio posible, devolver dinero»', (t) => {
    const { m, items, limpiar } = nuevoMundo(alm, politica());
    t.after(limpiar);
    const c = m.caja('DUO', 1);
    c.altaTarjetaRegalo({ codigo: 'TR-4', monto: MASCADA });
    m.pump();
    const { cart } = carrito(m, items);
    const v = c.cobrarConTarjetaRegalo(cart, 'TR-4', undefined);
    assert.throws(() => c.devolver({ sale_id: v.sale_id, renglones: [{ linea_id: v.lineas[0]!.linea_id, qty: 1 }], motivo: 'x' }), { codigo: 'DEVOLUCION_TARJETA_REGALO' });
    assert.equal(c.saldoTarjeta('TR-4'), 0);
    assert.equal(c.corteEnVivo('2026-10-01').folios_de_devolucion, 0, 'lo rechazado no deja devolución ni consume folio');
  });
});
