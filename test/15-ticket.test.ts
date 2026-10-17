import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { aCP858, codigoTicket, construirTicket, formatoMXN, interpretarCodigoTicket, renderTicketEscPos, renderTicketTexto } from '../src/ticket.ts';
import type { Venta } from '../src/tipos.ts';

const venta: Venta = {
  sale_id: 's1', tienda: 'DUO', caja: 2, folio: 12, cajero: 'Ana Pérez', ocurrio_en: '2026-10-16T21:32:00Z',
  lineas: [
    { linea_id: 'l1', item_id: 'i1', item_no: '1001', codigo: '0002026090782', descripcion: 'JEANS', marca: 'LEVIS', estilo: '726-', lote: '20260913', departamento: 'CABALLERO', qty: 2, precio_unit: 89900, descuento: 10000, importe: 169800 },
    { linea_id: 'l2', item_id: 'i2', item_no: null, codigo: '7500000000123', descripcion: 'BLUSA CON ÑANDÚ', marca: 'NUEVA', estilo: 'B-77', lote: '20261016', departamento: 'DAMA', qty: 1, precio_unit: 25000, descuento: 0, importe: 25000 },
  ],
  total: 194800, pagos: [{ metodo: 'efectivo', monto: 194800, recibido: 200000, cambio: 5200 }], estado: 'confirmada',
};

describe('[memoria — lógica pura] Ticket: contenido, MXN, sin impuestos, ESC/POS', () => {
  it('K1 importes en MXN exactos', () => {
    assert.equal(formatoMXN(123450), '$1,234.50');
    assert.equal(formatoMXN(5), '$0.05');
    assert.equal(formatoMXN(-1000), '-$10.00');
    assert.equal(formatoMXN(100000000), '$1,000,000.00');
  });

  it('K2 el ticket conserva Item #, Código, Descripción, Marca, Estilo y Lote como campos separados y rotulados', () => {
    const txt = renderTicketTexto(construirTicket(venta));
    assert.match(txt, /^JEANS$/m);
    assert.match(txt, /Item #: 1001 +Código: 0002026090782/);
    assert.match(txt, /Marca: LEVIS +Estilo: 726- +Lote: 20260913/);
    assert.match(txt, /Item #: pendiente +Código: 7500000000123/, 'un Item # aún no asignado se muestra como pendiente, nunca inventado');
    assert.match(txt, /Marca: NUEVA +Estilo: B-77 +Lote: 20261016/);
  });

  it('K2b un renglón largo se parte entre campos, nunca a la mitad de un campo', () => {
    const v2: Venta = { ...venta, lineas: [{ ...venta.lineas[0]!, marca: 'EFENTUS', estilo: 'A-12', lote: '20260913', item_no: '1003', codigo: '7501234567890' }] };
    const txt = renderTicketTexto(construirTicket(v2));
    assert.match(txt, /^Marca: EFENTUS {2}Estilo: A-12$/m);
    assert.match(txt, /^Lote: 20260913$/m);
    assert.match(txt, /^Item #: 1003 {2}Código: 7501234567890$/m);
  });

  it('K3 no hay IVA, Tax, impuestos ni porcentajes en el ticket; el total es neto', () => {
    const txt = renderTicketTexto(construirTicket(venta));
    assert.doesNotMatch(txt, /iva|tax|impuesto|%|subtotal/i);
    assert.match(txt, /TOTAL +\$1,948\.00/);
    assert.match(txt, /Descuento +-\$100\.00/);
    assert.match(txt, /Efectivo MXN +\$1,948\.00/);
    assert.match(txt, /Recibido +\$2,000\.00/);
    assert.match(txt, /Cambio +\$52\.00/);
    assert.doesNotMatch(txt, /dollars|usd/i, 'sin el rótulo heredado "Dollars"');
  });

  it('K4 encabezado, folio, identificador del ticket y leyenda configurable', () => {
    const t = construirTicket(venta);
    const txt = renderTicketTexto(t);
    assert.match(txt, /DÚO New York/);
    assert.match(txt, /Tienda DUO - Caja 2/);
    assert.match(txt, /Cajero: Ana Pérez/);
    assert.match(txt, /Fecha: 16\/10\/2026  Hora: 14:32/, 'hora de Hermosillo (UTC-7)');
    assert.match(txt, /Folio: 000012/);
    assert.match(txt, /No hacemos devoluciones de efectivo/);
    assert.equal(t.codigo_ticket, 'D2-000012');
    assert.ok(txt.trim().endsWith('D2-000012'));
    assert.ok(txt.split('\n').every((l) => l.length <= t.columnas), 'ningún renglón excede el ancho configurado');
  });

  it('K5 el código del ticket distingue las cuatro series y no interpreta folios sueltos', () => {
    assert.deepEqual(['DUO', 'LON'].flatMap((t) => [1, 2].map((c) => codigoTicket(t, c, 7))), ['D1-000007', 'D2-000007', 'L1-000007', 'L2-000007']);
    assert.deepEqual(interpretarCodigoTicket('L2-001251'), { tienda: 'LON', caja: 2, folio: 1251 });
    assert.equal(interpretarCodigoTicket('1251'), null, 'un ticket antiguo con solo folio necesita contexto de origen');
    assert.equal(interpretarCodigoTicket('X1-000001'), null);
  });

  it('K6 una reimpresión se rotula como tal y conserva el mismo folio', () => {
    const t = construirTicket(venta, undefined, 2);
    assert.match(renderTicketTexto(t), /\*\*\* REIMPRESIÓN 2 \*\*\*/);
    assert.equal(t.folio, 12);
  });

  it('K7 ESC/POS: inicializa, fija PC858, acentos, código de barras Code128, corte y (opcional) cajón', () => {
    const t = construirTicket(venta);
    const b = renderTicketEscPos(t, { abrirCajon: true });
    assert.deepEqual([...b.slice(0, 5)], [0x1b, 0x40, 0x1b, 0x74, 19]);
    assert.deepEqual([...b.slice(5, 10)], [0x1b, 0x70, 0x00, 25, 250], 'pulso del cajón');
    const hex = Buffer.from(b).toString('latin1');
    assert.ok(hex.includes('{BD2-000012'), 'datos Code128 con el código del ticket');
    const i = [...b].findIndex((x, k) => x === 0x1d && b[k + 1] === 0x6b && b[k + 2] === 73);
    assert.ok(i > 0);
    assert.equal(b[i + 3], '{BD2-000012'.length);
    assert.deepEqual([...b.slice(-4)], [0x1d, 0x56, 66, 0], 'corte');
    assert.ok([...b].includes(0xe9), 'Ú codificada en CP858 (DÚO)');
    assert.ok([...b].includes(0xa5), 'Ñ codificada en CP858');
    assert.notDeepEqual([...renderTicketEscPos(t).slice(5, 10)], [0x1b, 0x70, 0x00, 25, 250], 'sin la opción no se abre el cajón');
  });

  it('K8 caracteres fuera de CP858 se sustituyen con "?" y no rompen el flujo', () => {
    assert.deepEqual(aCP858('a€ñ☃'), [0x61, 0xd5, 0xa4, 0x3f]);
  });
});
