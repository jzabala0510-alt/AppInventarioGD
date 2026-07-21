<script setup>
import { computed, onMounted, reactive, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import * as conteosService from '../services/conteos';
import Spinner from '../components/Spinner.vue';
import Pagination from '../components/Pagination.vue';
import SearchableSelect from '../components/SearchableSelect.vue';

const props = defineProps({
  id: {
    type: Number,
    required: true,
  },
});

const router = useRouter();

const cargando = ref(true);
const actualizandoLineas = ref(false);
const lineas = ref([]);
const filtros = ref({ usuarios: [], zonas: [], conceptos: [] });
const resumenEnvios = ref([]);
const mostrarResumen = ref(false);

const filtro = reactive({
  usuario: -1,
  zona: 'TODO',
  sector: -1,
  concepto: -1,
  soloDiferencias: false,
  esConteoTotal: false,
});

const busqueda = ref('');
const ordenDiferencia = ref(null); // null | 'asc' | 'desc'

const pagina = ref(1);
const tamanoPagina = ref(50);

const sectoresDisponibles = computed(() => {
  const zona = filtros.value.zonas.find((z) => z.zona === filtro.zona);
  return zona?.sectores?.filter((s) => s !== -1) ?? [];
});

const opcionesZona = computed(() => filtros.value.zonas.map((z) => ({ value: z.zona, label: z.zona })));

watch(
  () => filtro.zona,
  () => {
    filtro.sector = -1;
  },
);

async function cargarFiltros() {
  filtros.value = await conteosService.obtenerFiltroConteo(props.id);
}

async function cargarLineas() {
  actualizandoLineas.value = true;
  try {
    lineas.value = await conteosService.obtenerDetalleConteo(props.id, {
      usuario: filtro.usuario,
      zona: filtro.zona,
      sector: filtro.sector,
      concepto: filtro.concepto,
      diferencias: filtro.soloDiferencias,
      total: filtro.esConteoTotal,
    });
  } finally {
    actualizandoLineas.value = false;
  }
}

async function cargarResumenEnvios() {
  resumenEnvios.value = await conteosService.getResumenEnvios(props.id);
}

async function cargarTodo() {
  cargando.value = true;
  await Promise.all([cargarFiltros(), cargarLineas(), cargarResumenEnvios()]);
  cargando.value = false;
}

onMounted(cargarTodo);

// La consulta detras de esto tarda varios segundos (agrega ventas/stock en
// vivo), asi que si se cambian varios filtros seguidos (p.ej. zona, que a su
// vez resetea sector) se agrupan en una sola llamada en vez de disparar una
// por cada cambio.
let debounceFiltro = null;
watch(
  () => [filtro.usuario, filtro.zona, filtro.sector, filtro.concepto, filtro.soloDiferencias, filtro.esConteoTotal],
  () => {
    clearTimeout(debounceFiltro);
    debounceFiltro = setTimeout(cargarLineas, 350);
  },
);

const filasVisibles = computed(() => {
  let filas = lineas.value;

  if (busqueda.value.trim().length > 0) {
    const q = busqueda.value.trim().toLowerCase();
    filas = filas.filter(
      ({ articulo }) =>
        articulo.codBarras?.toLowerCase().includes(q) ||
        articulo.referencia?.toLowerCase().includes(q) ||
        articulo.descripcion?.toLowerCase().includes(q) ||
        articulo.talla?.toLowerCase().includes(q) ||
        articulo.color?.toLowerCase().includes(q),
    );
  }

  if (ordenDiferencia.value) {
    filas = [...filas].sort((a, b) =>
      ordenDiferencia.value === 'asc' ? a.diferencia - b.diferencia : b.diferencia - a.diferencia,
    );
  }

  return filas;
});

const filasPagina = computed(() => {
  const inicio = (pagina.value - 1) * tamanoPagina.value;
  return filasVisibles.value.slice(inicio, inicio + tamanoPagina.value);
});

watch([busqueda, () => filtro.usuario, () => filtro.zona, () => filtro.sector, () => filtro.concepto, () => filtro.soloDiferencias, () => filtro.esConteoTotal], () => {
  pagina.value = 1;
});

const totales = computed(() =>
  filasVisibles.value.reduce(
    (acc, fila) => ({
      unidades: acc.unidades + (Number(fila.unidades) || 0),
      vendidas: acc.vendidas + (Number(fila.vendidas) || 0),
      vendidasReal: acc.vendidasReal + (Number(fila.vendidasReal) || 0),
      stock: acc.stock + (Number(fila.stock) || 0),
      stockMermas: acc.stockMermas + (Number(fila.stockMermas) || 0),
    }),
    { unidades: 0, vendidas: 0, vendidasReal: 0, stock: 0, stockMermas: 0 },
  ),
);

const totalUnidadesEnvios = computed(() =>
  resumenEnvios.value.reduce((acc, e) => acc + (Number(e.unidades) || 0), 0),
);

function alternarOrden() {
  ordenDiferencia.value = ordenDiferencia.value === 'asc' ? 'desc' : ordenDiferencia.value === 'desc' ? null : 'asc';
}

function verArticulo(fila) {
  router.push({
    name: 'conteo-detalle-articulo',
    params: { id: props.id },
    query: {
      fecha: fila.conteoCab.fecha,
      codAlmacen: fila.conteoCab.codAlmacen,
      codArticulo: fila.articulo.codArticulo,
      talla: fila.articulo.talla,
      color: fila.articulo.color,
    },
  });
}

const urlExportar = computed(() =>
  conteosService.urlExportarExcel(props.id, {
    usuario: filtro.usuario,
    zona: filtro.zona,
    sector: filtro.sector,
    concepto: filtro.concepto,
    diferencias: filtro.soloDiferencias,
    total: filtro.esConteoTotal,
  }),
);
</script>

<template>
  <div>
    <div class="page-header">
      <h1>Conteo #{{ id }}</h1>
      <div class="acciones">
        <button type="button" class="btn" @click="cargarTodo">Refrescar</button>
        <button type="button" class="btn" @click="mostrarResumen = true">Ver resumen de envíos</button>
        <a class="btn btn-primary" :href="urlExportar" target="_blank" rel="noopener">Exportar a Excel</a>
      </div>
    </div>

    <div class="card filtros">
      <div v-if="actualizandoLineas" class="actualizando">
        <Spinner :size="14" />
        <span>Actualizando…</span>
      </div>

      <div class="field">
        <label>Usuario</label>
        <select v-model.number="filtro.usuario" class="select">
          <option v-for="u in filtros.usuarios" :key="u.codUsuario" :value="u.codUsuario">{{ u.usuario }}</option>
        </select>
      </div>

      <div class="field">
        <label>Zona</label>
        <SearchableSelect v-model="filtro.zona" :options="opcionesZona" placeholder="Buscar zona…" />
      </div>

      <div v-if="sectoresDisponibles.length > 0" class="field">
        <label>Sector</label>
        <select v-model.number="filtro.sector" class="select">
          <option :value="-1">Todos</option>
          <option v-for="s in sectoresDisponibles" :key="s" :value="s">{{ s }}</option>
        </select>
      </div>

      <div class="field">
        <label>Concepto</label>
        <select v-model.number="filtro.concepto" class="select">
          <option v-for="c in filtros.conceptos" :key="c.codConcepto" :value="c.codConcepto">{{ c.concepto }}</option>
        </select>
      </div>

      <label class="checkbox-field">
        <input v-model="filtro.soloDiferencias" type="checkbox" />
        Solo diferencias
      </label>

      <label class="checkbox-field">
        <input v-model="filtro.esConteoTotal" type="checkbox" />
        Conteo total
      </label>

      <div class="field busqueda">
        <label>Buscar</label>
        <input v-model="busqueda" type="text" class="input" placeholder="Código, referencia, descripción…" />
      </div>
    </div>

    <div v-if="cargando" class="empty-state"><Spinner /></div>

    <div v-else-if="filasVisibles.length === 0" class="empty-state">No existen registros de conteo.</div>

    <div v-else class="card table-wrap">
      <table class="data-table">
        <thead>
          <tr>
            <th>Cód. barras</th>
            <th>Referencia</th>
            <th>Descripción</th>
            <th>Estilo</th>
            <th>Talla</th>
            <th>Color</th>
            <th>Conteo</th>
            <th>Vendidas</th>
            <th>Vendidas real</th>
            <th>Stock</th>
            <th>Stock mermas</th>
            <th class="ordenable" @click="alternarOrden">
              Diferencia
              <span v-if="ordenDiferencia">{{ ordenDiferencia === 'asc' ? '▲' : '▼' }}</span>
            </th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="(fila, ind) in filasPagina" :key="ind">
            <td class="mono">{{ fila.articulo.codBarras }}</td>
            <td>{{ fila.articulo.referencia }}</td>
            <td>{{ fila.articulo.descripcion }}</td>
            <td>{{ fila.articulo.norma }}</td>
            <td>{{ fila.articulo.talla }}</td>
            <td>{{ fila.articulo.color }}</td>
            <td>{{ fila.unidades }}</td>
            <td>{{ fila.vendidas }}</td>
            <td>{{ fila.vendidasReal }}</td>
            <td>{{ fila.stock }}</td>
            <td>{{ fila.stockMermas }}</td>
            <td>{{ fila.diferencia * -1 }}</td>
            <td><button type="button" class="btn btn-ghost" @click="verArticulo(fila)">Ver</button></td>
          </tr>
        </tbody>
        <tfoot>
          <tr>
            <td>Totales:</td>
            <td></td>
            <td></td>
            <td></td>
            <td></td>
            <td></td>
            <td>{{ totales.unidades }}</td>
            <td>{{ totales.vendidas }}</td>
            <td>{{ totales.vendidasReal }}</td>
            <td>{{ totales.stock }}</td>
            <td>{{ totales.stockMermas }}</td>
            <td></td>
            <td></td>
          </tr>
        </tfoot>
      </table>
      <Pagination v-model:page="pagina" v-model:page-size="tamanoPagina" :total-items="filasVisibles.length" />
    </div>

    <Teleport to="body">
      <div v-if="mostrarResumen" class="overlay" @click.self="mostrarResumen = false">
        <div class="dialog card">
          <h3>Resumen de envíos</h3>
          <div class="table-wrap">
            <table class="data-table">
              <thead>
                <tr>
                  <th>Usuario</th>
                  <th>Fecha</th>
                  <th>Unidades</th>
                  <th>Ip</th>
                  <th>Procesado</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="e in resumenEnvios" :key="e.idEnvio">
                  <td>{{ e.usuario }}</td>
                  <td>{{ e.horaGenerado }}</td>
                  <td>{{ e.unidades }}</td>
                  <td class="mono">{{ e.ip }}</td>
                  <td>{{ e.procesado ? 'Sí' : 'No' }}</td>
                </tr>
              </tbody>
              <tfoot>
                <tr>
                  <td colspan="2">Total:</td>
                  <td>{{ totalUnidadesEnvios }}</td>
                  <td></td>
                  <td></td>
                </tr>
              </tfoot>
            </table>
          </div>
          <div class="acciones dialog-acciones">
            <button type="button" class="btn" @click="mostrarResumen = false">Cerrar</button>
          </div>
        </div>
      </div>
    </Teleport>
  </div>
</template>

<style scoped>
.acciones {
  display: flex;
  gap: 8px;
}

.filtros {
  display: flex;
  flex-wrap: wrap;
  align-items: end;
  gap: 1rem;
  padding: 1rem 1.25rem;
  margin-bottom: 1.25rem;
  position: relative;
}

.actualizando {
  position: absolute;
  top: 8px;
  right: 12px;
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  color: var(--text-secondary);
}

.checkbox-field {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 14px;
  height: 38px;
}

.busqueda {
  min-width: 220px;
  flex: 1;
}

.table-wrap {
  overflow: auto;
  max-height: 70vh;
}

.ordenable {
  cursor: pointer;
  user-select: none;
}

.overlay {
  position: fixed;
  inset: 0;
  background: rgba(20, 20, 18, 0.45);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 100;
  padding: 2rem;
}

.dialog {
  width: min(720px, 100%);
  max-height: 80vh;
  padding: 1.5rem;
  display: flex;
  flex-direction: column;
  gap: 1rem;
}

.dialog-acciones {
  justify-content: flex-end;
}
</style>
