// No API responses, conversations or application pages are cached.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', event => event.waitUntil(self.clients.claim()));
self.addEventListener('fetch', event => {
  if (event.request.mode !== 'navigate' || new URL(event.request.url).origin !== self.location.origin) return;
  event.respondWith(fetch(event.request).catch(() => new Response(`<!doctype html><html lang="he" dir="rtl"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>EMPntegral — אין חיבור</title><body style="font-family:system-ui;background:#f4f5f6;color:#28232b;padding:40px;text-align:center"><h1>אין חיבור לאינטרנט</h1><p>כדי לצפות בהודעות ולשנות אוטומציות יש להתחבר לרשת.</p><p>הפעלת האוטומציות בשרת אינה תלויה בחיבור הטלפון.</p><button onclick="location.reload()" style="background:#872c9b;color:white;border:0;border-radius:8px;padding:12px 20px">נסה שוב</button></body></html>`, {status:503,headers:{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store'}})));
});
