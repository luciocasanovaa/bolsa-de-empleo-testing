// Panel "Prueba on-chain": lee el contrato real de Sepolia por RPC público, sin billetera.
// Si ningún RPC responde, muestra el último estado y los hashes guardados en data/onchain.json.
import config from '../config.js';
import { corto, esc, usd } from './util.js';

const SEL = { totalBecas: '0x47e66ff4', fondoComun: '0x85b120bf', comisionBps: '0x08a206c4', ventana: '0xc545bee0', balanceOf: '0x70a08231' };
const EVENTOS = {
  '0xcf1bf2345d67fe3f7acb9215287cb439898108c2a1a49531d8b1ebcceccf658a': 'Beca creada',
  '0xf93f411b4bf010efe96d873c95a998da42c3e9a05b1c3128d8607f578c33529b': 'Aporte',
  '0x421cb4996b9fc3ef198d57c69d679517cc1e51f2344a16e4bf17973edcf08077': 'Comisión cobrada',
  '0xb6fff16f369c9b3359d411dc906939017decfc3da8a2c9881b3e23e7b3702be5': 'Acta firmada',
  '0xb7781d6d4b585506be87d2d0884e1d2705f03f485644e9057cf50e927822df4f': 'Acta revocada',
  '0x4e8d2e8806f684bd9ca315d6b4ade75cc1faefef45801c9574ad13cee39b3750': 'Pago liberado',
  '0x793181623bb86aaa517976040d528d1b86e2e374aa958e4ba3e22ba1a5acbb84': 'Beca cerrada',
  '0xad2cbaf9bfb3b42660d2e5ae0d36ad35ebe2c8826ff0fb9a3f11ea4e51af6f62': 'Fondo común asignado',
};
const TRAMO = 5000; // algunos RPC limitan el rango de eth_getLogs

async function rpc(url, method, params, ms = 8000) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), ms);
  try {
    const r = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }), signal: ctl.signal });
    const j = await r.json();
    if (j.error) throw new Error(j.error.message);
    return j.result;
  } finally {
    clearTimeout(t);
  }
}

// Prueba los RPC en orden: el primero que responde gana. Lo usan el panel y la página del viaje.
export async function rpcConRespaldo(metodo, params) {
  let ultimo;
  for (const url of config.sepolia.rpcs) {
    try {
      return await rpc(url, metodo, params);
    } catch (e) {
      ultimo = e;
    }
  }
  throw ultimo ?? new Error('Ningún RPC respondió');
}

const numero = (hex) => Number(BigInt(hex));
const direccion32 = (d) => '0'.repeat(24) + d.toLowerCase().replace(/^0x/, '');

// Lectura completa con un solo RPC: si falla a mitad de camino se prueba el siguiente.
async function leerCon(url) {
  const c = config.sepolia;
  const llamar = (to, data) => rpc(url, 'eth_call', [{ to, data }, 'latest']);
  const bloque = numero(await rpc(url, 'eth_blockNumber', []));
  const [bps, ventana, total, fondo, saldo] = await Promise.all([
    llamar(c.contrato, SEL.comisionBps),
    llamar(c.contrato, SEL.ventana),
    llamar(c.contrato, SEL.totalBecas),
    llamar(c.contrato, SEL.fondoComun),
    llamar(c.token, SEL.balanceOf + direccion32(c.contrato)),
  ]);
  const eventos = [];
  for (let desde = c.desdeBloque; desde <= bloque; desde += TRAMO) {
    const hasta = Math.min(desde + TRAMO - 1, bloque);
    const logs = await rpc(url, 'eth_getLogs', [{ address: c.contrato, fromBlock: '0x' + desde.toString(16), toBlock: '0x' + hasta.toString(16) }]);
    for (const l of logs) if (EVENTOS[l.topics[0]]) eventos.push({ nombre: EVENTOS[l.topics[0]], hash: l.transactionHash, bloque: numero(l.blockNumber) });
  }
  return { rpc: url, bloque, comisionBps: numero(bps), ventana: numero(ventana), becas: numero(total), fondoComun: numero(fondo), saldoContrato: numero(saldo), eventos };
}

