// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

// Token de prueba. Cualquiera puede acunar: solo para la demo, sin valor.
contract MockUSDC is ERC20 {
    constructor() ERC20("Mock USDC", "mUSDC") {}

    function decimals() public pure override returns (uint8) {
        return 6;
    }

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}

// Escrow de becas por materia. Las reglas viven aca; la IA propone fuera de la cadena.
contract EduTrustBecas is AccessControl, ReentrancyGuard {
    using SafeERC20 for IERC20;

    bytes32 public constant SECRETARIA = keccak256("SECRETARIA");
    bytes32 public constant APROBADOR = keccak256("APROBADOR");

    enum Estado {
        Activa,
        Finalizada,
        Cerrada
    }

    struct Beca {
        address estudiante;
        uint256 montoPorMateria;
        uint256 saldo;
        uint64 vence;
        uint8 cupo;
        uint8 registradas;
        uint8 pagadas;
        Estado estado;
    }

    struct Aprobacion {
        bytes32 actaHash;
        uint64 liberableDesde;
        bool existe;
        bool liberada;
    }

    uint16 public constant COMISION_MAX_BPS = 100; // tope 1 %: el fee no puede crecer sin limite

    IERC20 public immutable token;
    address public tesoreria;
    uint16 public comisionBps; // se cobra ENCIMA del aporte: el estudiante cobra completo
    uint64 public ventana;
    uint256 public totalBecas;
    uint256 public fondoComun;
    mapping(uint256 => Beca) public becas;
    mapping(uint256 => mapping(bytes32 => Aprobacion)) public aprobaciones;

    event BecaCreada(
        uint256 indexed id,
        address indexed creador,
        address indexed estudiante,
        uint256 montoPorMateria,
        uint8 cupo,
        uint64 vence
    );
    event FondosDepositados(uint256 indexed id, address indexed aportante, uint256 monto);
    event ComisionCobrada(uint256 indexed id, address indexed aportante, uint256 monto);
    event AprobacionRegistrada(uint256 indexed id, bytes32 indexed materiaId, bytes32 actaHash, uint64 liberableDesde);
    event AprobacionRevocada(uint256 indexed id, bytes32 indexed materiaId);
    event PagoLiberado(uint256 indexed id, bytes32 indexed materiaId, address indexed estudiante, uint256 monto);
    event BecaCerrada(uint256 indexed id, uint256 sobranteAlFondo);
    event FondoAsignado(uint256 indexed id, uint256 monto, bytes32 propuestaHash);

    constructor(IERC20 _token, uint64 _ventana, address _tesoreria, uint16 _comisionBps) {
        require(_tesoreria != address(0) && _comisionBps <= COMISION_MAX_BPS, "Datos invalidos");
        token = _token;
        ventana = _ventana;
        tesoreria = _tesoreria;
        comisionBps = _comisionBps;
        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
    }

    function setComision(address _tesoreria, uint16 _comisionBps) external onlyRole(DEFAULT_ADMIN_ROLE) {
        require(_tesoreria != address(0) && _comisionBps <= COMISION_MAX_BPS, "Datos invalidos");
        tesoreria = _tesoreria;
        comisionBps = _comisionBps;
    }

    function configurarRoles(address secretaria, address aprobador) external onlyRole(DEFAULT_ADMIN_ROLE) {
        _grantRole(SECRETARIA, secretaria);
        _grantRole(APROBADOR, aprobador);
    }

    function setVentana(uint64 _ventana) external onlyRole(DEFAULT_ADMIN_ROLE) {
        ventana = _ventana;
    }

    function meta(uint256 id) public view returns (uint256) {
        Beca storage b = becas[id];
        return b.montoPorMateria * b.cupo;
    }

    function aportado(uint256 id) public view returns (uint256) {
        Beca storage b = becas[id];
        return b.saldo + uint256(b.pagadas) * b.montoPorMateria;
    }

    // Cualquiera puede crear una beca; el dinero llega despues con depositar().
    function crearBeca(address estudiante, uint256 montoPorMateria, uint8 cupo, uint64 vence)
        external
        returns (uint256 id)
    {
        require(
            estudiante != address(0) && montoPorMateria > 0 && cupo > 0 && vence > block.timestamp,
            "Datos invalidos"
        );
        id = ++totalBecas;
        becas[id] = Beca({
            estudiante: estudiante,
            montoPorMateria: montoPorMateria,
            saldo: 0,
            vence: vence,
            cupo: cupo,
            registradas: 0,
            pagadas: 0,
            estado: Estado.Activa
        });
        emit BecaCreada(id, msg.sender, estudiante, montoPorMateria, cupo, vence);
    }

    // Comision que se suma al aporte (no se descuenta de la beca). Redondea hacia abajo.
    function comisionDe(uint256 monto) public view returns (uint256) {
        return (monto * comisionBps) / 10_000;
    }

    // Abierto a cualquiera, desde 1 unidad. No se puede superar la meta.
    // El aportante debe aprobar monto + comisionDe(monto).
    function depositar(uint256 id, uint256 monto) external nonReentrant {
        Beca storage b = becas[id];
        require(b.estado == Estado.Activa, "Beca no activa");
        require(monto > 0, "Monto cero");
        require(aportado(id) + monto <= meta(id), "Supera la meta");
        b.saldo += monto;
        uint256 fee = comisionDe(monto);
        token.safeTransferFrom(msg.sender, address(this), monto);
        if (fee > 0) {
            token.safeTransferFrom(msg.sender, tesoreria, fee);
            emit ComisionCobrada(id, msg.sender, fee);
        }
        emit FondosDepositados(id, msg.sender, monto);
    }

    // La Secretaria registra el hash del acta. El pago espera la ventana de seguridad.
    function registrarAprobacion(uint256 id, bytes32 materiaId, bytes32 actaHash) external onlyRole(SECRETARIA) {
        Beca storage b = becas[id];
        require(b.estado == Estado.Activa, "Beca no activa");
        Aprobacion storage a = aprobaciones[id][materiaId];
        require(!a.existe, "Ya registrada");
        require(b.registradas < b.cupo, "Sin cupo");
        a.actaHash = actaHash;
        a.liberableDesde = uint64(block.timestamp) + ventana;
        a.existe = true;
        b.registradas++;
        emit AprobacionRegistrada(id, materiaId, actaHash, a.liberableDesde);
    }

    function revocarAprobacion(uint256 id, bytes32 materiaId) external onlyRole(SECRETARIA) {
        Aprobacion storage a = aprobaciones[id][materiaId];
        require(a.existe && !a.liberada, "No revocable");
        require(block.timestamp < a.liberableDesde, "Ventana cerrada");
        delete aprobaciones[id][materiaId];
        becas[id].registradas--;
        emit AprobacionRevocada(id, materiaId);
    }

    // Lo puede llamar cualquiera: un servicio automatico o la app del estudiante.
    // El destino siempre es b.estudiante, no depende de quien llama.
    function liberar(uint256 id, bytes32 materiaId) external nonReentrant {
        Beca storage b = becas[id];
        Aprobacion storage a = aprobaciones[id][materiaId];
        require(a.existe && !a.liberada, "No liberable");
        require(block.timestamp >= a.liberableDesde, "En ventana de seguridad");
        require(b.saldo >= b.montoPorMateria, "Esperando fondos");
        a.liberada = true;
        b.saldo -= b.montoPorMateria;
        b.pagadas++;
        if (b.pagadas == b.cupo) b.estado = Estado.Finalizada;
        token.safeTransfer(b.estudiante, b.montoPorMateria);
        emit PagoLiberado(id, materiaId, b.estudiante, b.montoPorMateria);
    }

    // Al vencer, o por abandono confirmado por un aprobador, el sobrante va al fondo comun.
    function cerrarBeca(uint256 id) external {
        Beca storage b = becas[id];
        require(b.estado == Estado.Activa, "Beca no activa");
        require(block.timestamp >= b.vence || hasRole(APROBADOR, msg.sender), "Aun no vence");
        require(b.registradas == b.pagadas, "Hay pagos pendientes");
        uint256 sobrante = b.saldo;
        b.saldo = 0;
        b.estado = Estado.Cerrada;
        fondoComun += sobrante;
        emit BecaCerrada(id, sobrante);
    }

    // La propuesta se calcula fuera de la cadena; una persona aprueba con esta funcion.
    // Tope: nunca se supera la meta de la beca. propuestaHash deja el rastro de la propuesta.
    function asignarDeFondo(uint256 id, uint256 monto, bytes32 propuestaHash) external onlyRole(APROBADOR) {
        Beca storage b = becas[id];
        require(b.estado == Estado.Activa, "Beca no activa");
        require(monto > 0 && monto <= fondoComun, "Fondo insuficiente");
        require(aportado(id) + monto <= meta(id), "Supera la meta");
        fondoComun -= monto;
        b.saldo += monto;
        emit FondoAsignado(id, monto, propuestaHash);
    }
}
