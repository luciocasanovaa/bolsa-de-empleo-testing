// Trazabilidad: reconstruye "el viaje del dinero" de una beca a partir de los eventos del contrato y
// de los Transfer del token (el movimiento real de los fondos), y controla que cuadre.
// No usa ethers: trabaja con logs en el formato crudo del RPC, así sirve en el navegador y en Node.
const TRANSFER = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';
const TOPICOS = {
  '0xcf1bf2345d67fe3f7acb9215287cb439898108c2a1a49531d8b1ebcceccf658a': 'creada',
  '0xf93f411b4bf010efe96d873c95a998da42c3e9a05b1c3128d8607f578c33529b': 'aporte',
  '0x421cb4996b9fc3ef198d57c69d679517cc1e51f2344a16e4bf17973edcf08077': 'comision',
  '0xb6fff16f369c9b3359d411dc906939017decfc3da8a2c9881b3e23e7b3702be5': 'acta',
  '0xb7781d6d4b585506be87d2d0884e1d2705f03f485644e9057cf50e927822df4f': 'revocada',
  '0x4e8d2e8806f684bd9ca315d6b4ade75cc1faefef45801c9574ad13cee39b3750': 'pago',
  '0x793181623bb86aaa517976040d528d1b86e2e374aa958e4ba3e22ba1a5acbb84': 'cierre',
  '0xad2cbaf9bfb3b42660d2e5ae0d36ad35ebe2c8826ff0fb9a3f11ea4e51af6f62': 'fondo',
};
const SEL = { totalBecas: '0x47e66ff4', becas: '0x950893cc', tesoreria: '0xe933dc54', fondoComun: '0x85b120bf', balanceOf: '0x70a08231' };
const TRAMO = 5000;

const palabra = (hex, i) => hex.slice(2 + i * 64, 2 + (i + 1) * 64);
const numero = (w) => Number(BigInt('0x' + w));
const direccion = (w) => ('0x' + w.slice(-40)).toLowerCase();

// Decodifica un log del contrato (formato RPC). Devuelve null si no es un evento de EduTrust.
export function decodificarLog(log) {
  const tipo = TOPICOS[log.topics[0]];
  if (!tipo) return null;
  const t = log.topics;
  const d = log.data;
  const base = { tipo, beca: numero(t[1].slice(2)), hash: log.transactionHash, bloque: numero(log.blockNumber.slice(2)), orden: numero(log.logIndex.slice(2)) };
  switch (tipo) {
    case 'creada': return { ...base, creador: direccion(t[2]), estudiante: direccion(t[3]), montoPorMateria: numero(palabra(d, 0)), cupo: numero(palabra(d, 1)) };
    case 'aporte': return { ...base, aportante: direccion(t[2]), monto: numero(palabra(d, 0)) };
    case 'comision': return { ...base, aportante: direccion(t[2]), monto: numero(palabra(d, 0)) };
    case 'acta': return { ...base, materia: t[2], actaHash: '0x' + palabra(d, 0), liberableDesde: numero(palabra(d, 1)) };
    case 'revocada': return { ...base, materia: t[2] };
    case 'pago': return { ...base, materia: t[2], estudiante: direccion(t[3]), monto: numero(palabra(d, 0)) };
    case 'cierre': return { ...base, sobrante: numero(palabra(d, 0)) };
    case 'fondo': return { ...base, monto: numero(palabra(d, 0)), propuestaHash: '0x' + palabra(d, 1) };
    default: return null;
  }
}

// Transfers del token dentro del recibo de una transacción.
function transfersDe(recibo, token) {
  return (recibo?.logs ?? [])
    .filter((l) => l.address.toLowerCase() === token.toLowerCase() && l.topics[0] === TRANSFER)
    .map((l) => ({ de: direccion(l.topics[1]), a: direccion(l.topics[2]), monto: numero(palabra(l.data, 0)) }));
}

const hayMovimiento = (transfers, f) => transfers.some(f);

// Une los eventos con los Transfer de su misma transacción y dice si el token se movió como el evento afirma.
function verificar(ev, transfers, { contrato, tesoreria }) {
  const c = contrato.toLowerCase();
  const t = tesoreria.toLowerCase();
  switch (ev.tipo) {
    case 'aporte': return hayMovimiento(transfers, (x) => x.de === ev.aportante && x.a === c && x.monto === ev.monto);
    case 'comision': return hayMovimiento(transfers, (x) => x.de === ev.aportante && x.a === t && x.monto === ev.monto);
    case 'pago': return hayMovimiento(transfers, (x) => x.de === c && x.a === ev.estudiante && x.monto === ev.monto);
    // Cierre, fondo, actas y creación son contabilidad interna: no deben mover tokens del contrato.
    default: return !hayMovimiento(transfers, (x) => x.de === c || x.a === c);
  }
}

