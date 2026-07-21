import zlib from 'node:zlib';
import { getPool, sql } from '../db/pool.js';

// Reconstruccion de mejor esfuerzo: el mapeo de resultset de
// Articulo.buscarCodigo() se perdio en la descompilacion (JD-GUI no reconstruyo
// esa seccion del bytecode). Las columnas de salida del SP si estan confirmadas
// (ver rip.APP_CONTEO_BUSCAR_ARTICULO), este mapeo a campos de "Articulo" es
// una inferencia razonable, no una transcripcion literal.
async function buscarArticuloPorCodigo({ codigo, codAlmacen, codArticulo = -1, color = '', talla = '' }) {
  const pool = await getPool();
  const result = await pool.request()
    .input('codigo', sql.NVarChar(50), codigo)
    .input('codAlmacen', sql.NVarChar(3), codAlmacen)
    .input('codArticulo', sql.Int, codArticulo)
    .input('color', sql.NVarChar(10), color)
    .input('talla', sql.NVarChar(10), talla)
    .execute('rip.APP_CONTEO_BUSCAR_ARTICULO');

  return result.recordset.map((r) => ({
    codArticulo: r.CODARTICULO,
    referencia: r.REFPROVEEDOR,
    descripcion: r.DESCRIPCION,
    color: r.COLOR,
    talla: r.TALLA,
    codBarras: r.CODBARRAS,
    codBarras2: r.CODBARRAS2,
    codBarras3: r.CODBARRAS3,
    usaStock: r.USASTOCKS === 'T',
    kit: r.ESKIT === 'T',
    codMarca: r.MARCA,
    seccion: r.SECCION,
    stockRepo: r.STOCK ?? 0,
  }));
}

async function agregarLineaConteo({ fecha, codAlmacen, codArticulo, color, talla, unidades, zona, sector, codUsuario, codConcepto }) {
  const pool = await getPool();

  await pool.request()
    .input('fecha', sql.Date, fecha)
    .input('codAlmacen', sql.NVarChar(3), codAlmacen)
    .input('codArticulo', sql.Int, codArticulo)
    .input('color', sql.NVarChar(10), color)
    .input('talla', sql.NVarChar(10), talla)
    .input('unidades', sql.Float, unidades)
    .input('zona', sql.NVarChar(50), (zona || '').trim().toUpperCase())
    .input('sector', sql.Int, sector)
    .input('codUsuario', sql.Int, codUsuario)
    .input('codConcepto', sql.Int, codConcepto)
    .query(`
      INSERT INTO rip.CONTEOLIN(FECHA, CODALMACEN, CODARTICULO, COLOR, TALLA, UNIDADES, HORACONTEO, ZONA, SECTOR, CODUSUARIO, CODCONCEPTO)
      SELECT @fecha, @codAlmacen, @codArticulo, @color, @talla, @unidades, GETDATE(), SUBSTRING(@zona,1,50), @sector, @codUsuario, @codConcepto
    `);

  // Si el articulo maneja tallas via "@" (talla unica), crea tambien el registro
  // en 0 unidades para las demas combinaciones color/talla reales del articulo,
  // igual que ConteoLin.agregar() en el original.
  await pool.request()
    .input('fecha', sql.Date, fecha)
    .input('codAlmacen', sql.NVarChar(3), codAlmacen)
    .input('codArticulo', sql.Int, codArticulo)
    .query(`
      ;WITH CTE_CONTEO AS(
        SELECT CL.CODARTICULO, MIN(CL.HORACONTEO) HORACONTEO
        FROM rip.CONTEOLIN CL WITH(NOLOCK)
        WHERE CL.FECHA=@fecha AND CL.CODALMACEN=@codAlmacen
        GROUP BY CL.CODARTICULO, CL.COLOR, CL.TALLA
      )
      INSERT INTO rip.CONTEOLIN (FECHA, CODALMACEN, CODARTICULO, COLOR, TALLA, UNIDADES, HORACONTEO)
      SELECT @fecha, @codAlmacen, AL.CODARTICULO, AL.COLOR, AL.TALLA, 0, C.HORACONTEO
      FROM ARTICULOSLIN AL WITH(NOLOCK)
      INNER JOIN CTE_CONTEO C ON AL.CODARTICULO=C.CODARTICULO
      WHERE AL.CODARTICULO=@codArticulo AND (AL.TALLA='@')
    `);
}

