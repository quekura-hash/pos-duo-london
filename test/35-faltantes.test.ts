import assert from 'node:assert/strict';
import { it } from 'node:test';
import { ServicioAdmin } from '../src/app/servicio.ts';
import { existenciaAlmacen, faltantes, reporteEntregas } from '../src/almacen.ts';
import { catalogo, stock } from '../src/proyecciones.ts';
import { nuevoMundo, politica, porAlmacen, servicioDe } from './ayudas/comun.ts';

const ENC = ['CANTIDAD', 'DESCRIPCION', 'ESTILO', 'MARCA', 'CODIGO', 'PRECIO', 'LOTE', 'DEPARTAMENTO'];

porAlmacen('Piezas faltantes en la recepción de una entrega', (alm) => {
  const preparar = (ctx: ReturnType<typeof nuevoMundo>) => {
    const a = new ServicioAdmin({ central: ctx.m.central, actor: { rol: 'admin', usuario: 'galo' }, fuente: () => ctx.m.central.repo.ops(), cajas: [{ tienda: 'DUO', caja: 1 }, { tienda: 'LON', caja: 1 }] });
    a.altaLote({ lote_id: 'L1', filas: [ENC, [24, 'BLUSA', 'BT2988', 'CAPELLA', '202610001', 349, '20261014', 'DAMA']] });
    const item = [...catalogo(ctx.m.central.repo.ops()).values()].find((x) => x.codigo === '202610001')!;
    a.entregarAlmacen({ item_id: item.item_id, destinos: { DUO: 12, LON: 12 }, etiqueta_precio: true, etiqueta_costura: true, ref: 'E1' });
    ctx.m.pump();
    return { a, item };
  };

  it('FA1 la tienda confirma otra cantidad: solo entra lo recibido y queda un faltante; cantidades inválidas se rechazan', (t) => {
    const ctx = nuevoMundo(alm, politica());
    t.after(ctx.limpiar);
    const { a, item } = preparar(ctx);
    const s = servicioDe(ctx, 'DUO', 1, 'Ana');
    const rec = (s.svc.escanear(s.svc.nuevaVenta(), '202610001') as any).recepcion[0];
    for (const q of [13, -1, 1.5]) assert.throws(() => s.svc.confirmarRecepcion(rec.entrega_id, q), { codigo: 'CANTIDAD_INVALIDA' });
    assert.equal(s.svc.recepcionesPendientes().length, 1, 'los rechazos no confirman nada');
    const r = s.svc.confirmarRecepcion(rec.entrega_id, 10);
    assert.deepEqual([r.qty, r.entregadas, r.faltan], [10, 12, 2]);
    assert.equal(ctx.m.caja('DUO', 1).stockLocal(item.item_id), 10);
    ctx.m.pump(); ctx.m.pump();
    const f = a.almacen().faltantes;
    assert.equal(f.length, 1);
    assert.deepEqual([f[0]!.tienda, f[0]!.entregadas, f[0]!.recibidas, f[0]!.faltan, f[0]!.pendiente, f[0]!.estado, f[0]!.reportada_por], ['DUO', 12, 10, 2, 2, 'pendiente', 'Ana']);
    // confirmar todo (o sin cantidad) no genera faltante
    const s2 = servicioDe(ctx, 'LON', 1, 'Luis');
    const rec2 = (s2.svc.escanear(s2.svc.nuevaVenta(), '202610001') as any).recepcion[0];
    s2.svc.confirmarRecepcion(rec2.entrega_id);
    ctx.m.pump(); ctx.m.pump();
    assert.equal(a.almacen().faltantes.length, 1);
    // el reporte de entregas lo marca como diferencia
    const rep = reporteEntregas(ctx.m.central.repo.ops(), catalogo(ctx.m.central.repo.ops()), {}, '2026-10-02');
    assert.ok(rep.diferencias.some((d) => d.tipo === 'faltante' && d.tienda === 'DUO' && d.piezas === 2));
  });

  it('FA2 ubicar faltantes: almacén y otra tienda suman existencia, perdidas solo se registran, se pueden corregir y no exceden lo faltante', (t) => {
    const ctx = nuevoMundo(alm, politica());
    t.after(ctx.limpiar);
    const { a, item } = preparar(ctx);
    const s = servicioDe(ctx, 'DUO', 1, 'Ana');
    const rec = (s.svc.escanear(s.svc.nuevaVenta(), '202610001') as any).recepcion[0];
    s.svc.confirmarRecepcion(rec.entrega_id, 8); // faltan 4
    ctx.m.pump(); ctx.m.pump();
    const alm0 = existenciaAlmacen(ctx.m.central.repo.ops()).get(item.item_id)!.existencia;
    assert.throws(() => a.resolverFaltante(rec.entrega_id, { almacen: 3, LON: 2 }), { codigo: 'EXCEDE_FALTANTE' });
    assert.throws(() => a.resolverFaltante(rec.entrega_id, { MARTE: 1 }), { codigo: 'DESTINO_INVALIDO' });
    assert.throws(() => a.resolverFaltante(rec.entrega_id, { almacen: -1 }), { codigo: 'CANTIDAD_INVALIDA' });
    assert.throws(() => a.resolverFaltante('no-existe', { almacen: 1 }), { codigo: 'FALTANTE_INEXISTENTE' });
    a.resolverFaltante(rec.entrega_id, { almacen: 1, LON: 2 });
    ctx.m.pump(); ctx.m.pump();
    const f = faltantes(ctx.m.central.repo.ops())[0]!;
    assert.deepEqual([f.pendiente, f.estado, f.ubicadas], [1, 'pendiente', { almacen: 1, LON: 2 }]);
    assert.equal(existenciaAlmacen(ctx.m.central.repo.ops()).get(item.item_id)!.existencia, alm0 + 1);
    assert.equal(ctx.m.caja('LON', 1).stockLocal(item.item_id), 2, 'la caja de London ve las piezas encontradas ahí');
    assert.equal(stock(ctx.m.central.repo.ops(), 'LON').get(item.item_id), 2);
    // corregir: las piezas de London eran de DÚO y una se perdió
    a.resolverFaltante(rec.entrega_id, { LON: 0, DUO: 2, perdida: 1 });
    ctx.m.pump(); ctx.m.pump();
    const g = faltantes(ctx.m.central.repo.ops())[0]!;
    assert.deepEqual([g.pendiente, g.estado, g.ubicadas], [0, 'resuelto', { almacen: 1, DUO: 2, perdida: 1 }]);
    assert.equal(ctx.m.caja('LON', 1).stockLocal(item.item_id), 0);
    assert.equal(ctx.m.caja('DUO', 1).stockLocal(item.item_id), 8 + 2);
    assert.equal(stock(ctx.m.central.repo.ops(), 'DUO').get(item.item_id), 10);
    // guardar lo mismo no duplica nada
    const n = ctx.m.central.repo.ops().length;
    a.resolverFaltante(rec.entrega_id, { almacen: 1, DUO: 2, perdida: 1 });
    assert.equal(ctx.m.central.repo.ops().length, n);
    // y ya no aparece como diferencia en el reporte
    const rep = reporteEntregas(ctx.m.central.repo.ops(), catalogo(ctx.m.central.repo.ops()), {}, '2026-10-02');
    assert.ok(!rep.diferencias.some((d) => d.tipo === 'faltante'));
  });
});
