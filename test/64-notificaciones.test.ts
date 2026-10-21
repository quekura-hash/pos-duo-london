import assert from 'node:assert/strict';
import { test } from 'node:test';
import { avisoDeOp, debeEnviar, esReciente, fechaHoraLocal, inicioDiaUtc, mxn, PREFS_OMISION, resumenDelDia, sanearPrefs, tocaResumen, type OpMin } from '../supabase/functions/notificar/formato.ts';

const op = (tipo: string, payload: unknown, extra: Partial<OpMin> = {}): OpMin => ({ op_id: `${tipo}:1`, tipo, tienda: 'DUO', caja: 1, ocurrio_en: '2026-10-21T18:00:00.000Z', payload, ...extra });
const VENTA = { sale_id: 's1', tienda: 'DUO', caja: 1, folio: 123, cajero: 'Ana', total: 101900, vendedora: 'Tania', lineas: [{ qty: 2 }, { qty: 1, tarjeta_regalo: true }], pagos: [{ metodo: 'efectivo' }, { metodo: 'tarjeta' }] };

test('NT1 cada tipo de operación genera su aviso con título y texto claros', () => {
  const v = avisoDeOp(op('sale.confirmed', VENTA))!;
  assert.deepEqual([v.tipo, v.titulo, v.cuerpo], ['venta', 'Venta DÚO · $1,019.00', 'Caja 1 · folio 000123 · Ana · vendió Tania · 2 pzas · efectivo + tarjeta']);
  assert.equal(avisoDeOp(op('sale.confirmed', { ...VENTA, tienda: 'LON', vendedora: 'Autocompra', pagos: [{ metodo: 'efectivo_usd' }] }))!.titulo, 'Venta London · $1,019.00');
  assert.match(avisoDeOp(op('sale.confirmed', { ...VENTA, vendedora: 'Autocompra' }))!.cuerpo, /^Caja 1 · folio 000123 · Ana · 2 pzas/, 'Autocompra no se menciona');
  const c = avisoDeOp(op('sale.cancelled', { sale_id: 's1', motivo: 'error de cobro', cancelo: 'Ana', autorizado_por: 'Tania' }), { venta: VENTA })!;
  assert.deepEqual([c.tipo, c.titulo, c.cuerpo], ['cancelacion', 'Venta cancelada DÚO · $1,019.00', 'Caja 1 · folio 000123 · cancela Ana (autoriza Tania) · error de cobro']);
  assert.equal(avisoDeOp(op('sale.cancelled', { sale_id: 'x', motivo: 'm', cancelo: 'Ana' }))!.titulo, 'Venta cancelada', 'sin la venta de origen igual avisa');
  const d = avisoDeOp(op('return.registered', { devolucion_id: 'd1', tienda: 'LON', caja: 2, importe: 45000, cajero: 'Luis', motivo: 'talla', reembolsos: [{ metodo: 'efectivo', monto: 45000 }] }))!;
  assert.deepEqual([d.tipo, d.titulo, d.cuerpo], ['devolucion', 'Devolución London · $450.00', 'Caja 2 · Luis · talla · sale efectivo']);
  const r = avisoDeOp(op('cash.retiro', { retiro_id: 'r1', folio_retiro: 'R-0004', tienda: 'DUO', caja: 1, usuario: 'Ana', equivalente_mxn: 500000 }))!;
  assert.deepEqual([r.tipo, r.titulo, r.cuerpo], ['retiro', 'Retiro de efectivo DÚO · $5,000.00', 'Caja 1 · Ana · retiro R-0004']);
  const k = avisoDeOp(op('corte.generado', { tienda: 'DUO', caja: 1, fecha: '2026-10-21', tickets: 42, ventas: 3842000, cobros_efectivo: 1500000, cobros_tarjeta: 2342000, cobros_efectivo_usd: 0, diferencia_mxn: -5000 }))!;
  assert.deepEqual([k.tipo, k.titulo, k.cuerpo], ['corte', 'Corte DÚO caja 1 · 21/10', '42 tickets · ventas $38,420.00 · efectivo $15,000.00 · tarjeta $23,420.00 · diferencia en efectivo −$50.00']);
  assert.equal(avisoDeOp(op('doc.perdida_posible', {}))!.tipo, 'alertas');
  assert.equal(avisoDeOp(op('alm.faltante', { tienda: 'DUO' }))!.tipo, 'alertas');
  assert.equal(avisoDeOp(op('inv.movement', {})), null);
  assert.equal(avisoDeOp(op('item.created', {})), null);
});

