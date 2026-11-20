import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it, test } from 'node:test';
import { chromium, devices } from 'playwright-core';
import { crearOp } from '../src/util.ts';
import { api, appAdmin } from './ayudas/app.ts';
import { centralLocal, ClientePglite, usuario } from './ayudas/central-pglite.ts';
import { ALMACENES, nuevoMundo, politica } from './ayudas/comun.ts';
import { irASeccion } from './ayudas/navegacion.ts';
import { simularSupabase, URL_CENTRAL } from './ayudas/supabase-simulado.ts';

const RAIZ = join(import.meta.dirname, '..');
const { defaultBrowserType: _omitido, ...IPHONE } = devices['iPhone 13']!;
void _omitido;

const CANDIDATOS = [process.env.POS_CHROMIUM, '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', '/opt/pw-browsers/chromium/chrome-linux/chrome'];
const chromiumPath = CANDIDATOS.find((p) => p && existsSync(p));
const sqlite = ALMACENES.find((a) => a.nombre === 'sqlite')!;
const T0 = '2026-11-10T12:00:00.000Z';
const op = (tipo: string, id: string, payload: object, tienda: string | null = 'DUO') => crearOp(tipo, tienda, null, 'admin', T0, payload, id);

test('AS1 central real: el asistente baja solo lo de almacén y lo de Empleadas (sin claves ni ventas normales) y solo sube abonos', async () => {
  const db = await centralLocal();
  const sup = await usuario(db, 'edgardo@x.mx', 'supervisor');
  const asi = await usuario(db, 'evelyn@x.mx', 'asistente');
  const alm = await usuario(db, 'gabo@x.mx', 'almacenista');
  const cliSup = new ClientePglite(db, sup);
  await cliSup.subirOps([
    op('cajero.guardado', 'c1', { id: 'caj-1', nombre: 'Rosa', activo: true, sal: 'SAL-SECRETA', hash: 'HASH-SECRETO', perfil: { telefono: '6531112233' }, tienda: 'DUO', por: 'Edgardo' }),
    op('supervisor.guardado', 'c2', { id: 'sup-1', nombre: 'Edgardo', activo: true, sal: 'SAL-SUP', hash: 'HASH-SUP', foto: 'data:image/png;base64,xx' }),
    op('sale.confirmed', 'v1', { sale_id: 'venta-normal', tienda: 'DUO', caja: 1, folio: 1, total: 90000, pagos: [{ metodo: 'efectivo', monto: 90000 }], lineas: [] }),
    op('sale.confirmed', 'v2', { sale_id: 'venta-credito', tienda: 'DUO', caja: 1, folio: 2, total: 50000, pagos: [{ metodo: 'credito_empleada', empleada_id: 'caj-1', monto: 50000 }], lineas: [] }),
    op('sale.cancelled', 'x1', { sale_id: 'venta-normal', tienda: 'DUO' }),
    op('return.registered', 'd1', { sale_id: 'venta-credito', devolucion_id: 'dev-1', tienda: 'DUO', importe: 10000, reembolsos: [{ metodo: 'credito_empleada', monto: 10000 }], lineas: [] }),
    op('return.registered', 'd2', { sale_id: 'venta-normal', devolucion_id: 'dev-2', tienda: 'DUO', importe: 5000, reembolsos: [{ metodo: 'efectivo', monto: 5000 }], lineas: [] }),
    op('empleada.credito', 'e1', { empleada_id: 'caj-1', limite: 100000, motivo: 'alta', por: 'Edgardo' }),
    op('empleada.movimiento', 'e2', { empleada_id: 'caj-1', tipo: 'abono', monto: 20000, motivo: 'nómina', por: 'Edgardo', ref: 'r1', fecha: '2026-11-10' }),
    op('empleadas.config', 'e3', { pct: 15, pct_uniforme: 30 }),
    op('item.created', 'i1', { item_id: 'a1', descripcion: 'BLUSA' }),
    op('promo.guardada', 'p1', { id: 'promo-1' }),
    op('corte.generado', 'k1', { tienda: 'DUO', caja: 1, fecha: '2026-11-10', ventas: 90000 }),
  ]);
  // El asistente: lo de almacén + lo de Empleadas; nada de ventas normales, cortes ni promociones.
  const filas = await new ClientePglite(db, asi).bajarOps(0, 1000);
  const ids = filas.map((f) => f.op_id).sort();
  assert.deepEqual(ids, ['c1', 'c2', 'd1', 'e1', 'e2', 'e3', 'i1', 'v2']);
  // Del personal solo llega lo necesario: nunca la sal ni la huella de la clave, el perfil ni la foto.
  for (const f of filas.filter((x) => x.tipo === 'cajero.guardado' || x.tipo === 'supervisor.guardado')) {
    assert.deepEqual(Object.keys(f.payload as object).sort(), f.tipo === 'cajero.guardado' ? ['activo', 'id', 'nombre', 'tienda'] : ['activo', 'id', 'nombre']);
  }
  assert.doesNotMatch(JSON.stringify(filas), /SECRET|HASH|SAL-|6531112233|base64/);
  // El cursor avanza: no repite lo ya bajado.
  const ultimo = Math.max(...filas.map((f) => f.seq));
  assert.deepEqual(await new ClientePglite(db, asi).bajarOps(ultimo, 1000), []);
  // El supervisor sigue viendo todo (con las claves, como siempre) y el almacenista, solo lo suyo.
  assert.equal((await cliSup.bajarOps(0, 1000)).length, 13);
  assert.deepEqual((await new ClientePglite(db, alm).bajarOps(0, 1000)).map((f) => f.op_id), ['i1']);

  // Escribe: lo de almacén y abonos de nómina; nada más.
  const cli = new ClientePglite(db, asi);
  assert.equal((await cli.subirOps([op('item.created', 'i2', { item_id: 'a2' }), op('empleada.movimiento', 'e4', { empleada_id: 'caj-1', tipo: 'abono', monto: 5000, motivo: 'nómina', por: 'Evelyn', ref: 'r2', fecha: '2026-11-11' })])).nuevas, 2);
  for (const [id, tipo, payload] of [
    ['m1', 'empleada.movimiento', { empleada_id: 'caj-1', tipo: 'ajuste_abono', monto: 99999, motivo: 'borrar deuda', ref: 'r3' }],
    ['m2', 'empleada.movimiento', { empleada_id: 'caj-1', tipo: 'ajuste_cargo', monto: 1, motivo: 'x', ref: 'r4' }],
    ['m3', 'empleada.credito', { empleada_id: 'caj-1', limite: 9999999, motivo: 'x' }],
    ['m4', 'empleadas.config', { pct: 90, pct_uniforme: 90 }],
    ['m5', 'sale.confirmed', { sale_id: 'falsa', tienda: 'DUO', total: 1, pagos: [], lineas: [] }],
    ['m6', 'cajero.guardado', { id: 'caj-9', nombre: 'Intrusa', activo: true }],
  ] as const) await assert.rejects(() => cli.subirOps([op(tipo, id, payload)]), /no permitido para este rol/, `${tipo} ${JSON.stringify(payload)}`);
  // El almacenista no ve ni escribe nada de Empleadas.
  await assert.rejects(() => new ClientePglite(db, alm).subirOps([op('empleada.movimiento', 'm7', { empleada_id: 'caj-1', tipo: 'abono', monto: 1, motivo: 'x', ref: 'r5' })]), /no permitido para este rol/);
});

