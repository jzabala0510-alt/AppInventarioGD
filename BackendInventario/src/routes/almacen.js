import { Router } from 'express';
import { listarAlmacenes } from '../services/almacenService.js';

export const almacenRouter = Router();

// GET /recursos/almacen
almacenRouter.get('/almacen', async (req, res, next) => {
  try {
    res.json(await listarAlmacenes());
  } catch (err) {
    next(err);
  }
});
