export function formatearFecha(fecha) {
  if (!fecha || fecha.length === 0) return '';
  return fecha.split('-').reverse().join('-');
}
