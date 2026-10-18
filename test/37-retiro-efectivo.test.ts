import assert from 'node:assert/strict';
import { it } from 'node:test';
import { renderTicketRetiroTexto, NEGOCIOS } from '../src/ticket.ts';
import { MINIMO_RETIRO, UMBRAL_AVISO_RETIRO } from '../src/retiros.ts';
import { nuevoMundo, politica, porAlmacen, servicioDe } from './ayudas/comun.ts';

const TASA = 180000; // $18.00 por USD

porAlmacen('Retiro de efectivo de la caja', (alm) => {
  const nuevo = (t: { after(f: () => void): void }) => {
    const ctx = nuevoMundo(alm, politica());
    ctx.m.fijarTipoCambioInicial(TASA);
    t.after(ctx.limpiar);
    return ctx;
  };
  /** Vende `n` jeans de $899 en efectivo (pesos) en la caja. */
  const vender = async (s: ReturnType<typeof servicioDe>, n: number, usd = 0) => {
    const c = s.svc.nuevaVenta();
    for (let i = 0; i < n; i++) s.svc.escanear(c, '0002026090782');
    const total = s.svc.vista(c).total;
    return s.svc.cobrarEfectivo(c, usd > 0 ? 0 : total + 1000, usd);
  };

  it('RT1 el aviso sale con $10,000 de efectivo de VENTA; el fondo inicial no cuenta y no se bloquea la venta', async (t) => {
    const ctx = nuevo(t);
    const s = servicioDe(ctx, 'DUO', 1, 'Ana');
    s.svc.movimientoEfectivo('fondo_inicial', 500000, 'MXN');
    assert.deepEqual([s.svc.estadoRetiro().venta.equivalente, s.svc.estadoRetiro().avisar], [0, false]);
    await vender(s, 11); // 11 × $899 = $9,889
    let e = s.svc.estadoRetiro();
    assert.deepEqual([e.venta.mxn, e.en_cajon.mxn, e.avisar], [988900, 988900 + 500000, false], 'con fondo ya hay más de $10,000 en el cajón y aun así no avisa');
    await vender(s, 1);   // $10,788
    e = s.svc.estadoRetiro();
    assert.equal(e.avisar, true);
    assert.equal(e.umbral, UMBRAL_AVISO_RETIRO);
    await vender(s, 1); // seguir vendiendo no está bloqueado
    assert.equal(s.svc.estadoRetiro().venta.mxn, 988900 + 89900 + 89900);
  });

  it('RT2 retiro con billetes grandes: mínimo $8,000, descuenta del corte, imprime sus datos, reintento idempotente y folio consecutivo', async (t) => {
    const ctx = nuevo(t);
    const s = servicioDe(ctx, 'DUO', 1, 'Ana');
    s.svc.movimientoEfectivo('fondo_inicial', 200000, 'MXN');
    await vender(s, 12); // $10,788 de venta
    const mil = '100000';
    await assert.rejects(() => s.svc.registrarRetiro({ retiro_id: 'r0', mxn: { [mil]: 7 } }), { codigo: 'RETIRO_INSUFICIENTE' });
    await assert.rejects(() => s.svc.registrarRetiro({ retiro_id: 'r0', mxn: { '10000': 90 } }), { codigo: 'RETIRO_INVALIDO' }); // $100 no es billete grande
    await assert.rejects(() => s.svc.registrarRetiro({ retiro_id: 'r0', mxn: { [mil]: 14 } }), { codigo: 'RETIRO_EXCEDE_EFECTIVO' });
    assert.equal(s.svc.estadoRetiro().retiros.length, 0, 'los rechazos no registran nada');
    const r = await s.svc.registrarRetiro({ retiro_id: 'r1', mxn: { [mil]: 8, '50000': 1 } }); // $8,500: no tiene que ser exactamente $10,000
    assert.equal(r.retiro.folio_retiro, 'D1-R0001');
    assert.deepEqual([r.retiro.equivalente_mxn, r.retiro.venta_antes, r.retiro.venta_despues], [850000, 1078800, 228800]);
    assert.equal(r.impresion.ok, true);
    assert.match(r.ticket_texto, /RETIRO DE EFECTIVO/);
    assert.match(r.ticket_texto, /Retiro: D1-R0001/);
    assert.match(r.ticket_texto, /8 x \$1,000\.00\s+\$8,000\.00/);
    assert.match(r.ticket_texto, /1 x \$500\.00\s+\$500\.00/);
    assert.match(r.ticket_texto, /TOTAL RETIRADO \(MXN\)\s+\$8,500\.00/);
    assert.match(r.ticket_texto, /Cajero: Ana/);
    assert.match(r.ticket_texto, /Firma de quien retira/);
    // el retiro descuenta del efectivo esperado del corte
    const corte = ctx.m.caja('DUO', 1).corteEnVivo(r.retiro.fecha);
    assert.deepEqual([corte.retiros, corte.efectivo_esperado], [850000, 200000 + 1078800 - 850000]);
    // reintento con el mismo id: mismo retiro, nada se duplica
    const otra = await s.svc.registrarRetiro({ retiro_id: 'r1', mxn: { [mil]: 8, '50000': 1 } });
    assert.equal(otra.retiro.folio_retiro, 'D1-R0001');
    assert.equal(ctx.m.caja('DUO', 1).corteEnVivo(r.retiro.fecha).retiros, 850000);
    const r2 = await s.svc.registrarRetiro({ retiro_id: 'r2', mxn: { [mil]: 1 }, usd: {} }).catch((e) => e);
    assert.equal(r2.codigo, 'RETIRO_INSUFICIENTE');
    const re = await s.svc.reimprimirRetiro('r1');
    assert.match(re.ticket_texto, /REIMPRESIÓN 1/);
    assert.equal(s.svc.estadoRetiro().retiros.length, 1);
  });

  it('RT3 los dólares cuentan con su equivalente: pesos + dólares hasta completar $8,000', async (t) => {
    const ctx = nuevo(t);
    const s = servicioDe(ctx, 'DUO', 1, 'Ana');
    // venta de $2,696.99 pagada con US$200 (= $3,600) y cambio en pesos
    await vender(s, 3, 20000);
    await vender(s, 8); // $7,192 en pesos
    const e = s.svc.estadoRetiro();
    assert.equal(e.venta.usd, 20000);
    assert.ok(e.venta.equivalente > 0);
    // US$100 × 2 = $3,600 + $5,000 en pesos = $8,600 ≥ $8,000
    const r = await s.svc.registrarRetiro({ retiro_id: 'u1', mxn: { '50000': 10 }, usd: { '100': 2 } });
    assert.deepEqual([r.retiro.usd.total, r.retiro.mxn.total, r.retiro.tasa, r.retiro.equivalente_mxn], [20000, 500000, TASA, 500000 + 360000]);
    assert.match(r.ticket_texto, /2 x US\$100\.00\s+US\$200\.00/);
    assert.match(r.ticket_texto, /Tipo de cambio 18\.00 MXN\/USD/);
    const corte = ctx.m.caja('DUO', 1).corteEnVivo(r.retiro.fecha);
    assert.deepEqual([corte.retiros, corte.retiros_usd], [500000, 20000]);
    // solo dólares tampoco alcanzan sin llegar al mínimo
    await assert.rejects(() => s.svc.registrarRetiro({ retiro_id: 'u2', usd: { '1': 1 } }), { codigo: 'RETIRO_INSUFICIENTE' });
    assert.equal(MINIMO_RETIRO, 800000);
  });

  it('RT4 el ticket de retiro sale con los datos de la tienda y la caja', async (t) => {
    const ctx = nuevo(t);
    const s = servicioDe(ctx, 'LON', 1, 'Luis');
    await vender(s, 12);
    const r = await s.svc.registrarRetiro({ retiro_id: 'l1', mxn: { '100000': 9 } });
    assert.equal(r.retiro.folio_retiro, 'L1-R0001');
    assert.match(renderTicketRetiroTexto(r.retiro, NEGOCIOS.LON!), /Tienda LON - Caja 1/);
  });
});
