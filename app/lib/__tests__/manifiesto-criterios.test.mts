// Guardarraíl del MANIFIESTO DE PRODUCTOS contra filas de la tabla de CRITERIOS DE EVALUACIÓN
// coladas como si fueran ítems a cotizar. Correr con:
//   npx tsx --test app/lib/__tests__/manifiesto-criterios.test.mts
//
// BUG REAL (14-ago-2026, caso 2345-128-LP26, reportado por el usuario: "me pone cualquier
// cantidad de cosas… que no son parte del costeo de los ítems de la licitación"): el manifiesto
// guardado traía 30 "productos" — los 10 reales (chalecos balísticos, cascos, bastones…) MÁS 20
// filas de la tabla de criterios, con el PUNTAJE leído como si fuera la "cantidad" del producto
// ("Oferta Técnica" cantidad=26, "Entre 10 y 14" cantidad=10, "1er Lugar…" cantidad=6). Todas
// esas filas terminaban en el Excel de costeo como ítems a cotizar.
//
// Los casos de abajo son las 30 descripciones REALES de esa licitación, copiadas tal cual de la
// BD — no ejemplos inventados.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { esFilaNoProducto } from '../viabilidad-ia';
import { adaptarViabilidadACosteo } from '../generar-costeo';

// Los 10 productos REALES de 2345-128-LP26 — ninguno debe descartarse jamás.
const PRODUCTOS_REALES = [
  'Chaleco Balístico con funda con logo institucional',
  'Funda Chaleco Balístico con logo institucional',
  'Cascos balísticos',
  'Bastón Retráctil',
  'Cinturón Táctico',
  'Botiquín control de hemorragias',
  'Gas pimienta con funda',
  'Esposas de seguridad con porta esposas',
  'Lentes balísticos',
  'Linterna con funda',
];

// Las 20 filas de la tabla de CRITERIOS que se colaron como "productos" — todas deben descartarse.
const FILAS_DE_CRITERIOS = [
  // Ponderaciones de los ejes de evaluación (el % leído como "cantidad").
  'Oferta Administrativa',
  'Oferta Técnica',
  'Oferta económica',
  // Declaración jurada de Programa de Integridad — las dos caras de un criterio binario.
  'El oferente, si es persona jurídica, acredita que cuenta con programa de integridad y ética empresarial y es conocidos por su personal. En caso de ser persona natural, acredita, tener formación en materias de compliance y/o integridad. Tratándose de UTP, todos sus integrantes acreditan que cuenta con programas de integridad y ética empresarial y es conocidos por su personal.',
  'El oferente, si es persona jurídica, no acredita que cuenta con programa de integridad y ética empresarial y/o no es conocidos por su personal. En caso de ser persona natural, no acredita, tener formación en materias de compliance y/o integridad. Tratándose de UTP, no acreditan que cuentan con programas de integridad y ética empresarial y/o no es conocidos por su personal, en los términos establecidos.',
  // Criterio de cumplimiento documental (plazo ordinario/extraordinario).
  'Presenta todos antecedentes en el plazo ordinario',
  'Presenta antecedentes en el plazo extraordinario',
  'No presenta todos los antecedentes en el plazo extraordinario',
  '“Sin Información”',
  // Criterio de Materias de Impacto Social.
  'El oferente cuenta con al menos una Materia de Impacto Social solicitada',
  'El oferente NO cuenta con ninguna Materia de Impacto Social solicitada',
  // Tramos de puntaje por cantidad de OC/facturas presentadas.
  '15 o más',
  'Entre 10 y 14',
  'Entre 5 y 9',
  'Entre 1 y 4',
  'Sin facturas, boletas u Ordenes de Compra o no presenta información',
  // Ranking por plazo de entrega ofertado.
  '1er Lugar: Oferta con la menor cantidad de días para la entrega',
  '2do Lugar: Oferta con la segunda menor cantidad de días para la entrega',
  '3er Lugar: Oferta con la tercera menor cantidad de días para la entrega',
  '4to Lugar: Oferta con la cuarta menor cantidad de días para la entrega (y subsiguientes)',
];

