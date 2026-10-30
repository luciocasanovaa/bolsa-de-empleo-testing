# EduTrust

Becas universitarias que se pagan por materia aprobada. Los fondos quedan en un contrato, la Secretaría firma el acta y cualquiera puede verificar el recorrido. Demo para la Hackathon EDU HUB, LABITCONF 2026 (track Nueva Educación).

## Qué hay

| Carpeta | Contenido |
|---|---|
| `contracts/EduTrust.sol` | `MockUSDC` (token de prueba) y `EduTrustBecas`: aportes abiertos desde 1 unidad, ventana de seguridad, fondo común y comisión del 0,3 % encima del aporte (tope 1 %). |
| `web/index.html`, `web/js/app.js`, `web/js/brote.js`, `web/styles.css` | Demo: camino de Brote con seis logros, becas, fondo común, registro de eventos, evidencia de OpenArg, panel "Prueba on-chain" y botón fijo "Ver el viaje del dinero". |
| `web/viaje.html`, `web/js/viaje.js` | **El viaje del dinero**: una página pública por beca (`?beca=N`), sin billetera: camino de Brote que marca en qué paso está la plata, diagrama, línea de tiempo, control "¿Cuadra?", seguimiento por hash y QR. |
| `web/config.js`, `web/data/openarg.json` | Direcciones públicas de Sepolia y RPC de respaldo; tres cifras de OpenArg con fuente, fecha y qué no afirmar. |
| `web/js/ledger-sim.js` | Libro simulado que replica las reglas del contrato. Es el modo de respaldo. |
| `web/js/chain.js` | Conexión al contrato en Sepolia con ethers v6 y la billetera del navegador. |
| `web/js/onchain.js`, `web/js/trazabilidad.js` | Lectura pública de la red por RPC (con respaldo) y reconstrucción del viaje del dinero. |
| `web/js/proposal.js`, `web/js/backend.js`, `web/js/scenario.js`, `web/js/util.js` | Propuesta de reparto (motor de reglas), backend simulado o de Sepolia con la misma interfaz, datos de la escena y utilidades. |
| `scripts/escena.mjs` | `chequeo`, `preparar`, `flujo` y `vigilante` contra Sepolia. |
| `tests/*.test.mjs`, `tests/chain/` | Pruebas del modo simulado y de la trazabilidad (Node) y del contrato y los scripts (Hardhat). |
| `docs/hoja-del-equipo.md` | Hoja de una página para el equipo: pasos de la demo, qué decir y qué hacer si algo falla. |

## Capa visual: prototipo de referencia

La interfaz (`index.html`, `viaje.html`, `app.js`, `brote.js`, `styles.css`) es un **prototipo de referencia**: **si el equipo de UX/UI arma otra interfaz, esta se adapta a la suya, no al revés**. Toda la lógica está separada y se puede reutilizar sin la interfaz:

- `web/js/backend.js`: `crearBackend(config)` devuelve el modo simulado o el de Sepolia con la misma interfaz (`estado`, `depositar`, `registrarAprobacion`, `revocarAprobacion`, `liberar`, `cerrarBeca`, `asignarDeFondo`).
- `web/js/onchain.js` (`leerOnchain`, `rpcConRespaldo`, `cargarRegistro`) y `web/js/trazabilidad.js` (`reunirViaje`, `construirViaje`, `calcularCuadra`, `seguirTransaccion`, `etapaDelDinero`, `buscarBecaDeLaEscena`): lectura pública de la red y el viaje del dinero de una beca, con el control "¿Cuadra?". Una beca inexistente devuelve `existe: false` y un `mensaje`: la interfaz debe mostrarlo y ocultar el diagrama y el "¿Cuadra?". `etapaDelDinero` dice en qué paso está la plata y `buscarBecaDeLaEscena` encuentra la beca de la demo leyendo solo la red, sin `onchain.json`.
- `web/js/proposal.js`: `proponerReparto` para el fondo común.
- `web/data/onchain.json`: respaldo si ningún RPC responde (lo genera `node scripts/escena.mjs flujo`).

Los nombres de botones y pantallas de `docs/hoja-del-equipo.md` son los del prototipo.

Para verla: `npm start` y abrir http://127.0.0.1:4178/ (modo simulado, sin billeteras). Guion de 60 s: **Ver video (12 s)**, **Aportar** USD 1 (se ve la comisión de USD 0,003), **Firmar acta** (corre la ventana de seguridad y el pago sale solo), **Cerrar beca** (los USD 30 que sobran van al fondo común), **Proponer reparto** y **Aprobar y ejecutar**. Con `?intro=1` el video arranca solo (sirve para grabarlo) y `?modo=sepolia` usa la red con MetaMask.

## Pruebas

Requiere Node.js 20 o superior.

```sh
npm test                # modo simulado, propuesta de reparto y trazabilidad
npm run contrato:test   # compila el contrato y corre sus pruebas y las de los scripts (Hardhat)
npm run contrato:gas    # gas por operación
```

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

En vivo: abrir la app con `?modo=sepolia`, conectar MetaMask con la misma cuenta y firmar el acta de la beca que indique `chequeo` (otra interfaz puede usar `crearBackend({ ...config, modo: 'sepolia' })`). `web/data/onchain.json` es el respaldo de la lectura pública cuando ningún RPC responde.

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
