/**
 * SkyDash-Manager - Lógica de Aplicación
 * JS Puro (Vanilla JS) para el control del dashboard meteorológico georreferenciado
 */

// ==========================================
// 1. CONFIGURACIÓN E INICIALIZACIÓN GLOBAL
// ==========================================
const CONFIG = {
    MOCK_USER: 'admin',
    MOCK_PASS: 'password123',
    DEFAULT_LAT: 10.4806, // Caracas, Venezuela
    DEFAULT_LNG: -66.9036,
    WEATHER_CACHE_KEY: 'skydash_weather_cache',
    FAVORITES_KEY: 'skydash_favorites',
    THEME_KEY: 'skydash_theme',
    SESSION_KEY: 'skydash_session_token'
};

// Variables de Estado de la Aplicación
let map = null;
let activeMarker = null;
let currentSelectedLocation = null; // { lat, lng, name }
let appState = {
    isOnline: navigator.onLine,
    favorites: [],
    weatherCache: {}, // Lookup de consultas anteriores para modo offline
    currentUser: null
};

document.addEventListener('DOMContentLoaded', () => {
    initApp();
});

// Inicialización de la Aplicación
function initApp() {
    // 1. Cargar Preferencias locales
    loadThemePreference();
    loadFavorites();
    loadWeatherCache();
    
    // 2. Inicializar Eventos de Autenticación
    setupAuthEvents();
    
    // 3. Monitorear Conexión a Red
    setupOfflineMonitor();
    
    // 4. Verificar Sesión Activa
    checkSession();
    
    // 5. Inicializar Service Worker
    registerServiceWorker();
}

// ==========================================
// 2. MODULO DE AUTENTICACIÓN & CONTROL DE SESIÓN
// ==========================================
function setupAuthEvents() {
    const loginForm = document.getElementById('login-form');
    const btnLogout = document.getElementById('btn-logout');
    
    loginForm.addEventListener('submit', (e) => {
        e.preventDefault();
        
        const usernameInput = document.getElementById('username').value.trim();
        const passwordInput = document.getElementById('password').value;
        const loginError = document.getElementById('login-error');
        const loginSpinner = document.getElementById('login-spinner');
        const btnLoginText = document.querySelector('#btn-login .btn-text');
        const btnLogin = document.getElementById('btn-login');
        
        // Limpiar errores previos
        loginError.classList.add('hidden');
        
        // Mostrar Spinner de Carga
        loginSpinner.classList.remove('hidden');
        btnLoginText.classList.add('hidden');
        btnLogin.disabled = true;
        
        // Simular latencia de red (1.5 segundos) para mostrar feedback visual
        setTimeout(() => {
            if (usernameInput === CONFIG.MOCK_USER && passwordInput === CONFIG.MOCK_PASS) {
                // Autenticación Exitosa
                const dummyToken = 'token_' + Math.random().toString(36).substr(2);
                localStorage.setItem(CONFIG.SESSION_KEY, dummyToken);
                localStorage.setItem('skydash_username', usernameInput);
                
                // Limpiar formulario
                loginForm.reset();
                
                // Mostrar Dashboard
                checkSession();
            } else {
                // Credenciales Incorrectas
                loginError.classList.remove('hidden');
                loginSpinner.classList.add('hidden');
                btnLoginText.classList.remove('hidden');
                btnLogin.disabled = false;
            }
        }, 1500);
    });
    
    btnLogout.addEventListener('click', () => {
        logout();
    });
}