porRol();
function porRol() {
  describe('AS2 Administración: el asistente ve Inventario, Almacén y Empleadas, y solo registra abonos', () => {
    it('AS2 rutas y permisos', async (t) => {
      const ctx = nuevoMundo(sqlite, politica());
      t.after(ctx.limpiar);
      const adm = await appAdmin(ctx);
      t.after(() => adm.cerrar());
      await api(adm.url, '/api/admin/administradores', { nombre: 'Edgardo', clave: 'clave-segura', clave_caja: '2468' });
      const ev = await api(adm.url, '/api/admin/administradores', { nombre: 'Evelyn', clave: 'clave-evelyn', rol: 'asistente', clave_caja: '1357' });
      assert.deepEqual(ev.json.administradores.map((a: any) => [a.nombre, a.rol]), [['Edgardo', 'supervisor'], ['Evelyn', 'asistente']]);
      await api(adm.url, '/api/admin/cajeros', { nombre: 'Rosa', clave: '8765' });
      const rosa = (await api(adm.url, '/api/admin/empleadas')).json.empleadas.find((e: any) => e.nombre === 'Rosa').id;
      await api(adm.url, '/api/admin/empleadas/limite', { empleada_id: rosa, limite: 100000, motivo: 'alta' });
      await api(adm.url, '/api/logout', {});
      const s = (await api(adm.url, '/api/login', { usuario: 'Evelyn', clave: 'clave-evelyn' })).json;
      assert.deepEqual([s.autenticado, s.rol_usuario], [true, 'asistente']);
      assert.deepEqual((await api(adm.url, '/api/sesion')).json.nav, ['inventario', 'almacen', 'empleadas']);
      // Puede: lo de Inventario y Almacén, ver cuentas, movimientos y nómina, y abonar.
      for (const ruta of ['/api/admin/inventario', '/api/admin/almacen', '/api/admin/empleadas', `/api/admin/empleadas/movimientos?id=${rosa}`, '/api/admin/empleadas/nomina?desde=2026-10-01&hasta=2026-10-01']) assert.equal((await api(adm.url, ruta)).status, 200, ruta);
      const abono = await api(adm.url, '/api/admin/empleadas/movimiento', { empleada_id: rosa, tipo: 'abono', monto: 30000, motivo: 'Descuento de nómina', periodo: 'octubre', ref: 'ref-asistente-1' });
      assert.equal(abono.status, 200, JSON.stringify(abono.json));
      assert.equal(abono.json.empleadas.find((e: any) => e.id === rosa).abonos, 30000);
      const mov = (await api(adm.url, `/api/admin/empleadas/movimientos?id=${rosa}`)).json.movimientos;
      assert.deepEqual(mov.map((m: any) => [m.tipo, m.monto, m.por]), [['abono', 30000, 'Evelyn']], 'el abono queda a su nombre');
      // No puede: ajustes, límite, porcentajes, perfiles, reportes ni administrar usuarios.
      for (const tipo of ['ajuste_cargo', 'ajuste_abono']) assert.equal((await api(adm.url, '/api/admin/empleadas/movimiento', { empleada_id: rosa, tipo, monto: 100, motivo: 'x', ref: `ref-${tipo}` })).status, 403, tipo);
      assert.equal((await api(adm.url, '/api/admin/empleadas/limite', { empleada_id: rosa, limite: 9999900, motivo: 'x' })).status, 403);
      assert.equal((await api(adm.url, '/api/admin/empleadas/config', { pct: 90 })).status, 403);
      for (const ruta of ['/api/admin/cajeros', '/api/admin/administradores', '/api/admin/supervisores', '/api/admin/reportes', '/api/admin/promociones', '/api/admin/tarjetas', '/api/admin/historial']) assert.equal((await api(adm.url, ruta)).status, 403, ruta);
      assert.equal((await api(adm.url, '/api/admin/cajeros', { nombre: 'Intrusa', clave: '1234' })).status, 403);
    });
  });
}

