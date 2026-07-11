/* Bok Family Predictor service worker.
   Network-first for pages so updates land immediately when online;
   everything falls back to cache offline. */
var CACHE = "bok-predictor-v1";
var SHELL = ["./", "./index.html", "./manifest.webmanifest", "./icon-192.png", "./icon-512.png", "./apple-touch-icon.png"];

self.addEventListener("install", function(e){
  self.skipWaiting();
  e.waitUntil(
    caches.open(CACHE).then(function(c){
      return Promise.all(SHELL.map(function(u){
        return c.add(u).catch(function(){});
      }));
    })
  );
});

self.addEventListener("activate", function(e){
  e.waitUntil(
    caches.keys().then(function(keys){
      return Promise.all(keys.filter(function(k){ return k !== CACHE; }).map(function(k){ return caches.delete(k); }));
    }).then(function(){ return self.clients.claim(); })
  );
});

self.addEventListener("fetch", function(e){
  if (e.request.method !== "GET") return;
  var url = new URL(e.request.url);
  if (url.origin !== location.origin) return;
  e.respondWith(
    fetch(e.request).then(function(res){
      if (res && res.ok) {
        var clone = res.clone();
        caches.open(CACHE).then(function(c){ c.put(e.request, clone); });
      }
      return res;
    }).catch(function(){
      return caches.match(e.request).then(function(hit){
        return hit || caches.match("./index.html");
      });
    })
  );
});

self.addEventListener("push", function(e){
  var data = {};
  try { data = e.data ? e.data.json() : {}; } catch (err) {}
  var title = data.title || "🏉 Bok Family Predictor";
  var body = data.body || "Kick-off is coming up — add your prediction!";
  e.waitUntil(
    self.registration.showNotification(title, {
      body: body,
      icon: "./icon-192.png",
      badge: "./icon-192.png",
      data: { url: data.url || "./" }
    })
  );
});

self.addEventListener("notificationclick", function(e){
  e.notification.close();
  var url = (e.notification.data && e.notification.data.url) || "./";
  e.waitUntil(
    clients.matchAll({ type: "window", includeUncontrolled: true }).then(function(list){
      for (var i=0;i<list.length;i++) {
        if ("focus" in list[i]) { list[i].navigate(url); return list[i].focus(); }
      }
      if (clients.openWindow) return clients.openWindow(url);
    })
  );
});
