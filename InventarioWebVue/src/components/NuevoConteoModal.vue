<script setup>
import { onMounted, ref, watch } from 'vue';
import { listarAlmacenes } from '../services/almacenes';
import * as conteosService from '../services/conteos';
import Spinner from './Spinner.vue';

const props = defineProps({
  open: { type: Boolean, default: false },
});

const emit = defineEmits(['creado', 'cancelar']);

const almacenes = ref([]);
const fecha = ref('');
const codAlmacen = ref('');
const observacion = ref('');
const enviando = ref(false);
const error = ref(null);

onMounted(cargarAlmacenes);

async function cargarAlmacenes() {
  try {
    almacenes.value = await listarAlmacenes();
  } catch {
    error.value = 'No se pudieron cargar los almacenes';
  }
}

watch(
  () => props.open,
  (abierto) => {
    if (abierto) {
      fecha.value = '';
      codAlmacen.value = '';
      observacion.value = '';
      error.value = null;
    }
  },
);

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
    emit('creado');
  } catch {
    error.value = 'No se pudo crear el conteo';
  } finally {
    enviando.value = false;
  }
}
</script>

<template>
  <Teleport to="body">
    <div v-if="open" class="overlay" @click.self="emit('cancelar')">
      <div class="dialog" role="dialog" aria-modal="true" aria-labelledby="modal-titulo">
        <div class="dialog-header">
          <h3 id="modal-titulo">Nuevo conteo</h3>
          <button type="button" class="btn-cerrar" aria-label="Cerrar" @click="emit('cancelar')">✕</button>
        </div>

        <form @submit.prevent="enviar">
          <p v-if="error" class="login-error">{{ error }}</p>

          <div class="field">
            <label for="nc-fecha">Fecha</label>
            <input id="nc-fecha" v-model="fecha" type="date" class="input" required :disabled="enviando" />
          </div>

          <div class="field">
            <label for="nc-almacen">Almacén</label>
            <select id="nc-almacen" v-model="codAlmacen" class="select" required :disabled="enviando">
              <option value="" disabled>Seleccionar...</option>
              <option v-for="a in almacenes" :key="a.codAlmacen" :value="a.codAlmacen">
                {{ a.nombreAlmacen }}
              </option>
            </select>
          </div>

          <div class="field">
            <label for="nc-observacion">Observación</label>
            <textarea id="nc-observacion" v-model="observacion" class="textarea" :disabled="enviando"></textarea>
          </div>

          <div class="dialog-acciones">
            <button type="button" class="btn" :disabled="enviando" @click="emit('cancelar')">Cancelar</button>
            <button type="submit" class="btn btn-primary" :disabled="enviando">
              <Spinner v-if="enviando" :size="14" />
              <span>{{ enviando ? 'Creando…' : 'Crear conteo' }}</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.overlay {
  position: fixed;
  inset: 0;
  background: rgba(20, 20, 18, 0.45);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 100;
}

.dialog {
  background: var(--bg-surface);
  border-radius: var(--radius-lg);
  padding: 1.5rem;
  width: min(440px, 92vw);
  box-shadow: var(--shadow-md);
  display: flex;
  flex-direction: column;
  gap: 1.25rem;
}

.dialog-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.dialog-header h3 {
  margin: 0;
}

.btn-cerrar {
  background: none;
  border: none;
  color: var(--text-secondary);
  font-size: 18px;
  cursor: pointer;
  line-height: 1;
  padding: 4px;
  border-radius: var(--radius);
}

.btn-cerrar:hover {
  color: var(--text-primary);
  background: var(--bg-surface-alt);
}

form {
  display: flex;
  flex-direction: column;
  gap: 1rem;
}

.dialog-acciones {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 0.25rem;
}
</style>
