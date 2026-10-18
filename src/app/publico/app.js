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
  if (!j.ok) { const e = new Error(j.error?.mensaje ?? 'Error'); e.codigo = j.error?.codigo; e.detalle = j.error?.detalle; throw e; }
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
  gear: '<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9 7 7M17 17l2.1 2.1M19.1 4.9 17 7M7 17l-2.1 2.1"/>',
  barcode: '<path d="M4 5v14M7 5v14M11 5v14M14 5v14M18 5v14M20.5 5v14"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  pencil: '<path d="M4 20h4L19 9a2.8 2.8 0 0 0-4-4L4 16z"/><path d="m13.5 6.5 4 4"/>',
  trash: '<path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 11v6M14 11v6"/>',
  undo: '<path d="M9 14 4 9l5-5"/><path d="M4 9h10a6 6 0 0 1 0 12h-3"/>',
  percent: '<path d="M19 5 5 19"/><circle cx="7" cy="7" r="2.3"/><circle cx="17" cy="17" r="2.3"/>',
  pause: '<path d="M9 5v14M15 5v14"/>',
  store: '<path d="M3 9l1.5-5h15L21 9"/><path d="M3 9a3 3 0 0 0 6 0 3 3 0 0 0 6 0 3 3 0 0 0 6 0"/><path d="M5 12v8h14v-8M10 20v-5h4v5"/>',
  caja: '<rect x="5" y="3" width="14" height="6" rx="1"/><path d="M3 21v-7a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v7zM8 16h.01M12 16h.01M16 16h.01"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
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

