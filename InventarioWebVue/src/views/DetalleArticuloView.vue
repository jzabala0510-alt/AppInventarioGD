<script setup>
import { computed, onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import * as conteosService from '../services/conteos';
import { useAuthStore } from '../stores/auth';
import Spinner from '../components/Spinner.vue';
import ConfirmDialog from '../components/ConfirmDialog.vue';

const props = defineProps({
  id: { type: Number, required: true },
  fecha: { type: String, required: true },
  codAlmacen: { type: String, required: true },
  codArticulo: { type: [String, Number], required: true },
  talla: { type: String, default: '' },
  color: { type: String, default: '' },
});

const router = useRouter();
const auth = useAuthStore();

const cargando = ref(true);
const resumen = ref(null);
const idAEliminar = ref(null);
const eliminandoTodos = ref(false);
const editandoId = ref(null);
const valorEditado = ref('');
const guardando = ref(false);

async function cargar() {
  cargando.value = true;
  resumen.value = await conteosService.obtenerConteoArticulo({
    fecha: props.fecha,
    codAlmacen: props.codAlmacen,
    codArticulo: props.codArticulo,
    talla: props.talla,
    color: props.color,
  });
  cargando.value = false;
}

onMounted(cargar);

const lineas = computed(() => resumen.value?.detalle ?? []);

const totalUnidades = computed(() =>
  lineas.value.reduce((acc, l) => acc + (Number(l.unidades) || 0), 0),
);

const resumenPorZona = computed(() => {
  const acumulado = new Map();
  for (const linea of lineas.value) {
    acumulado.set(linea.zona, (acumulado.get(linea.zona) ?? 0) + (Number(linea.unidades) || 0));
  }
  return [...acumulado.entries()];
});

function formatearHora(valor) {
  if (!valor) return '';
  const fecha = new Date(valor);
  if (Number.isNaN(fecha.getTime())) return '';
  return fecha.toLocaleTimeString('es-VE');
}

function empezarEdicion(linea) {
  editandoId.value = linea.id;
  valorEditado.value = String(linea.unidades ?? '');
}

async function guardarEdicion(id) {
  if (!/^[0-9]+$/.test(valorEditado.value)) return;
  guardando.value = true;
  try {
    await conteosService.actualizarConteoArticulo({
      id,
      unidades: valorEditado.value,
      codUsuario: auth.codVendedor,
    });
    editandoId.value = null;
    await cargar();
  } finally {
    guardando.value = false;
  }
}

async function confirmarEliminarUno() {
  const id = idAEliminar.value;
  idAEliminar.value = null;
  cargando.value = true;
  await conteosService.eliminarRegistro(id);
  await cargar();
}

async function confirmarEliminarTodos() {
  eliminandoTodos.value = false;
  cargando.value = true;
  for (const linea of lineas.value) {
    // eslint-disable-next-line no-await-in-loop -- deben eliminarse en orden, uno por registro
    await conteosService.eliminarRegistro(linea.id);
  }
  await cargar();
}

function volver() {
  router.push({ name: 'conteo-detalle', params: { id: props.id } });
}
</script>

<template>
  <div>
    <div class="page-header">
      <h1>Detalle del artículo</h1>
      <div class="acciones">
        <button type="button" class="btn" @click="volver">Volver</button>
        <button type="button" class="btn" @click="cargar">Refrescar</button>
      </div>
    </div>

    <div v-if="cargando" class="empty-state"><Spinner /></div>

    <template v-else-if="resumen">
      <div class="card resumen-card">
        <div class="resumen-item">
          <span class="label">Descripción</span>
          <span>{{ resumen.articulo?.descripcion }}</span>
        </div>
        <div class="resumen-item">
          <span class="label">Diferencia</span>
          <span>{{ resumen.diferencia }}</span>
        </div>
        <div class="resumen-item">
          <span class="label">Stock</span>
          <span>{{ resumen.stock }}</span>
        </div>
        <div class="resumen-item">
          <span class="label">Vendidas</span>
          <span>{{ resumen.vendidas }}</span>
        </div>
        <div class="resumen-item">
          <span class="label">Contado</span>
          <span>{{ resumen.contado }}</span>
        </div>
        <div class="resumen-item">
          <span class="label">Fecha</span>
          <span>{{ resumen.cabecera?.fecha }}</span>
        </div>
      </div>

      <div class="card table-wrap">
        <table class="data-table">
          <thead>
            <tr>
              <th>Hora</th>
              <th>Unidades</th>
              <th>Usuario</th>
              <th>Concepto</th>
              <th>Zona</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="linea in lineas" :key="linea.id">
              <td>{{ formatearHora(linea.horaConteo) }}</td>
              <td>
                <template v-if="editandoId === linea.id">
                  <input
                    v-model="valorEditado"
                    type="text"
                    class="input input-inline"
                    autofocus
                    @keyup.enter="guardarEdicion(linea.id)"
                  />
                </template>
                <template v-else>{{ linea.unidades }}</template>
              </td>
              <td>{{ linea.usuario }}</td>
              <td>{{ linea.concepto }}</td>
              <td>{{ linea.zona }}</td>
              <td class="col-acciones">
                <template v-if="editandoId === linea.id">
                  <button type="button" class="btn btn-ghost" :disabled="guardando" @click="guardarEdicion(linea.id)">
                    <Spinner v-if="guardando" :size="14" />
                    <span v-else>Guardar</span>
                  </button>
                </template>
                <template v-else>
                  <button type="button" class="btn btn-ghost" @click="empezarEdicion(linea)">Editar</button>
                  <button type="button" class="btn btn-ghost" @click="idAEliminar = linea.id">Eliminar</button>
                </template>
              </td>
            </tr>
          </tbody>
          <tfoot>
            <tr>
              <td>Totales:</td>
              <td>{{ totalUnidades }}</td>
              <td></td>
              <td></td>
              <td></td>
              <td></td>
            </tr>
          </tfoot>
        </table>
      </div>

      <div v-if="lineas.length > 0" class="acciones eliminar-todos">
        <button type="button" class="btn btn-danger" @click="eliminandoTodos = true">Eliminar todos los registros</button>
      </div>

      <div v-if="resumenPorZona.length > 0" class="card table-wrap zona-wrap">
        <table class="data-table">
          <thead>
            <tr>
              <th>Zona</th>
              <th>Unidades</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="[zona, unidades] in resumenPorZona" :key="zona">
              <td>{{ zona }}</td>
              <td>{{ unidades }}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </template>

    <ConfirmDialog
      :open="idAEliminar !== null"
      titulo="Eliminar registro"
      mensaje="¿Deseas eliminar este registro de conteo?"
      texto-confirmar="Eliminar"
      peligroso
      @confirmar="confirmarEliminarUno"
      @cancelar="idAEliminar = null"
    />

    <ConfirmDialog
      :open="eliminandoTodos"
      titulo="Eliminar todos los registros"
      mensaje="¿Estás totalmente seguro que deseas eliminar todos los registros de este artículo? Esta acción no se puede deshacer."
      texto-confirmar="Eliminar todos"
      peligroso
      @confirmar="confirmarEliminarTodos"
      @cancelar="eliminandoTodos = false"
    />
  </div>
</template>

<style scoped>
.acciones {
  display: flex;
  gap: 8px;
}

.resumen-card {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
  gap: 1rem;
  padding: 1.25rem;
  margin-bottom: 1.25rem;
}

.resumen-item {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.resumen-item .label {
  font-size: 12px;
  color: var(--text-secondary);
  font-weight: 500;
}

.table-wrap {
  overflow-x: auto;
}

.col-acciones {
  display: flex;
  gap: 4px;
  white-space: nowrap;
}

.input-inline {
  width: 70px;
  height: 30px;
  text-align: center;
}

.eliminar-todos {
  justify-content: flex-end;
  margin: 1rem 0;
}

.zona-wrap {
  max-width: 360px;
}
</style>
