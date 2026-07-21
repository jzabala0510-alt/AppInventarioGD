import { getPool, sql } from '../db/pool.js';
import { toIsoDate, toBit, sanitizeLike } from '../utils/format.js';

export async function getIdentificador(ip) {
  // La columna real es varchar(16) (IPv4 clasico). Node/Express a veces reporta
  // direcciones IPv4 mapeadas a IPv6 ("::ffff:x.x.x.x") o IPv6 reales, que no
  // caben -- eso rompe el protocolo TDS con un error de longitud invalida.
  // Se normaliza el prefijo IPv6-mapeado-a-IPv4 y se trunca como respaldo.
  const normalizedIp = String(ip).replace(/^::ffff:/, '').slice(0, 16);
  const pool = await getPool();
  const result = await pool.request()
    .input('ip', sql.VarChar(16), normalizedIp)
    .query('INSERT INTO rip.CONTEO_ENVIOS([IP]) OUTPUT inserted.ID VALUES(@ip)');
  return { success: true, respuesta: result.recordset[0].ID };
}

// Articulo.getBloques()/getArticulosPorBloque(): mecanismo de paginacion del
// CATALOGO GENERAL (no filtrado por conteo) que existe completo en el Java
// original pero nunca se conecto a un endpoint REST -- se expone aca tal cual.
// OJO: BLOCK_SIZE=450000 es mayor que el catalogo real (~311k articulos), asi
// que con este tamano "original" siempre da 1 solo bloque -- no resuelve por
// si solo el problema de volumen que vimos en obtenerArticulosComprimido
// (que ademas es un endpoint distinto, filtrado por CONTEO_TARGET). Se deja
// el valor tal cual por ahora hasta confirmar si de verdad ayuda de esta forma.
const BLOCK_SIZE = 450000;

export async function obtenerBloques() {
  const pool = await getPool();
  const result = await pool.request()
    .query(`
      SELECT CEILING(COUNT(*) * 1.0 / ${BLOCK_SIZE}) BLOQUES, COUNT(*) CANTIDAD
      FROM ARTICULOS ART WITH(NOLOCK)
      WHERE ART.TIPOARTICULO='A' AND ART.USASTOCKS='T' AND ART.CODARTICULO>0
    `);
  const r = result.recordset[0];
  return { cantidadArticulos: r.CANTIDAD, cantidadBloques: r.BLOQUES };
}

export async function obtenerArticulosPorBloque(idBloque) {
  const pool = await getPool();
  const result = await pool.request()
    .input('bloqueId', sql.Int, Number(idBloque))
    .input('bloqueSize', sql.Int, BLOCK_SIZE)
    .query(`
      SELECT ART.CODARTICULO, ISNULL(SEC.DESCRIPCION,'ND') SECCION, ISNULL(ART.REFPROVEEDOR,'') REFPROVEEDOR,
        ISNULL(ART.DESCRIPCION,'') DESCRIPCION, ISNULL(AL.COLOR,'') COLOR, ISNULL(AL.TALLA,'') TALLA,
        ISNULL(AL.CODBARRAS,'') CODBARRAS, ISNULL(AL.CODBARRAS2,'') CODBARRAS2, ISNULL(AL.CODBARRAS3,'') CODBARRAS3
      FROM ARTICULOS ART WITH(NOLOCK)
        INNER JOIN ARTICULOSLIN AL WITH(NOLOCK) ON ART.CODARTICULO=AL.CODARTICULO
        LEFT JOIN SECCIONES SEC WITH(NOLOCK) ON ART.DPTO=SEC.NUMDPTO AND ART.SECCION=SEC.NUMSECCION
      WHERE ART.TIPOARTICULO='A' AND ART.USASTOCKS='T' AND ART.CODARTICULO>0
      ORDER BY ART.CODARTICULO, ISNULL(AL.COLOR,''), ISNULL(AL.TALLA,'')
      OFFSET (@bloqueId-1)*@bloqueSize ROWS
      FETCH NEXT @bloqueSize ROWS ONLY
    `);
  return result.recordset.map((r) => ({
    codArticulo: r.CODARTICULO,
    seccion: r.SECCION,
    referencia: r.REFPROVEEDOR,
    descripcion: r.DESCRIPCION,
    talla: r.TALLA,
    color: r.COLOR,
    codBarras: r.CODBARRAS,
    codBarras2: r.CODBARRAS2,
    codBarras3: r.CODBARRAS3,
  }));
}

export async function listarConceptos() {
  const pool = await getPool();
  const result = await pool.request().query('SELECT * FROM rip.CONCEPTOS_CONTEO ORDER BY CODCONCEPTO');
  return result.recordset.map((r) => ({
    codConcepto: r.CODCONCEPTO,
    concepto: r.CONCEPTO,
  }));
}

