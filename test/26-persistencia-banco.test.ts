import assert from 'node:assert/strict';
import { it } from 'node:test';
import { crearBanco } from '../src/app/navegador.ts';

const ENC = ['CANTIDAD', 'DESCRIPCION', 'ESTILO', 'MARCA', 'CODIGO', 'PRECIO', 'LOTE', 'DEPARTAMENTO'];

it('P1 el banco de pruebas conserva lo hecho (altas, entregas, ventas, departamentos) al guardarlo y volver a abrirlo', async () => {
  const b1 = crearBanco();
  const admin = b1.admin;
  admin.guardarDepartamento({ nombre: 'Hogar' });
  admin.altaLote({ lote_id: 'L1', nombre: 'oct.xlsx', filas: [ENC, [24, 'BLUSA', 'BT2988', 'CAPELLA', '202610001', 349, '1', 'DAMA']] });
  const item = admin.almacen().items.find((i) => i.codigo === '202610001')!;
  admin.entregarAlmacen({ item_id: item.item_id, destinos: { DUO: 10 }, etiqueta_precio: true, etiqueta_costura: true });
  b1.m.pump();
  const caja = b1.servicios.get('DUO/1')!;
  const cart = caja.nuevaVenta();
  const esc = caja.escanear(cart, '202610001') as any;
  caja.confirmarRecepcion(esc.recepcion[0].entrega_id);
  caja.escanear(cart, '0002026090782'); // artículo de ejemplo
  const v = await caja.cobrarEfectivo(cart, 200000, 0);
  b1.m.pump();
  const foto = JSON.parse(JSON.stringify(b1.exportar())); // lo que pasaría por IndexedDB

  const b2 = crearBanco(undefined, foto);
  const a2 = b2.admin.almacen();
  const i2 = a2.items.find((i) => i.codigo === '202610001')!;
  assert.deepEqual([i2.existencia, i2.pendiente_por_tienda], [14, {}], 'el almacén y la recepción siguen ahí');
  assert.ok(b2.admin.departamentos().departamentos.some((d) => d.nombre === 'Hogar'));
  const c2 = b2.servicios.get('DUO/1')!;
  assert.equal(c2.caja.stockLocal(item.item_id), 9, 'entraron 10 y la venta descontó 1');
  assert.equal(c2.caja.stockLocal(c2.caja.buscarPorCodigo('0002026090782')[0]!.item_id), 4, 'la venta descontó existencia');
  assert.equal(b2.admin.almacen().items.length, a2.items.length);
  // el folio continúa (no se repite el 1)
  const cart2 = c2.nuevaVenta();
  c2.escanear(cart2, '7501234567890');
  const v2 = await c2.cobrarEfectivo(cart2, 20000, 0);
  assert.equal(JSON.stringify(v).includes('"folio":1'), true);
  assert.equal(JSON.stringify(v2).includes('"folio":2'), true);
  // una base distinta (con inventario) no mezcla lo guardado de otra
  const b3 = crearBanco([], foto);
  assert.equal(b3.admin.almacen().items.length, 0);
});
