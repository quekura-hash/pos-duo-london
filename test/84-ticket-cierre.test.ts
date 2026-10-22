import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { it } from 'node:test';
import { renderTicketCorteTexto, NEGOCIOS } from '../src/ticket.ts';
import { api, appAdmin, appCajero } from './ayudas/app.ts';
import { nuevoMundo, politica, porAlmacen } from './ayudas/comun.ts';

const JEANS = '0002026090782', MASCADA = '7501234567890', BOLSA = '0000000000017';
const pesos = (n: number) => Math.round(n * 100);

porAlmacen('Ticket de cierre de corte: 5 ventas (una con tarjeta), una devolución en efectivo y un cambio', (alm) => {
  it('TC1 el ticket resume el día, separa tarjeta de efectivo, muestra la diferencia tal cual y el fondo', async (t) => {
    const ctx = nuevoMundo(alm, politica());
    t.after(ctx.limpiar);
    const adm = await appAdmin(ctx); t.after(() => adm.cerrar());
    const caja = await appCajero(ctx, 'DUO', 1, 'Ana'); t.after(() => caja.cerrar());
    await api(adm.url, '/api/admin/administradores', { nombre: 'Edgardo', clave: 'clave-segura', clave_caja: '2468' });
    await api(adm.url, '/api/admin/cajeros', { nombre: 'Lupe', clave: '4321' });
    ctx.m.pump(); ctx.m.pump(); ctx.m.pump();
    await api(caja.url, '/api/login', { usuario: 'Lupe', clave: '4321' });
    const vender = async (codigo: string, precio: number | null, pago: 'efectivo' | 'tarjeta' = 'efectivo') => {
      const cart = (await api(caja.url, '/api/venta/nueva', {})).json.cart;
      const l = (await api(caja.url, '/api/venta/escanear', { cart, codigo })).json.linea;
      let total = l.importe ?? 0;
      if (precio !== null) total = (await api(caja.url, '/api/venta/editar-linea', { cart, linea_id: l.linea_id, precio_unit: pesos(precio), clave: '2468' })).json.carrito.total;
      else total = (await api(caja.url, '/api/venta/actual', {})).json.carrito.total;
      const r = pago === 'tarjeta'
        ? await api(caja.url, '/api/venta/cobrar-tarjeta', { cart, autorizacion: 'A12345', marca: 'visa', ultimos4: '4242' })
        : await api(caja.url, '/api/venta/cobrar-efectivo', { cart, recibido: Math.ceil(total / 10000) * 10000 });
      assert.equal(r.status, 200, JSON.stringify(r.json));
      return r.json.venta;
    };
    // 5 ventas: 4 en efectivo y 1 con tarjeta
    await vender(JEANS, null);               // $899
    const masc = await vender(MASCADA, null); // $120
    const bolsa = await vender(BOLSA, null);  // $450
    await vender(JEANS, null, 'tarjeta');     // $899 con tarjeta
    await vender(MASCADA, 1250);              // $1,250 (precio editado)
    // devolución en efectivo de la bolsa ($450)
    const d = await api(caja.url, '/api/venta/devolver', { sale_id: bolsa.sale_id, renglones: [{ linea_id: bolsa.lineas[0].linea_id, qty: 1 }], motivo: 'defecto', autoriza: { nombre: 'Edgardo', clave: '2468' } });
    assert.equal(d.status, 200, JSON.stringify(d.json));
    // cambio: la mascada de $120 por una bolsa de $450 (la clienta paga $330)
    const cart = (await api(caja.url, '/api/venta/nueva', {})).json.cart;
    await api(caja.url, '/api/venta/cambio/iniciar', { cart, sale_id: masc.sale_id, renglones: [{ linea_id: masc.lineas[0].linea_id, qty: 1 }], clienta: { nombre: 'Ana López', telefono: '6531234567' }, motivo: 'no le quedó' });
    await api(caja.url, '/api/venta/escanear', { cart, codigo: BOLSA });
    assert.equal((await api(caja.url, '/api/venta/cobrar-efectivo', { cart, recibido: pesos(330) })).status, 200);
    // cierre guiado: fondo exacto y conteo con $1 de sobrante
    await api(caja.url, '/api/cierre/fondo', { denominaciones: { '100000': 5 } });
    const esperado = (await api(caja.url, '/api/corte')).json.vivo.efectivo_ventas_esperado;
    const contado = esperado + 100;
    const den: Record<string, number> = {}; let r = contado;
    for (const x of [100000, 50000, 20000, 10000, 5000, 2000, 1000, 500, 200, 100]) { const n = Math.floor(r / x); if (n) { den[String(x)] = n; r -= n * x; } }
    await api(caja.url, '/api/efectivo/conteo', { moneda: 'MXN', denominaciones: den, alcance: 'ventas' });
    const c = await api(caja.url, '/api/corte/cerrar', { clave: '4321', observaciones: 'Sobrante de $1, probable propina.' });
    assert.equal(c.status, 200, JSON.stringify(c.json));
    const k = c.json.corte;
    const ticket = renderTicketCorteTexto(k, NEGOCIOS.DUO);
    writeFileSync('/tmp/claude-0/ticket-cierre.txt', ticket);
    // cifras: efectivo 899+120+450+1,250 = 2,719 + 330 del cambio − 450 de la devolución = 2,599
    assert.equal(esperado, pesos(2599));
    assert.match(ticket, /Tickets de venta +6/);
    assert.match(ticket, /Tarjeta \/ banco +\$899\.00/);
    assert.match(ticket, /Mercancía recibida a cambio +\$120\.00/);
    assert.match(ticket, /Devoluciones con reembolso +\$450\.00/);
    assert.match(ticket, /EFECTIVO DE VENTAS ESPERADO +\$2,599\.00/);
    assert.match(ticket, /DIFERENCIA +\+\$1\.00 SOBRANTE/);
    assert.match(ticket, /Fondo confirmado +\$5,000\.00[\s\S]*Fondo completo/);
    assert.ok(ticket.split('\n').every((l) => l.length <= 48), 'cabe en 48 columnas');
  });
});
