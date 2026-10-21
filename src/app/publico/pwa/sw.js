// Service worker de la Administración de LonDuo POS: abre sin conexión con la última versión y recibe las notificaciones push.
var VERSION = '__VERSION__';
var CACHE = 'londuo-admin-' + VERSION;
var BASICOS = ['./', 'index.html', 'manifest.webmanifest', 'icon-192.png', 'icon-512.png'];

self.addEventListener('install', function (e) {
  e.waitUntil(caches.open(CACHE).then(function (c) { return c.addAll(BASICOS); }).then(function () { return self.skipWaiting(); }));
});
self.addEventListener('activate', function (e) {
  e.waitUntil(caches.keys().then(function (ks) {
    return Promise.all(ks.filter(function (k) { return k.indexOf('londuo-admin-') === 0 && k !== CACHE; }).map(function (k) { return caches.delete(k); }));
  }).then(function () { return self.clients.claim(); }));
});
// Siempre se intenta la red primero (así una versión nueva se ve al abrir); sin red se usa lo último guardado.
self.addEventListener('fetch', function (e) {
  var req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;
  e.respondWith(fetch(req).then(function (r) {
    if (r && r.ok) { var copia = r.clone(); caches.open(CACHE).then(function (c) { c.put(req, copia); }); }
    return r;
  }).catch(function () { return caches.match(req).then(function (r) { return r || caches.match('index.html'); }); }));
});

self.addEventListener('push', function (e) {
  var d = {};
  try { d = e.data ? e.data.json() : {}; } catch (x) { d = { cuerpo: e.data ? e.data.text() : '' }; }
  e.waitUntil(self.registration.showNotification(d.titulo || 'LonDuo POS', {
    body: d.cuerpo || '', icon: 'icon-192.png', tag: d.tag || undefined, renotify: !!d.tag, data: { url: d.url || './' }, timestamp: d.ts || Date.now(),
  }));
});
self.addEventListener('notificationclick', function (e) {
  e.notification.close();
  var url = new URL((e.notification.data && e.notification.data.url) || './', self.registration.scope).href;
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function (cs) {
    for (var i = 0; i < cs.length; i++) { if ('focus' in cs[i]) { cs[i].focus(); if ('navigate' in cs[i]) cs[i].navigate(url).catch(function () {}); return; } }
    return self.clients.openWindow(url);
  }));
});
