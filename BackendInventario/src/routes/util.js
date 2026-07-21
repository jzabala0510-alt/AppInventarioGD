import { Router } from 'express';
import * as utilService from '../services/utilService.js';
import { config } from '../config/env.js';
import { obtenerIpLocal } from '../utils/redLocal.js';

export const utilRouter = Router();

utilRouter.get('/util/getApk', async (req, res, next) => {
  try {
    // La IP se calcula desde la red de esta maquina, NO desde como el
    // navegador llego hasta aca (req.get('host') podria ser "localhost" si el
    // frontend vive en el mismo dispositivo que el backend) -- un telefono
    // nunca podria usar "localhost" para conectarse.
    const baseUrl = `${req.protocol}://${obtenerIpLocal()}:${config.port}`;
    res.json(await utilService.obtenerApk(baseUrl));
  } catch (err) {
    next(err);
  }
});
