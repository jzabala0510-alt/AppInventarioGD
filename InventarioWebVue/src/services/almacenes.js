import { api } from './api';

export async function listarAlmacenes() {
  const { data } = await api.get('/almacen');
  return data;
}
