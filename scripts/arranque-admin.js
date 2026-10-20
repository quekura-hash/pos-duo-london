(function () {
  var $ = function (s) { return document.querySelector(s); };
  var esc = function (v) { return String(v == null ? '' : v).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); };
  var pesos = function (c) { return '$' + (c / 100).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ','); };
  var CFG = window.__POS_CENTRAL__ || {};
  window.PosBanco = PosAdmin; // el importador de inventario (compartido con la página de prueba) usa este nombre

  // ── réplica guardada en ESTE equipo (IndexedDB): una por usuario ──
  function idb() {
    return new Promise(function (res, rej) {
      try { var q = indexedDB.open('londuo-admin', 1); q.onupgradeneeded = function () { q.result.createObjectStore('k'); }; q.onsuccess = function () { res(q.result); }; q.onerror = function () { rej(q.error); }; } catch (e) { rej(e); }
    });
  }
  var almacen = {
    leer: function (k) { return idb().then(function (db) { return new Promise(function (res) { var q = db.transaction('k').objectStore('k').get(k); q.onsuccess = function () { res(q.result); }; q.onerror = function () { res(undefined); }; }); }).catch(function () { return undefined; }); },
    escribir: function (k, v) { return idb().then(function (db) { return new Promise(function (res, rej) { var t = db.transaction('k', 'readwrite'); t.objectStore('k').put(v, k); t.oncomplete = function () { res(); }; t.onerror = function () { rej(t.error); }; }); }); },
    borrar: function (k) { return idb().then(function (db) { return new Promise(function (res) { var t = db.transaction('k', 'readwrite'); t.objectStore('k').delete(k); t.oncomplete = function () { res(); }; }); }).catch(function () {}); },
  };
  function pref(k, v) { try { if (v === undefined) return localStorage.getItem('londuo-' + k) || ''; localStorage.setItem('londuo-' + k, v); } catch (e) { /* sin almacenamiento */ } return ''; }

  var nube = null;
  function crear() {
    var url = CFG.url || pref('url') || '';
    var llave = CFG.llave || pref('llave') || '';
    if (!url || !llave) return null;
    return PosAdmin.iniciarAdminNube({
      cliente: new PosAdmin.ClienteSupabase(url, llave), almacen: almacen,
      alCambiar: pintarEstado, alSalir: function () { mostrarPuerta(); },
    });
  }

  // ── puerta de entrada (inicio de sesión del central) ──
  function mostrarPuerta(mensaje) {
    var p = $('#puerta'); p.hidden = false;
    $('#msg-puerta').textContent = mensaje || '';
    $('#msg-puerta').className = mensaje ? 'mensaje error' : 'mensaje';
    $('#pu-clave').value = '';
    var sinCfg = !(CFG.url || pref('url')) || !(CFG.llave || pref('llave'));
    $('#pu-proyecto').open = sinCfg;
    $('#pu-proyecto').hidden = !!(CFG.url && CFG.llave); // con el proyecto fijado al construir, solo se piden correo y contraseña
    $('#pu-url').value = CFG.url || pref('url') || ''; $('#pu-llave').value = CFG.llave || pref('llave') || '';
    $('#pu-correo').value = pref('correo');
    ($('#pu-correo').value ? $('#pu-clave') : $('#pu-correo')).focus();
  }
  $('#form-puerta').addEventListener('submit', function (ev) {
    ev.preventDefault();
    var b = $('#pu-entrar'); b.disabled = true;
    pref('url', $('#pu-url').value.trim()); pref('llave', $('#pu-llave').value.trim()); pref('correo', $('#pu-correo').value.trim());
    nube = crear();
    if (!nube) { b.disabled = false; mostrarPuerta('Falta la dirección del proyecto y su llave pública.'); return; }
    $('#msg-puerta').className = 'mensaje'; $('#msg-puerta').textContent = 'Entrando y descargando la información…';
    nube.entrar($('#pu-correo').value.trim(), $('#pu-clave').value).then(function () {
      $('#puerta').hidden = true; $('#pu-clave').value = '';
      return window.POS_UI.iniciar();
    }).catch(function (e) { mostrarPuerta(e && e.message ? e.message : String(e)); }).then(function () { b.disabled = false; });
  });

  // ── estado de la conexión (barra superior) ──
  function hora(iso) { var d = new Date(iso); return ('0' + d.getHours()).slice(-2) + ':' + ('0' + d.getMinutes()).slice(-2); }
  function pintarEstado() {
    var e = nube ? nube.estado() : null;
    var el = $('#estado-nube');
    if (!e || !e.dentro) { el.textContent = 'Sin sesión'; el.className = 'estado-nube'; return; }
    var t = e.sincronizando ? 'Sincronizando…' : e.error ? 'Sin conexión con el central · ' + e.pendientes + ' cambio(s) por subir' : e.pendientes ? e.pendientes + ' cambio(s) por subir' : 'Sincronizado' + (e.ultimaSync ? ' ' + hora(e.ultimaSync) : '');
    el.textContent = e.usuario + ' (' + (e.rol === 'supervisor' ? 'supervisor' : 'almacén') + ') · ' + t;
    el.className = 'estado-nube' + (e.error ? ' mal' : '');
  }
  $('#btn-sync').addEventListener('click', function () { if (nube) nube.sincronizar(); });

  // ── contrato con la pantalla (mismo que la página de prueba) ──
  var SIN_SESION = { status: 200, json: { ok: true, rol: 'admin', requiere_login: true, autenticado: false, usuario: null, rol_usuario: null, sin_administradores: false, inactividad: null, cajas: [], nav: [] } };
  window.__POS_ATENDER__ = function (m, r, c) {
    if (!nube || !nube.estado().dentro) return Promise.resolve(/^\/api\/sesion/.test(r) ? SIN_SESION : { status: 401, json: { ok: false, error: { codigo: 'SIN_SESION', mensaje: 'Inicie sesión.' } } });
    return nube.atender(m, r, c).then(function (x) { pintarEstado(); return x; });
  };
  window.__POS_LEER_XLSX__ = function (archivo) { return archivo.arrayBuffer().then(function (b) { return PosAdmin.leerXlsx(window.ExcelJS, new Uint8Array(b)); }); };
  window.__POS_EXPORTAR__ = function (ruta, archivo) {
    var url = ruta ? ruta.replace(/\.xlsx(\?|$)/, function (m, q) { return q === '?' ? '?completo=1&' : '?completo=1'; }) : '/api/admin/inventario?completo=1';
    archivo = archivo || 'inventario.xlsx';
    return window.__POS_ATENDER__('GET', url, undefined).then(function (r) {
      if (!r.json.ok) throw new Error(r.json.error.mensaje);
      return PosAdmin.escribirXlsx(window.ExcelJS, [r.json.hoja]);
    }).then(function (bytes) {
      var a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob([bytes], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
      a.download = archivo; document.body.appendChild(a); a.click(); a.remove();
      return 'Descarga iniciada: ' + archivo;
    });
  };

  // ── cargar el catálogo desde Excel: las operaciones se agregan a la réplica y se suben al central ──
  var importador = crearImportador({ $: $, esc: esc, pesos: pesos, aplicar: function () {}, guardar: function () { return Promise.resolve(); }, borrar: function () { return Promise.resolve(); },
    cargarInventario: function (ops, texto) {
      var n = nube.agregarOps(ops);
      $('#estado-inv').textContent = texto + ' · ' + n + ' operaciones nuevas (se suben al central).';
      pintarEstado();
      window.POS_UI.iniciar();
    } });
  void importador;

  // ── corregir departamentos y marcas en bloque (Excel de correcciones + el inventario original) ──
  function leerHojas(archivo) { return archivo.arrayBuffer().then(function (b) { return PosAdmin.leerXlsx(window.ExcelJS, new Uint8Array(b)); }); }
  window.__POS_CORREGIR_CATALOGO__ = function () {
    var d = $('#dlg-correcciones');
    var corr = null, orig = null, plan = null;
    d.innerHTML = '<h2 id="corr-titulo">Corregir departamentos y marcas</h2>' +
      '<p><small>Use el Excel de correcciones que llenó y el <b>mismo archivo de inventario que cargó</b> (hace falta para saber de qué texto vino cada artículo). Solo se tocan los artículos que siguen en «Sin clasificar»; una marca que ya existe se conserva.</small></p>' +
      '<div class="campo"><label for="corr-f1">1. Archivo de correcciones</label><input id="corr-f1" type="file" accept=".xlsx"></div>' +
      '<div class="campo"><label for="corr-f2">2. Inventario original (el que cargó)</label><input id="corr-f2" type="file" accept=".xlsx"></div>' +
      '<div id="corr-msg" class="mensaje" role="status"></div><div id="corr-resumen"></div>' +
      '<div class="filas"><button class="btn" type="button" id="corr-cancelar">Cerrar</button><button class="btn btn-primario" type="button" id="corr-aplicar" style="width:auto;flex:1" disabled>Aplicar correcciones</button></div>';
    function msg(t, mal) { var m = $('#corr-msg'); m.textContent = t || ''; m.className = 'mensaje' + (mal ? ' error' : ''); }
    function pensar() {
      plan = null; $('#corr-aplicar').disabled = true; $('#corr-resumen').innerHTML = '';
      if (!corr || !orig) return;
      var lc = PosAdmin.leerCorrecciones(corr);
      if (lc.errores.length) return msg(lc.errores[0], true);
      var dc = nube.datosCatalogo();
      plan = PosAdmin.planCorrecciones({ correcciones: lc.filas, inventarioOriginal: orig, catalogo: dc.catalogo, deptosActivos: dc.deptosActivos, por: dc.usuario, ahora: dc.ahora });
      var r = plan.resumen;
      msg('');
      $('#corr-resumen').innerHTML = '<table><tbody>' +
        '<tr><td>Artículos que cambian</td><td><b>' + r.articulosCambiados + '</b></td></tr>' +
        '<tr><td>· con departamento nuevo</td><td>' + r.departamentosCambiados + '</td></tr>' +
        '<tr><td>· con marca puesta</td><td>' + r.marcasPuestas + '</td></tr>' +
        '<tr><td>Conservan su marca</td><td>' + r.conMarcaPropia + '</td></tr>' +
        '<tr><td>Ya estaban clasificados (se respetan)</td><td>' + r.yaClasificados + '</td></tr>' +
        '<tr><td>Renglones sin decisión (quedan como están)</td><td>' + r.sinDecision + '</td></tr>' +
        (r.deptosInvalidos.length ? '<tr><td>Departamento que no existe (no se aplican)</td><td>' + r.deptosInvalidos.length + '</td></tr>' : '') +
        (r.sinCoincidencia.length ? '<tr><td>Textos que no están en el inventario original</td><td><b>' + r.sinCoincidencia.length + '</b></td></tr>' : '') +
        '</tbody></table>' + (r.sinCoincidencia.length ? '<p class="nota">Si hay textos sin coincidencia, quizá el inventario original no es el mismo que cargó.</p>' : '');
      $('#corr-aplicar').disabled = plan.ops.length === 0;
    }
    function elegir(id, destino) {
      $(id).addEventListener('change', function (e) {
        var f = e.target.files[0]; if (!f) return;
        msg('Leyendo ' + f.name + '…');
        leerHojas(f).then(function (h) { var fila = h[0] ? h[0].filas : []; if (destino === 1) corr = fila; else orig = fila; pensar(); if (!$('#corr-resumen').innerHTML) msg(''); })
          .catch(function (er) { msg('No se pudo leer el archivo: ' + er.message, true); });
      });
    }
    elegir('#corr-f1', 1); elegir('#corr-f2', 2);
    $('#corr-cancelar').addEventListener('click', function () { d.close(); });
    $('#corr-aplicar').addEventListener('click', function () {
      if (!plan) return;
      var n = nube.agregarOps(plan.ops);
      d.close();
      $('#estado-inv').textContent = 'Correcciones aplicadas: ' + n + ' artículos (se suben al central).';
      pintarEstado();
      window.POS_UI.iniciar();
    });
    d.showModal();
  };
  setInterval(pintarEstado, 5000);
  window.POS_ADMIN = { estado: function () { return nube ? nube.estado() : null; } };
  mostrarPuerta();
})();
