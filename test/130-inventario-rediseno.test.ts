import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync, existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { chromium, devices, type Browser, type Page } from 'playwright-core';
import { centralLocal, usuario } from './ayudas/central-pglite.ts';
import { simularSupabase, URL_CENTRAL } from './ayudas/supabase-simulado.ts';
import { leerXlsxNode } from '../src/xlsx-node.ts';
import { api, appAdmin, appCajero } from './ayudas/app.ts';
import { ALMACENES, nuevoMundo, politica } from './ayudas/comun.ts';

const RAIZ = join(import.meta.dirname, '..');
const chromiumPath = [process.env.POS_CHROMIUM, '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', '/opt/pw-browsers/chromium/chrome-linux/chrome'].find((p) => p && existsSync(p));
const { defaultBrowserType: _omitido, ...IPHONE } = devices['iPhone 13']!;
void _omitido;
type Atender = { __POS_ATENDER__: (m: string, r: string, c?: unknown) => Promise<{ status: number; json: Record<string, any> }> };

/** Banco local: administración web con un central simulado (sin red) y cuatro artículos. */
async function preparar(t: { after: (f: () => unknown) => void }) {
  const dist = mkdtempSync(join(tmpdir(), 'londuo-admin-'));
  execFileSync(process.execPath, [join(RAIZ, 'scripts', 'construir-admin.mjs')], { stdio: 'pipe', env: { ...process.env, LONDUO_DIST: dist, LONDUO_SUPABASE_URL: URL_CENTRAL, LONDUO_SUPABASE_KEY: 'sb_publishable_prueba' } });
  const db = await centralLocal();
  const edgardo = await usuario(db, 'edgardo@x.mx', 'supervisor');
  const browser = await chromium.launch({ executablePath: chromiumPath, args: ['--no-sandbox'] });
  t.after(async () => { await browser.close(); rmSync(dist, { recursive: true, force: true }); });
  const abrir = async (opciones: Parameters<Browser['newContext']>[0]) => {
    const ctx = await browser.newContext(opciones);
    await simularSupabase(ctx, db, { 'edgardo@x.mx': edgardo });
    const page = await ctx.newPage();
    const errores: string[] = [];
    page.on('pageerror', (e) => errores.push(String(e)));
    page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource|net::/.test(m.text())) errores.push(m.text()); });
    await page.goto(`file://${join(dist, 'administracion.html')}`);
    await page.waitForSelector('#puerta:not([hidden])');
    await page.fill('#pu-correo', 'edgardo@x.mx'); await page.fill('#pu-clave', 'buena'); await page.click('#pu-entrar');
    await page.waitForSelector('#puerta', { state: 'hidden' });
    await page.waitForFunction(() => /Sincronizado/.test(document.querySelector('#estado-nube')?.textContent ?? ''));
    return { page, errores };
  };
  const alta = (page: Page, codigo: string, desc: string, marca: string, estilo: string, lote: string, precio: number, depto = 'Dama') =>
    page.evaluate(async (d) => (await (window as unknown as Atender).__POS_ATENDER__('POST', '/api/admin/almacen/manual', { lote_id: `m-${d.codigo}`, cantidad: 40, codigo: d.codigo, descripcion: d.desc, marca: d.marca, estilo: d.estilo, lote: d.lote, precio: d.precio, departamento: d.depto })).status, { codigo, desc, marca, estilo, lote, precio, depto });
  const sembrar = async (page: Page) => {
    assert.equal(await alta(page, '7500000000011', 'BLUSA', 'LEVIS', '123L', '20261014', 499), 200);
    assert.equal(await alta(page, '7500000000028', 'BLUSA', 'LEVIS', '123L-N', '20261015', 799), 200);
    assert.equal(await alta(page, '7500000000035', 'FALDA', 'ZESTINI', 'ABC9', '0', 299), 200);
    assert.equal(await alta(page, '7500000000042', 'BOLSA', 'ZESTINI', 'Z1', '20261016', 1299), 200);
  };
  return { abrir, sembrar };
}
const ir = async (page: Page) => { await page.click('#nav button[data-vista="inventario"]'); await page.waitForSelector('#inv-q'); };
const filasDe = (page: Page) => page.locator('#tabla-inv-lista tbody tr[data-item]');
const buscar = async (page: Page, q: string, n: number) => {
  await page.fill('#inv-q', q);
  await page.waitForFunction((k) => document.querySelectorAll('#tabla-inv-lista tbody tr[data-item]').length === k, n, { timeout: 8000 }).catch(async () => { throw new Error(`«${q}»: se esperaban ${n} y hay ${await filasDe(page).count()}`); });
};

