import test from 'node:test';
import assert from 'node:assert/strict';
import { ethers } from 'ethers';
import { buscarBecaDeLaEscena, calcularCuadra, construirViaje, decodificarLog, etapaDelDinero, leerEstadoBeca } from '../web/js/trazabilidad.js';
import { ESCENA_VENCE } from '../web/js/scenario.js';

const M = 1_000_000;
const CONTRATO = '0xD27EEbe1019032c1f8cCD05205451E7da6FCB7F7';
const TOKEN = '0x0Fa1a0280143EFEed64E4B5F57911f912a5c9b1C';
const TESORERIA = '0x5CCdd707B45a658Cb59D40b07796fe12e525d29C';
const SPONSOR1 = '0x1111111111111111111111111111111111111111';
const SPONSOR2 = '0x2222222222222222222222222222222222222222';
const ESTUDIANTE = '0x3333333333333333333333333333333333333333';
const MATERIA = ethers.id('MAT-101');
const ACTA = ethers.id('acta');

const iface = new ethers.Interface([
  'event BecaCreada(uint256 indexed id,address indexed creador,address indexed estudiante,uint256 montoPorMateria,uint8 cupo,uint64 vence)',
  'event FondosDepositados(uint256 indexed id,address indexed aportante,uint256 monto)',
  'event ComisionCobrada(uint256 indexed id,address indexed aportante,uint256 monto)',
  'event AprobacionRegistrada(uint256 indexed id,bytes32 indexed materiaId,bytes32 actaHash,uint64 liberableDesde)',
  'event PagoLiberado(uint256 indexed id,bytes32 indexed materiaId,address indexed estudiante,uint256 monto)',
  'event BecaCerrada(uint256 indexed id,uint256 sobranteAlFondo)',
  'event FondoAsignado(uint256 indexed id,uint256 monto,bytes32 propuestaHash)',
]);
const erc20 = new ethers.Interface(['event Transfer(address indexed from,address indexed to,uint256 value)']);

let contador = 0;
function logContrato(nombre, valores, hash, bloque) {
  const { data, topics } = iface.encodeEventLog(iface.getEvent(nombre), valores);
  return { address: CONTRATO, topics, data, transactionHash: hash, blockNumber: '0x' + bloque.toString(16), logIndex: '0x' + (contador++).toString(16) };
}
function logToken(de, a, valor, hash, bloque) {
  const { data, topics } = erc20.encodeEventLog(erc20.getEvent('Transfer'), [de, a, valor]);
  return { address: TOKEN, topics, data, transactionHash: hash, blockNumber: '0x' + bloque.toString(16), logIndex: '0x' + (contador++).toString(16) };
}
const h = (n) => '0x' + n.toString(16).padStart(64, '0');

// Beca 1: Sponsor 1 aporta 80 (comisión 0,24), se firma el acta, se paga 50 y se cierra con 30 al fondo.
function escenaCompleta() {
  const logs = [];
  const recibos = {};
  const bloques = { 100: 1000, 101: 1010, 102: 1020, 103: 1030, 104: 1040 };
  const tx = (n, bloque, eventos, transfers = []) => {
    const hash = h(n);
    const propios = eventos.map(([nom, v]) => logContrato(nom, v, hash, bloque));
    const tk = transfers.map(([d, a, v]) => logToken(d, a, v, hash, bloque));
    logs.push(...propios);
    recibos[hash] = { logs: [...tk, ...propios], status: '0x1' };
  };
  tx(1, 100, [['BecaCreada', [1, SPONSOR1, ESTUDIANTE, 50 * M, 2, 4102444800]]]);
  tx(2, 101, [['FondosDepositados', [1, SPONSOR1, 80 * M]], ['ComisionCobrada', [1, SPONSOR1, 240_000]]], [[SPONSOR1, CONTRATO, 80 * M], [SPONSOR1, TESORERIA, 240_000]]);
  tx(3, 102, [['AprobacionRegistrada', [1, MATERIA, ACTA, 1030]]]);
  tx(4, 103, [['PagoLiberado', [1, MATERIA, ESTUDIANTE, 50 * M]]], [[CONTRATO, ESTUDIANTE, 50 * M]]);
  tx(5, 104, [['BecaCerrada', [1, 30 * M]]]);
  return { logs, recibos, bloques };
}
const base = { beca: 1, contrato: CONTRATO, token: TOKEN, tesoreria: TESORERIA };

test('decodifica los eventos del contrato con sus montos y direcciones', () => {
  const { logs } = escenaCompleta();
  const aporte = decodificarLog(logs[1]);
  assert.equal(aporte.tipo, 'aporte');
  assert.equal(aporte.monto, 80 * M);
  assert.equal(aporte.aportante, SPONSOR1);
  assert.equal(decodificarLog(logs[0]).cupo, 2);
  assert.equal(decodificarLog({ ...logs[0], topics: ['0x' + '00'.repeat(32), ...logs[0].topics.slice(1)] }), null);
});

