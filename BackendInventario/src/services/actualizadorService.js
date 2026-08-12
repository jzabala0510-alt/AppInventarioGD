import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import AdmZip from 'adm-zip';
import { config } from '../config/env.js';
import { log, logError } from '../utils/logger.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Raiz que contiene BackendInventario/ e InventarioWebVue/ como hermanos --
// mismo repo, mismo commit, se actualizan juntos.
const RAIZ_PROYECTO = path.join(__dirname, '../../..');
const DIR_BACKEND = path.join(RAIZ_PROYECTO, 'BackendInventario');
const DIR_FRONTEND = path.join(RAIZ_PROYECTO, 'InventarioWebVue');
const ARCHIVO_VERSION = path.join(__dirname, '../../logs/version.json');

// Lo que nunca viene del zip descargado, aunque el repo lo incluyera:
// configuracion local, secretos y estado propio de esta instalacion. Se
// preservan copiando la version en vivo hacia la copia staged justo antes
// del swap final (node_modules NO va aca: la copia staged ya trae uno
// recien instalado, y ese es el que debe quedar).
const RUTAS_PROTEGIDAS = ['.env', '.env.local', 'logs', 'src/data', 'src/resources/passbd.json'];

// Staging DENTRO de la raiz del proyecto (mismo disco que DIR_BACKEND /
// DIR_FRONTEND): el swap final es un rename, y eso solo es instantaneo
// dentro del mismo volumen. os.tmpdir() puede estar en otro disco segun el
// sistema, asi que solo se usa para bajar/extraer el zip, nunca para lo que
// se va a renombrar hacia el directorio en vivo.
const DIR_STAGING = path.join(RAIZ_PROYECTO, '.actualizador-staging');

function repoConfigurado() {
  return Boolean(config.actualizador.repoOwner && config.actualizador.repoName);
}

export function claveValida(clave) {
  return Boolean(config.actualizador.clave) && clave === config.actualizador.clave;
}

export async function obtenerEstado() {
  try {
    const contenido = await fsp.readFile(ARCHIVO_VERSION, 'utf-8');
    return { configurado: repoConfigurado(), ...JSON.parse(contenido) };
  } catch {
    return { configurado: repoConfigurado(), commit: null, fecha: null };
  }
}

// "fetch failed" es el mensaje generico que usa undici para CUALQUIER error
// de red (timeout, reset de conexion, DNS, TLS); la causa real viaja en
// err.cause y antes se perdia. La combinamos en un solo mensaje para que
// quede algo util en backend.log.
function describirErrorFetch(err) {
  const causa = err.cause ? `${err.cause.code || err.cause.message || err.cause}` : null;
  return causa ? `${err.message} (${causa})` : err.message;
}

// GitHub (api.github.com y codeload.github.com) a veces corta la conexion de
// forma transitoria. Un solo intento fallido no deberia tumbar la
// actualizacion completa, asi que reintentamos con backoff antes de rendirnos.
async function conReintentos(fn, { intentos = 3, esperaMs = 1500 } = {}) {
  let ultimoError;
  for (let intento = 1; intento <= intentos; intento++) {
    try {
      return await fn();
    } catch (err) {
      ultimoError = err;
      log(`Intento ${intento}/${intentos} fallo: ${describirErrorFetch(err)}`);
      if (intento < intentos) await new Promise((r) => setTimeout(r, esperaMs * intento));
    }
  }
  throw new Error(describirErrorFetch(ultimoError));
}

async function obtenerUltimoCommit() {
  const { repoOwner, repoName, rama } = config.actualizador;
  return conReintentos(async () => {
    const resp = await fetch(`https://api.github.com/repos/${repoOwner}/${repoName}/commits/${rama}`, {
      signal: AbortSignal.timeout(15000),
    });
    if (!resp.ok) throw new Error(`No se pudo consultar el ultimo commit (${resp.status})`);
    const datos = await resp.json();
    return { sha: datos.sha, mensaje: datos.commit?.message?.split('\n')[0], fecha: datos.commit?.author?.date };
  });
}

