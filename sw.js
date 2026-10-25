/* Service worker del Selector: app sin conexión + notificaciones.
   Los datos van por Firebase (su propia caché offline); el SW no los toca.
   IMPORTANTE: en cada despliegue de assets, sube CACHE (sel-v1 → sel-v2…)
   o el móvil seguirá con la versión vieja. La app se recarga sola al
   detectar la nueva. */
const CACHE = "sel-v2";
const SHELL = [
  "./", "./index.html", "./manifest.webmanifest",
  "./assets/style.css", "./assets/app.js", "./assets/cloud.js", "./assets/chart.umd.min.js",
  "./assets/vendor/firebase-app.js", "./assets/vendor/firebase-auth.js", "./assets/vendor/firebase-firestore.js",
  "./icons/icon-192.png", "./icons/icon-512.png", "./icons/apple-touch-icon.png",
];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys()
    .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});
self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET" || url.origin !== location.origin) return;
  e.respondWith(caches.match(e.request, { ignoreSearch: true }).then((hit) => hit ||
    fetch(e.request).then((res) => {
      if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(e.request, copy)); }
      return res;
    })));
});

/* ---------- notificaciones ---------- */
self.addEventListener("push", (e) => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch (err) { d = { body: e.data ? e.data.text() : "" }; }
  e.waitUntil(self.registration.showNotification(d.title || "Selector", {
    body: d.body || "", tag: d.tag || "selector",
    icon: "./icons/icon-192.png", badge: "./icons/icon-192.png",
    data: { open: d.open || "hoy" },
  }));
});
self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  const open = (e.notification.data && e.notification.data.open) || "hoy";
  e.waitUntil(self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((list) => {
    for (const c of list) {
      c.postMessage({ open });
      if ("focus" in c) return c.focus();
    }
    return self.clients.openWindow("./#" + open);
  }));
});