test('¿Cuadra?: un recorrido completo suma bien y todos los eventos coinciden con los Transfer', () => {
  const { logs, recibos, bloques } = escenaCompleta();
  const v = construirViaje({ ...base, logs, recibos, bloques, estadoBeca: { saldo: 0, estado: 'Activa', montoPorMateria: 50 * M, cupo: 2 } });
  assert.deepEqual(v.resumen, { aportado: 80 * M, comision: 240_000, delFondo: 0, pagado: 50 * M, sobrante: 30 * M, bloqueado: 0 });
  assert.equal(v.cuadra.ok, true);
  assert.equal(v.cuadra.diferencia, 0);
  assert.equal(v.token_.ok, true);
  assert.equal(v.eventos.length, 6);
  assert.equal(v.eventos[0].ts, 1000);
});

test('¿Cuadra?: antes del pago lo aportado sigue bloqueado y también cuadra', () => {
  const { logs, recibos, bloques } = escenaCompleta();
  const hasta = logs.filter((l) => parseInt(l.blockNumber, 16) <= 101);
  const v = construirViaje({ ...base, logs: hasta, recibos, bloques, estadoBeca: { saldo: 80 * M, estado: 'Activa', montoPorMateria: 50 * M, cupo: 2 } });
  assert.equal(v.cuadra.ok, true);
  assert.equal(v.resumen.bloqueado, 80 * M);
});

test('¿Cuadra?: si el saldo de la red no coincide, muestra la diferencia y no la esconde', () => {
  const { logs, recibos, bloques } = escenaCompleta();
  const v = construirViaje({ ...base, logs, recibos, bloques, estadoBeca: { saldo: 5 * M, estado: 'Activa', montoPorMateria: 50 * M, cupo: 2 } });
  assert.equal(v.cuadra.ok, false);
  assert.equal(v.cuadra.diferencia, -5 * M);
});

test('comprobación con Transfer: detecta un aporte cuyo token no se movió', () => {
  const { logs, recibos, bloques } = escenaCompleta();
  recibos[h(2)] = { ...recibos[h(2)], logs: recibos[h(2)].logs.filter((l) => l.address !== TOKEN) };
  const v = construirViaje({ ...base, logs, recibos, bloques, estadoBeca: { saldo: 0, estado: 'Activa', montoPorMateria: 50 * M, cupo: 2 } });
  assert.equal(v.token_.ok, false);
  assert.deepEqual(v.token_.fallas.map((f) => f.tipo).sort(), ['aporte', 'comision']);
});

test('comprobación con Transfer: un cierre que mueve tokens del contrato se marca como falla', () => {
  const { logs, recibos, bloques } = escenaCompleta();
  recibos[h(5)] = { ...recibos[h(5)], logs: [...recibos[h(5)].logs, logToken(CONTRATO, SPONSOR1, 1, h(5), 104)] };
  const v = construirViaje({ ...base, logs, recibos, bloques, estadoBeca: { saldo: 0, estado: 'Activa', montoPorMateria: 50 * M, cupo: 2 } });
  assert.deepEqual(v.token_.fallas.map((f) => f.tipo), ['cierre']);
});

test('numera a los sponsors por orden de aparición y asigna roles', () => {
  const { logs, recibos, bloques } = escenaCompleta();
  const extra = logContrato('FondosDepositados', [1, SPONSOR2, 5 * M], h(9), 102);
  recibos[h(9)] = { logs: [logToken(SPONSOR2, CONTRATO, 5 * M, h(9), 102), extra], status: '0x1' };
  const v = construirViaje({ ...base, logs: [...logs, extra], recibos, bloques: { ...bloques }, estadoBeca: { saldo: 5 * M, estado: 'Activa', montoPorMateria: 50 * M, cupo: 2 } });
  const roles = v.eventos.map((e) => e.rol);
  assert.ok(roles.includes('Sponsor 1') && roles.includes('Sponsor 2') && roles.includes('Secretaría'));
  assert.equal(v.cuadra.ok, true);
});

test('la beca que recibe del fondo común cuadra: lo asignado cuenta como entrada', () => {
  const hash = h(20);
  const ev = logContrato('FondoAsignado', [2, 30 * M, ethers.id('propuesta')], hash, 110);
  const v = construirViaje({ ...base, beca: 2, logs: [ev], recibos: { [hash]: { logs: [ev], status: '0x1' } }, bloques: { 110: 2000 }, estadoBeca: { saldo: 30 * M, estado: 'Activa', montoPorMateria: 40 * M, cupo: 1 } });
  assert.equal(v.resumen.delFondo, 30 * M);
  assert.equal(v.cuadra.ok, true);
});

