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
  // El estado de la conexión vive en el encabezado de la pantalla (chip con punto de color y botón de sincronizar); lo dibuja app.js y lo rellena esta función.
  window.__POS_NUBE__ = true;
  function pintarEstado() {
    var e = nube ? nube.estado() : null;
    var el = $('#estado-nube');
    if (!el) return;
    var chip = el.parentNode;
    if (!e || !e.dentro) { el.textContent = 'Sin sesión'; chip.className = 'chip-top sincro-nube'; return; }
    var t = e.sincronizando ? 'Sincronizando…' : e.error ? 'Sin conexión' + (e.pendientes ? ' · ' + e.pendientes + ' por subir' : '') : e.pendientes ? e.pendientes + ' por subir' : 'Sincronizado';
    var cuando = !e.sincronizando && !e.error && !e.pendientes && e.ultimaSync ? ' ' + hora(e.ultimaSync) : '';
    el.innerHTML = '<span class="sn-quien">' + esc(e.usuario) + ' (' + (e.rol === 'supervisor' ? 'supervisor' : 'almacén') + ') · </span>' + esc(t) + '<span class="sn-hora">' + esc(cuando) + '</span>';
    el.className = 'estado-nube' + (e.error ? ' mal' : '');
    chip.className = 'chip-top sincro-nube ' + (e.error ? 'mal' : e.sincronizando ? 'sync' : e.pendientes ? 'pend' : 'ok');
  }
  window.__POS_PINTAR_ESTADO__ = pintarEstado;
  document.addEventListener('click', function (ev) { if (ev.target.closest && ev.target.closest('#btn-sync') && nube) nube.sincronizar(); });

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


  // ── avisos al teléfono (Web Push): la suscripción vive en este dispositivo y sus preferencias en el central ──
  var PREFS_BASE = { venta: true, venta_minima: 0, corte: true, resumen_dia: true, resumen_hora: '21:00', devolucion: true, cancelacion: true, retiro: true, alertas: true, tiendas: ['DUO', 'LON'] };
  function b64url(buf) { var s = ''; new Uint8Array(buf).forEach(function (b) { s += String.fromCharCode(b); }); return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); }
  function desdeB64url(t) { var p = (t + '===').slice(0, t.length + (4 - t.length % 4) % 4).replace(/-/g, '+').replace(/_/g, '/'); var r = atob(p), a = new Uint8Array(r.length); for (var i = 0; i < r.length; i++) a[i] = r.charCodeAt(i); return a; }
  function nombreDispositivo() { var u = navigator.userAgent || ''; return /iPhone/.test(u) ? 'iPhone' : /iPad/.test(u) ? 'iPad' : /Android/.test(u) ? 'Android' : /Mac/.test(u) ? 'Mac' : /Windows/.test(u) ? 'Windows' : 'Navegador'; }
  function suscripcionActual() {
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) return Promise.resolve(null);
    return navigator.serviceWorker.ready.then(function (reg) { return reg.pushManager.getSubscription(); }).catch(function () { return null; });
  }
  window.__POS_NOTIF__ = {
    estado: function () {
      var standalone = (window.matchMedia && matchMedia('(display-mode: standalone)').matches) || navigator.standalone === true;
      var soporte = 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
      var base = { soporte: soporte, instalada: !!standalone, permiso: soporte ? Notification.permission : 'denied', vapid: !!CFG.vapid, suscrito: false, prefs: PREFS_BASE, pausa_hasta: null };
      if (!soporte || !nube) return Promise.resolve(base);
      return suscripcionActual().then(function (sub) {
        if (!sub) return base;
        return nube.cliente.leerSuscripcion(sub.endpoint).then(function (f) {
          if (!f) return base;
          base.suscrito = !!f.activa; base.prefs = Object.assign({}, PREFS_BASE, f.prefs || {}); base.pausa_hasta = f.pausa_hasta || null;
          return base;
        });
      });
    },
    activar: function () {
      if (!CFG.vapid) return Promise.reject(new Error('Este equipo todavía no tiene la llave de avisos (VAPID) configurada.'));
      return Notification.requestPermission().then(function (perm) {
        if (perm !== 'granted') throw new Error('El teléfono no dio permiso para mostrar avisos. Se cambia en Ajustes › Notificaciones.');
        return navigator.serviceWorker.ready;
      }).then(function (reg) {
        return reg.pushManager.getSubscription().then(function (sub) { return sub || reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: desdeB64url(CFG.vapid) }); });
      }).then(function (sub) {
        var j = sub.toJSON();
        return nube.cliente.leerSuscripcion(sub.endpoint).then(function (f) {
          return nube.cliente.guardarSuscripcion({ endpoint: sub.endpoint, p256dh: j.keys.p256dh, auth: j.keys.auth, dispositivo: nombreDispositivo(), prefs: f ? Object.assign({}, PREFS_BASE, f.prefs || {}) : PREFS_BASE, pausa_hasta: f ? f.pausa_hasta : null, activa: true });
        });
      });
    },
    desactivar: function () {
      return suscripcionActual().then(function (sub) {
        if (!sub) return;
        var ep = sub.endpoint;
        return nube.cliente.borrarSuscripcion(ep).then(function () { return sub.unsubscribe(); });
      });
    },
    guardar: function (cambios) {
      return suscripcionActual().then(function (sub) { if (!sub) throw new Error('Primero active los avisos en este teléfono.'); return nube.cliente.cambiarSuscripcion(sub.endpoint, cambios); });
    },
    probar: function () {
      return suscripcionActual().then(function (sub) { if (!sub) throw new Error('Primero active los avisos en este teléfono.'); return nube.cliente.probarNotificacion(sub.endpoint); });
    },
  };

  setInterval(pintarEstado, 5000);
  window.POS_ADMIN = { estado: function () { return nube ? nube.estado() : null; } };
  mostrarPuerta();
})();
