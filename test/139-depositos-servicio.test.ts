import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { after, describe, it } from 'node:test';
import { api, appAdmin, appCajero } from './ayudas/app.ts';
import { ALMACENES, nuevoMundo, politica, servicioDe } from './ayudas/comun.ts';

const sqlite = ALMACENES.find((a) => a.nombre === 'sqlite')!;
const VESTIDO = '0002026090782'; // $899.00
const trabajos = (dir: string) => readdirSync(dir).filter((f) => f.endsWith('.bin')).sort().map((f) => ({ f, bin: readFileSync(join(dir, f)), txt: readFileSync(join(dir, f.replace(/\.bin$/, '.txt')), 'utf8') }));
const contiene = (b: Buffer, ...x: number[]) => b.indexOf(Buffer.from(x)) >= 0;
void after;
const codigoDe = (r: { ticket_texto: string }) => /Código: (DEP\S+)/.exec(r.ticket_texto)![1]!;

describe('Depósitos: servicio, impresión, permisos y pagos combinados', () => {
  it('DS1 impresión fallida: el depósito queda una sola vez, el reintento no lo duplica y se reimprime; el cajón y el código de barras salen donde corresponde', async (t) => {
    const ctx = nuevoMundo(sqlite, politica());
    const caja = await appCajero(ctx, 'DUO', 1, 'Ana');
    t.after(async () => { await caja.cerrar(); ctx.limpiar(); });
    caja.s.impresora.falla = 'sin papel';
    const r1 = await api(caja.url, '/api/deposito', { ref: 'ref-1', clienta: 'María González', monto: 30000 });
    assert.equal(r1.status, 200);
    assert.ok(!('secreto' in r1.json.deposito), 'la API no expone el secreto');
    assert.match(r1.json.codigo_barras_svg, /^<svg/);
    assert.deepEqual([r1.json.impresion.ok, r1.json.deposito.folio], [false, 'DEP-D1-0001']);
    assert.equal(trabajos(caja.s.impresora.dir).length, 0);
    // reintento con la misma referencia (la cajera vuelve a tocar el botón)
    const r2 = await api(caja.url, '/api/deposito', { ref: 'ref-1', clienta: 'María González', monto: 30000 });
    assert.equal(r2.json.deposito.deposito_id, r1.json.deposito.deposito_id);
    assert.equal((await api(caja.url, '/api/depositos')).json.depositos.length, 1, 'no se duplicó');
    caja.s.impresora.falla = null;
    const rep = await api(caja.url, '/api/deposito/reimprimir', { deposito_id: r1.json.deposito.deposito_id });
    assert.equal(rep.json.impresion.ok, true);
    const [p1] = trabajos(caja.s.impresora.dir);
    assert.match(p1!.txt, /COMPROBANTE DE DEPÓSITO[\s\S]*REIMPRESIÓN 1[\s\S]*Folio: DEP-D1-0001/);
    assert.ok(contiene(p1!.bin, 0x1d, 0x6b, 73), 'trae código de barras Code128 (GS k 73)');
    assert.ok(p1!.bin.includes(Buffer.from(`{B${codigoDe(r1.json)}`)), 'el código de barras lleva folio + secreto, escaneable por el lector de la caja');
    assert.match(codigoDe(r1.json), /^DEPD10001[A-Z2-9]{6}$/, 'el código de barras es solo letras y números (sin guiones ni símbolos)');
    assert.ok(!contiene(p1!.bin, 0x1d, 0x48, 2), 'el código de barras no imprime texto debajo (algunas impresoras ahí ponen el «{B»)');
    assert.ok(!contiene(p1!.bin, 0x1b, 0x70, 0x00), 'una reimpresión no abre el cajón');
    // un depósito nuevo SÍ abre el cajón
    const r3 = await api(caja.url, '/api/deposito', { ref: 'ref-2', clienta: 'Lupe Pérez', monto: 50000 });
    const p2 = trabajos(caja.s.impresora.dir).at(-1)!;
    assert.ok(contiene(p2.bin, 0x1b, 0x70, 0x00), 'recibir un depósito abre el cajón');
    // devolver abre el cajón; retener un fee no
    const id2 = (await api(caja.url, '/api/depositos?q=DEP-D1-0002')).json.depositos[0].deposito_id;
    const fee = await api(caja.url, '/api/deposito/fee', { ref: 'f-1', deposito_id: id2, monto: 10000, motivo: 'Mancha' });
    assert.equal(fee.status, 200);
    assert.ok(!contiene(trabajos(caja.s.impresora.dir).at(-1)!.bin, 0x1b, 0x70, 0x00), 'el fee no mueve efectivo: no abre el cajón');
    const dev = await api(caja.url, '/api/deposito/devolver', { ref: 'd-1', deposito_id: id2, confirmado: true, codigo: codigoDe(r3.json) });
    assert.equal(dev.status, 200);
    assert.ok(contiene(trabajos(caja.s.impresora.dir).at(-1)!.bin, 0x1b, 0x70, 0x00), 'devolver el dinero abre el cajón');
    assert.equal((await api(caja.url, '/api/deposito/devolver', { ref: 'd-2', deposito_id: id2, confirmado: false, codigo: codigoDe(r3.json) })).status >= 400, true, 'sin confirmar no se entrega');
    assert.ok(!trabajos(caja.s.impresora.dir).at(-1)!.bin.includes(Buffer.from(codigoDe(r3.json))), 'el comprobante de la devolución no lleva el secreto');
    // reimpresión de la resolución
    const rr = await api(caja.url, '/api/deposito/reimprimir-resolucion', { deposito_id: id2, op_id: dev.json.op_id });
    assert.match(rr.json.ticket_texto, /DEVOLUCIÓN DE DEPÓSITO[\s\S]*REIMPRESIÓN 1/);
  });

  it('DS2 permisos: el fee exige a otra persona (o supervisor) con su clave; sin sesión no se opera; Administración no recibe depósitos', async (t) => {
    const ctx = nuevoMundo(sqlite, politica());
    const adm = await appAdmin(ctx);
    const caja = await appCajero(ctx, 'DUO', 1, 'Lupe');
    t.after(async () => { await adm.cerrar(); await caja.cerrar(); ctx.limpiar(); });
    await api(adm.url, '/api/admin/administradores', { nombre: 'Edgardo', clave: 'clave-segura', clave_caja: '2468' });
    await api(adm.url, '/api/admin/cajeros', { nombre: 'Lupe', clave: '4321' });
    await api(adm.url, '/api/admin/cajeros', { nombre: 'Rosa', clave: '8765' });
    for (let i = 0; i < 4; i++) ctx.m.pump();
    const sin = await api(caja.url, '/api/deposito', { ref: 'x', clienta: 'Ana Pérez', monto: 10000 });
    assert.ok(sin.status >= 400, 'sin iniciar sesión no se recibe un depósito');
    await api(caja.url, '/api/login', { usuario: 'Lupe', clave: '4321' });
    const rec = (await api(caja.url, '/api/deposito', { ref: 'a', clienta: 'Ana Pérez', monto: 30000 })).json;
    const d = rec.deposito;
    assert.equal(d.cajero, 'Lupe');
    const malo = await api(caja.url, '/api/deposito/fee', { ref: 'f0', deposito_id: d.deposito_id, monto: 10000, motivo: 'Cierre roto' });
    assert.equal(malo.json.error?.codigo ?? malo.json.codigo, 'AUTORIZACION_REQUERIDA');
    const propio = await api(caja.url, '/api/deposito/fee', { ref: 'f0', deposito_id: d.deposito_id, monto: 10000, motivo: 'Cierre roto', autoriza: { nombre: 'Lupe', clave: '4321' } });
    assert.equal(propio.json.error?.codigo ?? propio.json.codigo, 'AUTORIZADOR_INVALIDO', 'no se autoriza a sí misma');
    const ok = await api(caja.url, '/api/deposito/fee', { ref: 'f1', deposito_id: d.deposito_id, monto: 10000, motivo: 'Cierre roto', autoriza: { nombre: 'Rosa', clave: '8765' } });
    assert.equal(ok.status, 200);
    const h = (await api(caja.url, `/api/deposito?id=${d.deposito_id}`)).json.deposito.movimientos;
    assert.deepEqual(h.map((m: any) => [m.tipo, m.monto, m.usuario, m.autorizado_por ?? null]), [['recibido', 30000, 'Lupe', null], ['fee', 10000, 'Lupe', 'Rosa']]);
    // devolver: sin el código no se entrega; con un código ajeno tampoco; con el correcto sí
    const dev = { ref: 'v1', deposito_id: d.deposito_id, confirmado: true };
    assert.equal((await api(caja.url, '/api/deposito/devolver', dev)).json.error?.codigo ?? (await api(caja.url, '/api/deposito/devolver', dev)).json.codigo, 'DEPOSITO_CODIGO_REQUERIDO');
    const malCodigo = await api(caja.url, '/api/deposito/devolver', { ...dev, codigo: 'DEP-D1-0001-AAAAAA' });
    assert.equal(malCodigo.json.error?.codigo ?? malCodigo.json.codigo, 'DEPOSITO_CODIGO_INVALIDO');
    // comprobante extraviado: doble clave (otra persona o supervisor), nunca la misma persona
    const propia2 = await api(caja.url, '/api/deposito/devolver', { ...dev, autoriza: { nombre: 'Lupe', clave: '4321' } });
    assert.equal(propia2.json.error?.codigo ?? propia2.json.codigo, 'AUTORIZADOR_INVALIDO');
    const mala = await api(caja.url, '/api/deposito/devolver', { ...dev, autoriza: { nombre: 'Rosa', clave: '0000' } });
    assert.ok(mala.status >= 400);
    const extr = await api(caja.url, '/api/deposito/devolver', { ...dev, monto: 5000, autoriza: { nombre: 'Rosa', clave: '8765' } });
    assert.equal(extr.status, 200);
    assert.match(extr.json.ticket_texto, /Comprobante extraviado[\s\S]*doble\s+clave[\s\S]*Autorizó: Rosa/);
    const h2 = (await api(caja.url, `/api/deposito?id=${d.deposito_id}`)).json.deposito.movimientos.at(-1);
    assert.deepEqual([h2.tipo, h2.verificado_con, h2.autorizado_por], ['devuelto', 'doble_clave', 'Rosa']);
    // «no hay nadie más»: la propia clave y queda anotado
    const solo = await api(caja.url, '/api/deposito/devolver', { ref: 'v2', deposito_id: d.deposito_id, confirmado: true, monto: 5000, autoriza: { nombre: 'Lupe', clave: '4321', sin_segundo: true } });
    assert.equal(solo.status, 200);
    assert.match((await api(caja.url, `/api/deposito?id=${d.deposito_id}`)).json.deposito.movimientos.at(-1).autorizado_por, /sin segunda persona/);
    // con el código del comprobante, sin más claves
    const conCodigo = await api(caja.url, '/api/deposito/devolver', { ref: 'v3', deposito_id: d.deposito_id, confirmado: true, monto: 1000, codigo: codigoDe(rec) });
    assert.equal(conCodigo.status, 200);
    assert.equal((await api(caja.url, `/api/deposito?id=${d.deposito_id}`)).json.deposito.movimientos.at(-1).verificado_con, 'ticket');
    // ni la lista ni la búsqueda exponen el secreto
    assert.ok(!JSON.stringify((await api(caja.url, '/api/depositos')).json).includes(codigoDe(rec).slice(-6)));
    // un código escaneado completo se reconoce como leído
    assert.equal((await api(caja.url, `/api/depositos?q=${codigoDe(rec)}`)).json.codigo_leido, true);
    assert.equal((await api(caja.url, `/api/depositos?q=DEP-D1-0001`)).json.codigo_leido, undefined);
    // Administración no tiene caja: no recibe depósitos
    const enAdmin = await api(adm.url, '/api/deposito', { ref: 'z', clienta: 'Ana Pérez', monto: 10000 });
    assert.ok(enAdmin.status >= 400);
  });

  it('DS3 pagos combinados: depósito + dólares, depósito + tarjeta de regalo, y el corte concilia', async (t) => {
    const ctx = nuevoMundo(sqlite, politica());
    ctx.m.fijarTipoCambioInicial(180000);
    t.after(ctx.limpiar);
    const s = servicioDe(ctx, 'DUO', 1, 'Ana');
    // — depósito $300 + dólares (US$20 = $360 a 18.00) + pesos: la venta es de $899, la clienta paga $599
    const dep = await s.svc.recibirDeposito({ ref: 'a', clienta: 'Clienta Uno', monto: 30000 });
    const c1 = s.svc.nuevaVenta(); s.svc.escanear(c1, VESTIDO);
    const ap = s.svc.aplicarDeposito(c1, dep.deposito.deposito_id, { codigo: codigoDe(dep) });
    assert.equal(ap.carrito.total, 59900);
    const v1 = (await s.svc.cobrarEfectivo(c1, 24000, 2000)).venta ?? undefined;
    const venta1 = v1 ?? (s.svc.caja.opsVentas().at(-1)!.payload);
    assert.equal(venta1.total, 89900);
    assert.deepEqual(venta1.pagos.map((p: any) => p.metodo), ['deposito', 'efectivo_usd']);
    assert.equal(venta1.pagos.reduce((a: number, p: any) => a + p.monto, 0), 89900);
    // — depósito $200 + tarjeta de regalo $200 + el resto en efectivo
    const dep2 = await s.svc.recibirDeposito({ ref: 'b', clienta: 'Clienta Dos', monto: 20000 });
    s.svc.caja.altaTarjetaRegalo({ codigo: 'GC-1', monto: 20000, ref: 'gc1', cajero: 'Ana' }); ctx.m.pump(); ctx.m.pump();
    const c2 = s.svc.nuevaVenta(); s.svc.escanear(c2, VESTIDO);
    s.svc.aplicarDeposito(c2, dep2.deposito.deposito_id, { codigo: codigoDe(dep2) });
    const v2 = s.svc.caja.cobrarConTarjetaRegalo(c2, 'GC-1', 49900, 'Ana');
    assert.deepEqual(v2.pagos.map((p) => p.metodo), ['deposito', 'tarjeta_regalo', 'efectivo']);
    assert.equal(v2.pagos.reduce((a, p) => a + p.monto, 0), v2.total);
    // — un depósito no se aplica a una tarjeta de regalo
    const dep3 = await s.svc.recibirDeposito({ ref: 'c', clienta: 'Clienta Tres', monto: 10000 });
    const c3 = s.svc.caja.abrirCarrito();
    s.svc.caja.agregarLinea(c3, { item_id: ctx.items[2]!.item_id, qty: 1 });
    assert.throws(() => s.svc.aplicarDeposito('no-existe', dep3.deposito.deposito_id, { codigo: codigoDe(dep3) }), { codigo: 'CARRITO_INEXISTENTE' });
    // — corte: ventas completas (2 × $899), depósitos aplicados $500, pendiente $100, y el efectivo esperado cuadra
    const corte = s.svc.corte(ctx.m.reloj.now().slice(0, 10)).vivo;
    assert.equal(corte.ventas_mercancia, 179800, 'las dos ventas completas (la tarjeta de regalo no es mercancía)');
    assert.deepEqual([corte.depositos.recibidos, corte.depositos.aplicados, corte.depositos.pendiente, corte.depositos.devueltos, corte.depositos.fees], [60000, 50000, 10000, 0, 0]);
    // efectivo físico = depósitos recibidos (600) + pesos cobrados de las ventas (v1: 240−change, v2: 499+alta GC 200) ...
    assert.equal(corte.mxn.depositos_recibidos, 60000);
    assert.equal(corte.ventas_netas, 179800);
    // el ticket del corte muestra la sección de depósitos, aparte de las ventas
    const { renderTicketCorteTexto } = await import('../src/ticket.ts');
    const texto = renderTicketCorteTexto({ ...corte, ...corte.mxn && {}, tienda: 'DUO' } as any);
    assert.match(texto, /DEPÓSITOS EN GARANTÍA \(no son venta\)[\s\S]*Depósitos recibidos\s+\$600\.00[\s\S]*Aplicados a compras\s+\$500\.00[\s\S]*Saldo pendiente \(1\)\s+\$100\.00/);
  });

  it('DS4 cancelar la venta que usó el depósito lo regresa al saldo; una venta pagada solo con depósito se confirma sin efectivo', async (t) => {
    const ctx = nuevoMundo(sqlite, politica());
    t.after(ctx.limpiar);
    const s = servicioDe(ctx, 'DUO', 1, 'Ana');
    const dep = await s.svc.recibirDeposito({ ref: 'a', clienta: 'Clienta Uno', monto: 100000 });
    const c = s.svc.nuevaVenta(); s.svc.escanear(c, VESTIDO);
    assert.throws(() => s.svc.aplicarDeposito(c, dep.deposito.deposito_id), { codigo: 'DEPOSITO_CODIGO_REQUERIDO' });
    const r = s.svc.aplicarDeposito(c, dep.deposito.deposito_id, { codigo: codigoDe(dep) });
    assert.equal(r.carrito.total, 0, 'el depósito cubre todo');
    const v = (await s.svc.cobrarEfectivo(c, 0, 0)).venta;
    assert.deepEqual(v.pagos.map((p: any) => [p.metodo, p.monto]), [['deposito', 89900]]);
    assert.equal(s.svc.caja.depositoPorId(dep.deposito.deposito_id)!.saldo, 10100);
    s.svc.cancelarVenta(v.sale_id, 'no le quedó');
    const d = s.svc.caja.depositoPorId(dep.deposito.deposito_id)!;
    assert.deepEqual([d.saldo, d.estado], [100000, 'parcial']);
    assert.deepEqual(d.movimientos.map((m) => m.tipo), ['recibido', 'aplicado', 'reintegrado']);
    const corte = s.svc.corte(ctx.m.reloj.now().slice(0, 10)).vivo;
    assert.equal(corte.mxn.esperado, 100000, 'el efectivo del depósito sigue en el cajón; no salió dinero por la cancelación');
    assert.equal(corte.depositos.pendiente, 100000);
  });
});