test('calcularCuadra devuelve la diferencia exacta', () => {
  assert.deepEqual(calcularCuadra({ aportado: 10, delFondo: 0, pagado: 4, sobrante: 0, bloqueado: 6 }), { entradas: 10, salidas: 10, diferencia: 0, ok: true });
  assert.equal(calcularCuadra({ aportado: 10, delFondo: 2, pagado: 4, sobrante: 0, bloqueado: 6 }).diferencia, 2);
});

const palabraHex = (n) => ethers.toBeHex(BigInt(n), 32).slice(2);
const structBeca = ({ estudiante = 0n, monto = 0, saldo = 0, vence = 0, cupo = 0, registradas = 0, pagadas = 0, estado = 0 }) =>
  '0x' + [BigInt(estudiante), monto, saldo, vence, cupo, registradas, pagadas, estado].map(palabraHex).join('');

test('una beca que no existe NO se muestra como Activa ni como que cuadra', () => {
  for (const estadoBeca of [
    { existe: false, saldo: 0, estado: null, montoPorMateria: 0, cupo: 0 },
    { saldo: 0, estado: 'Activa', montoPorMateria: 0, cupo: 0 }, // el struct vacío, sin la marca nueva
  ]) {
    const v = construirViaje({ ...base, beca: 99, logs: [], recibos: {}, bloques: {}, estadoBeca });
    assert.equal(v.existe, false);
    assert.equal(v.estado, null);
    assert.equal(v.cuadra, null);
    assert.equal(v.resumen, null);
    assert.equal(v.token_, null);
    assert.deepEqual(v.eventos, []);
    assert.equal(v.mensaje, 'Esta beca todavía no existe en la red');
    assert.equal(etapaDelDinero(v), null);
  }
});

test('leerEstadoBeca: el struct en ceros es una beca inexistente y uno completo se lee bien', async () => {
  const vacia = await leerEstadoBeca(async () => structBeca({}), { contrato: CONTRATO }, 7);
  assert.equal(vacia.existe, false);
  assert.equal(vacia.estado, null);
  const real = await leerEstadoBeca(async () => structBeca({ estudiante: ESTUDIANTE, monto: 50 * M, saldo: 80 * M, vence: ESCENA_VENCE, cupo: 2, registradas: 1, estado: 0 }), { contrato: CONTRATO }, 7);
  assert.deepEqual([real.existe, real.estado, real.cupo, real.registradas, real.saldo, real.vence], [true, 'Activa', 2, 1, 80 * M, ESCENA_VENCE]);
});

test('etapaDelDinero: sigue la plata desde que se crea la beca hasta el fondo común', () => {
  const { logs, recibos, bloques } = escenaCompleta();
  const hasta = (bloque, saldo) =>
    construirViaje({ ...base, logs: logs.filter((l) => parseInt(l.blockNumber, 16) <= bloque), recibos, bloques, estadoBeca: { saldo, estado: 'Activa', montoPorMateria: 50 * M, cupo: 2 } });
  assert.equal(etapaDelDinero(hasta(100, 0)).clave, 'creada');
  assert.equal(etapaDelDinero(hasta(101, 80 * M)).clave, 'bloqueado');
  assert.equal(etapaDelDinero(hasta(102, 80 * M)).clave, 'acta');
  assert.equal(etapaDelDinero(hasta(103, 30 * M)).clave, 'pagado');
  const fin = etapaDelDinero(hasta(104, 0));
  assert.deepEqual([fin.clave, fin.indice, fin.total], ['fondo', 5, 6]);
});

test('buscarBecaDeLaEscena: encuentra la escena más nueva leyendo sólo la red', async () => {
  const becas = {
    1: { cupo: 2, vence: 1, saldo: 80 * M }, // no es de escena
    2: { cupo: 1, vence: 1, saldo: 0 },
    3: { cupo: 2, vence: ESCENA_VENCE, saldo: 80 * M, monto: 50 * M },
    4: { cupo: 1, vence: ESCENA_VENCE, saldo: 10 * M, monto: 40 * M },
  };
  const fabricar = (registradas3) => async (metodo, [{ data }]) => {
    if (data.startsWith('0x47e66ff4')) return '0x' + palabraHex(4);
    const id = parseInt(data.slice(-64), 16);
    return structBeca({ monto: becas[id].monto ?? 50 * M, saldo: becas[id].saldo, vence: becas[id].vence, cupo: becas[id].cupo, registradas: id === 3 ? registradas3 : 0 });
  };
  assert.deepEqual(await buscarBecaDeLaEscena(fabricar(0), { contrato: CONTRATO }, ESCENA_VENCE), { origen: 3, destino: 4, lista: true });
  assert.equal((await buscarBecaDeLaEscena(fabricar(1), { contrato: CONTRATO }, ESCENA_VENCE)).lista, false);
});
