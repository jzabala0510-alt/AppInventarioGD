<script setup>
import { computed } from 'vue';

const props = defineProps({
  page: { type: Number, required: true },
  totalItems: { type: Number, required: true },
  pageSize: { type: Number, required: true },
  pageSizeOptions: { type: Array, default: () => [25, 50, 100] },
});

const emit = defineEmits(['update:page', 'update:pageSize']);

const totalPages = computed(() => Math.max(1, Math.ceil(props.totalItems / props.pageSize)));
const rangoInicio = computed(() => (props.totalItems === 0 ? 0 : (props.page - 1) * props.pageSize + 1));
const rangoFin = computed(() => Math.min(props.page * props.pageSize, props.totalItems));

function irA(pagina) {
  emit('update:page', Math.min(Math.max(1, pagina), totalPages.value));
}

function cambiarTamano(event) {
  emit('update:pageSize', Number(event.target.value));
  emit('update:page', 1);
}
</script>

<template>
  <div class="pagination">
    <span class="resumen">Mostrando {{ rangoInicio }}–{{ rangoFin }} de {{ totalItems }}</span>

    <div class="controles">
      <select class="select select-sm" :value="pageSize" @change="cambiarTamano">
        <option v-for="opcion in pageSizeOptions" :key="opcion" :value="opcion">{{ opcion }} / página</option>
      </select>

      <button type="button" class="btn btn-sm" :disabled="page <= 1" @click="irA(page - 1)">Anterior</button>
      <span class="pagina-actual">Página {{ page }} de {{ totalPages }}</span>
      <button type="button" class="btn btn-sm" :disabled="page >= totalPages" @click="irA(page + 1)">Siguiente</button>
    </div>
  </div>
</template>

<style scoped>
.pagination {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 12px;
  padding: 10px 14px;
  font-size: 13px;
  color: var(--text-secondary);
}

.controles {
  display: flex;
  align-items: center;
  gap: 8px;
}

.select-sm {
  height: 30px;
  padding: 0 8px;
  font-size: 13px;
}

.btn-sm {
  height: 30px;
  padding: 0 12px;
  font-size: 13px;
}

.pagina-actual {
  white-space: nowrap;
}
</style>
