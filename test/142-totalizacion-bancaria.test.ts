import assert from 'node:assert/strict';
import { it } from 'node:test';
import { nuevoMundo, politica, porAlmacen, servicioDe } from './ayudas/comun.ts';

const VESTIDO = '0002026090782'; // $899.00
const HOY = (ctx: { m: { reloj: { now(): string } } }) => ctx.m.reloj.now().slice(0, 10);

porAlmacen('Corte: totalización bancaria contra la tarjeta neta del sistema', (alm) => {
  it('TB2 cierre con totalización: coincide con tarjeta − reembolso a tarjeta', async (t) => {
    const ctx = nuevoMundo(alm, politica());
    t.after(ctx.limpiar);
    const s = servicioDe(ctx, 'DUO', 1, 'Ana');
    const c1 = s.svc.nuevaVenta(); s.svc.escanear(c1, VESTIDO);
    const v = (await s.svc.cobrarTarjetaManual(c1, { autorizacion: 'A111' })).venta; // $899 con tarjeta
    const c2 = s.svc.nuevaVenta(); s.svc.escanear(c2, VESTIDO);
    await s.svc.cobrarTarjetaManual(c2, { autorizacion: 'B222' }); // otros $899
    s.svc.caja.devolver({ sale_id: v.sale_id, renglones: [{ linea_id: v.lineas[0]!.linea_id, qty: 1 }], motivo: 'no le quedó' }); // reembolso a tarjeta de $899
    const vivo = s.svc.corte(HOY(ctx)).vivo;
    assert.deepEqual([vivo.cobros_tarjeta, vivo.devoluciones_a_tarjeta], [179800, 89900]);
    s.svc.confirmarFondo({ '100000': 5 });
    s.svc.registrarConteo('MXN', {}, 'ventas');
    await assert.rejects(() => s.svc.cerrarCorte(HOY(ctx)), { codigo: 'CIERRE_INCOMPLETO' }); // sin totalización no cierra
    await assert.rejects(() => s.svc.cerrarCorte(HOY(ctx), { totalizacion: -5 }), { codigo: 'CIERRE_INCOMPLETO' });
    // verificar: si no coincide NO se muestra la cifra del sistema; se piden hasta 3 intentos; la primera captura y los intentos quedan registrados
    const v1 = s.svc.verificarTotalizacion(HOY(ctx), 80000);
    assert.deepEqual(v1, { coincide: false, intentos: 1, final: false, restantes: 2 });
    assert.equal('sistema' in v1, false, 'sin cifra del sistema en los primeros intentos');
    await assert.rejects(() => s.svc.cerrarCorte(HOY(ctx), { totalizacion: 80000 }), { codigo: 'TOTALIZACION_NO_VERIFICADA' });
    const v2 = s.svc.verificarTotalizacion(HOY(ctx), 89900); // coincide en el 2.º intento: se confirma y se muestra
    assert.deepEqual(v2, { coincide: true, intentos: 2, final: true, restantes: 1, sistema: 89900, diferencia: 0 });
    assert.throws(() => s.svc.verificarTotalizacion(HOY(ctx), -1), { codigo: 'DATOS_REQUERIDOS' });
    const r = await s.svc.cerrarCorte(HOY(ctx), { totalizacion: 89900 });
    assert.deepEqual((r.corte as any).totalizacion_bancaria, { capturado: 89900, sistema: 89900, diferencia: 0, coincide: true, capturo: 'Ana', intentos: 2, primera_captura: 80000 });
    assert.match(r.ticket_texto!, /Intentos de captura\s+2[\s\S]*Primera captura\s+\$800\.00/);
    assert.equal(s.svc.corte(HOY(ctx)).estado.cerrado, true, 'el dato nuevo no hace que el corte parezca desactualizado');
  });
  it('TB3 tres intentos fallidos: recién ahí se muestra la cifra del sistema y se cierra con la nota «no coincidió»', async (t) => {
    const ctx = nuevoMundo(alm, politica());
    t.after(ctx.limpiar);
    const s = servicioDe(ctx, 'DUO', 1, 'Ana');
    const c1 = s.svc.nuevaVenta(); s.svc.escanear(c1, VESTIDO);
    await s.svc.cobrarTarjetaManual(c1, { autorizacion: 'A111' });
    s.svc.confirmarFondo({ '100000': 5 });
    s.svc.registrarConteo('MXN', {}, 'ventas');
    const dia = HOY(ctx);
    assert.deepEqual(s.svc.verificarTotalizacion(dia, 70000), { coincide: false, intentos: 1, final: false, restantes: 2 });
    assert.deepEqual(s.svc.verificarTotalizacion(dia, 71000), { coincide: false, intentos: 2, final: false, restantes: 1 });
    await assert.rejects(() => s.svc.cerrarCorte(dia, { totalizacion: 71000 }), { codigo: 'TOTALIZACION_NO_VERIFICADA' });
    const v3 = s.svc.verificarTotalizacion(dia, 72000);
    assert.deepEqual(v3, { coincide: false, intentos: 3, final: true, restantes: 0, sistema: 89900, diferencia: -17900 });
    const r = await s.svc.cerrarCorte(dia, { totalizacion: 72000 });
    const tb = (r.corte as any).totalizacion_bancaria;
    assert.deepEqual([tb.coincide, tb.diferencia, tb.intentos, tb.primera_captura], [false, -17900, 3, 70000]);
    assert.match(r.ticket_texto!, /NO COINCIDIÓ\s+-\$179\.00/);
    // un cierre nuevo el mismo día empieza sus intentos de cero
    assert.equal(s.svc.verificarTotalizacion(dia, 1).intentos, 1);
  });
});
