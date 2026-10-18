import assert from 'node:assert/strict';
import { it } from 'node:test';
import { ServicioAdmin } from '../src/app/servicio.ts';
import { existenciaAlmacen } from '../src/almacen.ts';
import { catalogo } from '../src/proyecciones.ts';
import { nuevoMundo, politica, porAlmacen, servicioDe } from './ayudas/comun.ts';

const ENC = ['CANTIDAD', 'DESCRIPCION', 'ESTILO', 'MARCA', 'CODIGO', 'PRECIO', 'LOTE', 'DEPARTAMENTO'];
const ENC_PED = [...ENC, 'PEDIMENTO'];

porAlmacen('Almacén: alta de lote, entregas y recepción en tienda', (alm) => {
  const admin = (ctx: ReturnType<typeof nuevoMundo>) => new ServicioAdmin({ central: ctx.m.central, actor: { rol: 'admin', usuario: 'galo' }, fuente: () => ctx.m.central.repo.ops(), cajas: [{ tienda: 'DUO', caja: 1 }, { tienda: 'LON', caja: 1 }] });

  it('A1 revisión: valida filas, detecta código existente y estilo repetido, sugiere departamentos y no guarda nada', (t) => {
    const ctx = nuevoMundo(alm, politica());
    t.after(ctx.limpiar);
    const a = admin(ctx);
    const existente = ctx.items[0]!; // LEVIS 726-
    const antes = ctx.m.central.repo.ops().length;
    const r = a.revisarAltaLote([
      ENC,
      [24, 'BLUSA', 'BT2988', 'CAPELLA', 202610001, 349, 20261014, 'mujer plus'],
      [10, 'JEANS', existente.estilo, existente.marca, '999000111', 899, '20261014', 'CABALLERO'],
      [5, 'JEANS', 'x', 'y', existente.codigo, 100, '1', 'CABALLERO'],
      [0, 'SIN CANTIDAD', 'e', 'm', '777', 100, '1', 'DAMA'],
      [3, 'SIN PRECIO', 'e', 'm', '778', 0, '1', 'DAMA'],
      [2, 'SIN CODIGO', 'e', 'm', '', 10, '1', 'DAMA'],
      [1, 'BOLSA DE REGALO', 'e', 'm', '779', 20, '1', 'Zapatos'],
    ]);
    assert.equal(ctx.m.central.repo.ops().length, antes, 'revisar no escribe nada');
    const [f1, f2, f3, f4, f5, f6, f7] = r.revision.filas;
    assert.deepEqual([f1!.estado, f1!.departamento, f1!.codigo], ['nuevo', 'Dama Plus', '202610001']);
    assert.equal(f2!.estado, 'nuevo');
    assert.ok(f2!.mismo_estilo.length >= 1 && f2!.avisos.some((x) => /mismo|este estilo/.test(x)));
    assert.deepEqual([f3!.estado, f3!.existente?.item_id], ['codigo_existente', existente.item_id]);
    assert.deepEqual([f4!.estado, f5!.estado, f6!.estado], ['invalido', 'invalido', 'invalido']);
    assert.equal(f7!.departamento, 'Envolturas y Bolsas de regalo');
    assert.deepEqual([r.revision.resumen.nuevos, r.revision.resumen.codigo_existente, r.revision.resumen.invalidos, r.revision.resumen.piezas], [3, 1, 3, 40]);
    assert.equal(r.revision.trae_pedimento, false);
    assert.ok(r.departamentos.some((g) => g.clave === 'mujer plus' && g.estado === 'alias'));
  });

  it('A2 alta de lote: artículos nuevos con Item # del central, piezas al almacén sin existencia en tiendas; reintentar no duplica', (t) => {
    const ctx = nuevoMundo(alm, politica());
    t.after(ctx.limpiar);
    const a = admin(ctx);
    const filas = [ENC_PED, [24, 'BLUSA', 'BT2988', 'CAPELLA', '202610001', 349, '20261014', 'DAMA', 'PED-1'], [30, 'PANTALON', '90332-', 'WAX JEAN', '202610002', 649, '20261014', 'Damma']];
    const n0 = catalogo(ctx.m.central.repo.ops()).size;
    const r = a.altaLote({ lote_id: 'L1', nombre: 'oct.xlsx', filas, decisiones: { damma: 'Dama' }, pedimento_lote: 'PED-LOTE' });
    assert.deepEqual([r.nuevos, r.sumados, r.piezas], [2, 0, 54]);
    ctx.m.pump();
    const ops = ctx.m.central.repo.ops();
    const cat = catalogo(ops);
    assert.equal(cat.size, n0 + 2);
    const nuevo = [...cat.values()].find((x) => x.codigo === '202610001')!;
    assert.deepEqual([nuevo.departamento, nuevo.precio, nuevo.lote], ['Dama', 34900, '20261014']);
    assert.ok(nuevo.item_no && /^\d+$/.test(nuevo.item_no));
    const ex = existenciaAlmacen(ops);
    assert.deepEqual([ex.get(nuevo.item_id)!.existencia, ex.get(nuevo.item_id)!.pedimentos], [24, ['PED-1']]);
    const otro = [...cat.values()].find((x) => x.codigo === '202610002')!;
    assert.deepEqual(ex.get(otro.item_id)!.pedimentos, ['PED-LOTE'], 'sin pedimento en la fila usa el del lote');
    for (const [t2, n] of [['DUO', 1], ['LON', 1]] as const) {
      assert.equal(ctx.m.caja(t2, n).stockLocal(nuevo.item_id), 0, 'las tiendas no reciben existencia');
      assert.ok(ctx.m.caja(t2, n).buscarPorCodigo('202610001').length === 1, 'pero el catálogo sí llega a las cajas');
    }
    a.altaLote({ lote_id: 'L1', nombre: 'oct.xlsx', filas, decisiones: { damma: 'Dama' } });
    assert.equal(catalogo(ctx.m.central.repo.ops()).size, n0 + 2);
    assert.equal(existenciaAlmacen(ctx.m.central.repo.ops()).get(nuevo.item_id)!.existencia, 24, 'reintento idempotente');
    // otra llegada del mismo código suma al artículo existente, con su propio pedimento
    a.altaLote({ lote_id: 'L2', filas: [ENC_PED, [6, 'BLUSA', 'BT2988', 'CAPELLA', '202610001', 349, '20261014', 'DAMA', 'PED-2']] });
    const e2 = existenciaAlmacen(ctx.m.central.repo.ops()).get(nuevo.item_id)!;
    assert.deepEqual([e2.existencia, e2.pedimentos], [30, ['PED-1', 'PED-2']]);
    assert.throws(() => a.altaLote({ lote_id: 'L3', filas: [ENC, [1, 'X', 'e', 'm', '', 1, '1', 'DAMA']] }), { codigo: 'ARCHIVO_INVALIDO' });
  });

  it('A3 alta manual: valida departamento y suma si el código existe', (t) => {
    const ctx = nuevoMundo(alm, politica());
    t.after(ctx.limpiar);
    const a = admin(ctx);
    const base = { cantidad: 5, codigo: 'M-1', marca: 'ACME', descripcion: 'CAMISA', estilo: 'C1', lote: 'L9', precio: 199.5, departamento: 'hombre' };
    assert.throws(() => a.altaManual({ ...base, departamento: 'Marte' }), { codigo: 'DEPARTAMENTO_INVALIDO' });
    assert.throws(() => a.altaManual({ ...base, cantidad: 0 }), { codigo: 'CANTIDAD_INVALIDA' });
    assert.throws(() => a.altaManual({ ...base, codigo: ' ' }), { codigo: 'DATOS_REQUERIDOS' });
    const r = a.altaManual({ ...base, lote_id: 'M1' });
    assert.deepEqual([r.nuevos, r.piezas], [1, 5]);
    const art = [...catalogo(ctx.m.central.repo.ops()).values()].find((x) => x.codigo === 'M-1')!;
    assert.deepEqual([art.departamento, art.precio], ['Caballero', 19950]);
    const r2 = a.altaManual({ ...base, cantidad: 2, lote_id: 'M2' });
    assert.deepEqual([r2.nuevos, r2.sumados], [0, 1]);
    assert.equal(existenciaAlmacen(ctx.m.central.repo.ops()).get(art.item_id)!.existencia, 7);
  });

  it('A4 entrega: exige etiquetas, avisa si excede, y la tienda recibe al confirmar (Almacén 0 / DÚO 12 / London 12)', (t) => {
    const ctx = nuevoMundo(alm, politica());
    t.after(ctx.limpiar);
    const a = admin(ctx);
    a.altaLote({ lote_id: 'L1', filas: [ENC, [24, 'BLUSA', 'BT2988', 'CAPELLA', '202610001', 349, '20261014', 'DAMA']] });
    const item = [...catalogo(ctx.m.central.repo.ops()).values()].find((x) => x.codigo === '202610001')!;
    const entrega = (extra: object) => a.entregarAlmacen({ item_id: item.item_id, destinos: { DUO: 12, LON: 12 }, etiqueta_precio: true, etiqueta_costura: true, ...extra });
    assert.throws(() => entrega({ etiqueta_costura: false }), { codigo: 'ETIQUETAS_PENDIENTES' });
    assert.throws(() => a.entregarAlmacen({ item_id: item.item_id, destinos: { DUO: 1.5 }, etiqueta_precio: true, etiqueta_costura: true }), { codigo: 'ENTREGA_INVALIDA' });
    assert.throws(() => a.entregarAlmacen({ item_id: item.item_id, destinos: {}, etiqueta_precio: true, etiqueta_costura: true }), { codigo: 'ENTREGA_INVALIDA' });
    assert.throws(() => entrega({ destinos: { DUO: 20, LON: 10 } }), (e: any) => e.codigo === 'CONFIRMACION_REQUERIDA' && e.detalle.disponible === 24 && e.detalle.pedido === 30);
    assert.equal(existenciaAlmacen(ctx.m.central.repo.ops()).get(item.item_id)!.existencia, 24, 'nada se movió');
    const r = entrega({ ref: 'E1' });
    assert.equal(r.existencia_almacen, 0);
    entrega({ ref: 'E1' }); // reintento con la misma referencia: no duplica
    ctx.m.pump();
    const fila = a.almacen().items.find((x) => x.item_id === item.item_id)!;
    assert.deepEqual([fila.existencia, fila.pendiente_por_tienda], [0, { DUO: 12, LON: 12 }]);
    // la tienda aún no tiene existencia hasta confirmar al escanear
    const s = servicioDe(ctx, 'DUO', 1);
    assert.equal(ctx.m.caja('DUO', 1).stockLocal(item.item_id), 0);
    const cart = s.svc.nuevaVenta();
    const esc = s.svc.escanear(cart, '202610001') as any;
    assert.equal(esc.recepcion.length, 1);
    assert.equal(esc.recepcion[0].qty, 12);
    assert.deepEqual(s.svc.recepcionesPendientes().map((x) => [x.qty, x.codigo]), [[12, '202610001']]);
    s.svc.confirmarRecepcion(esc.recepcion[0].entrega_id);
    assert.equal(ctx.m.caja('DUO', 1).stockLocal(item.item_id), 12);
    assert.throws(() => s.svc.confirmarRecepcion(esc.recepcion[0].entrega_id), { codigo: 'RECEPCION_INEXISTENTE' });
    assert.equal(s.svc.recepcionesPendientes().length, 0);
    ctx.m.pump(); ctx.m.pump();
    const f2 = a.almacen().items.find((x) => x.item_id === item.item_id)!;
    assert.deepEqual(f2.pendiente_por_tienda, { LON: 12 });
    const s2 = servicioDe(ctx, 'LON', 1);
    const esc2 = s2.svc.escanear(s2.svc.nuevaVenta(), '202610001') as any;
    s2.svc.confirmarRecepcion(esc2.recepcion[0].entrega_id);
    ctx.m.pump(); ctx.m.pump();
    assert.deepEqual([ctx.m.caja('LON', 1).stockLocal(item.item_id), a.almacen().items.find((x) => x.item_id === item.item_id)!.pendiente_por_tienda], [12, {}]);
    // exceso confirmado: queda registrado y el almacén queda en negativo
    const ex = entrega({ ref: 'E2', destinos: { DUO: 3 }, confirmar_exceso: true });
    assert.equal(ex.existencia_almacen, -3);
    assert.ok(existenciaAlmacen(ctx.m.central.repo.ops()).get(item.item_id)!.entregas.some((e) => e.exceso));
  });

  it('A5 recordatorio de sacar a piso: fecha por artículo, aviso agrupado, urgente a 7 días o menos y sin aviso al entregarse todo', (t) => {
    const ctx = nuevoMundo(alm, politica());
    t.after(ctx.limpiar);
    const a = admin(ctx);
    a.altaLote({ lote_id: 'L1', filas: [ENC, [24, 'BLUSA', 'B1', 'CAPELLA', '202610001', 349, '1', 'DAMA'], [12, 'PANTALON', 'P1', 'WAX', '202610002', 649, '1', 'DAMA'], [8, 'FALDA', 'F1', 'WAX', '202610003', 300, '1', 'DAMA']] });
    const id = (c: string) => [...catalogo(ctx.m.central.repo.ops()).values()].find((x) => x.codigo === c)!.item_id;
    const dia = (n: number) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);
    assert.deepEqual(a.almacen().avisos, []);
    assert.throws(() => a.fijarSacarAPiso(id('202610001'), '2026-02-31'), { codigo: 'FECHA_INVALIDA' });
    assert.throws(() => a.fijarSacarAPiso(id('202610001'), '12/11/2026'), { codigo: 'FECHA_INVALIDA' });
    assert.throws(() => a.fijarSacarAPiso('nada', dia(3)), { codigo: 'ARTICULO_INEXISTENTE' });
    a.fijarSacarAPiso(id('202610001'), dia(30));
    a.fijarSacarAPiso(id('202610002'), dia(5));
    const r = a.fijarSacarAPiso(id('202610003'), dia(5));
    assert.deepEqual(r.avisos.map((x) => [x.fecha, x.articulos, x.urgente]), [[dia(5), 2, true], [dia(30), 1, false]]);
    assert.equal(r.items.find((x) => x.codigo === '202610001')!.sacar_a_piso, dia(30));
    // pasada la fecha sigue urgente (vencido); la corrección de fecha reemplaza a la anterior
    a.fijarSacarAPiso(id('202610003'), dia(-2));
    assert.deepEqual(a.almacen().avisos.map((x) => [x.dias, x.urgente]), [[-2, true], [5, true], [30, false]]);
    // entregar todo lo del artículo lo saca del aviso; quitar la fecha también
    a.entregarAlmacen({ item_id: id('202610002'), destinos: { DUO: 12 }, etiqueta_precio: true, etiqueta_costura: true });
    a.fijarSacarAPiso(id('202610001'), null);
    assert.deepEqual(a.almacen().avisos.map((x) => x.dias), [-2]);
    // el recordatorio es interno: no llega a las tiendas
    ctx.m.pump();
    assert.equal(ctx.m.caja('DUO', 1).ops().some((o) => o.tipo === 'alm.recordatorio'), false);
  });
});
