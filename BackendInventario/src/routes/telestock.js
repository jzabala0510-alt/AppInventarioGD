import { Router } from 'express';
import * as albVentaService from '../services/libRemote/albVentaService.js';
import * as sesionService from '../services/telestockSesionService.js';
import * as libRemoteConfigStore from '../services/libRemote/configStore.js';
import { probarCredenciales } from '../services/libRemote/soapClient.js';

export const telestockRouter = Router();

// errorHandler.js del proyecto siempre responde 500 sin mirar err.status --
// por eso las rutas de este archivo responden directo con el codigo que
// corresponda (400/404/409/422) en vez de delegar en next(err), igual que ya
// hace actualizador.js. next(err) queda solo para lo verdaderamente inesperado
// (que no tiene status seteado, y por eso cae en 500 igual).
// Devuelve true si ya respondio (err.status conocido); false si hay que
// dejarselo al errorHandler generico (next(err)), que loguea el stack
// completo -- reservado para lo verdaderamente inesperado.
function responderError(res, err) {
  if (!err.status) return false;
  res.status(err.status).json({ error: err.message, codigoNoPertenece: err.codigoNoPertenece });
  return true;
}

// Estado del modulo: informa si LibRemote esta configurado, para que el
// frontend pueda mostrar un mensaje claro en vez de que todo falle en
// silencio (mismo patron que /actualizador/estado).
telestockRouter.get('/telestock/estado', (req, res) => {
  res.json({ configurado: albVentaService.libRemoteConfigurado() });
});

// Configuracion editable desde la app (Configuracion > LibRemote) -- nunca
// devuelve la contrasena, solo si hay una guardada (para que el frontend
// pueda dejar el campo vacio sin perder la que ya esta puesta).
telestockRouter.get('/telestock/configuracion', (req, res) => {
  const activa = libRemoteConfigStore.getConfigActiva();
  res.json({
    baseUrl: activa?.baseUrl || '',
    usuario: activa?.usuario || '',
    hayPasswordGuardada: Boolean(activa?.password),
  });
});

telestockRouter.post('/telestock/configuracion/probar', async (req, res, next) => {
  try {
    const { baseUrl, usuario, password } = req.body || {};
    const activa = libRemoteConfigStore.getConfigActiva();
    // password vacio -- probar con la ya guardada (si el usuario solo
    // cambio la URL, no tiene por que retipear la contrasena para probar).
    const passwordAUsar = password || activa?.password || '';
    const resultado = await probarCredenciales({ baseUrl, usuario, password: passwordAUsar });
    res.json(resultado);
  } catch (err) {
    if (!responderError(res, err)) next(err);
  }
});

telestockRouter.post('/telestock/configuracion', async (req, res, next) => {
  try {
    const { baseUrl, usuario, password } = req.body || {};
    if (!baseUrl || !usuario) {
      return res.status(400).json({ error: 'baseUrl y usuario son obligatorios' });
    }
    const activa = libRemoteConfigStore.getConfigActiva();
    const passwordAUsar = password || activa?.password || '';
    const resultado = await probarCredenciales({ baseUrl, usuario, password: passwordAUsar });
    if (!resultado.ok) {
      return res.status(422).json({ error: resultado.mensaje });
    }
    libRemoteConfigStore.actualizarConfig({ baseUrl, usuario, password });
    res.json({ guardado: true, mensaje: resultado.mensaje });
  } catch (err) {
    if (!responderError(res, err)) next(err);
  }
});

telestockRouter.get('/telestock/facturas', async (req, res, next) => {
  try {
    const facturas = await albVentaService.listarFacturasPendientes();
    res.json(facturas);
  } catch (err) {
    if (!responderError(res, err)) next(err);
  }
});

// Crea una sesion nueva: trae las lineas de la factura elegida y arranca el
// conteo en 0. idempotente-ish: cada llamada crea una sesion nueva (si el
// usuario recarga sin querer, mejor una sesion nueva vacia que reutilizar
// una vieja a medias sin que lo sepa).
telestockRouter.post('/telestock/sesiones', async (req, res, next) => {
  try {
    const { serie, numero, n } = req.body || {};
    if (!serie || numero === undefined || numero === null) {
      return res.status(400).json({ error: 'serie y numero son obligatorios' });
    }
    const { facturado, lineas } = await albVentaService.obtenerLineasFactura({ serie, numero, n });
    const sesion = await sesionService.crearSesion({ serie, numero, n, facturado, lineas });
    res.json(sesion);
  } catch (err) {
    if (!responderError(res, err)) next(err);
  }
});

// Listado liviano de sesiones locales (abiertas y cerradas) -- para poder
// encontrar de nuevo un conteo ya cerrado y reabrirlo sin depender de tener
// guardada la URL de esa sesion puntual.
telestockRouter.get('/telestock/sesiones', async (req, res, next) => {
  try {
    const sesiones = await sesionService.listarSesiones();
    res.json(sesiones);
  } catch (err) {
    if (!responderError(res, err)) next(err);
  }
});

telestockRouter.get('/telestock/sesiones/:idSesion', async (req, res, next) => {
  try {
    const sesion = await sesionService.obtenerSesion(req.params.idSesion);
    res.json(sesion);
  } catch (err) {
    if (!responderError(res, err)) next(err);
  }
});

telestockRouter.post('/telestock/sesiones/:idSesion/escanear', async (req, res, next) => {
  try {
    const { codigoBarras, unidades } = req.body || {};
    if (!codigoBarras) {
      return res.status(400).json({ error: 'codigoBarras es obligatorio' });
    }
    const resultado = await sesionService.registrarEscaneo(req.params.idSesion, { codigoBarras, unidades });
    res.json(resultado);
  } catch (err) {
    if (!responderError(res, err)) next(err);
  }
});

telestockRouter.post('/telestock/sesiones/:idSesion/cerrar', async (req, res, next) => {
  try {
    const { idMov } = req.body || {};
    const { sesion, contenido, nombreArchivo } = await sesionService.cerrarSesion(req.params.idSesion, { idMov });
    // Se devuelve el contenido junto con la sesion para que el frontend pueda
    // ofrecer la descarga directa (Blob) ademas de que ya quedo guardado en
    // TeleStock/ del lado del servidor.
    res.json({ sesion, contenido, nombreArchivo });
  } catch (err) {
    if (!responderError(res, err)) next(err);
  }
});

telestockRouter.post('/telestock/sesiones/:idSesion/reabrir', async (req, res, next) => {
  try {
    const sesion = await sesionService.reabrirSesion(req.params.idSesion);
    res.json(sesion);
  } catch (err) {
    if (!responderError(res, err)) next(err);
  }
});
