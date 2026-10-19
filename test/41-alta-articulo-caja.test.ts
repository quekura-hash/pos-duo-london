import assert from 'node:assert/strict';
import { it } from 'node:test';
import { ServicioAdmin } from '../src/app/servicio.ts';
import { nuevoMundo, politica, porAlmacen, servicioDe } from './ayudas/comun.ts';

porAlmacen('Alta de un artículo desde la caja con la clave del propio cajero', (alm) => {
  const mundo = (t: { after(f: () => void): void }) => {
    const ctx = nuevoMundo(alm, politica());
    t.after(ctx.limpiar);
    const admin = new ServicioAdmin({ central: ctx.m.central, actor: { rol: 'admin', usuario: 'galo' }, fuente: () => ctx.m.central.repo.ops(), cajas: ctx.m.ctx.cajasCfg.map((c) => ({ tienda: c.tienda, caja: c.caja })), inventario: ctx.m.inventarioCentral() });
    admin.guardarCajero({ nombre: 'Ana', clave: '1234' });
    admin.guardarCajero({ nombre: 'Beto', clave: '5678' });
    ctx.m.pump(); ctx.m.pump();
    return { ctx, admin };
  };
  const datos = { codigo: '202610555', descripcion: 'PANTIMEDIAS', marca: 'DUESANG', estilo: 'DSQP', lote: '20261019', departamento: 'Dama', precio: 18900 };

  it('AA1 con la clave de la cajera se da de alta, llega al catálogo de todas las tiendas y se agrega a la venta', (t) => {
    const { ctx, admin } = mundo(t);
    const s = servicioDe(ctx, 'DUO', 1, 'Ana');
    assert.ok(s.svc.departamentosAlta().departamentos.includes('Dama'));
    const c = s.svc.nuevaVenta();
    const r = s.svc.nuevoArticulo(c, datos, '1234');
    assert.equal(r.articulo.codigo, '202610555');
    assert.equal(r.linea.descripcion, 'PANTIMEDIAS');
    assert.equal(r.linea.precio_unit, 18900);
    assert.equal(r.carrito.total, 18900);
    ctx.m.pump(); ctx.m.pump(); ctx.m.pump();
    // lo ve London (otra tienda) y Administración
    const lon = servicioDe(ctx, 'LON', 1, 'Luis');
    assert.equal((lon.svc.escanear(lon.svc.nuevaVenta(), '202610555') as any).linea.descripcion, 'PANTIMEDIAS');
    assert.equal(admin.buscarArticulos('pantimedias', 5, 0, false).articulos.some((a) => a.codigo === '202610555'), true);
    // queda quién lo dio de alta
    const aud = ctx.m.central.repo.ops().filter((o) => o.tipo === 'articulo.alta_autorizada');
    assert.deepEqual(aud.map((o) => [o.payload.cajero, o.payload.tienda, o.payload.caja]), [['Ana', 'DUO', 1]]);
  });

  it('AA2 la clave debe ser la del propio cajero: otra clave, ninguna o un cajero sin clave no dan de alta nada; 5 fallos bloquean', (t) => {
    const { ctx } = mundo(t);
    const s = servicioDe(ctx, 'DUO', 1, 'Ana');
    const c = s.svc.nuevaVenta();
    assert.throws(() => s.svc.nuevoArticulo(c, datos, '5678'), { codigo: 'CLAVE_INVALIDA' }); // la clave de Beto no vale a nombre de Ana
    assert.throws(() => s.svc.nuevoArticulo(c, datos, ''), { codigo: 'CLAVE_INVALIDA' });
    const sinClave = servicioDe(ctx, 'DUO', 2, 'Carla');
    assert.throws(() => sinClave.svc.nuevoArticulo(sinClave.svc.nuevaVenta(), datos, '1234'), { codigo: 'CAJERO_SIN_CLAVE' });
    assert.equal(ctx.m.caja('DUO', 1).buscarPorCodigo('202610555').length, 0, 'nada se creó');
    // bloqueo tras 5 claves equivocadas seguidas (ya van 2)
    for (let i = 0; i < 3; i++) assert.throws(() => s.svc.nuevoArticulo(c, datos, '0000'), { codigo: 'CLAVE_INVALIDA' });
    assert.throws(() => s.svc.nuevoArticulo(c, datos, '1234'), { codigo: 'CLAVE_BLOQUEADA' }, 'bloqueada aunque ahora sí sea la clave correcta');
    ctx.m.reloj.avanzar(5 * 60000 + 1000);
    assert.equal(s.svc.nuevoArticulo(c, datos, '1234').articulo.codigo, '202610555');
  });

  it('AA3 validaciones: código repetido (exacto o forma corta/UPC), descripción, precio y departamento', (t) => {
    const { ctx } = mundo(t);
    const s = servicioDe(ctx, 'DUO', 1, 'Ana');
    const c = s.svc.nuevaVenta();
    assert.throws(() => s.svc.nuevoArticulo(c, { ...datos, codigo: '0002026090782' }, '1234'), { codigo: 'CODIGO_EXISTE' });
    assert.throws(() => s.svc.nuevoArticulo(c, { ...datos, codigo: '202609078' }, '1234'), { codigo: 'CODIGO_EXISTE' }, 'la forma corta de un UPC que ya existe');
    assert.throws(() => s.svc.nuevoArticulo(c, { ...datos, codigo: '' }, '1234'), { codigo: 'DATOS_REQUERIDOS' });
    assert.throws(() => s.svc.nuevoArticulo(c, { ...datos, descripcion: '  ' }, '1234'), { codigo: 'DATOS_REQUERIDOS' });
    assert.throws(() => s.svc.nuevoArticulo(c, { ...datos, precio: 0 }, '1234'), { codigo: 'DATOS_REQUERIDOS' });
    assert.throws(() => s.svc.nuevoArticulo(c, { ...datos, departamento: 'Inventado' }, '1234'), { codigo: 'DATOS_REQUERIDOS' });
    assert.equal(ctx.m.central.repo.ops().filter((o) => o.tipo === 'articulo.alta_autorizada').length, 0);
  });

  it('AA4 Administración da de alta, cambia la clave, desactiva y no repite nombres; una clave nueva reemplaza a la anterior', (t) => {
    const { ctx, admin } = mundo(t);
    assert.deepEqual(admin.cajeros().cajeros.map((c) => [c.nombre, c.activo]), [['Ana', true], ['Beto', true]]);
    assert.throws(() => admin.guardarCajero({ nombre: ' ana ', clave: '1111' }), { codigo: 'CAJERO_INVALIDO' });
    assert.throws(() => admin.guardarCajero({ nombre: 'Dani', clave: '12' }), { codigo: 'CAJERO_INVALIDO' });
    assert.throws(() => admin.guardarCajero({ nombre: 'Dani' }), { codigo: 'CAJERO_INVALIDO' });
    const ana = admin.cajeros().cajeros[0]!;
    admin.guardarCajero({ id: ana.id, clave: '9999' });
    ctx.m.pump(); ctx.m.pump(); ctx.m.pump();
    const s = servicioDe(ctx, 'DUO', 1, 'Ana');
    const c = s.svc.nuevaVenta();
    assert.throws(() => s.svc.nuevoArticulo(c, datos, '1234'), { codigo: 'CLAVE_INVALIDA' });
    admin.guardarCajero({ id: ana.id, activo: false });
    ctx.m.pump(); ctx.m.pump(); ctx.m.pump();
    assert.throws(() => s.svc.nuevoArticulo(c, datos, '9999'), { codigo: 'CAJERO_SIN_CLAVE' }, 'un cajero desactivado no autoriza');
    admin.guardarCajero({ id: ana.id, activo: true });
    ctx.m.pump(); ctx.m.pump(); ctx.m.pump();
    assert.equal(s.svc.nuevoArticulo(c, datos, '9999').articulo.codigo, '202610555');
  });
});
