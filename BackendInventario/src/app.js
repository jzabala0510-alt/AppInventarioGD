import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import cors from 'cors';
import compression from 'compression';
import helmet from 'helmet';
import { config } from './config/env.js';
import { router } from './routes/index.js';
import { errorHandler, notFoundHandler } from './middleware/errorHandler.js';
import { requestLogger } from './middleware/requestLogger.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// El frontend compilado (InventarioWebVue/dist) se sirve desde este mismo
// proceso -- un solo servicio NSSM que actualizar y reiniciar, en vez de dos.
const FRONTEND_DIST = path.join(__dirname, '../../InventarioWebVue/dist');

export const app = express();

// contentSecurityPolicy desactivado: el frontend carga Fira Sans/Fira Code
// desde fonts.googleapis.com, y el CSP por defecto de helmet lo bloquearia.
// Herramienta interna de solo LAN, no expuesta a internet.
app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors());
app.use(compression());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
// A diferencia de console.log, esto tambien queda en logs/backend.log --
// corriendo como servicio NSSM no hay terminal donde ver console.log.
app.use(requestLogger);

// El APK se sirve fuera del basePath, en la misma ruta relativa que el
// original (http://ip:puerto/descargas/docs/...), sin el prefijo
// /Reposiciones/recursos -- asi lo arma el campo "url" que devuelve getApk.
app.use('/descargas/docs', express.static(path.join(__dirname, 'static', 'descargas')));

// Mismo base path que el backend Java (@ApplicationPath("recursos")), para que
// el frontend React actual no tenga que cambiar ninguna URL.
app.use(config.basePath, router);

// Frontend Vue compilado -- assets primero, y cualquier ruta no reconocida
// (que no sea de la API ni de /descargas) cae al index.html para que Vue
// Router maneje sus propias rutas (login, inicio, configuracion, etc.).
app.use(express.static(FRONTEND_DIST));
app.get('*', (req, res, next) => {
  if (req.path.startsWith(config.basePath) || req.path.startsWith('/descargas')) {
    return next();
  }
  res.sendFile(path.join(FRONTEND_DIST, 'index.html'));
});

app.use(notFoundHandler);
app.use(errorHandler);
