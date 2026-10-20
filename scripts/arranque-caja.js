(function () {
  var $ = function (s) { return document.querySelector(s); };
  var CFG = window.__POS_CENTRAL__ || {};
  var hw = window.posHardware || null;

  // ── lo guardado en ESTE equipo (IndexedDB): el estado de la caja y quién es ──
  function idb() {
    return new Promise(function (res, rej) {
      try { var q = indexedDB.open('londuo-caja', 1); q.onupgradeneeded = function () { q.result.createObjectStore('k'); }; q.onsuccess = function () { res(q.result); }; q.onerror = function () { rej(q.error); }; } catch (e) { rej(e); }
    });
  }
  function leer(k) { return idb().then(function (db) { return new Promise(function (res) { var q = db.transaction('k').objectStore('k').get(k); q.onsuccess = function () { res(q.result); }; q.onerror = function () { res(undefined); }; }); }).catch(function () { return undefined; }); }
  function escribir(k, v) { return idb().then(function (db) { return new Promise(function (res, rej) { var t = db.transaction('k', 'readwrite'); t.objectStore('k').put(v, k); t.oncomplete = function () { res(); }; t.onerror = function () { rej(t.error); }; }); }); }
  var almacen = {
    leer: leer, escribir: escribir,
    leerIdentidad: function () { return leer('identidad'); },
    guardarIdentidad: function (i) { return escribir('identidad', i); },
  };

  var nube = null;
  function conectar(correo, clave) {
    nube = PosCaja.iniciarCajaNube({ cliente: new PosCaja.ClienteSupabase(CFG.url, CFG.llave), almacen: almacen, alCambiar: pintarEstado });
    return nube.entrar(correo, clave);
  }

  // ── pantalla de arranque: conectar con la cuenta de ESTA caja (se pide una sola vez; el equipo la guarda cifrada) ──
  function puerta(mensaje, esError) {
    $('#puerta').hidden = false;
    var m = $('#msg-puerta'); m.textContent = mensaje || ''; m.className = 'mensaje' + (esError ? ' error' : '');
  }
  function arrancar() {
    puerta('Abriendo la caja…');
    var creds = hw && hw.credencialesCaja ? hw.credencialesCaja() : Promise.resolve(null);
    return Promise.resolve(creds).then(function (c) {
      if (!c) { $('#pu-form').hidden = false; puerta('Esta caja todavía no tiene cuenta. Escriba la cuenta de la caja que le dio el administrador.'); return; }
      return conectar(c.correo, c.clave).then(abrir).catch(function (e) {
        $('#pu-form').hidden = false; $('#pu-correo').value = c.correo;
        puerta((e && e.message ? e.message : String(e)) + ' · Puede reintentar o cambiar la cuenta.', true);
      });
    });
  }
  function abrir() { $('#puerta').hidden = true; return window.POS_UI.iniciar(); }
  $('#pu-form').addEventListener('submit', function (ev) {
    ev.preventDefault();
    var correo = $('#pu-correo').value.trim(), clave = $('#pu-clave').value;
    $('#pu-entrar').disabled = true; puerta('Conectando con el central y descargando el catálogo…');
    conectar(correo, clave).then(function () {
      var guardar = hw && hw.guardarCredencialesCaja ? hw.guardarCredencialesCaja({ correo: correo, clave: clave }) : null;
      return Promise.resolve(guardar).then(function () { $('#pu-clave').value = ''; return abrir(); });
    }).catch(function (e) { puerta(e && e.message ? e.message : String(e), true); }).then(function () { $('#pu-entrar').disabled = false; });
  });
  $('#pu-reintentar').addEventListener('click', function () { $('#pu-form').hidden = true; arrancar(); });

  // ── estado de la conexión (barra superior) ──
  function hora(iso) { var d = new Date(iso); return ('0' + d.getHours()).slice(-2) + ':' + ('0' + d.getMinutes()).slice(-2); }
  function pintarEstado() {
    var e = nube ? nube.estado() : null, el = $('#estado-nube');
    if (!e || !e.dentro) { el.textContent = 'Sin conectar'; el.className = 'estado-nube'; return; }
    var t = e.sincronizando ? 'Sincronizando…' : e.error ? 'Sin conexión con el central' + (e.pendientes ? ' · ' + e.pendientes + ' por subir' : '') : e.pendientes ? e.pendientes + ' por subir' : 'Sincronizado' + (e.ultimaSync ? ' ' + hora(e.ultimaSync) : '');
    el.textContent = e.tienda + ' · Caja ' + e.caja + ' · ' + t;
    el.className = 'estado-nube' + (e.error ? ' mal' : '');
  }
  $('#btn-sync').addEventListener('click', function () { if (nube) nube.sincronizar(); });
  setInterval(pintarEstado, 5000);

  // ── contrato con la pantalla del POS ──
  var SIN_SESION = { status: 200, json: { ok: true, rol: 'cajero', requiere_login: true, autenticado: false, usuario: null, cajeros: [], nav: [], tienda: null, caja: null } };
  window.__POS_ATENDER__ = function (m, r, c) {
    if (!nube || !nube.estado().dentro) return Promise.resolve(/^\/api\/sesion/.test(r) ? SIN_SESION : { status: 401, json: { ok: false, error: { codigo: 'SIN_SESION', mensaje: 'La caja no está abierta.' } } });
    return nube.atender(m, r, c).then(function (x) { pintarEstado(); return x; });
  };
  window.addEventListener('pagehide', function () { if (nube) nube.guardarEstado(); });
  window.POS_CAJA = { estado: function () { return nube ? nube.estado() : null; }, sincronizar: function () { return nube ? nube.sincronizar() : Promise.resolve(false); } };
  arrancar();
})();