// Concepto.getResumenConteo(idConteo, -1): resumen contado->zona->sector.
// El SQL original tiene un bug de sintaxis real ("ORDER HORAGENERADO DESC" sin
// BY, y esa columna ni siquiera esta en el SELECT) -- eso significa que en el
// backend Java esto SIEMPRE tira una excepcion de sintaxis y el endpoint
// devuelve null/vacio hoy en produccion. Aca se corrige (se quita el ORDER BY
// invalido) porque no tiene sentido replicar un endpoint que nunca funciono.
export async function obtenerResumenConteoPorConcepto(idConteo) {
  const pool = await getPool();
  const result = await pool.request()
    .input('idConteo', sql.Int, idConteo)
    .query(`
      SELECT CON.CONCEPTO, CL.ZONA, CL.SECTOR, SUM(CL.UNIDADES) UNIDADES
      FROM rip.CONTEOCAB CC WITH(NOLOCK)
      INNER JOIN rip.CONTEOLIN CL WITH(NOLOCK) ON CC.FECHA=CL.FECHA AND CC.CODALMACEN=CL.CODALMACEN
      INNER JOIN rip.CONCEPTOS_CONTEO CON WITH(NOLOCK) ON CL.CODCONCEPTO=CON.CODCONCEPTO
      WHERE CC.IDCONTEO=@idConteo
      GROUP BY CON.CONCEPTO, CL.ZONA, CL.SECTOR
      ORDER BY CON.CONCEPTO, CL.ZONA, CL.SECTOR
    `);

  const conceptos = [];
  const porConcepto = new Map();
  for (const r of result.recordset) {
    if (!porConcepto.has(r.CONCEPTO)) {
      const entry = { concepto: r.CONCEPTO, zonas: [] };
      porConcepto.set(r.CONCEPTO, entry);
      conceptos.push(entry);
    }
    const conceptoEntry = porConcepto.get(r.CONCEPTO);
    let zonaEntry = conceptoEntry.zonas.find((z) => z.zona === r.ZONA);
    if (!zonaEntry) {
      zonaEntry = { zona: r.ZONA, sectores: [] };
      conceptoEntry.zonas.push(zonaEntry);
    }
    zonaEntry.sectores.push({ sector: r.SECTOR, unidades: r.UNIDADES });
  }
  return conceptos;
}

// ConteoCab.getResumenConteo(idConteo): catalogo target de un conteo con su
// estado de conteo (contado si/no, total contado). Mismo volumen que
// obtenerArticulosComprimido (un renglon por articulo target del conteo).
const RESUMEN_CONTEO_SQL = `
  DECLARE @CODALMACEN AS NVARCHAR(3) = (SELECT CODALMACEN FROM rip.CONTEOCAB WITH(NOLOCK) WHERE IDCONTEO=@idConteo);
  WITH CTE_CONTEO AS (
    SELECT CL.CODARTICULO, SUM(CL.UNIDADES) CONTADO
    FROM rip.CONTEOCAB CC WITH(NOLOCK)
    INNER JOIN rip.CONTEOLIN CL WITH(NOLOCK) ON CC.CODALMACEN=CL.CODALMACEN AND CC.FECHA=CL.FECHA
    WHERE CC.IDCONTEO=@idConteo
    GROUP BY CL.CODARTICULO
  )
  SELECT ART.CODARTICULO, ISNULL(SEC.DESCRIPCION,'ND') SECCION, ISNULL(ART.REFPROVEEDOR,'') REFPROVEEDOR,
    ISNULL(ART.DESCRIPCION,'') DESCRIPCION, ISNULL(AL.COLOR,'') COLOR, ISNULL(AL.TALLA,'') TALLA,
    ISNULL(ART.NORMA,'') NORMA, ISNULL(AL.CODBARRAS,'') CODBARRAS, ISNULL(AL.CODBARRAS2,'') CODBARRAS2,
    ISNULL(AL.CODBARRAS3,'') CODBARRAS3, ISNULL(ST.STOCK,0) STOCK,
    CASE WHEN CON.CODARTICULO IS NULL THEN 0 ELSE 1 END CONTADO,
    ISNULL(CON.CONTADO,0) TOTAL_CONTADO
  FROM ARTICULOS ART WITH(NOLOCK)
    INNER JOIN ARTICULOSLIN AL WITH(NOLOCK) ON ART.CODARTICULO=AL.CODARTICULO
    INNER JOIN rip.CONTEO_TARGET CT WITH(NOLOCK) ON ART.CODARTICULO=CT.CODARTICULO AND CT.IDCONTEO=@idConteo
    LEFT JOIN SECCIONES SEC WITH(NOLOCK) ON ART.DPTO=SEC.NUMDPTO AND ART.SECCION=SEC.NUMSECCION
    LEFT JOIN STOCKS ST WITH(NOLOCK) ON AL.CODARTICULO=ST.CODARTICULO AND AL.COLOR=ST.COLOR AND AL.TALLA=ST.TALLA AND ST.CODALMACEN=@CODALMACEN
    LEFT JOIN CTE_CONTEO CON ON ART.CODARTICULO=CON.CODARTICULO
  WHERE ART.TIPOARTICULO='A' AND ART.USASTOCKS='T' AND ART.CODARTICULO>0
`;

function mapArticuloConProgreso(r) {
  return {
    codArticulo: r.CODARTICULO,
    seccion: r.SECCION,
    referencia: r.REFPROVEEDOR,
    descripcion: r.DESCRIPCION,
    color: r.COLOR,
    talla: r.TALLA,
    norma: r.NORMA,
    codBarras: r.CODBARRAS,
    codBarras2: r.CODBARRAS2,
    codBarras3: r.CODBARRAS3,
    stock: r.STOCK,
    contado: !!r.CONTADO,
    unidadesContadas: r.TOTAL_CONTADO,
  };
}

