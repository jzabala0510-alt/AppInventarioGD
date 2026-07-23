import path from 'node:path';
import fsp from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import express from 'express';
import cors from 'cors';
import compression from 'compression';
import helmet from 'helmet';
import { config } from './config/env.js';
import { router } from './routes/index.js';
import { errorHandler, notFoundHandler } from './middleware/errorHandler.js';
import { requestLogger } from './middleware/requestLogger.js';
import { obtenerIpLocal } from './utils/redLocal.js';

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

// Archivos APK servidos como estaticos en /descargas/docs/
const DIR_DESCARGAS = path.join(__dirname, 'static', 'descargas');
app.use('/descargas/docs', express.static(DIR_DESCARGAS));

// Lista de APKs disponibles en la carpeta (para la pagina de seleccion)
app.get('/descargas/lista', async (req, res) => {
  try {
    const baseUrl = `${req.protocol}://${obtenerIpLocal()}:${config.port}`;
    const archivos = await fsp.readdir(DIR_DESCARGAS);
    const apks = archivos
      .filter((f) => f.toLowerCase().endsWith('.apk'))
      .map((f) => ({ nombre: f.replace(/\.apk$/i, ''), url: `${baseUrl}/descargas/docs/${encodeURIComponent(f)}` }));
    res.json(apks);
  } catch {
    res.json([]);
  }
});

// Pagina HTML de seleccion -- el QR apunta aqui en vez de al APK directo
const PAGINA_DESCARGAS = `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Descargas — redes ip</title>
<style>
  *{box-sizing:border-box;margin:0;padding:0}
  body{font-family:system-ui,sans-serif;background:#1a1f1a;color:#e8ede8;min-height:100vh;display:flex;align-items:center;justify-content:center;padding:1.5rem}
  .card{background:#242b24;border-radius:16px;padding:2rem 1.75rem;width:min(360px,100%);display:flex;flex-direction:column;align-items:center;gap:1.5rem;box-shadow:0 8px 32px rgba(0,0,0,.4)}
  .marca{font-size:22px;font-weight:700;letter-spacing:.5px;color:#8ab562}
  .marca span{color:#c5d9a8;font-weight:400}
  h1{font-size:17px;font-weight:600;text-align:center;color:#c5d9a8}
  p{font-size:13px;color:#8a9e8a;text-align:center}
  #lista{width:100%;display:flex;flex-direction:column;gap:.75rem}
  .btn-apk{display:block;width:100%;padding:14px 16px;background:#4a6e28;color:#fff;border-radius:10px;text-decoration:none;font-size:15px;font-weight:600;text-align:center;transition:background .15s}
  .btn-apk:active{background:#3a5620}
  .sub{font-size:12px;color:#5a7a5a}
  .spinner{width:28px;height:28px;border:3px solid #3a4e3a;border-top-color:#8ab562;border-radius:50%;animation:spin .8s linear infinite;margin:0 auto}
  @keyframes spin{to{transform:rotate(360deg)}}
</style>
</head>
<body>
<div class="card">
  <div class="marca">redes <span>ip</span></div>
  <div>
    <h1>App de Inventario</h1>
    <p style="margin-top:.5rem">Selecciona la versión a instalar</p>
  </div>
  <div id="lista"><div class="spinner"></div></div>
  <p class="sub">Requiere Android 5.0 o superior</p>
</div>
<script>
fetch('/descargas/lista')
  .then(r=>r.json())
  .then(apks=>{
    const el=document.getElementById('lista');
    if(!apks.length){el.innerHTML='<p>No hay APKs disponibles.</p>';return;}
    el.innerHTML=apks.map(a=>\`<a class="btn-apk" href="\${a.url}">\${a.nombre}</a>\`).join('');
  })
  .catch(()=>{document.getElementById('lista').innerHTML='<p>Error al cargar la lista.</p>';});
</script>
</body>
</html>`;

app.get('/descargas', (req, res) => res.send(PAGINA_DESCARGAS));
app.get('/descargas/', (req, res) => res.send(PAGINA_DESCARGAS));

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
