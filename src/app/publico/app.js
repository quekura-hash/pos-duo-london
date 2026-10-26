// Interfaz de venta — vanilla JS, sin dependencias. Toda la lógica de negocio vive en el servidor local (servicio.ts).
const $ = (s, r = document) => r.querySelector(s);
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// ── dinero: centavos enteros, nunca coma flotante ──
const mxn = (c) => {
  const neg = c < 0, a = Math.abs(c);
  return `${neg ? '-' : ''}$${String(Math.floor(a / 100)).replace(/\B(?=(\d{3})+(?!\d))/g, ',')}.${String(a % 100).padStart(2, '0')}`;
};
const parseMXN = (txt) => {
  const m = /^(\d+)(?:\.(\d{1,2}))?$/.exec(String(txt).replace(/[$,\s]/g, ''));
  return m ? Number(m[1]) * 100 + Number((m[2] ?? '').padEnd(2, '0') || 0) : null;
};

async function api(ruta, cuerpo) {
  // En la versión que corre dentro del navegador (sin servidor) la API se atiende en la misma página.
  const j = window.__POS_ATENDER__
    ? (await window.__POS_ATENDER__(cuerpo === undefined ? 'GET' : 'POST', ruta, cuerpo)).json
    : await (await fetch(ruta, cuerpo === undefined ? {} : { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(cuerpo) })).json();
  if (!j.ok) {
    // El servidor antepone el código técnico («SIN_EMPLEADA: …»); a quien usa la pantalla solo le sirve el texto.
    const e = new Error((j.error?.mensaje ?? 'Error').replace(/^[A-Z][A-Z0-9_]{3,}: /, '')); e.codigo = j.error?.codigo; e.detalle = j.error?.detalle;
    // La sesión se cerró (otro cajero desactivado, reinicio…): se vuelve a la pantalla de inicio de sesión.
    if (e.codigo === 'NO_AUTENTICADO' && S.sesion?.autenticado !== false && ruta !== '/api/sesion' && ruta !== '/api/login') { S.sesion = { ...S.sesion, autenticado: false }; setTimeout(() => iniciar(), 0); }
    throw e;
  }
  return j;
}

const S = { sesion: null, vista: null, cart: null, carrito: null, sel: null, estado: null, ultimoFolio: null, reloj: null };
const hora = (iso) => new Date(Date.parse(iso) - 7 * 3600e3).toISOString().slice(11, 16); // America/Hermosillo (UTC-7)
const fechaHora = (iso) => { const l = new Date(Date.parse(iso) - 7 * 3600e3).toISOString(); return `${l.slice(8, 10)}/${l.slice(5, 7)}/${l.slice(0, 4)} ${l.slice(11, 16)}`; };


// ── iconos (SVG en línea, trazo heredado del texto: siguen el color del botón y del tema) ──
const I = {
  cart: '<circle cx="9" cy="20" r="1.4"/><circle cx="18" cy="20" r="1.4"/><path d="M2 3h3l2.7 12.4a1 1 0 0 0 1 .8h8.8a1 1 0 0 0 1-.8L20 7H6"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  card: '<rect x="2.5" y="5" width="19" height="14" rx="2.5"/><path d="M2.5 10h19M6 15h4"/>',
  chart: '<path d="M5 20V11M12 20V4M19 20v-6"/>',
  gift: '<rect x="3" y="8" width="18" height="4" rx="1"/><path d="M12 8v13M5 12v8a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-8"/><path d="M7.5 8a2.5 2.5 0 0 1 0-5C10 3 12 8 12 8s2-5 4.5-5a2.5 2.5 0 0 1 0 5"/>',
  box: '<path d="M21 8 12 3 3 8v8l9 5 9-5z"/><path d="M3 8l9 5 9-5M12 13v8"/>',
  trend: '<path d="M3 17l6-6 4 4 8-8"/><path d="M15 7h6v6"/>',
  warehouse: '<path d="M3 10 12 4l9 6v10H3z"/><path d="M8 20v-6h8v6M8 17h8"/>',
  bell: '<path d="M6 17V11a6 6 0 0 1 12 0v6l1.5 2h-15z"/><path d="M10 21h4"/>',
  upload: '<path d="M12 16V5m0 0-4 4m4-4 4 4M5 20h14"/>',
  // Iconos de Lucide (settings, tag, banknote) y una caja registradora dibujada en el mismo estilo (Lucide no trae una).
  settings: '<path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="3"/>',
  tag: '<path d="M12.586 2.586A2 2 0 0 0 11.172 2H4a2 2 0 0 0-2 2v7.172a2 2 0 0 0 .586 1.414l8.704 8.704a2.426 2.426 0 0 0 3.42 0l6.58-6.58a2.426 2.426 0 0 0 0-3.42z"/><circle cx="7.5" cy="7.5" r=".5" fill="currentColor"/>',
  banknote: '<rect width="20" height="12" x="2" y="6" rx="2"/><circle cx="12" cy="12" r="2"/><path d="M6 12h.01M18 12h.01"/>',
  register: '<rect x="7" y="3" width="10" height="5" rx="1"/><path d="M12 8v3M4 11h16l1.5 5h-19z"/><rect x="2.5" y="16" width="19" height="5" rx="1"/><path d="M8 13.5h.01M12 13.5h.01M16 13.5h.01M10 18.5h4"/>',
  barcode: '<path d="M4 5v14M7 5v14M11 5v14M14 5v14M18 5v14M20.5 5v14"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  pencil: '<path d="M4 20h4L19 9a2.8 2.8 0 0 0-4-4L4 16z"/><path d="m13.5 6.5 4 4"/>',
  trash: '<path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 11v6M14 11v6"/>',
  undo: '<path d="M9 14 4 9l5-5"/><path d="M4 9h10a6 6 0 0 1 0 12h-3"/>',
  pause: '<path d="M9 5v14M15 5v14"/>',
  store: '<path d="M3 9l1.5-5h15L21 9"/><path d="M3 9a3 3 0 0 0 6 0 3 3 0 0 0 6 0 3 3 0 0 0 6 0"/><path d="M5 12v8h14v-8M10 20v-5h4v5"/>',
  caja: '<rect x="5" y="3" width="14" height="6" rx="1"/><path d="M3 21v-7a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v7zM8 16h.01M12 16h.01M16 16h.01"/>',
  camera: '<path d="M4 8h3l1.5-2h7L17 8h3a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1z"/><circle cx="12" cy="13" r="3.5"/>',
  calc: '<rect x="5" y="3" width="14" height="18" rx="2"/><path d="M8 7h8M8 12h.01M12 12h.01M16 12h.01M8 16h.01M12 16h.01M16 16h.01"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
  lock: '<rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>',
  calendar: '<rect x="3.5" y="5" width="17" height="15" rx="2"/><path d="M3.5 10h17M8 3v4M16 3v4"/>',
  cash: '<rect x="2.5" y="6" width="19" height="12" rx="2"/><circle cx="12" cy="12" r="2.6"/><path d="M6 12h.01M18 12h.01"/>',
  mixto: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M12 4v16M3 12h9"/>',
  receipt: '<path d="M6 3h12v18l-3-2-3 2-3-2-3 2z"/><path d="M9 8h6M9 12h6"/>',
  printer: '<path d="M7 9V3h10v6M7 17H5a2 2 0 0 1-2-2v-4a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v4a2 2 0 0 1-2 2h-2"/><rect x="7" y="14" width="10" height="7"/>',
  download: '<path d="M12 4v11m0 0-4-4m4 4 4-4M5 20h14"/>',
  chevron: '<path d="m9 6 6 6-6 6"/>',
  file: '<path d="M6 3h8l4 4v14H6z"/><path d="M14 3v4h4"/>',
  check: '<path d="m5 12.5 4.5 4.5L19 7.5"/>',
  refresh: '<path d="M20 11a8 8 0 0 0-14.5-4M4 4v4h4M4 13a8 8 0 0 0 14.5 4M20 20v-4h-4"/>',
  x: '<path d="M6 6l12 12M18 6 6 18"/>',
  dollar: '<path d="M12 3v18M16 7.5c0-1.7-1.8-3-4-3s-4 1.3-4 3 1.8 2.8 4 3.2 4 1.5 4 3.3-1.8 3-4 3-4-1.3-4-3"/>',
};
const ico = (n, cls = '') => `<svg class="ico ${cls}" viewBox="0 0 24 24" aria-hidden="true" focusable="false">${I[n]}</svg>`;
/** Botón de una función que aún no existe: visible, deshabilitado y rotulado "Próximamente" (nunca finge funcionar). */
const pronto = (id, icono, texto, extra = '') => `<button class="btn proximamente ${extra}" id="${id}" type="button" disabled title="Próximamente" aria-label="${texto} (próximamente)">${ico(icono)}<span>${texto}</span></button>`;
// Dólares (centavos de dólar) y tipo de cambio (diezmilésimas de peso por dólar): enteros, igual que en el servidor.
const usd = (c) => `US$${mxn(c).slice(1)}`;
const parseTasa = (t) => {
  const m = /^(\d{1,6})(?:\.(\d{1,4}))?$/.exec(String(t).replace(/[$,\s]/g, ''));
  if (!m) return null;
  const v = Number(m[1]) * 10000 + Number((m[2] ?? '').padEnd(4, '0') || 0);
  return v > 0 ? v : null;
};
/** Misma regla que el servidor: al centavo, mitad hacia arriba. Solo para mostrar; el servidor recalcula y manda lo que guarda. */
const usdAMxn = (usdC, tasa) => Math.floor((usdC * tasa + 5000) / 10000);
const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
const fechaCorta = (iso) => { const l = new Date(Date.parse(iso) - 7 * 3600e3).toISOString(); return `${l.slice(8, 10)} ${MESES[Number(l.slice(5, 7)) - 1]} ${l.slice(0, 4)} · ${l.slice(11, 16)}`; };
const logoDe = (t) => window.__POS_LOGOS__?.[t] ?? (t === 'DUO' ? 'logo-duo.png' : 'logo-london.png');
const NOMBRE_METODO = { efectivo: 'Efectivo', tarjeta: 'Tarjeta', tarjeta_regalo: 'Tarjeta de regalo' };

/** Logo de la tienda arriba del ticket (versión en 1 bit para papel térmico). */
const logoTicket = (t) => window.__POS_LOGOS_TICKET__?.[t] ?? (t === 'DUO' ? 'ticket-duo.png' : 'ticket-london.png');
const logoTicketHtml = () => (S.estado?.tienda ? `<div class="logo-ticket-cont"><img class="logo-ticket" id="logo-ticket" src="${logoTicket(S.estado.tienda)}" alt="Logo de ${esc(S.estado.negocio ?? S.estado.tienda)}"></div>` : '');

// ── Puente de impresión por el navegador (Windows): con el controlador de Epson instalado, el ticket sale por el diálogo de impresión de Chrome
// (sin diálogo si Chrome se abre con --kiosk-printing). Imprime como imagen: el cajón se abre por la configuración del controlador y el QR sale dibujado. ──
const impNavegador = () => { try { return localStorage.getItem('pos-imp-navegador') === '1'; } catch { return false; } };
async function imprimirNavegador(texto, { qrs = [], logo = true } = {}) {
  if (!impNavegador()) return false;
  let z = document.getElementById('zona-impresion');
  if (!z) { z = document.createElement('div'); z.id = 'zona-impresion'; document.body.appendChild(z); }
  z.innerHTML = `${logo ? logoTicketHtml() : ''}<pre>${esc(texto)}</pre>${qrs.map((q) => `<div class="qr-imp"><canvas width="180" height="180" data-qr="${esc(q)}"></canvas><div>${esc(q)}</div></div>`).join('')}`;
  for (const cv of z.querySelectorAll('canvas[data-qr]')) dibujarQR(cv.getContext('2d'), cv.dataset.qr, 0, 0, 180);
  await Promise.all([...z.querySelectorAll('img')].map((i) => (i.decode ? i.decode().catch(() => {}) : Promise.resolve())));
  try { window.print(); } finally { z.innerHTML = ''; }
  return true;
}
/** Comprobante corto de «Abrir caja»: al imprimirse, el controlador abre el cajón (configurado «antes de imprimir»). */
function comprobanteApertura() {
  const c = 42, centro = (t) => ' '.repeat(Math.max(0, Math.floor((c - t.length) / 2))) + t;
  const f = new Date();
  const dd = (n) => String(n).padStart(2, '0');
  return [centro('APERTURA DE CAJA'), centro(`Tienda ${S.sesion.tienda} - Caja ${S.sesion.caja}`), `Usuario: ${S.sesion.usuario ?? ''}`, `Fecha: ${dd(f.getDate())}/${dd(f.getMonth() + 1)}/${f.getFullYear()}  Hora: ${dd(f.getHours())}:${dd(f.getMinutes())}`].join('\n');
}

// ── barra superior y pie ──
async function pintarEncabezado() {
  const h = $('#encabezado');
  const pie = $('#pie');
  if (S.sesion.rol === 'admin') {
    h.innerHTML = `<div class="logos"><img class="logo" src="${logoDe('DUO')}" alt="DÚO New York"><img class="logo" src="${logoDe('LON')}" alt="London Love"></div>
      <div class="titulo">Administración</div>
      <div class="datos">${window.__POS_NUBE__ ? `<span class="chip-top sincro-nube" data-chip="sync"><span id="estado-nube" class="estado-nube" role="status" aria-live="polite">Sin sesión</span><button class="btn-sync" type="button" id="btn-sync" title="Sincronizar ahora" aria-label="Sincronizar ahora">${ico('refresh')}</button></span>` : ''}<span class="chip-top" data-chip="usuario">${ico('user')}<span>Usuario: <b>${esc(S.sesion.usuario)}</b></span></span><span class="chip-top" data-chip="rol">${ico('settings')}<b>Administración${S.sesion.requiere_login && S.sesion.rol_usuario ? ` · ${S.sesion.rol_usuario === 'almacenista' ? 'Almacenista' : 'Supervisor'}` : ''}</b></span>
      <span class="chip-top" data-chip="alcance">${ico('store')}<span>Una, varias o todas las cajas</span></span>${S.sesion.requiere_login ? `<button class="btn" type="button" id="btn-salir" title="Cerrar la sesión">${ico('x')}<span>Cerrar sesión</span></button>` : ''}</div>`;
    pie.innerHTML = `<span>Usuario: ${esc(S.sesion.usuario)}</span><span>Administración · consolida cajas y tiendas</span><span>Precios en MXN</span>`;
    await pintarTipoCambio();
    window.__POS_PINTAR_ESTADO__?.();
    return;
  }
  const { estado: e } = await api('/api/estado?pasivo=1');
  S.estado = e;
  pintarTipoCambio();
  const c = e.conexion;
  const sincro = !c.hub ? ['mal', 'Sin hub'] : c.pendientes > 0 ? ['pendiente', `${c.pendientes} por sincronizar`] : ['', 'Sincronizado'];
  h.innerHTML = `
    <img class="logo" src="${logoDe(e.tienda)}" alt="${esc(e.negocio)}" data-logo="${esc(e.tienda)}">
    <div class="titulo">Punto de venta</div>
    <div class="datos">
      <span class="chip-top" data-chip="tienda">${ico('store')}<span>Tienda: <b>${esc(e.negocio)}</b></span></span>
      <span class="chip-top" data-chip="caja">${ico('caja')}<span>CAJA <b>${e.caja}</b></span></span>
      <span class="chip-top" data-chip="usuario">${avatarBarra(e.usuario, e.usuario_foto)}<span>${S.sesion?.supervisor ? 'Supervisor' : 'Vendedora-Cajera'}: <b>${esc(e.usuario)}</b></span></span>
      <span class="sincro ${sincro[0]}" data-chip="sincro">${sincro[1]}</span>
      <span class="chip-top" data-chip="fecha">${ico('calendar')}<b>${fechaCorta(e.ahora)}</b></span>
      ${S.sesion.requiere_login ? `<button class="btn" type="button" id="btn-salir" title="Cerrar la sesión">${ico('x')}<span>Cerrar sesión</span></button>` : ''}
    </div>
    ${e.folios === 'recuperacion' ? `<div class="alerta-banda" style="flex-basis:100%;margin:0;display:flex;gap:12px;align-items:center;flex-wrap:wrap" role="alert" data-alerta="folios"><span>Esta caja no puede vender: hay que revisar los folios.</span><button class="btn" type="button" id="btn-revisar-folios">${ico('receipt')}<span>Revisar folios</span></button></div>` : ''}
    ${e.alertas.perdida_documental_abierta ? `<div class="alerta-banda" style="flex-basis:100%;margin:0" role="alert" data-alerta="perdida">Hay una posible pérdida de ventas, pagos o folios de esta caja sin resolver (Administración).</div>` : ''}
    ${e.alertas.articulos_no_verificados ? `<div class="alerta-banda" style="flex-basis:100%;margin:0" role="status" data-alerta="inventario">Existencias sin verificar: ${e.alertas.articulos_no_verificados} artículos (requieren conteo físico).</div>` : ''}`;
  $('#btn-revisar-folios')?.addEventListener('click', () => ir('folios'));
  const pagos = e.metodos.map((m) => NOMBRE_METODO[m].toLowerCase()).join(', ').replace(/, ([^,]*)$/, ' y $1');
  pie.innerHTML = `
    <span data-chip="pie-usuario">Usuario: ${esc(e.usuario)}</span>
    <span data-chip="pie-caja">Caja ${e.caja} · ${esc(pagos.charAt(0).toUpperCase() + pagos.slice(1))}</span>
    <span>Precios en MXN</span>
    <span class="${c.hub ? 'estado-ok' : 'estado-mal'}" data-chip="hub">Hub de la tienda: <b>${c.hub ? 'Conectado' : 'Sin conexión'}</b></span>
    <span class="${c.internet === false ? 'estado-mal' : c.internet ? 'estado-ok' : ''}" data-chip="internet">Internet: <b>${c.internet === null ? 'Sin dato' : c.internet ? 'Conectado' : 'Sin internet'}</b></span>
    <span data-chip="pendientes">Pendientes de sincronizar: <b>${c.pendientes}</b></span>
    <span data-chip="sync">Última sincronización: <b>${c.ultima_sync ? hora(c.ultima_sync) : 'Sin sincronizar'}</b></span>`;
  const f = $('#folio-linea b');
  if (f) { f.textContent = folioTexto(); f.parentElement.hidden = !S.ultimoFolio; }
}
const folioTexto = () => (S.ultimoFolio ? `Folio ${String(S.ultimoFolio).padStart(6, '0')}` : '');

// ── navegación ──
const NAV = {
  venta: ['Venta', 'cart'], retiro: ['Retiro', 'cash'], ventas: ['Historial', 'clock'], corte: ['Cierre de caja', 'register'], extraordinarias: ['Operaciones extraordinarias', 'cash'],
  tarjetas: ['Tarjetas de regalo', 'gift'], reportes: ['Reportes', 'chart'], cortes: ['Cortes', 'register'], empleadas: ['Personal', 'user'], dolares: ['Dólares recibidos', 'dollar'], descuentos: ['Descuentos', 'tag'], entregas: ['Entregas de almacén', 'warehouse'], inventario: ['Inventario', 'box'], departamentos: ['Departamentos', 'box'], almacen: ['Almacén', 'warehouse'], promociones: ['Promociones', 'tag'], tiendas: ['Tiendas', 'store'], configuracion: ['Configuración', 'settings'], administracion: ['Administración', 'settings'], volver_caja: ['Caja', 'caja'], tipo_cambio: ['Tipo de cambio', 'banknote'], avisos: ['Avisos', 'bell'], analisis: ['Análisis', 'trend'], historial: ['Historial de ventas', 'clock'],
};
// ── Calculadora básica: ventana flotante y movible, no modal. Sigue abierta mientras se usa el resto del POS ──
const calc = { abierta: false, pos: null, acc: null, op: null, entrada: '0', nuevo: true };
const OPS_CALC = { '+': '+', '-': '−', '*': '×', '/': '÷' };
const redondeaCalc = (n) => Number.parseFloat(n.toPrecision(12));
function calcAplicar(a, op, b) { return op === '+' ? a + b : op === '-' ? a - b : op === '*' ? a * b : op === '/' ? (b === 0 ? NaN : a / b) : b; }
function calcTecla(k) {
  const ent = () => Number(calc.entrada);
  if (/^\d$/.test(k)) { calc.entrada = calc.nuevo || calc.entrada === '0' ? k : (calc.entrada.replace('-', '').replace('.', '').length >= 15 ? calc.entrada : calc.entrada + k); calc.nuevo = false; }
  else if (k === '.') { if (calc.nuevo) { calc.entrada = '0.'; calc.nuevo = false; } else if (!calc.entrada.includes('.')) calc.entrada += '.'; }
  else if (k === 'C') { calc.acc = null; calc.op = null; calc.entrada = '0'; calc.nuevo = true; }
  else if (k === 'Backspace') { if (!calc.nuevo) { calc.entrada = calc.entrada.length > 1 && calc.entrada !== '-0' ? calc.entrada.slice(0, -1) : '0'; if (calc.entrada === '-') calc.entrada = '0'; } }
  else if (k === 'neg') { if (calc.entrada !== '0') calc.entrada = calc.entrada.startsWith('-') ? calc.entrada.slice(1) : `-${calc.entrada}`; }
  else if (k === '%') { const v = calc.acc !== null && calc.op ? (calc.acc * ent()) / 100 : ent() / 100; calc.entrada = String(redondeaCalc(v)); calc.nuevo = false; }
  else if (k in OPS_CALC) {
    if (calc.op && !calc.nuevo) { calc.acc = redondeaCalc(calcAplicar(calc.acc, calc.op, ent())); calc.entrada = String(calc.acc); } else if (calc.acc === null || !calc.op) calc.acc = ent();
    calc.op = k; calc.nuevo = true;
  } else if (k === '=') {
    if (calc.op) { const r = redondeaCalc(calcAplicar(calc.acc, calc.op, ent())); calc.entrada = Number.isFinite(r) ? String(r) : 'Error'; calc.acc = null; calc.op = null; calc.nuevo = true; }
  }
  if (calc.entrada === 'Error' && k !== 'C') { /* se queda hasta borrar */ }
  pintarCalculadora();
}
function pintarCalculadora() {
  const d = $('#calculadora');
  if (!d) return;
  const err = calc.entrada === 'Error';
  $('#calc-pantalla').textContent = err ? 'Error' : (() => { const [e, f] = calc.entrada.split('.'); return `${Number(e.replace('-', '')) ? Number(e.replace('-', '')).toLocaleString('en-US') : '0'}${f !== undefined ? `.${f}` : ''}`.replace(/^/, calc.entrada.startsWith('-') ? '-' : ''); })();
  $('#calc-previa').textContent = calc.op && calc.acc !== null ? `${calc.acc.toLocaleString('en-US')} ${OPS_CALC[calc.op]}` : '';
  if (err) calc.entrada = '0', calc.nuevo = true, calc.acc = null, calc.op = null;
}
function abrirCalculadora() {
  if ($('#calculadora')) return;
  calc.abierta = true;
  const teclas = [['C', 'C'], ['neg', '±'], ['%', '%'], ['/', '÷'], ['7', '7'], ['8', '8'], ['9', '9'], ['*', '×'], ['4', '4'], ['5', '5'], ['6', '6'], ['-', '−'], ['1', '1'], ['2', '2'], ['3', '3'], ['+', '+'], ['0', '0'], ['.', '.'], ['Backspace', '⌫'], ['=', '=']];
  const d = document.createElement('div');
  d.id = 'calculadora';
  d.setAttribute('role', 'dialog');
  d.setAttribute('aria-label', 'Calculadora');
  d.tabIndex = 0;
  d.style.cssText = 'outline:none;position:fixed;z-index:50;width:244px;background:var(--superficie);color:var(--texto);border:1px solid var(--borde);border-radius:14px;box-shadow:0 10px 40px rgba(0,0,0,.35);user-select:none;touch-action:none';
  d.innerHTML = `<div id="calc-barra" style="display:flex;align-items:center;justify-content:space-between;padding:8px 10px;cursor:move;border-bottom:1px solid var(--borde)"><b style="display:inline-flex;gap:6px;align-items:center">${ico('calc')}Calculadora</b><button type="button" id="calc-cerrar" class="btn btn-icono" aria-label="Cerrar la calculadora" title="Cerrar">${ico('x')}</button></div>
    <div style="padding:10px"><div id="calc-visor" style="cursor:text"><div id="calc-previa" style="min-height:18px;text-align:right;font-size:13px;color:var(--texto-2)"></div><div id="calc-pantalla" aria-live="polite" style="text-align:right;font-size:28px;font-weight:700;padding:2px 4px 8px;overflow:hidden;white-space:nowrap">0</div></div>
    <div id="calc-ayuda" class="nota" style="font-size:11px;text-align:center;margin:0 0 6px"></div>
    <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:6px">${teclas.map(([k, t]) => `<button type="button" class="btn" data-calc="${k}" tabindex="-1" style="padding:10px 0;justify-content:center;font-size:17px;${/[+\-*/=]/.test(k) ? 'background:var(--acento);color:var(--acento-texto);border-color:var(--acento)' : ''}">${t}</button>`).join('')}</div></div>`;
  document.body.appendChild(d);
  // No se roba el foco: así el cursor sigue en la búsqueda o en el campo que se estaba usando.
  // Las teclas del mouse no la enfocan; el teclado funciona cuando la calculadora tiene el foco: al abrirla con el menú, o al tocar su barra o su visor.
  d.addEventListener('mousedown', (ev) => { if (!ev.target.closest('#calc-barra, #calc-visor')) ev.preventDefault(); else if (!ev.target.closest('#calc-cerrar')) setTimeout(() => d.focus(), 0); });
  const marcarFoco = (on) => { d.style.borderColor = on ? 'var(--acento)' : 'var(--borde)'; d.style.boxShadow = on ? '0 0 0 3px var(--acento), 0 10px 40px rgba(0,0,0,.35)' : '0 10px 40px rgba(0,0,0,.35)'; $('#calc-ayuda').textContent = on ? 'Teclado activo: 0-9 + - * / Enter . Esc' : 'Toque la barra o el visor para usar el teclado'; };
  d.addEventListener('focus', () => marcarFoco(true));
  d.addEventListener('blur', () => marcarFoco(false));
  d.addEventListener('keydown', (ev) => {
    if (ev.ctrlKey || ev.metaKey || ev.altKey) return;
    const mapa = { Enter: '=', '=': '=', ',': '.', '.': '.', Delete: 'C', Escape: 'C', Backspace: 'Backspace', '%': '%', '+': '+', '-': '-', '*': '*', '/': '/', x: '*', X: '*' };
    const k = /^\d$/.test(ev.key) ? ev.key : mapa[ev.key];
    if (!k) return; // Tab y demás teclas siguen su camino normal
    ev.preventDefault();
    ev.stopPropagation();
    calcTecla(k);
  });
  for (const b of d.querySelectorAll('[data-calc]')) b.addEventListener('click', () => calcTecla(b.dataset.calc));
  $('#calc-cerrar').addEventListener('click', cerrarCalculadora);
  // Mover: se arrastra por la barra y se mantiene dentro de la ventana.
  const colocar = (x, y) => {
    const w = d.offsetWidth, h = d.offsetHeight;
    calc.pos = { x: Math.max(0, Math.min(window.innerWidth - w, x)), y: Math.max(0, Math.min(window.innerHeight - h, y)) };
    d.style.left = `${calc.pos.x}px`; d.style.top = `${calc.pos.y}px`;
  };
  colocar(calc.pos?.x ?? window.innerWidth - 270, calc.pos?.y ?? 90);
  $('#calc-barra').addEventListener('pointerdown', (ev) => {
    if (ev.target.closest('#calc-cerrar')) return;
    const dx = ev.clientX - calc.pos.x, dy = ev.clientY - calc.pos.y;
    const mover = (e) => colocar(e.clientX - dx, e.clientY - dy);
    const soltar = () => { window.removeEventListener('pointermove', mover); window.removeEventListener('pointerup', soltar); };
    window.addEventListener('pointermove', mover);
    window.addEventListener('pointerup', soltar);
  });
  window.addEventListener('resize', calc.reubicar = () => colocar(calc.pos.x, calc.pos.y));
  pintarCalculadora();
  marcarFoco(false);
  $('#btn-calculadora')?.setAttribute('aria-pressed', 'true');
  d.focus(); // se abrió a propósito: el teclado queda listo
}
function cerrarCalculadora() {
  $('#calculadora')?.remove();
  if (calc.reubicar) window.removeEventListener('resize', calc.reubicar);
  calc.abierta = false;
  $('#btn-calculadora')?.setAttribute('aria-pressed', 'false');
}

function pintarNav() {
  // En la página de prueba (una sola ventana) se puede pasar de la caja a Administración y volver; en la app real cada sesión es la suya.
  const cambia = !!window.__POS_CAMBIAR_SESION__;
  const avisos = S.sesion.rol !== 'cajero' && window.__POS_NOTIF__ && S.sesion.rol_usuario === 'supervisor' ? ['avisos'] : [];
  const items = S.sesion.rol === 'cajero' ? [...S.sesion.nav, ...(cambia ? ['administracion'] : [])] : [...S.sesion.nav, ...avisos, ...(cambia ? ['volver_caja'] : [])];
  $('#nav').innerHTML = items.map((v) => `<button type="button" data-vista="${v}" title="${NAV[v][0]}" ${v === ({ descuentos: 'promociones', dolares: 'cortes', entregas: 'almacen', conteo_limbo: 'inventario' }[S.vista] ?? S.vista) ? 'aria-current="page"' : ''}>${ico(NAV[v][1])}<span>${NAV[v][0]}</span></button>`).join('');
  // Calculadora de la caja: ventana flotante que no bloquea nada (se abre desde el menú lateral y se cierra con su X).
  if (S.sesion.rol === 'cajero') {
    $('#nav').insertAdjacentHTML('beforeend', `<button type="button" id="btn-calculadora" title="Calculadora" aria-pressed="${calc.abierta ? 'true' : 'false'}">${ico('calc')}<span>Calculadora</span></button>`);
    $('#btn-calculadora').addEventListener('click', () => (calc.abierta ? cerrarCalculadora() : abrirCalculadora()));
  }
  for (const b of $('#nav').querySelectorAll('button[data-vista]')) {
    b.addEventListener('click', () => {
      if (b.dataset.vista === 'administracion') return window.__POS_CAMBIAR_SESION__('admin');
      if (b.dataset.vista === 'volver_caja') return window.__POS_CAMBIAR_SESION__('caja');
      return ir(b.dataset.vista);
    });
  }
}
async function ir(v) {
  S.vista = v;
  if (v === 'corte') S.cierrePaso = undefined; // el cierre guiado arranca en el primer paso pendiente
  pintarNav();
  await pintarEncabezado();
  await ({ folios: vistaFolios, venta: vistaVenta, retiro: vistaRetiro, corte: vistaCorte, extraordinarias: vistaExtraordinarias, ventas: vistaVentas, reportes: vistaReportes, inventario: vistaInventario, almacen: vistaAlmacen, promociones: vistaPromociones, configuracion: vistaConfiguracion, tiendas: vistaTiendas, departamentos: vistaDepartamentos, tarjetas: vistaTarjetas, devolucion: vistaDevolucion, dolares: vistaDolares, descuentos: vistaDescuentos, entregas: vistaEntregas, conteo_limbo: vistaConteoLimbo, tipo_cambio: vistaTipoCambio, cortes: vistaCortes, empleadas: vistaPersonal, avisos: vistaAvisos, analisis: vistaAnalisis, historial: vistaHistorialAdmin })[v]();
  if (v !== 'almacen') await avisosPisoInicial();
}

// ── P-06: folios. Si la serie se bloquea (disco nuevo, respaldo restaurado, ticket con folio mayor…) no se vende hasta confirmar cómo continuar ──
const MOTIVO_FOLIOS = {
  disco_nuevo_en_caja_existente: 'Esta caja se instaló con un disco nuevo, pero ya había vendido antes: no se sabe qué folios se emitieron.',
  restaurado_desde_respaldo: 'Se restauró un respaldo: puede faltar lo vendido después de esa copia.',
  contador_local_atrasado_respecto_a_hub_o_central: 'El hub o el central tienen registrados folios más altos que los de esta caja.',
  ticket_con_folio_mayor_al_contador: 'Se escaneó un ticket de esta caja con un folio mayor al último que la caja tiene registrado.',
};
const EVIDENCIAS_FOLIO = [['ticket_impreso', 'Último ticket impreso'], ['libreta', 'Libreta o bitácora de la caja'], ['reporte_hub', 'Reporte del hub o del central'], ['otra', 'Otra']];
const folio6 = (n) => String(n).padStart(6, '0');
// Lo que se teclea para buscar un ticket: el código impreso (D2-000003, D2000003) o el folio suelto (3, 000003).
const LETRAS_TIENDA = { DUO: 'D', LON: 'L' };
const letraTienda = (t) => LETRAS_TIENDA[t] ?? '';
function interpretarFolioUI(texto) {
  const t = String(texto).trim();
  if (/^\d{1,9}$/.test(t)) return Number(t) > 0 ? { folio: Number(t) } : null;
  const m = /^([A-Za-z])\s*(\d)\s*-?\s*(\d{1,9})$/.exec(t);
  return m && Number(m[3]) > 0 ? { folio: Number(m[3]), caja: Number(m[2]), letra: m[1].toUpperCase() } : null;
}
async function vistaFolios() {
  const f = await api('/api/folios');
  const rangos = f.huecos.map((h) => (h.desde === h.hasta ? folio6(h.desde) : `${folio6(h.desde)} a ${folio6(h.hasta)}`));
  if (f.estado === 'activa') {
    $('#vista').innerHTML = `<div class="titulo-vista">${ico('receipt')}<h1>Folios</h1></div>
      <section class="panel" id="folios-ok"><p style="font-size:17px;margin-top:0">La serie de folios de esta caja está <b>en orden</b>. Último folio registrado: <b id="folio-ultimo">${f.ultimo ? folio6(f.ultimo) : 'ninguno todavía'}</b>.</p>
        ${f.huecos.length ? `<p class="nota" id="folios-huecos">Folios que quedaron sin comprobar tras una recuperación anterior (documentados, no se reutilizan): <b>${rangos.join(', ')}</b>.</p>` : ''}
        <button class="btn btn-primario" id="folios-volver" type="button" style="width:auto">${ico('cart')}<span>Volver a la venta</span></button></section>`;
    $('#folios-volver').addEventListener('click', () => ir('venta'));
    return;
  }
  const pideClave = f.pide_clave;
  $('#vista').innerHTML = `<div class="titulo-vista">${ico('receipt')}<h1>Revisar folios</h1></div>
    <section class="panel" id="folios-bloqueo">
      <div class="mensaje error" role="alert" style="margin-top:0"><b>La caja no puede vender hasta que se confirme cómo continuar.</b> ${esc(MOTIVO_FOLIOS[f.motivo] ?? f.motivo ?? '')}</div>
      <dl class="detalle" id="folios-datos" style="margin:12px 0">
        <div><dt>Último folio registrado en esta caja</dt><dd id="folio-ultimo"><b>${f.ultimo ? folio6(f.ultimo) : 'ninguno'}</b></dd></div>
        <div><dt>Mayor folio que conoce el hub o el central</dt><dd id="folio-hub">${f.hub.disponible ? `<b>${f.hub.hwm ? folio6(f.hub.hwm) : 'ninguno'}</b>${f.hub.techo ? ` (concedido hasta ${folio6(f.hub.techo)})` : ''}` : '<span style="color:var(--aviso)">sin conexión: no se puede contrastar</span>'}</dd></div>
        ${f.visto_en_ticket ? `<div><dt>Folio visto en un ticket escaneado</dt><dd id="folio-visto"><b>${folio6(f.visto_en_ticket)}</b></dd></div>` : ''}
        <div><dt>Folio sugerido para continuar</dt><dd id="folio-sugerido"><b>${folio6(f.sugerido)}</b></dd></div>
      </dl>
      <p class="nota" id="folios-aviso">Los folios entre el último registrado y el elegido <b>no se reutilizan</b>: quedan documentados como «sin comprobar» y Administración los verá. Si hay tickets impresos con folios que la caja no tiene, súbalos al número mayor que vea.</p>
      ${f.recuperacion_automatica ? `<div class="mensaje ok" style="margin:12px 0">El hub tiene el techo de folios concedido a esta caja: puede recuperarse automáticamente.<br><button class="btn btn-primario" id="folios-auto" type="button" style="width:auto;margin-top:8px">${ico('refresh')}<span>Recuperar automáticamente</span></button></div>` : ''}
      <form id="form-folios" autocomplete="off"><h2 style="margin-bottom:4px">Continuar con confirmación</h2>
        <div class="filas" style="align-items:flex-end">
          <div class="campo"><label for="fo-siguiente">Siguiente folio a usar</label><input id="fo-siguiente" inputmode="numeric" value="${f.sugerido}" style="width:130px"></div>
          <div class="campo"><label for="fo-tipo">Evidencia</label><select id="fo-tipo" style="padding:10px;border:2px solid var(--borde);border-radius:10px;background:var(--superficie)">${EVIDENCIAS_FOLIO.map(([v, t]) => `<option value="${v}">${t}</option>`).join('')}</select></div>
          <div class="campo" style="flex:1;min-width:220px"><label for="fo-ref">En qué se apoya (obligatorio)</label><input id="fo-ref" class="texto" maxlength="120" placeholder="Ej. último ticket impreso D1-000142"></div></div>
        ${f.hub.disponible ? '' : '<label style="display:block;margin:8px 0"><input type="checkbox" id="fo-sin-hub"> Confirmo que no hay forma de contrastar con el hub o el central y quiero continuar sin ese contraste.</label>'}
        ${pideClave ? `<div class="filas" style="align-items:flex-end"><div class="campo"><label for="fo-quien">Confirma (supervisor)</label><select id="fo-quien" style="padding:10px;border:2px solid var(--borde);border-radius:10px;background:var(--superficie)">${f.supervisores.map((n) => `<option>${esc(n)}</option>`).join('')}</select></div>
          <div class="campo"><label for="fo-clave">Su clave</label><input id="fo-clave" type="text" data-pin inputmode="numeric" autocomplete="off" placeholder="••••"></div></div>
          ${casillaSola('fo-solo', 'No hay supervisor: confirmo yo con mi clave (queda anotado)')}` : ''}
        <div id="msg-folios" class="mensaje" role="alert"></div>
        <button class="btn btn-peligro" type="submit" id="fo-confirmar" style="width:auto">${ico('check')}<span>Confirmar y continuar</span></button>
      </form></section>`;
  $('#folios-auto')?.addEventListener('click', async () => {
    try { await api('/api/folios/recuperar', {}); await foliosListo('Folios recuperados automáticamente; los huecos quedaron documentados.'); }
    catch (e) { const m = $('#msg-folios'); m.className = 'mensaje error'; m.textContent = e.message; }
  });
  $('#fo-solo')?.addEventListener('change', (e) => { $('#fo-quien').closest('.campo').hidden = e.target.checked; });
  $('#form-folios').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const m = $('#msg-folios');
    const siguiente = Number($('#fo-siguiente').value);
    if (!Number.isInteger(siguiente) || siguiente < 1) { m.className = 'mensaje error'; m.textContent = 'Escriba el número de folio siguiente.'; return; }
    if (!$('#fo-ref').value.trim()) { m.className = 'mensaje error'; m.textContent = 'Escriba en qué evidencia se apoya (por ejemplo, el último ticket impreso).'; return; }
    const foSolo = pideClave && $('#fo-solo')?.checked;
    if (pideClave && !$('#fo-clave').value) { m.className = 'mensaje error'; m.textContent = 'El supervisor debe teclear su clave.'; return; }
    try {
      await api('/api/folios/confirmar', { siguiente, evidencia: { tipo: $('#fo-tipo').value, referencia: $('#fo-ref').value }, sin_anclas: !!$('#fo-sin-hub')?.checked, ...(pideClave ? { autoriza: foSolo ? { nombre: S.sesion.usuario, clave: $('#fo-clave').value, sin_segundo: true } : { nombre: $('#fo-quien').value, clave: $('#fo-clave').value } } : {}) });
      await foliosListo(`Folios confirmados: la caja continúa desde el ${folio6(siguiente)}.`);
    } catch (e) { m.className = 'mensaje error'; m.textContent = e.message; const c = $('#fo-clave'); if (c) c.value = ''; }
  });
}
async function foliosListo(texto) {
  await pintarEncabezado();
  await ir('venta');
  msg(texto);
}

// ── venta ──
// ── Avisos a la vista: todo mensaje (error, aviso o éxito) que quede fuera de la pantalla sale también como aviso emergente con X ──
let avisosCaja = null;
const avisosActivos = new Set();
function cajaDeAvisos() {
  if (!avisosCaja) {
    avisosCaja = document.createElement('div');
    avisosCaja.id = 'avisos-flotantes';
    avisosCaja.setAttribute('role', 'region');
    avisosCaja.setAttribute('aria-label', 'Avisos');
  }
  // Con una ventana modal abierta el resto de la página queda inactivo (no se podría tocar la X): el aviso se coloca DENTRO de esa ventana.
  const modal = [...document.querySelectorAll('dialog[open]')].filter((d) => d.matches(':modal')).pop() ?? null;
  const destino = modal ?? document.body;
  const popover = !modal && typeof avisosCaja.showPopover === 'function';
  if (avisosCaja.parentElement !== destino) {
    if (avisosCaja.matches?.(':popover-open')) { try { avisosCaja.hidePopover(); } catch { /* ya cerrado */ } }
    destino.appendChild(avisosCaja);
  }
  avisosCaja.toggleAttribute('popover', popover);
  if (popover) avisosCaja.setAttribute('popover', 'manual');
  avisosCaja.classList.toggle('sin-popover', !popover);
  return avisosCaja;
}
/** Muestra un aviso emergente. `fuente` es el renglón de mensaje de donde viene (si deja de existir o cambia, el aviso se quita solo). */
function avisoFlotante(texto, tipo = 'error', fuente = null) {
  const caja = cajaDeAvisos();
  for (const a of avisosActivos) if (a.texto === texto && a.tipo === tipo) { a.fuente = fuente; return; }
  const el = document.createElement('div');
  el.className = `toast-aviso ${tipo}`;
  el.setAttribute('role', tipo === 'error' ? 'alert' : 'status');
  const t = document.createElement('span'); t.className = 'av-texto'; t.textContent = texto;
  const x = document.createElement('button'); x.type = 'button'; x.className = 'av-x'; x.setAttribute('aria-label', 'Cerrar aviso'); x.title = 'Cerrar'; x.textContent = '✕';
  el.append(t, x);
  const a = { el, texto, tipo, fuente };
  const quitar = () => { avisosActivos.delete(a); el.remove(); if (!avisosActivos.size && caja.hidePopover && caja.matches(':popover-open')) { try { caja.hidePopover(); } catch { /* ya cerrado */ } } };
  a.quitar = quitar;
  x.addEventListener('click', quitar);
  caja.appendChild(el);
  avisosActivos.add(a);
  while (avisosActivos.size > 3) { const primero = avisosActivos.values().next().value; primero.quitar(); }
  // Se vuelve a abrir cada vez para quedar por encima de cualquier ventana modal que esté abierta.
  if (caja.hasAttribute('popover')) { try { if (caja.matches(':popover-open')) caja.hidePopover(); caja.showPopover(); } catch { /* sin soporte */ } }
  if (tipo === 'ok') setTimeout(quitar, 5000);
}
/** ¿Se ve el renglón en pantalla (no está fuera de la vista, tapado ni recortado)? */
function renglonVisible(el) {
  const r = el.getBoundingClientRect();
  if (!r.width && !r.height) return false;
  const x = Math.min(Math.max(r.left + Math.min(r.width / 2, 40), 0), innerWidth - 1), y = r.top + Math.min(r.height / 2, 12);
  if (y < 0 || y >= innerHeight) return false;
  const t = document.elementFromPoint(x, y);
  return !!t && (t === el || el.contains(t));
}
function iniciarAvisosFlotantes() {
  const pendientes = new Set();
  let programado = false;
  const revisar = () => {
    programado = false;
    for (const a of [...avisosActivos]) if (a.fuente && (!a.fuente.isConnected || a.fuente.textContent.trim() !== a.texto || (a.fuente.closest('dialog') && !a.fuente.closest('dialog').open))) a.quitar();
    for (const el of pendientes) {
      if (!el.isConnected || el.closest('#avisos-flotantes')) continue;
      const texto = el.textContent.trim();
      const tipo = el.classList.contains('error') ? 'error' : el.classList.contains('aviso') ? 'aviso' : el.classList.contains('ok') ? 'ok' : null;
      if (!texto || !tipo) continue;
      if (el.getClientRects().length && !renglonVisible(el)) avisoFlotante(texto, tipo, el);
    }
    pendientes.clear();
  };
  new MutationObserver((muts) => {
    for (const m of muts) {
      const n = m.target.nodeType === 1 ? m.target : m.target.parentElement;
      const el = n?.closest?.('.mensaje');
      if (el) pendientes.add(el);
      for (const a of m.addedNodes) { if (a.nodeType === 1 && a.matches?.('.mensaje')) pendientes.add(a); }
    }
    if (!programado && (pendientes.size || avisosActivos.size)) { programado = true; requestAnimationFrame(revisar); }
  }).observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ['class'] });
}
// ── Campos que faltan: se marcan en rojo, se enfoca el primero y se avisa cuáles son ──
const etiquetaDeCampo = (c) => (c.labels?.[0]?.textContent ?? c.getAttribute('aria-label') ?? c.placeholder ?? c.name ?? '').replace(/\s+/g, ' ').trim();
function marcarCampoFalta(c) { c.classList.add('campo-falta'); c.closest('.campo')?.classList.add('campo-con-falta'); }
function limpiarCampoFalta(c) { c.classList.remove('campo-falta'); c.closest('.campo')?.classList.remove('campo-con-falta'); }
function iniciarCamposObligatorios() {
  let faltan = [];
  let pendiente = false;
  document.addEventListener('invalid', (ev) => {
    const c = ev.target;
    if (!(c instanceof HTMLElement)) return;
    ev.preventDefault(); // en lugar de la burbuja del navegador, se marca el campo y sale un aviso propio
    marcarCampoFalta(c);
    faltan.push(c);
    if (!pendiente) {
      pendiente = true;
      setTimeout(() => { // un turno después: así se juntan todos los campos que faltan, no solo el primero
        pendiente = false;
        const lista = faltan; faltan = [];
        lista[0].focus({ preventScroll: true });
        lista[0].scrollIntoView({ block: 'center', behavior: 'smooth' });
        const nombres = [...new Set(lista.map(etiquetaDeCampo).filter(Boolean))];
        avisoFlotante(`Falta completar: ${nombres.join(', ') || 'los campos marcados en rojo'}.`, 'error');
      }, 0);
    }
  }, true);
  for (const evento of ['input', 'change']) document.addEventListener(evento, (ev) => { if (ev.target instanceof HTMLElement && ev.target.classList.contains('campo-falta')) limpiarCampoFalta(ev.target); }, true);
}

function msg(texto, tipo = 'ok') { const m = $('#mensaje'); if (m) { m.className = `mensaje ${tipo}`; m.textContent = texto; } }

async function vistaVenta() {
  if (S.estado?.folios === 'recuperacion') return ir('folios'); // con la serie bloqueada no se vende: primero se revisan los folios
  if (!S.cart) { const r = await api('/api/venta/actual', {}); S.cart = r.cart; S.carrito = r.carrito; }
  const metodos = S.estado?.metodos ?? ['efectivo'];
  S.forma = 'efectivo'; S.tarjeta = null; S.usdAbierto = false; S.tasa = null;
  $('#vista').innerHTML = `
    <h1 class="sr-only">Venta</h1>
    <div class="folio-linea" id="folio-linea" data-chip="folio" ${S.ultimoFolio ? '' : 'hidden'}><b>${esc(folioTexto())}</b></div>
    <div class="venta">
      <div>
        <section class="panel" aria-label="Artículos de la venta">
          <div class="buscador">
            <form id="escaneo" autocomplete="off">
              ${ico('barcode', 'ico-lg')}
              <label for="scan" class="sr-only">Escanear código, Item # o escribir texto del artículo</label>
              <input id="scan" name="scan" inputmode="text" autocomplete="off" spellcheck="false" autofocus placeholder="Escanear código o buscar artículo…">
              <button class="btn btn-icono" type="submit" aria-label="Buscar" title="Buscar" style="border:0;background:none">${ico('search')}</button>
            </form>
            <div class="vendio-fila" id="bloque-vendio" hidden><label for="vendio-por">Venta por:</label><select id="vendio-por"></select><span id="msg-vendio" class="nota"></span></div>
            <button class="btn" id="btn-limpiar-busqueda" type="button" title="Borra el texto y los resultados de la búsqueda (la venta no se toca). Atajo: Esc">${ico('x')}<span>Limpiar búsqueda</span></button>
            <button class="btn btn-acento" id="btn-nuevo-articulo" type="button" title="Dar de alta un artículo que no está en el catálogo (pide su clave)">${ico('plus')}<span>Nuevo artículo</span></button>
          </div>
          <div id="mensaje" class="mensaje" role="status" aria-live="polite"></div>
          <div id="resultados"></div>
          <div class="tabla-cont"><table id="tabla-venta"><caption class="sr-only">Artículos de la venta en curso</caption>
            <thead><tr><th>Item #</th><th>Código</th><th>Descripción</th><th>Marca</th><th>Estilo</th><th>Lote</th><th class="num">Cant.</th><th class="num">Precio</th><th class="num">Desc.</th><th class="num">Importe</th><th><span class="sr-only">Acciones</span></th></tr></thead>
            <tbody id="cuerpo"></tbody></table></div>
        </section>
        <section class="panel detalle-card" id="detalle-card" aria-label="Artículo seleccionado" hidden>
          <h2 id="detalle-titulo"></h2><div class="sub" id="detalle-sub"></div>
          <dl class="detalle" id="detalle"></dl>
          <div class="existencias"><span>Existencias:</span><span class="chips" id="existencias"></span>
            <span class="acciones"><button class="btn" id="btn-uniforme" type="button" hidden title="Uniforme de la tienda: lleva el descuento mayor de empleada">${ico('tag')}<span id="txt-uniforme">Marcar como uniforme</span></button>
            <button class="btn btn-acento" id="btn-editar-venta" type="button" title="Cambiar el precio o la descripción de este artículo solo en esta venta">${ico('pencil')}<span>Editar en esta venta</span></button>
            <button class="btn btn-peligro" id="btn-quitar" type="button">${ico('trash')}<span>Quitar artículo</span></button></span></div>
        </section>
        <div class="acciones-inf" id="acciones-inf">
          <button class="btn" id="btn-buscar-ticket" type="button" title="Abre el historial de ventas de esta caja">${ico('search')}<span>Buscar ticket</span></button>
          <button class="btn" id="btn-devolucion" type="button" title="Buscar la venta y cambiar piezas (solo en la caja donde se vendió)">${ico('undo')}<span>Hacer Cambio</span></button><button class="btn" id="btn-descuento" type="button" title="Descuento con su clave (queda anotado quién lo hizo)">${ico('tag')}<span>Aplicar descuento</span></button><button class="btn" id="btn-cupon" type="button" title="Capturar o escanear un cupón de descuento">${ico('gift')}<span>Cupón</span></button><button class="btn" id="btn-espera" type="button" title="Guardar esta venta y atender a otro cliente, o retomar una venta guardada">${ico('pause')}<span id="txt-espera">Venta en espera</span></button><button class="btn" id="btn-abrir-caja" type="button" title="Abre el cajón de dinero sin hacer una venta (queda registrado). Atajo: Ctrl + F8">${ico('cash')}<span>Abrir caja</span></button><button class="btn" id="btn-contar-fondo" type="button" title="Abre el cajón y cuenta billetes y monedas para rectificar la feria y el efectivo (queda registrado)">${ico('cash')}<span>Contar fondo</span></button><button class="btn btn-peligro" id="btn-cancelar-venta" type="button" title="Cancelar la venta en curso (aún sin cobrar)">${ico('trash')}<span>Cancelar venta</span></button>
        <button class="btn" id="btn-empleada" type="button" title="Venta a una empleada: descuento de empleada y, si quiere, crédito a su cuenta">${ico('user')}<span>Venta a empleada</span></button>
        </div>
      </div>
      <aside class="panel resumen" aria-label="Resumen y cobro">
        <h2>Resumen de venta<span class="piezas-txt"><span id="piezas">0</span> pieza(s)</span></h2>
        <div id="bloque-empleada" class="mensaje ok" role="status" hidden style="margin:0 0 10px"></div>
        <dl>
          <dt>Importe</dt><dd id="brutas">$0.00</dd>
          <dt>Descuentos</dt><dd id="descuentos">$0.00</dd>
          <dt id="dt-cambio" hidden>Mercancía recibida a cambio</dt><dd id="dd-cambio" hidden>$0.00</dd>
        </dl>
        <div id="saldo-favor" class="mensaje aviso" role="status" hidden><span id="saldo-favor-texto"></span><br><button type="button" id="btn-devolver-dinero" style="background:none;border:0;padding:4px 0 0;color:var(--texto-2);font-size:12px;text-decoration:underline;cursor:pointer;display:inline-flex;gap:4px;align-items:center">${ico('cash')}<span>No hay cambio posible, devolver dinero</span></button></div>
        <div id="promos-aplicadas" aria-live="polite"></div>
        <div class="total"><span>TOTAL</span><b id="total">$0.00</b></div>
        <div class="mxn">MXN</div>
        <div class="formas" id="formas" role="group" aria-label="Forma de pago">
          <button class="btn forma" type="button" data-forma="efectivo" aria-pressed="true">${ico('cash', 'ico-lg')}<span>Efectivo</span></button>
          <button class="btn forma" type="button" data-forma="tarjeta" aria-pressed="false" ${metodos.includes('tarjeta') ? '' : 'disabled title="Esta caja no tiene terminal bancaria"'}>${ico('card', 'ico-lg')}<span>Tarjeta</span></button>
          <button class="btn forma" type="button" data-forma="mixto" aria-pressed="false" ${metodos.includes('tarjeta') ? '' : 'disabled title="Esta caja no tiene terminal bancaria"'}>${ico('mixto', 'ico-lg')}<span>Mixto</span></button>
          <button class="btn forma" type="button" data-forma="regalo" aria-pressed="false" ${metodos.includes('tarjeta_regalo') ? '' : `disabled title="Esta caja no maneja tarjetas de regalo"`}>${ico('gift', 'ico-lg')}<span>Tarjeta de regalo</span></button>
          <button class="btn forma" type="button" data-forma="credito" aria-pressed="false" disabled title="Primero elija «Venta a empleada»">${ico('user', 'ico-lg')}<span>Crédito de empleada</span></button>
        </div>
        <div id="pago"></div>
        <button class="btn btn-primario" id="btn-cobrar" type="button" disabled><span id="txt-cobrar">COBRAR $0.00</span>${ico('chevron')}</button>
        <div class="aux"><button class="btn" id="btn-regalo" type="button" aria-pressed="${S.conRegalo ? 'true' : 'false'}" title="Al cobrar, imprime también un ticket de regalo: la mercancía sin precios">${ico('gift')}<span>Ticket de regalo</span></button></div>
      </aside>
    </div>`;
  $('#escaneo').addEventListener('submit', async (ev) => { ev.preventDefault(); await escanear(); });
  // Limpia solo la búsqueda (texto, resultados y mensaje); los artículos de la venta no se tocan.
  const limpiarBusqueda = () => { $('#scan').value = ''; $('#resultados').innerHTML = ''; const m = $('#mensaje'); m.textContent = ''; m.className = 'mensaje'; $('#scan').focus(); };
  $('#btn-limpiar-busqueda').addEventListener('click', limpiarBusqueda);
  $('#btn-nuevo-articulo').addEventListener('click', () => abrirNuevoArticulo(/^[0-9A-Za-z-]{5,}$/.test($('#scan').value.trim()) ? $('#scan').value.trim() : ''));
  $('#scan').addEventListener('keydown', (ev) => { if (ev.key === 'Escape') { ev.preventDefault(); limpiarBusqueda(); } });
  $('#btn-regalo').addEventListener('click', () => { S.conRegalo = !S.conRegalo; $('#btn-regalo').setAttribute('aria-pressed', S.conRegalo ? 'true' : 'false'); msg(S.conRegalo ? 'Al cobrar se imprimirá también el ticket de regalo (sin precios).' : 'Sin ticket de regalo.', 'aviso'); });
  $('#btn-descuento').addEventListener('click', abrirDescuento);
  $('#btn-empleada').addEventListener('click', abrirEmpleada);
  $('#btn-uniforme').addEventListener('click', alternarUniforme);
  $('#btn-cupon').addEventListener('click', () => abrirCupon());
  $('#btn-espera').addEventListener('click', () => abrirEspera());
  $('#btn-cancelar-venta').addEventListener('click', abrirCancelarVenta);
  $('#btn-abrir-caja').addEventListener('click', async () => {
    try {
      const a = await api('/api/venta/autorizadores');
      avisoExtorsion(() => abrirMotivoApertura(a.pide_clave)); // primero el aviso; luego el motivo y, con Vendedoras-Cajeras registradas, su propia clave
      return;
    } catch (e) { msg(e.message, 'error'); }
    $('#scan').focus();
  });
  $('#btn-contar-fondo').addEventListener('click', () => abrirContarFondo());
  $('#btn-editar-venta').addEventListener('click', () => abrirEditarLinea());
  actualizarEspera();
  revisarAvisoRetiro();
  $('#btn-cobrar').addEventListener('click', cobrar);
  $('#btn-quitar').addEventListener('click', () => S.sel && accionLinea(S.sel, 'quitar'));
  $('#btn-buscar-ticket').addEventListener('click', () => ir('ventas'));
  $('#btn-devolucion').addEventListener('click', () => ir('devolucion'));
  $('#vendio-por').addEventListener('change', elegirVendedora);
  cargarVendedoras();
  $('#btn-devolver-dinero').addEventListener('click', abrirDevolverDinero);
  for (const b of $('#formas').querySelectorAll('button[data-forma]')) b.addEventListener('click', () => elegirForma(b.dataset.forma));
  pintarPago();
  pintarCarrito();
  if (S.carrito.tasa) abrirUsd(); // el cobro ya había empezado a recibir dólares: conserva su tasa
  $('#scan').focus();
}

function elegirForma(f) {
  S.forma = f;
  S.tarjeta = null;
  S.usdAbierto = false;
  S.tasa = null;
  for (const b of $('#formas').querySelectorAll('button[data-forma]')) b.setAttribute('aria-pressed', String(b.dataset.forma === f));
  pintarPago();
  recalcular();
  $(f === 'regalo' ? '#codigo-regalo' : f === 'tarjeta' ? '#tj-aut' : f === 'mixto' ? '#tj-monto' : f === 'credito' ? '#btn-cobrar' : '#recibido')?.focus();
}

/** Tarjeta con captura manual: se cobra en la terminal bancaria y aquí se teclea lo que dice el comprobante. */
function htmlTarjeta(mixto) {
  return `<p class="nota" style="margin:0 0 8px">Cobre en la terminal bancaria y, cuando la apruebe, capture aquí los datos del comprobante.</p>
    ${mixto ? `<div class="campo"><label for="tj-monto">Monto cobrado con tarjeta (MXN)</label><input id="tj-monto" inputmode="decimal" autocomplete="off" placeholder="0.00"></div>
    <div class="saldo-tarjeta" id="tj-resto" role="status" aria-live="polite">El resto se cobra en efectivo: <b id="tj-resto-monto">$0.00</b></div>` : ''}
    <div class="campo"><label for="tj-aut">Autorización del comprobante</label><input id="tj-aut" class="texto" autocomplete="off" spellcheck="false" maxlength="12" placeholder="Ej. 123456"></div>
    <div class="campo"><label for="tj-marca">Marca (opcional)</label><select id="tj-marca" class="texto"><option value="">—</option><option>Visa</option><option>Mastercard</option><option>American Express</option><option>Otra</option></select></div>
    <div class="campo"><label for="tj-ult4">Últimos 4 dígitos (opcional)</label><input id="tj-ult4" inputmode="numeric" autocomplete="off" maxlength="4" placeholder="1234"></div>`;
}
/** Importe de tarjeta y resto en efectivo de la venta en pantalla (null si el monto del mixto no es válido). */
function repartoTarjeta() {
  const total = S.carrito.total;
  if (S.forma === 'tarjeta') return { importe: total, resto: 0, valido: total > 0 };
  const m = parseMXN($('#tj-monto')?.value ?? '');
  const valido = m !== null && m > 0 && m < total;
  return { importe: valido ? m : 0, resto: valido ? total - m : total, valido };
}

/** Efectivo: pesos y, si se pide, dólares. El cajero solo captura lo recibido; el POS calcula equivalente, faltante y cambio en MXN. */
function htmlEfectivo(etiquetaPesos) {
  const pesos = /resto/.test(etiquetaPesos) ? 'Pesos recibidos para el resto (MXN)' : 'Pesos recibidos (MXN)';
  return `<div class="efectivo-campos"><div class="campo"><label for="recibido" id="lbl-recibido">${pesos} <span class="moneda" aria-hidden="true">💶</span></label>
      <input id="recibido" inputmode="decimal" autocomplete="off" placeholder="0.00"></div>
    <div class="campo"><label for="usd">Dólares recibidos (USD) <span class="moneda" aria-hidden="true">💵</span></label><input id="usd" inputmode="decimal" autocomplete="off" placeholder="0.00"></div></div>
    <div id="bloque-usd" hidden>
      <div id="msg-usd" class="mensaje error" role="alert"></div>
      <div class="saldo-tarjeta" id="info-tasa" role="status" aria-live="polite"></div>
      <div id="aviso-sin-verificar" class="mensaje aviso" role="status" hidden></div>
      <button class="btn btn-chico" id="btn-tasa-nueva" type="button" hidden>${ico('refresh')}<span>Usar la tasa vigente</span></button>
      <div id="aviso-cambio" class="mensaje aviso" role="status" hidden></div>
      <dl class="calc-usd"><dt>Equivalente de los USD</dt><dd id="usd-equivalente">$0.00</dd><dt>Total recibido equivalente</dt><dd id="total-recibido">$0.00</dd></dl>
    </div>
    <div class="cambio" id="linea-cambio"><span id="lbl-cambio">Cambio</span><b id="cambio">$0.00</b></div>`;
}
function engancharEfectivo() {
  $('#recibido').addEventListener('input', recalcular);
  $('#usd').addEventListener('input', alCambiarUsd);
  $('#btn-tasa-nueva').addEventListener('click', () => abrirUsd(true));
}
/** Con dólares escritos se fija el tipo de cambio de este cobro (una sola vez); al dejar el renglón vacío se quitan solos. */
async function alCambiarUsd() {
  const t = $('#usd').value.trim();
  const v = t === '' ? 0 : parseMXN(t);
  if (v !== null && v > 0 && !S.usdAbierto && !S.abriendoUsd) {
    S.abriendoUsd = true;
    try { await abrirUsd(); } finally { S.abriendoUsd = false; }
  } else if (v === 0 && S.usdAbierto) cerrarUsd();
  recalcular();
}
async function abrirUsd(renovar = false) {
  try {
    S.tasa = await api('/api/venta/tasa', { cart: S.cart, renovar });
    S.usdAbierto = true;
    $('#bloque-usd').hidden = false;
    pintarInfoTasa();
    recalcular();
  } catch (e) { const u = $('#usd'); if (u) u.value = ''; recalcular(); msg(e.message, 'error'); }
}
function cerrarUsd() {
  S.usdAbierto = false;
  $('#bloque-usd').hidden = true;
  $('#usd').value = '';
  recalcular();
}
function pintarInfoTasa() {
  const t = S.tasa;
  if (!t || !$('#info-tasa')) return;
  const sv = S.estado?.tipo_cambio?.sin_verificar;
  const av = $('#aviso-sin-verificar');
  if (av) { av.hidden = !sv || sv.nivel === 'ok'; if (sv && sv.nivel !== 'ok') av.textContent = `La tasa lleva ${sv.horas} h sin verificarse contra el central${sv.bloquear_usd_horas ? ` (a las ${sv.bloquear_usd_horas} h ya no se reciben dólares)` : ''}. Los cobros en pesos no se afectan.`; }
  $('#info-tasa').hidden = !t.hay_nueva;
  $('#info-tasa').innerHTML = `${t.hay_nueva ? `<span id="aviso-tasa-nueva" style="color:var(--aviso)">La tasa vigente cambió a $${esc(t.vigente.texto)} (v${t.vigente.version}). Este cobro conserva la que tenía.</span>` : ''}`;
  $('#btn-tasa-nueva').hidden = !t.hay_nueva;
}
function pintarPago() {
  const p = $('#pago');
  if (S.forma === 'tarjeta' || S.forma === 'mixto') {
    p.innerHTML = htmlTarjeta(S.forma === 'mixto');
    for (const id of ['#tj-aut', '#tj-monto', '#tj-ult4', '#tj-marca']) $(id)?.addEventListener('input', recalcular);
    $('#tj-ult4').addEventListener('input', () => { $('#tj-ult4').value = $('#tj-ult4').value.replace(/\D/g, ''); });
    return;
  }
  if (S.forma === 'credito') {
    p.innerHTML = '<div id="info-credito" class="mensaje" role="status" aria-live="polite"></div>';
    return;
  }
  if (S.forma === 'regalo') {
    p.innerHTML = `
      <div class="campo"><label for="codigo-regalo">Código de la tarjeta de regalo</label>
        <input id="codigo-regalo" class="texto" autocomplete="off" spellcheck="false" placeholder="Escanee o escriba el código"></div>
      <div id="info-regalo" class="saldo-tarjeta" role="status" aria-live="polite" hidden></div>
      <div id="resto-regalo" hidden>${htmlEfectivo('Efectivo recibido para el resto (MXN)')}</div>`;
    $('#codigo-regalo').addEventListener('keydown', (ev) => { if (ev.key === 'Enter') { ev.preventDefault(); consultarRegalo(); } });
    $('#codigo-regalo').addEventListener('change', consultarRegalo);
    $('#codigo-regalo').addEventListener('input', () => { S.tarjeta = null; $('#info-regalo').hidden = true; recalcular(); });
  } else {
    p.innerHTML = `${htmlEfectivo('Efectivo recibido (MXN)')}
      <button class="btn btn-chico" id="btn-exacto" type="button" disabled>${ico('check')}<span>Cliente paga exacto</span></button>`;
    $('#btn-exacto').addEventListener('click', () => {
      const eq = S.usdAbierto ? calcEfectivo(S.carrito.total).equivalente : 0;
      $('#recibido').value = (Math.max(0, S.carrito.total - eq) / 100).toFixed(2);
      recalcular();
    });
  }
  engancharEfectivo();
}

async function consultarRegalo() {
  const codigo = $('#codigo-regalo')?.value.trim();
  const info = $('#info-regalo');
  if (!codigo || !info) return;
  try {
    const { tarjeta } = await api(`/api/tarjeta?codigo=${encodeURIComponent(codigo)}`);
    S.tarjeta = tarjeta;
    info.hidden = false;
    info.innerHTML = `Saldo disponible: <b id="saldo-regalo">${mxn(tarjeta.saldo)}</b><br>${tarjeta.vencida ? `<span style="color:var(--error)" id="regalo-vencida">Vencida el ${esc(fechaCorta(tarjeta.vigente_hasta).split(' · ')[0])}</span>` : `Vigente hasta ${esc(fechaCorta(tarjeta.vigente_hasta).split(' · ')[0])}`}`;
  } catch (e) {
    S.tarjeta = null;
    info.hidden = false;
    info.innerHTML = `<span style="color:var(--error)">${esc(e.message)}</span>`;
  }
  recalcular();
}

/** Reparto de un cobro con tarjeta de regalo: el saldo se aplica primero y el resto va en efectivo. */
function repartoRegalo() {
  const total = S.carrito.total;
  const saldo = S.tarjeta?.saldo ?? 0;
  const aplicado = Math.min(saldo, total);
  return { aplicado, resto: total - aplicado, saldoDespues: saldo - aplicado };
}

/** «Venta por»: con empleadas registradas se debe elegir quién atendió a la clienta («Autocompra» = nadie la ayudó, y es lo que queda por omisión). Sin clave. */
async function cargarVendedoras() {
  try { S.vendedoras = await api('/api/venta/vendedoras'); } catch { S.vendedoras = { vendedoras: [], pide: false }; }
  pintarVendedora();
  recalcular();
}
const exigeVendedora = () => !!S.vendedoras?.pide && !S.carrito?.vendedora;
function pintarVendedora() {
  const bloque = $('#bloque-vendio');
  if (!bloque) return;
  const v = S.vendedoras;
  bloque.hidden = !v?.pide;
  if (!v?.pide) return;
  const sel = $('#vendio-por');
  const actual = S.carrito.vendedora;
  sel.innerHTML = `<option value="autocompra" ${!actual || actual.id === null ? 'selected' : ''}>Autocompra</option>${v.vendedoras.map((x) => `<option value="${esc(x.id)}" ${actual?.id === x.id ? 'selected' : ''}>${esc(x.alias)}${x.tipo === 'supervisor' ? ' (supervisor)' : ''}</option>`).join('')}`;
  $('#msg-vendio').textContent = '';
  // Por omisión la venta es «Autocompra»: se registra sola, y solo se cambia si alguien atendió a la clienta.
  if (!actual && !S.asignandoVendedora) {
    S.asignandoVendedora = true;
    const cart = S.cart;
    api('/api/venta/vendedora', { cart, vendedora_id: null }).then((r) => { if (S.cart === cart) { S.carrito = r.carrito; recalcular(); } }).catch(() => {}).finally(() => { S.asignandoVendedora = false; });
  }
}
async function elegirVendedora() {
  const v = $('#vendio-por').value;
  try {
    const r = await api('/api/venta/vendedora', { cart: S.cart, vendedora_id: v === 'autocompra' ? null : v });
    S.carrito = r.carrito;
    pintarVendedora();
    recalcular();
  } catch (e) { msg(e.message, 'error'); }
}

function pintarCarrito() {
  const c = S.carrito;
  $('#piezas').textContent = c.piezas;
  $('#brutas').textContent = mxn(c.ventas_brutas);
  $('#descuentos').textContent = c.descuentos ? `-${mxn(c.descuentos)}` : mxn(0);
  pintarPromos();
  $('#total').textContent = mxn(c.total);
  const cb = c.cambio;
  $('#dt-cambio').hidden = $('#dd-cambio').hidden = !cb;
  if (cb) $('#dd-cambio').textContent = `-${mxn(cb.credito)}`;
  $('#saldo-favor').hidden = !(cb && cb.saldo_favor > 0);
  if (cb && cb.saldo_favor > 0) $('#saldo-favor-texto').innerHTML = `Saldo a favor de la clienta: <b id="saldo-favor-monto">${mxn(cb.saldo_favor)}</b>. Agregue más artículos o devuélvale el dinero.`;
  const cuerpo = $('#cuerpo');
  // Las piezas que regresa la clienta (cambio) van en negativo: son el crédito que se descuenta de lo que se lleva.
  const filasCambio = cb ? cb.lineas.map((l) => `
      <tr class="fila-cambio" data-cambio-linea="${l.linea_id}" style="color:var(--error)">
        <td data-col="item_no">${esc(l.item_no ?? 'pendiente')}</td><td data-col="codigo">${esc(l.codigo)}</td><td class="desc" data-col="descripcion">${esc(l.descripcion)} <small>(cambio · folio ${String(cb.folio_origen).padStart(6, '0')})</small></td>
        <td data-col="marca">${esc(l.marca)}</td><td data-col="estilo">${esc(l.estilo)}</td><td data-col="lote"></td>
        <td class="num" data-col="cantidad"><b>-${l.qty}</b></td><td class="num" data-col="precio">${mxn(l.precio_unit)}</td><td class="num" data-col="descuento"></td><td class="num" data-col="importe"><b>-${mxn(l.importe)}</b></td>
        <td><button class="btn btn-icono" type="button" data-quitar-cambio aria-label="Quitar el cambio de la venta" title="Quitar el cambio de la venta">${ico('x')}</button></td>
      </tr>`).join('') : '';
  if (!c.lineas.length && !cb) {
    cuerpo.innerHTML = `<tr><td colspan="11" class="vacio">Escanee un artículo para comenzar la venta.</td></tr>`;
  } else {
    cuerpo.innerHTML = filasCambio + c.lineas.map((l) => `
      <tr data-linea="${l.linea_id}" aria-selected="${S.sel === l.linea_id}">
        <td data-col="item_no">${esc(l.item_no ?? 'pendiente')}</td><td data-col="codigo">${esc(l.codigo)}</td><td class="desc" data-col="descripcion">${esc(l.descripcion)}${l.editado ? ' <small class="nota" title="Precio o descripción editados solo en esta venta">(editado)</small>' : ''}</td>
        <td data-col="marca">${esc(l.marca)}</td><td data-col="estilo">${esc(l.estilo)}</td><td data-col="lote">${esc(l.lote)}</td>
        <td class="num" data-col="cantidad"><span class="qty"><button class="btn" type="button" data-accion="menos" aria-label="Quitar una pieza de ${esc(l.descripcion)}" ${l.qty <= 1 ? 'disabled' : ''}>−</button><b>${l.qty}</b><button class="btn" type="button" data-accion="mas" aria-label="Agregar una pieza de ${esc(l.descripcion)}">+</button></span></td>
        <td class="num" data-col="precio">${mxn(l.precio_unit)}</td><td class="num" data-col="descuento">${l.descuento ? `-${mxn(l.descuento)}` : mxn(0)}</td><td class="num" data-col="importe"><b>${mxn(l.importe)}</b></td>
        <td><button class="btn btn-icono" type="button" data-accion="quitar" aria-label="Quitar ${esc(l.descripcion)} de la venta" title="Quitar de la venta">${ico('x')}</button></td>
      </tr>`).join('');
  }
  for (const b of cuerpo.querySelectorAll('[data-quitar-cambio]')) b.addEventListener('click', quitarCambio);
  for (const tr of cuerpo.querySelectorAll('tr[data-linea]')) {
    tr.addEventListener('click', (ev) => {
      const id = tr.dataset.linea;
      const a = ev.target.closest('button')?.dataset.accion;
      if (a) return void accionLinea(id, a);
      S.sel = id;
      pintarCarrito();
    });
  }
  pintarEmpleada();
  const l = c.lineas.find((x) => x.linea_id === S.sel);
  $('#detalle-card').hidden = !l;
  if ($('#btn-uniforme')) {
    $('#btn-uniforme').hidden = !(l && c.empleada);
    if (l && c.empleada) $('#txt-uniforme').textContent = l.uniforme ? `Quitar uniforme (vuelve al ${c.empleada.pct}%)` : `Marcar como uniforme (${c.empleada.pct_uniforme}%)`;
  }
  if (l) {
    $('#detalle-titulo').textContent = [l.descripcion, l.marca].filter(Boolean).join(' · ');
    $('#detalle-sub').textContent = `Departamento: ${l.departamento}`;
    $('#detalle').innerHTML = `<div><dt>Departamento</dt><dd>${esc(l.departamento)}</dd></div><div><dt>Item #</dt><dd>${esc(l.item_no ?? 'pendiente')}</dd></div><div><dt>Código</dt><dd>${esc(l.codigo)}</dd></div><div><dt>Marca</dt><dd>${esc(l.marca)}</dd></div><div><dt>Estilo</dt><dd>${esc(l.estilo)}</dd></div><div><dt>Lote</dt><dd>${esc(l.lote)}</dd></div>`;
    const ex = c.existencias?.[l.item_id];
    $('#existencias').innerHTML = `<span class="chip-stock propia" data-existencia="tienda">${ico('store')}Esta tienda: ${ex ? `${ex.saldo}${ex.verificada ? '' : ' (sin verificar)'}` : 'sin dato'}</span>${ex && ex.limbo !== null ? `<span class="chip-stock" data-existencia="limbo" title="Catálogo inicial: se vende en cualquier tienda y caja y se descuenta de El Limbo">${ico('box')}El Limbo: ${ex.limbo}</span>` : ''}<span class="chip-stock" data-existencia="otras" title="La existencia de otras tiendas y del almacén se muestra en una etapa posterior">${ico('box')}Otras tiendas y almacén: sin dato</span>`;
  }
  recalcular();
}

/** Lo recibido en pesos y dólares frente al importe en MXN que debe liquidar este efectivo. */
function calcEfectivo(aplicar) {
  const pesosTxt = $('#recibido')?.value ?? '';
  const usdTxt = S.usdAbierto ? ($('#usd')?.value ?? '') : '';
  const pesos = pesosTxt.trim() === '' ? (S.usdAbierto ? 0 : null) : parseMXN(pesosTxt);
  const usdC = usdTxt.trim() === '' ? 0 : parseMXN(usdTxt);
  const billetes = usdC !== null && usdC % 100 === 0; // solo billetes: dólares enteros, sin centavos ni monedas
  const escritoSinTasa = !S.usdAbierto && (() => { const t = ($('#usd')?.value ?? '').trim(); if (!t) return false; const v = parseMXN(t); return v === null || v > 0; })(); // se está fijando el tipo de cambio
  const valido = pesos !== null && usdC !== null && billetes && !escritoSinTasa && (usdC === 0 || !!S.tasa);
  const equivalente = valido && usdC > 0 ? usdAMxn(usdC, S.tasa.bloqueada.tasa) : 0;
  const recibido = valido ? pesos + equivalente : 0;
  return { pesos: pesos ?? 0, usd: usdC ?? 0, valido, billetes: usdC === null || billetes, equivalente, recibido, ok: valido && aplicar > 0 && recibido >= aplicar, escribio: pesosTxt.trim() !== '' || usdTxt.trim() !== '' };
}
function pintarCambio(aplicar, c) {
  if ($('#msg-usd')) $('#msg-usd').textContent = c.billetes ? '' : 'Solo se aceptan billetes de dólar (1, 2, 5, 10, 20, 50 y 100): sin centavos ni monedas.';
  // Advertencia (no bloquea): el cambio en pesos excede lo que se SABE que hay en el cajón; sin fondo del día no se puede saber.
  const cambio = c.ok ? c.recibido - aplicar : 0;
  const ef = S.estado?.efectivo?.mxn;
  const excede = c.usd > 0 && cambio > c.pesos && ef?.conocido && cambio > ef.disponible + c.pesos;
  if ($('#aviso-cambio')) {
    $('#aviso-cambio').hidden = !excede;
    if (excede) $('#aviso-cambio').textContent = `Advertencia: el cambio (${mxn(cambio)}) supera los pesos que se sabe que hay en la caja (${mxn(Math.max(0, ef.disponible) + c.pesos)}). Puede cobrar, pero reponga cambio o reciba más pesos.`;
  }
  if ($('#usd-equivalente')) { $('#usd-equivalente').textContent = mxn(c.equivalente); $('#total-recibido').textContent = mxn(c.recibido); }
  const falta = c.valido && c.escribio && aplicar > 0 && c.recibido < aplicar;
  $('#lbl-cambio').textContent = falta ? 'Faltan' : 'Cambio';
  $('#cambio').textContent = falta ? mxn(aplicar - c.recibido) : c.ok ? mxn(c.recibido - aplicar) : mxn(0);
  $('#linea-cambio').classList.toggle('falta', falta);
}
function recalcular() {
  const total = S.carrito.total;
  const hay = S.carrito.lineas.length > 0;
  let ok = false;
  if (S.forma === 'tarjeta' || S.forma === 'mixto') {
    const r = repartoTarjeta();
    if ($('#tj-resto-monto')) $('#tj-resto-monto').textContent = mxn(r.resto);
    ok = hay && r.valido && /^[A-Za-z0-9]{4,12}$/.test($('#tj-aut').value.trim()) && (!$('#tj-ult4').value || /^\d{4}$/.test($('#tj-ult4').value));
    if ($('#linea-cambio')) $('#linea-cambio').classList.remove('falta');
    if ($('#lbl-cambio')) { $('#lbl-cambio').textContent = 'Cambio'; $('#cambio').textContent = mxn(0); }
  } else if (S.forma === 'credito') {
    const e = S.carrito.empleada;
    const disp = e?.credito_disponible ?? 0;
    ok = hay && !!e && total > 0 && total <= disp;
    const info = $('#info-credito');
    if (info) {
      info.className = `mensaje ${ok ? 'ok' : 'aviso'}`;
      info.innerHTML = !e ? 'Primero elija «Venta a empleada».' : total > disp ? `La compra (${mxn(total)}) pasa del crédito disponible de ${esc(e.nombre)} (${mxn(disp)}). Pague parte en efectivo o pida a Administración un límite mayor.` : `Se carga <b id="credito-monto">${mxn(total)}</b> a la cuenta de <b>${esc(e.nombre)}</b> y se le descuenta de su nómina. Crédito disponible: ${mxn(disp)}. No entra dinero a la caja.`;
    }
  } else if (S.forma === 'regalo') {
    const t = S.tarjeta;
    const { aplicado, resto, saldoDespues } = repartoRegalo();
    const info = $('#info-regalo');
    if (t && hay) {
      info.hidden = false;
      info.innerHTML = `Saldo disponible: <b id="saldo-regalo">${mxn(t.saldo)}</b>${t.vencida ? ' · <span style="color:var(--error)" id="regalo-vencida">VENCIDA</span>' : ''}<br>Se aplican <b id="regalo-aplicado">${mxn(aplicado)}</b> · saldo restante <b id="regalo-restante">${mxn(saldoDespues)}</b>${resto > 0 ? `<br>Resto en efectivo: <b id="regalo-resto">${mxn(resto)}</b>` : ''}`;
    }
    $('#resto-regalo').hidden = !(t && hay && resto > 0);
    const c = calcEfectivo(resto);
    ok = !!t && hay && !t.vencida && t.saldo > 0 && (resto === 0 || c.ok);
    pintarCambio(resto, c);
  } else {
    const c = calcEfectivo(total);
    ok = hay && (total === 0 || c.ok); // descuento del 100 %: se registra la venta sin cobrar nada
    pintarCambio(total, c);
    if ($('#btn-exacto')) $('#btn-exacto').disabled = !hay;
  }
  const saldo = S.carrito.cambio?.saldo_favor ?? 0; // con saldo a favor no se cobra: se agregan artículos o se devuelve el dinero
  $('#btn-cobrar').disabled = !ok || saldo > 0 || (hay && exigeVendedora());
  pintarVendedora();
  $('#txt-cobrar').textContent = S.carrito.cambio && hay && total === 0 && saldo === 0 ? 'CONFIRMAR CAMBIO' : hay && total === 0 && S.forma !== 'regalo' ? 'REGISTRAR VENTA SIN COBRO' : `COBRAR ${mxn(total)}`;
}

async function escanear() {
  const inp = $('#scan');
  const texto = inp.value;
  if (!texto.trim()) return;
  inp.value = '';
  $('#resultados').innerHTML = '';
  const qr = /^cupon:\s*(.+)$/i.exec(texto.trim()); // el QR de un cupón trae «CUPON:CÓDIGO»
  if (qr) { await aplicarCuponCodigo(qr[1]); inp.focus(); return; }
  if (/^RC-[A-Z0-9]+-\d{6}-\d+$/i.test(texto.trim())) { await aplicarCuponCodigo(texto.trim()); inp.focus(); return; } // cupón de recompensa impreso en el ticket
  try {
    const r = await api('/api/venta/escanear', { cart: S.cart, codigo: texto });
    S.carrito = r.carrito;
    if (r.resultado === 'agregado' || r.resultado === 'cantidad_incrementada') {
      S.sel = r.linea.linea_id;
      msg(`${r.resultado === 'agregado' ? 'Agregado' : 'Cantidad actualizada'}: ${r.linea.descripcion} ${r.linea.marca} · ${r.linea.qty} pza.`);
      pintarCarrito();
      await ofrecerRecepciones(r.recepcion, r.linea);
    } else if (r.resultado === 'ambiguo') {
      msg(`El código ${r.codigo} está duplicado en el catálogo. Elija cuál es el artículo: la venta quedará marcada para que Administración lo revise.`, 'aviso');
      $('#resultados').innerHTML = `<ul data-resultado="ambiguo" style="list-style:none;padding:0;display:flex;flex-direction:column;gap:8px">${r.candidatos.map((c) => `<li style="display:flex;gap:10px;align-items:center;flex-wrap:wrap"><span style="flex:1;min-width:200px">${esc(c.marca)} · ${esc(c.descripcion)} · Estilo ${esc(c.estilo)} · Lote ${esc(c.lote)} · Item # ${esc(c.item_no ?? 'pendiente')}</span><button class="btn" type="button" data-agregar="${c.item_id}">${ico('plus')}<span>Agregar este</span></button></li>`).join('')}</ul>`;
      engancharAgregar();
    } else {
      await buscarTexto(texto);
    }
  } catch (e) { msg(e.message, 'error'); }
  inp.focus();
}

async function buscarTexto(texto, limite = 20) {
  const { resultados, total } = await api(`/api/buscar?q=${encodeURIComponent(texto)}&limite=${limite}`);
  if (!resultados.length) {
    msg(`No se encontró «${texto}» por código, Item # ni texto.`, 'error');
    $('#resultados').innerHTML = `<button class="btn" type="button" id="btn-alta-desde-busqueda">${ico('plus')}<span>Dar de alta este artículo</span></button>`;
    $('#btn-alta-desde-busqueda').addEventListener('click', () => abrirNuevoArticulo(/^[0-9A-Za-z-]{5,}$/.test(texto) ? texto : ''));
    return;
  }
  msg(total > resultados.length ? `${total} resultados para «${texto}»; se muestran los ${resultados.length} más relevantes. Escriba más palabras (o el precio) para acotar, o pulse «Mostrar más».` : `${total} resultado(s) para «${texto}». Elija el artículo.`, 'aviso');
  $('#resultados').innerHTML = `<div class="tabla-cont"><table class="tabla-resultados"><thead><tr><th>Item #</th><th>Código</th><th>Descripción</th><th>Marca</th><th>Estilo</th><th>Lote</th><th>Departamento</th><th class="num">Precio</th><th class="num">Existencia</th><th></th></tr></thead><tbody>${resultados.map((r) => `
    <tr data-item="${r.item_id}"><td>${esc(r.item_no ?? 'pendiente')}</td><td>${r.codigo ? esc(r.codigo) : '<em>(sin código)</em>'}${r.codigo_alterno ? `<br><small>alterno ${esc(r.codigo_alterno)}</small>` : ''}</td><td>${esc(r.descripcion)}</td><td>${esc(r.marca)}</td><td>${esc(r.estilo)}</td><td>${esc(r.lote)}</td><td>${esc(r.departamento)}</td><td class="num">${mxn(r.precio)}</td>
    <td class="num">${r.existencia}${r.existencia_verificada ? '' : ' (sin verificar)'}</td>
    <td>${!r.precio_valido ? '<span class="insignia cancelada" title="Precio en el catálogo: corregirlo antes de vender">Precio no vendible</span>' : `${r.duplicado ? '<span class="insignia" title="Código duplicado: la venta queda marcada para revisión">Código duplicado</span> ' : ''}<button class="btn" type="button" data-agregar="${r.item_id}">${ico('plus')}<span>Agregar</span></button>`}</td></tr>`).join('')}</tbody></table></div>`;
  if (total > resultados.length && limite < 200) {
    $('#resultados').insertAdjacentHTML('beforeend', `<button class="btn" type="button" id="btn-mostrar-mas" style="margin-top:8px">${ico('plus')}<span>Mostrar más resultados</span></button>`);
    $('#btn-mostrar-mas').addEventListener('click', () => buscarTexto(texto, Math.min(200, limite + 40)));
  }
  engancharAgregar();
}
/** Alta de un artículo desde la venta: pide la clave del propio cajero y lo agrega a la venta; llega al catálogo de todas las tiendas. */
async function abrirNuevoArticulo(codigo = '') {
  let deptos = [];
  try { deptos = (await api('/api/venta/departamentos')).departamentos; } catch (e) { return msg(e.message, 'error'); }
  const d = dialogo('dlg-nuevo-articulo');
  d.setAttribute('aria-labelledby', 'na-titulo');
  const campo = (id, rotulo, valor = '', extra = '') => `<div class="campo"><label for="${id}">${rotulo}</label><input id="${id}" class="texto" value="${esc(valor)}" ${extra}></div>`;
  d.innerHTML = `<h2 id="na-titulo" style="margin-top:0">Nuevo artículo</h2>
    <p class="nota" style="margin-top:0">Queda en el catálogo de todas las tiendas y se agrega a esta venta. Pide la clave de quien da de alta.</p>
    <form id="form-nuevo-articulo" autocomplete="off">
      ${campo('na-codigo', 'Código (el de la etiqueta)', codigo, 'spellcheck="false"')}${campo('na-descripcion', 'Descripción', '', 'maxlength="60"')}${campo('na-marca', 'Marca (opcional)', '', 'maxlength="40"')}${campo('na-estilo', 'Estilo (opcional)', '', 'maxlength="40"')}${campo('na-lote', 'Lote (opcional)', '', 'maxlength="20"')}
      <div class="campo"><label for="na-depto">Departamento</label><select id="na-depto" style="width:100%;padding:10px;border:2px solid var(--borde);border-radius:10px;background:var(--superficie)">${deptos.map((n) => `<option>${esc(n)}</option>`).join('')}</select></div>
      ${campo('na-precio', 'Precio de venta (MXN)', '', 'inputmode="decimal"')}
      <div class="campo"><label for="na-clave">Su clave (${esc(S.sesion.usuario)})</label><input id="na-clave" type="text" data-pin inputmode="numeric" autocomplete="off" placeholder="••••"></div>
      <div id="msg-na" class="mensaje" role="status" aria-live="polite"></div>
      <div class="filas"><button class="btn" type="button" id="na-cerrar">Cancelar</button><button class="btn btn-primario" type="submit" id="na-guardar" style="width:auto;flex:1">${ico('check')}<span>Dar de alta y agregar a la venta</span></button></div>
    </form>`;
  $('#na-cerrar').addEventListener('click', () => d.close());
  $('#form-nuevo-articulo').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const m = $('#msg-na');
    const precio = parseMXN($('#na-precio').value);
    if (!$('#na-codigo').value.trim()) { m.className = 'mensaje error'; m.textContent = 'Escriba o escanee el código de la etiqueta.'; return; }
    if (!$('#na-descripcion').value.trim()) { m.className = 'mensaje error'; m.textContent = 'Escriba la descripción.'; return; }
    if (!precio || precio <= 0) { m.className = 'mensaje error'; m.textContent = 'Escriba un precio mayor que 0.'; return; }
    $('#na-guardar').disabled = true;
    try {
      const r = await api('/api/venta/nuevo-articulo', { cart: S.cart, codigo: $('#na-codigo').value, descripcion: $('#na-descripcion').value, marca: $('#na-marca').value, estilo: $('#na-estilo').value, lote: $('#na-lote').value, departamento: $('#na-depto').value, precio, clave: $('#na-clave').value });
      S.carrito = r.carrito; S.sel = r.linea.linea_id; d.close(); $('#resultados').innerHTML = '';
      msg(`Artículo dado de alta y agregado: ${r.linea.descripcion} ${r.linea.marca}`.trim() + ` · Item # ${r.articulo.item_no ?? 'pendiente'}`, 'ok'); pintarCarrito();
    } catch (e) { $('#na-guardar').disabled = false; $('#na-clave').value = ''; m.className = 'mensaje error'; m.textContent = e.message; $('#na-clave').focus(); }
  });
  d.showModal();
  $(codigo ? '#na-descripcion' : '#na-codigo').focus();
}
function engancharAgregar() {
  for (const b of $('#resultados').querySelectorAll('[data-agregar]')) {
    b.addEventListener('click', async () => {
      try {
        const r = await api('/api/venta/agregar', { cart: S.cart, item_id: b.dataset.agregar });
        S.carrito = r.carrito; S.sel = r.linea.linea_id; $('#resultados').innerHTML = '';
        msg(`Agregado: ${r.linea.descripcion} ${r.linea.marca}`.trim() + (r.linea.ambiguo ? ' (código duplicado: queda marcado para revisión)' : '')); pintarCarrito();
        await ofrecerRecepciones(r.recepcion, r.linea);
      } catch (e) { msg(e.message, 'error'); }
      $('#scan').focus();
    });
  }
}

async function accionLinea(id, a) {
  try {
    const l = S.carrito.lineas.find((x) => x.linea_id === id);
    const r = a === 'quitar' ? await api('/api/venta/quitar', { cart: S.cart, linea_id: id })
      : await api('/api/venta/cantidad', { cart: S.cart, linea_id: id, qty: l.qty + (a === 'mas' ? 1 : -1) });
    S.carrito = r.carrito;
    if (a === 'quitar' && S.sel === id) S.sel = null;
    pintarCarrito();
  } catch (e) { msg(e.message, 'error'); }
  $('#scan').focus();
}

async function cobrar() {
  const b = $('#btn-cobrar');
  b.disabled = true;
  try {
    let r;
    if (S.forma === 'tarjeta' || S.forma === 'mixto') {
      const t = repartoTarjeta();
      r = await api('/api/venta/cobrar-tarjeta', { cart: S.cart, ...(S.forma === 'mixto' ? { importe: t.importe } : {}), autorizacion: $('#tj-aut').value.trim(), marca: $('#tj-marca').value, ultimos4: $('#tj-ult4').value });
    } else if (S.forma === 'credito') {
      r = await api('/api/venta/cobrar-credito-empleada', { cart: S.cart });
    } else if (S.forma === 'regalo') {
      const { resto } = repartoRegalo();
      const c = calcEfectivo(resto);
      r = await api('/api/venta/cobrar-regalo', { cart: S.cart, codigo: S.tarjeta.codigo, ...(resto > 0 ? { recibido: c.pesos, ...(c.usd > 0 ? { usd: c.usd } : {}) } : {}) });
    } else {
      const c = calcEfectivo(S.carrito.total);
      r = await api('/api/venta/cobrar-efectivo', { cart: S.cart, recibido: c.pesos, ...(c.usd > 0 ? { usd: c.usd } : {}) });
    }
    S.ultimoFolio = r.venta.folio;
    mostrarTicket(r);
    await pintarEncabezado();
  } catch (e) {
    msg(e.message, 'error'); recalcular();
    if (e.codigo === 'FOLIO_BLOQUEADO') { await pintarEncabezado(); await ir('folios'); }
  }
}

/** Cerrar el ticket de una venta (con «Nueva venta», Esc o un clic fuera) siempre deja lista una venta nueva: una venta ya cobrada no se puede seguir editando. */
function cerrarTicketYVentaNueva(dlg, despues) {
  let hecho = false;
  const nueva = async () => {
    if (hecho) return;
    hecho = true;
    if (dlg.open) dlg.close();
    const n = await api('/api/venta/nueva', {});
    S.cart = n.cart; S.carrito = n.carrito; S.sel = null;
    await ir('venta');
    if (despues) await despues();
  };
  $('#btn-nueva').addEventListener('click', nueva);
  dlg.addEventListener('close', () => { void nueva(); }, { once: true });
}

function mostrarTicket(r) {
  const dlg = $('#dlg-ticket');
  const imp = r.impresion;
  const regalo = r.venta.pagos.find((p) => p.metodo === 'tarjeta_regalo');
  dlg.innerHTML = `
    <h2 id="dlg-titulo" style="margin:0 0 4px">Venta guardada</h2>
    <p style="margin:0" id="resumen-venta">Folio <b>${String(r.venta.folio).padStart(6, '0')}</b> · ticket <b>${esc(r.codigo_ticket)}</b> · cambio <b id="dlg-cambio">${mxn(r.cambio)}</b>${r.venta.pagos.some((p) => p.metodo === 'efectivo_usd') ? ` · dólares recibidos <b id="dlg-usd">${usd(r.venta.pagos.find((p) => p.metodo === 'efectivo_usd').usd)}</b>` : ''}${regalo ? ` · saldo de la tarjeta <b id="dlg-saldo-regalo">${mxn(regalo.saldo_despues ?? 0)}</b>` : ''}</p>
    <div id="estado-impresion" class="mensaje ${imp.ok ? 'ok' : 'error'}" role="status">${imp.ok ? 'Ticket enviado a la impresora.' : `La impresora falló: ${esc(imp.error)}. La venta SÍ quedó guardada; reintente la impresión.`}</div>
    ${(r.avisos ?? []).length ? `<div class="mensaje aviso" id="avisos-venta">${r.avisos.map((a) => esc(/^cambio_excede_efectivo_mxn:/.test(a) ? `Advertencia: el cambio entregado superó en ${mxn(Number(a.split(':')[1]))} los pesos que se sabía que había en la caja: revise el efectivo.` : a)).join(' · ')}</div>` : ''}
    ${logoTicketHtml()}<pre class="ticket" id="ticket-texto" tabindex="0">${esc(r.ticket_texto)}</pre>
    ${(r.venta.recompensas ?? []).map((e) => `<div class="panel" data-cupon-ganado="${esc(e.codigo)}" style="text-align:center;margin:8px 0"><b>Cupón ganado: ${esc(e.nombre)}</b><br><canvas width="150" height="150" aria-label="QR del cupón ${esc(e.codigo)}" data-qr="${esc(e.codigo)}"></canvas><br><small>${esc(e.codigo)}</small></div>`).join('')}
    <div class="filas"><button class="btn" id="btn-reimprimir" type="button">${ico('printer')}<span>${imp.ok ? 'Reimprimir ticket' : 'Reintentar impresión'}</span></button><button class="btn" id="btn-ticket-regalo" type="button">${ico('gift')}<span>Ticket de regalo</span></button><button class="btn btn-primario" id="btn-nueva" type="button" style="width:auto;flex:1">${ico('plus')}<span>Nueva venta</span></button></div>`;
  dlg.showModal();
  void imprimirNavegador(r.ticket_texto, { qrs: (r.venta.recompensas ?? []).map((e) => e.codigo) });
  for (const cv of dlg.querySelectorAll('canvas[data-qr]')) dibujarQR(cv.getContext('2d'), cv.dataset.qr, 0, 0, 150);
  $('#btn-ticket-regalo').addEventListener('click', () => abrirTicketRegalo(r.venta.sale_id));
  if (S.conRegalo) {
    // se pidió ticket de regalo antes de cobrar: sale junto con el ticket de la venta
    S.conRegalo = false;
    api('/api/venta/ticket-regalo', { sale_id: r.venta.sale_id }).then((x) => { $('#estado-impresion').insertAdjacentHTML('afterend', `<div class="mensaje ${x.impresion.ok ? 'ok' : 'error'}" id="estado-regalo" role="status">${x.impresion.ok ? 'Ticket de regalo enviado a la impresora.' : `El ticket de regalo no se imprimió: ${esc(x.impresion.error)}. Use el botón «Ticket de regalo» para reintentar.`}</div>`); })
      .catch((e) => $('#estado-impresion').insertAdjacentHTML('afterend', `<div class="mensaje error" id="estado-regalo">${esc(e.message)}</div>`));
  }
  $('#btn-reimprimir').addEventListener('click', async () => {
    try {
      const x = await api('/api/venta/reimprimir', { sale_id: r.venta.sale_id });
      $('#ticket-texto').textContent = x.ticket_texto;
      const e = $('#estado-impresion');
      e.className = `mensaje ${x.impresion.ok ? 'ok' : 'error'}`;
      e.textContent = x.impresion.ok ? 'Ticket enviado a la impresora (reimpresión).' : `La impresora falló: ${x.impresion.error}.`;
      await imprimirNavegador(x.ticket_texto, { qrs: (r.venta.recompensas ?? []).map((q) => q.codigo) });
    } catch (err) { $('#estado-impresion').textContent = err.message; }
  });
  cerrarTicketYVentaNueva(dlg);
}

/** Imprime y muestra el ticket de regalo (mercancía sin precios) de una venta de esta caja. */
async function abrirTicketRegalo(saleId) {
  const d = dialogo('dlg-regalo');
  d.setAttribute('aria-labelledby', 'regalo-titulo');
  const pintar = (x, nota) => {
    d.innerHTML = `<h2 id="regalo-titulo" style="margin:0 0 4px">Ticket de regalo</h2>
      <div id="estado-regalo-dlg" class="mensaje ${x.impresion.ok ? 'ok' : 'error'}" role="status">${x.impresion.ok ? esc(nota) : `La impresora falló: ${esc(x.impresion.error)}.`}</div>
      ${logoTicketHtml()}<pre class="ticket" id="ticket-regalo-texto">${esc(x.ticket_texto)}</pre>
      <div class="filas"><button class="btn" id="regalo-cerrar" type="button">${ico('x')}<span>Cerrar</span></button><button class="btn btn-primario" id="regalo-reimprimir" type="button" style="width:auto;flex:1">${ico('printer')}<span>Imprimir otra vez</span></button></div>`;
    $('#regalo-cerrar').addEventListener('click', () => d.close());
    $('#regalo-reimprimir').addEventListener('click', async () => { try { pintar(await api('/api/venta/ticket-regalo', { sale_id: saleId }), 'Ticket de regalo enviado a la impresora.'); } catch (e) { $('#estado-regalo-dlg').className = 'mensaje error'; $('#estado-regalo-dlg').textContent = e.message; } });
  };
  try {
    pintar(await api('/api/venta/ticket-regalo', { sale_id: saleId }), 'Ticket de regalo enviado a la impresora.');
    d.showModal();
  } catch (e) { const m = $('#estado-impresion'); if (m) { m.className = 'mensaje error'; m.textContent = e.message; } else msg(e.message, 'error'); }
}

// ── corte ──
/** Importe de un desglose que los cortes cerrados antes de existir no traen: «No disponible», nunca $0. */
const mxnODisp = (v) => (v === undefined || v === null ? 'No disponible' : mxn(v));
const FILAS_CORTE = [
  ['tickets', 'Tickets', (v) => v], ['ventas_brutas', 'Mercancía antes de descuentos', mxn], ['descuentos', 'Descuentos', mxn], ['ventas_mercancia', 'Ventas de mercancía', mxn],
  ['tarjetas_regalo_vendidas', 'Tarjetas de regalo vendidas o recargadas (no son ventas de mercancía)', mxn], ['ventas_a_credito_empleadas', 'Ventas a crédito de empleadas (se descuentan de nómina; no es cobro ni efectivo)', mxnODisp], ['ventas', 'Total de tickets de venta', mxn],
  ['mercancia_recibida_por_cambio', 'Mercancía recibida a cambio (no es salida de dinero)', mxnODisp], ['devoluciones_con_reembolso', 'Devoluciones con reembolso real', mxnODisp], ['diferencias_cobradas_en_cambios', 'Diferencias cobradas en cambios (ya incluidas en los cobros)', mxnODisp], ['diferencias_devueltas_en_cambios', 'Diferencias devueltas en cambios (ya incluidas en los reembolsos)', mxnODisp], ['devoluciones_en_efectivo', 'Devoluciones en efectivo', mxn], ['devoluciones_a_tarjeta_regalo', 'Devoluciones a tarjeta de regalo', mxn], ['ventas_netas', 'Ventas netas de mercancía', mxn], ['cobros_efectivo', 'Cobros en efectivo (MXN)', mxn], ['cobros_efectivo_usd', 'Cobros en efectivo con dólares (MXN que liquidan)', mxn], ['devoluciones_a_tarjeta', 'Reversos a tarjeta bancaria (no sale efectivo)', mxn], ['cobros_tarjeta', 'Cobros con tarjeta bancaria', mxn], ['cobros_tarjeta_regalo', 'Cobros con tarjeta de regalo', mxn],
  ['fondo_inicial', 'Fondo inicial en pesos', mxn], ['entradas', 'Entradas en pesos', mxn], ['retiros', 'Retiros en pesos', mxn], ['pesos_recibidos_con_usd', 'Pesos recibidos junto con dólares', mxn], ['cambio_mxn_con_usd', 'Cambio entregado en pesos por cobros con dólares', mxn],
  ['efectivo_esperado', 'EFECTIVO MXN de ventas esperado (pesos físicos, sin el fondo)', mxn],
  ['fondo_inicial_usd', 'Fondo inicial en dólares', usd], ['usd_recibidos', 'Dólares recibidos en cobros', usd], ['entradas_usd', 'Entradas en dólares', usd], ['retiros_usd', 'Retiros en dólares', usd],
  ['efectivo_usd_esperado', 'EFECTIVO USD esperado (dólares físicos)', usd],
  ['usd_equivalente_mxn_historico', 'Equivalente en MXN de los dólares recibidos (tasa de cada operación)', mxn],
  ['conteo_usd', 'Dólares contados (último conteo del día)', (v) => (v ? usd(v.contado) : '—')], ['diferencia_usd', 'Diferencia de dólares (contado − esperado)', (v) => (v === null ? '—' : (v < 0 ? '-' : '') + usd(Math.abs(v)))],
  ['conteo_mxn', 'Pesos contados (último conteo del día)', (v) => (v ? mxn(v.contado) : '—')], ['diferencia_mxn', 'Diferencia de pesos (contado − esperado)', (v) => (v === null ? '—' : mxn(v))],
  ['ventas_anuladas_antes_de_cobro', 'Ventas anuladas antes de recibir dinero (sin movimiento físico)', (v) => v], ['cancelaciones_posteriores_al_cobro', 'Ventas canceladas después de recibir efectivo (el cobro queda y se suma la salida)', (v) => v], ['aperturas_cajon_sin_venta', 'Aperturas del cajón sin venta (botón «Abrir caja»)', (v) => v ?? 0], ['billetes_usd_rechazados', 'Billetes en dólares rechazados (dañados o sospechosos)', (v) => v],
  ['folio_inicial', 'Folio inicial (ventas y devoluciones)', (v) => (v ?? '—')], ['folio_final', 'Folio final', (v) => (v ?? '—')], ['tickets_cancelados', 'Tickets cancelados', (v) => v],
];
// ── Cierre de caja guiado: 1 Fondo · 2 Efectivo de ventas · 3 Revisar y cerrar ──
// Lo contable no cambia: el esperado sale del libro de movimientos. El fondo fijo se separa y se cuenta aparte (no es venta ni movimiento de efectivo).
// Pesos: la clave es el valor en centavos. $20 existe como moneda y como billete: son dos renglones con la misma clave y se suman al enviar.
const FILAS_PESOS = [
  ['m2000', 2000, 'Moneda $20'], ['m1000', 1000, 'Moneda $10'], ['m500', 500, 'Moneda $5'], ['m200', 200, 'Moneda $2'], ['m100', 100, 'Moneda $1'],
  ['b100000', 100000, 'Billete $1,000'], ['b50000', 50000, 'Billete $500'], ['b20000', 20000, 'Billete $200'], ['b10000', 10000, 'Billete $100'], ['b5000', 5000, 'Billete $50'], ['b2000', 2000, 'Billete $20'],
];
const FILAS_USD = [100, 50, 20, 10, 5, 2, 1].map((d) => [`u${d}`, d * 100, `Billete US$${d}`, d]);
/** Tabla de conteo por denominación. `previos` = { clave: cantidad } para precargar (el renglón del billete se queda con las de $20). */
function tablaDenominaciones(prefijo, filas, fmt, previos = {}) {
  const usadas = new Set();
  return `<table class="tabla-denom"><thead><tr><th>Denominación</th><th class="num">Cantidad</th><th class="num">Importe</th></tr></thead><tbody>
    ${filas.map(([id, unidad, rotulo, clave]) => {
      const k = String(clave ?? unidad);
      const nombre = id.startsWith('m') ? 'm' : 'b';
      const cant = (!usadas.has(k) && previos[k] && (nombre === 'b' || !filas.some((f) => String(f[3] ?? f[1]) === k && f[0].startsWith('b')))) ? previos[k] : 0;
      if (cant) usadas.add(k);
      return `<tr><th scope="row">${rotulo}</th><td class="num"><input type="number" min="0" step="1" value="${cant}" data-${prefijo}="${id}" data-unidad="${unidad}" data-clave="${k}" aria-label="Cantidad de ${esc(rotulo)}" style="width:80px;text-align:right;padding:4px;border:1px solid var(--borde);border-radius:6px;background:var(--superficie)"></td><td class="num" data-imp-${prefijo}="${id}">${fmt(unidad * cant)}</td></tr>`;
    }).join('')}</tbody></table>`;
}
/** Suma lo capturado: devuelve { total, den } con las cantidades por clave (las dos filas de $20 se suman). */
function leerDenominaciones(prefijo, fmt, raiz = document) {
  let total = 0; const den = {};
  for (const i of raiz.querySelectorAll(`[data-${prefijo}]`)) {
    const n = Math.max(0, Math.floor(Number(i.value) || 0));
    const unidad = Number(i.dataset.unidad);
    const celda = raiz.querySelector(`[data-imp-${prefijo}="${i.dataset[prefijo]}"]`);
    if (celda) celda.textContent = fmt(unidad * n);
    total += unidad * n;
    if (n) den[i.dataset.clave] = (den[i.dataset.clave] ?? 0) + n;
  }
  return { total, den };
}
const horaCorte = (iso) => new Date(Date.parse(iso) - 7 * 3600000).toISOString().slice(11, 16);
const dif$ = (c, f = mxn) => (c === 0 ? f(0) : `${c < 0 ? '-' : '+'}${f(Math.abs(c))}`);

async function vistaCorte() {
  const j = await api('/api/corte');
  const v = j.vivo, est = j.estado;
  const cerrado = !!j.cerrado && !j.desactualizado; // con operaciones posteriores al último cierre se puede cerrar de nuevo (cubre todo el día)
  const hecho = { 1: !est.faltan.includes('fondo'), 2: v.conteo_alcance === 'ventas' && !est.faltan.some((f) => f.startsWith('recontar') || f === 'conteo_usd') && !est.faltan.includes('conteo_ventas') };
  const primero = !hecho[1] ? 1 : !hecho[2] ? 2 : 3;
  const maximo = cerrado ? 3 : primero;
  const paso = Math.min(S.cierrePaso ?? primero, maximo);
  S.cierrePaso = paso;
  const titulos = [[1, 'Fondo'], [2, 'Ventas en efectivo'], [3, 'Revisar y cerrar']];
  const pasos = `<ol class="cierre-pasos" id="cierre-pasos">${titulos.map(([n, t]) => {
    const ok = n === 1 ? hecho[1] : n === 2 ? hecho[2] : cerrado;
    const clic = n <= maximo;
    return `<li><button type="button" class="paso-btn ${n === paso ? 'activo' : ''} ${ok ? 'hecho' : ''}" data-paso="${n}" ${clic ? '' : 'disabled'} aria-current="${n === paso ? 'step' : 'false'}"><span class="paso-num">${ok ? ico('check') : n}</span><span>${n}. ${t}</span></button></li>`;
  }).join('')}</ol>`;
  const cab = `<div class="titulo-vista">${ico('register')}<h1>Cierre de caja — Caja ${v.caja} (${esc(v.tienda)}) · ${esc(v.fecha)}</h1></div>${pasos}
    ${v.perdida_documental_abierta.length ? '<div class="mensaje error" data-alerta="perdida-corte">Este corte puede estar incompleto: hay una posible pérdida de ventas, pagos o folios de esta caja sin resolver.</div>' : ''}
    ${j.cerrado && !cerrado ? `<div class="mensaje aviso" id="corte-reabierto">Ya se hizo un corte de arqueo a las ${horaCorte(j.cerrado_en)} con ${mxn(j.cerrado.ventas_mercancia)} de venta${j.cerrado.fondo_confirmado !== null ? ' y se confirmó fondo' : ''}. Hubo operaciones después: cuente de nuevo y cierre otra vez (el cierre cubre todo el día y deja anotado el corte anterior).</div>` : ''}
    ${cerrado ? `<div class="mensaje ok" id="corte-cerrado">Corte cerrado${j.cerrado.cerrado_por ? ` por ${esc(j.cerrado.cerrado_por)}` : ''}.</div>
      <div id="estado-impresion-cierre" class="mensaje ${S.cierreImpresion && !S.cierreImpresion.ok ? 'error' : 'ok'}" role="status" aria-live="polite" ${S.cierreImpresion ? '' : 'hidden'}>${S.cierreImpresion ? (S.cierreImpresion.ok ? 'El ticket de cierre se envió a la impresora.' : `No se pudo imprimir el ticket de cierre: ${esc(S.cierreImpresion.error ?? '')}. El corte SÍ quedó cerrado; use «Reimprimir cierre».`) : ''}</div>
      <div class="filas"><button class="btn" type="button" id="btn-reimprimir-cierre">${ico('printer')}<span>Reimprimir cierre</span></button></div>` : ''}`;
  let cuerpo = '';
  if (paso === 1) {
    const prev = (j.cerrado && !cerrado) ? {} : (v.fondo_denominaciones ?? v.fondo_referencia?.denominaciones ?? {}); // al reabrir, se cuenta de nuevo desde cero
    cuerpo = `<section class="panel" id="paso-fondo"><h2 style="margin-top:0">Paso 1: Contar y completar fondo</h2>
      <p class="nota">Primero separe el fondo fijo autorizado por Administración. La cajera cuenta el fondo, pero no modifica el importe autorizado. Separarlo del cajón no es una venta ni un ingreso.</p>
      <div class="mensaje" id="fondo-autorizado" style="background:var(--superficie-2,#eef6fb)">Fondo autorizado por Administración: <b>${mxn(v.fondo_autorizado)}</b></div>
      ${v.fondo_referencia && v.fondo_confirmado === null ? `<p class="nota" id="fondo-referencia">Composición del último fondo confirmado (${esc(v.fondo_referencia.fecha)}): ${mxn(v.fondo_referencia.total)}. <button class="btn" type="button" id="fondo-usar-anterior">Usar esa composición</button></p>` : ''}
      <div class="tabla-cont">${tablaDenominaciones('fondo', FILAS_PESOS, mxn, prev)}</div>
      <div class="panel" id="fondo-resumen" style="margin:10px 0"><p style="margin:0">Total contado del fondo: <b id="fondo-total">${mxn(0)}</b> · <span id="fondo-dif-txt"></span></p><p id="fondo-estado" style="margin:6px 0 0;font-weight:700"></p></div>
      <div class="campo" id="fondo-nota-campo" hidden><label for="fondo-nota">Nota del <span id="fondo-nota-tipo">faltante</span> (obligatoria; queda en el corte), por ejemplo «faltante por pago de barrendero»</label><textarea id="fondo-nota" rows="2" maxlength="300" style="width:100%;box-sizing:border-box;padding:8px;border:2px solid var(--borde);border-radius:10px;background:var(--superficie);font:inherit">${esc(v.fondo_nota ?? '')}</textarea></div>
      <div id="msg-fondo" class="mensaje" role="status" aria-live="polite"></div>
      ${cerrado ? '' : `<button class="btn btn-primario" id="btn-fondo" type="button">${ico('check')}<span>Confirmar fondo y continuar</span></button>`}</section>`;
  } else if (paso === 2) {
    const mostrarUsd = est.usd_requerido || (S.verUsd ?? false) || v.usd.contado !== null;
    const prev = v.conteo_mxn?.denominaciones ?? {};
    cuerpo = `<section class="panel" id="paso-ventas"><h2 style="margin-top:0">Paso 2: Contar efectivo de las ventas</h2>
      <p class="nota">Cuente únicamente el dinero de las ventas: el fondo ya está separado y <b>no se cuenta otra vez</b>. No incluya pagos bancarios (tarjeta, transferencia).</p>
      <div class="mensaje ok" id="fondo-confirmado">Fondo confirmado: <b>${mxn(v.fondo_confirmado ?? 0)}</b>${v.fondo_estado && v.fondo_estado !== 'completo' ? ` · ${esc(v.fondo_estado)} de ${mxn(Math.abs(v.fondo_diferencia))}` : ''}</div>
      ${v.conteo_desactualizado.mxn || v.conteo_desactualizado.usd ? '<div class="mensaje aviso" id="aviso-recontar">Hubo movimientos de efectivo después del último conteo: vuelva a contar para poder cerrar.</div>' : ''}
      <div class="cuadricula">
        <div class="panel"><h3 style="margin-top:0">Pesos (MXN)</h3><div class="tabla-cont">${tablaDenominaciones('venta', FILAS_PESOS, mxn, prev)}</div></div>
        ${mostrarUsd ? `<div class="panel" id="panel-usd"><h3 style="margin-top:0">Dólares (USD)</h3><div class="tabla-cont">${tablaDenominaciones('usd', FILAS_USD, usd, v.conteo_usd?.denominaciones ?? {})}</div>
          <p class="nota">Los dólares se cuentan como dólares; en pesos se concilian con el tipo de cambio de cada operación.</p></div>` : `<div class="panel"><p class="nota" id="sin-usd">No hubo dólares hoy. <button class="btn" type="button" id="btn-ver-usd">Contar dólares</button></p></div>`}
      </div>
      <div class="panel" style="margin:10px 0"><p style="margin:0">Total contado ventas MXN: <b id="venta-total-mxn">${mxn(0)}</b> · Esperado: <b id="venta-esperado">${mxn(v.efectivo_ventas_esperado)}</b> · Diferencia: <b id="venta-dif">${mxn(0)}</b></p>
        ${mostrarUsd ? `<p style="margin:6px 0 0">Total contado dólares: <b id="venta-total-usd">${usd(0)}</b> · Esperado: <b id="venta-esperado-usd">${usd(v.efectivo_usd_esperado)}</b></p>` : ''}
        <p id="venta-estado" style="margin:6px 0 0;font-weight:700"></p></div>
      <div id="msg-conteo" class="mensaje" role="status" aria-live="polite"></div>
      <div class="filas">${cerrado ? '' : `<button class="btn" type="button" id="btn-volver-fondo">Volver al fondo</button><button class="btn btn-primario" id="btn-conteo" type="button">${ico('check')}<span>Continuar a revisión y cierre</span></button>`}</div></section>`;
  } else {
    const dif = v.diferencia_mxn, difUsd = v.diferencia_usd;
    const fila = (id, t, val) => `<tr><th scope="row">${t}</th><td class="num" id="${id}">${val}</td></tr>`;
    const pend = est.faltan.length ? `<div class="mensaje aviso" id="cierre-pendiente">Para cerrar falta: ${est.faltan.map((f) => ({ fondo: 'confirmar el fondo', conteo_ventas: 'contar el efectivo de ventas', recontar_ventas: 'volver a contar los pesos (hubo movimientos)', conteo_usd: 'contar los dólares', recontar_usd: 'volver a contar los dólares (hubo movimientos)' }[f])).join(', ')}.</div>` : '';
    cuerpo = `<section class="panel" id="paso-cierre"><h2 style="margin-top:0">Paso 3: Revisar y cerrar</h2>
      <p class="nota">Revise el fondo, el efectivo contado y los movimientos del día antes de cerrar el corte.</p>${pend}
      <div class="kpi-grande" id="kpi-venta-total"><span class="kpi-rotulo">VENTA TOTAL DEL DÍA</span><span class="kpi-valor" id="rc-venta-total">${mxn(v.ventas_mercancia)}</span><span class="kpi-sub">${v.tickets} ticket${v.tickets === 1 ? '' : 's'} de venta${v.descuentos ? ` · descuentos ${mxn(v.descuentos)}` : ''}</span></div>
      <div class="kpi-grid">
        <div class="kpi" id="kpi-efectivo"><span class="kpi-rotulo">TOTAL EN EFECTIVO</span><b id="rc-total-efectivo">${mxn(v.cobros_efectivo + v.cobros_efectivo_usd)}</b></div>
        <div class="kpi" id="kpi-pesos"><span class="kpi-rotulo">Total en pesos</span><b id="rc-total-pesos">${mxn(v.cobros_efectivo)}</b></div>
        <div class="kpi" id="kpi-dolares"><span class="kpi-rotulo">Total en dólares</span><b id="rc-total-dolares">${usd(v.usd_recibidos)}</b>${v.cobros_efectivo_usd ? `<small>${mxn(v.cobros_efectivo_usd)}</small>` : ''}</div>
        <div class="kpi" id="kpi-tarjeta"><span class="kpi-rotulo">TOTAL EN TARJETA</span><b id="rc-total-tarjeta">${mxn(v.cobros_tarjeta)}</b></div>
        ${v.ventas_a_credito_empleadas ? `<div class="kpi" id="kpi-credito-empleadas"><span class="kpi-rotulo">Crédito de empleadas</span><b id="rc-credito-empleadas">${mxn(v.ventas_a_credito_empleadas)}</b><small>no es cobro</small></div>` : ''}
      </div>
      <div class="panel" id="kpi-fondo" style="margin:10px 0"><h3 style="margin:0 0 6px">Fondo</h3>
        <p style="margin:0">Fondo autorizado: <b id="rc-fondo-autorizado">${mxn(v.fondo_autorizado)}</b> · <b>Fondo confirmado: <span id="rc-fondo-confirmado">${v.fondo_confirmado === null ? '—' : `${mxn(v.fondo_confirmado)}${v.fondo_estado && v.fondo_estado !== 'completo' ? ` (${esc(v.fondo_estado)} de ${mxn(Math.abs(v.fondo_diferencia))}: ${esc(v.fondo_nota ?? '')})` : ' (completo)'}`}</span></b></p></div>
      <div class="panel" id="bloque-cambios" style="margin:10px 0"><h3 style="margin:0 0 6px">Cambios y devoluciones</h3>
        <table><tbody>
          <tr><th scope="row">Mercancía recibida a cambio</th><td class="num" id="rc-recibida-cambio">${mxnODisp(v.mercancia_recibida_por_cambio)}</td></tr>
          <tr><th scope="row">Diferencias cobradas en cambios</th><td class="num" id="rc-dif-cambios">${mxnODisp(v.diferencias_cobradas_en_cambios)}</td></tr>
          <tr><th scope="row">Devoluciones con reembolso</th><td class="num" id="rc-devoluciones">${mxnODisp(v.devoluciones_con_reembolso)}</td></tr>
          <tr><th scope="row" style="font-size:18px">VENTAS NETAS</th><td class="num" style="font-size:20px" id="rc-ventas-netas"><b>${mxn(v.ventas_netas)}</b></td></tr></tbody></table></div>
      <h3 style="margin:14px 0 6px">Conciliación del efectivo</h3>
      <div class="tabla-cont"><table id="resumen-cierre"><tbody>
        ${fila('rc-contado-mxn', 'Efectivo MXN de ventas contado', v.conteo_mxn && v.conteo_alcance === 'ventas' ? mxn(v.conteo_mxn.contado) : '—')}
        ${fila('rc-contado-usd', 'Efectivo USD contado', v.conteo_usd ? usd(v.conteo_usd.contado) : (est.usd_requerido ? '—' : usd(0)))}
        ${fila('rc-esperado', 'Efectivo MXN esperado (movimientos reales de caja)', mxn(v.efectivo_ventas_esperado))}
        ${fila('rc-esperado-usd', 'Efectivo USD esperado', usd(v.efectivo_usd_esperado))}
        ${fila('rc-tarjeta', 'Cobros con tarjeta / banco (no es efectivo)', mxn(v.cobros_tarjeta))}
        ${fila('rc-reembolsos-banco', 'Reembolsos a tarjeta / banco (no es efectivo)', mxn(v.devoluciones_a_tarjeta))}
        ${fila('rc-retiros', 'Retiros registrados', mxn(v.retiros))}
        ${fila('rc-entradas', 'Entradas y ajustes extraordinarios', mxn(v.entradas + (v.ajustes_admin ?? 0)))}
        ${fila('rc-dif-mxn', 'Diferencia en pesos (contado − esperado)', dif === null || v.conteo_alcance !== 'ventas' ? '—' : `<b style="color:${dif === 0 ? 'var(--ok,#0a7a4b)' : 'var(--error,#b3261e)'}">${dif$(dif)}</b> ${dif === 0 ? '· Sin diferencias' : dif > 0 ? '· Sobrante' : '· Faltante'}`)}
        ${fila('rc-dif-usd', 'Diferencia en dólares', difUsd === null ? '—' : `${dif$(difUsd, usd)}${difUsd === 0 ? ' · Sin diferencias' : difUsd > 0 ? ' · Sobrante' : ' · Faltante'}`)}
      </tbody></table></div>
      <p class="nota">Los faltantes y sobrantes se registran tal cual en el corte; el sistema no los corrige para cuadrar la caja.</p>
      <div class="campo"><label for="cierre-obs">Observaciones del cierre</label><textarea id="cierre-obs" rows="2" maxlength="500" ${cerrado ? 'disabled' : ''} style="width:100%;box-sizing:border-box;padding:8px;border:2px solid var(--borde);border-radius:10px;background:var(--superficie);font:inherit">${esc(cerrado ? (j.cerrado.observaciones ?? '') : '')}</textarea></div>
      ${!cerrado && est.puede_cerrar && j.pide_clave ? '<div class="campo"><label for="cierre-clave">Su clave para cerrar el corte</label><input id="cierre-clave" type="text" data-pin inputmode="numeric" autocomplete="off" style="width:140px;padding:8px;border:2px solid var(--borde);border-radius:10px"></div>' : ''}
      <div id="msg-cierre" class="mensaje" role="status" aria-live="polite"></div>
      <div class="filas"><button class="btn" type="button" id="btn-volver-conteo" ${cerrado ? 'hidden' : ''}>Volver al conteo</button>${!cerrado && est.puede_cerrar ? `<button class="btn btn-primario" id="btn-cerrar-corte" type="button">${ico('check')}<span>CERRAR CORTE</span></button>` : ''}</div>
      <details id="detalle-corte" style="margin-top:12px"><summary>Ver el detalle completo del corte</summary>
        <table id="tabla-corte"><tbody>${FILAS_CORTE.map(([k, t, f]) => `<tr data-campo="${k}"><th scope="row">${t}</th><td class="num">${f(v[k])}</td></tr>`).join('')}</tbody></table>
        <p class="nota">Corte en vivo: se calcula con las ventas de ESTA caja. Pesos y dólares se concilian por separado.</p></details></section>`;
  }
  // Para contar el fondo y el efectivo hay que abrir el cajón: «Empezar corte» lo abre (con la clave de quien cierra) y deja registrado el motivo. Cada cierre del día empieza así.
  const llaveCajon = `${v.fecha}:${j.cierres ?? 0}`;
  if (!cerrado && paso < 3 && S.cierreCajon !== llaveCajon) {
    $('#vista').innerHTML = `${cab}<section class="panel" id="paso-empezar"><h2 style="margin-top:0">Empezar corte</h2>
      <p class="nota">Para contar el fondo y el efectivo de las ventas se abre el cajón (queda registrado en el corte como «Corte de caja»).</p>
      ${j.pide_clave ? '<div class="campo"><label for="empezar-clave">Su clave</label><input id="empezar-clave" type="text" data-pin inputmode="numeric" autocomplete="off" placeholder="••••"></div>' : ''}
      <div id="msg-empezar" class="mensaje" role="alert"></div>
      <button class="btn btn-primario" id="btn-empezar" type="button">${ico('cash')}<span>Empezar corte y abrir cajón</span></button></section>`;
    for (const b of $('#cierre-pasos').querySelectorAll('[data-paso]')) b.addEventListener('click', () => { S.cierrePaso = Number(b.dataset.paso); vistaCorte(); });
    $('#btn-empezar').addEventListener('click', async () => {
      const m = $('#msg-empezar');
      if (j.pide_clave && !$('#empezar-clave').value) { m.className = 'mensaje error'; m.textContent = 'Teclee su clave.'; $('#empezar-clave').focus(); return; }
      try {
        await api('/api/caja/abrir', { motivo: 'Corte de caja', ...(j.pide_clave ? { clave: $('#empezar-clave').value } : {}) });
        S.cierreCajon = llaveCajon;
        imprimirNavegador(comprobanteApertura(), { logo: false }).catch(() => {});
        await vistaCorte();
      } catch (e) { m.className = 'mensaje error'; m.textContent = e.message; const c = $('#empezar-clave'); if (c) c.value = ''; }
    });
    ($('#empezar-clave') ?? $('#btn-empezar')).focus();
    return;
  }
  $('#vista').innerHTML = `${cab}${cuerpo}`;
  for (const b of $('#cierre-pasos').querySelectorAll('[data-paso]')) b.addEventListener('click', () => { S.cierrePaso = Number(b.dataset.paso); vistaCorte(); });
  if (paso === 1) {
    const total = () => {
      const { total: t } = leerDenominaciones('fondo', mxn);
      const d = t - v.fondo_autorizado;
      $('#fondo-total').textContent = mxn(t);
      $('#fondo-dif-txt').textContent = d === 0 ? 'Fondo exacto' : d < 0 ? `Faltan ${mxn(-d)} para completar el fondo` : `Sobran ${mxn(d)} de lo autorizado`;
      const e = $('#fondo-estado');
      e.textContent = t === 0 ? '' : d === 0 ? 'FONDO COMPLETO' : d < 0 ? 'Fondo incompleto: registre el faltante con una nota' : 'Fondo con sobrante: registre el sobrante con una nota';
      e.style.color = d === 0 ? 'var(--ok,#0a7a4b)' : 'var(--error,#b3261e)';
      $('#fondo-nota-campo').hidden = d === 0 || t === 0;
      $('#fondo-nota-tipo').textContent = d < 0 ? 'faltante' : 'sobrante';
      return { t, d };
    };
    for (const i of $('#vista').querySelectorAll('[data-fondo]')) i.addEventListener('input', total);
    total();
    $('#fondo-usar-anterior')?.addEventListener('click', () => {
      const ref = v.fondo_referencia.denominaciones;
      for (const i of $('#vista').querySelectorAll('[data-fondo]')) i.value = i.dataset.fondo.startsWith('b') ? (ref[i.dataset.clave] ?? 0) : (i.dataset.clave === '2000' ? 0 : (ref[i.dataset.clave] ?? 0));
      total();
    });
    $('#btn-fondo')?.addEventListener('click', async () => {
      const m = $('#msg-fondo');
      const { den } = leerDenominaciones('fondo', mxn);
      try { await api('/api/cierre/fondo', { denominaciones: den, nota: $('#fondo-nota').value }); S.cierrePaso = 2; await vistaCorte(); }
      catch (e) { m.className = 'mensaje error'; m.textContent = e.message; }
    });
  } else if (paso === 2) {
    const calc = () => {
      const m = leerDenominaciones('venta', mxn);
      const d = m.total - v.efectivo_ventas_esperado;
      $('#venta-total-mxn').textContent = mxn(m.total);
      $('#venta-dif').textContent = dif$(d);
      let txt = d === 0 ? 'Conteo correcto' : d < 0 ? `Faltante de ${mxn(-d)} (se registra en el corte)` : `Sobrante de ${mxn(d)} (se registra en el corte)`;
      if ($('#venta-total-usd')) { const u = leerDenominaciones('usd', usd); $('#venta-total-usd').textContent = usd(u.total); const du = u.total - v.efectivo_usd_esperado; if (du !== 0) txt += ` · Dólares: ${du < 0 ? 'faltante' : 'sobrante'} de ${usd(Math.abs(du))}`; }
      const e = $('#venta-estado'); e.textContent = txt; e.style.color = d === 0 ? 'var(--ok,#0a7a4b)' : 'var(--error,#b3261e)';
    };
    for (const i of $('#vista').querySelectorAll('[data-venta],[data-usd]')) i.addEventListener('input', calc);
    calc();
    $('#btn-ver-usd')?.addEventListener('click', () => { S.verUsd = true; vistaCorte(); });
    $('#btn-volver-fondo')?.addEventListener('click', () => { S.cierrePaso = 1; vistaCorte(); });
    $('#btn-conteo')?.addEventListener('click', async () => {
      const m = $('#msg-conteo');
      try {
        await api('/api/efectivo/conteo', { moneda: 'MXN', denominaciones: leerDenominaciones('venta', mxn).den, alcance: 'ventas' });
        if ($('#panel-usd')) await api('/api/efectivo/conteo', { moneda: 'USD', denominaciones: leerDenominaciones('usd', usd).den });
        S.cierrePaso = 3; await vistaCorte();
      } catch (e) { m.className = 'mensaje error'; m.textContent = e.message; }
    });
  } else {
    $('#btn-volver-conteo')?.addEventListener('click', () => { S.cierrePaso = 2; vistaCorte(); });
    $('#btn-cerrar-corte')?.addEventListener('click', async () => {
      const m = $('#msg-cierre');
      try {
        const r = await api('/api/corte/cerrar', { clave: $('#cierre-clave')?.value ?? '', observaciones: $('#cierre-obs').value });
        if (r.ticket_texto) void imprimirNavegador(r.ticket_texto, { logo: false });
        S.cierreImpresion = r.impresion ?? null;
        await vistaCorte();
      } catch (e) { m.className = 'mensaje error'; m.textContent = e.message; }
    });
  }
  $('#btn-reimprimir-cierre')?.addEventListener('click', async () => {
    const m = $('#estado-impresion-cierre');
    try {
      const r = await api('/api/corte/reimprimir', {});
      if (r.ticket_texto) void imprimirNavegador(r.ticket_texto, { logo: false });
      S.cierreImpresion = r.impresion;
      m.hidden = false; m.className = `mensaje ${r.impresion.ok ? 'ok' : 'error'}`;
      m.textContent = r.impresion.ok ? `Reimpresión ${r.reimpresion} enviada a la impresora.` : `No se pudo imprimir: ${r.impresion.error}. Intente de nuevo.`;
    } catch (e) { m.hidden = false; m.className = 'mensaje error'; m.textContent = e.message; }
  });
}

// ── Operaciones extraordinarias de efectivo (fuera del cierre): entradas con clave de supervisor; los retiros tienen su módulo ──
const nuevaRef = () => (globalThis.crypto?.randomUUID ? crypto.randomUUID() : `r-${Date.now()}-${Math.random().toString(16).slice(2)}`);
const NOM_EXTRA = { entrada: 'Entrada de efectivo', retiro: 'Retiro', ajuste_entrada: 'Entrega de Administración', ajuste_salida: 'Salida por ajuste de Administración', gasto: 'Gasto de caja' };
async function vistaExtraordinarias() {
  const [j, au] = await Promise.all([api('/api/efectivo/extraordinarias'), api('/api/venta/autorizadores')]);
  S.refEntrada ??= nuevaRef();
  S.refGasto ??= nuevaRef();
  $('#vista').innerHTML = `<div class="titulo-vista">${ico('cash')}<h1>Operaciones extraordinarias de efectivo</h1></div>
    <section class="panel"><h2 style="margin-top:0">Entrada de efectivo</h2>
      <p class="nota">Dinero que entra al cajón y no es una venta. Lo autoriza un <b>supervisor con su clave</b> y queda registrado con el motivo. El fondo fijo no se registra aquí: se cuenta en el cierre y su monto lo asigna Administración. Para retirar efectivo use <button class="btn" type="button" id="ir-retiro">Retiro</button>.</p>
      <form id="form-entrada" autocomplete="off">
        <div class="campo"><label for="ent-moneda">Moneda</label><select id="ent-moneda" style="width:100%;padding:8px;border:1px solid var(--borde);border-radius:8px;background:var(--superficie)"><option value="MXN">Pesos (MXN)</option><option value="USD">Dólares (USD)</option></select></div>
        <div class="campo"><label for="ent-monto">Monto</label><input id="ent-monto" inputmode="decimal" placeholder="0.00"></div>
        <div class="campo"><label for="ent-motivo">Motivo</label><input id="ent-motivo" maxlength="120" placeholder="Ej. cambio de la tienda de junto"></div>
        <div class="campo"><label for="ent-clave">Clave del supervisor</label><input id="ent-clave" type="text" data-pin inputmode="numeric" autocomplete="off" style="width:140px"></div>
        ${casillaSola('ent-solo', 'Supervisor ausente: autorizo yo con mi clave (queda anotado)')}
        <button class="btn btn-primario" id="btn-entrada" type="submit">${ico('plus')}<span>Registrar entrada</span></button>
      </form><div id="msg-ent" class="mensaje" role="status" aria-live="polite"></div></section>
    <section class="panel" id="panel-gasto"><h2 style="margin-top:0">Gasto de caja</h2>
      <p class="nota">Pagos con efectivo del cajón, por ejemplo al barrendero o a un proveedor. Se imprime un <b>recibo que firma quien recibe</b> y el gasto se resta del efectivo esperado en el corte.${au.pide_clave ? ' Lo autoriza otra Vendedora-Cajera o un supervisor con su clave.' : ''}</p>
      <form id="form-gasto" autocomplete="off">
        <div class="campo"><label for="gs-monto">Importe</label><input id="gs-monto" inputmode="decimal" placeholder="0.00" style="width:140px"></div>
        <div class="campo"><label for="gs-concepto">Concepto</label><input id="gs-concepto" maxlength="80" placeholder="Ej. Pago de limpieza"></div>
        <div class="campo"><label for="gs-recibio">Nombre de quien recibe</label><input id="gs-recibio" maxlength="60" placeholder="Nombre y apellido"></div>
        ${au.pide_clave ? `<div class="campo" id="gs-quien-campo"><label for="gs-quien">Autoriza</label><select id="gs-quien" style="width:100%;padding:8px;border:1px solid var(--borde);border-radius:8px;background:var(--superficie)">${au.autorizadores.map((x) => `<option value="${esc(x.nombre)}">${esc(x.nombre)}${x.tipo === 'supervisor' ? ' (supervisor)' : ''}</option>`).join('')}</select></div>
        <div class="campo"><label for="gs-clave">Clave de quien autoriza</label><input id="gs-clave" type="text" data-pin inputmode="numeric" autocomplete="off" style="width:140px"></div>
        ${casillaSola('gs-solo', 'No hay nadie más para autorizar: autorizo yo con mi clave (queda anotado)')}` : ''}
        <button class="btn btn-primario" id="btn-gasto" type="submit">${ico('receipt')}<span>Registrar gasto e imprimir recibo</span></button>
      </form><div id="msg-gasto" class="mensaje" role="status" aria-live="polite"></div></section>
    <section class="panel"><h2 style="margin-top:0">Operaciones de hoy</h2><div class="tabla-cont"><table id="tabla-extraordinarias"><thead><tr><th>Hora</th><th>Operación</th><th class="num">Monto</th><th>Motivo</th><th>Autorizó</th></tr></thead><tbody>
      ${j.operaciones.map((o) => `<tr><td>${esc(fechaHora(o.ocurrio_en))}</td><td>${esc(NOM_EXTRA[o.tipo] ?? o.tipo)}${o.folio ? ` ${esc(o.folio)}` : ''}</td><td class="num">${o.moneda === 'USD' ? usd(o.monto) : mxn(o.monto)}</td><td>${esc(o.motivo || '—')}</td><td>${esc(o.autorizado_por || '—')}</td></tr>`).join('') || '<tr><td colspan="5" class="vacio">Sin operaciones extraordinarias hoy.</td></tr>'}</tbody></table></div></section>`;
  $('#ir-retiro').addEventListener('click', () => ir('retiro'));
  $('#gs-solo')?.addEventListener('change', (e) => { $('#gs-quien-campo').hidden = e.target.checked; });
  $('#form-gasto').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const m = $('#msg-gasto');
    const monto = parseMXN($('#gs-monto').value);
    const falla = (t, id) => { m.className = 'mensaje error'; m.textContent = t; const c = $(`#${id}`); if (c) { marcarCampoFalta(c); c.focus(); } };
    if (monto === null || monto <= 0) return falla('Escriba el importe del gasto (por ejemplo 150 o 150.00).', 'gs-monto');
    if ($('#gs-concepto').value.trim().length < 3) return falla('Escriba el concepto del gasto.', 'gs-concepto');
    if ($('#gs-recibio').value.trim().length < 2) return falla('Escriba el nombre de quien recibe el dinero.', 'gs-recibio');
    let autoriza;
    if (au.pide_clave) {
      if (!$('#gs-clave').value) return falla('Teclee la clave de quien autoriza.', 'gs-clave');
      autoriza = $('#gs-solo')?.checked ? { nombre: S.sesion.usuario, clave: $('#gs-clave').value, sin_segundo: true } : { nombre: $('#gs-quien').value, clave: $('#gs-clave').value };
    }
    try {
      const r = await api('/api/gasto', { ref: S.refGasto, monto, concepto: $('#gs-concepto').value, recibio: $('#gs-recibio').value, ...(autoriza ? { autoriza } : {}) });
      S.refGasto = null;
      await vistaExtraordinarias();
      const mm = $('#msg-gasto'); mm.className = r.impresion?.ok === false ? 'mensaje aviso' : 'mensaje ok';
      mm.textContent = r.impresion?.ok === false ? `Gasto ${r.gasto.folio_gasto} registrado, pero el recibo no se imprimió: ${r.impresion.error}` : `Gasto ${r.gasto.folio_gasto} registrado. Recibo impreso: que lo firme quien recibe.`;
    } catch (e) { m.className = 'mensaje error'; m.textContent = e.message; const c = $('#gs-clave'); if (c) c.value = ''; }
  });
  $('#form-entrada').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const m = $('#msg-ent');
    const monto = parseMXN($('#ent-monto').value);
    if (monto === null || monto <= 0) { m.className = 'mensaje error'; m.textContent = 'Escriba un monto válido (por ejemplo 500 o 500.00).'; return; }
    try { await api('/api/efectivo/entrada', { monto, moneda: $('#ent-moneda').value, motivo: $('#ent-motivo').value, clave: $('#ent-clave').value, ...($('#ent-solo')?.checked ? { sin_supervisor: true } : {}), ref: S.refEntrada }); S.refEntrada = null; await vistaExtraordinarias(); const mm = $('#msg-ent'); mm.className = 'mensaje ok'; mm.textContent = 'Entrada registrada.'; }
    catch (e) { m.className = 'mensaje error'; m.textContent = e.message; }
  });
}

// ── ventas de la caja ──
const METODOS_PAGO = { efectivo: 'Efectivo', efectivo_usd: 'Dólares', tarjeta: 'Tarjeta', tarjeta_regalo: 'Tarjeta de regalo', credito_cambio: 'Mercancía recibida a cambio' };
const etiquetaMetodo = (m) => METODOS_PAGO[m] ?? m;

/** Nombre, teléfono y motivo de la clienta: se piden al revertir una venta y al aceptar un cambio. */
function camposClienta(p, motivoEtiqueta) {
  const estilo = 'width:100%;box-sizing:border-box;padding:10px;border:2px solid var(--borde);border-radius:10px;background:var(--superficie);font:inherit';
  return `<div class="campo"><label for="${p}-nombre">Nombre de la clienta</label><input id="${p}-nombre" maxlength="80" autocomplete="off" style="${estilo}"></div>
    <div class="campo"><label for="${p}-telefono">Teléfono de la clienta</label><input id="${p}-telefono" type="tel" inputmode="tel" maxlength="30" autocomplete="off" style="${estilo}"></div>
    <div class="campo"><label for="${p}-motivo">${esc(motivoEtiqueta)}</label><textarea id="${p}-motivo" rows="2" maxlength="300" style="${estilo};resize:vertical"></textarea></div>`;
}
/** Lee y valida los campos de camposClienta; devuelve null (y marca el error en `m`) si falta algo. */
function leerCamposClienta(p, m) {
  const nombre = $(`#${p}-nombre`).value.trim(), telefono = $(`#${p}-telefono`).value.trim(), motivo = $(`#${p}-motivo`).value.trim();
  const falla = (t, id) => { m.className = 'mensaje error'; m.textContent = t; const c = $(`#${p}-${id}`); marcarCampoFalta(c); c.focus(); return null; };
  if (nombre.length < 2) return falla('Escriba el nombre de la clienta.', 'nombre');
  if (telefono.replace(/\D/g, '').length < 7) return falla('Escriba el teléfono de la clienta (al menos 7 dígitos).', 'telefono');
  if (motivo.length < 3) return falla('Escriba el motivo.', 'motivo');
  return { clienta: { nombre, telefono }, motivo };
}
/** Pregunta nombre, teléfono y motivo del cambio. Resuelve con los datos, o null si se cancela. */
function pedirDatosCambio() {
  return new Promise((resolver) => {
    const d = dialogo('dlg-datos-cambio');
    d.setAttribute('aria-labelledby', 'dc-titulo');
    d.innerHTML = `<h2 id="dc-titulo" style="margin-top:0">Datos del cambio</h2>
      <p class="nota" style="margin-top:0">Quedan registrados junto con el cambio.</p>
      <form id="form-datos-cambio" autocomplete="off">${camposClienta('dc', 'Motivo del cambio')}
        <div id="msg-dc" class="mensaje" role="alert"></div>
        <div class="filas"><button class="btn" type="button" id="dc-no">Cancelar</button><button class="btn btn-primario" type="submit" style="width:auto;flex:1">${ico('check')}<span>Aceptar cambio</span></button></div></form>`;
    let listo = false;
    d.addEventListener('close', () => { if (!listo) resolver(null); }, { once: true });
    $('#dc-no').addEventListener('click', () => d.close());
    $('#form-datos-cambio').addEventListener('submit', (ev) => {
      ev.preventDefault();
      const datos = leerCamposClienta('dc', $('#msg-dc'));
      if (!datos) return;
      listo = true; d.close(); resolver(datos);
    });
    d.showModal();
    $('#dc-nombre').focus();
  });
}

/** «Revertir venta»: cancela la venta ya cobrada. Pide los datos de la clienta, el motivo y la clave de otra persona. */
async function abrirRevertirVenta(det, alTerminar) {
  const a = await api('/api/venta/autorizadores');
  const d = dialogo('dlg-revertir');
  d.setAttribute('aria-labelledby', 'rv-titulo');
  d.innerHTML = `<h2 id="rv-titulo" style="margin-top:0">Revertir venta</h2>
    <p id="rv-texto" style="margin-top:0">Folio <b>${String(det.folio).padStart(6, '0')}</b> · <b>${mxn(det.total)}</b>. Se cancela la venta completa, las prendas regresan al inventario y el dinero se regresa a la clienta.</p>
    <form id="form-revertir" autocomplete="off">${camposClienta('rv', 'Motivo de la cancelación')}
      ${a.pide_clave ? `<p class="nota">La cancelación la autoriza otra Vendedora-Cajera o un supervisor con su clave.</p>
      <div class="campo"><label for="rv-quien">Autoriza</label><select id="rv-quien" style="width:100%;padding:10px;border:2px solid var(--borde);border-radius:10px;background:var(--superficie)">${a.autorizadores.map((x) => `<option value="${esc(x.nombre)}">${esc(x.nombre)}${x.tipo === 'supervisor' ? ' (supervisor)' : ''}</option>`).join('')}</select></div>
      <div class="campo"><label for="rv-clave">Clave de quien autoriza</label><input id="rv-clave" type="text" data-pin inputmode="numeric" autocomplete="off" placeholder="••••"></div>
      ${casillaSola('rv-solo', 'No hay nadie más para autorizar: autorizo yo con mi clave (queda anotado)')}` : ''}
      <div id="msg-rv" class="mensaje" role="alert"></div>
      <div class="filas"><button class="btn" type="button" id="rv-no">No revertir</button><button class="btn btn-peligro" type="submit" id="rv-ok" style="width:auto;flex:1">${ico('undo')}<span>Revertir venta</span></button></div>
    </form>`;
  $('#rv-no').addEventListener('click', () => d.close());
  $('#rv-solo')?.addEventListener('change', (e) => { $('#rv-quien').closest('.campo').hidden = e.target.checked; });
  $('#form-revertir').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const m = $('#msg-rv');
    const datos = leerCamposClienta('rv', m);
    if (!datos) return;
    const rvSolo = a.pide_clave && $('#rv-solo')?.checked;
    if (a.pide_clave && ((!rvSolo && !$('#rv-quien').value) || !$('#rv-clave').value)) { m.className = 'mensaje error'; m.textContent = 'Elija quién autoriza y teclee su clave.'; return; }
    try {
      const r = await api('/api/venta/cancelar', { sale_id: det.sale_id, motivo: datos.motivo, clienta: datos.clienta, ...(a.pide_clave ? { autoriza: rvSolo ? { nombre: S.sesion.usuario, clave: $('#rv-clave').value, sin_segundo: true } : { nombre: $('#rv-quien').value, clave: $('#rv-clave').value } } : {}) });
      d.close();
      if (alTerminar) await alTerminar(r);
    } catch (e) { m.className = 'mensaje error'; m.textContent = e.message; const c = $('#rv-clave'); if (c) c.value = ''; }
  });
  d.showModal();
  $('#rv-nombre').focus();
}

/**
 * Ventana de detalle de una venta (hora, cajera, prendas, pagos y lo que le pasó después).
 * `acciones` = true en la caja (Revertir venta y Aceptar cambio); en Administración solo se consulta: esas dos acciones se hacen en la caja donde se vendió.
 */
async function abrirDetalleVenta(saleId, { acciones, ruta, alCambiar } = {}) {
  const j = await api(ruta ?? `/api/venta/detalle?sale_id=${encodeURIComponent(saleId)}`);
  const v = j.detalle;
  const d = dialogo('dlg-detalle-venta');
  d.setAttribute('aria-labelledby', 'dv-titulo');
  if (v.historica) {
    const h = v.historica;
    const TIPO = { venta: 'Venta', cambio: 'Cambio sin diferencia', fee: 'Cargo por daño' };
    d.innerHTML = `<h2 id="dv-titulo" style="margin:0 0 4px">Venta del POS anterior · folio ${esc(String(v.folio))}</h2>
      <p id="dv-resumen" style="margin:0 0 8px"><span class="insignia">POS anterior</span> · ${esc(v.tienda)} · Caja ${v.caja} · <b>${esc(v.fecha_local.split('-').reverse().join('/'))}</b></p>
      <dl class="resumen" id="dv-datos" style="margin:0 0 8px"><dt>Tipo de ticket</dt><dd>${esc(TIPO[h.tipo] ?? h.tipo)}</dd><dt>Total</dt><dd><b>${mxn(v.total)}</b></dd><dt>Piezas</dt><dd>${h.piezas}</dd><dt>Forma de pago</dt><dd>${esc(({ efectivo: 'Efectivo', tarjeta: 'Tarjeta', mixto: 'Mixto', sin_pago: 'Sin pago (cambio)' })[h.pago] ?? h.pago)}</dd></dl>
      <div class="mensaje aviso" id="dv-historica">Esta venta se hizo con el POS anterior: aquí solo se conserva lo que traía el reporte (folio, fecha, total, piezas y forma de pago). No tiene prendas, vendedora ni ticket. Úsela para cotejar un cambio o una devolución; la operación se hace como una venta nueva.</div>
      <div class="filas"><button class="btn" type="button" id="dv-cerrar">Cerrar</button></div>`;
    $('#dv-cerrar').addEventListener('click', () => d.close());
    if (!d.open) d.showModal();
    return;
  }
  const folio = v.codigo_ticket ?? String(v.folio).padStart(6, '0');
  const cli = (c) => (c ? `${esc(c.nombre)} · ${esc(c.telefono)}` : '—');
  const lineas = v.lineas.map((l) => `<tr><td data-label="Cant.">${l.qty}</td><td class="desc" data-label="Prenda">${esc(l.descripcion)}${l.marca ? ` · ${esc(l.marca)}` : ''}${l.estilo ? ` · ${esc(l.estilo)}` : ''}${l.item_no ? ` · #${esc(l.item_no)}` : ''}${l.devuelto ? ` <small>(${l.devuelto} ya devuelta${l.devuelto === 1 ? '' : 's'})</small>` : ''}</td><td class="num" data-label="Precio">${mxn(l.precio_unit)}</td><td class="num" data-label="Importe">${mxn(l.importe)}</td></tr>`).join('');
  const pagos = v.pagos.map((p) => `${esc(etiquetaMetodo(p.metodo))} ${mxn(p.monto)}`).join(' · ') || '—';
  const canc = v.cancelacion
    ? `<div class="mensaje error" id="dv-cancelada" role="status"><b>Venta cancelada</b> el ${esc(fechaHora(v.cancelacion.ocurrio_en))} por ${esc(v.cancelacion.cancelo)}${v.cancelacion.autorizado_por ? `, autorizó ${esc(v.cancelacion.autorizado_por)}` : ''}.<br>Motivo: ${esc(v.cancelacion.motivo)}<br>Clienta: ${cli(v.cancelacion.clienta)}</div>`
    : '';
  const devs = v.devoluciones.length
    ? `<h3 style="margin:10px 0 4px">Cambios y devoluciones</h3><ul id="dv-devoluciones" style="margin:0;padding-left:18px">${v.devoluciones.map((x) => `<li>${esc(fechaHora(x.ocurrio_en))} · ${x.piezas} pieza${x.piezas === 1 ? '' : 's'} · ${x.por_cambio ? 'cambio' : 'devolución'} · ${mxn(x.importe)} · ${esc(x.motivo)} · ${cli(x.clienta)}</li>`).join('')}</ul>`
    : '';
  d.innerHTML = `<h2 id="dv-titulo" style="margin:0 0 4px">Venta ${folio}</h2>
    <p id="dv-resumen" style="margin:0 0 8px"><span class="insignia ${esc(v.estado)}">${esc(v.estado)}</span> · ${esc(v.tienda)} · Caja ${v.caja} · <b>${esc(v.fecha_local.split('-').reverse().join('/'))} ${esc(v.hora)}</b></p>
    <dl class="resumen" id="dv-datos" style="margin:0 0 8px"><dt>Vendedora-Cajera</dt><dd>${esc(v.cajero)}</dd><dt>Venta por</dt><dd>${esc(v.vendedora || '—')}</dd><dt>Forma de pago</dt><dd>${pagos}</dd></dl>
    ${canc}
    <div class="tabla-cont"><table id="dv-lineas"><thead><tr><th class="num">Cant.</th><th>Prenda</th><th class="num">Precio</th><th class="num">Importe</th></tr></thead><tbody>${lineas}</tbody><tfoot><tr><th colspan="3" style="text-align:right">Total</th><td class="num"><b>${mxn(v.total)}</b></td></tr></tfoot></table></div>
    ${devs}
    <details style="margin-top:8px"><summary>Ver el ticket</summary>${logoTicketHtml()}<pre class="ticket" id="dv-ticket" tabindex="0">${esc(j.ticket_texto)}</pre></details>
    <div id="dv-msg" class="mensaje" role="status" aria-live="polite"></div>
    <div class="filas">
      <button class="btn" type="button" id="dv-cerrar">${ico('x')}<span>Cerrar</span></button>
      ${acciones && v.con_piezas_disponibles ? `<button class="btn" type="button" id="dv-cambio" title="La clienta regresa piezas de esta venta y se lleva otras">${ico('undo')}<span>Aceptar cambio</span></button>` : ''}
      ${acciones && v.cancelable ? `<button class="btn btn-peligro" type="button" id="dv-revertir">${ico('trash')}<span>Revertir venta</span></button>` : ''}
    </div>
    ${!acciones ? '<p class="nota" style="margin-bottom:0">Para revertir la venta o hacer un cambio, hágalo en la caja donde se vendió.</p>' : ''}`;
  $('#dv-cerrar').addEventListener('click', () => d.close());
  if ($('#dv-cambio')) $('#dv-cambio').addEventListener('click', async () => { d.close(); S.buscarFolio = String(v.folio); await ir('devolucion'); });
  if ($('#dv-revertir')) $('#dv-revertir').addEventListener('click', async () => {
    try { await abrirRevertirVenta(v, async (r) => { d.close(); if (alCambiar) await alCambiar(r); }); }
    catch (e) { const m = $('#dv-msg'); m.className = 'mensaje error'; m.textContent = e.message; }
  });
  if (!d.open) d.showModal();
}

/** Primer día que la caja todavía consulta (2 meses atrás); lo anterior solo se ve en Administración. */
const minHistorialCaja = () => new Date(Date.parse(S.estado.fecha_local + 'T12:00:00Z') - 60 * 86400e3).toISOString().slice(0, 10);

async function vistaVentas() {
  const hoy = S.estado.fecha_local;
  const fecha = S.fechaHistorial ?? hoy;
  const j = await api(`/api/ventas?fecha=${encodeURIComponent(fecha)}`);
  const folioBuscado = (S.folioHistorial ?? '').trim();
  // El folio se busca como lo imprime el ticket (D2-000003) o suelto (3). Si es de otra caja, se avisa en cuál se hizo.
  const pf = folioBuscado ? interpretarFolioUI(folioBuscado) : null;
  const mismaCaja = (r) => !pf || (r.folio === pf.folio && (pf.caja === undefined || (r.caja === pf.caja && (!pf.letra || pf.letra === letraTienda(r.tienda)))));
  const filas = folioBuscado ? (pf ? j.ventas.filter(mismaCaja) : []) : j.ventas;
  let avisoFolio = '';
  let anteriores = [];
  if (folioBuscado && !pf) avisoFolio = 'El folio no es válido: escriba el número o el código del ticket (por ejemplo D2-000003).';
  else if (pf) {
    try {
      const o = await api(`/api/ventas/buscar?folio=${encodeURIComponent(folioBuscado)}`);
      const ajenas = o.resultados.filter((v) => !v.propia);
      if (o.aviso) avisoFolio = o.aviso;
      else if (ajenas.length) avisoFolio = `${ajenas.length === 1 ? 'Esa venta es' : 'Esas ventas son'} de la ${[...new Set(ajenas.map((v) => `Caja ${v.caja} (${v.codigo_ticket})`))].join(' y de la ')}. Realice la operación en ${ajenas.length === 1 ? 'esa caja' : 'esas cajas'}.`;
    } catch { /* sin conexión con el hub: solo se ve esta caja */ }
  }
  if (pf && pf.caja === undefined) { try { anteriores = (await api(`/api/ventas/anteriores?folio=${encodeURIComponent(folioBuscado)}`)).ventas; } catch { /* sin datos del POS anterior */ } }
  $('#vista').innerHTML = `<div class="titulo-vista">${ico('clock')}<h1>Historial de mi caja</h1></div><div id="mensaje-hist" class="mensaje" role="status" aria-live="polite"></div>
    <form id="form-historial" class="filtros panel" autocomplete="off"><label>Fecha <input type="date" id="hist-fecha" value="${esc(fecha)}" min="${minHistorialCaja()}" max="${esc(hoy)}"></label>
      <label>Folio <input id="hist-folio" placeholder="D2-000003" value="${esc(folioBuscado)}" style="width:130px;padding:6px;border:1px solid var(--borde);border-radius:6px;background:var(--superficie)"></label>
      <button class="btn btn-primario" type="submit" style="width:auto">${ico('search')}<span>Buscar</span></button></form>
    ${avisoFolio ? `<div class="mensaje aviso" id="aviso-folio" role="status">${esc(avisoFolio)}</div>` : ''}
    ${anteriores.map((a) => `<div class="mensaje aviso" data-pos-anterior="${esc(a.hist_id)}"><b>POS anterior</b> · folio ${a.folio} (Caja ${a.caja_hist}) · ${esc(a.fecha)} · ${a.tipo_hist === 'cambio' ? 'cambio' : a.tipo_hist === 'fee' ? 'cargo' : 'venta'} · ${a.piezas} pza. · ${mxn(a.total)} · ${({ efectivo: 'Efectivo', tarjeta: 'Tarjeta', mixto: 'Mixto', sin_pago: 'Sin pago' })[a.pago] ?? esc(a.pago)}. Solo consulta: no se puede revertir ni cambiar desde aquí.</div>`).join('')}
    <div class="panel"><p class="nota" style="margin-top:0">Toque una venta para ver el detalle: hora, cajera, prendas y pagos. Desde ahí se puede revertir o hacer un cambio. La caja consulta <b>un día a la vez</b> y solo los <b>últimos 2 meses</b>; lo anterior se consulta en Administración.</p><div class="tabla-cont"><table id="tabla-ventas"><thead><tr><th>Folio</th><th>Fecha</th><th>Vendedora-Cajera</th><th>Venta por</th><th class="num">Total</th><th>Estado</th><th>Impresiones</th><th></th></tr></thead><tbody>
    ${filas.length ? filas.map((r) => `<tr data-folio="${r.folio}" data-detalle="${r.sale_id}" tabindex="0" style="cursor:pointer"><td>${esc(r.codigo_ticket ?? String(r.folio).padStart(6, '0'))}</td><td>${esc(r.fecha_local)}</td><td>${esc(r.cajero)}</td><td data-col="vendio">${esc(r.vendedora || '—')}</td><td class="num">${mxn(r.total)}</td><td><span class="insignia ${r.estado}">${esc(r.estado)}</span></td><td>${r.impresiones}${r.ultima_impresion === 'error' ? ' (última falló)' : ''}</td><td><button class="btn" type="button" data-ver="${r.sale_id}">${ico('receipt')}<span>Ver ticket</span></button>${r.estado === 'confirmada' ? ` <button class="btn" type="button" data-cambio="${r.folio}" title="La clienta regresa piezas de esta venta y se lleva otras">${ico('undo')}<span>Aceptar cambio</span></button> <button class="btn btn-peligro" type="button" data-revertir="${r.sale_id}" title="Cancela la venta completa">${ico('trash')}<span>Revertir venta</span></button>` : ''}</td></tr>`).join('') : `<tr><td colspan="8" class="vacio">${folioBuscado ? 'No hay una venta con ese folio.' : fecha === hoy ? 'Sin ventas hoy en esta caja.' : 'Sin ventas ese día en esta caja.'}</td></tr>`}
    </tbody></table></div></div>`;
  const recargar = async (r) => {
    await vistaVentas();
    if (!r || !r.venta) return;
    const m = $('#mensaje-hist');
    const fallas = [r.impresion, r.impresion_firma].filter((x) => x && !x.ok);
    m.className = fallas.length ? 'mensaje aviso' : 'mensaje ok';
    m.textContent = `Venta ${r.venta.codigo_ticket ?? String(r.venta.folio).padStart(6, '0')} revertida. ${fallas.length ? `La impresora falló: ${fallas[0].error}. La cancelación SÍ quedó guardada; reimprima el ticket cuando se pueda.` : 'Se imprimieron el ticket de VENTA CANCELADA de la clienta y el comprobante que ella firma.'}`;
  };
  $('#form-historial').addEventListener('submit', async (ev) => { ev.preventDefault(); S.fechaHistorial = $('#hist-fecha').value || hoy; S.folioHistorial = $('#hist-folio').value; await recargar(); });
  const mostrarError = (e) => { const m = $('#mensaje-hist'); m.className = 'mensaje error'; m.textContent = e.message; };
  for (const b of $('#vista').querySelectorAll('[data-cambio]')) b.addEventListener('click', async (ev) => { ev.stopPropagation(); S.buscarFolio = b.dataset.cambio; await ir('devolucion'); });
  for (const fila of $('#vista').querySelectorAll('tr[data-detalle]')) {
    const abrir = () => abrirDetalleVenta(fila.dataset.detalle, { acciones: true, alCambiar: recargar }).catch(mostrarError);
    fila.addEventListener('click', abrir);
    fila.addEventListener('keydown', (ev) => { if (ev.target === fila && (ev.key === 'Enter' || ev.key === ' ')) { ev.preventDefault(); abrir(); } });
  }
  for (const b of $('#vista').querySelectorAll('[data-revertir]')) {
    b.addEventListener('click', async (ev) => {
      ev.stopPropagation();
      try { const r = await api(`/api/venta/detalle?sale_id=${encodeURIComponent(b.dataset.revertir)}`); await abrirRevertirVenta(r.detalle, recargar); } catch (e) { mostrarError(e); }
    });
  }
  for (const b of $('#vista').querySelectorAll('[data-ver]')) {
    b.addEventListener('click', async (ev) => {
      ev.stopPropagation();
      const t = await api(`/api/ticket?sale_id=${b.dataset.ver}`);
      const dlg = $('#dlg-ticket');
      dlg.innerHTML = `<h2 id="dlg-titulo" style="margin:0">Ticket</h2>${logoTicketHtml()}<pre class="ticket" id="ticket-texto">${esc(t.ticket_texto)}</pre><div class="filas"><button class="btn" id="btn-reimprimir" type="button">${ico('printer')}<span>Reimprimir</span></button><button class="btn" id="btn-ticket-regalo" type="button">${ico('gift')}<span>Ticket de regalo</span></button><button class="btn" id="btn-cerrar" type="button">${ico('x')}<span>Cerrar</span></button></div><div id="estado-impresion" class="mensaje" role="status"></div>`;
      dlg.showModal();
      $('#btn-cerrar').addEventListener('click', () => dlg.close());
      $('#btn-ticket-regalo').addEventListener('click', () => abrirTicketRegalo(b.dataset.ver));
      $('#btn-reimprimir').addEventListener('click', async () => {
        const x = await api('/api/venta/reimprimir', { sale_id: b.dataset.ver });
        $('#ticket-texto').textContent = x.ticket_texto;
        const e = $('#estado-impresion'); e.className = `mensaje ${x.impresion.ok ? 'ok' : 'error'}`; e.textContent = x.impresion.ok ? 'Reimpreso.' : `Falló: ${x.impresion.error}`;
      });
    });
  }
}

/** Retiros de efectivo de las cajas (los del módulo Retiro): quién, cuándo y cuánto salió, en pesos y dólares. */
function panelRetiros(retiros) {
  const lista = retiros ?? [];
  const total = lista.reduce((a, r) => a + r.equivalente_mxn, 0);
  return `<div class="panel" id="panel-retiros"><h2 style="margin-top:0">Retiros de efectivo</h2>
    <p class="nota" style="margin-top:0">Dinero que salió de las cajas en el periodo. No son ventas: no restan a las ventas netas, pero sí al efectivo de la caja.</p>
    <div class="tabla-cont"><table id="tabla-retiros"><thead><tr><th>Caja</th><th>Retiro</th><th>Fecha</th><th>Hora</th><th>Lo retiró</th><th class="num">Pesos</th><th class="num">Dólares</th><th class="num">Total en pesos</th></tr></thead><tbody>
    ${lista.map((r) => `<tr data-retiro="${esc(r.retiro_id)}"><td>${esc(r.tienda)} · ${r.caja}</td><td>${esc(r.folio_retiro)}</td><td>${esc(r.fecha_local.split('-').reverse().join('/'))}</td><td>${esc(r.hora)}</td><td>${esc(r.usuario)}</td><td class="num">${mxn(r.pesos)}</td><td class="num">${r.dolares ? usd(r.dolares) : '—'}</td><td class="num"><b>${mxn(r.equivalente_mxn)}</b></td></tr>`).join('') || '<tr><td colspan="8" class="vacio">Sin retiros en el periodo.</td></tr>'}
    </tbody>${lista.length ? `<tfoot><tr><th colspan="7">Total retirado (${lista.length})</th><td class="num"><b id="total-retiros">${mxn(total)}</b></td></tr></tfoot>` : ''}</table></div></div>`;
}
/** Gastos de caja: pagos con efectivo del cajón, con el nombre de quien recibió el dinero y quién lo autorizó. */
function panelGastos(gastos) {
  const lista = gastos ?? [];
  const total = lista.reduce((a, r) => a + r.monto, 0);
  return `<div class="panel" id="panel-gastos"><h2 style="margin-top:0">Gastos de caja</h2>
    <p class="nota" style="margin-top:0">Pagos con efectivo del cajón (limpieza, proveedores…). Cada uno tiene su recibo firmado.</p>
    <div class="tabla-cont"><table id="tabla-gastos"><thead><tr><th>Caja</th><th>Recibo</th><th>Fecha</th><th>Hora</th><th>Concepto</th><th>Recibió</th><th>Entregó</th><th>Autorizó</th><th class="num">Importe</th></tr></thead><tbody>
    ${lista.map((r) => `<tr data-gasto="${esc(r.gasto_id)}"><td>${esc(r.tienda)} · ${r.caja}</td><td>${esc(r.folio_gasto)}</td><td>${esc(r.fecha_local.split('-').reverse().join('/'))}</td><td>${esc(r.hora)}</td><td>${esc(r.concepto)}</td><td>${esc(r.recibio)}</td><td>${esc(r.usuario)}</td><td>${esc(r.autorizado_por ?? '—')}</td><td class="num"><b>${mxn(r.monto)}</b></td></tr>`).join('') || '<tr><td colspan="9" class="vacio">Sin gastos en el periodo.</td></tr>'}
    </tbody>${lista.length ? `<tfoot><tr><th colspan="8">Total de gastos (${lista.length})</th><td class="num"><b id="total-gastos">${mxn(total)}</b></td></tr></tfoot>` : ''}</table></div></div>`;
}

// ── Historial de ventas en Administración: todas las tiendas y cajas, con el mismo detalle (solo consulta) ──
async function vistaHistorialAdmin() {
  const { cajas } = await api('/api/admin/cajas');
  const hoy = new Date(Date.now() - 7 * 3600e3).toISOString().slice(0, 10);
  const H = (S.historialAdmin ??= { desde: hoy, hasta: hoy, caja: '', folio: '', origen: '' });
  cuerpoVista().innerHTML = `<div class="titulo-vista">${ico('clock')}<h1>Historial de ventas</h1></div>
    <form class="filtros panel" id="ha-filtros" autocomplete="off">
      <label>Desde <input type="date" id="ha-desde" value="${esc(H.desde)}"></label><label>Hasta <input type="date" id="ha-hasta" value="${esc(H.hasta)}"></label>
      <label>Caja <select id="ha-caja" style="width:105px;padding:8px;border:2px solid var(--borde);border-radius:10px;background:var(--superficie)"><option value="">Todas</option>${cajas.map((c) => `<option value="${esc(c.tienda)}/${c.caja}" ${H.caja === `${c.tienda}/${c.caja}` ? 'selected' : ''}>${esc(c.tienda)} · Caja ${c.caja}</option>`).join('')}</select></label>
      <label>Origen <select id="ha-origen" style="width:95px;padding:8px;border:2px solid var(--borde);border-radius:10px;background:var(--superficie)"><option value="">Todos</option><option value="nuevo" ${H.origen === 'nuevo' ? 'selected' : ''}>POS nuevo</option><option value="anterior" ${H.origen === 'anterior' ? 'selected' : ''}>POS anterior</option></select></label>
      <label>Folio <input id="ha-folio" placeholder="D2-000003" value="${esc(H.folio)}" style="width:95px;padding:6px;border:1px solid var(--borde);border-radius:6px;background:var(--superficie)"></label>
      <button class="btn btn-primario" type="submit" style="width:auto">${ico('search')}<span>Consultar</span></button>
      <div id="ha-msg" class="mensaje" role="status" aria-live="polite"></div></form>
    <div id="ha-resultado"></div>`;
  const consultar = async () => {
    H.desde = $('#ha-desde').value; H.hasta = $('#ha-hasta').value; H.caja = $('#ha-caja').value; H.origen = $('#ha-origen').value; H.folio = $('#ha-folio').value.trim();
    const m = $('#ha-msg'); m.className = 'mensaje'; m.textContent = '';
    const p = new URLSearchParams({ desde: H.desde, hasta: H.hasta });
    if (H.caja) p.set('cajas', H.caja);
    if (H.folio) p.set('folio', H.folio);
    if (H.origen) p.set('origen', H.origen);
    let j;
    try { j = await api(`/api/admin/ventas?${p}`); } catch (e) { m.className = 'mensaje error'; m.textContent = e.message; return; }
    if (j.truncado) { m.className = 'mensaje aviso'; m.textContent = `Hay ${j.total_filas} ventas; se muestran las 500 más recientes. Acote las fechas.`; }
    $('#ha-resultado').innerHTML = `<div class="panel"><p class="nota" style="margin-top:0">Toque una venta para ver el detalle y el ticket.</p><div class="tabla-cont"><table id="tabla-historial-admin" class="solo-escritorio"><thead><tr><th>Caja</th><th>Folio</th><th>Fecha</th><th>Hora</th><th>Vendedora-Cajera</th><th>Venta por</th><th>Pago</th><th class="num">Total</th><th>Estado</th></tr></thead><tbody>
      ${j.ventas.length ? j.ventas.map((r) => `<tr data-detalle="${esc(r.sale_id)}" tabindex="0" style="cursor:pointer"><td>${esc(r.tienda)} · ${r.caja}</td><td>${r.historico ? `${esc(String(r.folio))} <span class="insignia" title="Venta importada del POS anterior: solo se conserva folio, fecha, total, piezas y forma de pago">POS anterior</span>` : esc(r.codigo_ticket)}</td><td>${esc(r.fecha_local.split('-').reverse().join('/'))}</td><td>${esc(r.hora || '—')}</td><td>${esc(r.cajero)}</td><td data-col="vendio">${esc(r.vendedora || '—')}</td><td>${esc(r.pago)}</td><td class="num">${mxn(r.total)}</td><td><span class="insignia ${esc(r.estado)}">${esc(r.estado)}</span></td></tr>`).join('') : '<tr><td colspan="9" class="vacio">No hay ventas con esos datos.</td></tr>'}
      </tbody></table>
      <div class="lista-inv solo-movil" id="lista-historial-admin" role="list">${j.ventas.map((r) => `<button type="button" class="fila-inv" role="listitem" data-detalle="${esc(r.sale_id)}"><span class="fi-linea"><b class="fi-desc">${r.historico ? `${esc(String(r.folio))} · POS anterior` : `${esc(r.codigo_ticket)} · ${esc(r.hora)}`}</b><span class="fi-precio">${mxn(r.total)}</span></span><span class="fi-quien">${esc(r.tienda)} · Caja ${r.caja} · ${esc(r.vendedora || r.cajero)}</span><span class="fi-sub"><span>${esc(r.fecha_local.split('-').reverse().join('/'))}</span><span>${esc(r.pago)}</span><span class="insignia ${esc(r.estado)}">${esc(r.estado)}</span></span></button>`).join('') || '<p class="vacio">No hay ventas con esos datos.</p>'}</div></div></div>${panelRetiros(j.retiros)}${panelGastos(j.gastos)}`;
    for (const fila of $('#ha-resultado').querySelectorAll('[data-detalle]')) {
      const abrir = () => abrirDetalleVenta(fila.dataset.detalle, { acciones: false, ruta: `/api/admin/venta?sale_id=${encodeURIComponent(fila.dataset.detalle)}` }).catch((e) => { m.className = 'mensaje error'; m.textContent = e.message; });
      fila.addEventListener('click', abrir);
      fila.addEventListener('keydown', (ev) => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); abrir(); } });
    }
  };
  $('#ha-filtros').addEventListener('submit', (ev) => { ev.preventDefault(); consultar(); });
  await consultar();
}

// ── Administración ──
// ── Importar las ventas del POS anterior (reporte «Sales Detail»): vista previa y confirmación ──
async function abrirImportarHistoricas(cajas, alTerminar) {
  const d = dialogo('dlg-hist');
  d.setAttribute('aria-labelledby', 'hist-titulo');
  const opcionesCaja = cajas.map((c) => `<option value="${esc(c.tienda)}/${c.caja}">${esc(c.tienda)} · Caja ${c.caja}</option>`).join('');
  let hoja = null, nombre = '';
  const nTxt = (n) => Number(n).toLocaleString('es-MX');
  d.innerHTML = `<h2 id="hist-titulo" style="margin-top:0">Importar ventas del POS anterior</h2>
    <p class="nota" style="margin-top:0">Sube el reporte de ventas («Sales Detail», un renglón por ticket). Se guardan con su folio y fecha originales, solo para reportes y contabilidad: no cambian existencias, cortes ni los folios de la caja nueva. Si lo importas dos veces no se duplica nada.</p>
    <div class="campo"><label for="hist-caja">¿De qué caja son?</label><select id="hist-caja" style="width:100%;padding:10px;border:2px solid var(--borde);border-radius:10px;background:var(--superficie)">${opcionesCaja}</select></div>
    <div class="campo"><label for="hist-archivo">Archivo de Excel (.xlsx)</label><input id="hist-archivo" type="file" accept=".xlsx"></div>
    <div id="hist-msg" class="mensaje" role="status" aria-live="polite"></div>
    <div id="hist-previa"></div>
    <label style="display:flex;gap:8px;align-items:flex-start;margin:8px 0"><input type="checkbox" id="hist-folios" checked style="margin-top:4px"><span>Que los tickets nuevos de esta caja <b>continúen después del último folio</b> importado (así no se repiten números del sistema anterior). Solo sube el contador; nunca lo baja.</span></label>
    <div class="filas"><button class="btn" type="button" id="hist-cerrar">Cerrar</button><button class="btn btn-primario" type="button" id="hist-confirmar" style="width:auto;flex:1" disabled>${ico('check')}<span>Importar</span></button></div>`;
  d.showModal();
  const msg = (t, tipo = '') => { const m = $('#hist-msg'); m.className = `mensaje ${tipo}`; m.textContent = t; };
  const caja = () => { const [tienda, n] = $('#hist-caja').value.split('/'); return { tienda, caja: Number(n) }; };
  $('#hist-cerrar').addEventListener('click', () => d.close());
  async function previa() {
    if (!hoja) return;
    try {
      const r = await api('/api/admin/ventas-historicas/revisar', { filas: hoja, ...caja() });
      const x = r.revision, s = x.resumen;
      const lineas = [['Tickets', nTxt(s.tickets)], ['Folios', s.folio_inicial ? `${s.folio_inicial} al ${s.folio_final}` : '—'], ['Fechas', s.desde ? `${s.desde} al ${s.hasta} (${s.dias_con_ventas} días con ventas)` : '—'], ['Piezas', nTxt(s.piezas)], ['Total', mxn(s.total)],
        ['Ventas', `${s.por_tipo.venta.tickets} · ${mxn(s.por_tipo.venta.total)}`], ['Cambios ($0)', `${s.por_tipo.cambio.tickets}`], ['Fees por daño', `${s.por_tipo.fee.tickets} · ${mxn(s.por_tipo.fee.total)}`],
        ['Efectivo', `${s.por_pago.efectivo.tickets} · ${mxn(s.por_pago.efectivo.total)}`], ['Tarjeta', `${s.por_pago.tarjeta.tickets} · ${mxn(s.por_pago.tarjeta.total)}`], ['Mixto (sin desglose)', `${s.por_pago.mixto.tickets} · ${mxn(s.por_pago.mixto.total)}`]];
      $('#hist-previa').innerHTML = `${x.errores.length ? `<div class="mensaje error">${x.errores.map(esc).join('<br>')}</div>` : ''}${x.avisos.length ? `<div class="mensaje aviso">${x.avisos.map(esc).join('<br>')}</div>` : ''}
        <table id="hist-resumen"><tbody>${lineas.map(([k, v]) => `<tr><th scope="row">${esc(k)}</th><td class="num">${esc(v)}</td></tr>`).join('')}</tbody></table>
        ${r.ya_importadas ? `<p class="nota"><b>${r.ya_importadas}</b> de estos tickets ya estaban importados: no se duplican. Se agregarán <b>${r.nuevas}</b>.</p>` : ''}
        ${x.para_revisar.length ? `<h3 style="margin-bottom:4px">Para revisar (${x.para_revisar.length})</h3><table id="hist-revisar"><thead><tr><th>Folio</th><th>Fecha</th><th>Cómo se guardará</th><th class="num">Piezas</th><th class="num">Total</th></tr></thead><tbody>${x.para_revisar.map((t) => `<tr><td>${t.folio}</td><td>${esc(t.fecha)}</td><td>${esc(t.nota)}</td><td class="num">${t.piezas}</td><td class="num">${mxn(t.total)}</td></tr>`).join('')}</tbody></table>` : ''}`;
      $('#hist-confirmar').disabled = x.errores.length > 0 || r.nuevas === 0;
      if (!x.errores.length) msg(r.nuevas ? 'Revisa el resumen y confirma.' : 'Todos estos tickets ya estaban importados.', r.nuevas ? '' : 'ok');
    } catch (e) { $('#hist-previa').innerHTML = ''; $('#hist-confirmar').disabled = true; msg(e.message, 'error'); }
  }
  $('#hist-caja').addEventListener('change', previa);
  $('#hist-archivo').addEventListener('change', async () => {
    const f = $('#hist-archivo').files[0];
    $('#hist-previa').innerHTML = ''; $('#hist-confirmar').disabled = true; hoja = null;
    if (!f) return;
    msg('Leyendo el archivo…');
    try {
      const hojas = await leerArchivoAlta(f);
      nombre = f.name;
      hoja = (hojas.find((h) => (h.filas ?? []).slice(0, 40).some((r) => (r ?? []).some((c) => /^receipt #?$/i.test(String(c ?? '').trim()) || /^folio$/i.test(String(c ?? '').trim())))) ?? hojas[0])?.filas ?? null;
    } catch (e) { msg(`No se pudo leer el archivo: ${e.message}`, 'error'); return; }
    await previa();
  });
  $('#hist-confirmar').addEventListener('click', async () => {
    $('#hist-confirmar').disabled = true;
    try {
      const r = await api('/api/admin/ventas-historicas/importar', { filas: hoja, ...caja(), nombre, continuar_folios: $('#hist-folios').checked });
      msg(`Listo: ${r.nuevas} ticket(s) importados${r.existentes ? `, ${r.existentes} ya existían` : ''}. Total ${mxn(r.resumen.total)}.${r.siguiente_folio > 1 ? ` Los tickets nuevos de esta caja seguirán desde el folio ${r.siguiente_folio} (después del último del sistema anterior).` : ''}`, 'ok');
      $('#hist-previa').innerHTML = '';
      alTerminar?.();
    } catch (e) { msg(e.message, 'error'); $('#hist-confirmar').disabled = false; }
  });
}

// ── Envío mensual del reporte a la contadora (un correo por tienda) ──
const CORREO_OK = /^[^\s@<>"]+@[^\s@<>"]+\.[^\s@<>"]{2,}$/;
async function pintarPanelContadora(cajas) {
  const R = window.__POS_REPORTE__;
  const cont = $('#panel-contadora');
  const nombre = { DUO: 'DÚO New York', LON: 'London Love' };
  let d;
  try { d = await R.leer(); } catch (e) { cont.innerHTML = `<h2 style="margin-top:0">Envío mensual a la contadora</h2><div class="mensaje error">No se pudo leer la configuración: ${esc(e.message)}</div>`; return; }
  const mesTxt = (p) => `${['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'][Number(p.slice(5, 7)) - 1]} ${p.slice(0, 4)}`;
  const cajaTxt = (t, n) => `${nombre[t] ?? t} · Caja ${n}`;
  cont.innerHTML = `<h2 style="margin-top:0">Envío mensual a la contadora</h2>
    <p class="nota">El último día de cada mes a las <b>9:00 p. m.</b> (hora de Hermosillo) se manda por correo el Excel del mes de <b>cada caja a sus propios correos</b>, con el detalle de tickets y el resumen por día (la Caja 1 de DÚO incluye las ventas del POS anterior). Cada caja es un correo aparte; una caja sin correos activados no manda nada. Si falla, se reintenta a las 10:00 p. m., a las 11:00 p. m. y a las 9:00 a. m. del día siguiente; si los 4 intentos fallan te llega un aviso al teléfono («El reporte no se envió»). Lo que se venda después de las 9:00 p. m. del último día no entra en ese archivo.</p>
    ${cajas.map((k) => { const c = d.config.find((x) => x.tienda === k.tienda && x.caja === k.caja) ?? { activo: false, correos: [] }; return `<fieldset class="rc-caja" data-tienda="${esc(k.tienda)}" data-caja="${k.caja}"><legend>${esc(cajaTxt(k.tienda, k.caja))}</legend>
      <label class="check-hist"><input type="checkbox" class="rc-activo" ${c.activo ? 'checked' : ''}> Enviar el informe mensual de esta caja</label>
      <div class="campo"><label for="rc-correos-${esc(k.tienda)}-${k.caja}">Enviar a (correos separados por coma)</label><input id="rc-correos-${esc(k.tienda)}-${k.caja}" class="texto rc-correos" type="text" inputmode="email" autocomplete="off" autocapitalize="none" spellcheck="false" placeholder="contadora@despacho.mx, tu@correo.com" value="${esc((c.correos ?? []).join(', '))}" style="width:100%;box-sizing:border-box"></div>
      <div class="filas"><button class="btn btn-primario rc-guardar" type="button" style="width:auto">${ico('check')}<span>Guardar</span></button><button class="btn rc-probar" type="button" title="Te manda a TU correo el reporte de lo que va del mes de esta caja">${ico('bell')}<span>Enviarme una prueba</span></button></div>
      <div class="mensaje rc-msg" role="status" aria-live="polite"></div></fieldset>`; }).join('')}
    ${d.envios.length ? `<h3 style="margin-bottom:4px">Últimos envíos</h3><table id="tabla-envios"><thead><tr><th>Mes</th><th>Caja</th><th>Estado</th><th class="num">Tickets</th><th class="num">Total</th><th>A</th></tr></thead><tbody>${d.envios.map((e) => `<tr class="${!e.enviado_en && e.intentos >= 4 ? 'fila-fallo' : ''}"><td>${esc(mesTxt(e.periodo))}</td><td>${esc(cajaTxt(e.tienda, e.caja))}</td><td>${e.enviado_en ? `Enviado ${esc(fechaHora(e.enviado_en))}` : e.intentos >= 4 ? `<b>No se envió</b> · 4 de 4 intentos${e.avisado_en ? ' · se avisó a tu teléfono' : ''}<br><small>${esc(e.ultimo_error ?? '')}</small>` : e.intentos > 0 ? `Reintentando · ${e.intentos} de 4 intentos<br><small>${esc(e.ultimo_error ?? '')}</small>` : 'En proceso'}</td><td class="num">${e.tickets ?? ''}</td><td class="num">${e.total == null ? '' : mxn(e.total)}</td><td>${esc((e.correos ?? []).join(', '))}</td></tr>`).join('')}</tbody></table>` : '<p class="nota">Todavía no se ha intentado ningún envío.</p>'}`;
  for (const f of cont.querySelectorAll('.rc-caja')) {
    const tienda = f.dataset.tienda, caja = Number(f.dataset.caja), msg = f.querySelector('.rc-msg');
    const decir = (t, tipo = '') => { msg.className = `mensaje rc-msg ${tipo}`; msg.textContent = t; };
    f.querySelector('.rc-guardar').addEventListener('click', async () => {
      const partes = f.querySelector('.rc-correos').value.split(/[\s,;]+/).map((x) => x.trim().toLowerCase()).filter(Boolean);
      const malos = partes.filter((x) => !CORREO_OK.test(x));
      if (malos.length) return decir(`Revisa estos correos: ${malos.join(', ')}`, 'error');
      const correos = [...new Set(partes)];
      const activo = f.querySelector('.rc-activo').checked;
      if (activo && !correos.length) return decir('Escribe al menos un correo para activar el envío.', 'error');
      try { await R.guardar(tienda, caja, { activo, correos }); decir(activo ? `Guardado: el informe de ${cajaTxt(tienda, caja)} se enviará a ${correos.join(', ')}.` : 'Guardado: el envío de esta caja está apagado.', 'ok'); }
      catch (e) { decir(`No se pudo guardar: ${e.message}`, 'error'); }
    });
    f.querySelector('.rc-probar').addEventListener('click', async () => {
      decir('Enviando la prueba…');
      try { const r = await R.probar(tienda, caja); decir(`Listo: te mandé a ${r.correo} el reporte de lo que va del mes de ${cajaTxt(tienda, caja)} (${r.tickets} ticket(s), ${mxn(r.total)}). Revisa también el correo no deseado.`, 'ok'); }
      catch (e) { decir(`No se pudo enviar la prueba: ${e.message}`, 'error'); }
    });
  }
}


// ── Resumen del día de todas las tiendas (el mismo que llega como aviso al teléfono a la hora elegida) ──
async function pintarResumenDia(fecha) {
  const cont = $('#resumen-dia');
  let j;
  try { j = await api(`/api/admin/resumen-dia?fecha=${encodeURIComponent(fecha)}`); }
  catch (e) { cont.innerHTML = `<div class="mensaje error">No se pudo cargar el resumen del día: ${esc(e.message)}</div>`; return; }
  S.resumenDiaFecha = j.fecha;
  const t = j.total;
  const f = (iso) => iso.split('-').reverse().join('/');
  cont.innerHTML = `<div class="filas" style="align-items:center;justify-content:space-between"><h2 style="margin:0">${ico('store')} Resumen del día — todas las tiendas</h2>
      <label>Día <input type="date" id="rd-fecha" value="${esc(j.fecha)}" max="${esc(j.hoy)}"></label></div>
    <div class="kpi-grande" id="rd-venta-total"><span class="kpi-rotulo">VENTA TOTAL DEL DÍA · ${esc(f(j.fecha))}</span><span class="kpi-valor" id="rd-total">${mxn(t.venta_total)}</span><span class="kpi-sub">${t.tickets} ticket${t.tickets === 1 ? '' : 's'} de venta${t.canceladas ? ` · ${t.canceladas} cancelada${t.canceladas === 1 ? '' : 's'}` : ''}</span></div>
    <div class="kpi-grid" id="rd-tiendas">${j.tiendas.map((x) => `<div class="kpi" data-tienda="${esc(x.tienda)}"><span class="kpi-rotulo">${esc(x.nombre).toUpperCase()}</span><b data-col="venta">${mxn(x.venta_total)}</b><small>${x.tickets} ticket${x.tickets === 1 ? '' : 's'} · netas ${mxn(x.ventas_netas)}</small><small>Efectivo ${mxn(x.efectivo)} · Tarjeta ${mxn(x.tarjeta)}</small><small>Cortes cerrados: ${x.cajas_con_corte} de ${x.cajas} cajas</small><small data-col="retiros">Retiros: ${mxn(x.retiros)}${x.retiros_n ? ` (${x.retiros_n})` : ''}</small><small data-col="gastos">Gastos de caja: ${mxn(x.gastos)}${x.gastos_n ? ` (${x.gastos_n})` : ''}</small></div>`).join('')}</div>
    <h3 style="margin:14px 0 6px">Cómo se cobró</h3>
    <div class="kpi-grid">
      <div class="kpi" style="border-color:var(--acento)"><span class="kpi-rotulo">TOTAL EN EFECTIVO</span><b id="rd-efectivo">${mxn(t.efectivo)}</b></div>
      <div class="kpi"><span class="kpi-rotulo">Total en pesos</span><b id="rd-pesos">${mxn(t.pesos)}</b></div>
      <div class="kpi"><span class="kpi-rotulo">Total en dólares</span><b id="rd-dolares">${mxn(t.dolares_mxn)}</b><small>equivalente en pesos</small></div>
      <div class="kpi" style="border-color:var(--acento)"><span class="kpi-rotulo">TOTAL EN TARJETA</span><b id="rd-tarjeta">${mxn(t.tarjeta)}</b></div>
      ${t.credito_empleadas ? `<div class="kpi"><span class="kpi-rotulo">Crédito de empleadas</span><b id="rd-credito">${mxn(t.credito_empleadas)}</b><small>se descuenta de nómina; no es cobro</small></div>` : ''}
    </div>
    <div class="panel" style="margin:10px 0"><h3 style="margin:0 0 6px">Cambios y devoluciones</h3><table><tbody>
      <tr><th scope="row">Mercancía recibida a cambio</th><td class="num" id="rd-cambio">${mxn(t.mercancia_recibida_por_cambio)}</td></tr>
      <tr><th scope="row">Devoluciones con reembolso</th><td class="num" id="rd-devoluciones">${mxn(t.devoluciones_con_reembolso)}</td></tr>
      <tr><th scope="row" style="font-size:18px">VENTAS NETAS</th><td class="num" style="font-size:20px" id="rd-netas"><b>${mxn(t.ventas_netas)}</b></td></tr></tbody></table></div>
    <div class="panel" style="margin:10px 0"><h3 style="margin:0 0 6px">Retiros y gastos de efectivo</h3><table><tbody>
      <tr><th scope="row">Retirado de las cajas${t.retiros_n ? ` (${t.retiros_n} retiro${t.retiros_n === 1 ? '' : 's'})` : ''}</th><td class="num" id="rd-retiros"><b>${mxn(t.retiros)}</b></td></tr>
      <tr><th scope="row">Gastos de caja${t.gastos_n ? ` (${t.gastos_n})` : ''}</th><td class="num" id="rd-gastos"><b>${mxn(t.gastos)}</b></td></tr></tbody></table>
      <p class="nota" style="margin:6px 0 0">No es venta: es dinero que salió del cajón. El detalle (quién y cuánto) está en Historial de ventas.</p></div>
    <p class="nota">Este es el mismo resumen que llega como aviso al teléfono (menú Avisos, hora configurable). Las pruebas que aún no se hayan borrado también cuentan.</p>`;
  $('#rd-fecha').addEventListener('change', (ev) => pintarResumenDia(ev.target.value || j.hoy));
}

async function vistaReportes() {
  const { cajas } = await api('/api/admin/cajas');
  const hoy = new Date(Date.now() - 7 * 3600e3).toISOString().slice(0, 10);
  $('#vista').innerHTML = `<div class="titulo-vista">${ico('chart')}<h1>Reportes de ventas</h1></div>
    <section class="panel" id="resumen-dia" aria-label="Resumen del día de las tiendas"></section>
    <form class="filtros panel" id="filtros">
    <fieldset><legend>Cajas</legend><label><input type="checkbox" id="todas" checked> Todas</label>
      ${cajas.map((c) => `<label><input type="checkbox" class="caja" value="${c.tienda}/${c.caja}" checked> ${esc(c.tienda)} · Caja ${c.caja}</label>`).join('')}</fieldset>
    <label>Desde <input type="date" id="desde" value="${hoy}"></label><label>Hasta <input type="date" id="hasta" value="${hoy}"></label>
    <label class="check-hist"><input type="checkbox" id="hist" checked> Incluir ventas del POS anterior (históricas)</label>
    <div class="filas"><button class="btn btn-primario" type="submit" style="width:auto">${ico('search')}<span>Consultar</span></button>
      <button class="btn" type="button" id="rep-excel" title="Excel para la contadora: detalle de tickets y resumen por día">${ico('download')}<span>Exportar a Excel (contadora)</span></button>
      <button class="btn" type="button" id="rep-importar" title="Importa el reporte «Sales Detail» del POS anterior">${ico('upload')}<span>Importar ventas del POS anterior</span></button></div>
    <div id="rep-msg" class="mensaje" role="status" aria-live="polite"></div></form>
    ${window.__POS_REPORTE__ && S.sesion.rol_usuario === 'supervisor' ? '<section class="panel" id="panel-contadora" aria-label="Envío mensual a la contadora"></section>' : ''}
    <div id="resultado"></div>`;
  if ($('#panel-contadora')) pintarPanelContadora(cajas);
  await pintarResumenDia(S.resumenDiaFecha ?? hoy);
  const marcas = () => [...$('#filtros').querySelectorAll('.caja')];
  $('#todas').addEventListener('change', (e) => marcas().forEach((m) => (m.checked = e.target.checked)));
  marcas().forEach((m) => m.addEventListener('change', () => ($('#todas').checked = marcas().every((x) => x.checked))));
  const seleccion = () => marcas().filter((m) => m.checked).map((m) => ({ tienda: m.value.split('/')[0], caja: Number(m.value.split('/')[1]) }));
  $('#rep-excel').addEventListener('click', async () => {
    const m = $('#rep-msg'); m.className = 'mensaje'; m.textContent = 'Preparando el Excel…';
    const sel = seleccion();
    if (!sel.length) { m.className = 'mensaje error'; m.textContent = 'Seleccione al menos una caja.'; return; }
    const ruta = `/api/admin/reporte-ventas.xlsx?cajas=${sel.map((c) => `${c.tienda}/${c.caja}`).join(',')}&desde=${$('#desde').value}&hasta=${$('#hasta').value}&historicas=${$('#hist').checked ? 1 : 0}`;
    try {
      if (window.__POS_EXPORTAR__) m.textContent = await window.__POS_EXPORTAR__(ruta, `reporte-de-ventas-${$('#desde').value}-a-${$('#hasta').value}.xlsx`);
      else { const a = document.createElement('a'); a.href = ruta; a.download = 'reporte-de-ventas.xlsx'; document.body.appendChild(a); a.click(); a.remove(); m.textContent = 'Descarga iniciada.'; }
      m.className = 'mensaje ok';
    } catch (e) { m.className = 'mensaje error'; m.textContent = `No se pudo exportar: ${e.message}`; }
  });
  $('#rep-importar').addEventListener('click', () => abrirImportarHistoricas(cajas, () => $('#filtros').requestSubmit()));
  $('#filtros').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const sel = marcas().filter((m) => m.checked).map((m) => ({ tienda: m.value.split('/')[0], caja: Number(m.value.split('/')[1]) }));
    if (!sel.length) return void ($('#resultado').innerHTML = '<div class="mensaje error">Seleccione al menos una caja.</div>');
    const { reporte: r } = await api('/api/admin/reporte', { cajas: sel, desde: $('#desde').value, hasta: $('#hasta').value, historicas: $('#hist').checked });
    $('#resultado').innerHTML = `<div class="panel"><p class="nota">Cada venta conserva tienda, caja y folio originales; el reporte no renumera.</p>
      <div class="tabla-cont"><table id="tabla-reporte"><thead><tr><th>Tienda</th><th>Caja</th><th>Folio</th><th>Fecha</th><th>Vendedora-Cajera</th><th class="num">Total</th><th>Estado</th><th class="num">Piezas</th><th>Forma de pago</th><th>Origen</th></tr></thead><tbody>
      ${r.filas.map((f) => `<tr${f.historico ? ' class="fila-hist"' : ''}><td>${esc(f.tienda)}</td><td>${f.caja}</td><td>${f.historico ? f.folio : String(f.folio).padStart(6, '0')}</td><td>${esc(f.fecha_local)}</td><td>${esc(f.cajero)}</td><td class="num">${mxn(f.total)}</td><td>${esc(f.estado)}</td><td class="num">${f.piezas}</td><td>${esc(f.pago)}</td><td>${f.historico ? `POS anterior${f.tipo_ticket === 'venta' ? '' : ` · ${f.tipo_ticket === 'fee' ? 'fee por daño' : 'cambio'}`}` : 'POS nuevo'}</td></tr>`).join('') || '<tr><td colspan="10" class="vacio">Sin ventas en el periodo.</td></tr>'}</tbody></table></div>
      <h2>Desglose por caja</h2><table id="tabla-por-caja"><thead><tr><th>Tienda</th><th>Caja</th><th class="num">Tickets</th><th class="num">Total</th></tr></thead><tbody>
      ${r.porCaja.map((c) => `<tr><td>${esc(c.tienda)}</td><td>${c.caja}${c.historico ? ' <small>(histórico)</small>' : ''}</td><td class="num">${c.tickets}</td><td class="num">${mxn(c.total)}</td></tr>`).join('')}
      <tr><th colspan="3" scope="row">Total consolidado</th><td class="num" id="total-consolidado"><b>${mxn(r.total)}</b></td></tr></tbody></table>
      <p class="nota">Sin tarjetas de regalo vendidas ni recargadas: <b id="total-mercancia">${mxn(r.total_mercancia)}</b>. Lo cobrado con una tarjeta de regalo ya cuenta como venta de mercancía; la venta de la tarjeta no.</p></div>`;
    const { vendedoras } = await api('/api/admin/reporte-vendedoras', { cajas: sel, desde: $('#desde').value, hasta: $('#hasta').value });
    $('#resultado').insertAdjacentHTML('beforeend', `<div class="panel" style="margin-top:12px"><h2 style="margin-top:0">Ventas por vendedora</h2>
      <p class="nota">Por quien atendió a la clienta («Venta por»), no por quien cobró. Lo devuelto o cambiado se resta a quien vendió la pieza. «Autocompra» = nadie ayudó.</p>
      <div class="tabla-cont"><table id="tabla-vendedoras"><thead><tr><th>Vendedora</th><th class="num">Tickets</th><th class="num">Piezas</th><th class="num">Vendido</th><th class="num">Devuelto / cambiado</th><th class="num">Neto</th></tr></thead><tbody>
      ${vendedoras.map((v) => `<tr data-vendedora="${esc(v.clave)}"><td><b>${esc(v.alias)}</b>${v.nombre_completo ? `<br><small>${esc(v.nombre_completo)}</small>` : ''}</td><td class="num">${v.tickets}</td><td class="num">${v.piezas}</td><td class="num">${mxn(v.vendido)}</td><td class="num">${v.devuelto ? `-${mxn(v.devuelto)}` : mxn(0)}</td><td class="num"><b>${mxn(v.neto)}</b></td></tr>`).join('') || '<tr><td colspan="6" class="vacio">Sin ventas en el periodo.</td></tr>'}</tbody></table></div></div>`);
  });
}

// ── Inventario (Administración) ──
const ROT_SEV = { bloquea_venta: 'No se puede vender', revisar: 'Revisar', info: 'Informativo' };
async function exportarInventario() {
  if (window.__POS_EXPORTAR__) return window.__POS_EXPORTAR__('/api/admin/inventario.xlsx', 'inventario.xlsx');
  const a = document.createElement('a'); a.href = '/api/admin/inventario.xlsx'; a.download = 'inventario.xlsx';
  document.body.appendChild(a); a.click(); a.remove();
  return 'Descarga iniciada.';
}
const ORDENES_INV = [['nuevo', 'Más nuevo primero'], ['viejo', 'Más viejo primero'], ['abc', 'Descripción (A-Z)'], ['marca', 'Marca (A-Z)'], ['estilo', 'Estilo (A-Z)'], ['lote', 'Lote (más reciente)'], ['cara', 'Más caro primero'], ['barata', 'Más barato primero']];
async function vistaInventario() {
  const j = await api('/api/admin/inventario');
  const r = j.resumen;
  const tiendas = Object.entries(r.por_tienda);
  S.inv = { q: S.inv?.q ?? '', orden: S.inv?.orden ?? 'nuevo', pag: 0, por: 50, total: 0, tiendas: [], articulos: [], sel: S.inv?.sel ?? null };
  $('#vista').innerHTML = `
    <div class="titulo-vista">${ico('box')}<h1>Inventario</h1></div>
    <div class="panel">
      <div class="filas" style="align-items:center;margin-bottom:12px">
        <button class="btn btn-primario" id="btn-exportar" type="button" style="width:auto">${ico('download')}<span>Exportar inventario a Excel</span></button>
        <span id="estado-exportar" role="status" aria-live="polite"></span>
      </div>
      <div class="cuadricula">
        <table id="tabla-inv-resumen"><caption class="sr-only">Resumen del catálogo</caption><tbody>
          <tr><th scope="row">Artículos</th><td class="num" data-campo="articulos">${r.articulos}</td></tr>
          <tr><th scope="row">Con código</th><td class="num" data-campo="con_codigo">${r.con_codigo}</td></tr>
          <tr><th scope="row">Sin código (no se escanean)</th><td class="num" data-campo="sin_codigo">${r.sin_codigo}</td></tr>
          <tr><th scope="row">Con precio no vendible (0 o negativo)</th><td class="num" data-campo="precio_no_vendible">${r.precio_no_vendible}</td></tr></tbody></table>
        <table id="tabla-inv-tiendas"><thead><tr><th>Tienda</th><th class="num">Piezas</th><th class="num">Artículos con existencia</th><th class="num">Sin verificar</th></tr></thead><tbody>
          ${tiendas.map(([t, x]) => `<tr data-tienda="${esc(t)}"><td>${esc(t === 'LIMBO' ? 'El Limbo' : t)}</td><td class="num">${x.piezas}</td><td class="num">${x.articulos_con_existencia}</td><td class="num">${x.no_verificados}</td></tr>`).join('')}</tbody></table>
      </div>
      <p class="nota">La existencia es la que conoce el central (lo ya sincronizado). Las cantidades de prueba están marcadas como tales en los movimientos.</p>
      <h2>Todos los artículos</h2>
      <div class="filas barra-busqueda-inv" style="align-items:center"><input id="inv-q" type="search" class="texto" placeholder="Buscar… (ej. Lote=202610)" value="${esc(S.inv.q)}" style="padding:6px 8px;border:1px solid var(--borde);border-radius:6px;background:var(--superficie);min-width:320px" autocapitalize="none" autocorrect="off" spellcheck="false">
        <label class="orden-inv" for="inv-orden"><span>Ordenar por</span><select id="inv-orden" style="padding:6px 8px;border:1px solid var(--borde);border-radius:6px;background:var(--superficie)">${ORDENES_INV.map(([v, t]) => `<option value="${v}" ${S.inv.orden === v ? 'selected' : ''}>${t}</option>`).join('')}</select></label>
        <button class="btn btn-primario" id="inv-sel-modo" type="button" aria-pressed="false" style="width:auto">${ico('check')}<span>Seleccionar</span></button></div>
      <p class="nota" id="inv-nota">Toque un artículo para editarlo, ver su historial o crearle una promoción. Para filtrar por un campo escriba, por ejemplo, <b>Lote=202610</b>, <b>Lote=0</b> (sin lote), <b>Marca=levis</b>, <b>Estilo=123L</b>, <b>Depto=dama</b>, <b>Precio&gt;200</b> o <b>Limbo&gt;0</b> (con piezas en El Limbo); se pueden combinar con palabras. Con <b>Seleccionar</b> puede marcar varios artículos y darles su ubicación real.</p>
      <div id="inv-msg" class="mensaje" role="status" aria-live="polite"></div>
      <div id="inv-sel" class="barra-sel" hidden></div>
      <div id="inv-res" class="tabla-cont"></div>
      <div class="filas" id="inv-pag" style="align-items:center;margin-top:8px"></div>
    </div>`;
  let tmp;
  $('#inv-orden').addEventListener('change', () => { S.inv.orden = $('#inv-orden').value; S.inv.pag = 0; cargarListaInventario(); });
  $('#inv-q').addEventListener('input', () => {
    clearTimeout(tmp);
    tmp = setTimeout(() => {
      S.inv.q = $('#inv-q').value.trim(); S.inv.pag = 0;
      // «Todo lo del buscador» solo vale para la búsqueda en que se marcó: al cambiarla se empieza de nuevo (lo marcado uno por uno se conserva).
      if (S.inv.sel && S.inv.sel.modo === 'filtro') { S.inv.sel = { modo: 'manual', ids: new Set(), filtro: null, excluir: new Set() }; pintarSel(); $('#inv-msg').className = 'mensaje aviso'; $('#inv-msg').textContent = 'Cambió la búsqueda: la selección de «todo lo del buscador» se quitó.'; }
      cargarListaInventario();
    }, 250);
  });
  $('#inv-sel-modo').addEventListener('click', () => {
    S.inv.sel = S.inv.sel ? null : { modo: 'manual', ids: new Set(), filtro: null, excluir: new Set() };
    cargarListaInventario();
  });
  $('#btn-exportar').addEventListener('click', async () => {
    const e = $('#estado-exportar');
    e.textContent = 'Preparando el archivo…';
    try { e.textContent = await exportarInventario(); } catch (err) { e.textContent = `No se pudo exportar: ${err.message}`; }
  });
  await cargarListaInventario();
}
// ── Selección de artículos del Inventario (para darles su ubicación real) ──
const selCantidad = () => { const s = S.inv.sel; return !s ? 0 : s.modo === 'filtro' ? Math.max(0, S.inv.total - s.excluir.size) : s.ids.size; };
const estaSel = (id) => { const s = S.inv.sel; return !!s && (s.modo === 'filtro' ? !s.excluir.has(id) : s.ids.has(id)); };
function alternarSel(id) {
  const s = S.inv.sel;
  const conj = s.modo === 'filtro' ? s.excluir : s.ids;
  if (conj.has(id)) conj.delete(id); else conj.add(id);
  pintarSel();
}
/** Marca o desmarca los renglones visibles y la barra de acciones. */
function pintarSel() {
  const I = S.inv, s = I.sel;
  $('#inv-sel-modo').setAttribute('aria-pressed', String(!!s));
  $('#inv-sel-modo').querySelector('span').textContent = s ? 'Salir de selección' : 'Seleccionar';
  for (const el of $('#inv-res').querySelectorAll('[data-item]')) {
    const on = estaSel(el.dataset.item);
    el.classList.toggle('sel', !!s && on);
    const c = el.querySelector('input[data-sel]'); if (c) c.checked = on;
  }
  const b = $('#inv-sel');
  b.hidden = !s;
  if (!s) { b.innerHTML = ''; return; }
  const n = selCantidad();
  b.innerHTML = `<div class="sel-resumen"><b id="sel-n">${n}</b> seleccionado${n === 1 ? '' : 's'}${s.modo === 'filtro' ? ` <small>(todo lo del buscador${s.excluir.size ? `, sin ${s.excluir.size}` : ''})</small>` : ''}</div>
    <div class="sel-botones"><button class="btn" type="button" id="sel-todo" ${I.total ? '' : 'disabled'}>${ico('check')}<span>Seleccionar los ${I.total} del buscador</span></button>
    <button class="btn" type="button" id="sel-nada" ${n ? '' : 'disabled'}>${ico('x')}<span>Quitar selección</span></button></div>
    <div class="sel-acciones"><button class="btn btn-primario" type="button" id="sel-almacen" ${n ? '' : 'disabled'}>${ico('warehouse')}<span>Pasar a Almacén</span></button>
    <button class="btn btn-peligro" type="button" id="sel-baja" ${n ? '' : 'disabled'}>${ico('trash')}<span>Ya no existe</span></button></div>`;
  $('#sel-todo').addEventListener('click', () => { I.sel = { modo: 'filtro', ids: new Set(), filtro: I.q, excluir: new Set() }; pintarSel(); });
  $('#sel-nada').addEventListener('click', () => { I.sel = { modo: 'manual', ids: new Set(), filtro: null, excluir: new Set() }; pintarSel(); });
  $('#sel-almacen').addEventListener('click', () => abrirReubicar('almacen', baseSeleccion()));
  $('#sel-baja').addEventListener('click', () => abrirReubicar('baja', baseSeleccion()));
}
const baseSeleccion = () => { const s = S.inv.sel; return s.modo === 'filtro' ? { filtro: s.filtro ?? '', excluir: [...s.excluir] } : { items: [...s.ids].map((item_id) => ({ item_id })) }; };

/**
 * Ubicación real de piezas de El Limbo: las pasa al almacén (desde ahí se sacan a piso con la entrega de siempre) o las da de baja (ya no existen).
 * Primero revisa lo que pasaría (sin guardar) y solo guarda cuando se confirma. `base` = { items } o { filtro, excluir }; `titulo` solo para un artículo.
 */
async function abrirReubicar(destinoInicial, base, titulo) {
  const d = dialogo('dlg-reubicar');
  d.setAttribute('aria-labelledby', 'ru-titulo');
  const id = (crypto.randomUUID && crypto.randomUUID()) || `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  d.innerHTML = `<h2 id="ru-titulo" style="margin-top:0">${esc(titulo ?? 'Ubicación real de las piezas')}</h2>
    <p class="nota" style="margin-top:0">Las piezas salen de El Limbo. Al almacén entran para sacarlas a piso con la entrega de siempre; «ya no existe» las quita sin dejarlas en ningún lado.</p>
    <form id="form-reubicar" autocomplete="off">
      <fieldset class="ru-opciones"><legend>¿A dónde van?</legend>
        <label><input type="radio" name="ru-destino" value="almacen" ${destinoInicial === 'almacen' ? 'checked' : ''}> Al almacén</label>
        <label><input type="radio" name="ru-destino" value="baja" ${destinoInicial === 'baja' ? 'checked' : ''}> Ya no existen (dar de baja)</label></fieldset>
      <fieldset class="ru-opciones"><legend>¿Cuántas piezas de cada artículo?</legend>
        <label><input type="radio" name="ru-cant" value="todo" checked> Todas las que tiene El Limbo</label>
        <label><input type="radio" name="ru-cant" value="fija"> Una cantidad fija: <input id="ru-n" type="number" min="1" step="1" inputmode="numeric" value="1" style="width:70px;padding:6px;border:1px solid var(--borde);border-radius:6px;background:var(--superficie)"></label></fieldset>
      <div id="ru-resumen" class="mensaje" role="status" aria-live="polite">Revisando…</div>
      <div id="ru-aviso" class="mensaje aviso" role="status" hidden></div>
      <div class="filas"><button class="btn" type="button" id="ru-no">Cancelar</button><button class="btn btn-primario" type="submit" id="ru-ok" style="width:auto;flex:1" disabled>${ico('check')}<span>Aplicar</span></button></div>
    </form>`;
  const destino = () => d.querySelector('input[name="ru-destino"]:checked').value;
  const cantidad = () => (d.querySelector('input[name="ru-cant"]:checked').value === 'fija' ? Number($('#ru-n').value) : null);
  let ultimo = null, n = 0;
  const cuerpo = (extra = {}) => ({ movimiento_id: id, destino: destino(), cantidad: cantidad(), ...base, ...extra });
  const revisar = async () => {
    const mio = ++n;
    const ok = $('#ru-ok'), res = $('#ru-resumen'), av = $('#ru-aviso');
    ok.disabled = true; av.hidden = true;
    if (cantidad() !== null && (!Number.isInteger(cantidad()) || cantidad() < 1)) { res.className = 'mensaje error'; res.textContent = 'La cantidad debe ser un entero de 1 o más.'; return; }
    try {
      const r = await api('/api/admin/limbo/reubicar', cuerpo({ solo_revisar: true }));
      if (mio !== n) return;
      ultimo = r;
      const baja = destino() === 'baja';
      res.className = 'mensaje';
      res.textContent = r.articulos ? `${r.articulos} artículo${r.articulos === 1 ? '' : 's'} · ${r.piezas} pieza${r.piezas === 1 ? '' : 's'} ${baja ? 'se darían de baja' : 'pasarían al almacén'}.${r.omitidos_total ? ` ${r.omitidos_total} no tienen piezas en El Limbo y se omiten.` : ''}` : 'Ninguno de los seleccionados tiene piezas en El Limbo.';
      const avisos = [];
      if (baja && r.articulos) avisos.push('Ya no se podrán vender como existencia de El Limbo. Confirme que de verdad ya no existen.');
      if (r.quedan_negativos) avisos.push(`${r.quedan_negativos} artículo${r.quedan_negativos === 1 ? '' : 's'} quedarán con El Limbo en negativo (se mueven más piezas de las que El Limbo tenía registradas).`);
      av.hidden = !avisos.length; av.textContent = avisos.join(' ');
      ok.disabled = !r.articulos;
      ok.querySelector('span').textContent = r.articulos ? (baja ? `Dar de baja ${r.piezas} pieza${r.piezas === 1 ? '' : 's'}` : `Pasar ${r.piezas} pieza${r.piezas === 1 ? '' : 's'} al almacén`) : 'Aplicar';
      ok.classList.toggle('btn-peligro', baja); ok.classList.toggle('btn-primario', !baja);
    } catch (e) { if (mio !== n) return; res.className = 'mensaje error'; res.textContent = e.message; }
  };
  for (const el of d.querySelectorAll('input[name="ru-destino"], input[name="ru-cant"]')) el.addEventListener('change', revisar);
  $('#ru-n').addEventListener('input', () => { d.querySelector('input[name="ru-cant"][value="fija"]').checked = true; clearTimeout(abrirReubicar.t); abrirReubicar.t = setTimeout(revisar, 300); });
  $('#ru-no').addEventListener('click', () => d.close());
  $('#form-reubicar').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const ok = $('#ru-ok'), res = $('#ru-resumen');
    ok.disabled = true;
    try {
      const r = await api('/api/admin/limbo/reubicar', cuerpo());
      d.close();
      const baja = r.destino === 'baja';
      S.inv.sel = null;
      await vistaInventario();
      const m = $('#inv-msg'); m.className = 'mensaje ok';
      m.textContent = `${r.articulos} artículo${r.articulos === 1 ? '' : 's'} (${r.piezas} pieza${r.piezas === 1 ? '' : 's'}) ${baja ? 'dados de baja de El Limbo' : 'pasaron de El Limbo al almacén'}.${r.repetido ? ' (Ya estaba aplicado.)' : ''}`;
    } catch (e) { res.className = 'mensaje error'; res.textContent = e.message; ok.disabled = false; }
  });
  d.showModal();
  await revisar();
}
async function cargarListaInventario() {
  const I = S.inv;
  const mia = (I.carga = (I.carga ?? 0) + 1);
  const r = await api(`/api/admin/articulos?todos=1&limite=${I.por}&desde=${I.pag * I.por}&q=${encodeURIComponent(I.q)}&orden=${encodeURIComponent(I.orden)}`);
  if (mia !== I.carga) return; // llegó otra búsqueda más reciente: esta respuesta ya no vale
  Object.assign(I, { total: r.total, tiendas: r.tiendas ?? [], articulos: r.articulos });
  const paginas = Math.max(1, Math.ceil(r.total / I.por));
  $('#inv-res').innerHTML = `<table id="tabla-inv-lista" class="solo-escritorio"><thead><tr>${I.sel ? '<th class="chk"></th>' : ''}<th>Item #</th><th>Código</th><th>Descripción</th><th>Marca</th><th>Estilo</th><th>Lote</th><th>Departamento</th><th class="num">Precio</th>${I.tiendas.map((t) => `<th class="num">${esc(t)}</th>`).join('')}<th class="num">Almacén</th><th class="num">El Limbo</th></tr></thead><tbody>
    ${r.articulos.map((a) => `<tr data-item="${esc(a.item_id)}" tabindex="0" style="cursor:pointer">${I.sel ? `<td class="chk"><input type="checkbox" data-sel="${esc(a.item_id)}" aria-label="Seleccionar ${esc(a.descripcion)}"></td>` : ''}<td>${esc(a.item_no ?? '')}</td><td>${esc(a.codigo)}</td><td>${esc(a.descripcion)}</td><td>${esc(a.marca)}</td><td>${esc(a.estilo)}</td><td>${esc(a.lote)}</td><td>${esc(a.departamento)}</td><td class="num">${mxn(a.precio)}</td>${I.tiendas.map((t) => `<td class="num">${a.existencias[t] ?? 0}</td>`).join('')}<td class="num">${a.almacen}</td><td class="num" data-col="limbo">${a.limbo}</td></tr>`).join('') || `<tr><td colspan="${11 + I.tiendas.length}" class="vacio">Ningún artículo coincide.</td></tr>`}</tbody></table>`;
  // En el teléfono la lista es de filas compactas (dos renglones por artículo), no tarjetas con todas las columnas.
  $('#inv-res').insertAdjacentHTML('beforeend', `<div class="lista-inv solo-movil" id="lista-inv" role="list">${r.articulos.map((a) => {
    const quien = [a.marca, a.estilo].filter(Boolean).map(esc).join(' · ');
    const ex = [...I.tiendas.map((t) => [t, a.existencias[t] ?? 0]), ['Alm', a.almacen], ['Limbo', a.limbo]].map(([t, n]) => `<span class="${n > 0 ? 'hay' : n < 0 ? 'neg' : ''}">${esc(t)} ${n}</span>`).join('');
    return `<button type="button" class="fila-inv" role="listitem" data-item="${esc(a.item_id)}">${I.sel ? '<span class="fi-chk" aria-hidden="true"></span>' : ''}<span class="fi-linea"><b class="fi-desc">${esc(a.descripcion) || '(sin descripción)'}</b><span class="fi-precio">${mxn(a.precio)}</span></span>${quien ? `<span class="fi-quien">${quien}</span>` : ''}<span class="fi-sub"><span>#${esc(a.item_no ?? '—')}</span><span>${esc(a.codigo) || 'sin código'}</span></span><span class="fi-ex">${ex}</span></button>`;
  }).join('') || '<p class="vacio">Sin resultados.</p>'}</div>`);
  for (const tr of $('#inv-res').querySelectorAll('[data-item]')) {
    // En modo selección, tocar el renglón lo marca o desmarca; fuera de él abre el artículo.
    const abrir = () => (I.sel ? alternarSel(tr.dataset.item) : abrirArticulo(I.articulos.find((x) => x.item_id === tr.dataset.item)));
    tr.addEventListener('click', (ev) => { if (ev.target.matches('input[data-sel]')) return; abrir(); });
    tr.addEventListener('keydown', (ev) => { if (ev.key === 'Enter' || (I.sel && ev.key === ' ')) { ev.preventDefault(); abrir(); } });
    const c = tr.querySelector('input[data-sel]');
    if (c) c.addEventListener('change', () => alternarSel(tr.dataset.item));
  }
  pintarSel();
  const desde = r.total ? I.pag * I.por + 1 : 0, hasta = Math.min(r.total, (I.pag + 1) * I.por);
  $('#inv-pag').innerHTML = `<button class="btn" id="inv-ant" type="button" ${I.pag === 0 ? 'disabled' : ''}>${ico('chevron', 'ico-izq')}<span>Anterior</span></button><span id="inv-pag-info">Artículos ${desde}–${hasta} de ${r.total} · página ${I.pag + 1} de ${paginas}</span><button class="btn" id="inv-sig" type="button" ${I.pag + 1 >= paginas ? 'disabled' : ''}><span>Siguiente</span>${ico('chevron')}</button>`;
  $('#inv-ant').addEventListener('click', () => { I.pag--; cargarListaInventario(); });
  $('#inv-sig').addEventListener('click', () => { I.pag++; cargarListaInventario(); });
}
/**
 * «Existencias reales» (solo supervisores): el propietario deja las cantidades de UN artículo exactamente como las contó (El Limbo, almacén y cada tienda).
 * Se guardan tal cual, sin escáner ni confirmación de recepción. Lo que se agrega en el almacén o en una tienda se puede descontar de El Limbo (casilla).
 */
async function abrirExistencias(a) {
  const j = await api(`/api/admin/existencias?item_id=${encodeURIComponent(a.item_id)}`);
  const d = dialogo('dlg-existencias');
  d.setAttribute('aria-labelledby', 'ex-titulo');
  const id = (crypto.randomUUID && crypto.randomUUID()) || `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const NOM = { limbo: 'El Limbo (sin ubicar)', almacen: 'Almacén', DUO: 'Tienda DÚO', LON: 'Tienda London' };
  const ub = j.ubicaciones;
  const campo = 'width:90px;padding:8px;border:2px solid var(--borde);border-radius:10px;background:var(--superficie);text-align:right;font:inherit;font-size:18px';
  const antes = Object.fromEntries(ub.map((u) => [u.clave, u.cantidad]));
  d.innerHTML = `<h2 id="ex-titulo" style="margin-top:0">Existencias reales</h2>
    <p style="margin:0 0 6px"><b>${esc(j.articulo.descripcion)}</b>${j.articulo.marca ? ` · ${esc(j.articulo.marca)}` : ''}${j.articulo.estilo ? ` · ${esc(j.articulo.estilo)}` : ''} <small>#${esc(j.articulo.item_no ?? '—')}</small></p>
    <p class="nota" style="margin-top:0">Escriba cuántas piezas hay <b>realmente</b> en cada lugar. Se guarda tal cual, sin escáner ni confirmación de la tienda. Solo supervisores.</p>
    <form id="form-existencias" autocomplete="off">
      <table id="ex-tabla" style="width:100%"><thead><tr><th style="text-align:left">Lugar</th><th class="num">Ahora</th><th class="num">Hay realmente</th></tr></thead><tbody>
      ${ub.map((u) => `<tr data-lugar="${esc(u.clave)}"><td>${esc(NOM[u.clave] ?? u.clave)}</td><td class="num" data-label="Ahora">${u.cantidad}</td><td class="num" data-label="Hay realmente"><input type="number" min="0" step="1" inputmode="numeric" value="${u.cantidad}" data-ex="${esc(u.clave)}" style="${campo}" aria-label="Piezas reales: ${esc(NOM[u.clave] ?? u.clave)}"></td></tr>`).join('')}
      </tbody></table>
      <label class="ex-desc" style="display:flex;gap:8px;align-items:center;padding:8px 0"><input type="checkbox" id="ex-limbo-auto" ${antes.limbo > 0 ? 'checked' : ''}> Lo que agregue al almacén o a una tienda se descuenta de El Limbo</label>
      <p class="nota" id="ex-total" style="margin:0 0 6px"></p>
      <div class="campo"><label for="ex-motivo">Motivo (opcional)</label><input id="ex-motivo" class="texto" maxlength="200" placeholder="Conteo del propietario" style="width:100%;box-sizing:border-box"></div>
      <div id="ex-msg" class="mensaje" role="status" aria-live="polite"></div>
      <div class="filas"><button class="btn" type="button" id="ex-no">Cancelar</button><button class="btn btn-primario" type="submit" id="ex-ok" style="width:auto;flex:1" disabled>${ico('check')}<span>Guardar existencias</span></button></div>
    </form>`;
  const inp = (k) => d.querySelector(`input[data-ex="${k}"]`);
  const valor = (k) => { const v = inp(k).value.trim(); return v === '' ? NaN : Number(v); };
  const cantidades = () => Object.fromEntries(ub.map((u) => [u.clave, valor(u.clave)]));
  let limboAMano = false;
  const refrescar = () => {
    const c = cantidades();
    const valido = Object.values(c).every((n) => Number.isInteger(n) && n >= 0);
    const cambia = ub.some((u) => c[u.clave] !== u.cantidad);
    const total = Object.values(c).reduce((x, n) => x + (Number.isFinite(n) ? n : 0), 0), totalAntes = ub.reduce((x, u) => x + u.cantidad, 0);
    $('#ex-total').textContent = `Total en todos los lugares: ${total} (antes ${totalAntes})${total !== totalAntes ? ` · ${total > totalAntes ? '+' : ''}${total - totalAntes}` : ''}`;
    $('#ex-ok').disabled = !valido || !cambia;
    $('#ex-msg').className = valido ? 'mensaje' : 'mensaje error';
    $('#ex-msg').textContent = valido ? '' : 'Escriba enteros de 0 o más en cada lugar.';
  };
  const recalcularLimbo = () => {
    if (!$('#ex-limbo-auto').checked || limboAMano) return;
    const subidas = ub.filter((u) => u.clave !== 'limbo').reduce((x, u) => x + Math.max(0, (valor(u.clave) || 0) - u.cantidad), 0);
    inp('limbo').value = String(Math.max(0, antes.limbo - subidas));
  };
  for (const u of ub) inp(u.clave).addEventListener('input', () => { if (u.clave === 'limbo') limboAMano = true; else recalcularLimbo(); refrescar(); });
  $('#ex-limbo-auto').addEventListener('change', () => { limboAMano = false; if ($('#ex-limbo-auto').checked) recalcularLimbo(); refrescar(); });
  $('#ex-no').addEventListener('click', () => d.close());
  $('#form-existencias').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const m = $('#ex-msg'), ok = $('#ex-ok');
    ok.disabled = true;
    try {
      const r = await api('/api/admin/existencias', { ajuste_id: id, item_id: a.item_id, cantidades: cantidades(), motivo: $('#ex-motivo').value.trim() });
      d.close();
      await vistaInventario();
      const mm = $('#inv-msg'); mm.className = 'mensaje ok';
      mm.textContent = `Existencias de «${a.descripcion}» guardadas: ${r.cambios.filter((c) => c.antes !== c.despues).map((c) => `${NOM[c.lugar] ?? c.lugar} ${c.antes} → ${c.despues}`).join(' · ') || 'sin cambios'}.`;
    } catch (e) { m.className = 'mensaje error'; m.textContent = e.message; ok.disabled = false; }
  });
  d.showModal();
  refrescar();
}
/** Edición de un artículo: se abre editable, con Historial y Crear promoción. */
async function abrirArticulo(a) {
  const { departamentos } = await api('/api/admin/departamentos');
  const d = dialogo('dlg-articulo');
  d.setAttribute('aria-labelledby', 'art-titulo');
  const deptos = departamentos.filter((x) => x.activo).map((x) => x.nombre);
  if (!deptos.includes(a.departamento)) deptos.unshift(a.departamento);
  const campo = (id, rotulo, valor, extra = '') => `<div class="campo"><label for="${id}">${rotulo}</label><input id="${id}" class="texto" value="${esc(valor ?? '')}" ${extra}></div>`;
  d.innerHTML = `<h2 id="art-titulo" style="margin-top:0">Artículo ${esc(a.item_no ?? '(sin Item #)')}</h2>
    <p class="nota" style="margin-top:0">Código <b>${esc(a.codigo || '(sin código)')}</b> · ${Object.entries(a.existencias).map(([t, n]) => `${esc(t)}: ${n}`).join(' · ')} · Almacén: ${a.almacen} · El Limbo: ${a.limbo}</p>
    <form id="form-articulo" autocomplete="off">
      ${campo('art-descripcion', 'Descripción', a.descripcion)}${campo('art-marca', 'Marca', a.marca)}${campo('art-estilo', 'Estilo', a.estilo)}${campo('art-lote', 'Lote', a.lote)}
      <div class="campo"><label for="art-depto">Departamento</label><select id="art-depto" style="width:100%;padding:10px;border:2px solid var(--borde);border-radius:10px;background:var(--superficie)">${deptos.map((n) => `<option ${n === a.departamento ? 'selected' : ''}>${esc(n)}</option>`).join('')}</select></div>
      ${campo('art-precio', 'Precio de venta (MXN)', centavosAPesos(a.precio), `inputmode="decimal" ${S.sesion.rol_usuario === 'almacenista' ? 'readonly title="Solo un supervisor cambia precios"' : ''}`)}
      <p class="nota">${S.sesion.rol_usuario === 'almacenista' ? 'El precio solo lo cambia un supervisor. ' : ''}Un cambio de precio vale para las ventas siguientes; lo ya vendido conserva el suyo. Queda registrado en el historial.</p>
      <div id="msg-art" class="mensaje" role="status" aria-live="polite"></div>
      <div class="filas"><button class="btn" type="button" id="art-cerrar">Cerrar</button>${S.sesion.rol_usuario === 'supervisor' ? `<button class="btn" type="button" id="art-existencias" title="Dejar las piezas de cada lugar tal como las contó">${ico('box')}<span>Existencias reales</span></button>` : `<button class="btn" type="button" id="art-ubicar" title="Dar su ubicación real a las piezas que figuran en El Limbo">${ico('warehouse')}<span>Ubicar piezas</span></button>`}<button class="btn" type="button" id="art-historial">${ico('clock')}<span>Historial</span></button>${S.sesion.rol_usuario === 'almacenista' ? '' : `<button class="btn" type="button" id="art-promo">${ico('tag')}<span>Crear promoción</span></button>`}<button class="btn btn-primario" type="submit" id="art-guardar" style="width:auto;flex:1">${ico('check')}<span>Guardar cambios</span></button></div>
    </form>
    <div id="art-hist" class="tabla-cont" hidden></div>`;
  $('#art-cerrar').addEventListener('click', () => d.close());
  if ($('#art-promo')) $('#art-promo').addEventListener('click', async () => { d.close(); S.hoyPromo = S.hoyPromo ?? new Date(Date.now() - 7 * 3600e3).toISOString().slice(0, 10); await abrirPromo(null, { item: a }); });
  if ($('#art-existencias')) $('#art-existencias').addEventListener('click', () => { d.close(); abrirExistencias(a).catch((e) => { const m = $('#inv-msg'); if (m) { m.className = 'mensaje error'; m.textContent = e.message; } }); });
  if ($('#art-ubicar')) $('#art-ubicar').addEventListener('click', () => { d.close(); abrirReubicar('almacen', { items: [{ item_id: a.item_id }] }, `Ubicar piezas · ${a.descripcion}`); });
  $('#art-historial').addEventListener('click', async () => {
    const h = $('#art-hist');
    if (!h.hidden) { h.hidden = true; return; }
    try {
      const r = await api(`/api/admin/articulo/historial?item_id=${encodeURIComponent(a.item_id)}`);
      h.innerHTML = `<h3>Historial</h3><table id="tabla-art-historial"><thead><tr><th>Fecha y hora</th><th>Evento</th><th>Detalle</th><th>Quién</th></tr></thead><tbody>${r.eventos.map((e) => `<tr data-tipo="${esc(e.tipo)}"><td>${esc(fechaHora(e.ocurrio_en))}</td><td>${esc(e.evento)}</td><td class="desc">${esc(e.detalle)}</td><td>${esc(e.por)}</td></tr>`).join('') || '<tr><td colspan="4" class="vacio">Sin movimientos.</td></tr>'}</tbody></table>`;
      h.hidden = false;
    } catch (e) { const m = $('#msg-art'); m.className = 'mensaje error'; m.textContent = e.message; }
  });
  $('#form-articulo').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const m = $('#msg-art');
    const soloLectura = S.sesion.rol_usuario === 'almacenista'; // el almacenista no cambia precios
    const precio = soloLectura ? a.precio : parseMXN($('#art-precio').value);
    if (precio === null) { m.className = 'mensaje error'; m.textContent = 'Escriba el precio en pesos (por ejemplo 899 o 899.50).'; return; }
    try {
      const r = await api('/api/admin/articulos', { item_id: a.item_id, cambios: { descripcion: $('#art-descripcion').value, marca: $('#art-marca').value, estilo: $('#art-estilo').value, lote: $('#art-lote').value, departamento: $('#art-depto').value, ...(soloLectura ? {} : { precio }) } });
      d.close();
      await cargarListaInventario();
      const mm = $('#inv-msg'); mm.className = 'mensaje ok'; mm.textContent = `Artículo ${r.articulo.item_no ?? ''} guardado.`;
    } catch (e) { m.className = 'mensaje error'; m.textContent = e.message; }
  });
  d.showModal();
}

// ── Tarjetas de regalo ──
const venceTxt = (iso) => fechaCorta(iso).split(' · ')[0];
const filaTarjeta = (t, admin) => `<tr data-tarjeta="${esc(t.codigo)}"><td data-col="codigo">${esc(t.codigo)}</td>${admin ? `<td>${esc(t.tienda)} · Caja ${t.caja}</td>` : ''}<td class="num">${mxn(t.emitido + (t.recargado ?? 0))}</td><td class="num">${mxn(t.usado)}</td><td class="num" data-col="saldo"><b>${mxn(t.saldo)}</b></td><td>${esc(venceTxt(t.vigente_hasta))}${t.vencida ? ' <span class="insignia cancelada">vencida</span>' : ''}</td>${admin ? `<td>${t.duplicadas ? `<span class="insignia cancelada">${t.duplicadas} alta(s) repetida(s)</span>` : ''}</td>` : ''}</tr>`;
function dialogoTicketTarjeta(titulo, r) {
  const dlg = $('#dlg-ticket');
  const imp = r.impresion;
  dlg.innerHTML = `<h2 id="dlg-titulo" style="margin:0 0 4px">${esc(titulo)}</h2>
    <p style="margin:0" id="resumen-alta">Código <b>${esc(r.tarjeta.codigo)}</b> · saldo <b>${mxn(r.tarjeta.saldo)}</b> · folio <b>${String(r.venta.folio).padStart(6, '0')}</b> · ticket <b>${esc(r.codigo_ticket)}</b> · cambio <b>${mxn(r.cambio)}</b></p>
    <p class="nota" style="margin:2px 0">Vigente hasta ${esc(venceTxt(r.tarjeta.vigente_hasta))}</p>
    <div class="mensaje ${imp.ok ? 'ok' : 'error'}" id="estado-impresion" role="status">${imp.ok ? 'Ticket enviado a la impresora.' : `La impresora falló: ${esc(imp.error)}. La venta SÍ quedó guardada.`}</div>
    ${logoTicketHtml()}<pre class="ticket" id="ticket-texto" tabindex="0">${esc(r.ticket_texto)}</pre>
    <div class="filas"><button class="btn btn-primario" id="btn-cerrar" type="button">${ico('check')}<span>Listo</span></button></div>`;
  dlg.showModal();
  $('#btn-cerrar').addEventListener('click', async () => { dlg.close(); await vistaTarjetas(); });
}
async function vistaTarjetas() {
  if (S.sesion.rol === 'admin') {
    const { tarjetas } = await api('/api/admin/tarjetas');
    $('#vista').innerHTML = `<div class="titulo-vista">${ico('gift')}<h1>Tarjetas de regalo</h1></div>
      <div class="panel"><p class="nota" style="margin-top:0">Libro de todas las tiendas. Saldo = vendido + recargas − usos + devoluciones a la tarjeta. Vencen a los 12 meses de la venta o de la última recarga en efectivo. Si dos cajas aisladas dan de alta el mismo código, la segunda no suma saldo y se señala aquí.</p>
      <div class="tabla-cont"><table id="tabla-tarjetas"><thead><tr><th>Código</th><th>Emitida en</th><th class="num">Cargado</th><th class="num">Usado</th><th class="num">Saldo</th><th>Vigente hasta</th><th>Avisos</th></tr></thead><tbody>
      ${tarjetas.map((t) => filaTarjeta(t, true)).join('') || '<tr><td colspan="7" class="vacio">Aún no hay tarjetas de regalo.</td></tr>'}</tbody></table></div></div>`;
    return;
  }
  const { tarjetas } = await api('/api/tarjetas');
  $('#vista').innerHTML = `<div class="titulo-vista">${ico('gift')}<h1>Tarjetas de regalo</h1></div>
    <div class="cuadricula">
      <section class="panel" aria-label="Vender una tarjeta">
        <h2 style="margin-top:0">${ico('plus')} Vender una tarjeta nueva</h2>
        <form id="form-alta" autocomplete="off">
          <div class="campo"><label for="alta-codigo">Código de la tarjeta</label><input id="alta-codigo" class="texto" spellcheck="false" placeholder="Escanee o escriba el código"></div>
          <div class="campo"><label for="alta-monto">Monto de la tarjeta (MXN)</label><input id="alta-monto" inputmode="decimal" placeholder="0.00"></div>
          <div class="campo"><label for="alta-recibido">Efectivo recibido (MXN, opcional)</label><input id="alta-recibido" inputmode="decimal" placeholder="Si lo deja vacío, paga exacto"></div>
          <button class="btn btn-primario" id="btn-alta" type="submit">${ico('gift')}<span>Cobrar y dar de alta</span></button>
        </form>
        <div id="msg-alta" class="mensaje" role="status" aria-live="polite"></div>
        <p class="nota">Es una venta en efectivo con folio normal, pero el corte la separa de las ventas de mercancía. Vence a los 12 meses.</p>
      </section>
      <section class="panel" aria-label="Recargar una tarjeta">
        <h2 style="margin-top:0">${ico('refresh')} Recargar una tarjeta</h2>
        <form id="form-recarga" autocomplete="off">
          <div class="campo"><label for="rec-codigo">Código de la tarjeta</label><input id="rec-codigo" class="texto" spellcheck="false" placeholder="Escanee o escriba el código"></div>
          <div class="campo"><label for="rec-monto">Monto a recargar (MXN)</label><input id="rec-monto" inputmode="decimal" placeholder="0.00"></div>
          <div class="campo"><label for="rec-recibido">Efectivo recibido (MXN, opcional)</label><input id="rec-recibido" inputmode="decimal" placeholder="Si lo deja vacío, paga exacto"></div>
          <button class="btn btn-primario" id="btn-recarga" type="submit">${ico('refresh')}<span>Cobrar y recargar</span></button>
        </form>
        <div id="msg-recarga" class="mensaje" role="status" aria-live="polite"></div>
        <p class="nota">La recarga en efectivo reinicia los 12 meses. Lo devuelto por cambios o devoluciones no los reinicia.</p>
      </section>
      <section class="panel" aria-label="Consultar saldo">
        <h2 style="margin-top:0">${ico('search')} Consultar saldo</h2>
        <form id="form-saldo" autocomplete="off">
          <div class="campo"><label for="saldo-codigo">Código de la tarjeta</label><input id="saldo-codigo" class="texto" spellcheck="false" placeholder="Escanee o escriba el código"></div>
          <button class="btn" id="btn-saldo" type="submit">${ico('search')}<span>Consultar</span></button>
        </form>
        <div id="resultado-saldo" class="mensaje" role="status" aria-live="polite"></div>
      </section>
    </div>
    <section class="panel" style="margin-top:12px"><h2 style="margin-top:0">Tarjetas vendidas en esta caja</h2>
      <div class="tabla-cont"><table id="tabla-tarjetas"><thead><tr><th>Código</th><th class="num">Cargado</th><th class="num">Usado</th><th class="num">Saldo</th><th>Vigente hasta</th></tr></thead><tbody>
      ${tarjetas.map((t) => filaTarjeta(t, false)).join('') || '<tr><td colspan="5" class="vacio">Esta caja aún no ha vendido tarjetas.</td></tr>'}</tbody></table></div></section>`;
  const enviar = (form, ruta, campos, msgId, titulo) => $(form).addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const m = $(msgId);
    const monto = parseMXN($(campos.monto).value);
    const recTxt = $(campos.recibido).value.trim();
    const recibido = recTxt ? parseMXN(recTxt) : undefined;
    if (monto === null || monto <= 0) { m.className = 'mensaje error'; m.textContent = 'Escriba un monto válido en pesos (por ejemplo 500 o 500.00).'; return; }
    if (recTxt && recibido === null) { m.className = 'mensaje error'; m.textContent = 'El efectivo recibido no es un importe válido.'; return; }
    try {
      const r = await api(ruta, { codigo: $(campos.codigo).value, monto, ...(recibido !== undefined ? { recibido } : {}), ref: crypto.randomUUID() });
      dialogoTicketTarjeta(titulo, r);
    } catch (e) { m.className = 'mensaje error'; m.textContent = e.message; }
  });
  enviar('#form-alta', '/api/tarjeta/alta', { codigo: '#alta-codigo', monto: '#alta-monto', recibido: '#alta-recibido' }, '#msg-alta', 'Tarjeta de regalo vendida');
  enviar('#form-recarga', '/api/tarjeta/recargar', { codigo: '#rec-codigo', monto: '#rec-monto', recibido: '#rec-recibido' }, '#msg-recarga', 'Tarjeta de regalo recargada');
  $('#form-saldo').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const m = $('#resultado-saldo');
    try {
      const { tarjeta: t } = await api(`/api/tarjeta?codigo=${encodeURIComponent($('#saldo-codigo').value)}`);
      m.className = `mensaje ${t.vencida ? 'error' : 'ok'}`;
      m.innerHTML = `Tarjeta <b>${esc(t.codigo)}</b>: saldo <b id="saldo-consultado">${mxn(t.saldo)}</b> (cargado ${mxn(t.emitido + t.recargado)}, usado ${mxn(t.usado)}${t.reintegrado ? `, devuelto a la tarjeta ${mxn(t.reintegrado)}` : ''}). ${t.vencida ? `<b id="tarjeta-vencida">VENCIDA el ${esc(venceTxt(t.vigente_hasta))}</b>` : `Vigente hasta ${esc(venceTxt(t.vigente_hasta))}.`}`;
    } catch (e) { m.className = 'mensaje error'; m.textContent = e.message; }
  });
}

// ── Hacer cambio: se busca la venta de la tienda, pero solo se cambia en la caja donde se hizo ──
async function vistaDevolucion() {
  const hoy = S.estado.fecha_local;
  $('#vista').innerHTML = `<div class="titulo-vista">${ico('undo')}<h1>Hacer cambio</h1></div>
    <section class="panel" aria-label="Buscar la venta">
      <p class="nota" style="margin-top:0">Busque por fecha y hora, escaneando el artículo, o por folio. El cambio se hace <b>solo en la caja donde se vendió</b>; si la venta es de la otra caja se le indica cuál. Las piezas que regresa la clienta se descuentan en negativo de lo que se lleve, en la misma operación.</p>
      <form id="form-buscar-venta" class="filtros" autocomplete="off">
        <label>Fecha <input type="date" id="bv-fecha" value="${hoy}" min="${minHistorialCaja()}" max="${hoy}"></label>
        <label>Desde <input type="time" id="bv-desde" value="00:00"></label>
        <label>Hasta <input type="time" id="bv-hasta" value="23:59"></label>
        <label>Artículo (escanee) <input id="bv-codigo" class="texto" style="padding:6px;border:1px solid var(--borde);border-radius:6px;background:var(--superficie)" spellcheck="false"></label>
        <label>Folio <input id="bv-folio" placeholder="D2-000003" style="width:130px;padding:6px;border:1px solid var(--borde);border-radius:6px;background:var(--superficie)"></label>
        <button class="btn btn-primario" type="submit" style="width:auto">${ico('search')}<span>Buscar venta</span></button>
        <button class="btn" type="button" id="bv-volver">${ico('cart')}<span>Volver a la venta</span></button>
      </form>
      <div id="bv-msg" class="mensaje" role="status" aria-live="polite"></div>
    </section>
    <div id="bv-resultados"></div>`;
  $('#bv-volver').addEventListener('click', () => ir('venta'));
  $('#form-buscar-venta').addEventListener('submit', async (ev) => { ev.preventDefault(); await buscarVentasDev(); });
  if (S.buscarFolio) { $('#bv-folio').value = S.buscarFolio; S.buscarFolio = null; await buscarVentasDev(); }
  else $('#bv-codigo').focus();
}
async function buscarVentasDev() {
  const m = $('#bv-msg');
  const p = new URLSearchParams();
  const codigo = $('#bv-codigo').value.trim(), folio = $('#bv-folio').value.trim();
  // Con artículo escaneado no hace falta la fecha: se muestra su historial de ventas en la tienda.
  if (!codigo) { p.set('fecha', $('#bv-fecha').value); p.set('desde', $('#bv-desde').value); p.set('hasta', $('#bv-hasta').value); }
  if (codigo) p.set('codigo', codigo);
  if (folio) p.set('folio', folio);
  try {
    const r = await api(`/api/ventas/buscar?${p}`);
    m.className = r.hub && !r.aviso ? 'mensaje' : 'mensaje aviso';
    m.textContent = r.aviso ? r.aviso : r.hub ? (r.articulo ? `Historial de ventas de ${r.articulo.descripcion} ${r.articulo.marca}.` : '') : 'Sin conexión con el hub: solo se muestran las ventas de esta caja.';
    $('#bv-resultados').innerHTML = r.resultados.length ? r.resultados.map((v) => ventaDevHtml(v)).join('') : '<div class="panel vacio" id="bv-vacio">No se encontró ninguna venta con esos datos.</div>';
    for (const f of $('#bv-resultados').querySelectorAll('form[data-sale]')) f.addEventListener('submit', (ev) => { ev.preventDefault(); aceptarCambio(f); });
  } catch (e) { m.className = 'mensaje error'; m.textContent = e.message; }
}
function ventaDevHtml(v) {
  const cab = `<div class="cab" style="display:flex;flex-wrap:wrap;gap:8px 14px;align-items:center"><b>${esc(v.codigo_ticket)}</b><span>${esc(fechaHora(v.ocurrio_en))}</span><span class="insignia">Caja ${v.caja}</span>${v.propia && v.total !== null ? `<span>Total ${mxn(v.total)}</span>` : ''}</div>`;
  if (!v.propia) {
    return `<section class="panel" data-venta-ajena="${esc(v.sale_id)}" style="margin-top:12px">${cab}
      <ul style="margin:8px 0">${v.lineas.map((l) => `<li>${esc(l.descripcion)} · ${l.qty} pza.</li>`).join('')}</ul>
      <div class="mensaje aviso">Esta venta se hizo en la <b>Caja ${v.caja}</b>. La devolución se hace en esa caja.</div></section>`;
  }
  return `<section class="panel" data-venta-propia="${esc(v.sale_id)}" style="margin-top:12px">${cab}
    <form data-sale="${esc(v.sale_id)}" autocomplete="off">
      <div class="tabla-cont"><table><thead><tr><th>Artículo</th><th class="num">Vendidas</th><th class="num">Ya cambiadas</th><th class="num">Importe</th><th class="num">Cambiar</th></tr></thead><tbody>
      ${v.lineas.map((l) => {
        const max = l.tarjeta_regalo ? 0 : l.qty - (l.devuelto ?? 0);
        return `<tr><td>${esc(l.descripcion)}${l.marca ? ` · ${esc(l.marca)}` : ''}${l.item_no ? ` · Item # ${esc(l.item_no)}` : ''}</td><td class="num">${l.qty}</td><td class="num">${l.devuelto ?? 0}</td><td class="num">${mxn(l.importe ?? 0)}</td>
        <td class="num">${l.tarjeta_regalo ? '<small>no se devuelve</small>' : `<input type="number" min="0" max="${max}" value="0" ${max === 0 ? 'disabled' : ''} data-linea="${esc(l.linea_id)}" style="width:64px;text-align:right;padding:4px;border:1px solid var(--borde);border-radius:6px;background:var(--superficie)" aria-label="Piezas a devolver de ${esc(l.descripcion)}">`}</td></tr>`;
      }).join('')}</tbody></table></div>
      <div class="filas" style="margin-top:10px;align-items:center"><span class="nota" style="flex:3;min-width:200px;margin:0">No devuelve dinero: lo recibido a cambio se descuenta en la misma operación.</span>
        <button class="btn btn-primario" type="submit" style="width:auto;flex:1">${ico('check')}<span>Aceptar cambio</span></button></div>
      <div class="mensaje" data-msg role="status"></div>
    </form></section>`;
}
async function aceptarCambio(form) {
  const m = form.querySelector('[data-msg]');
  const renglones = [...form.querySelectorAll('input[data-linea]')].map((i) => ({ linea_id: i.dataset.linea, qty: Number(i.value) })).filter((x) => x.qty > 0);
  if (!renglones.length) { m.className = 'mensaje error'; m.textContent = 'Indique cuántas piezas se cambian.'; return; }
  const datos = await pedirDatosCambio();
  if (!datos) return;
  try {
    if (!S.cart) { const r = await api('/api/venta/actual', {}); S.cart = r.cart; S.carrito = r.carrito; }
    const r = await api('/api/venta/cambio/iniciar', { cart: S.cart, sale_id: form.dataset.sale, renglones, clienta: datos.clienta, motivo: datos.motivo });
    S.carrito = r.carrito; S.sel = null;
    await ir('venta');
    msg('Cambio aceptado: las piezas quedaron en negativo. Escanee los artículos por los que cambia.');
  } catch (e) { m.className = 'mensaje error'; m.textContent = e.message; }
}
async function quitarCambio() {
  try { const r = await api('/api/venta/cambio/quitar', { cart: S.cart }); S.carrito = r.carrito; pintarCarrito(); msg('Cambio quitado de la venta.'); }
  catch (e) { msg(e.message, 'error'); }
}
/** «No hay cambio posible, devolver dinero»: el saldo sale en efectivo; la misma Vendedora-Cajera u otra (o un supervisor) lo autoriza con su clave. */
async function abrirDevolverDinero() {
  const monto = S.carrito.cambio?.saldo_favor ?? 0;
  if (!(monto > 0)) return;
  if (S.carrito.lineas.length && exigeVendedora()) return msg('Elija quién vendió antes de continuar.', 'aviso');
  const a = await api('/api/venta/autorizadores-efectivo');
  const d = dialogo('dlg-devolver-dinero');
  d.setAttribute('aria-labelledby', 'dd-titulo');
  d.innerHTML = `<h2 id="dd-titulo" style="margin-top:0">Devolver dinero</h2>
    <p id="dd-texto" style="font-size:17px">No hay cambio posible: se entregan <b>${mxn(monto)}</b> en efectivo a la clienta.</p>
    <form id="form-devolver-dinero" autocomplete="off">
      ${a.pide_clave ? `<p class="nota" style="margin-top:0">Devolución de efectivo autorizada por quien teclee aquí su clave (la misma Vendedora-Cajera, otra o un supervisor).</p>
      <div class="campo"><label for="dd-quien">Autoriza</label><select id="dd-quien" style="width:100%;padding:10px;border:2px solid var(--borde);border-radius:10px;background:var(--superficie)">${a.autorizadores.map((x) => `<option value="${esc(x.nombre)}" ${x.nombre === a.actual ? 'selected' : ''}>${esc(x.nombre)}${x.tipo === 'supervisor' ? ' (supervisor)' : ''}</option>`).join('')}</select></div>
      <div class="campo"><label for="dd-clave">Su clave</label><input id="dd-clave" type="text" data-pin inputmode="numeric" autocomplete="off" placeholder="••••"></div>` : ''}
      <div id="msg-dd" class="mensaje" role="alert"></div>
      <div class="filas"><button class="btn" type="button" id="dd-no">Cancelar</button><button class="btn btn-peligro" type="submit" id="dd-ok" style="width:auto;flex:1">${ico('cash')}<span>Devolver ${mxn(monto)}</span></button></div>
    </form>`;
  $('#dd-no').addEventListener('click', () => d.close());
  $('#form-devolver-dinero').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const m = $('#msg-dd');
    if (a.pide_clave && (!$('#dd-quien').value || !$('#dd-clave').value)) { m.className = 'mensaje error'; m.textContent = 'Elija quién autoriza y teclee su clave.'; return; }
    try {
      const r = await api('/api/venta/cambio/devolver-dinero', { cart: S.cart, ...(a.pide_clave ? { autoriza: { nombre: $('#dd-quien').value, clave: $('#dd-clave').value } } : {}) });
      d.close();
      mostrarDevolucionEfectivo(r);
    } catch (e) { m.className = 'mensaje error'; m.textContent = e.message; const c = $('#dd-clave'); if (c) c.value = ''; }
  });
  d.showModal();
  ($('#dd-clave') ?? $('#dd-no')).focus();
}
function mostrarDevolucionEfectivo(r) {
  const d = r.devolucion;
  const efectivo = d.reembolsos.filter((x) => x.metodo === 'efectivo').reduce((acc, x) => acc + x.monto, 0);
  const dlg = $('#dlg-ticket');
  dlg.innerHTML = `<h2 id="dlg-titulo" style="margin:0 0 4px">Devolución de efectivo registrada</h2>
    <p style="margin:0" id="resumen-devolucion">Folio <b>${String(d.folio).padStart(6, '0')}</b> · efectivo entregado <b>${mxn(efectivo)}</b>${d.autorizado_por ? ` · devolución de efectivo autorizada por <b id="dd-autorizo">${esc(d.autorizado_por)}</b>` : ''}${r.venta ? ` · venta del cambio folio <b>${String(r.venta.folio).padStart(6, '0')}</b>` : ''}</p>
    <div class="mensaje ${r.impresion.ok ? 'ok' : 'error'}" id="estado-impresion" role="status">${r.impresion.ok ? 'Ticket enviado a la impresora.' : `La impresora falló: ${esc(r.impresion.error)}. La devolución SÍ quedó guardada.`}</div>
    ${logoTicketHtml()}<pre class="ticket" id="ticket-texto" tabindex="0">${esc(r.ticket_texto)}</pre>
    <div class="filas"><button class="btn btn-primario" id="btn-nueva" type="button" style="width:auto;flex:1">${ico('plus')}<span>Nueva venta</span></button></div>`;
  dlg.showModal();
  void imprimirNavegador(r.ticket_texto);
  cerrarTicketYVentaNueva(dlg, pintarEncabezado);
}

// ── tipo de cambio del dólar (barra izquierda) ──
async function pintarTipoCambio() {
  const el = $('#tc-barra');
  if (!el || !S.sesion) return;
  let t;
  if (S.sesion.rol === 'admin') {
    const v = (await api('/api/admin/tipo-cambio?pasivo=1')).vigente;
    t = v ? { configurado: true, texto: v.texto, version: v.version, actualizado_en: v.ocurrio_en, cambiado_por: v.usuario, verificado: true, puede_editar: true } : { configurado: false, puede_editar: true };
  } else t = S.estado?.tipo_cambio;
  if (!t) return;
  S.tc = t;
  const lapiz = t.puede_editar ? `<button type="button" id="btn-editar-tc" class="tc-lapiz" aria-label="Editar tipo de cambio" title="Editar tipo de cambio">${ico('pencil')}</button>` : '';
  const sv = t.sin_verificar;
  const alerta = sv && sv.nivel !== 'ok' ? `<small class="det tc-estado mal" data-tc="sin-verificar">Sin verificar hace ${sv.horas} h${sv.nivel === 'bloqueada_usd' ? ': NO se reciben dólares' : ''}</small>` : '';
  const estado = t.verificado === true ? ['ok', 'Sincronizado con el central'] : t.verificado === false ? ['mal', 'Sin conexión: no se puede verificar si hay una tasa nueva'] : ['', 'Sin dato de conexión con el central'];
  el.innerHTML = t.configurado
    ? `<div class="tc-linea"><span data-tc="tasa">Dólar: <b>$${esc(t.texto)} MXN</b></span>${lapiz}</div>
       <small class="det" data-tc="fecha">Actualizado ${esc(fechaCorta(t.actualizado_en))} · v${t.version}${t.cambiado_por ? ` · ${esc(t.cambiado_por)}` : ''}</small>
       <small class="det tc-estado ${estado[0]}" data-tc="estado">${estado[1]}</small>${alerta}`
    : `<div class="tc-linea"><span data-tc="tasa">Dólar: <b>sin definir</b></span>${lapiz}</div><small class="det">No se pueden recibir dólares hasta fijar el tipo de cambio.</small>`;
  $('#btn-editar-tc')?.addEventListener('click', abrirEditarTc);
}
function abrirEditarTc() {
  const dlg = $('#dlg-tc');
  const t = S.tc;
  dlg.innerHTML = `<h2 id="tc-titulo" style="margin:0 0 4px">Tipo de cambio del dólar</h2>
    <p class="nota" style="margin:0 0 8px">Tipo de cambio comercial fijado por nosotros: pesos mexicanos por 1 dólar. Solo se usa para recibir dólares en efectivo.</p>
    <form id="form-tc" autocomplete="off">
      <div class="campo"><label for="tc-valor">MXN por 1 USD</label><input id="tc-valor" inputmode="decimal" value="${t?.configurado ? esc(t.texto) : ''}" placeholder="18.00"></div>
      <div id="tc-msg" class="mensaje" role="status" aria-live="polite"></div>
      <div class="filas"><button class="btn" id="tc-cancelar" type="button">${ico('x')}<span>Cancelar</span></button><button class="btn btn-primario" id="tc-guardar" type="submit" style="width:auto;flex:2">${ico('check')}<span>Guardar para todas las tiendas</span></button></div>
    </form>
    <p class="nota">Aplica a los cobros nuevos de todas las tiendas conectadas. Los cobros ya iniciados y las ventas anteriores conservan su tasa. Requiere conexión con el servicio central.</p>`;
  dlg.showModal();
  $('#tc-valor').select();
  let confirmado = false;
  $('#tc-valor').addEventListener('input', () => { confirmado = false; $('#tc-guardar').innerHTML = `${ico('check')}<span>Guardar para todas las tiendas</span>`; $('#tc-msg').textContent = ''; $('#tc-msg').className = 'mensaje'; });
  $('#tc-cancelar').addEventListener('click', () => dlg.close());
  $('#form-tc').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const m = $('#tc-msg');
    const tasa = parseTasa($('#tc-valor').value);
    if (tasa === null) { m.className = 'mensaje error'; m.textContent = 'Escriba un número positivo, con hasta 4 decimales (por ejemplo 18.00).'; return; }
    try {
      await api(S.sesion.rol === 'admin' ? '/api/admin/tipo-cambio' : '/api/tipo-cambio', { tasa, ...(confirmado ? { confirmar: true } : {}) });
      dlg.close();
      await pintarEncabezado();
      if (S.vista === 'configuracion' && S.configTab === 'tipo_cambio') await vistaTipoCambio();
    } catch (e) {
      m.className = 'mensaje error';
      if (e.codigo === 'CONFIRMACION_REQUERIDA') {
        // Cambio de más del 10 %: una confirmación adicional (no se pide doble autorización).
        const pct = (Math.abs(e.detalle.variacion_pb) / 100).toFixed(2);
        m.textContent = `Atención: este cambio es de ${e.detalle.variacion_pb > 0 ? '+' : '−'}${pct} % (de $${(e.detalle.anterior / 10000).toFixed(2)} a $${(e.detalle.nueva / 10000).toFixed(2)}). ¿Es correcto?`;
        confirmado = true;
        $('#tc-guardar').innerHTML = `${ico('check')}<span>Sí, confirmar el cambio</span>`;
      } else m.textContent = e.message;
    }
  });
}

// ── procedimiento operativo: rechazar un billete dañado o sospechoso ──

// ── Administración: cortes consolidados con pesos y dólares en columnas separadas ──
async function vistaCortes() {
  const hoy = new Date(Date.now() - 7 * 3600e3).toISOString().slice(0, 10);
  $('#vista').innerHTML = `<div class="titulo-vista">${ico('register')}<h1>Cortes de caja</h1><button class="btn" id="btn-ir-dolares" type="button" style="margin-left:auto">${ico('dollar')}<span>Dólares recibidos</span></button></div>
    <form class="filtros panel" id="filtros-cortes"><label>Desde <input type="date" id="cor-desde" value="${hoy}"></label><label>Hasta <input type="date" id="cor-hasta" value="${hoy}"></label>
      <button class="btn btn-primario" type="submit" style="width:auto">${ico('search')}<span>Consultar</span></button></form>
    <div id="resultado-cortes"></div>`;
  $('#btn-ir-dolares').addEventListener('click', () => ir('dolares'));
  const consultar = async () => {
    const { cortes } = await api('/api/admin/cortes', { desde: $('#cor-desde').value, hasta: $('#cor-hasta').value });
    const vacio = { fondo: 0, cobros: 0, cambio: 0, entradas: 0, devoluciones: 0, cancelaciones: 0, retiros: 0, esperado: 0, contado: null, diferencia: null };
    const fila = (c) => ({ ...c, mxn: c.mxn ?? { ...vacio, esperado: c.efectivo_esperado ?? 0 }, usd: c.usd ?? { ...vacio, equivalente_historico_mxn: 0 } });
    const rows = cortes.map(fila);
    const suma = (k, m) => rows.reduce((a, r) => a + (r[m][k] ?? 0), 0);
    const dif = (v, f) => (v === null ? '—' : (v < 0 ? '-' : '') + f(Math.abs(v)));
    const bloque = (r, m, f) => ['fondo', 'cobros', 'cambio', 'entradas', 'devoluciones', 'cancelaciones', 'retiros', 'esperado'].map((k) => `<td class="num" data-col="${m}-${k}">${f(r[m][k])}</td>`).join('')
      + `<td class="num" data-col="${m}-contado">${r[m].contado === null ? '—' : f(r[m].contado)}</td><td class="num" data-col="${m}-diferencia"><b>${dif(r[m].diferencia, f)}</b></td>`;
    const total = (m, f) => ['fondo', 'cobros', 'cambio', 'entradas', 'devoluciones', 'cancelaciones', 'retiros', 'esperado'].map((k) => `<td class="num" data-total="${m}-${k}"><b>${f(suma(k, m))}</b></td>`).join('') + '<td></td><td></td>';
    $('#resultado-cortes').innerHTML = `<div class="panel"><p class="nota" style="margin-top:0">Cortes cerrados. <b>Pesos y dólares son dinero físico distinto</b> y nunca se suman. El equivalente en MXN de los dólares es un dato contable (cada operación con su tasa), no pesos dentro del cajón.</p>
      <div class="tabla-cont"><table id="tabla-cortes"><thead>
        <tr><th rowspan="2">Tienda</th><th rowspan="2">Caja</th><th rowspan="2">Fecha</th><th rowspan="2" class="num">Tickets</th><th rowspan="2" class="num">Ventas netas MXN</th><th colspan="10">PESOS (MXN) físicos</th><th colspan="10">DÓLARES (USD) físicos</th><th rowspan="2" class="num">Equivalente histórico MXN de los USD (contable)</th></tr>
        <tr>${['Fondo', 'Cobros', 'Cambio', 'Entradas', 'Devol.', 'Cancel.', 'Retiros', 'Esperado', 'Contado', 'Diferencia'].map((h) => `<th class="num">${h}</th>`).join('')}${['Fondo', 'Cobros', 'Cambio', 'Entradas', 'Devol.', 'Cancel.', 'Retiros', 'Esperado', 'Contado', 'Diferencia'].map((h) => `<th class="num">${h}</th>`).join('')}</tr></thead><tbody>
      ${rows.map((r) => `<tr data-corte="${esc(r.tienda)}-${r.caja}-${esc(r.fecha)}"><td>${esc(r.tienda)}</td><td>${r.caja}</td><td>${esc(r.fecha)}</td><td class="num">${r.tickets}</td><td class="num">${mxn(r.ventas_netas)}</td>${bloque(r, 'mxn', mxn)}${bloque(r, 'usd', usd)}<td class="num" data-col="equivalente">${mxn(r.usd.equivalente_historico_mxn ?? r.usd_equivalente_mxn_historico ?? 0)}</td></tr>`).join('') || '<tr><td colspan="26" class="vacio">Sin cortes cerrados en el periodo.</td></tr>'}
      ${rows.length ? `<tr><th colspan="5" scope="row">Total</th>${total('mxn', mxn)}${total('usd', usd)}<td class="num" data-total="equivalente"><b>${mxn(rows.reduce((a, r) => a + (r.usd.equivalente_historico_mxn ?? 0), 0))}</b></td></tr>` : ''}</tbody></table></div></div>`;
  };
  $('#filtros-cortes').addEventListener('submit', async (ev) => { ev.preventDefault(); await consultar(); });
  await consultar();
}

// ── Administración: dólares recibidos y tipo de cambio ──
async function exportarArchivo(ruta, archivo) {
  if (window.__POS_EXPORTAR__) return window.__POS_EXPORTAR__(ruta, archivo);
  const a = document.createElement('a'); a.href = ruta; a.download = archivo;
  document.body.appendChild(a); a.click(); a.remove();
  return 'Descarga iniciada.';
}
async function vistaDolares() {
  const hoy = new Date(Date.now() - 7 * 3600e3).toISOString().slice(0, 10);
  $('#vista').innerHTML = `<div class="titulo-vista">${ico('dollar')}<h1>Dólares recibidos</h1><button class="btn" id="btn-volver-cortes" type="button" style="margin-left:auto">${ico('undo')}<span>Volver a cortes</span></button></div>
    <form class="filtros panel" id="filtros-usd"><label>Desde <input type="date" id="usd-desde" value="${hoy}"></label><label>Hasta <input type="date" id="usd-hasta" value="${hoy}"></label>
      <button class="btn btn-primario" type="submit" style="width:auto">${ico('search')}<span>Consultar</span></button>
      <button class="btn" type="button" id="btn-exportar-dolares">${ico('download')}<span>Exportar a Excel</span></button><span id="estado-exportar-usd" role="status" aria-live="polite"></span></form>
    <div id="resultado-usd"></div>`;
  const consultar = async () => {
    const q = `desde=${$('#usd-desde').value}&hasta=${$('#usd-hasta').value}`;
    const { reporte: r } = await api(`/api/admin/dolares?${q}`);
    $('#resultado-usd').innerHTML = `<div class="panel"><p class="nota" style="margin-top:0">Dólares FÍSICOS recibidos. El equivalente en MXN usa la tasa de cada operación, no la última del día. El cambio se entrega en pesos.</p>
      <div class="tabla-cont"><table id="tabla-dolares"><thead><tr><th>Tienda</th><th>Caja</th><th>Folio</th><th>Fecha</th><th>Vendedora-Cajera</th><th class="num">USD</th><th class="num">Tasa</th><th class="num">Equivalente MXN</th><th class="num">Pesos recibidos</th><th class="num">Cambio MXN</th><th>Estado</th></tr></thead><tbody>
      ${r.filas.map((f) => `<tr data-folio="${f.folio}"><td>${esc(f.tienda)}</td><td>${f.caja}</td><td>${String(f.folio).padStart(6, '0')}</td><td>${esc(f.fecha_local)} ${esc(f.hora)}</td><td>${esc(f.cajero)}</td><td class="num">${usd(f.usd)}</td><td class="num">${(f.tasa / 10000).toFixed(2)} (v${f.tasa_version})</td><td class="num">${mxn(f.equivalente)}</td><td class="num">${mxn(f.pesos_recibidos)}</td><td class="num">${mxn(f.cambio_mxn)}</td><td>${esc(f.estado)}</td></tr>`).join('') || '<tr><td colspan="11" class="vacio">Sin cobros con dólares en el periodo.</td></tr>'}</tbody></table></div>
      <h2>Por caja</h2><table id="tabla-dolares-caja"><thead><tr><th>Tienda</th><th>Caja</th><th class="num">Cobros</th><th class="num">USD físicos</th><th class="num">Equivalente histórico MXN</th></tr></thead><tbody>
      ${r.porCaja.map((c) => `<tr><td>${esc(c.tienda)}</td><td>${c.caja}</td><td class="num">${c.cobros}</td><td class="num">${usd(c.usd)}</td><td class="num">${mxn(c.equivalente_historico)}</td></tr>`).join('')}
      <tr><th colspan="3" scope="row">Total</th><td class="num" id="total-usd"><b>${usd(r.usd)}</b></td><td class="num" id="total-equivalente"><b>${mxn(r.equivalente_historico)}</b></td></tr></tbody></table></div>`;
  };
  $('#btn-volver-cortes').addEventListener('click', () => ir('cortes'));
  $('#filtros-usd').addEventListener('submit', async (ev) => { ev.preventDefault(); await consultar(); });
  $('#btn-exportar-dolares').addEventListener('click', async () => {
    const e = $('#estado-exportar-usd');
    e.textContent = 'Preparando el archivo…';
    try { e.textContent = await exportarArchivo(`/api/admin/dolares.xlsx?desde=${$('#usd-desde').value}&hasta=${$('#usd-hasta').value}`, 'dolares-recibidos.xlsx'); } catch (err) { e.textContent = `No se pudo exportar: ${err.message}`; }
  });
  await consultar();
}


// ── Reporte de promociones y descuentos autorizados por supervisor ──
const pctBp = (bp) => `${(bp / 100).toFixed(2).replace(/\.00$/, '')} %`;
const NOM_TIPO_DESC = { promo: 'Promoción', cupon: 'Cupón', manual: 'Manual (con clave)', empleada: 'Descuento de empleada' };
// ── retiro de efectivo ──
/** Ventana flotante (no modal: no bloquea el escaneo ni el cobro) cuando el efectivo de venta de la caja llega al umbral. «Más tarde» la oculta 15 minutos. */
async function revisarAvisoRetiro() {
  if (S.sesion?.rol !== 'cajero' || !S.sesion.nav.includes('retiro') || S.vista === 'retiro') return;
  try {
    const { retiro: e } = await api('/api/retiro');
    S.retiroEstado = e;
    const d = dialogo('dlg-retiro-aviso');
    if (!e.avisar) { if (d.open) d.close(); return; }
    if (d.open || (S.retiroAvisoHasta ?? 0) > Date.now()) return;
    d.className = 'aviso-flotante';
    d.setAttribute('role', 'alertdialog');
    d.setAttribute('aria-labelledby', 'ret-aviso-titulo');
    d.innerHTML = `<h2 id="ret-aviso-titulo" style="margin:0 0 6px">${ico('cash')} Es hora de un retiro</h2>
      <p style="margin:0 0 10px">La caja tiene <b id="ret-aviso-monto">${mxn(e.venta.equivalente)}</b> de efectivo de venta (sin contar el fondo). Puede seguir vendiendo.</p>
      <div class="filas"><button class="btn" type="button" id="ret-aviso-despues">Más tarde</button><button class="btn btn-primario" type="button" id="ret-aviso-ir" style="width:auto;flex:1">${ico('cash')}<span>Hacer el retiro</span></button></div>`;
    $('#ret-aviso-despues').addEventListener('click', () => { S.retiroAvisoHasta = Date.now() + 15 * 60e3; d.close(); });
    $('#ret-aviso-ir').addEventListener('click', () => { d.close(); ir('retiro'); });
    d.show();
  } catch { /* el aviso es una ayuda: si falla, la venta sigue */ }
}
async function vistaRetiro() {
  const { retiro: e } = await api('/api/retiro');
  S.retiroEstado = e;
  const hoyOk = e.venta.equivalente;
  const retiroId = uuid();
  const nomUsd = (d) => `US$${d}`;
  $('#vista').innerHTML = `<div class="titulo-vista">${ico('cash')}<h1>Retiro de efectivo</h1></div>
    <section class="panel" id="ret-resumen">
      <p class="nota" style="margin-top:0">Efectivo de venta en la caja (sin contar el fondo inicial). Con ${mxn(e.umbral)} el sistema avisa que toca un retiro; el aviso nunca bloquea la venta.</p>
      <table><tbody>
        <tr><th scope="row">Pesos de venta</th><td class="num" data-campo="mxn">${mxn(e.venta.mxn)}</td></tr>
        <tr><th scope="row">Dólares de venta</th><td class="num" data-campo="usd">${usd(e.venta.usd)}${e.venta.tasa && e.venta.usd > 0 ? ` <span class="nota">(${mxn(e.venta.equivalente - e.venta.mxn)} al tipo de cambio)</span>` : ''}</td></tr>
        <tr><th scope="row">Total en pesos</th><td class="num" data-campo="equivalente"><b>${mxn(hoyOk)}</b></td></tr>
      </tbody></table>
      <div class="mensaje ${e.avisar ? 'aviso' : ''}" id="ret-aviso" role="status">${e.avisar ? 'Ya toca un retiro.' : ''}</div></section>
    <section class="panel" style="margin-top:12px"><h2 style="margin-top:0">Billetes que se retiran</h2>
      <p class="nota" style="margin-top:0">Tome billetes grandes y dólares hasta completar al menos <b>${mxn(e.minimo)}</b> (o su equivalente en dólares). No tiene que ser exactamente ${mxn(e.umbral)}.</p>
      <div class="filas" style="align-items:flex-start;gap:24px;flex-wrap:wrap">
        <table id="ret-tabla-mxn"><thead><tr><th>Pesos</th><th class="num">Cantidad</th><th class="num">Importe</th></tr></thead><tbody>
        ${e.billetes.mxn.map((d) => `<tr><td>${mxn(d)}</td><td class="num"><input type="number" min="0" step="1" class="ret-mxn" data-den="${d}" aria-label="Billetes de ${mxn(d)}" style="width:80px;text-align:right"></td><td class="num" data-sub="mxn-${d}">${mxn(0)}</td></tr>`).join('')}</tbody></table>
        <table id="ret-tabla-usd"><thead><tr><th>Dólares</th><th class="num">Cantidad</th><th class="num">Importe</th></tr></thead><tbody>
        ${e.billetes.usd.map((d) => `<tr><td>${nomUsd(d)}</td><td class="num"><input type="number" min="0" step="1" class="ret-usd" data-den="${d}" aria-label="Billetes de ${nomUsd(d)}" style="width:80px;text-align:right"></td><td class="num" data-sub="usd-${d}">${usd(0)}</td></tr>`).join('')}</tbody></table>
      </div>
      <dl class="calc-usd"><dt>Pesos</dt><dd id="ret-t-mxn">${mxn(0)}</dd><dt>Dólares</dt><dd id="ret-t-usd">${usd(0)}</dd><dt>Total a retirar (MXN)</dt><dd id="ret-total"><b>${mxn(0)}</b></dd></dl>
      ${e.pide_clave ? `<div class="campo" style="max-width:260px"><label for="ret-clave">Su clave (${esc(S.sesion.usuario ?? '')}) para confirmar el retiro</label><input id="ret-clave" type="text" data-pin inputmode="numeric" autocomplete="off" placeholder="••••"></div>` : ''}
      <div class="mensaje" id="ret-estado" role="status" aria-live="polite"></div>
      <button class="btn btn-primario" id="btn-retirar" type="button" disabled>${ico('printer')}<span>Registrar retiro e imprimir</span></button></section>
    <section class="panel" style="margin-top:12px"><h2 style="margin-top:0">Retiros de hoy</h2>
      <table id="tabla-retiros"><thead><tr><th>Retiro</th><th>Hora</th><th>Vendedora-Cajera</th><th class="num">Pesos</th><th class="num">Dólares</th><th class="num">Total (MXN)</th><th></th></tr></thead><tbody>
      ${e.retiros.map((r) => `<tr data-retiro="${esc(r.retiro_id)}"><td>${esc(r.folio_retiro)}</td><td>${esc(hora(r.ocurrio_en))}</td><td>${esc(r.usuario)}</td><td class="num">${mxn(r.mxn.total)}</td><td class="num">${usd(r.usd.total)}</td><td class="num">${mxn(r.equivalente_mxn)}</td><td><button class="btn btn-reimp-retiro" type="button">${ico('printer')}<span>Reimprimir</span></button></td></tr>`).join('') || '<tr><td colspan="7" class="vacio">Sin retiros hoy.</td></tr>'}</tbody></table>
      <div id="msg-retiros" class="mensaje" role="status" aria-live="polite"></div></section>`;
  const cant = (el) => { const n = Number(el.value); return el.value.trim() === '' ? 0 : n; };
  const leer = () => {
    const mx = {}, us = {};
    let tm = 0, tu = 0, valido = true;
    for (const el of document.querySelectorAll('.ret-mxn')) { const n = cant(el); if (!Number.isInteger(n) || n < 0) valido = false; else if (n) { mx[el.dataset.den] = n; tm += Number(el.dataset.den) * n; } $(`[data-sub="mxn-${el.dataset.den}"]`).textContent = mxn(Number.isInteger(n) && n > 0 ? Number(el.dataset.den) * n : 0); }
    for (const el of document.querySelectorAll('.ret-usd')) { const n = cant(el); if (!Number.isInteger(n) || n < 0) valido = false; else if (n) { us[el.dataset.den] = n; tu += Number(el.dataset.den) * 100 * n; } $(`[data-sub="usd-${el.dataset.den}"]`).textContent = usd(Number.isInteger(n) && n > 0 ? Number(el.dataset.den) * 100 * n : 0); }
    return { mx, us, tm, tu, valido };
  };
  const pintar = () => {
    const { tm, tu, valido } = leer();
    const eq = tm + (tu > 0 && e.tasa ? usdAMxn(tu, e.tasa.tasa) : 0);
    $('#ret-t-mxn').textContent = mxn(tm); $('#ret-t-usd').textContent = usd(tu); $('#ret-total').innerHTML = `<b>${mxn(eq)}</b>`;
    let m = '', ok = valido && eq >= e.minimo;
    if (!valido) m = 'Escriba cantidades enteras de billetes.';
    else if (tu > 0 && !e.tasa) { m = 'No hay tipo de cambio fijado: no se pueden retirar dólares.'; ok = false; }
    else if (tm > e.en_cajon.mxn || tu > e.en_cajon.usd) { m = 'El retiro es mayor que el efectivo que registra la caja.'; ok = false; }
    else if (eq < e.minimo) m = eq > 0 ? `Faltan ${mxn(e.minimo - eq)} para llegar al mínimo de ${mxn(e.minimo)}.` : '';
    else m = `Retiro de ${mxn(eq)}: queda ${mxn(e.venta.equivalente - eq)} de efectivo de venta en la caja.`;
    const el = $('#ret-estado'); el.textContent = m; el.className = `mensaje ${ok ? 'ok' : m ? 'aviso' : ''}`;
    if (e.pide_clave && !($('#ret-clave').value.length >= 4)) { ok = false; if (eq >= e.minimo && valido) { el.textContent = `${m} Teclee su clave para confirmar.`; } }
    $('#btn-retirar').disabled = !ok;
  };
  for (const el of document.querySelectorAll('.ret-mxn, .ret-usd, #ret-clave')) el.addEventListener('input', pintar);
  $('#btn-retirar').addEventListener('click', async () => {
    const { mx, us } = leer();
    $('#btn-retirar').disabled = true;
    try {
      const r = await api('/api/retiro', { retiro_id: retiroId, mxn: mx, usd: us, ...(e.pide_clave ? { clave: $('#ret-clave').value } : {}) });
      mostrarTicketRetiro(r);
    } catch (err) { if ($('#ret-clave')) $('#ret-clave').value = ''; pintar(); const el = $('#ret-estado'); el.className = 'mensaje error'; el.textContent = err.message; }
  });
  for (const b of document.querySelectorAll('.btn-reimp-retiro')) b.addEventListener('click', async () => {
    try { mostrarTicketRetiro(await api('/api/retiro/reimprimir', { retiro_id: b.closest('tr').dataset.retiro }), true); } catch (err) { const m = $('#msg-retiros'); m.className = 'mensaje error'; m.textContent = err.message; }
  });
}
function mostrarTicketRetiro(r, reimpresion = false) {
  const d = dialogo('dlg-retiro-ticket');
  d.setAttribute('aria-labelledby', 'ret-tk-titulo');
  const imp = r.impresion;
  d.innerHTML = `<h2 id="ret-tk-titulo" style="margin:0 0 4px">${reimpresion ? 'Retiro reimpreso' : 'Retiro registrado'}</h2>
    <p style="margin:0" id="ret-tk-resumen">Retiro <b>${esc(r.retiro.folio_retiro)}</b> · ${mxn(r.retiro.equivalente_mxn)}</p>
    <div id="ret-tk-impresion" class="mensaje ${imp.ok ? 'ok' : 'error'}" role="status">${imp.ok ? 'Datos del retiro enviados a la impresora.' : `La impresora falló: ${esc(imp.error)}. El retiro SÍ quedó registrado; reimprímalo.`}</div>
    <pre class="ticket" id="ret-tk-texto" tabindex="0">${esc(r.ticket_texto)}</pre>
    <div class="filas"><button class="btn" type="button" id="ret-tk-reimprimir">${ico('printer')}<span>${imp.ok ? 'Reimprimir' : 'Reintentar impresión'}</span></button><button class="btn btn-primario" type="button" id="ret-tk-cerrar" style="width:auto;flex:1">${ico('check')}<span>Listo</span></button></div>`;
  d.showModal();
  void imprimirNavegador(r.ticket_texto, { logo: false });
  $('#ret-tk-cerrar').addEventListener('click', () => { d.close(); S.retiroAvisoHasta = 0; ir('retiro'); });
  $('#ret-tk-reimprimir').addEventListener('click', async () => {
    try {
      const x = await api('/api/retiro/reimprimir', { retiro_id: r.retiro.retiro_id });
      const e2 = $('#ret-tk-impresion'); e2.className = `mensaje ${x.impresion.ok ? 'ok' : 'error'}`; e2.textContent = x.impresion.ok ? 'Datos del retiro enviados a la impresora (reimpresión).' : `La impresora falló: ${x.impresion.error}.`;
    } catch (err) { $('#ret-tk-impresion').textContent = err.message; }
  });
}
// ── conteo físico de El Limbo ──
const CL_LLAVE = 'pos-conteo-limbo';
const clLeer = () => { try { return JSON.parse(localStorage.getItem(CL_LLAVE) ?? 'null'); } catch { return null; } };
const clGuardar = (c) => { try { localStorage.setItem(CL_LLAVE, JSON.stringify(c)); } catch { /* sin almacenamiento: el conteo vive mientras la página esté abierta */ } };
async function vistaConteoLimbo() {
  const C = S.conteoLimbo ?? (S.conteoLimbo = clLeer() ?? { id: uuid(), lineas: [] });
  const { conteos } = await api('/api/admin/limbo/conteos');
  $('#vista').innerHTML = `<div class="titulo-vista">${ico('check')}<h1>Conteo de El Limbo</h1><button class="btn" id="btn-volver-inv" type="button" style="margin-left:auto">${ico('undo')}<span>Volver a inventario</span></button></div>
    <section class="panel"><p class="nota" style="margin-top:0">Escanee o escriba el código de cada artículo: <b>cada escaneo cuenta una pieza</b>. También puede importar un Excel con las columnas CODIGO y CANTIDAD. Al aplicar el conteo, cada artículo contado queda en El Limbo con la cantidad contada; <b>los artículos que no cuente no se tocan</b>.</p>
      <form id="cl-form" class="filas" autocomplete="off"><input id="cl-scan" class="texto" placeholder="Escanee o escriba el código" style="flex:1"><button class="btn btn-primario" type="submit" style="width:auto">${ico('plus')}<span>Contar</span></button>
        <button class="btn" type="button" id="cl-importar">${ico('upload')}<span>Importar Excel de conteo</span></button><input type="file" id="cl-archivo" accept=".xlsx" hidden></form>
      <div id="msg-cl" class="mensaje" role="status" aria-live="polite"></div></section>
    <section class="panel" style="margin-top:12px"><div id="cl-resumen" class="nota" style="margin:0 0 8px"></div>
      <div class="tabla-cont"><table id="cl-tabla"><thead><tr><th>Item #</th><th>Código</th><th>Descripción</th><th class="num">En el sistema</th><th class="num">Contadas</th><th class="num">Diferencia</th><th></th></tr></thead><tbody></tbody></table></div>
      <div class="filas" style="margin-top:8px"><button class="btn" type="button" id="cl-vaciar">${ico('trash')}<span>Vaciar conteo</span></button><button class="btn btn-primario" type="button" id="cl-aplicar" style="width:auto;flex:1">${ico('check')}<span>Aplicar conteo</span></button></div></section>
    <section class="panel" style="margin-top:12px"><h2 style="margin-top:0">Conteos anteriores</h2><table id="cl-historial"><thead><tr><th>Fecha</th><th>Registró</th><th class="num">Artículos</th><th class="num">Con diferencia</th><th class="num">Sobrantes</th><th class="num">Faltantes</th></tr></thead><tbody>
      ${conteos.map((c) => `<tr data-conteo="${esc(c.conteo_id)}"><td>${esc(c.ocurrio_en.slice(0, 10))} ${esc(hora(c.ocurrio_en))}</td><td>${esc(c.por)}</td><td class="num">${c.articulos}</td><td class="num">${c.con_diferencia}</td><td class="num">${c.sobrantes}</td><td class="num">${c.faltantes}</td></tr>`).join('') || '<tr><td colspan="6" class="vacio">Todavía no hay conteos.</td></tr>'}</tbody></table></section>`;
  const aviso = (t, tipo = 'aviso') => { const m = $('#msg-cl'); m.className = `mensaje ${tipo}`; m.textContent = t; };
  const pintar = () => {
    clGuardar(C);
    const filas = C.lineas;
    $('#cl-tabla tbody').innerHTML = filas.map((l) => `<tr data-item="${esc(l.item_id)}"><td>${esc(l.item_no ?? '—')}</td><td>${esc(l.codigo)}</td><td>${esc(l.descripcion)} ${esc(l.marca)}</td><td class="num">${l.sistema}</td><td class="num"><input type="number" min="0" step="1" class="cl-contado" value="${l.contado}" aria-label="Piezas contadas" style="width:80px;text-align:right"></td><td class="num" data-col="dif">${l.contado - l.sistema > 0 ? '+' : ''}${l.contado - l.sistema}</td><td><button class="btn btn-icono cl-quitar" type="button" aria-label="Quitar del conteo">${ico('x')}</button></td></tr>`).reverse().join('') || '<tr><td colspan="7" class="vacio">Aún no ha contado nada.</td></tr>';
    const dif = filas.reduce((n, l) => n + l.contado - l.sistema, 0);
    $('#cl-resumen').textContent = `${filas.length} artículo(s) · ${filas.reduce((n, l) => n + l.contado, 0)} pieza(s) contadas · diferencia contra el sistema: ${dif > 0 ? '+' : ''}${dif}`;
    $('#cl-aplicar').disabled = !filas.length; $('#cl-vaciar').disabled = !filas.length;
    for (const tr of $('#cl-tabla tbody').querySelectorAll('tr[data-item]')) {
      const l = C.lineas.find((x) => x.item_id === tr.dataset.item);
      tr.querySelector('.cl-contado').addEventListener('change', (ev) => { const n = Number(ev.target.value); if (Number.isInteger(n) && n >= 0) l.contado = n; pintar(); });
      tr.querySelector('.cl-quitar').addEventListener('click', () => { C.lineas = C.lineas.filter((x) => x !== l); pintar(); });
    }
  };
  const sumar = (a, cantidad = 1) => {
    const l = C.lineas.find((x) => x.item_id === a.item_id);
    if (l) { l.contado += cantidad; l.sistema = a.sistema; } else C.lineas.push({ item_id: a.item_id, item_no: a.item_no, codigo: a.codigo, descripcion: a.descripcion, marca: a.marca, sistema: a.sistema, contado: cantidad });
  };
  $('#btn-volver-inv').addEventListener('click', () => ir('inventario'));
  $('#cl-form').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const codigo = $('#cl-scan').value.trim();
    $('#cl-scan').value = '';
    if (!codigo) return;
    try {
      const { articulos } = await api(`/api/admin/limbo/buscar?codigo=${encodeURIComponent(codigo)}`);
      if (!articulos.length) aviso(`No se encontró el código «${codigo}».`, 'error');
      else if (articulos.length > 1) aviso(`El código «${codigo}» corresponde a ${articulos.length} artículos (código duplicado): no se contó. Resuélvalo en Administración.`, 'error');
      else { sumar(articulos[0]); aviso(`${articulos[0].descripcion} ${articulos[0].marca}: ${C.lineas.find((x) => x.item_id === articulos[0].item_id).contado} contada(s)`.trim(), 'ok'); pintar(); }
    } catch (e) { aviso(e.message, 'error'); }
    $('#cl-scan').focus();
  });
  $('#cl-importar').addEventListener('click', () => $('#cl-archivo').click());
  $('#cl-archivo').addEventListener('change', async (ev) => {
    const f = ev.target.files[0]; ev.target.value = '';
    if (!f) return;
    try {
      if (!/\.xlsx$/i.test(f.name)) return aviso('Solo se aceptan archivos de Excel .xlsx.', 'error');
      const filas = (await leerArchivoAlta(f))[0].filas;
      const norm = (x) => String(x ?? '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();
      const enc = filas[0].map(norm);
      const ic = enc.findIndex((h) => ['codigo', 'upc', 'code', 'codigo de barras'].includes(h));
      const iq = enc.findIndex((h) => ['cantidad', 'contado', 'conteo', 'qty', 'piezas', 'existencia'].includes(h));
      if (ic < 0 || iq < 0) return aviso('El archivo necesita una columna CODIGO y una columna CANTIDAD (lo contado).', 'error');
      const r = await api('/api/admin/limbo/revisar', { filas: filas.slice(1).map((x) => ({ codigo: x[ic], cantidad: x[iq] })) });
      for (const a of r.reconocidas) { const l = C.lineas.find((x) => x.item_id === a.item_id); if (l) { l.contado = a.contado; l.sistema = a.sistema; } else sumar(a, a.contado); }
      pintar();
      const aparte = [r.noEncontradas.length ? `${r.noEncontradas.length} código(s) no encontrados (${r.noEncontradas.slice(0, 5).map((x) => x.codigo).join(', ')}${r.noEncontradas.length > 5 ? '…' : ''})` : '', r.invalidas.length ? `${r.invalidas.length} con cantidad inválida` : '', r.ambiguas.length ? `${r.ambiguas.length} con código duplicado` : ''].filter(Boolean);
      aviso(`Se importaron ${r.reconocidas.length} artículo(s) al conteo${aparte.length ? `; no se importaron: ${aparte.join('; ')}.` : '.'}`, aparte.length ? 'aviso' : 'ok');
    } catch (e) { aviso(e.message, 'error'); }
  });
  $('#cl-vaciar').addEventListener('click', () => { if (!$('#cl-vaciar').dataset.seguro) { $('#cl-vaciar').dataset.seguro = '1'; $('#cl-vaciar').querySelector('span').textContent = '¿Vaciar? Confirmar'; return; } C.lineas = []; C.id = uuid(); delete $('#cl-vaciar').dataset.seguro; $('#cl-vaciar').querySelector('span').textContent = 'Vaciar conteo'; pintar(); });
  $('#cl-aplicar').addEventListener('click', () => {
    const d = dialogo('dlg-cl-confirmar');
    const sob = C.lineas.filter((l) => l.contado > l.sistema).reduce((n, l) => n + l.contado - l.sistema, 0);
    const fal = C.lineas.filter((l) => l.contado < l.sistema).reduce((n, l) => n + l.sistema - l.contado, 0);
    d.setAttribute('aria-labelledby', 'cl-conf-titulo');
    d.innerHTML = `<h2 id="cl-conf-titulo" style="margin-top:0">Aplicar el conteo</h2>
      <p id="cl-conf-resumen">${C.lineas.length} artículo(s) contados: <b>${sob}</b> pieza(s) sobrantes y <b>${fal}</b> faltantes contra el sistema. El saldo de El Limbo de esos artículos quedará en lo contado; los demás no cambian.</p>
      <div id="cl-conf-msg" class="mensaje" role="status"></div><div class="filas"><button class="btn" type="button" id="cl-conf-no">Volver</button><button class="btn btn-primario" type="button" id="cl-conf-si" style="width:auto;flex:1">${ico('check')}<span>Aplicar</span></button></div>`;
    $('#cl-conf-no').addEventListener('click', () => d.close());
    $('#cl-conf-si').addEventListener('click', async () => {
      $('#cl-conf-si').disabled = true;
      try {
        const r = await api('/api/admin/limbo/conteo', { conteo_id: C.id, lineas: C.lineas.map((l) => ({ item_id: l.item_id, contado: l.contado })) });
        d.close(); S.conteoLimbo = { id: uuid(), lineas: [] }; clGuardar(S.conteoLimbo);
        await ir('conteo_limbo'); const m = $('#msg-cl'); m.className = 'mensaje ok'; m.textContent = `Conteo aplicado: ${r.conteo.articulos} artículo(s), ${r.conteo.con_diferencia} con diferencia (${r.conteo.sobrantes} sobrantes, ${r.conteo.faltantes} faltantes).`;
      } catch (e) { $('#cl-conf-si').disabled = false; const m = $('#cl-conf-msg'); m.className = 'mensaje error'; m.textContent = e.message; }
    });
    d.showModal();
  });
  pintar();
  $('#cl-scan').focus();
}
const NOM_DIF = { sin_confirmar: 'Sin confirmar', faltante: 'Piezas faltantes', exceso: 'Más de lo registrado', almacen_negativo: 'Almacén negativo' };
async function vistaEntregas() {
  const hoy = new Date(Date.now() - 7 * 3600e3).toISOString().slice(0, 10);
  const mes = `${hoy.slice(0, 8)}01`;
  const info = await api('/api/admin/almacen');
  $('#vista').innerHTML = `<div class="titulo-vista">${ico('warehouse')}<h1>Entregas y diferencias de almacén</h1><button class="btn" id="btn-volver-alm" type="button" style="margin-left:auto">${ico('undo')}<span>Volver a almacén</span></button></div>
    <form class="filtros panel" id="filtros-ent"><label>Desde <input type="date" id="ent-desde" value="${mes}"></label><label>Hasta <input type="date" id="ent-hasta" value="${hoy}"></label>
      <label>Tienda <select id="ent-tienda"><option value="">Todas</option>${info.tiendas.map((t) => `<option value="${esc(t)}">${esc(TIENDAS_ALM[t] ?? t)}</option>`).join('')}</select></label>
      <button class="btn btn-primario" type="submit" style="width:auto">${ico('search')}<span>Consultar</span></button>
      <button class="btn" type="button" id="btn-exportar-ent">${ico('download')}<span>Exportar a Excel</span></button><span id="estado-exportar-ent" role="status" aria-live="polite"></span></form>
    <div id="resultado-ent"></div>`;
  const filtro = () => `desde=${$('#ent-desde').value}&hasta=${$('#ent-hasta').value}&tienda=${encodeURIComponent($('#ent-tienda').value)}`;
  const consultar = async () => {
    const { reporte: r } = await api(`/api/admin/entregas?${filtro()}`);
    const R = r.resumen;
    $('#resultado-ent').innerHTML = `<div class="panel" id="panel-dif"><h2 style="margin-top:0">Diferencias <span class="nota">(estado actual; una entrega sin confirmar se marca a partir de ${r.dias_sin_confirmar} días)</span></h2>
      <table id="tabla-ent-dif"><thead><tr><th>Tipo</th><th>Tienda</th><th>Item #</th><th>Artículo</th><th class="num">Piezas</th><th>Detalle</th></tr></thead><tbody>
      ${r.diferencias.map((d) => `<tr data-tipo="${d.tipo}"><td><span class="insignia cancelada">${NOM_DIF[d.tipo]}</span></td><td>${esc(TIENDAS_ALM[d.tienda] ?? d.tienda ?? '—')}</td><td>${esc(d.item_no ?? '—')}</td><td>${esc(d.descripcion)}</td><td class="num">${d.piezas}</td><td>${esc(d.detalle)}</td></tr>`).join('') || '<tr><td colspan="6" class="vacio">Sin diferencias.</td></tr>'}</tbody></table></div>
      <div class="panel" style="margin-top:12px"><table id="tabla-ent-resumen"><thead><tr><th>Tienda</th><th class="num">Entregas</th><th class="num">Piezas</th><th class="num">Confirmadas</th><th class="num">Pendientes</th><th class="num">Piezas pendientes</th></tr></thead><tbody>
      ${r.porTienda.map((t) => `<tr data-tienda="${esc(t.tienda)}"><td>${esc(TIENDAS_ALM[t.tienda] ?? t.tienda)}</td><td class="num">${t.entregas}</td><td class="num">${t.piezas}</td><td class="num">${t.confirmadas}</td><td class="num">${t.pendientes}</td><td class="num">${t.piezas_pendientes}</td></tr>`).join('') || '<tr><td colspan="6" class="vacio">Sin entregas en el periodo.</td></tr>'}</tbody>
      <tfoot><tr><th>Total</th><td class="num" data-campo="entregas">${R.entregas}</td><td class="num" data-campo="piezas">${R.piezas}</td><td class="num">${R.confirmadas}</td><td class="num" data-campo="pendientes">${R.pendientes}</td><td class="num">${R.piezas_pendientes}</td></tr></tfoot></table></div>
      <div class="panel" style="margin-top:12px"><h2 style="margin-top:0">Detalle de entregas</h2><div class="tabla-cont"><table id="tabla-ent-detalle"><thead><tr><th>Fecha</th><th>Tienda</th><th>Item #</th><th>Código</th><th>Artículo</th><th class="num">Piezas</th><th>Estado</th><th>Confirmada</th><th>Entregó</th></tr></thead><tbody>
      ${r.filas.map((f) => `<tr data-entrega="${esc(f.entrega_id)}" data-estado="${f.estado}"><td>${esc(f.fecha_local)} ${esc(f.hora)}</td><td>${esc(TIENDAS_ALM[f.tienda] ?? f.tienda)}</td><td>${esc(f.item_no ?? '—')}</td><td>${esc(f.codigo)}</td><td>${esc(f.descripcion)} ${esc(f.marca)}${f.exceso ? ' <span class="insignia cancelada">excede almacén</span>' : ''}</td><td class="num">${f.qty}</td><td>${f.estado === 'confirmada' ? (f.recibida_qty < f.qty ? `Confirmada: recibió ${f.recibida_qty} de ${f.qty}` : 'Confirmada') : `<b>Pendiente</b> (${f.dias_espera} d)`}</td><td>${esc(f.recibida_local ?? '—')}${f.recibida_por ? ` · ${esc(f.recibida_por)}` : ''}</td><td>${esc(f.por)}</td></tr>`).join('') || '<tr><td colspan="9" class="vacio">Sin entregas en el periodo.</td></tr>'}</tbody></table></div></div>`;
  };
  $('#btn-volver-alm').addEventListener('click', () => ir('almacen'));
  $('#filtros-ent').addEventListener('submit', async (ev) => { ev.preventDefault(); await consultar(); });
  $('#btn-exportar-ent').addEventListener('click', async () => {
    const e = $('#estado-exportar-ent');
    e.textContent = 'Preparando el archivo…';
    try { e.textContent = await exportarArchivo(`/api/admin/entregas.xlsx?${filtro()}`, 'entregas-almacen.xlsx'); } catch (err) { e.textContent = `No se pudo exportar: ${err.message}`; }
  });
  await consultar();
}
async function vistaDescuentos() {
  const hoy = new Date(Date.now() - 7 * 3600e3).toISOString().slice(0, 10);
  $('#vista').innerHTML = `<div class="titulo-vista">${ico('tag')}<h1>Reporte de promociones y descuentos</h1><button class="btn" id="btn-volver-promos" type="button" style="margin-left:auto">${ico('undo')}<span>Volver a promociones</span></button></div>
    <form class="filtros panel" id="filtros-desc"><label>Desde <input type="date" id="desc-desde" value="${hoy}"></label><label>Hasta <input type="date" id="desc-hasta" value="${hoy}"></label>
      <button class="btn btn-primario" type="submit" style="width:auto">${ico('search')}<span>Consultar</span></button>
      <button class="btn" type="button" id="btn-exportar-desc">${ico('download')}<span>Exportar a Excel</span></button><span id="estado-exportar-desc" role="status" aria-live="polite"></span></form>
    <div id="resultado-desc"></div>`;
  const consultar = async () => {
    const { reporte: r } = await api(`/api/admin/descuentos?desde=${$('#desc-desde').value}&hasta=${$('#desc-hasta').value}`);
    const R = r.resumen;
    $('#resultado-desc').innerHTML = `<div class="panel"><p class="nota" style="margin-top:0">Los totales no incluyen las ventas canceladas (aparecen en el detalle marcadas). El importe de la venta es la mercancía a precio de lista.</p>
      <table id="tabla-desc-resumen"><tbody>
        <tr><th scope="row">Total descontado</th><td class="num" data-campo="monto"><b>${mxn(R.monto)}</b></td><td class="num" data-campo="tickets">${R.tickets} ticket(s)</td></tr>
        <tr><th scope="row">Promociones</th><td class="num" data-campo="promo">${mxn(R.promo.monto)}</td><td class="num">${R.promo.tickets} ticket(s)</td></tr>
        <tr><th scope="row">Cupones</th><td class="num" data-campo="cupon">${mxn(R.cupon.monto)}</td><td class="num">${R.cupon.tickets} ticket(s)</td></tr>
        <tr><th scope="row">Descuentos manuales (con clave)</th><td class="num" data-campo="manual">${mxn(R.manual.monto)}</td><td class="num">${R.manual.tickets} ticket(s)</td></tr></tbody></table></div>
      <div class="panel" style="margin-top:12px"><h2 style="margin-top:0">Por quién lo autorizó</h2>
        <table id="tabla-desc-supervisor"><thead><tr><th>Autorizó</th><th class="num">Descuentos</th><th class="num">Monto</th><th class="num">Mayor % de una venta</th><th class="num">Al 100 %</th></tr></thead><tbody>
        ${r.porSupervisor.map((x) => `<tr data-supervisor="${esc(x.supervisor)}"><td>${esc(x.supervisor)}</td><td class="num">${x.descuentos}</td><td class="num">${mxn(x.monto)}</td><td class="num">${pctBp(x.mayor_pct_bp)}</td><td class="num">${x.al_100}</td></tr>`).join('') || '<tr><td colspan="5" class="vacio">Sin descuentos autorizados en el periodo.</td></tr>'}</tbody></table></div>
      <div class="panel" style="margin-top:12px"><h2 style="margin-top:0">Por promoción o cupón</h2>
        <table id="tabla-desc-promos"><thead><tr><th>Tipo</th><th>Nombre</th><th class="num">Tickets</th><th class="num">Monto</th></tr></thead><tbody>
        ${r.porPromocion.map((x) => `<tr data-ref="${esc(x.ref)}"><td>${NOM_TIPO_DESC[x.tipo]}</td><td>${esc(x.concepto)}</td><td class="num">${x.tickets}</td><td class="num">${mxn(x.monto)}</td></tr>`).join('') || '<tr><td colspan="4" class="vacio">Sin promociones ni cupones aplicados en el periodo.</td></tr>'}</tbody></table></div>
      <div class="panel" style="margin-top:12px"><h2 style="margin-top:0">Detalle por ticket</h2><div class="tabla-cont"><table id="tabla-desc-detalle"><thead><tr><th>Tienda</th><th>Caja</th><th>Folio</th><th>Fecha</th><th>Vendedora-Cajera</th><th>Tipo</th><th>Concepto</th><th>Autorizó</th><th class="num">Venta</th><th class="num">Descuento</th><th class="num">% venta</th><th>Estado</th></tr></thead><tbody>
        ${r.filas.map((f) => `<tr data-folio="${f.folio}" data-tipo="${f.tipo}"><td>${esc(f.tienda)}</td><td>${f.caja}</td><td>${String(f.folio).padStart(6, '0')}</td><td>${esc(f.fecha_local)} ${esc(f.hora)}</td><td>${esc(f.cajero)}</td><td>${NOM_TIPO_DESC[f.tipo]}</td><td>${esc(f.concepto)}</td><td>${esc(f.supervisor ?? '')}</td><td class="num">${mxn(f.importe_venta)}</td><td class="num">${mxn(f.monto)}</td><td class="num">${pctBp(f.pct_bp)}</td><td>${f.estado === 'cancelada' ? '<span class="insignia cancelada">cancelada</span>' : 'confirmada'}</td></tr>`).join('') || '<tr><td colspan="12" class="vacio">Sin descuentos en el periodo.</td></tr>'}</tbody></table></div></div>`;
  };
  $('#btn-volver-promos').addEventListener('click', () => ir('promociones'));
  $('#filtros-desc').addEventListener('submit', async (ev) => { ev.preventDefault(); await consultar(); });
  $('#btn-exportar-desc').addEventListener('click', async () => {
    const e = $('#estado-exportar-desc');
    e.textContent = 'Preparando el archivo…';
    try { e.textContent = await exportarArchivo(`/api/admin/descuentos.xlsx?desde=${$('#desc-desde').value}&hasta=${$('#desc-hasta').value}`, 'descuentos.xlsx'); } catch (err) { e.textContent = `No se pudo exportar: ${err.message}`; }
  });
  await consultar();
}

// ── promociones, cupón y descuentos autorizados (venta) ──
function pintarPromos() {
  const el = $('#promos-aplicadas');
  if (!el || !S.carrito) return;
  const c = S.carrito;
  const li = [];
  for (const p of c.promos ?? []) li.push(`<li data-promo="${esc(p.promo_id)}"><span>${esc(p.nombre)}</span><b>-${mxn(p.monto)}</b></li>`);
  if (c.cupon?.aplicado) li.push(`<li data-cupon="${esc(c.cupon.codigo)}"><span>Cupón ${esc(c.cupon.codigo)} <button class="btn btn-icono" id="btn-quitar-cupon" type="button" title="Quitar cupón" aria-label="Quitar cupón">${ico('x')}</button></span><b>-${mxn(c.cupon.monto)}</b></li>`);
  else if (c.cupon) li.push(`<li class="aviso-promo" data-cupon-aviso="${esc(c.cupon.codigo)}"><span>Cupón ${esc(c.cupon.codigo)}: ${esc(c.cupon.motivo ?? 'no aplica')}</span></li>`);
  const manual = {};
  for (const l of c.lineas) for (const d of l.descuento_detalle ?? []) if (d.tipo === 'manual') manual[d.nombre] = (manual[d.nombre] ?? 0) + d.monto;
  for (const [n, m] of Object.entries(manual)) li.push(`<li data-manual><span>${esc(n)}</span><b>-${mxn(m)}</b></li>`);
  el.innerHTML = li.length ? `<ul class="lista-promos">${li.join('')}</ul>` : '';
  const q = $('#btn-quitar-cupon');
  if (q) q.addEventListener('click', async () => { try { const r = await api('/api/venta/cupon/quitar', { cart: S.cart }); S.carrito = r.carrito; pintarCarrito(); msg('Cupón quitado.'); } catch (e) { msg(e.message, 'error'); } });
}
async function aplicarCuponCodigo(codigo) {
  try {
    const r = await api('/api/venta/cupon', { cart: S.cart, codigo });
    S.carrito = r.carrito; pintarCarrito();
    msg(`Cupón ${r.cupon.codigo} aplicado: -${mxn(r.cupon.monto)}.`);
    return true;
  } catch (e) { msg(e.message, 'error'); return false; }
}
function abrirCupon() {
  const d = dialogo('dlg-cupon');
  d.setAttribute('aria-labelledby', 'cup-titulo');
  d.innerHTML = `<h2 id="cup-titulo" style="margin-top:0">Cupón de descuento</h2>
    <form id="form-cupon" autocomplete="off"><div class="campo"><label for="cup-codigo">Código del cupón</label><input id="cup-codigo" class="texto" placeholder="Escriba el código o escanee el QR"></div>
    <p class="nota">También puede escanear el QR del cupón con el campo de búsqueda de la venta.</p>
    <div id="msg-cupon" class="mensaje" role="status" aria-live="polite"></div>
    <div class="filas"><button class="btn" type="button" id="cup-cerrar">Cancelar</button><button class="btn btn-primario" type="submit" id="cup-aplicar" style="width:auto;flex:1">${ico('check')}<span>Aplicar cupón</span></button></div></form>`;
  $('#cup-cerrar').addEventListener('click', () => d.close());
  $('#form-cupon').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const raw = $('#cup-codigo').value.trim().replace(/^cupon:\s*/i, '');
    if (!raw) return;
    try {
      const r = await api('/api/venta/cupon', { cart: S.cart, codigo: raw });
      S.carrito = r.carrito; pintarCarrito(); d.close(); msg(`Cupón ${r.cupon.codigo} aplicado: -${mxn(r.cupon.monto)}.`);
    } catch (e) { const m = $('#msg-cupon'); m.className = 'mensaje error'; m.textContent = e.message; }
  });
  d.showModal();
  $('#cup-codigo').focus();
}
/** «Abrir caja»: pide la clave de la propia Vendedora-Cajera y abre el cajón sin vender. */
/** Aviso grande y legible antes de abrir la caja sin venta: las llamadas de extorsión piden justo eso. Hay que tocar ENTENDIDO para continuar. */
function avisoExtorsion(alContinuar) {
  const d = dialogo('dlg-aviso-extorsion');
  d.setAttribute('aria-labelledby', 'ax-titulo');
  d.setAttribute('aria-describedby', 'ax-texto');
  d.style.cssText = 'max-width:760px;width:calc(100% - 32px);padding:0;border:6px solid #1a1a1a;border-radius:18px;background:#ffd400;color:#1a1a1a';
  d.innerHTML = `<div style="padding:28px 30px;text-align:center">
    <div style="font-size:64px;line-height:1" aria-hidden="true">⚠️</div>
    <h2 id="ax-titulo" style="margin:6px 0 14px;font-size:48px;line-height:1.1;letter-spacing:1px">¡CUIDADO!</h2>
    <p id="ax-texto" style="margin:0 0 24px;font-size:28px;line-height:1.35;font-weight:700">Si te llama alguien que no conoces para sacar dinero de la caja y hacer un depósito o un pago, <u>cuelga</u> y llama a <u>Edgardo</u> o a <u>Karina</u>.</p>
    <button class="btn" id="ax-ok" type="button" style="font-size:30px;font-weight:800;padding:16px 56px;background:#1a1a1a;color:#ffd400;border:0;border-radius:14px;cursor:pointer">ENTENDIDO</button>
  </div>`;
  $('#ax-ok').addEventListener('click', () => { d.close(); alContinuar(); });
  d.addEventListener('cancel', (ev) => ev.preventDefault()); // Esc no lo salta: hay que leerlo y tocar ENTENDIDO
  d.showModal();
  $('#ax-ok').focus();
}
const MOTIVOS_APERTURA = ['Feria', 'Rectificar efectivo', 'Otro'];
/** Motivo de la apertura (Feria, Rectificar efectivo u Otro con texto) y, con Vendedoras-Cajeras registradas, la clave de quien abre. */
function abrirMotivoApertura(pideClave) {
  const d = dialogo('dlg-abrir-caja');
  d.removeAttribute('style');
  d.setAttribute('aria-labelledby', 'ac-titulo');
  d.innerHTML = `<h2 id="ac-titulo" style="margin-top:0">Abrir caja</h2>
    <p class="nota" style="margin-top:0">${pideClave ? `Elija el motivo y teclee su clave, ${esc(S.sesion.usuario ?? '')}.` : 'Elija el motivo.'} La apertura queda registrada a su nombre, con el motivo.</p>
    <form id="form-abrir-caja" autocomplete="off">
      <fieldset style="border:1px solid var(--borde);border-radius:8px;margin:8px 0"><legend>Motivo de la apertura</legend>
        ${MOTIVOS_APERTURA.map((m, i) => `<label style="display:block;padding:4px 0;font-size:1.05em"><input type="radio" name="ac-motivo" value="${esc(m)}" ${i === 0 ? 'checked' : ''}> ${esc(m)}</label>`).join('')}
        <div class="campo" id="ac-otro-campo" hidden><label for="ac-otro">Escriba el motivo</label><input id="ac-otro" maxlength="60" placeholder="Motivo de la apertura"></div></fieldset>
      ${pideClave ? `<div class="campo"><label for="ac-clave">Su clave</label><input id="ac-clave" type="text" data-pin inputmode="numeric" autocomplete="off" placeholder="••••"></div>` : ''}
      <div id="msg-ac" class="mensaje" role="alert"></div>
      <div class="filas"><button class="btn" type="button" id="ac-no">Cancelar</button><button class="btn btn-primario" type="submit" style="width:auto;flex:1">${ico('cash')}<span>Abrir caja</span></button></div></form>`;
  const motivo = () => d.querySelector('input[name="ac-motivo"]:checked').value;
  for (const r of d.querySelectorAll('input[name="ac-motivo"]')) r.addEventListener('change', () => { $('#ac-otro-campo').hidden = motivo() !== 'Otro'; if (motivo() === 'Otro') $('#ac-otro').focus(); });
  $('#ac-no').addEventListener('click', () => { d.close(); $('#scan').focus(); });
  $('#form-abrir-caja').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const m = $('#msg-ac');
    const texto = motivo() === 'Otro' ? $('#ac-otro').value.trim() : motivo();
    if (texto.length < 3) { m.className = 'mensaje error'; m.textContent = 'Escriba el motivo de la apertura.'; marcarCampoFalta($('#ac-otro')); $('#ac-otro').focus(); return; }
    if (pideClave && !$('#ac-clave').value) { m.className = 'mensaje error'; m.textContent = 'Teclee su clave.'; marcarCampoFalta($('#ac-clave')); $('#ac-clave').focus(); return; }
    try {
      await api('/api/caja/abrir', { motivo: motivo() === 'Otro' ? `Otro: ${texto}` : texto, ...(pideClave ? { clave: $('#ac-clave').value } : {}) });
      d.close(); msg('Caja abierta (queda registrado en el corte).'); $('#scan').focus();
      await imprimirNavegador(comprobanteApertura(), { logo: false });
    } catch (e) { m.className = 'mensaje error'; m.textContent = e.message; const c = $('#ac-clave'); if (c) c.value = ''; }
  });
  d.showModal();
  (pideClave ? $('#ac-clave') : d.querySelector('input[name="ac-motivo"]')).focus();
}
/** Contar el cajón a cualquier hora: abre el cajón (queda registrado como «Rectificar efectivo»), se cuentan billetes y monedas y «Confirmar fondo» guarda cómo quedaron. */
async function abrirContarFondo() {
  let e;
  try { e = await api('/api/arqueo'); } catch (x) { return msg(x.message, 'error'); }
  if (e.esperado === null) return msg('Primero cuente y confirme el fondo del día en el cierre de caja.', 'aviso');
  const d = dialogo('dlg-contar-fondo');
  d.setAttribute('aria-labelledby', 'cf-titulo');
  d.innerHTML = `<h2 id="cf-titulo" style="margin-top:0">Contar fondo</h2>
    <div id="cf-abrir"><p class="nota">Se abre el cajón (queda registrado como «Rectificar efectivo») para contar los billetes y monedas.</p>
      ${e.pide_clave ? `<div class="campo"><label for="cf-clave">Su clave</label><input id="cf-clave" type="text" data-pin inputmode="numeric" autocomplete="off" placeholder="••••"></div>` : ''}
      <div id="msg-cf-abrir" class="mensaje" role="alert"></div>
      <div class="filas"><button class="btn" type="button" id="cf-cerrar-1">Cancelar</button><button class="btn btn-primario" type="button" id="cf-abrir-btn" style="width:auto;flex:1">${ico('cash')}<span>Abrir caja y contar</span></button></div></div>
    <form id="cf-contar" autocomplete="off" hidden>
      <p class="nota">Cuente todo lo que hay en el cajón. El sistema espera <b>${mxn(e.esperado)}</b> (fondo ${mxn(e.fondo)} + efectivo de ventas y movimientos).</p>
      <div class="tabla-cont">${tablaDenominaciones('arq', FILAS_PESOS, mxn)}</div>
      <p style="font-size:1.1em;margin:8px 0">Total contado: <b id="cf-total">${mxn(0)}</b> · <span id="cf-dif"></span></p>
      <div class="campo" id="cf-nota-campo" hidden><label for="cf-nota">Nota de la diferencia (<span id="cf-nota-tipo"></span>)</label><input id="cf-nota" maxlength="300" placeholder="¿Por qué no coincide?"></div>
      <div id="msg-cf" class="mensaje" role="alert"></div>
      <div class="filas"><button class="btn" type="button" id="cf-cerrar-2">Cancelar</button><button class="btn btn-primario" type="submit" style="width:auto;flex:1">${ico('check')}<span>Confirmar fondo</span></button></div>
    </form>`;
  let claveConteo;
  const cerrar = () => { d.close(); $('#scan')?.focus(); };
  $('#cf-cerrar-1').addEventListener('click', cerrar);
  $('#cf-cerrar-2').addEventListener('click', cerrar);
  const total = () => {
    const { total: t } = leerDenominaciones('arq', mxn, d);
    const dif = t - e.esperado;
    $('#cf-total').textContent = mxn(t);
    $('#cf-dif').textContent = t === 0 ? '' : dif === 0 ? 'Cuadra con lo esperado' : dif < 0 ? `Faltan ${mxn(-dif)}` : `Sobran ${mxn(dif)}`;
    $('#cf-dif').style.color = dif === 0 ? 'var(--ok,#0a7a4b)' : 'var(--error,#b3261e)';
    $('#cf-nota-campo').hidden = dif === 0 || t === 0;
    $('#cf-nota-tipo').textContent = dif < 0 ? 'faltante' : 'sobrante';
    return t;
  };
  for (const i of d.querySelectorAll('[data-arq]')) i.addEventListener('input', total);
  $('#cf-abrir-btn').addEventListener('click', async () => {
    const m = $('#msg-cf-abrir');
    if (e.pide_clave && !$('#cf-clave').value) { m.className = 'mensaje error'; m.textContent = 'Teclee su clave.'; $('#cf-clave').focus(); return; }
    try {
      await api('/api/caja/abrir', { motivo: 'Rectificar efectivo', ...(e.pide_clave ? { clave: $('#cf-clave').value } : {}) });
      claveConteo = e.pide_clave ? $('#cf-clave').value : undefined; // la misma clave autoriza guardar el conteo
      $('#cf-abrir').hidden = true; $('#cf-contar').hidden = false; total();
      d.querySelector('[data-arq]').focus();
      imprimirNavegador(comprobanteApertura(), { logo: false }).catch(() => {});
    } catch (x) { m.className = 'mensaje error'; m.textContent = x.message; const c = $('#cf-clave'); if (c) c.value = ''; }
  });
  $('#cf-contar').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const m = $('#msg-cf');
    const { den } = leerDenominaciones('arq', mxn, d);
    try {
      const r = await api('/api/arqueo', { denominaciones: den, nota: $('#cf-nota').value, ...(e.pide_clave ? { clave: claveConteo } : {}) });
      d.close(); $('#scan')?.focus();
      const a = r.arqueo;
      msg(a.diferencia === 0 ? `Fondo confirmado: ${mxn(a.total)}. Cuadra y la feria quedó rectificada.` : `Fondo confirmado: ${mxn(a.total)} (${a.diferencia < 0 ? 'faltan' : 'sobran'} ${mxn(Math.abs(a.diferencia))}, anotado). La feria quedó rectificada.`);
    } catch (x) { m.className = 'mensaje error'; m.textContent = x.message; }
  });
  d.showModal();
  (e.pide_clave ? $('#cf-clave') : $('#cf-abrir-btn')).focus();
}
/** Cancelar la venta en curso (sin cobrar): solo pide confirmación, nunca clave. */
function abrirCancelarVenta() {
  if (!S.carrito.lineas.length) return msg('No hay una venta con artículos que cancelar.', 'aviso');
  const d = dialogo('dlg-cancelar-venta');
  d.setAttribute('aria-labelledby', 'cv-titulo');
  d.innerHTML = `<h2 id="cv-titulo" style="margin-top:0">¿Cancelar la venta?</h2>
    <p id="cv-texto">Se descartan los ${S.carrito.lineas.reduce((a, l) => a + l.qty, 0)} artículo(s) de esta venta y se abre una venta nueva. Aún no se ha cobrado nada.</p>
    <div id="msg-cv" class="mensaje" role="status" aria-live="polite"></div>
    <div class="filas"><button class="btn" type="button" id="cv-no">No, seguir con la venta</button><button class="btn btn-peligro" type="button" id="cv-si" style="width:auto;flex:1">${ico('trash')}<span>Sí, cancelar la venta</span></button></div>`;
  $('#cv-no').addEventListener('click', () => { d.close(); $('#scan').focus(); });
  $('#cv-si').addEventListener('click', async () => {
    try {
      const r = await api('/api/venta/anular', { cart: S.cart, motivo: 'cancelada antes de cobrar' });
      S.cart = r.cart; S.carrito = r.carrito; S.sel = null; d.close(); pintarCarrito(); msg('Venta cancelada.'); $('#scan').focus();
    } catch (e) { const m = $('#msg-cv'); m.className = 'mensaje error'; m.textContent = e.message; }
  });
  d.showModal();
  $('#cv-no').focus();
}
/** «Editar en esta venta»: descripción libre; el precio nuevo exige la clave de un supervisor. */
function abrirEditarLinea() {
  const l = S.sel ? S.carrito.lineas.find((x) => x.linea_id === S.sel && !x.tarjeta_regalo) : null;
  if (!l) return msg('Seleccione un artículo de la lista para editarlo en esta venta.', 'aviso');
  const d = dialogo('dlg-editar-linea');
  d.setAttribute('aria-labelledby', 'el-titulo');
  d.innerHTML = `<h2 id="el-titulo" style="margin-top:0">Editar en esta venta</h2>
    <p class="nota">Solo cambia en esta venta; el catálogo no se toca. Cambiar el precio lo autoriza un supervisor con su clave.${l.editado ? ` Precio de lista: ${mxn(l.editado.precio_lista)}.` : ''}</p>
    <form id="form-editar-linea" autocomplete="off">
      <div class="campo"><label for="el-desc">Descripción</label><input id="el-desc" maxlength="60" value="${esc(l.descripcion)}"></div>
      <div class="campo"><label for="el-precio">Precio unitario</label><input id="el-precio" inputmode="decimal" value="${centavosAPesos(l.precio_unit)}"></div>
      <div id="el-clave-bloque" hidden><div class="campo"><label for="el-clave">Clave del supervisor</label><input id="el-clave" type="text" data-pin inputmode="numeric" autocomplete="off" placeholder="••••"></div>
        ${casillaSola('el-solo', 'Supervisor ausente: autorizo yo con mi clave (queda anotado)')}</div>
      <div id="msg-el" class="mensaje" role="status" aria-live="polite"></div>
      <div class="filas"><button class="btn" type="button" id="el-cerrar">Cancelar</button><button class="btn btn-primario" type="submit" style="width:auto;flex:1">${ico('check')}<span>Guardar cambios</span></button></div>
    </form>`;
  const cambiaPrecio = () => parseMXN($('#el-precio').value) !== l.precio_unit;
  $('#el-precio').addEventListener('input', () => { $('#el-clave-bloque').hidden = !cambiaPrecio(); });
  $('#el-cerrar').addEventListener('click', () => { d.close(); $('#scan').focus(); });
  $('#form-editar-linea').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const m = $('#msg-el');
    const precio = parseMXN($('#el-precio').value);
    if (!precio) { m.className = 'mensaje error'; m.textContent = 'Escriba el precio en pesos.'; return; }
    try {
      const r = await api('/api/venta/editar-linea', { cart: S.cart, linea_id: l.linea_id, descripcion: $('#el-desc').value, ...(precio !== l.precio_unit ? { precio_unit: precio, clave: $('#el-clave').value, ...($('#el-solo')?.checked ? { sin_supervisor: true } : {}) } : {}) });
      S.carrito = r.carrito; pintarCarrito(); d.close(); msg('Artículo editado en esta venta.'); $('#scan').focus();
    } catch (e) { m.className = 'mensaje error'; m.textContent = e.message; const c = $('#el-clave'); if (c) c.value = ''; }
  });
  d.showModal();
  $('#el-desc').focus();
}
// ── Venta a empleada: descuento de empleada (15 %, o 30 % en uniformes) y crédito a su cuenta ──
function pintarEmpleada() {
  const e = S.carrito.empleada;
  const b = $('#bloque-empleada');
  if (b) {
    b.hidden = !e;
    if (e) b.innerHTML = `<b>Venta a empleada: ${esc(e.nombre)}</b><br><small>Descuento ${e.pct}% (uniformes ${e.pct_uniforme}%) · no se combina con promociones: aplica el que más le conviene. Crédito disponible: <b id="credito-disponible">${mxn(e.credito_disponible)}</b></small><br><button class="btn" type="button" id="btn-quitar-empleada">${ico('x')}<span>Quitar empleada</span></button>`;
    $('#btn-quitar-empleada')?.addEventListener('click', quitarEmpleada);
  }
  const f = $('#formas')?.querySelector('button[data-forma="credito"]');
  if (f) {
    f.disabled = !e;
    f.title = e ? 'Se carga a la cuenta de la empleada y se le descuenta de la nómina' : 'Primero elija «Venta a empleada»';
  }
  if (!e && S.forma === 'credito') elegirForma('efectivo');
}
async function quitarEmpleada() {
  try { const r = await api('/api/venta/empleada/quitar', { cart: S.cart }); S.carrito = r.carrito; pintarCarrito(); msg('Se quitó el descuento de empleada.'); }
  catch (e) { msg(e.message, 'error'); }
}
async function alternarUniforme() {
  const l = S.carrito.lineas.find((x) => x.linea_id === S.sel);
  if (!l) return;
  try { const r = await api('/api/venta/uniforme', { cart: S.cart, linea_id: l.linea_id, uniforme: !l.uniforme }); S.carrito = r.carrito; pintarCarrito(); }
  catch (e) { msg(e.message, 'error'); }
}
async function abrirEmpleada() {
  if (!S.carrito.lineas.length) return msg('Agregue artículos a la venta antes de elegir a la empleada.', 'aviso');
  const { empleadas, yo, config } = await api('/api/empleadas');
  const d = dialogo('dlg-empleada');
  d.setAttribute('aria-labelledby', 'emp-titulo');
  d.innerHTML = `<h2 id="emp-titulo" style="margin-top:0">Venta a empleada</h2>
    <p class="nota">La empleada confirma con <b>su propia clave</b>. El descuento de <b>${config.pct}%</b> se aplica <b>solo, a toda la mercancía de la venta</b>; no se combina con promociones. Para los uniformes de la tienda (<b>${config.pct_uniforme}%</b>), después seleccione el artículo en la lista y toque «Marcar como uniforme». Se paga normal o a crédito.</p>
    <form id="form-empleada" autocomplete="off">
      <div class="campo"><label for="emp-quien">Empleada</label><select id="emp-quien" style="width:100%;padding:10px;border:2px solid var(--borde);border-radius:10px;background:var(--superficie)">${empleadas.map((e) => `<option value="${esc(e.id)}" data-nombre="${esc(e.nombre)}">${esc(e.nombre)}</option>`).join('')}</select></div>
      <div class="campo"><label for="emp-clave">Clave de la empleada</label><input id="emp-clave" type="text" data-pin inputmode="numeric" autocomplete="off" placeholder="••••" required></div>
      <div class="campo" id="emp-sup-campo" hidden><label for="emp-sup">Clave de un supervisor (una cajera no se vende a sí misma sin autorización)</label><input id="emp-sup" type="text" data-pin inputmode="numeric" autocomplete="off" placeholder="••••">
        ${casillaSola('emp-solo', 'No hay supervisor: lo autorizo yo (queda anotado)')}</div>
      <div id="msg-emp" class="mensaje" role="status" aria-live="polite"></div>
      <div class="filas"><button class="btn" type="button" id="emp-cerrar">Cancelar</button><button class="btn btn-primario" type="submit" style="width:auto;flex:1">${ico('check')}<span>Aplicar descuento de empleada</span></button></div>
    </form>`;
  const sup = () => { $('#emp-sup-campo').hidden = S.sesion?.supervisor || $('#emp-quien').selectedOptions[0]?.dataset.nombre.toLowerCase() !== String(yo).toLowerCase(); };
  $('#emp-quien').addEventListener('change', sup); sup();
  $('#emp-cerrar').addEventListener('click', () => d.close());
  $('#form-empleada').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const m = $('#msg-emp');
    try {
      const r = await api('/api/venta/empleada', { cart: S.cart, empleada_id: $('#emp-quien').value, clave: $('#emp-clave').value, ...(!$('#emp-sup-campo').hidden ? ($('#emp-solo')?.checked ? { sin_supervisor: true } : { clave_supervisor: $('#emp-sup').value }) : {}) });
      S.carrito = r.carrito; d.close(); pintarCarrito(); msg(`Venta a empleada: ${r.carrito.empleada.nombre}. El ${config.pct}% ya se aplicó a toda la venta. Si algún artículo es uniforme, selecciónelo en la lista y toque «Marcar como uniforme» (${config.pct_uniforme}%). Luego elija la forma de pago.`);
    } catch (e) { m.className = 'mensaje error'; m.textContent = e.message; }
  });
  d.showModal();
  $('#emp-clave').focus();
}

/** «No hay nadie más / supervisor ausente»: quien cobra autoriza con su PROPIA clave y queda anotado. */
const casillaSola = (id, texto) => S.sesion?.supervisor ? '' : `<label style="display:flex;gap:8px;align-items:flex-start;margin:8px 0"><input type="checkbox" id="${id}" style="margin-top:4px"><span>${texto}</span></label>`;
function abrirDescuento() {
  if (!S.carrito.lineas.length) return msg('Agregue artículos a la venta antes de aplicar un descuento.', 'aviso');
  const d = dialogo('dlg-descuento');
  const sel = S.sel ? S.carrito.lineas.find((l) => l.linea_id === S.sel && !l.tarjeta_regalo) : null;
  const hayManual = S.carrito.lineas.some((l) => (l.descuento_detalle ?? []).some((x) => x.tipo === 'manual'));
  d.setAttribute('aria-labelledby', 'desc-titulo');
  d.innerHTML = `<h2 id="desc-titulo" style="margin-top:0">Aplicar descuento</h2>
    <p class="nota">Lo autoriza con su clave quien atiende la venta (o un supervisor). Queda anotado quién lo hizo, en la venta y en el ticket.</p>
    <form id="form-descuento" autocomplete="off">
      <fieldset style="border:1px solid var(--borde);border-radius:8px;margin:8px 0"><legend>Aplicar a</legend>
        <label style="display:block"><input type="radio" name="desc-alcance" value="linea" ${sel ? 'checked' : 'disabled'}> Solo el artículo seleccionado${sel ? `: ${esc(sel.descripcion)} ${esc(sel.marca)}` : ' (seleccione uno en la lista)'}</label>
        <label style="display:block"><input type="radio" name="desc-alcance" value="venta" ${sel ? '' : 'checked'}> Toda la venta</label></fieldset>
      <fieldset style="border:1px solid var(--borde);border-radius:8px;margin:8px 0"><legend>Tipo de descuento</legend>
        <label style="display:inline-block;margin-right:16px"><input type="radio" name="desc-tipo" value="pct" checked> Porcentaje (%)</label>
        <label style="display:inline-block;margin-right:16px"><input type="radio" name="desc-tipo" value="monto"> Monto ($)</label>
        <label style="display:inline-block"><input type="radio" name="desc-tipo" value="precio_final" ${sel ? '' : 'disabled'}> Precio final ($)</label></fieldset>
      <p class="nota" id="desc-final-ayuda" hidden></p>
      <div class="campo"><label for="desc-valor">Valor</label><input id="desc-valor" inputmode="decimal" placeholder="10"></div>
      <div class="campo"><label for="desc-clave">Su clave (o la de un supervisor)</label><input id="desc-clave" type="text" data-pin inputmode="numeric" autocomplete="off" placeholder="••••"></div>
      <div id="msg-desc" class="mensaje" role="status" aria-live="polite"></div>
      <div class="filas"><button class="btn" type="button" id="desc-cerrar">Cancelar</button>${hayManual ? `<button class="btn btn-peligro" type="button" id="desc-quitar">Quitar descuentos</button>` : ''}<button class="btn btn-primario" type="submit" id="desc-aplicar" style="width:auto;flex:1">${ico('check')}<span>Autorizar y aplicar</span></button></div>
    </form>`;
  $('#desc-cerrar').addEventListener('click', () => d.close());
  // «Precio final»: se escribe lo que debe costar la prenda (por pieza) y el descuento se calcula solo; vale para el artículo seleccionado.
  const alPrecioFinal = () => {
    const pf = d.querySelector('input[name="desc-tipo"]:checked').value === 'precio_final';
    const ay = $('#desc-final-ayuda');
    ay.hidden = !pf;
    if (pf && sel) {
      d.querySelector('input[name="desc-alcance"][value="linea"]').checked = true;
      ay.textContent = `${sel.descripcion}: precio actual ${mxn(sel.precio_unit)}${sel.qty > 1 ? ` por pieza (${sel.qty} piezas)` : ''}. Escriba el precio final por pieza; el descuento se calcula solo.`;
      $('#desc-valor').placeholder = '399';
    } else $('#desc-valor').placeholder = '10';
  };
  for (const r of d.querySelectorAll('input[name="desc-tipo"]')) r.addEventListener('change', alPrecioFinal);
  for (const r of d.querySelectorAll('input[name="desc-alcance"]')) r.addEventListener('change', () => { if (r.value === 'venta' && r.checked && d.querySelector('input[name="desc-tipo"][value="precio_final"]').checked) d.querySelector('input[name="desc-tipo"][value="pct"]').checked = true; alPrecioFinal(); });
  const q = $('#desc-quitar');
  if (q) q.addEventListener('click', async () => {
    const alcance = d.querySelector('input[name="desc-alcance"]:checked').value;
    try { const r = await api('/api/venta/descuento/quitar', { cart: S.cart, linea_id: alcance === 'linea' ? sel.linea_id : null }); S.carrito = r.carrito; pintarCarrito(); d.close(); msg('Descuento quitado.'); }
    catch (e) { const m = $('#msg-desc'); m.className = 'mensaje error'; m.textContent = e.message; }
  });
  $('#form-descuento').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const m = $('#msg-desc');
    let tipo = d.querySelector('input[name="desc-tipo"]:checked').value;
    const alcance = d.querySelector('input[name="desc-alcance"]:checked').value;
    const crudo = $('#desc-valor').value.trim();
    let valor = null;
    if (tipo === 'pct') valor = /^\d{1,3}$/.test(crudo) ? Number(crudo) : null;
    else valor = parseMXN(crudo);
    if (tipo === 'precio_final') {
      if (!sel || alcance !== 'linea') { m.className = 'mensaje error'; m.textContent = 'El precio final es para un artículo: selecciónelo en la lista.'; return; }
      if (!valor) { m.className = 'mensaje error'; m.textContent = 'Escriba el precio final en pesos (por pieza).'; return; }
      if (valor >= sel.precio_unit) { m.className = 'mensaje error'; m.textContent = `El precio final debe ser menor al precio actual (${mxn(sel.precio_unit)}).`; return; }
      valor = (sel.precio_unit - valor) * sel.qty; // descuento en pesos de toda la línea
      tipo = 'monto';
    }
    if (!valor) { m.className = 'mensaje error'; m.textContent = tipo === 'pct' ? 'Escriba un porcentaje entero de 1 a 100.' : 'Escriba el monto del descuento en pesos.'; return; }
    try {
      const r = await api('/api/venta/descuento', { cart: S.cart, linea_id: alcance === 'linea' ? sel.linea_id : null, tipo, valor, clave: $('#desc-clave').value });
      S.carrito = r.carrito; pintarCarrito(); d.close(); msg(`Descuento aplicado por ${r.supervisor}.`);
    } catch (e) { m.className = 'mensaje error'; m.textContent = e.message; $('#desc-clave').value = ''; }
  });
  d.showModal();
  $('#desc-valor').focus();
}

// ── recepción de mercancía del almacén (la tienda confirma al escanear por primera vez) ──
/** Rótulo del botón con el número de ventas guardadas. */
async function actualizarEspera() {
  try {
    const r = await api('/api/venta/espera');
    S.espera = r.espera;
    const t = $('#txt-espera');
    if (t) t.textContent = r.espera.length ? `Venta en espera (${r.espera.length})` : 'Venta en espera';
    return r.espera;
  } catch { return S.espera ?? []; }
}
/** Ventas en espera: guardar la actual, retomar o descartar una guardada. */
async function abrirEspera() {
  const lista = await actualizarEspera();
  const d = dialogo('dlg-espera');
  d.setAttribute('aria-labelledby', 'esp-titulo');
  const tieneArt = (S.carrito?.lineas?.length ?? 0) > 0 || !!S.carrito?.cambio; // un cambio ya aceptado (prenda que regresa) también se puede guardar
  const filas = lista.map((v) => `<tr data-cart="${esc(v.cart_id)}"><td>${esc(hora(v.desde))}</td><td>${esc(v.nota || '—')}<div class="nota">${v.articulos.map((a) => `${a.qty} ${esc(a.descripcion)}`).join(', ')}${v.piezas > v.articulos.reduce((n, a) => n + a.qty, 0) ? '…' : ''}</div></td><td class="num">${v.piezas}</td><td class="num">${mxn(v.total)}</td><td><button class="btn btn-primario esp-retomar" type="button">Retomar</button> <button class="btn esp-descartar" type="button">Descartar</button></td></tr>`).join('');
  d.innerHTML = `<h2 id="esp-titulo" style="margin-top:0">Venta en espera</h2>
    <div class="campo"><label for="esp-nota">Nota (nombre del cliente o referencia)</label><input id="esp-nota" class="texto" maxlength="80" placeholder="Opcional" ${tieneArt ? '' : 'disabled'}></div>
    <button class="btn btn-primario" type="button" id="esp-guardar" ${tieneArt ? '' : 'disabled'}>${ico('pause')}<span>Poner esta venta en espera</span></button>
    ${tieneArt ? '' : '<p class="nota">La venta en pantalla no tiene artículos: no hay nada que poner en espera.</p>'}
    <h3>Ventas guardadas (${lista.length})</h3>
    ${lista.length ? `<table class="tabla"><thead><tr><th>Hora</th><th>Detalle</th><th class="num">Piezas</th><th class="num">Total</th><th></th></tr></thead><tbody>${filas}</tbody></table><p class="nota">Al retomar, los precios y promociones se calculan de nuevo; las existencias no se reservan.</p>` : '<p class="nota">No hay ventas en espera.</p>'}
    <div id="msg-espera" class="mensaje" role="status" aria-live="polite"></div>
    <div class="filas"><button class="btn" type="button" id="esp-cerrar">Cerrar</button></div>`;
  const error = (e) => { const m = $('#msg-espera'); m.className = 'mensaje error'; m.textContent = e.message; };
  $('#esp-cerrar').addEventListener('click', () => d.close());
  $('#esp-guardar').addEventListener('click', async () => {
    try {
      const r = await api('/api/venta/espera', { cart: S.cart, nota: $('#esp-nota').value });
      S.cart = r.cart; S.carrito = r.carrito; S.sel = null; d.close(); await ir('venta'); msg('Venta guardada en espera.');
    } catch (e) { error(e); }
  });
  d.querySelectorAll('.esp-retomar').forEach((b) => b.addEventListener('click', async () => {
    try {
      const r = await api('/api/venta/retomar', { cart: b.closest('tr').dataset.cart, actual: S.cart });
      S.cart = r.cart; S.carrito = r.carrito; S.sel = null; d.close(); await ir('venta'); msg('Venta retomada.');
    } catch (e) { error(e); }
  }));
  d.querySelectorAll('.esp-descartar').forEach((b) => b.addEventListener('click', async () => {
    if (!b.dataset.seguro) { b.dataset.seguro = '1'; b.textContent = '¿Descartar? Confirmar'; return; }
    try { await api('/api/venta/espera/descartar', { cart: b.closest('tr').dataset.cart }); await abrirEspera(); } catch (e) { error(e); }
  }));
  if (!d.open) d.showModal();
}
function dialogo(id) {
  let d = document.getElementById(id);
  if (!d) { d = document.createElement('dialog'); d.id = id; document.body.appendChild(d); }
  return d;
}
async function ofrecerRecepciones(lista, linea) {
  for (const rec of lista ?? []) {
    const d = dialogo('dlg-recepcion');
    d.innerHTML = `<h2 id="rec-titulo" style="margin-top:0">Mercancía nueva del almacén</h2>
      <p><b>${esc(linea.descripcion)} ${esc(linea.marca)}</b></p>
      <p id="rec-pregunta" style="font-size:18px">¿Confirmas que recibiste <b>${rec.qty} pieza${rec.qty === 1 ? '' : 's'}</b>?</p>
      <p class="nota">Al confirmar, esas piezas entran a la existencia de esta tienda. Si la cuenta no coincide, elige «Otra cantidad» y captura las que sí llegaron: las faltantes quedan registradas para Administración.</p>
      <div id="rec-otra-bloque" hidden><div class="campo"><label for="rec-qty">Piezas que sí recibí (de ${rec.qty})</label><input id="rec-qty" type="number" min="0" max="${rec.qty - 1}" step="1" inputmode="numeric"></div>
        <div id="rec-aviso" class="mensaje aviso" role="status" aria-live="polite"></div>
        <div class="filas"><button class="btn" type="button" id="rec-otra-cancelar">Volver</button><button class="btn btn-primario" type="button" id="rec-otra-ok" disabled style="width:auto;flex:1">${ico('check')}<span>Confirmar esta cantidad</span></button></div></div>
      <div class="filas" id="rec-botones"><button class="btn" type="button" id="rec-no">Ahora no</button><button class="btn" type="button" id="rec-otra">${ico('pencil')}<span>Otra cantidad</span></button><button class="btn btn-primario" type="button" id="rec-si" style="width:auto;flex:1">${ico('check')}<span>Sí, recibí ${rec.qty}</span></button></div>`;
    d.setAttribute('aria-labelledby', 'rec-titulo');
    await new Promise((fin) => {
      $('#rec-no').addEventListener('click', () => { d.close(); fin(); });
      const confirmar = async (qty) => {
        try {
          const r = await api('/api/recepciones/confirmar', { entrega_id: rec.entrega_id, ...(qty === undefined ? {} : { qty }) });
          d.close(); const v = await api('/api/venta/actual', {}); S.carrito = v.carrito; pintarCarrito();
          msg(r.faltan > 0 ? `Recepción confirmada: ${r.qty} pieza(s) de ${linea.descripcion} entraron a la existencia. Se registró el faltante de ${r.faltan} pieza(s) para Administración.` : `Recepción confirmada: ${r.qty} pieza(s) de ${linea.descripcion} entraron a la existencia de la tienda.`);
        } catch (e) { d.close(); msg(e.message, 'error'); }
        fin();
      };
      $('#rec-si').addEventListener('click', () => confirmar());
      $('#rec-otra').addEventListener('click', () => { $('#rec-botones').hidden = true; $('#rec-otra-bloque').hidden = false; $('#rec-qty').focus(); });
      $('#rec-otra-cancelar').addEventListener('click', () => { $('#rec-otra-bloque').hidden = true; $('#rec-botones').hidden = false; });
      $('#rec-qty').addEventListener('input', () => {
        const v = $('#rec-qty').value.trim();
        const n = Number(v);
        const ok = v !== '' && Number.isInteger(n) && n >= 0 && n < rec.qty;
        $('#rec-otra-ok').disabled = !ok;
        $('#rec-aviso').textContent = ok ? `Entran ${n} pieza(s) a la existencia y se registran ${rec.qty - n} faltante(s).` : '';
      });
      $('#rec-otra-ok').addEventListener('click', () => confirmar(Number($('#rec-qty').value)));
      d.showModal();
    });
  }
  $('#scan')?.focus();
}

// ── Almacén (Administración) ──
const TIENDAS_ALM = { DUO: 'Tienda DÚO', LON: 'Tienda London' };
const uuid = () => (window.crypto?.randomUUID ? window.crypto.randomUUID() : `id-${Date.now()}-${Math.random().toString(16).slice(2)}`);
async function vistaAlmacen() {
  const j = await api('/api/admin/almacen');
  S.alm = { ...(S.alm ?? { q: '', solo: true }), tiendas: j.tiendas, items: j.items, hoy: j.hoy };
  pintarAvisoPiso(j.avisos, j.aviso_faltantes);
  $('#vista').innerHTML = `<div class="titulo-vista">${ico('warehouse')}<h1>Almacén</h1></div>
    <div class="solo-movil buscador-piso"><input id="alm-q-m" type="search" inputmode="search" enterkeyhint="search" autocomplete="off" autocapitalize="off" placeholder="Estilo, código o texto (ej. 123L)" aria-label="Buscar en el almacén" value="${esc(S.alm.q)}"></div>
    <section class="panel" id="panel-alm-acciones"><div class="filas" style="align-items:center">
      <button class="btn btn-primario" id="btn-alta-lote" type="button" style="width:auto">${ico('upload')}<span>Alta Lote de inventario</span></button>
      <button class="btn" id="btn-alta-manual" type="button">${ico('plus')}<span>Alta manual</span></button>
      <button class="btn" id="btn-reporte-entregas" type="button">${ico('chart')}<span>Reporte de entregas</span></button>
      <label class="solo-escritorio" style="margin-left:auto">${ico('search')} <input class="texto" id="alm-q" placeholder="Buscar por código, Item #, texto…" value="${esc(S.alm.q)}" style="padding:6px 8px;border:1px solid var(--borde);border-radius:6px;background:var(--superficie)"></label>
      <label><input type="checkbox" id="alm-solo" ${S.alm.solo ? 'checked' : ''}> Solo con piezas en el almacén o por confirmar</label></div>
      <p class="nota solo-escritorio">Las piezas llegan aquí sin etiquetar y sin existencia en tienda. Confirme las etiquetas, anote cuántas va a cada tienda y entregue: la tienda confirma la recepción al escanear el artículo por primera vez.</p>
      <div id="msg-alm" class="mensaje" role="status" aria-live="polite"></div></section>
    <section class="panel faltantes" id="panel-faltantes" style="margin-top:12px" hidden></section>
    <div class="solo-movil" id="alm-tarjetas"></div>
    <section class="panel solo-escritorio" style="margin-top:12px"><div class="tabla-cont"><table id="tabla-almacen"><thead><tr><th>Item #</th><th>Código</th><th>Descripción</th><th>Estilo</th><th>Lote</th><th>Pedimento</th><th>Departamento</th><th class="num">Almacén</th><th>Etiqueta precio</th><th>Etiqueta costura</th>${j.tiendas.map((t) => `<th>${esc(TIENDAS_ALM[t] ?? t)}</th>`).join('')}<th>Por confirmar</th><th>Sacar a piso</th><th></th></tr></thead><tbody id="alm-cuerpo"></tbody></table></div><p class="nota" id="alm-pie"></p></section>`;
  $('#btn-alta-lote').addEventListener('click', abrirAltaLote);
  $('#btn-alta-manual').addEventListener('click', abrirAltaManual);
  $('#btn-reporte-entregas').addEventListener('click', () => ir('entregas'));
  S.alm.faltantes = j.faltantes;
  pintarFaltantes();
  $('#alm-q').addEventListener('input', (ev) => { S.alm.q = ev.target.value; pintarAlmacen(); });
  $('#alm-q-m').addEventListener('input', (ev) => { S.alm.q = ev.target.value; pintarAlmacen(); });
  $('#alm-solo').addEventListener('change', (ev) => { S.alm.solo = ev.target.checked; pintarAlmacen(); });
  pintarAlmacen();
}
/** Entradas de almacén de un artículo: ver cada una y corregir la que se capturó mal (cantidad y/o pedimento, con motivo). */
async function abrirEntradas(itemId) {
  const { entradas } = await api(`/api/admin/almacen/entradas?item_id=${encodeURIComponent(itemId)}`);
  const it = S.alm.items.find((x) => x.item_id === itemId);
  const d = dialogo('dlg-entradas');
  d.setAttribute('aria-labelledby', 'ent-titulo');
  d.innerHTML = `<h2 id="ent-titulo" style="margin-top:0">Entradas de ${esc(it?.descripcion ?? '')} ${esc(it?.marca ?? '')}</h2>
    <p class="nota" style="margin-top:0">Si una entrada se capturó mal, corríjala aquí con el motivo. La captura original no se borra: queda en el historial del artículo. Corregir a 0 equivale a anularla.</p>
    <div class="tabla-cont"><table id="tabla-entradas"><thead><tr><th>Fecha</th><th>Lote / archivo</th><th class="num">Piezas</th><th>Pedimento</th><th>Capturó</th><th>Corrección</th><th></th></tr></thead><tbody>
    ${entradas.map((e) => `<tr data-entrada="${esc(e.entrada_id)}"><td>${esc(e.ocurrio_en.slice(0, 10))}</td><td>${esc(e.lote_doc)}${e.fuente ? ` · ${esc(e.fuente)}` : ''}</td><td class="num">${e.qty}${e.corregida ? ` <small class="nota">(era ${e.qty_original})</small>` : ''}</td><td>${esc(e.pedimento ?? '—')}</td><td>${esc(e.por)}</td><td>${e.corregida ? `${esc(e.motivo)} · ${esc(e.corregida_por)}` : '—'}</td><td><button class="btn ent-corregir" type="button">${ico('pencil')}<span>Corregir</span></button></td></tr>`).join('') || '<tr><td colspan="7" class="vacio">Este artículo no tiene entradas de almacén.</td></tr>'}</tbody></table></div>
    <div id="ent-form" hidden></div>
    <div id="msg-ent" class="mensaje" role="status" aria-live="polite"></div>
    <div class="filas"><button class="btn" type="button" id="ent-cerrar">Cerrar</button></div>`;
  $('#ent-cerrar').addEventListener('click', () => d.close());
  for (const b of d.querySelectorAll('.ent-corregir')) b.addEventListener('click', () => {
    const e = entradas.find((x) => x.entrada_id === b.closest('tr').dataset.entrada);
    const f = $('#ent-form');
    f.hidden = false;
    f.innerHTML = `<h3>Corregir la entrada de ${esc(e.ocurrio_en.slice(0, 10))} (${esc(e.lote_doc)})</h3>
      <div class="campo"><label for="ent-qty">Piezas correctas</label><input id="ent-qty" type="number" min="0" step="1" value="${e.qty}"></div>
      <div class="campo"><label for="ent-ped">Pedimento correcto</label><input id="ent-ped" class="texto" value="${esc(e.pedimento ?? '')}"></div>
      <div class="campo"><label for="ent-motivo">Motivo de la corrección</label><input id="ent-motivo" class="texto" maxlength="120" placeholder="Obligatorio"></div>
      <div class="filas"><button class="btn" type="button" id="ent-cancelar">Cancelar</button><button class="btn btn-primario" type="button" id="ent-guardar" style="width:auto;flex:1">${ico('check')}<span>Guardar corrección</span></button></div>`;
    $('#ent-cancelar').addEventListener('click', () => { f.hidden = true; });
    const correccionId = uuid();
    const guardar = async (confirmar) => {
      const m = $('#msg-ent');
      try {
        const cuerpo = { correccion_id: correccionId, entrada_id: e.entrada_id, motivo: $('#ent-motivo').value, confirmar_negativo: !!confirmar };
        if ($('#ent-qty').value.trim() !== '' && Number($('#ent-qty').value) !== e.qty) cuerpo.qty = Number($('#ent-qty').value);
        if ($('#ent-ped').value.trim() !== (e.pedimento ?? '')) cuerpo.pedimento = $('#ent-ped').value.trim();
        const r = await api('/api/admin/almacen/corregir-entrada', cuerpo);
        S.alm.items = r.almacen.items; pintarAlmacen(); pintarAvisoPiso(r.almacen.avisos, r.almacen.aviso_faltantes);
        await abrirEntradas(itemId);
        const n = $('#msg-ent'); n.className = 'mensaje ok'; n.textContent = `Entrada corregida. En el almacén quedan ${r.existencia} pieza(s).`;
      } catch (err) {
        m.className = 'mensaje error'; m.textContent = err.message;
        if (err.codigo === 'CONFIRMACION_REQUERIDA') m.insertAdjacentHTML('beforeend', ` <button class="btn" type="button" id="ent-confirmar-negativo">Aplicar de todos modos</button>`), $('#ent-confirmar-negativo').addEventListener('click', () => guardar(true));
      }
    };
    $('#ent-guardar').addEventListener('click', () => guardar(false));
  });
  if (!d.open) d.showModal();
}
/** Piezas faltantes: la tienda recibió menos de lo entregado. Cada renglón se actualiza o corrige con lo que se fue encontrando. */
function pintarFaltantes() {
  const el = $('#panel-faltantes');
  if (!el) return;
  const todos = S.alm.faltantes ?? [];
  const pend = todos.filter((f) => f.estado === 'pendiente');
  const ver = todos.filter((f) => f.estado === 'pendiente' || S.alm.verResueltos);
  el.hidden = todos.length === 0;
  if (!todos.length) return;
  const dest = ['almacen', ...S.alm.tiendas, 'perdida'];
  const NOM = { almacen: 'Encontradas en almacén', perdida: 'Perdidas' };
  const nombreDest = (d) => NOM[d] ?? `En ${TIENDAS_ALM[d] ?? d}`;
  el.innerHTML = `<h2>Piezas faltantes <span class="insignia naranja" id="n-faltantes">${pend.reduce((n, f) => n + f.pendiente, 0)} por ubicar</span></h2>
    <p class="nota">La tienda recibió menos piezas de las entregadas. Anote dónde aparecieron o si se dieron por perdidas; puede corregirlo cuantas veces haga falta. Las piezas encontradas en el almacén o en una tienda se suman a su existencia.</p>
    <label><input type="checkbox" id="fal-resueltos" ${S.alm.verResueltos ? 'checked' : ''}> Mostrar también los ya ubicados (${todos.length - pend.length})</label>
    <div class="tabla-cont"><table id="tabla-faltantes"><thead><tr><th>Artículo</th><th>Tienda</th><th class="num">Entregadas</th><th class="num">Recibidas</th><th class="num">Faltan</th>${dest.map((d) => `<th>${esc(nombreDest(d))}</th>`).join('')}<th class="num">Sin ubicar</th><th></th></tr></thead><tbody>
    ${ver.map((f) => `<tr data-entrega="${esc(f.entrega_id)}" class="${f.estado === 'pendiente' ? 'faltante-pendiente' : ''}"><td>${esc(f.item_no ?? '—')} ${esc(f.descripcion)} ${esc(f.marca)}<div class="nota">${esc(f.codigo)}</div></td><td>${esc(TIENDAS_ALM[f.tienda] ?? f.tienda)}</td><td class="num">${f.entregadas}</td><td class="num">${f.recibidas}</td><td class="num">${f.faltan}</td>
      ${dest.map((d) => `<td><input type="number" min="0" step="1" data-destino="${esc(d)}" value="${f.ubicadas[d] ?? 0}" aria-label="${esc(nombreDest(d))}"></td>`).join('')}
      <td class="num" data-col="sin-ubicar"><b>${f.pendiente}</b></td><td><button class="btn btn-guardar-faltante" type="button">${ico('check')}<span>Guardar</span></button></td></tr>`).join('') || '<tr><td colspan="20" class="vacio">Todo está ubicado.</td></tr>'}</tbody></table></div>
    <div id="msg-faltantes" class="mensaje" role="status" aria-live="polite"></div>`;
  $('#fal-resueltos').addEventListener('change', (ev) => { S.alm.verResueltos = ev.target.checked; pintarFaltantes(); });
  for (const tr of el.querySelectorAll('tr[data-entrega]')) {
    const f = todos.find((x) => x.entrega_id === tr.dataset.entrega);
    const suma = () => [...tr.querySelectorAll('input[data-destino]')].reduce((n, i) => n + (Number(i.value) || 0), 0);
    tr.addEventListener('input', () => { tr.querySelector('[data-col="sin-ubicar"]').innerHTML = `<b>${f.faltan - suma()}</b>`; });
    tr.querySelector('.btn-guardar-faltante').addEventListener('click', async () => {
      const m = $('#msg-faltantes');
      const destinos = Object.fromEntries([...tr.querySelectorAll('input[data-destino]')].map((i) => [i.dataset.destino, Number(i.value) || 0]));
      try {
        const r = await api('/api/admin/almacen/faltante', { entrega_id: f.entrega_id, destinos });
        S.alm.faltantes = r.faltantes; S.alm.items = r.items; pintarFaltantes(); pintarAlmacen(); pintarAvisoPiso(r.avisos, r.aviso_faltantes);
        const n = $('#msg-faltantes'); n.className = 'mensaje ok'; n.textContent = 'Faltante actualizado.';
      } catch (e) { m.className = 'mensaje error'; m.textContent = e.message; }
    });
  }
}
function pintarAlmacen() {
  const a = S.alm;
  const q = a.q.trim().toLowerCase();
  const visibles = a.items.filter((i) => (!a.solo || i.existencia !== 0 || Object.keys(i.pendiente_por_tienda).length)
    && (!q || [i.codigo, i.item_no, i.descripcion, i.marca, i.estilo, i.lote, i.departamento, ...i.pedimentos].join(' ').toLowerCase().includes(q)));
  // Lo que coincide EXACTO con el estilo escrito sale primero (en el almacén se dicta «el estilo 123L»).
  if (q) visibles.sort((x, y) => Number(y.estilo.toLowerCase() === q) - Number(x.estilo.toLowerCase() === q) || Number(y.estilo.toLowerCase().startsWith(q)) - Number(x.estilo.toLowerCase().startsWith(q)));
  const lim = visibles.slice(0, 150);
  pintarTarjetasAlmacen(lim, visibles.length);
  $('#alm-cuerpo').innerHTML = lim.map((i) => `<tr data-item="${esc(i.item_id)}" data-codigo="${esc(i.codigo)}" ${marcaPiso(i) ? `class="piso-${marcaPiso(i).tono}" data-piso="${marcaPiso(i).tono}"` : ''}>
    <td>${esc(i.item_no ?? '—')}</td><td>${esc(i.codigo)}</td><td class="desc">${esc(i.descripcion)} ${esc(i.marca)}</td><td>${esc(i.estilo)}</td><td>${esc(i.lote)}</td><td>${esc(i.pedimentos.join(', ') || '—')}</td><td>${esc(i.departamento)}</td>
    <td class="num" data-col="almacen"><b>${i.existencia}</b></td>
    <td><input type="checkbox" class="et-precio" aria-label="Etiqueta de precio"></td><td><input type="checkbox" class="et-costura" aria-label="Etiqueta de costura"></td>
    ${a.tiendas.map((t) => `<td><input type="number" min="0" step="1" class="q-${esc(t)}" data-tienda="${esc(t)}" aria-label="Piezas para ${esc(TIENDAS_ALM[t] ?? t)}" style="width:70px;padding:4px;border:1px solid var(--borde);border-radius:6px;background:var(--superficie);text-align:right"></td>`).join('')}
    <td data-col="pendiente">${Object.entries(i.pendiente_por_tienda).map(([t, n]) => `${esc(TIENDAS_ALM[t] ?? t)}: ${n}`).join(' · ') || '—'}</td>
    <td class="celda-piso"><input type="date" class="f-piso" value="${esc(i.sacar_a_piso ?? '')}" aria-label="Fecha para sacar a piso"> ${marcaPiso(i) ? `<span class="marca-piso ${marcaPiso(i).tono}" data-col="marca-piso">${esc(marcaPiso(i).texto)}</span>` : ''}</td>
    <td class="filas" style="flex-wrap:nowrap"><button class="btn btn-entregar" type="button">${ico('check')}<span>Entregar</span></button><button class="btn btn-entradas" type="button" title="Ver las entradas de este artículo y corregir una mal capturada">${ico('pencil')}<span>Entradas</span></button></td></tr>`).join('')
    || `<tr><td colspan="${12 + a.tiendas.length}" class="vacio">${a.items.length ? 'Nada coincide con el filtro.' : 'El almacén está vacío. Use «Alta Lote de inventario» o «Alta manual».'}</td></tr>`;
  $('#alm-pie').textContent = visibles.length > lim.length ? `Se muestran ${lim.length} de ${visibles.length}. Use el buscador para acotar.` : `${visibles.length} artículo(s).`;
  for (const tr of $('#alm-cuerpo').querySelectorAll('tr[data-item]')) {
    // Escribir una cantidad para una tienda marca solas las dos etiquetas (el almacén las pone al preparar la entrega).
    for (const inp of tr.querySelectorAll('input[type=number]')) inp.addEventListener('input', () => { if (Number(inp.value) > 0) { tr.querySelector('.et-precio').checked = true; tr.querySelector('.et-costura').checked = true; } });
    tr.querySelector('.btn-entregar').addEventListener('click', () => entregarFila(tr, false));
    tr.querySelector('.btn-entradas').addEventListener('click', () => abrirEntradas(tr.dataset.item));
    tr.querySelector('.f-piso').addEventListener('change', (ev) => fijarPiso(tr.dataset.item, ev.target.value));
  }
}

/** Almacén en el teléfono: una tarjeta por artículo con interruptores de etiqueta y contadores por tienda (mismas clases que la tabla, para reutilizar `entregarFila`). */
function pintarTarjetasAlmacen(lista, total) {
  const cont = $('#alm-tarjetas');
  if (!cont) return;
  const a = S.alm;
  const nom = (t) => TIENDAS_ALM[t] ?? t;
  cont.innerHTML = (lista.map((i) => `<article class="tarjeta-alm" data-item="${esc(i.item_id)}" data-codigo="${esc(i.codigo)}">
      <div class="alm-titulo">${esc(i.descripcion)} ${esc(i.marca)}</div>
      <div class="alm-meta"><span>Estilo <b>${esc(i.estilo || '—')}</b></span><span>Lote <b>${esc(i.lote || '—')}</b></span><span>Item # <b>${esc(i.item_no ?? '—')}</b></span><span>${esc(i.departamento)}</span></div>
      <div class="alm-existencia">En almacén: <b>${i.existencia}</b>${Object.keys(i.pendiente_por_tienda).length ? ` · por confirmar: ${Object.entries(i.pendiente_por_tienda).map(([t, n]) => `${esc(nom(t))} ${n}`).join(' · ')}` : ''}${marcaPiso(i) ? ` · <span class="marca-piso ${marcaPiso(i).tono}">${esc(marcaPiso(i).texto)}</span>` : ''}</div>
      <div class="alm-etiquetas"><label class="interruptor"><input type="checkbox" class="et-precio"><span>Etiqueta de precio</span></label><label class="interruptor"><input type="checkbox" class="et-costura"><span>Etiqueta de costura</span></label></div>
      <div class="alm-destinos">${a.tiendas.map((t) => `<div class="contador"><span>Para ${esc(nom(t))}</span><div class="cont-ctrl"><button type="button" class="cont-menos" aria-label="Una pieza menos para ${esc(nom(t))}">−</button><input type="number" inputmode="numeric" min="0" step="1" class="q-${esc(t)}" data-tienda="${esc(t)}" aria-label="Piezas para ${esc(nom(t))}" placeholder="0"><button type="button" class="cont-mas" aria-label="Una pieza más para ${esc(nom(t))}">+</button></div></div>`).join('')}</div>
      ${a.tiendas.length > 1 ? '<button type="button" class="btn btn-igual">Misma cantidad para todas</button>' : ''}
      <div class="alm-acciones"><button class="btn btn-primario btn-entregar" type="button">${ico('check')}<span>Entregar</span></button><button class="btn btn-entradas" type="button">Entradas</button></div>
      <label class="alm-extra">Sacar a piso: <input type="date" class="f-piso" value="${esc(i.sacar_a_piso ?? '')}"></label>
    </article>`).join('')) || `<p class="vacio">${a.items.length ? 'Nada coincide con lo que escribió.' : 'El almacén está vacío.'}</p>`;
  if (lista.length) cont.insertAdjacentHTML('beforeend', `<p class="nota">${total > lista.length ? `Se muestran ${lista.length} de ${total}. Escriba más del estilo para acotar.` : `${total} artículo(s).`}</p>`);
  for (const card of cont.querySelectorAll('article[data-item]')) {
    const inputs = [...card.querySelectorAll('input[type=number]')];
    const marcarEtiquetas = () => { if (inputs.some((x) => Number(x.value) > 0)) { card.querySelector('.et-precio').checked = true; card.querySelector('.et-costura').checked = true; } };
    for (const inp of inputs) {
      inp.addEventListener('input', marcarEtiquetas);
      const ctl = inp.closest('.cont-ctrl');
      ctl.querySelector('.cont-menos').addEventListener('click', () => { inp.value = String(Math.max(0, (Number(inp.value) || 0) - 1)); marcarEtiquetas(); });
      ctl.querySelector('.cont-mas').addEventListener('click', () => { inp.value = String((Number(inp.value) || 0) + 1); marcarEtiquetas(); });
    }
    const igual = card.querySelector('.btn-igual');
    if (igual) igual.addEventListener('click', () => { const v = inputs.map((x) => x.value).find((x) => x !== '' && Number(x) > 0); if (v !== undefined) { for (const x of inputs) x.value = v; marcarEtiquetas(); } });
    card.querySelector('.btn-entregar').addEventListener('click', () => entregarFila(card, false));
    card.querySelector('.btn-entradas').addEventListener('click', () => abrirEntradas(card.dataset.item));
    card.querySelector('.f-piso').addEventListener('change', (ev) => fijarPiso(card.dataset.item, ev.target.value));
  }
}
const fechaPiso = (f) => `${f.slice(8, 10)}/${MESES[Number(f.slice(5, 7)) - 1]}/${f.slice(2, 4)}`;
const diasPiso = (hoy, f) => Math.round((Date.parse(`${f}T00:00:00Z`) - Date.parse(`${hoy}T00:00:00Z`)) / 86400000);
/** Morado: hay fecha y faltan más de 7 días. Rojo: faltan 7 días o menos (o ya pasó) y todavía hay piezas en el almacén. Sin piezas, ya se sacó: sin marca. */
function marcaPiso(i) {
  if (!i.sacar_a_piso || i.existencia <= 0) return null;
  const d = diasPiso(S.alm.hoy, i.sacar_a_piso);
  if (d < 0) return { tono: 'roja', texto: `Vencido hace ${-d} día${d === -1 ? '' : 's'}` };
  if (d <= 7) return { tono: 'roja', texto: d === 0 ? 'Hoy' : `En ${d} día${d === 1 ? '' : 's'}` };
  return { tono: 'morada', texto: `En ${d} días` };
}
async function fijarPiso(itemId, fecha) {
  const m = $('#msg-alm');
  try {
    const r = await api('/api/admin/almacen/piso', { item_id: itemId, fecha: fecha || null });
    S.alm.items = r.items; S.alm.hoy = r.hoy;
    pintarAlmacen(); pintarAvisoPiso(r.avisos, r.aviso_faltantes);
    m.className = 'mensaje ok'; m.textContent = fecha ? `Recordatorio guardado: sacar a piso el ${fechaPiso(fecha)}.` : 'Recordatorio quitado.';
  } catch (e) { m.className = 'mensaje error'; m.textContent = e.message; }
}
/** Aviso en el menú lateral de Administración (junto al de modo de prueba). */
/** Marca naranja en el menú: piezas faltantes por ubicar (un faltante no debe quedarse días sin que nadie lo vea). */
function pintarAvisoFaltantes(af) {
  let a = $('#aviso-faltantes');
  if (S.sesion?.rol !== 'admin' || !af?.piezas) { if (a) a.remove(); return; }
  if (!a) {
    a = document.createElement('button'); a.id = 'aviso-faltantes'; a.type = 'button'; a.className = 'aviso-piso aviso-faltantes';
    $('.nav').insertBefore(a, $('.nav .prueba'));
    a.addEventListener('click', async () => { await ir('almacen'); $('#panel-faltantes')?.scrollIntoView({ block: 'start' }); });
  }
  a.innerHTML = `<strong>Piezas faltantes</strong><br><b>${af.piezas}</b> pieza${af.piezas === 1 ? '' : 's'} por ubicar en <b>${af.entregas}</b> entrega${af.entregas === 1 ? '' : 's'}`;
}
function pintarAvisoPiso(avisos, faltantes) {
  pintarAvisoFaltantes(faltantes);
  let a = $('#aviso-piso');
  if (S.sesion?.rol !== 'admin' || !avisos?.length) { if (a) a.remove(); return; }
  if (!a) { a = document.createElement('button'); a.id = 'aviso-piso'; a.type = 'button'; $('.nav').insertBefore(a, $('#aviso-faltantes') ?? $('.nav .prueba')); a.addEventListener('click', () => ir('almacen')); }
  const urgente = avisos.some((x) => x.urgente);
  a.className = `aviso-piso ${urgente ? 'roja' : 'morada'}`;
  const prim = avisos.slice(0, 3);
  a.innerHTML = `<strong>Sacar a piso</strong><br>Revise los artículos para sacar a piso el ${prim.map((x) => `<b>${fechaPiso(x.fecha)}</b> (${x.articulos})`).join(', ')}${avisos.length > 3 ? ` y ${avisos.length - 3} fecha(s) más` : ''}.`;
}
async function avisosPisoInicial() {
  if (S.sesion?.rol !== 'admin') return pintarAvisoPiso(null);
  try { (async (j) => pintarAvisoPiso(j.avisos, j.aviso_faltantes))(await api('/api/admin/almacen')); } catch { /* sin aviso */ }
}
async function entregarFila(tr, confirmarExceso) {
  const m = $('#msg-alm');
  const destinos = {};
  for (const inp of tr.querySelectorAll('input[type=number]')) if (inp.value !== '') destinos[inp.dataset.tienda] = Number(inp.value);
  S.refEntrega = S.refEntrega ?? {};
  const ref = (S.refEntrega[tr.dataset.item] ??= uuid());
  try {
    const r = await api('/api/admin/almacen/entregar', { item_id: tr.dataset.item, destinos, etiqueta_precio: tr.querySelector('.et-precio').checked, etiqueta_costura: tr.querySelector('.et-costura').checked, confirmar_exceso: confirmarExceso, ref });
    delete S.refEntrega[tr.dataset.item];
    S.alm.items = r.almacen.items; S.alm.hoy = r.almacen.hoy;
    pintarAlmacen(); pintarAvisoPiso(r.almacen.avisos, r.almacen.aviso_faltantes);
    m.className = 'mensaje ok'; m.textContent = `Entrega registrada. En el almacén quedan ${r.existencia_almacen} pieza(s); cada tienda las recibe al confirmar el primer escaneo.`;
    m.scrollIntoView({ block: 'center', behavior: 'smooth' });
  } catch (e) {
    if (e.codigo === 'CONFIRMACION_REQUERIDA') {
      m.className = 'mensaje aviso';
      m.innerHTML = `${esc(e.message)} <button class="btn" type="button" id="btn-confirmar-exceso">Entregar de todos modos</button>`;
      $('#btn-confirmar-exceso').addEventListener('click', () => entregarFila(tr, true));
    } else { delete S.refEntrega[tr.dataset.item]; m.className = 'mensaje error'; m.textContent = e.message; }
  }
}
async function leerArchivoAlta(archivo) {
  if (window.__POS_LEER_XLSX__) return window.__POS_LEER_XLSX__(archivo);
  const r = await fetch('/api/admin/almacen/leer-archivo', { method: 'POST', headers: { 'content-type': 'application/octet-stream' }, body: await archivo.arrayBuffer() });
  const j = await r.json();
  if (!j.ok) throw new Error(j.error?.mensaje ?? 'No se pudo leer el archivo');
  return j.hojas;
}
const ESTADO_FILA = { nuevo: 'Nuevo', codigo_existente: 'Ya existe: se suman piezas', invalido: 'No se da de alta' };
const NOM_ESTADO_DEPTO = { vacio: 'Sin departamento', exacto: 'Reconocido', alias: 'Reconocido (otra forma de escribirlo)', descontinuado: 'Ya no se vende', sugerido: 'Parecido a uno existente: confirme', desconocido: 'Desconocido: elija' };
function abrirAltaLote() {
  const d = dialogo('dlg-alta-lote');
  const E = { hojas: null, hoja: 0, nombre: '', decisiones: {}, regla: true, pedimento: '', lote_id: uuid(), rev: null };
  d.setAttribute('aria-labelledby', 'alta-titulo');
  const base = () => `<h2 id="alta-titulo" style="margin-top:0">Alta Lote de inventario</h2>
    <div id="zona-archivo" class="zona-archivo" tabindex="0"><p>Arrastre aquí el archivo de Excel del lote (.xlsx)</p><p>o</p><button class="btn" type="button" id="btn-buscar-archivo">${ico('file')}<span>Buscar en esta computadora</span></button>
      <input type="file" id="archivo-alta" accept=".xlsx" hidden></div>
    <p class="nota">Columnas esperadas: CANTIDAD, DESCRIPCION, ESTILO, MARCA, CODIGO, PRECIO, LOTE, DEPARTAMENTO y, cuando aplique, PEDIMENTO. Revisamos el archivo contra el inventario antes de guardar nada.</p>
    <p class="nota" id="alta-nota-catalogo"><b>Esto es para mercancía nueva que llega al almacén.</b> Las filas sin cantidad (0), sin código, sin precio o con código repetido no se dan de alta. Para cargar el catálogo completo de la tienda (incluidos los artículos con cantidad 0) use <b>Inventario → Cargar catálogo inicial (El Limbo)</b>.</p>
    <div id="msg-alta" class="mensaje" role="status" aria-live="polite"></div><div class="filas"><button class="btn" type="button" id="alta-cerrar">Cancelar</button></div>`;
  d.innerHTML = base();
  const err = (t) => { const m = $('#msg-alta'); if (m) { m.className = 'mensaje error'; m.textContent = t; } };
  const enganchar = () => {
    $('#alta-cerrar').addEventListener('click', () => d.close());
    const z = $('#zona-archivo');
    z.addEventListener('dragover', (ev) => { ev.preventDefault(); z.classList.add('sobre'); });
    z.addEventListener('dragleave', () => z.classList.remove('sobre'));
    z.addEventListener('drop', (ev) => { ev.preventDefault(); z.classList.remove('sobre'); const f = ev.dataTransfer.files[0]; if (f) cargarArchivo(f); });
    $('#btn-buscar-archivo').addEventListener('click', () => $('#archivo-alta').click());
    $('#archivo-alta').addEventListener('change', (ev) => { const f = ev.target.files[0]; ev.target.value = ''; if (f) cargarArchivo(f); });
  };
  const cargarArchivo = async (f) => {
    try {
      if (!/\.xlsx$/i.test(f.name)) return err('Solo se aceptan archivos de Excel .xlsx.');
      E.hojas = await leerArchivoAlta(f); E.nombre = f.name; E.hoja = 0; E.lote_id = uuid(); E.decisiones = {};
      await revisar();
    } catch (e) { err(e.message); }
  };
  const revisar = async () => {
    const hoja = E.hojas[E.hoja];
    E.rev = await api('/api/admin/almacen/revisar', { filas: hoja.filas, decisiones: E.decisiones, regla: E.regla });
    pintar();
  };
  const pintar = () => {
    const r = E.rev, rv = r.revision, rs = rv.resumen;
    const quedan = rs.nuevos + rs.codigo_existente;
    d.innerHTML = `<h2 id="alta-titulo" style="margin-top:0">Alta Lote de inventario</h2>
      <p><b>${esc(E.nombre)}</b>${E.hojas.length > 1 ? ` · hoja <select id="alta-hoja">${E.hojas.map((h, i) => `<option value="${i}" ${i === E.hoja ? 'selected' : ''}>${esc(h.nombre)}</option>`).join('')}</select>` : ''}</p>
      ${rv.errores.length ? `<div class="mensaje error" id="alta-errores">${rv.errores.map(esc).join('<br>')}</div>` : ''}
      <p id="alta-resumen"><b>${rs.filas}</b> filas · <b>${rs.nuevos}</b> artículos nuevos · <b>${rs.codigo_existente}</b> ya existen (se suman piezas) · <b>${rs.invalidos}</b> no se darán de alta · <b>${rs.piezas}</b> piezas en total · <b>${rs.con_estilo_existente}</b> con estilo y marca ya existentes con otro código</p>
      ${rv.trae_pedimento ? `<p class="nota">${rs.sin_pedimento} fila(s) sin pedimento (compras nacionales).</p>` : '<p class="nota" id="alta-sin-pedimento">El archivo no trae la columna de No. de pedimento. Si el lote lo lleva, anótelo aquí; si es compra nacional, déjelo vacío.</p>'}
      <label>No. de pedimento del lote (opcional, se aplica a las filas que no lo traen) <input class="texto" id="alta-pedimento" value="${esc(E.pedimento)}" style="padding:6px 8px;border:1px solid var(--borde);border-radius:6px;background:var(--superficie)"></label>
      <h3>Departamentos del archivo</h3>
      <div class="tabla-cont anomalias"><table id="alta-deptos"><thead><tr><th>En el archivo</th><th class="num">Filas</th><th>Situación</th><th>Departamento en el sistema</th></tr></thead><tbody>
      ${r.departamentos.map((g) => { const elegido = E.decisiones[g.clave] || g.propuesto; const aviso = ['sugerido', 'desconocido', 'descontinuado', 'vacio'].includes(g.estado); return `<tr data-clave="${esc(g.clave)}" data-estado="${g.estado}" ${aviso ? 'class="aviso-depto"' : ''}><td>${g.original ? esc(g.original) : '<em>(vacío)</em>'}</td><td class="num">${g.articulos}</td><td>${NOM_ESTADO_DEPTO[g.estado]}${g.estado === 'sugerido' ? `: ¿«${esc(g.propuesto)}»?` : ''}</td><td><select class="sel-depto" data-clave="${esc(g.clave)}">${r.destinos.map((n) => `<option ${n === elegido ? 'selected' : ''}>${esc(n)}</option>`).join('')}</select></td></tr>`; }).join('')}</tbody></table></div>
      <label><input type="checkbox" id="alta-regla" ${E.regla ? 'checked' : ''}> Mover bolsas y cajas de regalo (${r.envolturas} por su descripción) a «Envolturas y Bolsas de regalo»</label>
      <h3>Artículos</h3>
      <div class="tabla-cont anomalias" style="max-height:34vh;overflow:auto"><table id="alta-filas"><thead><tr><th>Fila</th><th class="num">Cant.</th><th>Código</th><th>Descripción</th><th>Estilo</th><th>Marca</th><th>Lote</th><th class="num">Precio</th><th>Departamento</th><th>Estado</th><th>Avisos</th></tr></thead><tbody>
      ${rv.filas.slice(0, 400).map((f) => `<tr data-fila="${f.fila}" data-estado="${f.estado}"><td>${f.fila}</td><td class="num">${f.cantidad}</td><td>${esc(f.codigo)}</td><td>${esc(f.descripcion)}</td><td>${esc(f.estilo)}</td><td>${esc(f.marca)}</td><td>${esc(f.lote)}</td><td class="num">${mxn(f.precio)}</td><td>${esc(f.departamento)}</td><td>${ESTADO_FILA[f.estado]}</td><td>${f.avisos.map(esc).join('<br>')}</td></tr>`).join('')}</tbody></table></div>
      ${rv.filas.length > 400 ? `<p class="nota">Se muestran las primeras 400 de ${rv.filas.length} filas; todas se procesan.</p>` : ''}
      <div id="msg-alta" class="mensaje" role="status" aria-live="polite"></div>
      <div class="filas"><button class="btn" type="button" id="alta-cerrar">Cancelar</button><button class="btn btn-primario" type="button" id="alta-confirmar" style="width:auto;flex:1" ${quedan && !rv.errores.length ? '' : 'disabled'}>Dar de alta ${quedan} artículos (${rs.piezas} piezas) al almacén</button></div>`;
    $('#alta-cerrar').addEventListener('click', () => d.close());
    const h = $('#alta-hoja'); if (h) h.addEventListener('change', async (ev) => { E.hoja = Number(ev.target.value); E.decisiones = {}; await revisar(); });
    for (const x of d.querySelectorAll('.sel-depto')) x.addEventListener('change', async (ev) => { E.decisiones[ev.target.dataset.clave] = ev.target.value; await revisar(); });
    $('#alta-regla').addEventListener('change', async (ev) => { E.regla = ev.target.checked; await revisar(); });
    $('#alta-pedimento').addEventListener('input', (ev) => { E.pedimento = ev.target.value; });
    $('#alta-confirmar').addEventListener('click', async () => {
      $('#alta-confirmar').disabled = true;
      try {
        const res = await api('/api/admin/almacen/alta', { lote_id: E.lote_id, nombre: E.nombre, filas: E.hojas[E.hoja].filas, decisiones: E.decisiones, regla: E.regla, pedimento_lote: E.pedimento });
        d.close();
        S.alm.items = res.almacen.items;
        await vistaAlmacen();
        const m = $('#msg-alm'); m.className = 'mensaje ok'; m.textContent = `Lote dado de alta: ${res.nuevos} artículo(s) nuevo(s), ${res.sumados} existente(s) con piezas sumadas, ${res.piezas} pieza(s) en el almacén${res.omitidas ? `; ${res.omitidas} fila(s) omitida(s)` : ''}.`;
      } catch (e) { err(e.message); $('#alta-confirmar').disabled = false; }
    });
  };
  enganchar();
  d.showModal();
}
async function abrirAltaManual() {
  const d = dialogo('dlg-alta-manual');
  const { departamentos: lista } = await api('/api/admin/departamentos');
  const campo = (id, rotulo, extra = '') => `<div class="campo"><label for="${id}">${rotulo}</label><input id="${id}" class="texto" ${extra}></div>`;
  d.setAttribute('aria-labelledby', 'manual-titulo');
  d.innerHTML = `<h2 id="manual-titulo" style="margin-top:0">Alta manual de artículo</h2>
    <form id="form-manual" autocomplete="off">
      ${campo('man-cantidad', 'Cantidad', 'type="number" min="1" step="1"')}${campo('man-codigo', 'Código (UPC)')}${campo('man-descripcion', 'Descripción')}${campo('man-marca', 'Marca')}${campo('man-estilo', 'Estilo')}${campo('man-lote', 'Lote')}${campo('man-precio', 'Precio de venta (MXN)', 'inputmode="decimal"')}
      <div class="campo"><label for="man-depto">Departamento</label><select id="man-depto" style="width:100%;padding:10px;border:2px solid var(--borde);border-radius:10px;background:var(--superficie)">${lista.filter((x) => x.activo).map((x) => `<option>${esc(x.nombre)}</option>`).join('')}</select></div>
      ${campo('man-pedimento', 'No. de pedimento (si aplica)')}
      <p class="nota">Si el código ya existe, las piezas se suman a ese artículo.</p>
      <div id="msg-manual" class="mensaje" role="status" aria-live="polite"></div>
      <div class="filas"><button class="btn" type="button" id="manual-cerrar">Cancelar</button><button class="btn btn-primario" type="submit" id="manual-guardar" style="width:auto;flex:1">${ico('check')}<span>Guardar en el almacén</span></button></div></form>`;
  $('#manual-cerrar').addEventListener('click', () => d.close());
  const lote_id = uuid();
  $('#form-manual').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const v = (id) => $(id).value;
    try {
      const r = await api('/api/admin/almacen/manual', { lote_id, cantidad: Number(v('#man-cantidad')), codigo: v('#man-codigo'), descripcion: v('#man-descripcion'), marca: v('#man-marca'), estilo: v('#man-estilo'), lote: v('#man-lote'), precio: Number(v('#man-precio').replace(/[$,\s]/g, '')), departamento: v('#man-depto'), pedimento: v('#man-pedimento') });
      d.close();
      S.alm.items = r.almacen.items;
      await vistaAlmacen();
      const m = $('#msg-alm'); m.className = 'mensaje ok'; m.textContent = r.sumados ? `El código ya existía: se sumaron ${r.piezas} pieza(s) al artículo.` : `Artículo dado de alta con ${r.piezas} pieza(s) en el almacén.`;
    } catch (e) { const m = $('#msg-manual'); m.className = 'mensaje error'; m.textContent = e.message; }
  });
  d.showModal();
}

// ── Promociones y cupones (Administración) ──
const centavosAPesos = (c) => (c / 100).toFixed(2).replace(/\.00$/, '');
function nombresArticulos(ids) { return ids.map((id) => { const a = S.artInfo?.[id]; return a ? `${a.descripcion}${a.marca ? ' ' + a.marca : ''}` : 'artículo'; }); }
function alcanceTexto(a) {
  return [a.item_ids?.length ? `artículos: ${nombresArticulos(a.item_ids).join(', ')}` : '', a.departamentos?.length ? `departamentos: ${a.departamentos.join(', ')}` : '', a.palabras?.length ? `descripción con: ${a.palabras.join(', ')}` : ''].filter(Boolean).join(' · ');
}
function reglaTexto(p) {
  if (!p.regalo) return reglaBase(p);
  const v = p.regalo.vigencia;
  return `Se imprime al final del ticket al pagar ${mxn(p.regalo.compra_minima)} o más; vale ${v.modo === 'dias' ? `${v.dias} días` : `del ${fechaPiso(v.inicio)} al ${fechaPiso(v.fin)}`}, un solo uso. Premio: ${reglaBase(p).replace(/^Código [^:]*: /, '')}`;
}
function reglaBase(p) {
  const acum = p.acumulable === false ? ' · una sola vez por compra' : ' · acumulable';
  if (p.tipo === 'nxm') return `Lleva ${p.lleva}, paga ${p.paga} (${alcanceTexto(p.alcance ?? {})})${acum}`;
  if (p.tipo === 'paquete') return `Lleva ${p.lleva} por ${mxn(p.precio)} (${alcanceTexto(p.alcance ?? {})})${acum}`;
  if (p.tipo === 'por_cada') return `Por cada ${mxn(p.cada)} de compra, ${mxn(p.descuenta)} de descuento${acum}`;
  const q = p.pct !== undefined ? `${p.pct} %` : mxn(p.monto);
  return `Código ${p.codigo}: ${q} de descuento${p.minimo ? ` en compras desde ${mxn(p.minimo)}` : ''}${p.usos_max ? ` · máx. ${p.usos_max} uso(s)` : ''}`;
}
const tiendasTexto = (p) => (p.tiendas?.length ? p.tiendas.map((t) => S.tiendasInfo?.find((x) => x.tienda === t)?.nombre ?? t).join(' y ') : 'Todas');
const NOM_TIPO = { nxm: 'Lleva X, paga Y', paquete: 'Paquete a precio fijo', por_cada: 'Por cada $X de compra', cupon: 'Cupón' };
const NOM_ESTADO_PROMO = { activa: 'Activa', programada: 'Programada', vencida: 'Vencida', inactiva: 'Desactivada' };
const vigenciaTexto = (p) => (p.inicio || p.fin ? `${p.inicio ? `Desde el ${fechaPiso(p.inicio)}` : 'Desde ya'} · ${p.fin ? `hasta el ${fechaPiso(p.fin)}` : 'sin fecha límite'}` : 'Sin fecha límite');
async function vistaPromociones() {
  const { promociones, hoy, tiendas, articulos } = await api('/api/admin/promociones');
  S.promos = promociones; S.hoyPromo = hoy; S.tiendasInfo = tiendas; S.artInfo = { ...(S.artInfo ?? {}), ...articulos };
  $('#vista').innerHTML = `<div class="titulo-vista">${ico('tag')}<h1>Promociones y cupones</h1></div>
    <section class="panel"><div class="filas" style="align-items:center"><button class="btn btn-primario" id="btn-nueva-promo" type="button" style="width:auto">${ico('plus')}<span>Nueva promoción o cupón</span></button><button class="btn" id="btn-reporte-promos" type="button">${ico('chart')}<span>Reporte de promociones</span></button></div>
      <p class="nota">Cada promoción o cupón vale solo en la tienda (o tiendas) que elija. Toda promoción lleva fecha de inicio y de término, o queda <b>sin fecha límite</b> hasta que Administración la desactive. En cada compra aplica <b>una sola</b> promoción o cupón: la que más descuento le da al cliente. Las promociones se aplican solas al cobrar; los cupones se capturan o se escanean en la caja. Para promocionar un artículo concreto, búsquelo al crear la promoción o use «Crear promoción» en Inventario.</p>
      <div id="msg-promo" class="mensaje" role="status" aria-live="polite"></div>
      <div class="tabla-cont"><table id="tabla-promos"><thead><tr><th>Nombre</th><th>Tienda</th><th>Tipo</th><th>Regla</th><th>Vigencia</th><th>Estado</th><th class="num">Usos <small>(regalados / canjeados)</small></th><th></th></tr></thead><tbody>
      ${promociones.map((p) => `<tr data-promo="${esc(p.id)}" data-estado="${p.estado}"><td>${esc(p.nombre)}</td><td data-col="tiendas">${esc(tiendasTexto(p))}</td><td>${NOM_TIPO[p.tipo]}</td><td class="desc">${esc(reglaTexto(p))}</td><td>${esc(vigenciaTexto(p))}</td><td><span class="insignia ${p.estado === 'activa' ? '' : 'cancelada'}">${NOM_ESTADO_PROMO[p.estado]}</span></td><td class="num">${p.regalo ? `<span title="Regalados / canjeados">${p.regaladas ?? 0} / ${p.canjeadas ?? 0}</span>` : p.usos}</td>
        <td><div class="acciones-promo"><button class="btn p-editar" type="button">${ico('pencil')}<span>Editar</span></button><button class="btn p-activa" type="button">${p.activa ? 'Desactivar promoción' : 'Activar promoción'}</button><button class="btn btn-peligro p-eliminar" type="button">${ico('trash')}<span>Eliminar</span></button>${p.tipo === 'cupon' ? `<button class="btn p-qr" type="button">${ico('download')}<span>Imagen QR</span></button>` : ''}</div></td></tr>`).join('') || '<tr><td colspan="8" class="vacio">Aún no hay promociones ni cupones.</td></tr>'}</tbody></table></div></section>
    <p class="nota" style="margin-top:12px">Quién autoriza descuentos en la caja (con su clave de caja) se administra en <b>Personal › Perfiles</b>.</p>`;
  $('#btn-nueva-promo').addEventListener('click', () => abrirPromo(null));
  $('#btn-reporte-promos').addEventListener('click', () => ir('descuentos'));
  for (const tr of $('#tabla-promos').querySelectorAll('tr[data-promo]')) {
    const p = S.promos.find((x) => x.id === tr.dataset.promo);
    tr.querySelector('.p-editar').addEventListener('click', () => abrirPromo(p));
    tr.querySelector('.p-activa').addEventListener('click', async () => {
      try { await api('/api/admin/promociones', { ...p, activa: !p.activa }); await vistaPromociones(); }
      catch (e) { const m = $('#msg-promo'); m.className = 'mensaje error'; m.textContent = e.message; }
    });
    tr.querySelector('.p-eliminar').addEventListener('click', async () => {
      if (!window.confirm(`¿Eliminar la promoción «${p.nombre}»? Dejará de aplicarse en las cajas. Las ventas ya hechas no cambian.`)) return;
      try { await api('/api/admin/promociones/eliminar', { id: p.id }); await vistaPromociones(); const m = $('#msg-promo'); m.className = 'mensaje ok'; m.textContent = 'Promoción eliminada.'; }
      catch (e) { const m = $('#msg-promo'); m.className = 'mensaje error'; m.textContent = e.message; }
    });
    const q = tr.querySelector('.p-qr'); if (q) q.addEventListener('click', () => abrirImagenCupon(p));
  }
}
async function abrirPromo(p, preset) {
  const [{ departamentos }, { tiendas }] = await Promise.all([api('/api/admin/departamentos'), api('/api/admin/tiendas')]);
  S.tiendasInfo = tiendas;
  S.artInfo = S.artInfo ?? {};
  const d = dialogo('dlg-promo');
  const nueva = !p;
  const q = p ?? { tipo: 'nxm', nombre: '', activa: true, tiendas: tiendas.map((t) => t.tienda), inicio: S.hoyPromo ?? null, fin: null, lleva: 2, paga: 1, precio: 18500, alcance: { departamentos: [], palabras: [], item_ids: [] }, cada: 100000, descuenta: 10000, codigo: '', pct: 10, minimo: 0, usos_max: null };
  let items = [...(q.alcance?.item_ids ?? [])];
  if (preset?.item) { S.artInfo[preset.item.item_id] = preset.item; if (!items.includes(preset.item.item_id)) items.push(preset.item.item_id); }
  const esPct = q.monto === undefined;
  d.setAttribute('aria-labelledby', 'promo-titulo');
  const campo = (id, rotulo, valor, extra = '') => `<div class="campo"><label for="${id}">${rotulo}</label><input id="${id}" class="texto" value="${esc(valor ?? '')}" ${extra}></div>`;
  d.innerHTML = `<h2 id="promo-titulo" style="margin-top:0">${nueva ? 'Nueva promoción o cupón' : 'Editar promoción'}</h2>
    <form id="form-promo" autocomplete="off">
      <div class="campo"><label for="pr-tipo">Tipo</label><select id="pr-tipo" ${nueva ? '' : 'disabled'} style="width:100%;padding:10px;border:2px solid var(--borde);border-radius:10px;background:var(--superficie)">
        <option value="nxm" ${q.tipo === 'nxm' ? 'selected' : ''}>Lleva X piezas y paga Y (2x1, 3x2…) en mercancía seleccionada</option>
        <option value="paquete" ${q.tipo === 'paquete' ? 'selected' : ''}>Paquete a precio fijo (lleva 4 por $185…)</option>
        <option value="por_cada" ${q.tipo === 'por_cada' ? 'selected' : ''}>Por cada $X de compra, $Y de descuento</option>
        <option value="cupon" ${q.tipo === 'cupon' ? 'selected' : ''}>Cupón de descuento (% o $) con código y QR</option></select></div>
      ${campo('pr-nombre', 'Nombre (aparece en el ticket)', q.nombre, 'required')}
      <fieldset style="border:1px solid var(--borde);border-radius:8px"><legend>Vale en la tienda</legend>${tiendas.map((t) => `<label style="display:inline-block;margin-right:16px"><input type="checkbox" class="pr-tienda" value="${esc(t.tienda)}" ${(q.tiendas ?? tiendas.map((x) => x.tienda)).includes(t.tienda) ? 'checked' : ''}> ${esc(t.nombre)}</label>`).join('')}</fieldset>
      <div class="filas"><div class="campo" style="flex:1"><label for="pr-inicio">Inicia</label><input id="pr-inicio" type="date" value="${esc(q.inicio ?? '')}" class="texto"></div>
        <div class="campo" style="flex:1"><label for="pr-fin">Termina</label><input id="pr-fin" type="date" value="${esc(q.fin ?? '')}" class="texto" ${q.fin ? '' : 'disabled'}></div></div>
      <label><input type="checkbox" id="pr-sin-fin" ${q.fin ? '' : 'checked'}> Sin fecha límite (vale hasta que Administración la desactive)</label>
      <div data-tipo="nxm paquete">
        <div class="filas" data-tipo="nxm"><div class="campo" style="flex:1"><label for="pr-lleva">Lleva (piezas)</label><input id="pr-lleva" type="number" min="2" class="texto" value="${q.lleva ?? 2}"></div><div class="campo" style="flex:1"><label for="pr-paga">Paga (piezas)</label><input id="pr-paga" type="number" min="1" class="texto" value="${q.paga ?? 1}"></div></div>
        <div class="filas" data-tipo="paquete"><div class="campo" style="flex:1"><label for="pr-lleva2">Lleva (piezas)</label><input id="pr-lleva2" type="number" min="2" class="texto" value="${q.lleva ?? 4}"></div><div class="campo" style="flex:1"><label for="pr-precio">Paga en total ($)</label><input id="pr-precio" class="texto" inputmode="decimal" value="${centavosAPesos(q.precio ?? 18500)}"></div></div>
        <p class="nota" data-tipo="nxm">De cada grupo, las piezas más baratas salen gratis. Este tipo necesita al menos un artículo elegido (o un departamento o palabras de la descripción).</p>
        <p class="nota" data-tipo="paquete">Cada grupo completo se cobra al precio del paquete; 5 piezas de un paquete de 4 son un paquete más una suelta a precio normal. Este tipo necesita elegir uno o varios artículos.</p>
        <div class="campo"><label for="pr-buscar">Artículos de la promoción: busque por código, Item #, descripción o marca</label><input id="pr-buscar" class="texto" placeholder="Ej. accesorio popular"></div>
        <div id="pr-resultados" class="tabla-cont" style="max-height:20vh;overflow:auto"></div>
        <div id="pr-items" class="filas" style="gap:6px;margin:6px 0"></div>
        <details><summary>También por departamento o palabras de la descripción</summary>
          <fieldset style="border:1px solid var(--borde);border-radius:8px"><legend>Departamentos</legend>${departamentos.filter((x) => x.activo).map((x) => `<label style="display:inline-block;margin-right:12px"><input type="checkbox" class="pr-dep" value="${esc(x.nombre)}" ${(q.alcance?.departamentos ?? []).includes(x.nombre) ? 'checked' : ''}> ${esc(x.nombre)}</label>`).join('')}</fieldset>
          ${campo('pr-palabras', 'Palabras de la descripción (separadas por comas): blusa, pantalón, falda…', (q.alcance?.palabras ?? []).join(', '))}
          <p class="nota">Si pone departamento y palabras, deben cumplirse las dos. Los artículos elegidos arriba entran siempre.</p></details>
      </div>
      <div data-tipo="por_cada">
        <div class="filas"><div class="campo" style="flex:1"><label for="pr-cada">Por cada ($ de compra)</label><input id="pr-cada" class="texto" value="${centavosAPesos(q.cada ?? 100000)}" inputmode="decimal"></div><div class="campo" style="flex:1"><label for="pr-descuenta">Descuento ($)</label><input id="pr-descuenta" class="texto" value="${centavosAPesos(q.descuenta ?? 10000)}" inputmode="decimal"></div></div>
        <p class="nota">Escalones completos: por cada $1,000 de compra, $100 menos; con $2,500 son $200 menos. <b>Este tipo no necesita elegir artículos</b>: aplica a toda la compra.</p>
      </div>
      <div data-tipo="cupon">
        <div class="filas" data-sinregalo><div class="campo" style="flex:2"><label for="pr-codigo">Código</label><input id="pr-codigo" class="texto" value="${esc(q.codigo ?? '')}" placeholder="VERANO20"></div>
          <div class="campo" style="flex:1"><label>&nbsp;</label><button class="btn" type="button" id="pr-generar">Generar código</button></div></div>
        <div class="filas"><label><input type="radio" name="pr-cup-tipo" value="pct" ${esPct ? 'checked' : ''}> Porcentaje (%)</label><label><input type="radio" name="pr-cup-tipo" value="monto" ${esPct ? '' : 'checked'}> Monto fijo ($)</label></div>
        ${campo('pr-cup-valor', 'Valor del descuento', esPct ? (q.pct ?? 10) : centavosAPesos(q.monto), 'inputmode="decimal"')}
        ${campo('pr-minimo', 'Compra mínima ($, vacío = sin mínimo; el mínimo se cumple con esa cantidad o más)', q.minimo ? centavosAPesos(q.minimo) : '', 'inputmode="decimal"')}
        <div data-sinregalo>${campo('pr-usos', 'Usos máximos (vacío = sin límite; 1 = un solo uso)', q.usos_max ?? '', 'inputmode="numeric"')}</div>
        <p class="nota">Un cupón no necesita elegir artículos: descuenta sobre toda la compra.</p>
      </div>
      <div data-tipo="nxm paquete por_cada"><label style="margin-top:8px"><input type="checkbox" id="pr-acumulable" ${q.acumulable === false ? '' : 'checked'}> <b>Acumulable</b>: se repite por cada grupo completo (8 piezas de un paquete de 4 = 2 paquetes; $2,650 con «por cada $500, $50» = $250 de descuento). Sin marcar, aplica una sola vez por compra.</label></div>
      <p class="nota">En cada compra aplica una sola promoción o cupón (la que más descuento dé); no se combinan entre sí.</p>
      <fieldset style="border:1px solid var(--borde);border-radius:8px"><legend>Regalo al final del ticket</legend>
        <label><input type="checkbox" id="pr-regalo" ${q.regalo ? 'checked' : ''}> <b>Imprimir al final del ticket</b> (la promoción no se aplica sola: se regala con un QR para la próxima compra)</label>
        <div id="pr-regalo-campos" ${q.regalo ? '' : 'hidden'}>
          <div class="campo"><label for="rg-compra">Se gana si la clienta paga ($ o más)</label><input id="rg-compra" inputmode="decimal" class="texto" value="${q.regalo ? centavosAPesos(q.regalo.compra_minima) : '1000'}"></div>
          <label style="margin-right:16px"><input type="radio" name="rg-vig" value="dias" ${q.regalo?.vigencia.modo === 'fechas' ? '' : 'checked'}> Vale <input id="rg-dias" type="number" min="1" max="365" style="width:70px" value="${q.regalo?.vigencia.modo === 'dias' ? q.regalo.vigencia.dias : 30}"> días desde el ticket</label>
          <label><input type="radio" name="rg-vig" value="fechas" ${q.regalo?.vigencia.modo === 'fechas' ? 'checked' : ''}> Del <input id="rg-ini" type="date" value="${q.regalo?.vigencia.modo === 'fechas' ? q.regalo.vigencia.inicio : ''}"> al <input id="rg-fin" type="date" value="${q.regalo?.vigencia.modo === 'fechas' ? q.regalo.vigencia.fin : ''}"></label>
          <p class="nota">Las fechas «Inicia» y «Termina» de arriba son el periodo en que se regala. El QR vale una sola vez y solo en la tienda que lo regaló; se canjea escaneándolo en la caja.</p></div></fieldset>
      <label style="margin-top:8px"><input type="checkbox" id="pr-activa" ${q.activa ? 'checked' : ''}> <span id="pr-activa-txt"></span></label>
      <div id="msg-pr" class="mensaje" role="status" aria-live="polite"></div>
      <div class="filas"><button class="btn" type="button" id="pr-cerrar">Cancelar</button><button class="btn btn-primario" type="submit" id="pr-guardar" style="width:auto;flex:1">${ico('check')}<span>Guardar</span></button></div>
    </form>`;
  const mostrar = () => {
    const t = $('#pr-tipo').value;
    for (const b of d.querySelectorAll('[data-tipo]')) b.hidden = !b.dataset.tipo.split(' ').includes(t);
    $('#pr-regalo-campos').hidden = !$('#pr-regalo').checked;
    for (const b of d.querySelectorAll('[data-sinregalo]')) b.hidden = $('#pr-regalo').checked || t !== 'cupon';
  };
  mostrar();
  $('#pr-regalo').addEventListener('change', mostrar);
  if (preset?.item && nueva) { $('#pr-tipo').value = 'nxm'; mostrar(); if (!$('#pr-nombre').value) $('#pr-nombre').value = `Promoción ${preset.item.descripcion}`; }
  $('#pr-tipo').addEventListener('change', mostrar);
  const rotuloActiva = () => { $('#pr-activa-txt').innerHTML = $('#pr-activa').checked ? '<b>Promoción activa</b>' : '<b>Promoción desactivada</b>'; };
  rotuloActiva();
  $('#pr-activa').addEventListener('change', rotuloActiva);
  const pintarItems = () => {
    $('#pr-items').innerHTML = items.length ? items.map((id) => `<span class="insignia" data-item="${esc(id)}">${esc(nombresArticulos([id])[0])} <button type="button" class="btn btn-icono pr-quitar" aria-label="Quitar" style="width:20px;height:20px">${ico('x')}</button></span>`).join('') : '<span class="nota">Ningún artículo elegido todavía.</span>';
    for (const b of $('#pr-items').querySelectorAll('.pr-quitar')) b.addEventListener('click', () => { items = items.filter((x) => x !== b.parentElement.dataset.item); pintarItems(); });
  };
  pintarItems();
  let temporizador;
  $('#pr-buscar').addEventListener('input', () => {
    clearTimeout(temporizador);
    temporizador = setTimeout(async () => {
      const t = $('#pr-buscar').value.trim();
      if (!t) { $('#pr-resultados').innerHTML = ''; return; }
      try {
        const r = await api(`/api/admin/articulos?q=${encodeURIComponent(t)}`);
        $('#pr-resultados').innerHTML = `<table id="pr-tabla-res"><tbody>${r.articulos.map((a) => `<tr data-item="${esc(a.item_id)}"><td>${esc(a.item_no ?? '')}</td><td>${esc(a.codigo)}</td><td>${esc(a.descripcion)} ${esc(a.marca)}</td><td class="num">${mxn(a.precio)}</td><td><button type="button" class="btn pr-agregar">${ico('plus')}<span>Agregar</span></button></td></tr>`).join('') || '<tr><td class="vacio">Sin resultados.</td></tr>'}</tbody></table>${r.total > r.articulos.length ? `<p class="nota">${r.total} resultados; escriba más para acotar.</p>` : ''}`;
        for (const b of $('#pr-resultados').querySelectorAll('.pr-agregar')) b.addEventListener('click', () => {
          const a = r.articulos.find((x) => x.item_id === b.closest('tr').dataset.item);
          S.artInfo[a.item_id] = a; if (!items.includes(a.item_id)) items.push(a.item_id); pintarItems();
        });
      } catch (e) { $('#pr-resultados').textContent = e.message; }
    }, 250);
  });
  $('#form-promo').addEventListener('keydown', (ev) => { if (ev.key === 'Enter' && ev.target.id === 'pr-buscar') ev.preventDefault(); });
  $('#pr-sin-fin').addEventListener('change', (ev) => { $('#pr-fin').disabled = ev.target.checked; if (ev.target.checked) $('#pr-fin').value = ''; });
  $('#pr-generar').addEventListener('click', () => { const A = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; let c = ''; for (let i = 0; i < 8; i++) c += A[Math.floor(Math.random() * A.length)]; $('#pr-codigo').value = c; });
  $('#pr-cerrar').addEventListener('click', () => d.close());
  $('#form-promo').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const m = $('#msg-pr');
    const err = (t) => { m.className = 'mensaje error'; m.textContent = t; };
    const t = $('#pr-tipo').value;
    const body = { id: p?.id ?? '', tipo: t, nombre: $('#pr-nombre').value, activa: $('#pr-activa').checked, tiendas: [...d.querySelectorAll('.pr-tienda:checked')].map((x) => x.value), inicio: $('#pr-inicio').value || null, fin: $('#pr-sin-fin').checked ? null : ($('#pr-fin').value || null) };
    if (!body.tiendas.length) return err('Elija en qué tienda vale (una o ambas).');
    if (!$('#pr-sin-fin').checked && !body.fin) return err('Elija la fecha de término o marque «Sin fecha límite».');
    if (t !== 'cupon') body.acumulable = $('#pr-acumulable').checked;
    if (t === 'nxm' || t === 'paquete') {
      if (t === 'nxm') { body.lleva = Number($('#pr-lleva').value); body.paga = Number($('#pr-paga').value); }
      else { body.lleva = Number($('#pr-lleva2').value); body.precio = parseMXN($('#pr-precio').value); if (body.precio === null) return err('Escriba el precio del paquete en pesos.'); }
      body.alcance = { departamentos: [...d.querySelectorAll('.pr-dep:checked')].map((x) => x.value), palabras: $('#pr-palabras').value.split(',').map((x) => x.trim()).filter(Boolean), item_ids: items };
    } else if (t === 'por_cada') {
      body.cada = parseMXN($('#pr-cada').value); body.descuenta = parseMXN($('#pr-descuenta').value);
      if (!body.cada || !body.descuenta) return err('Escriba los dos montos en pesos.');
    } else {
      if (!$('#pr-regalo').checked) body.codigo = $('#pr-codigo').value;
      const tipo = d.querySelector('input[name="pr-cup-tipo"]:checked').value;
      if (tipo === 'pct') body.pct = Number($('#pr-cup-valor').value); else { body.monto = parseMXN($('#pr-cup-valor').value); if (!body.monto) return err('Escriba el monto en pesos.'); }
      body.minimo = $('#pr-minimo').value.trim() ? parseMXN($('#pr-minimo').value) : 0;
      if (body.minimo === null) return err('La compra mínima no es válida.');
      body.usos_max = $('#pr-usos').value.trim() && !$('#pr-regalo').checked ? Number($('#pr-usos').value) : null;
    }
    if ($('#pr-regalo').checked) {
      const compra = parseMXN($('#rg-compra').value);
      if (!compra) return err('Escriba el monto de compra para ganar el regalo.');
      const dias = d.querySelector('input[name="rg-vig"]:checked').value === 'dias';
      body.regalo = { compra_minima: compra, vigencia: dias ? { modo: 'dias', dias: Number($('#rg-dias').value) } : { modo: 'fechas', inicio: $('#rg-ini').value, fin: $('#rg-fin').value } };
    }
    try { await api('/api/admin/promociones', body); d.close(); if (S.vista === 'promociones') { await vistaPromociones(); const mm = $('#msg-promo'); mm.className = 'mensaje ok'; mm.textContent = 'Guardado.'; } else await ir('promociones'); }
    catch (e) { err(e.message); }
  });
  d.showModal();
}

// ── Configuración: Tiendas, Departamentos y Tipo de cambio en una sola entrada ──
const cuerpoVista = () => $('#config-cuerpo') ?? $('#personal-cuerpo') ?? $('#vista');
const TABS_CONFIG = [['tiendas', 'Tiendas', 'store'], ['departamentos', 'Departamentos', 'box'], ['tipo_cambio', 'Tipo de cambio', 'banknote'], ['cajas', 'Cajas', 'cash'], ['feria', 'Feria', 'banknote']];
async function vistaConfiguracion(tab) {
  tab = tab ?? S.configTab ?? 'tiendas';
  S.configTab = tab;
  $('#vista').innerHTML = `<div class="titulo-vista">${ico('settings')}<h1>Configuración</h1></div>
    <div class="filas" role="tablist" aria-label="Configuración" style="margin-bottom:12px">${TABS_CONFIG.map(([id, rotulo, icono]) => `<button class="btn" type="button" role="tab" id="cfg-tab-${id}" data-tab="${id}" aria-selected="${id === tab}" style="${id === tab ? 'background:var(--acento);color:var(--acento-texto);border-color:var(--acento)' : ''}">${ico(icono)}<span>${rotulo}</span></button>`).join('')}</div>
    <div id="config-cuerpo" role="tabpanel"></div>`;
  for (const b of $('#vista').querySelectorAll('[role="tab"]')) b.addEventListener('click', () => vistaConfiguracion(b.dataset.tab));
  await ({ tiendas: vistaTiendas, departamentos: vistaDepartamentos, tipo_cambio: vistaTipoCambio, cajas: vistaCajasFondo, feria: vistaFeria })[tab]();
}


// ── Empleadas (Administración): porcentajes de descuento, límite de crédito, cuenta, abonos de nómina y reporte para la nómina ──
// ── Personal: perfiles, descuento y crédito, nómina y horarios ──
const TABS_PERSONAL = [['perfiles', 'Perfiles', 'user'], ['descuento', 'Descuento y crédito', 'tag'], ['nomina', 'Nómina', 'cash'], ['horarios', 'Horarios', 'clock']];
async function vistaHorarios() {
  cuerpoVista().innerHTML = `<section class="panel"><h2 style="margin-top:0">Horarios</h2><p class="nota">En desarrollo: aquí se organizarán los horarios y turnos del personal. Lo vamos a definir juntos.</p></section>`;
}
async function vistaPersonal(tab) {
  tab = tab ?? S.personalTab ?? 'perfiles';
  S.personalTab = tab;
  $('#vista').innerHTML = `<div class="titulo-vista">${ico('user')}<h1>Personal</h1></div>
    <div class="filas" role="tablist" aria-label="Personal" style="margin-bottom:12px">${TABS_PERSONAL.map(([id, rotulo, icono]) => `<button class="btn" type="button" role="tab" id="per-tab-${id}" data-tab="${id}" aria-selected="${id === tab}" style="${id === tab ? 'background:var(--acento);color:var(--acento-texto);border-color:var(--acento)' : ''}">${ico(icono)}<span>${rotulo}</span></button>`).join('')}</div>
    <div id="personal-cuerpo" role="tabpanel"></div>`;
  for (const b of $('#vista').querySelectorAll('[role="tab"]')) b.addEventListener('click', () => vistaPersonal(b.dataset.tab));
  await ({ perfiles: vistaCajeros, descuento: vistaDescuentoCredito, nomina: vistaNomina, horarios: vistaHorarios })[tab]();
}

async function vistaDescuentoCredito() {
  const j = await api('/api/admin/empleadas');
  const hoy = new Date(Date.now() - 7 * 3600e3).toISOString().slice(0, 10);
  cuerpoVista().innerHTML = `    <section class="panel"><h2 style="margin-top:0">Descuento de empleada</h2>
      <p class="nota">Se aplica solo en una «Venta a empleada» (la empleada confirma con su clave). No se combina con promociones ni cupones: gana el que más le convenga. En la caja se marcan los uniformes de la tienda.</p>
      <form id="form-emp-config" class="filas" style="align-items:end" autocomplete="off">
        <div class="campo" style="margin:0"><label for="ec-pct">Mercancía regular (%)</label><input id="ec-pct" type="number" min="1" max="100" value="${j.config.pct}" style="width:90px"></div>
        <div class="campo" style="margin:0"><label for="ec-uni">Uniformes (%)</label><input id="ec-uni" type="number" min="1" max="100" value="${j.config.pct_uniforme}" style="width:90px"></div>
        <button class="btn btn-primario" type="submit" style="width:auto">${ico('check')}<span>Guardar porcentajes</span></button></form>
      <div id="msg-emp-admin" class="mensaje" role="status" aria-live="polite"></div></section>
    <section class="panel" style="margin-top:12px"><h2 style="margin-top:0">Cuentas de crédito</h2>
      <p class="nota">El crédito no es dinero cobrado: la venta cuenta en la venta del día y baja el inventario, pero no entra al corte ni al efectivo. Aquí queda lo que cada empleada debe; los abonos se registran cuando se le descuenta de la nómina. <b>Total por cobrar: <span id="emp-total">${mxn(j.total_por_cobrar)}</span></b></p>
      <div class="tabla-cont"><table id="tabla-empleadas"><thead><tr><th>Empleada</th><th class="num">Límite</th><th class="num">Cargos</th><th class="num">Devoluciones</th><th class="num">Abonos</th><th class="num">Ajustes</th><th class="num">Debe</th><th class="num">Disponible</th><th></th></tr></thead><tbody>
      ${j.empleadas.map((e) => `<tr data-emp="${esc(e.id)}"><td>${esc(e.nombre)}${e.activa ? '' : ' <small>(ya no trabaja)</small>'}</td><td class="num" data-col="limite">${mxn(e.limite)}</td><td class="num" data-col="cargos">${mxn(e.cargos)}</td><td class="num">${mxn(e.devoluciones)}</td><td class="num" data-col="abonos">${mxn(e.abonos)}</td><td class="num">${mxn(e.ajustes)}</td><td class="num" data-col="saldo"><b>${mxn(e.saldo)}</b></td><td class="num" data-col="disponible">${mxn(e.disponible)}</td>
        <td class="filas" style="flex-wrap:nowrap"><button class="btn em-limite" type="button">${ico('pencil')}<span>Límite</span></button><button class="btn em-abono" type="button">${ico('cash')}<span>Abono de nómina</span></button><button class="btn em-ajuste" type="button">${ico('plus')}<span>Ajuste</span></button><button class="btn em-mov" type="button">${ico('clock')}<span>Movimientos</span></button></td></tr>`).join('') || '<tr><td colspan="9" class="vacio">Aún no hay empleadas dadas de alta en Personal › Perfiles.</td></tr>'}</tbody></table></div>
      <form id="form-emp" hidden autocomplete="off" style="margin-top:12px;border-top:1px solid var(--borde);padding-top:10px"></form>
      <div id="emp-movimientos"></div></section>`;
  const msg = (t, tipo = 'error') => { const m = $('#msg-emp-admin'); m.className = `mensaje ${tipo}`; m.textContent = t; };
  $('#form-emp-config').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    try { await api('/api/admin/empleadas/config', { pct: Number($('#ec-pct').value), pct_uniforme: Number($('#ec-uni').value) }); msg('Porcentajes guardados. Las cajas los reciben al sincronizar.', 'ok'); }
    catch (e) { msg(e.message); }
  });
  const abrir = (e, tipo) => {
    const f = $('#form-emp'); f.hidden = false;
    const enviar = (ruta, cuerpo, ok) => async (ev) => { ev.preventDefault(); try { await api(ruta, cuerpo()); await vistaDescuentoCredito(); const m = $('#msg-emp-admin'); m.className = 'mensaje ok'; m.textContent = ok; } catch (er) { msg(er.message); } };
    const botones = (rotulo) => `<div class="filas"><button class="btn" type="button" id="ef-cancelar">Cancelar</button><button class="btn btn-primario" type="submit" style="width:auto;flex:1">${ico('check')}<span>${rotulo}</span></button></div>`;
    const ref = nuevaRef();
    if (tipo === 'limite') {
      f.innerHTML = `<h3 style="margin-top:0">Límite de crédito de ${esc(e.nombre)}</h3><div class="campo"><label for="ef-monto">Límite ($; 0 = sin crédito)</label><input id="ef-monto" class="texto" inputmode="decimal" value="${centavosAPesos(e.limite)}"></div><div class="campo"><label for="ef-motivo">Motivo</label><input id="ef-motivo" class="texto" maxlength="120"></div>${botones('Guardar límite')}`;
      f.onsubmit = enviar('/api/admin/empleadas/limite', () => ({ empleada_id: e.id, limite: parseMXN($('#ef-monto').value || '0'), motivo: $('#ef-motivo').value }), 'Límite guardado.');
    } else {
      const abono = tipo === 'abono';
      f.innerHTML = `<h3 style="margin-top:0">${abono ? 'Abono de nómina' : 'Ajuste'} de ${esc(e.nombre)}</h3>
        ${abono ? '' : '<div class="campo"><label for="ef-tipo">Tipo de ajuste</label><select id="ef-tipo" style="width:100%;padding:8px;border:1px solid var(--borde);border-radius:8px;background:var(--superficie)"><option value="ajuste_cargo">Cargo (suma a lo que debe)</option><option value="ajuste_abono">Descuento a favor (resta a lo que debe)</option></select></div>'}
        <div class="campo"><label for="ef-monto">Monto ($)</label><input id="ef-monto" class="texto" inputmode="decimal"></div>
        ${abono ? '<div class="campo"><label for="ef-periodo">Periodo de nómina (opcional)</label><input id="ef-periodo" class="texto" maxlength="40" placeholder="Ej. octubre, 1ª quincena"></div>' : ''}
        <div class="campo"><label for="ef-motivo">${abono ? 'Nota' : 'Motivo'}</label><input id="ef-motivo" class="texto" maxlength="120" value="${abono ? 'Descuento de nómina' : ''}"></div>${botones('Registrar')}`;
      f.onsubmit = enviar('/api/admin/empleadas/movimiento', () => ({ empleada_id: e.id, tipo: abono ? 'abono' : $('#ef-tipo').value, monto: parseMXN($('#ef-monto').value), motivo: $('#ef-motivo').value, ...(abono ? { periodo: $('#ef-periodo').value } : {}), ref }), 'Movimiento registrado.');
    }
    $('#ef-cancelar').addEventListener('click', () => { f.hidden = true; });
    $('#ef-monto').focus();
  };
  for (const tr of $('#tabla-empleadas').querySelectorAll('tr[data-emp]')) {
    const e = j.empleadas.find((x) => x.id === tr.dataset.emp);
    tr.querySelector('.em-limite').addEventListener('click', () => abrir(e, 'limite'));
    tr.querySelector('.em-abono').addEventListener('click', () => abrir(e, 'abono'));
    tr.querySelector('.em-ajuste').addEventListener('click', () => abrir(e, 'ajuste'));
    tr.querySelector('.em-mov').addEventListener('click', async () => {
      const r = await api(`/api/admin/empleadas/movimientos?id=${encodeURIComponent(e.id)}`);
      const NOM = { cargo: 'Venta a crédito', devolucion: 'Devolución', abono: 'Abono de nómina', ajuste_cargo: 'Ajuste (cargo)', ajuste_abono: 'Ajuste (a favor)' };
      $('#emp-movimientos').innerHTML = `<h3>Movimientos de ${esc(e.nombre)}</h3><div class="tabla-cont"><table id="tabla-emp-mov"><thead><tr><th>Fecha</th><th>Movimiento</th><th>Detalle</th><th class="num">Monto</th></tr></thead><tbody>${r.movimientos.map((m) => `<tr><td>${esc(m.fecha.split('-').reverse().join('/'))}</td><td>${NOM[m.tipo]}</td><td>${esc(m.detalle)}${m.periodo ? ` · ${esc(m.periodo)}` : ''}${m.por ? ` · ${esc(m.por)}` : ''}</td><td class="num">${['cargo', 'ajuste_cargo'].includes(m.tipo) ? '' : '-'}${mxn(m.monto)}</td></tr>`).join('') || '<tr><td colspan="4" class="vacio">Sin movimientos.</td></tr>'}</tbody></table></div>`;
    });
  }
}
async function vistaNomina() {
  const hoy = new Date(Date.now() - 7 * 3600e3).toISOString().slice(0, 10);
  cuerpoVista().innerHTML = `<section class="panel"><h2 style="margin-top:0">Para la nómina</h2>
      <form id="form-nomina" class="filas" style="align-items:end" autocomplete="off"><label>Desde <input type="date" id="nom-desde" value="${hoy}"></label><label>Hasta <input type="date" id="nom-hasta" value="${hoy}"></label>
        <button class="btn btn-primario" type="submit" style="width:auto">${ico('search')}<span>Consultar</span></button></form>
      <div id="emp-nomina"></div></section>`;
  const nomina = async () => {
    const r = await api(`/api/admin/empleadas/nomina?desde=${$('#nom-desde').value}&hasta=${$('#nom-hasta').value}`);
    $('#emp-nomina').innerHTML = `<div class="tabla-cont"><table id="tabla-nomina"><thead><tr><th>Empleada</th><th class="num">Cargos del periodo</th><th class="num">Devoluciones</th><th class="num">Abonos</th><th class="num">A descontar</th><th class="num">Debe (saldo)</th></tr></thead><tbody>${r.filas.map((f) => `<tr data-emp="${esc(f.id)}"><td>${esc(f.nombre)}</td><td class="num">${mxn(f.cargos)}</td><td class="num">${mxn(f.devoluciones)}</td><td class="num">${mxn(f.abonos)}</td><td class="num"><b>${mxn(f.a_descontar)}</b></td><td class="num">${mxn(f.saldo)}</td></tr>`).join('') || '<tr><td colspan="6" class="vacio">Sin movimientos en el periodo.</td></tr>'}</tbody><tfoot><tr><th>Total</th><td class="num">${mxn(r.total.cargos)}</td><td class="num">${mxn(r.total.devoluciones)}</td><td class="num">${mxn(r.total.abonos)}</td><td class="num" id="nom-total"><b>${mxn(r.total.a_descontar)}</b></td><td class="num">${mxn(r.total.saldo)}</td></tr></tfoot></table></div>`;
  };
  $('#form-nomina').addEventListener('submit', (ev) => { ev.preventDefault(); nomina(); });
  await nomina();
}

// ── Configuración › Cajas: fondo fijo autorizado por caja y entregas o ajustes de efectivo (solo Administración) ──
/** «Cierre de sesión por inactividad» (Configuración › Cajas): minutos de la caja y de Administración. */
async function montarInactividad() {
  const { config } = await api('/api/admin/config-sesion');
  cuerpoVista().insertAdjacentHTML('beforeend', `    <section class="panel" id="panel-inactividad" style="margin-top:16px"><h2 style="margin-top:0">Cierre de sesión por inactividad</h2>
      <p class="nota" style="margin-top:0">Si nadie toca la pantalla durante estos minutos, la sesión se cierra y hay que volver a entrar. Un minuto antes aparece un aviso con «Seguir trabajando». La venta con artículos queda en «Venta en espera». <b>0 = nunca se cierra.</b></p>
      <div id="msg-inactividad" class="mensaje" role="status" aria-live="polite"></div>
      <form id="form-inactividad" class="filas" style="align-items:flex-end"><div class="campo"><label for="ina-caja">Caja (minutos)</label><input id="ina-caja" type="number" min="0" max="480" step="1" value="${config.caja_min}"></div><div class="campo"><label for="ina-admin">Administración (minutos)</label><input id="ina-admin" type="number" min="0" max="480" step="1" value="${config.admin_min}"></div>
        <button class="btn btn-primario" type="submit" id="btn-inactividad" style="width:auto">${ico('check')}<span>Guardar</span></button></form></section>`);
  $('#form-inactividad').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const m = $('#msg-inactividad');
    try { await api('/api/admin/config-sesion', { caja_min: Number($('#ina-caja').value), admin_min: Number($('#ina-admin').value) }); m.className = 'mensaje ok'; m.textContent = 'Guardado. Las cajas lo reciben al sincronizar.'; }
    catch (e) { m.className = 'mensaje error'; m.textContent = e.message; }
  });
}

async function vistaCajasFondo() {
  const j = await api('/api/admin/cajas/fondo');
  const nom = (c) => `${esc(c.tienda)} · Caja ${c.caja}`;
  cuerpoVista().innerHTML = `<section class="panel"><h2 style="margin-top:0">Fondo fijo por caja</h2>
    <p class="nota">Solo Administración asigna o cambia el fondo autorizado de cada caja. La cajera cuenta y confirma su composición en el cierre, pero no puede modificar el importe. Sin asignación, la caja usa ${mxn(j.defecto)}. Cada cambio queda con quién lo hizo y el motivo.</p>
    <div id="msg-cajas" class="mensaje" role="status" aria-live="polite"></div>
    <div class="tabla-cont"><table id="tabla-cajas-fondo"><thead><tr><th>Caja</th><th class="num">Fondo autorizado</th><th>Último fondo confirmado</th><th>Historial</th><th></th></tr></thead><tbody>
    ${j.cajas.map((c) => `<tr data-caja="${esc(c.tienda)}/${c.caja}"><td>${nom(c)}</td><td class="num" data-col="fondo">${mxn(c.fondo)}${c.asignado ? '' : ' <small>(por defecto)</small>'}</td>
      <td data-col="ultimo">${c.ultimo_fondo ? `${esc(c.ultimo_fondo.fecha)} · ${mxn(c.ultimo_fondo.total)} · ${esc(c.ultimo_fondo.estado)}${c.ultimo_fondo.diferencia ? ` (${dif$(c.ultimo_fondo.diferencia)}: ${esc(c.ultimo_fondo.nota)})` : ''}` : '—'}</td>
      <td>${c.historial.slice(0, 3).map((h) => `${mxn(h.monto)} · ${esc(h.por)} · ${esc(h.motivo)}`).join('<br>') || '—'}</td>
      <td class="filas" style="flex-wrap:nowrap"><button class="btn cf-fondo" type="button">${ico('pencil')}<span>Cambiar fondo</span></button><button class="btn cf-ajuste" type="button">${ico('cash')}<span>Entrega o ajuste</span></button></td></tr>`).join('')}
    </tbody></table></div>
    <form id="form-cf" hidden autocomplete="off" style="margin-top:12px;border-top:1px solid var(--borde);padding-top:10px"></form></section>
    <section class="panel"><h2 style="margin-top:0">Entregas y ajustes recientes</h2><div class="tabla-cont"><table id="tabla-ajustes"><thead><tr><th>Caja</th><th>Fecha</th><th>Operación</th><th class="num">Monto</th><th>Motivo</th><th>Registró</th></tr></thead><tbody>
    ${j.cajas.flatMap((c) => c.ajustes.map((a) => `<tr><td>${nom(c)}</td><td>${esc(a.fecha)}</td><td>${a.tipo === 'salida' ? 'Salida por ajuste' : 'Entrega de efectivo'}</td><td class="num">${mxn(a.monto)}</td><td>${esc(a.motivo)}</td><td>${esc(a.por)}</td></tr>`)).join('') || '<tr><td colspan="6" class="vacio">Sin entregas ni ajustes.</td></tr>'}</tbody></table></div></section>`;
  const msg = (t, tipo = 'error') => { const m = $('#msg-cajas'); m.className = `mensaje ${tipo}`; m.textContent = t; };
  const abrir = (c, tipo) => {
    const f = $('#form-cf'); f.hidden = false;
    f.innerHTML = tipo === 'fondo'
      ? `<h3 style="margin-top:0">Cambiar el fondo de ${nom(c)}</h3><div class="campo"><label for="cf-monto">Fondo autorizado ($)</label><input id="cf-monto" class="texto" inputmode="decimal" value="${centavosAPesos(c.fondo)}"></div>
         <div class="campo"><label for="cf-motivo">Motivo del cambio</label><input id="cf-motivo" class="texto" maxlength="120"></div>
         <div class="filas"><button class="btn" type="button" id="cf-cancelar">Cancelar</button><button class="btn btn-primario" type="submit" style="width:auto;flex:1">${ico('check')}<span>Guardar fondo</span></button></div>`
      : `<h3 style="margin-top:0">Entrega o ajuste de efectivo en ${nom(c)}</h3><div class="campo"><label for="cf-tipo">Operación</label><select id="cf-tipo" style="width:100%;padding:8px;border:1px solid var(--borde);border-radius:8px;background:var(--superficie)"><option value="entrada">Entrega de efectivo a la caja (suma)</option><option value="salida">Salida de efectivo por ajuste (resta)</option></select></div>
         <div class="campo"><label for="cf-monto">Monto ($)</label><input id="cf-monto" class="texto" inputmode="decimal"></div><div class="campo"><label for="cf-motivo">Motivo</label><input id="cf-motivo" class="texto" maxlength="120"></div>
         <div class="filas"><button class="btn" type="button" id="cf-cancelar">Cancelar</button><button class="btn btn-primario" type="submit" style="width:auto;flex:1">${ico('check')}<span>Registrar</span></button></div>`;
    $('#cf-cancelar').addEventListener('click', () => { f.hidden = true; });
    const ref = nuevaRef();
    f.onsubmit = async (ev) => {
      ev.preventDefault();
      const monto = parseMXN($('#cf-monto').value);
      if (!monto) return msg('Escriba un importe válido en pesos.');
      try {
        await api(tipo === 'fondo' ? '/api/admin/cajas/fondo' : '/api/admin/cajas/ajuste', tipo === 'fondo' ? { tienda: c.tienda, caja: c.caja, monto, motivo: $('#cf-motivo').value } : { tienda: c.tienda, caja: c.caja, tipo: $('#cf-tipo').value, monto, motivo: $('#cf-motivo').value, ref });
        await vistaCajasFondo(); msg('Guardado. La caja lo recibe al sincronizar.', 'ok');
      } catch (e) { msg(e.message); }
    };
    $('#cf-monto').focus();
  };
  for (const tr of $('#tabla-cajas-fondo').querySelectorAll('tr[data-caja]')) {
    const [tienda, n] = tr.dataset.caja.split('/'); const c = j.cajas.find((x) => x.tienda === tienda && String(x.caja) === n);
    tr.querySelector('.cf-fondo').addEventListener('click', () => abrir(c, 'fondo'));
    tr.querySelector('.cf-ajuste').addEventListener('click', () => abrir(c, 'ajuste'));
  }
  await montarInactividad();
}

// ── Feria: billetes y monedas de cambio de cada caja (estimado en el día, exacto desde el conteo del cierre) ──
const denFeria = (c) => (c >= 2000 ? `Billete de ${mxn(c).replace('.00', '')}` : `Moneda de ${mxn(c).replace('.00', '')}`);
const listaFeria = (d) => Object.keys(d).map(Number).sort((a, b) => b - a).map((k) => `${d[String(k)]} × ${mxn(k).replace('.00', '')}`).join(', ') || '—';
const ESTADO_FERIA = {
  bien: ['Feria suficiente', 'var(--ok, #1f7a4d)'], bajo: ['Va a faltar feria pronto', '#b8860b'], critico: ['Estado de feria CRÍTICO', '#b3261e'], sin_dato: ['Sin fondo contado hoy', '#6b7280'],
};
async function vistaFeria() {
  const j = await api('/api/admin/feria'); // solo el día de hoy: la feria de días anteriores ya no se muestra
  const orden = { critico: 0, bajo: 1, bien: 2, sin_dato: 3 };
  const cajas = [...j.cajas].sort((a, b) => orden[a.estado] - orden[b.estado] || a.tienda.localeCompare(b.tienda) || a.caja - b.caja);
  const hora = (iso) => new Date(Date.parse(iso) - 7 * 3600_000).toISOString().slice(11, 16);
  const tarjeta = (c) => {
    const [rotulo, color] = ESTADO_FERIA[c.estado];
    const movs = c.eventos.filter((e) => e.tipo !== 'fondo' && e.tipo !== 'conteo');
    const suma = (campo, d) => movs.reduce((a, e) => a + (e[campo][String(d)] ?? 0), 0);
    const filas = c.estado === 'sin_dato' ? '' : j.denominaciones.map((d) => {
      const n = c.inventario[String(d)] ?? 0, min = j.minimos[d];
      const est = n === 0 ? ['Agotada', '#b3261e'] : n < min ? ['Baja', '#b8860b'] : ['OK', 'var(--ok, #1f7a4d)'];
      return `<tr data-den="${d}"><td>${denFeria(d)}</td><td class="num">+${suma('entra', d)}</td><td class="num">−${suma('sale', d)}</td><td class="num"><b>${n}</b></td><td class="num">${min}</td><td><b style="color:${est[1]}">${est[0]}</b></td></tr>`;
    }).join('');
    const ev = movs.slice().reverse();
    return `<section class="panel" data-caja="${esc(c.tienda)}/${c.caja}" data-estado="${esc(c.estado)}" style="border-left:8px solid ${color}">
      <div class="filas" style="align-items:center;justify-content:space-between"><h2 style="margin:0">${esc(c.nombre)} · Caja ${c.caja}</h2><b class="estado-feria" style="color:${color};font-size:1.1em">${rotulo}</b></div>
      ${c.estado === 'sin_dato' ? '<p class="nota">La cajera todavía no cuenta y confirma el fondo de hoy: sin ese conteo no hay punto de partida.</p>' : `
      <p class="nota" style="margin:4px 0 8px">${c.estimado ? `<b>Estimado.</b> Último conteo confirmado a las ${hora(c.confirmado_en)}; desde entonces se supone lo más probable que entró y salió en cada operación.` : `<b>Confirmado</b> billete por billete y moneda por moneda a las ${hora(c.confirmado_en)}.`}${c.desfase ? ' <b style="color:#b3261e">La estimación no cuadró con lo que había: conviene contar la caja.</b>' : ''}</p>
      <div class="tabla-cont"><table><thead><tr><th>Denominación</th><th class="num">Entró hoy</th><th class="num">Salió hoy</th><th class="num">Hay ahora</th><th class="num">Mínimo</th><th>Estado</th></tr></thead><tbody>${filas}</tbody></table></div>
      <div class="filas" style="margin-top:10px"><button class="btn ver-movimientos" type="button" aria-expanded="false">${ico('clock')}<span>Ver movimientos (${ev.length})</span></button></div>
      <div class="tabla-cont movimientos-feria" hidden style="max-height:190px;overflow:auto;margin-top:6px"><table><thead><tr><th>Hora</th><th>Movimiento</th><th>Entra</th><th>Sale</th></tr></thead><tbody>${ev.map((e) => `<tr><td>${hora(e.ocurrio_en)}</td><td>${esc(e.descripcion)}${e.estimado ? '' : ' <small><b>(exacto)</b></small>'}</td><td>${listaFeria(e.entra)}</td><td>${listaFeria(e.sale)}</td></tr>`).join('') || '<tr><td colspan="4" class="vacio">Sin movimientos de feria hoy.</td></tr>'}</tbody></table></div>`}
    </section>`;
  };
  cuerpoVista().innerHTML = `<section class="panel"><h2 style="margin:0 0 4px">Estado de la feria por caja · hoy</h2>
      <p class="nota" style="margin:0">Billetes y monedas para dar cambio. Durante el día es un <b>estimado</b> (se supone lo más probable que entrega la clienta, nunca con billete de $1,000, y que da la cajera); en el cierre se cuenta billete por billete y deja de ser estimación. <b>Crítico</b>: ya no hay al menos dos denominaciones. <b>Va a faltar</b>: alguna agotada o por debajo de su mínimo. Solo se muestra el día de hoy.</p></section>
    ${cajas.map(tarjeta).join('')}`;
  for (const b of cuerpoVista().querySelectorAll('.ver-movimientos')) {
    b.addEventListener('click', () => {
      const caja = b.closest('section'), lista = caja.querySelector('.movimientos-feria'), abrir = lista.hidden;
      lista.hidden = !abrir; b.setAttribute('aria-expanded', String(abrir));
      b.querySelector('span').textContent = `${abrir ? 'Ocultar' : 'Ver'} movimientos (${lista.querySelectorAll('tbody tr:not(:has(.vacio))').length})`;
    });
  }
  await montarInactividad();
}

// ── Registro de empleadas: alias (el «Usuario»), datos completos y foto con la cámara de la PC ──
/** Avatar de quien tiene la sesión en la barra azul: tan grande como cabe sin agrandar la barra (64 px menos su relleno = 48 px). Sin foto, su inicial. */
const avatarBarra = (nombre, foto) => (foto
  ? `<img class="avatar-barra" src="${esc(foto)}" alt="Foto de ${esc(nombre)}">`
  : `<span class="avatar-barra avatar-inicial" aria-hidden="true">${esc(String(nombre ?? '?').trim().slice(0, 1).toUpperCase() || '?')}</span>`);
const avatar = (x, tam = 44) => (x.perfil?.foto
  ? `<img src="${esc(x.perfil.foto)}" alt="Foto de ${esc(x.nombre)}" style="width:${tam}px;height:${tam}px;border-radius:50%;object-fit:cover;flex:none">`
  : `<span aria-hidden="true" style="width:${tam}px;height:${tam}px;border-radius:50%;background:var(--superficie-2);display:inline-flex;align-items:center;justify-content:center;flex:none">${ico('user')}</span>`);
const nombreCompleto = (x) => [x.perfil?.nombres, x.perfil?.apellidos].filter(Boolean).join(' ');
const celdaPersona = (x) => `<div style="display:flex;gap:10px;align-items:center">${avatar(x)}<div><b data-alias>${esc(x.nombre)}</b><br><small data-nombre-completo>${nombreCompleto(x) ? esc(nombreCompleto(x)) : '<span class="nota">sin datos completos</span>'}</small>${x.perfil?.telefono ? `<br><small>${esc(x.perfil.telefono)}</small>` : ''}</div></div>`;
const perfilCampos = (p) => `<div class="campo"><label for="${p}-nombres">Nombres</label><input id="${p}-nombres" class="texto" maxlength="60" autocomplete="off" required></div>
  <div class="campo"><label for="${p}-apellidos">Apellidos</label><input id="${p}-apellidos" class="texto" maxlength="60" autocomplete="off" required></div>
  <div class="campo"><label for="${p}-telefono">Teléfono</label><input id="${p}-telefono" class="texto" inputmode="tel" maxlength="20" autocomplete="off"></div>
  <div class="campo"><label for="${p}-direccion">Dirección</label><input id="${p}-direccion" class="texto" maxlength="160" autocomplete="off"></div>
  <div class="campo"><label for="${p}-foto-btn">Foto</label><div class="filas" style="align-items:center"><span id="${p}-foto-img"></span><button class="btn" type="button" id="${p}-foto-btn">${ico('camera')}<span>Tomar foto</span></button></div></div>`;
/** Conecta los campos del perfil (con prefijo `p`): valores iniciales, botón de foto y lectura de lo capturado. */
function perfilEnlazar(p, inicial) {
  const v = inicial ?? {};
  for (const k of ['nombres', 'apellidos', 'telefono', 'direccion']) $(`#${p}-${k}`).value = v[k] ?? '';
  let foto = v.foto ?? null;
  let cambio = false;
  const pintar = () => {
    $(`#${p}-foto-img`).innerHTML = foto ? `<img id="${p}-foto" src="${esc(foto)}" alt="Foto tomada" style="width:56px;height:56px;border-radius:50%;object-fit:cover">` : '';
    $(`#${p}-foto-btn span`).textContent = foto ? 'Cambiar foto' : 'Tomar foto';
  };
  pintar();
  $(`#${p}-foto-btn`).addEventListener('click', async () => { const f = await tomarFoto(); if (f) { foto = f; cambio = true; pintar(); } });
  return {
    leer: () => ({ nombres: $(`#${p}-nombres`).value, apellidos: $(`#${p}-apellidos`).value, telefono: $(`#${p}-telefono`).value, direccion: $(`#${p}-direccion`).value, ...(cambio ? { foto } : {}) }),
    completo: () => !!$(`#${p}-nombres`).value.trim() && !!$(`#${p}-apellidos`).value.trim(),
  };
}
/** Foto con la cámara de la PC; si no hay cámara o no se autoriza, se elige un archivo. Devuelve un JPEG de 240×240 (data URL) o null. */
function tomarFoto() {
  return new Promise((fin) => {
    const d = dialogo('dlg-foto');
    d.setAttribute('aria-labelledby', 'foto-titulo');
    d.innerHTML = `<h2 id="foto-titulo" style="margin-top:0">Foto</h2>
      <div style="position:relative;width:100%;max-width:300px;aspect-ratio:1;margin:0 auto;background:#000;border-radius:12px;overflow:hidden">
        <video id="foto-video" autoplay playsinline muted style="width:100%;height:100%;object-fit:cover"></video>
        <img id="foto-previa" alt="Foto tomada" hidden style="width:100%;height:100%;object-fit:cover;position:absolute;inset:0"></div>
      <div id="msg-foto" class="mensaje" role="status" aria-live="polite"></div>
      <div class="filas" style="margin-top:8px;align-items:center">
        <button class="btn" type="button" id="foto-cancelar">${ico('x')}<span>Cancelar</span></button>
        <label class="btn" for="foto-archivo" id="foto-archivo-lbl" style="cursor:pointer">${ico('upload')}<span>Elegir archivo</span></label><input type="file" id="foto-archivo" accept="image/*" hidden>
        <button class="btn" type="button" id="foto-repetir" hidden>${ico('refresh')}<span>Repetir</span></button>
        <button class="btn btn-primario" type="button" id="foto-capturar" disabled style="width:auto;flex:1">${ico('camera')}<span>Tomar foto</span></button>
        <button class="btn btn-primario" type="button" id="foto-usar" hidden style="width:auto;flex:1">${ico('check')}<span>Usar esta foto</span></button></div>`;
    let stream = null;
    let resultado = null;
    const recortar = (fuente, ancho, alto) => {
      const c = document.createElement('canvas');
      c.width = c.height = 240;
      const lado = Math.min(ancho, alto);
      c.getContext('2d').drawImage(fuente, (ancho - lado) / 2, (alto - lado) / 2, lado, lado, 0, 0, 240, 240);
      return c.toDataURL('image/jpeg', 0.8);
    };
    const mostrar = (url) => { resultado = url; $('#foto-previa').src = url; $('#foto-previa').hidden = false; $('#foto-capturar').hidden = true; $('#foto-usar').hidden = false; $('#foto-repetir').hidden = false; };
    const cerrar = () => { stream?.getTracks().forEach((t) => t.stop()); stream = null; if (d.open) d.close(); fin(null); };
    d.addEventListener('close', () => { stream?.getTracks().forEach((t) => t.stop()); stream = null; }, { once: true });
    $('#foto-cancelar').addEventListener('click', cerrar);
    d.addEventListener('cancel', cerrar, { once: true });
    $('#foto-repetir').addEventListener('click', () => { resultado = null; $('#foto-previa').hidden = true; $('#foto-capturar').hidden = false; $('#foto-usar').hidden = true; $('#foto-repetir').hidden = true; });
    $('#foto-usar').addEventListener('click', () => { const r = resultado; stream?.getTracks().forEach((t) => t.stop()); stream = null; d.close(); fin(r); });
    $('#foto-capturar').addEventListener('click', () => { const v = $('#foto-video'); if (v.videoWidth) mostrar(recortar(v, v.videoWidth, v.videoHeight)); });
    $('#foto-archivo').addEventListener('change', async (ev) => {
      const f = ev.target.files[0];
      if (!f) return;
      try { const b = await createImageBitmap(f); mostrar(recortar(b, b.width, b.height)); }
      catch { const m = $('#msg-foto'); m.className = 'mensaje error'; m.textContent = 'No se pudo leer esa imagen.'; }
    });
    d.showModal();
    const m = $('#msg-foto');
    if (!navigator.mediaDevices?.getUserMedia) { m.className = 'mensaje aviso'; m.textContent = 'Este equipo no permite usar la cámara aquí: elija un archivo.'; return; }
    navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 } }, audio: false }).then((st) => {
      if (!d.open) { st.getTracks().forEach((t) => t.stop()); return; }
      stream = st;
      const v = $('#foto-video');
      v.srcObject = st;
      // solo se puede tomar la foto cuando la cámara ya entrega imagen (si no, saldría vacía)
      const listo = () => { if (v.videoWidth) $('#foto-capturar').disabled = false; };
      v.addEventListener('loadeddata', listo, { once: true });
      listo();
    }).catch((e) => { m.className = 'mensaje aviso'; m.textContent = `No se pudo usar la cámara (${e?.name === 'NotAllowedError' ? 'sin permiso' : 'no hay cámara'}). Elija un archivo.`; });
  });
}
const iniciales = (nombre) => String(nombre).trim().split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0].toUpperCase()).join('') || '?';
const fechaLocalJs = (iso) => new Date(Date.parse(iso) - 7 * 3600e3).toISOString().slice(0, 10);
/** «1 año 3 meses», «7 meses» o «12 días» entre dos fechas AAAA-MM-DD. */
function antiguedadTxt(desde, hasta) {
  const [y1, m1, d1] = desde.split('-').map(Number), [y2, m2, d2] = hasta.split('-').map(Number);
  let meses = (y2 - y1) * 12 + (m2 - m1) - (d2 < d1 ? 1 : 0);
  if (meses < 0) return '';
  if (meses < 1) { const dias = Math.max(0, Math.round((Date.parse(`${hasta}T00:00:00Z`) - Date.parse(`${desde}T00:00:00Z`)) / 86400e3)); return `${dias} día${dias === 1 ? '' : 's'}`; }
  const a = Math.floor(meses / 12); meses %= 12;
  return [a ? `${a} año${a === 1 ? '' : 's'}` : '', meses ? `${meses} mes${meses === 1 ? '' : 'es'}` : ''].filter(Boolean).join(' ');
}
const NOM_TIENDA_TRAB = { '': 'Sin asignar', DUO: 'DÚO', LON: 'London' };
const CRITERIOS_EXP = [['puntualidad', 'Puntualidad'], ['presentacion', 'Presentación'], ['inasistencias', 'Inasistencias', '5 = nunca falta'], ['facilidad_palabra', 'Facilidad de palabra'], ['vendedora', 'Vendedora'], ['humildad', 'Humildad']];
/**
 * Expediente PRIVADO de una trabajadora (fecha de alta, inactividad, ¿recontratable?, calificaciones y notas). Está oculto aunque la sesión sea de administrador:
 * se abre con la clave de un supervisor y se vuelve a cerrar solo (al salir de esta ventana o a los 3 minutos). Es un candado de pantalla, no un cifrado.
 */
function abrirExpediente(x, recargar) {
  const d = dialogo('dlg-expediente');
  d.setAttribute('aria-labelledby', 'exp-titulo');
  const bloquear = () => api('/api/admin/expediente/bloquear', {}).catch(() => {});
  const cerrar = () => { bloquear(); if (d.open) d.close(); };
  d.addEventListener('close', () => { bloquear(); d.innerHTML = ''; }, { once: true }); // al salir se cierra el candado y no queda nada del expediente en la pantalla
  let formulario = null; // lo que se abre después de teclear la clave (la ficha ya hecha)
  const campoClave = (id, rotulo) => `<div class="campo"><label for="${id}">${rotulo}</label><input id="${id}" type="text" data-pin inputmode="numeric" autocomplete="off" maxlength="8" placeholder="••••" style="width:100%;box-sizing:border-box;padding:10px;border:2px solid var(--borde);border-radius:10px;background:var(--superficie);font:inherit;font-size:20px"></div>`;
  const candado = async (aviso, modo) => {
    let tiene = true;
    try { tiene = (await api('/api/admin/expediente/clave')).tiene; } catch (e) { d.innerHTML = `<div class="mensaje error">${esc(e.message)}</div><div class="filas"><button class="btn" type="button" id="exp-cancelar">Cerrar</button></div>`; $('#exp-cancelar').addEventListener('click', cerrar); return; }
    const crear = !tiene || modo === 'cambiar';
    d.innerHTML = `<h2 id="exp-titulo" style="margin-top:0">${ico('lock')} Ficha</h2>
      <p class="nota" style="margin-top:0">${esc(x.nombre)} · ${crear ? (tiene ? 'Escriba su clave actual y la nueva.' : 'Primero cree <b>su clave corta</b> (4 a 8 dígitos). Es solo suya: no es la contraseña de Supabase. Con ella abre las fichas y autoriza en la caja. Hágalo usted mismo, antes de prestar el teléfono.') : 'Teclee <b>su clave corta</b> para abrir la ficha. Se cierra sola.'}</p>
      <form id="form-exp-clave" autocomplete="off">
        ${crear ? `${tiene ? campoClave('exp-actual', 'Su clave actual') : ''}${campoClave('exp-nueva', tiene ? 'Clave nueva (4 a 8 dígitos)' : 'Su clave corta (4 a 8 dígitos)')}${campoClave('exp-nueva2', 'Repita la clave')}` : campoClave('exp-clave', 'Su clave corta')}
        <div id="msg-exp" class="mensaje ${aviso ? 'aviso' : ''}" role="alert">${esc(aviso ?? '')}</div>
        ${tiene && !crear ? '<p class="nota" style="margin:0 0 8px">Es la misma «Clave de caja» de su usuario. ¿La olvidó? Escriba una nueva en Personal › Perfiles, en su renglón, columna «Clave de caja», y toque «Guardar cambios».</p>' : ''}
        <div class="filas"><button class="btn" type="button" id="exp-cancelar">Cancelar</button>${tiene && !crear ? `<button class="btn" type="button" id="exp-cambiar">Cambiar mi clave</button>` : ''}<button class="btn btn-primario" type="submit" style="width:auto;flex:1">${ico('lock')}<span>${crear ? (tiene ? 'Cambiar clave' : 'Crear mi clave y abrir') : 'Abrir ficha'}</span></button></div></form>`;
    $('#exp-cancelar').addEventListener('click', cerrar);
    if ($('#exp-cambiar')) $('#exp-cambiar').addEventListener('click', () => candado(null, 'cambiar'));
    $('#form-exp-clave').addEventListener('submit', async (ev) => {
      ev.preventDefault();
      const m = $('#msg-exp');
      try {
        if (crear) {
          const n1 = $('#exp-nueva').value, n2 = $('#exp-nueva2').value;
          if (!/^\d{4,8}$/.test(n1)) { m.className = 'mensaje error'; m.textContent = 'La clave lleva de 4 a 8 dígitos (solo números).'; return; }
          if (n1 !== n2) { m.className = 'mensaje error'; m.textContent = 'Las dos claves no coinciden.'; return; }
          await api('/api/admin/expediente/clave', { clave: n1, ...(tiene ? { actual: $('#exp-actual').value } : {}) });
        } else await api('/api/admin/expediente/desbloquear', { clave: $('#exp-clave').value });
        await formulario();
      } catch (e) { m.className = 'mensaje error'; m.textContent = e.message; for (const i of d.querySelectorAll('input')) i.value = ''; }
    });
    (d.querySelector('input') ?? $('#exp-cancelar')).focus();
  };
  const cargar = async () => {
    try { return await api(`/api/admin/expediente?cajero_id=${encodeURIComponent(x.id)}`); }
    catch (e) { if (/bloqueado/i.test(e.message)) { candado('La ficha se cerró: teclee su clave otra vez.'); return null; } throw e; }
  };
  /** La ficha ya terminada: un perfil compacto con avatar, datos básicos, calificaciones y notas. «Editar ficha» abre el formulario. */
  const ver = async (aviso) => {
    const j = await cargar();
    if (!j) return;
    const e = j.expediente, pf = j.cajero.perfil ?? {};
    const nombreCompleto = [pf.nombres, pf.apellidos].filter(Boolean).join(' ') || x.nombre;
    const fmt = (f) => (f ? `${f.slice(8, 10)}/${f.slice(5, 7)}/${f.slice(0, 4)}` : '—');
    const hoy = new Date(Date.now() - 7 * 3600e3).toISOString().slice(0, 10);
    const antig = e.fecha_alta ? antiguedadTxt(e.fecha_alta, e.fecha_baja || hoy) : '';
    const crit = CRITERIOS_EXP.map(([k, t]) => [t, e.calificaciones[k]]);
    const califs = crit.filter(([, n]) => n !== null);
    const prom = j.promedio;
    const estrellas = (n) => [1, 2, 3, 4, 5].map((i) => `<span class="pf-estrella ${i <= Math.round(n) ? 'on' : ''}">★</span>`).join('');
    const rec = e.recontratable === true ? ['si', 'Recontratable'] : e.recontratable === false ? ['no', 'No recontratable'] : ['nd', 'Recontratable: sin definir'];
    const dato = (t, v) => `<div class="pf-dato"><span>${esc(t)}</span><b>${v}</b></div>`;
    d.innerHTML = `<div id="perfil-ficha" class="perfil">
      <button class="pf-candado btn" type="button" id="exp-cerrar" aria-label="Bloquear y cerrar" title="Bloquear y cerrar">${ico('lock')}</button>
      <div class="pf-cab">
        ${pf.foto ? `<img class="pf-avatar" src="${esc(pf.foto)}" alt="Foto de ${esc(nombreCompleto)}">` : `<div class="pf-avatar pf-iniciales" aria-hidden="true">${esc(iniciales(nombreCompleto))}</div>`}
        <div class="pf-quien"><h2 id="exp-titulo" class="pf-nombre">${esc(nombreCompleto)}</h2><div class="pf-alias">@${esc(x.nombre)}</div>
          <div class="pf-chips"><span class="pf-chip ${j.cajero.activo ? 'ok' : 'baja'}">${j.cajero.activo ? 'Activa' : 'Inactiva'}</span><span class="pf-chip">${esc(NOM_TIENDA_TRAB[j.cajero.tienda ?? ''] ?? j.cajero.tienda)}</span><span class="pf-chip rec-${rec[0]}">${rec[1]}</span></div></div>
      </div>
      ${aviso ? `<div class="mensaje ok" id="msg-exp" role="status">${esc(aviso)}</div>` : '<div id="msg-exp" class="mensaje" role="status"></div>'}
      <section class="pf-bloque"><h3>Calificaciones</h3>
        ${prom !== null ? `<div class="pf-prom"><b id="pf-prom-num">${prom.toFixed(1)}</b><div class="pf-estrellas" aria-label="Promedio ${prom.toFixed(1)} de 5">${estrellas(prom)}</div><small>${califs.length} de ${crit.length} calificadas</small></div>` : '<p class="nota" style="margin:0">Aún sin calificar.</p>'}
        <div class="pf-crit">${crit.map(([t, n]) => `<div class="pf-crit-fila"><span>${esc(t)}</span><span class="pf-barra" aria-hidden="true">${[1, 2, 3, 4, 5].map((i) => `<i class="${n !== null && i <= n ? 'on' : ''}"></i>`).join('')}</span><b>${n === null ? '—' : n}</b></div>`).join('')}</div></section>
      <section class="pf-bloque"><h3>Datos</h3><div class="pf-datos">
        ${dato('Teléfono', esc(pf.telefono || '—'))}${dato('Dirección', esc(pf.direccion || '—'))}
        ${dato('Fecha de alta', `${esc(fmt(e.fecha_alta))}${antig ? ` <small>· ${esc(antig)}</small>` : ''}`)}${dato('Registrada en el sistema', esc(j.registrada_en ? fmt(fechaLocalJs(j.registrada_en)) : '—'))}
        ${e.fecha_baja ? dato('Inactiva desde', esc(fmt(e.fecha_baja))) : ''}</div></section>
      <section class="pf-bloque"><h3>Anotaciones</h3>${e.notas ? `<p class="pf-notas">${esc(e.notas)}</p>` : '<p class="nota" style="margin:0">Sin anotaciones.</p>'}</section>
      <div class="filas"><button class="btn" type="button" id="exp-cerrar2">${ico('lock')}<span>Bloquear y cerrar</span></button><button class="btn btn-primario" type="button" id="exp-editar" style="width:auto;flex:1">${ico('pencil')}<span>Editar ficha</span></button></div></div>`;
    $('#exp-cerrar').addEventListener('click', cerrar);
    $('#exp-cerrar2').addEventListener('click', cerrar);
    $('#exp-editar').addEventListener('click', () => editar(j));
  };
  const editar = (j) => {
    const e = j.expediente;
    const fReg = j.registrada_en ? fechaHora(j.registrada_en).slice(0, 10) : '—';
    const estilo = 'padding:8px;border:2px solid var(--borde);border-radius:10px;background:var(--superficie);font:inherit';
    d.innerHTML = `<h2 id="exp-titulo" style="margin-top:0">${ico('lock')} Ficha de ${esc(x.nombre)}</h2>
      <p class="nota" style="margin-top:0">Privada: solo con su clave corta. ${j.cajero.activo ? '<b>Activa</b>' : '<b>Inactiva</b> (el registro se conserva)'}.</p>
      <form id="form-exp" autocomplete="off">
        <div class="exp-fechas"><div class="campo"><label for="exp-alta">Fecha de alta (cuándo empezó a trabajar)</label><input id="exp-alta" type="date" value="${esc(e.fecha_alta ?? '')}" style="${estilo}"></div>
          <div class="campo"><label>Registrada en el sistema</label><div id="exp-registro" style="padding:8px 0">${esc(fReg)}</div></div>
          <div class="campo"><label for="exp-baja">Fecha de inactividad</label><input id="exp-baja" type="date" value="${esc(e.fecha_baja ?? '')}" style="${estilo}"></div></div>
        <fieldset class="ru-opciones"><legend>¿Recontratable?</legend>
          <label><input type="radio" name="exp-rec" value="si" ${e.recontratable === true ? 'checked' : ''}> Sí</label><label><input type="radio" name="exp-rec" value="no" ${e.recontratable === false ? 'checked' : ''}> No</label><label><input type="radio" name="exp-rec" value="" ${e.recontratable === null ? 'checked' : ''}> Sin definir</label></fieldset>
        <fieldset class="ru-opciones exp-notas-fs"><legend>Calificaciones (1 a 5) <small id="exp-prom"></small></legend>
          ${CRITERIOS_EXP.map(([k, t, ayuda]) => `<div class="exp-crit" data-crit="${k}"><span class="exp-crit-t">${esc(t)}${ayuda ? ` <small>(${esc(ayuda)})</small>` : ''}</span><span class="exp-crit-b" role="radiogroup" aria-label="${esc(t)}">${[1, 2, 3, 4, 5].map((n) => `<button type="button" class="exp-n ${e.calificaciones[k] === n ? 'on' : ''}" data-n="${n}" role="radio" aria-checked="${e.calificaciones[k] === n}">${n}</button>`).join('')}<button type="button" class="exp-n exp-sin ${e.calificaciones[k] === null ? 'on' : ''}" data-n="" role="radio" aria-checked="${e.calificaciones[k] === null}" title="Sin calificar">—</button></span></div>`).join('')}</fieldset>
        <div class="campo"><label for="exp-notas">Anotaciones</label><textarea id="exp-notas" rows="5" maxlength="4000" placeholder="Ej.: Buena vendedora, faltaba mucho…" style="width:100%;box-sizing:border-box;${estilo};resize:vertical"></textarea></div>
        <div id="msg-exp" class="mensaje" role="status" aria-live="polite"></div>
        <div class="filas"><button class="btn" type="button" id="exp-cancelar-edicion">Cancelar</button><button class="btn btn-primario" type="submit" id="exp-guardar" style="width:auto;flex:1">${ico('check')}<span>Guardar ficha</span></button></div></form>`;
    $('#exp-notas').value = e.notas ?? '';
    const valores = () => Object.fromEntries(CRITERIOS_EXP.map(([k]) => { const on = d.querySelector(`[data-crit="${k}"] .exp-n.on`); return [k, on && on.dataset.n ? Number(on.dataset.n) : null]; }));
    const promedio = () => { const v = Object.values(valores()).filter((n) => n !== null); $('#exp-prom').textContent = v.length ? `· promedio ${(Math.round((v.reduce((a, b) => a + b, 0) / v.length) * 10) / 10).toFixed(1)}` : ''; };
    for (const b of d.querySelectorAll('.exp-n')) b.addEventListener('click', () => { for (const o of b.parentElement.querySelectorAll('.exp-n')) { o.classList.remove('on'); o.setAttribute('aria-checked', 'false'); } b.classList.add('on'); b.setAttribute('aria-checked', 'true'); promedio(); });
    promedio();
    $('#exp-cancelar-edicion').addEventListener('click', () => ver());
    $('#form-exp').addEventListener('submit', async (ev) => {
      ev.preventDefault();
      const m = $('#msg-exp'), rec = d.querySelector('input[name="exp-rec"]:checked').value;
      try {
        await api('/api/admin/expediente', { cajero_id: x.id, fecha_alta: $('#exp-alta').value || null, fecha_baja: $('#exp-baja').value || null, recontratable: rec === 'si' ? true : rec === 'no' ? false : null, notas: $('#exp-notas').value, calificaciones: valores() });
        if (recargar) recargar();
        await ver('Ficha guardada.');
      } catch (er) { if (/bloqueado/i.test(er.message)) return candado('La ficha se cerró: teclee su clave otra vez.'); m.className = 'mensaje error'; m.textContent = er.message; }
    });
  };
  formulario = ver;
  candado();
  d.showModal();
}
/** «Eliminar» a una Vendedora-Cajera: pide la clave corta del supervisor. Desaparece de las listas, de «Venta por» y de las cajas; sus ventas conservan su nombre. */
function abrirEliminarTrabajadora(x, aviso, recargar, ruta = '/api/admin/cajeros/eliminar') {
  const d = dialogo('dlg-eliminar-trab');
  d.setAttribute('aria-labelledby', 'et-titulo');
  d.innerHTML = `<h2 id="et-titulo" style="margin-top:0">Eliminar a ${esc(x.nombre)}</h2>
    <p style="margin-top:0">Se quita de la lista, de «Venta por» y de las cajas, y ya no podrá iniciar sesión. Sus ventas anteriores conservan su nombre. <b>Si solo deja de trabajar por ahora, use «Desactivar»</b>: así se conserva su ficha para recontratarla.</p>
    <form id="form-eliminar-trab" autocomplete="off"><div class="campo"><label for="et-clave">Su clave corta</label><input id="et-clave" type="text" data-pin inputmode="numeric" autocomplete="off" maxlength="8" placeholder="••••" style="width:100%;box-sizing:border-box;padding:10px;border:2px solid var(--borde);border-radius:10px;background:var(--superficie);font:inherit;font-size:20px"></div>
      <div id="msg-et" class="mensaje" role="alert"></div>
      <div class="filas"><button class="btn" type="button" id="et-no">Cancelar</button><button class="btn btn-peligro" type="submit" style="width:auto;flex:1">${ico('trash')}<span>Eliminar a ${esc(x.nombre)}</span></button></div></form>`;
  $('#et-no').addEventListener('click', () => d.close());
  $('#form-eliminar-trab').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const m = $('#msg-et');
    try { await api(ruta, { id: x.id, clave: $('#et-clave').value }); d.close(); d.innerHTML = ''; await recargar(); aviso(`«${x.nombre}» eliminada.`, 'ok'); }
    catch (e) { m.className = 'mensaje error'; m.textContent = e.message; $('#et-clave').value = ''; }
  });
  d.showModal();
  $('#et-clave').focus();
}
/** Edita los datos de una persona ya registrada (alias, nombres, apellidos, teléfono, dirección y foto). */
function abrirEditarEmpleado(tipo, x, recargar) {
  const d = dialogo('dlg-empleado');
  d.setAttribute('aria-labelledby', 'emp-titulo');
  d.innerHTML = `<h2 id="emp-titulo" style="margin-top:0">Datos de ${esc(x.nombre)}</h2>
    <form id="form-empleado" autocomplete="off">
      <div class="campo"><label for="ed-alias">Usuario (alias)</label><input id="ed-alias" class="texto" maxlength="40"></div>
      ${perfilCampos('ed')}
      ${tipo === 'cajero' ? `<div class="campo"><label for="ed-tienda">Tienda donde trabaja</label><select id="ed-tienda" style="width:100%;padding:10px;border:2px solid var(--borde);border-radius:10px;background:var(--superficie)">${Object.entries(NOM_TIENDA_TRAB).map(([k, t]) => `<option value="${k}" ${(x.tienda ?? '') === k ? 'selected' : ''}>${t}${k === '' ? ' (aparece en las dos hasta que inicie sesión)' : ''}</option>`).join('')}</select><p class="nota" style="margin:4px 0 0">«Venta por» solo la muestra en su tienda. Si inicia sesión en la otra tienda, pasa sola a esa.</p></div>
      <button class="btn" type="button" id="emp-expediente" style="margin-bottom:8px">${ico('lock')}<span>Ficha</span></button>` : ''}
      <div id="msg-emp" class="mensaje" role="alert"></div>
      <div class="filas"><button class="btn" type="button" id="emp-cerrar">Cancelar</button><button class="btn btn-primario" type="submit" id="emp-guardar" style="width:auto;flex:1">${ico('check')}<span>Guardar datos</span></button></div></form>`;
  $('#ed-alias').value = x.nombre;
  const f = perfilEnlazar('ed', x.perfil ?? undefined);
  $('#emp-cerrar').addEventListener('click', () => d.close());
  if ($('#emp-expediente')) $('#emp-expediente').addEventListener('click', () => { d.close(); abrirExpediente(x, recargar); });
  $('#form-empleado').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const m = $('#msg-emp');
    if (!$('#ed-alias').value.trim()) { m.className = 'mensaje error'; m.textContent = 'Escriba el usuario (alias).'; return; }
    if (!f.completo()) { m.className = 'mensaje error'; m.textContent = 'Escriba los nombres y los apellidos.'; return; }
    try {
      await api(tipo === 'admin' ? '/api/admin/administradores' : '/api/admin/cajeros', { id: x.id, ...($('#ed-alias').value.trim() !== x.nombre ? { nombre: $('#ed-alias').value } : {}), perfil: f.leer(), ...(tipo === 'cajero' ? { tienda: $('#ed-tienda').value } : {}) });
      d.close();
      await recargar();
    } catch (e) { m.className = 'mensaje error'; m.textContent = e.message; }
  });
  d.showModal();
  $('#ed-nombres').focus();
}

// ── Usuarios: alias, datos completos y clave propia ──
async function vistaCajeros() {
  const [{ cajeros }, { administradores }, { supervisores }] = await Promise.all([api('/api/admin/cajeros'), api('/api/admin/administradores'), api('/api/admin/supervisores')]);
  // Supervisores que solo existen como «supervisor de caja» (sin acceso a Administración): también son personal y también cobran.
  const supsSolos = supervisores.filter((x) => !administradores.some((a) => `sup-${a.id.slice(4)}` === x.id));
  const celdaClave = 'style="padding:4px;border:1px solid var(--borde);border-radius:6px;background:var(--superficie)"';
  const esYo = (x) => String(S.sesion?.usuario ?? '').trim().toLowerCase() === String(x.nombre).trim().toLowerCase();
  const botonEliminar = (cls, motivoNo) => `<button class="btn btn-peligro ${cls}" type="button" ${motivoNo ? `disabled title="${esc(motivoNo)}"` : 'title="Quitarla por completo (pide su clave corta)"'}>${ico('trash')}<span>Eliminar</span></button>`;
  const filaAdmin = (x) => `<tr data-admin="${esc(x.id)}" data-rol="${x.rol}" class="fila-usuario" tabindex="0" title="Clic para editar los datos de ${esc(x.nombre)}"><td>${celdaPersona(x)}</td><td>${x.rol === 'almacenista' ? 'Almacenista' : 'Supervisor'}</td><td data-col="tienda">—</td><td>${x.activo ? 'Activo' : 'Desactivado'}</td>
    <td class="filas" style="flex-wrap:nowrap"><button class="btn a-editar" type="button">${ico('pencil')}<span>Editar datos</span></button><button class="btn a-activo" type="button">${x.activo ? 'Desactivar' : 'Activar'}</button>${botonEliminar('a-eliminar', x.protegido ? 'Cuenta protegida: no se puede eliminar' : esYo(x) ? 'Es su propio usuario' : '')}</td>
    <td><div class="claves-celda"><input type="password" class="a-clave" placeholder="Nueva contraseña (Administración)" aria-label="Nueva contraseña de ${esc(x.nombre)}" ${celdaClave}><input type="text" data-pin inputmode="numeric" class="a-clave-caja" placeholder="${x.clave_caja ? 'Nueva clave de caja' : 'Clave de caja (no cobra sin ella)'}" aria-label="Clave de caja de ${esc(x.nombre)}" ${celdaClave}><button class="btn a-guardar" type="button">${ico('check')}<span>Guardar cambios</span></button></div></td></tr>`;
  const filaCajera = (x) => `<tr data-cajero="${esc(x.id)}" data-rol="cajero" class="fila-usuario" tabindex="0" title="Clic para editar los datos de ${esc(x.nombre)}"><td>${celdaPersona(x)}</td><td>Vendedora-Cajera</td><td data-col="tienda">${esc(NOM_TIENDA_TRAB[x.tienda ?? ''] ?? x.tienda)}</td><td>${x.activo ? 'Activo' : 'Desactivado'}</td>
    <td class="filas" style="flex-wrap:nowrap"><button class="btn c-editar" type="button">${ico('pencil')}<span>Editar datos</span></button><button class="btn c-activo" type="button">${x.activo ? 'Desactivar' : 'Activar'}</button><button class="btn btn-peligro c-eliminar" type="button" title="Quitarla por completo (pide su clave corta)">${ico('trash')}<span>Eliminar</span></button></td>
    <td><div class="claves-celda"><input type="text" data-pin inputmode="numeric" class="c-clave" placeholder="Nueva clave de caja" aria-label="Nueva clave de ${esc(x.nombre)}" ${celdaClave}><button class="btn c-guardar" type="button">${ico('check')}<span>Cambiar clave</span></button></div></td></tr>`;
  const filaSup = (x) => `<tr data-sup="${esc(x.id)}" data-rol="supervisor" class="fila-usuario"><td><b data-alias>${esc(x.nombre)}</b><div class="nota">Supervisor de caja (sin acceso a Administración)</div></td><td>Supervisor</td><td data-col="tienda">—</td><td>${x.activo ? 'Activo' : 'Desactivado'}</td>
    <td class="filas" style="flex-wrap:nowrap"><button class="btn s-activo" type="button">${x.activo ? 'Desactivar' : 'Activar'}</button>${botonEliminar('s-eliminar', esYo(x) ? 'Es su propio usuario' : '')}</td>
    <td><div class="claves-celda"><input type="text" data-pin inputmode="numeric" class="s-clave" placeholder="Nueva clave de caja" aria-label="Nueva clave de ${esc(x.nombre)}" ${celdaClave}><button class="btn s-guardar" type="button">${ico('check')}<span>Cambiar clave</span></button></div></td></tr>`;
  // Activos primero y, dentro de cada grupo, por orden alfabético; el personal inactivo se va al final.
  const personas = [...administradores.map((x) => ({ x, html: filaAdmin(x) })), ...supsSolos.map((x) => ({ x, html: filaSup(x) })), ...cajeros.map((x) => ({ x, html: filaCajera(x) }))]
    .sort((a, b) => Number(b.x.activo) - Number(a.x.activo) || a.x.nombre.localeCompare(b.x.nombre, 'es', { sensitivity: 'base' }));
  const filas = personas.map((q) => q.html).join('') || '<tr><td colspan="6" class="vacio">Aún no hay personal registrado.</td></tr>';
  cuerpoVista().innerHTML = `<section class="panel" id="panel-personal"><h2 style="margin-top:0">Perfiles</h2>
    <p class="nota" style="margin-top:0">${administradores.some((a) => a.activo) ? '<b>Supervisor</b>: ve todo Administración, autoriza operaciones en la caja y también puede iniciar sesión y cobrar en la caja con su clave de caja (4 a 8 dígitos). <b>Almacenista</b>: solo Inventario y Almacén, y no cambia precios; si también cobra, ponle una clave de caja (cobra, pero no autoriza descuentos). Entran con su usuario y contraseña (6 a 40 caracteres), que solo viven en el servidor central. Las Vendedoras-Cajeras no entran a Administración.' : '<b>Esta consola está abierta: cualquiera que la abra puede entrar.</b> Cree el primer usuario (debe ser supervisor) para que pida usuario y contraseña. Quien lo crea queda dentro.'}</p>
    <p class="nota">Cada Vendedora-Cajera tiene su propia clave (4 a 8 dígitos) para confirmar operaciones a su nombre, como dar de alta un artículo en la caja. El <b>usuario (alias)</b> es con el que entra a la caja y el que sale en tickets y reportes; los nombres, apellidos, teléfono, dirección y foto son su registro. La clave no se puede volver a ver: si se olvida, se cambia.</p>
    <div class="filas" style="align-items:center;margin:8px 0"><input id="per-buscar" type="search" placeholder="Buscar por nombre, alias o teléfono" autocomplete="off" aria-label="Buscar personal" style="flex:1 1 260px;padding:9px 12px;border:2px solid var(--borde);border-radius:10px;background:var(--superficie);font:inherit"><label for="per-filtro" style="flex:none">Mostrar</label><select id="per-filtro" style="flex:none;padding:8px;border:2px solid var(--borde);border-radius:10px;background:var(--superficie)"><option value="">Todo el personal</option><option value="cajero">Vendedoras-Cajeras</option><option value="supervisor">Supervisores</option><option value="almacenista">Almacenistas</option></select></div>
    <div id="msg-admins" class="mensaje" role="status" aria-live="polite"></div>
    <div id="msg-cajeros" class="mensaje" role="status" aria-live="polite"></div>
    <div class="tabla-cont"><table id="tabla-personal"><thead><tr><th>Persona</th><th>Rol</th><th>Tienda</th><th>Estado</th><th>Acciones</th><th>Claves</th></tr></thead><tbody>${filas}</tbody></table></div><p id="per-vacio" class="nota" hidden>Nadie coincide con la búsqueda.</p></section>
    <section class="panel" id="panel-alta" style="margin-top:12px"><h2 style="margin-top:0">Agregar persona</h2>
    <div class="campo" style="max-width:320px"><label for="alta-rol">¿A quién vas a dar de alta?</label><select id="alta-rol" style="width:100%;padding:10px;border:2px solid var(--borde);border-radius:10px;background:var(--superficie)"><option value="cajero">Vendedora-Cajera</option><option value="supervisor">Supervisor</option><option value="almacenista" ${administradores.length ? '' : 'disabled'}>Almacenista</option></select></div>
    <div id="alta-cajero">
        <form id="form-cajero" class="filas" style="margin-top:12px;align-items:flex-end"><div class="campo"><label for="caj-nombre">Usuario (alias)</label><input id="caj-nombre" class="texto" maxlength="40" autocomplete="off" name="alias-caj-nombre" data-lpignore="true" required></div>${perfilCampos('caj')} <div class="campo"><label for="caj-clave">Clave</label><input id="caj-clave" type="text" data-pin inputmode="numeric" autocomplete="off" required></div>
      <div class="campo"><label for="caj-tienda">Tienda donde trabaja</label><select id="caj-tienda" style="padding:10px;border:2px solid var(--borde);border-radius:10px;background:var(--superficie)">${Object.entries(NOM_TIENDA_TRAB).map(([k, t]) => `<option value="${k}">${t}</option>`).join('')}</select></div>
      <button class="btn btn-primario" id="btn-caj" type="submit" style="width:auto">${ico('plus')}<span>Agregar Vendedora-Cajera</span></button></form>
    <div id="msg-caj-alta" class="mensaje" role="alert" aria-live="assertive" style="margin-top:8px"></div></div>
    <div id="alta-admin" hidden>
          <form id="form-admin" class="filas" style="margin-top:12px;align-items:flex-end"><div class="campo"><label for="adm-nombre">Usuario (alias)</label><input id="adm-nombre" class="texto" maxlength="40" autocomplete="off" name="alias-adm-nombre" data-lpignore="true" autocomplete="off" required></div>${perfilCampos('adm')}<div class="campo"><label for="adm-clave">Contraseña</label><input id="adm-clave" type="password" autocomplete="new-password" required></div>
        <div class="campo" id="adm-caja-campo"><label for="adm-clave-caja">Clave de caja (4 a 8 dígitos): para cobrar en la caja</label><input id="adm-clave-caja" type="text" data-pin inputmode="numeric" autocomplete="off"></div>
        <button class="btn btn-primario" id="btn-adm" type="submit" style="width:auto">${ico('plus')}<span id="txt-btn-adm">Agregar supervisor</span></button></form></div></section>`;
  const norm = (t) => String(t).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  const filtrarPersonal = () => {
    const f = $('#per-filtro').value, q = norm($('#per-buscar').value.trim());
    let visibles = 0;
    for (const tr of $('#tabla-personal').querySelectorAll('tbody tr[data-rol]')) {
      tr.hidden = (!!f && tr.dataset.rol !== f) || (!!q && !norm(tr.cells[0].textContent).includes(q));
      if (!tr.hidden) visibles++;
    }
    $('#per-vacio').hidden = visibles > 0 || !$('#tabla-personal').querySelector('tbody tr[data-rol]');
  };
  $('#per-filtro').addEventListener('change', filtrarPersonal);
  $('#per-buscar').addEventListener('input', filtrarPersonal);
  // Alta única: según el rol salen los campos que le tocan y el botón dice a quién se agrega.
  const rolAlta = () => {
    const r = $('#alta-rol').value;
    $('#alta-cajero').hidden = r !== 'cajero';
    $('#alta-admin').hidden = r === 'cajero';
    $('#txt-btn-adm').textContent = r === 'almacenista' ? 'Agregar almacenista' : 'Agregar supervisor';
  };
  $('#alta-rol').addEventListener('change', rolAlta);
  rolAlta();
  const msgA = (t, tipo = 'error') => { const m = $('#msg-admins'); m.className = `mensaje ${tipo}`; m.textContent = t; m.scrollIntoView({ block: 'nearest' }); };
  const perfilAdm = perfilEnlazar('adm');
  $('#form-admin').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const eraAbierta = !administradores.some((a) => a.activo);
    if (!perfilAdm.completo()) return msgA('Escriba los nombres y los apellidos.');
    try {
      await api('/api/admin/administradores', { nombre: $('#adm-nombre').value, perfil: perfilAdm.leer(), clave: $('#adm-clave').value, rol: $('#alta-rol').value, ...($('#adm-clave-caja').value ? { clave_caja: $('#adm-clave-caja').value } : {}) });
      if (eraAbierta) { S.sesion = await api('/api/sesion'); await pintarEncabezado(); }
      await vistaCajeros(); msgA('Administrador agregado.', 'ok');
    } catch (e) { msgA(e.message); }
  });
  for (const tr of $('#tabla-personal').querySelectorAll('tr[data-admin]')) {
    const id = tr.dataset.admin;
    const activo = administradores.find((c) => c.id === id).activo;
    tr.querySelector('.a-guardar').addEventListener('click', async () => {
      const clave = tr.querySelector('.a-clave').value;
      const claveCaja = tr.querySelector('.a-clave-caja')?.value ?? '';
      if (!clave && !claveCaja) return msgA('Escriba la nueva contraseña o la nueva clave de caja.');
      try { await api('/api/admin/administradores', { id, ...(clave ? { clave } : {}), ...(claveCaja ? { clave_caja: claveCaja } : {}) }); await vistaCajeros(); msgA('Cambios guardados.', 'ok'); } catch (e) { msgA(e.message); }
    });
    const editarA = () => abrirEditarEmpleado('admin', administradores.find((c) => c.id === id), vistaCajeros);
    tr.querySelector('.a-editar').addEventListener('click', editarA);
    tr.addEventListener('click', (ev) => { if (!ev.target.closest('input, button, a')) editarA(); });
    tr.addEventListener('keydown', (ev) => { if (ev.key === 'Enter' && ev.target === tr) editarA(); });
    tr.querySelector('.a-eliminar').addEventListener('click', (ev) => { ev.stopPropagation(); abrirEliminarTrabajadora(administradores.find((c) => c.id === id), msgA, vistaCajeros, '/api/admin/administradores/eliminar'); });
    tr.querySelector('.a-activo').addEventListener('click', async () => {
      try { await api('/api/admin/administradores', { id, activo: !activo }); S.sesion = await api('/api/sesion'); await vistaCajeros(); } catch (e) { msgA(e.message); }
    });
  }
  const msgC = (t, tipo = 'error') => { for (const id of ['#msg-cajeros', '#msg-caj-alta']) { const m = $(id); m.className = `mensaje ${tipo}`; m.textContent = t; } $('#msg-caj-alta').scrollIntoView({ block: 'nearest' }); };
  const perfilCaj = perfilEnlazar('caj');
  $('#form-cajero').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    if (!perfilCaj.completo()) return msgC('Escriba los nombres y los apellidos.');
    const nombreAlta = $('#caj-nombre').value.trim();
    try { await api('/api/admin/cajeros', { nombre: $('#caj-nombre').value, clave: $('#caj-clave').value, perfil: perfilCaj.leer(), tienda: $('#caj-tienda').value }); await vistaCajeros(); msgC(`Vendedora-Cajera «${nombreAlta}» guardada: ya aparece en la lista. Las cajas la reciben al sincronizar.`, 'ok'); } catch (e) { msgC(e.message); }
  });
  for (const tr of $('#tabla-personal').querySelectorAll('tr[data-cajero]')) {
    const id = tr.dataset.cajero;
    const activo = cajeros.find((c) => c.id === id).activo;
    tr.querySelector('.c-guardar').addEventListener('click', async () => {
      const clave = tr.querySelector('.c-clave').value;
      if (!clave) return msgC('Escriba la nueva clave.');
      try { await api('/api/admin/cajeros', { id, clave }); await vistaCajeros(); msgC('Clave cambiada.', 'ok'); } catch (e) { msgC(e.message); }
    });
    const editarC = () => abrirEditarEmpleado('cajero', cajeros.find((c) => c.id === id), vistaCajeros);
    tr.querySelector('.c-editar').addEventListener('click', editarC);
    tr.addEventListener('click', (ev) => { if (!ev.target.closest('input, button, a')) editarC(); });
    tr.addEventListener('keydown', (ev) => { if (ev.key === 'Enter' && ev.target === tr) editarC(); });
    tr.querySelector('.c-eliminar').addEventListener('click', (ev) => { ev.stopPropagation(); abrirEliminarTrabajadora(cajeros.find((c) => c.id === id), msgC, vistaCajeros); });
    tr.querySelector('.c-activo').addEventListener('click', async () => { try { await api('/api/admin/cajeros', { id, activo: !activo }); await vistaCajeros(); } catch (e) { msgC(e.message); } });
  }
  for (const tr of $('#tabla-personal').querySelectorAll('tr[data-sup]')) {
    const id = tr.dataset.sup;
    const activo = supsSolos.find((c) => c.id === id).activo;
    tr.querySelector('.s-guardar').addEventListener('click', async () => {
      const clave = tr.querySelector('.s-clave').value;
      if (!clave) return msgA('Escriba la nueva clave.');
      try { await api('/api/admin/supervisores', { id, clave }); await vistaCajeros(); msgA('Clave cambiada.', 'ok'); } catch (e) { msgA(e.message); }
    });
    tr.querySelector('.s-eliminar').addEventListener('click', (ev) => { ev.stopPropagation(); abrirEliminarTrabajadora(supsSolos.find((c) => c.id === id), msgA, vistaCajeros, '/api/admin/supervisores/eliminar'); });
    tr.querySelector('.s-activo').addEventListener('click', async () => { try { await api('/api/admin/supervisores', { id, activo: !activo }); await vistaCajeros(); } catch (e) { msgA(e.message); } });
  }
}

// ── Tiendas: nombre comercial, datos del ticket y política de devolución ──
async function vistaTiendas() {
  const { tiendas } = await api('/api/admin/tiendas');
  S.tiendasInfo = tiendas;
  const campo = (cls, rotulo, v, extra = '') => `<div class="campo" style="margin:6px 0"><label>${rotulo}<input class="texto ${cls}" value="${esc(v)}" ${extra} style="width:100%;padding:8px;border:1px solid var(--borde);border-radius:6px;background:var(--superficie);text-align:left;font-size:15px"></label></div>`;
  cuerpoVista().innerHTML = `<div class="titulo-vista">${ico('store')}<h1>Tiendas</h1></div>
    <p class="nota">Estos datos salen en el encabezado y el pie del ticket (con el logo de la tienda arriba) y en las imágenes de los cupones. Se actualizan en todas las cajas. Lo que deje vacío no se imprime.</p>
    <div id="msg-tiendas" class="mensaje" role="status" aria-live="polite"></div>
    <div class="cuadricula" id="tabla-tiendas">${tiendas.map((t) => `<section class="panel" data-tienda="${esc(t.tienda)}"><h2 style="margin-top:0">${esc(t.nombre)} <small class="nota">(${esc(t.tienda)})</small></h2>
      <img src="${logoTicket(t.tienda)}" alt="Logo en el ticket de ${esc(t.nombre)}" style="max-height:70px;display:block;margin-bottom:8px;background:#fff;padding:4px;border-radius:6px">
      ${campo('t-nombre', 'Nombre comercial', t.nombre, 'maxlength="40"')}${campo('t-razon', 'Razón social (a nombre de quién se factura)', t.razon_social, 'maxlength="80"')}${campo('t-rfc', 'RFC', t.rfc, 'maxlength="20"')}
      ${campo('t-direccion', 'Dirección', t.direccion, 'maxlength="120"')}${campo('t-ciudad', 'Ciudad y estado', t.ciudad, 'maxlength="80"')}${campo('t-telefono', 'Teléfono', t.telefono, 'maxlength="30"')}
      <div class="campo" style="margin:6px 0"><label>Política de devolución (un renglón por línea; sale al pie del ticket)<textarea class="t-politica" rows="7" maxlength="1500" style="width:100%;padding:8px;border:1px solid var(--borde);border-radius:6px;background:var(--superficie);color:var(--texto);font:inherit">${esc(t.politica)}</textarea></label></div>
      <div class="filas"><button class="btn btn-primario t-guardar" type="button" style="width:auto">${ico('check')}<span>Guardar</span></button><button class="btn t-fabrica" type="button" title="Volver a los datos originales">Restablecer</button></div></section>`).join('')}</div>`;
  const msgT = (tx, tipo) => { const m = $('#msg-tiendas'); m.className = `mensaje ${tipo}`; m.textContent = tx; };
  for (const sec of $('#tabla-tiendas').querySelectorAll('section[data-tienda]')) {
    const t = tiendas.find((x) => x.tienda === sec.dataset.tienda);
    const guardar = async (datos) => { try { await api('/api/admin/tiendas', { tienda: t.tienda, ...datos }); await vistaTiendas(); msgT('Datos guardados.', 'ok'); } catch (e) { msgT(e.message, 'error'); } };
    sec.querySelector('.t-guardar').addEventListener('click', () => guardar({ nombre: sec.querySelector('.t-nombre').value, razon_social: sec.querySelector('.t-razon').value, rfc: sec.querySelector('.t-rfc').value, direccion: sec.querySelector('.t-direccion').value, ciudad: sec.querySelector('.t-ciudad').value, telefono: sec.querySelector('.t-telefono').value, politica: sec.querySelector('.t-politica').value }));
    sec.querySelector('.t-fabrica').addEventListener('click', () => guardar(t.de_fabrica));
  }
}


// ── imagen del cupón con QR (para WhatsApp, redes o correo) ──
function qrMatriz(texto) {
  const q = window.qrcode(0, 'M');
  q.addData(texto); q.make();
  const n = q.getModuleCount();
  return { n, oscuro: (r, c) => q.isDark(r, c) };
}
function dibujarQR(ctx, texto, x, y, lado) {
  const { n, oscuro } = qrMatriz(texto);
  const m = 4; // zona tranquila de 4 módulos
  const celda = Math.floor(lado / (n + 2 * m));
  const real = celda * (n + 2 * m);
  const ox = x + Math.floor((lado - real) / 2), oy = y + Math.floor((lado - real) / 2);
  ctx.fillStyle = '#fff'; ctx.fillRect(ox, oy, real, real);
  ctx.fillStyle = '#000';
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (oscuro(r, c)) ctx.fillRect(ox + (c + m) * celda, oy + (r + m) * celda, celda, celda);
}
const cuponTitulo = (p) => (p.pct !== undefined ? `${p.pct}% DE DESCUENTO` : `${mxn(p.monto).replace(/\.00$/, '')} DE DESCUENTO`);
function cuponCondiciones(p) {
  const l = [];
  l.push(p.minimo ? `En compras desde ${mxn(p.minimo).replace(/\.00$/, '')}` : 'En cualquier compra');
  l.push(p.inicio || p.fin ? `Vigencia: ${p.inicio ? fechaPiso(p.inicio) : 'hoy'} al ${p.fin ? fechaPiso(p.fin) : 'nuevo aviso'}` : 'Vigencia: hasta nuevo aviso');
  if (p.usos_max) l.push(p.usos_max === 1 ? 'Un solo uso' : `Máximo ${p.usos_max} usos`);
  if (p.combinable === false) l.push('No se combina con otras promociones');
  return l;
}
/** Dibuja la tarjeta del cupón (1080×1350, vertical, buena para WhatsApp e Instagram). */
function tarjetaCupon(p) {
  const W = 1080, H = 1350;
  const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
  const x = cv.getContext('2d');
  x.fillStyle = '#0d2238'; x.fillRect(0, 0, W, H);
  x.fillStyle = '#16314e'; x.fillRect(40, 40, W - 80, H - 80);
  x.strokeStyle = '#2dd4bf'; x.lineWidth = 6; x.setLineDash([22, 14]); x.strokeRect(70, 70, W - 140, H - 140); x.setLineDash([]);
  x.textAlign = 'center'; x.fillStyle = '#9fb3c8'; x.font = '600 40px system-ui, sans-serif';
  x.fillText(tiendasTexto(p).toUpperCase(), W / 2, 170);
  x.fillStyle = '#5eead4'; x.font = '700 56px system-ui, sans-serif'; x.fillText('CUPÓN', W / 2, 270);
  x.fillStyle = '#ffffff'; x.font = '800 104px system-ui, sans-serif';
  const partes = cuponTitulo(p).split(' DE ');
  x.fillText(partes[0], W / 2, 420); x.font = '700 60px system-ui, sans-serif'; x.fillText(`DE ${partes[1]}`, W / 2, 495);
  x.fillStyle = '#e9f0f7'; x.font = '500 40px system-ui, sans-serif';
  x.fillText(p.nombre.length > 34 ? `${p.nombre.slice(0, 33)}…` : p.nombre, W / 2, 570);
  dibujarQR(x, `CUPON:${p.codigo}`, 290, 610, 500);
  x.fillStyle = '#ffffff'; x.font = '700 72px ui-monospace, Menlo, Consolas, monospace'; x.fillText(p.codigo, W / 2, 1170);
  x.fillStyle = '#9fb3c8'; x.font = '500 34px system-ui, sans-serif';
  cuponCondiciones(p).slice(0, 3).forEach((t, i) => x.fillText(t, W / 2, 1220 + i * 40));
  x.fillStyle = '#5eead4'; x.font = '600 30px system-ui, sans-serif'; x.fillText('Presenta este cupón en caja', W / 2, 1330 - 0);
  return cv;
}
function qrSolo(p) {
  const cv = document.createElement('canvas'); cv.width = 800; cv.height = 800;
  dibujarQR(cv.getContext('2d'), `CUPON:${p.codigo}`, 0, 0, 800);
  return cv;
}
const canvasBytes = (cv) => new Promise((res, rej) => cv.toBlob((b) => (b ? b.arrayBuffer().then((a) => res(new Uint8Array(a))) : rej(new Error('no se pudo crear la imagen'))), 'image/png'));
async function entregarArchivo(nombre, bytes, mime) {
  const dl = window.claude && window.claude.use ? await window.claude.use('downloads') : null;
  if (dl) {
    try { await dl.save({ filename: nombre, data: bytes }); return `Archivo entregado: ${nombre}`; }
    catch (e) { if (e && e.code === 'declined') return 'Descarga cancelada.'; throw e; }
  }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([bytes], { type: mime })); a.download = nombre; document.body.appendChild(a); a.click(); a.remove();
  return `Descarga iniciada: ${nombre}`;
}
function textoCupon(p) {
  return `🎁 ${tiendasTexto(p)}: ${p.nombre}\n${cuponTitulo(p)}\n${cuponCondiciones(p).join('\n')}\nCódigo: ${p.codigo}\nPresenta este cupón (o su QR) en caja.`;
}
function abrirImagenCupon(p) {
  const d = dialogo('dlg-cupon-img');
  d.setAttribute('aria-labelledby', 'img-titulo');
  d.innerHTML = `<h2 id="img-titulo" style="margin-top:0">Imagen del cupón ${esc(p.codigo)}</h2>
    <div style="text-align:center"><canvas id="img-cupon" style="max-width:100%;max-height:52vh;border-radius:12px"></canvas></div>
    <label style="display:block;margin-top:8px">Texto para acompañar el mensaje (WhatsApp, correo, redes)<textarea id="img-texto" readonly rows="6" style="width:100%;padding:8px;border:1px solid var(--borde);border-radius:8px;background:var(--superficie);color:var(--texto)">${esc(textoCupon(p))}</textarea></label>
    <p class="nota">El QR contiene <code>CUPON:${esc(p.codigo)}</code>. Para leerlo en caja hace falta un lector de códigos 2D (un láser de barras normal no lo lee): si no, la Vendedora-Cajera escribe el código.</p>
    <div id="msg-img" class="mensaje" role="status" aria-live="polite"></div>
    <div class="filas"><button class="btn" type="button" id="img-cerrar">Cerrar</button><button class="btn" type="button" id="img-copiar">Copiar texto</button><button class="btn" type="button" id="img-qr">${ico('download')}<span>Solo el QR (PNG)</span></button><button class="btn btn-primario" type="button" id="img-png" style="width:auto;flex:1">${ico('download')}<span>Descargar imagen (PNG)</span></button></div>`;
  const cv = tarjetaCupon(p);
  const vista = $('#img-cupon'); vista.width = cv.width; vista.height = cv.height; vista.getContext('2d').drawImage(cv, 0, 0);
  const m = $('#msg-img');
  const hecho = (t) => { m.className = 'mensaje ok'; m.textContent = t; };
  const falla = (e) => { m.className = 'mensaje error'; m.textContent = e.message; };
  $('#img-cerrar').addEventListener('click', () => d.close());
  $('#img-png').addEventListener('click', async () => { try { hecho(await entregarArchivo(`cupon-${p.codigo}.png`, await canvasBytes(cv), 'image/png')); } catch (e) { falla(e); } });
  $('#img-qr').addEventListener('click', async () => { try { hecho(await entregarArchivo(`qr-${p.codigo}.png`, await canvasBytes(qrSolo(p)), 'image/png')); } catch (e) { falla(e); } });
  $('#img-copiar').addEventListener('click', async () => {
    try { await navigator.clipboard.writeText($('#img-texto').value); hecho('Texto copiado.'); } catch { $('#img-texto').select(); hecho('Seleccionado: use Ctrl+C para copiarlo.'); }
  });
  d.showModal();
}

async function vistaDepartamentos() {
  const { departamentos: lista } = await api('/api/admin/departamentos');
  cuerpoVista().innerHTML = `<div class="titulo-vista">${ico('box')}<h1>Departamentos</h1></div>
    <section class="panel"><p class="nota">Cambiar el nombre actualiza los artículos que ya lo usan. Los alias son otras formas de escribirlo que se aceptan sin preguntar al importar (separe con comas). Un departamento desactivado ya no se ofrece al dar de alta artículos; los que ya lo tienen no cambian.</p>
      <div class="tabla-cont"><table id="tabla-deptos"><thead><tr><th>Nombre</th><th>Alias</th><th>Activo</th><th class="num">Artículos</th><th></th></tr></thead><tbody>
      ${lista.map((d) => `<tr data-depto="${esc(d.id)}"><td><input class="texto d-nombre" value="${esc(d.nombre)}" aria-label="Nombre de ${esc(d.nombre)}"></td><td><input class="texto d-alias" value="${esc(d.alias.join(', '))}" aria-label="Alias de ${esc(d.nombre)}"></td><td><input type="checkbox" class="d-activo" ${d.activo ? 'checked' : ''} ${d.id === 'sin-clasificar' ? 'disabled' : ''} aria-label="Activo"></td><td class="num">${d.articulos}</td><td><button class="btn d-guardar" type="button">${ico('check')}<span>Guardar</span></button></td></tr>`).join('')}</tbody></table></div>
      <div id="msg-depto" class="mensaje" role="status" aria-live="polite"></div></section>
    <section class="panel" style="margin-top:12px"><h2 style="margin-top:0">Nuevo departamento</h2>
      <form id="form-depto" autocomplete="off"><div class="campo"><label for="nd-nombre">Nombre</label><input id="nd-nombre" class="texto"></div>
      <div class="campo"><label for="nd-alias">Alias (opcional, separados por comas)</label><input id="nd-alias" class="texto"></div>
      <button class="btn btn-primario" id="btn-nuevo-depto" type="submit">${ico('check')}<span>Agregar departamento</span></button></form></section>`;
  const partir = (t) => t.split(',').map((x) => x.trim()).filter(Boolean);
  const m = $('#msg-depto');
  const intentar = async (cuerpo) => { try { await api('/api/admin/departamentos', cuerpo); await vistaDepartamentos(); $('#msg-depto').className = 'mensaje ok'; $('#msg-depto').textContent = 'Guardado.'; } catch (e) { m.className = 'mensaje error'; m.textContent = e.message; } };
  for (const b of $('#tabla-deptos').querySelectorAll('.d-guardar')) {
    b.addEventListener('click', () => {
      const tr = b.closest('tr');
      intentar({ id: tr.dataset.depto, nombre: tr.querySelector('.d-nombre').value, alias: partir(tr.querySelector('.d-alias').value), activo: tr.querySelector('.d-activo').checked });
    });
  }
  $('#form-depto').addEventListener('submit', (ev) => { ev.preventDefault(); intentar({ nombre: $('#nd-nombre').value, alias: partir($('#nd-alias').value) }); });
}
// ── Avisos al teléfono: cada venta, corte, resumen del día… con interruptores y «no molestar» ──
const AVISOS_TIPOS = [['venta', 'Cada venta', 'Un aviso por cada venta cobrada.'], ['corte', 'Corte de caja', 'Cuando una caja genera su corte.'], ['resumen_dia', 'Resumen de ventas del día', 'Un solo aviso con el total del día.'], ['devolucion', 'Devoluciones', 'Cuando se registra una devolución.'], ['cancelacion', 'Cancelaciones de venta', 'Cuando se cancela una venta.'], ['retiro', 'Retiros de efectivo', 'Cuando se saca efectivo de la caja.'], ['alertas', 'Alertas', 'Faltantes de almacén y posibles documentos perdidos.'], ['feria', 'Feria de las cajas', 'Cuando a una caja se le va acabando la feria (billetes y monedas de cambio) o ya está en estado crítico.']];
async function vistaAvisos() {
  const N = window.__POS_NOTIF__;
  const e = await N.estado().catch(() => ({ soporte: false, instalada: false, permiso: 'default', vapid: false, suscrito: false, prefs: {}, pausa_hasta: null }));
  const pf = e.prefs;
  const pausado = e.pausa_hasta && Date.parse(e.pausa_hasta) > Date.now();
  let guia = '';
  if (!e.soporte) guia = `<div class="mensaje error" id="av-guia">${/iPhone|iPad/.test(navigator.userAgent) && !e.instalada ? 'En iPhone los avisos solo funcionan con la app instalada: abra esta página en Safari, toque <b>Compartir</b> › <b>Agregar a pantalla de inicio</b> y ábrala desde ese icono.' : 'Este navegador no permite avisos al teléfono.'}</div>`;
  else if (!e.vapid) guia = '<div class="mensaje error" id="av-guia">Esta versión todavía no tiene la llave de avisos del central; hay que activarla en el servidor antes de poder suscribir el teléfono.</div>';
  else if (e.permiso === 'denied') guia = '<div class="mensaje error" id="av-guia">El teléfono bloqueó los avisos de esta app. Se vuelven a permitir en Ajustes › Notificaciones.</div>';
  const interr = (id, txt, ayuda, on) => `<label class="interruptor" style="margin:6px 0"><input type="checkbox" id="${id}" ${on ? 'checked' : ''}><span><b>${txt}</b><br><small>${ayuda}</small></span></label>`;
  cuerpoVista().innerHTML = `<div class="titulo-vista">${ico('bell')}<h1>Avisos en este teléfono</h1></div>
    <section class="panel" id="av-estado"><h2 style="margin-top:0">Este dispositivo</h2>
      ${guia}
      <p id="av-texto" style="font-size:17px">${e.suscrito ? `Los avisos están <b>activados</b>${pausado ? ` · en pausa hasta ${esc(fechaHora(e.pausa_hasta))}` : ''}.` : 'Los avisos están <b>desactivados</b> en este dispositivo.'}</p>
      <div class="filas">
        ${e.suscrito ? `<button class="btn" id="av-apagar" type="button">Desactivar en este teléfono</button><button class="btn" id="av-probar" type="button">${ico('bell')}<span>Enviar aviso de prueba</span></button>` : `<button class="btn btn-primario" id="av-activar" type="button" style="width:auto" ${e.soporte && e.vapid ? '' : 'disabled'}>${ico('bell')}<span>Activar avisos</span></button>`}
      </div>
      <div id="msg-avisos" class="mensaje" role="status"></div></section>
    ${e.suscrito ? `<section class="panel" id="av-pausa"><h2 style="margin-top:0">No molestar</h2>
      <p class="nota">Si se cansa de los avisos, pausa todos sin perder sus preferencias.</p>
      <div class="filas"><button class="btn" data-pausa="60" type="button">1 hora</button><button class="btn" data-pausa="manana" type="button">Hasta mañana</button>${pausado ? '<button class="btn btn-primario" data-pausa="0" type="button" style="width:auto">Reanudar ahora</button>' : ''}</div></section>
    <section class="panel" id="av-prefs"><h2 style="margin-top:0">Qué avisar</h2>
      ${AVISOS_TIPOS.map(([k, t, a]) => interr(`av-${k}`, t, a, pf[k] !== false)).join('')}
      <div class="filas" style="align-items:flex-end;margin-top:8px"><div class="campo"><label for="av-min">Avisar ventas desde (MXN)</label><input id="av-min" inputmode="decimal" value="${pf.venta_minima ? centavosAPesos(pf.venta_minima) : ''}" placeholder="0 = todas" style="width:130px"></div>
        <div class="campo"><label for="av-hora">Hora del resumen del día</label><input id="av-hora" type="time" value="${esc(pf.resumen_hora || '21:00')}"></div></div>
      <h3 style="margin-bottom:4px">Tiendas</h3>
      ${interr('av-t-DUO', 'DÚO New York', '', (pf.tiendas || ['DUO', 'LON']).includes('DUO'))}${interr('av-t-LON', 'London Love', '', (pf.tiendas || ['DUO', 'LON']).includes('LON'))}
      <button class="btn btn-primario" id="av-guardar" type="button" style="width:auto;margin-top:10px">${ico('check')}<span>Guardar preferencias</span></button></section>` : ''}`;
  const msg = (t, mal) => { const m = $('#msg-avisos'); m.className = `mensaje ${mal ? 'error' : 'ok'}`; m.textContent = t; };
  const correr = async (f, ok, repintar = true) => { try { await f(); if (repintar) await vistaAvisos(); if (ok) msg(ok, false); } catch (err) { msg(err.message || String(err), true); } };
  $('#av-activar')?.addEventListener('click', () => correr(() => N.activar(), 'Avisos activados en este teléfono.'));
  $('#av-apagar')?.addEventListener('click', () => correr(() => N.desactivar(), 'Avisos desactivados.'));
  $('#av-probar')?.addEventListener('click', () => correr(() => N.probar(), 'Aviso de prueba enviado: debe llegar en unos segundos.', false));
  for (const b of document.querySelectorAll('[data-pausa]')) {
    b.addEventListener('click', () => {
      const v = b.dataset.pausa;
      const hasta = v === '0' ? null : v === 'manana' ? (() => { const d = new Date(); d.setDate(d.getDate() + 1); d.setHours(7, 0, 0, 0); return d.toISOString(); })() : new Date(Date.now() + Number(v) * 60000).toISOString();
      correr(() => N.guardar({ pausa_hasta: hasta }), hasta ? 'Avisos en pausa.' : 'Avisos reanudados.');
    });
  }
  $('#av-guardar')?.addEventListener('click', () => {
    const prefs = { venta_minima: Math.round((Number($('#av-min').value.replace(/[$,\s]/g, '')) || 0) * 100), resumen_hora: $('#av-hora').value || '21:00', tiendas: ['DUO', 'LON'].filter((t) => $(`#av-t-${t}`).checked) };
    for (const [k] of AVISOS_TIPOS) prefs[k] = $(`#av-${k}`).checked;
    correr(() => N.guardar({ prefs }), 'Preferencias guardadas.');
  });
}

// ── Análisis de ventas: por mes, semana, día, día de la semana, hora, mapa de calor, forma de pago, caja y tienda ──
const AN_AGRUP = [['mes', 'Por mes'], ['semana', 'Por semana (la más alta del año)'], ['dia', 'Por día'], ['dia_semana', 'Por día de la semana'], ['hora', 'Por hora'], ['mapa_calor', 'Mapa de calor (día × hora)'], ['forma_pago', 'Por forma de pago'], ['caja', 'Por caja'], ['tienda', 'Por tienda']];
const AN_METRICAS = [['total', 'Total vendido ($)'], ['tickets', 'Tickets'], ['piezas', 'Piezas'], ['promedio_ticket', 'Ticket promedio ($)'], ['promedio_dia', 'Promedio por día ($)']];
const AN_DIAS = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'];
const anValor = (f, m) => (m === 'promedio_dia' ? (f.promedio_dia ?? 0) : f[m] ?? 0);
const anTexto = (v, m) => (m === 'tickets' || m === 'piezas' ? Number(v).toLocaleString('es-MX') : mxn(v));
const anCorto = (ag, f) => (ag === 'mes' ? f.etiqueta.slice(0, 3) : ag === 'semana' ? `S${f.etiqueta.split(' ')[1]}` : ag === 'dia' ? f.etiqueta.split(' ')[1] : ag === 'hora' ? `${f.etiqueta.split(':')[0]}h` : ag === 'dia_semana' ? f.etiqueta.slice(0, 3) : f.etiqueta);
const anFechas = (A) => {
  const hoy = new Date(Date.now() - 7 * 3600e3).toISOString().slice(0, 10), y = Number(hoy.slice(0, 4));
  const finMes = (ym) => `${ym}-${String(new Date(Date.UTC(Number(ym.slice(0, 4)), Number(ym.slice(5, 7)), 0)).getUTCDate()).padStart(2, '0')}`;
  if (A.rango === 'anio') return { desde: `${A.anio}-01-01`, hasta: `${A.anio}-12-31` };
  if (A.rango === 'mes') return { desde: `${A.mes}-01`, hasta: finMes(A.mes) };
  if (A.rango === 'ult30') return { desde: new Date(Date.parse(`${hoy}T00:00:00Z`) - 29 * 86400e3).toISOString().slice(0, 10), hasta: hoy };
  void y; return { desde: A.desde, hasta: A.hasta };
};
async function vistaAnalisis() {
  const { cajas } = await api('/api/admin/cajas');
  const hoy = new Date(Date.now() - 7 * 3600e3).toISOString().slice(0, 10), y = Number(hoy.slice(0, 4));
  const A = (S.analisis ??= { rango: 'anio', anio: String(y), mes: hoy.slice(0, 7), desde: `${y}-01-01`, hasta: hoy, agrupar: 'mes', metrica: 'total', historicas: true });
  const anios = Array.from({ length: Math.max(1, y - 2022) }, (_, i) => String(y - i));
  const sel = (id, ops, v) => `<select id="${id}" style="padding:8px;border:2px solid var(--borde);border-radius:10px;background:var(--superficie)">${ops.map(([k, t]) => `<option value="${k}" ${String(k) === String(v) ? 'selected' : ''}>${esc(t)}</option>`).join('')}</select>`;
  cuerpoVista().innerHTML = `<div class="titulo-vista">${ico('trend')}<h1>Análisis de ventas</h1></div>
    <form class="filtros panel" id="an-filtros" autocomplete="off">
      <div class="an-fila">
        <label>Periodo ${sel('an-rango', [['anio', 'Un año'], ['mes', 'Un mes'], ['ult30', 'Últimos 30 días'], ['personalizado', 'Fechas a elegir']], A.rango)}</label>
        <label id="an-l-anio">Año ${sel('an-anio', anios.map((a) => [a, a]), A.anio)}</label>
        <label id="an-l-mes">Mes <input type="month" id="an-mes" value="${esc(A.mes)}"></label>
        <label id="an-l-desde">Desde <input type="date" id="an-desde" value="${esc(A.desde)}"></label><label id="an-l-hasta">Hasta <input type="date" id="an-hasta" value="${esc(A.hasta)}"></label>
      </div>
      <div class="an-fila">
        <label>Ver ${sel('an-agrupar', AN_AGRUP, A.agrupar)}</label>
        <label id="an-l-metrica">Medir ${sel('an-metrica', AN_METRICAS, A.metrica)}</label>
      </div>
      <fieldset><legend>Cajas</legend><label><input type="checkbox" id="an-todas" checked> Todas</label>
        ${cajas.map((c) => `<label><input type="checkbox" class="an-caja" value="${esc(c.tienda)}/${c.caja}" checked> ${esc(c.tienda)} · Caja ${c.caja}</label>`).join('')}</fieldset>
      <label class="check-hist"><input type="checkbox" id="an-hist" ${A.historicas ? 'checked' : ''}> Incluir ventas del POS anterior (históricas)</label>
      <div class="filas"><button class="btn" type="button" id="an-excel">${ico('download')}<span>Exportar esta tabla a Excel</span></button></div>
      <div id="an-msg" class="mensaje" role="status" aria-live="polite"></div>
    </form>
    <div id="an-resultado"></div>`;
  const marcas = () => [...document.querySelectorAll('.an-caja')];
  const seleccion = () => marcas().filter((m) => m.checked).map((m) => m.value);
  const ruta = () => { const f = anFechas(A); const sel2 = seleccion(); return `/api/admin/analisis?agrupar=${A.agrupar}&desde=${f.desde}&hasta=${f.hasta}&cajas=${sel2.join(',')}&historicas=${A.historicas ? 1 : 0}`; };
  const visibilidad = () => {
    $('#an-l-anio').hidden = A.rango !== 'anio'; $('#an-l-mes').hidden = A.rango !== 'mes';
    $('#an-l-desde').hidden = $('#an-l-hasta').hidden = A.rango !== 'personalizado';
    $('#an-l-metrica').hidden = A.agrupar === 'mapa_calor';
  };
  async function consultar() {
    visibilidad();
    const res = $('#an-resultado');
    if (!seleccion().length) { res.innerHTML = '<div class="mensaje error">Seleccione al menos una caja.</div>'; return; }
    let j;
    try { j = (await api(ruta())).analisis; } catch (e) { res.innerHTML = `<div class="mensaje error">${esc(e.message)}</div>`; return; }
    pintarAnalisis(res, j, A.metrica);
  }
  for (const [id, k] of [['an-rango', 'rango'], ['an-anio', 'anio'], ['an-mes', 'mes'], ['an-desde', 'desde'], ['an-hasta', 'hasta'], ['an-agrupar', 'agrupar'], ['an-metrica', 'metrica']]) $(`#${id}`).addEventListener('change', () => { A[k] = $(`#${id}`).value; consultar(); });
  $('#an-hist').addEventListener('change', () => { A.historicas = $('#an-hist').checked; consultar(); });
  $('#an-todas').addEventListener('change', (e) => { marcas().forEach((m) => (m.checked = e.target.checked)); consultar(); });
  marcas().forEach((m) => m.addEventListener('change', () => { $('#an-todas').checked = marcas().every((x) => x.checked); consultar(); }));
  $('#an-excel').addEventListener('click', async () => {
    const m = $('#an-msg'); m.className = 'mensaje'; m.textContent = 'Preparando el Excel…';
    const r = ruta().replace('/analisis?', '/analisis.xlsx?');
    try {
      if (window.__POS_EXPORTAR__) m.textContent = await window.__POS_EXPORTAR__(r, `analisis-de-ventas-${A.agrupar}.xlsx`);
      else { const a = document.createElement('a'); a.href = r; a.download = 'analisis-de-ventas.xlsx'; document.body.appendChild(a); a.click(); a.remove(); m.textContent = 'Descarga iniciada.'; }
      m.className = 'mensaje ok';
    } catch (e) { m.className = 'mensaje error'; m.textContent = `No se pudo exportar: ${e.message}`; }
  });
  await consultar();
}
function pintarAnalisis(el, j, metrica) {
  const r = j.resumen, ag = j.agrupar;
  const kpi = (t, v, nota = '') => `<div class="an-kpi"><span>${esc(t)}</span><b>${esc(v)}</b>${nota ? `<small>${esc(nota)}</small>` : ''}</div>`;
  const NOM = { mes: 'mes', semana: 'semana', dia: 'día', dia_semana: 'día de la semana', hora: 'hora', mapa_calor: 'hora', forma_pago: 'forma de pago', caja: 'caja', tienda: 'tienda' }[ag];
  const kpis = `<div class="an-kpis">${kpi('Total vendido', mxn(r.total), r.fees ? `incluye ${mxn(r.fees)} de fees por daño` : '')}${kpi('Tickets', r.tickets.toLocaleString('es-MX'))}${kpi('Piezas', r.piezas.toLocaleString('es-MX'))}${kpi('Ticket promedio', mxn(r.promedio_ticket))}${kpi('Días con ventas', `${r.dias_con_ventas} de ${r.dias}`)}${j.mejor.por_total ? kpi(`Mejor ${NOM}`, j.mejor.por_total.etiqueta, mxn(j.mejor.por_total.total)) : ''}</div>`;
  const notas = `${j.sin_hora ? `<p class="nota">${j.sin_hora} ticket(s) del POS anterior no traen hora y no entran en esta vista.</p>` : ''}<p class="nota">Los fees por daño suman al total pero no cuentan como ticket; los cambios sin diferencia no cuentan. No incluye tickets cancelados.</p>`;
  if (!r.tickets && !r.fees) { el.innerHTML = `${kpis}<div class="panel"><p class="vacio">No hay ventas en este periodo.</p></div>${notas}`; return; }
  if (ag === 'mapa_calor') {
    const m = j.matriz, max = Math.max(1, ...m.flat());
    const horas = j.filas.map((f) => Number(f.clave));
    const [h0, h1] = [Math.min(...horas), Math.max(...horas)];
    const hs = Array.from({ length: h1 - h0 + 1 }, (_, i) => h0 + i);
    const corto = (c) => (c >= 100000 ? `${Math.round(c / 100000) / 10}k` : String(Math.round(c / 100)));
    el.innerHTML = `${kpis}<section class="panel"><h2 style="margin-top:0">Cuándo se vende más (total por día de la semana y hora)</h2>
      <div class="calor-cont"><table class="calor" id="an-calor"><thead><tr><th></th>${hs.map((h) => `<th>${h}h</th>`).join('')}</tr></thead><tbody>
      ${AN_DIAS.map((d, i) => `<tr><th scope="row">${d}</th>${hs.map((h) => { const c = m[i][h]; return `<td data-v="${c}" style="--i:${(c / max).toFixed(3)}" title="${esc(AN_DIAS[i])} ${h}:00 – ${h + 1}:00 · ${esc(mxn(c))}">${c ? esc(corto(c)) : ''}</td>`; }).join('')}</tr>`).join('')}</tbody></table></div>
      <p class="nota">Más oscuro = se vendió más. Los números son pesos (k = miles). Toque una celda para ver el monto exacto.</p></section>${notas}`;
    return;
  }
  const vals = j.filas.map((f) => anValor(f, metrica)), max = Math.max(1, ...vals);
  const mejorI = vals.indexOf(Math.max(...vals));
  const muchas = j.filas.length > 24;
  const grafica = ['forma_pago', 'caja', 'tienda'].includes(ag) ? '' : `<div class="grafica-cont"><div class="grafica ${muchas ? 'ancha' : ''}" id="an-grafica" role="img" aria-label="Gráfica de barras ${esc(AN_METRICAS.find((x) => x[0] === metrica)[1])} ${esc(NOM)}">${j.filas.map((f, i) => `<div class="gb ${i === mejorI && vals[i] > 0 ? 'mejor' : ''}" title="${esc(f.etiqueta)} · ${esc(anTexto(vals[i], metrica))}"><span class="gb-valor">${muchas || !vals[i] ? '' : esc(anTexto(vals[i], metrica).replace(/\.00$/, ''))}</span><span class="gb-barra" style="height:${((vals[i] / max) * 100).toFixed(1)}%"></span><span class="gb-eti">${esc(anCorto(ag, f))}</span></div>`).join('')}</div></div>`;
  const filas = j.filas.map((f, i) => `<tr class="${i === mejorI && vals[i] > 0 ? 'fila-mejor' : ''}"><td data-etiqueta>${esc(f.etiqueta)}</td><td class="celda-barra"><span class="barra-h" style="width:${((vals[i] / max) * 100).toFixed(1)}%"></span></td><td class="num">${f.tickets}</td><td class="num">${f.piezas}</td><td class="num">${mxn(f.total)}</td><td class="num">${mxn(f.promedio_ticket)}</td><td class="num">${f.promedio_dia == null ? '' : mxn(f.promedio_dia)}</td><td class="num">${f.porcentaje.toFixed(1)}%</td></tr>`).join('');
  el.innerHTML = `${kpis}<section class="panel"><h2 style="margin-top:0">${esc(AN_AGRUP.find((x) => x[0] === ag)[1])} · ${esc(AN_METRICAS.find((x) => x[0] === metrica)[1])}</h2>${grafica}
    <div class="tabla-cont"><table class="tabla-analisis" id="an-tabla"><thead><tr><th>${esc(NOM[0].toUpperCase() + NOM.slice(1))}</th><th>${esc(AN_METRICAS.find((x) => x[0] === metrica)[1])}</th><th class="num">Tickets</th><th class="num">Piezas</th><th class="num">Total</th><th class="num">Ticket prom.</th><th class="num">Prom. por día</th><th class="num">% del total</th></tr></thead><tbody>${filas}
      <tr class="fila-total"><th scope="row">Total</th><td></td><td class="num">${r.tickets}</td><td class="num">${r.piezas}</td><td class="num">${mxn(r.total)}</td><td class="num">${mxn(r.promedio_ticket)}</td><td></td><td class="num">100%</td></tr></tbody></table></div></section>${notas}`;
}

async function vistaTipoCambio() {
  const j = await api('/api/admin/tipo-cambio');
  const v = j.vigente;
  cuerpoVista().innerHTML = `<div class="titulo-vista">${ico('banknote')}<h1>Tipo de cambio del dólar</h1></div>
    <div class="cuadricula">
      <section class="panel"><h2 style="margin-top:0">Vigente</h2>
        <p id="tc-vigente" style="font-size:22px;margin:0">${v ? `<b>$${esc(v.texto)}</b> MXN por USD` : 'Sin definir'}</p>
        <p class="nota">${v ? `Versión ${v.version} · fijada por ${esc(v.usuario)} el ${esc(fechaHora(v.ocurrio_en))}` : 'Hasta fijarlo no se pueden recibir dólares.'}</p>
        <button class="btn btn-primario" id="btn-editar-tc-vista" type="button" style="width:auto">${ico('pencil')}<span>Cambiar tipo de cambio</span></button>
        <p class="nota">Es el tipo de cambio comercial que fija el negocio (no una cotización externa). Se propaga a todas las tiendas conectadas; las desconectadas siguen con su última tasa y se actualizan al reconectar.</p></section>
      <section class="panel"><h2 style="margin-top:0">Quién puede editarlo</h2>
        <form id="form-permiso" autocomplete="off">
          <div class="campo"><label for="perm-usuario">Usuario</label><input id="perm-usuario" class="texto" placeholder="Nombre de usuario"></div>
          <label style="display:flex;gap:8px;align-items:center;margin:8px 0"><input type="checkbox" id="perm-valor" checked> Puede editar el tipo de cambio</label>
          <button class="btn btn-primario" id="btn-permiso" type="submit">${ico('check')}<span>Guardar permiso</span></button>
        </form>
        <div id="msg-permiso" class="mensaje" role="status" aria-live="polite"></div>
        <table id="tabla-permisos" style="margin-top:8px"><thead><tr><th>Usuario</th><th>Puede editar</th></tr></thead><tbody>
        ${j.permisos.map((p) => `<tr data-usuario="${esc(p.usuario)}"><td>${esc(p.usuario)}</td><td>${p.editar_tipo_cambio ? 'Sí' : 'No'}</td></tr>`).join('') || '<tr><td colspan="2" class="vacio">Nadie más tiene el permiso (Administración siempre puede).</td></tr>'}</tbody></table></section>
    </div>
    <section class="panel" style="margin-top:12px"><h2 style="margin-top:0">Historial</h2><div class="tabla-cont"><table id="tabla-tc"><thead><tr><th>Versión</th><th class="num">Tasa</th><th class="num">Anterior</th><th>Cambió</th><th>Fecha y hora</th></tr></thead><tbody>
      ${j.historial.map((h) => `<tr data-version="${h.version}"><td>v${h.version}</td><td class="num">$${esc(h.texto)}</td><td class="num">${h.anterior ? `$${esc(h.anterior.texto)} (v${h.anterior.version})` : '—'}</td><td>${esc(h.usuario)}</td><td>${esc(fechaHora(h.ocurrio_en))}</td></tr>`).join('') || '<tr><td colspan="5" class="vacio">Aún no se ha fijado ningún tipo de cambio.</td></tr>'}</tbody></table></div></section>`;
  $('#btn-editar-tc-vista').addEventListener('click', abrirEditarTc);
  $('#form-permiso').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const m = $('#msg-permiso');
    try { await api('/api/admin/permisos', { usuario: $('#perm-usuario').value, editar_tipo_cambio: $('#perm-valor').checked }); await vistaTipoCambio(); } catch (e) { m.className = 'mensaje error'; m.textContent = e.message; }
  });
}

// ── arranque ──
/** Pantalla de inicio de sesión: la caja elige cajero y teclea su clave; Administración teclea usuario y contraseña. */
function pintarLogin() {
  const admin = S.sesion.rol === 'admin';
  document.querySelectorAll('dialog[open]').forEach((d) => d.close()); // ningún cuadro queda abierto sobre la pantalla de inicio
  S.finInactividad = null; avisoInactividad().hidden = true;
  $('#nav').innerHTML = '';
  $('#tc-barra').innerHTML = '';
  $('#encabezado').innerHTML = admin
    ? `<div class="logos"><img class="logo" src="${logoDe('DUO')}" alt="DÚO New York"><img class="logo" src="${logoDe('LON')}" alt="London Love"></div><div class="titulo">Administración</div><div class="datos"></div>`
    : `<img class="logo" src="${logoDe(S.sesion.tienda)}" alt="Logo de la tienda" data-logo="${esc(S.sesion.tienda)}"><div class="titulo">Punto de venta · Caja ${S.sesion.caja}</div><div class="datos"></div>`;
  $('#pie').innerHTML = '<span>Inicie sesión para continuar</span>';
  const lista = S.sesion.cajeros ?? [];
  $('#vista').innerHTML = `<section class="panel" id="login" style="max-width:420px;margin:40px auto"><div id="marca-pos" style="text-align:center;margin-bottom:14px"><div style="font-size:26px;font-weight:800;letter-spacing:.5px">LonDuo POS</div><div class="nota" style="margin:0">Smart Retail Management</div><div class="nota" id="version-login" style="margin:2px 0 0;font-size:11px">${esc(window.__POS_VERSION__?.texto ?? '')}</div></div><h1 style="margin-top:0">${ico('user')} Iniciar sesión</h1>
    <form id="form-login" autocomplete="off">
      <div class="campo"><label for="lg-usuario">Usuario</label>${!admin && lista.length <= 15 ? `<select id="lg-usuario" style="width:100%;padding:10px;border:2px solid var(--borde);border-radius:10px;background:var(--superficie)">${lista.map((n) => `<option>${esc(n)}</option>`).join('')}</select>` : '<input id="lg-usuario" class="texto" autocomplete="username">'}</div>
      <div class="campo"><label for="lg-clave">${admin ? 'Contraseña' : 'Clave'}</label><input id="lg-clave" type="password" ${admin ? '' : 'inputmode="numeric"'} autocomplete="current-password" placeholder="${admin ? '' : '••••'}"></div>
      <div id="msg-login" class="mensaje" role="alert"></div>
      <button class="btn btn-primario" type="submit" id="lg-entrar">${ico('check')}<span>Entrar</span></button></form></section>`;
  $('#form-login').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    $('#lg-entrar').disabled = true;
    try { await api('/api/login', { usuario: $('#lg-usuario').value, clave: $('#lg-clave').value }); await iniciar(); }
    catch (e) { $('#lg-entrar').disabled = false; $('#lg-clave').value = ''; const m = $('#msg-login'); m.className = 'mensaje error'; m.textContent = e.message; $('#lg-clave').focus(); }
  });
  ($('#lg-usuario') ?? {}).focus?.();
}
document.addEventListener('click', async (ev) => {
  if (!ev.target.closest('#btn-salir')) return;
  try { await api('/api/logout', {}); } catch { /* ya estaba cerrada */ }
  await iniciar();
});
async function iniciar() {
  Object.assign(S, { conRegalo: false, sesion: null, vista: null, cart: null, carrito: null, sel: null, estado: null, ultimoFolio: null, retiroAvisoHasta: 0, retiroEstado: null, conteoLimbo: null });
  S.sesion = await api('/api/sesion');
  S.finInactividad = S.sesion.inactividad ? Date.now() + S.sesion.inactividad.restante_seg * 1000 : null;
  if (S.sesion.requiere_login && !S.sesion.autenticado) return pintarLogin();
  await ir(S.sesion.nav[0]);
}
window.POS_UI = { iniciar, ir };
// ── cierre por inactividad: la pantalla avisa que la persona sigue ahí (latido) y muestra el aviso antes de que se cierre la sesión ──
let actividadPendiente = false;
for (const ev of ['keydown', 'pointerdown', 'wheel', 'mousemove']) document.addEventListener(ev, () => { actividadPendiente = true; }, { passive: true });
const avisoInactividad = () => {
  let a = document.getElementById('aviso-inactividad');
  if (!a) { a = document.createElement('div'); a.id = 'aviso-inactividad'; a.setAttribute('role', 'alert'); a.hidden = true; document.body.appendChild(a); }
  return a;
};
function pintarAvisoInactividad() {
  const a = avisoInactividad();
  const falta = S.finInactividad ? Math.max(0, Math.ceil((S.finInactividad - Date.now()) / 1000)) : null;
  if (falta === null || falta > 60 || !S.sesion?.autenticado) { a.hidden = true; return; }
  a.hidden = false;
  a.innerHTML = `Por inactividad, su sesión se cerrará en <b id="aviso-inact-seg">${falta}</b> s. <button class="btn" type="button" id="btn-seguir">Seguir trabajando</button>`;
  $('#btn-seguir').addEventListener('click', () => { actividadPendiente = true; latido(); });
}
setInterval(() => { if (S.finInactividad) pintarAvisoInactividad(); }, 1000);
async function latido() {
  // Caja sin cajeras registradas: si Administración registra una, la caja pasa sola a pedir usuario y clave.
  if (S.sesion?.rol === 'cajero' && !S.sesion.requiere_login) {
    try { const r = await api('/api/sesion?pasivo=1'); if (r.requiere_login) await iniciar(); } catch { /* sin respuesta: se reintenta */ }
    return;
  }
  if (!S.sesion?.requiere_login || !S.sesion.autenticado) { avisoInactividad().hidden = true; return; }
  try {
    const r = actividadPendiente ? await api('/api/actividad', {}) : await api('/api/sesion?pasivo=1');
    actividadPendiente = false;
    S.sesion.autenticado = r.autenticado;
    S.finInactividad = r.inactividad ? Date.now() + r.inactividad.restante_seg * 1000 : null;
    pintarAvisoInactividad();
    if (!r.autenticado) await iniciar(); // la sesión se cerró por inactividad: de vuelta al inicio de sesión
  } catch { /* sin conexión con el servicio: se reintenta en el siguiente ciclo */ }
}
setInterval(latido, 5000);
setInterval(async () => {
  if (!S.sesion || (S.sesion.requiere_login && !S.sesion.autenticado) || $('#dlg-ticket').open || $('#dlg-tc').open) return;
  pintarEncabezado().catch(() => {});
  // Si hay una tasa nueva mientras se cobra en dólares, se avisa (el cobro conserva la suya).
  if (S.vista === 'venta' && S.usdAbierto && S.cart && S.sesion.rol === 'cajero') {
    try { S.tasa = await api('/api/venta/tasa', { cart: S.cart, pasivo: true }); pintarInfoTasa(); recalcular(); } catch { /* sin cambios */ }
  }
}, 5000);
iniciarAvisosFlotantes();
iniciarCamposObligatorios();
// Con el botón COBRAR encendido, Enter cobra (solo desde los campos de pago o sin ningún campo enfocado: nunca desde el escáner ni un botón).
document.addEventListener('keydown', (ev) => {
  if (ev.key !== 'Enter' || ev.isComposing || ev.repeat || S.vista !== 'venta' || document.querySelector('dialog[open]')) return;
  const t = ev.target;
  if (t instanceof HTMLElement && t !== document.body) {
    const campoDePago = t.tagName === 'INPUT' && (t.id === 'recibido' || t.id === 'usd' || t.id.startsWith('tj-'));
    if (!campoDePago) return;
  }
  const b = $('#btn-cobrar');
  if (!b || b.disabled) return;
  ev.preventDefault();
  b.click();
});
// Ctrl + F8 = botón «Abrir caja» (con su aviso, motivo y clave de siempre). Solo en la pantalla de venta y sin otro diálogo abierto.
document.addEventListener('keydown', (ev) => {
  if (ev.key !== 'F8' || !ev.ctrlKey || ev.repeat || S.vista !== 'venta' || document.querySelector('dialog[open]')) return;
  const b = $('#btn-abrir-caja');
  if (!b || b.disabled) return;
  ev.preventDefault();
  b.click();
});
if (!window.__POS_MANUAL__) iniciar();
