// Sesiones de verificacion de conteo contra factura de venta (LibRemote) --
// modulo nuevo y separado del Conteo existente (rip.CONTEOLIN). Cada sesion
// representa "estoy contando lo que va a salir en la factura X" y termina
// generando un archivo StockMov.txt (formato Telestock de ICG, ver PDF de
// referencia) con lo que se conto.
//
// Persistencia: un archivo JSON por sesion en data/telestockSesiones/. No hay
// BD configurada en esta copia para probar contra una tabla real -- si mas
// adelante se conecta una BD y se prefiere ahi, es un cambio acotado a este
// archivo (la forma de la sesion no cambia, solo donde se guarda).
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { log } from '../utils/logger.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DIR_SESIONES = path.join(__dirname, '..', '..', 'data', 'telestockSesiones');
const DIR_TELESTOCK = path.join(__dirname, '..', '..', 'TeleStock');

fs.mkdirSync(DIR_SESIONES, { recursive: true });
fs.mkdirSync(DIR_TELESTOCK, { recursive: true });

function rutaSesion(idSesion) {
  // idSesion ya se genera con randomUUID en este mismo archivo -- no llega
  // desde afuera sin pasar por crearSesion, pero igual se valida el formato
  // antes de usarlo para armar una ruta de archivo (evita path traversal si
  // en algun momento se expone directo desde un parametro de ruta HTTP).
  if (!/^[0-9a-f-]{36}$/i.test(idSesion)) {
    const err = new Error('Identificador de sesion invalido');
    err.status = 400;
    throw err;
  }
  return path.join(DIR_SESIONES, `${idSesion}.json`);
}

async function guardarSesion(sesion) {
  await fsp.writeFile(rutaSesion(sesion.idSesion), JSON.stringify(sesion, null, 2));
  return sesion;
}

export async function obtenerSesion(idSesion) {
  try {
    const contenido = await fsp.readFile(rutaSesion(idSesion), 'utf-8');
    return JSON.parse(contenido);
  } catch (err) {
    if (err.code === 'ENOENT') {
      const notFound = new Error('La sesion no existe (¿se reinicio el backend sin haberla cerrado?)');
      notFound.status = 404;
      throw notFound;
    }
    throw err;
  }
}

function totalesSesion(sesion) {
  const facturado = sesion.lineasFactura.reduce((acc, l) => acc + Number(l.cantidad || 0), 0);
  const contado = Object.values(sesion.conteo).reduce((acc, u) => acc + Number(u || 0), 0);
  return { facturado, contado };
}

/**
 * Lista todas las sesiones guardadas localmente (abiertas y cerradas), mas
 * recientes primero -- para poder encontrar de nuevo un conteo ya cerrado
 * (y reabrirlo) sin depender de tener guardada la URL. Devuelve un resumen
 * liviano, no las lineas completas de cada factura.
 */
export async function listarSesiones() {
  const archivos = await fsp.readdir(DIR_SESIONES).catch(() => []);
  const sesiones = [];
  for (const archivo of archivos) {
    if (!archivo.endsWith('.json')) continue;
    try {
      const contenido = await fsp.readFile(path.join(DIR_SESIONES, archivo), 'utf-8');
      const sesion = JSON.parse(contenido);
      sesiones.push({
        idSesion: sesion.idSesion,
        factura: sesion.factura,
        creadaEn: sesion.creadaEn,
        cerradaEn: sesion.cerradaEn,
        archivoGenerado: sesion.archivoGenerado || null,
        totales: totalesSesion(sesion),
      });
    } catch {
      // Archivo corrupto o a medio escribir -- se omite en vez de tumbar el
      // listado completo por una sola sesion en mal estado.
    }
  }
  sesiones.sort((a, b) => new Date(b.creadaEn) - new Date(a.creadaEn));
  return sesiones;
}

/**
 * Crea una nueva sesion de verificacion para una factura ya identificada,
 * con sus lineas ya traidas de LibRemote (obtenerLineasFactura).
 */
