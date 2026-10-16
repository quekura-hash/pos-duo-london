import assert from 'node:assert/strict';
import { it } from 'node:test';
import { detectar } from '../src/incidencias.ts';
import { catalogo, stock, ventas } from '../src/proyecciones.ts';
import type { Politicas } from '../src/politicas.ts';
import { nuevoMundo, politica, porAlmacen, type Ctx } from './ayudas/comun.ts';

const ESTRATEGIAS: Politicas['P07_item_no'][] = ['a_central', 'b_bloques', 'c_espacios'];
const nuevo = (codigo: string, extra: object = {}) => ({
  codigo, marca: 'NUEVA', descripcion: 'BLUSA', estilo: 'B-77', lote: '20261016', departamento: 'DAMA', precio: 25000, existencia_inicial: 10, ...extra,
});

function aislar(ctx: Ctx, tienda: string, n: number) {
  ctx.m.cortarLan(tienda, n);
  ctx.m.cortarInternet(tienda);
}
function reconectar(ctx: Ctx, tienda: string, n: number) {
  ctx.m.restablecerLan(tienda, n);
  ctx.m.restablecerInternet(tienda);
  ctx.m.pump();
  ctx.m.pump();
}

for (const estrategia of ESTRATEGIAS) {
  porAlmacen(`Alta y venta de artículo nuevo SIN internet — Item # estrategia ${estrategia} (ensayo, no aprobada)`, (alm) => {
    it(`A1 se crea y vende offline y conserva su identidad al sincronizar [${estrategia}]`, (t) => {
      const ctx = nuevoMundo(alm, politica({ P07_item_no: estrategia }));
      t.after(ctx.limpiar);
      const { m } = ctx;
      const c = m.caja('DUO', 2);
      if (estrategia === 'b_bloques') c.altaArticulo(nuevo('7500000000001')); // el bloque se obtiene con conexión
      m.pump();
      aislar(ctx, 'DUO', 2); // Caja 2 sin LAN ni internet

      const art = c.altaArticulo(nuevo('7500000000123'));
      assert.ok(art.item_id.length > 10);
      assert.equal(art.codigo, '7500000000123');
      if (estrategia === 'a_central') assert.equal(art.item_no, null, 'pendiente de asignar, sin inventar un número');
      if (estrategia === 'b_bloques') assert.match(art.item_no!, /^100\d$/);
      if (estrategia === 'c_espacios') assert.equal(art.item_no, 'DUO2-1');
      // existencia inicial = movimiento trazable
      const mov = c.ops().find((o) => o.tipo === 'inv.movement' && o.payload.item_id === art.item_id)!;
      assert.equal(mov.payload.tipo, 'existencia_inicial');
      assert.equal(c.stockLocal(art.item_id), 10);

      // se vende offline sin importar que su Item # esté pendiente
      const cart = c.abrirCarrito();
      const l = c.agregarLinea(cart, { codigo: art.codigo, qty: 2 });
      const v = c.cobrar(cart, [{ metodo: 'efectivo', monto: l.importe }]);
      assert.equal(v.lineas[0]!.item_id, art.item_id);
      assert.equal(c.stockLocal(art.item_id), 8);

      reconectar(ctx, 'DUO', 2);
      // identidad intacta en TODOS los nodos
      for (const ops of [m.central.repo.ops(), m.hub('DUO').repo.ops(), m.hub('LON').repo.ops(), m.caja('DUO', 1).ops(), m.caja('LON', 2).ops()]) {
        const a = catalogo(ops).get(art.item_id)!;
        assert.ok(a, 'el artículo llegó');
        assert.equal(a.codigo, '7500000000123');
        assert.equal(a.marca, 'NUEVA');
      }
      assert.equal(m.caja('DUO', 1).stockLocal(art.item_id), 8, 'la otra caja de la tienda ve el inventario del artículo nuevo');
      assert.equal(stock(m.caja('LON', 1).ops(), 'LON').get(art.item_id) ?? 0, 0, 'London no recibe existencias de DÚO');
      assert.equal(ventas(m.central.repo.ops()).get(v.sale_id)!.lineas[0]!.item_id, art.item_id, 'el ticket sigue apuntando al mismo item_id');
      assert.deepEqual(detectar(m.central.repo.ops()).filter((i) => i.tipo === 'codigo_duplicado' || i.tipo === 'item_no_duplicado'), []);

      const final = catalogo(m.central.repo.ops()).get(art.item_id)!;
      if (estrategia === 'a_central') {
        assert.equal(final.item_no, '1005', 'asignado por el central en orden de llegada, sin saltos (seed termina en 1004)');
        assert.equal(catalogo(m.caja('DUO', 2).ops()).get(art.item_id)!.item_no, '1005', 'la caja de origen aprende su Item #');
        assert.equal(catalogo(m.caja('LON', 1).ops()).get(art.item_id)!.item_no, '1005');
      } else {
        assert.equal(final.item_no, art.item_no, 'el Item # nunca cambia al sincronizar');
      }
    });

    it(`A2 el catálogo sembrado conserva Item # originales y la numeración no los toca [${estrategia}]`, (t) => {
      const ctx = nuevoMundo(alm, politica({ P07_item_no: estrategia }));
      t.after(ctx.limpiar);
      const c = ctx.m.caja('DUO', 1);
      c.altaArticulo(nuevo('7500000000200'));
      ctx.m.pump();
      const cat = catalogo(ctx.m.central.repo.ops());
      assert.deepEqual(ctx.items.map((i) => cat.get(i.item_id)!.item_no), ['1001', '1002', '1003', '1004']);
    });
  });
}

