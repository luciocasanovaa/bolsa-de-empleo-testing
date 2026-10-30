// Backend contra Sepolia con ethers v6. NO está probado contra una red real: requiere el contrato
// desplegado y las direcciones en config.js. Misma interfaz que SimBackend.
import { ethers } from 'https://cdn.jsdelivr.net/npm/ethers@6.13.4/+esm';
import { ESCENA_VENCE, perfilDeBeca } from './scenario.js';
import { MICRO, hash32 } from './util.js';

const ABI = [
  'function token() view returns (address)',
  'function tesoreria() view returns (address)',
  'function comisionBps() view returns (uint16)',
  'function ventana() view returns (uint64)',
  'function totalBecas() view returns (uint256)',
  'function fondoComun() view returns (uint256)',
  'function becas(uint256) view returns (address estudiante,uint256 montoPorMateria,uint256 saldo,uint64 vence,uint8 cupo,uint8 registradas,uint8 pagadas,uint8 estado)',
  'function aprobaciones(uint256,bytes32) view returns (bytes32 actaHash,uint64 liberableDesde,bool existe,bool liberada)',
  'function meta(uint256) view returns (uint256)',
  'function aportado(uint256) view returns (uint256)',
  'function comisionDe(uint256) view returns (uint256)',
  'function SECRETARIA() view returns (bytes32)',
  'function APROBADOR() view returns (bytes32)',
  'function hasRole(bytes32,address) view returns (bool)',
  'function configurarRoles(address,address)',
  'function crearBeca(address,uint256,uint8,uint64) returns (uint256)',
  'function depositar(uint256,uint256)',
  'function registrarAprobacion(uint256,bytes32,bytes32)',
  'function revocarAprobacion(uint256,bytes32)',
  'function liberar(uint256,bytes32)',
  'function cerrarBeca(uint256)',
  'function asignarDeFondo(uint256,uint256,bytes32)',
  'event BecaCreada(uint256 indexed id,address indexed creador,address indexed estudiante,uint256 montoPorMateria,uint8 cupo,uint64 vence)',
  'event FondosDepositados(uint256 indexed id,address indexed aportante,uint256 monto)',
  'event ComisionCobrada(uint256 indexed id,address indexed aportante,uint256 monto)',
  'event AprobacionRegistrada(uint256 indexed id,bytes32 indexed materiaId,bytes32 actaHash,uint64 liberableDesde)',
  'event AprobacionRevocada(uint256 indexed id,bytes32 indexed materiaId)',
  'event PagoLiberado(uint256 indexed id,bytes32 indexed materiaId,address indexed estudiante,uint256 monto)',
  'event BecaCerrada(uint256 indexed id,uint256 sobranteAlFondo)',
  'event FondoAsignado(uint256 indexed id,uint256 monto,bytes32 propuestaHash)',
];
const ERC20_ABI = [
  'function balanceOf(address) view returns (uint256)',
  'function allowance(address,address) view returns (uint256)',
  'function approve(address,uint256) returns (bool)',
  'function mint(address,uint256)',
];
const ESTADOS = ['Activa', 'Finalizada', 'Cerrada'];
const VENCE = 4102444800;

export class ChainBackend {
  static async crear(config) {
    const c = config.sepolia;
    if (!globalThis.ethereum) throw new Error('Falta una billetera (MetaMask) en el navegador');
    if (!c.contrato || !c.token) throw new Error('Completar token y contrato en config.js');
    const provider = new ethers.BrowserProvider(globalThis.ethereum);
    await provider.send('eth_requestAccounts', []);
    const red = await provider.getNetwork();
    if (Number(red.chainId) !== c.chainId) {
      await provider.send('wallet_switchEthereumChain', [{ chainId: '0x' + c.chainId.toString(16) }]);
    }
    const signer = await provider.getSigner();
    return new ChainBackend(config, provider, signer, await signer.getAddress());
  }

  constructor(config, provider, signer, cuenta) {
    const c = config.sepolia;
    this.modo = 'sepolia';
    this.config = config;
    this.explorador = c.explorador;
    this.cuenta = cuenta;
    this.ventana = config.ventana;
    this.comisionBps = config.comisionBps;
    this.provider = provider;
    this.contrato = new ethers.Contract(c.contrato, ABI, signer);
    this.token = new ethers.Contract(c.token, ERC20_ABI, signer);
    this.iface = new ethers.Interface(ABI);
    // Direcciones por actor. Si no se configuran, todo se hace desde la billetera conectada.
    this.direcciones = {
      patrocinador: cuenta,
      aportante: cuenta,
      secretaria: cuenta,
      estudiante: c.estudiante || cuenta,
      estudiante2: c.estudiante2 || cuenta,
    };
  }

  comisionDe(monto) {
    return Math.floor((monto * this.comisionBps) / 10_000);
  }

  linkComprobante(tx) {
    return tx ? `${this.explorador}/tx/${tx}` : null;
  }

  async _enviar(promesa) {
    const tx = await promesa;
    await tx.wait();
    return tx.hash;
  }