// ── barra superior y pie ──
async function pintarEncabezado() {
  const h = $('#encabezado');
  const pie = $('#pie');
  if (S.sesion.rol === 'admin') {
    h.innerHTML = `<div class="logos"><img class="logo" src="${logoDe('DUO')}" alt="DÚO New York"><img class="logo" src="${logoDe('LON')}" alt="London Love"></div>
      <div class="titulo">Administración</div>
      <div class="datos"><span class="chip-top" data-chip="usuario">${ico('user')}<span>Usuario: <b>${esc(S.sesion.usuario)}</b></span></span><span class="chip-top" data-chip="rol">${ico('gear')}<b>Administración</b></span>
      <span class="chip-top" data-chip="alcance">${ico('store')}<span>Una, varias o todas las cajas</span></span></div>`;
    pie.innerHTML = `<span>Usuario: ${esc(S.sesion.usuario)}</span><span>Administración · consolida cajas y tiendas</span><span>Precios en MXN</span>`;
    await pintarTipoCambio();
    return;
  }
  const { estado: e } = await api('/api/estado');
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
      <span class="chip-top" data-chip="usuario">${ico('user')}<span>Cajero(a): <b>${esc(e.usuario)}</b></span></span>
      <span class="sincro ${sincro[0]}" data-chip="sincro">${sincro[1]}</span>
      <span class="chip-top" data-chip="fecha">${ico('calendar')}<b>${fechaCorta(e.ahora)}</b></span>
    </div>
    ${e.alertas.perdida_documental_abierta ? `<div class="alerta-banda" style="flex-basis:100%;margin:0" role="alert" data-alerta="perdida">Hay una posible pérdida de ventas, pagos o folios de esta caja sin resolver (Administración).</div>` : ''}
    ${e.alertas.articulos_no_verificados ? `<div class="alerta-banda" style="flex-basis:100%;margin:0" role="status" data-alerta="inventario">Existencias sin verificar: ${e.alertas.articulos_no_verificados} artículos (requieren conteo físico).</div>` : ''}`;
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
  if (f) f.textContent = folioTexto();
}
const folioTexto = () => (S.ultimoFolio ? `Folio ${String(S.ultimoFolio).padStart(6, '0')}` : 'Venta en curso · folio al cobrar');

// ── navegación ──
const NAV = {
  venta: ['Venta', 'cart'], ventas: ['Historial', 'clock'], creditos: ['Créditos', 'card'], corte: ['Corte de caja', 'chart'],
  tarjetas: ['Tarjetas de regalo', 'gift'], reportes: ['Reportes', 'chart'], cortes: ['Cortes', 'cash'], dolares: ['Dólares recibidos', 'dollar'], inventario: ['Inventario', 'box'], departamentos: ['Departamentos', 'box'], tipo_cambio: ['Tipo de cambio', 'refresh'],
};
function pintarNav() {
  const items = S.sesion.rol === 'cajero' ? S.sesion.nav.flatMap((v) => (v === 'ventas' ? [v, 'creditos'] : [v])) : S.sesion.nav;
  $('#nav').innerHTML = items.map((v) => v === 'creditos'
    ? `<button type="button" data-proximamente="creditos" disabled title="Próximamente" aria-label="Créditos (próximamente)">${ico(NAV[v][1])}<span>${NAV[v][0]}</span></button>`
    : `<button type="button" data-vista="${v}" title="${NAV[v][0]}" ${v === S.vista ? 'aria-current="page"' : ''}>${ico(NAV[v][1])}<span>${NAV[v][0]}</span></button>`).join('');
  for (const b of $('#nav').querySelectorAll('button[data-vista]')) b.addEventListener('click', () => ir(b.dataset.vista));
}
async function ir(v) {
  S.vista = v;
  pintarNav();
  await pintarEncabezado();
  await ({ venta: vistaVenta, corte: vistaCorte, ventas: vistaVentas, reportes: vistaReportes, inventario: vistaInventario, departamentos: vistaDepartamentos, tarjetas: vistaTarjetas, devolucion: vistaDevolucion, dolares: vistaDolares, tipo_cambio: vistaTipoCambio, cortes: vistaCortes })[v]();
}

// ── venta ──
function msg(texto, tipo = 'ok') { const m = $('#mensaje'); if (m) { m.className = `mensaje ${tipo}`; m.textContent = texto; } }

async function vistaVenta() {
  if (!S.cart) { const r = await api('/api/venta/actual', {}); S.cart = r.cart; S.carrito = r.carrito; }
  const metodos = S.estado?.metodos ?? ['efectivo'];
  S.forma = 'efectivo'; S.tarjeta = null; S.usdAbierto = false; S.tasa = null;
  $('#vista').innerHTML = `
    <h1>Nueva venta</h1>
    <div class="folio-linea" id="folio-linea" data-chip="folio"><b>${esc(folioTexto())}</b></div>
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
            ${pronto('btn-nuevo-articulo', 'plus', 'Nuevo artículo', 'btn-acento')}
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
            <span class="acciones">${pronto('btn-editar-venta', 'pencil', 'Editar en esta venta', 'btn-acento')}${pronto('btn-editar-catalogo', 'pencil', 'Editar catálogo', 'btn-acento')}
            <button class="btn btn-peligro" id="btn-quitar" type="button">${ico('trash')}<span>Quitar artículo</span></button></span></div>
        </section>
        <div class="acciones-inf" id="acciones-inf">
          <button class="btn" id="btn-buscar-ticket" type="button" title="Abre el historial de ventas de esta caja">${ico('search')}<span>Buscar ticket</span></button>
          <button class="btn" id="btn-devolucion" type="button" title="Buscar la venta y devolver (solo en la caja donde se vendió)">${ico('undo')}<span>Cambio o devolución</span></button>${pronto('btn-descuento', 'percent', 'Aplicar descuento')}${pronto('btn-espera', 'pause', 'Venta en espera')}
        </div>
      </div>
      <aside class="panel resumen" aria-label="Resumen y cobro">
        <h2>Resumen de venta</h2>
        <p class="nota" style="margin:0 0 10px"><span id="piezas">0</span> pieza(s)</p>
        <dl>
          <dt>Importe</dt><dd id="brutas">$0.00</dd>
          <dt>Descuentos</dt><dd id="descuentos">$0.00</dd>
        </dl>
        <div class="total"><span>TOTAL</span><b id="total">$0.00</b></div>
        <div class="mxn">MXN</div>
        <strong>Forma de pago</strong>
        <div class="formas" id="formas" role="group" aria-label="Forma de pago">
          <button class="btn forma" type="button" data-forma="efectivo" aria-pressed="true">${ico('cash', 'ico-lg')}<span>Efectivo</span></button>
          <button class="btn forma" type="button" data-forma="tarjeta" disabled title="${metodos.includes('tarjeta') ? 'Próximamente' : 'Esta caja no tiene terminal bancaria'}" aria-label="Tarjeta (${metodos.includes('tarjeta') ? 'próximamente' : 'no disponible en esta caja'})">${ico('card', 'ico-lg')}<span>Tarjeta</span></button>
          <button class="btn forma" type="button" data-forma="mixto" disabled title="Próximamente" aria-label="Mixto (próximamente)">${ico('mixto', 'ico-lg')}<span>Mixto</span></button>
          <button class="btn forma" type="button" data-forma="regalo" aria-pressed="false" ${metodos.includes('tarjeta_regalo') ? '' : `disabled title="Esta caja no maneja tarjetas de regalo"`}>${ico('gift', 'ico-lg')}<span>Tarjeta de regalo</span></button>
        </div>
        <div id="pago"></div>
        <button class="btn btn-primario" id="btn-cobrar" type="button" disabled><span id="txt-cobrar">COBRAR $0.00</span>${ico('chevron')}</button>
        <div class="aux">${pronto('btn-regalo', 'gift', 'Ticket de regalo')}</div>
      </aside>
    </div>`;
  $('#escaneo').addEventListener('submit', async (ev) => { ev.preventDefault(); await escanear(); });
  $('#btn-cobrar').addEventListener('click', cobrar);
  $('#btn-quitar').addEventListener('click', () => S.sel && accionLinea(S.sel, 'quitar'));
  $('#btn-buscar-ticket').addEventListener('click', () => ir('ventas'));
  $('#btn-devolucion').addEventListener('click', () => ir('devolucion'));
  for (const b of $('#formas').querySelectorAll('button[data-forma]:not(:disabled)')) b.addEventListener('click', () => elegirForma(b.dataset.forma));
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
  $(f === 'regalo' ? '#codigo-regalo' : '#recibido').focus();
}

/** Efectivo: pesos y, si se pide, dólares. El cajero solo captura lo recibido; el POS calcula equivalente, faltante y cambio en MXN. */
function htmlEfectivo(etiquetaPesos) {
  return `<div class="campo"><label for="recibido" id="lbl-recibido">${etiquetaPesos}</label>
      <input id="recibido" inputmode="decimal" autocomplete="off" placeholder="0.00"></div>
    <button class="btn" id="btn-usd" type="button" style="width:100%;margin-bottom:8px">${ico('dollar')}<span>Agregar dólares USD</span></button>
    <div id="bloque-usd" hidden>
      <div class="campo"><label for="usd">Dólares recibidos (USD)</label><input id="usd" inputmode="decimal" autocomplete="off" placeholder="0.00"></div>
      <div id="msg-usd" class="mensaje error" role="alert"></div>
      <div class="saldo-tarjeta" id="info-tasa" role="status" aria-live="polite"></div>
      <div id="aviso-sin-verificar" class="mensaje aviso" role="status" hidden></div>
      <button class="btn" id="btn-rechazar-billete" type="button" style="width:100%;margin-bottom:8px;font-size:13px">${ico('x')}<span>Rechazar un billete (dañado o sospechoso)</span></button>
      <button class="btn" id="btn-tasa-nueva" type="button" hidden style="width:100%;margin-bottom:8px">${ico('refresh')}<span>Usar la tasa vigente</span></button>
      <div id="aviso-cambio" class="mensaje aviso" role="status" hidden></div>
      <dl class="calc-usd"><dt>Equivalente de los USD</dt><dd id="usd-equivalente">$0.00</dd><dt>Total recibido equivalente</dt><dd id="total-recibido">$0.00</dd></dl>
    </div>
    <div class="cambio" id="linea-cambio"><span id="lbl-cambio">Cambio</span><b id="cambio">$0.00</b></div>`;
}
function engancharEfectivo() {
  $('#recibido').addEventListener('input', recalcular);
  $('#usd').addEventListener('input', recalcular);
  $('#btn-usd').addEventListener('click', () => (S.usdAbierto ? cerrarUsd() : abrirUsd()));
  $('#btn-tasa-nueva').addEventListener('click', () => abrirUsd(true));
  $('#btn-rechazar-billete').addEventListener('click', abrirRechazoBillete);
}
async function abrirUsd(renovar = false) {
  try {
    S.tasa = await api('/api/venta/tasa', { cart: S.cart, renovar });
    S.usdAbierto = true;
    $('#bloque-usd').hidden = false;
    $('#lbl-recibido').textContent = S.forma === 'regalo' ? 'Pesos recibidos para el resto (MXN)' : 'Pesos recibidos (MXN)';
    $('#btn-usd').innerHTML = `${ico('x')}<span>Quitar dólares USD</span>`;
    pintarInfoTasa();
    recalcular();
    if (!renovar) $('#usd').focus();
  } catch (e) { msg(e.message, 'error'); }
}
function cerrarUsd() {
  S.usdAbierto = false;
  $('#bloque-usd').hidden = true;
  $('#usd').value = '';
  $('#lbl-recibido').textContent = S.forma === 'regalo' ? 'Efectivo recibido para el resto (MXN)' : 'Efectivo recibido (MXN)';
  $('#btn-usd').innerHTML = `${ico('dollar')}<span>Agregar dólares USD</span>`;
  recalcular();
}
function pintarInfoTasa() {
  const t = S.tasa;
  if (!t || !$('#info-tasa')) return;
  const sv = S.estado?.tipo_cambio?.sin_verificar;
  const av = $('#aviso-sin-verificar');
  if (av) { av.hidden = !sv || sv.nivel === 'ok'; if (sv && sv.nivel !== 'ok') av.textContent = `La tasa lleva ${sv.horas} h sin verificarse contra el central${sv.bloquear_usd_horas ? ` (a las ${sv.bloquear_usd_horas} h ya no se reciben dólares)` : ''}. Los cobros en pesos no se afectan.`; }
  $('#info-tasa').innerHTML = `Tasa de este cobro: <b id="tasa-aplicada">$${esc(t.bloqueada.texto)} MXN por USD</b> (v${t.bloqueada.version})${t.hay_nueva ? `<br><span id="aviso-tasa-nueva" style="color:var(--aviso)">La tasa vigente cambió a $${esc(t.vigente.texto)} (v${t.vigente.version}). Este cobro conserva la que tenía.</span>` : ''}`;
  $('#btn-tasa-nueva').hidden = !t.hay_nueva;
}
function pintarPago() {
  const p = $('#pago');
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
      <button class="btn" id="btn-exacto" type="button" style="width:100%;margin-bottom:10px" disabled>${ico('check')}<span>Cliente paga exacto</span></button>`;
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

function pintarCarrito() {
  const c = S.carrito;
  $('#piezas').textContent = c.piezas;
  $('#brutas').textContent = mxn(c.ventas_brutas);
  $('#descuentos').textContent = c.descuentos ? `-${mxn(c.descuentos)}` : mxn(0);
  $('#total').textContent = mxn(c.total);
  const cuerpo = $('#cuerpo');
  if (!c.lineas.length) {
    cuerpo.innerHTML = `<tr><td colspan="11" class="vacio">Escanee un artículo para comenzar la venta.</td></tr>`;
  } else {
    cuerpo.innerHTML = c.lineas.map((l) => `
      <tr data-linea="${l.linea_id}" aria-selected="${S.sel === l.linea_id}">
        <td data-col="item_no">${esc(l.item_no ?? 'pendiente')}</td><td data-col="codigo">${esc(l.codigo)}</td><td class="desc" data-col="descripcion">${esc(l.descripcion)}</td>
        <td data-col="marca">${esc(l.marca)}</td><td data-col="estilo">${esc(l.estilo)}</td><td data-col="lote">${esc(l.lote)}</td>
        <td class="num" data-col="cantidad"><span class="qty"><button class="btn" type="button" data-accion="menos" aria-label="Quitar una pieza de ${esc(l.descripcion)}" ${l.qty <= 1 ? 'disabled' : ''}>−</button><b>${l.qty}</b><button class="btn" type="button" data-accion="mas" aria-label="Agregar una pieza de ${esc(l.descripcion)}">+</button></span></td>
        <td class="num" data-col="precio">${mxn(l.precio_unit)}</td><td class="num" data-col="descuento">${l.descuento ? `-${mxn(l.descuento)}` : mxn(0)}</td><td class="num" data-col="importe"><b>${mxn(l.importe)}</b></td>
        <td><button class="btn btn-icono" type="button" data-accion="quitar" aria-label="Quitar ${esc(l.descripcion)} de la venta" title="Quitar de la venta">${ico('x')}</button></td>
      </tr>`).join('');
  }
  for (const tr of cuerpo.querySelectorAll('tr[data-linea]')) {
    tr.addEventListener('click', (ev) => {
      const id = tr.dataset.linea;
      const a = ev.target.closest('button')?.dataset.accion;
      if (a) return void accionLinea(id, a);
      S.sel = id;
      pintarCarrito();
    });
  }
  const l = c.lineas.find((x) => x.linea_id === S.sel);
  $('#detalle-card').hidden = !l;
  if (l) {
    $('#detalle-titulo').textContent = [l.descripcion, l.marca].filter(Boolean).join(' · ');
    $('#detalle-sub').textContent = `Departamento: ${l.departamento}`;
    $('#detalle').innerHTML = `<div><dt>Departamento</dt><dd>${esc(l.departamento)}</dd></div><div><dt>Item #</dt><dd>${esc(l.item_no ?? 'pendiente')}</dd></div><div><dt>Código</dt><dd>${esc(l.codigo)}</dd></div><div><dt>Marca</dt><dd>${esc(l.marca)}</dd></div><div><dt>Estilo</dt><dd>${esc(l.estilo)}</dd></div><div><dt>Lote</dt><dd>${esc(l.lote)}</dd></div>`;
    const ex = c.existencias?.[l.item_id];
    $('#existencias').innerHTML = `<span class="chip-stock propia" data-existencia="tienda">${ico('store')}Esta tienda: ${ex ? `${ex.saldo}${ex.verificada ? '' : ' (sin verificar)'}` : 'sin dato'}</span><span class="chip-stock" data-existencia="otras" title="La existencia de otras tiendas y del almacén se muestra en una etapa posterior">${ico('box')}Otras tiendas y almacén: sin dato</span>`;
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
  const valido = pesos !== null && usdC !== null && billetes && (usdC === 0 || !!S.tasa);
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
  if (S.forma === 'regalo') {
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
    ok = hay && c.ok;
    pintarCambio(total, c);
    if ($('#btn-exacto')) $('#btn-exacto').disabled = !hay;
  }
  $('#btn-cobrar').disabled = !ok;
  $('#txt-cobrar').textContent = `COBRAR ${mxn(total)}`;
}

async function escanear() {
  const inp = $('#scan');
  const texto = inp.value;
  if (!texto.trim()) return;
  inp.value = '';
  $('#resultados').innerHTML = '';
  try {
    const r = await api('/api/venta/escanear', { cart: S.cart, codigo: texto });
    S.carrito = r.carrito;
    if (r.resultado === 'agregado' || r.resultado === 'cantidad_incrementada') {
      S.sel = r.linea.linea_id;
      msg(`${r.resultado === 'agregado' ? 'Agregado' : 'Cantidad actualizada'}: ${r.linea.descripcion} ${r.linea.marca} · ${r.linea.qty} pza.`);
      pintarCarrito();
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

async function buscarTexto(texto) {
  const { resultados, total } = await api(`/api/buscar?q=${encodeURIComponent(texto)}`);
  if (!resultados.length) return msg(`No se encontró «${texto}» por código, Item # ni texto.`, 'error');
  msg(total > resultados.length ? `${total} resultados para «${texto}»; se muestran los primeros ${resultados.length}. Escriba más texto para acotar.` : `${total} resultado(s) para «${texto}». Elija el artículo.`, 'aviso');
  $('#resultados').innerHTML = `<div class="tabla-cont"><table class="tabla-resultados"><thead><tr><th>Item #</th><th>Código</th><th>Descripción</th><th>Marca</th><th>Estilo</th><th>Lote</th><th>Departamento</th><th class="num">Precio</th><th class="num">Existencia</th><th></th></tr></thead><tbody>${resultados.map((r) => `
    <tr data-item="${r.item_id}"><td>${esc(r.item_no ?? 'pendiente')}</td><td>${r.codigo ? esc(r.codigo) : '<em>(sin código)</em>'}${r.codigo_alterno ? `<br><small>alterno ${esc(r.codigo_alterno)}</small>` : ''}</td><td>${esc(r.descripcion)}</td><td>${esc(r.marca)}</td><td>${esc(r.estilo)}</td><td>${esc(r.lote)}</td><td>${esc(r.departamento)}</td><td class="num">${mxn(r.precio)}</td>
    <td class="num">${r.existencia}${r.existencia_verificada ? '' : ' (sin verificar)'}</td>
    <td>${!r.precio_valido ? '<span class="insignia cancelada" title="Precio en el catálogo: corregirlo antes de vender">Precio no vendible</span>' : `${r.duplicado ? '<span class="insignia" title="Código duplicado: la venta queda marcada para revisión">Código duplicado</span> ' : ''}<button class="btn" type="button" data-agregar="${r.item_id}">${ico('plus')}<span>Agregar</span></button>`}</td></tr>`).join('')}</tbody></table></div>`;
  engancharAgregar();
}
function engancharAgregar() {
  for (const b of $('#resultados').querySelectorAll('[data-agregar]')) {
    b.addEventListener('click', async () => {
      try {
        const r = await api('/api/venta/agregar', { cart: S.cart, item_id: b.dataset.agregar });
        S.carrito = r.carrito; S.sel = r.linea.linea_id; $('#resultados').innerHTML = '';
        msg(`Agregado: ${r.linea.descripcion} ${r.linea.marca}`.trim() + (r.linea.ambiguo ? ' (código duplicado: queda marcado para revisión)' : '')); pintarCarrito();
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
    if (S.forma === 'regalo') {
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
  } catch (e) { msg(e.message, 'error'); recalcular(); }
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
    <pre class="ticket" id="ticket-texto" tabindex="0">${esc(r.ticket_texto)}</pre>
    <div class="filas"><button class="btn" id="btn-reimprimir" type="button">${ico('printer')}<span>${imp.ok ? 'Reimprimir ticket' : 'Reintentar impresión'}</span></button><button class="btn btn-primario" id="btn-nueva" type="button" style="width:auto;flex:1">${ico('plus')}<span>Nueva venta</span></button></div>`;
  dlg.showModal();
  $('#btn-reimprimir').addEventListener('click', async () => {
    try {
      const x = await api('/api/venta/reimprimir', { sale_id: r.venta.sale_id });
      $('#ticket-texto').textContent = x.ticket_texto;
      const e = $('#estado-impresion');
      e.className = `mensaje ${x.impresion.ok ? 'ok' : 'error'}`;
      e.textContent = x.impresion.ok ? 'Ticket enviado a la impresora (reimpresión).' : `La impresora falló: ${x.impresion.error}.`;
    } catch (err) { $('#estado-impresion').textContent = err.message; }
  });
  $('#btn-nueva').addEventListener('click', async () => {
    dlg.close();
    const n = await api('/api/venta/nueva', {});
    S.cart = n.cart; S.carrito = n.carrito; S.sel = null;
    await ir('venta');
  });
}

// ── corte ──
const FILAS_CORTE = [
  ['tickets', 'Tickets', (v) => v], ['ventas_brutas', 'Mercancía antes de descuentos', mxn], ['descuentos', 'Descuentos', mxn], ['ventas_mercancia', 'Ventas de mercancía', mxn],
  ['tarjetas_regalo_vendidas', 'Tarjetas de regalo vendidas o recargadas (no son ventas de mercancía)', mxn], ['ventas', 'Total de tickets de venta', mxn],
  ['devoluciones', 'Devoluciones', mxn], ['devoluciones_en_efectivo', 'Devoluciones en efectivo', mxn], ['devoluciones_a_tarjeta_regalo', 'Devoluciones a tarjeta de regalo', mxn], ['ventas_netas', 'Ventas netas de mercancía', mxn], ['cobros_efectivo', 'Cobros en efectivo (MXN)', mxn], ['cobros_efectivo_usd', 'Cobros en efectivo con dólares (MXN que liquidan)', mxn], ['devoluciones_a_tarjeta', 'Reversos a tarjeta bancaria (no sale efectivo)', mxn], ['cobros_tarjeta', 'Cobros con tarjeta bancaria', mxn], ['cobros_tarjeta_regalo', 'Cobros con tarjeta de regalo', mxn],
  ['fondo_inicial', 'Fondo inicial en pesos', mxn], ['entradas', 'Entradas en pesos', mxn], ['retiros', 'Retiros en pesos', mxn], ['pesos_recibidos_con_usd', 'Pesos recibidos junto con dólares', mxn], ['cambio_mxn_con_usd', 'Cambio entregado en pesos por cobros con dólares', mxn],
  ['efectivo_esperado', 'EFECTIVO MXN esperado en el cajón (pesos físicos)', mxn],
  ['fondo_inicial_usd', 'Fondo inicial en dólares', usd], ['usd_recibidos', 'Dólares recibidos en cobros', usd], ['entradas_usd', 'Entradas en dólares', usd], ['retiros_usd', 'Retiros en dólares', usd],
  ['efectivo_usd_esperado', 'EFECTIVO USD esperado en el cajón (dólares físicos)', usd],
  ['usd_equivalente_mxn_historico', 'Equivalente en MXN de los dólares recibidos (tasa de cada operación)', mxn],
  ['conteo_usd', 'Dólares contados (último conteo del día)', (v) => (v ? usd(v.contado) : '—')], ['diferencia_usd', 'Diferencia de dólares (contado − esperado)', (v) => (v === null ? '—' : (v < 0 ? '-' : '') + usd(Math.abs(v)))],
  ['conteo_mxn', 'Pesos contados (último conteo del día)', (v) => (v ? mxn(v.contado) : '—')], ['diferencia_mxn', 'Diferencia de pesos (contado − esperado)', (v) => (v === null ? '—' : mxn(v))],
  ['ventas_anuladas_antes_de_cobro', 'Ventas anuladas antes de recibir dinero (sin movimiento físico)', (v) => v], ['cancelaciones_posteriores_al_cobro', 'Ventas canceladas después de recibir efectivo (el cobro queda y se suma la salida)', (v) => v], ['billetes_usd_rechazados', 'Billetes en dólares rechazados (dañados o sospechosos)', (v) => v],
  ['folio_inicial', 'Folio inicial (ventas y devoluciones)', (v) => (v ?? '—')], ['folio_final', 'Folio final', (v) => (v ?? '—')], ['tickets_cancelados', 'Tickets cancelados', (v) => v],
];
// Dólares: se cuentan billetes (la clave es el valor en DÓLARES y el importe se calcula en centavos). Pesos: la clave son centavos.
const DENOM_USD = [100, 50, 20, 10, 5, 2, 1];
const DENOM_MXN = [100000, 50000, 20000, 10000, 5000, 2000, 1000, 500, 200, 100, 50];
function panelConteo(moneda, esperado) {
  const usdM = moneda === 'USD';
  const filas = (usdM ? DENOM_USD : DENOM_MXN).map((d) => ({ clave: d, unidad: usdM ? d * 100 : d, etiqueta: usdM ? `US$${d}` : mxn(d) }));
  return `<section class="panel" aria-label="Conteo de ${usdM ? 'dólares' : 'pesos'}">
    <h2 style="margin-top:0">${ico(usdM ? 'dollar' : 'cash')} Conteo de ${usdM ? 'dólares' : 'pesos'}</h2>
    <form id="form-conteo-${moneda}" autocomplete="off">
      <div class="tabla-cont"><table><thead><tr><th>${usdM ? 'Billete' : 'Billete o moneda'}</th><th class="num">Cantidad</th><th class="num">Importe</th></tr></thead><tbody>
      ${filas.map((f) => `<tr><th scope="row">${f.etiqueta}</th><td class="num"><input type="number" min="0" step="1" value="0" data-conteo="${moneda}" data-clave="${f.clave}" data-unidad="${f.unidad}" style="width:72px;text-align:right;padding:4px;border:1px solid var(--borde);border-radius:6px;background:var(--superficie)" aria-label="${usdM ? 'Billetes' : 'Piezas'} de ${f.etiqueta}"></td><td class="num" data-importe-${moneda}="${f.unidad}">${usdM ? 'US$0.00' : '$0.00'}</td></tr>`).join('')}
      </tbody></table></div>
      <p style="margin:8px 0">Total contado: <b id="conteo-total-${moneda}">${usdM ? 'US$0.00' : '$0.00'}</b> · esperado: <b>${usdM ? usd(esperado) : mxn(esperado)}</b></p>
      <button class="btn btn-primario" id="btn-conteo-${moneda}" type="submit">${ico('check')}<span>Guardar conteo de ${usdM ? 'dólares' : 'pesos'}</span></button>
    </form>
    <div id="msg-conteo-${moneda}" class="mensaje" role="status" aria-live="polite"></div>
  </section>`;
}
async function vistaCorte() {
  const j = await api('/api/corte');
  const v = j.vivo;
  $('#vista').innerHTML = `
    <div class="titulo-vista">${ico('chart')}<h1>Corte de la caja ${v.caja} — ${esc(v.tienda)} · ${esc(v.fecha)}</h1></div>
    ${v.perdida_documental_abierta.length ? '<div class="mensaje error" data-alerta="perdida-corte">Este corte puede estar incompleto: hay una posible pérdida de ventas, pagos o folios de esta caja sin resolver.</div>' : ''}
    <div class="panel"><table id="tabla-corte"><tbody>${FILAS_CORTE.map(([k, t, f]) => `<tr data-campo="${k}"><th scope="row">${t}</th><td class="num">${f(v[k])}</td></tr>`).join('')}</tbody></table>
    <p class="nota">Corte en vivo: se calcula con las ventas de ESTA caja. Pesos y dólares se concilian por separado: los dólares recibidos suben los dólares físicos y el cambio entregado en pesos baja los pesos físicos (no es descuento ni reembolso). El efectivo de las ventas cuenta lo aplicado, no lo recibido.</p>
    <div id="estado-corte">${j.cerrado ? `<div class="mensaje ${j.desactualizado ? 'aviso' : 'ok'}">Corte cerrado${j.desactualizado ? ': hay operaciones posteriores al cierre (no se reescribe el corte cerrado).' : '.'}</div>` : ''}</div>
    <button class="btn" id="btn-cerrar-corte" type="button" ${j.cerrado ? 'disabled' : ''}>${ico('check')}<span>Cerrar corte del día</span></button></div>
    <div class="cuadricula" style="margin-top:12px">
      ${panelConteo('USD', v.efectivo_usd_esperado)}
      ${panelConteo('MXN', v.efectivo_esperado)}
      <section class="panel" aria-label="Movimientos de efectivo">
        <h2 style="margin-top:0">${ico('cash')} Movimientos de efectivo</h2>
        <form id="form-movimiento" autocomplete="off">
          <div class="campo"><label for="mov-tipo">Movimiento</label><select id="mov-tipo" style="width:100%;padding:8px;border:1px solid var(--borde);border-radius:8px;background:var(--superficie)"><option value="fondo_inicial">Fondo inicial</option><option value="entrada">Entrada</option><option value="retiro">Retiro</option></select></div>
          <div class="campo"><label for="mov-moneda">Moneda</label><select id="mov-moneda" style="width:100%;padding:8px;border:1px solid var(--borde);border-radius:8px;background:var(--superficie)"><option value="MXN">Pesos (MXN)</option><option value="USD">Dólares (USD)</option></select></div>
          <div class="campo"><label for="mov-monto">Monto</label><input id="mov-monto" inputmode="decimal" placeholder="0.00"></div>
          <button class="btn btn-primario" id="btn-movimiento" type="submit">${ico('plus')}<span>Registrar movimiento</span></button>
        </form>
        <div id="msg-mov" class="mensaje" role="status" aria-live="polite"></div>
      </section>
    </div>`;
  $('#btn-cerrar-corte').addEventListener('click', async () => { await api('/api/corte/cerrar', {}); await vistaCorte(); });
  for (const moneda of ['USD', 'MXN']) {
    const fmt = moneda === 'USD' ? usd : mxn;
    const campos = () => [...document.querySelectorAll(`[data-conteo="${moneda}"]`)];
    const totalConteo = () => campos().reduce((acc, i) => {
      const unidad = Number(i.dataset.unidad);
      const n = Number(i.value) || 0;
      $(`[data-importe-${moneda}="${unidad}"]`).textContent = fmt(unidad * n);
      return acc + unidad * n;
    }, 0);
    for (const i of campos()) i.addEventListener('input', () => { $(`#conteo-total-${moneda}`).textContent = fmt(totalConteo()); });
    $(`#form-conteo-${moneda}`).addEventListener('submit', async (ev) => {
      ev.preventDefault();
      const d = {};
      for (const i of campos()) if (Number(i.value) > 0) d[i.dataset.clave] = Number(i.value);
      const m = $(`#msg-conteo-${moneda}`);
      try { await api('/api/efectivo/conteo', { moneda, denominaciones: d }); await vistaCorte(); } catch (e) { m.className = 'mensaje error'; m.textContent = e.message; }
    });
  }
  $('#form-movimiento').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const m = $('#msg-mov');
    const monto = parseMXN($('#mov-monto').value);
    if (monto === null || monto <= 0) { m.className = 'mensaje error'; m.textContent = 'Escriba un monto válido (por ejemplo 500 o 500.00).'; return; }
    try { await api('/api/efectivo/movimiento', { tipo: $('#mov-tipo').value, moneda: $('#mov-moneda').value, monto }); await vistaCorte(); } catch (e) { m.className = 'mensaje error'; m.textContent = e.message; }
  });
}

// ── ventas de la caja ──
async function vistaVentas() {
  const j = await api('/api/ventas');
  $('#vista').innerHTML = `<div class="titulo-vista">${ico('clock')}<h1>Historial de mi caja</h1></div><div class="panel"><div class="tabla-cont"><table id="tabla-ventas"><thead><tr><th>Folio</th><th>Fecha</th><th>Cajero</th><th class="num">Total</th><th>Estado</th><th>Impresiones</th><th></th></tr></thead><tbody>
    ${j.ventas.length ? j.ventas.map((r) => `<tr data-folio="${r.folio}"><td>${String(r.folio).padStart(6, '0')}</td><td>${esc(r.fecha_local)}</td><td>${esc(r.cajero)}</td><td class="num">${mxn(r.total)}</td><td><span class="insignia ${r.estado}">${esc(r.estado)}</span></td><td>${r.impresiones}${r.ultima_impresion === 'error' ? ' (última falló)' : ''}</td><td><button class="btn" type="button" data-ver="${r.sale_id}">${ico('receipt')}<span>Ver ticket</span></button></td></tr>`).join('') : '<tr><td colspan="7" class="vacio">Sin ventas hoy en esta caja.</td></tr>'}
    </tbody></table></div></div>`;
  for (const b of $('#vista').querySelectorAll('[data-ver]')) {
    b.addEventListener('click', async () => {
      const t = await api(`/api/ticket?sale_id=${b.dataset.ver}`);
      const dlg = $('#dlg-ticket');
      dlg.innerHTML = `<h2 id="dlg-titulo" style="margin:0">Ticket</h2><pre class="ticket" id="ticket-texto">${esc(t.ticket_texto)}</pre><div class="filas"><button class="btn" id="btn-reimprimir" type="button">${ico('printer')}<span>Reimprimir</span></button><button class="btn" id="btn-cerrar" type="button">${ico('x')}<span>Cerrar</span></button></div><div id="estado-impresion" class="mensaje" role="status"></div>`;
      dlg.showModal();
      $('#btn-cerrar').addEventListener('click', () => dlg.close());
      $('#btn-reimprimir').addEventListener('click', async () => {
        const x = await api('/api/venta/reimprimir', { sale_id: b.dataset.ver });
        $('#ticket-texto').textContent = x.ticket_texto;
        const e = $('#estado-impresion'); e.className = `mensaje ${x.impresion.ok ? 'ok' : 'error'}`; e.textContent = x.impresion.ok ? 'Reimpreso.' : `Falló: ${x.impresion.error}`;
      });
    });
  }
}

// ── Administración ──
async function vistaReportes() {
  const { cajas } = await api('/api/admin/cajas');
  const hoy = new Date(Date.now() - 7 * 3600e3).toISOString().slice(0, 10);
  $('#vista').innerHTML = `<div class="titulo-vista">${ico('chart')}<h1>Reportes de ventas</h1></div><form class="filtros panel" id="filtros">
    <fieldset><legend>Cajas</legend><label><input type="checkbox" id="todas" checked> Todas</label>
      ${cajas.map((c) => `<label><input type="checkbox" class="caja" value="${c.tienda}/${c.caja}" checked> ${esc(c.tienda)} · Caja ${c.caja}</label>`).join('')}</fieldset>
    <label>Desde <input type="date" id="desde" value="${hoy}"></label><label>Hasta <input type="date" id="hasta" value="${hoy}"></label>
    <button class="btn btn-primario" type="submit" style="width:auto">${ico('search')}<span>Consultar</span></button></form>
    <div id="resultado"></div>`;
  const marcas = () => [...$('#filtros').querySelectorAll('.caja')];
  $('#todas').addEventListener('change', (e) => marcas().forEach((m) => (m.checked = e.target.checked)));
  marcas().forEach((m) => m.addEventListener('change', () => ($('#todas').checked = marcas().every((x) => x.checked))));
  $('#filtros').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const sel = marcas().filter((m) => m.checked).map((m) => ({ tienda: m.value.split('/')[0], caja: Number(m.value.split('/')[1]) }));
    if (!sel.length) return void ($('#resultado').innerHTML = '<div class="mensaje error">Seleccione al menos una caja.</div>');
    const { reporte: r } = await api('/api/admin/reporte', { cajas: sel, desde: $('#desde').value, hasta: $('#hasta').value });
    $('#resultado').innerHTML = `<div class="panel"><p class="nota">Cada venta conserva tienda, caja y folio originales; el reporte no renumera.</p>
      <div class="tabla-cont"><table id="tabla-reporte"><thead><tr><th>Tienda</th><th>Caja</th><th>Folio</th><th>Fecha</th><th>Cajero</th><th class="num">Total</th><th>Estado</th></tr></thead><tbody>
      ${r.filas.map((f) => `<tr><td>${esc(f.tienda)}</td><td>${f.caja}</td><td>${String(f.folio).padStart(6, '0')}</td><td>${esc(f.fecha_local)}</td><td>${esc(f.cajero)}</td><td class="num">${mxn(f.total)}</td><td>${esc(f.estado)}</td></tr>`).join('') || '<tr><td colspan="7" class="vacio">Sin ventas en el periodo.</td></tr>'}</tbody></table></div>
      <h2>Desglose por caja</h2><table id="tabla-por-caja"><thead><tr><th>Tienda</th><th>Caja</th><th class="num">Tickets</th><th class="num">Total</th></tr></thead><tbody>
      ${r.porCaja.map((c) => `<tr><td>${esc(c.tienda)}</td><td>${c.caja}</td><td class="num">${c.tickets}</td><td class="num">${mxn(c.total)}</td></tr>`).join('')}
      <tr><th colspan="3" scope="row">Total consolidado</th><td class="num" id="total-consolidado"><b>${mxn(r.total)}</b></td></tr></tbody></table>
      <p class="nota">Sin tarjetas de regalo vendidas ni recargadas: <b id="total-mercancia">${mxn(r.total_mercancia)}</b>. Lo cobrado con una tarjeta de regalo ya cuenta como venta de mercancía; la venta de la tarjeta no.</p></div>`;
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
async function vistaInventario() {
  const j = await api('/api/admin/inventario');
  const r = j.resumen;
  const tiendas = Object.entries(r.por_tienda);
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
          ${tiendas.map(([t, x]) => `<tr data-tienda="${esc(t)}"><td>${esc(t)}</td><td class="num">${x.piezas}</td><td class="num">${x.articulos_con_existencia}</td><td class="num">${x.no_verificados}</td></tr>`).join('')}</tbody></table>
      </div>
      <p class="nota">La existencia es la que conoce el central (lo ya sincronizado). Las cantidades de prueba están marcadas como tales en los movimientos.</p>
      <h2>Vista previa (primeros 20 artículos)</h2>
      <div class="tabla-cont"><table id="tabla-inv-previa"><thead><tr>${j.hoja.encabezados.map((h) => `<th>${esc(h)}</th>`).join('')}</tr></thead><tbody>
        ${j.hoja.filas.map((f) => `<tr>${f.map((v) => `<td>${esc(v)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>
    </div>`;
  $('#btn-exportar').addEventListener('click', async () => {
    const e = $('#estado-exportar');
    e.textContent = 'Preparando el archivo…';
    try { e.textContent = await exportarInventario(); } catch (err) { e.textContent = `No se pudo exportar: ${err.message}`; }
  });
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
    <pre class="ticket" id="ticket-texto" tabindex="0">${esc(r.ticket_texto)}</pre>
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

// ── Cambio o devolución: se busca la venta de la tienda, pero solo se devuelve en la caja donde se hizo ──
async function vistaDevolucion() {
  const hoy = S.estado.fecha_local;
  $('#vista').innerHTML = `<div class="titulo-vista">${ico('undo')}<h1>Cambio o devolución</h1></div>
    <section class="panel" aria-label="Buscar la venta">
      <p class="nota" style="margin-top:0">Busque por fecha y hora, escaneando el artículo, o por folio. La devolución se hace <b>solo en la caja donde se vendió</b>; si la venta es de la otra caja se le indica cuál. Cada devolución lleva folio de la misma serie que las ventas.</p>
      <form id="form-buscar-venta" class="filtros" autocomplete="off">
        <label>Fecha <input type="date" id="bv-fecha" value="${hoy}"></label>
        <label>Desde <input type="time" id="bv-desde" value="00:00"></label>
        <label>Hasta <input type="time" id="bv-hasta" value="23:59"></label>
        <label>Artículo (escanee) <input id="bv-codigo" class="texto" style="padding:6px;border:1px solid var(--borde);border-radius:6px;background:var(--superficie)" spellcheck="false"></label>
        <label>Folio <input id="bv-folio" inputmode="numeric" style="width:90px;padding:6px;border:1px solid var(--borde);border-radius:6px;background:var(--superficie)"></label>
        <button class="btn btn-primario" type="submit" style="width:auto">${ico('search')}<span>Buscar venta</span></button>
        <button class="btn" type="button" id="bv-volver">${ico('cart')}<span>Volver a la venta</span></button>
      </form>
      <div id="bv-msg" class="mensaje" role="status" aria-live="polite"></div>
    </section>
    <div id="bv-resultados"></div>`;
  $('#bv-volver').addEventListener('click', () => ir('venta'));
  $('#form-buscar-venta').addEventListener('submit', async (ev) => { ev.preventDefault(); await buscarVentasDev(); });
  $('#bv-codigo').focus();
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
    m.className = r.hub ? 'mensaje' : 'mensaje aviso';
    m.textContent = r.hub ? (r.articulo ? `Historial de ventas de ${r.articulo.descripcion} ${r.articulo.marca}.` : '') : 'Sin conexión con el hub: solo se muestran las ventas de esta caja.';
    $('#bv-resultados').innerHTML = r.resultados.length ? r.resultados.map((v) => ventaDevHtml(v)).join('') : '<div class="panel vacio" id="bv-vacio">No se encontró ninguna venta con esos datos.</div>';
    for (const f of $('#bv-resultados').querySelectorAll('form[data-sale]')) f.addEventListener('submit', (ev) => { ev.preventDefault(); devolverVenta(f); });
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
      <div class="tabla-cont"><table><thead><tr><th>Artículo</th><th class="num">Vendidas</th><th class="num">Ya devueltas</th><th class="num">Importe</th><th class="num">Devolver</th></tr></thead><tbody>
      ${v.lineas.map((l) => {
        const max = l.tarjeta_regalo ? 0 : l.qty - (l.devuelto ?? 0);
        return `<tr><td>${esc(l.descripcion)}${l.marca ? ` · ${esc(l.marca)}` : ''}${l.item_no ? ` · Item # ${esc(l.item_no)}` : ''}</td><td class="num">${l.qty}</td><td class="num">${l.devuelto ?? 0}</td><td class="num">${mxn(l.importe ?? 0)}</td>
        <td class="num">${l.tarjeta_regalo ? '<small>no se devuelve</small>' : `<input type="number" min="0" max="${max}" value="0" ${max === 0 ? 'disabled' : ''} data-linea="${esc(l.linea_id)}" style="width:64px;text-align:right;padding:4px;border:1px solid var(--borde);border-radius:6px;background:var(--superficie)" aria-label="Piezas a devolver de ${esc(l.descripcion)}">`}</td></tr>`;
      }).join('')}</tbody></table></div>
      <div class="filas" style="margin-top:10px;align-items:center"><input class="texto" data-motivo placeholder="Motivo (talla, defecto, cambio de opinión…)" style="flex:3;min-width:200px;padding:8px;border:1px solid var(--borde);border-radius:8px;background:var(--superficie)" aria-label="Motivo">
        <button class="btn btn-primario" type="submit" style="width:auto;flex:1">${ico('undo')}<span>Devolver</span></button></div>
      <div class="mensaje" data-msg role="status"></div>
    </form></section>`;
}
async function devolverVenta(form) {
  const m = form.querySelector('[data-msg]');
  const renglones = [...form.querySelectorAll('input[data-linea]')].map((i) => ({ linea_id: i.dataset.linea, qty: Number(i.value) })).filter((x) => x.qty > 0);
  if (!renglones.length) { m.className = 'mensaje error'; m.textContent = 'Indique cuántas piezas se devuelven.'; return; }
  try {
    const r = await api('/api/venta/devolver', { sale_id: form.dataset.sale, renglones, motivo: form.querySelector('[data-motivo]').value.trim() || 'devolución' });
    const d = r.devolucion;
    const dlg = $('#dlg-ticket');
    dlg.innerHTML = `<h2 id="dlg-titulo" style="margin:0 0 4px">Devolución registrada</h2>
      <p style="margin:0" id="resumen-devolucion">Folio <b>${String(d.folio).padStart(6, '0')}</b> · devuelto <b>${mxn(d.importe)}</b>${d.reembolsos.map((x) => ` · ${x.metodo === 'efectivo' ? 'efectivo' : x.metodo === 'tarjeta' ? 'reverso a la tarjeta bancaria (hágalo en la terminal)' : `a la tarjeta ${esc(x.tarjeta)}`} <b>${mxn(x.monto)}</b>`).join('')}</p>
      <div class="mensaje ${r.impresion.ok ? 'ok' : 'error'}" id="estado-impresion" role="status">${r.impresion.ok ? 'Ticket enviado a la impresora.' : `La impresora falló: ${esc(r.impresion.error)}. La devolución SÍ quedó guardada.`}</div>
      <pre class="ticket" id="ticket-texto" tabindex="0">${esc(r.ticket_texto)}</pre>
      <div class="filas"><button class="btn btn-primario" id="btn-cerrar" type="button">${ico('check')}<span>Listo</span></button></div>`;
    dlg.showModal();
    $('#btn-cerrar').addEventListener('click', async () => { dlg.close(); await buscarVentasDev(); await pintarEncabezado(); });
  } catch (e) { m.className = 'mensaje error'; m.textContent = e.message; }
}

// ── tipo de cambio del dólar (barra izquierda) ──
async function pintarTipoCambio() {
  const el = $('#tc-barra');
  if (!el || !S.sesion) return;
  let t;
  if (S.sesion.rol === 'admin') {
    const v = (await api('/api/admin/tipo-cambio')).vigente;
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
      if (S.vista === 'tipo_cambio') await vistaTipoCambio();
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
function abrirRechazoBillete() {
  const dlg = $('#dlg-tc');
  dlg.innerHTML = `<h2 id="tc-titulo" style="margin:0 0 4px">Rechazar un billete</h2>
    <p class="nota" style="margin:0 0 8px"><b>Procedimiento:</b> devuelva el billete al cliente, pídale otro y capture solo lo que acepta. Aquí queda constancia (sin mover dinero). El sistema <b>no detecta falsificaciones</b>: la revisión es del cajero.</p>
    <form id="form-rechazo" autocomplete="off">
      <div class="campo"><label for="rb-denom">Billete</label><select id="rb-denom" style="width:100%;padding:8px;border:1px solid var(--borde);border-radius:8px;background:var(--superficie)">${[100, 50, 20, 10, 5, 2, 1].map((d) => `<option value="${d}">US$${d}</option>`).join('')}</select></div>
      <div class="campo"><label for="rb-cantidad">Cantidad</label><input id="rb-cantidad" type="number" min="1" step="1" value="1"></div>
      <div class="campo"><label for="rb-motivo">Motivo</label><select id="rb-motivo" style="width:100%;padding:8px;border:1px solid var(--borde);border-radius:8px;background:var(--superficie)"><option value="danado">Dañado</option><option value="sospechoso">Sospechoso</option></select></div>
      <div class="campo"><label for="rb-nota">Nota (opcional)</label><input id="rb-nota" class="texto"></div>
      <div id="rb-msg" class="mensaje" role="status" aria-live="polite"></div>
      <div class="filas"><button class="btn" id="rb-cancelar" type="button">${ico('x')}<span>Cancelar</span></button><button class="btn btn-primario" id="rb-guardar" type="submit" style="width:auto;flex:2">${ico('check')}<span>Registrar rechazo</span></button></div>
    </form>`;
  dlg.showModal();
  $('#rb-cancelar').addEventListener('click', () => dlg.close());
  $('#form-rechazo').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const m = $('#rb-msg');
    try {
      await api('/api/efectivo/billete-rechazado', { denominacion: Number($('#rb-denom').value), cantidad: Number($('#rb-cantidad').value), motivo: $('#rb-motivo').value, nota: $('#rb-nota').value });
      dlg.close();
      msg('Rechazo registrado. Devuelva el billete al cliente y capture solo los billetes aceptados.', 'aviso');
    } catch (e) { m.className = 'mensaje error'; m.textContent = e.message; }
  });
}

// ── Administración: cortes consolidados con pesos y dólares en columnas separadas ──
async function vistaCortes() {
  const hoy = new Date(Date.now() - 7 * 3600e3).toISOString().slice(0, 10);
  $('#vista').innerHTML = `<div class="titulo-vista">${ico('cash')}<h1>Cortes de caja</h1></div>
    <form class="filtros panel" id="filtros-cortes"><label>Desde <input type="date" id="cor-desde" value="${hoy}"></label><label>Hasta <input type="date" id="cor-hasta" value="${hoy}"></label>
      <button class="btn btn-primario" type="submit" style="width:auto">${ico('search')}<span>Consultar</span></button></form>
    <div id="resultado-cortes"></div>`;
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
  $('#vista').innerHTML = `<div class="titulo-vista">${ico('dollar')}<h1>Dólares recibidos</h1></div>
    <form class="filtros panel" id="filtros-usd"><label>Desde <input type="date" id="usd-desde" value="${hoy}"></label><label>Hasta <input type="date" id="usd-hasta" value="${hoy}"></label>
      <button class="btn btn-primario" type="submit" style="width:auto">${ico('search')}<span>Consultar</span></button>
      <button class="btn" type="button" id="btn-exportar-dolares">${ico('download')}<span>Exportar a Excel</span></button><span id="estado-exportar-usd" role="status" aria-live="polite"></span></form>
    <div id="resultado-usd"></div>`;
  const consultar = async () => {
    const q = `desde=${$('#usd-desde').value}&hasta=${$('#usd-hasta').value}`;
    const { reporte: r } = await api(`/api/admin/dolares?${q}`);
    $('#resultado-usd').innerHTML = `<div class="panel"><p class="nota" style="margin-top:0">Dólares FÍSICOS recibidos. El equivalente en MXN usa la tasa de cada operación, no la última del día. El cambio se entrega en pesos.</p>
      <div class="tabla-cont"><table id="tabla-dolares"><thead><tr><th>Tienda</th><th>Caja</th><th>Folio</th><th>Fecha</th><th>Cajero</th><th class="num">USD</th><th class="num">Tasa</th><th class="num">Equivalente MXN</th><th class="num">Pesos recibidos</th><th class="num">Cambio MXN</th><th>Estado</th></tr></thead><tbody>
      ${r.filas.map((f) => `<tr data-folio="${f.folio}"><td>${esc(f.tienda)}</td><td>${f.caja}</td><td>${String(f.folio).padStart(6, '0')}</td><td>${esc(f.fecha_local)} ${esc(f.hora)}</td><td>${esc(f.cajero)}</td><td class="num">${usd(f.usd)}</td><td class="num">${(f.tasa / 10000).toFixed(2)} (v${f.tasa_version})</td><td class="num">${mxn(f.equivalente)}</td><td class="num">${mxn(f.pesos_recibidos)}</td><td class="num">${mxn(f.cambio_mxn)}</td><td>${esc(f.estado)}</td></tr>`).join('') || '<tr><td colspan="11" class="vacio">Sin cobros con dólares en el periodo.</td></tr>'}</tbody></table></div>
      <h2>Por caja</h2><table id="tabla-dolares-caja"><thead><tr><th>Tienda</th><th>Caja</th><th class="num">Cobros</th><th class="num">USD físicos</th><th class="num">Equivalente histórico MXN</th></tr></thead><tbody>
      ${r.porCaja.map((c) => `<tr><td>${esc(c.tienda)}</td><td>${c.caja}</td><td class="num">${c.cobros}</td><td class="num">${usd(c.usd)}</td><td class="num">${mxn(c.equivalente_historico)}</td></tr>`).join('')}
      <tr><th colspan="3" scope="row">Total</th><td class="num" id="total-usd"><b>${usd(r.usd)}</b></td><td class="num" id="total-equivalente"><b>${mxn(r.equivalente_historico)}</b></td></tr></tbody></table></div>`;
  };
  $('#filtros-usd').addEventListener('submit', async (ev) => { ev.preventDefault(); await consultar(); });
  $('#btn-exportar-dolares').addEventListener('click', async () => {
    const e = $('#estado-exportar-usd');
    e.textContent = 'Preparando el archivo…';
    try { e.textContent = await exportarArchivo(`/api/admin/dolares.xlsx?desde=${$('#usd-desde').value}&hasta=${$('#usd-hasta').value}`, 'dolares-recibidos.xlsx'); } catch (err) { e.textContent = `No se pudo exportar: ${err.message}`; }
  });
  await consultar();
}
async function vistaDepartamentos() {
  const { departamentos: lista } = await api('/api/admin/departamentos');
  $('#vista').innerHTML = `<div class="titulo-vista">${ico('box')}<h1>Departamentos</h1></div>
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
async function vistaTipoCambio() {
  const j = await api('/api/admin/tipo-cambio');
  const v = j.vigente;
  $('#vista').innerHTML = `<div class="titulo-vista">${ico('refresh')}<h1>Tipo de cambio del dólar</h1></div>
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
async function iniciar() {
  Object.assign(S, { sesion: null, vista: null, cart: null, carrito: null, sel: null, estado: null, ultimoFolio: null });
  S.sesion = await api('/api/sesion');
  await ir(S.sesion.nav[0]);
}
window.POS_UI = { iniciar };
setInterval(async () => {
  if (!S.sesion || $('#dlg-ticket').open || $('#dlg-tc').open) return;
  pintarEncabezado().catch(() => {});
  // Si hay una tasa nueva mientras se cobra en dólares, se avisa (el cobro conserva la suya).
  if (S.vista === 'venta' && S.usdAbierto && S.cart && S.sesion.rol === 'cajero') {
    try { S.tasa = await api('/api/venta/tasa', { cart: S.cart }); pintarInfoTasa(); recalcular(); } catch { /* sin cambios */ }
  }
}, 5000);
if (!window.__POS_MANUAL__) iniciar();
