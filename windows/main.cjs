'use strict';
// LonDuo POS · Caja de pruebas para Windows. Envuelve la pantalla del POS y le da lo que un navegador no puede:
// impresión ESC/POS directa a la Epson/Bixolon, apertura del cajón y actualizaciones automáticas.
const { app, BrowserWindow, Menu, ipcMain, dialog, protocol, net, shell, session, safeStorage } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { crearAjustes } = require('./ajustes-store.cjs');
const { crearImpresoraRaw } = require('./impresora-raw.cjs');

protocol.registerSchemesAsPrivileged([{ scheme: 'londuo', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true } }]);

const DIR_APP = path.join(__dirname, 'app');
const NOMBRE = 'LonDuo POS';
let ventana = null;
let ventanaAjustes = null;
let ajustes = null;
let impresora = null;
let estadoActualizacion = { fase: 'inactivo', version: null, mensaje: '' };
let autoUpdater = null;
let temporizadorActualizacion = null;

// Datos de prueba de impresión (los genera el constructor con el mismo motor de tickets que usa la caja).
const archivoHw = (n) => path.join(DIR_APP, 'hardware', n);
const bytesDe = (n) => new Uint8Array(fs.readFileSync(archivoHw(n)));

function registro(linea) {
  try { fs.appendFileSync(path.join(app.getPath('userData'), 'londuo.log'), `${new Date().toISOString()} ${linea}\n`); } catch { /* sin disco: no es motivo para fallar */ }
}

// ── cuenta de ESTA caja en el central: se guarda cifrada con la protección de Windows (solo este usuario de Windows en este equipo la puede abrir) ──
const archivoCuenta = () => path.join(app.getPath('userData'), 'cuenta-caja.bin');
function leerCuenta() {
  try { return JSON.parse(safeStorage.decryptString(fs.readFileSync(archivoCuenta()))); } catch { return null; }
}
function guardarCuenta(c) {
  if (!c || typeof c.correo !== 'string' || typeof c.clave !== 'string' || !c.correo || !c.clave) throw new Error('Faltan el correo o la contraseña de la caja.');
  if (!safeStorage.isEncryptionAvailable()) throw new Error('Este equipo no puede guardar la contraseña de forma segura.');
  fs.writeFileSync(archivoCuenta(), safeStorage.encryptString(JSON.stringify({ correo: c.correo.trim(), clave: c.clave })));
}
function olvidarCuenta() { try { fs.rmSync(archivoCuenta(), { force: true }); } catch { /* ya no estaba */ } }

// ── impresión ──
/** Modo de pruebas sin Windows: LONDUO_IMPRESORA_ARCHIVO=carpeta guarda cada trabajo como .bin en lugar de mandarlo a una impresora. */
function imprimirBytes(bytes) {
  const carpeta = process.env.LONDUO_IMPRESORA_ARCHIVO;
  if (carpeta) {
    fs.mkdirSync(carpeta, { recursive: true });
    const n = fs.readdirSync(carpeta).filter((f) => f.endsWith('.bin')).length + 1;
    fs.writeFileSync(path.join(carpeta, `${String(n).padStart(3, '0')}.bin`), Buffer.from(bytes));
    return Promise.resolve();
  }
  return impresora.imprimir(ajustes.leer().impresora, bytes).catch((e) => { registro(`impresión falló: ${e.message}`); throw e; });
}

