import assert from 'node:assert/strict';
import { it } from 'node:test';
import { cortesPorCaja } from '../src/consultas.ts';
import { superaUmbralTasa, variacionTasaPb } from '../src/dinero.ts';
import { devoluciones, movimientosCaja, ventas } from '../src/proyecciones.ts';
import { validarOpEntrante } from '../src/reglas.ts';
import { renderTicketDevolucionTexto } from '../src/ticket.ts';
import type { Op } from '../src/tipos.ts';
import { crearPoliticasEnsayo } from '../src/politicas.ts';
import { BASE_ENSAYO, nuevoMundo, politica, porAlmacen, type Ctx } from './ayudas/comun.ts';

const TASA = 180000;
const H = 3_600_000;

it('T0 la regla del 10 % es estricta y usa enteros; la política de tasa sin verificar se valida', () => {
  assert.equal(superaUmbralTasa(180000, 198000), false, 'exactamente 10 % no pide confirmación');
  assert.equal(superaUmbralTasa(180000, 198001), true);
  assert.equal(superaUmbralTasa(180000, 162000), false);
  assert.equal(superaUmbralTasa(180000, 161999), true, 'también a la baja');
  assert.equal(variacionTasaPb(180000, 198000), 1000);
  assert.equal(variacionTasaPb(180000, 171000), -500);
  assert.throws(() => crearPoliticasEnsayo({ ...BASE_ENSAYO, tasa_sin_verificar: { advertir_horas: 0, bloquear_usd_horas: null } }), { codigo: 'POLITICA_INVALIDA' });
  assert.throws(() => crearPoliticasEnsayo({ ...BASE_ENSAYO, tasa_sin_verificar: { advertir_horas: 12, bloquear_usd_horas: 6 } }), { codigo: 'POLITICA_INVALIDA' });
  assert.doesNotThrow(() => crearPoliticasEnsayo({ ...BASE_ENSAYO, tasa_sin_verificar: { advertir_horas: 12, bloquear_usd_horas: 48 } }));
});

