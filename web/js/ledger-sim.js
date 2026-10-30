// Libro mayor simulado. Replica las reglas de contracts/EduTrust.sol para el modo
// simulado de la demo y para las pruebas. Los montos son enteros en micro-USDC (6 decimales).
export const CONTRATO = 'contrato';

export class SimLedger {
  constructor({ ventana = 10, comisionBps = 30, tesoreria = 'tesoreria', now = () => Math.floor(Date.now() / 1000) } = {}) {
    this.ventana = ventana;
    this.comisionBps = comisionBps;
    this.tesoreria = tesoreria;
    this.now = now;
    this.totalBecas = 0;
    this.fondoComun = 0;
    this.becas = new Map();
    this.aprobaciones = new Map();
    this.balances = new Map();
    this.roles = { secretaria: new Set(), aprobador: new Set() };
    this.events = [];
  }

  _emit(name, args) {
    this.events.push({ n: this.events.length + 1, name, args, ts: this.now() });
  }

  _need(condicion, mensaje) {
    if (!condicion) throw new Error(mensaje);
  }

  _beca(id) {
    const b = this.becas.get(id);
    this._need(b, 'Beca inexistente');
    return b;
  }

  _mover(de, a, monto) {
    this._need(this.balanceOf(de) >= monto, 'Saldo insuficiente');
    this.balances.set(de, this.balanceOf(de) - monto);
    this.balances.set(a, this.balanceOf(a) + monto);
  }

  mint(a, monto) {
    this.balances.set(a, this.balanceOf(a) + monto);
  }

  balanceOf(a) {
    return this.balances.get(a) ?? 0;
  }

  configurarRoles(secretaria, aprobador) {
    this.roles.secretaria.add(secretaria);
    this.roles.aprobador.add(aprobador);
  }

  meta(id) {
    const b = this._beca(id);
    return b.montoPorMateria * b.cupo;
  }

  aportado(id) {
    const b = this._beca(id);
    return b.saldo + b.pagadas * b.montoPorMateria;
  }

  aprobacion(id, materiaId) {
    return this.aprobaciones.get(`${id}:${materiaId}`) ?? null;
  }

  // Estado de una materia desde el punto de vista del estudiante.
  estadoMateria(id, materiaId) {
    const a = this.aprobacion(id, materiaId);
    if (!a) return 'sin-firma';
    if (a.liberada) return 'pagado';
    return this.now() >= a.liberableDesde ? 'disponible' : 'programado';
  }

  crearBeca(desde, { estudiante, montoPorMateria, cupo, vence }) {
    this._need(estudiante && montoPorMateria > 0 && cupo > 0 && vence > this.now(), 'Datos invalidos');
    const id = ++this.totalBecas;
    this.becas.set(id, { estudiante, montoPorMateria, saldo: 0, vence, cupo, registradas: 0, pagadas: 0, estado: 'Activa' });
    this._emit('BecaCreada', { id, creador: desde, estudiante, montoPorMateria, cupo, vence });
    return id;
  }

  // Comision encima del aporte, redondeada hacia abajo como en el contrato.
  comisionDe(monto) {
    return Math.floor((monto * this.comisionBps) / 10_000);
  }

  depositar(desde, id, monto) {
    const b = this._beca(id);
    this._need(b.estado === 'Activa', 'Beca no activa');
    this._need(monto > 0, 'Monto cero');
    this._need(this.aportado(id) + monto <= this.meta(id), 'Supera la meta');
    const fee = this.comisionDe(monto);
    this._need(this.balanceOf(desde) >= monto + fee, 'Saldo insuficiente');
    this._mover(desde, CONTRATO, monto);
    b.saldo += monto;
    if (fee > 0) {
      this._mover(desde, this.tesoreria, fee);
      this._emit('ComisionCobrada', { id, aportante: desde, monto: fee });
    }
    this._emit('FondosDepositados', { id, aportante: desde, monto });
  }

  registrarAprobacion(desde, id, materiaId, actaHash) {
    this._need(this.roles.secretaria.has(desde), 'Falta el rol SECRETARIA');
    const b = this._beca(id);
    this._need(b.estado === 'Activa', 'Beca no activa');
    this._need(!this.aprobacion(id, materiaId), 'Ya registrada');
    this._need(b.registradas < b.cupo, 'Sin cupo');
    const liberableDesde = this.now() + this.ventana;
    this.aprobaciones.set(`${id}:${materiaId}`, { actaHash, liberableDesde, liberada: false });
    b.registradas++;
    this._emit('AprobacionRegistrada', { id, materiaId, actaHash, liberableDesde });
  }

  revocarAprobacion(desde, id, materiaId) {
    this._need(this.roles.secretaria.has(desde), 'Falta el rol SECRETARIA');
    const a = this.aprobacion(id, materiaId);
    this._need(a && !a.liberada, 'No revocable');
    this._need(this.now() < a.liberableDesde, 'Ventana cerrada');
    this.aprobaciones.delete(`${id}:${materiaId}`);
    this._beca(id).registradas--;
    this._emit('AprobacionRevocada', { id, materiaId });
  }

  liberar(_desde, id, materiaId) {
    const b = this._beca(id);
    const a = this.aprobacion(id, materiaId);
    this._need(a && !a.liberada, 'No liberable');
    this._need(this.now() >= a.liberableDesde, 'En ventana de seguridad');
    this._need(b.saldo >= b.montoPorMateria, 'Esperando fondos');
    a.liberada = true;
    b.saldo -= b.montoPorMateria;
    b.pagadas++;
    if (b.pagadas === b.cupo) b.estado = 'Finalizada';
    this._mover(CONTRATO, b.estudiante, b.montoPorMateria);
    this._emit('PagoLiberado', { id, materiaId, estudiante: b.estudiante, monto: b.montoPorMateria });
  }

  cerrarBeca(desde, id) {
    const b = this._beca(id);
    this._need(b.estado === 'Activa', 'Beca no activa');
    this._need(this.now() >= b.vence || this.roles.aprobador.has(desde), 'Aun no vence');
    this._need(b.registradas === b.pagadas, 'Hay pagos pendientes');
    const sobrante = b.saldo;
    b.saldo = 0;
    b.estado = 'Cerrada';
    this.fondoComun += sobrante;
    this._emit('BecaCerrada', { id, sobranteAlFondo: sobrante });
  }

  asignarDeFondo(desde, id, monto, propuestaHash) {
    this._need(this.roles.aprobador.has(desde), 'Falta el rol APROBADOR');
    const b = this._beca(id);
    this._need(b.estado === 'Activa', 'Beca no activa');
    this._need(monto > 0 && monto <= this.fondoComun, 'Fondo insuficiente');
    this._need(this.aportado(id) + monto <= this.meta(id), 'Supera la meta');
    this.fondoComun -= monto;
    b.saldo += monto;
    this._emit('FondoAsignado', { id, monto, propuestaHash });
  }
}