// La cuenta: lo que entró a la beca (aportes + lo que le asigna el fondo común) debe ser igual a lo que
// salió (pagos + sobrante al fondo) más lo que sigue bloqueado hoy. Si no coincide se muestra la diferencia.
export function calcularCuadra({ aportado, delFondo, pagado, sobrante, bloqueado }) {
  const entradas = aportado + delFondo;
  const salidas = pagado + sobrante + bloqueado;
  return { entradas, salidas, diferencia: entradas - salidas, ok: entradas === salidas };
}

export function construirViaje({ beca, contrato, token, tesoreria, logs, recibos, bloques, estadoBeca, generado = null }) {
  // El struct vacío de una beca inexistente se lee como "Activa" con todo en cero: no se debe mostrar como
  // si hubiera un recorrido que "cuadra". Quien dibuja la pantalla muestra `mensaje` y oculta el resto.
  if (estadoBeca.existe === false || !(estadoBeca.cupo > 0)) {
    return { beca, existe: false, contrato, token, generado, estado: null, eventos: [], resumen: null, cuadra: null, token_: null, mensaje: 'Esta beca todavía no existe en la red' };
  }
  const sponsors = new Map();
  const sponsor = (dir) => {
    if (!sponsors.has(dir)) sponsors.set(dir, `Sponsor ${sponsors.size + 1}`);
    return sponsors.get(dir);
  };
  const eventos = logs
    .map(decodificarLog)
    .filter((e) => e && e.beca === beca)
    .sort((x, y) => x.bloque - y.bloque || x.orden - y.orden)
    .map((e) => {
      const transfers = transfersDe(recibos[e.hash], token);
      // Los roles salen de lo que el contrato exige para cada acción; los sponsors se numeran por aparición.
      const rol = e.aportante
        ? sponsor(e.aportante)
        : { creada: 'Creador de la beca', acta: 'Secretaría', revocada: 'Secretaría', pago: 'Servicio automático (lo puede llamar cualquiera)', cierre: 'Aprobador', fondo: 'Aprobador' }[e.tipo];
      return { ...e, rol, ts: bloques[e.bloque] ?? null, coincideConToken: verificar(e, transfers, { contrato, tesoreria }) };
    });
  const suma = (tipo, campo = 'monto') => eventos.filter((e) => e.tipo === tipo).reduce((s, e) => s + e[campo], 0);
  const resumen = {
    aportado: suma('aporte'),
    comision: suma('comision'),
    delFondo: suma('fondo'),
    pagado: suma('pago'),
    sobrante: suma('cierre', 'sobrante'),
    bloqueado: estadoBeca.saldo,
  };
  const fallasToken = eventos.filter((e) => !e.coincideConToken).map((e) => ({ tipo: e.tipo, hash: e.hash }));
  return {
    beca,
    existe: true,
    contrato,
    token,
    generado,
    estado: estadoBeca.estado,
    montoPorMateria: estadoBeca.montoPorMateria,
    cupo: estadoBeca.cupo,
    eventos,
    resumen,
    cuadra: calcularCuadra(resumen),
    token_: { ok: fallasToken.length === 0, revisados: eventos.length, fallas: fallasToken },
  };
}

// ---- Lectura de la red. `rpc(metodo, params)` la aporta quien llama (navegador o Node). ----

export async function leerEstadoBeca(rpc, { contrato }, beca) {
  const data = SEL.becas + beca.toString(16).padStart(64, '0');
  const r = await rpc('eth_call', [{ to: contrato, data }, 'latest']);
  const cupo = numero(palabra(r, 4));
  return {
    existe: cupo > 0, // una beca sin crear devuelve el struct en ceros
    estudiante: direccion(palabra(r, 0)),
    montoPorMateria: numero(palabra(r, 1)),
    saldo: numero(palabra(r, 2)),
    vence: numero(palabra(r, 3)),
    cupo,
    registradas: numero(palabra(r, 5)),
    estado: cupo > 0 ? (['Activa', 'Finalizada', 'Cerrada'][numero(palabra(r, 7))] ?? 'Desconocido') : null,
  };
}

export async function leerTesoreria(rpc, { contrato }) {
  return direccion(palabra(await rpc('eth_call', [{ to: contrato, data: SEL.tesoreria }, 'latest']), 0));
}

// Recorre los logs del contrato por tramos y se queda con los de una beca.
export async function leerLogsContrato(rpc, { contrato, desdeBloque }) {
  const ultimo = numero((await rpc('eth_blockNumber', [])).slice(2));
  const logs = [];
  for (let d = desdeBloque; d <= ultimo; d += TRAMO) {
    const h = Math.min(d + TRAMO - 1, ultimo);
    logs.push(...(await rpc('eth_getLogs', [{ address: contrato, fromBlock: '0x' + d.toString(16), toBlock: '0x' + h.toString(16) }])));
  }
  return logs;
}

async function enLotes(items, n, fn) {
  const salida = new Array(items.length);
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    while (i < items.length) { const k = i++; salida[k] = await fn(items[k]); }
  }));
  return salida;
}

