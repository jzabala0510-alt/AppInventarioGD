// Cifrado reversible de sustitucion usado por el backend Java original para la
// contrasena de conexion a SQL Server (ConexionBD.java / conexionbd.Conector.java).
// NO es el mismo array que el de login de vendedor (vendedorService.js) -- el
// original tenia una copia independiente y mas larga (111 offsets) en esta clase;
// se preserva tal cual, extraida y verificada contra las contrasenas reales de
// passbd.json (incluyendo el default conocido "M4st3rk3y..").
const OFFSETS = [
  78, 79, 82, 77, 65, 76, 75, 69, 89, 78, 79, 82, 77, 65, 76, 75, 69, 89, 78, 79, 82, 77, 65, 76, 75, 69, 89, 78, 79,
  82, 77, 65, 76, 75, 69, 89, 78, 78, 79, 82, 77, 65, 76, 75, 69, 89, 78, 79, 82, 77, 65, 76, 75, 69, 89, 78, 79, 82,
  77, 65, 76, 75, 69, 89, 78, 79, 82, 77, 65, 76, 75, 69, 89, 78, 78, 79, 82, 77, 65, 76, 75, 69, 89, 78, 79, 82, 77,
  65, 76, 75, 69, 89, 78, 79, 82, 77, 65, 76, 75, 69, 89, 78, 79, 82, 77, 65, 76, 75, 69, 89, 78,
];

export function encriptar(value) {
  let out = '';
  for (let i = 0; i < value.length; i++) {
    out += (value.charCodeAt(i) + OFFSETS[i]).toString(16).toUpperCase();
  }
  return out;
}

export function desEncriptar(value) {
  let out = '';
  let j = 0;
  for (let i = 0; i < value.length; i += 2) {
    out += String.fromCharCode(parseInt(value.substring(i, i + 2), 16) - OFFSETS[j]);
    j++;
  }
  return out;
}