porAlmacen('Item # — consecuencias propias de cada estrategia (hallazgos)', (alm) => {
  it('H1 (a) varias altas offline reciben consecutivos SIN saltos, en orden de llegada al central', (t) => {
    const ctx = nuevoMundo(alm, politica({ P07_item_no: 'a_central' }));
    t.after(ctx.limpiar);
    aislar(ctx, 'DUO', 2);
    ctx.m.cortarInternet('LON');
    const a = ctx.m.caja('DUO', 2).altaArticulo(nuevo('7500000000301'));
    const b = ctx.m.caja('DUO', 2).altaArticulo(nuevo('7500000000302'));
    const c = ctx.m.caja('LON', 1).altaArticulo(nuevo('7500000000303'));
    ctx.m.restablecerInternet('LON');
    ctx.m.restablecerLan('DUO', 2);
    ctx.m.restablecerInternet('DUO');
    ctx.m.pump();
    ctx.m.pump();
    const nums = [a, b, c].map((x) => Number(catalogo(ctx.m.central.repo.ops()).get(x.item_id)!.item_no));
    const orden = [...nums].sort((x, y) => x - y);
    assert.deepEqual(orden, [1005, 1006, 1007], 'sin saltos');
  });

  it('H2 (a) mientras no hay internet el artículo existe y vende, pero su Item # sigue "pendiente"', (t) => {
    const ctx = nuevoMundo(alm, politica({ P07_item_no: 'a_central' }));
    t.after(ctx.limpiar);
    ctx.m.cortarInternet('DUO');
    const art = ctx.m.caja('DUO', 2).altaArticulo(nuevo('7500000000401'));
    ctx.m.pump();
    assert.equal(catalogo(ctx.m.caja('DUO', 1).ops()).get(art.item_id)!.item_no, null, 'visible en la otra caja por LAN, sin número');
    assert.equal(catalogo(ctx.m.central.repo.ops()).get(art.item_id), undefined);
  });

  it('H3 (b) los bloques dejan SALTOS en el consecutivo; sin bloque y sin red no se pueden dar altas', (t) => {
    const ctx = nuevoMundo(alm, politica({ P07_item_no: 'b_bloques', K_item_no: 5 }));
    t.after(ctx.limpiar);
    const x = ctx.m.caja('DUO', 1).altaArticulo(nuevo('7500000000501')); // bloque 1005..1009, usa 1005
    const y = ctx.m.caja('LON', 1).altaArticulo(nuevo('7500000000502')); // bloque 1010..1014, usa 1010
    assert.equal(x.item_no, '1005');
    assert.equal(y.item_no, '1010');
    const usados = new Set([1001, 1002, 1003, 1004, 1005, 1010]);
    const saltos = []; for (let n = 1001; n <= 1010; n++) if (!usados.has(n)) saltos.push(n);
    assert.deepEqual(saltos, [1006, 1007, 1008, 1009], 'saltos reales: requieren aprobación del propietario');
    // caja sin bloque y aislada: no puede dar de alta
    aislar(ctx, 'DUO', 2);
    assert.throws(() => ctx.m.caja('DUO', 2).altaArticulo(nuevo('7500000000503')), { codigo: 'ITEMNO_BLOQUEADO' });
  });

  it('H4 (c) cada caja numera en su propio espacio, consecutivo y sin coordinación', (t) => {
    const ctx = nuevoMundo(alm, politica({ P07_item_no: 'c_espacios' }));
    t.after(ctx.limpiar);
    aislar(ctx, 'DUO', 2);
    const a1 = ctx.m.caja('DUO', 2).altaArticulo(nuevo('7500000000601'));
    const a2 = ctx.m.caja('DUO', 2).altaArticulo(nuevo('7500000000602'));
    const b1 = ctx.m.caja('DUO', 1).altaArticulo(nuevo('7500000000603'));
    assert.deepEqual([a1.item_no, a2.item_no, b1.item_no], ['DUO2-1', 'DUO2-2', 'DUO1-1']);
    reconectar(ctx, 'DUO', 2);
    assert.deepEqual(detectar(ctx.m.central.repo.ops()).filter((i) => i.tipo === 'item_no_duplicado'), []);
  });

  it('H5 pérdida de disco: (a) y (b) no pueden reutilizar Item #; (c) queda bloqueada hasta resolverlo', (t) => {
    for (const est of ESTRATEGIAS) {
      const ctx = nuevoMundo(alm, politica({ P07_item_no: est }));
      try {
        const c = ctx.m.caja('DUO', 1);
        const primero = c.altaArticulo(nuevo('7500000000701'));
        ctx.m.pump();
        ctx.m.perderDiscoCaja('DUO', 1);
        ctx.m.rehidratarCaja('DUO', 1);
        const nueva = ctx.m.caja('DUO', 1);
        if (est === 'c_espacios') {
          assert.throws(() => nueva.altaArticulo(nuevo('7500000000702')), { codigo: 'ITEMNO_BLOQUEADO' });
          nueva.atestarItemNoLocal(2); // resolución humana tras revisar
          assert.equal(nueva.altaArticulo(nuevo('7500000000702')).item_no, 'DUO1-2');
        } else {
          const segundo = nueva.altaArticulo(nuevo('7500000000702'));
          ctx.m.pump();
          ctx.m.pump();
          if (est === 'a_central') assert.equal(catalogo(ctx.m.central.repo.ops()).get(segundo.item_id)!.item_no, '1006');
          else assert.notEqual(segundo.item_no, primero.item_no);
        }
        assert.deepEqual(detectar(ctx.m.central.repo.ops()).filter((i) => i.tipo === 'item_no_duplicado'), [], est);
      } finally {
        ctx.limpiar();
      }
    }
  });
});

