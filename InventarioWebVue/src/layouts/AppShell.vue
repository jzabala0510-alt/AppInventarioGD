<script setup>
import { computed } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useAuthStore } from '../stores/auth';
import AppLogo from '../components/AppLogo.vue';
import ThemeToggle from '../components/ThemeToggle.vue';
import DireccionServidorBox from '../components/DireccionServidorBox.vue';

const route = useRoute();
const router = useRouter();
const auth = useAuthStore();

const TODOS_LOS_ITEMS = [
  { name: 'inicio', label: 'Conteos', requiereSesion: true },
  { name: 'conteo-nuevo', label: 'Nuevo conteo', requiereSesion: true },
  { name: 'configuracion', label: 'Configuración', requiereSesion: false },
  { name: 'actualizador', label: 'Actualizador', requiereSesion: true },
];

// Configuracion es publica (ver router) porque hay que poder llegar ahi sin
// sesion si la base de datos no esta configurada -- pero sin sesion no tiene
// sentido mostrar enlaces que solo van a rebotar de vuelta al login.
const navItems = computed(() => TODOS_LOS_ITEMS.filter((item) => !item.requiereSesion || auth.estaAutenticado));

function cerrarSesion() {
  auth.cerrarSesion();
  router.push({ name: 'login' });
}
</script>

<template>
  <div class="shell">
    <aside class="sidebar">
      <div class="sidebar-brand">
        <AppLogo :size="64" />
      </div>

      <DireccionServidorBox compacto />

      <nav class="sidebar-nav">
        <RouterLink
          v-for="item in navItems"
          :key="item.name"
          :to="{ name: item.name }"
          class="sidebar-link"
          :class="{ active: route.name === item.name }"
        >
          {{ item.label }}
        </RouterLink>
      </nav>

      <div class="sidebar-footer">
        <div v-if="auth.estaAutenticado" class="sidebar-user">{{ auth.nombreVendedor }}</div>
        <ThemeToggle />
        <button v-if="auth.estaAutenticado" type="button" class="sidebar-logout" @click="cerrarSesion">
          Cerrar sesión
        </button>
        <RouterLink v-else :to="{ name: 'login' }" class="sidebar-logout">Iniciar sesión</RouterLink>
      </div>
    </aside>

    <main class="main">
      <RouterView />
    </main>
  </div>
</template>

<style scoped>
.shell {
  display: grid;
  grid-template-columns: var(--sidebar-width) 1fr;
  min-height: 100vh;
}

.sidebar {
  background: var(--bg-sidebar);
  color: var(--text-on-sidebar);
  display: flex;
  flex-direction: column;
  padding: 1.25rem 1rem;
  gap: 2rem;
}

.sidebar-brand {
  display: flex;
  align-items: center;
  padding: 0 0.25rem;
}

.sidebar-nav {
  display: flex;
  flex-direction: column;
  gap: 4px;
  flex: 1;
}

.sidebar-link {
  color: var(--text-on-sidebar-muted);
  text-decoration: none;
  padding: 10px 12px;
  border-radius: var(--radius);
  font-weight: 500;
  font-size: 14px;
  transition: background-color 150ms, color 150ms;
}

.sidebar-link:hover {
  background: rgba(255, 255, 255, 0.08);
  color: var(--text-on-sidebar);
}

.sidebar-link.active {
  background: var(--color-primary);
  color: var(--text-on-primary);
}

.sidebar-footer {
  display: flex;
  flex-direction: column;
  gap: 8px;
  border-top: 1px solid rgba(255, 255, 255, 0.1);
  padding-top: 1rem;
}

.sidebar-user {
  font-size: 13px;
  color: var(--text-on-sidebar-muted);
  padding: 0 12px;
}

.sidebar-logout {
  display: block;
  background: none;
  border: 1px solid rgba(255, 255, 255, 0.15);
  color: var(--text-on-sidebar);
  border-radius: var(--radius);
  padding: 8px 12px;
  text-align: left;
  text-decoration: none;
  font-size: 14px;
  cursor: pointer;
}

.sidebar-logout:hover {
  background: rgba(255, 255, 255, 0.08);
}

.main {
  overflow-y: auto;
  padding: 1.5rem 2rem;
}
</style>
