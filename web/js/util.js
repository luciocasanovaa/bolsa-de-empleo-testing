// Utilidades compartidas: formato de montos, escape de HTML y hash de 32 bytes.
export const MICRO = 1_000_000;

// Hasta 3 decimales: la comision de un aporte de 1 USD es USD 0,003.
const nf = new Intl.NumberFormat('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 3 });
const nf0 = new Intl.NumberFormat('es-AR', { maximumFractionDigits: 0 });

export function usd(micro) {
  return 'USD ' + nf.format(micro / MICRO);
}

export function ars(valor) {
  return 'ARS ' + nf0.format(valor);
}

export function esc(texto) {
  return String(texto).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

// SHA-256 como bytes32 (0x + 64 hex). Sirve igual en modo simulado y en la cadena.
export async function hash32(texto) {
  const datos = new TextEncoder().encode(texto);
  const buf = await crypto.subtle.digest('SHA-256', datos);
  return '0x' + [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export function corto(hash) {
  return hash.length > 14 ? hash.slice(0, 8) + '...' + hash.slice(-6) : hash;
}