test('los 10 productos REALES de 2345-128-LP26 sobreviven al filtro (cero falsos positivos)', () => {
  for (const d of PRODUCTOS_REALES) {
    assert.equal(esFilaNoProducto(d), false, `se descartó un producto real: "${d}"`);
  }
});

test('las 20 filas de la tabla de CRITERIOS de 2345-128-LP26 se descartan todas', () => {
  for (const d of FILAS_DE_CRITERIOS) {
    assert.equal(esFilaNoProducto(d), true, `no se detectó como criterio: "${d}"`);
  }
});

// Guardarraíl del guardarraíl: productos reales de OTROS rubros que empiezan con palabras que
// podrían confundirse con las de un criterio — ninguno debe perderse. Un producto es una frase
// NOMINAL (un objeto); un criterio es una oración sobre el oferente o un rango/ranking.
test('productos de otros rubros con nombres "riesgosos" NO se descartan', () => {
  const noDebenDescartarse = [
    'Entregable de capacitación técnica',      // empieza con "Entrega"+ble, pero es un sustantivo
    'Presentador láser inalámbrico',           // empieza con "Presenta"+dor
    'Sin Fin transportador helicoidal',        // empieza con "Sin", pero no es "Sin Información"
    'Cumbrera de acero galvanizado',           // empieza con "Cum", cerca de "Cumple"
    'Declarador de aduana (servicio)',         // empieza con "Declara"+dor
    'Lugar de trabajo modular',                // contiene "Lugar" pero no es un ranking
    'El Alamo — banca de plaza modelo 3',      // empieza con "El" pero no "El oferente"
  ];
  for (const d of noDebenDescartarse) {
    assert.equal(esFilaNoProducto(d), false, `se descartó un producto real: "${d}"`);
  }
});

test('descripción vacía o solo espacios no revienta ni se marca como criterio', () => {
  assert.equal(esFilaNoProducto(''), false);
  assert.equal(esFilaNoProducto('   '), false);
  assert.equal(esFilaNoProducto(null as any), false);
  assert.equal(esFilaNoProducto(undefined as any), false);
});

// BUG REAL (17-ago-2026): el filtro estaba SOLO en el análisis (que ESCRIBE el manifiesto), pero
// "Regenerar costeo" (POST /api/documentos/generar-costeo) lee el manifiesto YA GUARDADO y arma el
// Excel de nuevo — ese camino no pasaba por el filtro, así que un informe viejo con ítems inflados
// seguía produciendo un Excel sucio, indistinguible de "el fix no funcionó". Ahora el filtro está
// en adaptarViabilidadACosteo, la última puerta antes del Excel, así que cubre TODOS los caminos.
test('adaptarViabilidadACosteo filtra los criterios aunque el manifiesto GUARDADO venga sucio (regresión 2345-128-LP26)', () => {
  const informe: any = {
    manifiesto_productos: [
      ...PRODUCTOS_REALES.map((descripcion, i) => ({
        linea: 1, categoria: null, descripcion, modelo: '',
        cantidad: 100 + i, unidad_medida: 'UN', unidad_inferida: false,
        presupuesto_linea: null, tipo: 'generico', ruta: '',
      })),
      ...FILAS_DE_CRITERIOS.map((descripcion) => ({
        linea: 1, categoria: null, descripcion, modelo: '',
        cantidad: 1, unidad_medida: 'UN', unidad_inferida: true,
        presupuesto_linea: null, tipo: 'generico', ruta: '',
      })),
    ],
    modalidad: { tipo: 'suma_alzada' },
    presupuesto: { bruto: 300_000_000 },
  };

  const datos = adaptarViabilidadACosteo('2345-128-LP26', informe);
  const items = datos.grupos.flatMap(g => g.items);

  assert.equal(items.length, PRODUCTOS_REALES.length, 'al Excel solo deben llegar los productos reales');
  for (const d of FILAS_DE_CRITERIOS) {
    assert.ok(!items.some(i => i.descripcion === d), `se colό una fila de criterios: "${d.slice(0, 50)}"`);
  }
  for (const d of PRODUCTOS_REALES) {
    assert.ok(items.some(i => i.descripcion === d), `falta un producto real: "${d}"`);
  }
});

