// PWA Push 測試用 Service Worker
// 版本：2026-08-18

const CACHE_NAME = 'pwa-push-test-v1';

// 安裝
self.addEventListener('install', (event) => {
  console.log('[SW] install');
  self.skipWaiting();
});

// 啟用
self.addEventListener('activate', (event) => {
  console.log('[SW] activate');
  event.waitUntil(self.clients.claim());
});

// 接收真正的 Push 訊息
self.addEventListener('push', (event) => {
  console.log('[SW] push event received');

  let data = {
    title: 'PWA 測試通知',
    body: '你收到一則推送通知！',
    icon: 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><text y=".9em" font-size="90">🔔</text></svg>',
    badge: 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><text y=".9em" font-size="90">🔔</text></svg>',
    url: './'
  };

  // 嘗試解析 payload
  if (event.data) {
    try {
      const payload = event.data.json();
      data = { ...data, ...payload };
    } catch (e) {
      // 如果不是 JSON，就當作純文字
      data.body = event.data.text() || data.body;
    }
  }

  const options = {
    body: data.body,
    icon: data.icon,
    badge: data.badge,
    vibrate: data.vibrate || [100, 50, 100],
    data: {
      url: data.url || './',
      dateOfArrival: Date.now()
    },
    actions: data.actions || [
      { action: 'open', title: '開啟' },
      { action: 'close', title: '關閉' }
    ],
    requireInteraction: data.requireInteraction || false,
    tag: data.tag || 'pwa-push-test',
    renotify: true
  };

  event.waitUntil(
    self.registration.showNotification(data.title, options)
  );
});

// 使用者點擊通知
self.addEventListener('notificationclick', (event) => {
  console.log('[SW] notificationclick', event.action);
  event.notification.close();

  if (event.action === 'close') {
    return;
  }

  // 預設行為：開啟或聚焦到頁面
  const targetUrl = event.notification.data?.url || './';

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      // 如果已經有開啟的視窗，就聚焦它
      for (const client of clientList) {
        if (client.url.includes(self.location.origin) && 'focus' in client) {
          return client.focus();
        }
      }
      // 否則開啟新視窗
      if (clients.openWindow) {
        return clients.openWindow(targetUrl);
      }
    })
  );
});

// 通知被關閉（可選）
self.addEventListener('notificationclose', (event) => {
  console.log('[SW] notification closed', event.notification.tag);
});

// 訂閱變更（重要：用來處理訂閱過期或更新）
self.addEventListener('pushsubscriptionchange', (event) => {
  console.log('[SW] pushsubscriptionchange');
  // 實務上這裡應該重新訂閱並把新的 subscription 送到後端
  // 測試版先只 log
});
