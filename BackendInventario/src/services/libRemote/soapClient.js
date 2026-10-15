// Cliente SOAP 1.1 (RPC/Encoded) minimo para el servicio SvcRemote de
// LibRemote/ICGManager. No usa una libreria SOAP de proposito general (wsdl
// completo, etc.) porque solo necesitamos invocar dos operaciones puntuales
// con una forma conocida -- armar el envelope a mano es mas simple y mas
// facil de auditar que traer una dependencia pesada para esto.
import { XMLParser } from 'fast-xml-parser';
import { getConfigActiva, configurado } from './configStore.js';
import { log, logError } from '../../utils/logger.js';

const parser = new XMLParser({ ignoreAttributes: true, trimValues: true });

// "fetch failed" es el mensaje generico que usa undici para CUALQUIER error de
// red (timeout, reset de conexion, DNS, TLS, puerto cerrado); la causa real
// viaja en err.cause y se pierde si no se la agrega a mano (mismo problema ya
// resuelto para el Actualizador en actualizadorService.js).
function describirErrorFetch(err) {
  const causa = err.cause ? `${err.cause.code || err.cause.message || err.cause}` : null;
  return causa ? `${err.message} (${causa})` : err.message;
}

export function libRemoteConfigurado() {
  return configurado();
}

function escaparXml(valor) {
  return String(valor)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// Arma el <soap:Envelope> completo para una operacion de SvcRemote. `campos`
// es un array de [nombre, valor, tipoXsd] en el orden exacto que espera el
// WSDL (ver los .postman_collection.json de referencia).
function armarEnvelope(operacion, campos) {
  const cuerpo = campos
    .map(([nombre, valor, tipo]) => `<${nombre} xsi:type="xsd:${tipo}">${escaparXml(valor)}</${nombre}>`)
    .join('\n         ');
  return `<?xml version="1.0" encoding="UTF-8"?>
<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/"
               xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
               xmlns:xsd="http://www.w3.org/2001/XMLSchema">
   <soap:Body>
      <${operacion} xmlns="urn:LibRemote-SvcRemote">
         ${cuerpo}
      </${operacion}>
   </soap:Body>
</soap:Envelope>`;
}

// Busca una clave en un objeto por su "nombre local" (lo que queda despues
// de los ":"), ignorando el prefijo de namespace -- distintos servidores
// SOAP usan prefijos distintos para lo mismo (soap:/SOAP-ENV:/NS1:/sin
// prefijo), y el prefijo no es parte del nombre real del elemento XML.
function buscarPorNombreLocal(obj, nombreLocal) {
  if (!obj || typeof obj !== 'object') return undefined;
  for (const clave of Object.keys(obj)) {
    if (clave === nombreLocal || clave.endsWith(`:${nombreLocal}`)) {
      return obj[clave];
    }
  }
  return undefined;
}

// Extrae el objeto de respuesta de una operacion a partir del TEXTO XML de la
// respuesta SOAP. Separado de invocarSoap (que hace el fetch real) para que
// se pueda probar con respuestas sinteticas sin pegarle a ningun servidor.
export function parsearRespuestaSoap(textoRespuesta, operacion) {
  const doc = parser.parse(textoRespuesta);
  const envelope = buscarPorNombreLocal(doc, 'Envelope');
  const body = buscarPorNombreLocal(envelope, 'Body');
  if (!body) {
    throw new Error(`Respuesta de ${operacion} no tiene la forma SOAP esperada`);
  }
  const fault = buscarPorNombreLocal(body, 'Fault');
  if (fault) {
    const mensaje = fault.faultstring || fault.faultcode || JSON.stringify(fault);
    throw new Error(`LibRemote devolvio un SOAP Fault en ${operacion}: ${mensaje}`);
  }
  // La respuesta viene envuelta en <${operacion}Response>...</> -- ICG (RemObjects
  // SDK) la manda con prefijo propio (ej. NS1:), por eso la busqueda tambien
  // es por nombre local.
  const respuesta = buscarPorNombreLocal(body, `${operacion}Response`) ?? buscarPorNombreLocal(body, operacion);
  if (!respuesta) {
    throw new Error(`No se encontro el nodo de respuesta esperado para ${operacion}`);
  }
  return respuesta;
}

// Todo metodo de SvcRemote devuelve un campo "Result" (entero) ademas de los
// parametros propios -- 0 es exito; cualquier otro valor es un codigo de
// rechazo de ICG (credenciales, permisos, etc.), y puede venir SIN nada en
// ErrorMsg/sMsgError. Si solo se mira ErrorMsg, un Result!=0 con ErrorMsg
// vacio pasa como "exito" en silencio -- por eso se valida aparte.
export function resultDeRespuesta(respuesta) {
  const valor = respuesta?.Result;
  return valor === undefined || valor === null ? null : Number(valor);
}

// Llama una operacion de SvcRemote y devuelve el objeto de respuesta ya
// parseado de XML a JS (sin interpretar los campos binarios todavia -- eso
// lo hace cada funcion de mas alto nivel, que sabe cual campo decodificar).
// `baseUrlOverride` se usa solo desde probarCredenciales(), para validar una
// URL que todavia no se guardo como la activa.
async function invocarSoap(operacion, campos, { timeoutMs = 20000, baseUrlOverride = null } = {}) {
  const baseUrl = baseUrlOverride ?? getConfigActiva()?.baseUrl;
  if (!baseUrl) {
    throw new Error('LibRemote no esta configurado (Configuracion > LibRemote)');
  }
  const url = `${baseUrl.replace(/\/$/, '')}/SOAP?service=SvcRemote`;
  const envelope = armarEnvelope(operacion, campos);

  const resp = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'text/xml; charset=utf-8',
      SOAPAction: `"urn:LibRemote-SvcRemote#${operacion}"`,
    },
    body: envelope,
    signal: AbortSignal.timeout(timeoutMs),
  });

  const textoRespuesta = await resp.text();
  if (!resp.ok) {
    throw new Error(`LibRemote respondio HTTP ${resp.status} en ${operacion}: ${textoRespuesta.slice(0, 500)}`);
  }

  return parsearRespuestaSoap(textoRespuesta, operacion);
}

