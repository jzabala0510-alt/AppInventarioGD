<script setup>
import { useThemeStore } from '../stores/theme';

const theme = useThemeStore();
</script>

<template>
  <div class="theme-toggle" role="group" aria-label="Tema">
    <button
      type="button"
      class="theme-toggle-btn"
      :class="{ active: theme.tema === 'light' }"
      aria-label="Modo claro"
      aria-pressed="theme.tema === 'light'"
      @click="theme.fijar('light')"
    >
      <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <circle cx="12" cy="12" r="4" />
        <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" />
      </svg>
    </button>
    <button
      type="button"
      class="theme-toggle-btn"
      :class="{ active: theme.tema === 'dark' }"
      aria-label="Modo oscuro"
      aria-pressed="theme.tema === 'dark'"
      @click="theme.fijar('dark')"
    >
      <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
      </svg>
    </button>
  </div>
</template>

<style scoped>
.theme-toggle {
  display: inline-flex;
  border: 1px solid rgba(128, 128, 128, 0.3);
  border-radius: var(--radius);
  overflow: hidden;
}

.theme-toggle-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  flex: 1;
  height: 34px;
  padding: 0 14px;
  background: none;
  border: none;
  color: inherit;
  opacity: 0.55;
  cursor: pointer;
}

.theme-toggle-btn:first-child {
  border-right: 1px solid rgba(128, 128, 128, 0.3);
}

.theme-toggle-btn:hover {
  opacity: 0.85;
  background: rgba(128, 128, 128, 0.12);
}

.theme-toggle-btn.active {
  opacity: 1;
  background: var(--color-primary);
  color: var(--text-on-primary);
}
</style>