function checkSession() {
    const token = localStorage.getItem(CONFIG.SESSION_KEY);
    const username = localStorage.getItem('skydash_username');
    
    const loginOverlay = document.getElementById('login-overlay');
    const appContainer = document.getElementById('app-container');
    const userDisplayName = document.getElementById('user-display-name');
    
    if (token && username) {
        appState.currentUser = username;
        userDisplayName.textContent = username;
        
        // Transición visual
        loginOverlay.classList.add('hidden');
        appContainer.classList.remove('hidden');
        
        // Detener spinner por si acaso
        const loginSpinner = document.getElementById('login-spinner');
        const btnLoginText = document.querySelector('#btn-login .btn-text');
        const btnLogin = document.getElementById('btn-login');
        if (loginSpinner) loginSpinner.classList.add('hidden');
        if (btnLoginText) btnLoginText.classList.remove('hidden');
        if (btnLogin) btnLogin.disabled = false;
        
        // Inicializar mapa si no está creado
        if (!map) {
            initMap();
        }
        
        // Renderizar lista de favoritos inicial
        renderFavorites();
    } else {
        appState.currentUser = null;
        loginOverlay.classList.remove('hidden');
        appContainer.classList.add('hidden');
    }
}

function logout() {
    // Limpieza de tokens y datos temporales
    localStorage.removeItem(CONFIG.SESSION_KEY);
    localStorage.removeItem('skydash_username');
    
    // Resetear mapa y vistas de detalle
    if (map) {
        map.remove();
        map = null;
        activeMarker = null;
    }
    
    currentSelectedLocation = null;
    
    // Ocultar sección de detalles y mostrar placeholder
    document.getElementById('weather-details-section').classList.add('hidden');
    document.getElementById('weather-placeholder').classList.remove('hidden');
    
    // Redirigir a login
    checkSession();
}

// ==========================================
// 3. MÓDULO DE MAPA INTERACTIVO (LEAFLET)
// ==========================================
function initMap() {
    // Crear el mapa en el contenedor #map centrado en coordenadas por defecto
    map = L.map('map', {
        zoomControl: true,
        fadeAnimation: true,
        zoomAnimation: true
    }).setView([CONFIG.DEFAULT_LAT, CONFIG.DEFAULT_LNG], 11);
    
    // Añadir capa de azulejos (Tiles) de OpenStreetMap
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
        maxZoom: 19
    }).addTo(map);
    
    // Escuchar clics sobre el mapa
    map.on('click', (e) => {
        handleMapClick(e.latlng.lat, e.latlng.lng);
    });
    
    // Forzar redibujado de Leaflet para evitar problemas de rendering en divs ocultos
    setTimeout(() => {
        map.invalidateSize();
    }, 100);
}

// Manejar clics sobre coordenadas del mapa
async function handleMapClick(lat, lng) {
    showSpinnerOnMap();
    
    try {
        let locationName = '';
        
        if (appState.isOnline) {
            // Geocodificación Inversa
            locationName = await reverseGeocode(lat, lng);
        } else {
            // Búsqueda en el cache local en caso de estar offline
            const cached = findNearestCachedWeather(lat, lng);
            if (cached) {
                locationName = cached.name + ' (Guardado - Offline)';
            } else {
                locationName = `Coordenadas: ${lat.toFixed(4)}, ${lng.toFixed(4)}`;
            }
        }
        
        // Guardar localización temporal
        currentSelectedLocation = {
            lat: lat,
            lng: lng,
            name: locationName
        };
        
        // Obtener clima de Open-Meteo
        const weatherData = await fetchWeather(lat, lng);
        
        if (weatherData) {
            // Actualizar Marcador en el Mapa con icono dinámico basado en clima
            updateMapMarker(lat, lng, weatherData.current.weathercode);
            
            // Mostrar los detalles en el panel
            displayWeatherDetails(currentSelectedLocation, weatherData);
            
            // Centrar suavemente hacia la nueva ubicación
            map.panTo([lat, lng]);
        }
    } catch (err) {
        console.error('Error al manejar clic en el mapa:', err);
    } finally {
        hideSpinnerOnMap();
    }
}

