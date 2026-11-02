import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { chromium, devices, type Browser, type Page } from 'playwright-core';
import { centralLocal, usuario } from './ayudas/central-pglite.ts';
import { simularSupabase, URL_CENTRAL } from './ayudas/supabase-simulado.ts';
import { irASeccion } from './ayudas/navegacion.ts';

const RAIZ = join(import.meta.dirname, '..');
const chromiumPath = [process.env.POS_CHROMIUM, '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', '/opt/pw-browsers/chromium/chrome-linux/chrome'].find((p) => p && existsSync(p));
const { defaultBrowserType: _omitido, ...IPHONE } = devices['iPhone 13']!;
void _omitido;
const VIEWPORT_PRO_MAX = { width: 440, height: 956 }; // iPhone Pro Max: píxeles CSS, no los de la captura física

async function preparar(t: { after: (f: () => unknown) => void }) {
  const dist = mkdtempSync(join(tmpdir(), 'londuo-admin-'));
  execFileSync(process.execPath, [join(RAIZ, 'scripts', 'construir-admin.mjs')], { stdio: 'pipe', env: { ...process.env, LONDUO_DIST: dist, LONDUO_SUPABASE_URL: URL_CENTRAL, LONDUO_SUPABASE_KEY: 'sb_publishable_prueba' } });
  const db = await centralLocal();
  const edgardo = await usuario(db, 'edgardo@x.mx', 'supervisor');
  let folio = 0;
  const venta = async (fecha: string, hora: string, pesos: number, tienda = 'DUO', caja = 1, vendedora = 'Ana') => {
    const utc = new Date(Date.parse(`${fecha}T${hora}:00Z`) + 7 * 3600_000).toISOString();
    const id = `v${++folio}`;
    const payload = { sale_id: id, tienda, caja, folio, cajero: 'Caja', vendedora_id: `id-${vendedora}`, vendedora, lineas: [{ linea_id: `${id}-1`, item_id: 'i1', qty: 1, importe: pesos * 100, precio_unit: pesos * 100 }], total: pesos * 100, pagos: [{ metodo: tienda === 'DUO' && caja === 2 ? 'tarjeta' : 'efectivo', monto: pesos * 100 }] };
    await db.query(`insert into pos.ops (op_id, tipo, tienda, caja, origen, ocurrio_en, payload) values ($1, 'sale.confirmed', $2, $3, $4, $5, $6::jsonb)`, [`sale.confirmed:${id}`, tienda, caja, `caja:${tienda}/${caja}`, utc, JSON.stringify(payload)]);
  };
  // 2026: un año con 8 meses de venta (marzo el más alto), dos tiendas, tres cajas y dos vendedoras.
  const montos = [310245, 382306, 556180, 511991, 441361, 357810, 258023, 434369];
  for (const [i, m] of montos.entries()) {
    const mes = String(i + 1).padStart(2, '0');
    await venta(`2026-${mes}-05`, '10:30', Math.round(m * 0.6), 'DUO', 1, 'Ana');
    await venta(`2026-${mes}-12`, '15:10', Math.round(m * 0.3), 'DUO', 2, 'Bea');
    await venta(`2026-${mes}-20`, '17:45', m - Math.round(m * 0.6) - Math.round(m * 0.3), 'LON', 1, 'Ana');
  }
  await venta('2026-03-02', '09:15', 2000, 'DUO', 1, 'Ana');
  await db.query(`insert into pos.ops (op_id, tipo, tienda, caja, origen, ocurrio_en, payload) values ('hist:DUO/1:52346', 'venta.historica', null, null, 'admin', now(), $1::jsonb)`, [JSON.stringify({ hist_id: 'hist:DUO/1:52346', tienda_hist: 'DUO', caja_hist: 1, folio: 52346, fecha: '2026-09-02', tipo_hist: 'venta', piezas: 1, total: 150000, pago: 'tarjeta', pago_original: 'Credit Card', fuente: 'POS anterior' })]);
  const browser = await chromium.launch({ executablePath: chromiumPath, args: ['--no-sandbox'] });
  t.after(async () => { await browser.close(); rmSync(dist, { recursive: true, force: true }); });
  const abrir = async (opciones: Parameters<Browser['newContext']>[0]) => {
    const ctx = await browser.newContext({ acceptDownloads: true, ...opciones });
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
    await irASeccion(page, 'analisis');
    await page.waitForSelector('#an-resultado .an-kpis');
    await page.selectOption('#an-anio', '2026');
    await page.waitForFunction(() => document.querySelectorAll('#an-tabla tbody tr[data-i]').length === 12);
    return { page, errores };
  };
  return { abrir };
}
const caja = (page: Page, sel: string) => page.evaluate((s) => { const r = document.querySelector(s)!.getBoundingClientRect(); return { x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) }; }, sel);
const tam = (page: Page, sel: string) => page.evaluate((s) => parseFloat(getComputedStyle(document.querySelector(s)!).fontSize), sel);

