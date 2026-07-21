import { defineStore } from 'pinia';

const STORAGE_KEY = 'inventario_tema';

function temaInicial() {
  const guardado = localStorage.getItem(STORAGE_KEY);
  if (guardado === 'light' || guardado === 'dark') return guardado;
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

export const useThemeStore = defineStore('theme', {
  state: () => ({
    tema: temaInicial(),
  }),
  actions: {
    aplicar() {
      document.documentElement.setAttribute('data-theme', this.tema);
    },
    fijar(tema) {
      if (this.tema === tema) return;
      this.tema = tema;
      localStorage.setItem(STORAGE_KEY, tema);
      this.aplicar();
    },
  },
});
