// Seep's service worker does ONE job: if the app is opened with no connection, show a friendly page instead of a browser error.
// It stores that one page and nothing else. It never stores the game, the app's files or any server reply, so it can never show anyone
// something out of date, and updating the app needs nothing special. It ignores everything except opening a page.
const CACHE = 'seep-offline-v1'
const OFFLINE_URL = '/offline.html'

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.add(new Request(OFFLINE_URL, { cache: 'reload' })))
      .then(() => self.skipWaiting()),
  )
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  )
})

self.addEventListener('fetch', (event) => {
  if (event.request.mode !== 'navigate') return // scripts, pictures, the server's replies: left entirely alone
  event.respondWith(fetch(event.request).catch(async () => (await caches.match(OFFLINE_URL)) || Response.error()))
})
