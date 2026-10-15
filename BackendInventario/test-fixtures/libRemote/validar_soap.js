// Valida parsearRespuestaSoap con un envelope SOAP SINTETICO (no pega a
// ningun servidor real -- no tenemos credenciales todavia). Embebe la
// muestra real de lineas (LINEAS.txt) como si fuera la respuesta del
// servidor, para probar el camino completo: XML -> extraer campo -> base64
// -> decodificar ClientDataSet -> valores esperados.
//
// Uso: node test-fixtures/libRemote/validar_soap.js   (desde BackendInventario/)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parsearRespuestaSoap, base64AbufferSeguro } from '../../src/services/libRemote/soapClient.js';
import { decodificarLineasAlbaran } from '../../src/services/libRemote/clientDataSetDecoder.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// LINEAS.txt es una muestra real y NO se versiona (ver .gitignore y validar.js).
if (!fs.existsSync(path.join(__dirname, 'LINEAS.txt'))) {
  console.log('OMITIDO: falta la muestra real LINEAS.txt (no se sube al repo)');
  process.exit(0);
}
const lineasB64 = fs.readFileSync(path.join(__dirname, 'LINEAS.txt'), 'utf-8').replace(/\s+/g, '');

// Envelope sintetico, mismo shape documentado en el postman de referencia
// para Documento_GetLineasAlbVentaU (RPC/Encoded, response con los mismos
// nombres de parametro que el request, InOut ya "resueltos").
const envelopeRespuestaOk = `<?xml version="1.0" encoding="UTF-8"?>
<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">
   <soap:Body>
      <Documento_GetLineasAlbVentaUResponse xmlns="urn:LibRemote-SvcRemote">
         <sUsuario>demo</sUsuario>
         <sSerie>ZZVA</sSerie>
         <iNumero>236</iNumero>
         <sN>B</sN>
         <DataLineas>${lineasB64}</DataLineas>
         <bAlbaranFacturado>false</bAlbaranFacturado>
         <AlbaranesFactura></AlbaranesFactura>
         <sMsgError></sMsgError>
      </Documento_GetLineasAlbVentaUResponse>
   </soap:Body>
</soap:Envelope>`;

const envelopeConFault = `<?xml version="1.0" encoding="UTF-8"?>
<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">
   <soap:Body>
      <soap:Fault>
         <faultcode>soap:Server</faultcode>
         <faultstring>Usuario o password incorrectos</faultstring>
      </soap:Fault>
   </soap:Body>
</soap:Envelope>`;

let fallas = 0;
function check(etiqueta, cond) {
  if (!cond) { fallas++; console.log(`FALLA: ${etiqueta}`); } else { console.log(`OK: ${etiqueta}`); }
}

// --- Respuesta exitosa ---
const respuesta = parsearRespuestaSoap(envelopeRespuestaOk, 'Documento_GetLineasAlbVentaU');
check('sSerie extraido', respuesta.sSerie === 'ZZVA');
check('iNumero extraido', Number(respuesta.iNumero) === 236);
const buffer = base64AbufferSeguro(respuesta.DataLineas);
check('DataLineas decodificado a Buffer no vacio', buffer.length > 1000);
const lineas = decodificarLineasAlbaran(buffer);
check('lineas.length === 275', lineas.length === 275);
check('primera linea codigoArticulo === 10343', lineas[0].codigoArticulo === 10343);

// --- SOAP Fault ---
let faultCapturado = null;
try {
  parsearRespuestaSoap(envelopeConFault, 'Documento_GetLineasAlbVentaU');
} catch (err) {
  faultCapturado = err;
}
check('SOAP Fault se convierte en excepcion con el mensaje', faultCapturado?.message.includes('Usuario o password incorrectos'));

console.log('');
if (fallas === 0) console.log('TODO OK -- parseo de respuesta SOAP + decoder end-to-end funciona.');
else { console.log(`${fallas} verificacion(es) fallaron.`); process.exit(1); }
