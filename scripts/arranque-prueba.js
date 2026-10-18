(function () {
  var $ = function (s) { return document.querySelector(s); };
  var esc = function (v) { return String(v == null ? '' : v).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); };
  var pesos = function (c) { return '$' + (c / 100).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ','); };
  var ctl = PosBanco.iniciarBanco({ alCambiar: function () { aplicar(); pintarAyuda(); window.POS_UI.iniciar(); } });
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

  // ── importar inventario (.xlsx) ──
  var estado = null; // { nombre, bytes, hojas, hoja, perfil, duo, lon, decisiones, regla }
  var NOM_ESTADO = { vacio: 'Sin departamento', exacto: 'Reconocido', alias: 'Reconocido (otra forma de escribirlo)', descontinuado: 'Ya no se vende', sugerido: 'Parecido a uno existente: confirme', desconocido: 'Desconocido: elija' };
  function activos() { return PosBanco.DEPARTAMENTOS_BASE.filter(function (d) { return d.activo; }).map(function (d) { return d.nombre; }); }
  var ETQ = { item_no: 'Item #', codigo: 'Código', marca: 'Marca', descripcion: 'Descripción', estilo: 'Estilo', lote: 'Lote', departamento: 'Departamento', precio: 'Precio de venta', precio_alterno: 'Precio alterno', codigo_alterno: 'Código alterno', etiqueta_costura: 'Etiqueta costura', etiqueta_precio: 'Etiqueta precio', pedimento: 'Pedimento', codigo_2: 'Código 2', existencia: 'Existencia' };
  var ROT = { bloquea_venta: 'No se puede vender', revisar: 'Revisar', info: 'Informativo' };
  var NOM_ANOM = { sin_codigo: 'Sin código (no se escanea)', item_no_duplicado: 'Item # repetido', codigo_duplicado: 'Código repetido', precio_cero: 'Precio 0', precio_negativo: 'Precio negativo', cupon_obsoleto: 'Cupón o certificado del sistema anterior (no se importa)', precio_ilegible: 'Precio ilegible', precio_con_centavos: 'Precio con centavos', codigo_numerico_posible_truncamiento: 'Código guardado como número', codigo_con_espacios: 'Código con espacios', item_no_ausente: 'Sin Item #', alterno_coincide_con_codigo: 'Código alterno igual al código de otro', existencia_ilegible: 'Existencia ilegible' };
  function lectura() { return PosBanco.leerInventario(estado.hojas[estado.hoja].filas, PosBanco.PERFILES[estado.perfil]); }
  function pintarImportacion() {
    var r = lectura();
    var e = r.estadisticas;
    var d = $('#dlg-importar');
    var cols = r.columnas;
    d.innerHTML = '<h2 id="dlg-imp-titulo">Importar inventario</h2>' +
      '<p><strong>' + esc(estado.nombre) + '</strong>' + (estado.hojas.length > 1 ? ' · hoja <select id="imp-hoja">' + estado.hojas.map(function (h, i) { return '<option value="' + i + '"' + (i === estado.hoja ? ' selected' : '') + '>' + esc(h.nombre) + '</option>'; }).join('') + '</select>' : ' · hoja ' + esc(estado.hojas[estado.hoja].nombre)) + '</p>' +
      (r.errores.length ? '<div class="mensaje error" id="imp-errores">' + r.errores.map(esc).join('<br>') + '</div>' : '') +
      '<fieldset><legend>Cómo se interpretan «Item Name» e «Item Description»</legend>' +
      PosBanco.PERFILES.map(function (p, i) { return '<label><input type="radio" name="imp-perfil" value="' + i + '"' + (i === estado.perfil ? ' checked' : '') + '> <strong>' + esc(p.titulo) + '</strong><br><small>' + esc(p.explicacion) + '</small></label>'; }).join('') + '</fieldset>' +
      '<p id="imp-resumen"><strong>' + e.filas + '</strong> artículos · con código <strong>' + e.con_codigo + '</strong> · sin código <strong>' + e.sin_codigo + '</strong> · sin descripción <strong>' + e.descripcion_vacia + '</strong> · sin marca <strong>' + e.marca_vacia + '</strong> · precio no vendible <strong>' + e.precio_no_vendible + '</strong></p>' +
      '<p><small>Columnas reconocidas: ' + esc(Object.keys(cols.usadas).map(function (k) { return ETQ[k] + ' ← ' + cols.usadas[k]; }).join(' · ')) + (cols.ignoradas.length ? ' · ignoradas: ' + esc(cols.ignoradas.join(', ')) : '') + (cols.faltantes.indexOf('existencia') >= 0 ? ' · <strong>el archivo no trae cantidades</strong>' : '') + '</small></p>' +
      '<div class="tabla-cont"><table id="imp-previa"><thead><tr><th>Item #</th><th>Código</th><th>Marca</th><th>Descripción</th><th>Estilo</th><th>Lote</th><th class="num">Precio</th></tr></thead><tbody>' +
      r.articulos.slice(0, 6).map(function (a) { return '<tr><td>' + esc(a.item_no) + '</td><td>' + esc(a.codigo) + '</td><td>' + esc(a.marca) + '</td><td>' + esc(a.descripcion) + '</td><td>' + esc(a.estilo) + '</td><td>' + esc(a.lote) + '</td><td class="num">' + pesos(a.precio) + '</td></tr>'; }).join('') + '</tbody></table></div>' +
      '<h3>Departamentos del archivo</h3>' +
      '<p><small>Los nombres que no coinciden con un departamento del sistema se sugieren aquí; elija el destino de cada uno antes de cargar. Lo que no se reconoce queda en «Sin clasificar».</small></p>' +
      '<div class="tabla-cont anomalias"><table id="imp-deptos"><thead><tr><th>En el archivo</th><th class="num">Artículos</th><th>Situación</th><th>Departamento en el sistema</th></tr></thead><tbody>' +
      r.departamentos.map(function (g) {
        var elegido = estado.decisiones[g.clave] || g.propuesto;
        var aviso = (g.estado === 'sugerido' || g.estado === 'desconocido' || g.estado === 'descontinuado' || g.estado === 'vacio') ? ' class="aviso-depto"' : '';
        return '<tr data-clave="' + esc(g.clave) + '" data-estado="' + g.estado + '"' + aviso + '><td>' + (g.original ? esc(g.original) : '<em>(vacío)</em>') + '</td><td class="num">' + g.articulos + '</td><td>' + NOM_ESTADO[g.estado] + (g.estado === 'sugerido' ? ': ¿«' + esc(g.propuesto) + '»?' : '') + '</td><td><select class="sel-depto" data-clave="' + esc(g.clave) + '">' +
          activos().map(function (n) { return '<option' + (n === elegido ? ' selected' : '') + '>' + esc(n) + '</option>'; }).join('') + '</select></td></tr>';
      }).join('') + '</tbody></table></div>' +
      '<label><input type="checkbox" id="imp-regla-env"' + (estado.regla ? ' checked' : '') + '> Mover las bolsas y cajas de regalo (' + r.envolturas + ' artículos por su descripción) a «Envolturas y Bolsas de regalo»</label>' +
      '<h3>Hallazgos del archivo</h3><div class="tabla-cont anomalias"><table id="imp-anomalias"><thead><tr><th>Tipo</th><th>Gravedad</th><th class="num">Filas</th><th>Ejemplo</th></tr></thead><tbody>' +
      r.porTipo.map(function (t) { return '<tr data-tipo="' + t.tipo + '"><td>' + esc(NOM_ANOM[t.tipo] || t.tipo) + '</td><td>' + ROT[t.severidad] + '</td><td class="num">' + t.cantidad + '</td><td>fila ' + t.ejemplos[0].fila + ': ' + esc(t.ejemplos[0].detalle) + '</td></tr>'; }).join('') + '</tbody></table></div>' +
      '<p><small>Nada se descarta ni se corrige: las filas con hallazgos se cargan tal cual y quedan señaladas. Los artículos con precio no vendible no se pueden agregar a una venta.</small></p>' +
      '<fieldset><legend>Existencia (el archivo no trae cantidades)</legend>' +
      '<label><input type="radio" name="imp-modo" id="imp-modo-limbo" value="limbo"' + (estado.modo === 'limbo' ? ' checked' : '') + '> <strong>Catálogo inicial en «El Limbo»</strong><br><small>Todas las tiendas y cajas venden estas piezas y se descuentan de El Limbo, un almacén virtual con todo etiquetado (precio y costura). Si no hay cantidad registrada queda en 0 y el saldo baja con las ventas hasta que se cuente.</small></label>' +
      '<label style="margin-left:24px">Piezas por artículo en El Limbo <input type="number" id="imp-limbo" min="0" max="999" value="' + estado.limbo + '"' + (estado.modo === 'limbo' ? '' : ' disabled') + '></label>' +
      '<label><input type="radio" name="imp-modo" id="imp-modo-prueba" value="prueba"' + (estado.modo === 'prueba' ? ' checked' : '') + '> <strong>Existencia de PRUEBA por tienda</strong></label>' +
      '<label style="margin-left:24px">Piezas por artículo en DÚO <input type="number" id="imp-duo" min="0" max="999" value="' + estado.duo + '"' + (estado.modo === 'prueba' ? '' : ' disabled') + '></label>' +
      '<label style="margin-left:24px">Piezas por artículo en London <input type="number" id="imp-lon" min="0" max="999" value="' + estado.lon + '"' + (estado.modo === 'prueba' ? '' : ' disabled') + '></label>' +
      '<small>La existencia de prueba se registra como movimientos marcados «existencia_prueba». Ambas opciones solo cubren artículos con precio vendible.</small></fieldset>' +
      '<div class="filas"><button class="btn" type="button" id="imp-cancelar">Cancelar</button><button class="btn btn-primario" type="button" id="imp-cargar" style="width:auto;flex:1"' + (r.errores.length ? ' disabled' : '') + '>Cargar ' + e.filas + ' artículos al sistema</button></div>';
    var h = $('#imp-hoja'); if (h) h.addEventListener('change', function (ev) { estado.hoja = Number(ev.target.value); pintarImportacion(); });
    function leerExistencia() { estado.duo = Number($('#imp-duo').value) || 0; estado.lon = Number($('#imp-lon').value) || 0; estado.limbo = Number($('#imp-limbo').value) || 0; }
    Array.prototype.forEach.call(d.querySelectorAll('input[name="imp-perfil"]'), function (x) { x.addEventListener('change', function (ev) { estado.perfil = Number(ev.target.value); leerExistencia(); pintarImportacion(); }); });
    Array.prototype.forEach.call(d.querySelectorAll('input[name="imp-modo"]'), function (x) { x.addEventListener('change', function (ev) { leerExistencia(); estado.modo = ev.target.value; pintarImportacion(); }); });
    Array.prototype.forEach.call(d.querySelectorAll('.sel-depto'), function (x) { x.addEventListener('change', function (ev) { estado.decisiones[ev.target.getAttribute('data-clave')] = ev.target.value; }); });
    $('#imp-regla-env').addEventListener('change', function (ev) { estado.regla = ev.target.checked; });
    $('#imp-cancelar').addEventListener('click', function () { d.close(); });
    $('#imp-cargar').addEventListener('click', function () { leerExistencia(); cargar(true); });
  }
  function cargar(guardarArchivo, estadoGuardado) {
    var r = lectura();
    var dep = PosBanco.aplicarDepartamentos(r.articulos, PosBanco.DEPARTAMENTOS_BASE, { decisiones: estado.decisiones, reglaEnvolturas: estado.regla });
    var o = PosBanco.aOperacionesInventario(dep.articulos, { ahora: new Date().toISOString(), idImportacion: 'imp1', existenciaPrueba: estado.modo === 'prueba' ? { DUO: estado.duo, LON: estado.lon } : {}, limbo: estado.modo === 'limbo' ? { piezas: estado.limbo } : undefined });
    var muestra = dep.articulos.filter(function (a) { return a.codigo && a.precio > 0; }).slice(0, 8).map(function (a) { return { codigo: a.codigo, item_no: a.item_no, descripcion: a.descripcion || '(sin descripción)', marca: a.marca, precio: a.precio, existencia: estado.modo === 'limbo' ? 'El Limbo ' + estado.limbo : estado.duo + ' / ' + estado.lon }; });
    var texto = 'Inventario cargado: ' + estado.nombre + ' · ' + r.estadisticas.filas + ' artículos · mapeo «' + PosBanco.PERFILES[estado.perfil].id + '» · ' + (estado.modo === 'limbo' ? 'catálogo inicial en El Limbo (' + estado.limbo + ' pza por artículo)' : 'existencia de prueba DÚO ' + estado.duo + ', London ' + estado.lon);
    if (guardarArchivo) borrar('estado'); // inventario nuevo = base nueva: lo guardado era de la base anterior
    ctl.cargarInventario(o.ops, texto, muestra, estadoGuardado);
    if (guardarArchivo) guardar('inventario', { nombre: estado.nombre, bytes: estado.bytes, hoja: estado.hoja, perfil: estado.perfil, modo: estado.modo, limbo: estado.limbo, duo: estado.duo, lon: estado.lon, decisiones: estado.decisiones, regla: estado.regla });
    var d = $('#dlg-importar'); if (d.open) d.close();
    $('#sesion-prueba').value = ctl.sesion;
  }
  function abrirArchivo(archivo) {
    $('#estado-inv').textContent = 'Leyendo ' + archivo.name + '…';
    return archivo.arrayBuffer().then(function (buf) {
      var bytes = new Uint8Array(buf);
      return PosBanco.leerXlsx(window.ExcelJS, bytes).then(function (hojas) {
        estado = { nombre: archivo.name, bytes: bytes, hojas: hojas, hoja: 0, perfil: 0, modo: 'limbo', limbo: 0, duo: 10, lon: 0, decisiones: {}, regla: true };
        pintarImportacion();
        $('#dlg-importar').showModal();
        aplicar();
      });
    }).catch(function (e) { $('#estado-inv').textContent = 'No se pudo leer el archivo: ' + e.message; });
  }
  $('#importar').addEventListener('click', function () { $('#archivo-inventario').click(); });
  $('#archivo-inventario').addEventListener('change', function (e) { var f = e.target.files[0]; e.target.value = ''; if (f) abrirArchivo(f); });
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
      estado = { nombre: g.nombre, bytes: g.bytes, hojas: hojas, hoja: g.hoja, perfil: g.perfil, modo: g.modo || 'prueba', limbo: g.limbo || 0, duo: g.duo, lon: g.lon, decisiones: g.decisiones || {}, regla: g.regla !== false };
      cargar(false, est && est.conInventario ? est : undefined);
    });
  }).catch(function () { aplicar(); }).then(function () { ultimaVersion = -1; listo = true; });
})();
