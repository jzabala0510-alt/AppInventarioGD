// Valida el ciclo de configStore: guardar, releer (simulando un reinicio del
// proceso via re-import con cache-busting), y que dejar la password vacia
// conserva la anterior.
// Uso: node test-fixtures/libRemote/validar_config.js   (desde BackendInventario/)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ARCHIVO_CONFIG = path.join(__dirname, '../../data/libRemoteConfig.json');
const yaExistia = fs.existsSync(ARCHIVO_CONFIG);
const respaldo = yaExistia ? fs.readFileSync(ARCHIVO_CONFIG, 'utf-8') : null;

let fallas = 0;
function check(etiqueta, cond) {
  if (!cond) { fallas++; console.log(`FALLA: ${etiqueta}`); } else { console.log(`OK: ${etiqueta}`); }
}

try {
  const store1 = await import('../../src/services/libRemote/configStore.js');
  store1.actualizarConfig({ baseUrl: 'https://icg.ejemplo.com:8443', usuario: 'demo', password: 'Secreta123' });
  check('getConfigActiva devuelve lo guardado', store1.getConfigActiva().password === 'Secreta123');
  check('archivo en disco NO tiene la password en texto plano', !fs.readFileSync(ARCHIVO_CONFIG, 'utf-8').includes('Secreta123'));

  // Simular un reinicio: re-importar el modulo con un query param para
  // saltar el cache de ESM y forzar que vuelva a leer el archivo de disco.
  const store2 = await import(`../../src/services/libRemote/configStore.js?reload=${Date.now()}`);
  check('tras "reiniciar", relee la password correcta del disco', store2.getConfigActiva().password === 'Secreta123');

  // Password vacio en actualizarConfig -> conserva la anterior
  store2.actualizarConfig({ baseUrl: 'https://icg.ejemplo.com:8443', usuario: 'demo2', password: '' });
  check('password vacio conserva la anterior', store2.getConfigActiva().password === 'Secreta123');
  check('usuario si se actualiza', store2.getConfigActiva().usuario === 'demo2');
  check('configurado() da true con todo presente', store2.configurado() === true);
} finally {
  // Restaurar el archivo tal como estaba (o borrarlo si no existia) para no
  // dejar basura de prueba.
  if (yaExistia) fs.writeFileSync(ARCHIVO_CONFIG, respaldo);
  else fs.rmSync(ARCHIVO_CONFIG, { force: true });
}

console.log('');
if (fallas === 0) console.log('TODO OK -- configStore persiste y relee correctamente.');
else { console.log(`${fallas} verificacion(es) fallaron.`); process.exit(1); }