export async function obtenerResumenConteoArticulos(idConteo) {
  const pool = await getPool();
  const result = await pool.request().input('idConteo', sql.Int, idConteo).query(RESUMEN_CONTEO_SQL);
  return result.recordset.map(mapArticuloConProgreso);
}

// Version en streaming -- mismo motivo que streamArticulosDeConteo (esta
// consulta devuelve el mismo volumen, un renglon por articulo target).
export async function streamResumenConteoArticulos(res, idConteo) {
  const pool = await getPool();
  const request = pool.request().input('idConteo', sql.Int, idConteo);
  request.stream = true;

  return new Promise((resolve, reject) => {
    let first = true;
    let started = false;

    request.on('row', (row) => {
      if (!started) {
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.write('[');
        started = true;
      }
      if (!first) res.write(',');
      first = false;
      res.write(JSON.stringify(mapArticuloConProgreso(row)));
    });
    request.on('error', (err) => reject(err));
    request.on('done', () => {
      if (!started) res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.write(started ? ']' : '[]');
      res.end();
      resolve();
    });

    request.query(RESUMEN_CONTEO_SQL).catch(reject);
  });
}

export async function listarConteos() {
  const pool = await getPool();
  const result = await pool.request().query(`
    SELECT
      FECHA, ALM.CODALMACEN, ALM.NOMBREALMACEN, OBSERVACION, IDCONTEO,
      ISNULL(FORMAT(CC.FECHAFIN,'d','es-VE'),'EN PROCESO') FECHAFIN
    FROM rip.CONTEOCAB CC WITH(NOLOCK)
      INNER JOIN dbo.ALMACEN ALM WITH(NOLOCK) ON CC.CODALMACEN = ALM.CODALMACEN COLLATE Latin1_General_CS_AI
    ORDER BY CC.FECHA DESC
  `);
  return result.recordset.map((r) => ({
    fecha: toIsoDate(r.FECHA),
    codAlmacen: r.CODALMACEN,
    // El getter Java concatena "(codAlmacen) nombre" -- se replica igual.
    nombreAlmacen: `(${r.CODALMACEN}) ${r.NOMBREALMACEN}`,
    observacion: r.OBSERVACION,
    fechaFin: r.FECHAFIN,
    idConteo: r.IDCONTEO,
  }));
}

async function cargarConteoCab(idConteo) {
  const pool = await getPool();
  const result = await pool.request()
    .input('idConteo', sql.Int, idConteo)
    .query(`
      SELECT CC.FECHA, ALM.CODALMACEN, ALM.NOMBREALMACEN, CC.OBSERVACION, CC.IDCONTEO,
        ISNULL(FORMAT(CC.FECHAFIN,'d','es-VE'),'EN PROCESO') FECHAFIN
      FROM rip.CONTEOCAB CC WITH(NOLOCK)
      INNER JOIN dbo.ALMACEN ALM WITH(NOLOCK) ON CC.CODALMACEN = ALM.CODALMACEN COLLATE Latin1_General_CS_AI
      WHERE CC.IDCONTEO = @idConteo
    `);
  if (result.recordset.length === 0) return null;
  const r = result.recordset[0];
  return {
    fecha: r.FECHA, // Date real, se usa tal cual para alimentar el SP
    codAlmacen: r.CODALMACEN,
    nombreAlmacen: r.NOMBREALMACEN,
    observacion: r.OBSERVACION,
    fechaFin: r.FECHAFIN,
    idConteo: r.IDCONTEO,
  };
}

function conteoCabToJson(cab) {
  return {
    fecha: toIsoDate(cab.fecha),
    codAlmacen: cab.codAlmacen,
    nombreAlmacen: `(${cab.codAlmacen}) ${cab.nombreAlmacen}`,
    observacion: cab.observacion,
    fechaFin: cab.fechaFin,
    idConteo: cab.idConteo,
  };
}

export async function obtenerDetalleConteo(idConteo, params = {}) {
  const {
    zona = 'TODO',
    sector = -1,
    codUsuario = -1,
    esConteoTotal = false,
    mostrarSoloDiferencias = false,
    codConcepto = -1,
  } = params;

  const cab = await cargarConteoCab(idConteo);
  if (!cab) return []; // el original atrapa cualquier excepcion y devuelve lista vacia

  const pool = await getPool();
  const request = pool.request();
  request.input('FECHA', sql.Date, cab.fecha);
  request.input('ALMACEN', sql.NVarChar(3), cab.codAlmacen);
  request.input('ZONA', sql.NVarChar(50), zona);
  request.input('SECTOR', sql.Int, Number(sector));
  request.input('CODUSUARIO', sql.Int, Number(codUsuario));
  request.input('ESTOTAL', sql.Bit, toBit(esConteoTotal));
  request.input('SOLODIFERENCIAS', sql.Bit, toBit(mostrarSoloDiferencias));
  request.input('CODCONCEPTO', sql.Int, Number(codConcepto));

  const result = await request.execute('rip.APP_CONTEO_GETCONTEO');
  const conteoCab = conteoCabToJson(cab);

  return result.recordset.map((r) => ({
    conteoCab,
    id: 0,
    articulo: {
      codArticulo: r.CODARTICULO,
      color: r.COLOR,
      talla: r.TALLA,
      departamento: r.DEPARTAMENTO,
      seccion: r.SECCION,
      referencia: r.REFPROVEEDOR,
      norma: r.NORMA,
      descripcion: r.DESCRIPCION,
      codBarras: r.CODBARRAS,
    },
    unidades: r.UNIDADES,
    vendidas: r.VENDIDAS,
    vendidasReal: r.VENTA_REAL,
    stock: r.STOCK,
    // Agregado 2026-07-16 (ver memoria stock-mermas-conteo): stock del almacen
    // de mermas de la tienda, ya presente en el SP parcheado.
    stockMermas: r.STOCKMERMAS,
    diferencia: r.PORCONTAR,
    horaConteo: null,
    zona: null,
    sector: 1,
    codUsuario: 0,
    codConcepto: 1,
  }));
}

