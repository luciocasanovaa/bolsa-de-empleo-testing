// Interfaz de la demo. Toda la lógica de dinero vive en el backend (simulado o Sepolia).
import config from '../config.js';
import { crearBackend, SimBackend } from './backend.js';
import { crearBrote } from './brote.js';
import { cargarRegistro, htmlOnchain, leerOnchain } from './onchain.js';
import { proponerReparto } from './proposal.js';
import { ACTORES, LOGROS, TASA_ARS, perfilDeBeca } from './scenario.js';
import { MICRO, ars, corto, esc, hash32, usd } from './util.js';

const $ = (id) => document.getElementById(id);
const secciones = { onchain: $('onchain'), evidencia: $('evidencia'), becas: $('becas'), fondo: $('fondo'), eventos: $('eventos') };

let backend;
let openarg;
let brote;
let estado;
let propuesta = null;
let cobrado = false;
let enIntro = false;
const enviando = new Set();
const valoresAporte = {};
const ultimoHtml = new Map();

function aviso(texto) {
  const caja = $('aviso');
  caja.textContent = texto;
  caja.hidden = false;
  clearTimeout(aviso.t);
  aviso.t = setTimeout(() => (caja.hidden = true), 5000);
}

// Evita reemplazar el DOM si nada cambió, y no pisa un campo que la persona está escribiendo.
function pintar(nombre, html) {
  const nodo = secciones[nombre];
  if (ultimoHtml.get(nombre) === html) return;
  if (nodo.contains(document.activeElement) && document.activeElement.tagName === 'INPUT') return;
  nodo.innerHTML = html;
  ultimoHtml.set(nombre, html);
}

async function accion(clave, fn) {
  if (enviando.has(clave)) return;
  enviando.add(clave);
  try {
    await fn();
  } catch (e) {
    aviso(e?.shortMessage ?? e?.message ?? String(e));
  } finally {
    enviando.delete(clave);
    await refrescar();
  }
}

function logrosAlcanzados() {
  const claves = new Set(['problema']);
  for (const ev of estado.eventos) {
    if (ev.name === 'FondosDepositados') claves.add('aporte');
    if (ev.name === 'AprobacionRegistrada') claves.add('acta');
    if (ev.name === 'PagoLiberado') claves.add('pago');
    if (ev.name === 'FondoAsignado') claves.add('fondo');
  }
  if (cobrado && claves.has('pago')) claves.add('cobro');
  return claves;
}

function htmlEvidencia() {
  const cifras = openarg.cifras
    .map(
      (c) => `<div class="cifra">
        <strong>${esc(c.grande)}</strong>
        <span>${esc(c.titulo)}</span>
        <small>${esc(c.texto)}</small>
        <details><summary>Fuente y cuidado</summary>
          <p>${esc(c.fuente)} · último dato ${esc(c.ultimoDato)} · <a href="${esc(c.url)}" target="_blank" rel="noopener">enlace</a></p>
          <p>Tabla <code>${esc(c.tabla)}</code>, columna <code>${esc(c.columna)}</code>. Leída por OpenArg el ${esc(c.leidaPorOpenArg)}.</p>
          <p><strong>Cuidado:</strong> ${esc(c.cuidado)}</p>
        </details>
      </div>`
    )
    .join('');
  const noAfirmar = openarg.noAfirmar.map((t) => `<li>${esc(t)}</li>`).join('');
  return `<h2>El problema, con datos públicos (OpenArg)</h2>
    <div class="cifras">${cifras}</div>
    <details class="no-afirmar"><summary>Lo que NO afirmamos</summary><ul>${noAfirmar}</ul></details>`;
}

function textoMateria(m, ahora) {
  if (m.estado === 'sin-firma') return '<span class="insignia">Sin firma</span>';
  if (m.estado === 'programado') {
    const falta = Math.max(0, m.liberableDesde - ahora);
    return `<span class="insignia programado">Ventana de seguridad: ${falta} s</span>`;
  }
  if (m.estado === 'disponible') return '<span class="insignia disponible">Lista para pagar</span>';
  return '<span class="insignia pagado">Pagada</span>';
}