async function descargarZip(destino) {
  const { repoOwner, repoName, rama } = config.actualizador;
  // Se pide directo a codeload.github.com en vez de a
  // github.com/.../archive/....zip (que redirige ahi mismo). En algunas
  // redes el redirect github.com -> codeload.github.com se corta a mitad de
  // camino cuando lo sigue fetch de Node (UND_ERR_SOCKET, 0 bytes leidos)
  // aunque el navegador y una descarga directa a codeload funcionen bien.
  const url = `https://codeload.github.com/${repoOwner}/${repoName}/zip/refs/heads/${rama}`;
  await conReintentos(async () => {
    const resp = await fetch(url, { signal: AbortSignal.timeout(60000) });
    if (!resp.ok) throw new Error(`No se pudo descargar el repositorio (${resp.status})`);
    const buffer = Buffer.from(await resp.arrayBuffer());
    await fsp.writeFile(destino, buffer);
  });
}

function ejecutar(comando, args, cwd) {
  log(`Ejecutando: ${comando} ${args.join(' ')} (en ${cwd})`);
  execFileSync(comando, args, { cwd, stdio: 'pipe', shell: true });
}

// Copia las rutas protegidas (config, secretos, estado local) desde la
// instalacion en vivo hacia la copia staged, para que sobrevivan la
// actualizacion aunque el repo no las incluya (o las incluya con otro
// contenido). Si dirViejo no existe todavia (primera instalacion) no hay
// nada que preservar.
async function preservarRutasProtegidas(dirViejo, dirStaging) {
  for (const relativa of RUTAS_PROTEGIDAS) {
    const partes = relativa.split('/');
    const origen = path.join(dirViejo, ...partes);
    if (!fs.existsSync(origen)) continue;
    const destino = path.join(dirStaging, ...partes);
    await fsp.rm(destino, { recursive: true, force: true });
    await fsp.mkdir(path.dirname(destino), { recursive: true });
    await fsp.cp(origen, destino, { recursive: true });
  }
}

// Reemplaza el directorio en vivo por la copia staged con dos renames (mismo
// disco = practicamente instantaneo), para minimizar la ventana en la que
// --watch puede reiniciar el proceso a mitad de camino. Si el segundo rename
// falla, se intenta restaurar el directorio original.
async function reemplazarDirectorio(dirViejo, dirStaging) {
  const respaldo = `${dirViejo}.old`;
  await fsp.rm(respaldo, { recursive: true, force: true });
  const habiaViejo = fs.existsSync(dirViejo);
  if (habiaViejo) await fsp.rename(dirViejo, respaldo);
  try {
    await fsp.rename(dirStaging, dirViejo);
  } catch (err) {
    if (habiaViejo) await fsp.rename(respaldo, dirViejo);
    throw err;
  }
  if (habiaViejo) fsp.rm(respaldo, { recursive: true, force: true }).catch(() => {});
}

