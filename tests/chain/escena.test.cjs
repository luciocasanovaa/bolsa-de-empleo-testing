// Prueba el script de escena contra una cadena local de Hardhat (no toca Sepolia).
const { expect } = require('chai');
const hre = require('hardhat');

describe('scripts/escena.mjs', () => {
  async function entorno() {
    const { ethers } = hre;
    const [admin, vigilante, estudiante, estudiante2] = await ethers.getSigners();
    const token = await (await ethers.getContractFactory('MockUSDC')).deploy();
    const becas = await (await ethers.getContractFactory('EduTrustBecas')).deploy(await token.getAddress(), 10, admin.address, 30);
    await becas.configurarRoles(admin.address, admin.address);
    const escena = await import('../../scripts/escena.mjs');
    const direcciones = { contrato: await becas.getAddress(), token: await token.getAddress() };
    const ctx = escena.conectar({ signer: admin, direcciones });
    // un vigilante SIN ningún rol y sin fondos: sólo paga el gas
    const ctxVigilante = escena.conectar({ signer: vigilante, direcciones });
    const avanzar = async (hasta) => {
      await hre.network.provider.send('evm_setNextBlockTimestamp', [hasta]);
      await hre.network.provider.send('evm_mine', []);
    };
    return { escena, ctx, ctxVigilante, becas, token, admin, estudiante, estudiante2, avanzar };
  }
  const callado = () => {};

  it('chequeo: confirma roles y avisa que no hay escena', async () => {
    const { escena, ctx } = await entorno();
    const r = await escena.chequeo(ctx, callado);
    expect(r.SECRETARIA).to.equal(true);
    expect(r.APROBADOR).to.equal(true);
    expect(r.listaParaDemo).to.equal(false);
  });

  it('preparar se puede repetir: cada vez deja una beca nueva lista y chequeo la señala', async () => {
    const { escena, ctx, becas } = await entorno();
    const a = await escena.preparar(ctx, { log: callado });
    expect(a).to.deep.equal({ origen: 1, destino: 2 });
    const b = await escena.preparar(ctx, { log: callado });
    expect(b).to.deep.equal({ origen: 3, destino: 4 });
    expect(await becas.totalBecas()).to.equal(4n);
    expect(await becas.aportado(3)).to.equal(80_000_000n);
    expect(await becas.aportado(4)).to.equal(10_000_000n);
    const r = await escena.chequeo(ctx, callado);
    expect(r.listaParaDemo).to.equal(true);
    expect(r.becaOrigen).to.equal(3);
    expect(r.becaDestino).to.equal(4);
  });

  it('un ensayo gasta la escena y chequeo pide preparar otra; la anterior no se toca', async () => {
    const { escena, ctx, becas, avanzar } = await entorno();
    await escena.preparar(ctx, { log: callado });
    await becas.registrarAprobacion(1, hre.ethers.id('MAT-101'), hre.ethers.id('acta'));
    const r = await escena.chequeo(ctx, callado);
    expect(r.listaParaDemo).to.equal(false);
    await escena.preparar(ctx, { log: callado });
    expect((await escena.chequeo(ctx, callado)).becaOrigen).to.equal(3);
    expect((await becas.becas(1)).registradas).to.equal(1n); // la del ensayo quedó como estaba
    void avanzar;
  });

  it('flujo: recorre los 8 pasos sin tocar las becas de la escena', async () => {
    const { escena, ctx, becas, token, estudiante, estudiante2, avanzar } = await entorno();
    await escena.preparar(ctx, { log: callado });
    const r = await escena.flujo(ctx, { estudiante: estudiante.address, estudiante2: estudiante2.address, salida: null, log: callado, esperar: avanzar, desdeBloque: 0 });
    expect(r.pasos).to.have.length(8);
    // La trazabilidad leída de una cadena real (local): cada beca cuadra y los eventos coinciden con los Transfer.
    for (const id of [3, 4]) {
      const v = r.viajes[id];
      expect(v.cuadra.ok, `beca ${id}: ${JSON.stringify(v.cuadra)}`).to.equal(true);
      expect(v.token_.ok, `beca ${id}: ${JSON.stringify(v.token_.fallas)}`).to.equal(true);
    }
    expect(r.viajes[3].resumen).to.include({ aportado: 80_000_000, pagado: 50_000_000, sobrante: 30_000_000, bloqueado: 0 });
    expect(r.viajes[3].resumen.comision).to.equal(240_000);
    expect(r.viajes[4].resumen).to.include({ aportado: 10_000_000, delFondo: 30_000_000, bloqueado: 40_000_000 });
    expect(r.viajes[3].eventos.map((e) => e.tipo)).to.deep.equal(['creada', 'comision', 'aporte', 'acta', 'pago', 'cierre']);
    expect(r.becas).to.deep.equal({ origen: 3, destino: 4 });
    expect(await token.balanceOf(estudiante.address)).to.equal(50_000_000n);
    expect(await becas.fondoComun()).to.equal(0n);
    expect(await becas.aportado(4)).to.equal(40_000_000n);
    expect((await becas.becas(1)).pagadas).to.equal(0n);
    expect(await becas.aportado(1)).to.equal(80_000_000n);
    // la escena sigue siendo la 1 y la 2: el flujo no lleva la marca de escena
    const c = await escena.chequeo(ctx, callado);
    expect(c.becaOrigen).to.equal(1);
    expect(c.listaParaDemo).to.equal(true);
  });

  it('vigilante: paga cuando vence la ventana, sin rol y sin esperar otra firma', async () => {
    const { escena, ctx, ctxVigilante, becas, token, estudiante, avanzar } = await entorno();
    await escena.preparar(ctx, { estudiante: estudiante.address, log: callado });
    const ctl = new AbortController();
    const corriendo = escena.vigilar(ctxVigilante, { senal: ctl.signal, intervaloMs: 50, desdeBloque: 0, log: callado });
    const materia = hre.ethers.id('MAT-101');
    await becas.registrarAprobacion(1, materia, hre.ethers.id('acta'));
    await new Promise((r) => setTimeout(r, 300));
    expect(await token.balanceOf(estudiante.address)).to.equal(0n); // en ventana: todavía no paga
    const { liberableDesde } = await becas.aprobaciones(1, materia);
    await avanzar(Number(liberableDesde));
    for (let i = 0; i < 40 && (await token.balanceOf(estudiante.address)) === 0n; i++) await new Promise((r) => setTimeout(r, 100));
    ctl.abort();
    const pagos = await corriendo;
    expect(await token.balanceOf(estudiante.address)).to.equal(50_000_000n);
    expect(pagos).to.equal(1);
  });

  it('vigilante: no paga un acta revocada dentro de la ventana', async () => {
    const { escena, ctx, ctxVigilante, becas, token, estudiante, avanzar } = await entorno();
    await escena.preparar(ctx, { estudiante: estudiante.address, log: callado });
    const ctl = new AbortController();
    const corriendo = escena.vigilar(ctxVigilante, { senal: ctl.signal, intervaloMs: 50, desdeBloque: 0, log: callado });
    const materia = hre.ethers.id('MAT-101');
    await becas.registrarAprobacion(1, materia, hre.ethers.id('acta'));
    const { liberableDesde } = await becas.aprobaciones(1, materia);
    await becas.revocarAprobacion(1, materia);
    await avanzar(Number(liberableDesde));
    await new Promise((r) => setTimeout(r, 500));
    ctl.abort();
    expect(await corriendo).to.equal(0);
    expect(await token.balanceOf(estudiante.address)).to.equal(0n);
  });
});
