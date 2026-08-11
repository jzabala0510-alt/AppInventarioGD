import { Router } from 'express';
import * as utilService from '../services/utilService.js';
import { config } from '../config/env.js';
import { obtenerIpLocal } from '../utils/redLocal.js';
import { getPool, sql } from '../db/pool.js';

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

// Devuelve los almacenes de mermas que tienen stock > 0 segun el ultimo
// snapshot de conteo (rip.CONTEOSTOCK). Se usa CONTEOSTOCK en vez de STOCKS
// porque en este cliente los items de mermas no se trasladan formalmente en ICG,
// por lo que STOCKS para el almacen de mermas siempre esta vacio.
utilRouter.get('/util/alertas-mermas', async (req, res, next) => {
  try {
    const pool = await getPool();
    const result = await pool.request().query(`
      SELECT A.CODALMACEN, A.NOMBREALMACEN, SUM(CS.STOCK) AS TOTALSTOCK
      FROM rip.CONTEOSTOCK CS WITH(NOLOCK)
      INNER JOIN ALMACEN A WITH(NOLOCK) ON CS.CODALMACEN = A.CODALMACEN
      WHERE A.ESMERMAS = 1
      GROUP BY A.CODALMACEN, A.NOMBREALMACEN
      HAVING SUM(CS.STOCK) > 0
    `);
    res.json(result.recordset.map((r) => ({
      codAlmacen: r.CODALMACEN,
      nombre: r.NOMBREALMACEN,
      totalStock: r.TOTALSTOCK,
    })));
  } catch (err) {
    next(err);
  }
});
