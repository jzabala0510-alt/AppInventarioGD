import { logError } from '../utils/logger.js';

// eslint-disable-next-line no-unused-vars
export function errorHandler(err, req, res, next) {
  logError(`${req.method} ${req.originalUrl}: ${err.stack || err}`);
  if (res.headersSent) return next(err);
  res.status(500).json({ success: false, respuesta: err.message || 'Error interno' });
}

export function notFoundHandler(req, res) {
  res.status(404).json({ success: false, respuesta: `Ruta no encontrada: ${req.method} ${req.originalUrl}` });
}
