// File: public/sw.js
//
// Strategy: network-first for everything.
// This app's whole point is showing current goals/status — a cached,
// stale version of Today is actively misleading, so we do NOT cache
// pages or API responses. The only thing cached is the tiny offline
// fallback page, so you get a friendly message instead of a browser
// error if you open the app with zero connection.

const CACHE_NAME = "standup-shell-v1";
const OFFLINE_URL = "/offline.html";

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.add(OFFLINE_URL))
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((key) => key !== CACHE_NAME)
          .map((key) => caches.delete(key))
      )
    )
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  // Only handle page navigations (not API calls, not Supabase requests).
  if (event.request.mode !== "navigate") return;

  event.respondWith(
    fetch(event.request).catch(() =>
      caches.match(OFFLINE_URL)
    )
  );
});
