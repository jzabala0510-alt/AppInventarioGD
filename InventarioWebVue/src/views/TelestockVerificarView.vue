<script setup>
import { computed, nextTick, onMounted, reactive, ref } from 'vue';
import { useRouter } from 'vue-router';
import * as telestockService from '../services/telestock';
import Spinner from '../components/Spinner.vue';

const props = defineProps({
  idSesion: {
    type: String,
    required: true,
  },
});

const router = useRouter();

const cargando = ref(true);
const sesion = ref(null);
const errorCarga = ref('');

const inputCodigo = ref(null);
const codigo = ref('');
const escaneando = ref(false);
// { tipo: 'ok' | 'error', texto } -- se limpia solo al siguiente escaneo exitoso
const ultimoResultado = ref(null);

const cerrando = ref(false);
const errorCierre = ref('');
const resultadoCierre = ref(null); // { nombreArchivo: 'StockMov.txt', rutaRelativa } una vez cerrado

const reabriendo = ref(false);
const errorReabrir = ref('');

onMounted(async () => {
  await cargarSesion();
  await nextTick();
  inputCodigo.value?.focus();
});

async function cargarSesion() {
  cargando.value = true;
  errorCarga.value = '';
  try {
    sesion.value = await telestockService.obtenerSesion(props.idSesion);
  } catch (err) {
    errorCarga.value = telestockService.mensajeError(err);
  } finally {
    cargando.value = false;
  }
}

function claveLinea(l) {
  return `${l.codigoArticulo}|${l.talla}|${l.color}`;
}

const lineas = computed(() => {
  if (!sesion.value) return [];
  return sesion.value.lineasFactura.map((l) => ({
    ...l,
    contado: sesion.value.conteo[claveLinea(l)] || 0,
  }));
});

const totales = computed(() =>
  lineas.value.reduce(
    (acc, l) => ({ facturado: acc.facturado + Number(l.cantidad || 0), contado: acc.contado + l.contado }),
    { facturado: 0, contado: 0 },
  ),
);

// Filtros e indicadores para encontrar lineas puntuales en facturas largas.
// "Con diferencias" solo cuenta lineas que YA se tocaron y no coinciden --
// una linea sin contar todavia (contado=0) cae en "Sin contar", no aca,
// para que las dos categorias no se solapen (si no, toda linea sin contar
// de una factura con facturado>0 tambien "tendria diferencia").
const filtro = reactive({
  sinContar: false,
  conDiferencias: false,
});
const ordenFacturado = ref(null); // null | 'asc' | 'desc'

function alternarOrdenFacturado() {
  ordenFacturado.value = ordenFacturado.value === 'asc' ? 'desc' : ordenFacturado.value === 'desc' ? null : 'asc';
}

const lineasVisibles = computed(() => {
  let filas = lineas.value;
  if (filtro.sinContar) filas = filas.filter((l) => l.contado === 0);
  if (filtro.conDiferencias) filas = filas.filter((l) => l.contado > 0 && l.contado !== l.cantidad);
  if (ordenFacturado.value) {
    filas = [...filas].sort((a, b) =>
      ordenFacturado.value === 'asc' ? a.cantidad - b.cantidad : b.cantidad - a.cantidad,
    );
  }
  return filas;
});

const sesionCerrada = computed(() => Boolean(sesion.value?.cerradaEn) || Boolean(resultadoCierre.value));

async function escanear() {
  const valor = codigo.value.trim();
  if (!valor || escaneando.value) return;
  escaneando.value = true;
  try {
    const resultado = await telestockService.escanear(props.idSesion, valor);
    sesion.value = resultado.sesion;
    ultimoResultado.value = {
      tipo: 'ok',
      texto: `${resultado.articulo.descripcion} — ${resultado.unidadesContadas}/${resultado.unidadesFacturadas} contadas`,
    };
  } catch (err) {
    ultimoResultado.value = { tipo: 'error', texto: telestockService.mensajeError(err) };
  } finally {
    codigo.value = '';
    escaneando.value = false;
    await nextTick();
    inputCodigo.value?.focus(); // el flujo es escanear seguido, nunca hay que volver a clickear el campo
  }
}

