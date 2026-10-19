// src/sw.js — custom service worker (vite-plugin-pwa "injectManifest" strategy).
import { clientsClaim } from 'workbox-core';
import { precacheAndRoute, cleanupOutdatedCaches, createHandlerBoundToURL } from 'workbox-precaching';
import { NavigationRoute, registerRoute } from 'workbox-routing';

// Placeholder fallback — the server normally sends the real URL in the payload.
const DEFAULT_URL = 'https://example.com/attendance';

// Take control immediately so updates apply without waiting for all tabs to close.
self.skipWaiting();
clientsClaim();

// The build step replaces self.__WB_MANIFEST with the list of files to precache.
precacheAndRoute(self.__WB_MANIFEST);
cleanupOutdatedCaches();

// SPA fallback so /admin works offline / on refresh (production only: in dev
// index.html is not in the precache list).
if (import.meta.env.PROD) {
  registerRoute(new NavigationRoute(createHandlerBoundToURL('/index.html')));
}

// ---------- Web Push ----------
self.addEventListener('push', (event) => {
  let data = { title: 'RemindME', body: 'Time to log your attendance.', url: DEFAULT_URL };

  if (event.data) {
    try {
      data = { ...data, ...event.data.json() };
    } catch {
      data.body = event.data.text(); // plain-text payload fallback
    }
  }

  event.waitUntil(
    self.registration.showNotification(data.title, {
      body: data.body,
      icon: '/pwa-192x192.png',
      badge: '/pwa-192x192.png',
      tag: 'attendance-reminder', // a newer reminder replaces an older one
      renotify: true,
      data: { url: data.url },
    })
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const targetUrl = event.notification.data?.url || DEFAULT_URL;

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windows) => {
      // Re-use a tab that already has the portal open, otherwise open a new one.
      const existing = windows.find((w) => w.url === targetUrl);
      return existing ? existing.focus() : self.clients.openWindow(targetUrl);
    })
  );
});