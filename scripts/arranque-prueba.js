(function () {
  var $ = function (s) { return document.querySelector(s); };
  var esc = function (v) { return String(v == null ? '' : v).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); };
  var pesos = function (c) { return '$' + (c / 100).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ','); };
  var ctl = PosBanco.iniciarBanco({ alCambiar: function () { aplicar(); pintarAyuda(); window.POS_UI.iniciar(); } });
  window.__POS_AVANZAR__ = function (ms) { ctl.avanzarReloj(ms); };
  window.__POS_TICKET_ESCANEADO__ = function (folio) { ctl.ticketEscaneado(folio); };
  window.__POS_ATENDER__ = function (m, r, c) { return ctl.atender(m, r, c).then(function (x) { $('#falla-imp').checked = ctl.fallaImpresoraActiva(); return x; }); };

  // ── almacenamiento del archivo en ESTE navegador (IndexedDB); nunca se envía a un servidor ──
  function idb() {
    return new Promise(function (res, rej) {
      try {
        var q = indexedDB.open('pos-prueba', 1);
        q.onupgradeneeded = function () { q.result.createObjectStore('k'); };
        q.onsuccess = function () { res(q.result); };
        q.onerror = function () { rej(q.error); };
      } catch (e) { rej(e); }
    });
  }
  function guardar(clave, valor) { return idb().then(function (db) { return new Promise(function (res, rej) { var t = db.transaction('k', 'readwrite'); t.objectStore('k').put(valor, clave); t.oncomplete = function () { res(); }; t.onerror = function () { rej(t.error); }; }); }).catch(function () {}); }
  function leer(clave) { return idb().then(function (db) { return new Promise(function (res) { var q = db.transaction('k').objectStore('k').get(clave); q.onsuccess = function () { res(q.result); }; q.onerror = function () { res(undefined); }; }); }).catch(function () { return undefined; }); }
  function borrar(clave) { return idb().then(function (db) { return new Promise(function (res) { var t = db.transaction('k', 'readwrite'); t.objectStore('k').delete(clave); t.oncomplete = function () { res(); }; }); }).catch(function () {}); }

  function aplicar() {
    var esAdmin = ctl.sesion === 'admin';
    $('#falla-hub').disabled = esAdmin; $('#falla-imp').disabled = esAdmin;
    $('#falla-hub').checked = ctl.hubCaidoActivo(); $('#falla-imp').checked = ctl.fallaImpresoraActiva();
    $('#quitar-inv').hidden = !ctl.inventarioCargado().conInventario;
    $('#estado-inv').textContent = ctl.inventarioCargado().conInventario ? ctl.inventarioCargado().etiqueta : 'Datos de ejemplo (6 artículos). El archivo que importe se lee en este navegador y no se envía a ningún servidor.';
  }
  function pintarAyuda() {
    var inv = ctl.inventarioCargado();
    var filas = inv.conInventario ? inv.muestra : PosBanco.ARTICULOS_DE_PRUEBA.map(function (a) { return { codigo: a.codigo, item_no: a.item_no, descripcion: a.descripcion, marca: a.marca, precio: a.precio, existencia: (a.existencias.DUO || 0) + ' / ' + (a.existencias.LON || 0) }; });
    $('#resumen-ayuda').textContent = inv.conInventario ? 'Artículos de su inventario: qué escanear' : 'Artículos de prueba: qué escanear';
    $('#ayuda').innerHTML = '<div class="tabla-ayuda"><table><thead><tr><th>Código (escanear)</th><th>Item #</th><th>Artículo</th><th>Precio</th><th>Existencia DÚO / London</th></tr></thead><tbody>' +
      filas.map(function (a) { return '<tr><td><code>' + esc(a.codigo) + '</code></td><td>' + esc(a.item_no) + '</td><td>' + esc(a.descripcion) + ' ' + esc(a.marca) + '</td><td>' + pesos(a.precio) + '</td><td>' + esc(a.existencia) + '</td></tr>'; }).join('') + '</tbody></table></div>' +
      (inv.conInventario
        ? '<p>También puede escribir texto (por ejemplo <code>vestido</code>), un Item # o un código alterno. Los artículos sin código solo se encuentran por texto o Item #. Las existencias son de PRUEBA: el archivo no trae cantidades.</p>'
        : '<p>También puede escribir texto (<code>mascada</code>, <code>levis</code>, <code>falda</code>) o un Item # (<code>1003</code>). La BOLSA tiene una sola pieza en DÚO (pruebe venderla desde las dos cajas). Los códigos <code>7508888888888</code> están duplicados a propósito: el POS no adivina cuál es. Tras vender en una caja, cambie a la otra caja de la misma tienda para ver el inventario compartido.</p>');
  }

  var importador = crearImportador({ $: $, esc: esc, pesos: pesos, aplicar: function () { aplicar(); }, guardar: guardar, borrar: borrar,
    cargarInventario: function (ops, texto, muestra, estadoGuardado) { ctl.cargarInventario(ops, texto, muestra, estadoGuardado); $('#sesion-prueba').value = ctl.sesion; },
    });
  $('#quitar-inv').addEventListener('click', function () { Promise.all([borrar('inventario'), borrar('estado')]).then(function () { ctl.quitarInventario(); $('#sesion-prueba').value = ctl.sesion; }); });

  // ── exportar inventario (Administración) ──
  window.__POS_EXPORTAR__ = function (ruta, archivo) {
    var url = ruta ? ruta.replace(/\.xlsx(\?|$)/, function (m, q) { return q === '?' ? '?completo=1&' : '?completo=1'; }) : '/api/admin/inventario?completo=1';
    archivo = archivo || 'inventario.xlsx';
    return ctl.atender('GET', url, undefined).then(function (r) {
      if (!r.json.ok) throw new Error(r.json.error.mensaje);
      return PosBanco.escribirXlsx(window.ExcelJS, [r.json.hoja]);
    }).then(function (bytes) {
      var viewer = window.claude && window.claude.use ? window.claude.use('downloads') : Promise.resolve(null);
      return Promise.resolve(viewer).then(function (d) {
        if (d) {
          return d.save({ filename: archivo, data: bytes }).then(function () { return 'Archivo entregado: ' + archivo; }, function (e) { if (e && e.code === 'declined') return 'Descarga cancelada.'; throw new Error((e && e.message) || 'no se pudo guardar'); });
        }
        var a = document.createElement('a');
        a.href = URL.createObjectURL(new Blob([bytes], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
        a.download = archivo; document.body.appendChild(a); a.click(); a.remove();
        return 'Descarga iniciada: ' + archivo;
      });
    });
  };

  $('#sesion-prueba').addEventListener('change', function (e) { ctl.seleccionar(e.target.value); });
  try { $('#imp-navegador').checked = localStorage.getItem('pos-imp-navegador') === '1'; } catch (e) { /* sin almacenamiento */ }
  $('#imp-navegador').addEventListener('change', function (e) { try { localStorage.setItem('pos-imp-navegador', e.target.checked ? '1' : '0'); } catch (x) { /* sin almacenamiento */ } });
  $('#falla-hub').addEventListener('change', function (e) { ctl.caerHub(ctl.tienda(), e.target.checked); });
  $('#falla-imp').addEventListener('change', function (e) { ctl.fallaImpresora(ctl.sesion, e.target.checked); });
  $('#reiniciar').addEventListener('click', function () { borrar('estado'); ultimaVersion = -1; ctl.reiniciar(); $('#sesion-prueba').value = ctl.sesion; });
  // Una sola ventana: la caja y Administración se alternan desde el menú lateral (en la app real cada sesión es aparte y con acceso propio).
  var ultimaCaja = 'DUO/1';
  window.__POS_CAMBIAR_SESION__ = function (a) {
    if (a === 'admin') { if (ctl.sesion !== 'admin') ultimaCaja = ctl.sesion; ctl.seleccionar('admin'); } else ctl.seleccionar(ultimaCaja);
    $('#sesion-prueba').value = ctl.sesion;
  };
  window.__POS_LEER_XLSX__ = function (archivo) { return archivo.arrayBuffer().then(function (b) { return PosBanco.leerXlsx(window.ExcelJS, new Uint8Array(b)); }); };

  // ── Respaldo cifrado: a una carpeta (p. ej. la que sincroniza OneDrive) o, si el navegador no deja elegir carpeta, como descarga ──
  var RESP_CADA_MS = 30 * 60 * 1000; // respaldo automático si hay cambios y pasaron 30 minutos
  var RESP_CONSERVAR = 30;
  var resp = { cfg: null, carpeta: null, trabajando: false };
  function respHora(iso) { var d = new Date(iso); var hoy = new Date(); var hm = ('0' + d.getHours()).slice(-2) + ':' + ('0' + d.getMinutes()).slice(-2); return d.toDateString() === hoy.toDateString() ? 'hoy ' + hm : d.toLocaleDateString('es-MX') + ' ' + hm; }
  function respEstado(texto, error) { var e = $('#estado-respaldo'); e.textContent = texto; e.style.color = error ? 'var(--error, #b3261e)' : ''; }
  function respPintar() {
    var c = resp.cfg || {};
    var partes = [];
    partes.push(resp.carpeta ? 'Carpeta: ' + resp.carpeta.name : 'Sin carpeta: se descarga el archivo');
    partes.push(c.clave ? 'clave guardada' : 'SIN clave');
    partes.push(c.ultimo ? 'último respaldo: ' + respHora(c.ultimo) : 'aún no hay respaldos');
    respEstado(partes.join(' · '), !c.clave);
  }
  function respGuardarCfg() { return guardar('respaldo-cfg', resp.cfg); }
  function respCargar() {
    return Promise.all([leer('respaldo-cfg'), leer('respaldo-carpeta')]).then(function (r) { resp.cfg = r[0] || {}; resp.carpeta = r[1] || null; respPintar(); });
  }
  function respDialogoClave(titulo, texto, confirmar) {
    return new Promise(function (fin) {
      var d = $('#dlg-respaldo');
      d.innerHTML = '<h2 id="resp-titulo" style="margin-top:0">' + esc(titulo) + '</h2><p>' + texto + '</p><form id="form-resp" autocomplete="off">' +
        '<div class="campo"><label for="resp-k1">Clave</label><input id="resp-k1" type="password" autocomplete="new-password"></div>' +
        (confirmar ? '<div class="campo"><label for="resp-k2">Repita la clave</label><input id="resp-k2" type="password" autocomplete="new-password"></div>' : '') +
        '<div id="msg-resp" class="mensaje error" role="alert"></div><div class="filas"><button class="btn" type="button" id="resp-no">Cancelar</button><button class="btn btn-primario" type="submit" style="width:auto;flex:1">Aceptar</button></div></form>';
      var listo = false;
      function cerrar(v) { if (listo) return; listo = true; d.close(); fin(v); }
      $('#resp-no').addEventListener('click', function () { cerrar(null); });
      d.addEventListener('cancel', function () { cerrar(null); }, { once: true });
      $('#form-resp').addEventListener('submit', function (ev) {
        ev.preventDefault();
        var k = $('#resp-k1').value, m = $('#msg-resp');
        if (k.length < PosBanco.CLAVE_MIN) { m.textContent = 'La clave lleva al menos ' + PosBanco.CLAVE_MIN + ' caracteres.'; return; }
        if (confirmar && k !== $('#resp-k2').value) { m.textContent = 'Las dos claves no coinciden.'; return; }
        cerrar(k);
      });
      d.showModal(); $('#resp-k1').focus();
    });
  }
  function respPedirClaveNueva() {
    return respDialogoClave('Clave del respaldo', 'Cifra los respaldos antes de salir de esta computadora: <b>sin esta clave no se pueden abrir</b>. Anótela y guárdela en un lugar seguro (no en OneDrive junto a los respaldos). Se guarda en este navegador para los respaldos automáticos.', true).then(function (k) {
      if (!k) return null;
      resp.cfg = resp.cfg || {}; resp.cfg.clave = k;
      return respGuardarCfg().then(function () { respPintar(); return k; });
    });
  }
  function respElegirCarpeta() {
    if (!window.showDirectoryPicker) { respEstado('Este navegador no deja elegir una carpeta: el respaldo se descargará como archivo (use Chrome o Edge para elegir la carpeta de OneDrive).', true); return Promise.resolve(); }
    return window.showDirectoryPicker({ id: 'respaldo-pos', mode: 'readwrite', startIn: 'documents' }).then(function (h) {
      resp.carpeta = h;
      return guardar('respaldo-carpeta', h).then(respPintar);
    }).catch(function (e) {
      if (e && e.name === 'AbortError') return;
      respEstado('No se pudo usar esa carpeta (' + (e && e.name === 'SecurityError' ? 'esta ventana no lo permite; abra la página directamente en Chrome o Edge' : (e && e.message)) + '). Se descargará como archivo.', true);
    });
  }
  function respDescargar(nombre, bytes) {
    var viewer = window.claude && window.claude.use ? window.claude.use('downloads') : Promise.resolve(null);
    return Promise.resolve(viewer).then(function (d) {
      if (d) return d.save({ filename: nombre, data: bytes }).then(function () { return 'archivo entregado'; }, function (e) { if (e && e.code === 'declined') throw new Error('descarga cancelada'); throw e; });
      var a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob([bytes], { type: 'application/octet-stream' }));
      a.download = nombre; document.body.appendChild(a); a.click(); a.remove();
      return 'descarga iniciada';
    });
  }
  // Escribe en la carpeta elegida y borra los respaldos más viejos (se conservan los últimos RESP_CONSERVAR).
  function respEscribirEnCarpeta(nombre, bytes, pedirPermiso) {
    var h = resp.carpeta;
    var perm = h.queryPermission ? h.queryPermission({ mode: 'readwrite' }) : Promise.resolve('granted');
    return perm.then(function (p) {
      if (p === 'granted') return p;
      if (!pedirPermiso) throw Object.assign(new Error('La carpeta necesita permiso: pulse «Respaldar ahora».'), { permiso: true });
      return h.requestPermission({ mode: 'readwrite' });
    }).then(function (p) {
      if (p !== 'granted') throw new Error('sin permiso para escribir en la carpeta');
      return h.getFileHandle(nombre, { create: true });
    }).then(function (f) { return f.createWritable(); }).then(function (w) { return w.write(bytes).then(function () { return w.close(); }); }).then(function () {
      var nombres = [];
      return (function leer() { var it = h.values(); return (function paso() { return it.next().then(function (r) { if (r.done) return; if (r.value.kind === 'file') nombres.push(r.value.name); return paso(); }); })(); })().then(function () {
        return Promise.all(PosBanco.sobrantes(nombres, RESP_CONSERVAR).map(function (n) { return h.removeEntry(n).catch(function () {}); }));
      });
    });
  }
  function respHacer(manual) {
    if (resp.trabajando) return Promise.resolve();
    var c = resp.cfg || {};
    if (!c.clave) { if (!manual) return Promise.resolve(); return respPedirClaveNueva().then(function (k) { return k ? respHacer(true) : undefined; }); }
    resp.trabajando = true;
    respEstado('Respaldando…');
    var f = ctl.estadoParaGuardar();
    return leer('inventario').then(function (inv) {
      return PosBanco.cifrarRespaldo({ version: 1, creado: new Date().toISOString(), inventario: inv || null, estado: f.estado || null }, c.clave);
    }).then(function (bytes) {
      var nombre = PosBanco.nombreRespaldo(new Date());
      var destino = resp.carpeta ? respEscribirEnCarpeta(nombre, bytes, manual).then(function () { return 'carpeta ' + resp.carpeta.name; }) : (manual ? respDescargar(nombre, bytes) : Promise.reject(new Error('sin carpeta')));
      return destino.then(function (donde) { resp.cfg.ultimo = new Date().toISOString(); resp.cfg.version = f.version; resp.cfg.ultimoNombre = nombre; return respGuardarCfg().then(function () { respPintar(); respEstado($('#estado-respaldo').textContent + ' (' + nombre + ' → ' + donde + ')'); }); });
    }).catch(function (e) {
      respEstado('El respaldo falló: ' + (e && e.message ? e.message : e) + (resp.carpeta ? '' : ''), true);
    }).then(function () { resp.trabajando = false; });
  }
  function respRestaurar(archivo) {
    return archivo.arrayBuffer().then(function (buf) {
      return respDialogoClave('Restaurar respaldo', 'Escriba la clave con que se cifró <b>' + esc(archivo.name) + '</b>.', false).then(function (k) {
        if (!k) return;
        return PosBanco.descifrarRespaldo(new Uint8Array(buf), k).then(function (p) {
          var d = $('#dlg-respaldo');
          var inv = p.inventario ? esc(p.inventario.nombre || 'inventario importado') : 'datos de ejemplo';
          d.innerHTML = '<h2 id="resp-titulo" style="margin-top:0">¿Restaurar este respaldo?</h2><p id="resp-detalle">Respaldo del <b>' + esc(respHora(p.creado)) + '</b> · inventario: <b>' + inv + '</b>.</p><p class="mensaje aviso">Esto <b>reemplaza todo</b> lo que hay ahora en este navegador (ventas, altas, inventario). No se puede deshacer.</p><div class="filas"><button class="btn" type="button" id="resp-no">Cancelar</button><button class="btn btn-peligro" type="button" id="resp-si" style="width:auto;flex:1">Sí, restaurar</button></div>';
          $('#resp-no').addEventListener('click', function () { d.close(); });
          $('#resp-si').addEventListener('click', function () {
            Promise.all([p.inventario ? guardar('inventario', p.inventario) : borrar('inventario'), p.estado ? guardar('estado', p.estado) : borrar('estado')]).then(function () { d.close(); location.reload(); });
          });
          d.showModal();
        });
      }).catch(function (e) { respEstado('No se pudo restaurar: ' + (e && e.message ? e.message : e), true); });
    });
  }
  $('#resp-clave').addEventListener('click', function () { respPedirClaveNueva(); });
  $('#resp-carpeta').addEventListener('click', function () { respElegirCarpeta(); });
  $('#resp-ahora').addEventListener('click', function () { respHacer(true); });
  $('#resp-restaurar').addEventListener('click', function () { $('#resp-archivo').click(); });
  $('#resp-archivo').addEventListener('change', function (e) { var f = e.target.files[0]; e.target.value = ''; if (f) respRestaurar(f); });
  respCargar();
  // Automático: cada minuto se revisa si hay cambios y ya pasaron RESP_CADA_MS desde el último respaldo (solo con carpeta y clave).
  setInterval(function () {
    var c = resp.cfg || {};
    if (!c.clave || !resp.carpeta || resp.trabajando) return;
    if (c.ultimo && Date.now() - Date.parse(c.ultimo) < RESP_CADA_MS) return;
    if (ctl.estadoParaGuardar().version === c.version && c.ultimo) return;
    respHacer(false);
  }, 60 * 1000);
  window.__POS_RESPALDAR__ = function () { return respHacer(true); };
  window.POS_PRUEBA = ctl;
  aplicar(); pintarAyuda();
  window.POS_UI.iniciar();

  // Todo lo que se haga (altas de almacén, entregas, ventas, departamentos…) se conserva en ESTE navegador y vuelve al abrir la página.
  var ultimaVersion = -1;
  var listo = false; // no se guarda nada hasta terminar de recuperar lo anterior (si no, se pisaría con un banco vacío)
  function guardarEstado() {
    if (!listo) return Promise.resolve();
    var f = ctl.estadoParaGuardar();
    if (f.version === ultimaVersion) return Promise.resolve();
    ultimaVersion = f.version;
    return guardar('estado', f.estado);
  }
  setInterval(guardarEstado, 2000);
  window.addEventListener('pagehide', guardarEstado);
  document.addEventListener('visibilitychange', function () { if (document.hidden) guardarEstado(); });
  window.__POS_GUARDAR_ESTADO__ = guardarEstado;

  // Si ya se importó un inventario en este navegador, se vuelve a cargar solo (con lo que se hizo después).
  Promise.all([leer('inventario'), leer('estado')]).then(function (r) {
    var g = r[0], est = r[1];
    if (!g) {
      if (est && !est.conInventario) { ctl.restaurar(est); $('#sesion-prueba').value = ctl.sesion; }
      return;
    }
    $('#estado-inv').textContent = 'Cargando el inventario guardado en este navegador…';
    return PosBanco.leerXlsx(window.ExcelJS, g.bytes).then(function (hojas) {
      importador.recargar(g, hojas, est && est.conInventario ? est : undefined);
    });
  }).catch(function () { aplicar(); }).then(function () { ultimaVersion = -1; listo = true; });
})();
