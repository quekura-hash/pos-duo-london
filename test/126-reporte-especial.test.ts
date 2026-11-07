import assert from 'node:assert/strict';
import { it } from 'node:test';
import { correoDelReporte, esEspecial, nombreCaja, porEnviar, reporteDeCaja } from '../src/reporte-contadora.ts';
import { avisoDeFallos, ejecutarMensual, ejecutarPrueba, type Dependencias } from '../src/reporte-contadora-envio.ts';
import { escribirXlsxNode, leerXlsxNode } from '../src/xlsx-node.ts';
import type { Op } from '../src/tipos.ts';
import type { VentaHistorica } from '../src/ventas-historicas.ts';
import { ALMACENES, nuevoMundo, politica, vender } from './ayudas/comun.ts';

const sqlite = ALMACENES.find((a) => a.nombre === 'sqlite')!;
const fila = (folio: number, fecha: string, total: number, tipo: VentaHistorica['tipo'] = 'venta'): VentaHistorica => ({ folio, fecha, tipo, piezas: 1, total, pago: 'efectivo', pago_original: 'Cash' });
/** DÚO: dos ventas en la Caja 1, una en la Caja 2 y tres tickets históricos de la Caja 1 (uno de «fee»), todo en octubre de 2026. */
function escenario(t: { after(f: () => void): void }) {
  const ctx = nuevoMundo(sqlite, politica());
  t.after(ctx.limpiar);
  ctx.m.central.importarVentasHistoricas({ tienda: 'DUO', caja: 1, lote: 'h', por: 'E', filas: [fila(100, '2026-10-01', 30000), fila(101, '2026-10-02', 45000), fila(102, '2026-10-03', 5000, 'fee')] });
  vender(ctx.m, 'DUO', 1, ctx.items[0]!.item_id); vender(ctx.m, 'DUO', 1, ctx.items[0]!.item_id); vender(ctx.m, 'DUO', 2, ctx.items[0]!.item_id);
  ctx.m.pump(); ctx.m.pump(); ctx.m.pump();
  return ctx.m.central.repo.ops();
}
const todoElTexto = (hojas: { encabezados: string[]; filas: unknown[][] }[]) => hojas.flatMap((h) => [...h.encabezados, ...h.filas.flat().map(String)]).join(' | ');

it('RE1 el Excel del reporte especial: una sola hoja «Detalle de ventas» con SOLO las siete columnas de la foto, solo de la Caja 1, sin la palabra Caja; el de cada caja sigue igual', (t) => {
  const ops = escenario(t);
  const e = reporteDeCaja(ops, 'DUO', 101, '2026-10');
  assert.deepEqual([e.especial, e.caja, e.hojas.length, e.hojas[0]!.nombre], [true, 1, 1, 'Detalle de ventas']);
  assert.deepEqual(e.hojas[0]!.encabezados, ['Fecha', 'Folio', 'Tipo', 'Piezas', 'Total', 'Forma de pago', 'Tienda']);
  assert.equal(e.hojas[0]!.filas.length, 5, 'las 2 ventas nuevas y los 3 tickets históricos de la Caja 1 (la venta de la Caja 2 no entra)');
  assert.ok(e.hojas[0]!.filas.every((f) => f.length === 7), 'ninguna fila trae más columnas');
  assert.equal(e.archivo, 'reporte-de-ventas-duo-2026-10.xlsx');
  assert.doesNotMatch(todoElTexto(e.hojas) + e.archivo, /caja/i, 'ni en el Excel ni en su nombre aparece «caja»');
  const normal = reporteDeCaja(ops, 'DUO', 1, '2026-10');
  assert.deepEqual([normal.especial, normal.hojas.map((h) => h.nombre), normal.archivo], [false, ['Detalle de ventas', 'Resumen por día'], 'reporte-de-ventas-duo-caja-1-2026-10.xlsx']);
  assert.equal(normal.hojas[0]!.encabezados.length, 13, 'el reporte de cada caja conserva todas sus columnas');
  assert.deepEqual([e.tickets, e.total], [normal.tickets, normal.total], 'mismos tickets y total que la Caja 1');
  assert.equal(reporteDeCaja(ops, 'LON', 101, '2026-10').hojas[0]!.filas.length, 0, 'London sin ventas: hoja vacía');
});

