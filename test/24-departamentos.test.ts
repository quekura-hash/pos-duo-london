import assert from 'node:assert/strict';
import { it } from 'node:test';
import { ServicioAdmin } from '../src/app/servicio.ts';
import {
  aplicarDepartamentos, DEPARTAMENTOS_BASE, DEPTO_ENVOLTURAS, DEPTO_SIN_CLASIFICAR, esEnvoltura, normalizarDepto, resolverDepartamento,
} from '../src/departamentos.ts';
import { leerInventario } from '../src/inventario.ts';
import { catalogo, departamentos } from '../src/proyecciones.ts';
import { nuevoMundo, politica, porAlmacen } from './ayudas/comun.ts';

const nombres = DEPARTAMENTOS_BASE.map((d) => d.nombre);

it('D1 el catálogo inicial ya no tiene Zapatos ni Niños, renombra Bolsos y Carteras y agrega Envolturas', () => {
  assert.ok(!nombres.some((n) => /zapato|ni(ñ|n)os/i.test(n)));
  assert.ok(nombres.includes('Bolsos y Carteras') && !nombres.includes('Bolsas y Equipaje'));
  assert.ok(nombres.includes(DEPTO_ENVOLTURAS) && nombres.includes(DEPTO_SIN_CLASIFICAR));
});

it('D2 resolución: exacto, alias, descontinuado, parecido, desconocido y vacío', () => {
  const r = (t: string) => resolverDepartamento(t);
  assert.deepEqual([r('Dama Plus').estado, r('MUJER  plus').estado, r('MUJER plus').propuesto], ['exacto', 'alias', 'Dama Plus']);
  assert.equal(r('ACCESORIO').propuesto, 'Accesorios');
  assert.equal(r('NOCHE').propuesto, 'Vestidos de noche');
  assert.deepEqual([r('Bolsas y Equipaje').estado, r('Bolsas y Equipaje').propuesto], ['alias', 'Bolsos y Carteras']);
  for (const t of ['Zapatos', 'NIÑOS', 'ninos']) assert.deepEqual([r(t).estado, r(t).propuesto], ['descontinuado', DEPTO_SIN_CLASIFICAR]);
  const p = r('Damma plus');
  assert.deepEqual([p.estado, p.propuesto], ['sugerido', 'Dama Plus']);
  assert.ok(p.sugerencias.length >= 1);
  assert.deepEqual([r('LEVIS').estado, r('LEVIS').propuesto, r('2024-05-01').estado], ['desconocido', DEPTO_SIN_CLASIFICAR, 'desconocido']);
  assert.deepEqual([r('').estado, r('  ').propuesto], ['vacio', DEPTO_SIN_CLASIFICAR]);
  assert.equal(normalizarDepto('  Cosméticos   y-Perfumes '), 'cosmeticos y perfumes');
});

it('D3 regla de envolturas: bolsas y cajas de regalo; no tarjetas ni bolsos', () => {
  assert.ok(esEnvoltura({ descripcion: 'BOLSA DE REGALO MEDIANA' }));
  assert.ok(esEnvoltura({ descripcion: 'caja regalo grande' }));
  assert.ok(esEnvoltura({ descripcion: 'GIFT BAG' }));
  assert.ok(!esEnvoltura({ descripcion: 'TARJETA DE REGALO' }));
  assert.ok(!esEnvoltura({ descripcion: 'BOLSA PIEL NEGRA' }));
});

it('D4 aplicar: decisiones del usuario, sugerencia por omisión y regla de envolturas (se puede apagar)', () => {
  const arts = [
    { departamento: 'mujer plus', descripcion: 'BLUSA', fila_origen: 2 },
    { departamento: 'Damma plus', descripcion: 'FALDA', fila_origen: 3 },
    { departamento: 'LEVIS', descripcion: 'PLAYERA', fila_origen: 4 },
    { departamento: 'Zapatos', descripcion: 'BOTA', fila_origen: 5 },
    { departamento: 'ACCESORIO', descripcion: 'BOLSA DE REGALO', fila_origen: 6 },
  ];
  const a = aplicarDepartamentos(arts, DEPARTAMENTOS_BASE, { decisiones: { levis: 'Caballero' } });
  assert.deepEqual(a.articulos.map((x) => x.departamento), ['Dama Plus', 'Dama Plus', 'Caballero', DEPTO_SIN_CLASIFICAR, DEPTO_ENVOLTURAS]);
  assert.equal(a.porEnvoltura, 1);
  const b = aplicarDepartamentos(arts, DEPARTAMENTOS_BASE, { reglaEnvolturas: false });
  assert.equal(b.articulos[4]!.departamento, 'Accesorios');
  assert.deepEqual(aplicarDepartamentos(arts, DEPARTAMENTOS_BASE, { decisiones: { levis: 'No existe' } }).sinDestino, ['No existe']);
});

