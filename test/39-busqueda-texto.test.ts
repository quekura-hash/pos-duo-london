import assert from 'node:assert/strict';
import { it } from 'node:test';
import { nuevoMundo, politica, porAlmacen, servicioDe } from './ayudas/comun.ts';

porAlmacen('Búsqueda por texto en la venta', (alm) => {
  const catalogo = (t: { after(f: () => void): void }) => {
    const ctx = nuevoMundo(alm, politica(), false);
    t.after(ctx.limpiar);
    // 60 pantimedias viejas (de $50 a $109) y, al final, las nuevas de $189; más una cosa que solo contiene la palabra
    const arts = Array.from({ length: 60 }, (_, i) => ({ codigo: `7000000${String(i).padStart(5, '0')}`, item_no: String(1000 + i), marca: 'MARCA', descripcion: `PANTIMEDIAS TIPO ${i}`, estilo: '', lote: '', departamento: 'DAMA', precio: 5000 + i * 100 }));
    arts.push({ codigo: '0002026102126', item_no: '9000', marca: '', descripcion: 'PANTIMEDIAS', estilo: '', lote: '', departamento: 'DAMA', precio: 18900 });
    arts.push({ codigo: '7000000099999', item_no: '9001', marca: '', descripcion: 'CAJA PARA PANTIMEDIAS', estilo: '', lote: '', departamento: 'DAMA', precio: 3000 });
    ctx.m.sembrar(arts, arts.map(() => ({ DUO: 1 })));
    return ctx;
  };

  it('BT1 el artículo reciente sale entre los primeros: empieza con lo escrito y, a igual relevancia, el Item # más alto primero', (t) => {
    const s = servicioDe(catalogo(t), 'DUO', 1, 'Ana');
    const r = s.svc.buscarConTotal('pantimedia');
    assert.equal(r.total, 62);
    assert.equal(r.resultados.length, 20);
    assert.equal(r.resultados[0]!.item_no, '9000', 'las pantimedias nuevas van primero');
    assert.ok(!r.resultados.some((x) => x.item_no === '9001'), 'lo que solo contiene la palabra va al final');
    // «mostrar más»
    assert.equal(s.svc.buscarConTotal('pantimedia', 62).resultados.at(-1)!.item_no, '9001');
  });

  it('BT2 varias palabras en cualquier orden y el precio en pesos acotan la búsqueda', (t) => {
    const s = servicioDe(catalogo(t), 'DUO', 1, 'Ana');
    assert.deepEqual(s.svc.buscar('pantimedias 189').map((x) => x.item_no), ['9000']);
    assert.deepEqual(s.svc.buscar('189 pantimedias').map((x) => x.item_no), ['9000']);
    assert.deepEqual(s.svc.buscar('189.00').map((x) => x.item_no), ['9000']);
    assert.deepEqual(s.svc.buscar('caja pantimedias').map((x) => x.item_no), ['9001'], 'cualquier orden');
    assert.equal(s.svc.buscarConTotal('pantimedias tipo 7').resultados.some((x) => x.descripcion === 'PANTIMEDIAS TIPO 7'), true);
    assert.equal(s.svc.buscar('pantimedias 9999').length, 0);
  });
});
