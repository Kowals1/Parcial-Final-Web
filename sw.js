/**
 * SkyDash-Manager - Service Worker para Soporte Offline
 */

const CACHE_NAME = 'skydash-v1';
const ASSETS_TO_CACHE = [
    './',
    './index.html',
    './style.css',
    './app.js',
    'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css',
    'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js',
    'https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@300;400;500;600;700;800&display=swap'
];

// Evento de Instalación - Cachear recursos del App Shell
self.addEventListener('install', (event) => {
    event.waitUntil(
        caches.open(CACHE_NAME)
            .then((cache) => {
                console.log('Service Worker: Cacheando App Shell');
                return cache.addAll(ASSETS_TO_CACHE);
            })
            .then(() => self.skipWaiting())
    );
});

// Evento de Activación - Limpiar caches antiguos
self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys().then((cacheNames) => {
            return Promise.all(
                cacheNames.map((cache) => {
                    if (cache !== CACHE_NAME) {
                        console.log('Service Worker: Borrando caché antiguo:', cache);
                        return caches.delete(cache);
                    }
                })
            );
        }).then(() => self.clients.claim())
    );
});

// Estrategia de Fetch: Network First con fallback a Cache para recursos dinámicos, 
// y Cache First para recursos estáticos del shell.
self.addEventListener('fetch', (event) => {
    // Solo manejar peticiones HTTP/HTTPS (ignora esquemas como chrome-extension)
    if (!event.request.url.startsWith('http')) {
        return;
    }

    const isStaticAsset = ASSETS_TO_CACHE.some(asset => {
        // Resolver rutas relativas para comparación simple
        const resolvedAsset = new URL(asset, self.location.href).href;
        return event.request.url === resolvedAsset || event.request.url.includes('unpkg.com') || event.request.url.includes('fonts.googleapis');
    });

    if (isStaticAsset) {
        // Network First con fallback a Cache para permitir desarrollo fluido local y soporte offline
        event.respondWith(
            fetch(event.request)
                .then((networkResponse) => {
                    return caches.open(CACHE_NAME).then((cache) => {
                        cache.put(event.request, networkResponse.clone());
                        return networkResponse;
                    });
                })
                .catch(() => {
                    return caches.match(event.request);
                })
        );
    } else {
        // Network First para peticiones de APIs (Nominatim, Open-Meteo)
        event.respondWith(
            fetch(event.request)
                .then((networkResponse) => {
                    // Si la red funciona, devolvemos la respuesta inmediatamente.
                    // Nota: No cacheamos llamadas de API directamente en Cache Storage, 
                    // ya que la aplicación implementa su propia base de datos de cache 
                    // meteorológico en localStorage para un control más fino.
                    return networkResponse;
                })
                .catch(() => {
                    // Si falla la red, intentamos buscar en caches si por alguna razón está ahí.
                    return caches.match(event.request);
                })
        );
    }
});