test('NT2 las preferencias deciden: tipo, tienda, importe mínimo y pausa («no molestar»)', () => {
  const venta = { tipo: 'venta' as const, tienda: 'DUO', monto: 5000 };
  const ahora = '2026-10-21T18:00:00.000Z';
  assert.equal(debeEnviar(undefined, venta, { ahora }), true, 'por omisión todo está activo');
  assert.equal(debeEnviar({ venta: false }, venta, { ahora }), false, 'cada venta apagada');
  assert.equal(debeEnviar({ venta: false }, { tipo: 'corte', tienda: 'DUO' }, { ahora }), true, 'apagar ventas no apaga el corte');
  assert.equal(debeEnviar({ tiendas: ['LON'] }, venta, { ahora }), false, 'solo London');
  assert.equal(debeEnviar({ venta_minima: 10000 }, venta, { ahora }), false);
  assert.equal(debeEnviar({ venta_minima: 10000 }, { ...venta, monto: 10000 }, { ahora }), true);
  assert.equal(debeEnviar(undefined, venta, { ahora, pausaHasta: '2026-10-21T19:00:00.000Z' }), false, 'en pausa');
  assert.equal(debeEnviar(undefined, venta, { ahora, pausaHasta: '2026-10-21T17:00:00.000Z' }), true, 'la pausa ya venció');
  assert.equal(debeEnviar({ venta: false }, { tipo: 'prueba', tienda: null }, { ahora, pausaHasta: '2099-01-01T00:00:00Z' }), true, 'la prueba siempre llega');
});

test('NT3 una operación vieja no avisa; fechas y horas locales de Hermosillo (UTC−7)', () => {
  assert.equal(esReciente({ ocurrio_en: '2026-10-21T17:50:00.000Z' }, '2026-10-21T18:00:00.000Z'), true);
  assert.equal(esReciente({ ocurrio_en: '2026-10-21T17:30:00.000Z' }, '2026-10-21T18:00:00.000Z'), false);
  assert.deepEqual(fechaHoraLocal('2026-10-22T04:30:00.000Z'), { fecha: '2026-10-21', hora: '21:30' });
  assert.deepEqual(fechaHoraLocal('2026-10-21T06:59:00.000Z'), { fecha: '2026-10-20', hora: '23:59' });
  assert.equal(inicioDiaUtc('2026-10-21').toISOString(), '2026-10-21T07:00:00.000Z');
  assert.equal(mxn(1234567), '$12,345.67');
});

test('NT4 resumen del día: por tienda y total, sin lo cancelado y restando devoluciones; llega una vez al día a su hora', () => {
  const vs = [{ ...VENTA, sale_id: 'a', total: 100000 }, { ...VENTA, sale_id: 'b', total: 50000 }, { ...VENTA, sale_id: 'c', total: 30000 }, { ...VENTA, sale_id: 'd', tienda: 'LON', caja: 1, total: 20000 }];
  const r = resumenDelDia({ fecha: '2026-10-21', ventas: vs, canceladas: ['c'], devoluciones: [{ tienda: 'DUO', importe: 10000 }] }, ['DUO', 'LON'])!;
  assert.equal(r.titulo, 'Resumen del día 21/10 · $1,600.00');
  assert.equal(r.cuerpo, 'DÚO: 2 tickets · $1,400.00 (dev. $100.00) · 1 canc.\nLondon: 1 ticket · $200.00\nTotal: 3 tickets · $1,600.00');
  assert.equal(resumenDelDia({ fecha: '2026-10-21', ventas: [], canceladas: [], devoluciones: [] }, ['DUO'])!.cuerpo, 'DÚO: 0 tickets · $0.00');
  // 21:00 locales = 04:00 UTC del día siguiente.
  assert.equal(tocaResumen(undefined, null, '2026-10-22T03:59:00.000Z'), false, 'todavía no son las 21:00');
  assert.equal(tocaResumen(undefined, null, '2026-10-22T04:00:00.000Z'), true);
  assert.equal(tocaResumen(undefined, '2026-10-21', '2026-10-22T04:15:00.000Z'), false, 'ya se mandó hoy');
  assert.equal(tocaResumen({ resumen_hora: '22:30' }, null, '2026-10-22T04:00:00.000Z'), false);
  assert.equal(tocaResumen({ resumen_dia: false }, null, '2026-10-22T05:00:00.000Z'), false);
});

test('NT5 las preferencias que llegan del teléfono se limpian y nunca rompen', () => {
  assert.deepEqual(sanearPrefs(undefined), PREFS_OMISION);
  assert.deepEqual(sanearPrefs({ venta: false, resumen_hora: '9:00', venta_minima: -5, tiendas: ['DUO', 'XX', 'DUO'], malo: true, corte: 'sí' }), { ...PREFS_OMISION, venta: false, tiendas: ['DUO'] });
  assert.equal(sanearPrefs({ resumen_hora: '23:45' }).resumen_hora, '23:45');
  assert.equal(sanearPrefs({ venta_minima: 50000 }).venta_minima, 50000);
});
