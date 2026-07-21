import crypto from 'node:crypto';
import { getPool, sql } from '../db/pool.js';

// El original genera el GUID en SQL Server con un WHILE que reintenta si ya
// existe -- una colision de UUID v4 es estadisticamente imposible, asi que
// alcanza con generarlo localmente (mismo patron que ya usamos en conteo).
export function generarNuevoIdControl() {
  return crypto.randomUUID();
}

export async function buscarArticulo(codigo) {
  const pool = await getPool();
  const result = await pool.request()
    .input('codigo', sql.NVarChar(50), codigo)
    .query('EXEC ripWsRep.BUSCAR_ARTICULO @codigo');

  if (result.recordset.length === 0) {
    return { respuesta: { success: false, respuesta: 'Articulo no encontrado' } };
  }
  const r = result.recordset[0];
  return {
    codArticulo: r.CODARTICULO,
    referencia: r.REFPROVEEDOR,
    descripcion: r.DESCRIPCION,
    talla: r.TALLA,
    color: r.COLOR,
    codBarras: r.CODBARRAS,
    codBarras2: r.CODBARRAS2,
    codBarras3: r.CODBARRAS3,
    stockRepo: r.STOCK_REPO ?? 0,
    stockVenta: r.STOCK_VENTA ?? 0,
    stockCompra: r.STOCK_COMPRA ?? 0,
    precio: r.PVP,
    valorLeido: codigo,
    respuesta: { success: true, respuesta: 'Ok' },
  };
}

export async function obtenerResumenPorVendedor(codVendedor) {
  const pool = await getPool();
  const result = await pool.request()
    .input('codVendedor', sql.Int, codVendedor)
    .query(`
      SELECT IDVISUAL, FORMAT(HORA,'t','es-VE') HORA,
        CASE WHEN PROCESADO=1 THEN 'PROCESADO' ELSE 'PENDIENTE' END ESTATUS
      FROM ripWsRep.VISTA_ORDEN_REPOCAB
      WHERE FECHA=CAST(GETDATE() AS DATE) AND CODVENDEDOR=@codVendedor
      ORDER BY IDVISUAL DESC
    `);

  if (result.recordset.length === 0) {
    return { success: false, respuesta: 'Usted no ha registrado ninguna orden el día de hoy.' };
  }

  // El original arma este mismo array via un hack EAV/XML en T-SQL y lo entrega
  // ya serializado como string dentro de "respuesta" (doble-encoding). Se
  // preserva el mismo contrato de salida, solo que armado en JS en vez de SQL.
  const data = result.recordset.map((r) => ({
    IDVISUAL: r.IDVISUAL,
    HORA: r.HORA,
    ESTATUS: r.ESTATUS,
  }));
  return { success: true, respuesta: JSON.stringify(data) };
}

export async function obtenerDetalleOrden(idVisual) {
  const pool = await getPool();
  const result = await pool.request()
    .input('idVisual', sql.Int, idVisual)
    .query(`
      SELECT L.CODIGO, ART.DESCRIPCION, L.UNIDADESSOLICITADAS SOLICITADO, L.UNIDADESDESPACHADAS DESPACHADO
      FROM ripWsRep.VISTA_ORDEN_REPOCAB C
      INNER JOIN ripWsRep.ORDEN_REPOLIN L ON C.IDORDEN=L.IDORDEN
      INNER JOIN dbo.ARTICULOS ART ON L.CODARTICULO=ART.CODARTICULO
      WHERE C.FECHA=CAST(GETDATE() AS DATE) AND C.IDVISUAL=@idVisual
    `);

  if (result.recordset.length === 0) {
    return { success: false, respuesta: 'No se encontró ninguna orden.' };
  }

  const data = result.recordset.map((r) => ({
    CODIGO: r.CODIGO,
    DESCRIPCION: r.DESCRIPCION,
    SOLICITADO: r.SOLICITADO,
    DESPACHADO: r.DESPACHADO,
  }));
  return { success: true, respuesta: JSON.stringify(data) };
}

