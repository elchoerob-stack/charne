// The app moved to https://elchoerob-stack.github.io/springboks-predictor/.
// Phones that installed it here still have the old service worker and its
// cached copy of the app, which would keep opening the old version. This
// replacement clears that cache, unregisters itself and reloads open tabs,
// which then land on the forwarding page.
self.addEventListener("install", function(){ self.skipWaiting(); });
self.addEventListener("activate", function(e){
  e.waitUntil(
    caches.keys()
      .then(function(keys){ return Promise.all(keys.map(function(k){ return caches.delete(k); })); })
      .then(function(){ return self.registration.unregister(); })
      .then(function(){ return self.clients.matchAll({ type:"window" }); })
      .then(function(list){ list.forEach(function(c){ c.navigate(c.url); }); })
  );
});
