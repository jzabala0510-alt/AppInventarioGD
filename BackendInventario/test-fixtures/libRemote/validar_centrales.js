// Valida construirBaseUrl() (centralesService.js): arma la URL de LibRemote a
// partir de la fila IDCENTRAL = 1 de ICGFRONT.dbo.CENTRALES. No necesita BD.
//
// Uso: node test-fixtures/libRemote/validar_centrales.js  (desde BackendInventario/)
process.env.JWT_SECRET_BASE64 ||= 'cHJ1ZWJh'; // config/env.js lo exige al importar; aca no se usa
const { construirBaseUrl, construirUrlSinPuerto, puertoValido } = await import('../../src/services/libRemote/centralesService.js');

let fallas = 0;
function check(etiqueta, cond) {
  if (!cond) { fallas++; console.log(`FALLA: ${etiqueta}`); } else { console.log(`OK: ${etiqueta}`); }
}
function lanza(fn) {
  try { fn(); return null; } catch (err) { return err; }
}

check('http cuando MODOHTTPS = 0', construirBaseUrl({ ip: '192.0.2.10', puerto: 9999, modoHttps: 0 }) === 'http://192.0.2.10:9999');
check('https cuando MODOHTTPS = 1', construirBaseUrl({ ip: 'icg.ejemplo.com', puerto: 8443, modoHttps: 1 }) === 'https://icg.ejemplo.com:8443');
check('recorta espacios de la IP (nvarchar con relleno)', construirBaseUrl({ ip: ' 192.0.2.10  ', puerto: 9999, modoHttps: null }) === 'http://192.0.2.10:9999');

// Visto en una BD real de prueba: PUERTO = 94000, que no es un puerto TCP.
const errPuerto = lanza(() => construirBaseUrl({ ip: '192.0.2.20', puerto: 94000, modoHttps: 0 }));
check('puerto > 65535 se rechaza con 422 y mensaje claro', errPuerto?.status === 422 && /94000/.test(errPuerto.message));
check('puerto 0 se rechaza', lanza(() => construirBaseUrl({ ip: 'x', puerto: 0, modoHttps: 0 }))?.status === 422);
check('IP vacia se rechaza', lanza(() => construirBaseUrl({ ip: '', puerto: 9999, modoHttps: 0 }))?.status === 422);

// Con el puerto invalido se carga igual la IP en el formulario: "http://ip:" para
// que solo haya que escribir el puerto.
check('puertoValido: 94000 no, 9999 si', !puertoValido(94000) && puertoValido(9999) && !puertoValido(null) && !puertoValido('9.5'));
check('URL sin puerto para el formulario', construirUrlSinPuerto({ ip: ' 192.0.2.20 ', modoHttps: 0 }) === 'http://192.0.2.20:');
check('URL sin puerto respeta https', construirUrlSinPuerto({ ip: 'icg.ejemplo.com', modoHttps: 1 }) === 'https://icg.ejemplo.com:');
check('URL sin puerto sin IP se rechaza', lanza(() => construirUrlSinPuerto({ ip: '', modoHttps: 0 }))?.status === 422);

console.log(fallas ? `\n${fallas} falla(s)` : '\nTODO OK -- construirBaseUrl arma bien la URL desde CENTRALES.');
process.exit(fallas ? 1 : 0);
