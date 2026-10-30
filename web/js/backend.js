// Backend de la demo. Misma interfaz para el modo simulado (esta archivo) y para Sepolia (chain.js).
import { SimLedger } from './ledger-sim.js';
import { MICRO, hash32 } from './util.js';
import { ESCENA_VENCE as VENCE, perfilDeBeca } from './scenario.js';

export class SimBackend {
  constructor({ ventana = 10, comisionBps = 30, now } = {}) {
    this.modo = 'simulado';
    this.ventana = ventana;
    this.comisionBps = comisionBps;
    this._now = now;
    this.reiniciar();
  }

  comisionDe(monto) {
    return this.ledger.comisionDe(monto);
  }

  reiniciar() {
    const L = (this.ledger = new SimLedger({ ventana: this.ventana, comisionBps: this.comisionBps, now: this._now }));
    L.configurarRoles('secretaria', 'secretaria');
    L.mint('patrocinador', 200 * MICRO);
    L.mint('aportante', 50 * MICRO);
    // Beca 1: dos materias de 50 USDC, con 79 ya aportados. Falta 1 para pagar la primera con holgura:
    // la persona que aporta en vivo completa 80, y lo que sobra al cerrar (30) va al fondo común.
    L.crearBeca('patrocinador', { estudiante: 'estudiante', montoPorMateria: 50 * MICRO, cupo: 2, vence: VENCE });
    L.depositar('patrocinador', 1, 79 * MICRO);
    // Beca 2: una materia de 40 USDC con 10 depositados. Espera fondos y la ayudará el fondo común.
    L.crearBeca('patrocinador', { estudiante: 'estudiante2', montoPorMateria: 40 * MICRO, cupo: 1, vence: VENCE });
    L.depositar('patrocinador', 2, 10 * MICRO);
  }

  async estado() {
    const L = this.ledger;
    const becas = [];
    const materias = {};
    for (let id = 1; id <= L.totalBecas; id++) {
      const b = L.becas.get(id);
      becas.push({ id, ...b, meta: L.meta(id), aportado: L.aportado(id) });
      materias[id] = [];
      for (const m of perfilDeBeca(b.cupo).materias) {
        const materiaId = await hash32(m.key);
        const a = L.aprobacion(id, materiaId);
        materias[id].push({
          ...m,
          materiaId,
          estado: L.estadoMateria(id, materiaId),
          liberableDesde: a?.liberableDesde ?? null,
          actaHash: a?.actaHash ?? null,
        });
      }
    }
    const balances = {};
    for (const actor of ['patrocinador', 'aportante', 'secretaria', 'estudiante', 'estudiante2', 'tesoreria']) {
      balances[actor] = L.balanceOf(actor);
    }
    return {
      ahora: L.now(),
      ventana: L.ventana,
      comisionBps: L.comisionBps,
      becas,
      materias,
      fondoComun: L.fondoComun,
      balances,
      eventos: [...L.events],
    };
  }

  async depositar(actor, id, monto) {
    this.ledger.depositar(actor, id, monto);
  }

  async registrarAprobacion(id, key) {
    const materiaId = await hash32(key);
    const actaHash = await hash32(`acta:${id}:${key}:${this.ledger.now()}`);
    this.ledger.registrarAprobacion('secretaria', id, materiaId, actaHash);
  }

  async revocarAprobacion(id, key) {
    this.ledger.revocarAprobacion('secretaria', id, await hash32(key));
  }

  async liberar(id, key) {
    this.ledger.liberar('servicio', id, await hash32(key));
  }

  async cerrarBeca(id) {
    this.ledger.cerrarBeca('secretaria', id);
  }

  async asignarDeFondo(id, monto, propuestaHash) {
    this.ledger.asignarDeFondo('secretaria', id, monto, propuestaHash);
  }

  linkComprobante() {
    return null;
  }
}

export async function crearBackend(config) {
  if (config.modo === 'sepolia') {
    const { ChainBackend } = await import('./chain.js');
    return ChainBackend.crear(config);
  }
  return new SimBackend({ ventana: config.ventana, comisionBps: config.comisionBps });
}
