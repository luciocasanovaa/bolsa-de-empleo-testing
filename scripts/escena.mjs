// Prepara la escena de la demo, corre una vez el flujo completo en Sepolia y vigila las actas.
// La clave va SOLO en un archivo .env local (ignorado por git), nunca en la línea de comandos:
//   RELAYER_KEY=0x...        SEPOLIA_RPC_URL=...        ESTUDIANTE=0x...        ESTUDIANTE2=0x...
// Uso: node scripts/escena.mjs chequeo | preparar | flujo | vigilante
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { ethers } from 'ethers';
import config from '../web/config.js';
import { ESCENA_VENCE } from '../web/js/scenario.js';
import { reunirViaje } from '../web/js/trazabilidad.js';

const M = 1_000_000n;
const FLUJO_VENCE = ESCENA_VENCE + 1; // marca distinta: el recorrido completo no se mezcla con la escena
const SALIDA = fileURLToPath(new URL('../web/data/onchain.json', import.meta.url));

const ABI = [
  'function totalBecas() view returns (uint256)',
  'function fondoComun() view returns (uint256)',
  'function comisionBps() view returns (uint16)',
  'function ventana() view returns (uint64)',
  'function SECRETARIA() view returns (bytes32)',
  'function APROBADOR() view returns (bytes32)',
  'function hasRole(bytes32,address) view returns (bool)',
  'function becas(uint256) view returns (address estudiante,uint256 montoPorMateria,uint256 saldo,uint64 vence,uint8 cupo,uint8 registradas,uint8 pagadas,uint8 estado)',
  'function aprobaciones(uint256,bytes32) view returns (bytes32 actaHash,uint64 liberableDesde,bool existe,bool liberada)',
  'function crearBeca(address,uint256,uint8,uint64) returns (uint256)',
  'function depositar(uint256,uint256)',
  'function registrarAprobacion(uint256,bytes32,bytes32)',
  'function liberar(uint256,bytes32)',
  'function cerrarBeca(uint256)',
  'function asignarDeFondo(uint256,uint256,bytes32)',
  'event AprobacionRegistrada(uint256 indexed id,bytes32 indexed materiaId,bytes32 actaHash,uint64 liberableDesde)',
];
const ERC20 = [
  'function balanceOf(address) view returns (uint256)',
  'function allowance(address,address) view returns (uint256)',
  'function approve(address,uint256) returns (bool)',
  'function mint(address,uint256)',
];

const dormir = (ms) => new Promise((r) => setTimeout(r, ms));

// Espera real: sondea el reloj de la cadena hasta que pase `hasta` (segundos).
async function esperarReal(provider, hasta) {
  for (;;) {
    const b = await provider.getBlock('latest');
    if (b.timestamp >= hasta) return;
    await dormir(2000);
  }
}

export function conectar({ signer, direcciones = config.sepolia }) {
  return {
    signer,
    contrato: new ethers.Contract(direcciones.contrato, ABI, signer),
    token: new ethers.Contract(direcciones.token, ERC20, signer),
    direcciones,
  };
}

// Busca la escena más nueva: la última beca de dos materias y la última de una, con la marca de escena.
async function buscarEscena(ctx) {
  const total = Number(await ctx.contrato.totalBecas());
  const hallado = {};
  for (let id = total; id >= 1 && id > total - 40 && !(hallado[2] && hallado[1]); id--) {
    const b = await ctx.contrato.becas(id);
    if (Number(b.vence) === ESCENA_VENCE) hallado[Number(b.cupo)] ??= { id, b };
  }
  const o = hallado[2];
  const d = hallado[1];
  return {
    origen: o ? o.id : null,
    destino: d ? d.id : null,
    // "Lista" = nadie firmó todavía y tiene fondos para pagar la materia.
    lista: Boolean(o && Number(o.b.registradas) === 0 && o.b.saldo >= o.b.montoPorMateria),
  };
}

