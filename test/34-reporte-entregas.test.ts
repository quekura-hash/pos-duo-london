import assert from 'node:assert/strict';
import { it } from 'node:test';
import { ServicioAdmin } from '../src/app/servicio.ts';
import { reporteEntregas } from '../src/almacen.ts';
import { hojaEntregas } from '../src/inventario.ts';
import { catalogo } from '../src/proyecciones.ts';
import { nuevoMundo, politica, porAlmacen, servicioDe } from './ayudas/comun.ts';

const ENC = ['CANTIDAD', 'DESCRIPCION', 'ESTILO', 'MARCA', 'CODIGO', 'PRECIO', 'LOTE', 'DEPARTAMENTO'];

porAlmacen('Reporte de entregas y diferencias de almacén', (alm) => {
  it('RE1 entregas por periodo y tienda, confirmadas/pendientes, diferencias (sin confirmar, exceso, almacén negativo) y Excel', (t) => {
    const ctx = nuevoMundo(alm, politica());
    t.after(ctx.limpiar);
    const a = new ServicioAdmin({ central: ctx.m.central, actor: { rol: 'admin', usuario: 'galo' }, fuente: () => ctx.m.central.repo.ops(), cajas: [{ tienda: 'DUO', caja: 1 }, { tienda: 'LON', caja: 1 }] });
    a.altaLote({ lote_id: 'L1', filas: [ENC, [24, 'BLUSA', 'BT2988', 'CAPELLA', '202610001', 349, '20261014', 'DAMA'], [10, 'PANTALON', 'P1', 'WAX', '202610002', 649, '20261014', 'DAMA']] });
    const id = (c: string) => [...catalogo(ctx.m.central.repo.ops()).values()].find((x) => x.codigo === c)!.item_id;
    const dia1 = ctx.m.reloj.now().slice(0, 10); // 2026-10-01
    a.entregarAlmacen({ item_id: id('202610001'), destinos: { DUO: 12, LON: 6 }, etiqueta_precio: true, etiqueta_costura: true, ref: 'E1' });
    ctx.m.pump();
    // DÚO confirma el mismo día
    const s = servicioDe(ctx, 'DUO', 1, 'Ana');
    const esc = s.svc.escanear(s.svc.nuevaVenta(), '202610001') as any;
    s.svc.confirmarRecepcion(esc.recepcion[0].entrega_id);
    ctx.m.pump(); ctx.m.pump();
    // cuatro días después: entrega con exceso (el almacén queda en negativo)
    ctx.m.reloj.avanzar(4 * 86400_000);
    a.entregarAlmacen({ item_id: id('202610002'), destinos: { DUO: 12 }, etiqueta_precio: true, etiqueta_costura: true, ref: 'E2', confirmar_exceso: true });
    ctx.m.pump();
    const ops = ctx.m.central.repo.ops();
    const cat = catalogo(ops);
    const hoy = '2026-10-05';
    const r = reporteEntregas(ops, cat, {}, hoy);
    assert.deepEqual([r.resumen.entregas, r.resumen.piezas, r.resumen.confirmadas, r.resumen.pendientes, r.resumen.piezas_pendientes, r.resumen.con_exceso], [3, 30, 1, 2, 18, 1]);
    assert.deepEqual(r.porTienda.map((x) => [x.tienda, x.entregas, x.piezas, x.pendientes]), [['DUO', 2, 24, 1], ['LON', 1, 6, 1]]);
    const lon = r.filas.find((f) => f.tienda === 'LON')!;
    assert.deepEqual([lon.estado, lon.dias_espera, lon.fecha_local], ['pendiente', 4, dia1]);
    const duo = r.filas.find((f) => f.tienda === 'DUO' && f.codigo === '202610001')!;
    assert.deepEqual([duo.estado, duo.dias_espera, duo.recibida_por], ['confirmada', 0, 'Ana']);
    const tipos = r.diferencias.map((d) => [d.tipo, d.tienda, d.codigo]).sort();
    assert.deepEqual(tipos, [['almacen_negativo', null, '202610002'], ['exceso', 'DUO', '202610002'], ['sin_confirmar', 'LON', '202610001']].sort());
    // la entrega del día 5 aún no cumple los días mínimos
    assert.ok(!r.diferencias.some((d) => d.tipo === 'sin_confirmar' && d.codigo === '202610002'));
    // filtros: periodo y tienda (las diferencias de una tienda no incluyen el almacén)
    assert.equal(reporteEntregas(ops, cat, { desde: '2026-10-05', hasta: '2026-10-05' }, hoy).resumen.entregas, 1);
    assert.equal(reporteEntregas(ops, cat, { desde: '2026-10-02', hasta: '2026-10-04' }, hoy).resumen.entregas, 0);
    const soloLon = reporteEntregas(ops, cat, { tienda: 'LON' }, hoy);
    assert.deepEqual([soloLon.resumen.entregas, soloLon.diferencias.map((d) => d.tipo)], [1, ['sin_confirmar']]);
    // servicio y hoja de Excel
    const viva = a.entregasAlmacen({ tienda: 'DUO' });
    assert.equal(viva.filas.length, 2);
    const hoja = hojaEntregas(r);
    assert.equal(hoja.filas.length, 3 + 2 + 3 + 3, 'detalle, total, sección de diferencias y sus 3 renglones');
    assert.ok(hoja.filas.some((f) => f[0] === 'DIFERENCIAS'));
    assert.ok(hoja.filas.some((f) => f[0] === 'Almacén negativo'));
  });
});
