import assert from 'node:assert/strict';
import { it } from 'node:test';
import { ServicioAdmin } from '../src/app/servicio.ts';
import { promocionesDe } from '../src/proyecciones.ts';
import { AVISO_VENTA_FINAL, construirTicket, renderTicketTexto } from '../src/ticket.ts';
import { nuevoMundo, politica, porAlmacen, servicioDe } from './ayudas/comun.ts';

const MASCADA = '7501234567890'; // $120.00

porAlmacen('Ticket: motivo del descuento y leyenda «venta final» por promoción', (alm) => {
  const preparar = (t: any) => {
    const ctx = nuevoMundo(alm, politica());
    t.after(ctx.limpiar);
    const a = new ServicioAdmin({ central: ctx.m.central, actor: { rol: 'admin', usuario: 'galo' }, fuente: () => ctx.m.central.repo.ops(), cajas: [{ tienda: 'DUO', caja: 1 }] });
    a.guardarSupervisor({ nombre: 'Ana Supervisora', clave: '1111' });
    const promo = (nombre: string, codigo: string, extra: Record<string, unknown> = {}) => a.guardarPromocion({ id: '', tipo: 'cupon', nombre, activa: true, tiendas: ['DUO'], inicio: null, fin: null, codigo, pct: 10, ...extra } as any);
    return { ctx, a, promo };
  };

  it('TV1 el motivo del descuento manual se imprime una sola vez en el ticket (aunque el descuento sea a toda la venta) y el aviso de venta final sigue', async (t) => {
    const { ctx } = preparar(t);
    ctx.m.pump();
    const s = servicioDe(ctx, 'DUO', 1);
    const c = s.svc.nuevaVenta();
    s.svc.escanear(c, MASCADA); s.svc.escanear(c, '0002026090782');
    s.svc.aplicarDescuento(c, { tipo: 'pct', valor: 20, motivo: 'Prenda con una mancha pequeña en el cuello' }, '1111');
    const v = (await s.svc.cobrarEfectivo(c, 500000, 0)).venta;
    const tk = construirTicket(v);
    const txt = renderTicketTexto(tk);
    assert.equal((txt.match(/Motivo del descuento:/g) ?? []).length, 1, 'una sola vez aunque el descuento se reparta en dos renglones');
    assert.match(txt, /Motivo del descuento: Prenda con una mancha\s+pequeña en el cuello/);
    assert.deepEqual(tk.avisos_grandes, [AVISO_VENTA_FINAL]);
    // una venta sin descuento manual no trae renglón de motivo
    const c2 = s.svc.nuevaVenta(); s.svc.escanear(c2, MASCADA);
    assert.doesNotMatch(renderTicketTexto(construirTicket((await s.svc.cobrarEfectivo(c2, 500000, 0)).venta)), /Motivo del descuento/);
  });

  it('TV2 una promoción con «venta final» desmarcada no imprime la leyenda; marcada (o sin dato) sí; y un descuento manual la vuelve a pedir', async (t) => {
    const { ctx, a, promo } = preparar(t);
    promo('Accesorios 10 %', 'SINVF', { venta_final: false });
    promo('Normal 10 %', 'CONVF');
    ctx.m.pump();
    const guardada = promocionesDe(ctx.m.central.repo.ops()).find((p: any) => p.codigo === 'SINVF');
    assert.equal(guardada?.venta_final, false);
    assert.equal(promocionesDe(ctx.m.central.repo.ops()).find((p: any) => p.codigo === 'CONVF')?.venta_final, undefined, 'sin dato = imprime, como siempre');
    const s = servicioDe(ctx, 'DUO', 1);
    const cobrarCon = async (codigo: string | null, manual = false) => {
      const c = s.svc.nuevaVenta();
      s.svc.escanear(c, MASCADA);
      if (codigo) s.svc.aplicarCupon(c, codigo);
      if (manual) s.svc.aplicarDescuento(c, { tipo: 'pct', valor: 5, motivo: 'cliente frecuente' }, '1111');
      return (await s.svc.cobrarEfectivo(c, 500000, 0)).venta;
    };
    const sinVF = await cobrarCon('SINVF');
    assert.ok(sinVF.lineas[0]!.descuento > 0, 'sí hay descuento');
    assert.equal(construirTicket(sinVF).avisos_grandes, undefined, 'sin la leyenda de venta final');
    assert.doesNotMatch(renderTicketTexto(construirTicket(sinVF)), /VENTA FINAL/);
    assert.deepEqual(construirTicket(await cobrarCon('CONVF')).avisos_grandes, [AVISO_VENTA_FINAL]);
    assert.deepEqual(construirTicket(await cobrarCon(null, true)).avisos_grandes, [AVISO_VENTA_FINAL], 'un descuento manual sí la pide');
    // la marca se congela en la venta: si después la promoción cambia, la reimpresión no cambia
    a.guardarPromocion({ ...guardada!, venta_final: true } as any);
    ctx.m.pump();
    assert.equal(construirTicket(sinVF).avisos_grandes, undefined);
    // una venta sin ningún descuento tampoco lleva la leyenda
    assert.equal(construirTicket(await cobrarCon(null)).avisos_grandes, undefined);
  });
});