function htmlBeca(b) {
  const meta = perfilDeBeca(b.cupo);
  const pct = Math.min(100, Math.round((b.aportado / b.meta) * 100));
  const materias = (estado.materias[b.id] ?? [])
    .map((m) => {
      const sinFondos = m.estado !== 'pagado' && m.estado !== 'sin-firma' && b.saldo < b.montoPorMateria;
      const botones = [];
      if (b.estado === 'Activa' && m.estado === 'sin-firma') {
        botones.push(`<button data-acc="firmar" data-id="${b.id}" data-key="${esc(m.key)}">Firmar acta (Secretaría)</button>`);
      }
      if (m.estado === 'disponible' && backend.modo === 'sepolia') {
        botones.push(`<button class="secundario" data-acc="liberar" data-id="${b.id}" data-key="${esc(m.key)}">Liberar pago (si el vigilante no lo hizo)</button>`);
      }
      if (m.estado === 'programado') {
        botones.push(`<button class="secundario" data-acc="revocar" data-id="${b.id}" data-key="${esc(m.key)}">Revocar</button>`);
      }
      return `<li class="materia">
        <span><strong>${esc(m.nombre)}</strong> <span class="etiqueta">${esc(m.key)}</span></span>
        <span class="fila">${textoMateria(m, estado.ahora)}${sinFondos ? '<span class="sin-fondos">Esperando fondos</span>' : ''}${botones.join('')}</span>
      </li>`;
    })
    .join('');
  const valor = valoresAporte[b.id] ?? 1;
  const monto = Math.round(valor * MICRO);
  const fee = backend.comisionDe(monto);
  const aportar =
    b.estado === 'Activa'
      ? `<div class="fila">
          <label>Aportar USD <input type="number" min="1" step="1" value="${esc(valor)}" data-aporte="${b.id}" aria-label="Monto a aportar en USD"></label>
          <button data-acc="aportar" data-id="${b.id}">Aportar</button>
          <span class="nota" data-fee="${b.id}">Aportás ${usd(monto)} + comisión ${usd(fee)} (la beca recibe todo)</span>
        </div>`
      : '';
  const cerrar =
    b.estado === 'Activa' && b.registradas === b.pagadas && b.saldo > 0 && b.pagadas > 0
      ? `<button class="secundario" data-acc="cerrar" data-id="${b.id}">Cerrar beca: el saldo va al fondo común</button>`
      : '';
  const pagada = b.pagadas > 0 && !cobrado
    ? `<button class="secundario" data-acc="cobrar" data-id="${b.id}">El estudiante cobra en pesos (simulado)</button>`
    : '';
  return `<article class="tarjeta">
    <div class="beca-cabecera">
      <h3>Beca #${b.id} · ${esc(ACTORES[meta.estudiante].nombre)}</h3>
      <span class="etiqueta">${esc(meta.territorio ?? '')} · ${esc(b.estado)}</span>
    </div>
    <div class="barra-progreso" aria-hidden="true"><span style="width:${pct}%"></span></div>
    <div class="datos">
      <span>Aportado ${usd(b.aportado)} de ${usd(b.meta)} (${pct} %)</span>
      <span>En el contrato ${usd(b.saldo)}</span>
      <span>${usd(b.montoPorMateria)} por materia</span>
    </div>
    <ul class="materias">${materias}</ul>
    ${aportar}
    <div class="fila">${cerrar}${pagada}</div>
  </article>`;
}

function htmlBecas() {
  if (!estado.becas.length) {
    return `<div class="tarjeta"><p>Todavía no hay becas en este contrato.</p>
      ${backend.preparar ? '<button data-acc="preparar">Preparar escena (varias transacciones)</button>' : ''}</div>`;
  }
  return estado.becas.map(htmlBeca).join('');
}