describe('[navegador real] Inventario rediseñado: todo lo anterior sigue funcionando', { timeout: 300_000, skip: chromiumPath ? false : 'Chromium no encontrado' }, () => {
  it('IN1 jerarquía nueva, contador real, sintaxis avanzada del buscador, Filtros, Ordenar, Seleccionar, Resumen, Ayuda y menú de Excel (escritorio)', async (t) => {
    const { abrir, sembrar } = await preparar(t);
    const { page, errores } = await abrir({ viewport: { width: 1280, height: 900 }, acceptDownloads: true });
    await sembrar(page);
    await ir(page);
    await filasDe(page).first().waitFor();
    // Jerarquía: título › buscador › tres botones › contador › lista; nada de resumen ni botón grande de Excel antes del buscador.
    const y = await page.evaluate(() => ['.inv-titulo', '#inv-q', '#inv-filtros', '#inv-contador', '#inv-res'].map((s) => Math.round(document.querySelector(s)!.getBoundingClientRect().top)));
    assert.deepEqual([...y].sort((a, b) => a - b), y, `orden vertical: ${y}`);
    assert.equal(await page.locator('#tabla-inv-resumen').count(), 0, 'el resumen ya no está al principio');
    assert.equal(await page.locator('#btn-exportar').isVisible(), false, 'la exportación está en el menú de tres puntos');
    assert.equal(await page.textContent('#inv-contador'), '4 artículos', 'contador real');
    // Los tres botones: textos completos y mismo tamaño.
    assert.deepEqual(await page.$$eval('.inv-acciones .btn span', (e) => e.map((x) => x.textContent)), ['Filtros', 'Ordenar', 'Seleccionar']);
    const cajas = await page.$$eval('.inv-acciones .btn', (b) => b.map((x) => { const r = x.getBoundingClientRect(); return [Math.round(r.width), Math.round(r.height)]; }));
    assert.ok(cajas.every((c) => c[0] === cajas[0]![0] && c[1] === cajas[0]![1]), `tres botones iguales: ${JSON.stringify(cajas)}`);
    // Sintaxis avanzada y combinada (la que ya existía): cada una con su resultado exacto.
    const casos: [string, number][] = [
      ['Marca=levis', 2], ['Lote=0', 1], ['Lote=sin', 1], ['Precio>500', 2], ['Precio>=799', 2], ['Precio<300', 1], ['Estilo=123L', 2], ['Depto=dama', 4],
      ['Alm>0', 4], ['Alm>100', 0], ['Limbo>0', 0], ['Codigo=834', 0], ['Codigo=7500000000042', 1], ['Desc=bolsa', 1],
      ['levis Precio>=500', 1], ['Marca="zestini" Precio<1000', 1], ['blusa 123L-N', 1], ['marca = levis', 2], ['MARCA:LEVIS lote=20261014', 1], ['foo=bar', 0],
    ];
    for (const [q, n] of casos) await buscar(page, q, n);
    assert.equal(await page.textContent('#inv-contador'), '0 artículos · de 4');
    await buscar(page, '', 4);
    // Filtros: se integran con el buscador (escriben campo=valor) y conservan lo que ya estaba escrito.
    await buscar(page, 'blusa Precio>200', 2);
    await page.click('#inv-filtros');
    await page.waitForSelector('#dlg-inv-filtros[open]');
    await page.fill('#fi-marca', 'levis'); await page.fill('#fi-precio-min', '500');
    await page.click('#form-inv-filtros button[type="submit"]');
    await page.waitForFunction(() => document.querySelectorAll('#tabla-inv-lista tbody tr[data-item]').length === 1);
    assert.equal(await page.inputValue('#inv-q'), 'blusa Precio>200 marca=levis precio>=500', 'lo escrito se conserva y se agregan los filtros');
    await page.click('#inv-filtros');
    assert.equal(await page.inputValue('#fi-marca'), 'levis', 'los filtros se leen del buscador');
    assert.equal(await page.inputValue('#fi-precio-min'), '500');
    await page.click('#fi-limpiar');
    await page.waitForFunction(() => document.querySelectorAll('#tabla-inv-lista tbody tr[data-item]').length === 2);
    assert.equal(await page.inputValue('#inv-q'), 'blusa Precio>200', 'Limpiar solo quita lo que los Filtros manejan');
    await page.click('#inv-filtros');
    await page.selectOption('#fi-depto', 'Dama'); await page.check('#fi-alm'); await page.fill('#fi-lote', '0');
    await page.click('#form-inv-filtros button[type="submit"]');
    await page.waitForFunction(() => document.querySelectorAll('#tabla-inv-lista tbody tr[data-item]').length === 0);
    assert.match(await page.inputValue('#inv-q'), /depto=Dama.*alm>0/);
    await buscar(page, '', 4);
    // Ordenar: todas las opciones de antes, la actual marcada.
    await page.click('#inv-ordenar');
    assert.deepEqual(await page.$$eval('#dlg-inv-orden [data-orden]', (b) => b.map((x) => (x as HTMLElement).dataset.orden)), ['nuevo', 'viejo', 'abc', 'marca', 'estilo', 'lote', 'cara', 'barata']);
    assert.equal(await page.getAttribute('#dlg-inv-orden [data-orden="nuevo"]', 'aria-checked'), 'true');
    await page.click('#dlg-inv-orden [data-orden="cara"]');
    await page.waitForFunction(() => /\$1,299/.test(document.querySelector('#tabla-inv-lista tbody tr[data-item]')?.textContent ?? ''));
    await page.click('#inv-ordenar'); await page.click('#dlg-inv-orden [data-orden="barata"]');
    await page.waitForFunction(() => /\$299/.test(document.querySelector('#tabla-inv-lista tbody tr[data-item]')?.textContent ?? ''));
    // Seleccionar: casillas, herramientas de la selección y cancelar.
    await page.click('#inv-sel-modo');
    await page.waitForSelector('#inv-sel:not([hidden])');
    assert.equal(await page.textContent('#inv-sel-modo span'), 'Cancelar');
    await page.check('#tabla-inv-lista input[data-sel] >> nth=0'); await page.check('#tabla-inv-lista input[data-sel] >> nth=1');
    assert.equal(await page.textContent('#sel-n'), '2');
    for (const id of ['#sel-todo', '#sel-nada', '#sel-almacen', '#sel-baja']) assert.equal(await page.locator(id).count(), 1, id);
    await page.click('#sel-todo');
    assert.equal(await page.textContent('#sel-n'), '4');
    await page.click('#inv-sel-modo');
    assert.equal(await page.locator('#inv-sel').isVisible(), false);
    assert.equal(await page.locator('#tabla-inv-lista input[data-sel]').count(), 0, 'vuelve la navegación normal');
    assert.equal(await page.textContent('#inv-sel-modo span'), 'Seleccionar');
    // Resumen: todos los indicadores de antes.
    await page.click('#inv-resumen-btn');
    await page.waitForSelector('#tabla-inv-resumen');
    assert.deepEqual(await page.$$eval('#tabla-inv-resumen [data-campo]', (e) => e.map((x) => [(x as HTMLElement).dataset.campo, x.textContent])), [['articulos', '4'], ['con_codigo', '4'], ['sin_codigo', '0'], ['precio_no_vendible', '0']]);
    assert.equal(await page.locator('#tabla-inv-tiendas tbody tr[data-tienda="LIMBO"]').count(), 1);
    assert.match(await page.textContent('#tabla-inv-tiendas thead') ?? '', /Sin verificar/);
    await page.click('#resumen-cerrar');
    // Ayuda: la sintaxis real con ejemplos.
    await page.click('#inv-ayuda');
    const ayuda = (await page.textContent('#dlg-inv-ayuda'))!;
    for (const ej of ['Lote=202610', 'Lote=0', 'Marca=levis', 'Estilo=123L', 'Depto=dama', 'Precio>200', 'Limbo>0']) assert.ok(ayuda.includes(ej), ej);
    await page.click('#ayuda-inv-ok');
    // Exportar: menú de tres puntos (se cierra con Esc) y el mismo archivo de siempre.
    await page.click('#inv-menu');
    assert.equal(await page.locator('#btn-exportar').isVisible(), true);
    await page.keyboard.press('Escape');
    assert.equal(await page.locator('#btn-exportar').isVisible(), false);
    const [descarga] = await Promise.all([page.waitForEvent('download'), (async () => { await page.click('#inv-menu'); await page.click('#btn-exportar'); })()]);
    assert.equal(descarga.suggestedFilename(), 'inventario.xlsx');
    assert.equal((await leerXlsxNode(readFileSync((await descarga.path())!)))[0]!.filas.length, 5, 'encabezado + 4 artículos');
    // Tocar un artículo abre su detalle (editar, Historial, promoción).
    await filasDe(page).first().click();
    await page.waitForSelector('#form-articulo');
    for (const id of ['#art-historial', '#art-promo', '#art-guardar', '#art-existencias']) assert.equal(await page.locator(id).count(), 1, id);
    await page.click('#art-historial');
    await page.waitForSelector('#tabla-art-historial');
    assert.deepEqual(errores, []);
  });

  it('IN2 móvil (iPhone): tarjetas con existencias en rojo si son negativas, tres botones iguales sin recortes en 320, 375, 390 y 430 px, modo claro y oscuro', async (t) => {
    const { abrir, sembrar } = await preparar(t);
    for (const [ancho, esquema] of [[390, 'dark'], [390, 'light'], [375, 'dark'], [320, 'dark'], [430, 'dark']] as const) {
      const { page, errores } = await abrir({ ...IPHONE, viewport: { width: ancho, height: 844 }, deviceScaleFactor: 2, colorScheme: esquema });
      if (esquema === 'dark' && ancho === 390) await sembrar(page);
      await ir(page);
      await page.waitForSelector('#lista-inv .fila-inv');
      const dims = await page.$$eval('.inv-acciones .btn', (b) => b.map((x) => { const r = x.getBoundingClientRect(); const s = x.querySelector('span')!.getBoundingClientRect(); return { ancho: Math.round(r.width), alto: Math.round(r.height), y: Math.round(r.top), corta: x.scrollWidth > x.clientWidth || s.right > r.right + 0.5 || s.left < r.left - 0.5 }; }));
      assert.ok(dims.every((d) => d.ancho === dims[0]!.ancho && d.alto === dims[0]!.alto && d.y === dims[0]!.y && !d.corta), `${ancho}px: tres botones iguales y sin recortar ${JSON.stringify(dims)}`);
      const pag = await page.evaluate(() => ({ pagina: document.documentElement.scrollWidth, ventana: window.innerWidth }));
      assert.ok(pag.pagina <= pag.ventana + 1, `${ancho}px sin desborde horizontal: ${JSON.stringify(pag)}`);
      const buscador = (await page.locator('#inv-q').boundingBox())!;
      assert.ok(buscador.width >= ancho * 0.6 && buscador.height >= 44, `buscador grande: ${JSON.stringify(buscador)}`);
      const ph = await page.evaluate(() => { const i = document.querySelector('#inv-q') as HTMLInputElement; const m = document.createElement('span'); const c = getComputedStyle(i, '::placeholder'); m.style.cssText = `position:absolute;visibility:hidden;white-space:nowrap;font:${c.fontStyle} ${c.fontWeight} ${c.fontSize} ${c.fontFamily}`; m.textContent = i.placeholder; document.body.appendChild(m); const r = { texto: m.getBoundingClientRect().width, hueco: i.clientWidth - parseFloat(getComputedStyle(i).paddingLeft) - parseFloat(getComputedStyle(i).paddingRight) }; m.remove(); return r; });
      assert.ok(ph.texto <= ph.hueco, `el texto del buscador cabe completo (${Math.round(ph.texto)} de ${Math.round(ph.hueco)} px)`);
      // La tarjeta trae descripción, precio, marca · estilo, Item #, código y las cuatro existencias.
      const t1 = (await page.locator('#lista-inv .fila-inv').first().textContent())!;
      assert.match(t1, /\$[\d,]+\.\d\d/); assert.match(t1, /#\d+/); assert.match(t1, /DUO \d+/); assert.match(t1, /LON \d+/); assert.match(t1, /Alm \d+/); assert.match(t1, /Limbo \d+/);
      // Existencias: el negativo sale en rojo y El Limbo con piezas, resaltado (se comprueba el estilo real de las tarjetas con un renglón de muestra).
      const est = await page.evaluate(() => {
        const f = document.querySelector('#lista-inv .fila-inv')!.cloneNode(true) as HTMLElement;
        f.querySelector('.fi-ex')!.innerHTML = '<span class="neg">DUO -2</span><span class="hay-limbo">Limbo 9</span><span>LON 0</span>';
        document.querySelector('#lista-inv')!.appendChild(f);
        const [n, l, c] = [...f.querySelectorAll('.fi-ex span')].map((x) => getComputedStyle(x));
        const rojo = getComputedStyle(document.documentElement).getPropertyValue('--error').trim();
        const sw = document.createElement('i'); sw.style.color = rojo; document.body.appendChild(sw);
        const res = { neg: n!.color, rojo: getComputedStyle(sw).color, limboFondo: l!.backgroundColor, acento: (() => { sw.style.color = getComputedStyle(document.documentElement).getPropertyValue('--acento').trim(); return getComputedStyle(sw).color; })(), normal: c!.backgroundColor };
        f.remove(); sw.remove(); return res;
      });
      assert.equal(est.neg, est.rojo, 'negativo en rojo'); assert.equal(est.limboFondo, est.acento, 'Limbo con piezas resaltado'); assert.notEqual(est.normal, est.acento);
      if (ancho === 390) await page.screenshot({ path: join(RAIZ, 'docs', 'capturas', `inventario-rediseno-${esquema}.png`) });
      for (const [abrir, id, cerrar] of [['#inv-filtros', '#dlg-inv-filtros', '#fi-cerrar'], ['#inv-ordenar', '#dlg-inv-orden', '#orden-cerrar']] as const) {
        await page.click(abrir);
        await page.waitForSelector(`${id}[open]`);
        const dim = await page.evaluate((s) => { const d = document.querySelector(s) as HTMLElement; const r = d.getBoundingClientRect(); return { scroll: d.scrollWidth, ancho: d.clientWidth, izq: r.left, der: r.right, ventana: window.innerWidth }; }, id);
        assert.ok(dim.scroll <= dim.ancho + 1 && dim.izq >= 0 && dim.der <= dim.ventana + 1, `${ancho}px: ${id} cabe sin deslizar de lado ${JSON.stringify(dim)}`);
        if (ancho === 390 && esquema === 'dark') await page.screenshot({ path: join(RAIZ, 'docs', 'capturas', `inventario-${id.replace('#dlg-inv-', '')}-dark.png`) });
        await page.click(cerrar);
      }
      await page.click('#inv-filtros'); await page.click('#fi-ayuda');
      assert.match((await page.textContent('#dlg-inv-ayuda'))!, /Precio>200/, 'la ayuda de búsqueda se abre desde Filtros');
      assert.deepEqual(errores, []);
    }
  });

  it('IN3 el código de barras se edita, no se repite ni queda vacío, se reindexa para buscarlo y queda en el historial', async (t) => {
    const { abrir, sembrar } = await preparar(t);
    const { page, errores } = await abrir({ viewport: { width: 1280, height: 900 } });
    await sembrar(page);
    await ir(page);
    await buscar(page, '7500000000011', 1);
    await filasDe(page).first().click();
    await page.waitForSelector('#form-articulo');
    assert.equal(await page.inputValue('#art-codigo'), '7500000000011', 'el código ahora es un campo editable');
    // repetido → se rechaza con el nombre del dueño; vacío → se rechaza; ninguno cambia nada
    await page.fill('#art-codigo', '7500000000028'); await page.click('#art-guardar');
    await page.waitForFunction(() => /ya pertenece/.test(document.querySelector('#msg-art')?.textContent ?? ''));
    await page.fill('#art-codigo', ''); await page.click('#art-guardar');
    await page.waitForFunction(() => /no puede quedar vacío/.test(document.querySelector('#msg-art')?.textContent ?? ''));
    await page.fill('#art-codigo', '75 000'); await page.click('#art-guardar');
    await page.waitForFunction(() => /sin espacios/.test(document.querySelector('#msg-art')?.textContent ?? ''));
    // un código válido se guarda junto con otros cambios
    await page.fill('#art-codigo', '7509999999991'); await page.fill('#art-estilo', '123L-X');
    assert.equal(await page.locator('#art-codigo-nota').isVisible(), true, 'avisa que cambia para todas las cajas');
    await page.click('#art-guardar');
    await page.waitForFunction(() => /guardado/.test(document.querySelector('#inv-msg')?.textContent ?? ''));
    await buscar(page, '7509999999991', 1);
    await buscar(page, 'Codigo=7509999999991', 1);
    await buscar(page, '7500000000011', 0);
    await buscar(page, '7500000000011 ', 0);
    await buscar(page, '', 4);
    await buscar(page, '7509999999991', 1);
    await filasDe(page).first().click();
    await page.waitForSelector('#form-articulo');
    assert.equal(await page.inputValue('#art-codigo'), '7509999999991');
    assert.equal(await page.inputValue('#art-estilo'), '123L-X');
    await page.click('#art-historial');
    await page.waitForSelector('#tabla-art-historial');
    const hist = (await page.textContent('#tabla-art-historial'))!;
    assert.match(hist, /Código de barras: «7500000000011» → «7509999999991»/);
    assert.match(hist, /Estilo: «123L» → «123L-X»/);
    assert.deepEqual(errores, []);
  });

  it('IN4 una caja escanea con el código nuevo y el anterior deja de encontrarlo; el almacenista también puede editarlo', async (t) => {
    const ctx = nuevoMundo(ALMACENES.find((a) => a.nombre === 'sqlite')!, politica());
    const adm = await appAdmin(ctx);
    const caja = await appCajero(ctx, 'DUO', 1, 'Ana');
    t.after(async () => { await adm.cerrar(); await caja.cerrar(); ctx.limpiar(); });
    await api(adm.url, '/api/admin/administradores', { nombre: 'Edgardo', clave: 'clave-segura', clave_caja: '2468' });
    await api(adm.url, '/api/admin/administradores', { nombre: 'Gabo', clave: 'clave-gabo', rol: 'almacenista' });
    await api(adm.url, '/api/admin/cajeros', { nombre: 'Ana', clave: '4321' });
    for (let i = 0; i < 4; i++) ctx.m.pump();
    assert.equal((await api(caja.url, '/api/login', { usuario: 'Ana', clave: '4321' })).status, 200);
    const VIEJO = '0002026090782', NUEVO = '8888800000001';
    await api(adm.url, '/api/logout', {});
    assert.equal((await api(adm.url, '/api/login', { usuario: 'Gabo', clave: 'clave-gabo' })).status, 200);
    const art = (await api(adm.url, `/api/admin/articulos?todos=1&q=${VIEJO}`)).json.articulos[0];
    assert.equal(art.codigo, VIEJO);
    const rep = await api(adm.url, '/api/admin/articulos', { item_id: art.item_id, cambios: { codigo: art.codigo } });
    assert.equal(rep.status, 200, 'mandar el mismo código no es un cambio ni un error');
    const otro = (await api(adm.url, '/api/admin/articulos?todos=1&limite=50')).json.articulos.find((a: any) => a.item_id !== art.item_id);
    const choque = await api(adm.url, '/api/admin/articulos', { item_id: art.item_id, cambios: { codigo: otro.codigo } });
    assert.ok(choque.status >= 400 && choque.json.error.codigo === 'CODIGO_EXISTE', `un código repetido se rechaza: ${JSON.stringify(choque.json)}`);
    const ok = await api(adm.url, '/api/admin/articulos', { item_id: art.item_id, cambios: { codigo: NUEVO } });
    assert.equal(ok.status, 200, JSON.stringify(ok.json));
    for (let i = 0; i < 4; i++) ctx.m.pump();
    const c = (await api(caja.url, '/api/venta/nueva', {})).json.cart;
    const nuevo = await api(caja.url, '/api/venta/escanear', { cart: c, codigo: NUEVO });
    assert.equal(nuevo.status, 200, JSON.stringify(nuevo.json));
    const viejo = await api(caja.url, '/api/venta/escanear', { cart: c, codigo: VIEJO });
    assert.equal(viejo.json.resultado, 'no_encontrado', 'el código anterior ya no encuentra el artículo');
  });
});