// Inyección programática de marcadores (DivIcon) dinámicos según el estado del tiempo
function updateMapMarker(lat, lng, weathercode) {
    if (activeMarker) {
        map.removeLayer(activeMarker);
    }
    
    const weatherInfo = getWeatherInfo(weathercode);
    
    // Crear marcador personalizado con Leaflet DivIcon
    const customIcon = L.divIcon({
        className: 'weather-div-icon',
        html: `<span>${weatherInfo.emoji}</span>`,
        iconSize: [40, 40],
        iconAnchor: [20, 20]
    });
    
    activeMarker = L.marker([lat, lng], { icon: customIcon }).addTo(map);
}

function showSpinnerOnMap() {
    const mapEl = document.getElementById('map');
    mapEl.style.cursor = 'wait';
}

function hideSpinnerOnMap() {
    const mapEl = document.getElementById('map');
    mapEl.style.cursor = '';
}

// ==========================================
// 4. INTEG. DE APIS: GEOCODIFICACIÓN & METEO
// ==========================================

// Geocodificación Inversa (OSM Nominatim)
async function reverseGeocode(lat, lng) {
    try {
        const response = await fetch(`https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}&zoom=14&addressdetails=1`, {
            headers: {
                'Accept-Language': 'es'
            }
        });
        if (!response.ok) throw new Error('Error de conexión a Nominatim');
        const data = await response.json();
        
        // Construir nombre descriptivo legible
        if (data.address) {
            const city = data.address.city || data.address.town || data.address.village || data.address.suburb || '';
            const state = data.address.state || '';
            const country = data.address.country || '';
            
            let parts = [];
            if (city) parts.push(city);
            else if (state) parts.push(state);
            
            if (country) parts.push(country);
            
            return parts.length > 0 ? parts.join(', ') : 'Ubicación Desconocida';
        }
        
        return data.display_name ? data.display_name.split(',').slice(0, 2).join(',') : `Lat: ${lat.toFixed(2)}, Lng: ${lng.toFixed(2)}`;
    } catch (err) {
        console.warn('Fallo en geocodificación inversa:', err);
        return `Lat: ${lat.toFixed(4)}, Lng: ${lng.toFixed(4)}`;
    }
}

// Geocodificación Directa (Buscador)
async function searchLocation(query) {
    if (!appState.isOnline) {
        // En modo offline, buscamos coincidencias de texto en el cache
        const results = searchOfflineCache(query);
        renderSearchResults(results);
        return;
    }
    
    try {
        const response = await fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query)}&limit=5&addressdetails=1`, {
            headers: {
                'Accept-Language': 'es'
            }
        });
        if (!response.ok) throw new Error('Error al buscar localización');
        const data = await response.json();
        
        const results = data.map(item => {
            const city = item.address.city || item.address.town || item.address.village || item.display_name.split(',')[0];
            const country = item.address.country || '';
            const displayName = country ? `${city}, ${country}` : item.display_name;
            return {
                name: displayName,
                lat: parseFloat(item.lat),
                lng: parseFloat(item.lon)
            };
        });
        
        renderSearchResults(results);
    } catch (err) {
        console.error('Error de búsqueda:', err);
    }
}

// Consulta de Clima en Open-Meteo
async function fetchWeather(lat, lng) {
    const roundedLat = lat.toFixed(2);
    const roundedLng = lng.toFixed(2);
    const cacheKey = `${roundedLat},${roundedLng}`;
    
    // Si estamos offline o la llamada falla, recurrimos al cache
    if (!appState.isOnline) {
        const cachedData = appState.weatherCache[cacheKey] || findNearestCachedWeather(lat, lng);
        if (cachedData) {
            console.log('Cargando clima desde el cache de almacenamiento local (Offline)');
            return cachedData.weather;
        } else {
            alert('No hay datos guardados para esta ubicación en el modo offline.');
            return null;
        }
    }
    
    try {
        // URL de la API Open-Meteo
        const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lng}&current_weather=true&daily=weathercode,temperature_2m_max,temperature_2m_min,apparent_temperature_max,apparent_temperature_min&relative_humidity_2m=true&current=relative_humidity_2m,apparent_temperature,wind_speed_10m,wind_direction_10m&timezone=auto`;
        const response = await fetch(url);
        if (!response.ok) throw new Error('Error de conexión a Open-Meteo');
        
        const data = await response.json();
        
        // Estructurar la respuesta
        const weatherResult = {
            current: {
                temperature: data.current_weather.temperature,
                weathercode: data.current_weather.weathercode,
                windspeed: data.current_weather.windspeed || (data.current && data.current.wind_speed_10m),
                winddirection: data.current_weather.winddirection || (data.current && data.current.wind_direction_10m),
                humidity: data.current ? data.current.relative_humidity_2m : 60, // Fallback
                apparent_temp: data.current ? data.current.apparent_temperature : data.current_weather.temperature
            },
            daily: data.daily
        };
        
        // Almacenar exitosamente en el cache local con timestamp
        saveToWeatherCache(lat, lng, currentSelectedLocation ? currentSelectedLocation.name : 'Ubicación', weatherResult);
        
        return weatherResult;
    } catch (err) {
        console.error('Error cargando clima:', err);
        // Si hay un error de red pero tenemos datos locales, los usamos
        const cachedData = appState.weatherCache[cacheKey] || findNearestCachedWeather(lat, lng);
        if (cachedData) {
            console.log('Error de red. Recurriendo al cache local.');
            return cachedData.weather;
        }
        return null;
    }
}

