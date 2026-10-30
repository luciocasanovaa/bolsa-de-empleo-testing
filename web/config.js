// Configuración de la demo. Sin secretos: las direcciones de una testnet son públicas.
// Para pasar a Sepolia: completar `sepolia` y abrir la app con ?modo=sepolia.
const params = new URLSearchParams(globalThis.location?.search ?? '');

export default {
  modo: params.get('modo') === 'sepolia' ? 'sepolia' : 'simulado',
  ventana: 10, // segundos de ventana de seguridad en la demo (en producción, horas o días)
  comisionBps: 30, // 0,3 %, se cobra encima del aporte
  pollMs: { simulado: 1000, sepolia: 4000 },
  sepolia: {
    chainId: 11155111,
    rpc: 'https://ethereum-sepolia-rpc.publicnode.com',
    // Primero el que mejor respondió desde un navegador; los demás son respaldo (probados con CORS y getLogs).
    rpcs: [
      'https://ethereum-sepolia-rpc.publicnode.com',
      'https://rpc.sepolia.ethpandaops.io',
      'https://sepolia.gateway.tenderly.co',
      'https://1rpc.io/sepolia',
    ],
    explorador: 'https://sepolia.etherscan.io',
    token: '0x0Fa1a0280143EFEed64E4B5F57911f912a5c9b1C', // MockUSDC
    contrato: '0xD27EEbe1019032c1f8cCD05205451E7da6FCB7F7', // EduTrustBecas
    desdeBloque: 12027572, // bloque del deploy, para acotar la lectura de eventos
    estudiante: '', // dirección del estudiante #1 (opcional; por defecto la propia billetera)
    estudiante2: '', // dirección del estudiante #2 (opcional)
  },
};
