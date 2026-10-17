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
  const r = await fetch(ruta, cuerpo === undefined ? {} : { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(cuerpo) });
  const j = await r.json();
  if (!j.ok) { const e = new Error(j.error?.mensaje ?? 'Error'); e.codigo = j.error?.codigo; throw e; }
  return j;
}

const S = { sesion: null, vista: null, cart: null, carrito: null, sel: null, estado: null, ultimoFolio: null, reloj: null };
const hora = (iso) => new Date(Date.parse(iso) - 7 * 3600e3).toISOString().slice(11, 16); // America/Hermosillo (UTC-7)
const fechaHora = (iso) => { const l = new Date(Date.parse(iso) - 7 * 3600e3).toISOString(); return `${l.slice(8, 10)}/${l.slice(5, 7)}/${l.slice(0, 4)} ${l.slice(11, 16)}`; };

// ── encabezado ──
async function pintarEncabezado() {
  const h = $('#encabezado');
  if (S.sesion.rol === 'admin') {
    h.innerHTML = `<div class="chip" data-chip="usuario"><small>Usuario</small><b>${esc(S.sesion.usuario)}</b></div><div class="chip" data-chip="rol"><small>Rol</small><b>Administración</b></div>
      <div class="chip" data-chip="alcance"><small>Alcance</small><b>Una, varias o todas las cajas</b></div>`;
    return;
  }
  const { estado: e } = await api('/api/estado');
  S.estado = e;
  const c = e.conexion;
  const folio = S.ultimoFolio ? `Folio ${String(S.ultimoFolio).padStart(6, '0')}` : 'Venta en curso · folio al cobrar';
  h.innerHTML = `
    <div class="chip" data-chip="tienda"><small>Tienda</small><b>${esc(e.negocio)} (${esc(e.tienda)})</b></div>
    <div class="chip" data-chip="caja"><small>Caja</small><b>${e.caja}</b></div>
    <div class="chip" data-chip="usuario"><small>Cajero</small><b>${esc(e.usuario)}</b></div>
    <div class="chip" data-chip="fecha"><small>Fecha y hora (Hermosillo)</small><b>${fechaHora(e.ahora)}</b></div>
    <div class="chip" data-chip="folio"><small>Venta</small><b>${esc(folio)}</b></div>
    <div class="chip ${c.hub ? 'estado-ok' : 'estado-mal'}" data-chip="hub"><small>Hub de la tienda</small><b>${c.hub ? 'Conectado' : 'Sin conexión'}</b></div>
    <div class="chip ${c.internet === false ? 'estado-mal' : c.internet ? 'estado-ok' : ''}" data-chip="internet"><small>Internet</small><b>${c.internet === null ? 'Sin dato' : c.internet ? 'Conectado' : 'Sin internet'}</b></div>
    <div class="chip" data-chip="pendientes"><small>Pendientes de sincronizar</small><b>${c.pendientes}</b></div>
    <div class="chip" data-chip="sync"><small>Última sincronización</small><b>${c.ultima_sync ? hora(c.ultima_sync) : 'Sin sincronizar'}</b></div>
    ${e.alertas.perdida_documental_abierta ? `<div class="alerta-banda" role="alert" data-alerta="perdida">Hay una posible pérdida de ventas, pagos o folios de esta caja sin resolver (Administración).</div>` : ''}
    ${e.alertas.articulos_no_verificados ? `<div class="alerta-banda" role="status" data-alerta="inventario">Existencias sin verificar: ${e.alertas.articulos_no_verificados} artículos (requieren conteo físico).</div>` : ''}`;
}

// ── navegación ──
const NAV = { venta: 'Venta', corte: 'Mi corte', ventas: 'Ventas de mi caja', reportes: 'Reportes' };
function pintarNav() {
  $('#nav').innerHTML = S.sesion.nav.map((v) => `<button type="button" data-vista="${v}" ${v === S.vista ? 'aria-current="page"' : ''}>${NAV[v]}</button>`).join('');
  for (const b of $('#nav').querySelectorAll('button')) b.addEventListener('click', () => ir(b.dataset.vista));
}
async function ir(v) {
  S.vista = v;
  pintarNav();
  await pintarEncabezado();
  await ({ venta: vistaVenta, corte: vistaCorte, ventas: vistaVentas, reportes: vistaReportes })[v]();
}

// ── venta ──
function msg(texto, tipo = 'ok') { const m = $('#mensaje'); if (m) { m.className = `mensaje ${tipo}`; m.textContent = texto; } }

