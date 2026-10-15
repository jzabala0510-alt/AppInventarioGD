// Valida el ciclo completo de una sesion de verificacion (crear -> escanear
// -> escanear algo que no pertenece -> cerrar -> contenido del StockMov.txt)
// con lineas de factura SINTETICAS (no depende de LibRemote real).
//
// Uso: node test-fixtures/telestock/validar_sesion.js   (desde BackendInventario/)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as sesionService from '../../src/services/telestockSesionService.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

let fallas = 0;
function check(etiqueta, cond) {
  if (!cond) { fallas++; console.log(`FALLA: ${etiqueta}`); } else { console.log(`OK: ${etiqueta}`); }
}
async function checkRechazo(etiqueta, promesa, statusEsperado) {
  try {
    await promesa;
    fallas++; console.log(`FALLA: ${etiqueta} (no rechazo, deberia haber tirado error)`);
  } catch (err) {
    check(`${etiqueta} (status ${err.status})`, err.status === statusEsperado);
  }
}

const lineasFactura = [
  { codigoArticulo: 100, codigoBarras: '8890000000001', talla: 'M', color: 'AZUL', cantidad: 3, descripcion: 'CAMISA AZUL M', fecha: '2026-09-11' },
  { codigoArticulo: 100, codigoBarras: '8890000000002', talla: 'L', color: 'AZUL', cantidad: 2, descripcion: 'CAMISA AZUL L', fecha: '2026-09-11' },
  { codigoArticulo: 200, codigoBarras: '8890000000003', talla: '.', color: '.', cantidad: 5, descripcion: 'GORRA', fecha: '2026-09-11' },
];

const sesion = await sesionService.crearSesion({ serie: 'ZZVA', numero: 236, n: 'B', facturado: false, lineas: lineasFactura });
check('sesion creada con idSesion', typeof sesion.idSesion === 'string' && sesion.idSesion.length > 0);
check('sesion arranca sin cerrar', sesion.cerradaEn === null);

// Escanear dos veces la talla M (2 unidades) y una vez la gorra (1 unidad)
await sesionService.registrarEscaneo(sesion.idSesion, { codigoBarras: '8890000000001' });
const r2 = await sesionService.registrarEscaneo(sesion.idSesion, { codigoBarras: '8890000000001' });
check('talla M acumula 2 unidades', r2.unidadesContadas === 2);
check('unidadesFacturadas expuesta (3)', r2.unidadesFacturadas === 3);
await sesionService.registrarEscaneo(sesion.idSesion, { codigoBarras: '8890000000003' });

// Codigo que NO pertenece a la factura -> debe rechazar con 422
await checkRechazo(
  'escaneo de codigo ajeno a la factura',
  sesionService.registrarEscaneo(sesion.idSesion, { codigoBarras: '9999999999999' }),
  422,
);

// Cerrar y verificar el archivo generado
const { contenido, nombreArchivo, rutaArchivo, sesion: sesionCerrada } = await sesionService.cerrarSesion(sesion.idSesion);
check('sesion queda marcada cerrada', sesionCerrada.cerradaEn !== null);
check('nombreArchivo (descarga) tambien es exactamente StockMov.txt', nombreArchivo === 'StockMov.txt');
check(
  'rutaArchivo real sigue TeleStock/StockMov-<fecha>/<serie>-<numero>/StockMov.txt',
  rutaArchivo.endsWith(path.join('StockMov-2026-09-11', 'ZZVA-236', 'StockMov.txt')),
);
check('el archivo real se llama exactamente StockMov.txt (requisito de ICG)', path.basename(rutaArchivo) === 'StockMov.txt');

console.log('--- contenido StockMov.txt generado ---');
console.log(contenido);
console.log('--- fin contenido ---');

const filas = contenido.trim().split('\r\n');
check('2 filas en el archivo (talla M y gorra, no la L que no se escaneo)', filas.length === 2);
check('fila talla M: "1|100|M|AZUL|2|0|0|0|8890000000001|"', filas.includes('1|100|M|AZUL|2|0|0|0|8890000000001|'));
check('fila gorra: "1|200|.|.|1|0|0|0|8890000000003|"', filas.includes('1|200|.|.|1|0|0|0|8890000000003|'));

// Reintentar escanear/cerrar una sesion ya cerrada -> 409
await checkRechazo('escanear sesion ya cerrada', sesionService.registrarEscaneo(sesion.idSesion, { codigoBarras: '8890000000001' }), 409);
await checkRechazo('cerrar sesion ya cerrada', sesionService.cerrarSesion(sesion.idSesion), 409);