porAlmacen('Identidad por código: sin fusiones', (alm) => {
  it('D1 el mismo código creado sin conexión en dos tiendas NO se fusiona: se conservan ambos y se reporta', (t) => {
    const ctx = nuevoMundo(alm, politica({ P07_item_no: 'a_central' }));
    t.after(ctx.limpiar);
    aislar(ctx, 'DUO', 2);
    ctx.m.cortarInternet('LON');
    const duo = ctx.m.caja('DUO', 2).altaArticulo(nuevo('7509999999999', { marca: 'DUOMARCA' }));
    const lon = ctx.m.caja('LON', 1).altaArticulo(nuevo('7509999999999', { marca: 'LONMARCA' }));
    ctx.m.restablecerLan('DUO', 2);
    ctx.m.restablecerInternet('DUO');
    ctx.m.restablecerInternet('LON');
    ctx.m.pump();
    ctx.m.pump();
    const cat = catalogo(ctx.m.central.repo.ops());
    assert.ok(cat.has(duo.item_id) && cat.has(lon.item_id), 'ambos registros siguen existiendo');
    assert.notEqual(duo.item_id, lon.item_id);
    const inc = detectar(ctx.m.central.repo.ops()).find((i) => i.tipo === 'codigo_duplicado')!;
    assert.deepEqual([...(inc.item_ids as string[])].sort(), [duo.item_id, lon.item_id].sort());
    // al escanear ese código el POS no adivina: pide elegir
    const c = ctx.m.caja('DUO', 1);
    const cart = c.abrirCarrito();
    assert.throws(() => c.agregarLinea(cart, { codigo: '7509999999999', qty: 1 }), { codigo: 'CODIGO_AMBIGUO' });
    assert.doesNotThrow(() => c.agregarLinea(cart, { item_id: duo.item_id, qty: 1 }));
  });

  it('D2 misma marca, estilo y descripción con código distinto son artículos distintos', (t) => {
    const ctx = nuevoMundo(alm, politica());
    t.after(ctx.limpiar);
    const [a, b] = ctx.items;
    assert.deepEqual([a!.marca, a!.estilo, a!.descripcion], [b!.marca, b!.estilo, b!.descripcion]);
    ctx.m.pump();
    const cat = catalogo(ctx.m.central.repo.ops());
    assert.equal(cat.size, 4);
    assert.notEqual(cat.get(a!.item_id)!.codigo, cat.get(b!.item_id)!.codigo);
    assert.notEqual(cat.get(a!.item_id)!.lote, cat.get(b!.item_id)!.lote);
  });

  it('D3 dar de alta un código que ya existe localmente se rechaza (no se duplica ni se fusiona)', (t) => {
    const ctx = nuevoMundo(alm, politica());
    t.after(ctx.limpiar);
    assert.throws(() => ctx.m.caja('DUO', 1).altaArticulo(nuevo('0002026090782')), { codigo: 'CODIGO_EXISTE' });
  });

  it('D4 el alta no pierde la operación en curso (carrito)', (t) => {
    const ctx = nuevoMundo(alm, politica());
    t.after(ctx.limpiar);
    const c = ctx.m.caja('DUO', 1);
    const cart = c.abrirCarrito();
    c.agregarLinea(cart, { item_id: ctx.items[2]!.item_id, qty: 2 });
    const art = c.altaArticulo(nuevo('7500000000801'));
    c.agregarLinea(cart, { item_id: art.item_id, qty: 1 });
    assert.equal(c.carrito(cart).lineas.length, 2);
    const total = c.carrito(cart).lineas.reduce((a, l) => a + l.importe, 0);
    assert.equal(c.cobrar(cart, [{ metodo: 'efectivo', monto: total }]).folio, 1);
  });

  it('D5 editar precio solo en el ticket no cambia el catálogo', (t) => {
    const ctx = nuevoMundo(alm, politica());
    t.after(ctx.limpiar);
    const c = ctx.m.caja('DUO', 1);
    const cart = c.abrirCarrito();
    const l = c.agregarLinea(cart, { item_id: ctx.items[2]!.item_id, qty: 1, precio_unit: 9900 });
    assert.equal(l.precio_unit, 9900);
    c.cobrar(cart, [{ metodo: 'efectivo', monto: 9900 }]);
    assert.equal(catalogo(c.ops()).get(ctx.items[2]!.item_id)!.precio, 12000);
  });
});
