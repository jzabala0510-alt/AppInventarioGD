import { getPool, sql } from '../db/pool.js';
import { signToken } from '../middleware/auth.js';

// Mismo cifrado reversible de sustitucion que usa hoy el backend Java
// (Vendedor.encriptar/desEncriptar, clave fija "NORMALKEY" repetida como offsets
// ASCII). No es hashing real -- se preserva tal cual para no invalidar las
// contrasenas ya guardadas en VENDEDORES.NEWPASSENTRADA. Ver hallazgo de
// seguridad en la memoria de migracion; cambiar a bcrypt es una migracion de
// datos aparte, no de esta fase.
const OFFSETS = [78, 79, 82, 77, 65, 76, 75, 69, 89, 78, 79, 82, 77, 65, 76, 75, 69, 89, 78, 79, 82, 77, 65, 76, 75, 69, 89, 78, 79, 82, 77, 65, 76, 75, 69, 89, 78];

function encriptar(value) {
  let out = '';
  for (let i = 0; i < value.length; i++) {
    out += (value.charCodeAt(i) + OFFSETS[i]).toString(16).toUpperCase();
  }
  return out;
}

export async function login(codVendedor, password) {
  const pool = await getPool();
  const result = await pool.request()
    .input('codVendedor', sql.Int, Number(codVendedor))
    .input('passEncriptado', sql.NVarChar(100), encriptar(String(password)))
    .query('SELECT CODVENDEDOR FROM VENDEDORES WHERE CODVENDEDOR=@codVendedor AND NEWPASSENTRADA=@passEncriptado');

  if (result.recordset.length === 0) {
    return { success: false, respuesta: 'Datos incorrectos' };
  }
  return { success: true, respuesta: signToken(result.recordset[0].CODVENDEDOR) };
}

export async function listarVendedores() {
  const pool = await getPool();
  const request = pool.request();
  request.timeout = 3000; // mismo timeout explicito que el backend Java
  const result = await request.execute('ripWsRep.GET_VENDEDORES');

  return result.recordset.map((r) => ({
    codVendedor: r.CODVENDEDOR,
    nombreVendedor: r.NOMVENDEDOR,
    foto: r.FOTO ? Buffer.from(r.FOTO).toString('base64') : null,
    opciones: r.PERMISOS,
  }));
}
