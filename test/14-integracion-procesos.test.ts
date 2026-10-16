import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { ventasPorCaja } from '../src/consultas.ts';
import { detectar } from '../src/incidencias.ts';
import { stock, ventas } from '../src/proyecciones.ts';
import { crearEntorno, ErrorRemoto } from './ayudas/procesos.ts';

const admin = { rol: 'admin' as const, usuario: 'galo' };
const sinSaldoNegativo = (ops: any[], item: string) => (stock(ops, 'DUO').get(item) ?? 0) >= 0;

describe('[procesos reales — hub + 2 cajas, SQLite persistente, HTTP en 127.0.0.1]', { timeout: 180_000 }, () => {
  it('X1 arranque: venta en Caja 2 llega al hub y se refleja en Caja 1 por el hub; las series son independientes', async (t) => {
    const e = await crearEntorno({ politicas: { P02_existencia_insuficiente: 'permitir_y_conciliar' } });
    t.after(() => e.limpiar());
    const masc = e.items[0]!.item_id;
    const a = await e.c2.carrito(masc, 2);
    const v2 = await e.c2.cobrarEfectivo(a.cart, a.importe);
    const b = await e.c1.carrito(masc, 1);
    const v1 = await e.c1.cobrarEfectivo(b.cart, b.importe);
    assert.deepEqual([v2.folio, v1.folio], [1, 1]);
    for (let i = 0; i < 2; i++) { await e.c1.sync(); await e.c2.sync(); }
    assert.equal(await e.c1.cmd('stockLocal', masc), 497);
    assert.equal(await e.c2.cmd('stockLocal', masc), 497);
    const ops = await e.hub.ops();
    assert.equal(ventas(ops).size, 2);
  });

  it('X2 ventas simultáneas desde dos procesos: folios consecutivos por caja, sin duplicados, inventario exacto', async (t) => {
    const e = await crearEntorno();
    t.after(() => e.limpiar());
    const masc = e.items[0]!.item_id;
    const N = 12;
    const prep1 = await Promise.all(Array.from({ length: N }, () => e.c1.carrito(masc, 1)));
    const prep2 = await Promise.all(Array.from({ length: N }, () => e.c2.carrito(masc, 2)));
    // las 24 ventas se disparan a la vez desde ambos procesos
    const r = await Promise.all([
      ...prep1.map((p) => e.c1.cobrarEfectivo(p.cart, p.importe)),
      ...prep2.map((p) => e.c2.cobrarEfectivo(p.cart, p.importe)),
    ]);
    const f1 = r.slice(0, N).map((v) => v.folio).sort((x, y) => x - y);
    const f2 = r.slice(N).map((v) => v.folio).sort((x, y) => x - y);
    assert.deepEqual(f1, Array.from({ length: N }, (_, i) => i + 1));
    assert.deepEqual(f2, Array.from({ length: N }, (_, i) => i + 1));
    for (let i = 0; i < 2; i++) { assert.ok((await e.c1.sync()).ok); assert.ok((await e.c2.sync()).ok); }
    const ops = await e.hub.ops();
    assert.equal(ventas(ops).size, 2 * N);
    assert.equal(stock(ops, 'DUO').get(masc), 500 - N * 1 - N * 2);
    assert.equal(await e.c1.cmd('stockLocal', masc), 500 - N * 3);
    assert.equal(await e.c2.cmd('stockLocal', masc), 500 - N * 3);
    assert.deepEqual(detectar(ops).filter((i) => i.tipo.startsWith('folio')), []);
    // reportes sobre lo recibido en el hub: cada caja conserva su serie original
    const f = ventasPorCaja(admin, ops, { cajas: [{ tienda: 'DUO', caja: 2 }] }).map((x) => x.folio);
    assert.deepEqual(f, Array.from({ length: N }, (_, i) => i + 1));
  });

  it('X3 arbitraje: la última pieza solicitada a la vez por dos procesos se concede UNA vez (P-02=bloquear), en 8 rondas', async (t) => {
    const e = await crearEntorno({ politicas: { P02_existencia_insuficiente: 'bloquear' }, itemsExtra: 8 });
    t.after(() => e.limpiar());
    const unicos = e.items.slice(1);
    let ganadas1 = 0;
    let ganadas2 = 0;
    for (const it of unicos) {
      const p1 = await e.c1.carrito(it.item_id, 1);
      const p2 = await e.c2.carrito(it.item_id, 1);
      const res = await Promise.allSettled([e.c1.cobrarEfectivo(p1.cart, p1.importe), e.c2.cobrarEfectivo(p2.cart, p2.importe)]);
      const ok = res.filter((r) => r.status === 'fulfilled').length;
      const rech = res.filter((r) => r.status === 'rejected') as PromiseRejectedResult[];
      assert.equal(ok, 1, `ronda ${it.item_id}: exactamente una venta`);
      assert.equal(rech.length, 1);
      assert.equal((rech[0]!.reason as ErrorRemoto).codigo, 'SIN_EXISTENCIA');
      if (res[0]!.status === 'fulfilled') ganadas1++; else ganadas2++;
    }
    for (let i = 0; i < 2; i++) { await e.c1.sync(); await e.c2.sync(); }
    const ops = await e.hub.ops();
    for (const it of unicos) assert.equal(stock(ops, 'DUO').get(it.item_id), 0, 'sin saldo negativo');
    assert.equal(ventas(ops).size, 8);
    // la venta rechazada no consumió folio: las series no tienen huecos
    const f1 = ventasPorCaja(admin, ops, { cajas: [{ tienda: 'DUO', caja: 1 }] }).map((x) => x.folio);
    const f2 = ventasPorCaja(admin, ops, { cajas: [{ tienda: 'DUO', caja: 2 }] }).map((x) => x.folio);
    assert.deepEqual(f1, Array.from({ length: ganadas1 }, (_, i) => i + 1));
    assert.deepEqual(f2, Array.from({ length: ganadas2 }, (_, i) => i + 1));
    assert.deepEqual((await e.hub.reservas()), [], 'todas las reservas se cerraron con sus movimientos');
  });

  it('X4 P-02=permitir_y_conciliar: ambas ventas proceden, una recibe aviso de sobreventa, queda −1 señalado', async (t) => {
    const e = await crearEntorno({ politicas: { P02_existencia_insuficiente: 'permitir_y_conciliar' }, itemsExtra: 4 });
    t.after(() => e.limpiar());
    for (const it of e.items.slice(1)) {
      const p1 = await e.c1.carrito(it.item_id, 1);
      const p2 = await e.c2.carrito(it.item_id, 1);
      const [a, b] = await Promise.all([e.c1.cobrarEfectivo(p1.cart, p1.importe), e.c2.cobrarEfectivo(p2.cart, p2.importe)]);
      const avisos = [a, b].filter((v) => v.avisos?.length);
      assert.equal(avisos.length, 1, 'el hub avisa solo a la que llegó segunda');
      assert.deepEqual(avisos[0].avisos, [`sobreventa:${it.item_id}`]);
    }
    for (let i = 0; i < 2; i++) { await e.c1.sync(); await e.c2.sync(); }
    const ops = await e.hub.ops();
    assert.equal(detectar(ops).filter((i) => i.tipo === 'stock_negativo').length, 4);
    assert.equal(ventas(ops).size, 8, 'ninguna venta se perdió');
  });

  it('X5 reintentos: respuestas perdidas del hub y doble envío del mismo cobro no duplican nada', async (t) => {
    const e = await crearEntorno();
    t.after(() => e.limpiar());
    const masc = e.items[0]!.item_id;
    const p = await e.c1.carrito(masc, 2);
    // el mismo cobro llega dos veces al mismo tiempo (doble clic)
    const [x, y] = await Promise.all([e.c1.cobrarEfectivo(p.cart, p.importe), e.c1.cobrarEfectivo(p.cart, p.importe)]);
    assert.deepEqual([x.folio, y.folio], [1, 1]);
    // el hub procesa los envíos pero la respuesta se pierde las 3 primeras veces
    await e.hub.fallas({ descartarRespuestas: 3 });
    const intentos: boolean[] = [];
    for (let i = 0; i < 6; i++) intentos.push((await e.c1.sync()).ok);
    assert.ok(intentos.includes(false), 'hubo fallos de sincronización reales');
    assert.equal(intentos.at(-1), true, 'terminó convergiendo');
    const ops = await e.hub.ops();
    assert.equal(ops.filter((o) => o.tipo === 'sale.confirmed').length, 1);
    assert.equal(ops.filter((o) => o.tipo === 'inv.movement' && o.payload.tipo === 'venta').length, 1);
    assert.equal(stock(ops, 'DUO').get(masc), 498);
    assert.equal((await e.c1.cmd<any>('estadoFolios')).ultimo, 1);
  });

  it('X6 desconexión REAL (hub muerto con kill -9), P-01=vender_autonomo_con_aviso: venden aisladas y convergen al volver', async (t) => {
    const e = await crearEntorno({ politicas: { P01_hub_no_disponible: 'vender_autonomo_con_aviso', P02_existencia_insuficiente: 'permitir_y_conciliar' }, itemsExtra: 1 });
    t.after(() => e.limpiar());
    const ultima = e.items[1]!.item_id;
    const masc = e.items[0]!.item_id;
    await e.hub.matar();
    const p1 = await e.c1.carrito(ultima, 1);
    const p2 = await e.c2.carrito(ultima, 1);
    const q = await e.c1.carrito(masc, 1);
    const [a, b, c] = await Promise.all([e.c1.cobrarEfectivo(p1.cart, p1.importe), e.c2.cobrarEfectivo(p2.cart, p2.importe), e.c1.cobrarEfectivo(q.cart, q.importe)]);
    assert.deepEqual([a.folio, c.folio].sort(), [1, 2]);
    assert.equal(b.folio, 1);
    assert.equal((await e.c1.sync()).ok, false, 'sin hub no hay sincronización');
    await e.hub.arrancar(); // mismo archivo SQLite, mismo puerto
    for (let i = 0; i < 2; i++) { assert.ok((await e.c1.sync()).ok); assert.ok((await e.c2.sync()).ok); }
    const ops = await e.hub.ops();
    assert.equal(ventas(ops).size, 3, 'las 3 ventas hechas durante la caída llegaron');
    assert.equal(stock(ops, 'DUO').get(ultima), -1, 'sobreventa por aislamiento: señalada, no perdida');
    assert.ok(detectar(ops).some((i) => i.tipo === 'stock_negativo'));
    assert.equal(await e.c1.cmd('stockLocal', ultima), -1);
    assert.equal(await e.c2.cmd('stockLocal', ultima), -1);
  });

  it('X7 desconexión REAL con P-01=bloquear_ventas_nuevas: no vende, conserva el carrito y completa cuando el hub vuelve', async (t) => {
    const e = await crearEntorno({ politicas: { P01_hub_no_disponible: 'bloquear_ventas_nuevas' } });
    t.after(() => e.limpiar());
    const masc = e.items[0]!.item_id;
    const p = await e.c2.carrito(masc, 1);
    await e.hub.matar();
    await assert.rejects(e.c2.cobrarEfectivo(p.cart, p.importe), (err: ErrorRemoto) => err.codigo === 'VENTA_BLOQUEADA');
    assert.equal((await e.c2.cmd<any>('estadoFolios')).ultimo, 0);
    await e.hub.arrancar();
    assert.equal((await e.c2.cobrarEfectivo(p.cart, p.importe)).folio, 1);
  });

  it('X8 el hub reiniciado conserva sus reservas (SQLite) y las huérfanas vencen por vigencia técnica', async (t) => {
    const e = await crearEntorno({ politicas: { P02_existencia_insuficiente: 'bloquear' }, itemsExtra: 1, ttlReservaMs: 1200 });
    t.after(() => e.limpiar());
    const ultima = e.items[1]!.item_id;
    // una caja "muere" después de reservar (se simula reservando directamente en el hub)
    assert.deepEqual(await e.hub.rpc('reservar', 'huerfana', 1, [{ item_id: ultima, qty: 1 }]), { ok: true });
    await e.hub.reiniciar(); // kill -9 del hub
    assert.equal((await e.hub.reservas()).length, 1, 'la reserva sobrevivió al reinicio del hub');
    const p = await e.c2.carrito(ultima, 1);
    await assert.rejects(e.c2.cobrarEfectivo(p.cart, p.importe), (err: ErrorRemoto) => err.codigo === 'SIN_EXISTENCIA');
    await new Promise((r) => setTimeout(r, 1400));
    assert.equal((await e.c2.cobrarEfectivo(p.cart, p.importe)).folio, 1, 'vencida la reserva huérfana, la pieza vuelve a estar disponible');
  });

  it('X9 reinicio abrupto de una caja (kill -9): folio, carrito y cola pendiente sobreviven; reenvío sin duplicar', async (t) => {
    const e = await crearEntorno();
    t.after(() => e.limpiar());
    const masc = e.items[0]!.item_id;
    await e.c1.desconectar(true); // la venta se guarda localmente y queda pendiente
    const a = await e.c1.carrito(masc, 2);
    assert.equal((await e.c1.cobrarEfectivo(a.cart, a.importe)).folio, 1);
    const abierto = await e.c1.carrito(masc, 1); // carrito en curso al momento de la caída
    await e.c1.reiniciar(); // SIGKILL + nuevo proceso sobre el mismo archivo
    assert.equal((await e.c1.cmd<any>('estadoFolios')).ultimo, 1);
    assert.deepEqual(await e.c1.cmd('carritosAbiertos'), [abierto.cart]);
    assert.equal((await e.c1.cobrarEfectivo(abierto.cart, abierto.importe)).folio, 2, 'el folio continúa');
    for (let i = 0; i < 3; i++) await e.c1.sync();
    const ops = await e.hub.ops();
    assert.equal(ventas(ops).size, 2);
    assert.equal(stock(ops, 'DUO').get(masc), 497);
    assert.deepEqual(detectar(ops).filter((i) => i.tipo.startsWith('folio')), []);
  });

  it('X10 partición de una sola caja (interruptor, no red real): converge sin pérdida al reconectar', async (t) => {
    const e = await crearEntorno({ politicas: { P02_existencia_insuficiente: 'permitir_y_conciliar' } });
    t.after(() => e.limpiar());
    const masc = e.items[0]!.item_id;
    await e.c2.desconectar(true);
    const a = await e.c1.carrito(masc, 1);
    const b = await e.c2.carrito(masc, 1);
    await e.c1.cobrarEfectivo(a.cart, a.importe);
    await e.c2.cobrarEfectivo(b.cart, b.importe);
    assert.equal(await e.c2.cmd('stockLocal', masc), 499, 'aislada: solo ve lo suyo');
    await e.c2.desconectar(false);
    for (let i = 0; i < 3; i++) { await e.c1.sync(); await e.c2.sync(); }
    assert.equal(await e.c1.cmd('stockLocal', masc), 498);
    assert.equal(await e.c2.cmd('stockLocal', masc), 498);
  });

  it('X11 el techo de folios concedido por el hub real persiste a su reinicio', async (t) => {
    const e = await crearEntorno({ politicas: { P06_huecos_de_folio: 'aceptados', K_folios: 6 } });
    t.after(() => e.limpiar());
    await e.c1.cmd('iniciarArrendamiento');
    assert.equal((await e.c1.cmd<any>('estadoFolios')).techo, 6);
    await e.hub.reiniciar();
    const anclas = await e.hub.rpc('anclas', 1);
    assert.equal(anclas.ceiling, 6);
    const masc = e.items[0]!.item_id;
    const p = await e.c1.carrito(masc, 1);
    assert.equal((await e.c1.cobrarEfectivo(p.cart, p.importe)).folio, 1);
  });
});
void sinSaldoNegativo;
