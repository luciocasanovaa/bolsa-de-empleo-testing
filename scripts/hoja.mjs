// Completa los links de Etherscan de docs/hoja-del-equipo.md con los hashes de web/data/onchain.json.
// Uso: npm run hoja   (después de correr `node scripts/escena.mjs flujo`)
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import config from '../web/config.js';

const hoja = fileURLToPath(new URL('../docs/hoja-del-equipo.md', import.meta.url));
const datos = fileURLToPath(new URL('../web/data/onchain.json', import.meta.url));

if (!existsSync(datos)) {
  console.error('Falta web/data/onchain.json: primero correr `node scripts/escena.mjs flujo`.');
  process.exit(1);
}
const r = JSON.parse(readFileSync(datos, 'utf8'));
const base = config.sepolia.explorador;
const lineas = [
  `Contrato: ${base}/address/${r.contrato}`,
  `Token de prueba: ${base}/address/${r.token}`,
  '',
  ...r.pasos.map((p) => `- ${p.paso}: ${base}/tx/${p.hash}`),
  '',
  `Viaje del dinero de la beca de origen: \`viaje.html?beca=${r.becas.origen}\` · de la beca destino: \`viaje.html?beca=${r.becas.destino}\``,
  `(Generado el ${r.generado.slice(0, 16).replace('T', ' ')} UTC)`,
];
const texto = readFileSync(hoja, 'utf8').replace(/<!-- LINKS -->[\s\S]*<!-- \/LINKS -->/, `<!-- LINKS -->\n${lineas.join('\n')}\n<!-- /LINKS -->`);
writeFileSync(hoja, texto);
console.log(`Hoja actualizada con ${r.pasos.length} links.`);