// ── actualizaciones ──
function configurarActualizador() {
  if (!app.isPackaged) return;
  try { ({ autoUpdater } = require('electron-updater')); } catch (e) { registro(`sin actualizador: ${e.message}`); return; }
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true; // si nadie pulsa «Instalar ahora», se instala al cerrar la app
  autoUpdater.allowDowngrade = false;
  autoUpdater.logger = { info: (m) => registro(`upd ${m}`), warn: (m) => registro(`upd! ${m}`), error: (m) => registro(`upd!! ${m}`), debug() {} };
  autoUpdater.on('checking-for-update', () => cambiarEstado({ fase: 'revisando', mensaje: 'Buscando actualizaciones…' }));
  autoUpdater.on('update-not-available', () => cambiarEstado({ fase: 'al_dia', mensaje: `Está al día (v${app.getVersion()}).` }));
  autoUpdater.on('update-available', (i) => cambiarEstado({ fase: 'descargando', version: i.version, mensaje: `Descargando la versión ${i.version}…` }));
  autoUpdater.on('download-progress', (p) => cambiarEstado({ fase: 'descargando', mensaje: `Descargando… ${Math.round(p.percent)}%` }));
  autoUpdater.on('update-downloaded', (i) => { cambiarEstado({ fase: 'lista', version: i.version, mensaje: `La versión ${i.version} está lista.` }); avisarEnPantalla(i.version); });
  autoUpdater.on('error', (e) => cambiarEstado({ fase: 'error', mensaje: `No se pudo revisar: ${e && e.message ? e.message.split('\n')[0] : e}` }));
}
function cambiarEstado(e) {
  estadoActualizacion = { ...estadoActualizacion, ...e };
  if (ventanaAjustes && !ventanaAjustes.isDestroyed()) ventanaAjustes.webContents.send('upd:estado', estadoActualizacion);
}
function aplicarFuente() {
  if (!autoUpdater) return;
  const a = ajustes.leer();
  autoUpdater.setFeedURL({ provider: 'generic', url: a.urlActualizaciones, channel: a.canal === 'estable' ? 'latest' : 'pruebas' });
}
async function revisarActualizacion() {
  if (!autoUpdater) { cambiarEstado({ fase: 'no_disponible', mensaje: app.isPackaged ? 'El actualizador no está disponible.' : 'Las actualizaciones solo funcionan en la app instalada.' }); return estadoActualizacion; }
  aplicarFuente();
  try { await autoUpdater.checkForUpdates(); } catch (e) { cambiarEstado({ fase: 'error', mensaje: `No se pudo revisar: ${String(e.message ?? e).split('\n')[0]}` }); }
  return estadoActualizacion;
}
function programarRevisiones() {
  if (temporizadorActualizacion) clearInterval(temporizadorActualizacion);
  if (!autoUpdater) return;
  setTimeout(() => { void revisarActualizacion(); }, 15_000);
  temporizadorActualizacion = setInterval(() => { void revisarActualizacion(); }, ajustes.leer().revisarCadaMin * 60_000);
}
/** Aviso discreto sobre la pantalla del POS: no interrumpe una venta. */
function avisarEnPantalla(version) {
  if (!ventana || ventana.isDestroyed()) return;
  void ventana.webContents.executeJavaScript(`(() => {
    if (document.getElementById('londuo-update')) return;
    const d = document.createElement('div'); d.id = 'londuo-update';
    d.style.cssText = 'position:fixed;right:16px;bottom:16px;z-index:99999;background:#0b3d62;color:#fff;padding:12px 16px;border-radius:12px;box-shadow:0 6px 24px rgba(0,0,0,.35);font:14px system-ui;max-width:340px';
    d.innerHTML = '<b>Actualización lista (v${version})</b><br><span style="opacity:.85">Se instala al cerrar la app, o ahora si no hay una venta en curso.</span><div style="margin-top:8px;display:flex;gap:8px"><button id="lu-ahora" style="padding:6px 12px;border-radius:8px;border:0;font-weight:700;cursor:pointer">Instalar ahora</button><button id="lu-luego" style="padding:6px 12px;border-radius:8px;border:1px solid #fff8;background:transparent;color:#fff;cursor:pointer">Después</button></div>';
    document.body.appendChild(d);
    document.getElementById('lu-luego').onclick = () => d.remove();
    document.getElementById('lu-ahora').onclick = () => { d.querySelector('b').textContent = 'Instalando…'; window.posHardware.instalarActualizacion(); };
  })()`).catch(() => undefined);
}
async function instalarAhora() {
  if (!autoUpdater || estadoActualizacion.fase !== 'lista') return false;
  // Respaldo cifrado antes de instalar, si ya está configurado en la página (carpeta y clave). Con tope de tiempo.
  try {
    await Promise.race([ventana.webContents.executeJavaScript('window.__POS_RESPALDAR__ ? window.__POS_RESPALDAR__() : null'), new Promise((r) => setTimeout(r, 20_000))]);
  } catch { /* sin respaldo configurado: se sigue */ }
  registro(`instalando v${estadoActualizacion.version}`);
  autoUpdater.quitAndInstall(true, true);
  return true;
}

