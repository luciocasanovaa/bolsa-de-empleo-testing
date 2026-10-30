import test from 'node:test';
import assert from 'node:assert/strict';
import { ethers } from 'ethers';
import { calcularCuadra, construirViaje, decodificarLog } from '../web/js/trazabilidad.js';

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
