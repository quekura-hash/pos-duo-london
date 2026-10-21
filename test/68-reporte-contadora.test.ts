import assert from 'node:assert/strict';
import { it } from 'node:test';
import { MAX_INTENTOS, correoDelReporte, diasDelMes, esUltimoDiaDelMes, limpiarCorreos, mesAnterior, nombreDelMes, porEnviar, rangoDelPeriodo, reporteDeCaja } from '../src/reporte-contadora.ts';
import { avisoDeFallos, ejecutarMensual, ejecutarPrueba, type Dependencias, type Fallo } from '../src/reporte-contadora-envio.ts';
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

it('RC2 cuándo toca: 9, 10 y 11 p. m. del último día del mes y 9 a. m. del día 1 (hora de Hermosillo); nunca antes ni después; cada caja por su lado', () => {
  const cajas = [{ tienda: 'DUO', caja: 1 }, { tienda: 'DUO', caja: 2 }];
  assert.equal(fechaLocal('2026-11-01T04:00:00Z'), '2026-10-31', '9 p. m. del 31/10 en Hermosillo (UTC−7) = 04:00 UTC del 1/11');
  for (const h of ['04', '05', '06']) assert.deepEqual(porEnviar(`2026-11-01T${h}:00:00Z`, cajas, new Set()), [{ periodo: '2026-10', tienda: 'DUO', caja: 1 }, { periodo: '2026-10', tienda: 'DUO', caja: 2 }], `${h}:00 UTC = 21, 22 y 23 h locales`);
  assert.deepEqual(porEnviar('2026-10-31T16:00:00Z', cajas, new Set()), [], '9 a. m. del último día todavía no: el mes no termina');
  assert.deepEqual(porEnviar('2026-11-01T07:00:00Z', cajas, new Set()), [], 'medianoche: no es ventana de envío');
  assert.deepEqual(porEnviar('2026-11-01T16:00:00Z', cajas, new Set()), [{ periodo: '2026-10', tienda: 'DUO', caja: 1 }, { periodo: '2026-10', tienda: 'DUO', caja: 2 }], '9 a. m. del día 1: cuarto y último intento del mes anterior');
  assert.deepEqual(porEnviar('2026-11-02T16:00:00Z', cajas, new Set()), [], 'el día 2 ya no se insiste');
  assert.deepEqual(porEnviar('2026-11-01T04:00:00Z', cajas, new Set(['2026-10|DUO/1'])), [{ periodo: '2026-10', tienda: 'DUO', caja: 2 }], 'lo ya enviado (o agotado) de una caja no se repite, la otra sigue');
  assert.deepEqual(porEnviar('2026-11-15T16:00:00Z', cajas, new Set()), [], 'a mitad de mes no se manda nada');
  assert.deepEqual(porEnviar('2026-03-01T04:00:00Z', [cajas[0]!], new Set()), [{ periodo: '2026-02', tienda: 'DUO', caja: 1 }], 'febrero termina el 28');
  assert.equal(MAX_INTENTOS, 4);
});

it('RC3 correos: se limpian, sin repetidos ni inválidos', () => {
  assert.deepEqual(limpiarCorreos('Conta@Despacho.mx, otra@x.com; conta@despacho.mx  mal@ y@'), { correos: ['conta@despacho.mx', 'otra@x.com'], invalidos: ['mal@', 'y@'] });
  assert.deepEqual(limpiarCorreos([]), { correos: [], invalidos: [] });
});

