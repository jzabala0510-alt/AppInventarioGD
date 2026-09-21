// Valida calcularAjusteReloj() (conteoBatchService.js) -- el "ajuste de
// reloj" del lote offline de AlmacenesApp. Bug real confirmado 21-sep-2026:
// un dispositivo que queda offline en el piso de venta y tarda en reintentar
// el envio hacia el servidor (no un reloj mal puesto) hacia que HORACONTEO
// terminara mas tarde que HORAPROCESADO del propio lote -- imposible en la
// realidad -- y que ventas legitimas ocurridas DESPUES de contar un
// articulo contaran como "Vendidas". No necesita BD: es matematica pura.
//
// Uso: node test-fixtures/conteo/validar_ajuste_reloj.js  (desde BackendInventario/)
import { calcularAjusteReloj, LIMITE_AJUSTE_RELOJ_SEGUNDOS } from '../../src/services/conteoBatchService.js';

let fallas = 0;
function check(etiqueta, cond) {
  if (!cond) { fallas++; console.log(`FALLA: ${etiqueta}`); } else { console.log(`OK: ${etiqueta}`); }
}

// Caso real confirmado: lote procesado a las 13:20:15 (HORAPROCESADO real),
// "fecha" declarada por el dispositivo con ~2h20min de diferencia (magnitud
// igual a la observada en rip.CONTEOLIN/rip.CONTEO_ENVIOS reales, donde
// HORACONTEO "corregida" quedaba horas despues de HORAPROCESADO).
const ahora = new Date('2026-09-21T13:20:15.683').getTime();
const fechaConDesfaseGrande = '2026-09-21T15:34:00';
check(
  'desfase de horas (retraso de red / reintentos) se descarta por completo',
  calcularAjusteReloj(fechaConDesfaseGrande, ahora) === 0,
);

// Desfase legitimo y chico (reloj del celular unos minutos adelantado) --
// SI se debe aplicar, para seguir compensando el caso real que la
// correccion original intentaba resolver.
const fechaConDesfaseChico = '2026-09-21T13:17:00'; // 3min15s antes de "ahora"
const ajusteChico = calcularAjusteReloj(fechaConDesfaseChico, ahora);
check('desfase chico (3min15s) SI se aplica', ajusteChico === 195);

// Justo en el limite (10 minutos exactos) -- todavia se aplica.
const fechaLimite = new Date(ahora - LIMITE_AJUSTE_RELOJ_SEGUNDOS * 1000).toISOString();
check('en el limite exacto (600s) todavia se aplica', calcularAjusteReloj(fechaLimite, ahora) === LIMITE_AJUSTE_RELOJ_SEGUNDOS);

// Un segundo por encima del limite -- se descarta.
const fechaSobreLimite = new Date(ahora - (LIMITE_AJUSTE_RELOJ_SEGUNDOS + 1) * 1000).toISOString();
check('un segundo por encima del limite se descarta (da 0)', calcularAjusteReloj(fechaSobreLimite, ahora) === 0);

// "fecha" invalida/vacia -- nunca debe reventar ni devolver NaN (eso
// corromperia TODAS las horas del lote al sumarse con +).
check('fecha invalida no revienta y devuelve 0', calcularAjusteReloj('no-es-una-fecha', ahora) === 0);
check('fecha vacia no revienta y devuelve 0', calcularAjusteReloj('', ahora) === 0);
check('fecha undefined no revienta y devuelve 0', calcularAjusteReloj(undefined, ahora) === 0);

// Simetria: un desfase negativo grande (dispositivo declara una hora muy
// anterior a la real) tambien se descarta, no solo los positivos.
const fechaFutura = '2026-09-21T18:00:00'; // el dispositivo "declara" estar mas adelantado que el servidor
check('desfase negativo grande tambien se descarta', calcularAjusteReloj(fechaFutura, ahora) === 0);

console.log('');
if (fallas === 0) console.log('TODO OK -- calcularAjusteReloj protege contra el bug real confirmado (retraso de red inflando HORACONTEO por horas).');
else { console.log(`${fallas} verificacion(es) fallaron.`); process.exit(1); }