function htmlFondo() {
  let cuerpo = '';
  if (propuesta) {
    const filas = propuesta.resultado.filas
      .map(
        (f) => `<tr><td>Beca #${f.id}</td><td>${usd(f.monto)}${f.completa ? ' (completa la meta)' : ''}</td>
          <td><ul>${f.razones.map((r) => `<li>${esc(r)}</li>`).join('')}</ul></td></tr>`
      )
      .join('');
    cuerpo = filas
      ? `<table class="propuesta"><thead><tr><th>Destino</th><th>Monto</th><th>Por qué</th></tr></thead><tbody>${filas}</tbody></table>
         <p class="nota">Sin asignar: ${usd(propuesta.resultado.sinAsignar)}. Es un motor de reglas con criterios públicos (no un modelo de lenguaje). Una persona aprueba y el contrato verifica los topes.</p>
         <div class="fila"><button data-acc="aprobar">Aprobar y ejecutar</button><button class="secundario" data-acc="descartar">Descartar</button></div>`
      : '<p>No hay becas con faltante para asignar.</p>';
  } else if (estado.fondoComun > 0) {
    cuerpo = '<button data-acc="proponer">Proponer reparto</button>';
  } else {
    cuerpo = '<p class="nota">Vacío. Cuando una beca se cierra, lo que no se usó llega acá y ayuda a otro estudiante.</p>';
  }
  return `<h2>Fondo común: ${usd(estado.fondoComun)}</h2>${cuerpo}`;
}

function resumenEvento(ev) {
  const a = ev.args;
  switch (ev.name) {
    case 'BecaCreada': return `Beca #${a.id} creada`;
    case 'FondosDepositados': return `Aporte de ${usd(a.monto)} a la beca #${a.id}`;
    case 'ComisionCobrada': return `Comisión ${usd(a.monto)} (se suma al aporte)`;
    case 'AprobacionRegistrada': return `Acta registrada en la beca #${a.id} · hash ${corto(a.actaHash)}`;
    case 'AprobacionRevocada': return `Acta revocada en la beca #${a.id}`;
    case 'PagoLiberado': return `Pago liberado: ${usd(a.monto)} al estudiante (beca #${a.id})`;
    case 'BecaCerrada': return `Beca #${a.id} cerrada: ${usd(a.sobranteAlFondo)} al fondo común`;
    case 'FondoAsignado': return `Fondo → beca #${a.id}: ${usd(a.monto)} · propuesta ${corto(a.propuestaHash)}`;
    default: return ev.name;
  }
}

function htmlEventos() {
  const items = [...estado.eventos]
    .reverse()
    .slice(0, 14)
    .map((ev) => {
      const link = backend.linkComprobante(ev.tx);
      const prueba = link ? `<a href="${esc(link)}" target="_blank" rel="noopener">ver transacción</a>` : '';
      return `<li><code>#${ev.n}</code><span>${esc(resumenEvento(ev))}</span>${prueba}</li>`;
    })
    .join('');
  const b = estado.balances;
  return `<h2>Registro público</h2>
    <p class="nota">Saldos: estudiante #1 ${usd(b.estudiante)} · estudiante #2 ${usd(b.estudiante2)} · tesorería ${usd(b.tesoreria)}${cobrado ? ` · cobrado en pesos (simulado): ${ars((b.estudiante / MICRO) * TASA_ARS)}` : ''}</p>
    <ul class="registro">${items || '<li>Sin eventos todavía.</li>'}</ul>`;
}

function pintarTodo() {
  pintar('becas', htmlBecas());
  pintar('fondo', htmlFondo());
  pintar('eventos', htmlEventos());
  if (!enIntro) brote.actualizar(logrosAlcanzados());
}

// Servicio automático: quien sea puede llamar liberar() cuando la ventana termina y hay fondos.
function liberarPendientes() {
  // En Sepolia paga el vigilante (scripts/escena.mjs vigilante): así MetaMask no pide otra confirmación.
  if (backend.modo === 'sepolia') return;
  for (const b of estado.becas) {
    for (const m of estado.materias[b.id] ?? []) {
      if (m.estado === 'disponible' && b.saldo >= b.montoPorMateria) {
        accion(`liberar:${b.id}:${m.key}`, () => backend.liberar(b.id, m.key));
      }
    }
  }
}

async function refrescar() {
  try {
    estado = await backend.estado();
  } catch (e) {
    aviso(e?.message ?? String(e));
    return;
  }
  pintarTodo();
  liberarPendientes();
}