describe('[navegador real] Empleadas: movimientos y abono en la misma ventana de cada empleada', { timeout: 240_000, skip: chromiumPath ? false : 'Chromium no encontrado (defina POS_CHROMIUM)' }, () => {
  it('AS3 el detalle sale justo debajo de la empleada; el asistente no ve Límite, Ajuste ni porcentajes', async (t) => {
    const browser = await chromium.launch({ executablePath: chromiumPath, args: ['--no-sandbox'] });
    const ctx = nuevoMundo(sqlite, politica());
    const adm = await appAdmin(ctx);
    t.after(async () => { await browser.close(); await adm.cerrar(); ctx.limpiar(); });
    await api(adm.url, '/api/admin/administradores', { nombre: 'Edgardo', clave: 'clave-segura', clave_caja: '2468' });
    await api(adm.url, '/api/admin/administradores', { nombre: 'Evelyn', clave: 'clave-evelyn', rol: 'asistente' });
    for (const [n, c] of [['Ana', '1111'], ['Rosa', '8765']] as const) await api(adm.url, '/api/admin/cajeros', { nombre: n, clave: c });
    const cuentas = (await api(adm.url, '/api/admin/empleadas')).json.empleadas as { id: string; nombre: string }[];
    const ana = cuentas.find((e) => e.nombre === 'Ana')!.id, rosa = cuentas.find((e) => e.nombre === 'Rosa')!.id;
    for (const id of [ana, rosa]) await api(adm.url, '/api/admin/empleadas/limite', { empleada_id: id, limite: 100000, motivo: 'alta' });
    const errores: string[] = [];
    const nueva = async (ancho: number) => { const p = await (await browser.newContext({ viewport: { width: ancho, height: 900 }, locale: 'es-MX' })).newPage(); p.on('pageerror', (e) => errores.push(String(e))); await p.goto(adm.url); return p; };

    // Supervisor: abono dentro de la ventana de Rosa y movimientos justo debajo de ella
    await api(adm.url, '/api/logout', {});
    await api(adm.url, '/api/login', { usuario: 'Edgardo', clave: 'clave-segura' });
    let a = await nueva(1366);
    await a.waitForSelector('#nav');
    await a.click('#nav button[data-vista="empleadas"]');
    await a.click('#per-tab-descuento');
    const fila = (id: string) => `#tabla-empleadas tr[data-emp="${id}"]`;
    await a.waitForSelector(fila(rosa));
    await a.click(`${fila(rosa)} .em-abono`);
    await a.fill('#ef-monto', '250');
    // el formulario vive en la fila de detalle que sigue a Rosa
    assert.equal(await a.evaluate((id) => document.querySelector(`#tabla-empleadas tr[data-emp="${id}"]`)!.nextElementSibling!.classList.contains('emp-det') && !!document.querySelector(`#tabla-empleadas tr[data-emp="${id}"]`)!.nextElementSibling!.querySelector('#form-emp'), rosa), true);
    await a.click('#form-emp button[type="submit"]');
    await a.waitForFunction((f) => document.querySelector(`${f} [data-col="abonos"]`)?.textContent === '$250.00', fila(rosa));
    await a.click(`${fila(rosa)} .em-mov`);
    await a.waitForSelector('#tabla-emp-mov');
    assert.equal(await a.evaluate((id) => !!document.querySelector(`#tabla-empleadas tr[data-emp="${id}"]`)!.nextElementSibling!.querySelector('#tabla-emp-mov'), rosa), true, 'los movimientos salen en la ventana de Rosa, no al final de la página');
    // abrir los de Ana cierra los de Rosa (solo uno a la vez) y el mismo botón los cierra
    await a.click(`${fila(ana)} .em-mov`);
    await a.waitForFunction((id) => !!document.querySelector(`#tabla-empleadas tr[data-emp="${id}"]`)!.nextElementSibling!.querySelector('#tabla-emp-mov'), ana);
    assert.equal(await a.locator('#tabla-emp-mov').count(), 1);
    await a.click(`${fila(ana)} .em-mov`);
    await a.waitForFunction(() => document.querySelectorAll('#tabla-emp-mov').length === 0);
    await a.close();

    // Asistente: solo cuentas y nómina, con Abono y Movimientos
    await api(adm.url, '/api/logout', {});
    await api(adm.url, '/api/login', { usuario: 'Evelyn', clave: 'clave-evelyn' });
    a = await nueva(1366);
    await a.waitForSelector('#nav');
    assert.deepEqual(await a.locator('#nav button[data-vista]').evaluateAll((bs) => bs.map((b) => (b as HTMLElement).dataset.vista)), ['inventario', 'almacen', 'empleadas']);
    await a.click('#nav button[data-vista="empleadas"]');
    await a.waitForSelector('#tabla-empleadas tr[data-emp]');
    assert.deepEqual(await a.locator('[role="tab"]').allTextContents(), ['Cuentas de crédito', 'Nómina']);
    assert.equal(await a.locator('#form-emp-config, #form-emp-ex, .em-limite, .em-ajuste').count(), 0, 'sin porcentajes, límite ni ajustes');
    await a.click(`${fila(rosa)} .em-abono`);
    await a.fill('#ef-monto', '100');
    await a.click('#form-emp button[type="submit"]');
    await a.waitForFunction((f) => document.querySelector(`${f} [data-col="abonos"]`)?.textContent === '$350.00', fila(rosa));
    await a.click(`${fila(rosa)} .em-mov`);
    await a.waitForSelector('#tabla-emp-mov');
    assert.match((await a.textContent('#tabla-emp-mov'))!, /Abono de nómina[\s\S]*Evelyn/);
    assert.deepEqual(errores, []);
  });
});

