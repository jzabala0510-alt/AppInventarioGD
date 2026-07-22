import { api } from './api';

export async function obtenerEstado() {
  const { data } = await api.get('/actualizador/estado');
  return data;
}

export async function actualizar(clave) {
  const { data } = await api.post('/actualizador/actualizar', { clave });
  return data;
}
