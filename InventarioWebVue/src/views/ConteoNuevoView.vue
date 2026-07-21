<script setup>
import { onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import * as conteosService from '../services/conteos';
import { listarAlmacenes } from '../services/almacenes';
import Spinner from '../components/Spinner.vue';

const router = useRouter();

const almacenes = ref([]);
const fecha = ref('');
const codAlmacen = ref('');
const observacion = ref('');
const enviando = ref(false);
const error = ref(null);

onMounted(async () => {
  try {
    almacenes.value = await listarAlmacenes();
  } catch {
    error.value = 'No se pudieron cargar los almacenes';
  }
});

async function enviar() {
  if (!fecha.value || !codAlmacen.value) {
    error.value = 'Los campos Fecha y Almacén son obligatorios';
    return;
  }
  error.value = null;
  enviando.value = true;
  try {
    await conteosService.crearConteo({
      fecha: fecha.value,
      codAlmacen: codAlmacen.value,
      observacion: observacion.value,
    });
    router.push({ name: 'inicio' });
  } catch {
    error.value = 'No se pudo crear el conteo';
  } finally {
    enviando.value = false;
  }
}
</script>

<template>
  <div>
    <div class="page-header">
      <h1>Nuevo conteo</h1>
    </div>

    <form class="card form-card" @submit.prevent="enviar">
      <p v-if="error" class="login-error">{{ error }}</p>

      <div class="field">
        <label for="fecha">Fecha</label>
        <input id="fecha" v-model="fecha" type="date" class="input" required />
      </div>

      <div class="field">
        <label for="almacen">Almacén</label>
        <select id="almacen" v-model="codAlmacen" class="select" required>
          <option value="" disabled>Seleccionar...</option>
          <option v-for="a in almacenes" :key="a.codAlmacen" :value="a.codAlmacen">
            {{ a.nombreAlmacen }}
          </option>
        </select>
      </div>

      <div class="field">
        <label for="observacion">Observación</label>
        <textarea id="observacion" v-model="observacion" class="textarea"></textarea>
      </div>

      <button type="submit" class="btn btn-primary" :disabled="enviando">
        <Spinner v-if="enviando" :size="16" />
        <span>{{ enviando ? 'Creando…' : 'Crear conteo' }}</span>
      </button>
    </form>
  </div>
</template>

<style scoped>
.form-card {
  width: min(480px, 100%);
  padding: 1.5rem;
  display: flex;
  flex-direction: column;
  gap: 1rem;
}
</style>
