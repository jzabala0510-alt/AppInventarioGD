// Deteccion automatica de la conexion a LibRemote desde la propia BD de ICG:
// la tabla ICGFRONT.dbo.CENTRALES ya tiene la central a la que el Front se
// comunica (IP, puerto, usuario, contrasena, http/https). Se usa SIEMPRE la
// central IDCENTRAL = 1 (criterio definido por el negocio).
//
// Nunca se guarda a ciegas: lo detectado se prueba contra LibRemote y recien
// si responde bien se guarda como configuracion activa (mismo criterio que
// Configuracion > LibRemote y Configuracion > Base de datos).
import { getPool } from '../../db/pool.js';
import { log } from '../../utils/logger.js';
import { configurado, actualizarConfig } from './configStore.js';
import { probarCredenciales } from './soapClient.js';

const ID_CENTRAL = 1;

function errorConStatus(mensaje, status) {
  const err = new Error(mensaje);
  err.status = status;
  return err;
}

export function puertoValido(puerto) {
  const n = Number(puerto);
  return Number.isInteger(n) && n >= 1 && n <= 65535;
}

// URL sin el numero de puerto ("http://ip:"): lo que se carga en el
// formulario cuando el puerto de CENTRALES no sirve, para completar solo eso.
export function construirUrlSinPuerto({ ip, modoHttps }) {
  const host = String(ip ?? '').trim();
  if (!host) {
    throw errorConStatus(`La central ${ID_CENTRAL} de ICGFRONT.dbo.CENTRALES no tiene IP.`, 422);
  }
  return `${Number(modoHttps) ? 'https' : 'http'}://${host}:`;
}

// Arma la URL base que espera soapClient (sin el /SOAP?service=... final).
export function construirBaseUrl({ ip, puerto, modoHttps }) {
  const sinPuerto = construirUrlSinPuerto({ ip, modoHttps });
  if (!puertoValido(puerto)) {
    throw errorConStatus(
      `La central ${ID_CENTRAL} de ICGFRONT.dbo.CENTRALES tiene un puerto inválido (${puerto}); debe estar entre 1 y 65535.`,
      422,
    );
  }
  return `${sinPuerto}${Number(puerto)}`;
}

/**
 * Lee la central 1 de ICGFRONT.dbo.CENTRALES y devuelve los datos de
 * conexion a LibRemote, SIN probarlos ni guardarlos. Si el puerto no es
 * valido no lanza: devuelve baseUrl null, urlSinPuerto y puertoInvalido,
 * para poder cargar igual la IP y el usuario en el formulario.
 */
export async function leerCentral() {
  let pool;
  try {
    pool = await getPool();
  } catch (err) {
    throw errorConStatus(`No se puede leer CENTRALES: ${err.message}`, 503);
  }
  const result = await pool.request().query(`
    SELECT TOP 1 DESCRIPCION, IP, PUERTO, USUARIO, PASSWORD, MODOHTTPS
    FROM [ICGFRONT].dbo.CENTRALES WITH(NOLOCK)
    WHERE IDCENTRAL = ${ID_CENTRAL}
  `);
  const fila = result.recordset[0];
  if (!fila) {
    throw errorConStatus(`No existe la central ${ID_CENTRAL} en ICGFRONT.dbo.CENTRALES.`, 404);
  }
  const datos = { ip: fila.IP, puerto: fila.PUERTO, modoHttps: fila.MODOHTTPS };
  const urlSinPuerto = construirUrlSinPuerto(datos);
  const valido = puertoValido(fila.PUERTO);
  return {
    descripcion: fila.DESCRIPCION,
    baseUrl: valido ? construirBaseUrl(datos) : null,
    urlSinPuerto,
    puertoInvalido: valido ? null : fila.PUERTO,
    usuario: String(fila.USUARIO ?? '').trim(),
    password: String(fila.PASSWORD ?? ''),
  };
}