export async function agregarArticulo(conteoJson) {
  const {
    fecha, codAlmacen, codigo, unidades, zona, sector = 1, codUsuario, codConcepto = 1,
    codArticulo = -1, color = '', talla = '',
  } = conteoJson;

  const candidatos = await buscarArticuloPorCodigo({ codigo, codAlmacen, codArticulo, color, talla });

  if (candidatos.length === 0) {
    return { idRespuesta: 0, respuesta: `El ${codigo} no existe.` };
  }
  if (candidatos.length > 1) {
    return { idRespuesta: 2, respuesta: JSON.stringify(candidatos) };
  }

  const articulo = candidatos[0];

  if (articulo.kit) {
    // Bug confirmado y preservado a proposito (ver memoria de migracion): en el
    // original, contar un articulo "kit" nunca hace nada -- el codigo Java tiene
    // un Stream.map() sin operacion terminal, asi que ningun componente del kit
    // se agrega a rip.CONTEOLIN. No se puede validar un fix sin datos reales de
    // kits ni la app movil para probarlo, asi que se deja igual.
    return { idRespuesta: undefined, respuesta: undefined };
  }

  await agregarLineaConteo({
    fecha, codAlmacen, codArticulo: articulo.codArticulo, color: articulo.color, talla: articulo.talla,
    unidades, zona, sector, codUsuario, codConcepto,
  });

  // El original sobreescribe "respuesta" con el JSON del articulo resuelto
  // (no con el mensaje "agregado satisfactoriamente") cuando el agregado fue
  // exitoso -- se replica ese contrato tal cual.
  return { idRespuesta: 1, respuesta: JSON.stringify(articulo) };
}

// --- Sincronizacion de conteo offline por lotes ---
//
// NOTA sobre PREPROCESADO: el SQL dinamico original, tal como quedo en el
// codigo fuente decompilado, parece invertido (PREPROCESADO=0 -> "se esta
// procesando en otro hilo"). Jose confirmo (2026-07-17) implementar la logica
// que tiene sentido: PREPROCESADO=0 significa libre para procesar, =1
// significa que otro hilo ya lo esta procesando (lock optimista real).

