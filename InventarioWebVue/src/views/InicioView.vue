<script setup>
import { computed, onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import * as conteosService from '../services/conteos';
import { formatearFecha } from '../utils/fecha';
import Spinner from '../components/Spinner.vue';
import ConfirmDialog from '../components/ConfirmDialog.vue';
import NuevoConteoModal from '../components/NuevoConteoModal.vue';
import Pagination from '../components/Pagination.vue';

const router = useRouter();

const conteos = ref([]);
const cargando = ref(true);
const error = ref(null);
const idAEliminar = ref(null);
const modalNuevo = ref(false);

const pagina = ref(1);
const tamanoPagina = ref(25);

const conteosPagina = computed(() => {
  const inicio = (pagina.value - 1) * tamanoPagina.value;
  return conteos.value.slice(inicio, inicio + tamanoPagina.value);
});

async function cargarConteos() {
  cargando.value = true;
  error.value = null;
  try {
    conteos.value = await conteosService.listarConteos();
    pagina.value = 1;
  } catch {
    error.value = 'No se pudieron cargar los conteos';
  } finally {
    cargando.value = false;
  }
}

onMounted(cargarConteos);

function verDetalle(idConteo) {
  router.push({ name: 'conteo-detalle', params: { id: idConteo } });
}

async function confirmarEliminar() {
  const idConteo = idAEliminar.value;
  idAEliminar.value = null;
  cargando.value = true;
  try {
    await conteosService.eliminarConteo(idConteo);
    await cargarConteos();
  } catch {
    error.value = 'No se pudo eliminar el conteo';
    cargando.value = false;
  }
}
</script>

<template>
  <div>
    <div class="page-header">
      <h1>Conteos</h1>
      <div class="acciones">
        <button type="button" class="btn" @click="cargarConteos">Refrescar</button>
        <button type="button" class="btn btn-primary" @click="modalNuevo = true">Nuevo conteo</button>
      </div>
    </div>

    <p v-if="error" class="login-error">{{ error }}</p>

    <div v-if="cargando" class="empty-state"><Spinner /></div>

    <div v-else-if="conteos.length === 0" class="empty-state">No hay conteos disponibles.</div>

    <div v-else class="card table-wrap">
      <table class="data-table">
        <thead>
          <tr>
            <th>Id</th>
            <th>Fecha inicio</th>
            <th>Fecha fin</th>
            <th>Almacén</th>
            <th>Observación</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="c in conteosPagina" :key="c.idConteo" class="row-clickable" @click="verDetalle(c.idConteo)">
            <td>{{ c.idConteo }}</td>
            <td>{{ formatearFecha(c.fecha) }}</td>
            <td>{{ formatearFecha(c.fechaFin) }}</td>
            <td>{{ c.nombreAlmacen }}</td>
            <td>{{ c.observacion }}</td>
            <td class="col-acciones" @click.stop>
              <button type="button" class="btn btn-ghost" @click="verDetalle(c.idConteo)">Ver</button>
              <button type="button" class="btn btn-ghost" @click="idAEliminar = c.idConteo">Eliminar</button>
            </td>
          </tr>
        </tbody>
      </table>
      <Pagination v-model:page="pagina" v-model:page-size="tamanoPagina" :total-items="conteos.length" />
    </div>

    <NuevoConteoModal
      :open="modalNuevo"
      @creado="modalNuevo = false; cargarConteos()"
      @cancelar="modalNuevo = false"
    />

    <ConfirmDialog
      :open="idAEliminar !== null"
      titulo="Eliminar conteo"
      mensaje="¿Estás seguro que deseas eliminar este conteo? Esta acción no se puede deshacer."
      texto-confirmar="Eliminar"
      peligroso
      @confirmar="confirmarEliminar"
      @cancelar="idAEliminar = null"
    />
  </div>
</template>

<style scoped>
.acciones {
  display: flex;
  gap: 8px;
}

.table-wrap {
  overflow-x: auto;
}

.row-clickable {
  cursor: pointer;
}

.col-acciones {
  display: flex;
  gap: 4px;
  white-space: nowrap;
}
</style>
