import { api } from './api';

export async function listarVendedores() {
  const { data } = await api.get('/vendedor');
  return data;
}

export async function login(codVendedor, password) {
  const { data } = await api.post('/vendedor', { codVendedor, password });
  return data;
}
