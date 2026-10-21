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
  // El encabezado se pega justo debajo de la barra de conexión: se mide su alto real (incluye la zona segura de arriba).
  function medirBarra() { var b = document.querySelector('.barra-nube'); if (b) document.documentElement.style.setProperty('--barra-alto', b.offsetHeight + 'px'); }
  window.addEventListener('resize', medirBarra); window.addEventListener('orientationchange', medirBarra); setTimeout(medirBarra, 0); setTimeout(medirBarra, 600);
  new MutationObserver(programar).observe(document.body, { childList: true, subtree: true });
  window.POS_MOVIL = { esMovil: function () { return window.matchMedia('(max-width: 820px)').matches; }, anotar: function () { anotar(document.body); } };
  anotar(document.body);
})();
