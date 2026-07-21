import { log } from '../utils/logger.js';

export function requestLogger(req, res, next) {
  const inicio = Date.now();
  res.on('finish', () => {
    const ms = Date.now() - inicio;
    log(`${req.method} ${req.originalUrl} -> ${res.statusCode} (${ms}ms)`);
  });
  next();
}
