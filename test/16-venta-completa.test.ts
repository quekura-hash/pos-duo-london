import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { it } from 'node:test';
import { ServicioAdmin, ServicioCaja } from '../src/app/servicio.ts';
import { reasignarCodigo } from '../src/administracion.ts';
import { stock, ventas } from '../src/proyecciones.ts';
import type { Actor } from '../src/tipos.ts';
import { nuevoMundo, politica, porAlmacen, servicioDe } from './ayudas/comun.ts';

const HOY = '2026-10-01';
const dinero = (n: number) => n; // centavos

porAlmacen('Primera operación completa: escanear → cobrar → guardar → inventario → ticket → corte', (alm) => {
  it('V1 el flujo completo con sus efectos persistidos', async (t) => {
    const ctx = nuevoMundo(alm, politica());
    t.after(() => ctx.limpiar());
    const { svc, impresora } = servicioDe(ctx, 'DUO', 1, 'Ana');
    const jeans = ctx.items[0]!;
    const masc = ctx.items[2]!;
    const cart = svc.carritoActual();

    // escanear: el código conserva ceros; los campos del artículo llegan separados
    const e1 = svc.escanear(cart, '0002026090782\n');
    assert.equal(e1.resultado, 'agregado');
    if (e1.resultado !== 'agregado') return;
    assert.deepEqual([e1.linea.item_no, e1.linea.codigo, e1.linea.descripcion, e1.linea.marca, e1.linea.estilo, e1.linea.lote],
      ['1001', '0002026090782', 'JEANS', 'LEVIS', '726-', '20260913']);
    assert.equal(svc.escanear(cart, '0002026090782').resultado, 'cantidad_incrementada');
    svc.escanear(cart, masc.codigo);
    const l = svc.vista(cart).lineas.find((x) => x.item_id === masc.item_id)!;
    svc.cambiarCantidad(cart, l.linea_id, 3);
    const bolsa = svc.escanear(cart, ctx.items[3]!.codigo);
    if (bolsa.resultado === 'agregado') svc.quitarLinea(cart, bolsa.linea.linea_id);
    const v = svc.vista(cart);
    assert.equal(v.lineas.length, 2);
    assert.equal(v.piezas, 5);
    assert.equal(v.total, dinero(2 * 89900 + 3 * 12000));

    // efectivo insuficiente: no se guarda nada ni se consume folio
    await assert.rejects(svc.cobrarEfectivo(cart, v.total - 1), { codigo: 'EFECTIVO_INSUFICIENTE' });
    assert.equal(ctx.m.caja('DUO', 1).estadoFolios().ultimo, 0);

    const r = await svc.cobrarEfectivo(cart, 220000);
    // guardar venta, pago y folio
    assert.equal(r.venta.folio, 1);
    assert.equal(r.cambio, 220000 - v.total);
    assert.deepEqual(r.venta.pagos, [{ metodo: 'efectivo', monto: v.total, recibido: 220000, cambio: 4200 }]);
    assert.equal(r.venta.lineas[0]!.estilo, '726-');
    // descontar inventario (la tienda comparte existencias: se ve en Caja 2 tras sincronizar)
    assert.equal(ctx.m.caja('DUO', 1).stockLocal(jeans.item_id), 5 - 2);
    assert.equal(ctx.m.caja('DUO', 1).stockLocal(masc.item_id), 50 - 3);
    ctx.m.pump();
    assert.equal(ctx.m.caja('DUO', 2).stockLocal(jeans.item_id), 3);
    assert.equal(stock(ctx.m.central.repo.ops(), 'DUO').get(masc.item_id), 47);
    assert.equal(ctx.m.caja('LON', 1).stockLocal(jeans.item_id), 3, 'London conserva su propio inventario');
    // imprimir ticket
    assert.equal(r.impresion.ok, true);
    const archivos = readdirSync(impresora.dir).sort();
    assert.deepEqual(archivos, ['001-D1-000001.bin', '001-D1-000001.txt']);
    const txt = readFileSync(join(impresora.dir, archivos[1]!), 'utf8');
    assert.match(txt, /Item #: 1001 +Código: 0002026090782/);
    assert.match(txt, /^\d+ JEANS LEVIS 726-$/m);
    assert.doesNotMatch(txt, /Marca:|Estilo:|Lote/);
    assert.match(txt, /TOTAL +\$2,158\.00/);
    assert.match(txt, /Cambio +\$42\.00/);
    assert.doesNotMatch(txt, /iva|tax|impuesto|%/i);
    const bin = readFileSync(join(impresora.dir, archivos[0]!));
    assert.deepEqual([...bin.subarray(5, 10)], [0x1b, 0x70, 0x00, 25, 250], 'el cobro en efectivo abre el cajón');
    assert.deepEqual(ctx.m.caja('DUO', 1).impresionesDe(r.venta.sale_id).map((i) => [i.tipo, i.resultado]), [['original', 'ok']]);
    // reflejar en el corte de ESA caja
    const c = svc.corte(HOY).vivo;
    assert.deepEqual(
      [c.tickets, c.ventas_brutas, c.descuentos, c.ventas, c.cobros_efectivo, c.efectivo_esperado, c.folio_inicial, c.folio_final],
      [1, 215800, 0, 215800, 215800, 215800, 1, 1],
    );
    assert.equal(ctx.m.caja('DUO', 2).corteEnVivo(HOY).tickets, 0, 'la otra caja no ve la venta en su corte');
    // cierre del corte y venta posterior => el cierre queda desactualizado, no se reescribe
    assert.equal(svc.cerrarCorte(HOY).tickets, 1);
    const cart2 = svc.nuevaVenta();
    svc.escanear(cart2, masc.codigo);
    await svc.cobrarEfectivo(cart2, 12000);
    const c2 = svc.corte(HOY);
    assert.equal(c2.vivo.tickets, 2);
    assert.equal(c2.cerrado!.tickets, 1);
    assert.equal(c2.desactualizado, true);
  });

  it('V2 si la impresora falla, la venta queda guardada una sola vez y el ticket se reimprime con el mismo folio', async (t) => {
    const ctx = nuevoMundo(alm, politica());
    t.after(() => ctx.limpiar());
    const { svc, impresora } = servicioDe(ctx, 'DUO', 1);
    const masc = ctx.items[2]!;
    const cart = svc.carritoActual();
    svc.escanear(cart, masc.codigo);
    impresora.falla = 'sin papel';
    const r = await svc.cobrarEfectivo(cart, 12000);
    assert.equal(r.impresion.ok, false);
    assert.match(r.impresion.error!, /sin papel/);
    assert.equal(r.venta.folio, 1);
    // reintento del mismo cobro (por ejemplo, doble clic): sigue siendo la misma venta
    const otra = await svc.cobrarEfectivo(cart, 12000);
    assert.equal(otra.venta.folio, 1);
    impresora.falla = null;
    const re = await svc.reimprimir(r.venta.sale_id);
    assert.equal(re.impresion.ok, true);
    assert.match(re.ticket_texto, /\*\*\* REIMPRESIÓN 1 \*\*\*/);
    assert.match(re.ticket_texto, /Folio: 000001/);
    const caja = ctx.m.caja('DUO', 1);
    assert.equal(caja.ops().filter((o) => o.tipo === 'sale.confirmed').length, 1);
    assert.equal(caja.stockLocal(masc.item_id), 49, 'el inventario se descontó una sola vez');
    assert.equal(caja.estadoFolios().ultimo, 1);
    assert.deepEqual(caja.impresionesDe(r.venta.sale_id).map((i) => [i.tipo, i.resultado]), [['original', 'error'], ['original', 'error'], ['reimpresion', 'ok']]);
    const reimpreso = readFileSync(join(impresora.dir, readdirSync(impresora.dir).find((f) => f.endsWith('.bin'))!));
    assert.notDeepEqual([...reimpreso.subarray(5, 10)], [0x1b, 0x70, 0x00, 25, 250], 'reimprimir no abre el cajón');
  });

  it('V3 las cuatro series son independientes y el inventario se comparte solo dentro de cada tienda', async (t) => {
    const ctx = nuevoMundo(alm, politica());
    t.after(() => ctx.limpiar());
    const masc = ctx.items[2]!;
    const cajas: [string, number][] = [['DUO', 1], ['DUO', 2], ['LON', 1], ['LON', 2]];
    const servicios = new Map(cajas.map(([tn, n]) => [`${tn}/${n}`, servicioDe(ctx, tn, n)]));
    const folios = new Map<string, number[]>();
    for (const ronda of [1, 2, 3]) {
      for (const [tn, n] of cajas) {
        const s = servicios.get(`${tn}/${n}`)!.svc;
        const cart = s.nuevaVenta();
        s.escanear(cart, masc.codigo);
        const r = await s.cobrarEfectivo(cart, 12000);
        folios.set(`${tn}/${n}`, [...(folios.get(`${tn}/${n}`) ?? []), r.venta.folio]);
        assert.match(r.codigo_ticket, new RegExp(`^${tn === 'DUO' ? 'D' : 'L'}${n}-00000${ronda}$`));
      }
    }
    for (const f of folios.values()) assert.deepEqual(f, [1, 2, 3]);
    ctx.m.pump();
    for (const [tn, n] of cajas) assert.equal(ctx.m.caja(tn, n).stockLocal(masc.item_id), 50 - 6, `${tn}/${n}: 3 ventas de cada caja de su tienda`);
    assert.deepEqual(detectarFolios(ctx), []);
  });

  it('V4 el cajero consulta solo su caja; Administración elige una, varias o todas', async (t) => {
    const ctx = nuevoMundo(alm, politica());
    t.after(() => ctx.limpiar());
    const masc = ctx.items[2]!;
    const a = servicioDe(ctx, 'DUO', 1, 'Ana').svc;
    const b = servicioDe(ctx, 'LON', 2, 'Luis').svc;
    for (const s of [a, b, a]) {
      const cart = s.nuevaVenta();
      s.escanear(cart, masc.codigo);
      await s.cobrarEfectivo(cart, 12000);
    }
    ctx.m.pump();
    assert.deepEqual(a.ventasDelDia(HOY).map((r) => [r.tienda, r.caja, r.folio]), [['DUO', 1, 1], ['DUO', 1, 2]]);
    assert.deepEqual(b.ventasDelDia(HOY).map((r) => [r.tienda, r.caja, r.folio]), [['LON', 2, 1]]);
    assert.throws(() => a.ventasPropias({ cajas: [{ tienda: 'LON', caja: 2 }] }), { codigo: 'PROHIBIDO' });
    assert.throws(() => a.cortesPropios({ cajas: [{ tienda: 'DUO', caja: 2 }] }), { codigo: 'PROHIBIDO' });
    assert.throws(() => new ServicioCaja({ caja: ctx.m.caja('DUO', 2), actor: { rol: 'cajero', usuario: 'x', tienda: 'DUO', caja: 1 }, impresora: servicioDe(ctx, 'DUO', 2).impresora, conexion: { hubAlcanzable: () => true, internet: () => null, pendientes: () => 0, ultimaSync: () => null }, reloj: ctx.m.reloj }), { codigo: 'PROHIBIDO' }, 'una sesión no puede atarse a la caja de otro');

    const admin = new ServicioAdmin({ actor: { rol: 'admin', usuario: 'galo' }, fuente: () => ctx.m.central.repo.ops(), cajas: ctx.m.ctx.cajasCfg });
    assert.equal(admin.reporte().filas.length, 3);
    assert.equal(admin.reporte({ cajas: [{ tienda: 'DUO', caja: 1 }] }).filas.length, 2);
    const varias = admin.reporte({ cajas: [{ tienda: 'DUO', caja: 1 }, { tienda: 'LON', caja: 2 }] });
    assert.equal(varias.filas.length, 3);
    assert.deepEqual(varias.porCaja.map((c) => [c.tienda, c.caja, c.tickets]).sort(), [['DUO', 1, 2], ['LON', 2, 1]]);
    assert.deepEqual(varias.filas.map((f) => f.folio).sort(), [1, 1, 2], 'folios originales, sin renumerar');
    const malo = new ServicioAdmin({ actor: { rol: 'cajero', usuario: 'c', tienda: 'DUO', caja: 1 } as unknown as Extract<Actor, { rol: 'admin' }>, fuente: () => ctx.m.central.repo.ops(), cajas: [] });
    assert.throws(() => malo.reporte(), { codigo: 'PROHIBIDO' });
  });

  it('V5 un código ambiguo no se adivina: el escaneo devuelve candidatos y no agrega nada', async (t) => {
    const ctx = nuevoMundo(alm, politica());
    t.after(() => ctx.limpiar());
    ctx.m.cortarInternet('DUO');
    ctx.m.cortarInternet('LON');
    const dup = (marca: string) => ({ codigo: '7509999999999', marca, descripcion: 'BLUSA', estilo: 'B-1', lote: '20261016', departamento: 'DAMA', precio: 25000, existencia_inicial: 5 });
    ctx.m.caja('DUO', 2).altaArticulo(dup('A'));
    ctx.m.caja('LON', 1).altaArticulo(dup('B'));
    ctx.m.restablecerInternet('DUO');
    ctx.m.restablecerInternet('LON');
    ctx.m.pump();
    ctx.m.pump();
    const { svc } = servicioDe(ctx, 'DUO', 1);
    const cart = svc.nuevaVenta();
    const r = svc.escanear(cart, '7509999999999');
    assert.equal(r.resultado, 'ambiguo');
    if (r.resultado === 'ambiguo') assert.equal(r.candidatos.length, 2);
    assert.equal(svc.vista(cart).lineas.length, 0);
    assert.equal(svc.escanear(cart, '0000000000000').resultado, 'no_encontrado');
    // tras la resolución administrativa, el mismo código ya no es ambiguo
    const op = ctx.m.central.repo.ops().find((o) => o.tipo === 'item.created' && o.payload.marca === 'B')!;
    reasignarCodigo({ rol: 'admin', usuario: 'galo' }, ctx.m.central, { item_id: op.payload.item_id, codigo_nuevo: '7509999999001', motivo: 're-etiquetado' });
    ctx.m.pump();
    ctx.m.pump();
    assert.equal(svc.escanear(cart, '7509999999999').resultado, 'agregado');
  });

  it('V6 búsqueda por código, Item # y texto (sin acentos), con existencia y estado de verificación', (t) => {
    const ctx = nuevoMundo(alm, politica());
    t.after(() => ctx.limpiar());
    const { svc } = servicioDe(ctx, 'DUO', 1);
    assert.deepEqual(svc.buscar('1003').map((x) => x.descripcion), ['MASCADA']);
    assert.deepEqual(svc.buscar('0002026090782').map((x) => x.item_no), ['1001']);
    assert.deepEqual(svc.buscar('mascada').map((x) => x.marca), ['EFENTUS']);
    assert.deepEqual(svc.buscar('levis').map((x) => x.lote).sort(), ['20260913', '20261014']);
    assert.equal(svc.buscar('bolsa')[0]!.existencia, 1);
    assert.equal(svc.buscar('bolsa')[0]!.existencia_verificada, true);
    assert.deepEqual(svc.buscar('   '), []);
  });

  it('V7 sin hub la venta sigue (P-01=vender_autonomo_con_aviso en ensayo): se guarda, se imprime y queda pendiente de sincronizar', async (t) => {
    const ctx = nuevoMundo(alm, politica({ P01_hub_no_disponible: 'vender_autonomo_con_aviso' }));
    t.after(() => ctx.limpiar());
    const { svc, sync } = servicioDe(ctx, 'DUO', 1);
    ctx.m.caerHub('DUO');
    const cart = svc.nuevaVenta();
    svc.escanear(cart, ctx.items[2]!.codigo);
    const r = await svc.cobrarEfectivo(cart, 12000);
    assert.equal(r.impresion.ok, true);
    const e = svc.estado();
    assert.equal(e.conexion.hub, false);
    assert.ok(e.conexion.pendientes > 0);
    ctx.m.levantarHub('DUO');
    sync();
    const e2 = svc.estado();
    assert.equal(e2.conexion.hub, true);
    assert.equal(e2.conexion.pendientes, 0);
    assert.ok(e2.conexion.ultima_sync);
  });

  it('V8 el encabezado: tienda, caja, usuario, fecha local, último folio y estado de conexión', async (t) => {
    const ctx = nuevoMundo(alm, politica());
    t.after(() => ctx.limpiar());
    ctx.m.reloj.fijar('2026-11-01T05:30:00Z'); // 22:30 del 31 de octubre en Hermosillo
    const { svc } = servicioDe(ctx, 'LON', 2, 'Luis');
    const e = svc.estado();
    assert.deepEqual([e.tienda, e.caja, e.usuario, e.negocio, e.fecha_local, e.ultimo_folio], ['LON', 2, 'Luis', 'London Love', '2026-10-31', 0]);
    assert.equal(e.conexion.internet, true);
  });
});

porAlmacen('Primera operación: reinicio (solo SQLite)', (alm) => {
  it('V9 tras un reinicio la venta, su ticket y el corte siguen ahí y se puede reimprimir', async (t) => {
    const ctx = nuevoMundo(alm, politica());
    t.after(() => ctx.limpiar());
    const a = servicioDe(ctx, 'DUO', 1);
    const cart = a.svc.nuevaVenta();
    a.svc.escanear(cart, ctx.items[2]!.codigo);
    const r = await a.svc.cobrarEfectivo(cart, 12000);
    ctx.m.reiniciarCaja('DUO', 1);
    const b = servicioDe(ctx, 'DUO', 1);
    assert.deepEqual(b.svc.ventasDelDia(HOY).map((x) => x.folio), [1]);
    assert.equal(b.svc.corte(HOY).vivo.tickets, 1);
    assert.match(b.svc.ticketTexto(r.venta.sale_id), /Folio: 000001/);
    assert.equal((await b.svc.reimprimir(r.venta.sale_id)).impresion.ok, true);
    assert.equal(ventas(ctx.m.caja('DUO', 1).ops()).size, 1);
  });
}, 'sqlite');

function detectarFolios(ctx: { m: { central: { repo: { ops(): import('../src/tipos.ts').Op[] } } } }) {
  const por = new Map<string, Set<number>>();
  for (const o of ctx.m.central.repo.ops()) if (o.tipo === 'sale.confirmed') (por.get(`${o.payload.tienda}/${o.payload.caja}`) ?? por.set(`${o.payload.tienda}/${o.payload.caja}`, new Set()).get(`${o.payload.tienda}/${o.payload.caja}`)!).add(o.payload.folio);
  return [...por].filter(([, s]) => s.size !== Math.max(...s)).map(([k]) => k);
}
