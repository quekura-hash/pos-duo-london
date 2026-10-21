import assert from 'node:assert/strict';
import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { _electron as electron } from 'playwright-core';
import { crearAjustes } from '../windows/ajustes-store.cjs';
import { crearImpresoraRaw, mensajeDeError, SCRIPT_ENVIAR } from '../windows/impresora-raw.cjs';

const RAIZ = join(import.meta.dirname, '..');
const ELECTRON = join(RAIZ, 'windows', 'node_modules', 'electron', 'dist', 'electron');

/** Sistema de archivos en memoria para probar sin disco ni Windows. */
function fsMemoria() {
  const archivos = new Map<string, Buffer | string>();
  return { archivos, mkdirSync() {}, writeFileSync(r: string, d: Buffer | string) { archivos.set(r, d); }, readFileSync(r: string) { const v = archivos.get(r); if (v === undefined) throw new Error('ENOENT'); return v.toString(); }, rmSync(r: string) { archivos.delete(r); } };
}

describe('[app de Windows] impresión directa por la cola de Windows (RAW)', () => {
  it('W1 lista las impresoras y manda los bytes con PowerShell, de uno en uno', async () => {
    const memoria = fsMemoria();
    const llamadas: { cmd: string; args: string[]; bytes?: number[] }[] = [];
    const ejecutar = async (cmd: string, args: string[]) => {
      const f = args.includes('-Archivo') ? args[args.indexOf('-Archivo') + 1] : undefined;
      llamadas.push({ cmd, args, bytes: f ? [...Buffer.from(memoria.archivos.get(f) as Buffer)] : undefined });
      if (args.includes('-Archivo')) return { code: 0, stdout: '', stderr: '' };
      return { code: 0, stdout: JSON.stringify([{ Name: 'EPSON TM-T20II Receipt', Default: true, PortName: 'USB001', DriverName: 'EPSON TM-T20II', WorkOffline: false }, { Name: 'Microsoft Print to PDF', Default: false, PortName: 'PORTPROMPT:', DriverName: 'PDF', WorkOffline: false }]), stderr: '' };
    };
    const imp = crearImpresoraRaw({ ejecutar, fs: memoria as never, dirTmp: '/tmp/x', plataforma: 'win32' });
    const lista = await imp.listar();
    assert.deepEqual(lista.map((p) => [p.nombre, p.predeterminada, p.puerto]), [['EPSON TM-T20II Receipt', true, 'USB001'], ['Microsoft Print to PDF', false, 'PORTPROMPT:']]);
    await Promise.all([imp.imprimir('EPSON TM-T20II Receipt', Uint8Array.from([0x1b, 0x40, 1])), imp.imprimir('EPSON TM-T20II Receipt', Uint8Array.from([0x1b, 0x70, 0, 25, 250]))]);
    const envios = llamadas.filter((l) => l.args.includes('-Archivo'));
    assert.deepEqual(envios.map((e) => e.bytes), [[0x1b, 0x40, 1], [0x1b, 0x70, 0, 25, 250]]);
    assert.equal(envios[0]!.cmd, 'powershell.exe');
    assert.ok(envios[0]!.args.includes('-ExecutionPolicy') && envios[0]!.args.includes('-NoProfile'));
    assert.equal(envios[0]!.args[envios[0]!.args.indexOf('-Impresora') + 1], 'EPSON TM-T20II Receipt');
    assert.ok(![...memoria.archivos.keys()].some((k) => k.endsWith('.bin')), 'el archivo temporal se borra');
    assert.match(String(memoria.archivos.get('/tmp/x/enviar.ps1')), /RAW/);
    assert.ok(SCRIPT_ENVIAR.includes('WritePrinter') && SCRIPT_ENVIAR.includes('StartDocPrinterW'));
  });

  it('W1b si PowerShell no arranca, usa la lista de Electron; sin plan B, dice el motivo real', async () => {
    const memoria = fsMemoria();
    const sinPowerShell = async () => ({ code: 1, stdout: '', stderr: 'no se pudo iniciar PowerShell (ENOENT).' });
    const alterna = [{ nombre: 'EPSON TM-T20II Receipt', predeterminada: true, puerto: '', controlador: '', sinConexion: false }];
    const conPlanB = crearImpresoraRaw({ ejecutar: sinPowerShell, fs: memoria as never, dirTmp: '/tmp/x', plataforma: 'win32', listarAlterno: async () => alterna });
    assert.deepEqual(await conPlanB.listar(), alterna);
    const sinPlanB = crearImpresoraRaw({ ejecutar: sinPowerShell, fs: memoria as never, dirTmp: '/tmp/x', plataforma: 'win32' });
    await assert.rejects(() => sinPlanB.listar(), /ENOENT/);
  });

  it('W2 los errores llegan en español y un fallo no frena los siguientes trabajos', async () => {
    const memoria = fsMemoria();
    let n = 0;
    const ejecutar = async () => (++n === 1 ? { code: 1, stdout: '', stderr: "Exception calling \"Enviar\" with \"2\" argument(s): \"No se pudo abrir la impresora 'X' (error de Windows 1801). Revise el nombre y que esté instalada.\"\nAt line:1 char:1\n+ [LonDuoRaw]::Enviar" } : { code: 0, stdout: '', stderr: '' });
    const imp = crearImpresoraRaw({ ejecutar, fs: memoria as never, dirTmp: '/tmp/x', plataforma: 'win32' });
    await assert.rejects(imp.imprimir('X', Uint8Array.from([1])), /No se pudo abrir la impresora 'X'.*Revise el nombre/);
    await imp.imprimir('X', Uint8Array.from([1])); // el siguiente sí sale
    await assert.rejects(imp.imprimir('', Uint8Array.from([1])), /No hay impresora configurada/);
    await assert.rejects(imp.imprimir('X', new Uint8Array(0)), /nada que imprimir/);
    await assert.rejects(crearImpresoraRaw({ plataforma: 'linux' }).imprimir('X', Uint8Array.from([1])), /solo existe en Windows/);
    assert.equal(mensajeDeError('At line:1\n+ foo\nboom'), 'boom');
  });

  it('W3 ajustes del equipo: se guardan, se validan y vuelven al abrir', () => {
    const memoria = fsMemoria();
    const a = crearAjustes('/datos', memoria as never);
    assert.deepEqual([a.leer().impresora, a.leer().canal, a.leer().pantallaCompleta], ['', 'pruebas', false]);
    a.guardar({ impresora: '  EPSON TM-T20II  ', canal: 'estable', pantallaCompleta: true, urlActualizaciones: 'http://inseguro.mx', revisarCadaMin: 2 });
    const b = crearAjustes('/datos', memoria as never).leer();
    assert.deepEqual([b.impresora, b.canal, b.pantallaCompleta, b.revisarCadaMin], ['EPSON TM-T20II', 'estable', true, 30]);
    assert.match(b.urlActualizaciones, /^https:\/\/.*\/actualizaciones$/, 'una dirección sin https se rechaza');
    a.guardar({ urlActualizaciones: 'https://ejemplo.mx/act/', revisarCadaMin: 60 });
    assert.deepEqual([a.leer().urlActualizaciones, a.leer().revisarCadaMin], ['https://ejemplo.mx/act', 60]);
  });
});