// ── ventanas ──
function abrirVentana(pagina = 'index.html') {
  ventana = new BrowserWindow({
    width: 1366, height: 820, minWidth: 1024, minHeight: 640, show: false, backgroundColor: '#0b1b33', title: `${NOMBRE} v${app.getVersion()}`,
    icon: path.join(__dirname, 'build', 'icon.png'), fullscreen: ajustes.leer().pantallaCompleta,
    webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, sandbox: true, nodeIntegration: false, spellcheck: false, backgroundThrottling: false },
  });
  ventana.setMenuBarVisibility(true);
  ventana.once('ready-to-show', () => { ventana.maximize(); ventana.show(); });
  ventana.on('page-title-updated', (e) => e.preventDefault());
  ventana.webContents.setWindowOpenHandler(({ url }) => { if (/^https:/.test(url)) void shell.openExternal(url); return { action: 'deny' }; });
  void ventana.loadURL(`londuo://app/${pagina}`);
}
function abrirAjustes() {
  if (ventanaAjustes && !ventanaAjustes.isDestroyed()) return ventanaAjustes.focus();
  ventanaAjustes = new BrowserWindow({
    width: 760, height: 780, parent: ventana ?? undefined, modal: false, title: 'Hardware y actualizaciones', backgroundColor: '#ffffff', autoHideMenuBar: true,
    icon: path.join(__dirname, 'build', 'icon.png'),
    webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, sandbox: true, nodeIntegration: false },
  });
  ventanaAjustes.setMenu(null);
  void ventanaAjustes.loadURL('londuo://app/ajustes.html');
}

function menu() {
  const probar = (tipo) => () => void probarHardware(tipo).then((m) => dialog.showMessageBox(ventana, { type: 'info', message: m, buttons: ['Aceptar'] }), (e) => dialog.showErrorBox('No se pudo imprimir', e.message));
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    { label: 'Archivo', submenu: [
      { label: 'Caja (conectada al central)', click: () => ventana && ventana.loadURL('londuo://app/index.html') },
      { label: 'Modo de pruebas (datos sintéticos, sin central)', click: () => ventana && ventana.loadURL('londuo://app/prueba.html') },
      { type: 'separator' },
      { label: 'Pantalla completa', accelerator: 'F11', click: () => ventana && ventana.setFullScreen(!ventana.isFullScreen()) },
      { label: 'Recargar', accelerator: 'CmdOrCtrl+R', click: () => ventana && ventana.reload() },
      { type: 'separator' }, { label: 'Salir', role: 'quit' },
    ] },
    { label: 'Hardware', submenu: [
      { label: 'Configurar impresora y cajón…', accelerator: 'CmdOrCtrl+,', click: abrirAjustes },
      { type: 'separator' },
      { label: 'Imprimir ticket de prueba (con logo, QR y cajón)', click: probar('ticket') },
      { label: 'Imprimir ticket de prueba sin logo', click: probar('sin-logo') },
      { label: 'Abrir el cajón', click: probar('cajon') },
      { type: 'separator' },
      { label: 'Cambiar la cuenta de esta caja…', click: async () => {
        const r = await dialog.showMessageBox(ventana, { type: 'question', message: '¿Cambiar la cuenta de esta caja?', detail: 'Se olvida la cuenta guardada y se pedirá una nueva. Lo ya vendido y guardado en esta PC no se borra.', buttons: ['Cancelar', 'Cambiar cuenta'], defaultId: 0, cancelId: 0 });
        if (r.response === 1) { olvidarCuenta(); if (ventana) ventana.loadURL('londuo://app/index.html'); }
      } },
    ] },
    { label: 'Ayuda', submenu: [
      { label: 'Buscar actualización…', click: async () => { const e = await revisarActualizacion(); void dialog.showMessageBox(ventana, { type: e.fase === 'error' ? 'warning' : 'info', message: e.mensaje || 'Listo.', buttons: ['Aceptar'] }); } },
      { label: 'Abrir la carpeta de datos', click: () => shell.openPath(app.getPath('userData')) },
      { label: 'Herramientas de desarrollo', accelerator: 'CmdOrCtrl+Shift+I', click: () => ventana && ventana.webContents.toggleDevTools() },
      { type: 'separator' },
      { label: `Acerca de ${NOMBRE}`, click: () => dialog.showMessageBox(ventana, { type: 'info', title: NOMBRE, message: `${NOMBRE} · Smart Retail Management`, detail: `Versión ${app.getVersion()}\nCanal de actualizaciones: ${ajustes.leer().canal}\nDatos: ${app.getPath('userData')}`, buttons: ['Aceptar'] }) },
    ] },
  ]));
}

