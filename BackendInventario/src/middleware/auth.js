import jwt from 'jsonwebtoken';
import { config } from '../config/env.js';

// A diferencia del backend Java (donde el filtro global Intercepter es un no-op
// por un bug de sintaxis), este middleware SI valida el token de verdad:
// firma, formato y expiracion. Los tokens viejos sin "exp" siguen siendo validos
// (no hay expiracion que violar); los nuevos que emitamos si expiran.

export function signToken(codVendedor) {
  return jwt.sign({}, config.jwt.secret, {
    subject: String(codVendedor),
    issuer: 'JWT',
    algorithm: 'HS256',
    expiresIn: config.jwt.expiresIn,
  });
}

// Replica ArticuloResource.obtenerCodVendedor(jwt): decodifica el subject del
// token sin rechazar la request si es invalido/expirado -- el original devuelve
// -1 en silencio en vez de un 401. Se preserva ese comportamiento laxo aca
// porque el endpoint que lo usa (ordenes) hoy tampoco lo valida de verdad; no es
// un middleware de proteccion, es solo una extraccion de "quien esta logueado".
export function extraerCodVendedorLaxo(authHeader) {
  const token = (authHeader || '').replace('Bearer ', '');
  try {
    const payload = jwt.verify(token, config.jwt.secret, { algorithms: ['HS256'] });
    return Number(payload.sub);
  } catch {
    return -1;
  }
}

export function requireAuth(req, res, next) {
  const header = req.get('Authorization') || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : header;

  if (!token) {
    return res.status(401).json({ success: false, respuesta: 'Falta el token de autenticacion' });
  }

  try {
    const payload = jwt.verify(token, config.jwt.secret, { algorithms: ['HS256'] });
    req.auth = { codVendedor: Number(payload.sub) };
    next();
  } catch (err) {
    return res.status(401).json({ success: false, respuesta: `Token invalido: ${err.message}` });
  }
}
