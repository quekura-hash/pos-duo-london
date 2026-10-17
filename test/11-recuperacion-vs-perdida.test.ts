import assert from 'node:assert/strict';
import { it } from 'node:test';
import { consultarPerdidasDocumentales, declararPerdidaIrrecuperable } from '../src/administracion.ts';
import { detectar } from '../src/incidencias.ts';
import { perdidasDocumentales, stock, ventas } from '../src/proyecciones.ts';
import type { Actor } from '../src/tipos.ts';
import { nuevoMundo, politica, porAlmacen, vender, type Ctx } from './ayudas/comun.ts';

const admin: Actor = { rol: 'admin', usuario: 'galo' };
const evidencia = { tipo: 'corte_impreso', referencia: 'corte impreso DUO/1 del 2026-10-01, foto sintética' };

/** Caja 1 de DÚO pierde 3 piezas de mascada en una venta jamás replicada y se reconstruye. */
function perdidaConVenta(ctx: Ctx) {
  const { m, items } = ctx;
  const masc = items[2]!.item_id;
  m.caja('DUO', 1).iniciarArrendamiento();
  m.cortarLan('DUO', 1);
  vender(m, 'DUO', 1, masc, 3);
  m.perderDiscoCaja('DUO', 1);
  m.restablecerLan('DUO', 1);
  const inf = m.rehidratarCaja('DUO', 1);
  m.pump();
  m.pump();
  return { masc, inf, nueva: m.caja('DUO', 1) };
}

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

  it('RP5 [alternativa de ensayo P-14=permitir_con_aviso] se puede vender con existencia no verificada; la marca se conserva y se ve', (t) => {
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

  it('RP8 la pérdida de ventas/pagos/folios es un registro SEPARADO del inventario; el informe los distingue', (t) => {
    const ctx = nuevoMundo(alm, politica(ARR));
    t.after(ctx.limpiar);
    const { inf, nueva } = perdidaConVenta(ctx);
    assert.equal(inf.existencias.estado, 'no_verificadas');
    assert.equal(inf.documentos?.estado, 'perdida_posible_abierta');
    assert.notEqual(inf.existencias.verificacion_op, inf.documentos?.perdida_id, 'son dos registros distintos');
    const p = perdidasDocumentales(ctx.m.central.repo.ops());
    assert.equal(p.length, 1);
    assert.deepEqual([p[0]!.tienda, p[0]!.caja, p[0]!.estado], ['DUO', 1, 'abierta']);
    assert.deepEqual(p[0]!.folios_sin_evidencia, { desde: 1, hasta: 6 });
    assert.equal(nueva.perdidasDocumentalesAbiertas().length, 1);
    assert.ok(detectar(ctx.m.central.repo.ops()).some((i) => i.tipo === 'perdida_documental_abierta'));
  });

  it('RP9 un conteo físico de TODOS los artículos deja el inventario verificado pero NO cierra la pérdida documental', (t) => {
    const ctx = nuevoMundo(alm, politica(ARR));
    t.after(ctx.limpiar);
    const { nueva, masc } = perdidaConVenta(ctx);
    for (const it of ctx.items) nueva.contarFisico(it.item_id, it.item_id === masc ? 47 : (stock(nueva.ops(), 'DUO').get(it.item_id) ?? 0), 'almacenista');
    assert.equal(nueva.articulosNoVerificados().length, 0, 'inventario conciliado');
    assert.equal(nueva.existenciaVerificada(masc).saldo, 47);
    ctx.m.pump();
    ctx.m.pump();
    assert.equal(nueva.perdidasDocumentalesAbiertas().length, 1, 'la pérdida de la venta, el pago y el folio sigue abierta');
    assert.equal(perdidasDocumentales(ctx.m.central.repo.ops())[0]!.estado, 'abierta');
    assert.equal(ventas(ctx.m.central.repo.ops()).size, 0, 'la venta sigue sin existir en el sistema aunque el stock cuadre');
    assert.ok(detectar(ctx.m.central.repo.ops()).some((i) => i.tipo === 'perdida_documental_abierta'));
  });

  it('RP10 declarar la pérdida documental NO limpia el inventario: son cierres independientes y ninguno restablece ventas', (t) => {
    const ctx = nuevoMundo(alm, politica(ARR));
    t.after(ctx.limpiar);
    const { nueva, masc } = perdidaConVenta(ctx);
    const id = consultarPerdidasDocumentales(admin, ctx.m.central.repo.ops())[0]!.perdida_id;
    const op = declararPerdidaIrrecuperable(admin, ctx.m.central, { perdida_id: id, evidencia, nota: 'no se localizaron los tickets' });
    assert.match(op.payload.aviso, /no restablece ventas, pagos ni folios/);
    ctx.m.pump();
    ctx.m.pump();
    assert.equal(nueva.perdidasDocumentalesAbiertas().length, 0);
    const p = perdidasDocumentales(ctx.m.central.repo.ops())[0]!;
    assert.equal(p.estado, 'declarada_irrecuperable', 'no se llama "recuperada": se declara irrecuperable');
    assert.equal(p.resolucion?.usuario, 'galo');
    assert.equal(nueva.existenciaVerificada(masc).verificada, false, 'el inventario sigue sin verificar hasta contarlo');
    assert.equal(ventas(ctx.m.central.repo.ops()).size, 0);
    assert.equal(detectar(ctx.m.central.repo.ops()).filter((i) => i.tipo === 'perdida_documental_abierta').length, 0);
  });

  it('RP11 la declaración exige Administración, pérdida existente y abierta, evidencia y nota', (t) => {
    const ctx = nuevoMundo(alm, politica(ARR));
    t.after(ctx.limpiar);
    perdidaConVenta(ctx);
    const id = perdidasDocumentales(ctx.m.central.repo.ops())[0]!.perdida_id;
    const cajero: Actor = { rol: 'cajero', usuario: 'c', tienda: 'DUO', caja: 1 };
    assert.throws(() => consultarPerdidasDocumentales(cajero, ctx.m.central.repo.ops()), { codigo: 'PROHIBIDO' });
    assert.throws(() => declararPerdidaIrrecuperable(cajero, ctx.m.central, { perdida_id: id, evidencia, nota: 'x' }), { codigo: 'PROHIBIDO' });
    assert.throws(() => declararPerdidaIrrecuperable(admin, ctx.m.central, { perdida_id: 'no-existe', evidencia, nota: 'x' }), { codigo: 'PERDIDA_INEXISTENTE' });
    assert.throws(() => declararPerdidaIrrecuperable(admin, ctx.m.central, { perdida_id: id, evidencia: { tipo: 'x', referencia: ' ' }, nota: 'x' }), { codigo: 'EVIDENCIA_REQUERIDA' });
    assert.throws(() => declararPerdidaIrrecuperable(admin, ctx.m.central, { perdida_id: id, evidencia, nota: '' }), { codigo: 'MOTIVO_REQUERIDO' });
    declararPerdidaIrrecuperable(admin, ctx.m.central, { perdida_id: id, evidencia, nota: 'ok' });
    assert.throws(() => declararPerdidaIrrecuperable(admin, ctx.m.central, { perdida_id: id, evidencia, nota: 'otra' }), { codigo: 'PERDIDA_YA_RESUELTA' });
  });

  it('RP12 el corte de la caja afectada muestra la pérdida documental abierta aunque el inventario ya esté contado', (t) => {
    const ctx = nuevoMundo(alm, politica(ARR));
    t.after(ctx.limpiar);
    const { nueva } = perdidaConVenta(ctx);
    nueva.recuperarFolios();
    for (const it of ctx.items) nueva.contarFisico(it.item_id, nueva.existenciaVerificada(it.item_id).saldo, 'a');
    vender(ctx.m, 'DUO', 1, ctx.items[2]!.item_id, 1);
    const corte = nueva.generarCorte('2026-10-01');
    assert.equal(corte.perdida_documental_abierta.length, 1);
    assert.equal(ctx.m.caja('DUO', 2).generarCorte('2026-10-01').perdida_documental_abierta.length, 0, 'la otra caja no tiene pérdida propia');
  });

  it('RP13 [P-14 en ensayo] vender con existencia no verificada: la alternativa "permitir_con_aviso" avisa y la de bloqueo lo impide', (t) => {
    const a = nuevoMundo(alm, politica({ ...ARR, P14_venta_con_inventario_no_verificado: 'permitir_con_aviso' }));
    const b = nuevoMundo(alm, politica({ ...ARR, P14_venta_con_inventario_no_verificado: 'bloquear_articulo_no_verificado' }));
    t.after(() => { a.limpiar(); b.limpiar(); });
    for (const ctx of [a, b]) {
      const masc = ctx.items[2]!.item_id;
      ctx.m.caja('DUO', 1).iniciarArrendamiento();
      ctx.m.perderDiscoCaja('DUO', 1);
      ctx.m.rehidratarCaja('DUO', 1);
      ctx.m.caja('DUO', 1).recuperarFolios();
      const c = ctx.m.caja('DUO', 1);
      const cart = c.abrirCarrito();
      const l = c.agregarLinea(cart, { item_id: masc, qty: 1 });
      if (ctx === a) {
        const v = c.cobrar(cart, [{ metodo: 'efectivo', monto: l.importe }]);
        assert.deepEqual(v.avisos, [`inventario_no_verificado:${masc}`]);
      } else {
        assert.throws(() => c.cobrar(cart, [{ metodo: 'efectivo', monto: l.importe }]), { codigo: 'INVENTARIO_NO_VERIFICADO' });
        assert.equal(c.estadoFolios().ultimo >= 0, true);
        c.contarFisico(masc, 50, 'a'); // tras contar ese artículo, sí se puede vender
        assert.ok(c.cobrar(cart, [{ metodo: 'efectivo', monto: l.importe }]).folio > 0);
      }
    }
  });
});
