import assert from 'node:assert/strict';
import { it } from 'node:test';
import { ServicioAdmin } from '../src/app/servicio.ts';
import { dolaresPorCaja } from '../src/consultas.ts';
import { DENOMINACIONES_USD, formatoTasa, parseTasa, totalDenominacionesUsd, usdAMxn } from '../src/dinero.ts';
import { hojaDolares } from '../src/inventario.ts';
import { tipoCambioVigente, ventas } from '../src/proyecciones.ts';
import { validarOpEntrante } from '../src/reglas.ts';
import { construirTicket, renderTicketTexto } from '../src/ticket.ts';
import type { Op } from '../src/tipos.ts';

import { CATALOGO_SINTETICO, nuevoMundo, politica, porAlmacen, servicioDe, type Ctx } from './ayudas/comun.ts';

const TASA = 180000; // $18.00 MXN por USD

it('D0 aritmética exacta: equivalente al centavo (mitad hacia arriba), tasa con hasta 4 decimales, denominaciones', () => {
  assert.equal(usdAMxn(5000, TASA), 90000, 'US$50 a 18.00 = $900.00');
  assert.equal(usdAMxn(1, 185000), 19, 'US$0.01 a 18.50 = 18.5 centavos → 19 (mitad hacia arriba)');
  assert.equal(usdAMxn(1, 184999), 18, 'justo debajo de la mitad (18.4999 centavos) → 18');
  assert.equal(usdAMxn(333, 183333), 6105, '3.33 × 18.3333 = 61.049889 → $61.05');
  assert.equal(usdAMxn(10, 182500), 183, 'US$0.10 × 18.25 = $1.825 → $1.83 (mitad hacia arriba)');
  assert.equal(usdAMxn(0, TASA), 0);
  assert.throws(() => usdAMxn(100, 0), RangeError);
  assert.throws(() => usdAMxn(-1, TASA), RangeError);
  assert.deepEqual(['18', '18.5', '18.1234', '$18.00', '0', '-1', '18.12345', 'abc', ''].map(parseTasa), [180000, 185000, 181234, 180000, null, null, null, null, null]);
  assert.deepEqual([180000, 185000, 181234, 181250, 17500].map(formatoTasa), ['18.00', '18.50', '18.1234', '18.125', '1.75']);
  assert.equal(totalDenominacionesUsd({ '100': 2, '20': 3, '1': 4 }), 26400);
  assert.throws(() => totalDenominacionesUsd({ '3': 1 }), RangeError);
  assert.throws(() => totalDenominacionesUsd({ '5': -1 }), RangeError);
  assert.deepEqual([...DENOMINACIONES_USD], [100, 50, 20, 10, 5, 2, 1]);
});

