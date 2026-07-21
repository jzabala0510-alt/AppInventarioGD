import { app } from './app.js';
import { config } from './config/env.js';
import { log } from './utils/logger.js';

// Ya NO se prueba la conexion a la BD antes de escuchar: si la base de datos
// no esta configurada o no es alcanzable (instalacion nueva, tienda que se
// muda de servidor), el backend debe arrancar igual para que la pantalla
// Configuracion > Base de datos sea alcanzable y pueda arreglarlo. Las rutas
// que si necesitan la BD fallan individualmente al llamarse (via getPool()).
app.listen(config.port, () => {
  log(`Backend Inventario escuchando en http://localhost:${config.port}${config.basePath}`);
});
