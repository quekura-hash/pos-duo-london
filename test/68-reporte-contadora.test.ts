import assert from 'node:assert/strict';
import { it } from 'node:test';
import { correoDelReporte, diasDelMes, esUltimoDiaDelMes, limpiarCorreos, mesAnterior, nombreDelMes, porEnviar, rangoDelPeriodo, reporteDeCaja } from '../src/reporte-contadora.ts';
import { ejecutarMensual, ejecutarPrueba, type Dependencias } from '../src/reporte-contadora-envio.ts';
import { ServicioAdmin } from '../src/app/servicio.ts';
import { escribirXlsxNode, leerXlsxNode } from '../src/xlsx-node.ts';
import { fechaLocal } from '../src/util.ts';
import type { Op } from '../src/tipos.ts';
import { nuevoMundo, politica, porAlmacen, vender } from './ayudas/comun.ts';

it('RC1 calendario: último día del mes (con bisiestos), mes anterior y rango', () => {
  assert.deepEqual([diasDelMes('2026-02'), diasDelMes('2028-02'), diasDelMes('2026-10')], [28, 29, 31]);
  assert.deepEqual([esUltimoDiaDelMes('2026-10-31'), esUltimoDiaDelMes('2026-10-30'), esUltimoDiaDelMes('2026-02-28'), esUltimoDiaDelMes('2028-02-28'), esUltimoDiaDelMes('2028-02-29')], [true, false, true, false, true]);
  assert.deepEqual([mesAnterior('2026-11'), mesAnterior('2027-01')], ['2026-10', '2026-12']);
  assert.deepEqual(rangoDelPeriodo('2026-09'), { desde: '2026-09-01', hasta: '2026-09-30' });
  assert.equal(nombreDelMes('2026-10'), 'octubre de 2026');
});

it('RC2 cuándo toca: el último día del mes a las 9 p. m. (hora de Hermosillo), y los días 1 al 3 solo si faltó el mes anterior; cada caja por su lado', () => {
  const cajas = [{ tienda: 'DUO', caja: 1 }, { tienda: 'DUO', caja: 2 }];
  assert.equal(fechaLocal('2026-11-01T04:00:00Z'), '2026-10-31', '9 p. m. del 31/10 en Hermosillo (UTC−7) = 04:00 UTC del 1/11');
  assert.deepEqual(porEnviar('2026-11-01T04:00:00Z', cajas, new Set()), [{ periodo: '2026-10', tienda: 'DUO', caja: 1 }, { periodo: '2026-10', tienda: 'DUO', caja: 2 }]);
  assert.deepEqual(porEnviar('2026-11-01T04:00:00Z', cajas, new Set(['2026-10|DUO/1'])), [{ periodo: '2026-10', tienda: 'DUO', caja: 2 }], 'lo ya enviado de una caja no se repite, la otra sigue pendiente');
  assert.deepEqual(porEnviar('2026-11-02T04:00:00Z', [cajas[0]!], new Set()), [{ periodo: '2026-10', tienda: 'DUO', caja: 1 }], 'el 1 de noviembre (local): reintento del mes anterior');
  assert.deepEqual(porEnviar('2026-11-02T04:00:00Z', [cajas[0]!], new Set(['2026-10|DUO/1'])), []);
  assert.deepEqual(porEnviar('2026-11-15T04:00:00Z', cajas, new Set()), [], 'a mitad de mes no se manda nada');
  assert.deepEqual(porEnviar('2026-03-01T04:00:00Z', [cajas[0]!], new Set()), [{ periodo: '2026-02', tienda: 'DUO', caja: 1 }], 'febrero termina el 28');
});

it('RC3 correos: se limpian, sin repetidos ni inválidos', () => {
  assert.deepEqual(limpiarCorreos('Conta@Despacho.mx, otra@x.com; conta@despacho.mx  mal@ y@'), { correos: ['conta@despacho.mx', 'otra@x.com'], invalidos: ['mal@', 'y@'] });
  assert.deepEqual(limpiarCorreos([]), { correos: [], invalidos: [] });
});

