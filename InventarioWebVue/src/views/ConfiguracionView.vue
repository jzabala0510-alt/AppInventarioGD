<script setup>
import { onMounted, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { apiConfig, actualizarApiBaseUrl, restablecerApiBaseUrl, esConfiguracionPersonalizada } from '../services/apiConfig';
import { api } from '../services/api';
import * as sqlConfigService from '../services/sqlConfig';
import Spinner from '../components/Spinner.vue';

const route = useRoute();
const router = useRouter();
const llegoPorFalloDeConexion = route.query.motivo === 'sin-conexion';
// Si se llega por una redireccion de fallo, el problema casi siempre es la
// base de datos (la direccion del backend se calcula sola -- ver apiConfig.js)
// asi que se oculta esa seccion para no distraer. Si de verdad el problema es
// la direccion (el bloque de abajo tampoco carga), se revela sola.
const mostrarSeccionApi = ref(!llegoPorFalloDeConexion);

const valorEditado = ref(apiConfig.baseUrl);
const guardado = ref(false);
const probando = ref(false);
const resultadoPrueba = ref(null);
const copiado = ref(false);

function guardar() {
  actualizarApiBaseUrl(valorEditado.value);
  guardado.value = true;
  resultadoPrueba.value = null;
  setTimeout(() => {
    guardado.value = false;
  }, 2000);
}

function restablecer() {
  restablecerApiBaseUrl();
  valorEditado.value = apiConfig.baseUrl;
  resultadoPrueba.value = null;
}

async function probarConexion() {
  probando.value = true;
  resultadoPrueba.value = null;
  try {
    const { data } = await api.get('/_health');
    resultadoPrueba.value = { ok: true, mensaje: `Conectado (Node ${data.node}, base de datos "${data.sql?.baseDatos}")` };
  } catch {
    resultadoPrueba.value = { ok: false, mensaje: 'No se pudo conectar con esa dirección' };
  } finally {
    probando.value = false;
  }
}

async function copiarUrl() {
  await navigator.clipboard.writeText(apiConfig.baseUrl);
  copiado.value = true;
  setTimeout(() => {
    copiado.value = false;
  }, 1500);
}

const formularioBD = ref({
  ip: '',
  puerto: 1433,
  instanciaSQL: 'MSSQLSERVER',
  usuario: '',
  pass: '',
});
const passwords = ref([]);
const cargandoBD = ref(true);
const probandoBD = ref(false);
const guardandoBD = ref(false);
const resultadoPruebaBD = ref(null);
const resultadoGuardarBD = ref(null);

onMounted(async () => {
  try {
    const [actual, listaPasswords] = await Promise.all([
      sqlConfigService.obtenerDatosConexion(),
      sqlConfigService.obtenerPasswords(),
    ]);
    passwords.value = listaPasswords;
    formularioBD.value = {
      ip: actual.ip || '',
      puerto: actual.puerto || 1433,
      instanciaSQL: actual.instanciaSQL || 'MSSQLSERVER',
      usuario: actual.usuario || '',
      pass: actual.pass || '',
    };
  } catch {
    // Si ni siquiera esto carga, el problema real es la direccion del backend,
    // no la base de datos -- hay que mostrar esa seccion aunque estuviera
    // oculta por defecto.
    mostrarSeccionApi.value = true;
    resultadoPruebaBD.value = {
      ok: false,
      mensaje: 'No se pudo contactar al backend. Revisa "Dirección del servidor" arriba.',
    };
  } finally {
    cargandoBD.value = false;
  }
});

async function probarConexionBD() {
  probandoBD.value = true;
  resultadoPruebaBD.value = null;
  try {
    const respuesta = await sqlConfigService.probarConexion(formularioBD.value);
    resultadoPruebaBD.value = { ok: respuesta.success, mensaje: respuesta.respuesta };
  } catch {
    resultadoPruebaBD.value = {
      ok: false,
      mensaje: 'No se pudo contactar al backend (no a la base de datos). Revisa "Dirección del servidor" arriba.',
    };
  } finally {
    probandoBD.value = false;
  }
}

async function guardarBD() {
  guardandoBD.value = true;
  resultadoGuardarBD.value = null;
  try {
    const respuesta = await sqlConfigService.guardarDatosConexion(formularioBD.value);
    if (respuesta.success === false) {
      resultadoGuardarBD.value = { ok: false, mensaje: respuesta.respuesta };
      return;
    }
    const mensajeScript = respuesta.script?.success
      ? 'Estructura actualizada correctamente.'
      : `No se pudo actualizar la estructura: ${respuesta.script?.respuesta}`;
    const ok = Boolean(respuesta.script?.success);
    resultadoGuardarBD.value = {
      ok,
      mensaje: `Conectado a "${respuesta.bd}". ${mensajeScript}${ok ? ' Volviendo al inicio…' : ''}`,
    };
    if (ok) {
      setTimeout(() => router.push({ name: 'login' }), 1800);
    }
  } catch {
    resultadoGuardarBD.value = {
      ok: false,
      mensaje: 'No se pudo contactar al backend. Revisa "Dirección del servidor" arriba.',
    };
  } finally {
    guardandoBD.value = false;
  }
}
</script>

<template>
  <div>
    <div class="page-header">
      <h1>Configuración</h1>
    </div>

    <div v-if="llegoPorFalloDeConexion" class="banner-error">
      No se pudo conectar con el servidor. Configura la base de datos aquí abajo.
    </div>

    <template v-if="mostrarSeccionApi">
    <h2 class="section-title">Conexión de la aplicación</h2>
    <div class="card config-card">
      <div class="field">
        <label>Dirección del servidor</label>
        <p class="ayuda">
          Esta es la dirección a la que se conecta esta aplicación y la app móvil de conteos.
          Usa el mismo valor al configurar la app en los dispositivos de la tienda.
          Por defecto se calcula sola a partir de la dirección con la que abriste esta página,
          así que se adapta automáticamente si el dispositivo cambia de red. Solo cámbiala a mano
          si el backend vive en otra dirección distinta a esta página.
        </p>
        <p v-if="esConfiguracionPersonalizada()" class="ayuda ayuda-aviso">
          Tienes una dirección guardada a mano — si cambiaste de red y algo dejó de funcionar,
          prueba "Restablecer valor por defecto".
        </p>
        <div class="url-actual mono">
          {{ apiConfig.baseUrl }}
          <button type="button" class="btn btn-ghost btn-copiar" @click="copiarUrl">
            {{ copiado ? 'Copiado' : 'Copiar' }}
          </button>
        </div>
      </div>

      <div class="field">
        <label for="nuevaUrl">Cambiar dirección</label>
        <input id="nuevaUrl" v-model="valorEditado" type="text" class="input" placeholder="http://10.10.10.200:8086/Reposiciones/recursos" />
      </div>

      <div class="acciones">
        <button type="button" class="btn btn-primary" @click="guardar">
          {{ guardado ? 'Guardado' : 'Guardar' }}
        </button>
        <button v-if="esConfiguracionPersonalizada()" type="button" class="btn" @click="restablecer">
          Restablecer valor por defecto
        </button>
        <button type="button" class="btn" :disabled="probando" @click="probarConexion">
          <Spinner v-if="probando" :size="14" />
          <span>{{ probando ? 'Probando…' : 'Probar conexión' }}</span>
        </button>
      </div>

      <p v-if="resultadoPrueba" :class="resultadoPrueba.ok ? 'resultado-ok' : 'login-error'">
        {{ resultadoPrueba.mensaje }}
      </p>
    </div>
    </template>

    <h2 class="section-title">Base de datos</h2>
    <div v-if="cargandoBD" class="empty-state"><Spinner /></div>
    <form v-else class="card config-card" @submit.prevent="guardarBD">
      <p class="ayuda">
        Cambia a qué base de datos apunta esta aplicación (por ejemplo, al pasar a otra tienda).
        Al guardar, también se crean o actualizan los procedimientos que la app necesita en esa base de datos.
      </p>

      <div class="fila-bd">
        <div class="field">
          <label for="bdIp">Servidor</label>
          <input id="bdIp" v-model="formularioBD.ip" type="text" class="input" required />
        </div>
        <div class="field campo-puerto">
          <label for="bdPuerto">Puerto</label>
          <input id="bdPuerto" v-model.number="formularioBD.puerto" type="number" class="input" required />
        </div>
      </div>

      <div class="field">
        <label for="bdInstancia">Instancia SQL</label>
        <input id="bdInstancia" v-model="formularioBD.instanciaSQL" type="text" class="input" required />
      </div>

      <div class="field">
        <label for="bdUsuario">Usuario SQL Server</label>
        <input id="bdUsuario" v-model="formularioBD.usuario" type="text" class="input" required />
      </div>

      <div class="field">
        <label for="bdPass">Contraseña</label>
        <select id="bdPass" v-model="formularioBD.pass" class="select">
          <option v-if="!passwords.some((p) => p.password === formularioBD.pass)" :value="formularioBD.pass">
            (actual)
          </option>
          <option v-for="p in passwords" :key="p.name" :value="p.password" :title="p.hint">{{ p.name }}</option>
        </select>
      </div>

      <div class="acciones">
        <button type="button" class="btn" :disabled="probandoBD" @click="probarConexionBD">
          <Spinner v-if="probandoBD" :size="14" />
          <span>{{ probandoBD ? 'Probando…' : 'Probar conexión' }}</span>
        </button>
        <button type="submit" class="btn btn-primary" :disabled="guardandoBD">
          <Spinner v-if="guardandoBD" :size="14" />
          <span>{{ guardandoBD ? 'Guardando…' : 'Guardar' }}</span>
        </button>
      </div>

      <p v-if="resultadoPruebaBD" :class="resultadoPruebaBD.ok ? 'resultado-ok' : 'login-error'">
        {{ resultadoPruebaBD.mensaje }}
      </p>
      <p v-if="resultadoGuardarBD" :class="resultadoGuardarBD.ok ? 'resultado-ok' : 'login-error'">
        {{ resultadoGuardarBD.mensaje }}
      </p>
    </form>
  </div>
</template>

<style scoped>
.banner-error {
  background: var(--color-danger-bg);
  color: var(--color-danger);
  border-radius: var(--radius);
  padding: 10px 14px;
  font-size: 14px;
  margin-bottom: 1rem;
}

.section-title {
  font-size: 16px;
  font-weight: 600;
  margin: 1.75rem 0 0.75rem;
}

.section-title:first-of-type {
  margin-top: 0;
}

.config-card {
  width: min(560px, 100%);
  padding: 1.5rem;
  display: flex;
  flex-direction: column;
  gap: 1.25rem;
}

.fila-bd {
  display: flex;
  gap: 1rem;
}

.fila-bd .field {
  flex: 1;
}

.campo-puerto {
  max-width: 140px;
}

.ayuda {
  margin: 0;
  font-size: 13px;
  color: var(--text-secondary);
  font-weight: 400;
}

.ayuda-aviso {
  color: var(--color-danger);
}

.url-actual {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  background: var(--bg-surface-alt);
  border-radius: var(--radius);
  padding: 10px 14px;
  font-size: 15px;
}

.btn-copiar {
  height: 28px;
  padding: 0 10px;
  font-size: 12px;
  flex-shrink: 0;
}

.acciones {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}

.resultado-ok {
  color: var(--color-success);
  font-size: 13px;
  margin: 0;
}
</style>