// Intérprete de Códigos de Clima WMO (Organización Meteorológica Mundial)
function getWeatherInfo(code) {
    const codes = {
        0: { emoji: '☀️', text: 'Despejado' },
        1: { emoji: '🌤️', text: 'Principalmente despejado' },
        2: { emoji: '⛅', text: 'Parcialmente nublado' },
        3: { emoji: '☁️', text: 'Nublado' },
        45: { emoji: '🌫️', text: 'Niebla' },
        48: { emoji: '🌫️', text: 'Niebla de escarcha' },
        51: { emoji: '🌧️', text: 'Llovizna ligera' },
        53: { emoji: '🌧️', text: 'Llovizna moderada' },
        55: { emoji: '🌧️', text: 'Llovizna densa' },
        56: { emoji: '🌧️❄️', text: 'Llovizna helada ligera' },
        57: { emoji: '🌧️❄️', text: 'Llovizna helada densa' },
        61: { emoji: '🌧️', text: 'Lluvia ligera' },
        63: { emoji: '🌧️', text: 'Lluvia moderada' },
        65: { emoji: '🌧️', text: 'Lluvia fuerte' },
        66: { emoji: '🌧️❄️', text: 'Lluvia helada ligera' },
        67: { emoji: '🌧️❄️', text: 'Lluvia helada fuerte' },
        71: { emoji: '❄️', text: 'Nieve ligera' },
        73: { emoji: '❄️', text: 'Nieve moderada' },
        75: { emoji: '❄️', text: 'Nieve fuerte' },
        77: { emoji: '❄️', text: 'Granizo de nieve' },
        80: { emoji: '🌦️', text: 'Chubascos ligeros de lluvia' },
        81: { emoji: '🌦️', text: 'Chubascos moderados de lluvia' },
        82: { emoji: '⛈️', text: 'Chubascos violentos de lluvia' },
        85: { emoji: '🌨️', text: 'Chubascos ligeros de nieve' },
        86: { emoji: '🌨️', text: 'Chubascos fuertes de nieve' },
        95: { emoji: '⛈️', text: 'Tormenta eléctrica' },
        96: { emoji: '⛈️🌨️', text: 'Tormenta con granizo ligero' },
        99: { emoji: '⛈️🌨️', text: 'Tormenta con granizo fuerte' }
    };
    
    return codes[code] || { emoji: '🌡️', text: 'Clima Variable' };
}

