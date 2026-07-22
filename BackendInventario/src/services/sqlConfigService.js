import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getPool, getConexionActiva, probarConexionCon, reconfigurarPool } from '../db/pool.js';
import { encriptar, desEncriptar } from '../utils/normalkeyConexion.js';

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
function aParametrosConexion({ ip, puerto, instanciaSQL, pass }) {
  return {
    host: ip,
    port: Number(puerto),
    database: 'ICGAdmin',
    instance: instanciaSQL,
    user: 'ICGAdmin',
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
  } catch (err) {
    script = { success: false, respuesta: String(err.message || err) };
  }

  return { ...(await obtenerDatosConexion()), script };
}

export async function ejecutarScript() {
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

  const activa = getConexionActiva();
  return { success: true, respuesta: `OK (${activa.database})` };
}