async function cerrarYDescargar() {
  cerrando.value = true;
  errorCierre.value = '';
  try {
    const { contenido, nombreArchivo, sesion: sesionActualizada } = await telestockService.cerrarSesion(props.idSesion);
    sesion.value = sesionActualizada;
    // nombreArchivo siempre es "StockMov.txt" (nombre fijo que exige ICG,
    // tanto en el servidor como en lo que se descarga) -- para mostrar a
    // que factura corresponde se usa la ruta relativa completa que guardo
    // el backend (sesion.archivoGenerado), no el nombre del archivo.
    resultadoCierre.value = { nombreArchivo, rutaRelativa: sesionActualizada.archivoGenerado };

    // Descarga directa en el navegador ademas de que ya quedo guardado en
    // TeleStock/ del lado del servidor.
    const blob = new Blob([contenido], { type: 'text/plain;charset=iso-8859-1' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = nombreArchivo;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  } catch (err) {
    errorCierre.value = telestockService.mensajeError(err);
  } finally {
    cerrando.value = false;
  }
}

async function reabrirConteo() {
  reabriendo.value = true;
  errorReabrir.value = '';
  try {
    sesion.value = await telestockService.reabrirSesion(props.idSesion);
    resultadoCierre.value = null; // vuelve a la pantalla de escaneo
    await nextTick();
    inputCodigo.value?.focus();
  } catch (err) {
    errorReabrir.value = telestockService.mensajeError(err);
  } finally {
    reabriendo.value = false;
  }
}
</script>

<template>
  <div>
    <div class="page-header">
      <h1>Verificar factura</h1>
      <div class="acciones">
        <button type="button" class="btn" @click="router.push({ name: 'telestock' })">← Volver al listado</button>
      </div>
    </div>

    <div v-if="cargando" class="empty-state"><Spinner /></div>

    <p v-else-if="errorCarga" class="login-error">{{ errorCarga }}</p>

    <template v-else-if="sesion">
      <div class="card resumen-factura">
        <div class="mono">
          <span class="serie">{{ sesion.factura.serie }}</span>-{{ sesion.factura.numero }}<span v-if="sesion.factura.n">-{{ sesion.factura.n }}</span>
        </div>
        <div class="totales">
          Contado: <strong>{{ totales.contado }}</strong> / Facturado: <strong>{{ totales.facturado }}</strong>
        </div>
      </div>

      <template v-if="!sesionCerrada">
        <form class="card escaneo" @submit.prevent="escanear">
          <label for="codigo">Escanear código de barras</label>
          <div class="escaneo-fila">
            <input
              id="codigo"
              ref="inputCodigo"
              v-model="codigo"
              type="text"
              class="input"
              autocomplete="off"
              :disabled="escaneando"
              placeholder="Esperando escaneo…"
            />
            <button type="submit" class="btn btn-primary" :disabled="escaneando || !codigo.trim()">Agregar</button>
          </div>
          <p v-if="ultimoResultado" :class="ultimoResultado.tipo === 'ok' ? 'resultado-ok' : 'login-error'">
            {{ ultimoResultado.texto }}
          </p>
        </form>
      </template>
      <div v-else class="card resultado-cierre">
        <p class="resultado-ok">
          Sesión cerrada — archivo <strong>StockMov.txt</strong> generado
          <template v-if="resultadoCierre">y descargado </template>
          (guardado en el servidor como <span class="mono">{{ resultadoCierre?.rutaRelativa || sesion.archivoGenerado }}</span>).
        </p>
        <p v-if="errorReabrir" class="login-error">{{ errorReabrir }}</p>
        <button type="button" class="btn" :disabled="reabriendo" @click="reabrirConteo">
          {{ reabriendo ? 'Reabriendo…' : 'Reabrir conteo' }}
        </button>
      </div>

      <div class="card filtros">
        <label class="checkbox-field">
          <input v-model="filtro.sinContar" type="checkbox" />
          Sin contar
        </label>
        <label class="checkbox-field">
          <input v-model="filtro.conDiferencias" type="checkbox" />
          Con diferencias
        </label>
        <span class="filtros-contador">{{ lineasVisibles.length }} de {{ lineas.length }} líneas</span>
      </div>

      <div class="card table-wrap">
        <table class="data-table">
          <thead>
            <tr>
              <th>Cód. barras</th>
              <th>Referencia</th>
              <th>Descripción</th>
              <th>Talla</th>
              <th>Color</th>
              <th class="ordenable" @click="alternarOrdenFacturado">
                Facturado
                <span v-if="ordenFacturado">{{ ordenFacturado === 'asc' ? '▲' : '▼' }}</span>
              </th>
              <th>Contado</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="(l, ind) in lineasVisibles" :key="ind" :class="{ completa: l.contado >= l.cantidad && l.contado > 0 }">
              <td class="mono">{{ l.codigoBarras }}</td>
              <td>{{ l.referencia }}</td>
              <td>{{ l.descripcion }}</td>
              <td>{{ l.talla }}</td>
              <td>{{ l.color }}</td>
              <td>{{ l.cantidad }}</td>
              <td>{{ l.contado }}</td>
              <td class="estado-linea">
                <span v-if="l.contado === 0"></span>
                <span v-else-if="l.contado === l.cantidad" class="ok">✓ completa</span>
                <span v-else-if="l.contado < l.cantidad" class="pendiente">faltan {{ l.cantidad - l.contado }}</span>
                <span v-else class="exceso">sobran {{ l.contado - l.cantidad }}</span>
              </td>
            </tr>
            <tr v-if="lineasVisibles.length === 0">
              <td colspan="8" class="sin-resultados">Ningún artículo coincide con los filtros.</td>
            </tr>
          </tbody>
        </table>
      </div>

      <div v-if="!sesionCerrada" class="acciones cierre-acciones">
        <p v-if="errorCierre" class="login-error">{{ errorCierre }}</p>
        <button
          type="button"
          class="btn btn-primary"
          :disabled="cerrando || totales.contado === 0"
          @click="cerrarYDescargar"
        >
          {{ cerrando ? 'Generando…' : 'Cerrar y generar Telestock' }}
        </button>
      </div>
    </template>
  </div>
</template>

<style scoped>
.acciones {
  display: flex;
  gap: 8px;
}

.resumen-factura {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 1rem 1.25rem;
  margin-bottom: 1.25rem;
  font-size: 14px;
}

.resumen-factura .serie {
  color: var(--color-primary);
  font-weight: 600;
}

.totales {
  color: var(--text-secondary);
}

.escaneo {
  padding: 1rem 1.25rem;
  margin-bottom: 1.25rem;
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.escaneo-fila {
  display: flex;
  gap: 8px;
}

.escaneo-fila .input {
  flex: 1;
  font-size: 16px;
}

.resultado-ok {
  color: var(--color-success);
  font-size: 13px;
  margin: 0;
}

.resultado-cierre {
  padding: 1rem 1.25rem;
  margin-bottom: 1.25rem;
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 0.75rem;
}

.filtros {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 1.25rem;
  padding: 0.75rem 1.25rem;
  margin-bottom: 1.25rem;
}

.checkbox-field {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 14px;
}

.filtros-contador {
  margin-left: auto;
  font-size: 12px;
  color: var(--text-secondary);
}

.ordenable {
  cursor: pointer;
  user-select: none;
}

.sin-resultados {
  text-align: center;
  color: var(--text-secondary);
  padding: 1.5rem 0;
}

.table-wrap {
  overflow: auto;
  max-height: 60vh;
}

tr.completa {
  background: color-mix(in srgb, var(--color-success) 8%, transparent);
}

.estado-linea .ok {
  color: var(--color-success);
  font-size: 12px;
}

.estado-linea .pendiente {
  color: var(--text-secondary);
  font-size: 12px;
}

.estado-linea .exceso {
  color: var(--color-danger);
  font-size: 12px;
  font-weight: 600;
}

.cierre-acciones {
  justify-content: flex-end;
  align-items: center;
  gap: 1rem;
  margin-top: 1rem;
}
</style>