export async function leerOnchain() {
  const c = config.sepolia;
  if (!c.contrato || !c.token) return null;
  for (const url of c.rpcs) {
    try {
      return await leerCon(url);
    } catch {
      // se prueba el siguiente RPC
    }
  }
  return null;
}

export async function cargarRegistro() {
  try {
    const r = await fetch('data/onchain.json');
    return r.ok ? await r.json() : null;
  } catch {
    return null;
  }
}

const enlaceTx = (hash) => `${config.sepolia.explorador}/tx/${hash}`;

export function htmlOnchain(vivo, registro) {
  const c = config.sepolia;
  if (!c.contrato) return '<h2>Prueba on-chain</h2><p class="nota">Todavía no hay contrato configurado.</p>';
  const origen = vivo
    ? `<span class="insignia disponible">En vivo · bloque ${vivo.bloque}</span> <span class="nota">RPC: ${esc(new URL(vivo.rpc).host)}</span>`
    : `<span class="insignia programado">Sin conexión al RPC</span> <span class="nota">Se muestra el último estado guardado${registro ? ` (${esc(registro.generado.slice(0, 16).replace('T', ' '))} UTC)` : ''}.</span>`;
  const estado = vivo ?? (registro ? { comisionBps: 30, ventana: 10, becas: null, fondoComun: registro.estadoFinal.fondoComun, saldoContrato: null, eventos: [] } : null);
  const datos = estado
    ? `<div class="datos">
        <span>Comisión ${(estado.comisionBps / 100).toLocaleString('es-AR')} % encima del aporte</span>
        <span>Ventana de seguridad ${estado.ventana} s (demo)</span>
        ${estado.becas !== null ? `<span>Becas creadas ${estado.becas}</span>` : ''}
        <span>Fondo común ${usd(estado.fondoComun)}</span>
        ${estado.saldoContrato !== null ? `<span>Bloqueado en el contrato ${usd(estado.saldoContrato)}</span>` : ''}
      </div>`
    : '<p class="nota">No hay datos para mostrar todavía.</p>';
  const pasos = registro
    ? `<details open><summary>Recorrido completo ya ejecutado en Sepolia (${registro.pasos.length} transacciones)</summary>
        <ul class="registro">${registro.pasos.map((p) => `<li><span>${esc(p.paso)}</span><a href="${esc(enlaceTx(p.hash))}" target="_blank" rel="noopener">${esc(corto(p.hash))}</a></li>`).join('')}</ul>
      </details>`
    : '<p class="nota">Todavía no se guardó un recorrido completo.</p>';
  const ultimos = vivo && vivo.eventos.length
    ? `<details><summary>Últimos eventos del contrato</summary><ul class="registro">${vivo.eventos.slice(-8).reverse().map((e) => `<li><span>${esc(e.nombre)}</span><a href="${esc(enlaceTx(e.hash))}" target="_blank" rel="noopener">${esc(corto(e.hash))}</a></li>`).join('')}</ul></details>`
    : '';
  const enlacesViaje = registro?.becas
    ? `<p>Seguí el dinero: <a href="viaje.html?beca=${registro.becas.origen}">viaje de la beca #${registro.becas.origen}</a> · <a href="viaje.html?beca=${registro.becas.destino}">viaje de la beca #${registro.becas.destino}</a></p>`
    : '';
  return `<h2>Prueba on-chain (Sepolia)</h2>
    <p>${origen}</p>
    <p class="nota">Contrato <a href="${esc(c.explorador)}/address/${esc(c.contrato)}" target="_blank" rel="noopener">${esc(corto(c.contrato))}</a> · token de prueba (sin valor) <a href="${esc(c.explorador)}/address/${esc(c.token)}" target="_blank" rel="noopener">${esc(corto(c.token))}</a>. Se lee sin billetera.</p>
    ${datos}${enlacesViaje}${pasos}${ultimos}`;
}
