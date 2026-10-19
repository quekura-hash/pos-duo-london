import assert from 'node:assert/strict';
import { it } from 'node:test';
import { ServicioAdmin } from '../src/app/servicio.ts';
import { existenciaAlmacen } from '../src/almacen.ts';
import { catalogo } from '../src/proyecciones.ts';
import { nuevoMundo, politica, porAlmacen } from './ayudas/comun.ts';

const ENC = ['CANTIDAD', 'DESCRIPCION', 'ESTILO', 'MARCA', 'CODIGO', 'PRECIO', 'LOTE', 'DEPARTAMENTO', 'PEDIMENTO'];

porAlmacen('Corrección de una entrada de almacén mal capturada', (alm) => {
  const mundo = (t: { after(f: () => void): void }) => {
    const ctx = nuevoMundo(alm, politica());
    t.after(ctx.limpiar);
    const a = new ServicioAdmin({ central: ctx.m.central, actor: { rol: 'admin', usuario: 'galo' }, fuente: () => ctx.m.central.repo.ops(), cajas: ctx.m.ctx.cajasCfg.map((c) => ({ tienda: c.tienda, caja: c.caja })), inventario: ctx.m.inventarioCentral() });
    a.altaLote({ lote_id: 'L1', filas: [ENC, [24, 'BLUSA', 'BT2988', 'CAPELLA', '202610001', 349, '20261014', 'DAMA', 'PED-MAL']] });
    const item = [...catalogo(ctx.m.central.repo.ops()).values()].find((x) => x.codigo === '202610001')!;
    const existencia = () => existenciaAlmacen(ctx.m.central.repo.ops()).get(item.item_id)!;
    return { ctx, a, item, existencia };
  };

  it('CE1 se corrige la cantidad y el pedimento con motivo; la entrada original no cambia y el último registro manda', (t) => {
    const { a, item, existencia } = mundo(t);
    const entradas = a.entradasAlmacen(item.item_id).entradas;
    assert.deepEqual([entradas.length, entradas[0]!.qty, entradas[0]!.corregida], [1, 24, false]);
    const id = entradas[0]!.entrada_id;
    assert.throws(() => a.corregirEntrada({ correccion_id: 'k0', entrada_id: id, qty: 20, motivo: '  ' }), { codigo: 'DATOS_REQUERIDOS' });
    assert.throws(() => a.corregirEntrada({ correccion_id: 'k0', entrada_id: id, motivo: 'x' }), { codigo: 'DATOS_REQUERIDOS' });
    assert.throws(() => a.corregirEntrada({ correccion_id: 'k0', entrada_id: id, qty: -1, motivo: 'x' }), { codigo: 'CANTIDAD_INVALIDA' });
    assert.throws(() => a.corregirEntrada({ correccion_id: 'k0', entrada_id: id, qty: 1.5, motivo: 'x' }), { codigo: 'CANTIDAD_INVALIDA' });
    assert.throws(() => a.corregirEntrada({ correccion_id: 'k0', entrada_id: 'no-existe', qty: 1, motivo: 'x' }), { codigo: 'ENTRADA_INEXISTENTE' });
    assert.equal(existencia().existencia, 24, 'los rechazos no cambian nada');
    const r = a.corregirEntrada({ correccion_id: 'k1', entrada_id: id, qty: 20, pedimento: 'PED-BIEN', motivo: 'se contaron mal las cajas' });
    assert.equal(r.existencia, 20);
    assert.deepEqual([existencia().recibido, existencia().existencia, existencia().pedimentos], [20, 20, ['PED-BIEN']]);
    const e = a.entradasAlmacen(item.item_id).entradas[0]!;
    assert.deepEqual([e.qty, e.qty_original, e.pedimento, e.pedimento_original, e.corregida, e.motivo, e.corregida_por], [20, 24, 'PED-BIEN', 'PED-MAL', true, 'se contaron mal las cajas', 'galo']);
    // una segunda corrección reemplaza a la primera (solo cantidad: el pedimento corregido se conserva)
    a.corregirEntrada({ correccion_id: 'k2', entrada_id: id, qty: 22, motivo: 'eran 22' });
    assert.deepEqual([existencia().existencia, existencia().pedimentos], [22, ['PED-BIEN']]);
    // reintentar la misma corrección no repite nada
    const n = a.entradasAlmacen(item.item_id).entradas.length;
    a.corregirEntrada({ correccion_id: 'k2', entrada_id: id, qty: 5, motivo: 'otra vez' });
    assert.equal(existencia().existencia, 22);
    assert.equal(a.entradasAlmacen(item.item_id).entradas.length, n);
    // queda en el historial del artículo
    assert.equal(a.historialArticulo(item.item_id).eventos.filter((x: any) => x.evento === 'Corrección de una entrada al almacén').length, 2);
  });

  it('CE2 si ya se entregaron piezas y la corrección deja el almacén en negativo pide confirmación; la entrega usa la existencia corregida', (t) => {
    const { a, item, existencia } = mundo(t);
    const id = a.entradasAlmacen(item.item_id).entradas[0]!.entrada_id;
    a.entregarAlmacen({ item_id: item.item_id, destinos: { DUO: 20 }, etiqueta_precio: true, etiqueta_costura: true, ref: 'E1' }); // quedan 4
    assert.throws(() => a.corregirEntrada({ correccion_id: 'n1', entrada_id: id, qty: 10, motivo: 'eran 10' }), (e: any) => e.codigo === 'CONFIRMACION_REQUERIDA' && e.detalle.existencia === -10);
    assert.equal(existencia().existencia, 4, 'sin confirmar no se aplica');
    a.corregirEntrada({ correccion_id: 'n1', entrada_id: id, qty: 10, motivo: 'eran 10', confirmar_negativo: true });
    assert.equal(existencia().existencia, -10);
    // la entrega siguiente se compara contra la existencia corregida (excede)
    assert.throws(() => a.entregarAlmacen({ item_id: item.item_id, destinos: { LON: 1 }, etiqueta_precio: true, etiqueta_costura: true, ref: 'E2' }), { codigo: 'CONFIRMACION_REQUERIDA' });
    // corregir hacia arriba nunca pide confirmación
    a.corregirEntrada({ correccion_id: 'n2', entrada_id: id, qty: 30, motivo: 'eran 30' });
    assert.equal(existencia().existencia, -10 + 20);
  });
});
