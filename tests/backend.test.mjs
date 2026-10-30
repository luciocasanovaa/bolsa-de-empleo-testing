import test from 'node:test';
import assert from 'node:assert/strict';
import { SimBackend } from '../web/js/backend.js';
import { proponerReparto } from '../web/js/proposal.js';
import { perfilDeBeca } from '../web/js/scenario.js';
import { MICRO } from '../web/js/util.js';

function nuevo() {
  let t = 2_000_000;
  const backend = new SimBackend({ ventana: 10, comisionBps: 30, now: () => t });
  return { backend, avanzar: (s) => (t += s) };
}

test('la escena inicial coincide con el guion de la demo', async () => {
  const { backend } = nuevo();
  const e = await backend.estado();
  assert.equal(e.becas.length, 2);
  assert.equal(e.becas[0].aportado, 79 * MICRO);
  assert.equal(e.becas[1].aportado, 10 * MICRO);
  assert.equal(e.fondoComun, 0);
  assert.equal(e.materias[1].length, 2);
  assert.ok(e.materias[1].every((m) => m.estado === 'sin-firma'));
});

test('recorrido completo del pitch: aporte, acta, pago, cierre y reparto del fondo', async () => {
  const { backend, avanzar } = nuevo();
  await backend.depositar('aportante', 1, 1 * MICRO);
  await backend.registrarAprobacion(1, 'MAT-101');
  let e = await backend.estado();
  assert.equal(e.materias[1][0].estado, 'programado');
  await assert.rejects(() => backend.liberar(1, 'MAT-101'), /En ventana de seguridad/);

  avanzar(10);
  e = await backend.estado();
  assert.equal(e.materias[1][0].estado, 'disponible');
  await backend.liberar(1, 'MAT-101');
  e = await backend.estado();
  assert.equal(e.balances.estudiante, 50 * MICRO);
  assert.equal(e.materias[1][0].estado, 'pagado');

  await backend.cerrarBeca(1);
  e = await backend.estado();
  assert.equal(e.fondoComun, 30 * MICRO);

  const territorios = { 'La Matanza': { sobreedadSecundaria2022: 20.93 }, 'Lomas de Zamora': { sobreedadSecundaria2022: 20.12 } };
  const activas = e.becas
    .filter((b) => b.estado === 'Activa')
    .map((b) => ({ id: b.id, meta: b.meta, aportado: b.aportado, territorio: perfilDeBeca(b.cupo).territorio, esperaMin: perfilDeBeca(b.cupo).creadaHaceMin }));
  const { filas } = proponerReparto({ becas: activas, fondoComun: e.fondoComun, territorios });
  assert.deepEqual(filas.map((f) => [f.id, f.monto]), [[2, 30 * MICRO]]);

  await backend.asignarDeFondo(2, 30 * MICRO, '0xabc');
  e = await backend.estado();
  assert.equal(e.fondoComun, 0);
  assert.equal(e.becas[1].aportado, 40 * MICRO);
});

test('reiniciar vuelve a la escena inicial', async () => {
  const { backend } = nuevo();
  await backend.depositar('aportante', 1, 1 * MICRO);
  backend.reiniciar();
  const e = await backend.estado();
  assert.equal(e.becas[0].aportado, 79 * MICRO);
  assert.equal(e.eventos.some((ev) => ev.name === 'PagoLiberado'), false);
});
