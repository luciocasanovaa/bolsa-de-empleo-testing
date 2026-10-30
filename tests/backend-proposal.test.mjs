// Pruebas del backend simulado y de la propuesta de reparto.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { SimBackend } from '../web/js/backend.js';
import { proponerReparto } from '../web/js/proposal.js';
import { MICRO } from '../web/js/util.js';

const datos = JSON.parse(readFileSync(new URL('../web/data/openarg.json', import.meta.url), 'utf8'));

test('backend simulado: recorrido de la demo hasta el fondo común', async () => {
  let t = 5000;
  const be = new SimBackend({ ventana: 10, now: () => t });
  let st = await be.estado();
  assert.equal(st.becas.length, 2);
  assert.equal(st.becas[1].aportado, 10 * MICRO);

  await be.depositar('aportante', 1, 1 * MICRO); // la beca 1 arranca con 79: con 1 más llega a 80
  await be.registrarAprobacion(1, 'MAT-101');
  st = await be.estado();
  assert.equal(st.materias[1][0].estado, 'programado');

  t += 10;
  st = await be.estado();
  assert.equal(st.materias[1][0].estado, 'disponible');
  await be.liberar(1, 'MAT-101');
  st = await be.estado();
  assert.equal(st.balances.estudiante, 50 * MICRO);

  await be.cerrarBeca(1);
  st = await be.estado();
  assert.equal(st.fondoComun, 30 * MICRO);

  const rep = proponerReparto({
    becas: [{ id: 2, meta: st.becas[1].meta, aportado: st.becas[1].aportado, territorio: 'La Matanza', esperaMin: 600 }],
    fondoComun: st.fondoComun,
    territorios: datos.territorios,
  });
  assert.equal(rep.filas.length, 1);
  assert.equal(rep.filas[0].monto, 30 * MICRO);
  await be.asignarDeFondo(2, rep.filas[0].monto, 'hash-propuesta');
  st = await be.estado();
  assert.equal(st.becas[1].saldo, 40 * MICRO);
  assert.equal(st.fondoComun, 0);
});

test('propuesta: respeta el fondo, el faltante y ordena por criterios públicos', () => {
  const becas = [
    { id: 1, meta: 100 * MICRO, aportado: 20 * MICRO, territorio: 'Lomas de Zamora', esperaMin: 60 },
    { id: 2, meta: 100 * MICRO, aportado: 90 * MICRO, territorio: 'La Matanza', esperaMin: 600 },
  ];
  const r = proponerReparto({ becas, fondoComun: 30 * MICRO, territorios: datos.territorios });
  assert.equal(r.filas[0].id, 2, 'la beca más cercana a completarse, más espera y más sobreedad va primero');
  assert.equal(r.filas[0].monto, 10 * MICRO);
  assert.equal(r.filas[1].monto, 20 * MICRO);
  assert.equal(r.sinAsignar, 0);
  assert.ok(r.filas.every((f) => f.razones.length === 3));
  assert.ok(r.filas.reduce((s, f) => s + f.monto, 0) <= 30 * MICRO);
});

test('propuesta: sin faltantes no asigna nada', () => {
  const r = proponerReparto({ becas: [{ id: 1, meta: 10, aportado: 10, territorio: 'x', esperaMin: 0 }], fondoComun: 5, territorios: {} });
  assert.equal(r.filas.length, 0);
  assert.equal(r.sinAsignar, 5);
});

test('datos de OpenArg: cada cifra declara fuente, fecha y cuidado', () => {
  assert.equal(datos.cifras.length, 3);
  for (const c of datos.cifras) {
    for (const campo of ['titulo', 'grande', 'texto', 'fuente', 'url', 'tabla', 'ultimoDato', 'leidaPorOpenArg', 'cuidado']) {
      assert.ok(c[campo], `${c.key} sin ${campo}`);
    }
    assert.match(c.url, /^https:\/\//);
  }
});
