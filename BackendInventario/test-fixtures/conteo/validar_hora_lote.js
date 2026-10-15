// Valida horaConteoParaSql() (conteoBatchService.js) -- la hora del escaneo
// que manda AlmacenesApp en el lote offline. Bug real confirmado 15-oct-2026:
// la hora local del celular se guardaba en UTC (4 horas adelantada) porque
// pasaba por new Date() + sql.DateTime con useUTC=true. No necesita BD: es
// manejo de texto puro, y no debe depender de la zona horaria del servidor.
//
// Uso: node test-fixtures/conteo/validar_hora_lote.js  (desde BackendInventario/)
// Probarlo tambien con otra zona: TZ=Asia/Tokyo node test-fixtures/conteo/validar_hora_lote.js
import { horaConteoParaSql } from '../../src/services/conteoBatchService.js';

let fallas = 0;
function check(etiqueta, real, esperado) {
  if (real !== esperado) { fallas++; console.log(`FALLA: ${etiqueta} -> ${real} (esperado ${esperado})`); } else { console.log(`OK: ${etiqueta}`); }
}

// Caso real (rip.CONTEOLIN, 22-jul-2026): el celular reporto 14:54:11.517 y
// en la BD quedaba 18:54:11.517.
check('hora del celular se guarda tal cual, sin pasar a UTC',
  horaConteoParaSql('2026-07-22T14:54:11.517'), '2026-07-22T14:54:11.517');

// LocalDateTime.toString() omite segundos/milisegundos cuando valen cero.
check('sin milisegundos', horaConteoParaSql('2026-07-22T14:54:11'), '2026-07-22T14:54:11.000');
check('sin segundos', horaConteoParaSql('2026-07-22T14:54'), '2026-07-22T14:54:00.000');
check('mas de 3 decimales se truncan', horaConteoParaSql('2026-07-22T14:54:11.517999'), '2026-07-22T14:54:11.517');
check('decimales cortos (.29 = 290 ms, sin error de coma flotante)', horaConteoParaSql('2026-07-22T14:54:11.29'), '2026-07-22T14:54:11.290');
check('separador espacio en vez de T', horaConteoParaSql('2026-07-22 14:54:11.517'), '2026-07-22T14:54:11.517');

// Ajuste de reloj del lote (calcularAjusteReloj), cruzando medianoche.
check('ajuste positivo cruza al dia siguiente', horaConteoParaSql('2026-07-22T23:59:30.000', 45), '2026-07-23T00:00:15.000');
check('ajuste negativo', horaConteoParaSql('2026-07-22T14:54:11.517', -300), '2026-07-22T14:49:11.517');

let lanzo = false;
try { horaConteoParaSql('no es una hora'); } catch { lanzo = true; }
check('hora invalida lanza error (no guarda basura)', lanzo, true);

console.log(fallas ? `\n${fallas} falla(s)` : '\nTodo OK');
process.exit(fallas ? 1 : 0);
