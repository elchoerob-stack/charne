// Cache the shell so the app opens instantly and survives a flaky signal.
// Predictions themselves always come from Firestore, never from this cache.
var CACHE = "tour-v2";
var SHELL = ["./", "./index.html", "./manifest.webmanifest",
  "./assets/ball-icon-192.png", "./assets/ball-icon-512.png"];
self.addEventListener("install", function(e){
  e.waitUntil(caches.open(CACHE).then(function(c){ return c.addAll(SHELL); }).then(function(){ return self.skipWaiting(); }));
});
self.addEventListener("activate", function(e){
  e.waitUntil(caches.keys().then(function(keys){
    return Promise.all(keys.filter(function(k){ return k !== CACHE; }).map(function(k){ return caches.delete(k); }));
  }).then(function(){ return self.clients.claim(); }));
});
self.addEventListener("fetch", function(e){
  var url = new URL(e.request.url);
  if (e.request.method !== "GET" || url.origin !== location.origin) return;   // never touch Firestore
  e.respondWith(
    fetch(e.request).then(function(res){
      var copy = res.clone();
      caches.open(CACHE).then(function(c){ c.put(e.request, copy); }).catch(function(){});
      return res;
    }).catch(function(){ return caches.match(e.request).then(function(r){ return r || caches.match("./index.html"); }); })
  );
});
