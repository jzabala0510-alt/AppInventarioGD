export function toIsoDate(date) {
  if (!date) return null;
  const d = date instanceof Date ? date : new Date(date);
  return d.toISOString().slice(0, 10);
}

export function toBit(value) {
  if (typeof value === 'string') return value === 'true' || value === '1' ? 1 : 0;
  return value ? 1 : 0;
}

// Mismo saneo que el Java original (quita comodines de LIKE); ya no hace falta
// escapar comillas porque el valor viaja como parametro con tipo, no concatenado.
export function sanitizeLike(value) {
  return value.replace(/%/g, '').replace(/_/g, '');
}