async function probarHardware(tipo) {
  const archivos = { ticket: 'ticket-prueba.bin', 'sin-logo': 'ticket-sin-logo.bin', cajon: 'solo-cajon.bin' };
  if (!archivos[tipo]) throw new Error('prueba desconocida');
  await imprimirBytes(bytesDe(archivos[tipo]));
  return tipo === 'cajon' ? 'Se envió la orden de abrir el cajón.' : 'Se envió el ticket de prueba. Revise acentos, logo, código de barras, QR y corte.';
}

function registrarIpc() {
  ipcMain.handle('hw:imprimir', (_e, bytes) => imprimirBytes(bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes)));
  ipcMain.handle('caja:credenciales', (e) => (e.senderFrame.url.startsWith('londuo://app/') ? leerCuenta() : null));
  ipcMain.handle('caja:guardar-credenciales', (_e, c) => { guardarCuenta(c); return true; });
  ipcMain.handle('caja:olvidar-credenciales', () => { olvidarCuenta(); return true; });
  ipcMain.handle('app:version', () => ({ version: app.getVersion(), canal: ajustes.leer().canal }));
  ipcMain.handle('app:carpeta-datos', () => app.getPath('userData'));
  ipcMain.handle('ajustes:leer', () => ({ ...ajustes.leer(), version: app.getVersion(), empaquetada: app.isPackaged, modoArchivo: !!process.env.LONDUO_IMPRESORA_ARCHIVO }));
  ipcMain.handle('ajustes:guardar', (_e, c) => { const a = ajustes.guardar(c); if (ventana) ventana.setFullScreen(!!a.pantallaCompleta); aplicarFuente(); programarRevisiones(); return a; });
  ipcMain.handle('ajustes:impresoras', () => impresora.listar());
  ipcMain.handle('ajustes:probar', (_e, tipo) => probarHardware(tipo));
  ipcMain.handle('upd:revisar', () => revisarActualizacion());
  ipcMain.handle('upd:estado', () => estadoActualizacion);
  ipcMain.handle('upd:instalar', () => instalarAhora());
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => { if (ventana) { if (ventana.isMinimized()) ventana.restore(); ventana.focus(); } });
  app.setAppUserModelId('mx.londuo.pos');
  void app.whenReady().then(() => {
    ajustes = crearAjustes(app.getPath('userData'));
    impresora = crearImpresoraRaw({ dirTmp: path.join(app.getPath('temp'), 'londuo-pos') });
    protocol.handle('londuo', (req) => {
      const rel = decodeURIComponent(new URL(req.url).pathname).replace(/^\/+/, '') || 'index.html';
      const archivo = path.normalize(path.join(DIR_APP, rel));
      if (!archivo.startsWith(DIR_APP + path.sep) || !fs.existsSync(archivo)) return new Response('no existe', { status: 404 });
      return net.fetch(pathToFileURL(archivo).toString());
    });
    // La cámara (foto de empleadas) y el portapapeles se permiten solo a la pantalla del POS.
    session.defaultSession.setPermissionRequestHandler((wc, permiso, ok) => ok(['media', 'clipboard-read', 'clipboard-sanitized-write', 'fullscreen'].includes(permiso) && wc.getURL().startsWith('londuo://app/')));
    registrarIpc();
    configurarActualizador();
    menu();
    abrirVentana();
    programarRevisiones();
    registro(`inicio v${app.getVersion()} (${process.platform})`);
  });
  app.on('window-all-closed', () => app.quit());
}