// Convertidor de grados a puntos cardinales para dirección del viento
function getWindDirectionText(degrees) {
    if (degrees === undefined || degrees === null) return 'N/D';
    const val = Math.floor((degrees / 22.5) + 0.5);
    const arr = ["N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE", "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW"];
    return arr[(val % 16)];
}

// ==========================================
// 5. RENDERIZACIÓN DE DETALLES & ELEMENTOS
// ==========================================
function displayWeatherDetails(location, data) {
    // Esconder el placeholder inicial, mostrar tarjeta de detalles
    document.getElementById('weather-placeholder').classList.add('hidden');
    const detailsSection = document.getElementById('weather-details-section');
    detailsSection.classList.remove('hidden');
    
    // Inyección Semántica
    document.getElementById('weather-location-name').textContent = location.name;
    document.getElementById('weather-coords').textContent = `Lat: ${location.lat.toFixed(4)}, Lng: ${location.lng.toFixed(4)}`;
    
    const weatherInfo = getWeatherInfo(data.current.weathercode);
    document.getElementById('current-weather-icon').textContent = weatherInfo.emoji;
    document.getElementById('current-temperature').textContent = Math.round(data.current.temperature);
    document.getElementById('current-weather-desc').textContent = weatherInfo.text;
    
    document.getElementById('current-humidity').textContent = `${data.current.humidity}%`;
    document.getElementById('current-wind').textContent = `${data.current.windspeed} km/h`;
    document.getElementById('current-wind-direction').textContent = getWindDirectionText(data.current.winddirection);
    document.getElementById('current-apparent-temp').textContent = `${Math.round(data.current.apparent_temp)}°C`;
    
    // Renderizar Pronóstico 7 días
    renderForecastGrid(data.daily);
    
    // Actualizar botón de favorito
    updateFavoriteButtonState();
}

function renderForecastGrid(daily) {
    const grid = document.getElementById('forecast-grid');
    grid.innerHTML = '';
    
    const days = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];
    
    for (let i = 0; i < 7; i++) {
        if (!daily.time[i]) break;
        
        const dateObj = new Date(daily.time[i] + 'T00:00:00'); // Evitar desfase horario
        const dayName = days[dateObj.getDay()];
        const formattedDate = dateObj.toLocaleDateString('es-ES', { day: '2-digit', month: '2-digit' });
        
        const maxTemp = Math.round(daily.temperature_2m_max[i]);
        const minTemp = Math.round(daily.temperature_2m_min[i]);
        const weatherInfo = getWeatherInfo(daily.weathercode[i]);
        
        const card = document.createElement('div');
        card.className = 'forecast-card';
        card.style.animationDelay = `${i * 0.05}s`; // Efecto cascada secuencial
        
        card.innerHTML = `
            <span class="forecast-day">${dayName}</span>
            <span class="forecast-date">${formattedDate}</span>
            <span class="forecast-icon" title="${weatherInfo.text}">${weatherInfo.emoji}</span>
            <div class="forecast-temp">
                <span class="forecast-temp-max">${maxTemp}°</span>
                <span class="forecast-temp-min">${minTemp}°</span>
            </div>
        `;
        
        grid.appendChild(card);
    }
}

// ==========================================
// 6. GESTIÓN PERSONALIZADA & PERSISTENCIA
// ==========================================
function loadFavorites() {
    const raw = localStorage.getItem(CONFIG.FAVORITES_KEY);
    appState.favorites = raw ? JSON.parse(raw) : [];
}

function saveFavorites() {
    localStorage.setItem(CONFIG.FAVORITES_KEY, JSON.stringify(appState.favorites));
    renderFavorites();
}

function loadWeatherCache() {
    const raw = localStorage.getItem(CONFIG.WEATHER_CACHE_KEY);
    appState.weatherCache = raw ? JSON.parse(raw) : {};
}

