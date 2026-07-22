<script setup>
import { onMounted, ref } from 'vue';
import * as actualizadorService from '../services/actualizador';
import { api } from '../services/api';
import Spinner from '../components/Spinner.vue';

const estado = ref(null);
const cargandoEstado = ref(true);
const clave = ref('');
const actualizando = ref(false);
const reiniciando = ref(false);
const resultado = ref(null);

onMounted(cargarEstado);

async function cargarEstado() {
  cargandoEstado.value = true;
  try {
    estado.value = await actualizadorService.obtenerEstado();
  } catch {
    estado.value = null;
  } finally {
    cargandoEstado.value = false;
  }
}

function formatearFecha(iso) {
  if (!iso) return '';
  return new Date(iso).toLocaleString('es-VE');
}

// Tras aplicar la actualizacion el proceso se reinicia solo -- hay que
// esperar a que deje de responder y vuelva a estar arriba antes de dar por
// terminado el ciclo.
async function esperarReinicio() {
  const esperar = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  await esperar(1500);
  for (let intento = 0; intento < 40; intento++) {
    try {
      await api.get('/_health');
      return;
    } catch {
      await esperar(1500);
    }
  }
  throw new Error('El servicio no volvió a responder a tiempo. Verifica el servicio manualmente.');
}

async function ejecutarActualizacion() {
  if (!clave.value) return;
  actualizando.value = true;
  resultado.value = null;
  try {
    const respuesta = await actualizadorService.actualizar(clave.value);
    if (!respuesta.success) {
      resultado.value = { ok: false, mensaje: respuesta.respuesta };
      return;
    }
    reiniciando.value = true;
    await esperarReinicio();
    clave.value = '';
    resultado.value = { ok: true, mensaje: 'Actualización completa — el servicio ya volvió a estar disponible.' };
    await cargarEstado();
  } catch (err) {
    resultado.value = { ok: false, mensaje: err.response?.data?.respuesta || err.message || 'No se pudo actualizar' };
  } finally {
    actualizando.value = false;
    reiniciando.value = false;
  }
}
</script>

<template>
  <div>
    <div class="page-header">
      <h1>Actualizador</h1>
    </div>

    <div v-if="cargandoEstado" class="empty-state"><Spinner /></div>

    <form v-else class="card actualizador-card" @submit.prevent="ejecutarActualizacion">
      <p class="ayuda">
        Descarga la última versión publicada en GitHub, la aplica y reinicia el servicio.
        Solo quien tenga la clave puede hacerlo.
      </p>

      <div v-if="estado?.commit" class="version-actual mono">
        <span class="version-sha">{{ estado.commit.slice(0, 7) }}</span>
        <span v-if="estado.mensaje" class="version-mensaje">{{ estado.mensaje }}</span>
        <span v-if="estado.aplicado" class="version-fecha">{{ formatearFecha(estado.aplicado) }}</span>
      </div>
      <p v-else class="ayuda">Aún no se ha aplicado ninguna actualización desde esta pantalla.</p>

      <p v-if="estado && !estado.configurado" class="login-error">
        El actualizador no tiene configurado el repositorio de GitHub (revisa UPDATER_REPO_OWNER /
        UPDATER_REPO_NAME en el .env del backend).
      </p>

      <div class="field">
        <label for="clave">Clave de actualización</label>
        <input
          id="clave"
          v-model="clave"
          type="password"
          class="input"
          required
          :disabled="actualizando"
        />
      </div>

      <div class="acciones">
        <button type="submit" class="btn btn-primary" :disabled="actualizando || !estado?.configurado">
          <Spinner v-if="actualizando" :size="14" />
          <span>{{ reiniciando ? 'Reiniciando…' : actualizando ? 'Actualizando…' : 'Actualizar' }}</span>
        </button>
      </div>

      <p v-if="resultado" :class="resultado.ok ? 'resultado-ok' : 'login-error'">{{ resultado.mensaje }}</p>
    </form>
  </div>
</template>

<style scoped>
.actualizador-card {
  width: min(480px, 100%);
  padding: 1.5rem;
  display: flex;
  flex-direction: column;
  gap: 1.25rem;
}

.ayuda {
  margin: 0;
  font-size: 13px;
  color: var(--text-secondary);
  font-weight: 400;
}

.version-actual {
  display: flex;
  flex-direction: column;
  gap: 2px;
  background: var(--bg-surface-alt);
  border-radius: var(--radius);
  padding: 10px 14px;
  font-size: 13px;
}

.version-sha {
  font-weight: 600;
  color: var(--color-primary);
}

.version-mensaje {
  color: var(--text-primary);
}

.version-fecha {
  color: var(--text-secondary);
  font-size: 12px;
}

.acciones {
  display: flex;
  gap: 8px;
}

.resultado-ok {
  color: var(--color-success);
  font-size: 13px;
  margin: 0;
}
</style>