test('adaptarViabilidadACosteo no toca un manifiesto que ya viene limpio', () => {
  const informe: any = {
    manifiesto_productos: PRODUCTOS_REALES.map((descripcion, i) => ({
      linea: 1, categoria: null, descripcion, modelo: '',
      cantidad: 10 + i, unidad_medida: 'UN', unidad_inferida: false,
      presupuesto_linea: null, tipo: 'generico', ruta: '',
    })),
    modalidad: { tipo: 'suma_alzada' },
    presupuesto: { bruto: 300_000_000 },
  };
  const items = adaptarViabilidadACosteo('X-1-LP26', informe).grupos.flatMap(g => g.items);
  assert.equal(items.length, PRODUCTOS_REALES.length);
});


// ─── CASO REAL 2981-225-LE26 (25-ago-2026, PDI — 165 botiquines IFAK) ──────────────────────
// El manifiesto guardado traía 16 "productos" que eran los campos en blanco de los ANEXOS
// administrativos del PDF de bases, más los tramos del criterio de inclusión. El único producto
// real (el botiquín, cantidad 165) quedó sepultado: la vista de Productos mostraba 16 rótulos y
// el Excel de costeo se generaba con esas 16 filas.
const ROTULOS_2981 = [
  'Nombre:', 'Domicilio:', 'Teléfono:', 'E-mail:',
  'Más de 40%', 'Más de 25% hasta 40%', 'Más de 10% hasta 25%', '1% a 10%',
  'Nombre del Oferente:', 'Razón social:', 'FIRMA:', 'FECHA DECLARACIÓN:',
  'NOMBRE / RAZON SOCIAL', 'GIRO:', 'E-MAIL', 'NOMBRE COMPLETO:',
];

test('las 16 filas basura de 2981-225-LE26 (rótulos de formulario + tramos %) se descartan todas', () => {
  for (const d of ROTULOS_2981) {
    assert.equal(esFilaNoProducto(d), true, `no se detectó como rótulo/tramo: "${d}"`);
  }
});

test('el ÚNICO producto real de 2981-225-LE26 sobrevive', () => {
  assert.equal(esFilaNoProducto(
    'BOTIQUINES TACTICOS PARA CONTROL DE TRAUMAS Y/O HEMORRAGIAS TIPO IFAK PARA EQUIPOS FRONTERA INTERNA',
  ), false);
});

// Guardarraíl del filtro de rótulos: productos reales que contienen porcentajes, dos puntos en
// medio, o palabras que también son rótulos ("Fecha", "Firma") — ninguno debe perderse.
test('productos reales con % o palabras de rótulo NO se descartan', () => {
  const noDebenDescartarse = [
    'Alcohol gel 70%',
    'Cloro al 5% bidón 5 litros',
    'Guantes de nitrilo: caja de 100 unidades',   // dos puntos EN MEDIO, no al final
    'Fechador automático de goma',                // empieza con "Fecha"+dor
    'Firmador digital token USB',                 // empieza con "Firma"+dor
    'Detergente concentrado 40% activo',
    'Papel higiénico hoja doble 500 mts',
    'Ciudadela — set de mesas escolares',         // empieza con "Ciudad"+ela
  ];
  for (const d of noDebenDescartarse) {
    assert.equal(esFilaNoProducto(d), false, `se descartó un producto real: "${d}"`);
  }
});
