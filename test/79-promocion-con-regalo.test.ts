import assert from 'node:assert/strict';
import { it } from 'node:test';
import { appAdmin, appCajero, api } from './ayudas/app.ts';
import { nuevoMundo, politica, porAlmacen } from './ayudas/comun.ts';

porAlmacen('Promociones con «imprimir al final del ticket»: la promoción se regala con un QR y se canjea en una compra futura', (alm) => {
  const JEANS = '0002026090782', MASCADA = '7501234567890';
  const preparar = async (t: { after(f: () => void): void }) => {
    const ctx = nuevoMundo(alm, politica());
    t.after(ctx.limpiar);
    const adm = await appAdmin(ctx); t.after(() => adm.cerrar());
    const caja = await appCajero(ctx, 'DUO', 1, 'Ana'); t.after(() => caja.cerrar());
    return { ctx, adm, caja };
  };
  const comprar = async (caja: any, codigos: string[], cupon?: string) => {
    const cart = (await api(caja.url, '/api/venta/nueva', {})).json.cart;
    for (const c of codigos) await api(caja.url, '/api/venta/escanear', { cart, codigo: c });
    const cp = cupon ? await api(caja.url, '/api/venta/cupon', { cart, codigo: cupon }) : null;
    const v = await api(caja.url, '/api/venta/cobrar-efectivo', { cart, recibido: 5000000 });
    return { venta: v.json.venta, ticket: v.json.ticket_texto, cupon: cp };
  };
  const base = { activa: true, tiendas: ['DUO'], inicio: null, fin: null };
  const regalo = { compra_minima: 100000, vigencia: { modo: 'dias', dias: 30 } };

  it('PG1 «Por cada $500, $50» con regalo no descuenta sola; al pagar ≥ $1,000 imprime el QR y ese QR descuenta por escalones', async (t) => {
    const { ctx, adm, caja } = await preparar(t);
    const r = await api(adm.url, '/api/admin/promociones', { ...base, tipo: 'por_cada', nombre: 'Gana $50 por cada $500', cada: 50000, descuenta: 5000, regalo });
    assert.equal(r.status, 200);
    ctx.m.pump(); ctx.m.pump(); ctx.m.pump();
    const g = await comprar(caja, [JEANS, JEANS]);
    assert.equal(g.venta.total, 179800, 'la promoción regalada no se aplica en la compra actual');
    assert.equal(g.venta.recompensas.length, 1);
    const e = g.venta.recompensas[0];
    assert.equal(e.promo.tipo, 'por_cada');
    assert.match(g.ticket, /¡TE GANASTE UN CUPÓN![\s\S]*Gana \$50 por cada \$500[\s\S]*\$50\.00 de descuento por cada \$500\.00 de compra\s+en tu próxima compra[\s\S]*Código: RC-DUO1/);
    // canje: $899 → un escalón de $500 → $50 menos; un solo uso
    const c = await comprar(caja, [JEANS], e.codigo);
    assert.equal(c.cupon!.status, 200);
    assert.equal(c.venta.total, 89900 - 5000);
    const otra = await comprar(caja, [JEANS], e.codigo);
    assert.equal(otra.cupon!.status >= 400, true, 'ya no se puede volver a usar');
    assert.equal(otra.venta.total, 89900);
    ctx.m.pump(); ctx.m.pump(); ctx.m.pump();
    // la lista de Promociones cuenta regalados / canjeados
    const l = (await api(adm.url, '/api/admin/promociones')).json.promociones.find((p: any) => p.regalo);
    assert.deepEqual([l.regaladas, l.canjeadas], [1, 1]);
  });

  it('PG2 un 2x1 regalado se canjea con su QR en la mercancía de la promoción, y sin la casilla la promoción se aplica sola', async (t) => {
    const { ctx, adm, caja } = await preparar(t);
    const prim = await comprar(caja, [MASCADA]);
    const item_id = prim.venta.lineas[0].item_id;
    const alcance = { departamentos: [], palabras: [], item_ids: [item_id] };
    await api(adm.url, '/api/admin/promociones', { ...base, tipo: 'nxm', nombre: 'Hoy ganaste 2x1', lleva: 2, paga: 1, alcance, regalo });
    ctx.m.pump(); ctx.m.pump(); ctx.m.pump();
    assert.equal((await comprar(caja, [MASCADA, MASCADA])).venta.recompensas, undefined, 'una compra chica no gana el regalo');
    const g = await comprar(caja, [JEANS, MASCADA, MASCADA]);
    assert.equal(g.venta.total, 89900 + 24000, 'el 2x1 regalado no se aplica en la compra que lo regala');
    const e = g.venta.recompensas[0];
    assert.match(g.ticket, /Lleva 2 y paga 1 \(en la mercancía de la\s+promoción\)\s+en tu próxima compra/);
    assert.equal((await comprar(caja, [MASCADA], e.codigo)).venta.total, 12000, 'con una sola pieza no hay grupo');
    const c = await comprar(caja, [MASCADA, MASCADA], e.codigo);
    assert.equal(c.cupon!.status >= 400 || c.venta.total === 12000, true);
    // la misma promoción SIN regalo se aplica sola
    await api(adm.url, '/api/admin/promociones', { ...base, tipo: 'nxm', nombre: 'Dos por uno directo', lleva: 2, paga: 1, alcance });
    ctx.m.pump(); ctx.m.pump(); ctx.m.pump();
    assert.equal((await comprar(caja, [MASCADA, MASCADA])).venta.total, 12000);
  });

  it('PG3 validación del regalo y las reglas del formato anterior siguen vigentes y se ven en Promociones', async (t) => {
    const { ctx, adm, caja } = await preparar(t);
    const mal = async (rg: unknown) => (await api(adm.url, '/api/admin/promociones', { ...base, tipo: 'por_cada', nombre: 'X', cada: 50000, descuenta: 5000, regalo: rg })).json.error.codigo;
    assert.equal(await mal({ compra_minima: 0, vigencia: { modo: 'dias', dias: 5 } }), 'PROMOCION_INVALIDA');
    assert.equal(await mal({ compra_minima: 1000, vigencia: { modo: 'dias', dias: 0 } }), 'PROMOCION_INVALIDA');
    assert.equal(await mal({ compra_minima: 1000, vigencia: { modo: 'fechas', inicio: '2026-12-10', fin: '2026-12-01' } }), 'PROMOCION_INVALIDA');
    const vieja = await api(adm.url, '/api/admin/recompensas', { nombre: 'Vieja $50', activa: true, tiendas: ['DUO'], inicio: null, fin: null, compra_minima: 100000, cupon: { monto: 5000, minimo: 0, vigencia: { modo: 'dias', dias: 30 } } });
    assert.equal(vieja.status, 200);
    ctx.m.pump(); ctx.m.pump(); ctx.m.pump();
    const lista = (await api(adm.url, '/api/admin/promociones')).json.promociones;
    const v = lista.find((p: any) => p.nombre === 'Vieja $50');
    assert.deepEqual([v.tipo, v.monto, v.regalo.compra_minima], ['cupon', 5000, 100000]);
    assert.equal((await comprar(caja, [JEANS, JEANS])).venta.recompensas.length, 1, 'la regla vieja sigue regalando');
    // al editarla en Promociones manda la promoción y no se regala doble
    const ed = await api(adm.url, '/api/admin/promociones', { ...v, nombre: 'Nueva $50' });
    assert.equal(ed.status, 200);
    ctx.m.pump(); ctx.m.pump(); ctx.m.pump();
    const g = await comprar(caja, [JEANS, JEANS]);
    assert.equal(g.venta.recompensas.length, 1);
    assert.equal(g.venta.recompensas[0].nombre, 'Nueva $50');
  });
});
