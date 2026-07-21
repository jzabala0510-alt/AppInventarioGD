import { getPool } from '../db/pool.js';

const QUERY = `
  SELECT
    DPTO.NUMDPTO, DPTO.DESCRIPCION AS DEPARTAMENTO,
    SEC.NUMSECCION, ISNULL(SEC.DESCRIPCION,'SIN SECCION') AS SECCION,
    FAM.NUMFAMILIA, ISNULL(FAM.DESCRIPCION,'SIN FAMILIA') AS FAMILIA,
    SFAM.NUMSUBFAMILIA AS NUMFAMILIA_SUBFAM, ISNULL(SFAM.DESCRIPCION,'SIN SUBFAMILIA') AS SUBFAMILIA
  FROM DEPARTAMENTO DPTO
    LEFT JOIN SECCIONES SEC ON DPTO.NUMDPTO = SEC.NUMDPTO
    LEFT JOIN FAMILIAS FAM ON SEC.NUMDPTO = FAM.NUMDPTO AND SEC.NUMSECCION = FAM.NUMSECCION
    LEFT JOIN SUBFAMILIAS SFAM ON FAM.NUMDPTO = SFAM.NUMDPTO AND FAM.NUMSECCION = SFAM.NUMSECCION AND FAM.NUMFAMILIA = SFAM.NUMFAMILIA
`;

// Reconstruye el arbol de 3 niveles (Depto->Seccion->Familia->SubFamilia) del
// join plano, igual que el Java original pero con Maps en vez de O(n^2).
function buildTree(rows) {
  const deptos = new Map();

  for (const r of rows) {
    if (!deptos.has(r.NUMDPTO)) {
      deptos.set(r.NUMDPTO, { numDpto: r.NUMDPTO, departamento: r.DEPARTAMENTO, secciones: new Map() });
    }
    const depto = deptos.get(r.NUMDPTO);

    if (r.NUMSECCION == null) continue;
    if (!depto.secciones.has(r.NUMSECCION)) {
      depto.secciones.set(r.NUMSECCION, { numSeccion: r.NUMSECCION, seccion: r.SECCION, familias: new Map() });
    }
    const seccion = depto.secciones.get(r.NUMSECCION);

    if (r.NUMFAMILIA == null) continue;
    if (!seccion.familias.has(r.NUMFAMILIA)) {
      seccion.familias.set(r.NUMFAMILIA, { numFamilia: r.NUMFAMILIA, familia: r.FAMILIA, subFamilias: new Map() });
    }
    const familia = seccion.familias.get(r.NUMFAMILIA);

    if (r.NUMFAMILIA_SUBFAM == null) continue;
    if (!familia.subFamilias.has(r.NUMFAMILIA_SUBFAM)) {
      familia.subFamilias.set(r.NUMFAMILIA_SUBFAM, { numSubFamilia: r.NUMFAMILIA_SUBFAM, subFamilia: r.SUBFAMILIA });
    }
  }

  return [...deptos.values()].map((d) => ({
    ...d,
    secciones: [...d.secciones.values()].map((s) => ({
      ...s,
      familias: [...s.familias.values()].map((f) => ({
        ...f,
        subFamilias: [...f.subFamilias.values()],
      })),
    })),
  }));
}

export async function listarDepartamentos() {
  const pool = await getPool();
  const result = await pool.request().query(QUERY);
  return buildTree(result.recordset);
}
