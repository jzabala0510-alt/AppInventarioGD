import { getPool } from '../db/pool.js';

const QUERY = `
  SELECT M.CODMARCA, M.DESCRIPCION MARCA, L.CODLINEA, ISNULL(L.DESCRIPCION,'SIN LINEA') AS LINEA
  FROM MARCA M LEFT JOIN LINEA L ON M.CODMARCA = L.CODMARCA
`;

// Reconstruye el arbol Marca->Lineas a partir del resultado plano del join,
// igual que hacia el Java original pero con un Map en vez de busqueda lineal.
function buildTree(rows) {
  const marcas = new Map();
  for (const r of rows) {
    if (!marcas.has(r.CODMARCA)) {
      marcas.set(r.CODMARCA, { numMarca: r.CODMARCA, marca: r.MARCA, lineas: [] });
    }
    if (r.CODLINEA != null) {
      marcas.get(r.CODMARCA).lineas.push({ numLinea: r.CODLINEA, linea: r.LINEA });
    }
  }
  return [...marcas.values()];
}

export async function listarMarcas() {
  const pool = await getPool();
  const result = await pool.request().query(QUERY);
  return buildTree(result.recordset);
}
