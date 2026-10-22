import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { describe, it } from 'node:test';
import { chromium, type Page } from 'playwright-core';
import { api, appAdmin } from './ayudas/app.ts';
import { ALMACENES, nuevoMundo, politica } from './ayudas/comun.ts';

const CANDIDATOS = [process.env.POS_CHROMIUM, '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', '/opt/pw-browsers/chromium/chrome-linux/chrome'];
const chromiumPath = CANDIDATOS.find((p) => p && existsSync(p));
const sqlite = ALMACENES.find((a) => a.nombre === 'sqlite')!;

const esperarTexto = async (page: Page, selector: string, re: RegExp) => {
  try { await page.waitForFunction(([s, r]) => new RegExp(r).test(document.querySelector(s as string)?.textContent ?? ''), [selector, re.source], { timeout: 8000 }); }
  catch { throw new Error(`${selector} no dijo ${re}; decía: «${await page.textContent(selector).catch(() => '(no existe)')}»`); }
};

describe('[navegador real] Usuarios: tienda de cada trabajadora y expediente privado', { timeout: 240_000, skip: chromiumPath ? false : 'Chromium no encontrado (defina POS_CHROMIUM)' }, () => {
  it('UT1 la tienda se elige al dar de alta y al editar; la ficha está oculta hasta teclear su clave corta, se guarda y vuelve a cerrarse', async (t) => {
    const browser = await chromium.launch({ executablePath: chromiumPath, args: ['--no-sandbox'] });
    const ctx = nuevoMundo(sqlite, politica());
    const adm = await appAdmin(ctx);
    t.after(async () => { await browser.close(); await adm.cerrar(); ctx.limpiar(); });
    await api(adm.url, '/api/admin/cajeros', { nombre: 'Ana', clave: '1111', perfil: { nombres: 'Ana', apellidos: 'López' } });
    const page = await (await browser.newContext({ viewport: { width: 1366, height: 820 }, locale: 'es-MX' })).newPage();
    const errores: string[] = [];
    page.on('pageerror', (e) => errores.push(String(e)));
    page.on('console', (m) => { if (m.type() === 'error') errores.push(m.text()); });
    await page.goto(adm.url);
    await page.click('#nav button[data-vista="configuracion"]');
    await page.click('#cfg-tab-cajeros');
    await page.waitForSelector('#tabla-cajeros tr[data-cajero]');
    // la lista muestra la tienda (sin asignar al principio)
    assert.match((await page.textContent('#tabla-cajeros tr[data-cajero]'))!, /Sin asignar/);
    // las claves cortas no son campos de contraseña (Chrome les pondría la contraseña guardada) y los errores se ven junto al botón
    assert.equal(await page.getAttribute('#caj-clave', 'type'), 'text');
    assert.notEqual(await page.getAttribute('#caj-clave', 'type'), 'password');
    assert.equal(await page.getAttribute('#caj-nombre', 'autocomplete'), 'off');
    await page.fill('#caj-nombre', 'Pepe'); await page.fill('#caj-clave', '5555');
    await page.click('#btn-caj');
    await esperarTexto(page, '#msg-caj-alta', /nombres y los apellidos/);
    assert.equal(await page.locator('#tabla-cajeros tr[data-cajero]').count(), 1, 'con datos incompletos no se guarda nada');
    await page.fill('#caj-nombre', '');
    await page.fill('#caj-clave', '');
    // alta con tienda
    await page.fill('#caj-nombre', 'Bea'); await page.fill('#caj-clave', '2222');
    await page.fill('#caj-nombres', 'Beatriz'); await page.fill('#caj-apellidos', 'Soto');
    await page.selectOption('#caj-tienda', 'LON');
    await page.click('#btn-caj');
    await esperarTexto(page, '#msg-cajeros', /agregada|Bea/);
    assert.equal((await api(adm.url, '/api/admin/cajeros')).json.cajeros.find((c: any) => c.nombre === 'Bea').tienda, 'LON');

    // editar a Ana: elegir tienda y abrir el expediente
    await page.click('#tabla-cajeros tr[data-cajero] .c-editar >> nth=0');
    await page.waitForSelector('#dlg-empleado[open]');
    await page.selectOption('#ed-tienda', 'DUO');
    await page.click('#emp-guardar');
    await page.waitForSelector('#dlg-empleado', { state: 'hidden' });
    assert.equal((await api(adm.url, '/api/admin/cajeros')).json.cajeros.find((c: any) => c.nombre === 'Ana').tienda, 'DUO');
    await page.click('#tabla-cajeros tr[data-cajero] .c-editar >> nth=0');
    await page.waitForSelector('#dlg-empleado[open]');
    // nada privado en pantalla mientras el expediente está cerrado
    assert.doesNotMatch(await page.content(), /Recontratable|Puntualidad|Anotaciones/);
    await page.click('#emp-expediente');
    await page.waitForSelector('#dlg-expediente[open] #form-exp-clave');
    assert.match((await page.textContent('#dlg-expediente'))!, /Ficha[\s\S]*cree <b>su clave corta|su clave corta[\s\S]*no es la contraseña de Supabase/i, 'la primera vez pide crear su clave corta');
    assert.doesNotMatch((await page.textContent('#dlg-expediente'))!, /Puntualidad|Anotaciones/, 'candado: sin la clave no se ve nada');
    // validaciones al crearla
    await page.fill('#exp-nueva', '12'); await page.fill('#exp-nueva2', '12');
    await page.click('#form-exp-clave button[type=submit]');
    await esperarTexto(page, '#msg-exp', /4 a 8 dígitos/);
    await page.fill('#exp-nueva', '2468'); await page.fill('#exp-nueva2', '1111');
    await page.click('#form-exp-clave button[type=submit]');
    await esperarTexto(page, '#msg-exp', /no coinciden/);
    await page.fill('#exp-nueva', '2468'); await page.fill('#exp-nueva2', '2468');
    await page.click('#form-exp-clave button[type=submit]');
    await page.waitForSelector('#form-exp');
    assert.match((await page.textContent('#exp-registro'))!, /\d\d\/\d\d\/\d{4}/, 'fecha de registro en el sistema');
    assert.equal(await page.locator('.exp-crit').count(), 6);
    // llenar: fecha de alta, recontratable, calificaciones y notas
    await page.fill('#exp-alta', '2025-03-10');
    await page.check('input[name="exp-rec"][value="si"]');
    for (const [k, n] of [['puntualidad', 4], ['presentacion', 5], ['inasistencias', 2], ['facilidad_palabra', 5], ['vendedora', 5], ['humildad', 3]] as const) await page.click(`[data-crit="${k}"] .exp-n[data-n="${n}"]`);
    assert.match((await page.textContent('#exp-prom'))!, /promedio 4\.0/);
    await page.fill('#exp-notas', 'Buena vendedora. Faltaba mucho.');
    await page.click('#exp-guardar');
    await esperarTexto(page, '#msg-exp', /Ficha guardada/);
    // se guardó tal cual
    const e = (await api(adm.url, '/api/admin/expediente?cajero_id=' + (await api(adm.url, '/api/admin/cajeros')).json.cajeros.find((c: any) => c.nombre === 'Ana').id)).json.expediente;
    assert.deepEqual([e.fecha_alta, e.recontratable, e.notas, e.calificaciones.inasistencias], ['2025-03-10', true, 'Buena vendedora. Faltaba mucho.', 2]);
    // bloquear y cerrar: vuelve a quedar bajo llave
    await page.click('#exp-cerrar');
    await page.waitForSelector('#dlg-expediente', { state: 'hidden' });
    const ana = (await api(adm.url, '/api/admin/cajeros')).json.cajeros.find((c: any) => c.nombre === 'Ana');
    assert.equal((await api(adm.url, `/api/admin/expediente?cajero_id=${ana.id}`)).json.error.codigo, 'EXPEDIENTE_BLOQUEADO');
    assert.doesNotMatch(await page.content(), /Faltaba mucho|Recontratable|Calificaciones/, 'nada del expediente queda en la pantalla');
    // volver a abrirla pide la clave corta (ya no la de crear)
    await page.click('#tabla-cajeros tr[data-cajero] .c-editar >> nth=0');
    await page.waitForSelector('#dlg-empleado[open]');
    assert.equal((await page.textContent('#emp-expediente'))!.trim(), 'Ficha', 'el botón se llama Ficha');
    await page.click('#emp-expediente');
    await page.waitForSelector('#exp-clave');
    await page.fill('#exp-clave', '0000');
    await page.click('#form-exp-clave button[type=submit]');
    await esperarTexto(page, '#msg-exp', /no es correcta/);
    await page.fill('#exp-clave', '2468');
    await page.click('#form-exp-clave button[type=submit]');
    await page.waitForSelector('#form-exp');
    assert.equal(await page.inputValue('#exp-notas'), 'Buena vendedora. Faltaba mucho.');
    assert.deepEqual(errores.filter((x) => !/401|403|Failed to load resource/.test(x)), []);
  });
});
