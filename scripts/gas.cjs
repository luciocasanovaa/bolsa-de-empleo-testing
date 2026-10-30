// Mide el gas de cada operación del contrato en la red local de Hardhat.
// Uso: npx hardhat run scripts/gas.cjs
const hre = require('hardhat');

const M = 1_000_000n;
const VENCE = 4102444800;

async function main() {
  const { ethers } = hre;
  const [admin, aportante, estudiante, estudiante2] = await ethers.getSigners();
  const token = await (await ethers.getContractFactory('MockUSDC')).deploy();
  const becas = await (await ethers.getContractFactory('EduTrustBecas')).deploy(await token.getAddress(), 10, admin.address, 30);
  const dir = await becas.getAddress();
  const filas = [];
  const medir = async (nombre, promesa) => {
    const r = await (await promesa).wait();
    filas.push([nombre, r.gasUsed]);
    return r;
  };
  const materia = ethers.id('MAT-101');
  const acta = ethers.id('acta');

  await medir('MockUSDC.mint', token.mint(aportante.address, 500n * M));
  await medir('MockUSDC.approve', token.connect(aportante).approve(dir, 500n * M));
  await medir('configurarRoles (una vez)', becas.configurarRoles(admin.address, admin.address));
  await medir('crearBeca', becas.crearBeca(estudiante.address, 50n * M, 2, VENCE));
  await medir('crearBeca (2ª)', becas.crearBeca(estudiante2.address, 40n * M, 1, VENCE));
  await medir('depositar (1er aporte, con comisión)', becas.connect(aportante).depositar(1, 79n * M));
  await medir('depositar (aporte siguiente)', becas.connect(aportante).depositar(1, 1n * M));
  await medir('registrarAprobacion (firmar acta)', becas.registrarAprobacion(1, materia, acta));
  await ethers.provider.send('evm_increaseTime', [11]);
  await ethers.provider.send('evm_mine', []);
  await medir('liberar (ejecutar pago)', becas.liberar(1, materia));
  await medir('cerrarBeca (sobrante al fondo)', becas.cerrarBeca(1));
  await medir('asignarDeFondo (aprobar reparto)', becas.asignarDeFondo(2, 30n * M, ethers.id('propuesta')));

  console.log('| Operación | Gas |\n|---|---:|');
  for (const [n, g] of filas) console.log(`| ${n} | ${g.toString()} |`);
  const flujo = filas.filter(([n]) => !n.includes('(2ª)') && !n.includes('siguiente') && !n.includes('mint') && !n.includes('approve') && !n.includes('configurarRoles'));
  console.log('\nFlujo completo del pitch (crear, aportar, firmar, pagar, cerrar, asignar):', flujo.reduce((s, [, g]) => s + g, 0n).toString(), 'gas');
}
main().catch((e) => { console.error(e); process.exitCode = 1; });
