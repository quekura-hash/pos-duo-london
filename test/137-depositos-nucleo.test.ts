import assert from 'node:assert/strict';
import { it } from 'node:test';
import { codigoFolioDeposito, codigoTicketDeposito, interpretarCodigoDeposito } from '../src/depositos.ts';
import { fechaLocal } from '../src/util.ts';
import { nuevoMundo, politica, porAlmacen } from './ayudas/comun.ts';

porAlmacen('Depósitos en garantía: núcleo (recibir, buscar, resolver, aplicar, corte)', (alm) => {
  const escenario = (t: { after: (f: () => void) => void }) => {
    const ctx = nuevoMundo(alm, politica());
    t.after(ctx.limpiar);
    const { m, items } = ctx;
    const hoy = () => fechaLocal(m.reloj.now());
    const cod = (id: string) => codigoTicketDeposito(m.caja('DUO', 1).depositoPorId(id)!);
    const dep = (caja = 1, clienta = 'María González', monto = 30000, ref = `r${Math.random()}`) => m.caja('DUO', caja).recibirDeposito({ ref, clienta, monto, usuario: 'Ana' });
    const carrito = (caja = 1, qty = 1) => { const c = m.caja('DUO', caja); const cart = c.abrirCarrito(); const l = c.agregarLinea(cart, { item_id: items[2]!.item_id, qty }); return { c, cart, importe: l.importe }; };
    const efectivo = (caja = 1) => m.caja('DUO', caja).corteEnVivo(hoy()).mxn.esperado;
    return { ctx, m, hoy, dep, carrito, efectivo, cod };
  };

  it('DP1 recibir un depósito: efectivo +$300, ventas $0, folio propio y asociado a tienda/caja/cajera', (t) => {
    const { m, dep, hoy, cod } = escenario(t);
    const d = dep(1);
    assert.equal(d.folio, 'DEP-D1-0001');
    assert.deepEqual([d.tienda, d.caja, d.cajero, d.clienta, d.monto, d.saldo, d.estado], ['DUO', 1, 'Ana', 'María González', 30000, 30000, 'pendiente']);
    assert.equal(d.concepto, 'Prueba de vestido de noche');
    const corte = m.caja('DUO', 1).corteEnVivo(hoy());
    assert.equal(corte.mxn.esperado, 30000, 'el efectivo del cajón sube');
    assert.equal(corte.ventas, 0, 'no es una venta');
    assert.equal(corte.ventas_netas, 0);
    assert.equal(corte.tickets, 0);
    assert.deepEqual([corte.depositos.recibidos, corte.depositos.recibidos_n, corte.depositos.pendiente, corte.mxn.depositos_recibidos], [30000, 1, 30000, 30000]);
  });
  it('DP2 validaciones: nombre y monto obligatorios, monto positivo entero', (t) => {
    const { m, cod } = escenario(t);
    const c = m.caja('DUO', 1);
    assert.throws(() => c.recibirDeposito({ ref: 'a', clienta: ' ', monto: 100, usuario: 'Ana' }), { codigo: 'DATOS_REQUERIDOS' });
    assert.throws(() => c.recibirDeposito({ ref: 'b', clienta: 'Ana', monto: 0, usuario: 'Ana' }), { codigo: 'PAGO_INVALIDO' });
    assert.throws(() => c.recibirDeposito({ ref: 'c', clienta: 'Ana', monto: -5, usuario: 'Ana' }), { codigo: 'PAGO_INVALIDO' });
    assert.throws(() => c.recibirDeposito({ ref: 'd', clienta: 'Ana', monto: 10.5, usuario: 'Ana' }), { codigo: 'PAGO_INVALIDO' });
    assert.equal(c.depositosTodos().length, 0);
  });
  it('DP3 doble clic / reintento con la misma referencia: un solo depósito y un solo movimiento de efectivo', (t) => {
    const { m, hoy, cod } = escenario(t);
    const c = m.caja('DUO', 1);
    const a = c.recibirDeposito({ ref: 'x1', clienta: 'Lupe', monto: 20000, usuario: 'Ana' });
    const b = c.recibirDeposito({ ref: 'x1', clienta: 'Lupe', monto: 20000, usuario: 'Ana' });
    assert.equal(a.deposito_id, b.deposito_id);
    assert.equal(c.depositosTodos().length, 1);
    assert.equal(c.corteEnVivo(hoy()).mxn.esperado, 20000);
  });
  it('DP4 folios únicos entre cajas (también sin conexión) y distintos del contador de ventas', (t) => {
    const { m, dep, cod } = escenario(t);
    m.cortarLan('DUO', 2);
    const a = dep(1, 'Ana A'), b = dep(2, 'Beatriz'), a2 = dep(1, 'Carla');
    assert.deepEqual([a.folio, b.folio, a2.folio], ['DEP-D1-0001', 'DEP-D2-0001', 'DEP-D1-0002']);
    assert.equal(new Set([a.folio, b.folio, a2.folio]).size, 3);
  });
  it('DP5 búsqueda por folio (lector) y por nombre (sin acentos ni mayúsculas); un código desconocido no devuelve nada', (t) => {
    const { m, dep, cod } = escenario(t);
    dep(1, 'María González'); dep(1, 'Lupe Pérez');
    const c = m.caja('DUO', 1);
    assert.deepEqual(c.buscarDepositos('DEP-D1-0001').map((d) => d.clienta), ['María González']);
    assert.deepEqual(c.buscarDepositos('dep-d1-0002').map((d) => d.clienta), ['Lupe Pérez']);
    assert.deepEqual(c.buscarDepositos('maria gonzalez').map((d) => d.clienta), ['María González']);
    assert.deepEqual(c.buscarDepositos('PEREZ').map((d) => d.clienta), ['Lupe Pérez']);
    assert.deepEqual(c.buscarDepositos('DEP-D1-9999'), []);
    assert.deepEqual(c.buscarDepositos(''), []);
  });
  it('DP6 devolución completa: sale el efectivo, el saldo queda en cero, no suma ventas; reintento no entrega dos veces', (t) => {
    const { m, dep, hoy, cod } = escenario(t);
    const d = dep(1);
    const c = m.caja('DUO', 1);
    assert.throws(() => c.devolverDeposito({ ref: 'dev0', deposito_id: d.deposito_id, codigo: cod(d.deposito_id), confirmado: false, usuario: 'Ana' }), { codigo: 'CONFIRMACION_REQUERIDA' });
    const r = c.devolverDeposito({ ref: 'dev1', deposito_id: d.deposito_id, codigo: cod(d.deposito_id), confirmado: true, usuario: 'Ana' });
    assert.equal(r.monto, 30000);
    assert.deepEqual([r.deposito.saldo, r.deposito.estado, r.deposito.devuelto], [0, 'cerrado', 30000]);
    c.devolverDeposito({ ref: 'dev1', deposito_id: d.deposito_id, codigo: cod(d.deposito_id), confirmado: true, usuario: 'Ana' }); // doble clic
    const corte = c.corteEnVivo(hoy());
    assert.equal(corte.mxn.esperado, 0);
    assert.deepEqual([corte.depositos.devueltos, corte.depositos.devueltos_n, corte.depositos.pendiente, corte.ventas], [30000, 1, 0, 0]);
    assert.throws(() => c.devolverDeposito({ ref: 'dev2', deposito_id: d.deposito_id, codigo: cod(d.deposito_id), confirmado: true, usuario: 'Ana' }), { codigo: 'DEPOSITO_CERRADO' });
  });
  it('DP7 devolución parcial: queda saldo y estado «parcial»; no se puede devolver más que el saldo', (t) => {
    const { m, dep, cod } = escenario(t);
    const d = dep(1);
    const c = m.caja('DUO', 1);
    const r = c.devolverDeposito({ ref: 'p1', deposito_id: d.deposito_id, codigo: cod(d.deposito_id), monto: 10000, confirmado: true, usuario: 'Ana' });
    assert.deepEqual([r.deposito.saldo, r.deposito.estado], [20000, 'parcial']);
    assert.throws(() => c.devolverDeposito({ ref: 'p2', deposito_id: d.deposito_id, codigo: cod(d.deposito_id), monto: 25000, confirmado: true, usuario: 'Ana' }), { codigo: 'DEPOSITO_EXCEDE_SALDO' });
    assert.deepEqual(c.depositosPendientes().map((x) => [x.folio, x.saldo, x.estado]), [['DEP-D1-0001', 20000, 'parcial']]);
  });
  it('DP8 fee por daño: se retiene sin mover efectivo, el resto se devuelve; un fee mayor al saldo se rechaza', (t) => {
    const { m, dep, hoy, cod } = escenario(t);
    const d = dep(1);
    const c = m.caja('DUO', 1);
    assert.throws(() => c.cobrarFeeDeposito({ ref: 'f0', deposito_id: d.deposito_id, monto: 40000, motivo: 'cierre roto', usuario: 'Ana' }), { codigo: 'DEPOSITO_EXCEDE_SALDO' });
    assert.throws(() => c.cobrarFeeDeposito({ ref: 'f0', deposito_id: d.deposito_id, monto: 15000, motivo: 'x', usuario: 'Ana' }), { codigo: 'DATOS_REQUERIDOS' });
    const f = c.cobrarFeeDeposito({ ref: 'f1', deposito_id: d.deposito_id, monto: 15000, motivo: 'Cierre roto', usuario: 'Ana' });
    assert.deepEqual([f.deposito.saldo, f.deposito.retenido, f.deposito.estado], [15000, 15000, 'parcial']);
    c.cobrarFeeDeposito({ ref: 'f1', deposito_id: d.deposito_id, monto: 15000, motivo: 'Cierre roto', usuario: 'Ana' }); // reintento
    assert.equal(c.depositoPorId(d.deposito_id)!.retenido, 15000);
    assert.equal(c.corteEnVivo(hoy()).mxn.esperado, 30000, 'retener no mueve efectivo');
    c.devolverDeposito({ ref: 'f2', deposito_id: d.deposito_id, codigo: cod(d.deposito_id), confirmado: true, usuario: 'Ana' });
    const corte = c.corteEnVivo(hoy());
    assert.deepEqual([corte.mxn.esperado, corte.depositos.fees, corte.depositos.devueltos, corte.depositos.pendiente], [15000, 15000, 15000, 0]);
    assert.equal(c.depositoPorId(d.deposito_id)!.estado, 'cerrado');
  });
  it('DP9 aplicar a una compra (total del depósito): el precio no cambia, la venta es completa y única, el efectivo cobrado es solo la diferencia', (t) => {
    const { m, dep, carrito, hoy, cod } = escenario(t);
    const d = dep(1, 'Clienta', 10000);
    const { c, cart, importe } = carrito(1, 3);
    assert.ok(importe > 10000);
    const r = c.aplicarDepositoACarrito(cart, d.deposito_id, 'Ana', { codigo: cod(d.deposito_id) });
    assert.equal(r.aplicado, 10000);
    const resto = importe - 10000;
    const venta = c.cobrar(cart, [{ metodo: 'efectivo', monto: resto, recibido: resto, cambio: 0 }]);
    assert.equal(venta.total, importe, 'la venta conserva el importe completo');
    assert.deepEqual(venta.pagos.map((p) => [p.metodo, p.monto]), [['deposito', 10000], ['efectivo', resto]]);
    const dd = c.depositoPorId(d.deposito_id)!;
    assert.deepEqual([dd.saldo, dd.aplicado, dd.estado], [0, 10000, 'cerrado']);
    const corte = c.corteEnVivo(hoy());
    assert.equal(corte.ventas, importe, 'la venta se reconoce completa, una sola vez');
    assert.equal(corte.mxn.esperado, 10000 + resto, 'el efectivo del depósito ya estaba: solo entra lo cobrado');
    assert.deepEqual([corte.depositos.aplicados, corte.depositos.pendiente], [10000, 0]);
    void m;
  });
  it('DP10 aplicación parcial (saldo mayor que la compra): se usa solo lo necesario y queda el remanente', (t) => {
    const { dep, carrito, cod } = escenario(t);
    const { c, cart, importe } = carrito(1, 1);
    const d = dep(1, 'Clienta', importe + 5000);
    const r = c.aplicarDepositoACarrito(cart, d.deposito_id, 'Ana', { codigo: cod(d.deposito_id) });
    assert.deepEqual([r.aplicado, r.resto_saldo], [importe, 5000]);
    const venta = c.cobrar(cart, []);
    assert.deepEqual(venta.pagos.map((p) => [p.metodo, p.monto]), [['deposito', importe]]);
    const dd = c.depositoPorId(d.deposito_id)!;
    assert.deepEqual([dd.saldo, dd.estado], [5000, 'parcial']);
  });
  it('DP11 reservar no consume: quitar o anular la venta libera el depósito sin perderlo; otra venta no puede tomarlo mientras está reservado', (t) => {
    const { m, dep, carrito, cod } = escenario(t);
    const d = dep(1, 'Clienta', 10000);
    const a = carrito(1, 3);
    a.c.aplicarDepositoACarrito(a.cart, d.deposito_id, 'Ana', { codigo: cod(d.deposito_id) });
    assert.equal(a.c.depositoPorId(d.deposito_id)!.saldo, 10000, 'solo reservado: el saldo no cambia');
    const b = carrito(1, 3);
    assert.throws(() => b.c.aplicarDepositoACarrito(b.cart, d.deposito_id, 'Ana', { codigo: cod(d.deposito_id) }), { codigo: 'DEPOSITO_RESERVADO' });
    assert.throws(() => a.c.devolverDeposito({ ref: 'r1', deposito_id: d.deposito_id, codigo: cod(d.deposito_id), confirmado: true, usuario: 'Ana' }), { codigo: 'DEPOSITO_RESERVADO' });
    a.c.anularCarrito(a.cart, 'cambió de opinión', 'Ana');
    const r = b.c.aplicarDepositoACarrito(b.cart, d.deposito_id, 'Ana', { codigo: cod(d.deposito_id) });
    assert.equal(r.aplicado, 10000);
    b.c.quitarDepositoDeCarrito(b.cart);
    assert.equal(b.c.depositoDeCarrito(b.c['cartGet'](b.cart)), null);
    assert.equal(b.c.depositoPorId(d.deposito_id)!.saldo, 10000);
    void m;
  });
  it('DP12 cancelar la compra ya cobrada devuelve el saldo al depósito (no entrega efectivo por esa parte)', (t) => {
    const { dep, carrito, hoy, cod } = escenario(t);
    const d = dep(1, 'Clienta', 10000);
    const { c, cart, importe } = carrito(1, 3);
    c.aplicarDepositoACarrito(cart, d.deposito_id, 'Ana', { codigo: cod(d.deposito_id) });
    const resto = importe - 10000;
    const venta = c.cobrar(cart, [{ metodo: 'efectivo', monto: resto, recibido: resto, cambio: 0 }]);
    c.cancelarVenta(venta.sale_id, 'no le quedó', 'Ana');
    const dd = c.depositoPorId(d.deposito_id)!;
    assert.deepEqual([dd.saldo, dd.estado], [10000, 'parcial']);
    const corte = c.corteEnVivo(hoy());
    assert.equal(corte.mxn.esperado, 10000, 'solo queda en el cajón el efectivo del depósito');
    assert.equal(corte.depositos.pendiente, 10000);
  });
  it('DP13 compra pagada por completo con depósito + pago mixto con dólares/tarjeta de regalo se bloquea o cuadra', (t) => {
    const { dep, carrito, cod } = escenario(t);
    const d = dep(1, 'Clienta', 10000);
    const { c, cart } = carrito(1, 3);
    c.aplicarDepositoACarrito(cart, d.deposito_id, 'Ana', { codigo: cod(d.deposito_id) });
    // un depósito no se aplica a tarjetas de regalo ni a ventas a empleada
    const g = c.abrirCarrito();
    c.agregarLinea(g, { item_id: carrito(1, 1).c['cartGet'](cart).lineas[0]!.item_id, qty: 1 });
    // el pago de efectivo sigue siendo sobre el neto (la caja pide solo lo que falta)
    assert.throws(() => c.cobrar(cart, [{ metodo: 'efectivo', monto: 1 }]), { codigo: 'PAGO_INVALIDO' });
  });
  it('DP14 dos cajas: sin comunicación con el hub la resolución se bloquea; con comunicación, lo resuelto en una caja se ve en la otra y no se entrega dos veces', (t) => {
    const { m, dep, cod } = escenario(t);
    const d = dep(1, 'Clienta', 30000);
    m.pump(); m.pump(); m.pump();
    const c2 = m.caja('DUO', 2);
    assert.equal(c2.depositoPorId(d.deposito_id)?.saldo, 30000, 'la otra caja ve el depósito');
    m.cortarLan('DUO', 2);
    assert.throws(() => c2.devolverDeposito({ ref: 'o1', deposito_id: d.deposito_id, codigo: cod(d.deposito_id), confirmado: true, usuario: 'Bea' }), { codigo: 'DEPOSITO_NO_VERIFICABLE' });
    assert.equal(c2.depositoPorId(d.deposito_id)!.saldo, 30000, 'bloqueado: no hubo movimiento');
    // la caja 1 la devuelve; la caja 2 ya no puede entregarla de nuevo
    m.caja('DUO', 1).devolverDeposito({ ref: 'o2', deposito_id: d.deposito_id, codigo: cod(d.deposito_id), confirmado: true, usuario: 'Ana' });
    m.pump(); m.pump(); m.pump();
    assert.equal(c2.depositoPorId(d.deposito_id)!.saldo, 30000, 'sigue sin conexión: aún no ve la devolución');
    assert.throws(() => c2.devolverDeposito({ ref: 'o3', deposito_id: d.deposito_id, codigo: cod(d.deposito_id), confirmado: true, usuario: 'Bea' }), { codigo: 'DEPOSITO_NO_VERIFICABLE' });
  });
  it('DP15 el saldo no se edita: dos resoluciones que nunca se vieron dejan el depósito marcado como inconsistente y bloqueado', (t) => {
    const { m, dep, cod } = escenario(t);
    const d = dep(1, 'Clienta', 30000);
    m.pump(); m.pump(); m.pump();
    const c1 = m.caja('DUO', 1);
    // Se fuerza el peor caso: cada caja registra la devolución antes de enterarse de la otra.
    c1.devolverDeposito({ ref: 'z1', deposito_id: d.deposito_id, codigo: cod(d.deposito_id), confirmado: true, usuario: 'Ana' });
    const c2 = m.caja('DUO', 2);
    c2['emitir']('deposito.devuelto', { deposito_id: d.deposito_id, folio: d.folio, monto: 30000, tienda: 'DUO', caja: 2, usuario: 'Bea' }, 'depres:z2');
    m.pump(); m.pump(); m.pump();
    const x = c1.depositoPorId(d.deposito_id)!;
    assert.equal(x.saldo, -30000);
    assert.equal(x.inconsistente, true);
    assert.throws(() => c1.devolverDeposito({ ref: 'z3', deposito_id: d.deposito_id, codigo: cod(d.deposito_id), confirmado: true, usuario: 'Ana' }), { codigo: 'DEPOSITO_INCONSISTENTE' });
  });
  it('DP16 un depósito de la otra tienda no se resuelve aquí', (t) => {
    const { m, cod } = escenario(t);
    const d = m.caja('LON', 1).recibirDeposito({ ref: 'l1', clienta: 'Clienta', monto: 10000, usuario: 'Eva' });
    m.pump(); m.pump(); m.pump(); m.pump();
    const c = m.caja('DUO', 1);
    if (c.depositoPorId(d.deposito_id)) assert.throws(() => c.devolverDeposito({ ref: 'q1', deposito_id: d.deposito_id, codigo: cod(d.deposito_id), confirmado: true, usuario: 'Ana' }), { codigo: 'DEPOSITO_OTRA_TIENDA' });
  });
  it('DP17 historial/auditoría: cada movimiento guarda quién, cuándo, caja y monto; nada se borra', (t) => {
    const { m, dep, cod } = escenario(t);
    const d = dep(1, 'Clienta', 30000);
    const c = m.caja('DUO', 1);
    c.cobrarFeeDeposito({ ref: 'h1', deposito_id: d.deposito_id, monto: 5000, motivo: 'Mancha', usuario: 'Ana' });
    c.devolverDeposito({ ref: 'h2', deposito_id: d.deposito_id, codigo: cod(d.deposito_id), confirmado: true, usuario: 'Ana' });
    const h = c.depositoPorId(d.deposito_id)!.movimientos;
    assert.deepEqual(h.map((x) => [x.tipo, x.monto, x.usuario, x.caja, x.tienda]), [['recibido', 30000, 'Ana', 1, 'DUO'], ['fee', 5000, 'Ana', 1, 'DUO'], ['devuelto', 25000, 'Ana', 1, 'DUO']]);
    assert.ok(h.every((x) => x.ocurrio_en && x.op_id));
    assert.equal(h[1]!.motivo, 'Mancha');
  });
  it('DP18 el código del comprobante: sin él (o con uno ajeno, o solo con el folio) no se entrega ni se aplica; sin cajeros con clave no hay doble clave', (t) => {
    const { m, dep, carrito } = escenario(t);
    const d = dep(1, 'Clienta', 30000);
    const otro = dep(1, 'Otra clienta', 10000);
    const c = m.caja('DUO', 1);
    const base = { ref: 'x', deposito_id: d.deposito_id, confirmado: true, usuario: 'Ana' };
    assert.throws(() => c.devolverDeposito(base), { codigo: 'DEPOSITO_CODIGO_REQUERIDO' });
    assert.throws(() => c.devolverDeposito({ ...base, codigo: d.folio }), { codigo: 'DEPOSITO_CODIGO_INVALIDO' }, 'solo el folio no basta: es adivinable');
    assert.throws(() => c.devolverDeposito({ ...base, codigo: `${d.folio}-AAAAAA` }), { codigo: 'DEPOSITO_CODIGO_INVALIDO' });
    assert.throws(() => c.devolverDeposito({ ...base, codigo: codigoTicketDeposito(c.depositoPorId(otro.deposito_id)!) }), { codigo: 'DEPOSITO_CODIGO_INVALIDO' }, 'el código de otro depósito no sirve');
    assert.equal(c.depositoPorId(d.deposito_id)!.saldo, 30000, 'nada se movió');
    const k = carrito(1, 3);
    assert.throws(() => k.c.aplicarDepositoACarrito(k.cart, d.deposito_id, 'Ana'), { codigo: 'DEPOSITO_CODIGO_REQUERIDO' });
    const ok = c.devolverDeposito({ ...base, codigo: codigoTicketDeposito(c.depositoPorId(d.deposito_id)!).toLowerCase() });
    assert.equal(ok.deposito.estado, 'cerrado');
    assert.equal(ok.deposito.movimientos.at(-1)!.verificado_con, 'ticket');
  });
  it('DP20 el código leído tolera el «{B» de la impresora y símbolos en lugar de guiones (teclado mexicano); el código impreso es solo letras y números', (t) => {
    const sec = 'HWE48U';
    assert.equal(codigoTicketDeposito({ folio: 'DEP-L1-0002', secreto: sec }), 'DEPL10002HWE48U');
    const ok = { folio: 'DEP-L1-0002', secreto: sec };
    for (const leido of ['DEPL10002HWE48U', 'DEP-L1-0002-HWE48U', "{BDEP'L1'0002'HWE48U", '{BDEPL10002HWE48U', 'BDEPL10002HWE48U', "¨BDEP'L1'0002'HWE48U", ' dep-l1-0002-hwe48u ', "DEP'L10002'HWE48U"]) assert.deepEqual(interpretarCodigoDeposito(leido), ok, leido);
    for (const leido of ['DEPL10002', 'DEP-L1-0002', "{BDEP'L1'0002", '{BDEPL10002']) assert.deepEqual(interpretarCodigoDeposito(leido), { folio: 'DEP-L1-0002', secreto: null }, leido);
    for (const mal of ['', 'julia', 'Deposito', 'D1-000001', 'DEP-L1', 'DEP-L1-0002-ABC', 'DEPL1000']) assert.equal(interpretarCodigoDeposito(mal), null, mal);
    // el folio solo (comprobantes de devolución) también va sin guiones
    assert.deepEqual(interpretarCodigoDeposito(codigoFolioDeposito('DEP-L1-0002')), { folio: 'DEP-L1-0002', secreto: null });
    // y la búsqueda encuentra el depósito con la lectura sucia
    const { m, dep } = escenario(t);
    const d = dep(1, 'Julia', 20000);
    const c = m.caja('DUO', 1);
    const sucio = `{B${codigoTicketDeposito(c.depositoPorId(d.deposito_id)!).replace(/^DEP([A-Z]\d)(\d{4})/, "DEP'$1'$2'")}`;
    assert.deepEqual(c.buscarDepositos(sucio).map((x) => x.deposito_id), [d.deposito_id]);
    assert.equal(c.devolverDeposito({ ref: 'sucio', deposito_id: d.deposito_id, confirmado: true, usuario: 'Ana', codigo: sucio }).deposito.estado, 'cerrado', 'la lectura sucia también sirve para cobrar');
  });
  it('DP19 el SVG del código de barras usa los patrones Code128 del lector ZXing y su dígito de control es correcto', async (t) => {
    void t;
    const { PATRONES_CODE128, valoresCode128B, svgCode128 } = await import('../src/codigo128.ts');
    const { Code128Reader } = await import('@zxing/library');
    const zx = (Code128Reader as any).CODE_PATTERNS as number[][];
    assert.equal(PATRONES_CODE128.length, zx.length);
    PATRONES_CODE128.forEach((p, i) => assert.deepEqual([...p].map(Number), [...zx[i]!], `patrón ${i}`));
    const v = valoresCode128B('DEP-D1-0001-K7M2Q9');
    assert.equal(v[0], 104); assert.equal(v.at(-1), 106);
    assert.equal(v.at(-2), v.slice(0, -2).reduce((a, x, i) => a + (i === 0 ? x : x * i), 0) % 103);
    assert.match(svgCode128('DEP-D1-0001-K7M2Q9'), /^<svg[\s\S]*<rect[\s\S]*<\/svg>$/);
  });
});