porAlmacen('Cierre de pendientes de dólares: devoluciones, cancelaciones, billetes, tasa y cortes consolidados', (alm) => {
  const nuevo = (o: Parameters<typeof politica>[0] = {}) => {
    const ctx = nuevoMundo(alm, politica(o));
    ctx.m.fijarTipoCambioInicial(TASA);
    return ctx;
  };
  const carrito = (ctx: Ctx, t: string, n: number, precio: number, qty = 1) => {
    const caja = ctx.m.caja(t, n);
    const cart = caja.abrirCarrito();
    caja.agregarLinea(cart, { item_id: ctx.items[2]!.item_id, qty, precio_unit: precio });
    return { caja, cart };
  };
  const ledger = (ctx: Ctx, t = 'DUO', n = 1) => movimientosCaja(ctx.m.caja(t, n).ops(), t, n);
  const permiso = (ctx: Ctx, u: string) => { ctx.m.central.asignarPermiso(u, 'editar_tipo_cambio', true, 'admin'); ctx.m.pump(); };

  it('C1 devolución parcial de una venta con dólares: el reembolso es SOLO en pesos, con los importes originales (no recalcula con la tasa de hoy)', (t) => {
    const ctx = nuevo();
    t.after(ctx.limpiar);
    // 4 piezas de $300 = $1,200: US$50 ($900) + $400 → cambio $100, monto aplicado $1,200
    const { caja, cart } = carrito(ctx, 'DUO', 1, 30000, 4);
    const v = caja.cobrarEfectivoMixto(cart, { usd: 5000, pesos: 40000 });
    assert.deepEqual([v.total, v.pagos[0]!.cambio_mxn], [120000, 10000]);
    ctx.m.central.fijarTipoCambio(190000, 'admin', 1); ctx.m.pump(); // la tasa de hoy ya no es la de la venta
    const lin = v.lineas[0]!.linea_id;
    const d1 = caja.devolver({ sale_id: v.sale_id, renglones: [{ linea_id: lin, qty: 1 }], motivo: 'talla' });
    assert.deepEqual(d1.reembolsos, [{ metodo: 'efectivo', monto: 30000 }], 'pesos por el importe original de la pieza');
    const d2 = caja.devolver({ sale_id: v.sale_id, renglones: [{ linea_id: lin, qty: 3 }], motivo: 'resto' });
    assert.deepEqual(d2.reembolsos, [{ metodo: 'efectivo', monto: 90000 }]);
    assert.throws(() => caja.devolver({ sale_id: v.sale_id, renglones: [{ linea_id: lin, qty: 1 }], motivo: 'de más' }), { codigo: 'DEVOLUCION_EXCEDE' });
    const k = caja.corteEnVivo('2026-10-01');
    assert.deepEqual([k.devoluciones, k.devoluciones_en_efectivo, k.usd_recibidos], [120000, 120000, 5000], 'los dólares recibidos siguen en el cajón: no se devolvieron dólares');
    // pesos físicos: +400 −100 (cambio) −300 −900 = −900 ; dólares: +50
    assert.deepEqual([k.efectivo_esperado, k.efectivo_usd_esperado], [40000 - 10000 - 30000 - 90000, 5000]);
    assert.equal(ventas(caja.ops()).get(v.sale_id)!.pagos[0]!.tasa_version, 1, 'la venta conserva su tasa histórica');
  });

  it('C2 pago combinado con tarjeta bancaria: cada método se devuelve por su vía y nunca por más de lo pagado', (t) => {
    const ctx = nuevo();
    t.after(ctx.limpiar);
    const { caja, cart } = carrito(ctx, 'DUO', 1, 12000, 3); // $360: tarjeta $200 + efectivo $160
    const { intento } = caja.iniciarCobroTarjeta(cart, 20000);
    const v = caja.resolverIntento(intento.intent_id, { resultado: 'aprobado', autorizacion: 'AUT-1', efectivo_adicional: 16000 })!;
    const lin = v.lineas[0]!.linea_id;
    const reintegros: number[][] = [];
    for (let i = 0; i < 3; i++) {
      const d = caja.devolver({ sale_id: v.sale_id, renglones: [{ linea_id: lin, qty: 1 }], motivo: 'x' });
      reintegros.push([d.reembolsos.find((r) => r.metodo === 'efectivo')?.monto ?? 0, d.reembolsos.find((r) => r.metodo === 'tarjeta')?.monto ?? 0]);
      assert.equal(d.reembolsos.reduce((a, r) => a + r.monto, 0), d.importe);
    }
    assert.deepEqual(reintegros, [[5334, 6666], [5334, 6666], [5332, 6668]], 'proporcional; la última absorbe el redondeo');
    assert.deepEqual([reintegros.reduce((a, r) => a + r[0]!, 0), reintegros.reduce((a, r) => a + r[1]!, 0)], [16000, 20000], 'exactamente lo pagado por cada método');
    const k = caja.corteEnVivo('2026-10-01');
    assert.deepEqual([k.devoluciones_en_efectivo, k.devoluciones_a_tarjeta], [16000, 20000]);
    assert.equal(k.mxn.devoluciones, 16000, 'solo el efectivo mueve el cajón; el reverso a tarjeta se hace en la terminal');
    const txt = renderTicketDevolucionTexto(devoluciones(caja.ops())[0]!, ventas(caja.ops()).get(v.sale_id)!);
    assert.match(txt, /Reverso a tarjeta bancaria/);
  });

  it('C3 tarjeta de regalo + dólares + efectivo: se devuelve a la tarjeta lo de la tarjeta y en pesos lo demás', (t) => {
    const ctx = nuevo();
    t.after(ctx.limpiar);
    const c = ctx.m.caja('DUO', 1);
    c.altaTarjetaRegalo({ codigo: 'G', monto: 20000 }); ctx.m.pump();
    const { cart } = carrito(ctx, 'DUO', 1, 50000, 2); // $1,000: tarjeta $200 + $800 con US$50 ($900) → cambio $100
    const v = c.cobrarConTarjetaRegalo(cart, 'G', 0, 'Ana', 5000);
    const d = c.devolver({ sale_id: v.sale_id, renglones: [{ linea_id: v.lineas[0]!.linea_id, qty: 2 }], motivo: 'x' });
    assert.deepEqual(d.reembolsos, [{ metodo: 'efectivo', monto: 80000 }, { metodo: 'tarjeta_regalo', monto: 20000, tarjeta: 'G' }]);
    assert.equal(c.saldoTarjeta('G'), 20000);
  });

  it('C4 anulada ANTES de recibir dinero ≠ cancelada DESPUÉS de recibir efectivo; el libro físico nunca se borra', (t) => {
    const ctx = nuevo();
    t.after(ctx.limpiar);
    const { caja } = carrito(ctx, 'DUO', 1, 1);
    // anulación: nada de dinero, nada de folio
    const a = carrito(ctx, 'DUO', 1, 99900);
    caja.anularCarrito(a.cart, 'el cliente se arrepintió', 'Ana');
    assert.equal(ledger(ctx).length, 0, 'una anulación no mueve dinero');
    assert.equal(caja.estadoFolios().ultimo, 0);
    assert.deepEqual(caja.carritosAbiertos().includes(a.cart), false);
    assert.throws(() => caja.anularCarrito(a.cart, 'otra vez'), { codigo: 'CARRITO_CERRADO' });
    const audit = caja.ops().find((o) => o.tipo === 'sale.voided')!;
    assert.deepEqual([audit.payload.total, audit.payload.motivo, audit.payload.usuario], [99900, 'el cliente se arrepintió', 'Ana']);
    // cancelación de una venta cobrada con dólares: sus movimientos permanecen y se suma la salida de pesos
    const b = carrito(ctx, 'DUO', 1, 125000);
    const v = caja.cobrarEfectivoMixto(b.cart, { usd: 5000, pesos: 50000 });
    const antes = ledger(ctx).map((m) => JSON.stringify(m));
    assert.throws(() => caja.anularCarrito(b.cart, 'ya cobrada'), { codigo: 'VENTA_YA_CONFIRMADA' });
    caja.cancelarVenta(v.sale_id, 'error de captura');
    const despues = ledger(ctx);
    assert.deepEqual(despues.slice(0, antes.length).map((m) => JSON.stringify(m)), antes, 'ningún movimiento físico anterior se elimina ni se edita');
    assert.deepEqual(despues.slice(antes.length).map((m) => [m.moneda, m.tipo, m.monto]), [['MXN', 'cancelacion', -125000]]);
    const k = caja.corteEnVivo('2026-10-01');
    assert.deepEqual([k.ventas_anuladas_antes_de_cobro, k.cancelaciones_posteriores_al_cobro, k.tickets, k.ventas], [1, 1, 0, 0]);
    // pesos: +500 −150 −1,250 = −900 ; dólares: los US$50 siguen en el cajón (el reembolso es en pesos)
    assert.deepEqual([k.efectivo_esperado, k.efectivo_usd_esperado], [50000 - 15000 - 125000, 5000]);
    assert.throws(() => caja.devolver({ sale_id: v.sale_id, renglones: [{ linea_id: v.lineas[0]!.linea_id, qty: 1 }], motivo: 'x' }), { codigo: 'DEVOLUCION_BLOQUEADA' });
  });

  it('C5 cancelar una venta en pesos deja neto cero en el cajón (cobro, cambio y cancelación quedan en el libro); no se cancela lo ya devuelto', (t) => {
    const ctx = nuevo();
    t.after(ctx.limpiar);
    const a = carrito(ctx, 'DUO', 1, 12000, 2);
    const v = a.caja.cobrarEfectivo(a.cart, 30000);
    a.caja.cancelarVenta(v.sale_id, 'x');
    assert.deepEqual(ledger(ctx).map((m) => [m.tipo, m.monto]), [['cobro', 30000], ['cambio', -6000], ['cancelacion', -24000]]);
    assert.equal(a.caja.corteEnVivo('2026-10-01').efectivo_esperado, 0);
    const b = carrito(ctx, 'DUO', 1, 12000, 2);
    const w = b.caja.cobrarEfectivo(b.cart, 24000);
    b.caja.devolver({ sale_id: w.sale_id, renglones: [{ linea_id: w.lineas[0]!.linea_id, qty: 1 }], motivo: 'x' });
    assert.throws(() => b.caja.cancelarVenta(w.sale_id, 'x'), { codigo: 'CANCELACION_BLOQUEADA' });
  });

  it('C6 toda entrada o salida física queda en el libro por moneda y el esperado de cada moneda sale de él', (t) => {
    const ctx = nuevo();
    t.after(ctx.limpiar);
    const { caja } = carrito(ctx, 'DUO', 1, 1);
    caja.movimientoEfectivo('fondo_inicial', 100000);
    caja.movimientoEfectivo('fondo_inicial', 5000, 'USD');
    const a = carrito(ctx, 'DUO', 1, 125000);
    const v = caja.cobrarEfectivoMixto(a.cart, { usd: 5000, pesos: 50000 });
    caja.devolver({ sale_id: v.sale_id, renglones: [{ linea_id: v.lineas[0]!.linea_id, qty: 1 }], motivo: 'x' });
    caja.movimientoEfectivo('retiro', 2000, 'USD');
    caja.movimientoEfectivo('entrada', 3000);
    const libro = ledger(ctx);
    assert.deepEqual(libro.map((m) => [m.moneda, m.tipo, m.monto]), [
      ['MXN', 'fondo_inicial', 100000], ['USD', 'fondo_inicial', 5000], ['USD', 'cobro', 5000], ['MXN', 'cobro', 50000], ['MXN', 'cambio', -15000],
      ['MXN', 'devolucion', -125000], ['USD', 'retiro', -2000], ['MXN', 'entrada', 3000],
    ]);
    assert.equal(libro.find((m) => m.moneda === 'USD' && m.tipo === 'cobro')!.tasa, TASA, 'cada cobro en dólares conserva su tasa histórica');
    const k = caja.corteEnVivo('2026-10-01');
    for (const [moneda, esperado] of [['MXN', k.efectivo_esperado], ['USD', k.efectivo_usd_esperado]] as const) {
      assert.equal(libro.filter((m) => m.moneda === moneda).reduce((a, m) => a + m.monto, 0), esperado);
    }
    assert.deepEqual([k.mxn.esperado, k.usd.esperado], [100000 + 50000 - 15000 - 125000 + 3000, 5000 + 5000 - 2000]);
  });

  it('B1 solo billetes: sin centavos ni monedas; el hub también lo exige', (t) => {
    const ctx = nuevo();
    t.after(ctx.limpiar);
    const a = carrito(ctx, 'DUO', 1, 12000);
    for (const usd of [5050, 50, 1, 99, 150]) assert.throws(() => a.caja.cobrarEfectivoMixto(a.cart, { usd, pesos: 100000 }), { codigo: 'USD_SOLO_BILLETES' }, `US$${usd / 100} no es un número entero de dólares`);
    assert.equal(a.caja.estadoFolios().ultimo, 0);
    assert.equal(a.caja.cobrarEfectivoMixto(a.cart, { usd: 700 }).pagos[0]!.usd, 700, 'US$7 = 5 + 2: se arma con billetes aceptados');
    const cfg = [{ tienda: 'DUO', caja: 1, metodos: ['efectivo' as const] }];
    const op = (usd: number): Op => ({ op_id: 'x', tipo: 'sale.confirmed', tienda: 'DUO', caja: 1, origen: 'caja:DUO/1', ocurrio_en: '2026-10-01T15:00:00Z', payload: { tienda: 'DUO', caja: 1, total: 12000, pagos: [{ metodo: 'efectivo_usd', monto: 12000, usd, tasa: TASA, tasa_version: 1, equivalente: Math.floor((usd * TASA + 5000) / 10000), pesos_recibidos: 0, cambio_mxn: Math.floor((usd * TASA + 5000) / 10000) - 12000 }] } });
    assert.equal(validarOpEntrante(op(1000), cfg), null);
    assert.equal(validarOpEntrante(op(1050), cfg), 'efectivo_usd_no_billetes');
  });

  it('B2 rechazo de un billete dañado o sospechoso: solo constancia, sin mover dinero y sin detección automática', (t) => {
    const ctx = nuevo();
    t.after(ctx.limpiar);
    const { caja } = carrito(ctx, 'DUO', 1, 1);
    caja.registrarBilleteRechazado({ denominacion: 100, motivo: 'sospechoso', nota: 'sin marca de agua', usuario: 'Ana' });
    caja.registrarBilleteRechazado({ denominacion: 20, cantidad: 2, motivo: 'danado', usuario: 'Ana' });
    assert.throws(() => caja.registrarBilleteRechazado({ denominacion: 3, motivo: 'danado', usuario: 'Ana' }), { codigo: 'CONTEO_INVALIDO' });
    assert.throws(() => caja.registrarBilleteRechazado({ denominacion: 5, cantidad: 0, motivo: 'danado', usuario: 'Ana' }), { codigo: 'CONTEO_INVALIDO' });
    assert.throws(() => caja.registrarBilleteRechazado({ denominacion: 5, motivo: 'raro' as never, usuario: 'Ana' }), { codigo: 'DATOS_REQUERIDOS' });
    const k = caja.corteEnVivo('2026-10-01');
    assert.deepEqual([k.billetes_usd_rechazados, k.efectivo_usd_esperado, k.efectivo_esperado], [3, 0, 0]);
    assert.equal(ledger(ctx).length, 0);
  });

  it('F1 tipo de cambio: más del 10 % pide una confirmación adicional; los cambios normales no; queda en el historial', (t) => {
    const ctx = nuevo();
    t.after(ctx.limpiar);
    permiso(ctx, 'Ana');
    const c = ctx.m.caja('DUO', 1);
    const n1 = c.fijarTipoCambio(198000, 'Ana'); // exactamente +10 %: sin confirmación
    assert.deepEqual([n1.version, n1.tasa], [2, 198000]);
    assert.throws(() => c.fijarTipoCambio(220000, 'Ana'), (e: any) => e.codigo === 'CONFIRMACION_REQUERIDA' && e.detalle.variacion_pb === 1111 && e.detalle.anterior === 198000);
    assert.equal(c.tipoCambio()!.version, 2, 'sin confirmar no cambia nada');
    const n2 = c.fijarTipoCambio(220000, 'Ana', false, true);
    assert.equal(n2.version, 3);
    ctx.m.pump();
    const reg = ctx.m.central.repo.ops().filter((o) => o.tipo === 'config.tipo_cambio').map((o) => [o.payload.version, o.payload.variacion_pb, o.payload.variacion_confirmada, o.payload.usuario]);
    assert.deepEqual(reg, [[1, 0, false, 'sistema'], [2, 1000, false, 'Ana'], [3, 1111, true, 'Ana']]);
    assert.equal(ctx.m.central.fijarTipoCambio(100000, 'admin', 3).motivo, 'confirmacion_requerida', 'también a la baja y también desde Administración');
  });

  it('E1 advertencia de cambio: solo cuando el cambio en pesos excede el efectivo CONOCIDO; sin fondo no se inventa y el cobro no se bloquea', (t) => {
    const ctx = nuevo();
    t.after(ctx.limpiar);
    const { caja } = carrito(ctx, 'DUO', 1, 1);
    // sin fondo registrado: se desconoce el efectivo → ninguna advertencia
    const a = carrito(ctx, 'DUO', 1, 125000);
    assert.deepEqual(caja.cobrarEfectivoMixto(a.cart, { usd: 10000 }).avisos ?? [], [], 'US$100 por $1,250: cambio $550 sin saldo conocido');
    assert.deepEqual(caja.efectivoMxnConocido(), { conocido: false, disponible: null });
    // con fondo de $100: el cambio de $550 excede lo conocido → avisa, pero cobra
    caja.movimientoEfectivo('fondo_inicial', 10000);
    assert.deepEqual(caja.efectivoMxnConocido(), { conocido: true, disponible: 10000 + 0 - 0 + 0 - 0 + (-55000 + 0) + 0 });
    const b = carrito(ctx, 'DUO', 1, 125000);
    const v = caja.cobrarEfectivoMixto(b.cart, { usd: 10000 });
    assert.equal(v.estado, 'confirmada');
    assert.deepEqual(v.avisos, ['cambio_excede_efectivo_mxn:100000'], 'disponible −450 (ya negativo) → faltan $1,000 para dar $550');
    // con suficiente efectivo conocido no hay aviso
    caja.movimientoEfectivo('entrada', 500000);
    const c = carrito(ctx, 'DUO', 1, 125000);
    assert.deepEqual(caja.cobrarEfectivoMixto(c.cart, { usd: 10000 }).avisos ?? [], []);
    // el cobro ordinario en pesos nunca advierte
    const d = carrito(ctx, 'DUO', 1, 12000);
    assert.deepEqual(caja.cobrarEfectivo(d.cart, 20000).avisos ?? [], []);
  });

  it('S1 tasa sin verificar: advierte y, si la política lo define, deja de recibir DÓLARES; los pesos jamás se afectan', (t) => {
    const ctx = nuevo({ tasa_sin_verificar: { advertir_horas: 2, bloquear_usd_horas: 5 } });
    t.after(ctx.limpiar);
    const { caja } = carrito(ctx, 'DUO', 1, 1);
    assert.deepEqual([caja.estadoTasa().nivel, caja.estadoTasa().horas], ['ok', 0]);
    ctx.m.cortarInternet('DUO');
    ctx.m.reloj.avanzar(3 * H);
    assert.deepEqual([caja.estadoTasa().nivel, caja.estadoTasa().horas], ['advertencia', 3]);
    const inicio = carrito(ctx, 'DUO', 1, 12000); // un cobro que ya empezó con la tasa conserva la suya
    assert.equal(caja.bloquearTasa(inicio.cart).bloqueada.version, 1);
    ctx.m.reloj.avanzar(3 * H);
    assert.equal(caja.estadoTasa().nivel, 'bloqueada_usd');
    const nuevoCobro = carrito(ctx, 'DUO', 1, 12000);
    assert.throws(() => caja.bloquearTasa(nuevoCobro.cart), (e: any) => e.codigo === 'TASA_SIN_VERIFICAR' && e.detalle.horas === 6);
    assert.throws(() => caja.cobrarEfectivoMixto(nuevoCobro.cart, { usd: 1000 }), { codigo: 'TASA_SIN_VERIFICAR' });
    assert.equal(caja.cobrarEfectivo(nuevoCobro.cart, 12000).estado, 'confirmada', 'los pesos siguen normales');
    assert.equal(caja.cobrarEfectivoMixto(inicio.cart, { usd: 1000 }).pagos[0]!.tasa_version, 1, 'el cobro iniciado antes del bloqueo se completa');
    // al verificar contra el central vuelve a la normalidad
    ctx.m.restablecerInternet('DUO');
    caja.registrarVerificacionTasa();
    assert.deepEqual([caja.estadoTasa().nivel, caja.estadoTasa().horas], ['ok', 0]);
    const otro = carrito(ctx, 'DUO', 1, 12000);
    assert.equal(caja.cobrarEfectivoMixto(otro.cart, { usd: 1000 }).estado, 'confirmada');
  });

  it('S2 por omisión (sin política) solo advierte a las 12 h y nunca bloquea', (t) => {
    const ctx = nuevo();
    t.after(ctx.limpiar);
    const { caja } = carrito(ctx, 'DUO', 1, 1);
    ctx.m.reloj.avanzar(11 * H);
    assert.equal(caja.estadoTasa().nivel, 'ok');
    ctx.m.reloj.avanzar(2 * H);
    assert.deepEqual([caja.estadoTasa().nivel, caja.estadoTasa().bloquear_usd_horas], ['advertencia', null]);
    ctx.m.reloj.avanzar(24 * 30 * H);
    const a = carrito(ctx, 'DUO', 1, 12000);
    assert.equal(caja.cobrarEfectivoMixto(a.cart, { usd: 1000 }).estado, 'confirmada');
  });

  it('K1 cortes consolidados: pesos y dólares en columnas separadas, con diferencias por moneda y el equivalente histórico aparte', (t) => {
    const ctx = nuevo();
    t.after(ctx.limpiar);
    const d1 = ctx.m.caja('DUO', 1);
    const l2 = ctx.m.caja('LON', 2);
    d1.movimientoEfectivo('fondo_inicial', 100000); d1.movimientoEfectivo('fondo_inicial', 10000, 'USD');
    const a = carrito(ctx, 'DUO', 1, 125000);
    d1.cobrarEfectivoMixto(a.cart, { usd: 5000, pesos: 50000 }); // pesos +500 −150 ; USD +50
    ctx.m.central.fijarTipoCambio(190000, 'admin', 1); ctx.m.pump();
    const b = carrito(ctx, 'LON', 2, 100000);
    l2.cobrarEfectivoMixto(b.cart, { usd: 6000 }); // $1,140 a 19.00 ; cambio $140
    d1.movimientoEfectivo('retiro', 3000, 'USD'); d1.movimientoEfectivo('retiro', 20000);
    d1.registrarConteo({ moneda: 'USD', denominaciones: { '100': 1, '50': 1, '5': 1 }, usuario: 'Ana' }); // US$155 contados vs US$157 esperados
    d1.registrarConteo({ moneda: 'MXN', denominaciones: { '50000': 1, '20000': 1, '10000': 3 }, usuario: 'Ana' }); // $1,000 contados vs $1,150 esperados
    const k1 = d1.generarCorte('2026-10-01');
    l2.generarCorte('2026-10-01');
    ctx.m.pump(); ctx.m.pump();
    assert.deepEqual([k1.mxn.esperado, k1.mxn.contado, k1.mxn.diferencia], [100000 + 50000 - 15000 - 20000, 100000, -15000]);
    assert.deepEqual([k1.usd.esperado, k1.usd.contado, k1.usd.diferencia], [10000 + 5000 - 3000, 15500, 3500]);
    const filas = cortesPorCaja({ rol: 'admin', usuario: 'galo' }, ctx.m.central.repo.ops());
    assert.equal(filas.length, 2);
    const duo = filas.find((f) => f.tienda === 'DUO')!;
    assert.deepEqual([duo.mxn!.fondo, duo.mxn!.cobros, duo.mxn!.cambio, duo.mxn!.retiros, duo.mxn!.esperado, duo.mxn!.contado, duo.mxn!.diferencia], [100000, 50000, 15000, 20000, 115000, 100000, -15000]);
    assert.deepEqual([duo.usd!.fondo, duo.usd!.cobros, duo.usd!.retiros, duo.usd!.esperado, duo.usd!.contado, duo.usd!.diferencia, duo.usd!.equivalente_historico_mxn], [10000, 5000, 3000, 12000, 15500, 3500, 90000]);
    const lon = filas.find((f) => f.tienda === 'LON')!;
    assert.deepEqual([lon.mxn!.cambio, lon.mxn!.esperado, lon.usd!.cobros, lon.usd!.equivalente_historico_mxn, lon.usd!.contado], [14000, -14000, 6000, 114000, null]);
    // el equivalente es contable: no se suma a los pesos físicos ni cambia los dólares físicos
    assert.notEqual(lon.mxn!.esperado, lon.usd!.equivalente_historico_mxn);
  });

  it('K2 el corte cerrado conserva la distinción de cancelaciones y las devoluciones por moneda; cancelar no "arregla" el corte', (t) => {
    const ctx = nuevo();
    t.after(ctx.limpiar);
    const { caja } = carrito(ctx, 'DUO', 1, 1);
    const a = carrito(ctx, 'DUO', 1, 125000);
    const v = caja.cobrarEfectivoMixto(a.cart, { usd: 5000, pesos: 50000 });
    const antes = caja.corteEnVivo('2026-10-01');
    caja.cancelarVenta(v.sale_id, 'x');
    const despues = caja.corteEnVivo('2026-10-01');
    assert.deepEqual([antes.usd_recibidos, despues.usd_recibidos], [5000, 5000], 'los dólares siguen físicamente en el cajón: el reembolso fue en pesos');
    assert.deepEqual([antes.tickets_con_usd, despues.tickets_con_usd, despues.usd.equivalente_historico_mxn], [1, 0, 90000], 'el ticket ya no es una venta vigente, pero el equivalente histórico de los dólares físicos se conserva');
    assert.deepEqual([antes.efectivo_usd_esperado, despues.efectivo_usd_esperado], [5000, 5000]);
    assert.deepEqual([despues.mxn.cancelaciones, despues.mxn.cobros, despues.mxn.cambio], [125000, 50000, 15000], 'cobro, cambio y cancelación quedan a la vista');
  });
});