// Devuelve el resultado del intento; si tiene exito, el caller es responsable
// de reiniciar el proceso (process.exit) DESPUES de responder al cliente.
export async function aplicarActualizacion() {
  if (!repoConfigurado()) {
    throw new Error('El actualizador no tiene configurado el repositorio (UPDATER_REPO_OWNER/UPDATER_REPO_NAME)');
  }

  const commit = await obtenerUltimoCommit();
  log(`Actualizando a commit ${commit.sha.slice(0, 7)}: ${commit.mensaje}`);

  const dirTemp = await fsp.mkdtemp(path.join(os.tmpdir(), 'actualizador-'));
  const zipPath = path.join(dirTemp, 'repo.zip');
  try {
    await descargarZip(zipPath);

    const zip = new AdmZip(zipPath);
    zip.extractAllTo(dirTemp, true);

    // GitHub empaqueta todo dentro de una carpeta "{repo}-{rama}/"
    const carpetaExtraida = fs
      .readdirSync(dirTemp, { withFileTypes: true })
      .find((e) => e.isDirectory() && e.name.startsWith(`${config.actualizador.repoName}-`));
    if (!carpetaExtraida) {
      throw new Error('El zip descargado no tiene la estructura esperada');
    }
    const raizExtraida = path.join(dirTemp, carpetaExtraida.name);

    const backendExtraido = path.join(raizExtraida, 'BackendInventario');
    const frontendExtraido = path.join(raizExtraida, 'InventarioWebVue');
    if (!fs.existsSync(backendExtraido) || !fs.existsSync(frontendExtraido)) {
      throw new Error('El repositorio descargado no contiene BackendInventario/ e InventarioWebVue/');
    }

    // Todo lo lento (instalar dependencias, compilar) ocurre en copias
    // staged dentro de DIR_STAGING, SIN tocar los directorios en vivo --
    // node --watch no tiene nada que observar ahi, asi que el proceso
    // actual sigue corriendo sin interrupciones mientras se arma la version
    // nueva completa. El unico riesgo de reinicio a mitad de camino queda
    // reducido al swap final, que son solo un par de renames dentro del
    // mismo disco.
    await fsp.rm(DIR_STAGING, { recursive: true, force: true });
    await fsp.mkdir(DIR_STAGING, { recursive: true });
    const backendStaging = path.join(DIR_STAGING, 'BackendInventario');
    const frontendStaging = path.join(DIR_STAGING, 'InventarioWebVue');

    log('Preparando backend en staging...');
    await fsp.cp(backendExtraido, backendStaging, { recursive: true });
    log('Instalando dependencias del backend...');
    ejecutar('npm', ['install', '--omit=dev'], backendStaging);

    log('Preparando frontend en staging...');
    await fsp.cp(frontendExtraido, frontendStaging, { recursive: true });
    // --include=dev: NODE_ENV=production omitiria devDependencies (vite,
    // @vitejs/plugin-vue) que el build necesita.
    log('Instalando dependencias del frontend...');
    ejecutar('npm', ['install', '--include=dev'], frontendStaging);
    log('Compilando el frontend...');
    ejecutar('npm', ['run', 'build'], frontendStaging);

    log('Preservando configuracion y datos locales...');
    await preservarRutasProtegidas(DIR_BACKEND, backendStaging);
    await preservarRutasProtegidas(DIR_FRONTEND, frontendStaging);

    // El frontend no esta bajo --watch del backend (carpeta hermana, no
    // observada) -- se aplica sin apuro. El backend si dispara --watch en
    // cuanto se hace el rename, asi que el version.json se escribe pegado
    // a ese swap para que quede consistente aunque el proceso se reinicie
    // apenas despues.
    log('Aplicando frontend actualizado...');
    await reemplazarDirectorio(DIR_FRONTEND, frontendStaging);

    log('Aplicando backend actualizado...');
    await reemplazarDirectorio(DIR_BACKEND, backendStaging);

    await fsp.mkdir(path.dirname(ARCHIVO_VERSION), { recursive: true });
    await fsp.writeFile(
      ARCHIVO_VERSION,
      JSON.stringify({ commit: commit.sha, mensaje: commit.mensaje, fecha: commit.fecha, aplicado: new Date().toISOString() }, null, 2),
    );

    log(`Actualizacion aplicada correctamente (commit ${commit.sha.slice(0, 7)})`);
    return commit;
  } catch (err) {
    logError(`Fallo la actualizacion: ${err.message}`);
    throw err;
  } finally {
    await fsp.rm(dirTemp, { recursive: true, force: true }).catch(() => {});
    await fsp.rm(DIR_STAGING, { recursive: true, force: true }).catch(() => {});
  }
}
