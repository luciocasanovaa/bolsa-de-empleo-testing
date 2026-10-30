# EduTrust

Becas universitarias que se pagan por materia aprobada. Los fondos quedan en un contrato, la Secretaría firma el acta y cualquiera puede verificar el recorrido. Demo para la Hackathon EDU HUB, LABITCONF 2026 (track Nueva Educación).

## Qué hay

| Carpeta | Contenido |
|---|---|
| `contracts/EduTrust.sol` | `MockUSDC` (token de prueba) y `EduTrustBecas`: aportes abiertos desde 1 unidad, ventana de seguridad, fondo común y comisión del 0,3 % encima del aporte (tope 1 %). |
| `web/` | Demo estática: camino de Brote con seis logros, becas, fondo común, registro de eventos, evidencia de OpenArg y panel "Prueba on-chain". |
| `web/viaje.html` | **El viaje del dinero**: una página pública por beca (`?beca=N`), sin billetera, con línea de tiempo, control "¿Cuadra?", seguimiento por hash y QR. |
| `web/js/ledger-sim.js` | Libro simulado que replica las reglas del contrato. Es el modo de respaldo. |
| `web/js/chain.js` | Conexión al contrato en Sepolia con ethers v6 y la billetera del navegador. |
| `web/js/onchain.js`, `web/js/trazabilidad.js` | Lectura pública de la red por RPC (con respaldo) y reconstrucción del viaje del dinero. |
| `web/js/proposal.js` | Propuesta de reparto del fondo común (motor de reglas). |
| `web/data/openarg.json` | Tres cifras de OpenArg con fuente, fecha y qué no afirmar. |
| `scripts/escena.mjs` | `chequeo`, `preparar`, `flujo` y `vigilante` contra Sepolia. |
| `tests/*.test.mjs`, `tests/chain/` | Pruebas del modo simulado y de la trazabilidad (Node) y del contrato y los scripts (Hardhat). |
| `docs/hoja-del-equipo.md` | Hoja de una página para el equipo: pasos de la demo, qué decir y qué hacer si algo falla. |

## Correr la demo

Requiere Node.js 20 o superior. La demo no tiene dependencias.

```sh
npm start               # http://127.0.0.1:4178/
npm test                # pruebas del modo simulado y de la trazabilidad
npm run contrato:test   # compila el contrato y corre sus pruebas y las de los scripts (Hardhat)
npm run contrato:gas    # gas por operación
```

Arranca en **modo simulado**: no necesita red ni billeteras. Guion de 60 s:

1. Botón **Ver video (12 s)**: Brote sube y desbloquea los seis logros.
2. **Aportar** USD 1 a la beca 1 (se ve la comisión de USD 0,003 sumada al aporte).
3. **Firmar acta** de una materia (Secretaría). Corre la ventana de seguridad y el pago sale solo.
4. **Cerrar beca**: los USD 30 que sobran van al fondo común.
5. **Proponer reparto** y **Aprobar y ejecutar**: el fondo completa la beca 2.

`Reiniciar demo` vuelve a la escena inicial. Con `?intro=1` el video arranca solo (sirve para grabarlo).

## Sepolia

El contrato y el token ya están desplegados; sus direcciones están en `web/config.js` (son públicas, **no va ninguna clave privada**: las transacciones las firma la billetera o el script).

La clave de la cuenta de testnet va **solo en un archivo `.env` local** (copiar `.env.example`; está en `.gitignore`), nunca en la línea de comandos. La cuenta tiene que ser nueva, solo de testnet, con los roles SECRETARIA y APROBADOR (el dueño del deploy ejecuta `configurarRoles(cuenta, cuenta)`) y ETH de Sepolia para gas.

```sh
node scripts/escena.mjs chequeo     # roles, gas, RPC y qué beca está LISTA para la demo en vivo
node scripts/escena.mjs preparar    # crea una escena nueva lista para firmar; se puede repetir (los ensayos no gastan la del pitch)
node scripts/escena.mjs flujo       # recorrido completo, una vez; guarda web/data/onchain.json con el viaje de cada beca
node scripts/escena.mjs vigilante   # paga cuando vence la ventana; liberar() lo puede llamar cualquiera, así que solo pone gas
npm run hoja                        # completa los links de Etherscan en docs/hoja-del-equipo.md
```

En vivo: abrir la app con `?modo=sepolia`, conectar MetaMask con la misma cuenta y firmar el acta de la beca que indique `chequeo`. `web/data/onchain.json` alimenta el panel "Prueba on-chain" y `viaje.html` cuando ningún RPC responde.

## Estado y límites

- El contrato compila y pasa sus pruebas en una cadena local. Está desplegado en Sepolia; **no está auditado**.
- **El flujo completo contra Sepolia todavía no se corrió** (hace falta la cuenta de testnet con roles y gas). Sí se corrió contra una cadena local de Hardhat y se vio en un navegador.
- **`chain.js` (modo Sepolia de la interfaz con MetaMask) no se probó contra ninguna red real.**
- **La propuesta de reparto es un motor de reglas, no un modelo de lenguaje.** Pesos: faltante 50 %, territorio 30 %, espera 20 %. Una persona aprueba y el contrato pone los topes.
- Simulados: el retiro a pesos (cotización fija de demostración), los saldos iniciales y las becas de ejemplo. El token es de prueba, no es USDC real.
- Las cifras de OpenArg están calculadas al 30/10/2026. Ver `web/data/openarg.json` para tablas, columnas y advertencias.
- Los precios del plan institucional, el beneficio fiscal y la bolsa de talento son hipótesis, no están validados.

## Publicar el link

La entrega es un link que abra desde cualquier computadora. `web/` es una carpeta estática: se puede desplegar con `vercel` desde esa carpeta, después de correr `flujo`. No se publicó nada todavía.
