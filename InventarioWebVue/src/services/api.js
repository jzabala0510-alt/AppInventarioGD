import axios from 'axios';
import { useAuthStore } from '../stores/auth';
import { apiConfig } from './apiConfig';

export const api = axios.create();

api.interceptors.request.use((requestConfig) => {
  requestConfig.baseURL = apiConfig.baseUrl;

  const auth = useAuthStore();
  if (auth.token) {
    requestConfig.headers.Authorization = `Bearer ${auth.token}`;
  }
  return requestConfig;
});
