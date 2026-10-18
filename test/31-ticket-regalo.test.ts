import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { it } from 'node:test';
import { ServicioAdmin } from '../src/app/servicio.ts';
import { construirTicketRegalo, renderTicketEscPos, renderTicketTexto } from '../src/ticket.ts';
import { LOGOS_TICKET } from '../src/logos-ticket.ts';
import { nuevoMundo, politica, porAlmacen, servicioDe } from './ayudas/comun.ts';

const secuencia = (b: Uint8Array, s: number[]) => b.findIndex((_, i) => s.every((x, k) => b[i + k] === x));

porAlmacen('Ticket de regalo: la mercancía sin precios y con el código de la compra', (alm) => {
  it('TG1 sale sin precios, descuentos, pagos ni cajero; con logo, datos de la tienda, código de la compra y política', async (t) => {
    const ctx = nuevoMundo(alm, politica());
    t.after(ctx.limpiar);
    const a = new ServicioAdmin({ central: ctx.m.central, actor: { rol: 'admin', usuario: 'galo' }, fuente: () => ctx.m.central.repo.ops(), cajas: [{ tienda: 'DUO', caja: 1 }, { tienda: 'LON', caja: 1 }] });
    a.guardarPromocion({ id: '', tipo: 'nxm', nombre: '2x1 jeans', activa: true, tiendas: ['DUO'], inicio: null, fin: null, lleva: 2, paga: 1, alcance: { departamentos: [], palabras: ['jeans'], item_ids: [] } });
    ctx.m.pump();
    const s = servicioDe(ctx, 'DUO', 1, 'Ana');
    const c = s.svc.nuevaVenta();
    s.svc.escanear(c, '0002026090782');
    s.svc.escanear(c, '0002026090799');
    s.svc.escanear(c, '7501234567890');
    const venta = await s.svc.cobrarEfectivo(c, 200000, 0);
    const r = await s.svc.ticketRegalo(venta.venta.sale_id);
    const txt = r.ticket_texto;
    assert.equal(r.impresion.ok, true);
    assert.match(txt, /\*\*\* TICKET DE REGALO \*\*\*/);
    assert.match(txt, /^Compra: D1-000001$/m);
    assert.match(txt, /^1 JEANS LEVIS 726-$/m);
    assert.match(txt, /^#1001 0002026090782$/m);
    assert.match(txt, /^1 MASCADA EFENTUS A-12$/m);
    assert.match(txt, /KARINA PALAFOX VILLALOBOS/);
    assert.match(txt, /TELÉFONO 534-0607/);
    assert.match(txt, /NO HAY CAMBIOS SIN RECIBO/);
    assert.match(txt, /Para cambios presente este ticket/);
    assert.doesNotMatch(txt, /\$|TOTAL|Efectivo|Recibido|Cambio|Cajero|2x1|Descuento|Folio:/, 'ni un precio, descuento, pago ni cajero');
    // mismo ancho de papel
    assert.ok(txt.split('\n').every((x) => x.length <= 42));
    // impresión: logo arriba, código de barras de la compra y SIN abrir el cajón
    const dir = (s.impresora as { dir: string }).dir;
    const archivos = readdirSync(dir).sort();
    const bin = new Uint8Array(readFileSync(join(dir, archivos.find((f) => f.includes('regalo') && f.endsWith('.bin'))!)));
    assert.ok(secuencia(bin, [0x1d, 0x76, 0x30, 0]) >= 0, 'lleva el logo');
    assert.ok(secuencia(bin, [0x1d, 0x6b, 73]) >= 0, 'lleva el código de barras para el cambio');
    assert.equal(secuencia(bin, [0x1b, 0x70, 0x00]), -1, 'no abre el cajón');
    // el ticket de venta no se altera ni cuenta como reimpresión
    assert.match(s.svc.ticketTexto(venta.venta.sale_id), /TOTAL +\$/);
    const antes = s.svc.ticketTexto(venta.venta.sale_id);
    await s.svc.ticketRegalo(venta.venta.sale_id);
    assert.equal(s.svc.ticketTexto(venta.venta.sale_id), antes, 'el ticket de venta no dice «reimpresión» por haber sacado el de regalo');
    assert.doesNotMatch(antes, /REIMPRESIÓN/);
    // el código de la compra sirve para el cambio: es el mismo del ticket de venta
    assert.ok(antes.includes('D1-000001'));
  });

  it('TG2 no se imprime de ventas ajenas, canceladas o sin mercancía (tarjetas de regalo)', async (t) => {
    const ctx = nuevoMundo(alm, politica());
    t.after(ctx.limpiar);
    const s = servicioDe(ctx, 'DUO', 1);
    const c = s.svc.nuevaVenta();
    s.svc.escanear(c, '7501234567890');
    const v = await s.svc.cobrarEfectivo(c, 20000, 0);
    // otra caja no puede imprimir el de esta
    ctx.m.pump(); ctx.m.pump();
    await assert.rejects(() => servicioDe(ctx, 'LON', 1).svc.ticketRegalo(v.venta.sale_id), { codigo: 'PROHIBIDO' });
    await assert.rejects(() => s.svc.ticketRegalo('no-existe'), { codigo: 'PROHIBIDO' });
    // una tarjeta de regalo sola no tiene ticket de regalo
    const tj = await s.svc.altaTarjetaRegalo('TR-9', 10000, 10000);
    await assert.rejects(() => s.svc.ticketRegalo(tj.venta.sale_id), { codigo: 'SIN_MERCANCIA' });
    // mercancía normal: sí tiene ticket de regalo, y sin precios
    const c2 = s.svc.nuevaVenta();
    s.svc.escanear(c2, '0000000000017');
    const v2 = await s.svc.cobrarEfectivo(c2, 100000, 0);
    const t2 = construirTicketRegalo(v2.venta);
    assert.equal(t2!.lineas.length, 1);
    // cancelada
    s.svc.cancelarVenta(v.venta.sale_id, 'prueba');
    await assert.rejects(() => s.svc.ticketRegalo(v.venta.sale_id), { codigo: 'VENTA_CANCELADA' });
    assert.equal(renderTicketTexto(t2!).includes('$'), false);
    assert.ok(renderTicketEscPos(t2!, { logo: LOGOS_TICKET.DUO }).length > 100);
  });
});
