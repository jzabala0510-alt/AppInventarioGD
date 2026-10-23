import { app } from './app.js';
import { config } from './config/env.js';
import { log } from './utils/logger.js';
import { ejecutarScriptAlArranque } from './services/sqlConfigService.js';
import { liberarEnviosColgados } from './services/conteoBatchService.js';

// Ya NO se prueba la conexion a la BD antes de escuchar: si la base de datos
// no esta configurada o no es alcanzable (instalacion nueva, tienda que se
// muda de servidor), el backend debe arrancar igual para que la pantalla
// Configuracion > Base de datos sea alcanzable y pueda arreglarlo. Las rutas
// que si necesitan la BD fallan individualmente al llamarse (via getPool()).
app.listen(config.port, () => {
  log(`Backend Inventario escuchando en http://localhost:${config.port}${config.basePath}`);

  // Ejecutar el script de estructura al arranque. No bloquea el inicio: si no
  // hay BD o falla la conexion, se reintenta solo en segundo plano hasta
  // lograrlo (ver ejecutarScriptAlArranque).
  ejecutarScriptAlArranque();

  // Aparte (no depende de que el script salga bien): liberar los envios que
  // quedaron marcados "procesando" si el servicio se detuvo en medio de uno.
  liberarEnviosAlArranque();
});

// Si no, el celular recibiria "El identificador se esta procesando en otro
// hilo" en cada reintento. Se reintenta mientras la BD no responda (o, en una
// instalacion nueva, mientras rip.CONTEO_ENVIOS no exista: ahi no hay nada trabado).
async function liberarEnviosAlArranque() {
  let ultimoError = null;
  for (const espera of [0, 5000, 15000, 30000, 60000, 120000, 300000]) {
    await new Promise((resolver) => setTimeout(resolver, espera));
    try {
      const n = await liberarEnviosColgados();
      if (n > 0) log(`Envios de conteo trabados liberados al arrancar: ${n}`);
      return;
    } catch (err) {
      ultimoError = err.message;
    }
  }
  log(`No se pudieron liberar los envios de conteo trabados al arrancar: ${ultimoError}`);
}
