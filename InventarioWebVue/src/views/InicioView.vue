<script setup>
import { computed, onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import * as conteosService from '../services/conteos';
import { api } from '../services/api';
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
const alertaMermas = ref([]);

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

async function cargarAlertaMermas() {
  try {
    const { data } = await api.get('/util/alertas-mermas');
    alertaMermas.value = data;
  } catch { /* sin BD: ignorar */ }
}

onMounted(() => {
  cargarConteos();
  cargarAlertaMermas();
});

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

    <div v-if="alertaMermas.length" class="alerta-mermas">
      <span class="alerta-mermas__icono">⚠</span>
      <div class="alerta-mermas__cuerpo">
        <strong>Stock en almacén de mermas</strong>
        <span v-for="a in alertaMermas" :key="a.codAlmacen">
          {{ a.nombre }}: {{ a.totalStock.toLocaleString('es-VE') }} unidades
        </span>
      </div>
      <button type="button" class="alerta-mermas__cerrar" @click="alertaMermas = []">✕</button>
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

.alerta-mermas {
  display: flex;
  align-items: flex-start;
  gap: 0.75rem;
  background: color-mix(in srgb, var(--color-warning, #f59e0b) 12%, transparent);
  border: 1px solid color-mix(in srgb, var(--color-warning, #f59e0b) 50%, transparent);
  border-radius: var(--radius);
  padding: 0.875rem 1rem;
  margin-bottom: 1rem;
}

.alerta-mermas__icono {
  font-size: 1.1rem;
  flex-shrink: 0;
  margin-top: 1px;
}

.alerta-mermas__cuerpo {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
  font-size: 14px;
  color: var(--text-primary);
}

.alerta-mermas__cuerpo strong {
  color: var(--color-warning, #b45309);
}

.alerta-mermas__cerrar {
  background: none;
  border: none;
  cursor: pointer;
  font-size: 13px;
  color: var(--text-secondary);
  padding: 0 0.25rem;
  flex-shrink: 0;
  line-height: 1;
}

.alerta-mermas__cerrar:hover {
  color: var(--text-primary);
}
</style>