// Reúne todo lo necesario para una beca y arma el viaje.
export async function reunirViaje(rpc, { contrato, token, desdeBloque }, beca) {
  const [todos, estadoBeca, tesoreria] = await Promise.all([leerLogsContrato(rpc, { contrato, desdeBloque }), leerEstadoBeca(rpc, { contrato }, beca), leerTesoreria(rpc, { contrato })]);
  const logs = todos.filter((l) => TOPICOS[l.topics[0]] && numero(l.topics[1].slice(2)) === beca);
  const hashes = [...new Set(logs.map((l) => l.transactionHash))];
  const bloquesUnicos = [...new Set(logs.map((l) => l.blockNumber))];
  const recibosLista = await enLotes(hashes, 6, (h) => rpc('eth_getTransactionReceipt', [h]));
  const bloquesLista = await enLotes(bloquesUnicos, 6, (b) => rpc('eth_getBlockByNumber', [b, false]));
  const recibos = Object.fromEntries(hashes.map((h, i) => [h, recibosLista[i]]));
  const bloques = Object.fromEntries(bloquesUnicos.map((b, i) => [numero(b.slice(2)), numero(bloquesLista[i].timestamp.slice(2))]));
  return construirViaje({ beca, contrato, token, tesoreria, logs, recibos, bloques, estadoBeca, generado: new Date().toISOString() });
}

// "Seguí tu aporte": a partir de una transacción, dice qué hizo con la plata y a qué beca fue.
export async function seguirTransaccion(rpc, { contrato, token }, hash) {
  const recibo = await rpc('eth_getTransactionReceipt', [hash]);
  if (!recibo) return { encontrada: false };
  const eventos = recibo.logs.filter((l) => l.address.toLowerCase() === contrato.toLowerCase()).map(decodificarLog).filter(Boolean);
  const transfers = transfersDe(recibo, token);
  return { encontrada: true, ok: recibo.status === '0x1', eventos, transfers, bloque: numero(recibo.blockNumber.slice(2)) };
}

export const descripcion = (e) => ({
  creada: `Se creó la beca (${e.cupo} ${e.cupo === 1 ? 'materia' : 'materias'}).`,
  aporte: 'Aporte: la plata entra al contrato y queda bloqueada en esta beca.',
  comision: 'Comisión de EduTrust: se suma al aporte y va a la tesorería, no sale de la beca.',
  acta: 'La Secretaría firmó el acta de una materia. Empieza la ventana de seguridad.',
  revocada: 'La Secretaría revocó el acta dentro de la ventana de seguridad.',
  pago: 'Pago liberado: el contrato transfiere la plata al estudiante.',
  cierre: 'Se cerró la beca: lo que no se usó pasa al fondo común.',
  fondo: 'El fondo común aportó a esta beca (propuesta aprobada por una persona).',
}[e.tipo]);


// En qué paso está la plata de una beca (para marcarlo en un camino o línea de progreso).
export const ETAPAS = ['creada', 'bloqueado', 'acta', 'pagado', 'cerrada', 'fondo'];
export function etapaDelDinero(viaje) {
  if (!viaje || viaje.existe === false) return null;
  const r = viaje.resumen;
  const cuenta = (tipo) => viaje.eventos.filter((e) => e.tipo === tipo).length;
  const actasVigentes = cuenta('acta') - cuenta('revocada') - cuenta('pago');
  let clave;
  let etiqueta;
  if (cuenta('cierre') > 0 && r.sobrante > 0) [clave, etiqueta] = ['fondo', 'El sobrante pasó al fondo común'];
  else if (cuenta('cierre') > 0) [clave, etiqueta] = ['cerrada', 'La beca se cerró sin sobrante'];
  else if (r.pagado > 0) [clave, etiqueta] = ['pagado', 'La plata ya llegó al estudiante'];
  else if (actasVigentes > 0) [clave, etiqueta] = ['acta', 'Acta firmada: la plata espera la ventana de seguridad o el pago'];
  else if (r.aportado + r.delFondo > 0) [clave, etiqueta] = ['bloqueado', 'La plata está bloqueada en el contrato'];
  else [clave, etiqueta] = ['creada', 'Beca creada, todavía sin fondos'];
  return { clave, etiqueta, indice: ETAPAS.indexOf(clave), total: ETAPAS.length };
}

// Encuentra la escena de la demo leyendo solo la red (sin onchain.json): la última beca de dos materias y
// la última de una, marcadas con el vencimiento de escena. `lista` = nadie firmó y hay fondos para pagar.
export async function buscarBecaDeLaEscena(rpc, { contrato }, venceEscena) {
  const total = numero(palabra(await rpc('eth_call', [{ to: contrato, data: SEL.totalBecas }, 'latest']), 0));
  const hallado = {};
  for (let id = total; id >= 1 && id > total - 40 && !(hallado[2] && hallado[1]); id--) {
    const b = await leerEstadoBeca(rpc, { contrato }, id);
    if (b.vence === venceEscena) hallado[b.cupo] ??= { id, b };
  }
  const o = hallado[2];
  return {
    origen: o?.id ?? null,
    destino: hallado[1]?.id ?? null,
    lista: Boolean(o && o.b.registradas === 0 && o.b.saldo >= o.b.montoPorMateria),
  };
}