async function aprobarPropuesta() {
  const { resultado } = propuesta;
  const propuestaHash = await hash32(JSON.stringify(resultado.filas.map((f) => [f.id, f.monto])));
  for (const f of resultado.filas) await backend.asignarDeFondo(f.id, f.monto, propuestaHash);
  propuesta = null;
}

async function proponer() {
  const becas = estado.becas
    .filter((b) => b.estado === 'Activa')
    .map((b) => ({
      id: b.id,
      meta: b.meta,
      aportado: b.aportado,
      territorio: perfilDeBeca(b.cupo).territorio,
      esperaMin: perfilDeBeca(b.cupo).creadaHaceMin,
    }));
  propuesta = { resultado: proponerReparto({ becas, fondoComun: estado.fondoComun, territorios: openarg.territorios }) };
}

document.addEventListener('click', (e) => {
  const boton = e.target.closest('button[data-acc]');
  if (!boton) return;
  const { acc, id, key } = boton.dataset;
  const beca = Number(id);
  const acciones = {
    aportar: () => backend.depositar('aportante', beca, Math.round((valoresAporte[beca] ?? 1) * MICRO)),
    firmar: () => backend.registrarAprobacion(beca, key),
    revocar: () => backend.revocarAprobacion(beca, key),
    liberar: () => backend.liberar(beca, key),
    cerrar: () => backend.cerrarBeca(beca),
    cobrar: async () => { cobrado = true; },
    proponer,
    aprobar: aprobarPropuesta,
    descartar: async () => { propuesta = null; },
    preparar: () => backend.preparar(),
  };
  const fn = acciones[acc];
  if (fn) accion(`${acc}:${id ?? ''}:${key ?? ''}`, fn);
});

document.addEventListener('input', (e) => {
  const campo = e.target.closest('input[data-aporte]');
  if (!campo) return;
  const id = Number(campo.dataset.aporte);
  const valor = Math.max(1, Number(campo.value) || 1);
  valoresAporte[id] = valor;
  const monto = Math.round(valor * MICRO);
  const nota = document.querySelector(`[data-fee="${id}"]`);
  if (nota) nota.textContent = `Aportás ${usd(monto)} + comisión ${usd(backend.comisionDe(monto))} (la beca recibe todo)`;
});

async function reproducirIntro() {
  if (enIntro) return;
  enIntro = true;
  $('intro').hidden = false;
  await brote.intro((t) => ($('intro-sub').textContent = t));
  $('intro').hidden = true;
  enIntro = false;
  pintarTodo();
}

async function iniciar() {
  openarg = await (await fetch('data/openarg.json')).json();
  try {
    backend = await crearBackend(config);
  } catch (e) {
    aviso(`${e.message}. Se usa el modo simulado.`);
    backend = new SimBackend({ ventana: config.ventana, comisionBps: config.comisionBps });
  }
  const real = backend.modo === 'sepolia';
  const modo = $('modo');
  modo.textContent = real ? `Sepolia (testnet) · ${corto(backend.cuenta)}` : 'Modo simulado: sin blockchain';
  modo.classList.toggle('real', real);
  $('btn-reiniciar').hidden = real;

  brote = crearBrote($('brote'), LOGROS);
  pintar('evidencia', htmlEvidencia());
  // Panel on-chain: siempre lee la red real, también en modo simulado, y no necesita billetera.
  const registro = await cargarRegistro();
  pintar('onchain', '<h2>Prueba on-chain (Sepolia)</h2><p class="nota">Leyendo la red…</p>');
  const actualizarOnchain = async () => pintar('onchain', htmlOnchain(await leerOnchain(), registro));
  actualizarOnchain();
  setInterval(actualizarOnchain, 20000);
  await refrescar();

  $('btn-intro').addEventListener('click', reproducirIntro);
  $('btn-reiniciar').addEventListener('click', async () => {
    backend.reiniciar();
    cobrado = false;
    propuesta = null;
    ultimoHtml.clear();
    await refrescar();
  });
  setInterval(refrescar, config.pollMs[backend.modo] ?? 2000);
  if (new URLSearchParams(location.search).has('intro')) reproducirIntro();
}

iniciar().catch((e) => aviso(e?.message ?? String(e)));