describe('[navegador real] Administración web en el iPhone: Evelyn (asistente) entra con su cuenta del central', { timeout: 300_000, skip: chromiumPath ? false : 'Chromium no encontrado (defina POS_CHROMIUM)' }, () => {
  it('AS4 de punta a punta: baja solo lo suyo, ve las cuentas, abre los movimientos en la tarjeta de la empleada y registra un abono que llega al central a su nombre', async (t) => {
    const dist = mkdtempSync(join(tmpdir(), 'londuo-admin-'));
    execFileSync(process.execPath, [join(RAIZ, 'scripts', 'construir-admin.mjs')], { stdio: 'pipe', env: { ...process.env, LONDUO_DIST: dist, LONDUO_SUPABASE_URL: URL_CENTRAL, LONDUO_SUPABASE_KEY: 'sb_publishable_prueba' } });
    const db = await centralLocal();
    const sup = await usuario(db, 'edgardo@x.mx', 'supervisor');
    const evelyn = await usuario(db, 'evelyn@x.mx', 'asistente');
    await db.query(`update pos.admins set alias = 'Evelyn' where user_id = $1`, [evelyn]);
    await new ClientePglite(db, sup).subirOps([
      op('cajero.guardado', 'c1', { id: 'caj-ana', nombre: 'Ana', activo: true, sal: 'SAL', hash: 'HASH', tienda: 'DUO' }),
      op('cajero.guardado', 'c2', { id: 'caj-rosa', nombre: 'Rosa', activo: true, sal: 'SAL', hash: 'HASH', tienda: 'LON' }),
      op('empleada.credito', 'e1', { empleada_id: 'caj-ana', limite: 300000, motivo: 'alta', por: 'Edgardo' }),
      op('empleada.credito', 'e2', { empleada_id: 'caj-rosa', limite: 200000, motivo: 'alta', por: 'Edgardo' }),
      op('sale.confirmed', 'v1', { sale_id: 'venta-ana', tienda: 'DUO', caja: 1, folio: 1, cajero: 'Ana', lineas: [{ linea_id: 'l1', item_id: 'i1', qty: 1, importe: 80000, precio_unit: 80000 }], total: 80000, pagos: [{ metodo: 'credito_empleada', empleada_id: 'caj-ana', monto: 80000 }] }),
      op('sale.confirmed', 'v2', { sale_id: 'venta-normal', tienda: 'DUO', caja: 1, folio: 2, cajero: 'Ana', lineas: [{ linea_id: 'l2', item_id: 'i1', qty: 1, importe: 123400, precio_unit: 123400 }], total: 123400, pagos: [{ metodo: 'efectivo', monto: 123400 }] }),
    ]);
    const browser = await chromium.launch({ executablePath: chromiumPath, args: ['--no-sandbox'] });
    t.after(async () => { await browser.close(); rmSync(dist, { recursive: true, force: true }); });
    const ctx = await browser.newContext({ ...IPHONE, viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, colorScheme: 'light' });
    await simularSupabase(ctx, db, { 'evelyn@x.mx': evelyn });
    const page = await ctx.newPage();
    const errores: string[] = [];
    page.on('pageerror', (e) => errores.push(String(e)));
    page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource|net::|403|401/.test(m.text())) errores.push(m.text()); });
    await page.goto(`file://${join(dist, 'administracion.html')}`);
    await page.waitForSelector('#puerta:not([hidden])');
    await page.fill('#pu-correo', 'evelyn@x.mx'); await page.fill('#pu-clave', 'buena'); await page.click('#pu-entrar');
    await page.waitForSelector('#puerta', { state: 'hidden' });
    await page.waitForFunction(() => /Sincronizado/.test(document.querySelector('#estado-nube')?.textContent ?? ''));
    // Su navegación: Inventario, Almacén y Empleadas (nada de Reportes, Cortes ni Configuración)
    await page.click('#isla-menu');
    assert.deepEqual(await page.locator('#menu-hoja button[data-vista]').evaluateAll((bs) => bs.map((b) => (b as HTMLElement).dataset.vista)), ['inventario', 'almacen', 'empleadas']);
    await page.keyboard.press('Escape');
    await irASeccion(page, 'empleadas');
    await page.waitForSelector('#tabla-empleadas tr[data-emp]');
    const ana = '#tabla-empleadas tr[data-emp="caj-ana"]';
    assert.deepEqual(await page.locator('#tabla-empleadas tr[data-emp] td:first-child').allTextContents(), ['Ana', 'Rosa']);
    assert.equal(await page.textContent(`${ana} [data-col="saldo"]`), '$800.00', 'su compra a crédito sí le llegó; la venta normal no');
    assert.equal(await page.locator('.em-limite, .em-ajuste, #form-emp-config').count(), 0);
    // Movimientos: salen dentro de la tarjeta de Ana, no al final de la página
    await page.click(`${ana} .em-mov`);
    await page.waitForSelector('#tabla-emp-mov');
    assert.match((await page.textContent('#tabla-emp-mov'))!, /Compra a crédito folio 000001/);
    assert.equal(await page.evaluate(() => document.querySelector('#tabla-empleadas tr[data-emp="caj-ana"]')!.nextElementSibling!.contains(document.querySelector('#tabla-emp-mov'))), true);
    if (process.env.POS_CAPTURA) await page.screenshot({ path: join(process.env.POS_CAPTURA, 'asistente-movimientos.png') });
    // Abono de nómina de $300
    await page.click(`${ana} .em-abono`);
    await page.fill('#ef-monto', '300');
    if (process.env.POS_CAPTURA) await page.screenshot({ path: join(process.env.POS_CAPTURA, 'asistente-abono.png') });
    await page.click('#form-emp button[type="submit"]');
    await page.waitForFunction((f) => document.querySelector(`${f} [data-col="saldo"]`)?.textContent === '$500.00', ana);
    await page.waitForFunction(() => /Sincronizado/.test(document.querySelector('#estado-nube')?.textContent ?? ''));
    // llegó al central, a nombre de Evelyn y con el origen de su cuenta
    await page.waitForTimeout(500);
    const filas = (await db.query<{ origen: string; payload: any }>(`select origen, payload from pos.ops where tipo = 'empleada.movimiento'`)).rows;
    assert.equal(filas.length, 1);
    assert.deepEqual([filas[0]!.origen.startsWith('admin:'), filas[0]!.payload.por, filas[0]!.payload.tipo, filas[0]!.payload.monto, filas[0]!.payload.empleada_id], [true, 'Evelyn', 'abono', 30000, 'caj-ana']);
    assert.deepEqual(errores, []);
  });
});

