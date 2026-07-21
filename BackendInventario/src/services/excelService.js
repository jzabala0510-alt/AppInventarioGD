import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ExcelJS from 'exceljs';
import { getPool, sql } from '../db/pool.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TEMPLATE_PATH = path.join(__dirname, '..', 'resources', 'FORMATO_DIFERENCIAS.xlsx');

// Columna E ("Marca") nunca se llena con la marca real -- el Java original tiene
// un bug de copy-paste (usa Util.col("E") en vez de Util.col("R") al escribir
// ZONA_6), asi que la columna "Dotacion" (R) siempre queda vacia/en 0 y "Marca"
// (E) en realidad muestra el valor de zona 6. Jose pidio replicar esto tal cual,
// no corregirlo (ver memoria de migracion).
function llenarHojaDetalle(sheet, rows) {
  // El Java original lee estas columnas con rs.getDouble()/getInt(), que en JDBC
  // devuelve 0 (no null) cuando el valor SQL es NULL -- se replica esa coercion
  // aca explicitamente, si no las celdas quedarian vacias en vez de en 0.
  const num = (v) => v ?? 0;

  rows.forEach((r, i) => {
    const excelRow = i + 2;
    const row = sheet.getRow(excelRow);
    row.getCell('A').value = r.DEPARTAMENTO;
    row.getCell('B').value = r.SECCION;
    row.getCell('C').value = r.FAMILIA;
    row.getCell('D').value = r.SUBFAMILIA;
    row.getCell('E').value = num(r.ZONA_6); // bug preservado a proposito
    row.getCell('F').value = num(r.CODARTICULO);
    row.getCell('G').value = r.REFPROVEEDOR;
    row.getCell('H').value = r.DESCRIPCION;
    row.getCell('I').value = r.COLOR;
    row.getCell('J').value = r.TALLA;
    row.getCell('K').value = r.CODBARRAS;
    row.getCell('L').value = r.CODBARRAS2;
    row.getCell('M').value = num(r.ZONA_1);
    row.getCell('N').value = num(r.ZONA_2);
    row.getCell('O').value = num(r.ZONA_3);
    row.getCell('P').value = num(r.ZONA_4);
    row.getCell('Q').value = num(r.ZONA_5);
    // R ("Dotacion") nunca se escribe -- mismo bug que el original.
    row.getCell('S').value = num(r.ZONA_7);
    row.getCell('T').value = num(r.CONTADO);
    row.getCell('U').value = num(r.STOCK);
    row.getCell('V').value = num(r.VENDIDAS);
    row.getCell('W').value = num(r.DIFERENCIA);
    row.getCell('X').value = num(r.COSTOVEN);
    row.getCell('Y').value = num(r.COSTOVEN_DIFERENCIA);
    row.getCell('Z').value = { formula: `"1|" & F${excelRow} & "|" & J${excelRow} & "|" & I${excelRow} & "|" & (T${excelRow} + V${excelRow}) & "|0|0|0||"` };
    row.getCell('AA').value = { formula: `"1|" & F${excelRow} & "|" & J${excelRow} & "|" & I${excelRow} & "|" & (T${excelRow}) & "|0|0|0||"` };
    row.getCell('AB').value = { formula: `"1|" & F${excelRow} & "|" & J${excelRow} & "|" & I${excelRow} & "|" & (U${excelRow} - T${excelRow} - V${excelRow}) & "|0|0|0||"` };
  });

  const lastDataRow = rows.length + 1; // fila Excel de la ultima fila con datos
  const totalsRow = sheet.getRow(rows.length + 2);
  const totalCols = ['M', 'N', 'O', 'P', 'Q', 'R', 'S', 'T', 'U', 'V', 'W', 'Y'];
  for (const col of totalCols) {
    const cell = totalsRow.getCell(col);
    cell.value = { formula: `SUM(${col}2:${col}${lastDataRow})` };
    cell.numFmt = '#,##0.00';
  }
}

function llenarHojaResumen(sheet, rows) {
  rows.forEach((r, i) => {
    const row = sheet.getRow(i + 2);
    row.getCell('A').value = r.REFPROVEEDOR;
    row.getCell('B').value = r.DESCRIPCION;
    row.getCell('C').value = r.ESTILO;
    row.getCell('D').value = r.COLOR;
    row.getCell('E').value = r.TALLA;
    row.getCell('F').value = r.CODBARRAS;
    row.getCell('G').value = r.ZONA;
    row.getCell('H').value = r.SUBZONA;
    row.getCell('I').value = r.SECTOR;
    row.getCell('J').value = r.CONTEO ?? 0; // rs.getDouble() en el original -> 0 si es NULL
    row.getCell('K').value = r.NOMVENDEDOR;
  });
}

