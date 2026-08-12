import { Router } from 'express';
import * as actualizadorService from '../services/actualizadorService.js';
import { log } from '../utils/logger.js';

export const actualizadorRouter = Router();

// Publico a proposito: solo informa la version actual, no hace falta clave
// para verla (igual que ver el numero de version de cualquier app).
actualizadorRouter.get('/actualizador/estado', async (req, res, next) => {
  try {
    res.json(await actualizadorService.obtenerEstado());
  } catch (err) {
    next(err);
  }
});

actualizadorRouter.post('/actualizador/actualizar', async (req, res) => {
  const { clave } = req.body || {};
  if (!actualizadorService.claveValida(clave)) {
    return res.status(401).json({ success: false, respuesta: 'Clave incorrecta' });
  }

  // Responder de inmediato antes de iniciar la actualizacion.
  // node --watch reinicia el proceso cuando detecta los archivos nuevos
  // copiados del ZIP -- si esperamos a que termine nunca hay tiempo de
  // responder. El cliente entra en polling (/_health) y espera a que el
  // servidor vuelva con el codigo nuevo.
  res.json({ success: true, respuesta: 'Actualización iniciada. El servidor se reiniciará en unos momentos…' });

  setTimeout(async () => {
    try {
      await actualizadorService.aplicarActualizacion();
      log('Actualizacion completada, reiniciando proceso...');
    } catch (err) {
      log(`Actualizacion fallida: ${err.message || err}`);
    }
    // Salir siempre: en exito carga el codigo nuevo; en fallo el staging
    // preservo el node_modules anterior y NSSM/--watch levanta el proceso
    // con la version que estaba funcionando.
    process.exit(0);
  }, 200);
});
