import { api } from './api';

export async function obtenerDatosConexion() {
  const { data } = await api.get('/sql/obtenerDatosConexion');
  return data;
}

export async function obtenerPasswords() {
  const { data } = await api.get('/sql/obtenerPasswords');
  return data;
}

export async function probarConexion(datos) {
  const { data } = await api.post('/sql/probarConexion', datos);
  return data;
}

export async function guardarDatosConexion(datos) {
  const { data } = await api.post('/sql/guardarDatosConexion', datos);
  return data;
}