/** Convierte un campo de la respuesta SOAP (texto base64, posiblemente vacio) a Buffer. */
export function base64AbufferSeguro(valor) {
  if (!valor || typeof valor !== 'string') return Buffer.alloc(0);
  return Buffer.from(valor, 'base64');
}

// `credencialesOverride` + `baseUrlOverride` se usan solo desde
// probarCredenciales(), para validar datos que todavia no se guardaron.
export async function invocarInformesGetAlbVentaCabNoRecibidos({ credencialesOverride, baseUrlOverride, timeoutMs } = {}) {
  const { usuario, password } = credencialesOverride ?? getConfigActiva() ?? {};
  const campos = [
    ['Usuario', usuario, 'string'],
    ['Password', password, 'string'],
    // Data va vacio en el pedido: es un parametro InOut, el servidor lo llena
    // en la respuesta con el listado completo (ver nota en el postman de
    // referencia -- no hay confirmacion oficial de que espere un filtro aca).
    ['Data', '', 'base64Binary'],
    ['ErrorMsg', '', 'string'],
  ];
  const respuesta = await invocarSoap('Informes_GetAlbVentaCabNoRecibidos', campos, { baseUrlOverride, timeoutMs });
  const result = resultDeRespuesta(respuesta);
  // ErrorMsg puede venir vacio aunque Result no sea 0 (rechazo sin texto) --
  // sin este chequeo un rechazo asi pasaba como "exito" con lista vacia.
  const errorMsg = respuesta.ErrorMsg || (result !== null && result !== 0 ? `Result=${result} (sin mensaje de ICG)` : null);
  if (errorMsg) {
    log(`Informes_GetAlbVentaCabNoRecibidos devolvio error: ${errorMsg}`);
  }
  return { data: base64AbufferSeguro(respuesta.Data), errorMsg: errorMsg || null };
}

/**
 * Prueba credenciales/URL de LibRemote SIN guardarlas -- para el boton
 * "Probar conexión" de Configuracion > LibRemote. Reusa la consulta de
 * facturas pendientes (la mas liviana de las dos que tenemos) solo para
 * confirmar que el servidor responde y que el usuario/password son validos.
 */
export async function probarCredenciales({ baseUrl, usuario, password }) {
  if (!baseUrl || !usuario || !password) {
    return { ok: false, mensaje: 'Completá URL, usuario y contraseña.' };
  }
  try {
    const { errorMsg } = await invocarInformesGetAlbVentaCabNoRecibidos({
      credencialesOverride: { usuario, password },
      baseUrlOverride: baseUrl,
      timeoutMs: 10000,
    });
    if (errorMsg) {
      return { ok: false, mensaje: `El servidor respondió, pero rechazó las credenciales: ${errorMsg}` };
    }
    return { ok: true, mensaje: 'Conexión correcta.' };
  } catch (err) {
    return { ok: false, mensaje: describirErrorFetch(err) };
  }
}

export async function invocarDocumentoGetLineasAlbVentaU({ serie, numero, n }) {
  const { usuario, password } = getConfigActiva() ?? {};
  const campos = [
    ['sUsuario', usuario, 'string'],
    ['sPassword', password, 'string'],
    ['sSerie', serie, 'string'],
    ['iNumero', numero, 'int'],
    ['sN', n, 'string'],
    ['DataLineas', '', 'base64Binary'],
    ['bAlbaranFacturado', false, 'boolean'],
    ['AlbaranesFactura', '', 'base64Binary'],
    ['sCodFPFactura', '', 'string'],
    ['sSerieFac', '', 'string'],
    ['iNumFac', 0, 'int'],
    ['sNFac', '', 'string'],
    ['sMsgError', '', 'string'],
  ];
  const respuesta = await invocarSoap('Documento_GetLineasAlbVentaU', campos);
  const result = resultDeRespuesta(respuesta);
  const mensajeError = respuesta.sMsgError || (result !== null && result !== 0 ? `Result=${result} (sin mensaje de ICG)` : null);
  if (mensajeError) {
    logError(`Documento_GetLineasAlbVentaU (${serie}/${numero}/${n}) devolvio error: ${mensajeError}`);
  }
  return {
    dataLineas: base64AbufferSeguro(respuesta.DataLineas),
    facturado: String(respuesta.bAlbaranFacturado).trim() === 'true',
    mensajeError: mensajeError || null,
  };
}
