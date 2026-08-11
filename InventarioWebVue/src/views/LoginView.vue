<script setup>
import { computed, onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import { useAuthStore } from '../stores/auth';
import { listarVendedores, login as loginVendedor } from '../services/vendedores';
import { api } from '../services/api';
import AppLogo from '../components/AppLogo.vue';
import Spinner from '../components/Spinner.vue';
import SearchableSelect from '../components/SearchableSelect.vue';
import ThemeToggle from '../components/ThemeToggle.vue';
import DireccionServidorBox from '../components/DireccionServidorBox.vue';

const router = useRouter();
const auth = useAuthStore();

const vendedores = ref([]);
const opcionesVendedores = computed(() =>
  vendedores.value.map((v) => ({ value: v.codVendedor, label: v.nombreVendedor })),
);
const codVendedor = ref('');
const password = ref('');
const errorLogin = ref(null);
const enviando = ref(false);
const alertaMermas = ref([]);  // almacenes de mermas con stock > 0

onMounted(async () => {
  try {
    vendedores.value = await listarVendedores();
  } catch {
    // Sin conexion no hay nada que hacer en Login -- se manda derecho a
    // Configuracion en vez de dejar a alguien varado viendo un error suelto.
    router.replace({ name: 'configuracion', query: { motivo: 'sin-conexion' } });
  }
});

async function handleSubmit() {
  if (!codVendedor.value || !password.value) {
    errorLogin.value = 'Selecciona un usuario e ingresa la contraseña';
    return;
  }
  errorLogin.value = null;
  enviando.value = true;
  try {
    const respuesta = await loginVendedor(codVendedor.value, password.value);
    if (!respuesta.success) {
      errorLogin.value = respuesta.respuesta || 'Datos incorrectos';
      return;
    }
    const vendedor = vendedores.value.find((v) => v.codVendedor === Number(codVendedor.value));
    auth.iniciarSesion({
      token: respuesta.respuesta,
      codVendedor: Number(codVendedor.value),
      nombreVendedor: vendedor?.nombreVendedor ?? '',
    });
    // Verificar mermas antes de redirigir -- error silencioso para no bloquear el login.
    try {
      const { data } = await api.get('/util/alertas-mermas');
      if (data.length > 0) {
        alertaMermas.value = data;
        return; // queda en la pantalla de login mostrando la alerta
      }
    } catch { /* sin BD o error: ignorar */ }
    router.push({ name: 'inicio' });
  } catch {
    errorLogin.value = 'No se pudo conectar con el servidor';
  } finally {
    enviando.value = false;
  }
}
</script>

<template>
  <div class="login-page">
    <ThemeToggle class="login-theme-toggle" />

    <section class="brand-panel">
      <AppLogo :size="120" />
      <p class="brand-copy">Conteos de inventario</p>

      <DireccionServidorBox />
    </section>

    <section class="form-panel">
      <form class="login-card card" @submit.prevent="handleSubmit">
        <h1>Iniciar sesión</h1>

        <div class="field">
          <label for="usuario">Usuario</label>
          <SearchableSelect
            v-model="codVendedor"
            :options="opcionesVendedores"
            placeholder="Buscar usuario…"
          />
        </div>

        <div class="field">
          <label for="password">Contraseña</label>
          <input id="password" v-model="password" type="password" class="input" required />
        </div>

        <p v-if="errorLogin" class="login-error">{{ errorLogin }}</p>

        <!-- Alerta de mermas: se muestra si hay stock en almacenes de mermas -->
        <div v-if="alertaMermas.length" class="alerta-mermas">
          <p class="alerta-mermas__titulo">⚠ Atención — Stock en almacén de mermas</p>
          <p v-for="a in alertaMermas" :key="a.codAlmacen" class="alerta-mermas__linea">
            {{ a.nombre }}: <strong>{{ a.totalStock.toLocaleString('es-VE') }}</strong> unidades
          </p>
          <button type="button" class="btn btn-primary" @click="router.push({ name: 'inicio' })">
            Entendido, continuar
          </button>
        </div>

        <template v-else>
          <button type="submit" class="btn btn-primary" :disabled="enviando">
            <Spinner v-if="enviando" :size="16" />
            <span>{{ enviando ? 'Ingresando…' : 'Iniciar sesión' }}</span>
          </button>

          <RouterLink :to="{ name: 'configuracion' }" class="enlace-configuracion">
            ¿No puedes conectar? Configurar servidor
          </RouterLink>
        </template>
      </form>
    </section>
  </div>
</template>

<style scoped>
.login-page {
  position: relative;
  min-height: 100vh;
  display: grid;
  grid-template-columns: minmax(280px, 1fr) minmax(320px, 1fr);
}

.login-theme-toggle {
  position: absolute;
  top: 1rem;
  right: 1rem;
  z-index: 1;
  background: var(--bg-surface);
}

.brand-panel {
  background: var(--bg-sidebar);
  color: var(--text-on-sidebar);
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 1.5rem;
  padding: 2rem;
}

.brand-copy {
  color: var(--text-on-sidebar-muted);
  margin: -1rem 0 0;
}

.enlace-configuracion {
  text-align: center;
  font-size: 13px;
  color: var(--text-secondary);
}

.form-panel {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 2rem;
  background: var(--bg-page);
}

.login-card {
  width: min(360px, 100%);
  padding: 2rem;
  display: flex;
  flex-direction: column;
  gap: 1.25rem;
}

.login-error {
  margin: -0.5rem 0 0;
  color: var(--color-danger);
  font-size: 13px;
}

.alerta-mermas {
  background: color-mix(in srgb, var(--color-warning, #f59e0b) 12%, transparent);
  border: 1px solid color-mix(in srgb, var(--color-warning, #f59e0b) 50%, transparent);
  border-radius: var(--radius);
  padding: 1rem;
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.alerta-mermas__titulo {
  font-weight: 600;
  font-size: 14px;
  color: var(--color-warning, #b45309);
  margin: 0;
}

.alerta-mermas__linea {
  font-size: 13px;
  margin: 0;
  color: var(--text-primary);
}

@media (max-width: 720px) {
  .login-page {
    grid-template-columns: 1fr;
  }
}
</style>