export async function getResumenEnvios(idConteo) {
  const pool = await getPool();
  const result = await pool.request()
    .input('idConteo', sql.Int, idConteo)
    .query(`
      SELECT CE.ID, CE.IP, CE.PROCESADO,
        FORMAT(CE.HORAGENERADO,'d','es-VE') + ' ' + FORMAT(CE.HORAGENERADO,'t','es-VE') HORAGENERADO,
        FORMAT(CE.HORAPROCESADO,'d','es-VE') + ' ' + FORMAT(CE.HORAPROCESADO,'t','es-VE') HORAPROCESADO,
        V.NOMVENDEDOR USUARIO, ISNULL(CE.UNIDADES,0) UNIDADES
      FROM rip.CONTEO_ENVIOS CE WITH(NOLOCK)
      LEFT JOIN VENDEDORES V WITH(NOLOCK) ON CE.CODUSUARIO = V.CODVENDEDOR
      WHERE CE.IDCONTEO = @idConteo
      ORDER BY CE.HORAPROCESADO DESC
    `);
  return result.recordset.map((r) => ({
    idEnvio: r.ID,
    ip: r.IP,
    procesado: r.PROCESADO,
    horaGenerado: r.HORAGENERADO,
    horaProcesado: r.HORAPROCESADO,
    usuario: r.USUARIO,
    unidades: r.UNIDADES,
  }));
}

export async function obtenerFiltroConteo(idConteo) {
  const pool = await getPool();

  const zonasResult = await pool.request()
    .input('idConteo', sql.Int, idConteo)
    .query(`
      SELECT CL.ZONA, CL.SECTOR
      FROM rip.CONTEOCAB CC WITH(NOLOCK)
      INNER JOIN rip.CONTEOLIN CL WITH(NOLOCK) ON CC.FECHA=CL.FECHA AND CC.CODALMACEN=CL.CODALMACEN
      WHERE CC.IDCONTEO=@idConteo
      GROUP BY CL.ZONA, CL.SECTOR ORDER BY CL.ZONA, CL.SECTOR
    `);
  const zonas = [{ zona: 'TODO', sectores: [-1] }];
  const zonaMap = new Map();
  for (const r of zonasResult.recordset) {
    if (!zonaMap.has(r.ZONA)) {
      const entry = { zona: r.ZONA, sectores: [] };
      zonaMap.set(r.ZONA, entry);
      zonas.push(entry);
    }
    zonaMap.get(r.ZONA).sectores.push(r.SECTOR);
  }

  const usuariosResult = await pool.request()
    .input('idConteo', sql.Int, idConteo)
    .query(`
      SELECT V.CODVENDEDOR, V.NOMVENDEDOR
      FROM rip.CONTEOCAB CC WITH(NOLOCK)
      INNER JOIN rip.CONTEOLIN CL WITH(NOLOCK) ON CC.FECHA=CL.FECHA AND CC.CODALMACEN=CL.CODALMACEN
      INNER JOIN dbo.VENDEDORES V WITH(NOLOCK) ON CL.CODUSUARIO=V.CODVENDEDOR
      WHERE CC.IDCONTEO=@idConteo
      GROUP BY V.CODVENDEDOR, V.NOMVENDEDOR ORDER BY V.CODVENDEDOR
    `);
  const usuarios = [
    { codUsuario: -1, usuario: 'TODOS' },
    ...usuariosResult.recordset.map((r) => ({ codUsuario: r.CODVENDEDOR, usuario: r.NOMVENDEDOR })),
  ];

  const conceptosResult = await pool.request()
    .input('idConteo', sql.Int, idConteo)
    .query(`
      SELECT C.CODCONCEPTO, C.CONCEPTO
      FROM rip.CONTEOCAB CC WITH(NOLOCK)
      INNER JOIN rip.CONTEOLIN CL WITH(NOLOCK) ON CC.FECHA=CL.FECHA AND CC.CODALMACEN=CL.CODALMACEN
      INNER JOIN rip.CONCEPTOS_CONTEO C WITH(NOLOCK) ON CL.CODCONCEPTO=C.CODCONCEPTO
      WHERE CC.IDCONTEO=@idConteo
      GROUP BY C.CODCONCEPTO, C.CONCEPTO ORDER BY C.CODCONCEPTO
    `);
  const conceptos = [
    { codConcepto: -1, concepto: 'TODOS' },
    ...conceptosResult.recordset.map((r) => ({ codConcepto: r.CODCONCEPTO, concepto: r.CONCEPTO })),
  ];

  return { zonas, usuarios, conteoTotal: false, mostarSoloDiferencias: false, conceptos };
}

