// Pruebas del libro simulado, que replica las reglas de contracts/EduTrust.sol.
import test from 'node:test';
import assert from 'node:assert/strict';
import { SimLedger, CONTRATO } from '../web/js/ledger-sim.js';

const M = 1_000_000;
const MAT1 = '0x01';
const MAT2 = '0x02';
const ACTA = '0xaa';
const VENCE = 4102444800;

function escena() {
  let t = 1000;
  const l = new SimLedger({ ventana: 10, now: () => t });
  l.configurarRoles('sec', 'sec');
  l.mint('A', 120 * M); // alcanza para 100 más la comisión del 0,3 %
  l.mint('B', 50 * M);
  const id = l.crearBeca('A', { estudiante: 'E', montoPorMateria: 50 * M, cupo: 2, vence: VENCE });
  return { l, id, avanzar: (s) => (t += s) };
}

// Invariante: lo que tiene el contrato es la suma de saldos de becas más el fondo común.
function invariante(l) {
  let saldos = 0;
  for (const b of l.becas.values()) saldos += b.saldo;
  assert.equal(l.balanceOf(CONTRATO), saldos + l.fondoComun);
}

test('flujo completo: aportes, firma, ventana, pago, cierre y fondo común', () => {
  const { l, id, avanzar } = escena();
  l.depositar('A', id, 50 * M);
  l.depositar('B', id, 30 * M);
  assert.equal(l.aportado(id), 80 * M);

  l.registrarAprobacion('sec', id, MAT1, ACTA);
  assert.equal(l.estadoMateria(id, MAT1), 'programado');
  assert.throws(() => l.liberar('x', id, MAT1), /En ventana de seguridad/);

  avanzar(10);
  assert.equal(l.estadoMateria(id, MAT1), 'disponible');
  l.liberar('x', id, MAT1);
  assert.equal(l.balanceOf('E'), 50 * M);
  assert.equal(l.estadoMateria(id, MAT1), 'pagado');
  assert.equal(l.becas.get(id).saldo, 30 * M);

  l.cerrarBeca('sec', id);
  assert.equal(l.fondoComun, 30 * M);
  assert.equal(l.becas.get(id).estado, 'Cerrada');
  invariante(l);

  const id2 = l.crearBeca('A', { estudiante: 'E2', montoPorMateria: 40 * M, cupo: 1, vence: VENCE });
  l.depositar('A', id2, 10 * M);
  l.asignarDeFondo('sec', id2, 30 * M, '0xbb');
  assert.equal(l.becas.get(id2).saldo, 40 * M);
  assert.equal(l.fondoComun, 0);
  invariante(l);
});

test('no se puede superar la meta ni depositar sin saldo', () => {
  const { l, id } = escena();
  l.depositar('A', id, 100 * M);
  assert.throws(() => l.depositar('B', id, 1), /Supera la meta/);
  const { l: l2, id: id2 } = escena();
  assert.throws(() => l2.depositar('B', id2, 80 * M), /Saldo insuficiente/);
});

test('sólo la Secretaría firma y sólo un aprobador asigna del fondo', () => {
  const { l, id } = escena();
  assert.throws(() => l.registrarAprobacion('A', id, MAT1, ACTA), /SECRETARIA/);
  assert.throws(() => l.asignarDeFondo('A', id, 1, '0x'), /APROBADOR/);
});

test('una materia se registra una sola vez y respeta el cupo', () => {
  const { l, id } = escena();
  l.registrarAprobacion('sec', id, MAT1, ACTA);
  assert.throws(() => l.registrarAprobacion('sec', id, MAT1, ACTA), /Ya registrada/);
  l.registrarAprobacion('sec', id, MAT2, ACTA);
  assert.throws(() => l.registrarAprobacion('sec', id, '0x03', ACTA), /Sin cupo/);
});

test('la revocación sólo vale dentro de la ventana y permite volver a firmar', () => {
  const { l, id, avanzar } = escena();
  l.registrarAprobacion('sec', id, MAT1, ACTA);
  l.revocarAprobacion('sec', id, MAT1);
  assert.equal(l.estadoMateria(id, MAT1), 'sin-firma');
  l.registrarAprobacion('sec', id, MAT1, ACTA);
  avanzar(10);
  assert.throws(() => l.revocarAprobacion('sec', id, MAT1), /Ventana cerrada/);
});

test('sin fondos el pago espera y se libera cuando llegan', () => {
  const { l, id, avanzar } = escena();
  l.depositar('A', id, 20 * M);
  l.registrarAprobacion('sec', id, MAT1, ACTA);
  avanzar(10);
  assert.throws(() => l.liberar('x', id, MAT1), /Esperando fondos/);
  l.depositar('A', id, 30 * M);
  l.liberar('x', id, MAT1);
  assert.equal(l.balanceOf('E'), 50 * M);
  invariante(l);
});

test('cerrar la beca: requiere aprobador o vencimiento y sin pagos pendientes', () => {
  const { l, id, avanzar } = escena();
  l.depositar('A', id, 50 * M);
  assert.throws(() => l.cerrarBeca('A', id), /Aun no vence/);
  l.registrarAprobacion('sec', id, MAT1, ACTA);
  assert.throws(() => l.cerrarBeca('sec', id), /Hay pagos pendientes/);
  avanzar(10);
  l.liberar('x', id, MAT1);
  l.cerrarBeca('sec', id);
  assert.throws(() => l.depositar('A', id, 1), /Beca no activa/);
});

test('asignar del fondo respeta el fondo disponible y la meta de la beca', () => {
  const { l, id } = escena();
  l.depositar('A', id, 50 * M);
  l.cerrarBeca('sec', id);
  const id2 = l.crearBeca('A', { estudiante: 'E2', montoPorMateria: 40 * M, cupo: 1, vence: VENCE });
  assert.throws(() => l.asignarDeFondo('sec', id2, 60 * M, '0x'), /Fondo insuficiente/);
  l.depositar('A', id2, 20 * M);
  assert.throws(() => l.asignarDeFondo('sec', id2, 30 * M, '0x'), /Supera la meta/);
  l.asignarDeFondo('sec', id2, 20 * M, '0x');
  invariante(l);
});