export async function crearSesion({ serie, numero, n, facturado, lineas }) {
  const idSesion = crypto.randomUUID();
  // La fecha de la factura (no la de hoy) es la que decide en que carpeta
  // StockMov-<fecha>/ cae el archivo al cerrar -- LibRemote no la devuelve a
  // nivel de cabecera en esta llamada, pero cada linea trae la suya, y para
  // una misma factura son todas iguales.
  const fechaFactura = lineas[0]?.fecha || new Date().toISOString().slice(0, 10);
  const sesion = {
    idSesion,
    factura: { serie, numero: Number(numero), n: n ?? '', facturado: Boolean(facturado), fecha: fechaFactura },
    lineasFactura: lineas, // tal cual las devuelve el decoder (codigoBarras, codigoArticulo, talla, color, cantidad, ...)
    conteo: {}, // clave "codigoArticulo|talla|color" -> unidades contadas
    historial: [], // cada escaneo, para auditoria/deshacer
    creadaEn: new Date().toISOString(),
    cerradaEn: null,
  };
  await guardarSesion(sesion);
  log(`Sesion de verificacion creada ${idSesion} para factura ${serie}/${numero}/${n} (${lineas.length} lineas)`);
  return sesion;
}

function claveLinea({ codigoArticulo, talla, color }) {
  return `${codigoArticulo}|${talla}|${color}`;
}

/**
 * Registra un escaneo dentro de una sesion. Busca el articulo por codigo de
 * barras entre las lineas de la factura cargada -- si no pertenece a esa
 * factura, rechaza el escaneo (comportamiento pedido: bloquear/avisar de
 * inmediato, no permitirlo).
 */
export async function registrarEscaneo(idSesion, { codigoBarras, unidades = 1 }) {
  const sesion = await obtenerSesion(idSesion);
  if (sesion.cerradaEn) {
    const err = new Error('Esta sesion ya fue cerrada, no se pueden agregar mas escaneos.');
    err.status = 409;
    throw err;
  }

  const linea = sesion.lineasFactura.find((l) => l.codigoBarras === codigoBarras);
  if (!linea) {
    const err = new Error(`El codigo "${codigoBarras}" no pertenece a esta factura.`);
    err.status = 422;
    err.codigoNoPertenece = true;
    throw err;
  }

  const clave = claveLinea(linea);
  sesion.conteo[clave] = (sesion.conteo[clave] || 0) + Number(unidades);
  sesion.historial.push({
    codigoBarras,
    codigoArticulo: linea.codigoArticulo,
    talla: linea.talla,
    color: linea.color,
    descripcion: linea.descripcion,
    unidades: Number(unidades),
    hora: new Date().toISOString(),
  });

  await guardarSesion(sesion);
  return {
    sesion,
    articulo: linea,
    unidadesContadas: sesion.conteo[clave],
    unidadesFacturadas: linea.cantidad,
  };
}

// Formato StockMov.txt (ver "Caracteristicas y uso del archivo texto para el
// telestock.pdf"): un registro por linea, campos separados por "|", con "|"
// tambien al final de cada linea.
//   IDMov|CodArticulo|Talla|Color|Unidades|Precio|Dto|Total|CodBarras|
// Precio/Dto/Total van en 0 -- el PDF dice explicitamente que para importar
// una regularizacion esos campos pueden ponerse a 0.
function generarContenidoStockMov(sesion, idMov = 1) {
  const lineasPorClave = new Map(sesion.lineasFactura.map((l) => [claveLinea(l), l]));
  const filas = Object.entries(sesion.conteo).map(([clave, unidades]) => {
    const linea = lineasPorClave.get(clave);
    const talla = linea?.talla || '.';
    const color = linea?.color || '.';
    const codBarras = linea?.codigoBarras || '';
    return `${idMov}|${linea?.codigoArticulo ?? ''}|${talla}|${color}|${unidades}|0|0|0|${codBarras}|`;
  });
  return filas.join('\r\n') + (filas.length > 0 ? '\r\n' : '');
}