it('D5 la lectura del archivo agrupa los departamentos distintos y cuenta envolturas', () => {
  const filas = [
    ['Item Number', 'Item Name', 'Item Description', 'UPC', 'Regular Price', 'Department Name'],
    [1, 'BLUSA', 'a', '001', 100, 'Mujer Plus'], [2, 'BLUSA', 'b', '002', 100, 'mujer plus'], [3, 'BOLSA DE REGALO', 'c', '003', 20, 'Bolsas'],
    [4, 'BOTA', 'd', '004', 300, 'ZAPATOS'], [5, 'X', 'e', '005', 10, 'Damma Plus'],
  ];
  const r = leerInventario(filas);
  const g = Object.fromEntries(r.departamentos.map((x) => [x.clave, x]));
  assert.equal(g['mujer plus']!.articulos, 2);
  assert.equal(g['zapatos']!.estado, 'descontinuado');
  assert.equal(g['damma plus']!.estado, 'sugerido');
  assert.equal(r.envolturas, 1);
  assert.ok(r.departamentos[0]!.estado !== 'alias', 'lo que requiere revisión va primero');
});

porAlmacen('Administración de departamentos: alta, edición y propagación', (alm) => {
  const admin = (ctx: ReturnType<typeof nuevoMundo>) => new ServicioAdmin({ central: ctx.m.central, actor: { rol: 'admin', usuario: 'galo' }, fuente: () => ctx.m.central.repo.ops(), cajas: [{ tienda: 'DUO', caja: 1 }] });

  it('D6 alta y edición: se propaga a cajas, renombra artículos y valida repetidos', (t) => {
    const ctx = nuevoMundo(alm, politica());
    t.after(ctx.limpiar);
    const a = admin(ctx);
    const lista0 = a.departamentos().departamentos;
    assert.equal(lista0.length, DEPARTAMENTOS_BASE.length);
    // alta
    const nuevo = a.guardarDepartamento({ nombre: '  Hogar   y cocina ', alias: ['hogar'] });
    const h = nuevo.departamentos.find((d) => d.id === 'hogar-y-cocina')!;
    assert.deepEqual([h.nombre, h.activo, h.alias], ['Hogar y cocina', true, ['hogar']]);
    // repetidos y vacíos
    assert.throws(() => a.guardarDepartamento({ nombre: 'DAMA' }), { codigo: 'DEPARTAMENTO_INVALIDO' });
    assert.throws(() => a.guardarDepartamento({ nombre: 'Otro', alias: ['Mujer'] }), { codigo: 'DEPARTAMENTO_INVALIDO' });
    assert.throws(() => a.guardarDepartamento({ nombre: ' ' }), { codigo: 'DEPARTAMENTO_INVALIDO' });
    assert.throws(() => a.guardarDepartamento({ id: 'nada', nombre: 'x' }), { codigo: 'NO_ENCONTRADO' });
    assert.throws(() => a.guardarDepartamento({ id: 'sin-clasificar', activo: false }), { codigo: 'DEPARTAMENTO_INVALIDO' });
    // renombrar un departamento al que pertenecen artículos: los artículos lo siguen, en central y en las cajas
    const art = ctx.m.caja('DUO', 1).altaArticulo({ codigo: 'D-0001', marca: 'X', descripcion: 'CAMISA', estilo: '', lote: '', departamento: 'Caballero', precio: 10000 });
    ctx.m.pump();
    assert.equal(a.departamentos().departamentos.find((d) => d.id === 'caballero')!.articulos, 1);
    a.guardarDepartamento({ id: 'caballero', nombre: 'Caballero y Joven' });
    ctx.m.pump();
    assert.equal(catalogo(ctx.m.central.repo.ops()).get(art.item_id)!.departamento, 'Caballero y Joven');
    assert.equal(ctx.m.caja('LON', 1).buscar('Joven').some((x) => x.item_id === art.item_id), true, 'la búsqueda por departamento sigue el nuevo nombre');
    assert.equal(ctx.m.caja('DUO', 1).buscar('caballero y joven').some((x) => x.item_id === art.item_id), true);
    const d = a.departamentos().departamentos;
    assert.deepEqual([d.find((x) => x.id === 'caballero')!.nombre, d.find((x) => x.id === 'caballero')!.articulos], ['Caballero y Joven', 1]);
    // desactivar y alias
    a.guardarDepartamento({ id: 'hogar-y-cocina', activo: false, alias: ['hogar', 'cocina'] });
    const h2 = a.departamentos().departamentos.find((d) => d.id === 'hogar-y-cocina')!;
    assert.deepEqual([h2.activo, h2.alias], [false, ['hogar', 'cocina']]);
    // la caja ve el mismo catálogo tras sincronizar
    ctx.m.pump();
    for (const [tienda, n] of [['DUO', 1], ['LON', 1]] as const) {
      const lista = departamentos(ctx.m.caja(tienda, n).repo.ops());
      assert.equal(lista.find((x) => x.id === 'caballero')!.nombre, 'Caballero y Joven', `${tienda} recibió el cambio`);
      assert.equal(lista.find((x) => x.id === 'hogar-y-cocina')!.activo, false);
    }
  });
});