export async function chequeo(ctx, log = console.log) {
  const yo = await ctx.signer.getAddress();
  const prov = ctx.signer.provider;
  const [eth, bps, ventana, sec, apr, bloque] = await Promise.all([
    prov.getBalance(yo),
    ctx.contrato.comisionBps(),
    ctx.contrato.ventana(),
    ctx.contrato.SECRETARIA(),
    ctx.contrato.APROBADOR(),
    prov.getBlockNumber(),
  ]);
  const [esSec, esApr] = await Promise.all([ctx.contrato.hasRole(sec, yo), ctx.contrato.hasRole(apr, yo)]);
  const gas = (await prov.getFeeData()).gasPrice ?? 0n;
  const estimado = gas * 1_500_000n; // ~1,5 M de gas cubre una escena y el flujo con margen
  const escena = await buscarEscena(ctx);
  const res = {
    cuenta: yo,
    bloque,
    ethSepolia: ethers.formatEther(eth),
    precioGasGwei: ethers.formatUnits(gas, 'gwei'),
    ethEstimadoNecesario: ethers.formatEther(estimado),
    comisionBps: Number(bps),
    ventanaSeg: Number(ventana),
    SECRETARIA: esSec,
    APROBADOR: esApr,
    escena: escena.lista
      ? `LISTA para la demo en vivo: firmar el acta en la beca #${escena.origen} (el fondo común va a la #${escena.destino})`
      : escena.origen
        ? `La beca #${escena.origen} ya se usó o no tiene fondos: correr "preparar" para dejar una nueva`
        : 'No hay escena: correr "preparar"',
  };
  log(res);
  const problemas = [];
  if (!esSec || !esApr) problemas.push('la cuenta no tiene los roles SECRETARIA y APROBADOR: el dueño del deploy debe ejecutar configurarRoles(cuenta, cuenta)');
  if (eth < estimado * 2n) problemas.push('falta ETH de Sepolia para gas');
  if (problemas.length) throw new Error(problemas.join('; '));
  return { ...res, listaParaDemo: escena.lista, becaOrigen: escena.origen, becaDestino: escena.destino };
}

async function asegurarTokens(ctx, yo, monto) {
  if ((await ctx.token.balanceOf(yo)) < monto) await (await ctx.token.mint(yo, monto)).wait();
  if ((await ctx.token.allowance(yo, ctx.direcciones.contrato)) < monto) {
    await (await ctx.token.approve(ctx.direcciones.contrato, monto * 2n)).wait();
  }
}

// Deja SIEMPRE una escena nueva lista para firmar. Se puede correr cuantas veces haga falta:
// los ensayos gastan escenas viejas y la más nueva queda para el pitch.
export async function preparar(ctx, { estudiante, estudiante2, log = console.log } = {}) {
  const yo = await ctx.signer.getAddress();
  await asegurarTokens(ctx, yo, 150n * M);
  const c = ctx.contrato;
  const tx = async (n, p) => { const r = await (await p).wait(); log(`${n}: ${r.hash}`); return r; };
  const origen = Number(await c.totalBecas()) + 1;
  await tx(`crearBeca #${origen} (2 materias)`, c.crearBeca(estudiante ?? yo, 50n * M, 2, ESCENA_VENCE));
  await tx(`crearBeca #${origen + 1} (1 materia, recibe el fondo común)`, c.crearBeca(estudiante2 ?? yo, 40n * M, 1, ESCENA_VENCE));
  await tx(`depositar #${origen} (80)`, c.depositar(origen, 80n * M));
  await tx(`depositar #${origen + 1} (10)`, c.depositar(origen + 1, 10n * M));
  return { origen, destino: origen + 1 };
}

// Recorrido completo, una vez, con becas propias para no gastar las de la demo en vivo.
export async function flujo(ctx, { estudiante, estudiante2, esperar, salida = SALIDA, desdeBloque = config.sepolia.desdeBloque, log = console.log } = {}) {
  const yo = await ctx.signer.getAddress();
  const prov = ctx.signer.provider;
  const c = ctx.contrato;
  const materia = ethers.id('MAT-101');
  const pasos = [];
  const paso = async (descripcion, funcion, promesa) => {
    const r = await (await promesa).wait();
    pasos.push({ paso: descripcion, funcion, hash: r.hash, bloque: r.blockNumber, gas: Number(r.gasUsed) });
    log(`${descripcion}: ${r.hash}`);
    return r;
  };
  await asegurarTokens(ctx, yo, 200n * M);
  const idA = Number(await c.totalBecas()) + 1;
  const idB = idA + 1;
  await paso('1. Crear beca', 'crearBeca', c.crearBeca(estudiante ?? yo, 50n * M, 2, FLUJO_VENCE));
  await paso('2. Crear segunda beca', 'crearBeca', c.crearBeca(estudiante2 ?? yo, 40n * M, 1, FLUJO_VENCE));
  await paso('3. Aportar (con comisión encima)', 'depositar', c.depositar(idA, 80n * M));
  await paso('4. Aportar a la segunda beca', 'depositar', c.depositar(idB, 10n * M));
  await paso('5. Firmar acta (Secretaría)', 'registrarAprobacion', c.registrarAprobacion(idA, materia, ethers.id(`acta:${idA}:MAT-101:${Date.now()}`)));
  const { liberableDesde } = await c.aprobaciones(idA, materia);
  await (esperar ?? ((h) => esperarReal(prov, h)))(Number(liberableDesde));
  await paso('6. Pago liberado al estudiante', 'liberar', c.liberar(idA, materia));
  await paso('7. Cerrar beca: sobrante al fondo común', 'cerrarBeca', c.cerrarBeca(idA));
  const fondo = await c.fondoComun();
  await paso('8. Aprobar reparto del fondo común', 'asignarDeFondo', c.asignarDeFondo(idB, fondo, ethers.id(`propuesta:${idB}:${fondo}`)));

  // El viaje de cada beca queda guardado: es el respaldo de la página pública si ningún RPC responde.
  const rpc = (metodo, params) => prov.send(metodo, params);
  const datos = { contrato: ctx.direcciones.contrato, token: ctx.direcciones.token, desdeBloque };
  const viajes = { [idA]: await reunirViaje(rpc, datos, idA), [idB]: await reunirViaje(rpc, datos, idB) };

  const resultado = {
    generado: new Date().toISOString(),
    red: 'Sepolia',
    contrato: ctx.direcciones.contrato,
    token: ctx.direcciones.token,
    becas: { origen: idA, destino: idB },
    pasos,
    viajes,
    estadoFinal: {
      fondoComun: Number(await c.fondoComun()),
      saldoEstudiante: Number(await ctx.token.balanceOf(estudiante ?? yo)),
    },
  };
  if (salida) writeFileSync(salida, JSON.stringify(resultado, null, 2) + '\n');
  return resultado;
}

