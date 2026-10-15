// Configuracion de LibRemote editable desde la app (Configuracion > LibRemote),
// igual patron que sqlConfigService/db/pool.js para la conexion de base de
// datos: arranca desde el .env (si esta) y desde ahi en adelante lo que
// quede guardado en data/ (protegido del Actualizador) manda. La contrasena
// nunca se persiste en texto plano.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { encriptar, desEncriptar } from '../../utils/normalkeyConexion.js';
import { config } from '../../config/env.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ARCHIVO_CONFIG = path.join(__dirname, '../../../data/libRemoteConfig.json');

function leerConfigGuardada() {
  try {
    const datos = JSON.parse(fs.readFileSync(ARCHIVO_CONFIG, 'utf-8'));
    return { baseUrl: datos.baseUrl, usuario: datos.usuario, password: desEncriptar(datos.password || '') };
  } catch {
    return null;
  }
}

let estadoActivo = leerConfigGuardada() ?? (config.libRemote.baseUrl ? { ...config.libRemote } : null);

export function getConfigActiva() {
  return estadoActivo ? { ...estadoActivo } : null;
}

export function configurado() {
  return Boolean(estadoActivo?.baseUrl && estadoActivo?.usuario && estadoActivo?.password);
}

function persistir() {
  fs.mkdirSync(path.dirname(ARCHIVO_CONFIG), { recursive: true });
  fs.writeFileSync(
    ARCHIVO_CONFIG,
    JSON.stringify(
      { baseUrl: estadoActivo.baseUrl, usuario: estadoActivo.usuario, password: encriptar(estadoActivo.password) },
      null,
      2,
    ),
  );
}

/**
 * Guarda la nueva configuracion activa. `password` vacio conserva la
 * contrasena ya guardada (para no forzar a retipearla cada vez que se
 * cambia la URL o el usuario nomas).
 */
export function actualizarConfig({ baseUrl, usuario, password }) {
  estadoActivo = {
    baseUrl,
    usuario,
    password: password || estadoActivo?.password || '',
  };
  persistir();
  return getConfigActiva();
}
