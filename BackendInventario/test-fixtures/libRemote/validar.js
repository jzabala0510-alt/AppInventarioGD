// Script de validacion manual (no es parte de la suite de la app): decodifica
// las muestras LINEAS.txt / PENDIENTES.txt y compara contra los valores ya
// confirmados con el prototipo en Python, para verificar que el puerto a
// Node.js es fiel antes de conectarlo al backend real.
//
// Uso: node test-fixtures/libRemote/validar.js   (desde BackendInventario/)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { decodificarLineasAlbaran, decodificarCabecerasAlbaranVenta } from '../../src/services/libRemote/clientDataSetDecoder.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Las muestras son datos reales de facturas/clientes y NO se versionan (ver
// .gitignore, el repo es publico) -- solo existen en la copia local de quien
// las capturo. Sin ellas no hay nada que validar.
const MUESTRAS = ['LINEAS.txt', 'PENDIENTES.txt', 'factura_cargo_administrativo_ZZVC346.bin'];
const faltantes = MUESTRAS.filter((m) => !fs.existsSync(path.join(__dirname, m)));
if (faltantes.length) {
  console.log(`OMITIDO: faltan muestras reales de LibRemote (no se suben al repo): ${faltantes.join(', ')}`);
  process.exit(0);
}

function leerBase64ComoBuffer(nombreArchivo) {
  const texto = fs.readFileSync(path.join(__dirname, nombreArchivo), 'utf-8').replace(/\s+/g, '');
  return Buffer.from(texto, 'base64');
}

let fallas = 0;
function assertIgual(etiqueta, real, esperado) {
  const ok = JSON.stringify(real) === JSON.stringify(esperado);
  if (!ok) {
    fallas++;
    console.log(`FALLA: ${etiqueta}\n  esperado: ${JSON.stringify(esperado)}\n  obtenido: ${JSON.stringify(real)}`);
  } else {
    console.log(`OK: ${etiqueta}`);
  }
}

// --- Lineas de albaran ---
console.log('=== decodificarLineasAlbaran (LINEAS.txt) ===');
const buf = leerBase64ComoBuffer('LINEAS.txt');
const lineas = decodificarLineasAlbaran(buf);
console.log(`Total lineas: ${lineas.length}`);
console.log('Primera linea:', lineas[0]);
console.log('Ultima linea:', lineas[lineas.length - 1]);
// numeroLinea debe salir correlativo 1..N sin huecos (mismo chequeo que el script Python)
const numerosLinea = lineas.map((l) => l.numeroLinea);
const correlativo = numerosLinea.every((n, i) => n === i + 1);
assertIgual('numeroLinea correlativo 1..N', correlativo, true);

// --- Linea sin codigo de barras real (cargo administrativo, factura real
// ZZVC/346) -- caso que rompia el decoder anterior (basado en anclar por
// "889...", que esta linea no tiene). Confirma que el decoder actual (basado
// en el bloque de esquema, no en el contenido) no depende de eso.
console.log('');
console.log('=== decodificarLineasAlbaran (factura_cargo_administrativo_ZZVC346.bin) ===');
const bufCargo = fs.readFileSync(path.join(__dirname, 'factura_cargo_administrativo_ZZVC346.bin'));
const lineasCargo = decodificarLineasAlbaran(bufCargo);
assertIgual('1 linea (cargo administrativo, sin codigo de barras real)', lineasCargo.length, 1);
assertIgual('datos de la linea', {
  codigoArticulo: lineasCargo[0]?.codigoArticulo,
  codigoBarras: lineasCargo[0]?.codigoBarras,
  descripcion: lineasCargo[0]?.descripcion,
}, { codigoArticulo: 7529, codigoBarras: '0000000022453', descripcion: 'COBRO DE  LICENCIAS ADICIONAL GWORKS PAC' });

// --- Cabeceras de albaranes de venta pendientes ---
console.log('');
console.log('=== decodificarCabecerasAlbaranVenta (PENDIENTES.txt) ===');
const buf2 = leerBase64ComoBuffer('PENDIENTES.txt');
const cabeceras = decodificarCabecerasAlbaranVenta(buf2);
assertIgual('total cabeceras', cabeceras.length, 70);
assertIgual('registro 0', {
  serie: cabeceras[0].serie, numero: cabeceras[0].numero,
  nombre: cabeceras[0].nombreClienteProveedor.startsWith('WORLD BRANDS INTERNATIONALS'), bruto: +cabeceras[0].bruto.toFixed(2),
}, { serie: 'ZZVA', numero: 236, nombre: true, bruto: 13220.00 });
assertIgual('registro 69 (ultimo)', {
  serie: cabeceras[69].serie, numero: cabeceras[69].numero, bruto: +cabeceras[69].bruto.toFixed(2),
}, { serie: 'ZZVO', numero: 240, bruto: -960.27 });

console.log('');
if (fallas === 0) {
  console.log('TODO OK -- el puerto a Node.js reproduce los valores ya confirmados.');
} else {
  console.log(`${fallas} verificacion(es) fallaron.`);
  process.exit(1);
}