function saveToWeatherCache(lat, lng, name, weatherData) {
    const roundedLat = lat.toFixed(2);
    const roundedLng = lng.toFixed(2);
    const cacheKey = `${roundedLat},${roundedLng}`;
    
    appState.weatherCache[cacheKey] = {
        lat: lat,
        lng: lng,
        name: name,
        weather: weatherData,
        timestamp: Date.now()
    };
    
    localStorage.setItem(CONFIG.WEATHER_CACHE_KEY, JSON.stringify(appState.weatherCache));
}

// Búsqueda de ubicación por proximidad en offline
function findNearestCachedWeather(lat, lng) {
    let nearest = null;
    let minDistance = 0.08; // Umbral aprox de 8km de distancia
    
    for (const key in appState.weatherCache) {
        const entry = appState.weatherCache[key];
        const dist = Math.sqrt(Math.pow(entry.lat - lat, 2) + Math.pow(entry.lng - lng, 2));
        if (dist < minDistance) {
            minDistance = dist;
            nearest = entry;
        }
    }
    return nearest;
}

// Buscar en el cache offline usando subcadenas de nombres de localizaciones
function searchOfflineCache(query) {
    const queryLower = query.toLowerCase();
    const results = [];
    const namesSeen = new Set();
    
    // 1. Buscar en cache de clima
    for (const key in appState.weatherCache) {
        const entry = appState.weatherCache[key];
        if (entry.name.toLowerCase().includes(queryLower) && !namesSeen.has(entry.name)) {
            namesSeen.add(entry.name);
            results.push({
                name: entry.name,
                lat: entry.lat,
                lng: entry.lng
            });
        }
    }
    
    // 2. Buscar en favoritos por si no estaban en el cache general
    for (const fav of appState.favorites) {
        if (fav.name.toLowerCase().includes(queryLower) && !namesSeen.has(fav.name)) {
            namesSeen.add(fav.name);
            results.push({
                name: fav.name,
                lat: fav.lat,
                lng: fav.lng
            });
        }
    }
    
    return results.slice(0, 5);
}

// Renderización visual de Favoritos
function renderFavorites() {
    const listEl = document.getElementById('favorites-list');
    const countEl = document.getElementById('favorites-count');
    
    countEl.textContent = appState.favorites.length;
    
    if (appState.favorites.length === 0) {
        listEl.innerHTML = `
            <div class="empty-favorites">
                <p>No tienes ubicaciones guardadas.</p>
                <span>Haz clic en el mapa y presiona "Guardar ubicación" para añadir una.</span>
            </div>
        `;
        return;
    }
    
    listEl.innerHTML = '';
    
    appState.favorites.forEach((fav) => {
        const item = document.createElement('div');
        item.className = 'favorite-item';
        
        // Obtener del cache temporal el clima rápido si existe
        const roundedLat = fav.lat.toFixed(2);
        const roundedLng = fav.lng.toFixed(2);
        const cacheEntry = appState.weatherCache[`${roundedLat},${roundedLng}`];
        const tempText = cacheEntry ? `${Math.round(cacheEntry.weather.current.temperature)}°C` : '';
        const emojiText = cacheEntry ? getWeatherInfo(cacheEntry.weather.current.weathercode).emoji : '📍';
        
        item.innerHTML = `
            <div class="favorite-item-info">
                <span class="favorite-item-title">${fav.name}</span>
                <span class="favorite-item-coords">Lat: ${fav.lat.toFixed(2)}, Lng: ${fav.lng.toFixed(2)}</span>
            </div>
            <div class="favorite-item-right">
                <span class="favorite-item-temp">${emojiText} ${tempText}</span>
                <button class="btn-delete-favorite" title="Eliminar de favoritos">&times;</button>
            </div>
        `;
        
        // Click en elemento: Carga rápida (Reubicar y consultar clima)
        item.addEventListener('click', (e) => {
            if (e.target.classList.contains('btn-delete-favorite')) {
                e.stopPropagation();
                removeFavorite(fav.lat, fav.lng);
            } else {
                selectFavorite(fav);
            }
        });
        
        listEl.appendChild(item);
    });
}