export async function obtenerConteoArticulo({ fecha, codAlmacen, codArticulo, talla, color }) {
  const pool = await getPool();

  const headerRequest = pool.request();
  headerRequest.input('FECHA', sql.Date, fecha);
  headerRequest.input('ALMACEN', sql.NVarChar(3), codAlmacen);
  headerRequest.input('CODARTICULO', sql.Int, Number(codArticulo));
  headerRequest.input('COLOR', sql.NVarChar(10), color);
  headerRequest.input('TALLA', sql.NVarChar(10), talla);
  const headerResult = await headerRequest.execute('rip.APP_CONTEO_DETALLE_ARTICULO');

  if (headerResult.recordset.length === 0) {
    // El original nunca entra al bloque de mapeo si el SP no devuelve fila (no
    // es una excepcion): todos los campos quedan en sus defaults, no en null.
    return {
      cabecera: null,
      articulo: null,
      contado: 0,
      stock: 0,
      vendidas: 0,
      diferencia: 0,
      detalle: null,
    };
  }
  const h = headerResult.recordset[0];

  const linesRequest = pool.request();
  linesRequest.input('FECHA', sql.Date, fecha);
  linesRequest.input('ALMACEN', sql.NVarChar(3), codAlmacen);
  linesRequest.input('CODARTICULO', sql.Int, Number(codArticulo));
  linesRequest.input('COLOR', sql.NVarChar(10), color);
  linesRequest.input('TALLA', sql.NVarChar(10), talla);
  const linesResult = await linesRequest.execute('rip.APP_CONTEO_GETCONTEO_ARTICULO');

  return {
    // El original no llama loadConteo() en este flujo, asi que solo fecha/codAlmacen
    // quedan poblados en la cabecera (igual que en produccion hoy).
    cabecera: {
      fecha,
      codAlmacen,
      nombreAlmacen: null,
      observacion: null,
      fechaFin: null,
      idConteo: 0,
    },
    articulo: {
      codArticulo: Number(codArticulo),
      color,
      talla,
      seccion: h.SECCION,
      referencia: h.REFPROVEEDOR,
      descripcion: h.DESCRIPCION,
      codBarras: h.CODBARRAS,
    },
    contado: h.CONTADO,
    stock: h.STOCK,
    vendidas: h.VENDIDAS,
    diferencia: h.DIFERENCIA,
    detalle: linesResult.recordset.map((r) => ({
      id: r.ID,
      codArticulo: r.CODARTICULO,
      color: r.COLOR,
      talla: r.TALLA,
      codBarras: r.CODBARRAS,
      codBarras2: r.CODBARRAS2,
      unidades: r.UNIDADES,
      horaConteo: r.HORACONTEO,
      zona: r.ZONA,
      usuario: r.USUARIO,
      concepto: r.CONCEPTO,
    })),
  };
}

export async function eliminarRegistro(id) {
  const pool = await getPool();
  await pool.request().input('id', sql.Int, Number(id)).query('DELETE FROM rip.CONTEOLIN WHERE ID=@id');
  return { success: true, respuesta: 'Linea eliminada satisfactoriamente' };
}

export async function actualizarConteoArticulo({ id, unidades, codUsuario }) {
  const pool = await getPool();
  await pool.request()
    .input('unidades', sql.Float, Number(unidades))
    .input('codUsuario', sql.Int, Number(codUsuario))
    .input('id', sql.Int, Number(id))
    .query('UPDATE rip.CONTEOLIN SET UNIDADES=@unidades, CODUSUARIO=@codUsuario WHERE ID=@id');
  return { success: true, respuesta: 'Registro actualizado satisfactoriamente' };
}

export async function eliminarConteo(idConteo) {
  const pool = await getPool();

  // Mismo chequeo de existencia que el Java original (ConteoCab.loadConteo):
  // el INNER JOIN contra ALMACEN es parte de la condicion, no un detalle
  // decorativo -- si no hay fila correspondiente en ALMACEN, el original
  // tampoco encuentra el conteo y rechaza el borrado.
  const cab = await cargarConteoCab(idConteo);
  if (!cab) {
    throw new Error('El conteo a eliminar no existe');
  }
  const { fecha, codAlmacen } = cab;

  // El Java original hace estos 3 DELETE sin transaccion (hallazgo de la
  // migracion). Aca si se envuelven en una transaccion real -- mismo efecto neto
  // en exito, pero atomico si algo falla a mitad de camino.
  const transaction = new sql.Transaction(pool);
  await transaction.begin();
  try {
    await new sql.Request(transaction)
      .input('fecha', sql.Date, fecha)
      .input('codAlmacen', sql.NVarChar(3), codAlmacen)
      .query('DELETE FROM rip.CONTEOLIN WHERE FECHA=@fecha AND CODALMACEN=@codAlmacen');

    await new sql.Request(transaction)
      .input('fecha', sql.Date, fecha)
      .input('codAlmacen', sql.NVarChar(3), codAlmacen)
      .query(`
        DELETE CE FROM rip.CONTEO_ENVIOS CE
        INNER JOIN rip.CONTEOCAB CC ON CE.IDCONTEO = CC.IDCONTEO
        WHERE CC.FECHA=@fecha AND CC.CODALMACEN=@codAlmacen
      `);

    await new sql.Request(transaction)
      .input('fecha', sql.Date, fecha)
      .input('codAlmacen', sql.NVarChar(3), codAlmacen)
      .query('DELETE FROM rip.CONTEOCAB WHERE FECHA=@fecha AND CODALMACEN=@codAlmacen');

    await transaction.commit();
  } catch (err) {
    await transaction.rollback();
    throw err;
  }

  return { success: true, respuesta: 'Conteo eliminado satisfactoriamente' };
}

