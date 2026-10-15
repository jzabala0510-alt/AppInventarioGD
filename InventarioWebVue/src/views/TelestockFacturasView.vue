<script setup>
import { computed, onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import * as telestockService from '../services/telestock';
import Spinner from '../components/Spinner.vue';

const router = useRouter();

const cargando = ref(true);
const estado = ref(null);
const facturas = ref([]);
const sesiones = ref([]); // sesiones locales (abiertas y cerradas), para poder continuar/reabrir en vez de crear una nueva en blanco
const busqueda = ref('');
const creandoSesionPara = ref(null); // "serie-numero-n" de la fila en la que se hizo click, para deshabilitar solo ese boton
const error = ref('');

function claveFactura({ serie, numero, n }) {
  return `${serie}-${numero}-${n ?? ''}`;
}

async function cargarTodo() {
  cargando.value = true;
  error.value = '';
  try {
    estado.value = await telestockService.obtenerEstado();
    if (estado.value.configurado) {
      const [listaFacturas, listaSesiones] = await Promise.all([
        telestockService.listarFacturas(),
        telestockService.listarSesiones(),
      ]);
      facturas.value = listaFacturas;
      sesiones.value = listaSesiones;
    }
  } catch (err) {
    error.value = telestockService.mensajeError(err);
  } finally {
    cargando.value = false;
  }
}

onMounted(cargarTodo);

// Por cada factura, la sesion local mas reciente que le corresponde (puede
// no haber ninguna todavia) -- para decidir si el boton dice "Verificar"
// (no hay sesion), "Continuar" (hay una abierta) o "Ver / Reabrir" (cerrada).
const sesionPorFactura = computed(() => {
  const mapa = new Map();
  for (const s of sesiones.value) {
    const clave = claveFactura(s.factura);
    // sesiones.value ya viene ordenado por creadaEn descendente -- la primera
    // que se encuentre por factura es la mas reciente, se queda con esa.
    if (!mapa.has(clave)) mapa.set(clave, s);
  }
  return mapa;
});

// Filas a mostrar: las facturas pendientes de ICG, mas cualquier sesion local
// cuya factura ya no aparezca ahi (por ejemplo, si ICG ya la marco como
// recibida) -- para no perder el acceso a un conteo que se hizo sobre ella.
const filasVisibles = computed(() => {
  const clavesFacturas = new Set(facturas.value.map(claveFactura));
  const filasDeFacturas = facturas.value.map((f) => ({ factura: f, sesion: sesionPorFactura.value.get(claveFactura(f)) || null }));
  const filasSoloSesion = sesiones.value
    .filter((s) => !clavesFacturas.has(claveFactura(s.factura)) && s === sesionPorFactura.value.get(claveFactura(s.factura)))
    .map((s) => ({ factura: s.factura, sesion: s }));

  const todas = [...filasDeFacturas, ...filasSoloSesion];
  if (!busqueda.value.trim()) return todas;
  const q = busqueda.value.trim().toLowerCase();
  return todas.filter(
    ({ factura: f }) =>
      f.serie?.toLowerCase().includes(q) ||
      String(f.numero).includes(q) ||
      f.nombreClienteProveedor?.toLowerCase().includes(q),
  );
});

function formatearFecha(iso) {
  if (!iso) return '';
  return new Date(iso).toLocaleDateString('es-VE');
}

function formatearMonto(valor) {
  return Number(valor ?? 0).toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

async function verificar(factura) {
  const clave = claveFactura(factura);
  creandoSesionPara.value = clave;
  error.value = '';
  try {
    const sesion = await telestockService.crearSesion({
      serie: factura.serie,
      numero: factura.numero,
      n: factura.n,
    });
    router.push({ name: 'telestock-verificar', params: { idSesion: sesion.idSesion } });
  } catch (err) {
    error.value = telestockService.mensajeError(err);
  } finally {
    creandoSesionPara.value = null;
  }
}

// Continuar una sesion abierta o ver/reabrir una ya cerrada -- a diferencia
// de "Verificar", no crea nada nuevo, solo navega a la sesion existente
// (TelestockVerificarView ya sabe mostrar el boton "Reabrir conteo" si hace falta).
function irASesion(sesion) {
  router.push({ name: 'telestock-verificar', params: { idSesion: sesion.idSesion } });
}
</script>

<template>
  <div>
    <div class="page-header">
      <h1>Verificación de conteo contra factura</h1>
      <div class="acciones">
        <button type="button" class="btn" @click="cargarTodo">Refrescar</button>
      </div>
    </div>

    <p class="ayuda">
      Elegí la factura de venta que vas a despachar. Vas a poder escanear lo que se cuente físicamente y
      compararlo contra lo que dice la factura; al cerrar se genera el archivo de Telestock.
    </p>

    <div v-if="cargando" class="empty-state"><Spinner /></div>

    <template v-else>
      <p v-if="error" class="login-error">{{ error }}</p>

      <div v-if="estado && !estado.configurado" class="card aviso-config">
        El módulo de verificación todavía no tiene configurado LibRemote.
        <RouterLink :to="{ name: 'configuracion' }">Configurarlo</RouterLink>.
      </div>

      <template v-else>
        <div class="card filtros">
          <div class="field busqueda">
            <label>Buscar</label>
            <input v-model="busqueda" type="text" class="input" placeholder="Serie, número o cliente…" />
          </div>
        </div>

        <div v-if="filasVisibles.length === 0" class="empty-state">No hay facturas de venta pendientes.</div>

        <div v-else class="card table-wrap">
          <table class="data-table">
            <thead>
              <tr>
                <th>Serie</th>
                <th>Número</th>
                <th>Fecha</th>
                <th>Cliente</th>
                <th>Neto</th>
                <th>Conteo</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="{ factura: f, sesion: s } in filasVisibles" :key="claveFactura(f)">
                <td class="mono">{{ f.serie }}</td>
                <td class="mono">{{ f.numero }}</td>
                <td>{{ formatearFecha(f.fecha) }}</td>
                <td>{{ f.nombreClienteProveedor }}</td>
                <td>{{ formatearMonto(f.neto) }}</td>
                <td>
                  <span v-if="!s" class="estado-conteo sin-empezar">Sin empezar</span>
                  <span v-else-if="s.cerradaEn" class="estado-conteo cerrado">
                    Cerrado ({{ s.totales.contado }}/{{ s.totales.facturado }})
                  </span>
                  <span v-else class="estado-conteo en-curso">En curso ({{ s.totales.contado }}/{{ s.totales.facturado }})</span>
                </td>
                <td>
                  <button
                    v-if="!s"
                    type="button"
                    class="btn btn-primary"
                    :disabled="creandoSesionPara === claveFactura(f)"
                    @click="verificar(f)"
                  >
                    {{ creandoSesionPara === claveFactura(f) ? 'Abriendo…' : 'Verificar' }}
                  </button>
                  <button v-else-if="s.cerradaEn" type="button" class="btn" @click="irASesion(s)">Ver / Reabrir</button>
                  <button v-else type="button" class="btn btn-primary" @click="irASesion(s)">Continuar</button>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </template>
    </template>
  </div>
</template>

<style scoped>
.acciones {
  display: flex;
  gap: 8px;
}

.ayuda {
  margin: 0 0 1.25rem;
  font-size: 13px;
  color: var(--text-secondary);
  font-weight: 400;
}

.aviso-config {
  padding: 1rem 1.25rem;
  color: var(--text-secondary);
}

.filtros {
  display: flex;
  flex-wrap: wrap;
  align-items: end;
  gap: 1rem;
  padding: 1rem 1.25rem;
  margin-bottom: 1.25rem;
}

.busqueda {
  min-width: 260px;
  flex: 1;
}

.table-wrap {
  overflow: auto;
  max-height: 70vh;
}

.estado-conteo {
  font-size: 12px;
  white-space: nowrap;
}

.estado-conteo.sin-empezar {
  color: var(--text-secondary);
}

.estado-conteo.en-curso {
  color: var(--color-primary);
  font-weight: 600;
}

.estado-conteo.cerrado {
  color: var(--color-success);
  font-weight: 600;
}
</style>
