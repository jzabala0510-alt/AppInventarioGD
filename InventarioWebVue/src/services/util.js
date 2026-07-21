import { api } from './api';

export async function obtenerApk() {
  const { data } = await api.get('/util/getApk');
  return data;
}
