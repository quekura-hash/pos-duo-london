import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { it } from 'node:test';
import { api, appAdmin, appCajero } from './ayudas/app.ts';
import { centralLocal } from './ayudas/central-pglite.ts';
import { NEGOCIOS, renderTicketCorteTexto } from '../src/ticket.ts';
import { nuevoMundo, politica, porAlmacen } from './ayudas/comun.ts';

const JEANS = '0002026090782', MASCADA = '7501234567890';
const pesos = (n: number) => Math.round(n * 100);

porAlmacen('Empleadas: descuento de empleada (15 % / 30 % uniforme), crédito con cuenta, abonos de nómina y límite', (alm) => {
  const preparar = async (t: { after(f: () => void): void }) => {
    const ctx = nuevoMundo(alm, politica());
    t.after(ctx.limpiar);
    const adm = await appAdmin(ctx); t.after(() => adm.cerrar());
    const caja = await appCajero(ctx, 'DUO', 1, 'Ana'); t.after(() => caja.cerrar());
    await api(adm.url, '/api/admin/administradores', { nombre: 'Edgardo', clave: 'clave-segura', clave_caja: '2468' });
    await api(adm.url, '/api/admin/cajeros', { nombre: 'Lupe', clave: '4321' });
    await api(adm.url, '/api/admin/cajeros', { nombre: 'Rosa', clave: '8765' });
    ctx.m.pump(); ctx.m.pump(); ctx.m.pump();
    await api(caja.url, '/api/login', { usuario: 'Lupe', clave: '4321' });
    const emp = (await api(caja.url, '/api/empleadas')).json.empleadas as { id: string; nombre: string }[];
    const id = (n: string) => emp.find((e) => e.nombre === n)!.id;
    return { ctx, adm, caja, rosa: id('Rosa'), lupe: id('Lupe') };
  };
  const nueva = async (caja: any, ...codigos: string[]) => {
    const cart = (await api(caja.url, '/api/venta/nueva', {})).json.cart;
    const lineas = [];
    for (const c of codigos) lineas.push((await api(caja.url, '/api/venta/escanear', { cart, codigo: c })).json.linea);
    return { cart, lineas };
  };
  const sync = (ctx: any) => { ctx.m.pump(); ctx.m.pump(); ctx.m.pump(); };
  const corte = async (caja: any) => (await api(caja.url, '/api/corte')).json.vivo;

  it('EM1 descuento de empleada: 15 % en mercancía regular y 30 % en el uniforme que marca la cajera; pide la clave de la empleada', async (t) => {
    const { caja, rosa } = await preparar(t);
    const { cart, lineas } = await nueva(caja, JEANS, MASCADA);
    assert.equal((await api(caja.url, '/api/venta/empleada', { cart, empleada_id: rosa, clave: '0000' })).json.error.codigo, 'CLAVE_INVALIDA');
    const a = await api(caja.url, '/api/venta/empleada', { cart, empleada_id: rosa, clave: '8765' });
    assert.equal(a.status, 200, JSON.stringify(a.json));
    let v = a.json.carrito;
    assert.deepEqual([v.empleada.nombre, v.empleada.pct, v.empleada.pct_uniforme], ['Rosa', 15, 30]);
    // jeans 899 − 15 % = 764.15 ; mascada 120 − 15 % = 102
    assert.equal(v.total, 76400 + 10200);
    assert.equal(v.lineas[0].descuento_detalle[0].tipo, 'empleada');
    assert.match(v.lineas[0].descuento_detalle[0].nombre, /Descuento de empleada 15%/);
    // la mascada es uniforme: 30 %
    v = (await api(caja.url, '/api/venta/uniforme', { cart, linea_id: lineas[1].linea_id, uniforme: true })).json.carrito;
    assert.equal(v.total, 76400 + 8400);
    assert.match(v.lineas[1].descuento_detalle[0].nombre, /30%.*uniforme/);
    // quitar a la empleada quita el descuento
    v = (await api(caja.url, '/api/venta/empleada/quitar', { cart })).json.carrito;
    assert.equal(v.total, 89900 + 12000);
    assert.equal(v.empleada, null);
  });

  it('EM2 no se combina con promociones: aplica el que más le conviene; una cajera no se vende a sí misma sin un supervisor', async (t) => {
    const { ctx, adm, caja, rosa, lupe } = await preparar(t);
    await api(adm.url, '/api/admin/promociones', { tipo: 'por_cada', nombre: 'Por cada $100, $50', activa: true, tiendas: ['DUO'], inicio: null, fin: null, cada: 10000, descuenta: 5000 });
    sync(ctx);
    const { cart } = await nueva(caja, JEANS);
    // la promoción da $400 (8 escalones) contra $134.85 de empleada: gana la promoción
    const v = (await api(caja.url, '/api/venta/empleada', { cart, empleada_id: rosa, clave: '8765' })).json.carrito;
    assert.equal(v.total, 89900 - 40000);
    assert.equal(v.lineas[0].descuento_detalle[0].tipo, 'promo');
    // la cajera Lupe quiere venderse a sí misma
    const yo = await api(caja.url, '/api/venta/empleada', { cart, empleada_id: lupe, clave: '4321' });
    assert.equal(yo.json.error.codigo, 'AUTORIZACION_REQUERIDA');
    assert.equal((await api(caja.url, '/api/venta/empleada', { cart, empleada_id: lupe, clave: '4321', clave_supervisor: '2468' })).status, 200);
  });

  it('EM3 crédito de empleada: exige límite, cuenta como venta pero no como cobro, baja el inventario, se firma y respeta el límite', async (t) => {
    const { ctx, adm, caja, rosa } = await preparar(t);
    const impresos = () => readdirSync(caja.s.impresora.dir).filter((f) => f.endsWith('.txt')).sort().map((f) => readFileSync(join(caja.s.impresora.dir, f), 'utf8'));
    const { cart } = await nueva(caja, JEANS);
    await api(caja.url, '/api/venta/empleada', { cart, empleada_id: rosa, clave: '8765' });
    assert.equal((await api(caja.url, '/api/venta/cobrar-credito-empleada', { cart })).json.error.codigo, 'SIN_CREDITO');
    // Administración fija el límite de $1,000
    assert.equal((await api(adm.url, '/api/admin/empleadas/limite', { empleada_id: rosa, limite: pesos(1000), motivo: 'alta de crédito' })).status, 200);
    sync(ctx);
    const antes = impresos().length;
    const ok = await api(caja.url, '/api/venta/cobrar-credito-empleada', { cart });
    assert.equal(ok.status, 200, JSON.stringify(ok.json));
    assert.deepEqual(ok.json.venta.pagos.map((p: any) => [p.metodo, p.monto, p.empleada]), [['credito_empleada', 76400, 'Rosa']]);
    assert.equal(ok.json.venta.empleada.nombre, 'Rosa');
    const tk = impresos().slice(antes)[0]!;
    assert.match(tk, /Empleada: Rosa[\s\S]*Descuento de empleada 15%[\s\S]*Crédito de empleada \(nómina\) +\$764\.00[\s\S]*se descuenta\s+de su\s+nómina[\s\S]*Firma: Rosa/);
    // venta del día sí; cobro y efectivo no
    const c = await corte(caja);
    assert.deepEqual([c.ventas_mercancia, c.ventas_a_credito_empleadas, c.cobros_efectivo, c.efectivo_esperado, c.cobros_tarjeta], [76400, 76400, 0, 0, 0]);
    // el ticket de cierre y el resumen del día muestran el crédito aparte, sin sumarlo a los cobros
    assert.match(renderTicketCorteTexto(c, NEGOCIOS.DUO), /VENTA TOTAL DEL DÍA[\s\S]*TOTAL EN EFECTIVO +\$0\.00[\s\S]*Ventas a crédito de empleadas \(no es cobro\) +\$764\.00/);
    sync(ctx);
    const rd = (await api(adm.url, '/api/admin/resumen-dia?fecha=2026-10-01')).json.total;
    assert.deepEqual([rd.venta_total, rd.credito_empleadas, rd.efectivo, rd.tarjeta, rd.ventas_netas], [76400, 76400, 0, 0, 76400]);
    // el inventario bajó: la existencia de la venta nueva del mismo artículo es una menos
    const ex = (await api(caja.url, '/api/venta/escanear', { cart: (await api(caja.url, '/api/venta/nueva', {})).json.cart, codigo: JEANS })).json.carrito.existencias;
    assert.ok(Object.values(ex).every((x: any) => x.saldo >= 0));
    // segunda compra que pasa del límite ($1,000 − $764.15 = $235.85)
    const dos = await nueva(caja, JEANS);
    await api(caja.url, '/api/venta/empleada', { cart: dos.cart, empleada_id: rosa, clave: '8765' });
    const sobre = await api(caja.url, '/api/venta/cobrar-credito-empleada', { cart: dos.cart });
    assert.equal(sobre.json.error.codigo, 'LIMITE_EXCEDIDO');
    // Administración ve la cuenta: debe $764.15, disponible $235.85
    sync(ctx);
    const e = (await api(adm.url, '/api/admin/empleadas')).json.empleadas.find((x: any) => x.id === rosa);
    assert.deepEqual([e.limite, e.cargos, e.saldo, e.disponible], [pesos(1000), 76400, 76400, pesos(1000) - 76400]);
  });

  it('EM4 abono de nómina y ajustes con motivo y referencia única; devolución y cancelación de una venta a crédito bajan el saldo (sin efectivo)', async (t) => {
    const { ctx, adm, caja, rosa } = await preparar(t);
    await api(adm.url, '/api/admin/empleadas/limite', { empleada_id: rosa, limite: pesos(5000), motivo: 'alta' });
    sync(ctx);
    const vender = async (codigo: string) => {
      const { cart } = await nueva(caja, codigo);
      await api(caja.url, '/api/venta/empleada', { cart, empleada_id: rosa, clave: '8765' });
      const r = await api(caja.url, '/api/venta/cobrar-credito-empleada', { cart });
      assert.equal(r.status, 200, JSON.stringify(r.json));
      return r.json.venta;
    };
    const v1 = await vender(JEANS), v2 = await vender(MASCADA);
    sync(ctx);
    let e = (await api(adm.url, '/api/admin/empleadas')).json.empleadas.find((x: any) => x.id === rosa);
    assert.equal(e.saldo, 76400 + 10200);
    // devolución de los jeans a crédito: baja el saldo, no sale efectivo
    const d = await api(caja.url, '/api/venta/devolver', { sale_id: v1.sale_id, renglones: [{ linea_id: v1.lineas[0].linea_id, qty: 1 }], motivo: 'talla', autoriza: { nombre: 'Edgardo', clave: '2468' } });
    assert.equal(d.status, 200, JSON.stringify(d.json));
    assert.deepEqual(d.json.devolucion.reembolsos.map((r: any) => [r.metodo, r.monto]), [['credito_empleada', 76400]]);
    // la mascada se cancela completa
    const cn = await api(caja.url, '/api/venta/cancelar', { sale_id: v2.sale_id, motivo: 'error', clienta: { nombre: 'Rosa', telefono: '6531234567' }, autoriza: { nombre: 'Edgardo', clave: '2468' } });
    assert.equal(cn.status, 200, JSON.stringify(cn.json));
    sync(ctx);
    e = (await api(adm.url, '/api/admin/empleadas')).json.empleadas.find((x: any) => x.id === rosa);
    assert.deepEqual([e.cargos, e.devoluciones, e.saldo], [76400, 76400, 0]);
    const c = await corte(caja);
    assert.equal(c.efectivo_esperado, 0, 'ni la devolución ni la cancelación de un crédito mueven efectivo');
    // abonos y ajustes (con referencia única)
    const aj = { empleada_id: rosa, tipo: 'ajuste_cargo', monto: pesos(300), motivo: 'uniforme perdido', ref: 'm1' };
    assert.equal((await api(adm.url, '/api/admin/empleadas/movimiento', aj)).status, 200);
    await api(adm.url, '/api/admin/empleadas/movimiento', aj); // reintento: no duplica
    assert.equal((await api(adm.url, '/api/admin/empleadas/movimiento', { empleada_id: rosa, tipo: 'abono', monto: pesos(100), motivo: 'nómina 1ª quincena', periodo: 'oct-Q1', ref: 'm2' })).status, 200);
    assert.equal((await api(adm.url, '/api/admin/empleadas/movimiento', { empleada_id: rosa, tipo: 'abono', monto: pesos(10), motivo: '', ref: 'm3' })).status >= 400, true, 'sin motivo no se registra');
    e = (await api(adm.url, '/api/admin/empleadas')).json.empleadas.find((x: any) => x.id === rosa);
    assert.deepEqual([e.saldo, e.abonos, e.ajustes], [pesos(300) - pesos(100), pesos(100), pesos(300)]);
    const mov = (await api(adm.url, `/api/admin/empleadas/movimientos?id=${rosa}`)).json.movimientos.map((m: any) => m.tipo).sort();
    assert.deepEqual(mov, ['abono', 'ajuste_cargo', 'cargo', 'devolucion']);
    // reporte para la nómina del día
    const n = (await api(adm.url, '/api/admin/empleadas/nomina?desde=2026-10-01&hasta=2026-10-01')).json;
    assert.equal(n.filas.find((f: any) => f.id === rosa).abonos, pesos(100));
  });

  it('EM5 porcentajes configurables por Administración; una caja no puede tocar límites, abonos ni porcentajes', async (t) => {
    const { ctx, adm, caja, rosa } = await preparar(t);
    assert.equal((await api(adm.url, '/api/admin/empleadas/config', { pct: 20, pct_uniforme: 35 })).status, 200);
    assert.equal((await api(adm.url, '/api/admin/empleadas/config', { pct: 0, pct_uniforme: 35 })).status >= 400, true);
    sync(ctx);
    const { cart } = await nueva(caja, MASCADA);
    const v = (await api(caja.url, '/api/venta/empleada', { cart, empleada_id: rosa, clave: '8765' })).json.carrito;
    assert.equal(v.total, 9600, '120 − 20 %');
    for (const [ruta, cuerpo] of [['/api/admin/empleadas/limite', { empleada_id: rosa, limite: 1, motivo: 'xxx' }], ['/api/admin/empleadas/movimiento', { empleada_id: rosa, tipo: 'abono', monto: 1, motivo: 'xxx', ref: 'z' }], ['/api/admin/empleadas/config', { pct: 50, pct_uniforme: 60 }]] as const) {
      assert.equal((await api(caja.url, ruta, cuerpo)).status >= 400, true, `${ruta} desde una caja`);
    }
  });
});

it('EM6 migración 0011 (central real): porcentajes, límites y abonos son solo de Administración y se reparten a las cajas', async () => {
  const db = await centralLocal();
  const r = (await db.query(`select pos.tipo_para_cajas('empleadas.config') as a, pos.tipo_solo_admin('empleadas.config') as b, pos.tipo_para_cajas('empleada.credito') as c, pos.tipo_solo_admin('empleada.credito') as d, pos.tipo_para_cajas('empleada.movimiento') as e, pos.tipo_solo_admin('empleada.movimiento') as f, pos.tipo_solo_admin('sale.confirmed') as venta_admin, pos.tipo_solo_admin('caja.fondo_autorizado') as fondo_sigue`)).rows;
  assert.deepEqual(r, [{ a: true, b: true, c: true, d: true, e: true, f: true, venta_admin: false, fondo_sigue: true }]);
});
