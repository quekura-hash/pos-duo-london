// Ayudas de la versión para teléfono (solo en la página de Administración).
(function () {
  // Cada celda de una tabla lleva el nombre de su columna (data-label) para poder mostrarla como tarjeta en pantallas angostas.
  function anotar(raiz) {
    var tablas = raiz.querySelectorAll ? raiz.querySelectorAll('table') : [];
    Array.prototype.forEach.call(tablas, function (t) {
      var ths = Array.prototype.map.call(t.querySelectorAll('thead th'), function (th) { return th.textContent.replace(/\s+/g, ' ').trim(); });
      if (!ths.length) return;
      Array.prototype.forEach.call(t.querySelectorAll('tbody tr'), function (tr) {
        Array.prototype.forEach.call(tr.children, function (td, i) {
          if (td.tagName === 'TD' && td.getAttribute('data-label') === null) td.setAttribute('data-label', ths[i] || '');
        });
      });
    });
  }
  var pendiente = false;
  function programar() { if (pendiente) return; pendiente = true; requestAnimationFrame(function () { pendiente = false; anotar(document.body); }); }
  // El encabezado va fijo arriba: se mide su alto real (incluye la zona segura) para que el contenido empiece justo debajo.
  function medirEncabezado() { var h = document.querySelector('.encabezado'); if (h && h.offsetHeight) document.documentElement.style.setProperty('--enc-alto', h.offsetHeight + 'px'); }
  window.addEventListener('resize', medirEncabezado); window.addEventListener('orientationchange', medirEncabezado); setTimeout(medirEncabezado, 0); setTimeout(medirEncabezado, 600);
  var enc = document.querySelector('.encabezado');
  if (enc && window.ResizeObserver) new ResizeObserver(medirEncabezado).observe(enc);
  new MutationObserver(function () { programar(); medirEncabezado(); }).observe(document.body, { childList: true, subtree: true });
  window.POS_MOVIL = { esMovil: function () { return window.matchMedia('(max-width: 820px)').matches; }, anotar: function () { anotar(document.body); } };
  anotar(document.body);
})();