it('RE2 el correo del reporte especial: saluda a la Contadora Elva, no dice Caja 1 ni «reporte especial» ni «Resumen por día»; el de cada caja no cambia', (t) => {
  const ops = escenario(t);
  const c = correoDelReporte(reporteDeCaja(ops, 'DUO', 101, '2026-10', '2026-10-29'), { corteA: '29/10/2026 (hasta este momento)' });
  assert.equal(c.asunto, 'DÚO New York · Reporte de ventas de octubre de 2026 (al 29/10/2026)');
  assert.ok(c.texto.startsWith('Hola, Contadora Elva\n\nAdjunto el reporte de ventas de DÚO New York · del 01/10/2026 al 29/10/2026.\n\nTickets: '), c.texto);
  assert.match(c.texto, /Corte: 29\/10\/2026 \(hasta este momento\)\. Lo que se venda después no está en este archivo\./);
  assert.match(c.texto, /El archivo trae la hoja «Detalle de ventas» \(una fila por ticket, con folio, fecha, piezas, total y forma de pago\)\. Los cancelados no se cuentan\. Enviado automáticamente por LonDuo POS\./);
  for (const parte of [c.asunto, c.texto, c.html]) assert.doesNotMatch(parte, /caja|especial|resumen por d[ií]a/i);
  assert.match(c.html, /<p>Hola, Contadora Elva<\/p>/);
  const normal = correoDelReporte(reporteDeCaja(ops, 'DUO', 2, '2026-10', '2026-10-29'));
  assert.match(normal.asunto, /^DÚO New York · Caja 2 · Reporte de ventas/);
  assert.ok(normal.texto.startsWith('Hola,\n\nAdjunto el reporte de ventas de DÚO New York · Caja 2 del 01/10/2026'));
  assert.match(normal.texto, /Resumen por día/);
  assert.equal(correoDelReporte(reporteDeCaja(ops, 'DUO', 101, '2026-10', '2026-10-29'), { prueba: true }).asunto, '[PRUEBA] DÚO New York · Reporte de ventas de octubre de 2026 (al 29/10/2026)');
});

it('RE3 envío mensual y prueba de punta a punta: el especial sale una vez a sus correos con su Excel, aparte del reporte de la Caja 1, y se reintenta como los demás', async (t) => {
  const ops = escenario(t);
  const enviados = new Set<string>(), correos: { para: string[]; asunto: string; texto: string; nombre: string; bytes: Uint8Array }[] = [];
  const d: Dependencias = {
    ahora: () => '2026-11-01T04:00:00Z', // 9 p. m. del 31/10 en Hermosillo
    cajasConfiguradas: async () => [{ tienda: 'DUO', caja: 1, activo: true, correos: ['conta@despacho.mx'] }, { tienda: 'DUO', caja: 101, activo: true, correos: ['auxiliar@despacho.mx'] }, { tienda: 'LON', caja: 101, activo: false, correos: [] }],
    enviados: async () => new Set(enviados), agotados: async () => new Set(),
    reclamar: async () => true, fallar: async () => 1, reiniciar: async () => undefined, avisarFallos: async () => undefined,
    registrar: async (p, tienda, caja) => { enviados.add(`${p}|${tienda}/${caja}`); },
    leerOps: async () => ops as Op[], generarXlsx: escribirXlsxNode,
    enviarCorreo: async (c) => { correos.push({ para: c.para, asunto: c.asunto, texto: c.texto, nombre: c.adjunto.nombre, bytes: c.adjunto.bytes }); return { id: `re_${correos.length}` }; },
  };
  const r = await ejecutarMensual(d);
  assert.deepEqual(r.resultados.map((x) => [x.tienda, x.caja, x.estado]), [['DUO', 1, 'enviado'], ['DUO', 101, 'enviado']], 'London apagado no manda nada');
  const esp = correos.find((c) => c.para[0] === 'auxiliar@despacho.mx')!, normal = correos.find((c) => c.para[0] === 'conta@despacho.mx')!;
  assert.match(normal.asunto, /Caja 1/);
  assert.doesNotMatch(esp.asunto + esp.texto + esp.nombre, /caja|especial/i);
  const libro = await leerXlsxNode(esp.bytes);
  assert.deepEqual(libro.map((h: { nombre: string }) => h.nombre), ['Detalle de ventas']);
  assert.equal(libro[0]!.filas[0]!.join(','), 'Fecha,Folio,Tipo,Piezas,Total,Forma de pago,Tienda');
  assert.equal(libro[0]!.filas.length, 1 + 5, 'encabezado y 5 tickets');
  assert.ok(libro[0]!.filas.every((f) => f.length === 7), 'siete columnas en cada fila');
  assert.doesNotMatch(JSON.stringify(libro), /caja/i);
  assert.equal((await ejecutarMensual(d)).resultados.length, 0, 'ya enviado: no se repite');
  // prueba: solo al correo de quien la pide
  const antes = correos.length;
  const p = await ejecutarPrueba({ ...d, ahora: () => '2026-10-29T20:00:00Z' }, 'DUO', 101, 'edgardo@x.mx');
  assert.equal(correos.length, antes + 1);
  assert.deepEqual(correos.at(-1)!.para, ['edgardo@x.mx']);
  assert.match(p.asunto, /^\[PRUEBA\] DÚO New York · Reporte de ventas de octubre de 2026 \(al 29\/10\/2026\)$/);
});

it('RE4 el aviso al teléfono nombra el reporte (es para Edgardo, no para la contadora) y el calendario trata el especial como cualquier envío', () => {
  assert.equal([esEspecial(1), esEspecial(2), esEspecial(101)].join(), 'false,false,true');
  assert.equal(nombreCaja('LON', 101), 'Reporte Especial Caja 1 · London Love');
  assert.match(avisoDeFallos([{ periodo: '2026-10', tienda: 'DUO', caja: 101, intentos: 4, error: 'Resend: 503' }]).cuerpo, /Reporte Especial Caja 1 · DÚO New York · octubre de 2026/);
  assert.deepEqual(porEnviar('2026-11-01T04:00:00Z', [{ tienda: 'DUO', caja: 1 }, { tienda: 'DUO', caja: 101 }], new Set(['2026-10|DUO/1'])), [{ periodo: '2026-10', tienda: 'DUO', caja: 101 }]);
});