export async function generarExcelDiferencias(idConteo, params = {}) {
  const {
    zona = 'TODO',
    sector = -1,
    codUsuario = -1,
    esConteoTotal = false,
    mostrarSoloDiferencias = false,
    codConcepto = -1,
  } = params;

  const pool = await getPool();

  const cabResult = await pool.request()
    .input('idConteo', sql.Int, idConteo)
    .query(`
      SELECT CC.FECHA, ALM.CODALMACEN
      FROM rip.CONTEOCAB CC WITH(NOLOCK)
      INNER JOIN dbo.ALMACEN ALM WITH(NOLOCK) ON CC.CODALMACEN = ALM.CODALMACEN COLLATE Latin1_General_CS_AI
      WHERE CC.IDCONTEO = @idConteo
    `);
  if (cabResult.recordset.length === 0) {
    throw new Error('El conteo no existe');
  }
  const { FECHA: fecha, CODALMACEN: codAlmacen } = cabResult.recordset[0];

  const detalleRequest = pool.request();
  detalleRequest.input('FECHA', sql.Date, fecha);
  detalleRequest.input('ALMACEN', sql.NVarChar(3), codAlmacen);
  detalleRequest.input('ZONA', sql.NVarChar(50), zona);
  detalleRequest.input('SECTOR', sql.Int, Number(sector));
  detalleRequest.input('CODUSUARIO', sql.Int, Number(codUsuario));
  detalleRequest.input('ESTOTAL', sql.Bit, esConteoTotal ? 1 : 0);
  detalleRequest.input('SOLODIFERENCIAS', sql.Bit, mostrarSoloDiferencias ? 1 : 0);
  detalleRequest.input('CODCONCEPTO', sql.Int, Number(codConcepto));
  const detalleResult = await detalleRequest.execute('rip.APP_CONTEO_DETALLE_PTY');

  const resumenResult = await pool.request()
    .input('fecha', sql.Date, fecha)
    .input('codAlmacen', sql.NVarChar(3), codAlmacen)
    .query(`
      SELECT
        ART.REFPROVEEDOR, ART.DESCRIPCION, ISNULL(ART.NORMA,'') ESTILO,
        CASE WHEN AL.TALLA IN ('@') THEN '.' ELSE AL.COLOR END COLOR,
        CASE WHEN AL.TALLA IN ('@') THEN '.' ELSE AL.TALLA END TALLA,
        CASE WHEN AL.TALLA IN ('@') THEN '' ELSE AL.CODBARRAS END CODBARRAS,
        ISNULL(CC.CONCEPTO,'DESCONOCIDA') ZONA, CL.ZONA SUBZONA, CL.SECTOR,
        SUM(UNIDADES) CONTEO,
        ISNULL(V.NOMVENDEDOR,'No Definido ('+CAST(CL.CODUSUARIO AS NVARCHAR)+')') NOMVENDEDOR
      FROM rip.CONTEOLIN CL WITH(NOLOCK)
        INNER JOIN rip.CONCEPTOS_CONTEO CC WITH(NOLOCK) ON CL.CODCONCEPTO=CC.CODCONCEPTO
        LEFT JOIN dbo.VENDEDORES V WITH(NOLOCK) ON CL.CODUSUARIO=V.CODVENDEDOR
        INNER JOIN ARTICULOS ART WITH(NOLOCK) ON CL.CODARTICULO=ART.CODARTICULO
        INNER JOIN ARTICULOSLIN AL WITH(NOLOCK) ON CL.CODARTICULO=AL.CODARTICULO
          AND CL.COLOR=AL.COLOR COLLATE Latin1_General_CS_AI AND CL.TALLA=AL.TALLA COLLATE Latin1_General_CS_AI
      WHERE CL.FECHA=@fecha AND CL.CODALMACEN=@codAlmacen
      GROUP BY ART.REFPROVEEDOR, ART.DESCRIPCION, ART.NORMA, CL.ZONA, CL.SECTOR, V.NOMVENDEDOR, CL.CODUSUARIO, CC.CONCEPTO,
        CASE WHEN AL.TALLA IN ('@') THEN '.' ELSE AL.COLOR END,
        CASE WHEN AL.TALLA IN ('@') THEN '.' ELSE AL.TALLA END,
        CASE WHEN AL.TALLA IN ('@') THEN '' ELSE AL.CODBARRAS END
      ORDER BY REFPROVEEDOR, COLOR, TALLA, CC.CONCEPTO, CL.ZONA, SECTOR
    `);

  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(TEMPLATE_PATH);
  llenarHojaDetalle(workbook.getWorksheet('Detalle'), detalleResult.recordset);
  llenarHojaResumen(workbook.getWorksheet('Resumen'), resumenResult.recordset);

  return workbook.xlsx.writeBuffer();
}
