<script setup>
import { onMounted, ref } from 'vue';
import { obtenerApk } from '../services/util';
import Spinner from './Spinner.vue';

defineProps({
  compacto: {
    type: Boolean,
    default: false,
  },
});

const apk = ref({ qr: null, direccion: null });
const cargando = ref(true);
const copiado = ref(false);

onMounted(async () => {
  try {
    const data = await obtenerApk();
    apk.value = { qr: data.qr, direccion: data.urlWS };
  } catch {
    // No es critico -- el bloque simplemente no muestra nada si falla.
  } finally {
    cargando.value = false;
  }
});

async function copiarDireccion() {
  if (!apk.value.direccion) return;
  await navigator.clipboard.writeText(apk.value.direccion);
  copiado.value = true;
  setTimeout(() => {
    copiado.value = false;
  }, 1500);
}
</script>

<template>
  <div class="conexion-box" :class="{ compacto }">
    <p class="conexion-label">Dirección del servidor</p>
    <p v-if="!compacto" class="conexion-copy">Configura la app móvil de conteos con esta dirección</p>
    <div v-if="cargando" class="conexion-loading"><Spinner :size="compacto ? 18 : 24" /></div>
    <template v-else-if="apk.direccion && compacto">
      <button type="button" class="conexion-direccion-compacta mono" @click="copiarDireccion" :title="copiado ? 'Copiado' : 'Clic para copiar'">
        {{ copiado ? 'Copiado ✓' : apk.direccion }}
      </button>
    </template>
    <template v-else-if="apk.direccion">
      <div class="conexion-direccion mono">
        {{ apk.direccion }}
        <button type="button" class="btn btn-ghost btn-copiar" @click="copiarDireccion">
          {{ copiado ? 'Copiado' : 'Copiar' }}
        </button>
      </div>
      <img v-if="apk.qr" :src="apk.qr" alt="Código QR de descarga de la app móvil" class="conexion-qr" />
      <p class="conexion-hint">O escanea este código para descargar la app</p>
    </template>
  </div>
</template>

<style scoped>
.conexion-box {
  text-align: center;
  background: rgba(255, 255, 255, 0.06);
  border-radius: var(--radius-lg);
  padding: 1.5rem;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  width: min(360px, 100%);
}

.conexion-box.compacto {
  padding: 0.85rem;
  gap: 4px;
  width: 100%;
  border-radius: var(--radius);
}

.conexion-label {
  font-size: 15px;
  font-weight: 500;
  margin: 0;
}

.compacto .conexion-label {
  font-size: 12px;
}

.conexion-copy {
  font-size: 13px;
  color: var(--text-on-sidebar-muted);
  margin: 0 0 8px;
}

.conexion-direccion {
  display: flex;
  align-items: center;
  gap: 10px;
  background: rgba(255, 255, 255, 0.1);
  border-radius: var(--radius);
  padding: 10px 14px;
  font-size: 17px;
  font-weight: 500;
}

.btn-copiar {
  height: 26px;
  padding: 0 10px;
  font-size: 12px;
  color: var(--text-on-sidebar);
  border-color: rgba(255, 255, 255, 0.3);
  flex-shrink: 0;
}

.conexion-direccion-compacta {
  width: 100%;
  margin: 0;
  border: none;
  cursor: pointer;
  background: rgba(134, 187, 37, 0.16);
  color: var(--color-brand-green);
  border-radius: var(--radius);
  padding: 8px 4px;
  font-size: 11px;
  font-weight: 600;
  white-space: nowrap;
  overflow-x: auto;
  text-align: center;
}

.conexion-direccion-compacta:hover {
  background: rgba(134, 187, 37, 0.26);
}

.conexion-loading {
  height: 140px;
  display: flex;
  align-items: center;
  justify-content: center;
}

.compacto .conexion-loading {
  height: 36px;
}

.conexion-qr {
  margin-top: 10px;
  width: 120px;
  height: 120px;
  border-radius: var(--radius);
  background: #fff;
  padding: 6px;
}

.conexion-hint {
  margin: 0;
  font-size: 12px;
  color: var(--text-on-sidebar-muted);
}
</style>
