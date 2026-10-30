// Pruebas del contrato EduTrustBecas en una blockchain local (Hardhat).
const { expect } = require('chai');
const { ethers } = require('hardhat');
const { time } = require('@nomicfoundation/hardhat-network-helpers');

const M = 1_000_000n; // 1 USDC con 6 decimales
const MAT1 = ethers.id('MAT-101');
const MAT2 = ethers.id('MAT-102');
const MAT3 = ethers.id('MAT-103');
const ACTA = ethers.id('acta:1');
const LEJOS = 4102444800n;
const COMISION_BPS = 30n; // 0,3 %, se cobra encima del aporte

async function desplegar() {
  const [admin, patro, aportante, secretaria, estudiante, estudiante2, otro, tesoreria] = await ethers.getSigners();
  const token = await (await ethers.getContractFactory('MockUSDC')).deploy();
  const becas = await (await ethers.getContractFactory('EduTrustBecas')).deploy(await token.getAddress(), 10, tesoreria.address, COMISION_BPS);
  await becas.configurarRoles(secretaria.address, secretaria.address);
  const direccion = await becas.getAddress();
  for (const [cuenta, monto] of [[patro, 200n * M], [aportante, 100n * M]]) {
    await token.mint(cuenta.address, monto);
    await token.connect(cuenta).approve(direccion, 1000n * M);
  }
  await becas.connect(patro).crearBeca(estudiante.address, 50n * M, 2, LEJOS);
  return { token, becas, direccion, admin, patro, aportante, secretaria, estudiante, estudiante2, otro, tesoreria };
}

async function invariante(token, becas, direccion) {
  let saldos = 0n;
  const total = await becas.totalBecas();
  for (let i = 1n; i <= total; i++) saldos += (await becas.becas(i)).saldo;
  expect(await token.balanceOf(direccion)).to.equal(saldos + (await becas.fondoComun()));
}