describe('[navegador real] Análisis de ventas en el teléfono', { timeout: 300_000, skip: chromiumPath ? false : 'Chromium no encontrado' }, () => {
  it('AM1 filtros compactos y plegables, chips de cajas, indicadores, gráfica y tabla; todo lo funcional intacto (iPhone Pro Max, 440 px)', async (t) => {
    const { abrir } = await preparar(t);
    const { page, errores } = await abrir({ ...IPHONE, viewport: VIEWPORT_PRO_MAX, deviceScaleFactor: 2, colorScheme: 'light' });
    // — Filtros: tarjeta con icono, título y chevrón; Periodo/Año y Desglose/Ver en pareja, Medir a todo el ancho.
    assert.equal((await page.textContent('#an-toggle .an-cab-tit'))!.trim(), 'Filtros');
    assert.equal(await page.getAttribute('#an-toggle', 'aria-expanded'), 'true');
    const [per, anio, desg, ver, med] = await Promise.all(['#an-l-rango', '#an-l-anio', '#an-desglose', '#an-agrupar', '#an-l-metrica'].map((s) => caja(page, s)));
    assert.ok(per!.y === anio!.y && per!.x < anio!.x, 'Periodo y Año en la misma fila');
    assert.ok(desg!.y === ver!.y && desg!.x < ver!.x, 'Desglose y Ver en la misma fila');
    assert.ok(med!.y > ver!.y && med!.w > per!.w * 1.8, 'Medir a todo el ancho, debajo');
    const altoSel = await caja(page, '#an-agrupar'); assert.ok(altoSel.h >= 44, `selectores táctiles (${altoSel.h}px)`);
    // Todas las opciones de antes siguen en la lista.
    assert.deepEqual(await page.$$eval('#an-agrupar option', (o) => o.map((x) => (x as HTMLOptionElement).value)), ['anio', 'mes', 'semana', 'dia', 'dia_semana', 'hora', 'mapa_calor', 'forma_pago', 'caja', 'tienda']);
    assert.deepEqual(await page.$$eval('#an-metrica option', (o) => o.map((x) => (x as HTMLOptionElement).value)), ['total', 'tickets', 'piezas', 'promedio_ticket', 'promedio_dia']);
    assert.deepEqual(await page.$$eval('#an-rango option', (o) => o.map((x) => (x as HTMLOptionElement).value)), ['anio', 'mes', 'ult30', 'personalizado']);
    assert.deepEqual(await page.$$eval('#an-desglose option', (o) => o.map((x) => (x as HTMLOptionElement).value)), ['todo', 'empleada']);
    // — Chips de cajas: 5, seleccionados distinguibles, y la lógica de siempre (individual y «Todas»).
    assert.deepEqual(await page.$$eval('.an-chips .chip span', (c) => c.map((x) => x.textContent)), ['Todas', 'DUO · Caja 1', 'DUO · Caja 2', 'LON · Caja 1', 'LON · Caja 2']);
    const fondo = (sel: string) => page.$eval(sel, (e) => getComputedStyle(e).backgroundColor);
    const marcado = await fondo('.an-chips .chip:has(#an-todas)');
    const totalTodas = (await page.textContent('.an-kpi-total b'))!;
    await page.uncheck('#an-todas');
    await page.waitForFunction(() => /Seleccione al menos una caja/.test(document.querySelector('#an-resultado')?.textContent ?? ''));
    assert.notEqual(await fondo('.an-chips .chip:has(#an-todas)'), marcado, 'un chip desmarcado se ve distinto');
    await page.check('.an-caja[value="DUO/2"]');
    await page.waitForFunction((v) => document.querySelector('.an-kpi-total b')?.textContent !== v && !!document.querySelector('.an-kpi-total b'), totalTodas);
    const soloDuo2 = await page.textContent('.an-kpi-total b');
    await page.check('#an-todas');
    await page.waitForFunction((v) => document.querySelector('.an-kpi-total b')?.textContent === v, totalTodas);
    assert.notEqual(soloDuo2, totalTodas);
    // — Históricas (suman en septiembre) y su fila limpia.
    const conHist = await page.textContent('.an-kpi-total b');
    await page.uncheck('#an-hist');
    await page.waitForFunction((v) => document.querySelector('.an-kpi-total b')?.textContent !== v, conHist);
    await page.check('#an-hist');
    await page.waitForFunction((v) => document.querySelector('.an-kpi-total b')?.textContent === v, conHist);
    // — Indicadores: Total vendido (hero, el valor más grande), cuatro tarjetas en dos columnas y Mejor mes (naranja).
    const fs = { hero: await tam(page, '.an-kpi-total b'), k: await tam(page, '.an-kpi:not(.an-kpi-total):not(.an-kpi-mejor) b'), h1: await tam(page, '.an-titulo h1'), etiqueta: await tam(page, '.an-kpi span'), mejor: await tam(page, '.an-kpi-mejor b') };
    assert.ok(fs.hero >= 34 && fs.hero > fs.k && fs.k >= 18 && fs.k <= 23 && fs.h1 >= 24 && fs.etiqueta >= 13 && fs.mejor >= 18 && fs.mejor <= 22, JSON.stringify(fs));
    const ks = await page.$$eval('.an-kpi:not(.an-kpi-total):not(.an-kpi-mejor)', (k) => k.map((e) => { const r = e.getBoundingClientRect(); return { x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) }; }));
    assert.equal(ks.length, 4); assert.ok(ks[0]!.y === ks[1]!.y && ks[2]!.y === ks[3]!.y && ks[2]!.y > ks[0]!.y && ks[0]!.w === ks[1]!.w, `2×2: ${JSON.stringify(ks)}`);
    assert.deepEqual(await page.$$eval('.an-kpi:not(.an-kpi-total):not(.an-kpi-mejor) > span', (e) => e.map((x) => x.textContent)), ['Tickets', 'Piezas', 'Ticket promedio', 'Días con ventas']);
    const partidos = await page.evaluate(() => [...document.querySelectorAll('.an-kpi b, .an-kpi small')].filter((c) => { const r = document.createRange(); r.selectNodeContents(c); return new Set([...r.getClientRects()].map((q) => Math.round(q.top))).size > 1 && c.tagName === 'B'; }).map((c) => c.textContent));
    assert.deepEqual(partidos, [], 'ningún valor de los indicadores se parte en varias líneas');
    assert.match((await page.textContent('.an-kpi-mejor'))!, /Mejor mes\s*marzo 2026/);
    assert.equal(await page.locator('.an-kpi-total .an-ico svg').count(), 1); assert.equal(await page.locator('.an-kpi-mejor .an-ico svg').count(), 1);
    const colores = await page.evaluate(() => ({ mejor: getComputedStyle(document.querySelector('.an-kpi-mejor')!).backgroundColor, base: getComputedStyle(document.querySelector('.an-kpi:not(.an-kpi-total):not(.an-kpi-mejor)')!).backgroundColor }));
    assert.notEqual(colores.mejor, colores.base, 'Mejor mes con acento propio');
    // — Gráfica: 12 barras, la mayor en naranja, etiquetas abreviadas sin encimarse, y el monto exacto al tocar una barra.
    assert.equal(await page.locator('#an-grafica .gb').count(), 12);
    const barras = await page.evaluate(() => [...document.querySelectorAll('#an-grafica .gb')].map((b) => { const bar = b.querySelector('.gb-barra')!; const v = b.querySelector('.gb-valor') as HTMLElement; const r = b.getBoundingClientRect(); const cs = getComputedStyle(v, '::after'); const c = document.createElement('canvas').getContext('2d')!; c.font = `${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`; return { centro: r.left + r.width / 2, color: getComputedStyle(bar).backgroundImage, corto: v.dataset.corto ?? '', ancho: v.dataset.corto ? c.measureText(v.dataset.corto).width : 0, mejor: b.classList.contains('mejor'), eti: (b.querySelector('.gb-eti') as HTMLElement).textContent }; }));
    assert.equal(barras.filter((b) => b.mejor).length, 1); assert.equal(barras.find((b) => b.mejor)!.eti, 'mar');
    assert.notEqual(barras.find((b) => b.mejor)!.color, barras.find((b) => !b.mejor)!.color, 'la barra mayor es naranja y las demás turquesa');
    assert.match(barras.find((b) => b.mejor)!.corto, /^\d+k$/);
    for (let i = 1; i < barras.length; i++) { if (barras[i]!.corto && barras[i - 1]!.corto) assert.ok(barras[i]!.centro - barras[i - 1]!.centro >= (barras[i]!.ancho + barras[i - 1]!.ancho) / 2 - 1, `etiquetas ${i - 1} y ${i} encimadas`); }
    await page.click('#an-grafica .gb:nth-child(3)');
    assert.match((await page.textContent('#an-detalle'))!, /marzo 2026 · \$[\d,]+\.\d\d · 4 tickets/);
    // — Tabla: todas las filas (12, no 5), importes en una sola línea, mejor mes resaltado, total, y detalle desplegable por fila.
    assert.equal(await page.locator('#an-tabla tbody tr[data-i]').count(), 12);
    assert.equal((await page.textContent('#an-tabla tr.fila-total td:nth-child(5)'))!.trim(), (await page.textContent('.an-kpi-total b'))!.trim(), 'el total de la tabla es el del indicador');
    const envueltos = await page.evaluate(() => [...document.querySelectorAll('#an-tabla tbody td.num, #an-tabla td[data-etiqueta]')].filter((c) => { const r = document.createRange(); r.selectNodeContents(c); return new Set([...r.getClientRects()].map((x) => Math.round(x.top))).size > 1; }).map((c) => c.textContent));
    assert.deepEqual(envueltos, [], 'sin importes ni nombres partidos en varias líneas');
    assert.equal(await page.locator('#an-tabla tr.fila-mejor').count(), 1);
    assert.deepEqual(await page.$$eval('#an-tabla thead th', (h) => h.filter((x) => (x as HTMLElement).offsetParent).map((x) => x.textContent!.trim())), ['Mes', 'Total vendido ($)', 'Tickets', 'Total', '% del total', '']);
    await page.click('#an-tabla tbody tr[data-i="2"]');
    assert.match((await page.textContent('#an-tabla tr.an-det'))!, /Piezas[\s\S]*Ticket promedio[\s\S]*Promedio por día/);
    await page.click('#an-tabla tbody tr[data-i="2"]');
    assert.equal(await page.locator('#an-tabla tr.an-det').count(), 0);
    // — Plegar y desplegar los filtros: no se pierde nada ni se vuelve a consultar; el resumen dice lo elegido.
    await page.$eval('#an-resultado', (e) => { (e.firstElementChild as HTMLElement).dataset.marca = 'x'; });
    await page.click('#an-toggle');
    assert.equal(await page.locator('#an-cuerpo-filtros').isVisible(), false);
    assert.equal(await page.getAttribute('#an-toggle', 'aria-expanded'), 'false');
    const resumen = (await page.textContent('#an-resumen-filtros'))!;
    for (const x of ['2026', 'Por mes', 'Total vendido ($)', 'Todas las cajas', 'Con históricas']) assert.ok(resumen.includes(x), `${x} en «${resumen}»`);
    assert.equal(await page.locator('#an-resultado [data-marca="x"]').count(), 1, 'los resultados siguen ahí, sin recargarse');
    await page.screenshot({ path: join(RAIZ, 'docs', 'capturas', 'analisis-movil-plegado.png') });
    await page.click('#an-toggle');
    assert.equal(await page.locator('#an-cuerpo-filtros').isVisible(), true);
    assert.equal(await page.inputValue('#an-agrupar'), 'mes'); assert.equal(await page.locator('.an-caja:checked').count(), 4, 'los filtros se conservan');
    // — Excel: el mismo archivo de siempre.
    const [descarga] = await Promise.all([page.waitForEvent('download'), page.click('#an-excel')]);
    assert.equal(descarga.suggestedFilename(), 'analisis-de-ventas-mes.xlsx');
    assert.equal(await page.evaluate(() => window.innerWidth), VIEWPORT_PRO_MAX.width, 'la página no ensanchó la pantalla del teléfono (algo no cabía)');
    // — La isla sigue ahí y la página llega hasta abajo sin quedar detrás de ella.
    await page.evaluate(() => window.scrollTo(0, 99999));
    const fin = await page.evaluate(() => { const u = [...document.querySelectorAll('#an-resultado > *')].at(-1)!.getBoundingClientRect(); const i = document.querySelector('#isla')!.getBoundingClientRect(); return { finContenido: u.bottom, topIsla: i.top }; });
    assert.ok(fin.finContenido <= fin.topIsla + 1, `el contenido no queda tapado por la isla: ${JSON.stringify(fin)}`);
    assert.deepEqual(await page.$$eval('#isla button span', (e) => e.map((x) => x.textContent)), ['Reportes', 'Menú', 'Configuración']);
    // — Capturas (arriba, medio y abajo) para compararlas con la referencia.
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({ path: join(RAIZ, 'docs', 'capturas', 'analisis-movil-arriba.png') });
    await page.evaluate(() => { const k = document.querySelector('.an-kpis')!.getBoundingClientRect(); window.scrollTo(0, window.scrollY + k.top - 100); });
    await page.screenshot({ path: join(RAIZ, 'docs', 'capturas', 'analisis-movil-indicadores.png') });
    await page.evaluate(() => document.querySelector('.an-card-graf')!.scrollIntoView({ block: 'start' }));
    await page.screenshot({ path: join(RAIZ, 'docs', 'capturas', 'analisis-movil-grafica.png') });
    await page.evaluate(() => document.querySelector('.an-card-tabla')!.scrollIntoView({ block: 'start' }));
    await page.screenshot({ path: join(RAIZ, 'docs', 'capturas', 'analisis-movil-tabla.png') });
    assert.deepEqual(errores, []);
  });

  it('AM2 todas las modalidades (año, semana, día, día de la semana, hora, mapa de calor, forma de pago, caja, tienda, por empleada, mes y fechas a elegir) se ven bien: sin desborde horizontal, en claro y oscuro y en 320, 375, 390, 430 y 440 px', async (t) => {
    const { abrir } = await preparar(t);
    for (const [ancho, esquema] of [[320, 'dark'], [375, 'light'], [390, 'dark'], [430, 'light'], [440, 'dark']] as const) {
      const { page, errores } = await abrir({ ...IPHONE, viewport: { width: ancho, height: 900 }, deviceScaleFactor: 2, colorScheme: esquema });
      const sinDesborde = async (donde: string) => {
        const r = await page.evaluate((real) => ({ pagina: document.documentElement.scrollWidth, ventana: real, ancha: window.innerWidth, malos: [...document.querySelectorAll('.an-titulo, #an-filtros *, #an-resultado *')].filter((e) => { const b = e.getBoundingClientRect(); return b.width > 0 && (b.right > real + 1) && !e.closest('.grafica-cont') && !e.closest('.calor-cont') && !e.closest('.tabla-cont') && !e.closest('.sr-only'); }).slice(0, 3).map((e) => `${e.tagName.toLowerCase()}.${String(e.className).slice(0, 20)}`) }), ancho);
        assert.ok(r.pagina <= r.ventana + 1 && r.ancha === ancho && r.malos.length === 0, `${ancho}px ${donde}: ${JSON.stringify(r)}`);
      };
      await sinDesborde('por mes');
      const partidos2 = await page.evaluate(() => [...document.querySelectorAll('.an-kpi b')].filter((c) => { const r = document.createRange(); r.selectNodeContents(c); return new Set([...r.getClientRects()].map((q) => Math.round(q.top))).size > 1 || c.scrollWidth > c.clientWidth + 1; }).map((c) => c.textContent));
      assert.deepEqual(partidos2, [], `${ancho}px: valores de indicadores partidos o recortados`);
      const chips = await page.$$eval('.an-chips .chip', (c) => c.map((x) => { const r = x.getBoundingClientRect(); return { h: Math.round(r.height), corta: x.scrollWidth > x.clientWidth + 1, dentro: r.right <= window.innerWidth }; }));
      assert.ok(chips.every((c) => c.h >= 38 && c.h <= 42 && !c.corta && c.dentro), `${ancho}px chips: ${JSON.stringify(chips)}`);
      const chipsForma = await page.evaluate(() => ({ radios: [...document.querySelectorAll('.an-chips .chip')].map((c) => parseFloat(getComputedStyle(c).borderTopLeftRadius)), texto: [...document.querySelectorAll('.an-chips .chip')].map((c) => { const s = c.querySelector('span')!.getBoundingClientRect(), r = c.getBoundingClientRect(); return Math.abs((s.top + s.height / 2) - (r.top + r.height / 2)); }), alto: Math.round(document.querySelector('.an-cajas')!.getBoundingClientRect().height) }));
      assert.ok(chipsForma.radios.every((r) => r <= 10), `${ancho}px chips rectangulares: ${chipsForma.radios}`);
      assert.ok(chipsForma.texto.every((d) => d <= 2), `${ancho}px texto centrado en el chip (sin espacio muerto): ${chipsForma.texto}`);
      if (ancho >= 390) assert.ok(chipsForma.alto <= 140, `${ancho}px bloque de cajas compacto: ${chipsForma.alto}px`);
      for (const ver of ['anio', 'semana', 'dia', 'dia_semana', 'hora', 'mapa_calor', 'forma_pago', 'caja', 'tienda', 'mes']) {
        await page.selectOption('#an-agrupar', ver);
        await page.waitForFunction((v) => !!document.querySelector(v === 'mapa_calor' ? '#an-calor' : '#an-tabla'), ver, { timeout: 10_000 });
        await sinDesborde(`Ver ${ver}`);
      }
      for (const m of ['tickets', 'piezas', 'promedio_ticket', 'promedio_dia', 'total']) { await page.selectOption('#an-metrica', m); await page.waitForSelector('#an-tabla'); }
      await sinDesborde('métricas');
      await page.selectOption('#an-rango', 'personalizado');
      await page.waitForSelector('#an-desde', { state: 'visible' });
      const fechas = await Promise.all(['#an-l-rango', '#an-l-desde', '#an-l-hasta'].map((s) => caja(page, s)));
      assert.ok(fechas[0]!.w > fechas[1]!.w * 1.5 || ancho < 380, 'con fechas a elegir, Periodo ocupa su fila y Desde/Hasta van lado a lado');
      await sinDesborde('fechas a elegir');
      await page.selectOption('#an-rango', 'mes'); await page.waitForSelector('#an-mes', { state: 'visible' }); await sinDesborde('un mes');
      await page.selectOption('#an-rango', 'anio');
      await page.selectOption('#an-desglose', 'empleada');
      await page.waitForSelector('#an-ranking');
      await sinDesborde('por empleada');
      assert.deepEqual(await page.$$eval('#an-agrupar option', (o) => o.map((x) => (x as HTMLOptionElement).value)).then((v) => v.sort()), ['anio', 'dia', 'mes', 'semana']);
      assert.deepEqual(errores, []);
    }
  });

  it('AM3 oscuro con contraste, y en escritorio el panel de filtros y las tablas se ven como antes (sin encabezado plegable ni chips)', async (t) => {
    const { abrir } = await preparar(t);
    const m = await abrir({ ...IPHONE, viewport: VIEWPORT_PRO_MAX, deviceScaleFactor: 2, colorScheme: 'dark' });
    await m.page.screenshot({ path: join(RAIZ, 'docs', 'capturas', 'analisis-movil-oscuro.png') });
    const lum = (c: string) => { const [r, g, b] = c.match(/\d+/g)!.map(Number); const f = (v: number) => { const x = v / 255; return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(r!) + 0.7152 * f(g!) + 0.0722 * f(b!); };
    const contraste = async (sel: string) => { const [fg, bg] = await m.page.$eval(sel, (e) => { const s = getComputedStyle(e); let p: Element | null = e; let fondo = 'rgba(0, 0, 0, 0)'; while (p) { const c = getComputedStyle(p).backgroundColor; if (c && !/rgba\(0, 0, 0, 0\)|transparent/.test(c)) { fondo = c; break; } p = p.parentElement; } return [s.color, fondo]; }); const [a, b] = [lum(fg!), lum(bg!)]; return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05); };
    for (const sel of ['.an-kpi-total b', '.an-kpi:not(.an-kpi-total):not(.an-kpi-mejor) b', '.an-kpi-mejor b', '#an-tabla tbody td:nth-child(5)', '.an-cab-tit']) assert.ok((await contraste(sel)) >= 4.5, `contraste de ${sel}: ${await contraste(sel)}`);
    assert.deepEqual(m.errores, []);
    const d = await abrir({ viewport: { width: 1280, height: 900 }, colorScheme: 'light' });
    assert.equal(await d.page.locator('#an-toggle').isVisible(), false, 'el encabezado plegable es solo del teléfono');
    assert.equal(await d.page.locator('#an-cuerpo-filtros .an-fila').first().isVisible(), true);
    assert.equal(await d.page.locator('.an-kpi .an-ico').first().isVisible(), false, 'iconos de indicadores solo en el teléfono');
    assert.equal(await d.page.locator('#an-tabla th:nth-child(4)').isVisible(), true, 'en escritorio la tabla trae todas sus columnas');
    assert.equal(await d.page.locator('#an-tabla .an-col-chev').first().isVisible(), false);
    assert.equal(await d.page.locator('#isla').isVisible(), false);
  });
});
