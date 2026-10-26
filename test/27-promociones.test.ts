import assert from 'node:assert/strict';
import { it } from 'node:test';
import { ServicioAdmin } from '../src/app/servicio.ts';
import { calcularDescuentos, repartir, validarPromocion, type Promocion } from '../src/promociones.ts';
import { sha256, supervisorPorClave } from '../src/supervisores.ts';
import type { Linea } from '../src/tipos.ts';
import { renderTicketTexto, construirTicket } from '../src/ticket.ts';
import { nuevoMundo, politica, porAlmacen, servicioDe } from './ayudas/comun.ts';

const HOY = '2026-11-10';
const L = (id: string, desc: string, precio: number, qty: number, dep = 'Dama'): Linea => ({
  linea_id: id, item_id: id, item_no: id, codigo: id, descripcion: desc, marca: 'X', estilo: '', lote: '', departamento: dep, qty, precio_unit: precio, descuento: 0, importe: qty * precio,
});
const P = (o: Partial<Promocion> & Pick<Promocion, 'tipo'>): Promocion => ({ id: 'p1', nombre: 'Promo', activa: true, inicio: null, fin: null, ...o });
const dosxuno = (o: Partial<Promocion> = {}) => P({ tipo: 'nxm', id: 'n1', nombre: '2x1 blusas', lleva: 2, paga: 1, alcance: { departamentos: [], palabras: ['blusa'], item_ids: [] }, ...o });

