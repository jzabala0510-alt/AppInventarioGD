// Valida ejecutarScriptAlArranque() y enSerie() (sqlConfigService.js). Caso
// real 15-oct-2026: probando el instalador contra un servidor de pruebas la primera
// conexion agotaba los 30 s de connectionTimeout, el script de estructura se
// intentaba UNA sola vez al arrancar y quedaba omitido hasta reiniciar el
// servicio. No necesita BD: usa un ejecutor falso y esperas de milisegundos.
// (La prueba de punta a punta contra una BD real se hace arrancando el
// backend con la BD inaccesible y luego accesible, mirando logs/backend.log.)
//
// Uso: node test-fixtures/sql/validar_script_arranque.js  (desde BackendInventario/)
import { ejecutarScriptAlArranque, enSerie } from '../../src/services/sqlConfigService.js';

let fallas = 0;
function check(etiqueta, cond) {
  if (!cond) { fallas++; console.log(`FALLA: ${etiqueta}`); } else { console.log(`OK: ${etiqueta}`); }
}
const dormir = (ms) => new Promise((r) => setTimeout(r, ms));

// 1. Falla dos veces (BD que no responde) y a la tercera conecta.
{
  let llamadas = 0;
  const lineas = [];
  await ejecutarScriptAlArranque({
    ejecutar: async () => { llamadas++; if (llamadas < 3) throw new Error('Failed to connect in 30000ms'); },
    yaAplicado: () => false,
    esperas: [5, 10],
    registrar: (l) => lineas.push(l),
  });
  check('reintenta hasta lograrlo (3 intentos)', llamadas === 3);
  check('deja constancia del exito con el numero de intento', lineas.some((l) => l.includes('correctamente') && l.includes('intento 3')));
  check('el mismo error repetido se registra una sola vez', lineas.filter((l) => l.includes('fallo')).length === 1);
}

// 2. Si el error cambia, si se registra de nuevo.
{
  let llamadas = 0;
  const lineas = [];
  await ejecutarScriptAlArranque({
    ejecutar: async () => { llamadas++; if (llamadas === 1) throw new Error('A'); if (llamadas === 2) throw new Error('B'); },
    yaAplicado: () => false,
    esperas: [5],
    registrar: (l) => lineas.push(l),
  });
  check('errores distintos se registran por separado', lineas.filter((l) => l.includes('fallo')).length === 2);
}

// 3. Primer intento OK: mensaje de siempre, sin "intento".
{
  const lineas = [];
  await ejecutarScriptAlArranque({ ejecutar: async () => {}, yaAplicado: () => false, esperas: [5], registrar: (l) => lineas.push(l) });
  check('primer intento OK usa el mensaje de siempre', lineas.length === 1 && lineas[0] === 'Script de BD ejecutado correctamente al arranque');
}

// 4. Mientras espera, alguien guarda la conexion (que ya corre el script):
// el reintento se detiene sin volver a ejecutarlo.
{
  let llamadas = 0;
  let aplicado = false;
  const lineas = [];
  const p = ejecutarScriptAlArranque({
    ejecutar: async () => { llamadas++; throw new Error('sin conexion'); },
    yaAplicado: () => aplicado,
    esperas: [30],
    registrar: (l) => lineas.push(l),
  });
  await dormir(10);
  aplicado = true;
  await p;
  check('se detiene si el script ya se aplico por otra via', llamadas === 1 && lineas.some((l) => l.includes('otra via')));
}

// 5. enSerie: dos llamadas simultaneas nunca se solapan (el DELETE + INSERT
// de rip.CONCEPTOS_CONTEO choca si corren a la vez), y un fallo no traba a
// la siguiente.
{
  let activas = 0;
  let maxActivas = 0;
  let n = 0;
  const serie = enSerie(async () => {
    activas++; maxActivas = Math.max(maxActivas, activas);
    await dormir(20);
    activas--;
    if (++n === 1) throw new Error('falla la primera');
    return n;
  });
  const resultados = await Promise.allSettled([serie(), serie(), serie()]);
  check('nunca hay dos corridas a la vez', maxActivas === 1);
  check('el fallo de la primera no impide las siguientes',
    resultados[0].status === 'rejected' && resultados[1].value === 2 && resultados[2].value === 3);
}

console.log(fallas ? `\n${fallas} falla(s)` : '\nTodo OK');
process.exit(fallas ? 1 : 0);