porAlmacen('Pagos en dólares en efectivo', (alm) => {
  const nuevo = (o: Parameters<typeof politica>[0] = {}) => {
    const ctx = nuevoMundo(alm, politica(o));
    ctx.m.fijarTipoCambioInicial(TASA);
    return ctx;
  };
  /** Venta de un renglón con precio libre (en centavos) en la caja indicada. */
  const carrito = (ctx: Ctx, t: string, n: number, precio: number) => {
    const caja = ctx.m.caja(t, n);
    const cart = caja.abrirCarrito();
    caja.agregarLinea(cart, { item_id: ctx.items[2]!.item_id, qty: 1, precio_unit: precio });
    return { caja, cart };
  };
  const permiso = (ctx: Ctx, usuario: string, v = true) => { ctx.m.central.asignarPermiso(usuario, 'editar_tipo_cambio', v, 'admin'); ctx.m.pump(); };

  it('D1 el cobro habitual en pesos no cambia: sin pasos extra, sin tasa ni dólares en el pago', (t) => {
    const ctx = nuevo();
    t.after(ctx.limpiar);
    const { caja, cart } = carrito(ctx, 'DUO', 1, 125000);
    const v = caja.cobrarEfectivo(cart, 130000);
    assert.deepEqual(v.pagos, [{ metodo: 'efectivo', monto: 125000, recibido: 130000, cambio: 5000 }]);
    assert.equal(caja.carrito(cart).tasa, undefined, 'no se bloquea tasa si no hay dólares');
  });

  it('D2 el ejemplo: venta $1,250, tasa 18.00, recibido US$50 + $500 → equivalente $900, cambio $150', (t) => {
    const ctx = nuevo();
    t.after(ctx.limpiar);
    const { caja, cart } = carrito(ctx, 'DUO', 1, 125000);
    const v = caja.cobrarEfectivoMixto(cart, { usd: 5000, pesos: 50000 }, 'Ana');
    assert.deepEqual(v.pagos, [{ metodo: 'efectivo_usd', monto: 125000, usd: 5000, tasa: TASA, tasa_version: 1, equivalente: 90000, pesos_recibidos: 50000, cambio_mxn: 15000 }]);
    assert.equal(v.total, 125000, 'el total sigue en MXN');
  });

  it('D3 solo dólares con cambio en pesos; faltante, pago exacto y cambio con USD + MXN', (t) => {
    const ctx = nuevo();
    t.after(ctx.limpiar);
    // solo USD: US$100 = $1,800 para una venta de $1,250 → cambio $550 en pesos
    const a = carrito(ctx, 'DUO', 1, 125000);
    const va = a.caja.cobrarEfectivoMixto(a.cart, { usd: 10000 });
    assert.deepEqual([va.pagos[0]!.equivalente, va.pagos[0]!.pesos_recibidos, va.pagos[0]!.cambio_mxn], [180000, 0, 55000]);
    // faltante: US$50 + $300 = $1,200 → faltan $50 y no se guarda nada
    const b = carrito(ctx, 'DUO', 1, 125000);
    assert.throws(() => b.caja.cobrarEfectivoMixto(b.cart, { usd: 5000, pesos: 30000 }), (e: any) => e.codigo === 'EFECTIVO_INSUFICIENTE' && e.detalle.faltan === 5000 && e.detalle.equivalente === 90000);
    assert.equal(b.caja.estadoFolios().ultimo, 1, 'lo rechazado no consumió folio');
    // exacto: US$50 + $350 = $1,250
    const ve = b.caja.cobrarEfectivoMixto(b.cart, { usd: 5000, pesos: 35000 });
    assert.equal(ve.pagos[0]!.cambio_mxn, 0);
    // la Caja 2 también recibe dólares
    const c = carrito(ctx, 'DUO', 2, 36000);
    assert.equal(c.caja.cobrarEfectivoMixto(c.cart, { usd: 2000 }).pagos[0]!.cambio_mxn, 0, 'US$20 = $360 exactos');
    // pesos solos por la vía mixta equivalen al efectivo de siempre
    const d = carrito(ctx, 'LON', 1, 5000);
    assert.equal(d.caja.cobrarEfectivoMixto(d.cart, { pesos: 5000 }).pagos[0]!.metodo, 'efectivo');
  });

  it('D4 un cobro iniciado conserva su tasa aunque cambie la global; los nuevos usan la vigente; lo anterior no se recalcula', (t) => {
    const ctx = nuevo();
    t.after(ctx.limpiar);
    const c1 = ctx.m.caja('DUO', 1);
    const vieja = carrito(ctx, 'DUO', 1, 125000);
    const antes = vieja.caja.cobrarEfectivoMixto(carrito(ctx, 'DUO', 1, 10000).cart, { usd: 1000 }); // venta previa con v1
    assert.equal(antes.pagos[0]!.tasa_version, 1);
    assert.deepEqual(c1.bloquearTasa(vieja.cart).bloqueada, { version: 1, tasa: TASA });
    // Administración fija 19.00 (v2) y llega a las cajas sin reiniciar
    const r = ctx.m.central.fijarTipoCambio(190000, 'admin', 1);
    assert.equal(r.ok, true);
    ctx.m.pump();
    assert.equal(c1.tipoCambio()!.version, 2);
    const nota = c1.bloquearTasa(vieja.cart);
    assert.deepEqual([nota.bloqueada.version, nota.vigente.version, nota.hay_nueva], [1, 2, true], 'el cobro iniciado conserva la v1 y avisa que hay una nueva');
    const v = c1.cobrarEfectivoMixto(vieja.cart, { usd: 7000 });
    assert.deepEqual([v.pagos[0]!.tasa, v.pagos[0]!.tasa_version, v.pagos[0]!.equivalente], [TASA, 1, 126000], 'se cobra a la tasa con la que se inició');
    // renovar es una acción explícita
    const otra = carrito(ctx, 'DUO', 1, 125000);
    assert.equal(c1.bloquearTasa(otra.cart).bloqueada.version, 2, 'un cobro nuevo toma la vigente');
    c1.bloquearTasa(otra.cart, true);
    assert.equal(c1.cobrarEfectivoMixto(otra.cart, { usd: 7000 }).pagos[0]!.equivalente, 133000);
    // nada anterior cambia
    assert.equal(ventas(c1.ops()).get(antes.sale_id)!.pagos[0]!.tasa_version, 1);
    assert.equal(ventas(c1.ops()).get(antes.sale_id)!.pagos[0]!.equivalente, 18000);
  });

  it('D5 propagación: permiso por usuario, versión, caja desconectada sigue con su tasa y se actualiza al reconectar', (t) => {
    const ctx = nuevo();
    t.after(ctx.limpiar);
    const { m } = ctx;
    const d1 = m.caja('DUO', 1);
    assert.throws(() => d1.fijarTipoCambio(190000, 'Beto'), { codigo: 'PERMISO_DENEGADO' });
    permiso(ctx, 'Beto');
    assert.equal(m.caja('LON', 2).puedeEditarTipoCambio('Beto'), true, 'el permiso llega a todas las cajas');
    assert.throws(() => d1.fijarTipoCambio(0, 'Beto'), { codigo: 'TASA_INVALIDA' });
    assert.throws(() => d1.fijarTipoCambio(-5, 'Beto'), { codigo: 'TASA_INVALIDA' });
    permiso(ctx, 'Luis');
    // London sin internet: no se entera, sigue con v1
    m.cortarInternet('LON');
    const nueva = d1.fijarTipoCambio(190000, 'Beto');
    assert.deepEqual([nueva.version, nueva.tasa, nueva.usuario, nueva.anterior], [2, 190000, 'Beto', { version: 1, tasa: TASA }]);
    m.pump(); m.pump();
    assert.equal(m.caja('DUO', 2).tipoCambio()!.version, 2, 'la otra caja de DÚO se actualiza sin reiniciar');
    assert.equal(m.caja('LON', 1).tipoCambio()!.version, 1, 'London sigue con su última tasa guardada');
    // editar la global exige el central: London desconectada no puede
    assert.throws(() => m.caja('LON', 1).fijarTipoCambio(200000, 'Luis'), { codigo: 'SIN_CENTRAL' });
    // y puede cobrar con la tasa que tiene
    const c = carrito(ctx, 'LON', 1, 18000);
    assert.equal(m.caja('LON', 1).cobrarEfectivoMixto(c.cart, { usd: 1000 }).pagos[0]!.tasa_version, 1);
    // al reconectarse recibe la vigente
    m.restablecerInternet('LON');
    for (let i = 0; i < 4; i++) m.pump();
    assert.deepEqual([m.caja('LON', 1).tipoCambio()!.version, m.caja('LON', 2).tipoCambio()!.tasa], [2, 190000]);
    // quién, cuándo y valor anterior/nuevo quedan en el central
    const reg = m.central.repo.ops().filter((o) => o.tipo === 'config.tipo_cambio').map((o) => [o.payload.version, o.payload.usuario, o.payload.anterior?.tasa ?? null, o.payload.tasa]);
    assert.deepEqual(reg, [[1, 'sistema', null, 180000], [2, 'Beto', 180000, 190000]]);
    // retirar el permiso
    permiso(ctx, 'Beto', false);
    assert.throws(() => d1.fijarTipoCambio(200000, 'Beto'), { codigo: 'PERMISO_DENEGADO' });
  });

  it('D6 versiones: una edición con datos viejos se rechaza y una actualización vieja que llega tarde no pisa la nueva', (t) => {
    const ctx = nuevo();
    t.after(ctx.limpiar);
    const { m } = ctx;
    permiso(ctx, 'Ana'); permiso(ctx, 'Beto');
    // dos editores parten de la v1; el segundo es rechazado por el central
    assert.equal(m.central.fijarTipoCambio(190000, 'Ana', 1).ok, true);
    const r = m.central.fijarTipoCambio(195000, 'Beto', 1);
    assert.deepEqual([r.ok, r.motivo, r.vigente!.version], [false, 'config_desactualizada', 2]);
    assert.equal(m.central.fijarTipoCambio(200000, 'Beto', 2).ok, true);
    // las operaciones llegan a una caja en desorden: manda la mayor versión
    const ops = m.central.repo.ops().filter((o) => o.tipo === 'config.tipo_cambio');
    const solo = ctx.m.caja('DUO', 1);
    const enDesorden = [ops[2]!, ops[0]!, ops[1]!];
    for (const o of enDesorden) solo.recibir(o, 'central');
    assert.equal(solo.tipoCambio()!.version, 3);
    assert.equal(tipoCambioVigente(enDesorden)!.tasa, 200000);
  });

  it('D7 reintentos: el mismo cobro con dólares no se duplica (mismo folio, una sola vez en el corte)', (t) => {
    const ctx = nuevo();
    t.after(ctx.limpiar);
    const { caja, cart } = carrito(ctx, 'DUO', 1, 125000);
    const a = caja.cobrarEfectivoMixto(cart, { usd: 10000 });
    const b = caja.cobrarEfectivoMixto(cart, { usd: 10000 });
    const c = caja.cobrarEfectivoMixto(cart, { usd: 5000 }); // un reintento con otros importes devuelve la venta ya guardada
    assert.deepEqual([b.folio, c.folio, c.pagos[0]!.usd], [a.folio, a.folio, 10000]);
    const corte = caja.corteEnVivo('2026-10-01');
    assert.deepEqual([corte.tickets, corte.usd_recibidos], [1, 10000]);
  });

  it('D8 el corte concilia cada moneda por separado: fondo, retiro, cambio y conteo por denominaciones', (t) => {
    const ctx = nuevo();
    t.after(ctx.limpiar);
    const { caja } = carrito(ctx, 'DUO', 1, 1);
    caja.movimientoEfectivo('fondo_inicial', 200000); // $2,000 MXN
    caja.movimientoEfectivo('fondo_inicial', 10000, 'USD'); // US$100
    // venta 1: $1,250 con US$50 + $500 → USD +50, MXN +500 −150
    const v1 = carrito(ctx, 'DUO', 1, 125000);
    caja.cobrarEfectivoMixto(v1.cart, { usd: 5000, pesos: 50000 });
    // venta 2: $120 en pesos, con $200 → MXN +120 (neto, ya sin el cambio)
    const v2 = carrito(ctx, 'DUO', 1, 12000);
    caja.cobrarEfectivo(v2.cart, 20000);
    // venta 3 a otra tasa: $1,000 con US$60 a 19.00 = $1,140 → USD +60, MXN −140
    ctx.m.central.fijarTipoCambio(190000, 'admin', 1); ctx.m.pump();
    const v3 = carrito(ctx, 'DUO', 1, 100000);
    const venta3 = caja.cobrarEfectivoMixto(v3.cart, { usd: 6000 });
    assert.deepEqual([venta3.pagos[0]!.equivalente, venta3.pagos[0]!.cambio_mxn], [114000, 14000]);
    caja.movimientoEfectivo('retiro', 5000, 'USD'); // sale US$50 a la caja fuerte
    caja.movimientoEfectivo('retiro', 30000); // y $300 MXN
    caja.movimientoEfectivo('entrada', 2000, 'USD');
    const k = caja.corteEnVivo('2026-10-01');
    // pesos físicos: 2000 + 500 − 150 + 120 − 140 − 300 = 2030
    assert.equal(k.efectivo_esperado, 200000 + 50000 - 15000 + 12000 - 14000 - 30000);
    assert.equal(k.efectivo_esperado, 203000);
    // dólares físicos: 100 + 50 + 60 + 20 − 50 = 180
    assert.deepEqual([k.fondo_inicial_usd, k.usd_recibidos, k.entradas_usd, k.retiros_usd, k.efectivo_usd_esperado], [10000, 11000, 2000, 5000, 18000]);
    // equivalente HISTÓRICO: cada operación con su tasa (900 + 1140), no todo a la última
    assert.equal(k.usd_equivalente_mxn_historico, 90000 + 114000);
    assert.notEqual(k.usd_equivalente_mxn_historico, usdAMxn(11000, 190000));
    // el cambio no es descuento ni reembolso ni cambia las ventas
    assert.deepEqual([k.descuentos, k.devoluciones, k.ventas, k.tickets_con_usd], [0, 0, 125000 + 12000 + 100000, 2]);
    assert.equal(k.cambio_mxn_con_usd, 15000 + 14000);
    assert.equal(k.pesos_recibidos_con_usd, 50000);
    // conteo por denominaciones y diferencia
    assert.throws(() => caja.registrarConteoUsd({ denominaciones: { '7': 1 }, usuario: 'Ana' }), { codigo: 'CONTEO_INVALIDO' });
    assert.equal(caja.registrarConteoUsd({ denominaciones: { '100': 1, '50': 1, '20': 1, '5': 2 }, usuario: 'Ana' }).total, 18000);
    assert.equal(caja.corteEnVivo('2026-10-01').diferencia_usd, 0);
    caja.registrarConteoUsd({ denominaciones: { '100': 1, '50': 1, '20': 0, '10': 1 }, usuario: 'Ana' });
    const k2 = caja.corteEnVivo('2026-10-01');
    assert.deepEqual([k2.conteo_usd!.contado, k2.diferencia_usd], [16000, -2000], 'el último conteo del día; faltan US$20');
    // el corte cerrado conserva ambas monedas; la otra caja no mezcla las suyas
    assert.equal(caja.generarCorte('2026-10-01').efectivo_usd_esperado, 18000);
    assert.equal(ctx.m.caja('DUO', 2).corteEnVivo('2026-10-01').efectivo_usd_esperado, 0);
    assert.throws(() => caja.movimientoEfectivo('retiro', 100, 'EUR' as never), { codigo: 'PAGO_INVALIDO' });
  });

  it('D9 ticket y reimpresión conservan la tasa original; sin renglones de IVA; el total sigue en MXN', (t) => {
    const ctx = nuevo();
    t.after(ctx.limpiar);
    const { caja, cart } = carrito(ctx, 'DUO', 1, 125000);
    const v = caja.cobrarEfectivoMixto(cart, { usd: 5000, pesos: 50000 }, 'Ana');
    ctx.m.central.fijarTipoCambio(250000, 'admin', 1, true); ctx.m.pump();
    const txt = renderTicketTexto(construirTicket(ventas(caja.ops()).get(v.sale_id)!));
    assert.match(txt, /TOTAL +\$1,250\.00/);
    assert.match(txt, /USD recibidos +US\$50\.00/);
    assert.match(txt, /Tasa 18\.00 MXN\/USD \(v1\)/);
    assert.match(txt, /Equivalente MXN +\$900\.00/);
    assert.match(txt, /Pesos recibidos +\$500\.00/);
    assert.match(txt, /Cambio MXN +\$150\.00/);
    assert.doesNotMatch(txt, /\b(iva|tax|impuesto)\b|%/i, "sin renglones de impuestos");
    const sinPesos = carrito(ctx, 'DUO', 1, 90000);
    const t2 = renderTicketTexto(construirTicket(caja.cobrarEfectivoMixto(sinPesos.cart, { usd: 5000 })));
    assert.doesNotMatch(t2, /Pesos recibidos/);
    assert.match(t2, /Tasa 25\.00 MXN\/USD \(v2\)/);
  });

  it('D10 con tarjeta de regalo + dólares solo se convierte la parte recibida en USD; reglas de tarjeta bancaria intactas', (t) => {
    const ctx = nuevo();
    t.after(ctx.limpiar);
    const c = ctx.m.caja('DUO', 1);
    c.altaTarjetaRegalo({ codigo: 'G', monto: 20000 });
    ctx.m.pump();
    const { cart } = carrito(ctx, 'DUO', 1, 125000); // $1,250
    const v = c.cobrarConTarjetaRegalo(cart, 'G', 30000, 'Ana', 5000); // tarjeta $200, resto $1,050 con US$50 ($900) + $300
    assert.deepEqual(v.pagos[0], { metodo: 'tarjeta_regalo', monto: 20000, tarjeta: 'G', saldo_despues: 0 });
    assert.deepEqual([v.pagos[1]!.metodo, v.pagos[1]!.monto, v.pagos[1]!.equivalente, v.pagos[1]!.cambio_mxn], ['efectivo_usd', 105000, 90000, 15000]);
    // la Caja 2 rechaza la tarjeta bancaria aunque lleve dólares
    const c2 = carrito(ctx, 'DUO', 2, 125000);
    assert.throws(() => ctx.m.caja('DUO', 2).cobrar(c2.cart, [{ metodo: 'tarjeta', monto: 50000, autorizacion: 'X' }, { metodo: 'efectivo', monto: 75000 }]), { codigo: 'PAGO_NO_PERMITIDO' });
  });

  it('D11 hub y central revalidan: un cobro en dólares con equivalente o cambio mal calculado se rechaza', () => {
    const cfg = [{ tienda: 'DUO', caja: 1, metodos: ['efectivo' as const] }];
    const op = (p: object): Op => ({ op_id: 'x', tipo: 'sale.confirmed', tienda: 'DUO', caja: 1, origen: 'caja:DUO/1', ocurrio_en: '2026-10-01T15:00:00Z', payload: { tienda: 'DUO', caja: 1, total: 125000, pagos: [p] } });
    const ok = { metodo: 'efectivo_usd', monto: 125000, usd: 5000, tasa: TASA, tasa_version: 1, equivalente: 90000, pesos_recibidos: 50000, cambio_mxn: 15000 };
    assert.equal(validarOpEntrante(op(ok), cfg), null, 'una caja con efectivo recibe dólares');
    assert.equal(validarOpEntrante(op({ ...ok, equivalente: 90100 }), cfg), 'efectivo_usd_equivalente_incorrecto');
    assert.equal(validarOpEntrante(op({ ...ok, cambio_mxn: 14000 }), cfg), 'efectivo_usd_no_cuadra');
    assert.equal(validarOpEntrante(op({ ...ok, usd: 0 }), cfg), 'efectivo_usd_incompleto');
    assert.equal(validarOpEntrante(op({ ...ok, tasa_version: undefined }), cfg), 'efectivo_usd_incompleto');
  });

  it('D12 reporte: dólares físicos con el equivalente de CADA operación y detalle exportable a Excel', (t) => {
    const ctx = nuevo();
    t.after(ctx.limpiar);
    const a = carrito(ctx, 'DUO', 1, 125000);
    a.caja.cobrarEfectivoMixto(a.cart, { usd: 5000, pesos: 50000 }, 'Ana');
    ctx.m.central.fijarTipoCambio(190000, 'admin', 1); ctx.m.pump();
    const b = carrito(ctx, 'LON', 2, 100000);
    ctx.m.caja('LON', 2).cobrarEfectivoMixto(b.cart, { usd: 6000 }, 'Luis');
    const c = carrito(ctx, 'LON', 2, 1000);
    const cancelada = ctx.m.caja('LON', 2).cobrarEfectivoMixto(c.cart, { usd: 100 }, 'Luis');
    ctx.m.caja('LON', 2).cancelarVenta(cancelada.sale_id, 'error');
    ctx.m.pump(); ctx.m.pump();
    const admin = { rol: 'admin' as const, usuario: 'galo' };
    const r = dolaresPorCaja(admin, ctx.m.central.repo.ops());
    assert.equal(r.filas.length, 3);
    assert.deepEqual(r.porCaja.map((x) => [x.tienda, x.caja, x.usd, x.equivalente_historico]), [['DUO', 1, 5000, 90000], ['LON', 2, 6100, 115900]], 'cada operación con su tasa; los dólares de una venta cancelada siguen físicamente en el cajón');
    assert.deepEqual([r.usd, r.equivalente_historico], [11100, 205900]);
    const hoja = hojaDolares(r);
    assert.equal(hoja.encabezados[7], 'Tipo de cambio (MXN por USD)');
    assert.deepEqual(hoja.filas[0]!.slice(0, 12), ['DUO', 1, 1, '2026-10-01', '08:00', 'Ana', '50.00', '18.00', 1, '900.00', '500.00', '150.00']);
    assert.deepEqual(hoja.filas[1]!.slice(6, 10), ['60.00', '19.00', 2, '1140.00']);
    const svc = new ServicioAdmin({ actor: admin, fuente: () => ctx.m.central.repo.ops(), cajas: [{ tienda: 'DUO', caja: 1 }, { tienda: 'LON', caja: 2 }], central: ctx.m.central });
    assert.equal(svc.hojaDolares({ cajas: [{ tienda: 'LON', caja: 2 }] }).filas.length - 2, 2, 'filtra por caja');
    // el cajero no ve dólares de otra caja
    assert.throws(() => dolaresPorCaja({ rol: 'cajero', usuario: 'x', tienda: 'DUO', caja: 1 }, ctx.m.central.repo.ops(), { cajas: [{ tienda: 'LON', caja: 2 }] }), { codigo: 'PROHIBIDO' });
  });

  it('D13 servicio: barra del dólar con fecha, quién y verificación; sin tasa no hay dólares', async (t) => {
    const ctx = nuevoMundo(alm, politica());
    t.after(ctx.limpiar);
    const s = servicioDe(ctx, 'DUO', 1, 'Ana');
    assert.equal(s.svc.estado().tipo_cambio.configurado, false);
    const cart = s.svc.nuevaVenta();
    s.svc.caja.agregarLinea(cart, { item_id: ctx.items[2]!.item_id, qty: 1 });
    await assert.rejects(() => s.svc.cobrarEfectivo(cart, 0, 1000), { codigo: 'SIN_TIPO_DE_CAMBIO' });
    ctx.m.fijarTipoCambioInicial(TASA, 'Gerencia');
    const tc = s.svc.estado().tipo_cambio;
    assert.deepEqual([tc.texto, tc.version, tc.cambiado_por, tc.verificado, tc.puede_editar], ['18.00', 1, 'Gerencia', true, false]);
    assert.match(tc.actualizado_en!, /^2026-10-01T/);
    ctx.m.cortarInternet('DUO');
    assert.equal(s.svc.estado().tipo_cambio.verificado, false, 'sin internet no puede verificar actualizaciones');
    ctx.m.restablecerInternet('DUO');
    permiso(ctx, 'Ana');
    assert.equal(s.svc.estado().tipo_cambio.puede_editar, true);
    const nuevo2 = await s.svc.fijarTipoCambio(185000);
    assert.deepEqual([nuevo2.texto, nuevo2.version], ['18.50', 2]);
    const r = await s.svc.cobrarEfectivo(cart, 0, 1000);
    assert.equal(r.venta.pagos[0]!.tasa_version, 2);
    assert.match(r.ticket_texto, /Tasa 18\.50 MXN\/USD \(v2\)/);
    assert.equal(r.cambio, 18500 - 12000, 'cambio en pesos');
    // reimprimir conserva la tasa aunque cambie después
    await s.svc.fijarTipoCambio(200000);
    const re = await s.svc.reimprimir(r.venta.sale_id);
    assert.match(re.ticket_texto, /Tasa 18\.50 MXN\/USD \(v2\)/);
    assert.match(re.ticket_texto, /REIMPRESIÓN 1/);
    void CATALOGO_SINTETICO;
  });
});
