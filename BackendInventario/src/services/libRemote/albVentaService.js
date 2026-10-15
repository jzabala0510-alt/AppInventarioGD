// Funciones de alto nivel para la pantalla de verificacion de conteo contra
// factura: listar facturas de venta pendientes y traer las lineas de una en
// particular, combinando el cliente SOAP con el decoder del binario.
import {
  libRemoteConfigurado,
  invocarInformesGetAlbVentaCabNoRecibidos,
  invocarDocumentoGetLineasAlbVentaU,
} from './soapClient.js';
import { decodificarCabecerasAlbaranVenta, decodificarLineasAlbaran } from './clientDataSetDecoder.js';

export { libRemoteConfigurado };

/**
 * Lista las facturas de venta pendientes de recepcion (panel de seleccion).
 * Devuelve un array de cabeceras ya decodificadas.
 */
export async function listarFacturasPendientes() {
  const { data, errorMsg } = await invocarInformesGetAlbVentaCabNoRecibidos();
  if (errorMsg) {
    throw new Error(`LibRemote rechazo la consulta de facturas pendientes: ${errorMsg}`);
  }
  if (data.length === 0) {
    return [];
  }
  return decodificarCabecerasAlbaranVenta(data);
}

/**
 * Trae las lineas de una factura puntual para verificar el conteo contra
 * ella. serie/numero/n identifican el albaran (mismos valores que aparecen
 * en el listado de listarFacturasPendientes).
 */
export async function obtenerLineasFactura({ serie, numero, n }) {
  if (!serie || numero === undefined || numero === null) {
    const err = new Error('serie y numero son obligatorios');
    err.status = 400;
    throw err;
  }
  const { dataLineas, facturado, mensajeError } = await invocarDocumentoGetLineasAlbVentaU({
    serie,
    numero: Number(numero),
    n: n ?? '',
  });
  if (mensajeError) {
    throw new Error(`LibRemote rechazo la consulta de lineas: ${mensajeError}`);
  }
  const lineas = dataLineas.length === 0 ? [] : decodificarLineasAlbaran(dataLineas);
  return { serie, numero: Number(numero), n: n ?? '', facturado, lineas };
}
