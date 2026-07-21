import { getPool } from '../db/pool.js';

export async function listarAlmacenes() {
  const pool = await getPool();
  const result = await pool.request().execute('ripWsRep.GET_ALMACENES');
  return result.recordset.map((r) => ({
    codAlmacen: r.CODALMACEN,
    nombreAlmacen: r.NOMBREALMACEN,
    referencia: null,
    ubicacion: null,
  }));
}