porAlmacen('Reporte mensual a la contadora: un correo por caja a sus propios destinatarios, sin duplicar, con reintento y prueba solo para quien la pide', (alm) => {
  const admin = (ctx: ReturnType<typeof nuevoMundo>) => new ServicioAdmin({ central: ctx.m.central, actor: { rol: 'admin', usuario: 'galo' }, fuente: () => ctx.m.central.repo.ops(), cajas: [{ tienda: 'DUO', caja: 1 }, { tienda: 'LON', caja: 1 }] as never, tiendas: () => ['DUO', 'LON'] } as never);
  const HOJA: unknown[][] = [[null, 'Date', null, 'Receipt #', null, 'Receipt Type', null, 'Full Name', null, 'Qty Sold', null, 'Total', null, 'Payment'], [null, '13/09/2026', null, 52349, null, 'Sales', null, null, null, 2, null, 1000, null, 'Cash']];

  function dependencias(ops: () => Op[], o: { ahora: string; config: { tienda: string; caja: number; activo: boolean; correos: string[] }[]; falla?: (tienda: string, caja: number) => boolean }) {
    const enviados = new Set<string>();
    const reservas = new Set<string>();
    const intentos = new Map<string, number>();
    const correos: { para: string[]; asunto: string; texto: string; adjunto: { nombre: string; bytes: Uint8Array } }[] = [];
    const bitacora: string[] = [];
    const avisos: Fallo[][] = [];
    const k = (p: string, t: string, c: number) => `${p}|${t}/${c}`;
    let fallaAhora = false;
    const d: Dependencias & { fijar(a: string): void } = {
      ahora: () => o.ahora, fijar: (a) => { o.ahora = a; },
      cajasConfiguradas: async () => o.config,
      enviados: async () => new Set([...enviados]),
      agotados: async () => new Set([...intentos].filter(([key, n]) => n >= MAX_INTENTOS && !enviados.has(key)).map(([key]) => key)),
      reclamar: async (p, t, c) => { const key = k(p, t, c); if (enviados.has(key) || reservas.has(key) || (intentos.get(key) ?? 0) >= MAX_INTENTOS) return false; reservas.add(key); return true; },
      fallar: async (p, t, c, e) => { const key = k(p, t, c); reservas.delete(key); intentos.set(key, (intentos.get(key) ?? 0) + 1); bitacora.push(`fallo ${key} #${intentos.get(key)} ${e}`); return intentos.get(key)!; },
      reiniciar: async (p, t, c) => { const key = k(p, t, c); if (!enviados.has(key)) { reservas.delete(key); intentos.delete(key); bitacora.push(`reiniciado ${key}`); } },
      registrar: async (p, t, c, r) => { enviados.add(k(p, t, c)); bitacora.push(`registrado ${k(p, t, c)} ${r.tickets} ${r.total}`); },
      avisarFallos: async (f) => { avisos.push(f); },
      leerOps: async () => ops(),
      generarXlsx: escribirXlsxNode,
      enviarCorreo: async (c) => {
        const caja = /Caja (\d)/.exec(c.asunto)![1]!;
        const tienda = c.asunto.startsWith('DÚO') ? 'DUO' : 'LON';
        if (o.falla?.(tienda, Number(caja))) throw new Error('Resend: 503');
        correos.push({ para: c.para, asunto: c.asunto, texto: c.texto, adjunto: c.adjunto });
        return { id: `re_${correos.length}` };
      },
    };
    void fallaAhora;
    return { d, correos, bitacora, enviados, intentos, avisos };
  }

  const mes = () => {
    const periodo = fechaLocal(new Date().toISOString()).slice(0, 7);
    const [y, m] = periodo.split('-').map(Number) as [number, number];
    const hora = (dia: number, h: number) => new Date(Date.UTC(y, m, dia, h)).toISOString();
    // 21, 22 y 23 h locales del último día = 04, 05 y 06 UTC del día 1 siguiente; 9 a. m. del día 1 = 16 UTC.
    return { periodo, h21: hora(1, 4), h22: hora(1, 5), h23: hora(1, 6), h9: hora(1, 16) };
  };

  it('RC4 cada caja manda SU correo a SUS destinatarios; si falla se reintenta a las 22 y 23 h y a las 9 a. m.; al cuarto fallo avisa al teléfono una sola vez; si sale antes no avisa', async (t) => {
    const ctx = nuevoMundo(alm, politica());
    t.after(ctx.limpiar);
    const v = vender(ctx.m, 'DUO', 1, ctx.items[2]!.item_id).venta; // venta de hoy en DÚO Caja 1
    ctx.m.pump();
    const { periodo, h21, h22, h23, h9 } = mes();
    const ops = () => ctx.m.central.repo.ops();
    const config = [
      { tienda: 'DUO', caja: 1, activo: true, correos: ['conta@despacho.mx', 'dueno@x.mx'] }, { tienda: 'DUO', caja: 2, activo: true, correos: ['otra.conta@despacho.mx'] },
      { tienda: 'LON', caja: 1, activo: false, correos: ['lon@x.mx'] }];

    // Escenario A: DÚO Caja 1 falla en los cuatro intentos; la Caja 2 sale a la primera.
    const x = dependencias(ops, { ahora: h21, config, falla: (tienda, caja) => tienda === 'DUO' && caja === 1 });
    let r = await ejecutarMensual(x.d);
    assert.deepEqual(r.resultados.map((e) => [e.tienda, e.caja, e.estado, e.intentos]), [['DUO', 1, 'fallo', 1], ['DUO', 2, 'enviado', undefined]]);
    assert.deepEqual(x.correos.map((c) => c.para), [['otra.conta@despacho.mx']], 'cada caja va a SUS correos');
    assert.match(x.correos[0]!.asunto, /^DÚO New York · Caja 2 · Reporte de ventas de /);
    assert.equal(x.avisos.length, 0, 'un solo fallo no avisa');
    x.d.fijar(h22);
    r = await ejecutarMensual(x.d);
    assert.deepEqual(r.resultados.map((e) => [e.tienda, e.caja, e.estado, e.intentos]), [['DUO', 1, 'fallo', 2]], 'a las 22 h reintenta solo lo que falta');
    x.d.fijar(h23);
    r = await ejecutarMensual(x.d);
    assert.deepEqual(r.resultados.map((e) => e.intentos), [3]);
    assert.equal(x.avisos.length, 0, 'tres fallos todavía no avisan');
    x.d.fijar(h9);
    r = await ejecutarMensual(x.d);
    assert.deepEqual(r.resultados.map((e) => [e.estado, e.intentos]), [['fallo', 4]], 'cuarto intento, 9 a. m. del día siguiente');
    assert.equal(x.avisos.length, 1, 'al cuarto fallo se avisa al teléfono');
    assert.deepEqual(x.avisos[0]!.map((f) => [f.tienda, f.caja, f.intentos, f.error]), [['DUO', 1, 4, 'Resend: 503']]);
    const aviso = avisoDeFallos(x.avisos[0]!);
    assert.equal(aviso.titulo, 'El reporte no se envió');
    assert.match(aviso.cuerpo, /DÚO New York · Caja 1/);
    assert.match(aviso.cuerpo, /Se intentó 4 veces/);
    assert.match(aviso.cuerpo, /Resend: 503/);
    // Ya no se insiste (ni se vuelve a avisar), aunque la función corra otra vez.
    r = await ejecutarMensual(x.d);
    assert.deepEqual([r.resultados.length, x.avisos.length], [0, 1]);
    x.d.fijar(new Date(Date.parse(h9) + 3600_000).toISOString());
    assert.equal((await ejecutarMensual(x.d)).resultados.length, 0);

    // Escenario B: falla a las 21 y 22 h y sale a las 23 h: sin aviso, con su Excel, y ya no se repite.
    let rondas = 0;
    const y = dependencias(ops, { ahora: h21, config: [config[0]!], falla: () => rondas++ < 2 });
    await ejecutarMensual(y.d);
    y.d.fijar(h22); await ejecutarMensual(y.d);
    y.d.fijar(h23); r = await ejecutarMensual(y.d);
    assert.deepEqual(r.resultados.map((e) => [e.tienda, e.caja, e.estado, e.tickets, e.total]), [['DUO', 1, 'enviado', 1, v.total]]);
    assert.equal(y.avisos.length, 0, 'si sale antes del cuarto intento no se avisa');
    const c = y.correos[0]!;
    assert.deepEqual(c.para, ['conta@despacho.mx', 'dueno@x.mx']);
    assert.match(c.asunto, /^DÚO New York · Caja 1 · Reporte de ventas de /);
    assert.equal(c.adjunto.nombre, `reporte-de-ventas-duo-caja-1-${periodo}.xlsx`);
    assert.equal((await leerXlsxNode(c.adjunto.bytes))[0]!.filas.length, 2, 'encabezado y el ticket de la Caja 1');
    y.d.fijar(h9);
    assert.equal((await ejecutarMensual(y.d)).resultados.length, 0, 'ya salió: no se repite');
    y.d.fijar(new Date(Date.parse(h9) + 14 * 86400_000).toISOString());
    assert.match((await ejecutarMensual(y.d)).omitido!, /no toca enviar/);

    // Reenvío manual de un mes agotado: empieza de cero (intentos en 0) y esta vez sale.
    x.d.fijar(h9);
    const antes = x.correos.length;
    const z = dependencias(ops, { ahora: h9, config: [config[0]!] });
    z.intentos.set(`${periodo}|DUO/1`, 4);
    r = await ejecutarMensual(z.d, { periodo, tienda: 'DUO', caja: 1 });
    assert.deepEqual(r.resultados.map((e) => e.estado), ['enviado']);
    assert.ok(z.bitacora.includes(`reiniciado ${periodo}|DUO/1`));
    void antes;
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
