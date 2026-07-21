import { Router } from 'express';
import { listarMarcas } from '../services/marcasService.js';

export const marcasRouter = Router();

// GET /recursos/marcas
// El backend Java gzipeaba esto a mano con un header propio; aca lo dejamos como
// JSON normal y que compression() (ya montado en app.js) haga el gzip transparente
// a nivel HTTP -- mismo efecto neto, sin logica manual.
marcasRouter.get('/marcas', async (req, res, next) => {
  try {
    res.json(await listarMarcas());
  } catch (err) {
    next(err);
  }
});
