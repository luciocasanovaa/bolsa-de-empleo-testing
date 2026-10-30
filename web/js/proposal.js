// Propuesta de reparto del fondo común. Es un motor de reglas con criterios públicos, no un modelo
// de lenguaje: propone, explica cada decisión y nunca mueve fondos. Una persona aprueba.
import { usd } from './util.js';

export const PESOS = { falta: 0.5, territorio: 0.3, espera: 0.2 };

// becas: [{ id, meta, aportado, territorio, esperaMin }]  (sólo becas activas con faltante)
// territorios: { [nombre]: { sobreedadSecundaria2022 } }  (datos de OpenArg)
export function proponerReparto({ becas, fondoComun, territorios }) {
  const candidatas = becas.filter((b) => b.meta - b.aportado > 0);
  const maxSobreedad = Math.max(1, ...candidatas.map((b) => territorios[b.territorio]?.sobreedadSecundaria2022 ?? 0));
  const maxEspera = Math.max(1, ...candidatas.map((b) => b.esperaMin));

  const puntuadas = candidatas.map((b) => {
    const falta = b.meta - b.aportado;
    const sobreedad = territorios[b.territorio]?.sobreedadSecundaria2022 ?? 0;
    const cercania = 1 - falta / b.meta;
    const territorial = sobreedad / maxSobreedad;
    const espera = b.esperaMin / maxEspera;
    const puntaje = PESOS.falta * cercania + PESOS.territorio * territorial + PESOS.espera * espera;
    return { b, falta, sobreedad, puntaje };
  });
  puntuadas.sort((x, y) => y.puntaje - x.puntaje || x.b.id - y.b.id);

  let restante = fondoComun;
  const filas = [];
  for (const { b, falta, sobreedad, puntaje } of puntuadas) {
    const monto = Math.min(falta, restante);
    if (monto <= 0) continue;
    restante -= monto;
    const razones = [
      `Le faltan ${usd(falta)} de ${usd(b.meta)} (${Math.round(((b.meta - falta) / b.meta) * 100)} % completa).`,
      sobreedad
        ? `Territorio: ${b.territorio}, sobreedad secundaria ${sobreedad.toLocaleString('es-AR')} % en 2022 (OpenArg).`
        : `Territorio: ${b.territorio}, sin dato en OpenArg.`,
      `En espera hace ${Math.round(b.esperaMin)} min.`,
    ];
    filas.push({ id: b.id, monto, puntaje: Math.round(puntaje * 100) / 100, completa: monto === falta, razones });
  }
  return { filas, sinAsignar: restante, pesos: PESOS };
}
