// Datos de la escena de demostración. Todo es ficticio y está rotulado como tal en la interfaz.
export const TASA_ARS = 1500; // cotización fija de demostración, no es un dato real

export const ACTORES = {
  patrocinador: { nombre: 'Fundación Demo (patrocinador)' },
  aportante: { nombre: 'Persona aportante (demo)' },
  secretaria: { nombre: 'Secretaría Académica (demo)' },
  estudiante: { nombre: 'Estudiante #1 (demo)' },
  estudiante2: { nombre: 'Estudiante #2 (demo)' },
};

// Las becas de la escena de la demo llevan este vencimiento como marca (año 2100, no vencen).
// Las del recorrido completo (scripts/escena.mjs flujo) usan otro y no se muestran en la escena.
export const ESCENA_VENCE = 4102444800;

// Cada beca de la escena se reconoce por su cupo, no por su número: así `preparar` puede crear
// escenas nuevas sin tocar el código. Con dos materias es la que cierra y aporta al fondo común;
// con una es la que lo recibe. Territorio y antigüedad no viven en el contrato (alimentan la propuesta).
const PERFILES = {
  2: {
    estudiante: 'estudiante',
    territorio: 'Lomas de Zamora',
    creadaHaceMin: 90,
    materias: [
      { key: 'MAT-101', nombre: 'Análisis Matemático I' },
      { key: 'MAT-102', nombre: 'Álgebra y Geometría' },
    ],
  },
  1: {
    estudiante: 'estudiante2',
    territorio: 'La Matanza',
    creadaHaceMin: 600,
    materias: [{ key: 'MAT-201', nombre: 'Introducción a la Programación' }],
  },
};

export const perfilDeBeca = (cupo) => PERFILES[cupo] ?? { estudiante: 'estudiante', territorio: undefined, creadaHaceMin: 0, materias: [] };

// Logros del camino de Brote, en orden de ascenso.
export const LOGROS = [
  { key: 'problema', titulo: 'Problema real', detalle: 'Cifras de OpenArg con su fuente' },
  { key: 'aporte', titulo: 'Aporte recibido', detalle: 'Los fondos quedan en la beca' },
  { key: 'acta', titulo: 'Acta firmada', detalle: 'La universidad confirma la materia' },
  { key: 'pago', titulo: 'Pago liberado', detalle: 'El contrato paga al estudiante' },
  { key: 'cobro', titulo: 'Cobrado (simulado)', detalle: 'Retiro a pesos de demostración' },
  { key: 'fondo', titulo: 'Fondo común', detalle: 'El saldo sobrante ayuda a otra beca' },
];

// Camino de la plata de una beca (página "El viaje del dinero"): mismos pasos que ETAPAS de trazabilidad.js.
export const LOGROS_VIAJE = [
  { key: 'creada', titulo: 'Beca creada', detalle: 'Todavía sin fondos' },
  { key: 'bloqueado', titulo: 'Plata bloqueada', detalle: 'Queda en el contrato' },
  { key: 'acta', titulo: 'Acta firmada', detalle: 'La Secretaría confirma' },
  { key: 'pagado', titulo: 'Pago al estudiante', detalle: 'El contrato paga' },
  { key: 'cerrada', titulo: 'Beca cerrada', detalle: 'Se liquida lo que quedó' },
  { key: 'fondo', titulo: 'Fondo común', detalle: 'El sobrante ayuda a otro' },
];