function selectFavorite(fav) {
    currentSelectedLocation = fav;
    map.setView([fav.lat, fav.lng], 12);
    
    // Carga rápida llamando a la consulta climática
    handleMapClick(fav.lat, fav.lng);
}

function toggleFavorite() {
    if (!currentSelectedLocation) return;
    
    const index = getFavoriteIndex(currentSelectedLocation.lat, currentSelectedLocation.lng);
    
    if (index === -1) {
        // Añadir a favoritos
        appState.favorites.push({
            name: currentSelectedLocation.name,
            lat: currentSelectedLocation.lat,
            lng: currentSelectedLocation.lng
        });
    } else {
        // Eliminar
        appState.favorites.splice(index, 1);
    }
    
    saveFavorites();
    updateFavoriteButtonState();
}

function removeFavorite(lat, lng) {
    const index = getFavoriteIndex(lat, lng);
    if (index !== -1) {
        appState.favorites.splice(index, 1);
        saveFavorites();
        updateFavoriteButtonState();
    }
}

function getFavoriteIndex(lat, lng) {
    return appState.favorites.findIndex(fav => {
        // Comparación con precisión de 4 decimales
        return Math.abs(fav.lat - lat) < 0.0001 && Math.abs(fav.lng - lng) < 0.0001;
    });
}

function updateFavoriteButtonState() {
    const btn = document.getElementById('btn-toggle-favorite');
    if (!btn || !currentSelectedLocation) return;
    
    const favText = btn.querySelector('.favorite-text');
    const isFav = getFavoriteIndex(currentSelectedLocation.lat, currentSelectedLocation.lng) !== -1;
    
    if (isFav) {
        btn.classList.add('active');
        favText.textContent = 'Guardado';
    } else {
        btn.classList.remove('active');
        favText.textContent = 'Guardar';
    }
}

// Configurar botón favorito en la interfaz
document.getElementById('btn-toggle-favorite').addEventListener('click', toggleFavorite);

// ==========================================
// 7. BUSCADOR Y AUTO-SUGERENCIAS
// ==========================================
const searchForm = document.getElementById('search-form');
const searchInput = document.getElementById('search-input');
const btnClearSearch = document.getElementById('btn-clear-search');
const searchResultsList = document.getElementById('search-results-list');

let searchDebounceTimeout = null;

// Lógica de tipeo con debounce para evitar saturación de API
searchInput.addEventListener('input', () => {
    const query = searchInput.value.trim();
    
    if (query.length > 0) {
        btnClearSearch.classList.remove('hidden');
    } else {
        btnClearSearch.classList.add('hidden');
        searchResultsList.classList.add('hidden');
    }
    
    clearTimeout(searchDebounceTimeout);
    if (query.length >= 3) {
        searchDebounceTimeout = setTimeout(() => {
            searchLocation(query);
        }, 500);
    } else {
        searchResultsList.classList.add('hidden');
    }
});

// Botón de limpiar input
btnClearSearch.addEventListener('click', () => {
    searchInput.value = '';
    btnClearSearch.classList.add('hidden');
    searchResultsList.classList.add('hidden');
    searchInput.focus();
});

