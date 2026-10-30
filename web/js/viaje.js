// Página pública "El viaje del dinero": una por beca (?beca=N), sin billetera.
// Lee la red por RPC; si ningún RPC responde, usa el último recorrido guardado en data/onchain.json.
import config from '../config.js';
import { cargarRegistro, rpcConRespaldo } from './onchain.js';
import { descripcion, reunirViaje, seguirTransaccion } from './trazabilidad.js';
import { corto, esc, usd } from './util.js';

const $ = (id) => document.getElementById(id);
const c = config.sepolia;
const tx = (hash) => `${c.explorador}/tx/${hash}`;
const fecha = (ts) => (ts ? new Date(ts * 1000).toLocaleString('es-AR', { dateStyle: 'medium', timeStyle: 'medium' }) : 'sin fecha');

function htmlOrigen(viaje, vivo, registro) {
  const estado = vivo
    ? '<span class="insignia disponible">Datos en vivo desde la red</span>'
    : `<span class="insignia programado">Sin conexión a la red</span> <span class="nota">Se muestra el último recorrido guardado${registro ? ` el ${esc(fecha(Date.parse(registro.generado) / 1000))}` : ''}.</span>`;
  return `<p>${estado}</p>
    <p class="nota">Beca #${viaje.beca} · estado: <strong>${esc(viaje.estado)}</strong> · ${usd(viaje.montoPorMateria)} por materia. Contrato <a href="${esc(c.explorador)}/address/${esc(viaje.contrato)}" target="_blank" rel="noopener">${esc(corto(viaje.contrato))}</a>.
    Solo mostramos direcciones abreviadas y roles: ningún dato personal.</p>`;
}

function htmlDiagrama(v) {
  const r = v.resumen;
  const salioDeBilleteras = r.aportado + r.comision;
  return `<h2>Por dónde pasó la plata</h2>
    <div class="recorrido">
      <div class="paso"><h3>1. Sponsors</h3><p class="monto">${usd(salioDeBilleteras)}</p><p class="nota">salieron de sus billeteras, de los cuales ${usd(r.comision)} son la comisión de EduTrust (no entran a la beca)</p></div>
      <div class="flecha" aria-hidden="true">→</div>
      <div class="paso"><h3>2. Contrato</h3><p class="monto">${usd(r.bloqueado)}</p><p class="nota">bloqueados hoy en esta beca; solo se mueven con un acta firmada</p></div>
      <div class="flecha" aria-hidden="true">→</div>
      <div class="paso"><h3>3. Estudiante</h3><p class="monto">${usd(r.pagado)}</p><p class="nota">ya pagados</p></div>
    </div>
    <div class="recorrido secundario">
      <div class="paso"><h3>Al fondo común</h3><p class="monto">${usd(r.sobrante)}</p><p class="nota">sobrante al cerrar la beca, para ayudar a otro estudiante</p></div>
      ${r.delFondo ? `<div class="paso"><h3>Recibido del fondo común</h3><p class="monto">${usd(r.delFondo)}</p><p class="nota">asignado a esta beca</p></div>` : ''}
    </div>
    <p class="nota">Los aportes de una beca forman un pozo común: el contrato no etiqueta qué dólar paga qué materia.</p>`;
}

function htmlCuadra(v, vivo) {
  const r = v.resumen;
  const q = v.cuadra;
  const t = v.token_;
  const cabecera = q.ok
    ? '<p class="veredicto bien">✓ Sí, cuadra</p>'
    : `<p class="veredicto mal">✗ No cuadra: hay una diferencia de ${usd(Math.abs(q.diferencia))} (${q.diferencia > 0 ? 'entró más de lo que se explica' : 'se explica más de lo que entró'})</p>`;
  const tokenTexto = t.ok
    ? `✓ Los ${t.revisados} eventos coinciden con los movimientos reales del token.`
    : `✗ ${t.fallas.length} de ${t.revisados} eventos no coinciden con el token: ${t.fallas.map((f) => `<a href="${esc(tx(f.hash))}" target="_blank" rel="noopener">${esc(f.tipo)}</a>`).join(', ')}.`;
  return `<h2>¿Cuadra?</h2>${cabecera}
    <ul class="cuenta">
      <li>Entró a la beca: aportes ${usd(r.aportado)} + del fondo común ${usd(r.delFondo)} = <strong>${usd(q.entradas)}</strong></li>
      <li>Salió o sigue acá: pagado ${usd(r.pagado)} + al fondo común ${usd(r.sobrante)} + bloqueado hoy ${usd(r.bloqueado)} = <strong>${usd(q.salidas)}</strong></li>
      <li>Diferencia: <strong>${usd(q.diferencia)}</strong></li>
    </ul>
    <p class="nota">Aportado de las billeteras (${usd(r.aportado + r.comision)}) − comisión (${usd(r.comision)}) = ${usd(r.aportado)} que entra a la beca. ${vivo ? 'El saldo bloqueado se lee de la red en este momento.' : 'Sin conexión: el saldo bloqueado es el del último recorrido guardado.'}</p>
    <p class="${t.ok ? 'veredicto bien' : 'veredicto mal'}">${tokenTexto}</p>`;
}

