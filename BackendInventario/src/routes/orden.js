import { Router } from 'express';
import * as ordenService from '../services/ordenService.js';
import { extraerCodVendedorLaxo } from '../middleware/auth.js';

// OJO: en el backend Java esta clase se llama "ArticuloResource" pero su
// @Path real es "orden" (no "articulo") -- es el flujo de ordenes de
// reposicion, no el catalogo de articulos.
export const ordenRouter = Router();

ordenRouter.get('/orden/buscarArticulo/:codigo', async (req, res, next) => {
  try {
    res.json(await ordenService.buscarArticulo(req.params.codigo));
  } catch (err) {
    next(err);
  }
});

ordenRouter.get('/orden/generarNuevaOrden', (req, res) => {
  res.type('text/plain').send(ordenService.generarNuevoIdControl());
});

ordenRouter.get('/orden/obtenerResumen', async (req, res, next) => {
  try {
    const codVendedor = extraerCodVendedorLaxo(req.get('Authorization'));
    res.json(await ordenService.obtenerResumenPorVendedor(codVendedor));
  } catch (err) {
    next(err);
  }
});

ordenRouter.get('/orden/obtenerDetalleOrden/:idVisual', async (req, res, next) => {
  try {
    res.json(await ordenService.obtenerDetalleOrden(Number(req.params.idVisual)));
  } catch (err) {
    next(err);
  }
});

ordenRouter.post('/orden/crear', async (req, res, next) => {
  try {
    const codVendedor = extraerCodVendedorLaxo(req.get('Authorization'));
    const { idControl, objeto } = req.body;
    // "objeto" viaja doblemente serializado (un string que contiene el JSON del
    // array de articulos), igual que en el original -- se replica el mismo
    // doble JSON.parse en vez de esperar un array nativo.
    const articulos = typeof objeto === 'string' ? JSON.parse(objeto) : objeto;
    res.json(await ordenService.crearOrden({ idControl, articulos, codVendedor }));
  } catch (err) {
    next(err);
  }
});
