import { Router } from 'express';
import { getPool } from '../db/pool.js';
import { requireAuth, signToken } from '../middleware/auth.js';

export const healthRouter = Router();

// Valida que el pool realmente puede hablarle a SQL Server (no solo que Express arrancó).
healthRouter.get('/_health', async (req, res, next) => {
  try {
    const pool = await getPool();
    const result = await pool.request().query('SELECT GETDATE() AS servidor, DB_NAME() AS baseDatos');
    res.json({ success: true, node: process.version, sql: result.recordset[0] });
  } catch (err) {
    next(err);
  }
});

// Confirma que el middleware de auth valida de verdad (a diferencia del Intercepter viejo).
healthRouter.get('/_health/auth', requireAuth, (req, res) => {
  res.json({ success: true, auth: req.auth });
});

// Solo en desarrollo: emite un token de prueba para poder probar rutas protegidas
// sin depender todavia del endpoint de login real.
if (process.env.NODE_ENV !== 'production') {
  healthRouter.get('/_health/token/:codVendedor', (req, res) => {
    res.json({ success: true, respuesta: signToken(req.params.codVendedor) });
  });
}
