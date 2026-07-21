import { Router } from 'express';
import * as vendedorService from '../services/vendedorService.js';

export const vendedorRouter = Router();

// GET /recursos/vendedor
vendedorRouter.get('/vendedor', async (req, res, next) => {
  try {
    res.json(await vendedorService.listarVendedores());
  } catch (err) {
    next(err);
  }
});

// POST /recursos/vendedor (login)
vendedorRouter.post('/vendedor', async (req, res, next) => {
  try {
    const { codVendedor, password } = req.body;
    res.json(await vendedorService.login(codVendedor, password));
  } catch (err) {
    next(err);
  }
});