/**
 * Cierra la sesion: genera el StockMov.txt con el conteo acumulado y lo
 * guarda en la carpeta TeleStock/ del backend. Devuelve el contenido (para
 * ofrecerlo como descarga) y la ruta donde quedo guardado.
 */
export async function cerrarSesion(idSesion, { idMov = 1 } = {}) {
  const sesion = await obtenerSesion(idSesion);
  if (sesion.cerradaEn) {
    const err = new Error('Esta sesion ya fue cerrada.');
    err.status = 409;
    throw err;
  }
  if (Object.keys(sesion.conteo).length === 0) {
    const err = new Error('No se registro ningun conteo en esta sesion todavia.');
    err.status = 422;
    throw err;
  }

  const contenido = generarContenidoStockMov(sesion, idMov);

  // El nombre del archivo en si NO es negociable: ICG solo importa un
  // archivo llamado exactamente "StockMov.txt" (ver el PDF de referencia).
  // Como cada factura genera el suyo, no pueden compartir carpeta -- se
  // organizan en TeleStock/StockMov-<fecha factura>/<serie>-<numero>/, asi
  // que facturas de la misma fecha quedan agrupadas bajo la misma carpeta
  // StockMov-<fecha> pero cada una en su propia subcarpeta.
  const carpetaFecha = `StockMov-${sesion.factura.fecha}`;
  const carpetaFactura = `${sesion.factura.serie}-${sesion.factura.numero}`;
  const dirDestino = path.join(DIR_TELESTOCK, carpetaFecha, carpetaFactura);
  await fsp.mkdir(dirDestino, { recursive: true });
  const rutaArchivo = path.join(dirDestino, 'StockMov.txt');
  await fsp.writeFile(rutaArchivo, contenido, 'latin1');

  // La descarga del navegador tambien tiene que llamarse "StockMov.txt" --
  // el usuario la usa para arrastrarla directo a la carpeta de importacion
  // de ICG (mismo requisito de nombre fijo que la copia que ya quedo en el
  // servidor). Para saber a que factura corresponde sin depender del
  // nombre del archivo, la UI usa sesion.archivoGenerado (la ruta relativa
  // completa, con las carpetas fecha/serie-numero).
  const nombreArchivo = 'StockMov.txt';

  sesion.cerradaEn = new Date().toISOString();
  sesion.archivoGenerado = path.join(carpetaFecha, carpetaFactura, 'StockMov.txt');
  await guardarSesion(sesion);

  log(`Sesion ${idSesion} cerrada -- ${Object.keys(sesion.conteo).length} articulos, archivo ${rutaArchivo}`);
  return { sesion, contenido, nombreArchivo, rutaArchivo };
}

/**
 * Reabre una sesion ya cerrada para poder seguir escaneando (por ejemplo, se
 * cerro por error o aparecieron mas unidades para contar despues). El conteo
 * acumulado hasta ahora NO se borra -- se sigue sumando sobre el mismo. El
 * StockMov.txt que ya se genero queda tal cual en el disco hasta que la
 * sesion se vuelva a cerrar, momento en el que se sobreescribe con el
 * contenido actualizado (mismo archivo, misma ruta -- ver cerrarSesion).
 */
export async function reabrirSesion(idSesion) {
  const sesion = await obtenerSesion(idSesion);
  if (!sesion.cerradaEn) {
    const err = new Error('Esta sesion no esta cerrada, no hace falta reabrirla.');
    err.status = 409;
    throw err;
  }

  sesion.reaperturas = sesion.reaperturas || [];
  sesion.reaperturas.push({ hora: new Date().toISOString(), cerradaEnAntes: sesion.cerradaEn });
  sesion.cerradaEn = null;

  await guardarSesion(sesion);
  log(`Sesion ${idSesion} reabierta (factura ${sesion.factura.serie}/${sesion.factura.numero}/${sesion.factura.n})`);
  return sesion;
}

export { generarContenidoStockMov, DIR_SESIONES, DIR_TELESTOCK };
