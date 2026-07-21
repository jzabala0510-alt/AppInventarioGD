import { api } from './api';
import { apiConfig } from './apiConfig';

export async function listarConteos() {
  const { data } = await api.get('/conteo/obtenerConteos');
  return data;
}

export async function crearConteo({ codAlmacen, fecha, observacion }) {
  const { data } = await api.post('/conteo/crear', { codAlmacen, fecha, observacion });
  return data;
}

export async function eliminarConteo(idConteo) {
  const { data } = await api.get(`/conteo/eliminarConteo/${idConteo}`);
  return data;
}

export async function obtenerDetalleConteo(idConteo, filtro = {}) {
  const { data } = await api.get(`/conteo/obtenerDetalleConteo/${idConteo}`, { params: filtro });
  return data;
}

export async function obtenerFiltroConteo(idConteo) {
  const { data } = await api.get(`/conteo/obtenerFiltroConteo/${idConteo}`);
  return data;
}

export async function getResumenEnvios(idConteo) {
  const { data } = await api.get(`/conteo/getResumenEnvios/${idConteo}`);
  return data;
}

export async function hayVentaEspera() {
  const { data } = await api.get('/conteo/hayVentaEspera');
  return data;
}

export async function obtenerConteoArticulo({ fecha, codAlmacen, codArticulo, talla, color }) {
  const { data } = await api.get('/conteo/obtenerConteoArticulo', {
    params: { fecha, codAlmacen, codArticulo, talla, color },
  });
  return data;
}

export async function eliminarRegistro(id) {
  const { data } = await api.get(`/conteo/eliminarRegistro/${id}`);
  return data;
}

export async function actualizarConteoArticulo({ id, unidades, codUsuario }) {
  const { data } = await api.post('/conteo/actualizarConteoArticulo', { id, unidades, codUsuario });
  return data;
}

export function urlExportarExcel(idConteo, filtro = {}) {
  const params = new URLSearchParams(
    Object.entries(filtro).filter(([, value]) => value !== undefined && value !== null && value !== ''),
  );
  const query = params.toString();
  return `${apiConfig.baseUrl}/conteo/obtenerExcel2/${idConteo}${query ? `?${query}` : ''}`;
}
