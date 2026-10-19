import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { it } from 'node:test';
import { ServicioAdmin } from '../src/app/servicio.ts';
import { LOGOS_TICKET } from '../src/logos-ticket.ts';
import { construirTicket, NEGOCIOS, rasterEscPos, renderTicketEscPos, renderTicketTexto } from '../src/ticket.ts';
import { nuevoMundo, politica, porAlmacen, servicioDe } from './ayudas/comun.ts';

const secuencia = (b: Uint8Array, s: number[]) => b.findIndex((_, i) => s.every((x, k) => b[i + k] === x));

it('DT1 los logos del ticket son bitmaps de 1 bit con el tamaño correcto y caben en 58 mm', () => {
  for (const [t, l] of Object.entries(LOGOS_TICKET)) {
    assert.ok(l.ancho > 0 && l.ancho <= 384, `${t} cabe en 384 puntos`);
    assert.equal(Buffer.from(l.datos, 'base64').length, Math.ceil(l.ancho / 8) * l.alto, `${t}: bytes = filas × ceil(ancho/8)`);
    assert.ok(Buffer.from(l.datos, 'base64').some((x) => x !== 0) && Buffer.from(l.datos, 'base64').some((x) => x !== 255), `${t} no está vacío ni todo negro`);
  }
  const r = rasterEscPos(LOGOS_TICKET.DUO!);
  assert.deepEqual(r.slice(0, 11), [0x1b, 0x61, 1, 0x1d, 0x76, 0x30, 0, Math.ceil(LOGOS_TICKET.DUO!.ancho / 8), 0, LOGOS_TICKET.DUO!.alto, 0]);
});

