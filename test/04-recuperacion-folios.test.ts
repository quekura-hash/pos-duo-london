import assert from 'node:assert/strict';
import { it } from 'node:test';
import { detectar } from '../src/incidencias.ts';
import { ventas } from '../src/proyecciones.ts';
import { nuevoMundo, politica, porAlmacen, vender } from './ayudas/comun.ts';

const ARR = { P06_huecos_de_folio: 'aceptados' as const, K_folios: 6 };
const MANUAL = { P06_huecos_de_folio: 'no_aceptados' as const };
const atesta = { usuario: 'galo', evidencia: { tipo: 'ultimo_ticket_impreso', referencia: 'ticket DUO/1 folio 4, foto IMG-sintetica' } };

porAlmacen('Recuperación de folios: nunca reutilizar; sin evidencia, bloquear', (alm) => {
  it('R1 [P-06 aceptada] pérdida de disco con 4 ventas jamás sincronizadas: bloquea, recupera sin reutilizar y documenta el hueco', (t) => {
    const { m, items, limpiar } = nuevoMundo(alm, politica(ARR));
    t.after(limpiar);
    m.caja('DUO', 1).iniciarArrendamiento(); // techo concedido: 6
    m.cortarLan('DUO', 1); // las ventas se guardan en la caja, el hub no las recibe
    const folios = [1, 2, 3, 4].map(() => vender(m, 'DUO', 1, items[2]!.item_id).venta.folio);
    assert.deepEqual(folios, [1, 2, 3, 4]);
    assert.equal(ventas(m.hub('DUO').repo.ops()).size, 0, 'el hub nunca las recibió');

    const nueva = m.perderDiscoCaja('DUO', 1);
    assert.equal(nueva.estadoFolios().estado, 'recuperacion');
    assert.throws(() => nueva.recuperarFolios(), { codigo: 'FOLIO_BLOQUEADO' }, 'sin acceso al hub no se puede asegurar nada');

    m.restablecerLan('DUO', 1);
    m.rehidratarCaja('DUO', 1); // catálogo y existencias desde el hub (las 4 ventas perdidas NO vuelven)
    const cart = nueva.abrirCarrito();
    nueva.agregarLinea(cart, { item_id: items[2]!.item_id, qty: 1 });
    assert.throws(() => nueva.cobrar(cart, [{ metodo: 'efectivo', monto: 12000 }]), { codigo: 'FOLIO_BLOQUEADO' }, 'rehidratar no desbloquea folios');
    assert.equal(nueva.stockLocal(items[2]!.item_id), 50, 'hallazgo: existencias sobreestimadas (4 ventas perdidas) hasta un conteo físico');
    const r = nueva.recuperarFolios();
    assert.equal(r.modo, 'automatica');
    const nuevo = nueva.cobrar(cart, [{ metodo: 'efectivo', monto: 12000 }]);
    assert.ok(nuevo.folio > 4, `el folio ${nuevo.folio} no reutiliza 1..4`);
    assert.equal(nuevo.folio, 7);
    m.pump();
    const inc = detectar(m.central.repo.ops());
    assert.deepEqual(inc.filter((i) => i.tipo === 'folio_duplicado' || i.tipo === 'folio_hueco_sin_explicar'), [], 'el hueco 1..6 queda documentado');
    const gap = m.central.repo.ops().find((o) => o.tipo === 'folio.gap')!.payload;
    assert.deepEqual([gap.desde, gap.hasta], [1, 6]);
  });

  it('R2 [P-06 aceptada] sin acceso a hub ni central la emisión sigue bloqueada tras reiniciar', (t) => {
    const { m, items, limpiar } = nuevoMundo(alm, politica(ARR));
    t.after(limpiar);
    m.caja('DUO', 1).iniciarArrendamiento();
    m.cortarLan('DUO', 1);
    vender(m, 'DUO', 1, items[2]!.item_id);
    const nueva = m.perderDiscoCaja('DUO', 1);
    assert.throws(() => nueva.recuperarFolios(), { codigo: 'FOLIO_BLOQUEADO' });
    assert.equal(nueva.estadoFolios().estado, 'recuperacion');
    if (alm.nombre === 'sqlite') {
      const otra = m.reiniciarCaja('DUO', 1);
      assert.equal(otra.estadoFolios().estado, 'recuperacion', 'el bloqueo sobrevive al reinicio');
    }
  });

  it('R3 [P-06 aceptada] evidencia incompleta: si nunca hubo techo registrado no se recupera automáticamente', (t) => {
    const { m, items, limpiar } = nuevoMundo(alm, politica(ARR));
    t.after(limpiar);
    m.caerHub('DUO'); // la caja arranca sin poder pedir techo
    const c = m.caja('DUO', 1);
    assert.equal(c.estadoFolios().techo, null);
    assert.throws(() => vender(m, 'DUO', 1, items[2]!.item_id), { codigo: 'FOLIO_BLOQUEADO' }, 'con arrendamiento activo no se emite sin techo');
    m.levantarHub('DUO');
    c.iniciarArrendamiento();
    const v = vender(m, 'DUO', 1, items[2]!.item_id).venta;
    assert.equal(v.folio, 1);
    // ahora se pierde el hub Y la caja antes de que el techo llegue al central
    m.perderDiscoHub('DUO');
    const nueva = m.perderDiscoCaja('DUO', 1);
    assert.throws(() => nueva.recuperarFolios(), { codigo: 'FOLIO_BLOQUEADO', message: /no hay techo registrado/ });
    assert.equal(nueva.estadoFolios().estado, 'recuperacion');
  });

  it('R3b [P-06 aceptada] si el central recibió el techo, sobrevive a la pérdida simultánea de caja y hub', (t) => {
    const { m, items, limpiar } = nuevoMundo(alm, politica(ARR));
    t.after(limpiar);
    m.caja('DUO', 1).iniciarArrendamiento();
    m.pump(); // el techo llega al central
    m.cortarLan('DUO', 1);
    vender(m, 'DUO', 1, items[2]!.item_id);
    m.perderDiscoHub('DUO');
    const nueva = m.perderDiscoCaja('DUO', 1);
    m.restablecerLan('DUO', 1);
    const r = nueva.recuperarFolios();
    assert.equal(r.modo, 'automatica');
    assert.ok(nueva.estadoFolios().ultimo >= 6);
  });

  it('R4 [P-06 NO aceptada] no hay recuperación automática; la atestación manual exige evidencia y supera lo conocido', (t) => {
    const { m, items, limpiar } = nuevoMundo(alm, politica(MANUAL));
    t.after(limpiar);
    for (let i = 0; i < 3; i++) vender(m, 'DUO', 1, items[2]!.item_id);
    m.pump(); // el hub conoce hasta el folio 3
    m.cortarLan('DUO', 1);
    vender(m, 'DUO', 1, items[2]!.item_id); // folio 4: se pierde con el disco
    const nueva = m.perderDiscoCaja('DUO', 1);
    m.restablecerLan('DUO', 1);
    m.rehidratarCaja('DUO', 1);
    assert.throws(() => nueva.recuperarFolios(), { codigo: 'FOLIO_BLOQUEADO', message: /atestación manual/ });
    assert.throws(() => nueva.atestarSiguienteFolio({ siguiente: 3, ...atesta }), { codigo: 'FOLIO_REUTILIZABLE' });
    assert.throws(() => nueva.atestarSiguienteFolio({ siguiente: 4, usuario: 'galo', evidencia: { tipo: 'x', referencia: '  ' } }), { codigo: 'EVIDENCIA_REQUERIDA' });
    assert.equal(nueva.estadoFolios().estado, 'recuperacion', 'los intentos rechazados no desbloquean');
    nueva.atestarSiguienteFolio({ siguiente: 5, ...atesta });
    assert.equal(nueva.estadoFolios().estado, 'activa');
    const cart = nueva.abrirCarrito();
    nueva.agregarLinea(cart, { item_id: items[2]!.item_id, qty: 1 });
    assert.equal(nueva.cobrar(cart, [{ metodo: 'efectivo', monto: 12000 }]).folio, 5);
    const at = nueva.ops().find((o) => o.tipo === 'folio.atestacion_manual')!.payload;
    assert.equal(at.verificable, false, 'el sistema no pretende haber verificado la atestación');
    assert.equal(at.hwm_conocido, 3);
  });

  it('R5 [P-06 NO aceptada] sin hub/central no se atesta salvo confirmación explícita, que queda registrada', (t) => {
    const { m, limpiar } = nuevoMundo(alm, politica(MANUAL));
    t.after(limpiar);
    m.cortarLan('DUO', 1);
    const nueva = m.perderDiscoCaja('DUO', 1);
    assert.throws(() => nueva.atestarSiguienteFolio({ siguiente: 10, ...atesta }), { codigo: 'EVIDENCIA_INSUFICIENTE' });
    assert.equal(nueva.estadoFolios().estado, 'recuperacion');
    nueva.atestarSiguienteFolio({ siguiente: 10, ...atesta, sinAnclasConfirmado: true });
    assert.equal(nueva.ops().find((o) => o.tipo === 'folio.atestacion_manual')!.payload.anclas_disponibles, false);
  });

  it('R6 un ticket escaneado con folio mayor al contador bloquea la serie y abre incidencia', (t) => {
    const { m, items, limpiar } = nuevoMundo(alm, politica(MANUAL));
    t.after(limpiar);
    const c = m.caja('DUO', 1);
    vender(m, 'DUO', 1, items[2]!.item_id);
    assert.deepEqual(c.registrarTicketEscaneado({ tienda: 'DUO', caja: 1, folio: 1 }), { ok: true });
    assert.deepEqual(c.registrarTicketEscaneado({ tienda: 'DUO', caja: 2, folio: 99 }), { ok: true }, 'otra serie no afecta');
    assert.deepEqual(c.registrarTicketEscaneado({ tienda: 'DUO', caja: 1, folio: 9 }), { ok: false });
    assert.equal(c.estadoFolios().estado, 'recuperacion');
    assert.throws(() => vender(m, 'DUO', 1, items[2]!.item_id), { codigo: 'FOLIO_BLOQUEADO' });
  });

  it('R7 [P-06 aceptada] costo del arrendamiento: aislada y con el techo agotado, la caja deja de vender; con hub renueva sin límite', (t) => {
    const { m, items, limpiar } = nuevoMundo(alm, politica({ ...ARR, K_folios: 4 }));
    t.after(limpiar);
    const c = m.caja('DUO', 1);
    c.iniciarArrendamiento();
    for (let i = 0; i < 20; i++) vender(m, 'DUO', 1, items[2]!.item_id); // con hub: renovación continua
    assert.equal(c.estadoFolios().ultimo, 20);
    m.caerHub('DUO');
    const restante = c.estadoFolios().techo! - c.estadoFolios().ultimo;
    for (let i = 0; i < restante; i++) vender(m, 'DUO', 1, items[2]!.item_id);
    assert.throws(() => vender(m, 'DUO', 1, items[2]!.item_id), { codigo: 'FOLIO_BLOQUEADO', message: /techo/ });
  });
});