// Evento Submit de Búsqueda
searchForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const query = searchInput.value.trim();
    if (query.length === 0) return;
    
    searchResultsList.classList.add('hidden');
    
    if (appState.isOnline) {
        try {
            const response = await fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query)}&limit=1&addressdetails=1`, {
                headers: {
                    'Accept-Language': 'es'
                }
            });
            if (response.ok) {
                const data = await response.json();
                if (data.length > 0) {
                    const first = data[0];
                    const city = first.address.city || first.address.town || first.address.village || first.display_name.split(',')[0];
                    const country = first.address.country || '';
                    const displayName = country ? `${city}, ${country}` : first.display_name;
                    
                    const item = {
                        name: displayName,
                        lat: parseFloat(first.lat),
                        lng: parseFloat(first.lon)
                    };
                    
                    // Carga rápida
                    selectFavorite(item);
                } else {
                    alert('No se encontraron resultados para la búsqueda.');
                }
            }
        } catch (err) {
            console.error('Error al realizar búsqueda directa:', err);
        }
    } else {
        // Offline
        const offlineResults = searchOfflineCache(query);
        if (offlineResults.length > 0) {
            selectFavorite(offlineResults[0]);
        } else {
            alert('No hay coincidencias guardadas localmente para esta búsqueda en modo offline.');
        }
    }
});

// Renderizar lista flotante de resultados
function renderSearchResults(results) {
    if (results.length === 0) {
        searchResultsList.classList.add('hidden');
        return;
    }
    
    searchResultsList.innerHTML = '';
    searchResultsList.classList.remove('hidden');
    
    results.forEach(res => {
        const div = document.createElement('div');
        div.className = 'search-result-item';
        div.textContent = res.name;
        
        div.addEventListener('click', () => {
            searchResultsList.classList.add('hidden');
            searchInput.value = res.name;
            selectFavorite(res);
        });
        
        searchResultsList.appendChild(div);
    });
}

// Ocultar buscador si se hace clic afuera
document.addEventListener('click', (e) => {
    if (!searchForm.contains(e.target) && !searchResultsList.contains(e.target)) {
        searchResultsList.classList.add('hidden');
    }
});

// ==========================================
// 8. TEMATIZACIÓN DUAL (LIGHT / DARK MODE)
// ==========================================
const themeToggle = document.getElementById('theme-toggle');

themeToggle.addEventListener('click', () => {
    document.body.classList.toggle('light-mode');
    document.body.classList.toggle('dark-mode');
    
    const activeTheme = document.body.classList.contains('light-mode') ? 'light' : 'dark';
    localStorage.setItem(CONFIG.THEME_KEY, activeTheme);
});

function loadThemePreference() {
    const savedTheme = localStorage.getItem(CONFIG.THEME_KEY);
    
    if (savedTheme === 'light') {
        document.body.classList.remove('dark-mode');
        document.body.classList.add('light-mode');
    } else {
        document.body.classList.remove('light-mode');
        document.body.classList.add('dark-mode');
    }
}

// ==========================================
// 9. RESILIENCIA Y MODO OFFLINE
// ==========================================
function setupOfflineMonitor() {
    const offlineBanner = document.getElementById('offline-banner');
    
    window.addEventListener('online', () => {
        appState.isOnline = true;
        offlineBanner.classList.add('hidden');
        console.log('Conexión reestablecida.');
        // Recargar datos dinámicos si se desea
        if (currentSelectedLocation) {
            handleMapClick(currentSelectedLocation.lat, currentSelectedLocation.lng);
        }
    });
    
    window.addEventListener('offline', () => {
        appState.isOnline = false;
        offlineBanner.classList.remove('hidden');
        console.log('Conexión perdida. Iniciando modo offline.');
    });
    
    // Establecer estado inicial
    if (!appState.isOnline) {
        offlineBanner.classList.remove('hidden');
    } else {
        offlineBanner.classList.add('hidden');
    }
}

// Registro del Service Worker para almacenamiento en caché local
function registerServiceWorker() {
    if ('serviceWorker' in navigator) {
        window.addEventListener('load', () => {
            navigator.serviceWorker.register('./sw.js')
                .then(reg => {
                    console.log('Service Worker registrado con éxito. Scope:', reg.scope);
                })
                .catch(err => {
                    console.warn('Error al registrar Service Worker:', err);
                });
        });
    }
}