test('AS5 si el rol de la cuenta cambia, la réplica guardada se rehace sola (si no, su cursor «al día» dejaría fuera lo de Empleadas) sin perder lo aún no subido', async () => {
  const { iniciarAdminNube } = await import('../src/app/admin-nube.ts');
  const db = await centralLocal();
  const sup = await usuario(db, 'edgardo@x.mx', 'supervisor');
  const eve = await usuario(db, 'evelyn@x.mx', 'almacenista');
  await new ClientePglite(db, sup).subirOps([
    op('cajero.guardado', 'c1', { id: 'caj-ana', nombre: 'Ana', activo: true, sal: 'SAL', hash: 'HASH', tienda: 'DUO' }),
    op('empleada.credito', 'e1', { empleada_id: 'caj-ana', limite: 300000, motivo: 'alta', por: 'Edgardo' }),
    op('item.created', 'i1', { item_id: 'a1', codigo: '7500000000011', item_no: '1', marca: 'X', descripcion: 'BLUSA', estilo: '', lote: '', departamento: 'Dama', precio: 10000 }),
  ]);
  const datos = new Map<string, any>();
  const almacen = { async leer(k: string) { return datos.get(k); }, async escribir(k: string, e: any) { datos.set(k, e); }, async borrar(k: string) { datos.delete(k); } };
  let rol: 'almacenista' | 'asistente' = 'almacenista';
  const cliente = () => {
    const c = () => new ClientePglite(db, eve);
    return { async iniciarSesion() {}, async miPerfil() { return { rol, alias: 'Evelyn', usuario_id: eve }; }, cerrarSesion() {}, subirOps: (o: any) => c().subirOps(o), bajarOps: (d: number, l: number) => c().bajarOps(d, l) };
  };
  // Como almacenista baja su réplica (solo almacén) y la guarda.
  const a1 = iniciarAdminNube({ cliente: cliente(), almacen });
  await a1.entrar('evelyn@x.mx', 'buena');
  assert.equal((await a1.atender('GET', '/api/sesion', undefined)).status, 200);
  assert.equal(datos.size, 1);
  assert.equal(JSON.stringify(datos.get(`replica:${eve}`).ops.map((o: any) => o.tipo).sort()), JSON.stringify(['item.created']));
  // Algo hecho sin internet que aún no se sube: no se debe perder.
  datos.get(`replica:${eve}`).ops.push(op('item.editado', 'pend-1', { item_id: 'a1', cambios: { marca: 'Y' } }));
  datos.get(`replica:${eve}`).outbox.push(['pend-1|central', false]);
  // La suben a asistente: al entrar rehace la réplica y ya ve las cuentas.
  rol = 'asistente';
  await db.query(`update pos.admins set rol = 'asistente' where user_id = $1`, [eve]);
  const a2 = iniciarAdminNube({ cliente: cliente(), almacen });
  await a2.entrar('evelyn@x.mx', 'buena');
  const cuentas = (await a2.atender('GET', '/api/admin/empleadas', undefined)).json as { empleadas: { nombre: string }[] };
  assert.deepEqual(cuentas.empleadas.map((e) => e.nombre), ['Ana']);
  assert.equal(JSON.stringify(datos.get(`replica:${eve}`).kv.find(([k]: [string]) => k === 'rol_replica')), JSON.stringify(['rol_replica', '"asistente"']));
  await a2.sincronizar();
  assert.equal(Number((await db.query<{ n: number }>(`select count(*)::int as n from pos.ops where op_id = 'pend-1'`)).rows[0]!.n), 1, 'lo pendiente se subió');
});