async function vistaVenta() {
  if (!S.cart) { const r = await api('/api/venta/actual', {}); S.cart = r.cart; S.carrito = r.carrito; }
  $('#vista').innerHTML = `
    <h1>Venta</h1>
    <div class="venta">
      <section class="panel" aria-label="Artículos de la venta">
        <form class="escaneo" id="escaneo" autocomplete="off">
          <label for="scan">Escanear código, Item # o escribir texto del artículo</label>
          <input id="scan" name="scan" inputmode="text" autocomplete="off" spellcheck="false" autofocus>
        </form>
        <div id="mensaje" class="mensaje" role="status" aria-live="polite"></div>
        <div id="resultados"></div>
        <div class="tabla-cont"><table id="tabla-venta"><caption class="sr-only">Artículos de la venta en curso</caption>
          <thead><tr><th>Item #</th><th>Código</th><th>Descripción</th><th>Marca</th><th>Estilo</th><th>Lote</th><th class="num">Cant.</th><th class="num">Precio unit.</th><th class="num">Descuento</th><th class="num">Importe</th><th><span class="sr-only">Acciones</span></th></tr></thead>
          <tbody id="cuerpo"></tbody></table></div>
        <dl class="detalle" id="detalle" hidden></dl>
      </section>
      <aside class="panel resumen" aria-label="Resumen y cobro">
        <dl>
          <dt>Piezas</dt><dd id="piezas">0</dd>
          <dt>Importe antes de descuentos</dt><dd id="brutas">$0.00</dd>
          <dt>Descuentos</dt><dd id="descuentos">$0.00</dd>
        </dl>
        <div class="total"><span>Total</span><b id="total">$0.00</b></div>
        <div class="campo"><label for="recibido">Efectivo recibido (MXN)</label>
          <input id="recibido" inputmode="decimal" autocomplete="off" placeholder="0.00"></div>
        <div class="cambio"><span>Cambio</span><b id="cambio">$0.00</b></div>
        <button class="btn btn-primario" id="btn-cobrar" type="button" disabled>Cobrar en efectivo</button>
        <button class="btn btn-secundario" id="btn-exacto" type="button" disabled>Cliente paga exacto</button>
        <button class="btn btn-secundario" id="btn-regalo" type="button" disabled aria-describedby="nota-regalo">Imprimir ticket de regalo</button>
        <p class="nota" id="nota-regalo">Disponible en una etapa posterior.</p>
      </aside>
    </div>`;
  $('#escaneo').addEventListener('submit', async (ev) => { ev.preventDefault(); await escanear(); });
  $('#recibido').addEventListener('input', recalcular);
  $('#btn-cobrar').addEventListener('click', cobrar);
  $('#btn-exacto').addEventListener('click', () => { $('#recibido').value = (S.carrito.total / 100).toFixed(2); recalcular(); });
  pintarCarrito();
  $('#scan').focus();
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
        <td><button class="btn btn-icono" type="button" data-accion="quitar" aria-label="Quitar ${esc(l.descripcion)} de la venta" title="Quitar de la venta">×</button></td>
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
  const d = $('#detalle');
  d.hidden = !l;
  if (l) d.innerHTML = `<div><dt>Departamento</dt><dd>${esc(l.departamento)}</dd></div><div><dt>Item #</dt><dd>${esc(l.item_no ?? 'pendiente')}</dd></div><div><dt>Código</dt><dd>${esc(l.codigo)}</dd></div><div><dt>Marca</dt><dd>${esc(l.marca)}</dd></div><div><dt>Estilo</dt><dd>${esc(l.estilo)}</dd></div><div><dt>Lote</dt><dd>${esc(l.lote)}</dd></div>`;
  recalcular();
}

function recalcular() {
  const total = S.carrito.total;
  const rec = parseMXN($('#recibido').value);
  const ok = S.carrito.lineas.length > 0 && rec !== null && rec >= total;
  $('#cambio').textContent = rec !== null && rec >= total ? mxn(rec - total) : mxn(0);
  $('#btn-cobrar').disabled = !ok;
  $('#btn-exacto').disabled = !S.carrito.lineas.length;
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
      msg(`El código ${r.codigo} está duplicado en el catálogo. No se agregó nada: avise a Administración para resolverlo.`, 'error');
      $('#resultados').innerHTML = `<ul data-resultado="ambiguo">${r.candidatos.map((c) => `<li>${esc(c.marca)} · ${esc(c.descripcion)} · Estilo ${esc(c.estilo)} · Lote ${esc(c.lote)} · Item # ${esc(c.item_no ?? 'pendiente')}</li>`).join('')}</ul>`;
    } else {
      await buscarTexto(texto);
    }
  } catch (e) { msg(e.message, 'error'); }
  inp.focus();
}

