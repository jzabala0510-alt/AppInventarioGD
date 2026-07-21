import { Router } from 'express';
import { healthRouter } from './health.js';
import { almacenRouter } from './almacen.js';
import { marcasRouter } from './marcas.js';
import { departamentosRouter } from './departamentos.js';
import { vendedorRouter } from './vendedor.js';
import { conteoRouter } from './conteo.js';
import { sqlRouter } from './sql.js';
import { ordenRouter } from './orden.js';
import { utilRouter } from './util.js';

export const router = Router();

router.use(healthRouter);
router.use(almacenRouter);
router.use(marcasRouter);
router.use(departamentosRouter);
router.use(vendedorRouter);
router.use(conteoRouter);
router.use(sqlRouter);
router.use(ordenRouter);
router.use(utilRouter);
