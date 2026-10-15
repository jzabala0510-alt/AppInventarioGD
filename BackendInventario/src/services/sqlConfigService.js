import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getPool, getConexionActiva, probarConexionCon, reconfigurarPool } from '../db/pool.js';
import { encriptar, desEncriptar } from '../utils/normalkeyConexion.js';
import { log } from '../utils/logger.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ARCHIVO_PASSWORDS = path.join(__dirname, '../resources/passbd.json');
const ARCHIVO_SCRIPT = path.join(__dirname, '../resources/scriptConteo.sql');

// El original expone la contrasena activa cifrada (nunca en texto plano) -- el
// frontend solo la usa para preseleccionar cual preset de passbd.json coincide,
// nunca para leerla.
export async function obtenerDatosConexion() {
  const activa = getConexionActiva();
  return {
    ip: activa.host,
    puerto: activa.port,
    bd: activa.database,
    instanciaSQL: activa.instance || 'MSSQLSERVER',
    usuario: activa.user,
    pass: encriptar(activa.password || ''),
  };
}

export async function obtenerPasswords() {
  const contenido = await fs.readFile(ARCHIVO_PASSWORDS, 'utf-8');
  return JSON.parse(contenido);
}

// El "pass" que manda el frontend es uno de los strings ya cifrados de
// passbd.json (o el que ya estaba activo) -- se descifra aca antes de usarlo
// para conectar de verdad. A diferencia del original (donde el usuario de SQL
// Server no era editable desde esta pantalla), aca si se acepta -- una
// instalacion nueva no tiene ningun usuario previo guardado para reusar.
function aParametrosConexion({ ip, puerto, bd, instanciaSQL, pass }) {
  const activa = getConexionActiva();
  return {
    host: ip,
    port: Number(puerto),
    database: bd || activa.database || 'ICGAdmin',
    instance: instanciaSQL,
    user: activa.user || 'ICGAdmin',
    password: desEncriptar(pass || ''),
  };
}

export async function probarConexion(datos) {
  await probarConexionCon(aParametrosConexion(datos));
}

export async function guardarDatosConexion(datos) {
  const parametros = aParametrosConexion(datos);

  // No se aplica nada si la conexion nueva no sirve -- a diferencia del
  // original, que guardaba a ciegas.
  await probarConexionCon(parametros);
  await reconfigurarPool(parametros);

  // Igual que el original: crear/actualizar la estructura es parte del mismo
  // flujo de guardado, pero un fallo aca no deshace el cambio de conexion (el
  // Java tambien atrapaba esta excepcion en silencio).
  let script;
  try {
    script = await ejecutarScript();
    log('Script de BD ejecutado correctamente al guardar conexion');
  } catch (err) {
    script = { success: false, respuesta: String(err.message || err) };
    log(`Error ejecutando script al guardar conexion: ${err.message || err}`);
  }

  return { ...(await obtenerDatosConexion()), script };
}

// El script se puede disparar desde tres lados (arranque y sus reintentos,
// guardar conexion, GET /sql/ejecutarScript) y dos corridas simultaneas sobre
// la misma BD chocan -- el DELETE + INSERT de rip.CONCEPTOS_CONTEO termina en
// violacion de PK (ya se vio). Por eso cada llamada espera a que termine la
// anterior antes de empezar: una sola corrida a la vez por proceso.
export function enSerie(fn) {
  let corridaEnCurso = Promise.resolve();
  return () => {
    const corrida = corridaEnCurso.then(() => fn());
    corridaEnCurso = corrida.catch(() => {}); // un fallo no traba a la siguiente
    return corrida;
  };
}

// true en cuanto CUALQUIER corrida termina bien en este proceso -- asi los
// reintentos del arranque se detienen solos si, mientras tanto, alguien guardo
// la conexion desde Configuracion > Base de datos (que ya corre el script).
let scriptAplicado = false;

export const ejecutarScript = enSerie(ejecutarScriptAhora);

async function ejecutarScriptAhora() {
  const pool = await getPool();
  const contenido = await fs.readFile(ARCHIVO_SCRIPT, 'utf-8');

  // Mismo criterio que el Java original (SQL.leerArchivo): "GO" en su propia
  // linea es el separador de lotes; cada lote se ejecuta como un batch
  // independiente porque CREATE PROCEDURE/FUNCTION debe ser la unica sentencia
  // del lote.
  const lotes = contenido
    .split(/^\s*GO\s*$/im)
    .map((lote) => lote.trim())
    .filter(Boolean);

  for (const lote of lotes) {
    await pool.request().batch(lote);
  }

  scriptAplicado = true;
  const activa = getConexionActiva();
  return { success: true, respuesta: `OK (${activa.database})` };
}

// Esperas entre reintentos del arranque; la ultima se repite indefinidamente.
// La primera es corta a proposito: hay servidores (visto en uno de pruebas) donde la
// primera conexion del proceso agota el connectionTimeout de 30 s y la
// siguiente conecta al instante.
export const ESPERAS_REINTENTO_MS = [5_000, 15_000, 30_000, 60_000, 120_000, 300_000];

// Antes el script se intentaba UNA sola vez al arrancar: si SQL Server no
// respondia en ese momento, una BD nueva se quedaba sin sus objetos rip.* hasta
// el proximo reinicio del servicio. Ahora se reintenta con backoff hasta
// lograrlo una vez por proceso. No bloquea nada (el que llama no la espera) y
// cada intento pasa por ejecutarScript(), asi que nunca corre en paralelo con
// otra corrida. Los parametros solo existen para la validacion manual en
// test-fixtures/ (ejecutor falso y esperas cortas).
export async function ejecutarScriptAlArranque({
  ejecutar = ejecutarScript,
  yaAplicado = () => scriptAplicado,
  esperas = ESPERAS_REINTENTO_MS,
  registrar = log,
} = {}) {
  const inicio = Date.now();
  let ultimoError = null;

  for (let intento = 1; ; intento++) {
    if (yaAplicado()) {
      registrar('Script de BD al arranque: ya se habia ejecutado por otra via (guardar conexion), no se reintenta');
      return;
    }
    try {
      await ejecutar();
      const segundos = Math.round((Date.now() - inicio) / 1000);
      registrar(intento === 1
        ? 'Script de BD ejecutado correctamente al arranque'
        : `Script de BD ejecutado correctamente al arranque (intento ${intento}, ${segundos} s despues de arrancar)`);
      return;
    } catch (err) {
      const espera = esperas[Math.min(intento - 1, esperas.length - 1)];
      const mensaje = String(err?.message ?? err);
      // Solo se deja constancia cuando el error cambia: con la BD caida (o sin
      // configurar) toda una noche, repetir la misma linea cada 5 min no
      // aporta nada y llena backend.log.
      if (mensaje !== ultimoError) {
        registrar(`Script de BD al arranque fallo (intento ${intento}): ${mensaje} -- se reintenta en ${Math.round(espera / 1000)} s`);
        ultimoError = mensaje;
      }
      await new Promise((resolver) => setTimeout(resolver, espera));
    }
  }
}
