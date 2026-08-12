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

// Lo que nunca se toca al actualizar, aunque venga (o no) en el zip del repo:
// configuracion local, secretos y estado propio de esta instalacion.
const RUTAS_PROTEGIDAS = [
  '.env',
  '.env.local',
  'logs',
  'src/data',
  'src/resources/passbd.json',
  'node_modules',
];

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

async function obtenerUltimoCommit() {
  const { repoOwner, repoName, rama } = config.actualizador;
  const resp = await fetch(`https://api.github.com/repos/${repoOwner}/${repoName}/commits/${rama}`);
  if (!resp.ok) throw new Error(`No se pudo consultar el ultimo commit (${resp.status})`);
  const datos = await resp.json();
  return { sha: datos.sha, mensaje: datos.commit?.message?.split('\n')[0], fecha: datos.commit?.author?.date };
}

async function descargarZip(destino) {
  const { repoOwner, repoName, rama } = config.actualizador;
  const url = `https://github.com/${repoOwner}/${repoName}/archive/refs/heads/${rama}.zip`;
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`No se pudo descargar el repositorio (${resp.status})`);
  const buffer = Buffer.from(await resp.arrayBuffer());
  await fsp.writeFile(destino, buffer);
}

function esRutaProtegida(rutaRelativa) {
  const normalizada = rutaRelativa.split(path.sep).join('/');
  return RUTAS_PROTEGIDAS.some((protegida) => normalizada === protegida || normalizada.startsWith(`${protegida}/`));
}

// Copia recursiva que respeta RUTAS_PROTEGIDAS -- nunca sobreescribe .env,
// logs/, la config de conexion ni passbd.json, aunque el repo los incluyera.
async function copiarSobreescribiendo(origen, destino, prefijoRelativo = '') {
  const entradas = await fsp.readdir(origen, { withFileTypes: true });
  await fsp.mkdir(destino, { recursive: true });
  for (const entrada of entradas) {
    const relativa = prefijoRelativo ? `${prefijoRelativo}/${entrada.name}` : entrada.name;
    if (esRutaProtegida(relativa)) continue;
    const rutaOrigen = path.join(origen, entrada.name);
    const rutaDestino = path.join(destino, entrada.name);
    if (entrada.isDirectory()) {
      await copiarSobreescribiendo(rutaOrigen, rutaDestino, relativa);
    } else {
      await fsp.copyFile(rutaOrigen, rutaDestino);
    }
  }
}

function ejecutar(comando, args, cwd) {
  log(`Ejecutando: ${comando} ${args.join(' ')} (en ${cwd})`);
  execFileSync(comando, args, { cwd, stdio: 'pipe', shell: true });
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

    log('Aplicando archivos nuevos del backend...');
    await copiarSobreescribiendo(backendExtraido, DIR_BACKEND);

    log('Aplicando archivos nuevos del frontend...');
    await copiarSobreescribiendo(frontendExtraido, DIR_FRONTEND);

    log('Instalando dependencias del backend...');
    ejecutar('npm', ['install', '--omit=dev'], DIR_BACKEND);

    log('Instalando dependencias y compilando el frontend...');
    ejecutar('npm', ['install'], DIR_FRONTEND);
    ejecutar('npm', ['run', 'build'], DIR_FRONTEND);

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
  }
}
