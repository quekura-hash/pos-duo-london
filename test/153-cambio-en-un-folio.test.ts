import assert from 'node:assert/strict';
import { it } from 'node:test';
import { reporteConsolidado } from '../src/consultas.ts';
import { totalesPorDia } from '../src/metas.ts';
import { devoluciones, ventas } from '../src/proyecciones.ts';
import { reporteDeCaja } from '../src/reporte-contadora.ts';
import { nuevoMundo, politica, porAlmacen, servicioDe } from './ayudas/comun.ts';

const MASCADA = '7501234567890'; // $120
const BOLSA = '0000000000017'; // $450
const JEANS = '0002026090782'; // $899
const ADMIN = { rol: 'admin', usuario: 'prueba' } as never;
const CLIENTA = { clienta: { nombre: 'Ana López', telefono: '6531234567' }, motivo: 'cambio' };

porAlmacen('Un cambio de mercancía es UN solo folio: parejo = «Cambio» $0; si paga diferencia = «Venta»; «Devolución» solo si se regresó dinero', (alm) => {
  const preparar = async (t: any) => {
    const ctx = nuevoMundo(alm, politica());
    t.after(ctx.limpiar);
    const s = servicioDe(ctx, 'DUO', 1, 'Ana');
    ctx.m.reloj.fijar('2026-11-14T20:00:00Z');
    const c1 = s.svc.nuevaVenta(); s.svc.escanear(c1, JEANS); s.svc.escanear(c1, MASCADA);
    const v1 = (await s.svc.cobrarEfectivo(c1, 200000)).venta; // folio 1: $1,019
    const hacerCambio = (lineaIdx: number, nuevos: string[]) => {
      const c = s.svc.nuevaVenta();
      s.svc.iniciarCambio(c, v1.sale_id, [{ linea_id: v1.lineas[lineaIdx]!.linea_id, qty: 1 }], CLIENTA);
      for (const n of nuevos) s.svc.escanear(c, n);
      return c;
    };
    const filas = () => { ctx.m.pump(); ctx.m.pump(); return reporteDeCaja(ctx.m.central.repo.ops(), 'DUO', 1, '2026-11').hojas[0]!.filas; };
    return { ctx, s, v1, hacerCambio, filas };
  };

  it('CU1 devuelve una prenda y se lleva otra del mismo precio: UN folio en $0, marcado «Cambio», sin renglón de devolución ni segundo folio', async (t) => {
    const { ctx, s, hacerCambio, filas } = await preparar(t);
    const c = hacerCambio(0, [JEANS]); // devuelve los jeans de $899 y se lleva otros jeans de $899
    const v2 = (await s.svc.cobrarEfectivo(c, 0)).venta;
    assert.deepEqual(v2.pagos.map((p: any) => [p.metodo, p.monto]), [['credito_cambio', 89900]]);
    // el siguiente ticket de la caja es el folio 3: el cambio consumió UN solo folio
    const c3 = s.svc.nuevaVenta(); s.svc.escanear(c3, MASCADA);
    assert.equal((await s.svc.cobrarEfectivo(c3, 12000)).venta.folio, v2.folio + 1);
    ctx.m.pump(); ctx.m.pump();
    const dev = devoluciones(ctx.m.central.repo.ops()).find((d) => d.por_cambio)!;
    assert.deepEqual([dev.folio ?? null, dev.folio_unico], [null, true], 'la devolución por cambio no tiene folio propio');
    const f = filas();
    assert.equal(f.some((x) => String(x[2]).startsWith('Devolución')), false, 'no hay renglón de devolución ni en negativo');
    const cambio = f.find((x) => x[1] === v2.folio)!;
    assert.deepEqual([cambio[2], cambio[3], cambio[4]], ['Cambio', 0, 0]);
    assert.deepEqual(f.map((x) => Number(x[1])).sort((a, b) => a - b), [1, 2, 3], 'folios consecutivos');
    const rep = reporteDeCaja(ctx.m.central.repo.ops(), 'DUO', 1, '2026-11');
    assert.equal(rep.total, 101900 + 12000, 'el cambio parejo no suma ni resta');
    assert.equal(rep.efectivo, 101900 + 12000);
    assert.equal(s.svc.corte('2026-11-14').vivo.ventas_netas, 101900 + 12000);
  });

  it('CU2 devuelve una prenda y se lleva una más cara: UN folio marcado «Venta» por la diferencia', async (t) => {
    const { ctx, s, hacerCambio, filas } = await preparar(t);
    const c = hacerCambio(1, [BOLSA]); // devuelve la mascada de $120 y se lleva la bolsa de $450: paga $330
    const v2 = (await s.svc.cobrarEfectivo(c, 33000)).venta;
    const f = filas();
    const cambio = f.find((x) => x[1] === v2.folio)!;
    assert.deepEqual([cambio[2], cambio[4]], ['Venta', 330], 'el folio es una venta de la diferencia');
    assert.equal(f.some((x) => String(x[2]).startsWith('Devolución')), false);
    assert.equal(reporteDeCaja(ctx.m.central.repo.ops(), 'DUO', 1, '2026-11').total, 101900 + 33000);
    assert.equal(totalesPorDia(ctx.m.central.repo.ops(), 'DUO').get('2026-11-14'), 101900 + 33000);
    // el resumen del día y el corte dicen lo mismo
    const dia = servicioDe(ctx, 'DUO', 1, 'Ana').svc.corte('2026-11-14').vivo;
    assert.deepEqual([dia.venta_total_dia, dia.ventas_netas], [101900 + 33000, 101900 + 33000]);
    // y el cambio lleva su venta en el análisis por caja
    const r = reporteConsolidado(ADMIN, ctx.m.central.repo.ops(), { desde: '2026-11-01', hasta: '2026-11-30', devoluciones: true });
    assert.equal(r.total, 101900 + 33000);
    assert.equal(r.porCaja[0]!.tickets, 2);
  });

  it('CU3 se lleva algo más barato y se le regresa la diferencia en efectivo: UN folio marcado «Devolución» por el dinero que salió', async (t) => {
    const { ctx, s, hacerCambio, filas } = await preparar(t);
    const c = hacerCambio(0, [MASCADA]); // devuelve jeans $899 y se lleva la mascada $120: se le regresan $779
    const r = await s.svc.devolverEfectivoCambio(c);
    const folio = r.venta!.folio;
    const f = filas();
    const cambio = f.find((x) => x[1] === folio)!;
    assert.deepEqual([cambio[2], cambio[4]], ['Devolución', -779]);
    assert.equal(f.filter((x) => x[1] === folio).length, 1, 'un solo renglón');
    const rep = reporteDeCaja(ctx.m.central.repo.ops(), 'DUO', 1, '2026-11');
    assert.equal(rep.total, 101900 - 77900, 'el mes resta el dinero que salió');
    assert.equal(rep.efectivo, 101900 - 77900, 'el efectivo devuelto sale de lo cobrado');
    assert.equal(s.svc.corte('2026-11-14').vivo.efectivo_ventas_esperado, 101900 - 77900);
    assert.equal(s.svc.corte('2026-11-14').vivo.ventas_netas, 101900 - 77900);
    assert.deepEqual(f.map((x) => Number(x[1])).sort((a, b) => a - b), [1, 2], 'dos folios: la venta original y el cambio');
  });

  it('CU4 lo ya registrado no se toca: un cambio hecho con dos folios (devolución con folio propio) sigue como estaba', async (t) => {
    const ctx = nuevoMundo(alm, politica());
    t.after(ctx.limpiar);
    const s = servicioDe(ctx, 'DUO', 1, 'Ana');
    ctx.m.reloj.fijar('2026-11-03T20:00:00Z');
    const c1 = s.svc.nuevaVenta(); s.svc.escanear(c1, MASCADA);
    const v1 = (await s.svc.cobrarEfectivo(c1, 12000)).venta;
    const c2 = s.svc.nuevaVenta();
    s.svc.iniciarCambio(c2, v1.sale_id, [{ linea_id: v1.lineas[0]!.linea_id, qty: 1 }], CLIENTA);
    s.svc.escanear(c2, MASCADA);
    const v2 = (await s.svc.cobrarEfectivo(c2, 0)).venta;
    ctx.m.pump(); ctx.m.pump();
    // simula un cambio de la versión anterior: la devolución con folio propio y sin la marca, y la venta sin la marca del folio único
    const ops = ctx.m.central.repo.ops().map((o) => {
      if (o.tipo === 'return.registered') return { ...o, payload: { ...o.payload, folio: 99, folio_unico: undefined } };
      if (o.tipo === 'sale.confirmed' && o.payload.sale_id === v2.sale_id) { const { cambio_unico: _x, ...resto } = o.payload; return { ...o, payload: resto }; }
      return o;
    });
    const filas = reporteDeCaja(ops as never, 'DUO', 1, '2026-11').hojas[0]!.filas;
    assert.ok(filas.some((x) => x[1] === 99 && String(x[2]).startsWith('Devolución')), 'la devolución con su folio sigue en el reporte');
    assert.ok(filas.some((x) => x[1] === v2.folio && x[2] === 'Venta · cambio de mercancía'), 'y la venta del cambio, como siempre');
    assert.equal(reporteDeCaja(ops as never, 'DUO', 1, '2026-11').total, 12000, 'el mes cuenta lo mismo que antes');
    assert.equal(ventas(ops as never).get(v2.sale_id)!.cambio_unico, undefined);
  });
});