export async function crearOrden({ idControl, articulos, codVendedor }) {
  if (!idControl || idControl.length !== 36) {
    return { success: false, respuesta: 'Debe suministrar un Id de Control válido para poder generar una nueva Orden.' };
  }
  if (!Array.isArray(articulos) || articulos.length === 0) {
    return { success: false, respuesta: 'La orden debe contener por lo menos un articulo.' };
  }

  const pool = await getPool();

  const existing = await pool.request()
    .input('idControl', sql.NVarChar(36), idControl)
    .query('SELECT IDVISUAL FROM ripWsRep.VISTA_ORDEN_REPOCAB WHERE IDCONTROL=@idControl');
  if (existing.recordset.length > 0) {
    return { success: true, respuesta: `Ya existe la Orden #${existing.recordset[0].IDVISUAL} para el Id Control actual.` };
  }

  for (const art of articulos) {
    const r = await pool.request()
      .input('codArticulo', sql.Int, art.codArticulo)
      .input('color', sql.NVarChar(10), art.color)
      .input('talla', sql.NVarChar(10), art.talla)
      .query('SELECT TOP 1 1 AS x FROM ARTICULOSLIN WITH(NOLOCK) WHERE CODARTICULO=@codArticulo AND COLOR=@color AND TALLA=@talla');
    if (r.recordset.length === 0) {
      return { success: false, respuesta: `No Existe -> Cod. Articulo: ${art.codArticulo} | Color: ${art.color} | Talla: ${art.talla}` };
    }
  }

  // El original no envuelve esto en una transaccion real (solo revierte a mano
  // con un DELETE si insertarArticulos falla) -- aca si se usa una transaccion
  // real, mismo efecto neto en exito.
  const transaction = new sql.Transaction(pool);
  await transaction.begin();
  try {
    const cabResult = await new sql.Request(transaction)
      .input('codVendedor', sql.Int, codVendedor)
      .input('idControl', sql.NVarChar(36), idControl)
      .query('INSERT INTO ripWsRep.ORDEN_REPOCAB(CODVENDEDOR, IDCONTROL) OUTPUT inserted.IDORDEN VALUES (@codVendedor, @idControl)');
    const idOrden = cabResult.recordset[0].IDORDEN;

    for (const art of articulos) {
      // El original intenta INSERT y, si falla por PK duplicada, hace un UPDATE
      // sumando unidades (control de flujo dirigido por excepcion). Aca se hace
      // el mismo chequeo por adelantado -- mismo efecto neto, sin depender de
      // que la BD lance un error para decidir el camino.
      const existingLine = await new sql.Request(transaction)
        .input('idOrden', sql.Int, idOrden)
        .input('codArticulo', sql.Int, art.codArticulo)
        .input('color', sql.NVarChar(10), art.color)
        .input('talla', sql.NVarChar(10), art.talla)
        .input('codigo', sql.NVarChar(30), art.valorLeido)
        .query(`
          SELECT TOP 1 1 AS x FROM ripWsRep.ORDEN_REPOLIN
          WHERE IDORDEN=@idOrden AND CODARTICULO=@codArticulo AND COLOR=@color AND TALLA=@talla AND CODIGO=@codigo
        `);

      if (existingLine.recordset.length > 0) {
        await new sql.Request(transaction)
          .input('unidades', sql.Float, art.unidades)
          .input('idOrden', sql.Int, idOrden)
          .input('codArticulo', sql.Int, art.codArticulo)
          .input('color', sql.NVarChar(10), art.color)
          .input('talla', sql.NVarChar(10), art.talla)
          .input('codigo', sql.NVarChar(30), art.valorLeido)
          .query(`
            UPDATE ripWsRep.ORDEN_REPOLIN
            SET UNIDADESSOLICITADAS=UNIDADESSOLICITADAS+@unidades, UNIDADESDESPACHADAS=UNIDADESDESPACHADAS+@unidades
            WHERE IDORDEN=@idOrden AND CODARTICULO=@codArticulo AND COLOR=@color AND TALLA=@talla AND CODIGO=@codigo
          `);
      } else {
        await new sql.Request(transaction)
          .input('idOrden', sql.Int, idOrden)
          .input('codArticulo', sql.Int, art.codArticulo)
          .input('color', sql.NVarChar(10), art.color)
          .input('talla', sql.NVarChar(10), art.talla)
          .input('codigo', sql.NVarChar(30), art.valorLeido)
          .input('unidades', sql.Float, art.unidades)
          .query(`
            INSERT INTO ripWsRep.ORDEN_REPOLIN(IDORDEN, CODARTICULO, COLOR, TALLA, CODIGO, UNIDADESSOLICITADAS, UNIDADESDESPACHADAS)
            VALUES (@idOrden, @codArticulo, @color, @talla, @codigo, @unidades, @unidades)
          `);
      }
    }

    const visualResult = await new sql.Request(transaction)
      .input('idOrden', sql.Int, idOrden)
      .query('SELECT IDVISUAL FROM ripWsRep.VISTA_ORDEN_REPOCAB WHERE IDORDEN=@idOrden');
    const idVisual = visualResult.recordset[0]?.IDVISUAL;

    // Impresion omitida a proposito (decision 2026-07-17, ver memoria de
    // migracion): el original imprime aca un ticket ESC/POS a una impresora
    // fisica local llamada "ORDENES", algo que este backend no puede replicar.
    // Se deja el contenido del ticket en la respuesta para imprimirlo por otra via.
    const contenidoResult = await new sql.Request(transaction)
      .input('idOrden', sql.Int, idOrden)
      .query('EXEC ripWsRep.GET_DETALLE_PRINT @idOrden');
    const ticket = contenidoResult.recordset.map((r) => r.LINEA).join('\n\n');

    await transaction.commit();

    return {
      success: true,
      respuesta: `Se ha creado la Orden #${idVisual} satisfactoriamente.`,
      ticket,
    };
  } catch (err) {
    await transaction.rollback();
    return { success: false, respuesta: err.message };
  }
}