export async function hayVentaEspera() {
  const pool = await getPool();
  await pool.request().query("SELECT * FROM ALBVENTACAB WITH(NOLOCK) WHERE NUMSERIE='****'");
  // NOTA: el metodo Java original nunca asigna `true` a su valor de retorno --
  // siempre devuelve false sin importar si existen ventas en espera. Se preserva
  // ese comportamiento (bug conocido, ver hallazgos de la migracion) hasta que
  // se decida explicitamente corregirlo.
  return false;
}

function buildFiltroWhere(request, filtro = {}) {
  let where = '';
  const num = (v) => (v === undefined || v === null || v === '' ? 0 : Number(v));

  if (num(filtro.departamento) > 0) {
    request.input('departamento', sql.Int, num(filtro.departamento));
    where += ' AND ART.DPTO = @departamento';
  }
  if (num(filtro.seccion) > 0) {
    request.input('seccion', sql.Int, num(filtro.seccion));
    where += ' AND ART.SECCION = @seccion';
  }
  if (num(filtro.familia) > 0) {
    request.input('familia', sql.Int, num(filtro.familia));
    where += ' AND ART.FAMILIA = @familia';
  }
  if (num(filtro.subFamilia) > 0) {
    request.input('subFamilia', sql.Int, num(filtro.subFamilia));
    where += ' AND ART.SUBFAMILIA = @subFamilia';
  }
  if (num(filtro.marca) > 0) {
    request.input('marca', sql.Int, num(filtro.marca));
    where += ' AND ART.MARCA = @marca';
  }
  if (num(filtro.linea) > 0) {
    request.input('linea', sql.Int, num(filtro.linea));
    where += ' AND ART.LINEA = @linea';
  }
  if (num(filtro.stockMayorQue) > 0) {
    request.input('stockMayorQue', sql.Float, num(filtro.stockMayorQue));
    where += ' AND ST.STOCK > @stockMayorQue';
  }
  if (num(filtro.stockMenorQue) > 0) {
    request.input('stockMenorQue', sql.Float, num(filtro.stockMenorQue));
    where += ' AND ST.STOCK < @stockMenorQue';
  }
  const incluirDescatalogados = filtro.incluirDescatalogados === true || filtro.incluirDescatalogados === 'true';
  if (!incluirDescatalogados) {
    where += " AND ART.DESCATALOGADO='F'";
  }
  if (filtro.comienzaPor) {
    request.input('comienzaPor', sql.NVarChar(102), `${sanitizeLike(String(filtro.comienzaPor).trim().toUpperCase())}%`);
    where += ' AND LTRIM(RTRIM(UPPER(ART.DESCRIPCION))) LIKE @comienzaPor';
  }
  if (filtro.terminaEn) {
    request.input('terminaEn', sql.NVarChar(102), `%${sanitizeLike(String(filtro.terminaEn).trim().toUpperCase())}`);
    where += ' AND LTRIM(RTRIM(UPPER(ART.DESCRIPCION))) LIKE @terminaEn';
  }
  if (filtro.contiene) {
    request.input('contiene', sql.NVarChar(102), `%${sanitizeLike(String(filtro.contiene).trim().toUpperCase())}%`);
    where += ' AND LTRIM(RTRIM(UPPER(ART.DESCRIPCION))) LIKE @contiene';
  }
  return where;
}

function mapArticuloJson(r) {
  return {
    codArticulo: r.CODARTICULO,
    seccion: r.SECCION,
    referencia: r.REFPROVEEDOR,
    descripcion: r.DESCRIPCION,
    talla: r.TALLA,
    color: r.COLOR,
    norma: r.NORMA,
    codBarras: r.CODBARRAS,
    codBarras2: r.CODBARRAS2,
    codBarras3: r.CODBARRAS3,
    stock: r.STOCK,
  };
}

const ARTICULOS_SELECT = `
  ART.CODARTICULO, ISNULL(SEC.DESCRIPCION,'ND') SECCION, ISNULL(ART.REFPROVEEDOR,'') REFPROVEEDOR,
  ISNULL(ART.DESCRIPCION,'') DESCRIPCION, ISNULL(AL.COLOR,'') COLOR, ISNULL(AL.TALLA,'') TALLA,
  ISNULL(ART.NORMA,'') NORMA, ISNULL(AL.CODBARRAS,'') CODBARRAS, ISNULL(AL.CODBARRAS2,'') CODBARRAS2,
  ISNULL(AL.CODBARRAS3,'') CODBARRAS3, ISNULL(ST.STOCK,0) STOCK
`;
const ARTICULOS_WHERE_BASE = `
  WHERE ART.TIPOARTICULO='A' AND ART.USASTOCKS='T' AND ART.CODARTICULO>0
    AND ((ART.USARNUMSERIE='T' AND AL.TALLA='@') OR ART.USARNUMSERIE='F')
`;

