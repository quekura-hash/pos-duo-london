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
    const e = new Error(j.error?.mensaje ?? 'Error'); e.codigo = j.error?.codigo; e.detalle = j.error?.detalle;
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
  warehouse: '<path d="M3 10 12 4l9 6v10H3z"/><path d="M8 20v-6h8v6M8 17h8"/>',
  upload: '<path d="M12 16V5m0 0-4 4m4-4 4 4M5 20h14"/>',
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

/** Logo de la tienda arriba del ticket (versión en 1 bit para papel térmico). */
const logoTicket = (t) => window.__POS_LOGOS_TICKET__?.[t] ?? (t === 'DUO' ? 'ticket-duo.png' : 'ticket-london.png');
const logoTicketHtml = () => (S.estado?.tienda ? `<div class="logo-ticket-cont"><img class="logo-ticket" id="logo-ticket" src="${logoTicket(S.estado.tienda)}" alt="Logo de ${esc(S.estado.negocio ?? S.estado.tienda)}"></div>` : '');

// ── barra superior y pie ──
async function pintarEncabezado() {
  const h = $('#encabezado');
  const pie = $('#pie');
  if (S.sesion.rol === 'admin') {
    h.innerHTML = `<div class="logos"><img class="logo" src="${logoDe('DUO')}" alt="DÚO New York"><img class="logo" src="${logoDe('LON')}" alt="London Love"></div>
      <div class="titulo">Administración</div>
      <div class="datos"><span class="chip-top" data-chip="usuario">${ico('user')}<span>Usuario: <b>${esc(S.sesion.usuario)}</b></span></span><span class="chip-top" data-chip="rol">${ico('gear')}<b>Administración${S.sesion.requiere_login && S.sesion.rol_usuario ? ` · ${S.sesion.rol_usuario === 'almacenista' ? 'Almacenista' : 'Supervisor'}` : ''}</b></span>
      <span class="chip-top" data-chip="alcance">${ico('store')}<span>Una, varias o todas las cajas</span></span>${S.sesion.requiere_login ? `<button class="btn" type="button" id="btn-salir" title="Cerrar la sesión">${ico('x')}<span>Cerrar sesión</span></button>` : ''}</div>`;
    pie.innerHTML = `<span>Usuario: ${esc(S.sesion.usuario)}</span><span>Administración · consolida cajas y tiendas</span><span>Precios en MXN</span>`;
    await pintarTipoCambio();
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
      <span class="chip-top" data-chip="usuario">${ico('user')}<span>Vendedora-Cajera: <b>${esc(e.usuario)}</b></span></span>
      <span class="sincro ${sincro[0]}" data-chip="sincro">${sincro[1]}</span>
      <span class="chip-top" data-chip="fecha">${ico('calendar')}<b>${fechaCorta(e.ahora)}</b></span>
      ${S.sesion.requiere_login ? `<button class="btn" type="button" id="btn-salir" title="Cerrar la sesión">${ico('x')}<span>Cerrar sesión</span></button>` : ''}
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
  venta: ['Venta', 'cart'], retiro: ['Retiro', 'cash'], ventas: ['Historial', 'clock'], creditos: ['Créditos', 'card'], corte: ['Corte de caja', 'chart'],
  tarjetas: ['Tarjetas de regalo', 'gift'], reportes: ['Reportes', 'chart'], cortes: ['Cortes', 'cash'], dolares: ['Dólares recibidos', 'dollar'], descuentos: ['Descuentos', 'percent'], entregas: ['Entregas de almacén', 'warehouse'], inventario: ['Inventario', 'box'], departamentos: ['Departamentos', 'box'], almacen: ['Almacén', 'warehouse'], promociones: ['Promociones', 'percent'], tiendas: ['Tiendas', 'store'], configuracion: ['Configuración', 'gear'], administracion: ['Administración', 'gear'], volver_caja: ['Caja', 'caja'], tipo_cambio: ['Tipo de cambio', 'refresh'],
};
function pintarNav() {
  // En la página de prueba (una sola ventana) se puede pasar de la caja a Administración y volver; en la app real cada sesión es la suya.
  const cambia = !!window.__POS_CAMBIAR_SESION__;
  const items = S.sesion.rol === 'cajero' ? [...S.sesion.nav, ...(cambia ? ['administracion'] : [])] : [...S.sesion.nav, ...(S.sesion.rol_usuario === 'almacenista' ? [] : ['creditos']), ...(cambia ? ['volver_caja'] : [])]; // Créditos vive en Administración, no en la venta
  $('#nav').innerHTML = items.map((v) => v === 'creditos'
    ? `<button type="button" data-proximamente="creditos" disabled title="Próximamente" aria-label="Créditos (próximamente)">${ico(NAV[v][1])}<span>${NAV[v][0]}</span></button>`
    : `<button type="button" data-vista="${v}" title="${NAV[v][0]}" ${v === ({ descuentos: 'promociones', dolares: 'cortes', entregas: 'almacen', conteo_limbo: 'inventario' }[S.vista] ?? S.vista) ? 'aria-current="page"' : ''}>${ico(NAV[v][1])}<span>${NAV[v][0]}</span></button>`).join('');
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
  pintarNav();
  await pintarEncabezado();
  await ({ venta: vistaVenta, retiro: vistaRetiro, corte: vistaCorte, ventas: vistaVentas, reportes: vistaReportes, inventario: vistaInventario, almacen: vistaAlmacen, promociones: vistaPromociones, configuracion: vistaConfiguracion, tiendas: vistaTiendas, departamentos: vistaDepartamentos, tarjetas: vistaTarjetas, devolucion: vistaDevolucion, dolares: vistaDolares, descuentos: vistaDescuentos, entregas: vistaEntregas, conteo_limbo: vistaConteoLimbo, tipo_cambio: vistaTipoCambio, cortes: vistaCortes })[v]();
  if (v !== 'almacen') await avisosPisoInicial();
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
            <span class="acciones">${pronto('btn-editar-venta', 'pencil', 'Editar en esta venta', 'btn-acento')}${pronto('btn-editar-catalogo', 'pencil', 'Editar catálogo', 'btn-acento')}
            <button class="btn btn-peligro" id="btn-quitar" type="button">${ico('trash')}<span>Quitar artículo</span></button></span></div>
        </section>
        <div class="acciones-inf" id="acciones-inf">
          <button class="btn" id="btn-buscar-ticket" type="button" title="Abre el historial de ventas de esta caja">${ico('search')}<span>Buscar ticket</span></button>
          <button class="btn" id="btn-devolucion" type="button" title="Buscar la venta y devolver (solo en la caja donde se vendió)">${ico('undo')}<span>Cambio o devolución</span></button><button class="btn" id="btn-descuento" type="button" title="Descuento autorizado por un supervisor con su clave">${ico('percent')}<span>Aplicar descuento</span></button><button class="btn" id="btn-cupon" type="button" title="Capturar o escanear un cupón de descuento">${ico('gift')}<span>Cupón</span></button><button class="btn" id="btn-espera" type="button" title="Guardar esta venta y atender a otro cliente, o retomar una venta guardada">${ico('pause')}<span id="txt-espera">Venta en espera</span></button>
        </div>
      </div>
      <aside class="panel resumen" aria-label="Resumen y cobro">
        <h2>Resumen de venta</h2>
        <p class="nota" style="margin:0 0 10px"><span id="piezas">0</span> pieza(s)</p>
        <dl>
          <dt>Importe</dt><dd id="brutas">$0.00</dd>
          <dt>Descuentos</dt><dd id="descuentos">$0.00</dd>
        </dl>
        <div id="promos-aplicadas" aria-live="polite"></div>
        <div class="total"><span>TOTAL</span><b id="total">$0.00</b></div>
        <div class="mxn">MXN</div>
        <strong>Forma de pago</strong>
        <div class="formas" id="formas" role="group" aria-label="Forma de pago">
          <button class="btn forma" type="button" data-forma="efectivo" aria-pressed="true">${ico('cash', 'ico-lg')}<span>Efectivo</span></button>
          <button class="btn forma" type="button" data-forma="tarjeta" aria-pressed="false" ${metodos.includes('tarjeta') ? '' : 'disabled title="Esta caja no tiene terminal bancaria"'}>${ico('card', 'ico-lg')}<span>Tarjeta</span></button>
          <button class="btn forma" type="button" data-forma="mixto" aria-pressed="false" ${metodos.includes('tarjeta') ? '' : 'disabled title="Esta caja no tiene terminal bancaria"'}>${ico('mixto', 'ico-lg')}<span>Mixto</span></button>
          <button class="btn forma" type="button" data-forma="regalo" aria-pressed="false" ${metodos.includes('tarjeta_regalo') ? '' : `disabled title="Esta caja no maneja tarjetas de regalo"`}>${ico('gift', 'ico-lg')}<span>Tarjeta de regalo</span></button>
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
  $('#btn-cupon').addEventListener('click', () => abrirCupon());
  $('#btn-espera').addEventListener('click', () => abrirEspera());
  actualizarEspera();
  revisarAvisoRetiro();
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
  $(f === 'regalo' ? '#codigo-regalo' : f === 'tarjeta' ? '#tj-aut' : f === 'mixto' ? '#tj-monto' : '#recibido').focus();
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
  if (S.forma === 'tarjeta' || S.forma === 'mixto') {
    p.innerHTML = htmlTarjeta(S.forma === 'mixto');
    for (const id of ['#tj-aut', '#tj-monto', '#tj-ult4', '#tj-marca']) $(id)?.addEventListener('input', recalcular);
    $('#tj-ult4').addEventListener('input', () => { $('#tj-ult4').value = $('#tj-ult4').value.replace(/\D/g, ''); });
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
  pintarPromos();
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
  if (S.forma === 'tarjeta' || S.forma === 'mixto') {
    const r = repartoTarjeta();
    if ($('#tj-resto-monto')) $('#tj-resto-monto').textContent = mxn(r.resto);
    ok = hay && r.valido && /^[A-Za-z0-9]{4,12}$/.test($('#tj-aut').value.trim()) && (!$('#tj-ult4').value || /^\d{4}$/.test($('#tj-ult4').value));
    if ($('#linea-cambio')) $('#linea-cambio').classList.remove('falta');
    if ($('#lbl-cambio')) { $('#lbl-cambio').textContent = 'Cambio'; $('#cambio').textContent = mxn(0); }
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
  $('#btn-cobrar').disabled = !ok;
  $('#txt-cobrar').textContent = hay && total === 0 && S.forma !== 'regalo' ? 'REGISTRAR VENTA SIN COBRO' : `COBRAR ${mxn(total)}`;
}

async function escanear() {
  const inp = $('#scan');
  const texto = inp.value;
  if (!texto.trim()) return;
  inp.value = '';
  $('#resultados').innerHTML = '';
  const qr = /^cupon:\s*(.+)$/i.exec(texto.trim()); // el QR de un cupón trae «CUPON:CÓDIGO»
  if (qr) { await aplicarCuponCodigo(qr[1]); inp.focus(); return; }
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
      <div class="campo"><label for="na-clave">Su clave (${esc(S.sesion.usuario)})</label><input id="na-clave" type="password" inputmode="numeric" autocomplete="off" placeholder="••••"></div>
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
    ${logoTicketHtml()}<pre class="ticket" id="ticket-texto" tabindex="0">${esc(r.ticket_texto)}</pre>
    <div class="filas"><button class="btn" id="btn-reimprimir" type="button">${ico('printer')}<span>${imp.ok ? 'Reimprimir ticket' : 'Reintentar impresión'}</span></button><button class="btn" id="btn-ticket-regalo" type="button">${ico('gift')}<span>Ticket de regalo</span></button><button class="btn btn-primario" id="btn-nueva" type="button" style="width:auto;flex:1">${ico('plus')}<span>Nueva venta</span></button></div>`;
  dlg.showModal();
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
    } catch (err) { $('#estado-impresion').textContent = err.message; }
  });
  $('#btn-nueva').addEventListener('click', async () => {
    dlg.close();
    const n = await api('/api/venta/nueva', {});
    S.cart = n.cart; S.carrito = n.carrito; S.sel = null;
    await ir('venta');
  });
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
  $('#vista').innerHTML = `<div class="titulo-vista">${ico('clock')}<h1>Historial de mi caja</h1></div><div id="mensaje-hist" class="mensaje" role="status" aria-live="polite"></div><div class="panel"><div class="tabla-cont"><table id="tabla-ventas"><thead><tr><th>Folio</th><th>Fecha</th><th>Vendedora-Cajera</th><th class="num">Total</th><th>Estado</th><th>Impresiones</th><th></th></tr></thead><tbody>
    ${j.ventas.length ? j.ventas.map((r) => `<tr data-folio="${r.folio}"><td>${String(r.folio).padStart(6, '0')}</td><td>${esc(r.fecha_local)}</td><td>${esc(r.cajero)}</td><td class="num">${mxn(r.total)}</td><td><span class="insignia ${r.estado}">${esc(r.estado)}</span></td><td>${r.impresiones}${r.ultima_impresion === 'error' ? ' (última falló)' : ''}</td><td><button class="btn" type="button" data-ver="${r.sale_id}">${ico('receipt')}<span>Ver ticket</span></button>${r.estado === 'confirmada' ? ` <button class="btn" type="button" data-cancelar="${r.sale_id}" title="Cancela la venta ya cobrada: la autoriza otra persona">${ico('x')}<span>Cancelar venta</span></button>` : ''}</td></tr>`).join('') : '<tr><td colspan="7" class="vacio">Sin ventas hoy en esta caja.</td></tr>'}
    </tbody></table></div></div>`;
  for (const b of $('#vista').querySelectorAll('[data-cancelar]')) {
    b.addEventListener('click', async () => {
      try {
        const aut = await pedirAutorizacion({ titulo: 'Cancelar la venta', texto: 'Se cancela una venta ya cobrada: el cobro y el cambio quedan registrados y se suma la salida de dinero. La autoriza otra persona (otra Vendedora-Cajera o un supervisor) con su clave.', conMotivo: true, boton: 'Cancelar la venta' });
        if (aut === null) return;
        await api('/api/venta/cancelar', { sale_id: b.dataset.cancelar, motivo: aut.motivo, ...(aut.autoriza ? { autoriza: aut.autoriza } : {}) });
        await vistaVentas();
        const m = $('#mensaje-hist'); if (m) { m.className = 'mensaje ok'; m.textContent = 'Venta cancelada.'; }
      } catch (e) { const m = $('#mensaje-hist'); if (m) { m.className = 'mensaje error'; m.textContent = e.message; } else msg(e.message, 'error'); }
    });
  }
  for (const b of $('#vista').querySelectorAll('[data-ver]')) {
    b.addEventListener('click', async () => {
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
      <div class="tabla-cont"><table id="tabla-reporte"><thead><tr><th>Tienda</th><th>Caja</th><th>Folio</th><th>Fecha</th><th>Vendedora-Cajera</th><th class="num">Total</th><th>Estado</th></tr></thead><tbody>
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
  S.inv = { q: S.inv?.q ?? '', pag: 0, por: 50, total: 0, tiendas: [], articulos: [] };
  $('#vista').innerHTML = `
    <div class="titulo-vista">${ico('box')}<h1>Inventario</h1></div>
    <div class="panel">
      <div class="filas" style="align-items:center;margin-bottom:12px">
        ${window.__POS_IMPORTAR_INVENTARIO__ ? `<button class="btn btn-primario" id="btn-catalogo-inicial" type="button" style="width:auto" title="Carga el archivo completo de artículos: la cantidad de cada fila queda en El Limbo, que se vende en todas las tiendas y cajas">${ico('upload')}<span>Cargar catálogo inicial (El Limbo)</span></button>` : ''}
        <button class="btn" id="btn-conteo-limbo" type="button" title="Contar físicamente las piezas de El Limbo y ajustar su existencia">${ico('check')}<span>Conteo de El Limbo</span></button>
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
      <div class="filas" style="align-items:center"><input id="inv-q" class="texto" placeholder="Buscar por código, Item #, descripción, marca, estilo…" value="${esc(S.inv.q)}" style="padding:6px 8px;border:1px solid var(--borde);border-radius:6px;background:var(--superficie);min-width:320px"><span class="nota">Haga clic en un artículo para editarlo, ver su historial o crearle una promoción.</span></div>
      <div id="inv-msg" class="mensaje" role="status" aria-live="polite"></div>
      <div id="inv-res" class="tabla-cont"></div>
      <div class="filas" id="inv-pag" style="align-items:center;margin-top:8px"></div>
    </div>`;
  let tmp;
  $('#inv-q').addEventListener('input', () => { clearTimeout(tmp); tmp = setTimeout(() => { S.inv.q = $('#inv-q').value.trim(); S.inv.pag = 0; cargarListaInventario(); }, 250); });
  $('#btn-exportar').addEventListener('click', async () => {
    const e = $('#estado-exportar');
    e.textContent = 'Preparando el archivo…';
    try { e.textContent = await exportarInventario(); } catch (err) { e.textContent = `No se pudo exportar: ${err.message}`; }
  });
  $('#btn-conteo-limbo').addEventListener('click', () => ir('conteo_limbo'));
  const ci = $('#btn-catalogo-inicial'); if (ci) ci.addEventListener('click', () => window.__POS_IMPORTAR_INVENTARIO__());
  await cargarListaInventario();
}
async function cargarListaInventario() {
  const I = S.inv;
  const r = await api(`/api/admin/articulos?todos=1&limite=${I.por}&desde=${I.pag * I.por}&q=${encodeURIComponent(I.q)}`);
  Object.assign(I, { total: r.total, tiendas: r.tiendas ?? [], articulos: r.articulos });
  const paginas = Math.max(1, Math.ceil(r.total / I.por));
  $('#inv-res').innerHTML = `<table id="tabla-inv-lista"><thead><tr><th>Item #</th><th>Código</th><th>Descripción</th><th>Marca</th><th>Estilo</th><th>Lote</th><th>Departamento</th><th class="num">Precio</th>${I.tiendas.map((t) => `<th class="num">${esc(t)}</th>`).join('')}<th class="num">Almacén</th><th class="num">El Limbo</th></tr></thead><tbody>
    ${r.articulos.map((a) => `<tr data-item="${esc(a.item_id)}" tabindex="0" style="cursor:pointer"><td>${esc(a.item_no ?? '')}</td><td>${esc(a.codigo)}</td><td>${esc(a.descripcion)}</td><td>${esc(a.marca)}</td><td>${esc(a.estilo)}</td><td>${esc(a.lote)}</td><td>${esc(a.departamento)}</td><td class="num">${mxn(a.precio)}</td>${I.tiendas.map((t) => `<td class="num">${a.existencias[t] ?? 0}</td>`).join('')}<td class="num">${a.almacen}</td><td class="num" data-col="limbo">${a.limbo}</td></tr>`).join('') || `<tr><td colspan="${10 + I.tiendas.length}" class="vacio">Ningún artículo coincide.</td></tr>`}</tbody></table>`;
  for (const tr of $('#inv-res').querySelectorAll('tr[data-item]')) {
    const abrir = () => abrirArticulo(I.articulos.find((x) => x.item_id === tr.dataset.item));
    tr.addEventListener('click', abrir);
    tr.addEventListener('keydown', (ev) => { if (ev.key === 'Enter') abrir(); });
  }
  const desde = r.total ? I.pag * I.por + 1 : 0, hasta = Math.min(r.total, (I.pag + 1) * I.por);
  $('#inv-pag').innerHTML = `<button class="btn" id="inv-ant" type="button" ${I.pag === 0 ? 'disabled' : ''}>${ico('chevron', 'ico-izq')}<span>Anterior</span></button><span id="inv-pag-info">Artículos ${desde}–${hasta} de ${r.total} · página ${I.pag + 1} de ${paginas}</span><button class="btn" id="inv-sig" type="button" ${I.pag + 1 >= paginas ? 'disabled' : ''}><span>Siguiente</span>${ico('chevron')}</button>`;
  $('#inv-ant').addEventListener('click', () => { I.pag--; cargarListaInventario(); });
  $('#inv-sig').addEventListener('click', () => { I.pag++; cargarListaInventario(); });
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
      <div class="filas"><button class="btn" type="button" id="art-cerrar">Cerrar</button><button class="btn" type="button" id="art-historial">${ico('clock')}<span>Historial</span></button>${S.sesion.rol_usuario === 'almacenista' ? '' : `<button class="btn" type="button" id="art-promo">${ico('percent')}<span>Crear promoción</span></button>`}<button class="btn btn-primario" type="submit" id="art-guardar" style="width:auto;flex:1">${ico('check')}<span>Guardar cambios</span></button></div>
    </form>
    <div id="art-hist" class="tabla-cont" hidden></div>`;
  $('#art-cerrar').addEventListener('click', () => d.close());
  if ($('#art-promo')) $('#art-promo').addEventListener('click', async () => { d.close(); S.hoyPromo = S.hoyPromo ?? new Date(Date.now() - 7 * 3600e3).toISOString().slice(0, 10); await abrirPromo(null, { item: a }); });
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
/**
 * Pide la autorización de OTRA persona (otra Vendedora-Cajera o un supervisor: su nombre y su clave) y, si se pide, el motivo. Si todavía no hay cajeros
 * registrados (la caja trabaja abierta) no hay a quién pedirla. Devuelve { motivo, autoriza } o null si se cancela.
 */
async function pedirAutorizacion({ titulo, texto, conMotivo = false, boton = 'Autorizar' }) {
  const a = await api('/api/venta/autorizadores');
  if (!a.pide_clave && !conMotivo) return { autoriza: undefined };
  const d = dialogo('dlg-autorizacion');
  d.setAttribute('aria-labelledby', 'aut-titulo');
  d.innerHTML = `<h2 id="aut-titulo" style="margin-top:0">${esc(titulo)}</h2><p class="nota" style="margin-top:0">${esc(texto)}</p>
    <form id="form-autorizacion" autocomplete="off">
      ${conMotivo ? '<div class="campo"><label for="aut-motivo">Motivo</label><input id="aut-motivo" class="texto" maxlength="120" placeholder="Obligatorio"></div>' : ''}
      ${a.pide_clave ? `<div class="campo"><label for="aut-quien">Autoriza (otra Vendedora-Cajera o supervisor)</label><select id="aut-quien" style="width:100%;padding:10px;border:2px solid var(--borde);border-radius:10px;background:var(--superficie)">${a.autorizadores.map((x) => `<option value="${esc(x.nombre)}">${esc(x.nombre)}${x.tipo === 'supervisor' ? ' (supervisor)' : ''}</option>`).join('')}</select></div>
      <div class="campo"><label for="aut-clave">Su clave</label><input id="aut-clave" type="password" inputmode="numeric" autocomplete="off" placeholder="••••"></div>` : ''}
      <div id="msg-aut" class="mensaje" role="alert"></div>
      <div class="filas"><button class="btn" type="button" id="aut-no">Cancelar</button><button class="btn btn-primario" type="submit" style="width:auto;flex:1">${ico('check')}<span>${esc(boton)}</span></button></div></form>`;
  return new Promise((fin) => {
    let listo = false;
    const cerrar = (v) => { if (listo) return; listo = true; d.close(); fin(v); };
    $('#aut-no').addEventListener('click', () => cerrar(null));
    d.addEventListener('cancel', () => cerrar(null), { once: true });
    $('#form-autorizacion').addEventListener('submit', (ev) => {
      ev.preventDefault();
      const m = $('#msg-aut');
      const motivo = conMotivo ? $('#aut-motivo').value.trim() : '';
      if (conMotivo && !motivo) { m.className = 'mensaje error'; m.textContent = 'Escriba el motivo.'; return; }
      if (a.pide_clave && (!$('#aut-quien').value || !$('#aut-clave').value)) { m.className = 'mensaje error'; m.textContent = a.autorizadores.length ? 'Elija quién autoriza y teclee su clave.' : 'No hay otra Vendedora-Cajera o supervisor registrado que pueda autorizar.'; return; }
      cerrar({ motivo, autoriza: a.pide_clave ? { nombre: $('#aut-quien').value, clave: $('#aut-clave').value } : undefined });
    });
    d.showModal();
    ($(conMotivo ? '#aut-motivo' : '#aut-clave') ?? $('#aut-no')).focus();
  });
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
    const aut = await pedirAutorizacion({ titulo: 'Autorizar la devolución', texto: 'Una devolución la autoriza otra persona: otra Vendedora-Cajera o un supervisor, con su clave.' });
    if (aut === null) return;
    const r = await api('/api/venta/devolver', { sale_id: form.dataset.sale, renglones, motivo: form.querySelector('[data-motivo]').value.trim() || 'devolución', ...(aut.autoriza ? { autoriza: aut.autoriza } : {}) });
    const d = r.devolucion;
    const dlg = $('#dlg-ticket');
    dlg.innerHTML = `<h2 id="dlg-titulo" style="margin:0 0 4px">Devolución registrada</h2>
      <p style="margin:0" id="resumen-devolucion">Folio <b>${String(d.folio).padStart(6, '0')}</b> · devuelto <b>${mxn(d.importe)}</b>${d.reembolsos.map((x) => ` · ${x.metodo === 'efectivo' ? 'efectivo' : x.metodo === 'tarjeta' ? 'reverso a la tarjeta bancaria (hágalo en la terminal)' : `a la tarjeta ${esc(x.tarjeta)}`} <b>${mxn(x.monto)}</b>`).join('')}</p>
      <div class="mensaje ${r.impresion.ok ? 'ok' : 'error'}" id="estado-impresion" role="status">${r.impresion.ok ? 'Ticket enviado a la impresora.' : `La impresora falló: ${esc(r.impresion.error)}. La devolución SÍ quedó guardada.`}</div>
      ${logoTicketHtml()}<pre class="ticket" id="ticket-texto" tabindex="0">${esc(r.ticket_texto)}</pre>
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
  $('#vista').innerHTML = `<div class="titulo-vista">${ico('cash')}<h1>Cortes de caja</h1><button class="btn" id="btn-ir-dolares" type="button" style="margin-left:auto">${ico('dollar')}<span>Dólares recibidos</span></button></div>
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
const NOM_TIPO_DESC = { promo: 'Promoción', cupon: 'Cupón', manual: 'Manual (supervisor)' };
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
      ${e.pide_clave ? `<div class="campo" style="max-width:260px"><label for="ret-clave">Su clave (${esc(S.sesion.usuario ?? '')}) para confirmar el retiro</label><input id="ret-clave" type="password" inputmode="numeric" autocomplete="off" placeholder="••••"></div>` : ''}
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
  $('#vista').innerHTML = `<div class="titulo-vista">${ico('percent')}<h1>Reporte de promociones y descuentos</h1><button class="btn" id="btn-volver-promos" type="button" style="margin-left:auto">${ico('undo')}<span>Volver a promociones</span></button></div>
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
        <tr><th scope="row">Descuentos autorizados por supervisor</th><td class="num" data-campo="manual">${mxn(R.manual.monto)}</td><td class="num">${R.manual.tickets} ticket(s)</td></tr></tbody></table></div>
      <div class="panel" style="margin-top:12px"><h2 style="margin-top:0">Por supervisor</h2>
        <table id="tabla-desc-supervisor"><thead><tr><th>Supervisor</th><th class="num">Descuentos</th><th class="num">Monto</th><th class="num">Mayor % de una venta</th><th class="num">Al 100 %</th></tr></thead><tbody>
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
function abrirDescuento() {
  if (!S.carrito.lineas.length) return msg('Agregue artículos a la venta antes de aplicar un descuento.', 'aviso');
  const d = dialogo('dlg-descuento');
  const sel = S.sel ? S.carrito.lineas.find((l) => l.linea_id === S.sel && !l.tarjeta_regalo) : null;
  const hayManual = S.carrito.lineas.some((l) => (l.descuento_detalle ?? []).some((x) => x.tipo === 'manual'));
  d.setAttribute('aria-labelledby', 'desc-titulo');
  d.innerHTML = `<h2 id="desc-titulo" style="margin-top:0">Aplicar descuento</h2>
    <p class="nota">Lo autoriza un supervisor con su clave. Queda anotado en la venta y en el ticket.</p>
    <form id="form-descuento" autocomplete="off">
      <fieldset style="border:1px solid var(--borde);border-radius:8px;margin:8px 0"><legend>Aplicar a</legend>
        <label style="display:block"><input type="radio" name="desc-alcance" value="linea" ${sel ? 'checked' : 'disabled'}> Solo el artículo seleccionado${sel ? `: ${esc(sel.descripcion)} ${esc(sel.marca)}` : ' (seleccione uno en la lista)'}</label>
        <label style="display:block"><input type="radio" name="desc-alcance" value="venta" ${sel ? '' : 'checked'}> Toda la venta</label></fieldset>
      <fieldset style="border:1px solid var(--borde);border-radius:8px;margin:8px 0"><legend>Tipo de descuento</legend>
        <label style="display:inline-block;margin-right:16px"><input type="radio" name="desc-tipo" value="pct" checked> Porcentaje (%)</label>
        <label style="display:inline-block"><input type="radio" name="desc-tipo" value="monto"> Monto ($)</label></fieldset>
      <div class="campo"><label for="desc-valor">Valor</label><input id="desc-valor" inputmode="decimal" placeholder="10"></div>
      <div class="campo"><label for="desc-clave">Clave del supervisor</label><input id="desc-clave" type="password" inputmode="numeric" autocomplete="off" placeholder="••••"></div>
      <div id="msg-desc" class="mensaje" role="status" aria-live="polite"></div>
      <div class="filas"><button class="btn" type="button" id="desc-cerrar">Cancelar</button>${hayManual ? `<button class="btn btn-peligro" type="button" id="desc-quitar">Quitar descuentos</button>` : ''}<button class="btn btn-primario" type="submit" id="desc-aplicar" style="width:auto;flex:1">${ico('check')}<span>Autorizar y aplicar</span></button></div>
    </form>`;
  $('#desc-cerrar').addEventListener('click', () => d.close());
  const q = $('#desc-quitar');
  if (q) q.addEventListener('click', async () => {
    const alcance = d.querySelector('input[name="desc-alcance"]:checked').value;
    try { const r = await api('/api/venta/descuento/quitar', { cart: S.cart, linea_id: alcance === 'linea' ? sel.linea_id : null }); S.carrito = r.carrito; pintarCarrito(); d.close(); msg('Descuento quitado.'); }
    catch (e) { const m = $('#msg-desc'); m.className = 'mensaje error'; m.textContent = e.message; }
  });
  $('#form-descuento').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const m = $('#msg-desc');
    const tipo = d.querySelector('input[name="desc-tipo"]:checked').value;
    const alcance = d.querySelector('input[name="desc-alcance"]:checked').value;
    const crudo = $('#desc-valor').value.trim();
    let valor = null;
    if (tipo === 'pct') valor = /^\d{1,3}$/.test(crudo) ? Number(crudo) : null;
    else valor = parseMXN(crudo);
    if (!valor) { m.className = 'mensaje error'; m.textContent = tipo === 'pct' ? 'Escriba un porcentaje entero de 1 a 100.' : 'Escriba el monto del descuento en pesos.'; return; }
    try {
      const r = await api('/api/venta/descuento', { cart: S.cart, linea_id: alcance === 'linea' ? sel.linea_id : null, tipo, valor, clave: $('#desc-clave').value });
      S.carrito = r.carrito; pintarCarrito(); d.close(); msg(`Descuento autorizado por ${r.supervisor}.`);
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
  const tieneArt = (S.carrito?.lineas?.length ?? 0) > 0;
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
  pintarAvisoPiso(j.avisos);
  $('#vista').innerHTML = `<div class="titulo-vista">${ico('warehouse')}<h1>Almacén</h1></div>
    <section class="panel"><div class="filas" style="align-items:center">
      <button class="btn btn-primario" id="btn-alta-lote" type="button" style="width:auto">${ico('upload')}<span>Alta Lote de inventario</span></button>
      <button class="btn" id="btn-alta-manual" type="button">${ico('plus')}<span>Alta manual</span></button>
      <button class="btn" id="btn-reporte-entregas" type="button">${ico('chart')}<span>Reporte de entregas</span></button>
      <label style="margin-left:auto">${ico('search')} <input class="texto" id="alm-q" placeholder="Buscar por código, Item #, texto…" value="${esc(S.alm.q)}" style="padding:6px 8px;border:1px solid var(--borde);border-radius:6px;background:var(--superficie)"></label>
      <label><input type="checkbox" id="alm-solo" ${S.alm.solo ? 'checked' : ''}> Solo con piezas en el almacén o por confirmar</label></div>
      <p class="nota">Las piezas llegan aquí sin etiquetar y sin existencia en tienda. Confirme las etiquetas, anote cuántas va a cada tienda y entregue: la tienda confirma la recepción al escanear el artículo por primera vez.</p>
      <div id="msg-alm" class="mensaje" role="status" aria-live="polite"></div></section>
    <section class="panel faltantes" id="panel-faltantes" style="margin-top:12px" hidden></section>
    <section class="panel" style="margin-top:12px"><div class="tabla-cont"><table id="tabla-almacen"><thead><tr><th>Item #</th><th>Código</th><th>Descripción</th><th>Estilo</th><th>Lote</th><th>Pedimento</th><th>Departamento</th><th class="num">Almacén</th><th>Etiqueta precio</th><th>Etiqueta costura</th>${j.tiendas.map((t) => `<th>${esc(TIENDAS_ALM[t] ?? t)}</th>`).join('')}<th>Por confirmar</th><th>Sacar a piso</th><th></th></tr></thead><tbody id="alm-cuerpo"></tbody></table></div><p class="nota" id="alm-pie"></p></section>`;
  $('#btn-alta-lote').addEventListener('click', abrirAltaLote);
  $('#btn-alta-manual').addEventListener('click', abrirAltaManual);
  $('#btn-reporte-entregas').addEventListener('click', () => ir('entregas'));
  S.alm.faltantes = j.faltantes;
  pintarFaltantes();
  $('#alm-q').addEventListener('input', (ev) => { S.alm.q = ev.target.value; pintarAlmacen(); });
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
        S.alm.items = r.almacen.items; pintarAlmacen(); pintarAvisoPiso(r.almacen.avisos);
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
        S.alm.faltantes = r.faltantes; S.alm.items = r.items; pintarFaltantes(); pintarAlmacen(); pintarAvisoPiso(r.avisos);
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
  const lim = visibles.slice(0, 150);
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
    pintarAlmacen(); pintarAvisoPiso(r.avisos);
    m.className = 'mensaje ok'; m.textContent = fecha ? `Recordatorio guardado: sacar a piso el ${fechaPiso(fecha)}.` : 'Recordatorio quitado.';
  } catch (e) { m.className = 'mensaje error'; m.textContent = e.message; }
}
/** Aviso en el menú lateral de Administración (junto al de modo de prueba). */
function pintarAvisoPiso(avisos) {
  let a = $('#aviso-piso');
  if (S.sesion?.rol !== 'admin' || !avisos?.length) { if (a) a.remove(); return; }
  if (!a) { a = document.createElement('button'); a.id = 'aviso-piso'; a.type = 'button'; $('.nav').insertBefore(a, $('.nav .prueba')); a.addEventListener('click', () => ir('almacen')); }
  const urgente = avisos.some((x) => x.urgente);
  a.className = `aviso-piso ${urgente ? 'roja' : 'morada'}`;
  const prim = avisos.slice(0, 3);
  a.innerHTML = `<strong>Sacar a piso</strong><br>Revise los artículos para sacar a piso el ${prim.map((x) => `<b>${fechaPiso(x.fecha)}</b> (${x.articulos})`).join(', ')}${avisos.length > 3 ? ` y ${avisos.length - 3} fecha(s) más` : ''}.`;
}
async function avisosPisoInicial() {
  if (S.sesion?.rol !== 'admin') return pintarAvisoPiso(null);
  try { pintarAvisoPiso((await api('/api/admin/almacen')).avisos); } catch { /* sin aviso */ }
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
    pintarAlmacen(); pintarAvisoPiso(r.almacen.avisos);
    m.className = 'mensaje ok'; m.textContent = `Entrega registrada. En el almacén quedan ${r.existencia_almacen} pieza(s); cada tienda las recibe al confirmar el primer escaneo.`;
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
  const [{ promociones, hoy, tiendas, articulos }, { supervisores }] = await Promise.all([api('/api/admin/promociones'), api('/api/admin/supervisores')]);
  S.promos = promociones; S.hoyPromo = hoy; S.tiendasInfo = tiendas; S.artInfo = { ...(S.artInfo ?? {}), ...articulos };
  $('#vista').innerHTML = `<div class="titulo-vista">${ico('percent')}<h1>Promociones y cupones</h1></div>
    <section class="panel"><div class="filas" style="align-items:center"><button class="btn btn-primario" id="btn-nueva-promo" type="button" style="width:auto">${ico('plus')}<span>Nueva promoción o cupón</span></button><button class="btn" id="btn-reporte-promos" type="button" style="margin-left:auto">${ico('chart')}<span>Reporte de promociones</span></button></div>
      <p class="nota">Cada promoción o cupón vale solo en la tienda (o tiendas) que elija. Toda promoción lleva fecha de inicio y de término, o queda <b>sin fecha límite</b> hasta que Administración la desactive. En cada compra aplica <b>una sola</b> promoción o cupón: la que más descuento le da al cliente. Las promociones se aplican solas al cobrar; los cupones se capturan o se escanean en la caja. Para promocionar un artículo concreto, búsquelo al crear la promoción o use «Crear promoción» en Inventario.</p>
      <div id="msg-promo" class="mensaje" role="status" aria-live="polite"></div>
      <div class="tabla-cont"><table id="tabla-promos"><thead><tr><th>Nombre</th><th>Tienda</th><th>Tipo</th><th>Regla</th><th>Vigencia</th><th>Estado</th><th class="num">Usos</th><th></th></tr></thead><tbody>
      ${promociones.map((p) => `<tr data-promo="${esc(p.id)}" data-estado="${p.estado}"><td>${esc(p.nombre)}</td><td data-col="tiendas">${esc(tiendasTexto(p))}</td><td>${NOM_TIPO[p.tipo]}</td><td class="desc">${esc(reglaTexto(p))}</td><td>${esc(vigenciaTexto(p))}</td><td><span class="insignia ${p.estado === 'activa' ? '' : 'cancelada'}">${NOM_ESTADO_PROMO[p.estado]}</span></td><td class="num">${p.usos}</td>
        <td class="filas" style="flex-wrap:nowrap"><button class="btn p-editar" type="button">${ico('pencil')}<span>Editar</span></button><button class="btn p-activa" type="button">${p.activa ? 'Desactivar promoción' : 'Activar promoción'}</button>${p.tipo === 'cupon' ? `<button class="btn p-qr" type="button">${ico('download')}<span>Imagen QR</span></button>` : ''}</td></tr>`).join('') || '<tr><td colspan="8" class="vacio">Aún no hay promociones ni cupones.</td></tr>'}</tbody></table></div></section>
    <section class="panel" style="margin-top:12px"><h2 style="margin-top:0">Supervisores que autorizan descuentos</h2>
      <p class="nota">Solo un supervisor puede autorizar un descuento en la caja, tecleando su clave (4 a 8 dígitos). El descuento puede llegar hasta el 100 %. La clave no se puede volver a ver: si se olvida, se cambia.</p>
      <div class="tabla-cont"><table id="tabla-supervisores"><thead><tr><th>Nombre</th><th>Estado</th><th>Nueva clave</th><th></th></tr></thead><tbody>
      ${supervisores.map((x) => `<tr data-sup="${esc(x.id)}"><td>${esc(x.nombre)}</td><td>${x.activo ? 'Activo' : 'Desactivado'}</td><td><input type="password" inputmode="numeric" class="s-clave" placeholder="dejar vacío = no cambiar" aria-label="Nueva clave de ${esc(x.nombre)}" style="padding:4px;border:1px solid var(--borde);border-radius:6px;background:var(--superficie)"></td>
        <td class="filas" style="flex-wrap:nowrap"><button class="btn s-guardar" type="button">${ico('check')}<span>Cambiar clave</span></button><button class="btn s-activo" type="button">${x.activo ? 'Desactivar' : 'Activar'}</button></td></tr>`).join('') || '<tr><td colspan="4" class="vacio">Aún no hay supervisores: sin uno nadie puede autorizar descuentos.</td></tr>'}</tbody></table></div>
      <form id="form-sup" autocomplete="off" class="filas" style="align-items:end;margin-top:10px"><div class="campo" style="margin:0"><label for="sup-nombre">Nombre</label><input id="sup-nombre" class="texto"></div><div class="campo" style="margin:0"><label for="sup-clave">Clave (4 a 8 dígitos)</label><input id="sup-clave" type="password" inputmode="numeric" class="texto"></div>
      <button class="btn btn-primario" id="btn-sup" type="submit" style="width:auto">${ico('plus')}<span>Agregar supervisor</span></button></form>
      <div id="msg-sup" class="mensaje" role="status" aria-live="polite"></div></section>`;
  $('#btn-nueva-promo').addEventListener('click', () => abrirPromo(null));
  $('#btn-reporte-promos').addEventListener('click', () => ir('descuentos'));
  for (const tr of $('#tabla-promos').querySelectorAll('tr[data-promo]')) {
    const p = S.promos.find((x) => x.id === tr.dataset.promo);
    tr.querySelector('.p-editar').addEventListener('click', () => abrirPromo(p));
    tr.querySelector('.p-activa').addEventListener('click', async () => {
      try { await api('/api/admin/promociones', { ...p, activa: !p.activa }); await vistaPromociones(); }
      catch (e) { const m = $('#msg-promo'); m.className = 'mensaje error'; m.textContent = e.message; }
    });
    const q = tr.querySelector('.p-qr'); if (q) q.addEventListener('click', () => abrirImagenCupon(p));
  }
  const supMsg = (t, tipo = 'error') => { const m = $('#msg-sup'); m.className = `mensaje ${tipo}`; m.textContent = t; };
  $('#form-sup').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    try { await api('/api/admin/supervisores', { nombre: $('#sup-nombre').value, clave: $('#sup-clave').value }); await vistaPromociones(); supMsg('Supervisor agregado.', 'ok'); } catch (e) { supMsg(e.message); }
  });
  for (const tr of $('#tabla-supervisores').querySelectorAll('tr[data-sup]')) {
    const id = tr.dataset.sup;
    const activo = tr.children[1].textContent === 'Activo';
    tr.querySelector('.s-guardar').addEventListener('click', async () => {
      const clave = tr.querySelector('.s-clave').value;
      if (!clave) return supMsg('Escriba la nueva clave.');
      try { await api('/api/admin/supervisores', { id, clave }); await vistaPromociones(); supMsg('Clave cambiada.', 'ok'); } catch (e) { supMsg(e.message); }
    });
    tr.querySelector('.s-activo').addEventListener('click', async () => {
      try { await api('/api/admin/supervisores', { id, activo: !activo }); await vistaPromociones(); } catch (e) { supMsg(e.message); }
    });
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
      ${campo('pr-nombre', 'Nombre (aparece en el ticket)', q.nombre)}
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
        <div class="filas"><div class="campo" style="flex:2"><label for="pr-codigo">Código</label><input id="pr-codigo" class="texto" value="${esc(q.codigo ?? '')}" placeholder="VERANO20"></div>
          <div class="campo" style="flex:1"><label>&nbsp;</label><button class="btn" type="button" id="pr-generar">Generar código</button></div></div>
        <div class="filas"><label><input type="radio" name="pr-cup-tipo" value="pct" ${esPct ? 'checked' : ''}> Porcentaje (%)</label><label><input type="radio" name="pr-cup-tipo" value="monto" ${esPct ? '' : 'checked'}> Monto fijo ($)</label></div>
        ${campo('pr-cup-valor', 'Valor del descuento', esPct ? (q.pct ?? 10) : centavosAPesos(q.monto), 'inputmode="decimal"')}
        ${campo('pr-minimo', 'Compra mínima ($, vacío = sin mínimo; el mínimo se cumple con esa cantidad o más)', q.minimo ? centavosAPesos(q.minimo) : '', 'inputmode="decimal"')}
        ${campo('pr-usos', 'Usos máximos (vacío = sin límite; 1 = un solo uso)', q.usos_max ?? '', 'inputmode="numeric"')}
        <p class="nota">Un cupón no necesita elegir artículos: descuenta sobre toda la compra.</p>
      </div>
      <div data-tipo="nxm paquete por_cada"><label style="margin-top:8px"><input type="checkbox" id="pr-acumulable" ${q.acumulable === false ? '' : 'checked'}> <b>Acumulable</b>: se repite por cada grupo completo (8 piezas de un paquete de 4 = 2 paquetes; $2,650 con «por cada $500, $50» = $250 de descuento). Sin marcar, aplica una sola vez por compra.</label></div>
      <p class="nota">En cada compra aplica una sola promoción o cupón (la que más descuento dé); no se combinan entre sí.</p>
      <label style="margin-top:8px"><input type="checkbox" id="pr-activa" ${q.activa ? 'checked' : ''}> <span id="pr-activa-txt"></span></label>
      <div id="msg-pr" class="mensaje" role="status" aria-live="polite"></div>
      <div class="filas"><button class="btn" type="button" id="pr-cerrar">Cancelar</button><button class="btn btn-primario" type="submit" id="pr-guardar" style="width:auto;flex:1">${ico('check')}<span>Guardar</span></button></div>
    </form>`;
  const mostrar = () => { const t = $('#pr-tipo').value; for (const b of d.querySelectorAll('[data-tipo]')) b.hidden = !b.dataset.tipo.split(' ').includes(t); };
  mostrar();
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
      body.codigo = $('#pr-codigo').value;
      const tipo = d.querySelector('input[name="pr-cup-tipo"]:checked').value;
      if (tipo === 'pct') body.pct = Number($('#pr-cup-valor').value); else { body.monto = parseMXN($('#pr-cup-valor').value); if (!body.monto) return err('Escriba el monto en pesos.'); }
      body.minimo = $('#pr-minimo').value.trim() ? parseMXN($('#pr-minimo').value) : 0;
      if (body.minimo === null) return err('La compra mínima no es válida.');
      body.usos_max = $('#pr-usos').value.trim() ? Number($('#pr-usos').value) : null;
    }
    try { await api('/api/admin/promociones', body); d.close(); if (S.vista === 'promociones') { await vistaPromociones(); const mm = $('#msg-promo'); mm.className = 'mensaje ok'; mm.textContent = 'Guardado.'; } else await ir('promociones'); }
    catch (e) { err(e.message); }
  });
  d.showModal();
}

// ── Configuración: Tiendas, Departamentos y Tipo de cambio en una sola entrada ──
const cuerpoVista = () => $('#config-cuerpo') ?? $('#vista');
const TABS_CONFIG = [['tiendas', 'Tiendas', 'store'], ['departamentos', 'Departamentos', 'box'], ['tipo_cambio', 'Tipo de cambio', 'refresh'], ['cajeros', 'Usuarios', 'user']];
async function vistaConfiguracion(tab) {
  tab = tab ?? S.configTab ?? 'tiendas';
  S.configTab = tab;
  $('#vista').innerHTML = `<div class="titulo-vista">${ico('gear')}<h1>Configuración</h1></div>
    <div class="filas" role="tablist" aria-label="Configuración" style="margin-bottom:12px">${TABS_CONFIG.map(([id, rotulo, icono]) => `<button class="btn" type="button" role="tab" id="cfg-tab-${id}" data-tab="${id}" aria-selected="${id === tab}" style="${id === tab ? 'background:var(--acento);color:var(--acento-texto);border-color:var(--acento)' : ''}">${ico(icono)}<span>${rotulo}</span></button>`).join('')}</div>
    <div id="config-cuerpo" role="tabpanel"></div>`;
  for (const b of $('#vista').querySelectorAll('[role="tab"]')) b.addEventListener('click', () => vistaConfiguracion(b.dataset.tab));
  await ({ tiendas: vistaTiendas, departamentos: vistaDepartamentos, tipo_cambio: vistaTipoCambio, cajeros: vistaCajeros })[tab]();
}

// ── Cajeros: nombre (el del usuario de la caja) y clave propia ──
async function vistaCajeros() {
  const [{ cajeros }, { administradores }, { config }] = await Promise.all([api('/api/admin/cajeros'), api('/api/admin/administradores'), api('/api/admin/config-sesion')]);
  cuerpoVista().innerHTML = `<div class="titulo-vista">${ico('user')}<h1>Usuarios</h1></div>
    <section class="panel" id="panel-admins" style="margin-bottom:12px"><h2 style="margin-top:0">Supervisores y almacenistas (entran a Administración)</h2>
      <p class="nota" style="margin-top:0">${administradores.some((a) => a.activo) ? '<b>Supervisor</b>: ve todo Administración y autoriza operaciones en la caja con su clave de caja (4 a 8 dígitos). <b>Almacenista</b>: solo Inventario y Almacén, y no cambia precios. Entran con su usuario y contraseña (6 a 40 caracteres), que solo viven en el servidor central. Las Vendedoras-Cajeras no entran a Administración.' : '<b>Esta consola está abierta: cualquiera que la abra puede entrar.</b> Cree el primer usuario (debe ser supervisor) para que pida usuario y contraseña. Quien lo crea queda dentro.'}</p>
      <div id="msg-admins" class="mensaje" role="status" aria-live="polite"></div>
      <div class="tabla-cont"><table id="tabla-admins"><thead><tr><th>Nombre</th><th>Rol</th><th>Estado</th><th>Nueva contraseña</th><th>Clave de caja</th><th></th></tr></thead><tbody>
      ${administradores.map((x) => `<tr data-admin="${esc(x.id)}" data-rol="${x.rol}"><td>${esc(x.nombre)}</td><td>${x.rol === 'almacenista' ? 'Almacenista' : 'Supervisor'}</td><td>${x.activo ? 'Activo' : 'Desactivado'}</td><td><input type="password" class="a-clave" placeholder="dejar vacío = no cambiar" aria-label="Nueva contraseña de ${esc(x.nombre)}" style="padding:4px;border:1px solid var(--borde);border-radius:6px;background:var(--superficie)"></td><td>${x.rol === 'supervisor' ? `<input type="password" inputmode="numeric" class="a-clave-caja" placeholder="${x.clave_caja ? 'dejar vacío = no cambiar' : 'sin clave: no autoriza en la caja'}" aria-label="Clave de caja de ${esc(x.nombre)}" style="padding:4px;border:1px solid var(--borde);border-radius:6px;background:var(--superficie)">` : '—'}</td>
        <td class="filas" style="flex-wrap:nowrap"><button class="btn a-guardar" type="button">${ico('check')}<span>Guardar cambios</span></button><button class="btn a-activo" type="button">${x.activo ? 'Desactivar' : 'Activar'}</button></td></tr>`).join('') || '<tr><td colspan="6" class="vacio">Aún no hay usuarios de Administración.</td></tr>'}</tbody></table></div>
      <form id="form-admin" class="filas" style="margin-top:12px;align-items:flex-end"><div class="campo"><label for="adm-nombre">Nombre</label><input id="adm-nombre" class="texto" maxlength="40" autocomplete="off"></div><div class="campo"><label for="adm-clave">Contraseña</label><input id="adm-clave" type="password" autocomplete="new-password"></div>
        <div class="campo"><label for="adm-rol">Rol</label><select id="adm-rol" style="padding:10px;border:2px solid var(--borde);border-radius:10px;background:var(--superficie)"><option value="supervisor">Supervisor</option><option value="almacenista" ${administradores.length ? '' : 'disabled'}>Almacenista</option></select></div>
        <div class="campo" id="adm-caja-campo"><label for="adm-clave-caja">Clave de caja (4 a 8 dígitos)</label><input id="adm-clave-caja" type="password" inputmode="numeric" autocomplete="off"></div>
        <button class="btn btn-primario" id="btn-adm" type="submit" style="width:auto">${ico('plus')}<span>Agregar usuario</span></button></form></section>
    <h2>Vendedoras-Cajeras</h2>
    <p class="nota">Cada Vendedora-Cajera tiene su propia clave (4 a 8 dígitos) para confirmar operaciones a su nombre, como dar de alta un artículo en la caja. El nombre debe ser el del usuario con el que entra a la caja. La clave no se puede volver a ver: si se olvida, se cambia.</p>
    <div id="msg-cajeros" class="mensaje" role="status" aria-live="polite"></div>
    <div class="tabla-cont"><table id="tabla-cajeros"><thead><tr><th>Nombre</th><th>Estado</th><th>Nueva clave</th><th></th></tr></thead><tbody>
    ${cajeros.map((x) => `<tr data-cajero="${esc(x.id)}"><td>${esc(x.nombre)}</td><td>${x.activo ? 'Activo' : 'Desactivado'}</td><td><input type="password" inputmode="numeric" class="c-clave" placeholder="dejar vacío = no cambiar" aria-label="Nueva clave de ${esc(x.nombre)}" style="padding:4px;border:1px solid var(--borde);border-radius:6px;background:var(--superficie)"></td>
      <td class="filas" style="flex-wrap:nowrap"><button class="btn c-guardar" type="button">${ico('check')}<span>Cambiar clave</span></button><button class="btn c-activo" type="button">${x.activo ? 'Desactivar' : 'Activar'}</button></td></tr>`).join('') || '<tr><td colspan="4" class="vacio">Aún no hay Vendedoras-Cajeras con clave: sin ella nadie puede dar de alta artículos en la caja.</td></tr>'}</tbody></table></div>
    <form id="form-cajero" class="filas" style="margin-top:12px;align-items:flex-end"><div class="campo"><label for="caj-nombre">Nombre de la Vendedora-Cajera</label><input id="caj-nombre" class="texto" maxlength="40"></div><div class="campo"><label for="caj-clave">Clave</label><input id="caj-clave" type="password" inputmode="numeric" autocomplete="off"></div>
      <button class="btn btn-primario" id="btn-caj" type="submit" style="width:auto">${ico('plus')}<span>Agregar Vendedora-Cajera</span></button></form>
    <section class="panel" id="panel-inactividad" style="margin-top:16px"><h2 style="margin-top:0">Cierre de sesión por inactividad</h2>
      <p class="nota" style="margin-top:0">Si nadie toca la pantalla durante estos minutos, la sesión se cierra y hay que volver a entrar. Un minuto antes aparece un aviso con «Seguir trabajando». La venta con artículos queda en «Venta en espera». <b>0 = nunca se cierra.</b></p>
      <div id="msg-inactividad" class="mensaje" role="status" aria-live="polite"></div>
      <form id="form-inactividad" class="filas" style="align-items:flex-end"><div class="campo"><label for="ina-caja">Caja (minutos)</label><input id="ina-caja" type="number" min="0" max="480" step="1" value="${config.caja_min}"></div><div class="campo"><label for="ina-admin">Administración (minutos)</label><input id="ina-admin" type="number" min="0" max="480" step="1" value="${config.admin_min}"></div>
        <button class="btn btn-primario" type="submit" id="btn-inactividad" style="width:auto">${ico('check')}<span>Guardar</span></button></form></section>`;
  $('#form-inactividad').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const m = $('#msg-inactividad');
    try { await api('/api/admin/config-sesion', { caja_min: Number($('#ina-caja').value), admin_min: Number($('#ina-admin').value) }); m.className = 'mensaje ok'; m.textContent = 'Guardado. Las cajas lo reciben al sincronizar.'; }
    catch (e) { m.className = 'mensaje error'; m.textContent = e.message; }
  });
  $('#adm-rol').addEventListener('change', () => { $('#adm-caja-campo').hidden = $('#adm-rol').value !== 'supervisor'; });
  const msgA = (t, tipo = 'error') => { const m = $('#msg-admins'); m.className = `mensaje ${tipo}`; m.textContent = t; };
  $('#form-admin').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const eraAbierta = !administradores.some((a) => a.activo);
    try {
      await api('/api/admin/administradores', { nombre: $('#adm-nombre').value, clave: $('#adm-clave').value, rol: $('#adm-rol').value, ...($('#adm-rol').value === 'supervisor' && $('#adm-clave-caja').value ? { clave_caja: $('#adm-clave-caja').value } : {}) });
      if (eraAbierta) { S.sesion = await api('/api/sesion'); await pintarEncabezado(); }
      await vistaCajeros(); msgA('Administrador agregado.', 'ok');
    } catch (e) { msgA(e.message); }
  });
  for (const tr of $('#tabla-admins').querySelectorAll('tr[data-admin]')) {
    const id = tr.dataset.admin;
    const activo = administradores.find((c) => c.id === id).activo;
    tr.querySelector('.a-guardar').addEventListener('click', async () => {
      const clave = tr.querySelector('.a-clave').value;
      const claveCaja = tr.querySelector('.a-clave-caja')?.value ?? '';
      if (!clave && !claveCaja) return msgA('Escriba la nueva contraseña o la nueva clave de caja.');
      try { await api('/api/admin/administradores', { id, ...(clave ? { clave } : {}), ...(claveCaja ? { clave_caja: claveCaja } : {}) }); await vistaCajeros(); msgA('Cambios guardados.', 'ok'); } catch (e) { msgA(e.message); }
    });
    tr.querySelector('.a-activo').addEventListener('click', async () => {
      try { await api('/api/admin/administradores', { id, activo: !activo }); S.sesion = await api('/api/sesion'); await vistaCajeros(); } catch (e) { msgA(e.message); }
    });
  }
  const msgC = (t, tipo = 'error') => { const m = $('#msg-cajeros'); m.className = `mensaje ${tipo}`; m.textContent = t; };
  $('#form-cajero').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    try { await api('/api/admin/cajeros', { nombre: $('#caj-nombre').value, clave: $('#caj-clave').value }); await vistaCajeros(); msgC('Vendedora-Cajera agregada.', 'ok'); } catch (e) { msgC(e.message); }
  });
  for (const tr of $('#tabla-cajeros').querySelectorAll('tr[data-cajero]')) {
    const id = tr.dataset.cajero;
    const activo = cajeros.find((c) => c.id === id).activo;
    tr.querySelector('.c-guardar').addEventListener('click', async () => {
      const clave = tr.querySelector('.c-clave').value;
      if (!clave) return msgC('Escriba la nueva clave.');
      try { await api('/api/admin/cajeros', { id, clave }); await vistaCajeros(); msgC('Clave cambiada.', 'ok'); } catch (e) { msgC(e.message); }
    });
    tr.querySelector('.c-activo').addEventListener('click', async () => { try { await api('/api/admin/cajeros', { id, activo: !activo }); await vistaCajeros(); } catch (e) { msgC(e.message); } });
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
async function vistaTipoCambio() {
  const j = await api('/api/admin/tipo-cambio');
  const v = j.vigente;
  cuerpoVista().innerHTML = `<div class="titulo-vista">${ico('refresh')}<h1>Tipo de cambio del dólar</h1></div>
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
  $('#vista').innerHTML = `<section class="panel" id="login" style="max-width:420px;margin:40px auto"><h1 style="margin-top:0">${ico('user')} Iniciar sesión</h1>
    <form id="form-login" autocomplete="off">
      <div class="campo"><label for="lg-usuario">${admin ? 'Usuario' : 'Vendedora-Cajera'}</label>${!admin && lista.length <= 15 ? `<select id="lg-usuario" style="width:100%;padding:10px;border:2px solid var(--borde);border-radius:10px;background:var(--superficie)">${lista.map((n) => `<option>${esc(n)}</option>`).join('')}</select>` : '<input id="lg-usuario" class="texto" autocomplete="username">'}</div>
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
window.POS_UI = { iniciar };
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
if (!window.__POS_MANUAL__) iniciar();
