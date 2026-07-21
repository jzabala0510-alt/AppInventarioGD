import { Router } from 'express';
import * as sqlConfigService from '../services/sqlConfigService.js';

export const sqlRouter = Router();

// GET /recursos/sql/obtenerDatosConexion
sqlRouter.get('/sql/obtenerDatosConexion', async (req, res, next) => {
  try {
    res.json(await sqlConfigService.obtenerDatosConexion());
  } catch (err) {
    next(err);
  }
});

// GET /recursos/sql/obtenerPasswords
sqlRouter.get('/sql/obtenerPasswords', async (req, res, next) => {
  try {
    res.json(await sqlConfigService.obtenerPasswords());
  } catch (err) {
    next(err);
  }
});

// POST /recursos/sql/probarConexion -- no existia en el original; se agrega
// para poder validar antes de aplicar (ver memoria de la migracion del frontend Vue).
sqlRouter.post('/sql/probarConexion', async (req, res) => {
  try {
    await sqlConfigService.probarConexion(req.body);
    res.json({ success: true, respuesta: 'Conexion exitosa' });
  } catch (err) {
    res.json({ success: false, respuesta: err.message || String(err) });
  }
});

// POST /recursos/sql/guardarDatosConexion
sqlRouter.post('/sql/guardarDatosConexion', async (req, res) => {
  try {
    res.json(await sqlConfigService.guardarDatosConexion(req.body));
  } catch (err) {
    res.json({ success: false, respuesta: err.message || String(err) });
  }
});

// GET /recursos/sql/ejecutarScript
sqlRouter.get('/sql/ejecutarScript', async (req, res) => {
  try {
    res.json(await sqlConfigService.ejecutarScript());
  } catch (err) {
    res.json({ success: false, respuesta: err.message || String(err) });
  }
});
