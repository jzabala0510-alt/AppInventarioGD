<script setup>
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';

const props = defineProps({
  modelValue: { type: [String, Number], default: '' },
  options: { type: Array, required: true }, // [{ value, label }]
  placeholder: { type: String, default: 'Seleccionar...' },
});

const emit = defineEmits(['update:modelValue']);

const abierto = ref(false);
const busqueda = ref('');
const raiz = ref(null);

const etiquetaSeleccionada = computed(
  () => props.options.find((o) => o.value === props.modelValue)?.label ?? '',
);

const opcionesFiltradas = computed(() => {
  if (!busqueda.value.trim()) return props.options;
  const q = busqueda.value.trim().toLowerCase();
  return props.options.filter((o) => o.label.toLowerCase().includes(q));
});

function abrir() {
  abierto.value = true;
  busqueda.value = '';
}

function elegir(opcion) {
  emit('update:modelValue', opcion.value);
  abierto.value = false;
}

function alPerderFoco(event) {
  busqueda.value = '';
}

function onClickFuera(event) {
  if (raiz.value && !raiz.value.contains(event.target)) {
    abierto.value = false;
  }
}

onMounted(() => document.addEventListener('mousedown', onClickFuera));
onBeforeUnmount(() => document.removeEventListener('mousedown', onClickFuera));
</script>

<template>
  <div ref="raiz" class="searchable-select">
    <input
      type="text"
      class="input"
      :value="abierto ? busqueda : etiquetaSeleccionada"
      :placeholder="placeholder"
      autocomplete="off"
      @focus="abrir"
      @input="busqueda = $event.target.value"
      @keydown.escape="abierto = false"
      @blur="alPerderFoco"
    />
    <div v-if="abierto" class="panel">
      <div
        v-for="opcion in opcionesFiltradas"
        :key="opcion.value"
        class="opcion"
        :class="{ activa: opcion.value === modelValue }"
        @mousedown.prevent="elegir(opcion)"
      >
        {{ opcion.label }}
      </div>
      <div v-if="opcionesFiltradas.length === 0" class="opcion vacia">Sin resultados</div>
    </div>
  </div>
</template>

<style scoped>
.searchable-select {
  position: relative;
}

.searchable-select input {
  display: block;
  width: 100%;
}

.panel {
  position: absolute;
  top: calc(100% + 4px);
  left: 0;
  right: 0;
  max-height: 240px;
  overflow-y: auto;
  background: var(--bg-surface);
  border: 1px solid var(--border-strong);
  border-radius: var(--radius);
  box-shadow: var(--shadow-md);
  z-index: 50;
}

.opcion {
  padding: 8px 12px;
  cursor: pointer;
  font-size: 14px;
}

.opcion:hover,
.opcion.activa {
  background: var(--bg-surface-alt);
}

.opcion.vacia {
  color: var(--text-secondary);
  cursor: default;
}
</style>
