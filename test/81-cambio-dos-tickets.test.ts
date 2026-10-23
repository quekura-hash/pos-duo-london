import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { it } from 'node:test';
import { api, appAdmin, appCajero } from './ayudas/app.ts';
import { nuevoMundo, politica, porAlmacen } from './ayudas/comun.ts';

const CLIENTA = { nombre: 'Ana López', telefono: '653 123 4567' };
const JEANS = '0002026090782', MASCADA = '7501234567890';

porAlmacen('Cambio de mercancía: exactamente dos tickets, sin comprobante de crédito, y corte conciliado', (alm) => {
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
    return { ctx, adm, caja };
  };
  const pesos = (n: number) => Math.round(n * 100);
  /** Vende una prenda con el precio dado (en pesos) y la cobra en efectivo. */
  const vender = async (caja: any, codigo: string, precio: number) => {
    const cart = (await api(caja.url, '/api/venta/nueva', {})).json.cart;
    const l = (await api(caja.url, '/api/venta/escanear', { cart, codigo })).json.linea;
    const e = await api(caja.url, '/api/venta/editar-linea', { cart, linea_id: l.linea_id, precio_unit: pesos(precio), clave: '2468' });
    assert.equal(e.status, 200, JSON.stringify(e.json));
    return (await api(caja.url, '/api/venta/cobrar-efectivo', { cart, recibido: pesos(precio) })).json.venta;
  };
  /** Prepara el carrito de un cambio: regresa la prenda de `v` y agrega la nueva con el precio dado. */
  const cambio = async (caja: any, v: any, codigoNuevo: string, precioNuevo: number) => {
    const cart = (await api(caja.url, '/api/venta/nueva', {})).json.cart;
    const r = await api(caja.url, '/api/venta/cambio/iniciar', { cart, sale_id: v.sale_id, renglones: [{ linea_id: v.lineas[0].linea_id, qty: 1 }], clienta: CLIENTA, motivo: 'no le quedó' });
    assert.equal(r.status, 200, JSON.stringify(r.json));
    const l = (await api(caja.url, '/api/venta/escanear', { cart, codigo: codigoNuevo })).json.linea;
    await api(caja.url, '/api/venta/editar-linea', { cart, linea_id: l.linea_id, precio_unit: pesos(precioNuevo), clave: '2468' });
    return cart;
  };
  const impresos = (caja: any) => readdirSync(caja.s.impresora.dir).filter((f) => f.endsWith('.txt')).sort().map((f) => readFileSync(join(caja.s.impresora.dir, f), 'utf8'));
  const corte = async (caja: any) => (await api(caja.url, '/api/corte')).json.vivo;

  it('CD1 escenario del corte: $8,000 en ventas, cambio de $500 por $899 (+$399), devolución en efectivo de $1,000, fondo fijo de $5,000', async (t) => {
    const { caja } = await preparar(t);
    // $8,000 de ventas normales en efectivo (entre ellas las prendas de $500 y $1,000 que luego se cambian / devuelven)
    const v6500 = await vender(caja, JEANS, 6500), v500 = await vender(caja, MASCADA, 500), v1000 = await vender(caja, MASCADA, 1000);
    assert.equal(v6500.total + v500.total + v1000.total, pesos(8000));
    // cambio: la prenda de $500 por otra de $899; la clienta paga la diferencia de $399
    const cart = await cambio(caja, v500, JEANS, 899);
    const antes = impresos(caja).length;
    const p = await api(caja.url, '/api/venta/cobrar-efectivo', { cart, recibido: pesos(399) });
    assert.equal(p.status, 200, JSON.stringify(p.json));
    assert.equal(p.json.venta.total, pesos(899));
    const nuevos = impresos(caja).slice(antes);
    assert.equal(nuevos.length, 2, 'solo dos tickets: el de la clienta y el de control para firma');
    assert.match(nuevos[0]!, /ARTÍCULO NUEVO:[\s\S]*SE RECIBIÓ A CAMBIO:[\s\S]*-\$500\.00[\s\S]*Venta original: D1-000002[\s\S]*TOTAL A PAGAR +\$399\.00/);
    assert.match(nuevos[1]!, /SE HIZO CAMBIO[\s\S]*COPIA PARA LA TIENDA \(FIRMA\)[\s\S]*Clienta: Ana López[\s\S]*Recibí cambio del artículo:[\s\S]*\$500\.00[\s\S]*Me llevo a cambio:[\s\S]*\$899\.00[\s\S]*TOTAL A PAGAR +\$399\.00[\s\S]*Nombre y firma de la clienta/);
    assert.doesNotMatch(nuevos.join('\n'), /[Cc]rédito/);
    // devolución independiente con reembolso en efectivo de $1,000
    const d = await api(caja.url, '/api/venta/devolver', { sale_id: v1000.sale_id, renglones: [{ linea_id: v1000.lineas[0].linea_id, qty: 1 }], motivo: 'defecto', autoriza: { nombre: 'Edgardo', clave: '2468' } });
    assert.equal(d.status, 200, JSON.stringify(d.json));
    assert.equal(impresos(caja).length, antes + 4, 'la devolución normal sigue con sus dos comprobantes');

    const c = await corte(caja);
    assert.equal(c.ventas_brutas, pesos(8899));
    assert.equal(c.mercancia_recibida_por_cambio, pesos(500));
    assert.equal(c.devoluciones_con_reembolso, pesos(1000));
    assert.equal(c.diferencias_cobradas_en_cambios, pesos(399));
    assert.equal(c.ventas_netas, pesos(7399));
    assert.equal(c.cobros_efectivo, pesos(8399));
    assert.equal(c.devoluciones_en_efectivo, pesos(1000));
    assert.equal(c.mxn.cobros - c.mxn.cambio - c.mxn.devoluciones, pesos(7399), 'movimiento neto del efectivo');
    assert.equal(c.efectivo_esperado, pesos(7399), 'el fondo no es movimiento de efectivo');
    // cierre guiado: se cuenta el fondo ($5,000) y, aparte, el efectivo de ventas ($7,399) → sin diferencia
    assert.equal((await api(caja.url, '/api/cierre/fondo', { denominaciones: { '100000': 5 } })).status, 200);
    const conteo = await api(caja.url, '/api/efectivo/conteo', { moneda: 'MXN', denominaciones: { '100000': 7, '20000': 1, '10000': 1, '5000': 1, '2000': 2, '500': 1, '200': 2 }, alcance: 'ventas' });
    assert.equal(conteo.status, 200, JSON.stringify(conteo.json));
    assert.equal((await corte(caja)).diferencia_mxn, 0);
  });

  it('CD2 cambio de la prueba real: recibe $599, lleva $849, paga $250 con $500 y regresan $250 (+$250 neto), solo dos tickets; no se reutiliza la prenda; la reimpresión no crea crédito', async (t) => {
    const { caja } = await preparar(t);
    const v = await vender(caja, MASCADA, 599);
    const base = await corte(caja);
    const cart = await cambio(caja, v, JEANS, 849);
    const antes = impresos(caja).length;
    const p = await api(caja.url, '/api/venta/cobrar-efectivo', { cart, recibido: pesos(500) });
    assert.equal(p.status, 200, JSON.stringify(p.json));
    assert.equal(p.json.cambio, pesos(250));
    const nuevos = impresos(caja).slice(antes);
    assert.equal(nuevos.length, 2);
    const tk = nuevos[0]!;
    assert.match(tk, /DÚO New York/);
    assert.match(tk, /ARTÍCULO NUEVO:[\s\S]*\$849\.00[\s\S]*SE RECIBIÓ A CAMBIO:[\s\S]*-\$599\.00[\s\S]*Venta original: D1-000001[\s\S]*TOTAL A PAGAR +\$250\.00[\s\S]*Efectivo MXN +\$250\.00[\s\S]*Recibido +\$500\.00[\s\S]*Cambio +\$250\.00/);
    assert.match(tk, /PÓLIZA DE DEVOLUCIÓN/, 'conserva la política de cambios y devoluciones');
    assert.match(tk, /D1-000002/, 'y el código de barras / folio');
    assert.doesNotMatch(nuevos.join('\n'), /[Cc]rédito/);
    // efectivo: +$250 neto (cobro de $500 − cambio de $250), y lo recibido a cambio no es una salida
    const c = await corte(caja);
    assert.equal(c.mxn.cobros - base.mxn.cobros - (c.mxn.cambio - base.mxn.cambio), pesos(250));
    assert.equal(c.efectivo_esperado - base.efectivo_esperado, pesos(250));
    assert.equal(c.devoluciones_en_efectivo, 0);
    assert.equal(c.mercancia_recibida_por_cambio, pesos(599));
    assert.equal(c.ventas_netas - base.ventas_netas, pesos(250));
    // la misma prenda no se puede cambiar otra vez
    const otra = await api(caja.url, '/api/venta/cambio/iniciar', { cart: (await api(caja.url, '/api/venta/nueva', {})).json.cart, sale_id: v.sale_id, renglones: [{ linea_id: v.lineas[0].linea_id, qty: 1 }], clienta: CLIENTA, motivo: 'otro motivo' });
    assert.equal(otra.json.error.codigo, 'DEVOLUCION_EXCEDE');
    // reimprimir: solo el ticket de la venta, identificado como reimpresión, con el mismo formato y sin crédito
    const n = impresos(caja).length;
    await api(caja.url, '/api/venta/reimprimir', { sale_id: p.json.venta.sale_id });
    const re = impresos(caja).slice(n);
    assert.equal(re.length, 1);
    assert.match(re[0]!, /REIMPRESIÓN 1[\s\S]*SE RECIBIÓ A CAMBIO:[\s\S]*-\$599\.00[\s\S]*TOTAL A PAGAR +\$250\.00/);
    assert.doesNotMatch(re[0]!, /[Cc]rédito/);
  });

  it('CD3 diferencia a favor: nueva de $500 por recibida de $899 → DIFERENCIA A DEVOLVER $399 con clave de quien autoriza, solo dos tickets y el corte cuadra', async (t) => {
    const { caja } = await preparar(t);
    const v = await vender(caja, JEANS, 899);
    const base = await corte(caja);
    const cart = await cambio(caja, v, MASCADA, 500);
    const sin = await api(caja.url, '/api/venta/cambio/devolver-dinero', { cart });
    assert.equal(sin.json.error.codigo, 'AUTORIZACION_REQUERIDA', 'sin autorización no se devuelve efectivo');
    const antes = impresos(caja).length;
    const ok = await api(caja.url, '/api/venta/cambio/devolver-dinero', { cart, autoriza: { nombre: 'Rosa', clave: '8765' } });
    assert.equal(ok.status, 200, JSON.stringify(ok.json));
    const nuevos = impresos(caja).slice(antes);
    assert.equal(nuevos.length, 2, 'ticket de la clienta (la venta con ambos artículos) y el de control para firma');
    assert.match(nuevos[0]!, /ARTÍCULO NUEVO:[\s\S]*\$500\.00[\s\S]*SE RECIBIÓ A CAMBIO:[\s\S]*-\$899\.00[\s\S]*Venta original: D1-000001[\s\S]*DIFERENCIA A DEVOLVER +\$399\.00[\s\S]*Reembolso en efectivo MXN +\$399\.00[\s\S]*autorizada por Rosa/);
    assert.match(nuevos[1]!, /SE HIZO CAMBIO[\s\S]*COPIA PARA LA TIENDA \(FIRMA\)[\s\S]*DIFERENCIA A DEVOLVER +\$399\.00/);
    assert.doesNotMatch(nuevos.join('\n'), /[Cc]rédito|TOTAL A PAGAR/);
    const c = await corte(caja);
    assert.equal(c.efectivo_esperado - base.efectivo_esperado, -pesos(399));
    assert.equal(c.mercancia_recibida_por_cambio, pesos(500), 'la parte aplicada a la venta nueva; los $399 son reembolso real');
    assert.equal(c.diferencias_devueltas_en_cambios, pesos(399));
    assert.equal(c.devoluciones_con_reembolso, pesos(399));
    assert.equal(c.ventas_netas - base.ventas_netas, -pesos(399), 'ventas netas bajan solo lo realmente devuelto: $500 nuevos − $899 recibidos, sin restar dos veces');
  });
});
