import test from 'node:test';
import assert from 'node:assert/strict';
import { proponerReparto } from '../web/js/proposal.js';

const M = 1_000_000;
const territorios = {
  'La Matanza': { sobreedadSecundaria2022: 20.93 },
  'Lomas de Zamora': { sobreedadSecundaria2022: 20.12 },
};

test('no reparte más de lo que hay y nunca supera el faltante de cada beca', () => {
  const r = proponerReparto({
    fondoComun: 30 * M,
    territorios,
    becas: [
      { id: 2, meta: 40 * M, aportado: 10 * M, territorio: 'La Matanza', esperaMin: 600 },
      { id: 3, meta: 100 * M, aportado: 0, territorio: 'Lomas de Zamora', esperaMin: 30 },
    ],
  });
  const total = r.filas.reduce((s, f) => s + f.monto, 0);
  assert.ok(total <= 30 * M);
  assert.equal(total + r.sinAsignar, 30 * M);
  for (const f of r.filas) assert.ok(f.monto > 0);
});

test('prioriza la beca más cercana a completarse y con más espera', () => {
  const r = proponerReparto({
    fondoComun: 30 * M,
    territorios,
    becas: [
      { id: 2, meta: 40 * M, aportado: 10 * M, territorio: 'La Matanza', esperaMin: 600 },
      { id: 3, meta: 100 * M, aportado: 0, territorio: 'Lomas de Zamora', esperaMin: 30 },
    ],
  });
  assert.equal(r.filas[0].id, 2);
  assert.equal(r.filas[0].monto, 30 * M);
  assert.equal(r.filas[0].completa, true);
});

test('cada fila explica sus razones, también si falta el dato del territorio', () => {
  const r = proponerReparto({
    fondoComun: 5 * M,
    territorios: {},
    becas: [{ id: 1, meta: 10 * M, aportado: 0, territorio: 'Sin datos', esperaMin: 5 }],
  });
  assert.equal(r.filas.length, 1);
  assert.match(r.filas[0].razones.join(' '), /sin dato en OpenArg/);
});

test('sin becas con faltante no propone nada', () => {
  const r = proponerReparto({
    fondoComun: 5 * M,
    territorios,
    becas: [{ id: 1, meta: 10 * M, aportado: 10 * M, territorio: 'La Matanza', esperaMin: 5 }],
  });
  assert.deepEqual(r.filas, []);
  assert.equal(r.sinAsignar, 5 * M);
});

test('con empate de puntaje, desempata por número de beca (resultado estable)', () => {
  const becas = [
    { id: 5, meta: 10 * M, aportado: 0, territorio: 'La Matanza', esperaMin: 10 },
    { id: 4, meta: 10 * M, aportado: 0, territorio: 'La Matanza', esperaMin: 10 },
  ];
  const r = proponerReparto({ fondoComun: 10 * M, territorios, becas });
  assert.equal(r.filas[0].id, 4);
});