describe('[app de Windows] la app real (Electron) con la pantalla del POS', { timeout: 240_000, skip: existsSync(ELECTRON) && existsSync('/usr/bin/Xvfb') ? false : 'Electron o Xvfb no están disponibles' }, () => {
  it('W4 abre la pantalla, imprime el ticket de una venta y el cajón como bytes ESC/POS, y abre los ajustes', async (t) => {
    execFileSync(process.execPath, [join(RAIZ, 'windows', 'construir.mjs'), '--sin-instalador'], { stdio: 'pipe' });
    const salida = mkdtempSync(join(tmpdir(), 'pos-imp-'));
    const datos = mkdtempSync(join(tmpdir(), 'pos-datos-'));
    const pantalla = 97 + Math.floor(Math.random() * 100);
    const xvfb: ChildProcess = spawn('Xvfb', [`:${pantalla}`, '-screen', '0', '1400x900x24'], { stdio: 'ignore' });
    await new Promise((r) => setTimeout(r, 800));
    const app = await electron.launch({ executablePath: ELECTRON, args: [join(RAIZ, 'windows'), '--no-sandbox', `--user-data-dir=${datos}`], env: { ...process.env, DISPLAY: `:${pantalla}`, LONDUO_IMPRESORA_ARCHIVO: salida } as Record<string, string> });
    t.after(async () => { await app.close().catch(() => undefined); xvfb.kill(); rmSync(salida, { recursive: true, force: true }); rmSync(datos, { recursive: true, force: true }); });
    const page = await app.firstWindow();
    const errores: string[] = [];
    page.on('pageerror', (e) => errores.push(String(e)));
    // La app abre la CAJA conectada al central; para probar el hardware sin central se usa el modo de pruebas.
    await page.waitForSelector('#puerta', { timeout: 60_000 });
    assert.equal(page.url(), 'londuo://app/index.html');
    await page.goto('londuo://app/prueba.html');
    await page.waitForSelector('[data-chip="tienda"]', { timeout: 60_000 });
    assert.equal(await page.evaluate(() => typeof (window as unknown as { posHardware: { imprimirRaw: unknown } }).posHardware.imprimirRaw), 'function');
    assert.equal(await page.evaluate(() => typeof (window as unknown as { require?: unknown }).require), 'undefined', 'la página no tiene acceso a Node');
    const v = JSON.parse(readFileSync(join(RAIZ, 'package.json'), 'utf8')).version as string;
    assert.equal((await page.evaluate(() => (window as unknown as { posHardware: { version(): Promise<{ version: string }> } }).posHardware.version())).version, v);

    // Venta en efectivo: el ticket sale como bytes ESC/POS por la impresora de la app.
    await page.fill('#scan', '0002026090782');
    await page.press('#scan', 'Enter');
    await page.waitForSelector('#cuerpo tr[data-linea]');
    await page.fill('#recibido', '1000');
    await page.click('#btn-cobrar');
    await page.waitForSelector('#dlg-ticket[open]');
    await page.waitForFunction(() => /Folio 000001/.test(document.querySelector('#resumen-venta')!.textContent!));
    const trabajos = () => readdirSync(salida).filter((f) => f.endsWith('.bin')).sort();
    await page.waitForFunction(() => true);
    for (let i = 0; i < 40 && !trabajos().length; i++) await new Promise((r) => setTimeout(r, 250));
    assert.ok(trabajos().length >= 1, 'se imprimió el ticket');
    const ticket = readFileSync(join(salida, trabajos()[0]!));
    assert.deepEqual([...ticket.subarray(0, 2)], [0x1b, 0x40], 'empieza con ESC @ (inicializar)');
    assert.ok(ticket.includes(Buffer.from([0x1d, 0x56])), 'trae el corte de papel');
    assert.ok(ticket.length > 200);

    // Pruebas de hardware desde los ajustes: ticket, y solo cajón (ESC p).
    const antes = trabajos().length;
    await page.evaluate(() => (window as unknown as { posAjustes: { probar(t: string): Promise<string> } }).posAjustes.probar('cajon'));
    const nuevo = trabajos();
    assert.equal(nuevo.length, antes + 1);
    assert.deepEqual([...readFileSync(join(salida, nuevo[nuevo.length - 1]!))], [0x1b, 0x40, 0x1b, 0x70, 0x00, 25, 250]);
    const cfg = await page.evaluate(async () => { const a = (window as unknown as { posAjustes: { guardar(c: object): Promise<{ impresora: string }>; leer(): Promise<{ impresora: string; modoArchivo: boolean; version: string }> } }).posAjustes; await a.guardar({ impresora: 'EPSON TM-T20II' }); return a.leer(); });
    assert.deepEqual([cfg.impresora, cfg.modoArchivo, cfg.version], ['EPSON TM-T20II', true, v]);
    // Fuera de Windows el listado de impresoras avisa con claridad.
    const msg = await page.evaluate(async () => { try { await (window as unknown as { posAjustes: { impresoras(): Promise<unknown> } }).posAjustes.impresoras(); return 'sin error'; } catch (e) { return String((e as Error).message); } });
    assert.match(msg, /solo existe en Windows/);
    assert.deepEqual(errores, []);
  });
});