porAlmacen('Reporte mensual a la contadora: un correo por caja a sus propios destinatarios, sin duplicar, con reintento y prueba solo para quien la pide', (alm) => {
  const admin = (ctx: ReturnType<typeof nuevoMundo>) => new ServicioAdmin({ central: ctx.m.central, actor: { rol: 'admin', usuario: 'galo' }, fuente: () => ctx.m.central.repo.ops(), cajas: [{ tienda: 'DUO', caja: 1 }, { tienda: 'LON', caja: 1 }] as never, tiendas: () => ['DUO', 'LON'] } as never);
  const HOJA: unknown[][] = [[null, 'Date', null, 'Receipt #', null, 'Receipt Type', null, 'Full Name', null, 'Qty Sold', null, 'Total', null, 'Payment'], [null, '13/09/2026', null, 52349, null, 'Sales', null, null, null, 2, null, 1000, null, 'Cash']];

  function dependencias(ops: () => Op[], o: { ahora: string; config: { tienda: string; caja: number; activo: boolean; correos: string[] }[]; fallaCorreo?: { n: number } }) {
    const enviados = new Set<string>();
    const reservas = new Set<string>();
    const correos: { para: string[]; asunto: string; texto: string; adjunto: { nombre: string; bytes: Uint8Array } }[] = [];
    const bitacora: string[] = [];
    const d: Dependencias & { fijar(a: string): void } = {
      ahora: () => o.ahora, fijar: (a) => { o.ahora = a; },
      cajasConfiguradas: async () => o.config,
      enviados: async () => new Set([...enviados]),
      reclamar: async (p, t, c) => { if (enviados.has(`${p}|${t}/${c}`) || reservas.has(`${p}|${t}/${c}`)) return false; reservas.add(`${p}|${t}/${c}`); return true; },
      liberar: async (p, t, c) => { reservas.delete(`${p}|${t}/${c}`); bitacora.push(`liberado ${p}|${t}/${c}`); },
      registrar: async (p, t, c, r) => { enviados.add(`${p}|${t}/${c}`); bitacora.push(`registrado ${p}|${t}/${c} ${r.tickets} ${r.total}`); },
      leerOps: async () => ops(),
      generarXlsx: escribirXlsxNode,
      enviarCorreo: async (c) => { if (o.fallaCorreo && o.fallaCorreo.n-- > 0) throw new Error('Resend: 503'); correos.push({ para: c.para, asunto: c.asunto, texto: c.texto, adjunto: c.adjunto }); return { id: `re_${correos.length}` }; },
    };
    return { d, correos, bitacora, enviados };
  }

  it('RC4 el último día del mes cada caja manda SU correo a SUS destinatarios con su Excel; no se repite; si un correo falla solo ese se reintenta el día 1', async (t) => {
    const ctx = nuevoMundo(alm, politica());
    t.after(ctx.limpiar);
    const a = admin(ctx);
    const v = vender(ctx.m, 'DUO', 1, ctx.items[2]!.item_id).venta; // venta de hoy en DÚO Caja 1
    ctx.m.pump();
    const periodo = fechaLocal(new Date().toISOString()).slice(0, 7);
    const [y, m] = periodo.split('-').map(Number) as [number, number];
    const ultimoDia9pm = new Date(Date.UTC(y, m, 1, 4)).toISOString(); // 04:00 UTC del día 1 siguiente = 21:00 del último día local
    const diaUno = new Date(Date.UTC(y, m, 2, 4)).toISOString();
    const ops = () => ctx.m.central.repo.ops();
    assert.ok(a.reporte({}).filas.length >= 1);

    const x = dependencias(ops, { ahora: ultimoDia9pm, fallaCorreo: { n: 1 }, config: [
      { tienda: 'DUO', caja: 1, activo: true, correos: ['conta@despacho.mx', 'dueno@x.mx'] }, { tienda: 'DUO', caja: 2, activo: true, correos: ['otra.conta@despacho.mx'] },
      { tienda: 'LON', caja: 1, activo: false, correos: ['lon@x.mx'] }] });
    // Primera corrida: el proveedor falla con la primera (DÚO Caja 1) → se libera su reserva; la Caja 2 sí sale.
    let r = await ejecutarMensual(x.d);
    assert.deepEqual(r.resultados.map((e) => [e.tienda, e.caja, e.estado]), [['DUO', 1, 'fallo'], ['DUO', 2, 'enviado']]);
    assert.match(r.resultados[0]!.error!, /503/);
    assert.deepEqual(x.bitacora, [`liberado ${periodo}|DUO/1`, `registrado ${periodo}|DUO/2 0 0`]);
    assert.deepEqual(x.correos.map((c) => c.para), [['otra.conta@despacho.mx']], 'cada caja va a SUS correos');
    assert.match(x.correos[0]!.asunto, /^DÚO New York · Caja 2 · Reporte de ventas de /);
    // Día 1 siguiente: reintenta SOLO lo que faltó (Caja 1), a sus dos destinatarios, con su Excel.
    x.d.fijar(diaUno);
    r = await ejecutarMensual(x.d);
    assert.deepEqual(r.resultados.map((e) => [e.tienda, e.caja, e.estado, e.tickets, e.total]), [['DUO', 1, 'enviado', 1, v.total]]);
    assert.equal(x.correos.length, 2);
    const c = x.correos[1]!;
    assert.deepEqual(c.para, ['conta@despacho.mx', 'dueno@x.mx']);
    assert.match(c.asunto, /^DÚO New York · Caja 1 · Reporte de ventas de /);
    assert.match(c.texto, /Tickets: 1/);
    assert.equal(c.adjunto.nombre, `reporte-de-ventas-duo-caja-1-${periodo}.xlsx`);
    const hojas = await leerXlsxNode(c.adjunto.bytes);
    assert.deepEqual(hojas.map((h) => h.nombre), ['Detalle de ventas', 'Resumen por día']);
    assert.equal(hojas[0]!.filas.length, 2, 'encabezado y el ticket de la Caja 1');
    assert.equal((await leerXlsxNode(x.correos[0]!.adjunto.bytes))[0]!.filas.length, 1, 'la Caja 2 no vendió: solo el encabezado');
    // Ya salió todo: otra corrida (o dos a la vez) no manda nada más.
    r = await ejecutarMensual(x.d);
    assert.deepEqual([r.resultados.length, r.omitido], [0, 'nada pendiente']);
    assert.equal(x.correos.length, 2);
    x.d.fijar(new Date(Date.UTC(y, m, 15, 4)).toISOString());
    assert.match((await ejecutarMensual(x.d)).omitido!, /no toca enviar/);
  });

  it('RC5 una caja sin correos no manda ni se reserva; la inactiva se ignora; el reporte de una caja no trae las ventas de otra', async (t) => {
    const ctx = nuevoMundo(alm, politica());
    t.after(ctx.limpiar);
    vender(ctx.m, 'DUO', 1, ctx.items[2]!.item_id);
    ctx.m.pump();
    const periodo = fechaLocal(new Date().toISOString()).slice(0, 7);
    const [y, m] = periodo.split('-').map(Number) as [number, number];
    const x = dependencias(() => ctx.m.central.repo.ops(), { ahora: new Date(Date.UTC(y, m, 1, 4)).toISOString(), config: [{ tienda: 'DUO', caja: 1, activo: true, correos: [] }, { tienda: 'LON', caja: 1, activo: true, correos: ['lon@x.mx'] }, { tienda: 'LON', caja: 2, activo: false, correos: ['no@x.mx'] }] });
    const r = await ejecutarMensual(x.d);
    assert.deepEqual(r.resultados.map((e) => [e.tienda, e.caja, e.estado]).sort(), [['DUO', 1, 'sin_destinatarios'], ['LON', 1, 'enviado']]);
    assert.equal(x.correos.length, 1);
    assert.match(x.correos[0]!.asunto, /^London Love · Caja 1 · /);
    assert.equal(x.correos[0]!.adjunto.nombre, `reporte-de-ventas-london-caja-1-${periodo}.xlsx`);
    assert.equal((await leerXlsxNode(x.correos[0]!.adjunto.bytes))[0]!.filas.length, 1, 'London no tuvo ventas: solo el encabezado');
    const ops = ctx.m.central.repo.ops();
    assert.deepEqual([reporteDeCaja(ops, 'LON', 1, periodo).tickets, reporteDeCaja(ops, 'DUO', 2, periodo).tickets, reporteDeCaja(ops, 'DUO', 1, periodo).tickets], [0, 0, 1], 'cada caja solo ve lo suyo');
  });

  it('RC6 las ventas históricas entran al mes que les toca, y la prueba va solo a quien la pide, sin reservar nada', async (t) => {
    const ctx = nuevoMundo(alm, politica());
    t.after(ctx.limpiar);
    const a = admin(ctx);
    a.importarVentasHistoricas({ filas: HOJA, tienda: 'DUO', caja: 1, nombre: 'p.xlsx' });
    ctx.m.pump();
    const sept = reporteDeCaja(ctx.m.central.repo.ops(), 'DUO', 1, '2026-09');
    assert.deepEqual([sept.tickets, sept.piezas, sept.total, sept.efectivo, sept.historicos], [1, 2, 100000, 100000, 1]);
    assert.equal(reporteDeCaja(ctx.m.central.repo.ops(), 'DUO', 1, '2026-10').tickets, 0, 'otro mes: nada');
    assert.equal(reporteDeCaja(ctx.m.central.repo.ops(), 'DUO', 2, '2026-09').tickets, 0, 'las históricas son de la Caja 1, no de la 2');
    const c = correoDelReporte(sept, { corteA: '30/09/2026 21:00' });
    assert.match(c.texto, /del 01\/09\/2026 al 30\/09\/2026/);
    assert.match(c.texto, /Total cobrado: \$1,000\.00/);
    assert.match(c.texto, /Corte: 30\/09\/2026 21:00/);
    assert.match(c.html, /<b>\$1,000\.00<\/b>/);
    // Forzar un mes (reenvío manual): Septiembre completo, una sola vez.
    const x = dependencias(() => ctx.m.central.repo.ops(), { ahora: '2026-10-10T18:00:00Z', config: [{ tienda: 'DUO', caja: 1, activo: true, correos: ['conta@despacho.mx'] }] });
    let r = await ejecutarMensual(x.d, { periodo: '2026-09', tienda: 'DUO', caja: 1 });
    assert.deepEqual(r.resultados.map((e) => [e.estado, e.tickets, e.total]), [['enviado', 1, 100000]]);
    r = await ejecutarMensual(x.d, { periodo: '2026-09', tienda: 'DUO', caja: 1 });
    assert.deepEqual(r.resultados, [], 'no se duplica');
    // Prueba: solo al correo de quien la pide, marcada como prueba, sin tocar lo enviado.
    const antes = x.correos.length;
    const p = await ejecutarPrueba(x.d, 'DUO', 1, 'yo@x.mx');
    assert.match(p.asunto, /^\[PRUEBA\] DÚO New York · Caja 1 · Reporte de ventas de octubre de 2026 \(al 10\/10\/2026\)$/);
    assert.deepEqual(x.correos.slice(antes).map((e) => e.para), [['yo@x.mx']]);
    assert.equal(x.enviados.size, 1, 'la prueba no reserva ni registra');
    assert.match(c.texto, /Adjunto el reporte de ventas de DÚO New York · Caja 1 del 01\/09\/2026/);
  });
});
