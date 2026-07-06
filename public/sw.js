// Service worker jen pro push notifikace — žádné cachování, ať se appka vždy načte čerstvá
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', event => event.waitUntil(clients.claim()));

self.addEventListener('push', event => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {}
  event.waitUntil(self.registration.showNotification(data.title || 'Šmogyho FVE', {
    body: data.body || '',
    icon: '/icon-192.png',
    badge: '/icon-192.png'
  }));
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list =>
      list.length ? list[0].focus() : clients.openWindow('/')
    )
  );
});
