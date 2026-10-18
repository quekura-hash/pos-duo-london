import assert from 'node:assert/strict';
import { it } from 'node:test';
import { ServicioAdmin } from '../src/app/servicio.ts';
import { descuentosPorCaja } from '../src/consultas.ts';
import { nuevoMundo, politica, porAlmacen, servicioDe } from './ayudas/comun.ts';

porAlmacen('Reporte de promociones y descuentos autorizados por supervisor', (alm) => {
  it('RD1 separa promociones, cupones y descuentos de cada supervisor; las ventas canceladas no suman', async (t) => {
    const ctx = nuevoMundo(alm, politica());
    t.after(ctx.limpiar);
    const a = new ServicioAdmin({ central: ctx.m.central, actor: { rol: 'admin', usuario: 'galo' }, fuente: () => ctx.m.central.repo.ops(), cajas: [{ tienda: 'DUO', caja: 1 }, { tienda: 'LON', caja: 1 }] });
    a.guardarSupervisor({ nombre: 'Ana Supervisora', clave: '1111' });
    a.guardarSupervisor({ nombre: 'Beto Supervisor', clave: '2222' });
    a.guardarPromocion({ id: '', tipo: 'nxm', nombre: '2x1 jeans', activa: true, tiendas: ['DUO'], inicio: null, fin: null, lleva: 2, paga: 1, alcance: { departamentos: [], palabras: ['jeans'], item_ids: [] } });
    a.guardarPromocion({ id: '', tipo: 'cupon', nombre: 'Cupón 10 %', activa: true, tiendas: ['DUO'], inicio: null, fin: null, codigo: 'DIEZ', pct: 10 });
    ctx.m.pump();
    const s = servicioDe(ctx, 'DUO', 1);
    const venta = (codigos: string[], extra?: (c: string, lin: string) => void) => {
      const c = s.svc.nuevaVenta();
      let lin = '';
      for (const k of codigos) lin = (s.svc.escanear(c, k) as any).linea.linea_id;
      extra?.(c, lin);
      return c;
    };
    const cobrar = async (c: string) => (await s.svc.cobrarEfectivo(c, 500000, 0)).venta;
    // 1) 2x1 en dos jeans ($899 de descuento)
    const v1 = await cobrar(venta(['0002026090782', '0002026090799']));
    // 2) cupón 10 % sobre la mascada de $120 = $12
    const v2 = await cobrar(venta(['7501234567890'], (c) => { s.svc.aplicarCupon(c, 'DIEZ'); }));
    // 3) Ana: 50 % a la mascada ($60)   4) Beto: 100 % a toda la venta de la mascada ($120)
    const v3 = await cobrar(venta(['7501234567890'], (c, lin) => { s.svc.aplicarDescuento(c, { linea_id: lin, tipo: 'pct', valor: 50 }, '1111'); }));
    const v4 = await cobrar(venta(['7501234567890'], (c) => { s.svc.aplicarDescuento(c, { tipo: 'pct', valor: 100 }, '2222'); }));
    // 5) otro cupón en una venta que luego se cancela: no debe sumar
    const v5 = await cobrar(venta(['7501234567890'], (c) => { s.svc.aplicarCupon(c, 'DIEZ'); }));
    s.svc.cancelarVenta(v5.sale_id, 'prueba');
    ctx.m.pump(); ctx.m.pump();

    const r = a.descuentos();
    assert.deepEqual(r.resumen.promo, { tickets: 1, monto: 89900 });
    assert.deepEqual(r.resumen.cupon, { tickets: 1, monto: 1200 }, 'el cupón de la venta cancelada no cuenta');
    assert.deepEqual(r.resumen.manual, { tickets: 2, monto: 6000 + 12000 });
    assert.deepEqual([r.resumen.tickets, r.resumen.monto], [4, 89900 + 1200 + 18000]);
    assert.deepEqual(r.porSupervisor.map((x) => [x.supervisor, x.monto, x.mayor_pct_bp, x.al_100]), [['Beto Supervisor', 12000, 10000, 1], ['Ana Supervisora', 6000, 5000, 0]]);
    assert.deepEqual(r.porPromocion.map((x) => [x.tipo, x.concepto, x.tickets, x.monto]), [['promo', '2x1 jeans', 1, 89900], ['cupon', 'Cupón 10 %', 1, 1200]]);
    const cancelada = r.filas.find((f) => f.sale_id === v5.sale_id)!;
    assert.deepEqual([cancelada.estado, cancelada.tipo, cancelada.monto], ['cancelada', 'cupon', 1200]);
    const d3 = r.filas.find((f) => f.sale_id === v3.sale_id)!;
    assert.deepEqual([d3.supervisor, d3.importe_venta, d3.monto, d3.pct_bp, d3.folio], ['Ana Supervisora', 12000, 6000, 5000, v3.folio]);
    assert.equal(r.filas.find((f) => f.sale_id === v1.sale_id)!.pct_bp, 5000, 'la mitad de dos jeans iguales');
    assert.equal(r.filas.find((f) => f.sale_id === v2.sale_id)!.supervisor, null);
    assert.equal(r.filas.find((f) => f.sale_id === v4.sale_id)!.pct_bp, 10000);

    // filtros: otro periodo o una caja sin ventas no trae nada
    assert.equal(a.descuentos({ desde: '2030-01-01' }).filas.length, 0);
    assert.equal(a.descuentos({ cajas: [{ tienda: 'LON', caja: 1 }] }).filas.length, 0);
    assert.equal(descuentosPorCaja({ rol: 'admin', usuario: 'x' }, ctx.m.central.repo.ops(), { desde: '2026-10-01', hasta: '2026-10-01' }).filas.length, r.filas.length);

    // Excel: importes exactos como texto y el total sin cancelados
    const hoja = a.hojaDescuentos();
    assert.deepEqual(hoja.encabezados.slice(6, 11), ['Tipo', 'Concepto', 'Supervisor que autorizó', 'Importe de la venta', 'Descuento']);
    const total = hoja.filas.at(-1)!;
    assert.deepEqual([total[0], total[10]], ['TOTAL (sin cancelados)', '1091.00']);
    assert.ok(hoja.filas.some((f) => f[6] === 'Manual (supervisor)' && f[8] === 'Ana Supervisora' && f[11] === '50.00 %'));
  });

  it('RD2 una venta con descuento anterior al registro de supervisores aparece «sin registro de supervisor»', async (t) => {
    const ctx = nuevoMundo(alm, politica());
    t.after(ctx.limpiar);
    const s = servicioDe(ctx, 'DUO', 1);
    const c = s.svc.nuevaVenta();
    ctx.m.caja('DUO', 1).agregarLinea(c, { item_id: ctx.items[2]!.item_id, qty: 1, descuento: 2000 }); // descuento manual sin detalle (formato anterior)
    await s.svc.cobrarEfectivo(c, 20000, 0);
    ctx.m.pump(); ctx.m.pump();
    const r = descuentosPorCaja({ rol: 'admin', usuario: 'x' }, ctx.m.central.repo.ops());
    assert.deepEqual(r.porSupervisor.map((x) => [x.supervisor, x.monto]), [['sin registro de supervisor', 2000]]);
  });
});
