// Service worker de push do CRM — VAPID "tickle": o servidor não envia
// payload; ao receber `push` o SW abre uma notificação que leva ao app.
self.addEventListener('push', (event) => {
  const titulo = 'Pousada Espírito do Mar';
  event.waitUntil(
    self.registration.showNotification(titulo, {
      body: 'Nova atividade no painel — toque para abrir.',
      icon: '/favicon.ico',
      badge: '/favicon.ico',
      tag: 'crm-alerta',
      data: { url: '/' },
    }),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((lista) => {
      const aberta = lista.find((c) => 'focus' in c);
      return aberta ? aberta.focus() : clients.openWindow('/');
    }),
  );
});
