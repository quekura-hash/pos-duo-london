import assert from 'node:assert/strict';
import { it } from 'node:test';
import { cortesPorCaja } from '../src/consultas.ts';
import { nuevoMundo, politica, porAlmacen, servicioDe } from './ayudas/comun.ts';

const HOY = '2026-10-01';

porAlmacen('Cierre de caja más de una vez al día: el último cubre todo el día y anota los anteriores', (alm) => {
  it('CC1 tras un cierre y más ventas se puede cerrar de nuevo con TODO el día; el ticket anota el corte de arqueo anterior', async (t) => {
    const ctx = nuevoMundo(alm, politica());
    t.after(() => ctx.limpiar());
    const { svc } = servicioDe(ctx, 'DUO', 1, 'Ana');
    const masc = ctx.items[2]!; // mascada $120
    const vender = async () => { const c = svc.nuevaVenta(); svc.escanear(c, masc.codigo); await svc.cobrarEfectivo(c, 12000); };
    await vender();
    svc.confirmarFondo({ '100000': 5 });
    svc.registrarConteo('MXN', { '10000': 1, '2000': 1 }, 'ventas'); // 120
    const primero: any = await svc.cerrarCorte(HOY);
    assert.equal(primero.corte.tickets, 1);
    assert.equal(primero.corte.cierres_previos, undefined);
    assert.equal(svc.corte(HOY).estado.cerrado, true);
    // más ventas: el cierre queda abierto otra vez
    ctx.m.reloj.avanzar(3600_000);
    await vender();
    let c = svc.corte(HOY);
    assert.equal(c.desactualizado, true);
    assert.equal(c.estado.cerrado, false);
    assert.equal(c.estado.puede_cerrar, false, 'hay que recontar');
    assert.deepEqual(c.estado.faltan, ['fondo', 'recontar_ventas'], 'el fondo se vuelve a contar y confirmar');
    // los billetes del fondo ya son otros y falta dinero: se registra con nota, no se corrige solo
    assert.throws(() => svc.confirmarFondo({ '50000': 5, '20000': 0 }), /FONDO_NO_COINCIDE|fondo/i);
    ctx.m.reloj.avanzar(60_000);
    svc.confirmarFondo({ '50000': 4, '20000': 5, '10000': 3 }, 'faltan $1,700 por pago de proveedores'); // 3,300 contra 5,000 autorizados
    assert.equal(svc.corte(HOY).vivo.fondo_estado, 'faltante');
    svc.registrarConteo('MXN', { '10000': 2, '2000': 2 }, 'ventas'); // 240: todo el día
    c = svc.corte(HOY);
    assert.equal(c.estado.puede_cerrar, true);
    const segundo: any = await svc.cerrarCorte(HOY);
    assert.equal(segundo.corte.tickets, 2, 'el segundo cierre cubre todo el día');
    assert.equal(segundo.corte.cierres_previos!.length, 1);
    assert.equal(segundo.corte.cierres_previos![0].ventas, 12000);
    assert.equal(segundo.corte.cierres_previos![0].fondo_confirmado, true);
    assert.match(segundo.ticket_texto!.replace(/\s+/g, ' '), /Se hizo un corte de arqueo a las \d{1,2}:\d\d (AM|PM) con \$120\.00 de venta y se confirmó fondo\./);
    assert.equal(segundo.corte.fondo_estado, 'faltante');
    assert.equal(segundo.corte.fondo_confirmado, 330000);
    // cerrado y sin operaciones nuevas: otro intento devuelve el mismo y no imprime
    const otra: any = await svc.cerrarCorte(HOY);
    assert.equal(otra.ticket_texto, null);
    assert.equal(otra.corte.cierres_previos!.length, 1);
    assert.equal(svc.corte(HOY).estado.cerrado, true);
    // reportes: un solo corte por caja y día (el último)
    const filas = cortesPorCaja({ tipo: 'admin' } as any, ctx.m.caja('DUO', 1).opsDe('corte.generado'), {});
    assert.equal(filas.length, 1);
    assert.equal(filas[0]!.tickets, 2);
  });
});
