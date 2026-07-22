import { Router } from 'express';
import * as actualizadorService from '../services/actualizadorService.js';

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

  try {
    const commit = await actualizadorService.aplicarActualizacion();
    res.json({
      success: true,
      respuesta: `Actualizado a "${commit.mensaje}". Reiniciando...`,
      commit: commit.sha,
    });
    // El proceso se reinicia DESPUES de que la respuesta salio -- NSSM lo
    // vuelve a levantar solo (AppExit configurado en Restart), ya con el
    // codigo nuevo. Sin esto, seguiria corriendo la version vieja en memoria.
    setTimeout(() => process.exit(0), 500);
  } catch (err) {
    res.status(500).json({ success: false, respuesta: err.message || 'No se pudo actualizar' });
  }
});
