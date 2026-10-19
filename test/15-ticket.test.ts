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

  it('K2 cada artículo sale como «cantidad descripción marca estilo», con su Item # y código; sin rótulos ni lote', () => {
    const txt = renderTicketTexto(construirTicket(venta));
    assert.match(txt, /^\d+ JEANS LEVIS 726-$/m);
    assert.match(txt, /^#1001 0002026090782 +.*\$\d/m);
    assert.match(txt, /^\d+ \S.* NUEVA B-77$/m);
    assert.match(txt, /^7500000000123 +.*\$\d/m, 'un Item # aún no asignado no se inventa: solo sale el código');
    assert.doesNotMatch(txt, /#null|#undefined|pendiente/);
    assert.doesNotMatch(txt, /Marca:|Estilo:|Lote|Item #|Código:|20260913|20261016/, 'ya no salen los rótulos ni el lote');
  });

  it('K2b un renglón largo se parte entre palabras y los siguientes quedan sangrados bajo la descripción', () => {
    const v2: Venta = { ...venta, lineas: [{ ...venta.lineas[0]!, qty: 12, descripcion: 'VESTIDO LARGO DE NOCHE BORDADO CON LENTEJUELA', marca: 'EFENTUS', estilo: 'A-12', item_no: '1003', codigo: '7501234567890' }] };
    const txt = renderTicketTexto(construirTicket(v2));
    assert.match(txt, /^12 VESTIDO LARGO DE NOCHE BORDADO CON$/m);
    assert.match(txt, /^ {3}LENTEJUELA EFENTUS A-12$/m, 'sangría de la cantidad («12 »)');
    assert.match(txt, /^#1003 7501234567890/m);
    assert.ok(txt.split('\n').every((x) => x.length <= 42), 'nada pasa del ancho del papel');
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
    assert.match(txt, /Vendedora-Cajera: Ana Pérez/);
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
