import test from 'node:test';
import assert from 'node:assert/strict';
import { SimLedger } from '../web/js/ledger-sim.js';

const M = 1_000_000;
const VENCE = 4102444800;

function escena() {
  let t = 1_000_000;
  const L = new SimLedger({ ventana: 10, comisionBps: 30, now: () => t });
  L.configurarRoles('sec', 'apr');
  L.mint('ana', 500 * M);
  L.crearBeca('ana', { estudiante: 'est', montoPorMateria: 50 * M, cupo: 2, vence: VENCE });
  return { L, avanzar: (s) => (t += s) };
}

test('la comisión se cobra encima del aporte y la beca recibe todo', () => {
  const { L } = escena();
  L.depositar('ana', 1, 100 * M);
  assert.equal(L.becas.get(1).saldo, 100 * M);
  assert.equal(L.balanceOf('tesoreria'), 300_000); // 0,3 % de 100 USD = 0,30 USD
  assert.equal(L.balanceOf('ana'), 500 * M - 100 * M - 300_000);
});

test('un aporte de 1 USD cobra 0,003 USD de comisión', () => {
  const { L } = escena();
  L.depositar('ana', 1, 1 * M);
  assert.equal(L.balanceOf('tesoreria'), 3_000);
});

test('no se puede superar la meta', () => {
  const { L } = escena();
  L.depositar('ana', 1, 100 * M);
  assert.throws(() => L.depositar('ana', 1, 1), /Supera la meta/);
});

test('el aporte falla si no alcanza para monto más comisión', () => {
  const { L } = escena();
  L.mint('pobre', 100 * M);
  assert.throws(() => L.depositar('pobre', 1, 100 * M), /Saldo insuficiente/);
});

test('sólo la secretaría registra aprobaciones', () => {
  const { L } = escena();
  assert.throws(() => L.registrarAprobacion('ana', 1, 'm1', 'acta'), /SECRETARIA/);
});

test('no se libera dentro de la ventana de seguridad y sí después', () => {
  const { L, avanzar } = escena();
  L.depositar('ana', 1, 100 * M);
  L.registrarAprobacion('sec', 1, 'm1', 'acta');
  assert.throws(() => L.liberar('x', 1, 'm1'), /En ventana de seguridad/);
  avanzar(10);
  L.liberar('x', 1, 'm1');
  assert.equal(L.balanceOf('est'), 50 * M);
  assert.throws(() => L.liberar('x', 1, 'm1'), /No liberable/);
});

test('el pago siempre va al estudiante, sin importar quién llama', () => {
  const { L, avanzar } = escena();
  L.depositar('ana', 1, 100 * M);
  L.registrarAprobacion('sec', 1, 'm1', 'acta');
  avanzar(10);
  L.liberar('un-atacante', 1, 'm1');
  assert.equal(L.balanceOf('un-atacante'), 0);
  assert.equal(L.balanceOf('est'), 50 * M);
});

test('una aprobación se puede revocar sólo dentro de la ventana', () => {
  const { L, avanzar } = escena();
  L.depositar('ana', 1, 100 * M);
  L.registrarAprobacion('sec', 1, 'm1', 'acta');
  L.revocarAprobacion('sec', 1, 'm1');
  assert.equal(L.becas.get(1).registradas, 0);
  L.registrarAprobacion('sec', 1, 'm1', 'acta2');
  avanzar(10);
  assert.throws(() => L.revocarAprobacion('sec', 1, 'm1'), /Ventana cerrada/);
});

test('sin fondos suficientes la materia espera y se paga cuando llegan', () => {
  const { L, avanzar } = escena();
  L.depositar('ana', 1, 10 * M);
  L.registrarAprobacion('sec', 1, 'm1', 'acta');
  avanzar(10);
  assert.throws(() => L.liberar('x', 1, 'm1'), /Esperando fondos/);
  L.depositar('ana', 1, 40 * M);
  L.liberar('x', 1, 'm1');
  assert.equal(L.balanceOf('est'), 50 * M);
});

test('no se registran más aprobaciones que el cupo', () => {
  const { L } = escena();
  L.registrarAprobacion('sec', 1, 'm1', 'a');
  L.registrarAprobacion('sec', 1, 'm2', 'b');
  assert.throws(() => L.registrarAprobacion('sec', 1, 'm3', 'c'), /Sin cupo/);
});

test('cerrar la beca manda el sobrante al fondo común y exige pagos al día', () => {
  const { L, avanzar } = escena();
  L.depositar('ana', 1, 80 * M);
  L.registrarAprobacion('sec', 1, 'm1', 'a');
  assert.throws(() => L.cerrarBeca('apr', 1), /Hay pagos pendientes/);
  avanzar(10);
  L.liberar('x', 1, 'm1');
  assert.throws(() => L.cerrarBeca('ana', 1), /Aun no vence/);
  L.cerrarBeca('apr', 1);
  assert.equal(L.fondoComun, 30 * M);
  assert.equal(L.becas.get(1).saldo, 0);
  assert.equal(L.becas.get(1).estado, 'Cerrada');
});

test('el fondo común se asigna con tope de fondo y de meta, y sólo por el aprobador', () => {
  const { L, avanzar } = escena();
  L.crearBeca('ana', { estudiante: 'est2', montoPorMateria: 40 * M, cupo: 1, vence: VENCE });
  L.depositar('ana', 1, 80 * M);
  L.registrarAprobacion('sec', 1, 'm1', 'a');
  avanzar(10);
  L.liberar('x', 1, 'm1');
  L.cerrarBeca('apr', 1);
  L.depositar('ana', 2, 10 * M);
  assert.throws(() => L.asignarDeFondo('ana', 2, 5 * M, '0x1'), /APROBADOR/);
  assert.throws(() => L.asignarDeFondo('apr', 2, 31 * M, '0x1'), /Fondo insuficiente/);
  L.asignarDeFondo('apr', 2, 30 * M, '0xabc');
  assert.equal(L.fondoComun, 0);
  assert.equal(L.aportado(2), 40 * M);
  assert.throws(() => L.asignarDeFondo('apr', 2, 1, '0x1'), /Fondo insuficiente|Supera la meta/);
  assert.equal(L.events.at(-1).name, 'FondoAsignado');
});

test('el dinero se conserva: nada se crea ni se destruye', () => {
  const { L, avanzar } = escena();
  const total = () => [...L.balances.values()].reduce((a, b) => a + b, 0);
  const inicial = total();
  L.depositar('ana', 1, 100 * M);
  L.registrarAprobacion('sec', 1, 'm1', 'a');
  avanzar(10);
  L.liberar('x', 1, 'm1');
  L.cerrarBeca('apr', 1);
  assert.equal(total(), inicial);
});
