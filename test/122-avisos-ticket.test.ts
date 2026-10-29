import assert from 'node:assert/strict';
import { it } from 'node:test';
import { AVISO_VENTA_FINAL, AVISO_VESTIDO_NOCHE, avisosGrandes, construirTicket, renderTicketEscPos, renderTicketTexto } from '../src/ticket.ts';
import { nuevoMundo, politica, porAlmacen, vender } from './ayudas/comun.ts';

const GS_DOBLE = [0x1d, 0x21, 0x11];
const contiene = (b: Uint8Array, patron: number[]) => b.some((_, i) => patron.every((x, j) => b[i + j] === x));

porAlmacen('Avisos en letras grandes del ticket: vestido de noche y venta final con descuento', (alm) => {
  it('AT1 avisosGrandes: vestido de noche, cualquier descuento, ambos, ninguno; la tarjeta de regalo no cuenta', () => {
    const l = (departamento: string, descuento = 0, tarjeta = false) => ({ departamento, descuento, ...(tarjeta ? { tarjeta_regalo: { codigo: 'x', tipo: 'alta' as const } } : {}) }) as never;
    assert.deepEqual(avisosGrandes({ lineas: [l('Dama')] }), []);
    assert.deepEqual(avisosGrandes({ lineas: [l('Vestidos de noche')] }), [AVISO_VESTIDO_NOCHE]);
    assert.deepEqual(avisosGrandes({ lineas: [l('VESTIDOS DE NOCHE')] }), [AVISO_VESTIDO_NOCHE], 'mayúsculas');
    assert.deepEqual(avisosGrandes({ lineas: [l('Dama', 5000)] }), [AVISO_VENTA_FINAL]);
    assert.deepEqual(avisosGrandes({ lineas: [l('Dama'), l('Vestidos de noche', 100)] }), [AVISO_VESTIDO_NOCHE, AVISO_VENTA_FINAL]);
  });

  it('AT2 un ticket real: sin descuento ni vestido no lleva avisos; con descuento dice VENTA FINAL en letras grandes (ESC/POS) y en el texto', (t) => {
    const ctx = nuevoMundo(alm, politica());
    t.after(ctx.limpiar);
    const normal = construirTicket(vender(ctx.m, 'DUO', 1, ctx.items[0]!.item_id).venta);
    assert.equal(normal.avisos_grandes, undefined);
    assert.doesNotMatch(renderTicketTexto(normal), /VENTA FINAL/);
    assert.equal(contiene(renderTicketEscPos(normal), GS_DOBLE), false, 'sin avisos no hay doble tamaño');
    const conDesc = construirTicket(vender(ctx.m, 'DUO', 1, ctx.items[0]!.item_id, 1, { descuento: 1000 }).venta);
    assert.deepEqual(conDesc.avisos_grandes, [AVISO_VENTA_FINAL]);
    const txt = renderTicketTexto(conDesc);
    assert.match(txt, /VENTA FINAL NO CAMBIOS NI DEVOLUCIONES/);
    assert.ok(txt.indexOf('VENTA FINAL') < txt.indexOf('PÓLIZA DE DEVOLUCIÓN'), 'va antes de la póliza');
    const bytes = renderTicketEscPos(conDesc);
    assert.ok(contiene(bytes, GS_DOBLE), 'doble tamaño (GS ! 0x11)');
    assert.ok(contiene(bytes, [0x1d, 0x21, 0x00]), 'y vuelve a tamaño normal');
    // se imprime en renglones de media columna (24): «VENTA FINAL NO CAMBIOS» / «NI DEVOLUCIONES»
    assert.ok(Buffer.from(bytes).toString('latin1').includes('VENTA FINAL NO CAMBIOS\nNI DEVOLUCIONES'));
  });

  it('AT3 el aviso de vestido de noche sale con el texto pedido, y con los dos avisos salen los dos; la reimpresión conserva los avisos', (t) => {
    const ctx = nuevoMundo(alm, politica());
    t.after(ctx.limpiar);
    const v = vender(ctx.m, 'DUO', 1, ctx.items[0]!.item_id, 1, { descuento: 500 }).venta;
    const noche = { ...v, lineas: v.lineas.map((x) => ({ ...x, departamento: 'Vestidos de noche' })) };
    const tk = construirTicket(noche);
    assert.deepEqual(tk.avisos_grandes, [AVISO_VESTIDO_NOCHE, AVISO_VENTA_FINAL]);
    const txt = renderTicketTexto(tk);
    assert.match(txt, /EN VESTIDO DE NOCHE NO HAY CAMBIOS NI\s+DEVOLUCIONES|EN VESTIDO DE NOCHE NO HAY CAMBIOS NI DEVOLUCIONES/);
    assert.match(txt, /VENTA FINAL NO CAMBIOS NI DEVOLUCIONES/);
    assert.deepEqual(construirTicket(noche, undefined, 1).avisos_grandes, [AVISO_VESTIDO_NOCHE, AVISO_VENTA_FINAL]);
  });
});
