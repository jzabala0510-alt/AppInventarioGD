import QRCode from 'qrcode';

// El original genera un PNG en disco (..\docroot\descargas\images\apk.png) y
// devuelve una URL apuntando a ese archivo estatico. Aca se simplifica a un
// data URI generado en memoria -- el <img src=...> del frontend acepta ambos
// por igual, y asi no hay que gestionar un archivo generado dinamicamente.
export async function obtenerApk(baseUrl) {
  const url = `${baseUrl}/descargas/`;
  const qr = await QRCode.toDataURL(url);
  return { url, qr, urlWS: baseUrl };
}
