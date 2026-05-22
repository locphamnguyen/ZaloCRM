/// <reference lib="webworker" />
import { clientsClaim } from 'workbox-core';
import { cleanupOutdatedCaches, precacheAndRoute } from 'workbox-precaching';
import { registerRoute } from 'workbox-routing';
import { CacheFirst, NetworkFirst, StaleWhileRevalidate } from 'workbox-strategies';
import { ExpirationPlugin } from 'workbox-expiration';

declare const self: ServiceWorkerGlobalScope;

self.skipWaiting();
clientsClaim();
cleanupOutdatedCaches();
precacheAndRoute(self.__WB_MANIFEST);

registerRoute(
  ({ request, url }) => request.mode === 'navigate' && !url.pathname.startsWith('/api/') && !url.pathname.startsWith('/socket.io/'),
  new NetworkFirst({
    cacheName: 'zalocrm-pages',
    networkTimeoutSeconds: 3,
    plugins: [new ExpirationPlugin({ maxEntries: 40, maxAgeSeconds: 7 * 24 * 60 * 60 })],
  }),
);

registerRoute(
  ({ request }) => ['style', 'script', 'worker', 'font', 'image'].includes(request.destination),
  new StaleWhileRevalidate({
    cacheName: 'zalocrm-assets',
    plugins: [new ExpirationPlugin({ maxEntries: 120, maxAgeSeconds: 30 * 24 * 60 * 60 })],
  }),
);

registerRoute(
  ({ request }) => ['image', 'font'].includes(request.destination),
  new CacheFirst({
    cacheName: 'zalocrm-static',
    plugins: [new ExpirationPlugin({ maxEntries: 80, maxAgeSeconds: 60 * 60 * 24 * 30 })],
  }),
);

interface PushPayload {
  title?: string;
  body?: string;
  url?: string;
  tag?: string;
  type?: string;
  priority?: string;
  createdAt?: string;
}

function parsePushPayload(event: PushEvent): PushPayload {
  if (!event.data) return {};
  try {
    return event.data.json();
  } catch {
    return { title: 'ZaloCRM', body: event.data.text() };
  }
}

self.addEventListener('push', (event) => {
  const payload = parsePushPayload(event);
  const title = payload.title || 'ZaloCRM';
  const url = payload.url || '/';
  event.waitUntil(
    self.registration.showNotification(title, {
      body: payload.body || 'Bạn có thông báo mới',
      icon: '/pwa-192x192.svg',
      badge: '/pwa-192x192.svg',
      tag: payload.tag,
      data: { url, type: payload.type, createdAt: payload.createdAt },
    }),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const targetUrl = new URL(event.notification.data?.url || '/', self.location.origin).href;

  event.waitUntil((async () => {
    const windowClients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const client of windowClients) {
      await client.focus();
      await client.navigate(targetUrl);
      return;
    }
    await self.clients.openWindow(targetUrl);
  })());
});