async function buscarTexto(texto) {
  const { resultados } = await api(`/api/buscar?q=${encodeURIComponent(texto)}`);
  if (!resultados.length) return msg(`No se encontró «${texto}» por código, Item # ni texto.`, 'error');
  msg(`${resultados.length} resultado(s) para «${texto}». Elija el artículo.`, 'aviso');
  $('#resultados').innerHTML = `<div class="tabla-cont"><table class="tabla-resultados"><thead><tr><th>Item #</th><th>Código</th><th>Descripción</th><th>Marca</th><th>Estilo</th><th>Lote</th><th class="num">Precio</th><th class="num">Existencia</th><th></th></tr></thead><tbody>${resultados.map((r) => `
    <tr data-item="${r.item_id}"><td>${esc(r.item_no ?? 'pendiente')}</td><td>${esc(r.codigo)}</td><td>${esc(r.descripcion)}</td><td>${esc(r.marca)}</td><td>${esc(r.estilo)}</td><td>${esc(r.lote)}</td><td class="num">${mxn(r.precio)}</td>
    <td class="num">${r.existencia}${r.existencia_verificada ? '' : ' (sin verificar)'}</td>
    <td>${r.duplicado ? '<span class="insignia">Código duplicado</span>' : `<button class="btn" type="button" data-agregar="${r.item_id}">Agregar</button>`}</td></tr>`).join('')}</tbody></table></div>`;
  for (const b of $('#resultados').querySelectorAll('[data-agregar]')) {
    b.addEventListener('click', async () => {
      try {
        const r = await api('/api/venta/agregar', { cart: S.cart, item_id: b.dataset.agregar });
        S.carrito = r.carrito; S.sel = r.linea.linea_id; $('#resultados').innerHTML = '';
        msg(`Agregado: ${r.linea.descripcion} ${r.linea.marca}`); pintarCarrito();
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
  const recibido = parseMXN($('#recibido').value);
  const b = $('#btn-cobrar');
  b.disabled = true;
  try {
    const r = await api('/api/venta/cobrar-efectivo', { cart: S.cart, recibido });
    S.ultimoFolio = r.venta.folio;
    mostrarTicket(r);
    await pintarEncabezado();
  } catch (e) { msg(e.message, 'error'); recalcular(); }
}

function mostrarTicket(r) {
  const dlg = $('#dlg-ticket');
  const imp = r.impresion;
  dlg.innerHTML = `
    <h2 id="dlg-titulo" style="margin:0 0 4px">Venta guardada</h2>
    <p style="margin:0" id="resumen-venta">Folio <b>${String(r.venta.folio).padStart(6, '0')}</b> · ticket <b>${esc(r.codigo_ticket)}</b> · cambio <b id="dlg-cambio">${mxn(r.cambio)}</b></p>
    <div id="estado-impresion" class="mensaje ${imp.ok ? 'ok' : 'error'}" role="status">${imp.ok ? 'Ticket enviado a la impresora.' : `La impresora falló: ${esc(imp.error)}. La venta SÍ quedó guardada; reintente la impresión.`}</div>
    ${(r.avisos ?? []).length ? `<div class="mensaje aviso" id="avisos-venta">${r.avisos.map(esc).join(' · ')}</div>` : ''}
    <pre class="ticket" id="ticket-texto" tabindex="0">${esc(r.ticket_texto)}</pre>
    <div class="filas"><button class="btn" id="btn-reimprimir" type="button">${imp.ok ? 'Reimprimir ticket' : 'Reintentar impresión'}</button><button class="btn btn-primario" id="btn-nueva" type="button" style="width:auto;flex:1">Nueva venta</button></div>`;
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
  ['tickets', 'Tickets', (v) => v], ['ventas_brutas', 'Importe antes de descuentos', mxn], ['descuentos', 'Descuentos', mxn], ['ventas', 'Ventas', mxn],
  ['devoluciones', 'Devoluciones', mxn], ['ventas_netas', 'Ventas netas', mxn], ['cobros_efectivo', 'Cobros en efectivo (MXN)', mxn], ['cobros_tarjeta', 'Cobros con tarjeta', mxn],
  ['fondo_inicial', 'Fondo inicial', mxn], ['entradas', 'Entradas', mxn], ['retiros', 'Retiros', mxn], ['efectivo_esperado', 'Efectivo esperado en caja', mxn],
  ['folio_inicial', 'Folio inicial', (v) => (v ?? '—')], ['folio_final', 'Folio final', (v) => (v ?? '—')], ['tickets_cancelados', 'Tickets cancelados', (v) => v],
];
async function vistaCorte() {
  const j = await api('/api/corte');
  const v = j.vivo;
  $('#vista').innerHTML = `
    <h1>Corte de la caja ${v.caja} — ${esc(v.tienda)} · ${esc(v.fecha)}</h1>
    ${v.perdida_documental_abierta.length ? '<div class="mensaje error" data-alerta="perdida-corte">Este corte puede estar incompleto: hay una posible pérdida de ventas, pagos o folios de esta caja sin resolver.</div>' : ''}
    <div class="panel"><table id="tabla-corte"><tbody>${FILAS_CORTE.map(([k, t, f]) => `<tr data-campo="${k}"><th scope="row">${t}</th><td class="num">${f(v[k])}</td></tr>`).join('')}</tbody></table>
    <p class="nota">Corte en vivo: se calcula con las ventas de ESTA caja. El efectivo cuenta lo aplicado a la venta, no lo recibido.</p>
    <div id="estado-corte">${j.cerrado ? `<div class="mensaje ${j.desactualizado ? 'aviso' : 'ok'}">Corte cerrado${j.desactualizado ? ': hay operaciones posteriores al cierre (no se reescribe el corte cerrado).' : '.'}</div>` : ''}</div>
    <button class="btn" id="btn-cerrar-corte" type="button" ${j.cerrado ? 'disabled' : ''}>Cerrar corte del día</button></div>`;
  $('#btn-cerrar-corte').addEventListener('click', async () => { await api('/api/corte/cerrar', {}); await vistaCorte(); });
}

// ── ventas de la caja ──
async function vistaVentas() {
  const j = await api('/api/ventas');
  $('#vista').innerHTML = `<h1>Ventas de mi caja</h1><div class="panel"><div class="tabla-cont"><table id="tabla-ventas"><thead><tr><th>Folio</th><th>Fecha</th><th>Cajero</th><th class="num">Total</th><th>Estado</th><th>Impresiones</th><th></th></tr></thead><tbody>
    ${j.ventas.length ? j.ventas.map((r) => `<tr data-folio="${r.folio}"><td>${String(r.folio).padStart(6, '0')}</td><td>${esc(r.fecha_local)}</td><td>${esc(r.cajero)}</td><td class="num">${mxn(r.total)}</td><td><span class="insignia ${r.estado}">${esc(r.estado)}</span></td><td>${r.impresiones}${r.ultima_impresion === 'error' ? ' (última falló)' : ''}</td><td><button class="btn" type="button" data-ver="${r.sale_id}">Ver ticket</button></td></tr>`).join('') : '<tr><td colspan="7" class="vacio">Sin ventas hoy en esta caja.</td></tr>'}
    </tbody></table></div></div>`;
  for (const b of $('#vista').querySelectorAll('[data-ver]')) {
    b.addEventListener('click', async () => {
      const t = await api(`/api/ticket?sale_id=${b.dataset.ver}`);
      const dlg = $('#dlg-ticket');
      dlg.innerHTML = `<h2 id="dlg-titulo" style="margin:0">Ticket</h2><pre class="ticket" id="ticket-texto">${esc(t.ticket_texto)}</pre><div class="filas"><button class="btn" id="btn-reimprimir" type="button">Reimprimir</button><button class="btn" id="btn-cerrar" type="button">Cerrar</button></div><div id="estado-impresion" class="mensaje" role="status"></div>`;
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
  $('#vista').innerHTML = `<h1>Reportes de ventas</h1><form class="filtros panel" id="filtros">
    <fieldset><legend>Cajas</legend><label><input type="checkbox" id="todas" checked> Todas</label>
      ${cajas.map((c) => `<label><input type="checkbox" class="caja" value="${c.tienda}/${c.caja}" checked> ${esc(c.tienda)} · Caja ${c.caja}</label>`).join('')}</fieldset>
    <label>Desde <input type="date" id="desde" value="${hoy}"></label><label>Hasta <input type="date" id="hasta" value="${hoy}"></label>
    <button class="btn btn-primario" type="submit" style="width:auto">Consultar</button></form>
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
      <tr><th colspan="3" scope="row">Total consolidado</th><td class="num" id="total-consolidado"><b>${mxn(r.total)}</b></td></tr></tbody></table></div>`;
  });
}

// ── arranque ──
(async function () {
  S.sesion = await api('/api/sesion');
  await ir(S.sesion.nav[0]);
  setInterval(() => { if (S.vista === 'venta' && !$('#dlg-ticket').open) pintarEncabezado().catch(() => {}); }, 5000);
})();
