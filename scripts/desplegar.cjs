// Despliega MockUSDC y EduTrustBecas y deja listos los roles y los fondos de prueba.
// Imprime las direcciones para pegarlas en web/config.js (sección sepolia). No escribe archivos.
//   Sepolia:  DEPLOYER_KEY=0x... [MI_WALLET=0x...] npm run contrato:desplegar
//   Local:    npx hardhat node   (otra terminal)  y   npx hardhat run scripts/desplegar.cjs --network localhost
// DEPLOYER_KEY es la clave de UNA cuenta de testnet con ETH de prueba y sin valor real.
// MI_WALLET es la billetera (MetaMask) que usará la demo; recibe los roles y los USDC de prueba.
// Si no se indica, se usa la cuenta que despliega.
const hre = require('hardhat');

const M = 1_000_000n;
const COMISION_BPS = Number(process.env.COMISION_BPS ?? 30); // 0,3 %, tope del contrato: 100
const VENTANA = Number(process.env.VENTANA ?? 10); // segundos de la ventana de seguridad

async function main() {
  const { ethers, network } = hre;
  const [deployer] = await ethers.getSigners();
  if (!deployer) throw new Error('Falta DEPLOYER_KEY: la clave de UNA cuenta de testnet con ETH de prueba.');
  const red = await ethers.provider.getNetwork();
  const saldo = await ethers.provider.getBalance(deployer.address);
  const demo = process.env.MI_WALLET || deployer.address;
  const tesoreria = process.env.TESORERIA || deployer.address;
  console.log(`Red: ${network.name} (chainId ${red.chainId})`);
  console.log(`Despliega: ${deployer.address} con ${ethers.formatEther(saldo)} ETH`);
  if (!['hardhat', 'localhost'].includes(network.name) && saldo < ethers.parseEther('0.02')) {
    console.warn('Aviso: con menos de 0.02 ETH puede no alcanzar para desplegar.');
  }

  const token = await (await ethers.getContractFactory('MockUSDC')).deploy();
  await token.waitForDeployment();
  const becas = await (await ethers.getContractFactory('EduTrustBecas')).deploy(
    await token.getAddress(),
    VENTANA,
    tesoreria,
    COMISION_BPS
  );
  const recibo = await becas.deploymentTransaction().wait();

  await (await becas.configurarRoles(demo, demo)).wait();
  await (await token.mint(demo, 1000n * M)).wait();

  const dirToken = await token.getAddress();
  const dirBecas = await becas.getAddress();
  const explorador = red.chainId === 11155111n ? 'https://sepolia.etherscan.io' : '';

  console.log('\nPegar en web/config.js, sección sepolia:');
  console.log(`  chainId: ${red.chainId},`);
  console.log(`  token: '${dirToken}',`);
  console.log(`  contrato: '${dirBecas}',`);
  console.log(`  desdeBloque: ${recibo.blockNumber},`);
  console.log(`\nRoles SECRETARIA y APROBADOR: ${demo}`);
  console.log(`Tesorería (recibe la comisión de ${COMISION_BPS / 100} %): ${tesoreria}`);
  console.log(`USDC de prueba entregados: 1000 a ${demo}`);
  if (explorador) console.log(`Ver el contrato: ${explorador}/address/${dirBecas}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