porAlmacen('Recuperación desde respaldo (solo SQLite)', (alm) => {
  it('R8 un respaldo viejo restaurado detecta que el contador está atrasado y NO emite hasta resolver', (t) => {
    const { m, items, limpiar } = nuevoMundo(alm, politica(MANUAL));
    t.after(limpiar);
    for (let i = 0; i < 3; i++) vender(m, 'DUO', 1, items[2]!.item_id);
    const respaldo = m.respaldarCaja('DUO', 1);
    for (let i = 0; i < 2; i++) vender(m, 'DUO', 1, items[2]!.item_id); // folios 4 y 5
    m.pump();
    const restaurada = m.restaurarCajaDesdeRespaldo('DUO', 1, respaldo);
    assert.equal(restaurada.estadoFolios().ultimo, 3, 'el respaldo no conoce 4 y 5');
    assert.equal(restaurada.estadoFolios().estado, 'recuperacion');
    assert.throws(() => restaurada.atestarSiguienteFolio({ siguiente: 5, ...atesta }), { codigo: 'FOLIO_REUTILIZABLE' });
    restaurada.atestarSiguienteFolio({ siguiente: 6, ...atesta });
    const cart = restaurada.abrirCarrito();
    restaurada.agregarLinea(cart, { item_id: items[2]!.item_id, qty: 1 });
    assert.equal(restaurada.cobrar(cart, [{ metodo: 'efectivo', monto: 12000 }]).folio, 6);
    m.pump();
    assert.deepEqual(detectar(m.central.repo.ops()).filter((i) => i.tipo.startsWith('folio')), []);
  });

  it('R9 un respaldo con ventas pendientes de enviar las conserva al restaurar y reenviar sin duplicar', (t) => {
    const { m, items, limpiar } = nuevoMundo(alm, politica(MANUAL));
    t.after(limpiar);
    m.cortarLan('DUO', 1);
    vender(m, 'DUO', 1, items[2]!.item_id, 2);
    const respaldo = m.respaldarCaja('DUO', 1); // incluye la cola de salida
    const restaurada = m.restaurarCajaDesdeRespaldo('DUO', 1, respaldo);
    m.restablecerLan('DUO', 1);
    // la caja restaurada sigue en recuperación (no sabe qué pasó después del respaldo) pero sus ventas guardadas se envían
    m.pump();
    m.pump();
    assert.equal(ventas(m.central.repo.ops()).size, 1);
    assert.equal(restaurada.estadoFolios().estado, 'recuperacion');
  });
}, 'sqlite');
