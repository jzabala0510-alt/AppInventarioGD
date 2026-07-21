import express, { Router } from 'express';
import * as conteoService from '../services/conteoService.js';
import { generarExcelDiferencias } from '../services/excelService.js';
import * as conteoBatchService from '../services/conteoBatchService.js';

export const conteoRouter = Router();

conteoRouter.get('/conteo/getIdentificador', async (req, res, next) => {
  try {
    // req.ip depende de "trust proxy"; para uso local basta con el remoteAddress.
    res.json(await conteoService.getIdentificador(req.ip || req.socket.remoteAddress || '127.0.0.1'));
  } catch (err) {
    next(err);
  }
});

conteoRouter.get('/conteo/obtenerBloques', async (req, res, next) => {
  try {
    res.json(await conteoService.obtenerBloques());
  } catch (err) {
    next(err);
  }
});

// No hay certeza del nombre/forma exacta que espera la app para este segundo
// endpoint (nunca existio en el backend original) -- se acepta idBloque tanto
// por query string como por path param para no perder el intento real.
async function handleArticulosPorBloque(req, res, next) {
  try {
    const idBloque = req.params.idBloque ?? req.query.idBloque;
    res.json(await conteoService.obtenerArticulosPorBloque(idBloque));
  } catch (err) {
    next(err);
  }
}
conteoRouter.get('/conteo/obtenerArticulosPorBloque', handleArticulosPorBloque);
conteoRouter.get('/conteo/obtenerArticulosPorBloque/:idBloque', handleArticulosPorBloque);

conteoRouter.get('/conteo/obtenerResumenConteo/:idConteo', async (req, res, next) => {
  try {
    res.json(await conteoService.obtenerResumenConteoPorConcepto(Number(req.params.idConteo)));
  } catch (err) {
    next(err);
  }
});

conteoRouter.get('/conteo/getResumen/:idConteo', async (req, res, next) => {
  try {
    await conteoService.streamResumenConteoArticulos(res, Number(req.params.idConteo));
  } catch (err) {
    next(err);
  }
});

conteoRouter.get('/conteo/obtenerConceptos', async (req, res, next) => {
  try {
    res.json(await conteoService.listarConceptos());
  } catch (err) {
    next(err);
  }
});

conteoRouter.get('/conteo/obtenerConteos', async (req, res, next) => {
  try {
    res.json(await conteoService.listarConteos());
  } catch (err) {
    next(err);
  }
});

conteoRouter.post('/conteo/crear', async (req, res, next) => {
  try {
    const { codAlmacen, fecha, observacion } = req.body;
    res.json(await conteoService.crearConteo({ fecha, codAlmacen, observacion, filtro: req.query }));
  } catch (err) {
    next(err);
  }
});

conteoRouter.get('/conteo/hayVentaEspera', async (req, res, next) => {
  try {
    res.json(await conteoService.hayVentaEspera());
  } catch (err) {
    next(err);
  }
});

// obtenerDetalleConteo y su alias talleConteo comparten el mismo handler --
// talleConteo no existe en el backend Java (bug del frontend), se implementa
// aca porque no hay nada funcionando hoy que romper.
async function handleDetalleConteo(req, res, next) {
  try {
    const { id } = req.params;
    const { zona, sector, usuario, total, diferencias, concepto } = req.query;
    const data = await conteoService.obtenerDetalleConteo(Number(id), {
      zona,
      sector,
      codUsuario: usuario,
      esConteoTotal: total,
      mostrarSoloDiferencias: diferencias,
      codConcepto: concepto,
    });
    res.json(data);
  } catch (err) {
    next(err);
  }
}
conteoRouter.get('/conteo/obtenerDetalleConteo/:id', handleDetalleConteo);
conteoRouter.get('/conteo/obtenerDetalleConteo2/:id', handleDetalleConteo);
conteoRouter.get('/conteo/talleConteo/:id', handleDetalleConteo);

conteoRouter.get('/conteo/getResumenEnvios/:id', async (req, res, next) => {
  try {
    res.json(await conteoService.getResumenEnvios(Number(req.params.id)));
  } catch (err) {
    next(err);
  }
});

