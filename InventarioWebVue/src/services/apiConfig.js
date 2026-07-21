import { reactive } from 'vue';

const STORAGE_KEY = 'inventario_api_base_url';
const PUERTO_BACKEND = import.meta.env.VITE_BACKEND_PORT || '8086';
const RUTA_BASE = import.meta.env.VITE_BASE_PATH || '/Reposiciones/recursos';

// El frontend y el backend viven en el mismo dispositivo (servicios NSSM), y ese
// dispositivo cambia de red. En vez de depender de una IP fija que se vuelve
// invalida cada vez que cambia la red, la direccion por defecto se calcula a
// partir de la misma direccion que el navegador esta usando AHORA MISMO para
// cargar el frontend -- eso siempre es valido en la red actual, sin tocar nada.
//
// En produccion el backend sirve este mismo frontend (mismo origen exacto),
// asi que ahi ni hace falta adivinar el puerto. Solo en desarrollo (`vite dev`
// en :5173, backend en :8086) hace falta la version que arma el puerto a mano.
function calcularBaseUrlPorDefecto() {
  if (import.meta.env.DEV) {
    const { protocol, hostname } = window.location;
    return `${protocol}//${hostname}:${PUERTO_BACKEND}${RUTA_BASE}`;
  }
  return `${window.location.origin}${RUTA_BASE}`;
}

export const apiConfig = reactive({
  baseUrl: localStorage.getItem(STORAGE_KEY) || calcularBaseUrlPorDefecto(),
});

export function actualizarApiBaseUrl(url) {
  const limpio = url.trim().replace(/\/+$/, '');
  apiConfig.baseUrl = limpio;
  localStorage.setItem(STORAGE_KEY, limpio);
}

export function restablecerApiBaseUrl() {
  localStorage.removeItem(STORAGE_KEY);
  apiConfig.baseUrl = calcularBaseUrlPorDefecto();
}

export function esConfiguracionPersonalizada() {
  return localStorage.getItem(STORAGE_KEY) !== null;
}
