import { api } from './api';

export async function obtenerEstado() {
  const { data } = await api.get('/telestock/estado');
  return data;
}

export async function obtenerConfiguracion() {
  const { data } = await api.get('/telestock/configuracion');
  return data;
}

export async function probarConfiguracion({ baseUrl, usuario, password }) {
  const { data } = await api.post('/telestock/configuracion/probar', { baseUrl, usuario, password });
  return data;
}

export async function guardarConfiguracion({ baseUrl, usuario, password }) {
  const { data } = await api.post('/telestock/configuracion', { baseUrl, usuario, password });
  return data;
}

// Lee la central 1 de ICGFRONT.dbo.CENTRALES, la prueba y la guarda si
// responde. Con 422 viene igual { baseUrl, usuario } detectados.
export async function detectarConfiguracion() {
  const { data } = await api.post('/telestock/configuracion/detectar', {});
  return data;
}

export async function listarFacturas() {
  const { data } = await api.get('/telestock/facturas');
  return data;
}

export async function crearSesion({ serie, numero, n }) {
  const { data } = await api.post('/telestock/sesiones', { serie, numero, n });
  return data;
}

export async function listarSesiones() {
  const { data } = await api.get('/telestock/sesiones');
  return data;
}

export async function obtenerSesion(idSesion) {
  const { data } = await api.get(`/telestock/sesiones/${idSesion}`);
  return data;
}

export async function reabrirSesion(idSesion) {
  const { data } = await api.post(`/telestock/sesiones/${idSesion}/reabrir`, {});
  return data;
}

export async function escanear(idSesion, codigoBarras) {
  const { data } = await api.post(`/telestock/sesiones/${idSesion}/escanear`, { codigoBarras });
  return data;
}

export async function cerrarSesion(idSesion) {
  const { data } = await api.post(`/telestock/sesiones/${idSesion}/cerrar`, {});
  return data;
}

// El backend responde {error, codigoNoPertenece} en las rutas de telestock
// (distinto del {success,respuesta} de actualizador) -- este helper cubre
// las dos formas para no repetirlo en cada catch de las vistas.
export function mensajeError(err) {
  return err.response?.data?.error || err.response?.data?.respuesta || err.message || 'Ocurrió un error';
}