// Catalogo completo de articulos con stock (usado por la app movil antes de
// permitir iniciar un conteo nuevo / busqueda libre). Requiere codAlmacen.
export async function obtenerArticulosCatalogo(filtro = {}) {
  if (!filtro.codAlmacen) {
    const err = new Error("El parámetro 'codAlmacen' es obligatorio.");
    err.status = 400;
    throw err;
  }
  const pool = await getPool();
  const request = pool.request();
  request.input('codAlmacenStock', sql.NVarChar(3), filtro.codAlmacen);
  const where = buildFiltroWhere(request, filtro);

  const result = await request.query(`
    SELECT ${ARTICULOS_SELECT}
    FROM ARTICULOS ART WITH(NOLOCK)
      INNER JOIN ARTICULOSLIN AL WITH(NOLOCK) ON ART.CODARTICULO=AL.CODARTICULO
      LEFT JOIN SECCIONES SEC WITH(NOLOCK) ON ART.DPTO=SEC.NUMDPTO AND ART.SECCION=SEC.NUMSECCION
      LEFT JOIN STOCKS ST WITH(NOLOCK) ON AL.CODARTICULO=ST.CODARTICULO AND AL.COLOR=ST.COLOR AND AL.TALLA=ST.TALLA AND ST.CODALMACEN=@codAlmacenStock
    ${ARTICULOS_WHERE_BASE}
    ${where}
  `);
  return result.recordset.map(mapArticuloJson);
}

// Version en streaming de obtenerArticulosCatalogo -- mismo motivo que
// streamArticulosDeConteo/streamResumenConteoArticulos (medido en real: 31.6s
// sin streaming vs. bytes casi inmediatos con streaming).
export async function streamArticulosCatalogo(res, filtro = {}) {
  if (!filtro.codAlmacen) {
    const err = new Error("El parámetro 'codAlmacen' es obligatorio.");
    err.status = 400;
    throw err;
  }
  const pool = await getPool();
  const request = pool.request();
  request.input('codAlmacenStock', sql.NVarChar(3), filtro.codAlmacen);
  const where = buildFiltroWhere(request, filtro);
  request.stream = true;

  return new Promise((resolve, reject) => {
    let first = true;
    let started = false;

    request.on('row', (row) => {
      if (!started) {
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.write('[');
        started = true;
      }
      if (!first) res.write(',');
      first = false;
      res.write(JSON.stringify(mapArticuloJson(row)));
    });
    request.on('error', (err) => reject(err));
    request.on('done', () => {
      if (!started) res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.write(started ? ']' : '[]');
      res.end();
      resolve();
    });

    request.query(`
      SELECT ${ARTICULOS_SELECT}
      FROM ARTICULOS ART WITH(NOLOCK)
        INNER JOIN ARTICULOSLIN AL WITH(NOLOCK) ON ART.CODARTICULO=AL.CODARTICULO
        LEFT JOIN SECCIONES SEC WITH(NOLOCK) ON ART.DPTO=SEC.NUMDPTO AND ART.SECCION=SEC.NUMSECCION
        LEFT JOIN STOCKS ST WITH(NOLOCK) ON AL.CODARTICULO=ST.CODARTICULO AND AL.COLOR=ST.COLOR AND AL.TALLA=ST.TALLA AND ST.CODALMACEN=@codAlmacenStock
      ${ARTICULOS_WHERE_BASE}
      ${where}
    `).catch(reject);
  });
}

// Articulos "target" de un conteo especifico (lo que la app movil descarga
// antes de empezar a contar). Requiere codAlmacen + idConteo.
export async function obtenerArticulosDeConteo(filtro = {}) {
  if (!filtro.codAlmacen) {
    const err = new Error("El parámetro 'codAlmacen' es obligatorio.");
    err.status = 400;
    throw err;
  }
  if (!filtro.idConteo) {
    const err = new Error("El parámetro 'idConteo' es obligatorio.");
    err.status = 400;
    throw err;
  }
  const pool = await getPool();
  const request = pool.request();
  request.input('idConteo', sql.Int, Number(filtro.idConteo));
  request.input('codAlmacenStock', sql.NVarChar(3), filtro.codAlmacen);
  const where = buildFiltroWhere(request, filtro);

  const result = await request.query(`
    SELECT ${ARTICULOS_SELECT}
    FROM ARTICULOS ART WITH(NOLOCK)
      INNER JOIN rip.CONTEO_TARGET CT WITH(NOLOCK) ON ART.CODARTICULO=CT.CODARTICULO AND CT.IDCONTEO=@idConteo
      INNER JOIN ARTICULOSLIN AL WITH(NOLOCK) ON ART.CODARTICULO=AL.CODARTICULO
      LEFT JOIN SECCIONES SEC WITH(NOLOCK) ON ART.DPTO=SEC.NUMDPTO AND ART.SECCION=SEC.NUMSECCION
      LEFT JOIN STOCKS ST WITH(NOLOCK) ON AL.CODARTICULO=ST.CODARTICULO AND AL.COLOR=ST.COLOR AND AL.TALLA=ST.TALLA AND ST.CODALMACEN=@codAlmacenStock
    ${ARTICULOS_WHERE_BASE}
    ${where}
  `);
  return result.recordset.map(mapArticuloJson);
}

