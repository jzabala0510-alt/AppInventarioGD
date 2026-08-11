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

// Devuelve los almacenes de mermas que tienen stock neto > 0 segun STOCKS (ICG live).
utilRouter.get('/util/alertas-mermas', async (req, res, next) => {
  try {
    const pool = await getPool();
    const result = await pool.request().query(`
      SELECT A.CODALMACEN, A.NOMBREALMACEN,
             SUM(CASE WHEN S.STOCK > 0 THEN S.STOCK ELSE 0 END) AS TOTALSTOCK
      FROM STOCKS S WITH(NOLOCK)
      INNER JOIN ALMACEN A WITH(NOLOCK) ON S.CODALMACEN = A.CODALMACEN
      WHERE A.ESMERMAS = 1
      GROUP BY A.CODALMACEN, A.NOMBREALMACEN
      HAVING SUM(CASE WHEN S.STOCK > 0 THEN S.STOCK ELSE 0 END) > 0
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
