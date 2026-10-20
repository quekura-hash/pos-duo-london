// Importación de inventario (.xlsx): lectura, vista previa, departamentos y carga. Lo comparten la página de prueba y la Administración conectada.
// api: { $, esc, pesos, aplicar(), guardar(k, v), borrar(k), cargarInventario(ops, texto, muestra, estadoGuardado) }
function crearImportador(api) {
  var $ = api.$, esc = api.esc, pesos = api.pesos;
  // ── importar inventario (.xlsx) ──
  var estado = null; // { nombre, bytes, hojas, hoja, perfil, duo, lon, decisiones, regla }
  var NOM_ESTADO = { vacio: 'Sin departamento', exacto: 'Reconocido', alias: 'Reconocido (otra forma de escribirlo)', descontinuado: 'Ya no se vende', sugerido: 'Parecido a uno existente: confirme', desconocido: 'Desconocido: elija' };
  function activos() { return PosBanco.DEPARTAMENTOS_BASE.filter(function (d) { return d.activo; }).map(function (d) { return d.nombre; }); }
  var ETQ = { item_no: 'Item #', codigo: 'Código', marca: 'Marca', descripcion: 'Descripción', estilo: 'Estilo', lote: 'Lote', departamento: 'Departamento', precio: 'Precio de venta', precio_alterno: 'Precio alterno', codigo_alterno: 'Código alterno', etiqueta_costura: 'Etiqueta costura', etiqueta_precio: 'Etiqueta precio', pedimento: 'Pedimento', codigo_2: 'Código 2', existencia: 'Existencia' };
  var ROT = { bloquea_venta: 'No se puede vender', revisar: 'Revisar', info: 'Informativo' };
  var NOM_ANOM = { sin_codigo: 'Sin código (no se escanea)', item_no_duplicado: 'Item # repetido', codigo_duplicado: 'Código repetido', precio_cero: 'Precio 0', precio_negativo: 'Precio negativo', cupon_obsoleto: 'Cupón o certificado del sistema anterior (no se importa)', precio_ilegible: 'Precio ilegible', precio_con_centavos: 'Precio con centavos', codigo_numerico_posible_truncamiento: 'Código guardado como número', codigo_con_espacios: 'Código con espacios', item_no_ausente: 'Sin Item #', alterno_coincide_con_codigo: 'Código alterno igual al código de otro', existencia_ilegible: 'Existencia ilegible' };
  function lectura() {
    var perfil = PosBanco.PERFILES[estado.perfil];
    if (estado.colCantidad) perfil = PosBanco.perfilConCantidad(perfil, estado.colCantidad);
    return PosBanco.leerInventario(estado.hojas[estado.hoja].filas, perfil);
  }
  // Resumen de la cantidad que trae el archivo: se usa como existencia inicial de El Limbo.
  function resumenCantidad(r) {
    var n = 0, piezas = 0, neg = 0, sinCant = 0;
    r.articulos.forEach(function (a) { if (a.precio > 0) { if (Number.isInteger(a.existencia)) { n++; piezas += a.existencia; if (a.existencia < 0) neg++; } else sinCant++; } });
    return { n: n, piezas: piezas, neg: neg, sinCant: sinCant };
  }
  function pintarImportacion() {
    var r = lectura();
    var e = r.estadisticas;
    var d = $('#dlg-importar');
    var cols = r.columnas;
    var cant = resumenCantidad(r);
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
      (cols.faltantes.indexOf('existencia') >= 0
        ? '<label style="margin-left:24px">Columna de cantidad del archivo <select id="imp-col-cantidad"><option value="">(el archivo no trae cantidades)</option>' + cols.ignoradas.map(function (h) { return '<option' + (h === estado.colCantidad ? ' selected' : '') + '>' + esc(h) + '</option>'; }).join('') + '</select></label>'
        : '<p id="imp-cantidad-archivo" style="margin-left:24px"><small>La cantidad de cada fila (columna «' + esc(cols.usadas.existencia) + '») es la existencia inicial de El Limbo: <strong>' + cant.n + '</strong> artículos con cantidad · <strong>' + cant.piezas + '</strong> piezas' + (cant.neg ? ' · <strong>' + cant.neg + ' con cantidad negativa</strong> (se cargan tal cual)' : '') + (cant.sinCant ? ' · ' + cant.sinCant + ' sin cantidad entera' : '') + '.</small></p>') +
      '<label style="margin-left:24px">Piezas en El Limbo para los artículos ' + (cols.faltantes.indexOf('existencia') >= 0 ? '' : 'sin cantidad en el archivo ') + '<input type="number" id="imp-limbo" min="0" max="999" value="' + estado.limbo + '"' + (estado.modo === 'limbo' ? '' : ' disabled') + '></label>' +
      '<label><input type="radio" name="imp-modo" id="imp-modo-prueba" value="prueba"' + (estado.modo === 'prueba' ? ' checked' : '') + '> <strong>Existencia de PRUEBA por tienda</strong></label>' +
      '<label style="margin-left:24px">Piezas por artículo en DÚO <input type="number" id="imp-duo" min="0" max="999" value="' + estado.duo + '"' + (estado.modo === 'prueba' ? '' : ' disabled') + '></label>' +
      '<label style="margin-left:24px">Piezas por artículo en London <input type="number" id="imp-lon" min="0" max="999" value="' + estado.lon + '"' + (estado.modo === 'prueba' ? '' : ' disabled') + '></label>' +
      '<small>La existencia de prueba se registra como movimientos marcados «existencia_prueba». Ambas opciones solo cubren artículos con precio vendible.</small></fieldset>' +
      '<div class="filas"><button class="btn" type="button" id="imp-cancelar">Cancelar</button><button class="btn btn-primario" type="button" id="imp-cargar" style="width:auto;flex:1"' + (r.errores.length ? ' disabled' : '') + '>Cargar ' + e.filas + ' artículos al sistema</button></div>';
    var h = $('#imp-hoja'); if (h) h.addEventListener('change', function (ev) { estado.hoja = Number(ev.target.value); pintarImportacion(); });
    function leerExistencia() { estado.duo = Number($('#imp-duo').value) || 0; estado.lon = Number($('#imp-lon').value) || 0; estado.limbo = Number($('#imp-limbo').value) || 0; }
    Array.prototype.forEach.call(d.querySelectorAll('input[name="imp-perfil"]'), function (x) { x.addEventListener('change', function (ev) { estado.perfil = Number(ev.target.value); leerExistencia(); pintarImportacion(); }); });
    var cc = $('#imp-col-cantidad'); if (cc) cc.addEventListener('change', function (ev) { leerExistencia(); estado.colCantidad = ev.target.value; pintarImportacion(); });
    Array.prototype.forEach.call(d.querySelectorAll('input[name="imp-modo"]'), function (x) { x.addEventListener('change', function (ev) { leerExistencia(); estado.modo = ev.target.value; pintarImportacion(); }); });
    Array.prototype.forEach.call(d.querySelectorAll('.sel-depto'), function (x) { x.addEventListener('change', function (ev) { estado.decisiones[ev.target.getAttribute('data-clave')] = ev.target.value; }); });
    $('#imp-regla-env').addEventListener('change', function (ev) { estado.regla = ev.target.checked; });
    $('#imp-cancelar').addEventListener('click', function () { d.close(); });
    $('#imp-cargar').addEventListener('click', function () { leerExistencia(); cargar(true); });
  }
  function cargar(guardarArchivo, estadoGuardado) {
    var r = lectura();
    var dep = PosBanco.aplicarDepartamentos(r.articulos, PosBanco.DEPARTAMENTOS_BASE, { decisiones: estado.decisiones, reglaEnvolturas: estado.regla });
    var o = PosBanco.aOperacionesInventario(dep.articulos, { ahora: new Date().toISOString(), idImportacion: 'imp1', existenciaPrueba: estado.modo === 'prueba' ? { DUO: estado.duo, LON: estado.lon } : {}, limbo: estado.modo === 'limbo' ? { piezas: estado.limbo, delArchivo: true } : undefined });
    var muestra = dep.articulos.filter(function (a) { return a.codigo && a.precio > 0; }).slice(0, 8).map(function (a) { return { codigo: a.codigo, item_no: a.item_no, descripcion: a.descripcion || '(sin descripción)', marca: a.marca, precio: a.precio, existencia: estado.modo === 'limbo' ? 'El Limbo ' + (Number.isInteger(a.existencia) ? a.existencia : estado.limbo) : estado.duo + ' / ' + estado.lon }; });
    var texto = 'Inventario cargado: ' + estado.nombre + ' · ' + r.estadisticas.filas + ' artículos · mapeo «' + PosBanco.PERFILES[estado.perfil].id + '» · ' + (estado.modo === 'limbo' ? 'catálogo inicial en El Limbo (' + (r.columnas.faltantes.indexOf('existencia') >= 0 ? estado.limbo + ' pza por artículo' : 'cantidades del archivo, ' + resumenCantidad(r).piezas + ' piezas') + ')' : 'existencia de prueba DÚO ' + estado.duo + ', London ' + estado.lon);
    if (guardarArchivo) api.borrar('estado'); // inventario nuevo = base nueva: lo guardado era de la base anterior
    api.cargarInventario(o.ops, texto, muestra, estadoGuardado);
    if (guardarArchivo) api.guardar('inventario', { nombre: estado.nombre, bytes: estado.bytes, hoja: estado.hoja, perfil: estado.perfil, modo: estado.modo, limbo: estado.limbo, colCantidad: estado.colCantidad, duo: estado.duo, lon: estado.lon, decisiones: estado.decisiones, regla: estado.regla });
    var d = $('#dlg-importar'); if (d.open) d.close();
  }
  function abrirArchivo(archivo) {
    $('#estado-inv').textContent = 'Leyendo ' + archivo.name + '…';
    return archivo.arrayBuffer().then(function (buf) {
      var bytes = new Uint8Array(buf);
      return PosBanco.leerXlsx(window.ExcelJS, bytes).then(function (hojas) {
        estado = { nombre: archivo.name, bytes: bytes, hojas: hojas, hoja: 0, perfil: 0, colCantidad: '', modo: 'limbo', limbo: 0, duo: 10, lon: 0, decisiones: {}, regla: true };
        pintarImportacion();
        $('#dlg-importar').showModal();
        api.aplicar();
      });
    }).catch(function (e) { $('#estado-inv').textContent = 'No se pudo leer el archivo: ' + e.message; });
  }
  var bImportar = $('#importar'); if (bImportar) bImportar.addEventListener('click', function () { $('#archivo-inventario').click(); });
  window.__POS_IMPORTAR_INVENTARIO__ = function () { $('#archivo-inventario').click(); };
  $('#archivo-inventario').addEventListener('change', function (e) { var f = e.target.files[0]; e.target.value = ''; if (f) abrirArchivo(f); });
  return {
    /** Vuelve a cargar el inventario guardado en este navegador (los bytes del Excel ya leídos en `hojas`). */
    recargar: function (g, hojas, estadoGuardado) {
      estado = { nombre: g.nombre, bytes: g.bytes, hojas: hojas, hoja: g.hoja, perfil: g.perfil, modo: g.modo || 'prueba', limbo: g.limbo || 0, colCantidad: g.colCantidad || '', duo: g.duo, lon: g.lon, decisiones: g.decisiones || {}, regla: g.regla !== false };
      cargar(false, estadoGuardado);
    },
  };
}