porAlmacen('Datos de la tienda y política de devolución en el ticket', (alm) => {
  const admin = (ctx: ReturnType<typeof nuevoMundo>) => new ServicioAdmin({ central: ctx.m.central, actor: { rol: 'admin', usuario: 'galo' }, fuente: () => ctx.m.central.repo.ops(), cajas: [{ tienda: 'DUO', caja: 1 }, { tienda: 'LON', caja: 1 }] });
  const vender = async (ctx: ReturnType<typeof nuevoMundo>, tienda: string) => {
    const s = servicioDe(ctx, tienda, 1);
    const c = s.svc.nuevaVenta();
    s.svc.escanear(c, '7501234567890');
    return { s, v: await s.svc.cobrarEfectivo(c, 20000, 0) };
  };

  it('DT2 DÚO sale con dirección, razón social, RFC, teléfono y su política; London no inventa datos', async (t) => {
    const ctx = nuevoMundo(alm, politica());
    t.after(ctx.limpiar);
    const d = (await vender(ctx, 'DUO')).v.ticket_texto;
    for (const x of ['DÚO New York', 'AV. LIBERTAD entre calles 8 y 9 #803', 'San Luis Río Colorado, Sonora', 'KARINA PALAFOX VILLALOBOS', 'RFC: PAVK-781208-TB9', 'TELÉFONO 534-0607', 'PÓLIZA DE DEVOLUCIÓN', 'NO HAY CAMBIOS SIN RECIBO', 'No hacemos devoluciones de efectivo', 'NI DEVOLUCIONES SIN EXCEPCIÓN']) assert.ok(d.includes(x), x);
    assert.ok(d.indexOf('London') < 0);
    assert.ok(d.indexOf('RFC') < d.indexOf('Vendedora-Cajera'), 'el encabezado va arriba, antes de los datos de la venta');
    assert.ok(d.indexOf('TELÉFONO') > d.indexOf('TOTAL'), 'el teléfono y la política van al pie');
    const l = (await vender(ctx, 'LON')).v.ticket_texto;
    assert.doesNotMatch(l, /RFC|TELÉFONO|PÓLIZA/);
    assert.match(l, /London Love/);
    assert.match(l, /No hacemos devoluciones de efectivo/);
  });

  it('DT3 Administración edita los datos de la tienda: llegan a la caja, se actualizan por campo y lo vacío no sale', async (t) => {
    const ctx = nuevoMundo(alm, politica());
    t.after(ctx.limpiar);
    const a = admin(ctx);
    const antes = a.tiendasInfo().find((x) => x.tienda === 'LON')!;
    assert.deepEqual([antes.rfc, antes.direccion, antes.politica], ['', '', 'No hacemos devoluciones de efectivo']);
    a.guardarDatosTienda('LON', { direccion: '  Calle  Juárez 12 ', ciudad: 'Mexicali, B.C.', telefono: '686 000 0000', rfc: 'XAXX010101000', razon_social: 'London Love SA', politica: 'Cambios en 7 días con ticket.\n\n  Sin devoluciones de efectivo.  ' });
    ctx.m.pump();
    const info = a.tiendasInfo().find((x) => x.tienda === 'LON')!;
    assert.deepEqual([info.direccion, info.politica], ['Calle Juárez 12', 'Cambios en 7 días con ticket.\nSin devoluciones de efectivo.']);
    const t1 = (await vender(ctx, 'LON')).v.ticket_texto;
    for (const x of ['Calle Juárez 12', 'Mexicali, B.C.', 'London Love SA', 'RFC: XAXX010101000', 'TELÉFONO 686 000 0000', 'Cambios en 7 días con ticket.', 'Sin devoluciones de efectivo.']) assert.ok(t1.includes(x), x);
    assert.doesNotMatch(t1, /No hacemos devoluciones de efectivo/, 'la política editada reemplaza a la de fábrica');
    // un solo campo: lo demás se conserva; vacío = no mostrar
    a.guardarDatosTienda('LON', { rfc: '', telefono: '' });
    ctx.m.pump();
    const t2 = (await vender(ctx, 'LON')).v.ticket_texto;
    assert.doesNotMatch(t2, /RFC|TELÉFONO/);
    assert.match(t2, /Calle Juárez 12/);
    // la otra tienda no cambia
    assert.match((await vender(ctx, 'DUO')).v.ticket_texto, /PAVK-781208-TB9/);
    // validaciones
    assert.throws(() => a.guardarDatosTienda('LON', { nombre: ' ' }), { codigo: 'TIENDA_INVALIDA' });
    assert.throws(() => a.guardarDatosTienda('LON', { telefono: 'x'.repeat(31) }), { codigo: 'TIENDA_INVALIDA' });
    assert.throws(() => a.guardarDatosTienda('XYZ', { nombre: 'Otra' }), { codigo: 'TIENDA_INVALIDA' });
    // política vacía: el ticket no lleva leyendas
    a.guardarDatosTienda('LON', { politica: '' });
    ctx.m.pump();
    assert.doesNotMatch((await vender(ctx, 'LON')).v.ticket_texto, /devoluciones/);
  });

  it('DT4 la impresión lleva el logo de la tienda arriba (ESC/POS GS v 0) y la reimpresión también', async (t) => {
    const ctx = nuevoMundo(alm, politica());
    t.after(ctx.limpiar);
    for (const tienda of ['DUO', 'LON']) {
      const { s, v } = await vender(ctx, tienda);
      const bin = () => readdirSync(s.impresora.dir).filter((f) => f.endsWith('.bin')).map((f) => new Uint8Array(readFileSync(join(s.impresora.dir, f))));
      const bytes = bin()[0]!;
      const logo = LOGOS_TICKET[tienda]!;
      const i = secuencia(bytes, [0x1d, 0x76, 0x30, 0]);
      assert.ok(i >= 0, `${tienda}: lleva imagen`);
      assert.equal(bytes[i + 4], Math.ceil(logo.ancho / 8));
      assert.ok(i < 40, 'el logo es lo primero que se imprime (tras inicializar y abrir el cajón)');
      await s.svc.reimprimir(v.venta.sale_id);
      assert.ok(bin().every((b) => secuencia(b, [0x1d, 0x76, 0x30, 0]) >= 0), 'también la reimpresión');
    }
    // sin logo (ticket de pruebas sin impresora térmica) el contenido de texto sigue completo
    const t0 = construirTicket((await vender(ctx, 'DUO')).v.venta, NEGOCIOS.DUO!);
    assert.ok(renderTicketEscPos(t0).length < renderTicketEscPos(t0, { logo: LOGOS_TICKET.DUO }).length);
    assert.match(renderTicketTexto(t0), /KARINA PALAFOX VILLALOBOS/);
  });
});
