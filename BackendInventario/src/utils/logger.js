import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ARCHIVO_LOG = path.join(__dirname, '../../logs/backend.log');

fs.mkdirSync(path.dirname(ARCHIVO_LOG), { recursive: true });

// Log a archivo ademas de consola: corriendo como servicio NSSM no hay
// terminal donde mirar console.log, asi que esto es la unica forma real de
// ver que esta pasando despues del hecho.
export function log(mensaje) {
  const linea = `[${new Date().toISOString()}] ${mensaje}`;
  console.log(linea);
  fs.appendFile(ARCHIVO_LOG, linea + '\n', () => {});
}

export function logError(mensaje) {
  const linea = `[${new Date().toISOString()}] [error] ${mensaje}`;
  console.error(linea);
  fs.appendFile(ARCHIVO_LOG, linea + '\n', () => {});
}