// Reabrir -> escanear la talla L (que faltaba) -> cerrar de nuevo: el
// StockMov.txt tiene que quedar con las 3 filas (M, L y gorra), no solo con
// lo que se conto en la primera ronda.
const reabierta = await sesionService.reabrirSesion(sesion.idSesion);
check('sesion reabierta queda sin cerradaEn', reabierta.cerradaEn === null);
check('sesion reabierta conserva el conteo previo (M=2, gorra=1)', Object.keys(reabierta.conteo).length === 2);

// Reabrir una sesion que YA esta abierta (no cerrada) -> 409
await checkRechazo('reabrir sesion que ya esta abierta', sesionService.reabrirSesion(sesion.idSesion), 409);
await sesionService.registrarEscaneo(sesion.idSesion, { codigoBarras: '8890000000002' }); // talla L
const { contenido: contenido2, rutaArchivo: rutaArchivo2 } = await sesionService.cerrarSesion(sesion.idSesion);
const filas2 = contenido2.trim().split('\r\n');
check('tras reabrir+recerrar, el StockMov.txt tiene las 3 filas (M, L y gorra)', filas2.length === 3);
check('fila talla L agregada en la segunda ronda: "1|100|L|AZUL|1|0|0|0|8890000000002|"', filas2.includes('1|100|L|AZUL|1|0|0|0|8890000000002|'));
check('el StockMov.txt se sobreescribio en la misma ruta (no genero un archivo nuevo)', rutaArchivo2 === rutaArchivo);

// listarSesiones: la sesion de esta factura tiene que aparecer, ya cerrada,
// con los totales actualizados (3 contadas de 5 facturadas: M no completa, L completa, gorra completa)
const listado = await sesionService.listarSesiones();
const enListado = listado.find((s) => s.idSesion === sesion.idSesion);
check('la sesion aparece en listarSesiones', Boolean(enListado));
check('listarSesiones la muestra cerrada', enListado?.cerradaEn !== null);
check('listarSesiones trae los totales correctos (contado=4, facturado=3+2+5=10)', enListado?.totales.contado === 4 && enListado?.totales.facturado === 10);

// No se puede reabrir una sesion inexistente -> 404 (obtenerSesion adentro tira eso)
await checkRechazo('reabrir sesion inexistente', sesionService.reabrirSesion('00000000-0000-0000-0000-000000000000'), 404);

// Sesion inexistente -> 404
await checkRechazo('sesion inexistente', sesionService.obtenerSesion('00000000-0000-0000-0000-000000000000'), 404);

// Segunda factura, MISMA fecha -> debe caer en la misma carpeta StockMov-<fecha>,
// en su propia subcarpeta serie-numero (no pisa el StockMov.txt de la primera).
const sesion2 = await sesionService.crearSesion({
  serie: 'ZZVB', numero: 500, n: 'B', facturado: false,
  lineas: [{ codigoArticulo: 300, codigoBarras: '8890000000009', talla: '.', color: '.', cantidad: 1, descripcion: 'OTRO', fecha: '2026-09-11' }],
});
await sesionService.registrarEscaneo(sesion2.idSesion, { codigoBarras: '8890000000009' });
const { rutaArchivo: ruta2 } = await sesionService.cerrarSesion(sesion2.idSesion);
check(
  'segunda factura (misma fecha, otra serie/numero) cae bajo la misma carpeta StockMov-2026-09-11',
  ruta2.includes(path.join('StockMov-2026-09-11', 'ZZVB-500', 'StockMov.txt')),
);
check('el StockMov.txt de la primera factura sigue existiendo (no se pisaron)', fs.existsSync(rutaArchivo));
fs.rmSync(path.join(sesionService.DIR_SESIONES, `${sesion2.idSesion}.json`), { force: true });

// Limpieza: borra el archivo de sesion y toda la carpeta StockMov-<fecha> generada por este test
fs.rmSync(path.join(sesionService.DIR_SESIONES, `${sesion.idSesion}.json`), { force: true });
fs.rmSync(path.join(sesionService.DIR_TELESTOCK, 'StockMov-2026-09-11'), { recursive: true, force: true });

console.log('');
if (fallas === 0) console.log('TODO OK -- ciclo completo de sesion + generacion de StockMov.txt funciona.');
else { console.log(`${fallas} verificacion(es) fallaron.`); process.exit(1); }