  async estado() {
    const C = this.contrato;
    const bloque = await this.provider.getBlock('latest');
    const total = Number(await C.totalBecas());
    const becas = [];
    const materias = {};
    // La escena es el último par de becas marcado con ESCENA_VENCE: una de dos materias (origen) y una
    // de una materia (destino del fondo común). Así `preparar` se puede repetir y los ensayos no gastan
    // la beca del pitch: siempre se muestra la más nueva. Las del recorrido completo no llevan la marca.
    const escena = {};
    for (let id = total; id >= 1 && id > total - 40 && !(escena[2] && escena[1]); id--) {
      const b = await C.becas(id);
      if (Number(b.vence) !== ESCENA_VENCE) continue;
      escena[Number(b.cupo)] ??= id;
    }
    for (const id of Object.values(escena).sort((x, y) => x - y)) {
      const [b, meta, aportado] = await Promise.all([C.becas(id), C.meta(id), C.aportado(id)]);
      becas.push({
        id,
        estudiante: b.estudiante,
        montoPorMateria: Number(b.montoPorMateria),
        saldo: Number(b.saldo),
        vence: Number(b.vence),
        cupo: Number(b.cupo),
        registradas: Number(b.registradas),
        pagadas: Number(b.pagadas),
        estado: ESTADOS[Number(b.estado)],
        meta: Number(meta),
        aportado: Number(aportado),
      });
      materias[id] = [];
      for (const m of perfilDeBeca(Number(b.cupo)).materias) {
        const materiaId = await hash32(m.key);
        const a = await C.aprobaciones(id, materiaId);
        const liberableDesde = a.existe ? Number(a.liberableDesde) : null;
        let estado = 'sin-firma';
        if (a.existe) estado = a.liberada ? 'pagado' : bloque.timestamp >= liberableDesde ? 'disponible' : 'programado';
        materias[id].push({ ...m, materiaId, estado, liberableDesde, actaHash: a.existe ? a.actaHash : null });
      }
    }
    const balances = {};
    for (const [actor, dir] of Object.entries(this.direcciones)) balances[actor] = Number(await this.token.balanceOf(dir));
    const tesoreria = await C.tesoreria();
    balances.tesoreria = Number(await this.token.balanceOf(tesoreria));
    return {
      ahora: bloque.timestamp,
      ventana: Number(await C.ventana()),
      comisionBps: Number(await C.comisionBps()),
      becas,
      materias,
      fondoComun: Number(await C.fondoComun()),
      balances,
      eventos: await this._eventos(),
    };
  }

  async _eventos() {
    const logs = await this.provider.getLogs({
      address: this.config.sepolia.contrato,
      fromBlock: this.config.sepolia.desdeBloque,
      toBlock: 'latest',
    });
    const salida = [];
    for (const log of logs) {
      let parsed;
      try {
        parsed = this.iface.parseLog(log);
      } catch {
        continue;
      }
      if (!parsed) continue;
      const args = {};
      parsed.fragment.inputs.forEach((inp, i) => {
        const v = parsed.args[i];
        args[inp.name] = typeof v === 'bigint' ? Number(v) : v;
      });
      salida.push({ n: salida.length + 1, name: parsed.name, args, ts: null, tx: log.transactionHash, bloque: log.blockNumber });
    }
    return salida;
  }

  async _aprobarToken(monto) {
    const necesario = BigInt(monto);
    const actual = await this.token.allowance(this.cuenta, this.config.sepolia.contrato);
    if (actual < necesario) await this._enviar(this.token.approve(this.config.sepolia.contrato, necesario));
  }

  async depositar(_actor, id, monto) {
    await this._aprobarToken(monto + this.comisionDe(monto));
    return this._enviar(this.contrato.depositar(id, monto));
  }

  async registrarAprobacion(id, key) {
    const materiaId = await hash32(key);
    const actaHash = await hash32(`acta:${id}:${key}:${Date.now()}`);
    return this._enviar(this.contrato.registrarAprobacion(id, materiaId, actaHash));
  }

  async revocarAprobacion(id, key) {
    return this._enviar(this.contrato.revocarAprobacion(id, await hash32(key)));
  }

  async liberar(id, key) {
    return this._enviar(this.contrato.liberar(id, await hash32(key)));
  }

  async cerrarBeca(id) {
    return this._enviar(this.contrato.cerrarBeca(id));
  }

  async asignarDeFondo(id, monto, propuestaHash) {
    return this._enviar(this.contrato.asignarDeFondo(id, monto, propuestaHash));
  }

  // Deja la escena lista antes del pitch (varias transacciones). Idempotente: no hace nada si ya hay becas.
  async preparar() {
    const C = this.contrato;
    if (Number(await C.totalBecas()) > 0) return;
    const yo = this.cuenta;
    if (!(await C.hasRole(await C.SECRETARIA(), yo))) await this._enviar(C.configurarRoles(yo, yo));
    await this._enviar(this.token.mint(yo, 300n * BigInt(MICRO)));
    await this._enviar(C.crearBeca(this.direcciones.estudiante, 50 * MICRO, 2, VENCE));
    await this._enviar(C.crearBeca(this.direcciones.estudiante2, 40 * MICRO, 1, VENCE));
    await this._aprobarToken(100 * MICRO);
    await this._enviar(C.depositar(1, 79 * MICRO));
    await this._enviar(C.depositar(2, 10 * MICRO));
  }
}
