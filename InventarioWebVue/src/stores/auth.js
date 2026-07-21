import { defineStore } from 'pinia';

const STORAGE_KEY = 'inventario_sesion';

function leerSesionGuardada() {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

const sesionGuardada = leerSesionGuardada();

export const useAuthStore = defineStore('auth', {
  state: () => ({
    token: sesionGuardada?.token ?? null,
    codVendedor: sesionGuardada?.codVendedor ?? null,
    nombreVendedor: sesionGuardada?.nombreVendedor ?? null,
  }),
  getters: {
    estaAutenticado: (state) => Boolean(state.token),
  },
  actions: {
    iniciarSesion({ token, codVendedor, nombreVendedor }) {
      this.token = token;
      this.codVendedor = codVendedor;
      this.nombreVendedor = nombreVendedor;
      sessionStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({ token, codVendedor, nombreVendedor }),
      );
    },
    cerrarSesion() {
      this.token = null;
      this.codVendedor = null;
      this.nombreVendedor = null;
      sessionStorage.removeItem(STORAGE_KEY);
    },
  },
});