// Ultima central detectada (en memoria, nunca al frontend): si la prueba
// falla o el puerto no sirve, el usuario corrige la URL en pantalla y guarda
// sin conocer la contrasena (las rutas de probar/guardar la toman de aca).
let ultimaDeteccion = null;

export function passwordDetectadaPara(usuario) {
  return ultimaDeteccion && ultimaDeteccion.usuario === usuario ? ultimaDeteccion.password : '';
}

/**
 * Detecta la central, la prueba contra LibRemote y, si responde bien, la
 * guarda como configuracion activa. Devuelve { ok, mensaje, baseUrl,
 * usuario, descripcion, faltaPuerto } -- nunca la contrasena.
 */
export async function detectarYGuardar() {
  const central = await leerCentral();
  ultimaDeteccion = { usuario: central.usuario, password: central.password };
  if (central.puertoInvalido !== null) {
    log(`LibRemote: central ${ID_CENTRAL} detectada (${central.urlSinPuerto}) con puerto inválido (${central.puertoInvalido})`);
    return {
      ok: false,
      faltaPuerto: true,
      mensaje: `La central ${ID_CENTRAL} de ICGFRONT.dbo.CENTRALES ("${central.descripcion}") tiene un puerto inválido (${central.puertoInvalido}); debe estar entre 1 y 65535. Se cargaron la IP y el usuario: escribe el puerto correcto al final de la URL y guarda (la contraseña se toma de CENTRALES).`,
      baseUrl: central.urlSinPuerto,
      usuario: central.usuario,
      descripcion: central.descripcion,
    };
  }
  const prueba = await probarCredenciales(central);
  const publico = { baseUrl: central.baseUrl, usuario: central.usuario, descripcion: central.descripcion };
  if (!prueba.ok) {
    log(`LibRemote: central ${ID_CENTRAL} detectada (${central.baseUrl}) pero no respondió bien: ${prueba.mensaje}`);
    return { ok: false, mensaje: `Se encontró la central "${central.descripcion}" (${central.baseUrl}), pero la prueba falló: ${prueba.mensaje}`, ...publico };
  }
  actualizarConfig(central);
  log(`LibRemote: configurado automáticamente desde CENTRALES (${central.baseUrl}, usuario ${central.usuario})`);
  return { ok: true, mensaje: `Conexión detectada y guardada desde la central "${central.descripcion}" (${central.baseUrl}).`, ...publico };
}

// Si LibRemote todavia no esta configurado, intenta configurarlo solo desde
// CENTRALES. Un intento fallido no se repite durante un rato para no
// consultar la BD y LibRemote en cada pedido de la pantalla.
const ESPERA_REINTENTO_MS = 60 * 1000;
let ultimoIntentoFallido = { en: 0, mensaje: null };

export async function asegurarConfiguracionAutomatica() {
  if (configurado()) return { configurado: true, mensaje: null };
  if (Date.now() - ultimoIntentoFallido.en < ESPERA_REINTENTO_MS) {
    return { configurado: false, mensaje: ultimoIntentoFallido.mensaje };
  }
  try {
    const resultado = await detectarYGuardar();
    if (resultado.ok) return { configurado: true, mensaje: resultado.mensaje };
    const mensaje = resultado.faltaPuerto
      ? `La central ${ID_CENTRAL} de ICGFRONT.dbo.CENTRALES tiene un puerto inválido. En Configuración > LibRemote, "Detectar automáticamente" carga la IP y el usuario: solo falta escribir el puerto.`
      : resultado.mensaje;
    ultimoIntentoFallido = { en: Date.now(), mensaje };
  } catch (err) {
    ultimoIntentoFallido = { en: Date.now(), mensaje: err.message };
    log(`LibRemote: detección automática desde CENTRALES falló: ${err.message}`);
  }
  return { configurado: false, mensaje: ultimoIntentoFallido.mensaje };
}