async function procesarBatch({ idEnvio, fecha, codUsuario, codConteo, unidadesEsperadas, lineas }) {
  const acumulado = lineas.reduce((sum, l) => sum + Number(l.unidades), 0);
  if (Math.abs(acumulado - Number(unidadesEsperadas)) > 0.1) {
    return {
      success: false,
      respuesta: `Existe una diferencia entre las unidades esperadas (${unidadesEsperadas}) y las recibidas (${acumulado})`,
    };
  }

  const pool = await getPool();

  const envioResult = await pool.request()
    .input('idEnvio', sql.UniqueIdentifier, idEnvio)
    .query('SELECT PROCESADO, PREPROCESADO, HORAPROCESADO FROM rip.CONTEO_ENVIOS WHERE ID=@idEnvio');

  if (envioResult.recordset.length === 0) {
    return { success: false, respuesta: 'El identificador suministrado no es válido.' };
  }
  const envio = envioResult.recordset[0];

  if (envio.PROCESADO) {
    const hora = envio.HORAPROCESADO ? new Date(envio.HORAPROCESADO).toLocaleString('es-VE') : '';
    return { success: true, respuesta: `El identificador suministrado fue procesado el ${hora}.` };
  }
  if (envio.PREPROCESADO) {
    return { success: false, respuesta: 'El identificador se está procesando en otro hilo de ejecución.' };
  }

  // Lock optimista: marcar preprocesado ANTES de insertar, para que un segundo
  // intento concurrente con el mismo idEnvio lo encuentre tomado.
  await pool.request()
    .input('idEnvio', sql.UniqueIdentifier, idEnvio)
    .query('UPDATE rip.CONTEO_ENVIOS SET PREPROCESADO=1 WHERE ID=@idEnvio');

  // Ajuste de reloj: el original desplaza la hora de cada linea por la
  // diferencia entre "ahora" y la hora en que el lote se genero en el
  // dispositivo (compensa reloj desincronizado del celular/tablet offline).
  const segundos = Math.floor((Date.now() - new Date(fecha).getTime()) / 1000);

  const transaction = new sql.Transaction(pool);
  await transaction.begin();
  try {
    for (const linea of lineas) {
      const horaAjustada = new Date(new Date(linea.horaConteo).getTime() + segundos * 1000);
      await new sql.Request(transaction)
        .input('fecha', sql.Date, linea.fecha)
        .input('codAlmacen', sql.NVarChar(3), linea.codAlmacen)
        .input('codArticulo', sql.Int, linea.codArticulo)
        .input('color', sql.NVarChar(10), linea.color)
        .input('talla', sql.NVarChar(10), linea.talla)
        .input('unidades', sql.Float, linea.unidades)
        .input('horaConteo', sql.DateTime, horaAjustada)
        .input('zona', sql.NVarChar(50), String(linea.zona || '').substring(0, 50))
        .input('codUsuario', sql.Int, linea.codUsuario)
        .input('sector', sql.Int, linea.sector)
        .input('idEnvio', sql.UniqueIdentifier, idEnvio)
        .input('codConcepto', sql.Int, linea.codConcepto)
        .query(`
          INSERT INTO rip.CONTEOLIN(FECHA, CODALMACEN, CODARTICULO, COLOR, TALLA, UNIDADES, HORACONTEO, ZONA, CODUSUARIO, SECTOR, UNIDADESREALES, IDENVIO, CODCONCEPTO)
          VALUES (@fecha, @codAlmacen, @codArticulo, @color, @talla, @unidades, @horaConteo, @zona, @codUsuario, @sector, @unidades, @idEnvio, @codConcepto)
        `);
    }

    const updateResult = await new sql.Request(transaction)
      .input('idEnvio', sql.UniqueIdentifier, idEnvio)
      .input('codUsuario', sql.Int, Number(codUsuario))
      .input('codConteo', sql.Int, Number(codConteo))
      .input('unidades', sql.Float, acumulado)
      .query(`
        UPDATE rip.CONTEO_ENVIOS
        SET PROCESADO=1, HORAPROCESADO=GETDATE(), CODUSUARIO=@codUsuario, IDCONTEO=@codConteo, UNIDADES=@unidades
        WHERE ID=@idEnvio AND ISNULL(PROCESADO,0)=0
      `);

    if (updateResult.rowsAffected[0] === 0) {
      throw new Error('EL CONTEO HA SIDO CARGADO EN UN HILO PREVIO');
    }

    await transaction.commit();
    return { success: true, respuesta: 'OK' };
  } catch (err) {
    await transaction.rollback();
    // Libera el lock optimista para permitir un reintento si esto fallo.
    await pool.request()
      .input('idEnvio', sql.UniqueIdentifier, idEnvio)
      .query('UPDATE rip.CONTEO_ENVIOS SET PREPROCESADO=0 WHERE ID=@idEnvio');
    return { success: false, respuesta: err.message };
  }
}

async function procesarBatchDesdeJson(desconectado) {
  const { idConteo: idEnvio, fecha, codUsuario, codConteo, conteo, unidades } = desconectado;
  const lineas = typeof conteo === 'string' ? JSON.parse(conteo) : conteo;

  if (!Array.isArray(lineas) || lineas.length === 0) {
    return { success: false, respuesta: 'El conteo debe tener al menos un registro.' };
  }

  return procesarBatch({ idEnvio, fecha, codUsuario, codConteo, unidadesEsperadas: unidades, lineas });
}

export async function agregarArticuloBatch(body) {
  return procesarBatchDesdeJson(body);
}

export async function agregarArticuloBatchComprimido(gzipBase64Text) {
  const jsonText = zlib.gunzipSync(Buffer.from(gzipBase64Text, 'base64')).toString('utf-8');
  return procesarBatchDesdeJson(JSON.parse(jsonText));
}