// Version en streaming de obtenerArticulosDeConteo: escribe directo a la
// respuesta HTTP fila por fila conforme SQL Server las entrega, en vez de
// armar los ~300k objetos en memoria y responder todo de un tiron. Mismo
// contenido final (un array JSON de ArticuloJson), pero el dispositivo movil
// empieza a recibir bytes casi de inmediato -- si su timeout es por
// inactividad (lo tipico), esto evita que corte la conexion antes de terminar.
export async function streamArticulosDeConteo(res, filtro = {}) {
  if (!filtro.codAlmacen) {
    const err = new Error("El parámetro 'codAlmacen' es obligatorio.");
    err.status = 400;
    throw err;
  }
  if (!filtro.idConteo) {
    const err = new Error("El parámetro 'idConteo' es obligatorio.");
    err.status = 400;
    throw err;
  }

  const pool = await getPool();
  const request = pool.request();
  request.input('idConteo', sql.Int, Number(filtro.idConteo));
  request.input('codAlmacenStock', sql.NVarChar(3), filtro.codAlmacen);
  const where = buildFiltroWhere(request, filtro);
  request.stream = true;

  return new Promise((resolve, reject) => {
    let first = true;
    let started = false;

    request.on('row', (row) => {
      if (!started) {
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.write('[');
        started = true;
      }
      if (!first) res.write(',');
      first = false;
      res.write(JSON.stringify(mapArticuloJson(row)));
    });
    request.on('error', (err) => reject(err));
    request.on('done', () => {
      if (!started) res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.write(started ? ']' : '[]');
      res.end();
      resolve();
    });

    request.query(`
      SELECT ${ARTICULOS_SELECT}
      FROM ARTICULOS ART WITH(NOLOCK)
        INNER JOIN rip.CONTEO_TARGET CT WITH(NOLOCK) ON ART.CODARTICULO=CT.CODARTICULO AND CT.IDCONTEO=@idConteo
        INNER JOIN ARTICULOSLIN AL WITH(NOLOCK) ON ART.CODARTICULO=AL.CODARTICULO
        LEFT JOIN SECCIONES SEC WITH(NOLOCK) ON ART.DPTO=SEC.NUMDPTO AND ART.SECCION=SEC.NUMSECCION
        LEFT JOIN STOCKS ST WITH(NOLOCK) ON AL.CODARTICULO=ST.CODARTICULO AND AL.COLOR=ST.COLOR AND AL.TALLA=ST.TALLA AND ST.CODALMACEN=@codAlmacenStock
      ${ARTICULOS_WHERE_BASE}
      ${where}
    `).catch(reject);
  });
}

async function llenarConteoTarget(idConteo, codAlmacen, filtro) {
  const pool = await getPool();
  const request = pool.request();
  request.input('idConteo', sql.Int, idConteo);
  request.input('codAlmacenStock', sql.NVarChar(3), codAlmacen);
  const where = buildFiltroWhere(request, filtro);

  await request.query(`
    INSERT INTO rip.CONTEO_TARGET(IDCONTEO, CODARTICULO, ASIGNADO, BLOQUE, IDBLOQUE)
    SELECT @idConteo, ART.CODARTICULO, 0, 1, NULL
    FROM ARTICULOS ART WITH(NOLOCK)
      LEFT JOIN STOCKS ST WITH(NOLOCK) ON ART.CODARTICULO = ST.CODARTICULO AND ST.CODALMACEN = @codAlmacenStock
      LEFT JOIN rip.CONTEO_TARGET CT WITH(NOLOCK) ON ART.CODARTICULO = CT.CODARTICULO AND CT.IDCONTEO = @idConteo
    WHERE ART.USASTOCKS='T'
      ${where}
      AND CT.CODARTICULO IS NULL
    GROUP BY ART.CODARTICULO
  `);
}

export async function crearConteo({ fecha, codAlmacen, observacion, filtro = {} }) {
  const pool = await getPool();

  await pool.request()
    .input('fecha', sql.Date, fecha)
    .input('codAlmacen', sql.NVarChar(3), codAlmacen)
    .input('observacion', sql.NVarChar(50), (observacion || '').trim().toUpperCase())
    .input('tipoConteo', sql.Int, 1)
    .query(`
      INSERT INTO rip.CONTEOCAB(FECHA, CODALMACEN, OBSERVACION, FECHAINICIO, IDCONTEO, IDTIPOCONTEO)
      SELECT @fecha, @codAlmacen, @observacion, GETDATE(), ISNULL((SELECT MAX(IDCONTEO) FROM rip.CONTEOCAB WITH(NOLOCK)),0)+1, @tipoConteo;

      DELETE FROM rip.CONTEOSTOCK WHERE CODALMACEN=@codAlmacen AND FECHA=@fecha;

      INSERT INTO rip.CONTEOSTOCK
      SELECT @codAlmacen, @fecha, CODARTICULO, COLOR, TALLA, STOCK
      FROM rip.RIP_FSTOCK_ARTICULO_FECHA(DATEADD(DAY,-1,@fecha), @codAlmacen);
    `);

  const idResult = await pool.request()
    .input('fecha', sql.Date, fecha)
    .input('codAlmacen', sql.NVarChar(3), codAlmacen)
    .query('SELECT IDCONTEO FROM rip.CONTEOCAB WHERE FECHA=@fecha AND CODALMACEN=@codAlmacen');
  const idConteo = idResult.recordset[0]?.IDCONTEO;

  await llenarConteoTarget(idConteo, codAlmacen, filtro);

  return { success: true, respuesta: 'Ok' };
}