describe('EduTrustBecas', () => {
  it('flujo completo: aportes, firma, ventana, pago, cierre y fondo común', async () => {
    const { token, becas, direccion, patro, aportante, secretaria, estudiante, estudiante2, otro } = await desplegar();

    await becas.connect(patro).depositar(1, 50n * M);
    await becas.connect(aportante).depositar(1, 30n * M);
    expect(await becas.aportado(1)).to.equal(80n * M);
    expect(await becas.meta(1)).to.equal(100n * M);

    await expect(becas.connect(secretaria).registrarAprobacion(1, MAT1, ACTA))
      .to.emit(becas, 'AprobacionRegistrada');
    await expect(becas.connect(otro).liberar(1, MAT1)).to.be.revertedWith('En ventana de seguridad');

    await time.increase(11);
    await expect(becas.connect(otro).liberar(1, MAT1))
      .to.emit(becas, 'PagoLiberado')
      .withArgs(1, MAT1, estudiante.address, 50n * M);
    expect(await token.balanceOf(estudiante.address)).to.equal(50n * M);
    expect((await becas.becas(1)).saldo).to.equal(30n * M);

    await expect(becas.connect(secretaria).cerrarBeca(1)).to.emit(becas, 'BecaCerrada').withArgs(1, 30n * M);
    expect(await becas.fondoComun()).to.equal(30n * M);
    await invariante(token, becas, direccion);

    await becas.connect(patro).crearBeca(estudiante2.address, 40n * M, 1, LEJOS);
    await becas.connect(patro).depositar(2, 10n * M);
    const propuesta = ethers.id('propuesta-ia');
    await expect(becas.connect(secretaria).asignarDeFondo(2, 30n * M, propuesta))
      .to.emit(becas, 'FondoAsignado')
      .withArgs(2, 30n * M, propuesta);
    expect((await becas.becas(2)).saldo).to.equal(40n * M);
    expect(await becas.fondoComun()).to.equal(0);
    await invariante(token, becas, direccion);
  });

  it('no deja superar la meta ni crear becas inválidas', async () => {
    const { becas, patro, aportante, estudiante } = await desplegar();
    await becas.connect(patro).depositar(1, 100n * M);
    await expect(becas.connect(aportante).depositar(1, 1)).to.be.revertedWith('Supera la meta');
    await expect(becas.connect(patro).crearBeca(ethers.ZeroAddress, 1, 1, LEJOS)).to.be.revertedWith('Datos invalidos');
    await expect(becas.connect(patro).crearBeca(estudiante.address, 0, 1, LEJOS)).to.be.revertedWith('Datos invalidos');
    await expect(becas.connect(patro).depositar(1, 0)).to.be.revertedWith('Monto cero');
  });

  it('sólo la Secretaría firma y sólo un aprobador asigna del fondo', async () => {
    const { becas, patro, otro } = await desplegar();
    await expect(becas.connect(otro).registrarAprobacion(1, MAT1, ACTA)).to.be.revertedWithCustomError(becas, 'AccessControlUnauthorizedAccount');
    await expect(becas.connect(patro).asignarDeFondo(1, 1, ACTA)).to.be.revertedWithCustomError(becas, 'AccessControlUnauthorizedAccount');
    await expect(becas.connect(otro).configurarRoles(otro.address, otro.address)).to.be.revertedWithCustomError(becas, 'AccessControlUnauthorizedAccount');
  });

  it('una materia se registra una sola vez y se respeta el cupo', async () => {
    const { becas, secretaria } = await desplegar();
    await becas.connect(secretaria).registrarAprobacion(1, MAT1, ACTA);
    await expect(becas.connect(secretaria).registrarAprobacion(1, MAT1, ACTA)).to.be.revertedWith('Ya registrada');
    await becas.connect(secretaria).registrarAprobacion(1, MAT2, ACTA);
    await expect(becas.connect(secretaria).registrarAprobacion(1, MAT3, ACTA)).to.be.revertedWith('Sin cupo');
  });

  it('la revocación sólo vale dentro de la ventana y permite volver a firmar', async () => {
    const { becas, secretaria } = await desplegar();
    await becas.connect(secretaria).registrarAprobacion(1, MAT1, ACTA);
    await expect(becas.connect(secretaria).revocarAprobacion(1, MAT1)).to.emit(becas, 'AprobacionRevocada');
    await becas.connect(secretaria).registrarAprobacion(1, MAT1, ACTA);
    await time.increase(11);
    await expect(becas.connect(secretaria).revocarAprobacion(1, MAT1)).to.be.revertedWith('Ventana cerrada');
  });

  it('una materia ya pagada no se puede volver a cobrar ni re-registrar', async () => {
    const { token, becas, patro, secretaria, estudiante, otro } = await desplegar();
    await becas.connect(patro).depositar(1, 100n * M);
    await becas.connect(secretaria).registrarAprobacion(1, MAT1, ACTA);
    await time.increase(11);
    await becas.connect(otro).liberar(1, MAT1);
    await expect(becas.connect(otro).liberar(1, MAT1)).to.be.revertedWith('No liberable');
    await expect(becas.connect(secretaria).registrarAprobacion(1, MAT1, ACTA)).to.be.revertedWith('Ya registrada');
    await expect(becas.connect(secretaria).revocarAprobacion(1, MAT1)).to.be.revertedWith('No revocable');
    expect(await token.balanceOf(estudiante.address)).to.equal(50n * M);
  });

  it('sin fondos el pago espera y se libera cuando llegan', async () => {
    const { becas, patro, secretaria, otro } = await desplegar();
    await becas.connect(patro).depositar(1, 20n * M);
    await becas.connect(secretaria).registrarAprobacion(1, MAT1, ACTA);
    await time.increase(11);
    await expect(becas.connect(otro).liberar(1, MAT1)).to.be.revertedWith('Esperando fondos');
    await becas.connect(patro).depositar(1, 30n * M);
    await expect(becas.connect(otro).liberar(1, MAT1)).to.emit(becas, 'PagoLiberado');
  });

  it('el destino del pago es siempre el estudiante, no quien llama', async () => {
    const { token, becas, patro, secretaria, estudiante, otro } = await desplegar();
    await becas.connect(patro).depositar(1, 50n * M);
    await becas.connect(secretaria).registrarAprobacion(1, MAT1, ACTA);
    await time.increase(11);
    const antes = await token.balanceOf(otro.address);
    await becas.connect(otro).liberar(1, MAT1);
    expect(await token.balanceOf(otro.address)).to.equal(antes);
    expect(await token.balanceOf(estudiante.address)).to.equal(50n * M);
  });

  it('cerrar la beca: requiere aprobador o vencimiento, y sin pagos pendientes', async () => {
    const { becas, patro, secretaria, otro } = await desplegar();
    await becas.connect(patro).depositar(1, 50n * M);
    await expect(becas.connect(otro).cerrarBeca(1)).to.be.revertedWith('Aun no vence');
    await becas.connect(secretaria).registrarAprobacion(1, MAT1, ACTA);
    await expect(becas.connect(secretaria).cerrarBeca(1)).to.be.revertedWith('Hay pagos pendientes');
    await time.increase(11);
    await becas.connect(otro).liberar(1, MAT1);
    await becas.connect(secretaria).cerrarBeca(1);
    await expect(becas.connect(patro).depositar(1, 1)).to.be.revertedWith('Beca no activa');
  });

  it('cualquiera puede cerrar una beca vencida', async () => {
    const { token, becas, patro, estudiante, otro } = await desplegar();
    const vence = BigInt(await time.latest()) + 100n;
    await becas.connect(patro).crearBeca(estudiante.address, 10n * M, 1, vence);
    await becas.connect(patro).depositar(2, 4n * M);
    await expect(becas.connect(otro).cerrarBeca(2)).to.be.revertedWith('Aun no vence');
    await time.increase(101);
    await becas.connect(otro).cerrarBeca(2);
    expect(await becas.fondoComun()).to.equal(4n * M);
    expect(await token.balanceOf(await becas.getAddress())).to.equal(4n * M);
  });

  it('asignar del fondo respeta el fondo disponible y la meta de la beca', async () => {
    const { token, becas, direccion, patro, secretaria, estudiante2 } = await desplegar();
    await becas.connect(patro).depositar(1, 50n * M);
    await becas.connect(secretaria).cerrarBeca(1);
    await becas.connect(patro).crearBeca(estudiante2.address, 40n * M, 1, LEJOS);
    await expect(becas.connect(secretaria).asignarDeFondo(2, 60n * M, ACTA)).to.be.revertedWith('Fondo insuficiente');
    await becas.connect(patro).depositar(2, 20n * M);
    await expect(becas.connect(secretaria).asignarDeFondo(2, 30n * M, ACTA)).to.be.revertedWith('Supera la meta');
    await becas.connect(secretaria).asignarDeFondo(2, 20n * M, ACTA);
    await invariante(token, becas, direccion);
  });

  it('un aportante sin saldo no puede depositar', async () => {
    const { becas, otro } = await desplegar();
    await expect(becas.connect(otro).depositar(1, 1n * M)).to.be.reverted;
  });

  describe('comisión', () => {
    it('se cobra encima del aporte y va a la tesorería; la beca recibe el monto completo', async () => {
      const { token, becas, direccion, patro, tesoreria } = await desplegar();
      const fee = (100n * M * COMISION_BPS) / 10_000n;
      expect(await becas.comisionDe(100n * M)).to.equal(fee);
      const antesPatro = await token.balanceOf(patro.address);
      await expect(becas.connect(patro).depositar(1, 100n * M))
        .to.emit(becas, 'ComisionCobrada')
        .withArgs(1, patro.address, fee);
      expect(await token.balanceOf(tesoreria.address)).to.equal(fee);
      expect(await token.balanceOf(direccion)).to.equal(100n * M);
      expect(antesPatro - (await token.balanceOf(patro.address))).to.equal(100n * M + fee);
      expect((await becas.becas(1)).saldo).to.equal(100n * M);
      await invariante(token, becas, direccion);
    });

    it('el estudiante cobra completo: la comisión no sale de su beca', async () => {
      const { token, becas, patro, secretaria, estudiante, otro } = await desplegar();
      await becas.connect(patro).depositar(1, 50n * M);
      await becas.connect(secretaria).registrarAprobacion(1, MAT1, ACTA);
      await time.increase(11);
      await becas.connect(otro).liberar(1, MAT1);
      expect(await token.balanceOf(estudiante.address)).to.equal(50n * M);
    });

    it('un aporte de 1 USDC paga USD 0,003 de comisión (redondea hacia abajo)', async () => {
      const { token, becas, patro, tesoreria } = await desplegar();
      await becas.connect(patro).depositar(1, 1n * M);
      expect(await token.balanceOf(tesoreria.address)).to.equal(3_000n);
      await becas.connect(patro).depositar(1, 10n); // 10 unidades mínimas: fee 0
      expect(await token.balanceOf(tesoreria.address)).to.equal(3_000n);
    });

    it('si el aportante sólo aprobó el monto y no la comisión, el aporte falla', async () => {
      const { token, becas, direccion, otro } = await desplegar();
      await token.mint(otro.address, 10n * M);
      await token.connect(otro).approve(direccion, 10n * M);
      await expect(becas.connect(otro).depositar(1, 10n * M)).to.be.reverted;
    });

    it('la comisión tiene tope de 1 % y sólo la cambia el administrador', async () => {
      const { becas, admin, otro, tesoreria } = await desplegar();
      expect(await becas.COMISION_MAX_BPS()).to.equal(100n);
      await expect(becas.connect(admin).setComision(tesoreria.address, 101)).to.be.revertedWith('Datos invalidos');
      await expect(becas.connect(admin).setComision(ethers.ZeroAddress, 10)).to.be.revertedWith('Datos invalidos');
      await expect(becas.connect(otro).setComision(otro.address, 10)).to.be.revertedWithCustomError(becas, 'AccessControlUnauthorizedAccount');
      await becas.connect(admin).setComision(tesoreria.address, 100);
      expect(await becas.comisionBps()).to.equal(100n);
    });

    it('con comisión cero no se cobra nada ni se emite el evento', async () => {
      const { token, becas, admin, patro, tesoreria } = await desplegar();
      await becas.connect(admin).setComision(tesoreria.address, 0);
      await expect(becas.connect(patro).depositar(1, 10n * M)).to.not.emit(becas, 'ComisionCobrada');
      expect(await token.balanceOf(tesoreria.address)).to.equal(0);
    });

    it('el constructor rechaza una comisión mayor al tope o sin tesorería', async () => {
      const [, , , , , , , tes] = await ethers.getSigners();
      const token = await (await ethers.getContractFactory('MockUSDC')).deploy();
      const fabrica = await ethers.getContractFactory('EduTrustBecas');
      await expect(fabrica.deploy(await token.getAddress(), 10, tes.address, 101)).to.be.revertedWith('Datos invalidos');
      await expect(fabrica.deploy(await token.getAddress(), 10, ethers.ZeroAddress, 30)).to.be.revertedWith('Datos invalidos');
    });
  });
});