function htmlLinea(v) {
  const items = v.eventos
    .map((e) => {
      const monto = e.monto !== undefined ? `<strong>${usd(e.monto)}</strong> · ` : e.sobrante !== undefined ? `<strong>${usd(e.sobrante)}</strong> · ` : '';
      const coincide = e.coincideConToken ? '✓ coincide con el token' : '✗ NO coincide con el token';
      return `<li class="evento">
        <time>${esc(fecha(e.ts))}</time>
        <p>${monto}${esc(descripcion(e))}</p>
        <p class="nota">Quién: ${esc(e.rol)} · <a href="${esc(tx(e.hash))}" target="_blank" rel="noopener">Ver en Etherscan (${esc(corto(e.hash))})</a> · ${coincide}</p>
      </li>`;
    })
    .join('');
  return `<h2>Línea de tiempo</h2>${items ? `<ol class="linea">${items}</ol>` : '<p class="nota">Esta beca todavía no tiene movimientos.</p>'}`;
}

function htmlSeguir(r, hash) {
  if (!r.encontrada) return '<p class="veredicto mal">✗ No encontramos esa transacción en la red.</p>';
  if (!r.ok) return '<p class="veredicto mal">✗ Esa transacción falló en la red: no movió plata.</p>';
  const movs = r.transfers.map((x) => `<li>${esc(corto(x.de))} → ${esc(corto(x.a))}: <strong>${usd(x.monto)}</strong></li>`).join('');
  const becas = [...new Set(r.eventos.map((e) => e.beca))].map((b) => `<a href="viaje.html?beca=${b}">beca #${b}</a>`).join(', ');
  const destino = becas ? `<p>Esa plata fue a la ${becas}. Mirá su viaje en esa página.</p>` : '<p class="nota">Esa transacción no pertenece a una beca de EduTrust.</p>';
  return `<p class="veredicto bien">✓ Transacción confirmada en el bloque ${r.bloque}</p>
    <ul class="cuenta">${movs || '<li>No movió tokens.</li>'}</ul>${destino}
    <p class="nota"><a href="${esc(tx(hash))}" target="_blank" rel="noopener">Ver en Etherscan</a></p>`;
}

function dibujarQR(enlace) {
  $('enlace').textContent = enlace;
  const s = document.createElement('script');
  s.src = 'https://cdnjs.cloudflare.com/ajax/libs/qrcode-generator/1.4.4/qrcode.min.js';
  s.onload = () => {
    const qr = globalThis.qrcode(0, 'M');
    qr.addData(enlace);
    qr.make();
    $('qr').innerHTML = qr.createSvgTag({ cellSize: 6, margin: 4, scalable: true });
  };
  s.onerror = () => ($('qr').textContent = 'No se pudo cargar el generador de QR; usá el enlace de abajo.');
  document.head.append(s);
}

async function iniciar() {
  const registro = await cargarRegistro();
  const pedida = Number(new URLSearchParams(location.search).get('beca'));
  const beca = pedida > 0 ? pedida : (registro?.becas?.origen ?? 1);
  $('subtitulo').textContent = `Beca #${beca}`;
  dibujarQR(`${location.origin}${location.pathname}?beca=${beca}`);

  let viaje = null;
  let vivo = false;
  try {
    viaje = await reunirViaje(rpcConRespaldo, { contrato: c.contrato, token: c.token, desdeBloque: c.desdeBloque }, beca);
    vivo = true;
  } catch {
    viaje = registro?.viajes?.[beca] ?? null;
  }
  if (!viaje) {
    $('origen').innerHTML = '<p class="veredicto mal">✗ No pudimos leer la red y no hay un recorrido guardado para esta beca.</p>';
    return;
  }
  $('origen').innerHTML = htmlOrigen(viaje, vivo, registro);
  $('diagrama').innerHTML = htmlDiagrama(viaje);
  $('cuadra').innerHTML = htmlCuadra(viaje, vivo);
  $('linea').innerHTML = htmlLinea(viaje);
}

$('form-seguir').addEventListener('submit', async (e) => {
  e.preventDefault();
  const hash = $('hash').value.trim();
  const salida = $('resultado-seguir');
  if (!/^0x[0-9a-fA-F]{64}$/.test(hash)) {
    salida.innerHTML = '<p class="veredicto mal">✗ El código debe empezar con 0x y tener 64 caracteres después.</p>';
    return;
  }
  salida.textContent = 'Buscando…';
  try {
    salida.innerHTML = htmlSeguir(await seguirTransaccion(rpcConRespaldo, { contrato: c.contrato, token: c.token }, hash), hash);
  } catch {
    salida.innerHTML = '<p class="veredicto mal">✗ No pudimos consultar la red ahora. Probá de nuevo en un momento.</p>';
  }
});

iniciar();
