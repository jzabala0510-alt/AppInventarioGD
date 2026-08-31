import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sql from 'mssql';
import { config } from '../config/env.js';
import { encriptar, desEncriptar } from '../utils/normalkeyConexion.js';
import { log } from '../utils/logger.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Reemplaza a ReposicionBD.config (el .properties del Java original) -- misma
// idea, formato distinto: persiste que base de datos esta activa ahora mismo,
// para sobrevivir un reinicio del backend. La contrasena se guarda cifrada
// (nunca en texto plano en disco), igual que el original.
const ARCHIVO_CONFIG = path.join(__dirname, '../data/conexion.config.json');

function construirSqlConfig({ host, port, database, user, password, instance }) {
  const sqlConfig = {
    server: host,
    port: Number(port),
    database,
    user,
    password,
    pool: {
      max: 10,
      min: 0,
      idleTimeoutMillis: 30000,
    },
    connectionTimeout: 30000,
    requestTimeout: 30000,
    options: {
      encrypt: false,
      trustServerCertificate: true,
    },
  };
  // Mismo criterio que el Conector Java: MSSQLSERVER es la instancia por defecto
  // (conexion directa por host:puerto); solo se resuelve por nombre de instancia
  // real cuando difiere de eso, para no depender del servicio SQL Browser sin
  // necesidad.
  if (instance && instance.toUpperCase() !== 'MSSQLSERVER') {
    sqlConfig.options.instanceName = instance;
  }
  return sqlConfig;
}

function configValida(c) {
  return Boolean(c && c.host && c.database && c.user && c.password);
}

function leerConfigPersistida() {
  try {
    const datos = JSON.parse(fs.readFileSync(ARCHIVO_CONFIG, 'utf-8'));
    return {
      host: datos.ip,
      port: Number(datos.puerto),
      database: datos.bd,
      instance: datos.instanciaSQL,
      user: datos.usuario,
      password: desEncriptar(datos.pass),
    };
  } catch {
    return null;
  }
}

function persistirConfigActiva() {
  fs.mkdirSync(path.dirname(ARCHIVO_CONFIG), { recursive: true });
  fs.writeFileSync(
    ARCHIVO_CONFIG,
    JSON.stringify(
      {
        ip: estadoActivo.host,
        puerto: estadoActivo.port,
        bd: estadoActivo.database,
        instanciaSQL: estadoActivo.instance || 'MSSQLSERVER',
        usuario: estadoActivo.user,
        pass: encriptar(estadoActivo.password),
      },
      null,
      2,
    ),
  );
}

const configGuardada = leerConfigPersistida();
// Si no hay nada guardado en disco NI en .env, el backend arranca igual, solo
// que sin base de datos activa -- se debe poder configurar desde el frontend
// (Configuracion > Base de datos), sin que eso tumbe el proceso.
let estadoActivo = configGuardada ?? (configValida(config.db) ? { ...config.db } : null);
if (!configGuardada && estadoActivo) persistirConfigActiva(); // primer arranque: deja constancia en disco

let poolPromise = null;

// Cachea que tan moderno es el SQL Server conectado, para que el resto del
// backend pueda evitar sintaxis que ese servidor no soporte (p.ej. OPENJSON,
// que solo existe desde SQL Server 2016/version mayor 13 -- una tienda con
// una caja en SQL Server 2014 o anterior necesita un metodo alternativo).
let capacidadesServidor = { soportaOpenJson: true, versionMayor: null };

async function detectarCapacidadesServidor(pool) {
  try {
    const result = await pool.request().query(
      "SELECT CAST(SERVERPROPERTY('ProductVersion') AS NVARCHAR(50)) AS VERSION",
    );
    const version = result.recordset[0]?.VERSION || '';
    const versionMayor = parseInt(version.split('.')[0], 10);
    const soportaOpenJson = Number.isNaN(versionMayor) ? true : versionMayor >= 13;
    capacidadesServidor = { soportaOpenJson, versionMayor: Number.isNaN(versionMayor) ? null : versionMayor };
    if (!soportaOpenJson) {
      log(`SQL Server ${version} detectado -- sin soporte OPENJSON, se usa el metodo de envio alternativo`);
    }
  } catch (err) {
    // Si no se pudo detectar (permisos insuficientes sobre SERVERPROPERTY,
    // error transitorio, etc.), asume que si soporta -- es el caso mas comun
    // y evita degradar de mas una instalacion moderna por un fallo puntual.
    capacidadesServidor = { soportaOpenJson: true, versionMayor: null };
  }
}

export function getCapacidadesServidor() {
  return { ...capacidadesServidor };
}

export function getPool() {
  if (!estadoActivo) {
    return Promise.reject(new Error('No hay una conexion de base de datos configurada. Ve a Configuracion > Base de datos.'));
  }
  if (!poolPromise) {
    poolPromise = new sql.ConnectionPool(construirSqlConfig(estadoActivo))
      .connect()
      .then(async (pool) => {
        await detectarCapacidadesServidor(pool);
        return pool;
      })
      .catch((err) => {
        poolPromise = null; // permite reintentar en la siguiente llamada
        throw err;
      });
  }
  return poolPromise;
}

export function getConexionActiva() {
  return estadoActivo
    ? { ...estadoActivo }
    : { host: '', port: 1433, database: '', instance: 'MSSQLSERVER', user: '', password: '' };
}

// Abre y cierra una conexion desechable con los parametros dados, sin tocar el
// pool activo -- para validar credenciales/host antes de comprometerse a ellos.
export async function probarConexionCon(parametros) {
  const poolPrueba = new sql.ConnectionPool(construirSqlConfig(parametros));
  try {
    await poolPrueba.connect();
  } finally {
    await poolPrueba.close().catch(() => {});
  }
}

// Reemplaza el pool activo por uno nuevo ya conectado. Si la conexion nueva
// falla, no se toca nada del estado anterior (se propaga el error).
export async function reconfigurarPool(parametros) {
  const nuevoPool = new sql.ConnectionPool(construirSqlConfig(parametros));
  await nuevoPool.connect();
  await detectarCapacidadesServidor(nuevoPool);

  const anterior = poolPromise;
  poolPromise = Promise.resolve(nuevoPool);
  estadoActivo = { ...parametros };
  persistirConfigActiva();

  if (anterior) {
    anterior.then((p) => p.close()).catch(() => {});
  }
}

export { sql };