it('PR1 sha256 y reparto en centavos exactos', () => {
  assert.equal(sha256('abc'), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  assert.deepEqual(repartir(100, [1, 1, 1]), [34, 33, 33]);
  assert.equal(repartir(1001, [333, 333, 334]).reduce((a, b) => a + b, 0), 1001);
  assert.deepEqual(repartir(0, [5, 5]), [0, 0]);
});

it('PR2 2x1: regala la pieza más barata de cada par y respeta el alcance', () => {
  const r = calcularDescuentos([L('a', 'BLUSA ROJA', 30000, 1), L('b', 'BLUSA AZUL', 20000, 1), L('c', 'PANTALON', 50000, 1)], [dosxuno()], null, HOY);
  const [a, b, c] = r.lineas;
  assert.deepEqual([a!.importe, b!.importe, c!.importe], [30000, 0, 50000]);
  assert.deepEqual(r.aplicadas, [{ promo_id: 'n1', nombre: '2x1 blusas', tipo: 'nxm', monto: 20000 }]);
  assert.equal(b!.descuento_detalle![0]!.tipo, 'promo');
  // 3 piezas = un par; 4 piezas = dos pares; la pieza suelta no cuenta
  assert.equal(calcularDescuentos([L('a', 'BLUSA', 10000, 3)], [dosxuno()], null, HOY).lineas[0]!.importe, 20000);
  assert.equal(calcularDescuentos([L('a', 'BLUSA', 10000, 4)], [dosxuno()], null, HOY).lineas[0]!.importe, 20000);
  assert.equal(calcularDescuentos([L('a', 'BLUSA', 10000, 1)], [dosxuno()], null, HOY).lineas[0]!.importe, 10000);
});

it('PR3 lleva 3 paga 2 por departamento, y por artículos elegidos', () => {
  const p = P({ tipo: 'nxm', id: 'n3', nombre: '3x2 dama', lleva: 3, paga: 2, alcance: { departamentos: ['dama'], palabras: [], item_ids: [] } });
  const r = calcularDescuentos([L('a', 'FALDA', 10000, 1), L('b', 'BLUSA', 20000, 1), L('c', 'PANTALON', 30000, 1), L('d', 'BOLSA', 99900, 1, 'Bolsos y Carteras')], [p], null, HOY);
  assert.deepEqual(r.lineas.map((l) => l.importe), [0, 20000, 30000, 99900], 'la más barata de las tres sale gratis; otro departamento no entra');
  const sel = P({ tipo: 'nxm', id: 'n4', nombre: '2x1 elegidos', lleva: 2, paga: 1, alcance: { departamentos: [], palabras: [], item_ids: ['d'] } });
  assert.equal(calcularDescuentos([L('d', 'BOLSA', 5000, 2)], [sel], null, HOY).lineas[0]!.importe, 5000);
});

it('PR4 por cada $X de compra, $Y de descuento: escalones completos', () => {
  const p = P({ tipo: 'por_cada', id: 'c1', nombre: 'Por cada $1,000 de compra, $100 menos', cada: 100000, descuenta: 10000 });
  assert.equal(calcularDescuentos([L('a', 'X', 99900, 1)], [p], null, HOY).lineas[0]!.importe, 99900, 'no llega a $1,000');
  const r = calcularDescuentos([L('a', 'X', 120000, 1), L('b', 'Y', 90000, 1)], [p], null, HOY); // $2,100 → 2 escalones = $200
  assert.equal(r.aplicadas[0]!.monto, 20000);
  assert.equal(r.lineas.reduce((a, l) => a + l.importe, 0), 190000);
});

it('PR5 vigencia: programada, vencida, inactiva y sin fecha límite', () => {
  const art = [L('a', 'BLUSA', 10000, 2)];
  const imp = (p: Promocion) => calcularDescuentos(art, [p], null, HOY).lineas[0]!.importe;
  assert.equal(imp(dosxuno({ inicio: '2026-11-10', fin: '2026-11-10' })), 10000, 'el último día y el primero cuentan');
  assert.equal(imp(dosxuno({ inicio: '2026-11-11' })), 20000, 'aún no empieza');
  assert.equal(imp(dosxuno({ fin: '2026-11-09' })), 20000, 'ya venció');
  assert.equal(imp(dosxuno({ activa: false })), 20000, 'Administración la desactivó');
  assert.equal(imp(dosxuno()), 10000, 'sin fechas: vale hasta que Administración la desactive');
});

it('PR6 cupón: % con redondeo al centavo, monto fijo, compra mínima y mensajes claros', () => {
  const pct = P({ tipo: 'cupon', id: 'k1', nombre: 'Verano', codigo: 'VERANO20', pct: 20, minimo: 50000, usos_max: null });
  const art = [L('a', 'X', 33333, 2)]; // 66,666 → 20 % = 13,333.2 → 13,333
  const r = calcularDescuentos(art, [pct], 'verano20', HOY);
  assert.deepEqual([r.cupon!.aplicado, r.cupon!.monto, r.lineas[0]!.importe], [true, 13333, 53333]);
  const bajo = calcularDescuentos([L('a', 'X', 40000, 1)], [pct], 'VERANO20', HOY);
  assert.match(bajo.cupon!.motivo!, /al menos \$500\.00/);
  assert.equal(bajo.lineas[0]!.importe, 40000);
  const monto = P({ tipo: 'cupon', id: 'k2', nombre: '$100', codigo: 'MENOS100', monto: 10000, minimo: 0 });
  assert.equal(calcularDescuentos([L('a', 'X', 5000, 1)], [monto], 'MENOS100', HOY).lineas[0]!.importe, 0, 'nunca pasa del importe');
  assert.match(calcularDescuentos(art, [pct], 'NOEXISTE', HOY).cupon!.motivo!, /no existe/);
  assert.match(calcularDescuentos(art, [{ ...pct, fin: '2026-11-01' }], 'VERANO20', HOY).cupon!.motivo!, /venció/);
  assert.match(calcularDescuentos(art, [{ ...pct, usos_max: 3 }], 'VERANO20', HOY, () => 3).cupon!.motivo!, /máximo de veces/);
  // una sola promoción o cupón por compra: gana la que más descuento da
  const dos = dosxuno(); // 2 blusas de $100: la promoción regala $100
  const cup5 = { ...pct, minimo: 0, pct: 5 }; // 5 % de $200 = $10
  const gana = calcularDescuentos([L('a', 'BLUSA', 10000, 2)], [dos, cup5], 'VERANO20', HOY);
  assert.deepEqual([gana.aplicadas.map((x) => x.promo_id), gana.cupon!.aplicado, gana.lineas[0]!.importe], [['n1'], false, 10000]);
  assert.match(gana.cupon!.motivo!, /no se combina.*2x1 blusas/);
  const cup50 = { ...pct, minimo: 0, pct: 50 }; // 50 % de $200 = $100: empata con la promoción → gana la primera de la lista
  assert.equal(calcularDescuentos([L('a', 'BLUSA', 10000, 2)], [dos, cup50], 'VERANO20', HOY).cupon!.aplicado, false);
  const cup60 = { ...pct, minimo: 0, pct: 60 };
  const cg = calcularDescuentos([L('a', 'BLUSA', 10000, 2)], [dos, cup60], 'VERANO20', HOY);
  assert.deepEqual([cg.cupon!.aplicado, cg.aplicadas.length, cg.lineas[0]!.importe], [true, 0, 8000], 'el cupón gana y no se suma la promoción');
});

it('PR6b acumulable: se repite por grupo completo; sin marcar aplica una sola vez por compra', () => {
  const paq = P({ tipo: 'paquete', id: 'q', nombre: '4 por $185', lleva: 4, precio: 18500, alcance: { departamentos: [], palabras: ['accesorio'], item_ids: [] } });
  const imp = (p: Promocion, n: number) => calcularDescuentos([L('a', 'ACCESORIO POPULAR', 5500, n)], [p], null, HOY).lineas[0]!.importe;
  assert.deepEqual([4, 8, 9, 12].map((n) => imp(paq, n)), [18500, 37000, 37000 + 5500, 55500]);
  assert.deepEqual([4, 8, 12].map((n) => imp({ ...paq, acumulable: false }, n)), [18500, 18500 + 22000, 18500 + 44000], 'sin acumular: un solo paquete');
  const dos = dosxuno({ acumulable: false });
  assert.equal(calcularDescuentos([L('a', 'BLUSA', 10000, 6)], [dos], null, HOY).lineas[0]!.importe, 50000, 'un solo par gratis');
  const pc = P({ tipo: 'por_cada', id: 'c', nombre: 'Por cada $500, $50', cada: 50000, descuenta: 5000 });
  const tot = (p: Promocion, precio: number) => calcularDescuentos([L('a', 'X', precio, 1)], [p], null, HOY).lineas[0]!.importe;
  assert.deepEqual([49900, 50000, 265000].map((x) => tot(pc, x)), [49900, 45000, 240000], '$2,650 → 5 escalones = $250 menos');
  assert.deepEqual([49900, 50000, 265000].map((x) => tot({ ...pc, acumulable: false }, x)), [49900, 45000, 260000], 'sin acumular: $50 una sola vez');
  const v = validarPromocion({ ...paq, tiendas: ['DUO'], acumulable: false }, [], ['DUO']);
  assert.equal(v.ok && v.promo.acumulable, false);
  const v2 = validarPromocion({ ...paq, tiendas: ['DUO'] }, [], ['DUO']);
  assert.equal(v2.ok && v2.promo.acumulable, true);
});

it('PR7 validación: tipos, fechas, códigos y alcance', () => {
  const v = (p: Promocion, otras: Promocion[] = []) => validarPromocion({ tiendas: ['DUO'], ...p }, otras, ['DUO', 'LON']);
  assert.equal(v(dosxuno()).ok, true);
  assert.equal(v(dosxuno({ paga: 2 })).ok, false);
  assert.equal(v(dosxuno({ alcance: { departamentos: [], palabras: [], item_ids: [] } })).ok, false);
  assert.equal(v(dosxuno({ inicio: '2026-12-01', fin: '2026-11-01' })).ok, false);
  assert.equal(v(dosxuno({ inicio: '2026-02-31' })).ok, false);
  assert.equal(v(P({ tipo: 'por_cada', cada: 1000, descuenta: 1000 })).ok, false);
  const cup = P({ tipo: 'cupon', id: 'k', nombre: 'C', codigo: ' verano 20 ', pct: 10 });
  const ok = v(cup);
  assert.equal(ok.ok && ok.promo.codigo, 'VERANO20');
  assert.equal(v(P({ ...cup, id: 'otro' }), [{ ...cup, codigo: 'VERANO20' }]).ok, false, 'código repetido');
  assert.equal(v(P({ ...cup, pct: 10, monto: 500 })).ok, false);
  assert.equal(v(P({ ...cup, pct: 101 })).ok, false);
  assert.equal(v(dosxuno({ tiendas: [] })).ok, false, 'hay que elegir tienda');
  assert.equal(v(dosxuno({ tiendas: ['XYZ'] })).ok, false);
  assert.equal(v(P({ tipo: 'paquete', id: 'q', nombre: 'Paquete', lleva: 4, precio: 18500, alcance: { departamentos: [], palabras: [], item_ids: ['a'] } })).ok, true);
  assert.equal(v(P({ tipo: 'paquete', id: 'q', nombre: 'Paquete', lleva: 1, precio: 18500, alcance: { departamentos: [], palabras: [], item_ids: ['a'] } })).ok, false);
  assert.equal(v(P({ ...cup, codigo: 'AB' })).ok, false);
});

porAlmacen('Promociones, cupones y descuentos con clave de supervisor en la caja', (alm) => {
  const admin = (ctx: ReturnType<typeof nuevoMundo>) => new ServicioAdmin({ central: ctx.m.central, actor: { rol: 'admin', usuario: 'galo' }, fuente: () => ctx.m.central.repo.ops(), cajas: [{ tienda: 'DUO', caja: 1 }, { tienda: 'LON', caja: 1 }] });

  it('PR8 Administración crea promociones y cupones; llegan a las cajas; solo una por compra', async (t) => {
    const ctx = nuevoMundo(alm, politica());
    t.after(ctx.limpiar);
    const a = admin(ctx);
    const jeans = a.guardarPromocion({ id: '', tipo: 'nxm', nombre: '2x1 jeans', activa: true, tiendas: ['DUO', 'LON'], inicio: null, fin: null, lleva: 2, paga: 1, alcance: { departamentos: [], palabras: ['jeans'], item_ids: [] } }).guardada;
    a.guardarPromocion({ id: '', tipo: 'cupon', nombre: 'Cupón 10 %', activa: true, tiendas: ['DUO', 'LON'], inicio: null, fin: null, codigo: 'diez', pct: 10, minimo: 0, usos_max: 1 });
    assert.throws(() => a.guardarPromocion({ id: '', tipo: 'cupon', nombre: 'Otro', activa: true, tiendas: ['DUO'], inicio: null, fin: null, codigo: 'DIEZ', pct: 5 }), { codigo: 'PROMOCION_INVALIDA' });
    assert.throws(() => a.guardarPromocion({ id: 'nada', tipo: 'nxm', nombre: 'x', activa: true, tiendas: ['DUO'], inicio: null, fin: null, lleva: 2, paga: 1, alcance: { departamentos: [], palabras: ['x'], item_ids: [] } }), { codigo: 'NO_ENCONTRADO' });
    assert.throws(() => a.guardarPromocion({ id: '', tipo: 'nxm', nombre: 'sin tienda', activa: true, tiendas: [], inicio: null, fin: null, lleva: 2, paga: 1, alcance: { departamentos: [], palabras: ['x'], item_ids: [] } }), { codigo: 'PROMOCION_INVALIDA' });
    ctx.m.pump();
    const s = servicioDe(ctx, 'DUO', 1);
    const cart = s.svc.nuevaVenta();
    s.svc.escanear(cart, '0002026090782'); // JEANS $899
    const v = s.svc.escanear(cart, '0002026090799') as any; // JEANS $899 (otro lote)
    assert.deepEqual([v.carrito.total, v.carrito.descuentos, v.carrito.promos.map((p: any) => p.nombre)], [89900, 89900, ['2x1 jeans']], 'la segunda pieza sale gratis');
    // el cupón de 10 % ($179.80) da MENOS que el 2x1 ($899): no se combinan y gana la promoción
    assert.throws(() => s.svc.aplicarCupon(cart, 'DIEZ'), (e: any) => e.codigo === 'CUPON_NO_APLICA' && /no se combina.*2x1 jeans/.test(e.message));
    assert.equal(s.svc.vista(cart).cupon, null);
    assert.throws(() => s.svc.aplicarCupon(cart, 'NOEXISTE'), { codigo: 'CUPON_NO_APLICA' });
    // sin la promoción, el cupón aplica
    a.guardarPromocion({ ...jeans!, activa: false });
    ctx.m.pump();
    const k = s.svc.aplicarCupon(cart, 'DIEZ');
    assert.deepEqual([k.cupon.monto, k.carrito.total, k.carrito.promos.length], [17980, 161820, 0]);
    s.svc.quitarCupon(cart);
    assert.equal(s.svc.vista(cart).total, 179800);
    s.svc.aplicarCupon(cart, 'DIEZ');
    // cobrar: el ticket explica el descuento
    const venta = await s.svc.cobrarEfectivo(cart, 200000, 0);
    assert.equal(venta.venta.total, 161820);
    const txt = renderTicketTexto(construirTicket(venta.venta));
    assert.match(txt, /Cupón Cupón 10 % +-\$89\.90/);
    assert.match(txt, /TOTAL +\$1,618\.20/);
    // usos_max = 1: el cupón ya no vale otra vez
    const cart2 = s.svc.nuevaVenta();
    s.svc.escanear(cart2, '7501234567890');
    assert.throws(() => s.svc.aplicarCupon(cart2, 'DIEZ'), (e: any) => /máximo de veces/.test(e.message));
    // reactivar la promoción: la siguiente venta la lleva sola
    ctx.m.pump(); ctx.m.pump();
    a.guardarPromocion({ ...jeans!, activa: true });
    ctx.m.pump();
    const cart3 = s.svc.nuevaVenta();
    s.svc.escanear(cart3, '0002026090782');
    assert.equal((s.svc.escanear(cart3, '0002026090799') as any).carrito.total, 89900);
    assert.equal(a.promociones().promociones.find((p) => p.id === jeans!.id)!.usos, 0, 'la venta con cupón no cuenta como uso de la promoción');
  });

  it('PR8b cada tienda tiene sus promociones y cupones: lo de London no vale en DÚO y viceversa', async (t) => {
    const ctx = nuevoMundo(alm, politica());
    t.after(ctx.limpiar);
    const a = admin(ctx);
    a.guardarPromocion({ id: '', tipo: 'nxm', nombre: '2x1 jeans London', activa: true, tiendas: ['LON'], inicio: null, fin: null, lleva: 2, paga: 1, alcance: { departamentos: [], palabras: ['jeans'], item_ids: [] } });
    a.guardarPromocion({ id: '', tipo: 'cupon', nombre: 'Cupón London', activa: true, tiendas: ['LON'], inicio: null, fin: null, codigo: 'LONDON10', pct: 10 });
    a.guardarPromocion({ id: '', tipo: 'cupon', nombre: 'Cupón DÚO', activa: true, tiendas: ['DUO'], inicio: null, fin: null, codigo: 'DUO10', pct: 10 });
    ctx.m.pump();
    const venta = (tienda: string) => { const s = servicioDe(ctx, tienda, 1); const c = s.svc.nuevaVenta(); s.svc.escanear(c, '0002026090782'); s.svc.escanear(c, '0002026090799'); return { s, c }; };
    const d = venta('DUO');
    assert.equal(d.s.svc.vista(d.c).total, 179800, 'la promoción de London no aplica en DÚO');
    assert.throws(() => d.s.svc.aplicarCupon(d.c, 'LONDON10'), (e: any) => /no es válido en esta tienda/.test(e.message));
    assert.equal(d.s.svc.aplicarCupon(d.c, 'DUO10').cupon.aplicado, true);
    const l = venta('LON');
    assert.equal(l.s.svc.vista(l.c).total, 89900, 'en London sí');
    assert.throws(() => l.s.svc.aplicarCupon(l.c, 'DUO10'), (e: any) => /no es válido en esta tienda/.test(e.message));
  });

  it('PR8c paquete a precio fijo: «lleva 4 por $185» en un artículo elegido (accesorio popular de $55)', async (t) => {
    const ctx = nuevoMundo(alm, politica());
    t.after(ctx.limpiar);
    const a = admin(ctx);
    const art = a.buscarArticulos('mascada').articulos[0]!; // MASCADA $120 en el catálogo de prueba
    assert.equal(a.buscarArticulos('7501234567890').articulos[0]!.item_id, art.item_id, 'también se busca por código');
    assert.deepEqual(a.buscarArticulos('zzz').articulos, []);
    a.guardarPromocion({ id: '', tipo: 'paquete', nombre: 'Accesorio popular: 4 por $185', activa: true, tiendas: ['DUO', 'LON'], inicio: null, fin: null, lleva: 4, precio: 18500, alcance: { departamentos: [], palabras: [], item_ids: [art.item_id] } });
    const prom = a.promociones();
    assert.equal(prom.articulos[art.item_id]!.descripcion, 'MASCADA');
    ctx.m.pump();
    const s = servicioDe(ctx, 'DUO', 1);
    const total = (n: number) => { const c = s.svc.nuevaVenta(); const e = s.svc.escanear(c, '7501234567890') as any; if (n > 1) s.svc.cambiarCantidad(c, e.linea.linea_id, n); return s.svc.vista(c); };
    // 4 × $120 = $480 → $185 (paquete); 5 piezas = un paquete + 1 suelta; 8 = dos paquetes; 3 no completan
    assert.deepEqual([3, 4, 5, 8].map((n) => total(n).total), [36000, 18500, 18500 + 12000, 37000]);
    assert.equal(total(4).promos[0]!.nombre, 'Accesorio popular: 4 por $185');
  });

  it('PR8d el nombre de cada tienda es editable y se usa en el ticket, la pantalla y la imagen del cupón', async (t) => {
    const ctx = nuevoMundo(alm, politica());
    t.after(ctx.limpiar);
    const a = admin(ctx);
    assert.deepEqual(a.tiendasInfo().map((x) => [x.tienda, x.nombre]), [['DUO', 'DÚO New York'], ['LON', 'London Love']]);
    assert.throws(() => a.guardarNombreTienda('DUO', '  '), { codigo: 'TIENDA_INVALIDA' });
    assert.throws(() => a.guardarNombreTienda('XYZ', 'Otra'), { codigo: 'TIENDA_INVALIDA' });
    a.guardarNombreTienda('LON', '  London   Love Outlet ');
    ctx.m.pump();
    assert.equal(a.tiendasInfo()[1]!.nombre, 'London Love Outlet');
    const s = servicioDe(ctx, 'LON', 1);
    assert.equal(s.svc.estado().negocio, 'London Love Outlet');
    const c = s.svc.nuevaVenta();
    s.svc.escanear(c, '7501234567890');
    const v = await s.svc.cobrarEfectivo(c, 20000, 0);
    assert.match(v.ticket_texto, /London Love Outlet/);
    assert.equal(servicioDe(ctx, 'DUO', 1).svc.estado().negocio, 'DÚO New York', 'la otra tienda no cambia');
  });

  it('PR9 la promoción se recalcula al cambiar cantidades, y una venta cancelada no cuenta como uso del cupón', async (t) => {
    const ctx = nuevoMundo(alm, politica());
    t.after(ctx.limpiar);
    const a = admin(ctx);
    a.guardarPromocion({ id: '', tipo: 'por_cada', nombre: 'Por cada $1,000, $100', activa: true, tiendas: ['DUO', 'LON'], inicio: null, fin: null, cada: 100000, descuenta: 10000 });
    a.guardarPromocion({ id: '', tipo: 'cupon', nombre: 'Único', activa: true, tiendas: ['DUO', 'LON'], inicio: null, fin: null, codigo: 'UNICO', monto: 5000, minimo: 0, usos_max: 1 });
    ctx.m.pump();
    const s = servicioDe(ctx, 'DUO', 1);
    const cart = s.svc.nuevaVenta();
    const esc = s.svc.escanear(cart, '0002026090782') as any; // $899: no llega a $1,000
    assert.equal(esc.carrito.total, 89900);
    const l = esc.linea.linea_id;
    assert.equal(s.svc.cambiarCantidad(cart, l, 2).total, 169800, '$1,798 → un escalón de $100');
    assert.equal(s.svc.cambiarCantidad(cart, l, 1).total, 89900, 'baja de cantidad: se quita el descuento');
    s.svc.aplicarCupon(cart, 'UNICO');
    const venta = await s.svc.cobrarEfectivo(cart, 100000, 0);
    assert.equal(venta.venta.total, 84900);
    s.svc.cancelarVenta(venta.venta.sale_id, 'prueba');
    const cart2 = s.svc.nuevaVenta();
    s.svc.escanear(cart2, '7501234567890');
    assert.equal(s.svc.aplicarCupon(cart2, 'UNICO').cupon.aplicado, true, 'la venta cancelada liberó el cupón');
  });

  it('PR10 descuento manual: solo con la clave de un supervisor, sin tope, y queda anotado quién lo autorizó', async (t) => {
    const ctx = nuevoMundo(alm, politica());
    t.after(ctx.limpiar);
    const a = admin(ctx);
    assert.throws(() => a.guardarSupervisor({ nombre: 'Ana', clave: '12' }), { codigo: 'SUPERVISOR_INVALIDO' });
    assert.throws(() => a.guardarSupervisor({ nombre: '', clave: '1234' }), { codigo: 'SUPERVISOR_INVALIDO' });
    a.guardarSupervisor({ nombre: 'Ana Supervisora', clave: '4321' });
    a.guardarSupervisor({ nombre: 'Otra', clave: '4321' }); // la misma clave se permite: avisar «ya está usada» revelaría la clave de otra persona
    const lista = a.supervisores().supervisores;
    assert.deepEqual(lista.map((x) => [x.nombre, x.activo]), [['Ana Supervisora', true], ['Otra', true]]);
    assert.equal(JSON.stringify(lista).includes('4321'), false, 'la clave no sale nunca de Administración');
    const opsSup = ctx.m.central.repo.ops().filter((o) => o.tipo === 'supervisor.guardado');
    assert.ok(opsSup.every((o) => !('clave' in o.payload) && /^[0-9a-f]{64}$/.test(o.payload.hash) && o.payload.hash !== '4321'), 'ni se guarda en claro: solo sal y hash');
    ctx.m.pump();
    const s = servicioDe(ctx, 'DUO', 1);
    const cart = s.svc.nuevaVenta();
    const esc = s.svc.escanear(cart, '0002026090782') as any; // $899
    s.svc.escanear(cart, '7501234567890'); // $120
    const lin = esc.linea.linea_id;
    assert.throws(() => s.svc.aplicarDescuento(cart, { linea_id: lin, tipo: 'pct', valor: 10 }, '0000'), { codigo: 'CLAVE_INVALIDA' });
    assert.throws(() => s.svc.aplicarDescuento(cart, { linea_id: lin, tipo: 'pct', valor: 10 }, ''), { codigo: 'CLAVE_INVALIDA' });
    assert.throws(() => s.svc.aplicarDescuento(cart, { linea_id: lin, tipo: 'pct', valor: 101 }, '4321'), { codigo: 'DESCUENTO_INVALIDO' });
    const r = s.svc.aplicarDescuento(cart, { linea_id: lin, tipo: 'pct', valor: 10 }, '4321');
    assert.deepEqual([r.supervisor, r.carrito.total], ['Ana Supervisora', 80910 + 12000]);
    // reemplaza el descuento anterior de la línea; sobre toda la venta se reparte sin perder un centavo
    const todo = s.svc.aplicarDescuento(cart, { tipo: 'monto', valor: 10001 }, '4321');
    assert.equal(todo.carrito.descuentos, 10001);
    assert.equal(todo.carrito.lineas.reduce((x: number, l: any) => x + l.descuento, 0), 10001);
    s.svc.quitarDescuento(cart);
    assert.equal(s.svc.vista(cart).descuentos, 0);
    // 100 %: la venta queda registrada sin cobro
    s.svc.aplicarDescuento(cart, { tipo: 'pct', valor: 100 }, '4321');
    assert.equal(s.svc.vista(cart).total, 0);
    const venta = await s.svc.cobrarEfectivo(cart, 0, 0);
    assert.deepEqual([venta.venta.total, venta.venta.pagos.length, venta.venta.lineas.every((l) => l.descuento_detalle![0]!.nombre.includes('Ana Supervisora'))], [0, 0, true]);
    assert.equal(venta.venta.folio, 1);
    // un supervisor desactivado ya no autoriza (tras sincronizar)
    a.guardarSupervisor({ id: lista[0]!.id, activo: false });
    a.guardarSupervisor({ id: lista[1]!.id, activo: false }); // también «Otra», que comparte la misma clave
    ctx.m.pump();
    const c2 = s.svc.nuevaVenta();
    const e2 = s.svc.escanear(c2, '7501234567890') as any;
    assert.throws(() => s.svc.aplicarDescuento(c2, { linea_id: e2.linea.linea_id, tipo: 'pct', valor: 5 }, '4321'), { codigo: 'CLAVE_INVALIDA' });
    assert.equal(supervisorPorClave([], '4321'), null);
  });
});