conteoRouter.get('/conteo/obtenerFiltroConteo/:id', async (req, res, next) => {
  try {
    res.json(await conteoService.obtenerFiltroConteo(Number(req.params.id)));
  } catch (err) {
    next(err);
  }
});

conteoRouter.get('/conteo/obtenerConteoArticulo', async (req, res, next) => {
  try {
    const { fecha, codAlmacen, codArticulo, talla, color } = req.query;
    const data = await conteoService.obtenerConteoArticulo({ fecha, codAlmacen, codArticulo, talla, color });
    res.json(data);
  } catch (err) {
    next(err);
  }
});

conteoRouter.get('/conteo/eliminarRegistro/:id', async (req, res, next) => {
  try {
    res.json(await conteoService.eliminarRegistro(req.params.id));
  } catch (err) {
    next(err);
  }
});

conteoRouter.post('/conteo/actualizarConteoArticulo', async (req, res, next) => {
  try {
    const { id, unidades, codUsuario } = req.body;
    res.json(await conteoService.actualizarConteoArticulo({ id, unidades, codUsuario }));
  } catch (err) {
    next(err);
  }
});

conteoRouter.get('/conteo/eliminarConteo/:id', async (req, res, next) => {
  try {
    res.json(await conteoService.eliminarConteo(Number(req.params.id)));
  } catch (err) {
    next(err);
  }
});

// obtenerExcel2 y su alias obtenerExcel2__ (con doble guion bajo -- ruta legacy
// del Java original, parece deshabilitada, se implementa igual por si acaso)
// comparten el mismo handler; ambas invocan exportarXLSXVEN en el original.
async function handleExportarExcel(req, res, next) {
  try {
    const { id } = req.params;
    const { zona, sector, usuario, total, diferencias, concepto } = req.query;
    const buffer = await generarExcelDiferencias(Number(id), {
      zona,
      sector,
      codUsuario: usuario,
      esConteoTotal: total,
      mostrarSoloDiferencias: diferencias,
      codConcepto: concepto,
    });
    res.set('Content-Type', 'application/vnd.ms-excel');
    res.set('Content-Disposition', 'attachment; filename=conteo.xlsx');
    res.send(Buffer.from(buffer));
  } catch (err) {
    next(err);
  }
}
conteoRouter.get('/conteo/obtenerExcel2/:id', handleExportarExcel);
conteoRouter.get('/conteo/obtenerExcel2__/:id', handleExportarExcel);

conteoRouter.post('/conteo/agregarArticulo', async (req, res, next) => {
  try {
    res.json(await conteoBatchService.agregarArticulo(req.body));
  } catch (err) {
    next(err);
  }
});

conteoRouter.post('/conteo/agregarArticuloBatch', async (req, res, next) => {
  try {
    res.json(await conteoBatchService.agregarArticuloBatch(req.body));
  } catch (err) {
    next(err);
  }
});

// El original consume esto como text/plain (el body es directamente el string
// base64-gzip, no un objeto JSON) -- se usa express.text() solo en esta ruta.
conteoRouter.post('/conteo/agregarArticuloBatchComprimido', express.text({ type: '*/*' }), async (req, res, next) => {
  try {
    res.json(await conteoBatchService.agregarArticuloBatchComprimido(req.body));
  } catch (err) {
    next(err);
  }
});

// El original responde estos dos con texto plano (no JSON) cuando falta un
// parametro obligatorio -- se replica ese detalle en vez de pasar por el
// errorHandler generico (que siempre responde JSON).
conteoRouter.get('/conteo/obtenerArticulos', async (req, res, next) => {
  try {
    await conteoService.streamArticulosCatalogo(res, req.query);
  } catch (err) {
    if (err.status === 400) return res.status(400).type('text/plain').send(err.message);
    next(err);
  }
});

conteoRouter.get('/conteo/obtenerArticulosComprimido', async (req, res, next) => {
  try {
    await conteoService.streamArticulosDeConteo(res, req.query);
  } catch (err) {
    if (err.status === 400) return res.status(400).type('text/plain').send(err.message);
    next(err);
  }
});
