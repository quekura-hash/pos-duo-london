import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { it } from 'node:test';
import { api, appAdmin, appCajero } from './ayudas/app.ts';
import { nuevoMundo, politica, porAlmacen } from './ayudas/comun.ts';
import { detalleDeVenta, validarDatosClienta } from '../src/detalle-venta.ts';

const CLIENTA = { nombre: 'Ana López', telefono: '653 123 4567' };

porAlmacen('Historial: detalle de venta, «Revertir venta» y datos de la clienta en cambios y cancelaciones', (alm) => {
  const preparar = async (t: { after(f: () => void): void }) => {
    const ctx = nuevoMundo(alm, politica());
    t.after(ctx.limpiar);
    const adm = await appAdmin(ctx); t.after(() => adm.cerrar());
    const caja = await appCajero(ctx, 'DUO', 1, 'Ana'); t.after(() => caja.cerrar());
    await api(adm.url, '/api/admin/administradores', { nombre: 'Edgardo', clave: 'clave-segura', clave_caja: '2468' });
    await api(adm.url, '/api/admin/cajeros', { nombre: 'Lupe', clave: '4321' });
    await api(adm.url, '/api/admin/cajeros', { nombre: 'Rosa', clave: '8765' });
    ctx.m.pump(); ctx.m.pump(); ctx.m.pump();
    await api(caja.url, '/api/login', { usuario: 'Lupe', clave: '4321' });
    return { ctx, adm, caja };
  };
  const vender = async (caja: any, codigo = '0002026090782') => {
    const cart = (await api(caja.url, '/api/venta/nueva', {})).json.cart;
    await api(caja.url, '/api/venta/escanear', { cart, codigo });
    return (await api(caja.url, '/api/venta/cobrar-efectivo', { cart, recibido: 5000000 })).json.venta;
  };
  const impresos = (caja: any) => readdirSync(caja.s.impresora.dir).filter((f) => f.endsWith('.txt')).sort().map((f) => ({ f, texto: readFileSync(join(caja.s.impresora.dir, f), 'utf8') }));

  it('HD1 el detalle de la venta trae hora, cajera, prendas, pagos y qué se puede hacer con ella', async (t) => {
    const { caja } = await preparar(t);
    const v = await vender(caja);
    const r = await api(caja.url, `/api/venta/detalle?sale_id=${v.sale_id}`);
    assert.equal(r.status, 200);
    const d = r.json.detalle;
    assert.deepEqual([d.folio, d.cajero, d.estado, d.total, d.cancelable, d.con_piezas_disponibles], [v.folio, 'Lupe', 'confirmada', 89900, true, true]);
    assert.match(d.hora, /^\d\d:\d\d$/);
    assert.equal(d.lineas.length, 1);
    assert.equal(d.lineas[0].devuelto, 0);
    assert.deepEqual(d.pagos.map((p: any) => p.metodo), ['efectivo']);
    assert.match(r.json.ticket_texto, /Folio: 000001/);
    assert.equal((await api(caja.url, '/api/venta/detalle?sale_id=no-existe')).status >= 400, true);
  });

  it('HD2 Revertir venta exige nombre, teléfono y motivo, y la clave de OTRA persona; imprime VENTA CANCELADA y el comprobante de firma', async (t) => {
    const { caja } = await preparar(t);
    const v = await vender(caja);
    const revertir = (extra: object) => api(caja.url, '/api/venta/cancelar', { sale_id: v.sale_id, ...extra });
    const auth = { nombre: 'Rosa', clave: '8765' };
    assert.equal((await revertir({ motivo: 'error', autoriza: auth })).json.error.codigo, 'DATOS_REQUERIDOS', 'sin clienta');
    assert.match((await revertir({ motivo: 'error', clienta: { nombre: 'A', telefono: '6531234567' }, autoriza: auth })).json.error.mensaje, /nombre/);
    assert.match((await revertir({ motivo: 'error', clienta: { nombre: 'Ana', telefono: '123' }, autoriza: auth })).json.error.mensaje, /teléfono/);
    assert.match((await revertir({ clienta: CLIENTA, autoriza: auth })).json.error.mensaje, /motivo/);
    assert.equal((await revertir({ motivo: 'error', clienta: CLIENTA })).json.error.codigo, 'AUTORIZACION_REQUERIDA');
    assert.equal((await revertir({ motivo: 'error', clienta: CLIENTA, autoriza: { nombre: 'Lupe', clave: '4321' } })).json.error.codigo, 'AUTORIZADOR_INVALIDO', 'no se autoriza a sí misma');
    assert.equal(impresos(caja).filter((x) => /cancelacion/.test(x.f)).length, 0, 'nada se imprime mientras falle algo');

    const antes = impresos(caja).length;
    const ok = await revertir({ motivo: 'no le gustó', clienta: CLIENTA, autoriza: auth });
    assert.equal(ok.status, 200);
    assert.equal(ok.json.venta.estado, 'cancelada');
    assert.deepEqual([ok.json.impresion.ok, ok.json.impresion_firma.ok], [true, true]);
    const nuevos = impresos(caja).slice(antes);
    assert.equal(nuevos.length, 2, 'dos tickets: el de la clienta y el de la firma');
    const [cliente, firma] = nuevos.map((x) => x.texto);
    assert.match(cliente!, /VENTA CANCELADA[\s\S]*Venta cancelada: D1-000001[\s\S]*TOTAL DEVUELTO +\$899\.00[\s\S]*Motivo: no le gustó[\s\S]*Autorizó: Rosa/);
    assert.match(firma!, /VENTA CANCELADA[\s\S]*COPIA PARA LA TIENDA[\s\S]*Clienta: Ana López[\s\S]*Teléfono: 653 123 4567[\s\S]*Motivo: no le gustó[\s\S]*Recibí devolución por \$899\.00 de:[\s\S]*Nombre y firma de la clienta/);
    // repetirlo no vuelve a imprimir
    const otra = await revertir({ motivo: 'otra vez', clienta: CLIENTA, autoriza: auth });
    assert.equal(otra.status, 200);
    assert.equal(impresos(caja).length, antes + 2);
    // el detalle muestra la cancelación con los datos de la clienta
    const d = (await api(caja.url, `/api/venta/detalle?sale_id=${v.sale_id}`)).json.detalle;
    assert.deepEqual([d.estado, d.cancelable, d.con_piezas_disponibles], ['cancelada', false, false]);
    assert.deepEqual([d.cancelacion.motivo, d.cancelacion.cancelo, d.cancelacion.autorizado_por, d.cancelacion.clienta], ['no le gustó', 'Lupe', 'Rosa', { nombre: 'Ana López', telefono: '653 123 4567' }]);
  });

  it('HD3 el cambio pide nombre, teléfono y motivo; quedan en la devolución y se imprimen SE HIZO CAMBIO y el comprobante «Recibí cambio del artículo»', async (t) => {
    const { caja } = await preparar(t);
    const v = await vender(caja, '7501234567890'); // mascada $120
    const cart = (await api(caja.url, '/api/venta/nueva', {})).json.cart;
    const renglones = [{ linea_id: v.lineas[0].linea_id, qty: 1 }];
    assert.equal((await api(caja.url, '/api/venta/cambio/iniciar', { cart, sale_id: v.sale_id, renglones })).json.error.codigo, 'DATOS_REQUERIDOS');
    const ini = await api(caja.url, '/api/venta/cambio/iniciar', { cart, sale_id: v.sale_id, renglones, clienta: CLIENTA, motivo: 'talla incorrecta' });
    assert.equal(ini.status, 200);
    await api(caja.url, '/api/venta/escanear', { cart, codigo: '0000000000017' }); // bolsa $450
    const antes = impresos(caja).length;
    const p = await api(caja.url, '/api/venta/cobrar-efectivo', { cart, recibido: 40000 });
    assert.equal(p.status, 200);
    assert.deepEqual([p.json.impresion_cambio.ok, p.json.impresion_firma.ok], [true, true]);
    const nuevos = impresos(caja).slice(antes).map((x) => x.texto);
    assert.equal(nuevos.length, 3, 'ticket de la venta, ticket CAMBIO y comprobante de firma');
    assert.match(nuevos[1]!, /SE HIZO CAMBIO[\s\S]*CRÉDITO POR CAMBIO/);
    assert.match(nuevos[2]!, /SE HIZO CAMBIO[\s\S]*COPIA PARA LA TIENDA[\s\S]*Clienta: Ana López[\s\S]*Motivo: talla incorrecta[\s\S]*Recibí cambio del artículo:[\s\S]*Me llevo a cambio:[\s\S]*Nombre y firma de la clienta/);
    // el detalle de la venta original lista el cambio con la clienta y el motivo
    const d = (await api(caja.url, `/api/venta/detalle?sale_id=${v.sale_id}`)).json.detalle;
    assert.equal(d.devoluciones.length, 1);
    assert.deepEqual([d.devoluciones[0].por_cambio, d.devoluciones[0].motivo, d.devoluciones[0].clienta], [true, 'talla incorrecta', { nombre: 'Ana López', telefono: '653 123 4567' }]);
    assert.equal(d.cancelable, false, 'con un cambio ya no se cancela completa');
  });

  it('HD4 Administración consulta el historial de todas las cajas y el detalle (solo lectura)', async (t) => {
    const { ctx, adm, caja } = await preparar(t);
    const v = await vender(caja);
    ctx.m.pump(); ctx.m.pump(); ctx.m.pump();
    assert.ok((await api(adm.url, '/api/sesion')).json.nav.includes('historial'));
    const h = (await api(adm.url, '/api/admin/ventas?desde=2026-10-01&hasta=2026-10-01')).json;
    assert.equal(h.ventas.length, 1);
    assert.deepEqual([h.ventas[0].folio, h.ventas[0].tienda, h.ventas[0].caja, h.ventas[0].estado], [1, 'DUO', 1, 'confirmada']);
    assert.equal((await api(adm.url, '/api/admin/ventas?desde=2026-10-01&hasta=2026-10-01&folio=99')).json.ventas.length, 0);
    assert.equal((await api(adm.url, '/api/admin/ventas?desde=2026-10-01&hasta=2026-10-01&cajas=DUO/2')).json.ventas.length, 0, 'filtra por caja');
    const d = (await api(adm.url, `/api/admin/venta?sale_id=${v.sale_id}`)).json;
    assert.deepEqual([d.detalle.folio, d.detalle.cajero, d.detalle.lineas.length], [1, 'Lupe', 1]);
    assert.match(d.ticket_texto, /Folio: 000001/);
    assert.equal((await api(adm.url, '/api/admin/venta?sale_id=no-existe')).status >= 400, true);
    // Administración no puede operar la venta
    assert.equal((await api(adm.url, '/api/venta/cancelar', { sale_id: v.sale_id, motivo: 'x', clienta: CLIENTA })).status >= 400, true);
  });

  it('HD5 validarDatosClienta limpia espacios y rechaza datos incompletos; detalleDeVenta devuelve null si la venta no existe', () => {
    assert.deepEqual(validarDatosClienta({ clienta: { nombre: '  Ana   López ', telefono: ' 653 123 4567 ' }, motivo: '  no le   quedó ' }), { clienta: { nombre: 'Ana López', telefono: '653 123 4567' }, motivo: 'no le quedó' });
    assert.throws(() => validarDatosClienta({}), { codigo: 'DATOS_REQUERIDOS' });
    assert.equal(detalleDeVenta([], 'nada'), null);
  });
});
