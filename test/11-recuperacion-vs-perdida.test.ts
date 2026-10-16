import assert from 'node:assert/strict';
import { it } from 'node:test';
import { stock, ventas } from '../src/proyecciones.ts';
import { nuevoMundo, politica, porAlmacen, vender } from './ayudas/comun.ts';

const ARR = { P06_huecos_de_folio: 'aceptados' as const, K_folios: 6 };

porAlmacen('Recuperación con movimientos disponibles vs. operaciones nunca replicadas', (alm) => {
  it('RP1 se recuperan TODOS los movimientos disponibles y se separa lo perdido, que queda marcado', (t) => {
    const { m, items, limpiar } = nuevoMundo(alm, politica(ARR));
    t.after(limpiar);
    const [, , masc, bolsa] = items.map((i) => i.item_id);
    m.caja('DUO', 1).iniciarArrendamiento();
    // lo que SÍ llegó al hub: 2 ventas de DUO/1 y 3 de DUO/2
    vender(m, 'DUO', 1, masc!, 1);
    vender(m, 'DUO', 1, masc!, 2);
    vender(m, 'DUO', 2, masc!, 3);
    vender(m, 'DUO', 2, bolsa!, 1);
    vender(m, 'DUO', 2, masc!, 1);
    m.pump();
    const movHub = m.hub('DUO').repo.ops().filter((o) => o.tipo === 'inv.movement' && o.payload.tipo !== 'existencia_inicial').length;
    // lo que NO llegó: 2 ventas de DUO/1 (folios 3 y 4) con el enlace cortado
    m.cortarLan('DUO', 1);
    vender(m, 'DUO', 1, masc!, 4);
    vender(m, 'DUO', 1, masc!, 2);
    const nueva = m.perderDiscoCaja('DUO', 1);
    m.restablecerLan('DUO', 1);

    const inf = m.rehidratarCaja('DUO', 1);
    // clase 1: recuperable
    assert.equal(inf.recuperado.movimientos, movHub + 4 /*existencias iniciales DUO*/, 'todos los movimientos de la tienda que existen en el hub');
    assert.equal(inf.recuperado.operaciones_propias, 2, 'las 2 ventas propias que sí llegaron');
    assert.deepEqual(inf.fuentes, ['hub', 'central']);
    // clase 2: nunca replicado — contenido desconocido, con la evidencia disponible
    assert.equal(inf.no_replicado.contenido, 'desconocido');
    assert.equal(inf.no_replicado.evidencia, 'techo_de_folios');
    assert.deepEqual(inf.no_replicado.folios_sin_evidencia, { desde: 3, hasta: 6 }, 'folios que pudieron existir y no hay rastro de ellos');
    // la existencia queda marcada, para toda la tienda
    assert.equal(inf.existencias.estado, 'no_verificadas');
    assert.equal(nueva.articulosNoVerificados().length, items.length);
    assert.equal(nueva.existenciaVerificada(masc!).verificada, false);
    assert.equal(nueva.existenciaVerificada(masc!).saldo, 50 - (1 + 2 + 3 + 1), 'saldo según lo verificable; las 6 piezas perdidas no están');
  });

  it('RP2 sin techo de folios no hay ni rango: la evidencia es "ninguna" y la existencia igual queda marcada', (t) => {
    const { m, items, limpiar } = nuevoMundo(alm, politica({ P06_huecos_de_folio: 'no_aceptados' }));
    t.after(limpiar);
    m.cortarLan('DUO', 1);
    vender(m, 'DUO', 1, items[2]!.item_id, 2);
    const nueva = m.perderDiscoCaja('DUO', 1);
    m.restablecerLan('DUO', 1);
    const inf = m.rehidratarCaja('DUO', 1);
    assert.equal(inf.no_replicado.evidencia, 'ninguna');
    assert.equal(inf.no_replicado.folios_sin_evidencia, null);
    assert.equal(nueva.existenciaVerificada(items[2]!.item_id).verificada, false);
  });

  it('RP3 un conteo físico ajusta por movimiento y limpia SOLO ese artículo; la marca llega a la otra caja y al central', (t) => {
    const { m, items, limpiar } = nuevoMundo(alm, politica(ARR));
    t.after(limpiar);
    const [, , masc, bolsa] = items.map((i) => i.item_id);
    m.caja('DUO', 1).iniciarArrendamiento();
    m.cortarLan('DUO', 1);
    vender(m, 'DUO', 1, masc!, 4); // se perderá
    const nueva = m.perderDiscoCaja('DUO', 1);
    m.restablecerLan('DUO', 1);
    m.rehidratarCaja('DUO', 1);
    m.pump();
    assert.equal(m.caja('DUO', 2).existenciaVerificada(masc!).verificada, false, 'la otra caja también ve la marca');
    assert.ok(m.central.repo.ops().some((o) => o.tipo === 'inv.verificacion_pendiente'));
    // se cuenta la mascada: hay 46 (50 − las 4 perdidas)
    const r = nueva.contarFisico(masc!, 46, 'almacenista');
    assert.deepEqual(r, { saldo_previo: 50, delta: -4 });
    assert.equal(nueva.existenciaVerificada(masc!).verificada, true);
    assert.equal(nueva.existenciaVerificada(masc!).saldo, 46);
    assert.equal(nueva.existenciaVerificada(bolsa!).verificada, false, 'los demás siguen sin verificar');
    m.pump();
    m.pump();
    assert.equal(stock(m.central.repo.ops(), 'DUO').get(masc!), 46);
    assert.equal(m.caja('DUO', 2).existenciaVerificada(masc!).verificada, true);
    // contar de nuevo no suma: "contar 10 deja 10"
    assert.deepEqual(nueva.contarFisico(masc!, 46, 'almacenista'), { saldo_previo: 46, delta: 0 });
  });

  it('RP4 una nueva pérdida posterior vuelve a marcar aunque el artículo ya se hubiera contado', (t) => {
    const { m, items, limpiar } = nuevoMundo(alm, politica(ARR));
    t.after(limpiar);
    const masc = items[2]!.item_id;
    m.perderDiscoCaja('DUO', 1);
    const c = m.caja('DUO', 1);
    m.rehidratarCaja('DUO', 1);
    c.contarFisico(masc, 50, 'a');
    assert.equal(c.existenciaVerificada(masc).verificada, true);
    m.perderDiscoCaja('DUO', 1);
    m.rehidratarCaja('DUO', 1);
    assert.equal(m.caja('DUO', 1).existenciaVerificada(masc).verificada, false);
  });

  it('RP5 las ventas siguen permitidas con existencia no verificada, pero la marca se conserva y se ve', (t) => {
    const { m, items, limpiar } = nuevoMundo(alm, politica(ARR));
    t.after(limpiar);
    const masc = items[2]!.item_id;
    m.caja('DUO', 1).iniciarArrendamiento();
    m.perderDiscoCaja('DUO', 1);
    m.rehidratarCaja('DUO', 1);
    m.caja('DUO', 1).recuperarFolios();
    const v = vender(m, 'DUO', 1, masc, 1).venta;
    assert.ok(v.folio > 0);
    assert.equal(m.caja('DUO', 1).existenciaVerificada(masc).verificada, false);
  });

  it('RP6 hub reconstruido: recupera del central y de lo que las cajas conservan; sin pérdida en cajas no hay existencias dudosas', (t) => {
    const { m, items, limpiar } = nuevoMundo(alm, politica(ARR));
    t.after(limpiar);
    const masc = items[2]!.item_id;
    m.caja('DUO', 1).iniciarArrendamiento();
    m.cortarLan('DUO', 2); // el hub no puede relevar a la caja 2
    vender(m, 'DUO', 1, masc, 2);
    m.pump(); // llega al hub y al central; el relevo a la caja 2 queda pendiente en el hub
    m.cortarInternet('DUO');
    vender(m, 'DUO', 1, masc, 1);
    m.pump(); // llega al hub, NO al central
    const hub2 = m.perderDiscoHub('DUO'); // se pierde el hub, su cola de relevo y la venta que solo él tenía
    m.restablecerLan('DUO', 2);
    m.restablecerInternet('DUO');
    const inf = m.rehidratarHub('DUO');
    assert.deepEqual(inf.fuentes, ['central']);
    assert.equal(hub2.repo.kvGet('techo:1'), 6, 'el techo de folios se restaura desde el central');
    assert.equal(inf.reenviadas_por_cajas, 2, 'la caja 1 conserva la venta (y su movimiento) que el central no tenía');
    assert.equal(inf.no_replicado.alcance, 'operaciones_originadas_solo_en_el_hub');
    assert.equal(inf.existencias.estado, 'verificables_si_las_cajas_reenvian');
    m.pump();
    m.pump();
    assert.equal(stock(m.hub('DUO').repo.ops(), 'DUO').get(masc), 47);
    assert.equal(stock(m.central.repo.ops(), 'DUO').get(masc), 47);
    assert.equal(m.caja('DUO', 2).stockLocal(masc), 47, 'el relevo perdido a la caja 2 se reconstruyó');
    assert.equal(m.caja('DUO', 2).articulosNoVerificados().length, 0, 'sin marcas innecesarias');
  });

  it('RP7 hub reconstruido cuando una caja TAMBIÉN perdió su disco: lo que solo ambos tenían es irrecuperable y se marca', (t) => {
    const { m, items, limpiar } = nuevoMundo(alm, politica(ARR));
    t.after(limpiar);
    const masc = items[2]!.item_id;
    m.caja('DUO', 1).iniciarArrendamiento();
    m.cortarInternet('DUO');
    vender(m, 'DUO', 1, masc, 3);
    m.pump(); // solo el hub y la caja 1 la tienen
    m.perderDiscoHub('DUO');
    m.perderDiscoCaja('DUO', 1);
    m.restablecerInternet('DUO');
    const inf = m.rehidratarHub('DUO');
    assert.equal(inf.no_replicado.alcance, 'operaciones_del_hub_y_de_cajas_perdidas');
    assert.equal(inf.existencias.estado, 'no_verificadas');
    m.rehidratarCaja('DUO', 1);
    m.pump();
    m.pump();
    // El MOVIMIENTO sobrevive porque la caja 2 lo había recibido y lo reenvía; el REGISTRO de la venta (folio, pagos) no.
    assert.equal(stock(m.hub('DUO').repo.ops(), 'DUO').get(masc), 47);
    assert.equal(m.caja('DUO', 1).existenciaVerificada(masc).saldo, 47);
    assert.equal(ventas(m.central.repo.ops()).size, 0, 'la venta y su folio se perdieron');
    assert.equal(m.caja('DUO', 1).existenciaVerificada(masc).verificada, false, 'la marca se conserva: puede haber más operaciones perdidas');
  });
});
