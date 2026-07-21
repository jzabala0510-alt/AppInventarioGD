import { Router } from 'express';
import { listarDepartamentos } from '../services/departamentosService.js';

export const departamentosRouter = Router();

// GET /recursos/departamentos
departamentosRouter.get('/departamentos', async (req, res, next) => {
  try {
    res.json(await listarDepartamentos());
  } catch (err) {
    next(err);
  }
});
