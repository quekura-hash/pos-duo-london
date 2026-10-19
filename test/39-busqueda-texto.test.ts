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

  it('BT3 más reciente = año en el código; con la misma descripción y estilo va primero el de mayor precio', (t) => {
    const ctx = nuevoMundo(alm, politica(), false);
    t.after(ctx.limpiar);
    const a = (codigo: string, estilo: string, precio: number, no: string) => ({ codigo, item_no: no, marca: 'TM EXPOSURE', descripcion: 'CAMISA TM EXPOSURE', estilo, lote: '', departamento: 'CABALLERO', precio });
    const arts = [
      a('0002021010101', '123L', 30000, '10'), // 2021, $300
      a('0002026010202', '123L', 29900, '11'), // 2026 pero más barata que la anterior de su grupo
      a('0002024010101', '123L', 35000, '12'), // 2024, $350
      a('0002026010101', '123L', 38500, '13'), // 2026, $385: la más actualizada
      a('0002023010101', '999X', 50000, '14'), // otro estilo, 2023
      { ...a('7501234567890', 'Z1', 90000, '15'), descripcion: 'CAMISA OTRA' }, // sin año en el código
    ];
    ctx.m.sembrar(arts, arts.map(() => ({ DUO: 1 })));
    const r = servicioDe(ctx, 'DUO', 1, 'Ana').svc.buscar('camisa').map((x) => x.item_no);
    assert.deepEqual(r, ['13', '12', '10', '11', '14', '15'], 'grupo 123L (2026) por precio; luego el estilo 2023; al final el que no trae año');
  });
});