// Vigilante: cuando se firma un acta y vence la ventana, llama a liberar(). `liberar` NO exige ningún rol
// (lo puede llamar cualquiera después de la ventana y siempre paga al estudiante), así que esta cuenta
// sólo pone el gas. Corre hasta que `senal` se aborta (en la línea de comandos, hasta Ctrl+C).
export async function vigilar(ctx, { senal, intervaloMs = 2000, desdeBloque = config.sepolia.desdeBloque, log = console.log } = {}) {
  const prov = ctx.signer.provider;
  const c = ctx.contrato;
  const atendidas = new Set();
  let pagos = 0;
  log('Vigilante activo: esperando actas firmadas...');
  while (!senal?.aborted) {
    try {
      const logs = await c.queryFilter(c.filters.AprobacionRegistrada(), desdeBloque, 'latest');
      const ahora = (await prov.getBlock('latest')).timestamp;
      for (const l of logs) {
        const { id, materiaId } = l.args;
        const clave = `${id}:${materiaId}`;
        if (atendidas.has(clave)) continue;
        const a = await c.aprobaciones(id, materiaId);
        if (!a.existe || a.liberada) { atendidas.add(clave); continue; } // revocada o ya pagada
        if (ahora < Number(a.liberableDesde)) continue; // sigue en ventana de seguridad
        try {
          const r = await (await c.liberar(id, materiaId)).wait();
          atendidas.add(clave);
          pagos++;
          log(`Pago liberado (beca #${id}): ${r.hash}`);
        } catch (e) {
          log(`Aún no se puede pagar la beca #${id}: ${e.shortMessage || e.message}`); // por ejemplo, "Esperando fondos"
        }
      }
    } catch (e) {
      log(`Vigilante: ${e.shortMessage || e.message} (se reintenta)`);
    }
    await dormir(intervaloMs);
  }
  return pagos;
}

// CLI
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  try { process.loadEnvFile(); } catch { /* sin .env: se usan las variables del entorno */ }
  const modo = process.argv[2];
  if (!process.env.RELAYER_KEY) {
    console.error('Falta RELAYER_KEY. Crear un archivo .env (copiar .env.example) con la clave de una cuenta de testnet.');
    process.exit(1);
  }
  const prov = new ethers.JsonRpcProvider(process.env.SEPOLIA_RPC_URL || config.sepolia.rpc, config.sepolia.chainId, { staticNetwork: true });
  const ctx = conectar({ signer: new ethers.Wallet(process.env.RELAYER_KEY, prov) });
  const opciones = { estudiante: process.env.ESTUDIANTE || undefined, estudiante2: process.env.ESTUDIANTE2 || undefined };
  const previo = async () => { await chequeo(ctx, () => {}); };
  const acciones = {
    chequeo: () => chequeo(ctx),
    preparar: async () => { await previo(); const r = await preparar(ctx, opciones); console.log(`\nEscena lista: firmar el acta en la beca #${r.origen}`); },
    flujo: async () => { await previo(); const r = await flujo(ctx, opciones); console.log(`\nGuardado en web/data/onchain.json (${r.pasos.length} transacciones)`); },
    vigilante: async () => {
      await previo();
      const ctl = new AbortController();
      process.on('SIGINT', () => ctl.abort());
      await vigilar(ctx, { senal: ctl.signal });
    },
  };
  if (!acciones[modo]) {
    console.error('Uso: node scripts/escena.mjs chequeo | preparar | flujo | vigilante');
    process.exit(1);
  }
  acciones[modo]().catch((e) => { console.error('ERROR:', e.shortMessage || e.message); process.exit(1); });
}
