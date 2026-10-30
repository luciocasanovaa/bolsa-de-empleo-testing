# EduTrust · hoja del equipo (1 página)

Pitch de 1 minuto. Se muestra **una sola transacción en vivo**: firmar el acta. El pago sale solo.

> Los nombres de botones y pantallas de esta hoja son los del prototipo visual de referencia (ver el README). **Hay que ajustarlos a la interfaz final** que está armando el equipo de UX/UI.

## Antes de subir al escenario (10 minutos antes)

1. Terminal 1: `node scripts/escena.mjs chequeo`. Tiene que decir **"LISTA para la demo en vivo"** y el número de beca. Si no, correr `node scripts/escena.mjs preparar` y repetir `chequeo`.
2. Terminal 2: `node scripts/escena.mjs vigilante` (queda abierto; paga solo cuando vence la ventana).
3. Notebook: MetaMask en Sepolia con la cuenta de testnet del relayer. Abrir la demo con `?modo=sepolia` y confirmar que arriba dice **"Sepolia (testnet)"**.
4. Tener abierta otra pestaña con la demo **sin** `?modo=sepolia` (modo simulado) como respaldo.

## La demo en vivo (60 segundos)

| Tiempo | Qué se hace | Qué se dice |
|---|---|---|
| 0:00 a 0:12 | Botón **Ver video (12 s)** | "Entre 2023 y 2025, los beneficiarios de Progresar cayeron 57 %. Fuente: OpenArg." |
| 0:12 a 0:22 | Mostrar el panel **Prueba on-chain** y la beca lista | "Los que quieren ayudar no saben si su plata llega. Acá el dinero ya está bloqueado en un contrato: se ve en la red, sin billetera." |
| 0:22 a 0:28 | Clic en **Firmar acta** y confirmar en MetaMask | "La Secretaría confirma que el estudiante aprobó la materia." |
| 0:28 a 0:45 | Cuenta regresiva de la ventana de seguridad | (ver abajo) |
| 0:45 a 0:52 | Aparece **Pagada**; abrir el link de Etherscan del pago | "El contrato pagó solo, a la billetera del estudiante. Cualquiera lo puede comprobar." |
| 0:52 a 1:00 | Mostrar **El viaje del dinero** (QR) y cerrar | "Las personas pagan 0,3 % encima del aporte; las empresas, un plan por reportes verificables y talento con consentimiento." |

## Qué decir mientras corre la cuenta regresiva (unos 15 segundos)

> "Hay una ventana de seguridad: si la Secretaría se equivoca, puede revocar el acta antes de que se pague. Después de la ventana, el pago lo puede liberar cualquiera y siempre va al estudiante. Nadie del equipo puede desviarlo."

## Si algo falla (no improvisar: pasar al simulado)

1. **MetaMask no abre o la transacción tarda más de 20 s:** pasar a la pestaña del **modo simulado** y repetir el mismo recorrido (Aportar, Firmar acta, esperar, se paga). Decir: "Esto es el modo simulado; la prueba real está acá" y abrir el panel **Prueba on-chain** con los hashes ya ejecutados.
2. **El panel dice "Sin conexión al RPC":** no pasa nada, muestra el último estado guardado. Seguir.
3. **El pago no sale después de la ventana:** apretar **Liberar pago (si el vigilante no lo hizo)**; cualquiera puede liberar.
4. **Todo falla:** mostrar el video grabado de respaldo.

## Links de Etherscan del recorrido completo

<!-- LINKS -->
(Se completan con `npm run hoja` después de correr `node scripts/escena.mjs flujo`.)
<!-- /LINKS -->

## Qué es real y qué es simulado

- **Real (en Sepolia, sin valor):** contrato, token de prueba, aportes, comisión, firma de acta, ventana, pago, fondo común y la lectura pública de la red.
- **Simulado:** el login, el retiro a pesos, la prueba de conocimiento cero, los saldos iniciales y las becas de ejemplo. El token es de prueba, no es USDC real.
- **Hipótesis (no validadas):** los precios del plan institucional, el beneficio fiscal y la bolsa de talento.
