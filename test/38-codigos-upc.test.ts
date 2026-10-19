import assert from 'node:assert/strict';
import { it } from 'node:test';
import { claveDeEscaneo, clavesDeCatalogo, digitoVerificadorUpc } from '../src/codigos.ts';
import { revisarAlta } from '../src/almacen.ts';
import { leerInventario } from '../src/inventario.ts';
import { nuevoMundo, politica, porAlmacen, servicioDe } from './ayudas/comun.ts';

it('UPC1 dígito verificador y claves: el código corto de la etiqueta se relaciona con el UPC completo del sistema anterior', () => {
  assert.equal(digitoVerificadorUpc('00202609078'), 2, '0002026090782 del catálogo de prueba');
  assert.equal(digitoVerificadorUpc('02100140306'), 5, '0021001403065 del archivo real');
  assert.equal(digitoVerificadorUpc('00202610212'), 6);
  assert.deepEqual(clavesDeCatalogo('0002026102126'), ['2026102126', '202610212']);
  assert.deepEqual(clavesDeCatalogo('002026102126'), ['2026102126', '202610212'], 'UPC-A de 12 dígitos');
  assert.deepEqual(clavesDeCatalogo('0002026102127'), ['2026102127'], 'dígito verificador inválido: solo sin ceros');
  assert.deepEqual(clavesDeCatalogo('ABC12345678'), [], 'no numérico');
  assert.deepEqual(clavesDeCatalogo('0000000000017'), [], 'demasiado corto para buscarse por aproximación');
  assert.equal(claveDeEscaneo('202610212'), '202610212');
  assert.equal(claveDeEscaneo('0002026102126'), '2026102126');
  assert.equal(claveDeEscaneo('17'), null);
  assert.equal(claveDeEscaneo('ABC12345678'), null);
});

porAlmacen('Escaneo del código corto de la etiqueta', (alm) => {
  const conPantimedias = (t: { after(f: () => void): void }, ...extra: Parameters<ReturnType<typeof nuevoMundo>['m']['sembrar']>[0]) => {
    const ctx = nuevoMundo(alm, politica(), false);
    t.after(ctx.limpiar);
    ctx.m.sembrar([
      { codigo: '0002026102126', item_no: '2001', marca: '', descripcion: 'PANTIMEDIAS', estilo: '', lote: '', departamento: 'DAMA', precio: 18900 },
      { codigo: '7501234567890', item_no: '2002', marca: 'EFENTUS', descripcion: 'MASCADA', estilo: 'A-12', lote: '', departamento: 'ACCESORIOS', precio: 12000 },
      ...extra,
    ], [{ DUO: 5 }, { DUO: 5 }, ...extra.map(() => ({ DUO: 1 }))]);
    return ctx;
  };

  it('UPC2 escanear 202610212 encuentra el artículo guardado como UPC completo, y también por su forma completa o sin ceros', (t) => {
    const ctx = conPantimedias(t);
    const s = servicioDe(ctx, 'DUO', 1, 'Ana');
    for (const codigo of ['202610212', '0002026102126', '002026102126', '2026102126']) {
      const c = s.svc.nuevaVenta();
      const r = s.svc.escanear(c, codigo) as any;
      assert.equal(r.resultado, 'agregado', codigo);
      assert.equal(r.linea.descripcion, 'PANTIMEDIAS', codigo);
      assert.equal(r.linea.precio_unit, 18900);
    }
    // un código corto cualquiera o uno con otro dígito no se inventa
    const c = s.svc.nuevaVenta();
    assert.equal((s.svc.escanear(c, '17') as any).resultado, 'no_encontrado');
    assert.equal((s.svc.escanear(c, '202610213') as any).resultado, 'no_encontrado');
    assert.equal((s.svc.escanear(c, '75012345678') as any).resultado, 'no_encontrado');
  });

  it('UPC3 el código exacto manda: si existe un artículo con el código corto tal cual, se elige ese sin ambigüedad', (t) => {
    const ctx = conPantimedias(t, { codigo: '202610212', item_no: '2003', marca: '', descripcion: 'PANTIMEDIAS NUEVAS', estilo: '', lote: '', departamento: 'DAMA', precio: 17900 });
    const s = servicioDe(ctx, 'DUO', 1, 'Ana');
    const r = s.svc.escanear(s.svc.nuevaVenta(), '202610212') as any;
    assert.equal(r.linea.descripcion, 'PANTIMEDIAS NUEVAS');
  });

  it('UPC4 la búsqueda por texto también encuentra el código corto, y Alta Lote reconoce el artículo que ya existe con UPC completo', (t) => {
    const ctx = conPantimedias(t);
    const s = servicioDe(ctx, 'DUO', 1, 'Ana');
    const b = s.svc.buscar('202610212');
    assert.equal(b.length, 1);
    assert.equal(b[0]!.descripcion, 'PANTIMEDIAS');
    const cat = [...ctx.m.central.repo.ops().filter((o) => o.tipo === 'item.created').map((o) => ({ ...o.payload }))];
    const lectura = leerInventario([['CANTIDAD', 'DESCRIPCION', 'ESTILO', 'MARCA', 'CODIGO', 'PRECIO', 'LOTE', 'DEPARTAMENTO'], [10, 'PANTIMEDIAS', '', '', '202610212', 189, '20261021', 'DAMA']]);
    const rev = revisarAlta(lectura, cat as any, [] as any);
    assert.equal(rev.filas[0]!.estado, 'codigo_existente');
    assert.equal(rev.filas[0]!.existente?.item_no, '2001');
  });
});
