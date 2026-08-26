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
import { planillaReconoceElListado } from '../fila-no-producto';
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


// ─── REGLA: EL PARSER NO INVENTA DATOS (25-ago-2026) ──────────────────────────────────────
// El MODO CATÁLOGO rellenaba `cantidad: 1` y `unidad: 'Unidad'` cuando el documento no las traía.
// Además de mentirle a quien cotiza, eso DESACTIVABA el GATE DE COTIZACIÓN aguas abajo (que
// descarta formularios precisamente porque no traen cantidades) — así entraron los 16 rótulos de
// 2981-225-LE26. Si el documento no lo dice, va null/vacío.
test('modo catálogo: no inventa cantidad ni unidad cuando el documento no las trae', async () => {
  const { parsearPlanillaCosteo } = await import('../planilla-costeo-parser');
  // Catálogo de suministro real: header de planilla + 16 productos con la columna Cantidad VACÍA
  // (caso 2731-21-LE26, "Solicitud de Compra" municipal de ferretería). El modo catálogo vive en el
  // parser de TABLAS HTML, que es lo que emite GLM-OCR para PDF escaneados — de ahí el formato.
  const filas = [
    'Martillo carpintero 16 oz mango fibra', 'Destornillador paleta 6 x 150 mm',
    'Alicate universal 8 pulgadas aislado', 'Serrucho costilla 12 pulgadas',
    'Huincha de medir 5 metros con traba', 'Nivel de aluminio 60 cm tres burbujas',
    'Brocha 3 pulgadas cerda natural', 'Rodillo de pintura 22 cm con mango',
    'Tornillo autoperforante 8 x 1 pulgada', 'Tarugo plastico 8 mm',
    'Silicona transparente pomo 280 ml', 'Cinta aisladora negra 18 mm',
    'Guante cabritilla talla L', 'Lente de seguridad claro antiempanante',
    'Disco de corte metal 4 1/2 pulgadas', 'Escalera tijera aluminio 5 peldanos',
  ];
  const texto = '<table border=1>'
    + '<tr><td>Bienes o Servicios Requeridos</td><td>Cantidad</td><td>Unidad</td></tr>'
    + filas.map(f => `<tr><td>${f}</td><td></td><td></td></tr>`).join('')
    + '</table>';
  // El nombre debe pasar esCandidato() — "listado" es una de las palabras que lo habilitan.
  const r = parsearPlanillaCosteo([{ nombre: 'listado-suministro.pdf', categoria: null, texto, metodo: 'pdf-glm-ocr' }]);
  assert.ok(r, 'el catálogo legítimo debe seguir parseándose (el gate anti-formulario no lo toca)');
  assert.ok(r!.items.length >= 15, `se esperaban >=15 ítems, llegaron ${r!.items.length}`);
  for (const it of r!.items) {
    assert.equal(it.cantidad, null, `cantidad inventada en "${it.descripcion}": ${it.cantidad}`);
    assert.equal(it.unidad, '', `unidad inventada en "${it.descripcion}": "${it.unidad}"`);
  }
});

// El mismo parser, alimentado con un ANEXO EN BLANCO en vez de un catálogo: misma firma
// estructural (celdas vacías), resultado opuesto. Es el caso 2981-225-LE26 en miniatura.
test('modo catálogo: un anexo en blanco con la MISMA firma estructural se rechaza', async () => {
  const { parsearPlanillaCosteo } = await import('../planilla-costeo-parser');
  const rotulos = [
    'Nombre:', 'Domicilio:', 'Teléfono:', 'E-mail:', 'Razón social:', 'GIRO:',
    'FIRMA:', 'FECHA DECLARACIÓN:', 'NOMBRE COMPLETO:', 'Cargo:', 'Comuna:', 'Ciudad:',
    'Más de 40%', 'Más de 25% hasta 40%', 'Más de 10% hasta 25%', '1% a 10%',
  ];
  const texto = '<table border=1>'
    + '<tr><td>Bienes o Servicios Requeridos</td><td>Cantidad</td><td>Unidad</td></tr>'
    + rotulos.map(f => `<tr><td>${f}</td><td></td><td></td></tr>`).join('')
    + '</table>';
  const r = parsearPlanillaCosteo([{ nombre: 'listado-anexos.pdf', categoria: null, texto, metodo: 'pdf-glm-ocr' }]);
  assert.equal(r, null, 'un anexo en blanco NO puede pasar por catálogo de productos');
});


// ─── REGLA V-16 DEL VALIDADOR (25-ago-2026) ───────────────────────────────────────────────
// El punto único por donde pasan todas las rutas que escriben un manifiesto. Nace de que el mismo
// error volvió cuatro veces con cuatro disfraces y cada vez se arregló solo en el parser culpable.
test('V-16 caza filas que no son productos y autocorregir las saca del manifiesto', async () => {
  const { validarInformeViabilidad, autocorregirHallazgos } = await import('../validador-viabilidad');
  const inf: any = {
    manifiesto_productos: [
      { descripcion: 'Juegos infantiles tipo calistenia alto tráfico', cantidad: 5 },
      { descripcion: 'OFERTA ECONÓMICA(OE)', cantidad: 1 },
      { descripcion: 'PLAZO DE ENTREGA(PE)', cantidad: 2 },
      { descripcion: 'COMPORTAMIENTO CONTRACTUAL ANTERIOR(CCA)', cantidad: 3 },
      { descripcion: 'PRESENCIA LOCAL DE PROVEEDORES(PLP)', cantidad: 4 },
    ],
  };
  const res = validarInformeViabilidad(inf, 60);
  const v16 = res.hallazgos.filter(h => h.regla === 'V-16');
  assert.equal(v16.length, 1, 'V-16 debió disparar exactamente una vez');
  assert.equal(v16[0].severidad, 'error');
  autocorregirHallazgos(inf, res.hallazgos, 60);
  assert.equal(inf.manifiesto_productos.length, 1, 'debía quedar solo el producto real');
  assert.match(inf.manifiesto_productos[0].descripcion, /Juegos infantiles/);
});

test('V-16 detecta el manifiesto DEGENERADO (una fila replicada) y NO lo autocorrige', async () => {
  const { validarInformeViabilidad, autocorregirHallazgos, escalarARevisionHumana } = await import('../validador-viabilidad');
  // Caso real 1057536-107-LE26: 58 filas, todas el mismo pedazo de frase cortado por el OCR.
  const inf: any = {
    manifiesto_productos: Array.from({ length: 12 }, () => ({ descripcion: 'S Y 14HRS', cantidad: 3, unidad_medida: 'HR' })),
    veredicto: { nivel: 'VIABLE', estado_veredicto: 'DEFINITIVO' },
  };
  const res = validarInformeViabilidad(inf, 60);
  const v16 = res.hallazgos.filter(h => h.regla === 'V-16');
  assert.equal(v16.length, 1);
  assert.match(v16[0].mensaje, /DEGENERADO/);
  autocorregirHallazgos(inf, res.hallazgos, 60);
  assert.equal(inf.manifiesto_productos.length, 12, 'no hay dato bueno que rescatar: no se toca');
  const escaladas = escalarARevisionHumana(inf, res.hallazgos);
  assert.ok(escaladas.includes('V-16'), 'debe escalar a revisión humana');
  assert.equal(inf.veredicto.estado_veredicto, 'REVISION_HUMANA');
});

test('V-16 no dispara sobre un manifiesto sano', async () => {
  const { validarInformeViabilidad } = await import('../validador-viabilidad');
  const inf: any = {
    manifiesto_productos: [
      { descripcion: 'Adoquines', cantidad: 17900 },
      { descripcion: 'Solera', cantidad: 572 },
      { descripcion: 'Cemento', cantidad: 250 },
      { descripcion: 'Arena', cantidad: 23 },
      { descripcion: 'Notebook 15 pulgadas (HP)', cantidad: 4 },
      { descripcion: 'TAC de Cerebro, sin MC', cantidad: 10 },
    ],
  };
  const res = validarInformeViabilidad(inf, 60);
  assert.equal(res.hallazgos.filter(h => h.regla === 'V-16').length, 0);
});


// Contraprueba del detector de manifiesto degenerado: el MISMO producto repetido en varios lotes
// con cantidades distintas es un listado legítimo, no un error de extracción.
// Caso real 1422051-24-LE26 (riego): "Válvulas de solenoide" en 7 de 10 líneas, 50/200/80/100/…
test('V-16 NO marca degenerado un producto repetido en varios lotes con cantidades distintas', async () => {
  const { validarInformeViabilidad } = await import('../validador-viabilidad');
  const inf: any = {
    manifiesto_productos: [
      { descripcion: 'Equipo de riego para invernadero', cantidad: 5, linea: 1 },
      { descripcion: 'Válvulas de solenoide', cantidad: 50, linea: 2 },
      { descripcion: 'Equipo de riego para invernadero', cantidad: 50, linea: 3 },
      { descripcion: 'Equipo de riego para invernadero', cantidad: 50, linea: 4 },
      { descripcion: 'Válvulas de solenoide', cantidad: 200, linea: 5 },
      { descripcion: 'Válvulas de solenoide', cantidad: 80, linea: 6 },
      { descripcion: 'Válvulas de solenoide', cantidad: 100, linea: 7 },
      { descripcion: 'Válvulas de solenoide', cantidad: 100, linea: 8 },
      { descripcion: 'Válvulas de solenoide', cantidad: 40, linea: 9 },
      { descripcion: 'Válvulas de solenoide', cantidad: 40, linea: 10 },
    ],
  };
  const res = validarInformeViabilidad(inf, 60);
  assert.equal(res.hallazgos.filter(h => h.regla === 'V-16').length, 0);
});


// ─── FALSOS POSITIVOS DE LA REGLA DE SIGLAS (25-ago-2026) ─────────────────────────────────
// La primera versión de la regla se conformaba con que la sigla fueran las iniciales de la frase.
// Al correrla sobre los documentos reales de las 348 licitaciones con listado, borró equipamiento
// médico legítimo — y alcanzó a removerlo de dos informes guardados antes de que se detectara.
// Borrar un producto real es PEOR que mostrar uno de más: el de más se ve y se saca, el que falta
// no se nota hasta que la oferta salió incompleta. De ahí el segundo candado (vocabulario de
// evaluación). Estos son los casos reales que lo motivaron.
test('la regla de siglas NO borra productos reales cuya sigla calza con sus iniciales', () => {
  const productosReales = [
    'Desfibrilador Externo Automático(DEA)',      // D-E-A calza, pero es un equipo médico
    'Desfibrilador externo automático (DEA)',
    'Mascara de alto flujo (MAF)',                // M-A-F calza
    'Monitor de Signos Vitales (MSV)',
    'Test de Desarrollo Psicomotor (TDP)',
    'Bomba de Infusión Volumétrica (BIV)',
  ];
  for (const d of productosReales) {
    assert.equal(esFilaNoProducto(d), false, `se borró un producto real: "${d}"`);
  }
});

test('la regla de siglas SÍ descarta criterios de evaluación con sigla', () => {
  const criterios = [
    'OFERTA ECONÓMICA(OE)', 'PLAZO DE ENTREGA(PE)',
    'COMPORTAMIENTO CONTRACTUAL ANTERIOR(CCA)', 'PRESENCIA LOCAL DE PROVEEDORES(PLP)',
  ];
  for (const d of criterios) {
    assert.equal(esFilaNoProducto(d), true, `no se detectó el criterio: "${d}"`);
  }
});


// ─── INVARIANTE DE ORDEN EN EL PIPELINE (25-ago-2026) ─────────────────────────────────────
// Este test mira el CÓDIGO FUENTE, cosa rara, y tiene una razón concreta: V-16 nació muerta.
// `manifiesto_productos` se agregaba recién en el objeto de retorno de analizarViabilidadIAV3, así
// que cuando corría el validador el campo no existía y toda regla que lo mirara veía [] y se iba
// sin hacer nada. La regla pasaba sus tests unitarios, pasaba sobre informes guardados, y aun así
// NUNCA se habría disparado durante el análisis que produce el problema.
//
// Un fallo así no se nota: no hay excepción, no hay log, el informe sale "válido". Por eso el
// invariante se verifica sobre el texto del módulo — es la única forma barata de que mover esa
// asignación rompa algo visible en vez de apagar el guardarraíl en silencio.
test('el manifiesto entra a p3 ANTES de que corra el validador (si no, V-16 queda muerta)', async () => {
  const { readFileSync } = await import('node:fs');
  const { fileURLToPath } = await import('node:url');
  const ruta = fileURLToPath(new URL('../viabilidad-ia.ts', import.meta.url));
  const src = readFileSync(ruta, 'utf8');

  const iAsigna = src.indexOf('p3.manifiesto_productos = manifiesto');
  const iValida = src.indexOf('validarInformeViabilidad(p3');
  assert.notEqual(iAsigna, -1, 'falta "p3.manifiesto_productos = manifiesto" — V-16 no vería el manifiesto');
  assert.notEqual(iValida, -1, 'no se encontró la llamada a validarInformeViabilidad(p3, …)');
  assert.ok(iAsigna < iValida,
    'el manifiesto debe asignarse a p3 ANTES de validarInformeViabilidad: si no, V-16 valida un manifiesto vacío y no caza nada');

  // Y el retorno debe devolver el manifiesto YA autocorregido, no el array original.
  assert.match(src, /manifiesto_productos:\s*p3\.manifiesto_productos/,
    'el retorno debe usar p3.manifiesto_productos (el corregido por el validador), no la variable `manifiesto`');
});


// ─── INVARIANTE ARQUITECTÓNICO: TODA RUTA QUE **ESCRIBE** EL MANIFIESTO DEBE FILTRAR ──────
// (25-ago-2026.) V-16 corre durante el ANÁLISIS. Pero el manifiesto se escribe desde más de un
// lado, y el segundo se descubrió de casualidad: `app/api/documentos/generar-costeo/[codigo]`
// vuelve a correr el parser al REGENERAR el costeo y pisaba `manifiesto_productos` con las filas
// crudas — sin pasar por V-16. Efecto real en 2409-49-LP26: se dejaba el manifiesto en 14
// productos, el usuario apretaba "regenerar costeo" y volvían las 16 filas de "PLAZO DE
// INSTALACION". Indistinguible de "el fix no sirvió".
//
// Filtrar al LEER no alcanza: el manifiesto guardado es lo que ven el auditor técnico, el
// checklist comercial y la ficha del negocio. Este test recorre app/ y exige que todo archivo que
// asigne `manifiesto_productos` importe el filtro (o el validador, que lo aplica por dentro).
test('todo archivo que ESCRIBE manifiesto_productos filtra las filas que no son productos', async () => {
  const { readFileSync, readdirSync, statSync } = await import('node:fs');
  const { fileURLToPath } = await import('node:url');
  const { join, sep } = await import('node:path');
  const raiz = fileURLToPath(new URL('../../../app', import.meta.url));

  const archivos: string[] = [];
  (function recorrer(dir: string) {
    for (const e of readdirSync(dir)) {
      const p = join(dir, e);
      if (statSync(p).isDirectory()) { if (e !== 'node_modules' && e !== '__tests__') recorrer(p); }
      else if (/\.(ts|tsx)$/.test(e)) archivos.push(p);
    }
  })(raiz);

  const infractores: string[] = [];
  for (const f of archivos) {
    const src = readFileSync(f, 'utf8');
    // Asignación real al campo (no lectura, no declaración de tipo, no comentario).
    if (!/^\s*(?!\/\/|\*)[\w.\[\]]*\bmanifiesto_productos\s*=[^=]/m.test(src)) continue;
    const filtra = /esFilaNoProducto/.test(src) || /autocorregirHallazgos/.test(src);
    if (!filtra) infractores.push(f.slice(raiz.length + 1).split(sep).join('/'));
  }
  assert.deepEqual(infractores, [],
    `estos archivos escriben manifiesto_productos sin filtrar filas que no son productos: ${infractores.join(', ')}`);
});


// ─── UN PARSER QUE BARRE EL PLIEGO ENTERO (25-ago-2026, 1057922-23-LE26) ──────────────────
// CASO REAL reportado por el usuario ("los productos de la viabilidad no son los correctos; lo
// re-analicé y sigue igual"): CESFAM con SAR Rahue Alto. Las bases venían como UN PDF de 3.300
// líneas en pdf-text, con la tabla de equipamiento (9 productos) en las páginas 2-3 y el resto
// prosa administrativa. El parser laxo de itemizados —guiado SOLO por el correlativo esperado, sin
// estructura de tabla— leyó los ítems 2, 3 y 4 de la tabla real y después fue a buscar el "5", el
// "7" y el "8" a cientos de líneas de distancia: cazó el membrete de la portada ("DIRECCIÓN DEPTO.
// ASESORÍA JURÍDICA A.2/Folio DSF5997", con un número de página suelto como cantidad), el
// cronograma del proceso ("Apertura de las Ofertas"), un decreto citado y la cola de un párrafo
// partido. Trece filas que además GANARON por largo al listado correcto de 9 del modelo.
//
// Endurecer el parser se probó y se DESCARTÓ con datos: podar por contigüidad limpiaba este caso
// pero borraba productos reales en otras doce licitaciones (nueve materiales de construcción en
// 3390-19-LE26, diez cajas de implantes en 2258-113-LR26, cinco camas clínicas en 1114608-4-LP26),
// porque hay listados legítimos donde cada ítem viene seguido de su ficha técnica y por tanto queda
// tan espaciado como un enganche lejano. Borrar un producto real es peor que mostrar uno de más.
// El guardarraíl vive entonces en el CONSUMIDOR: la planilla solo pisa al modelo si reconoce lo
// que el modelo ya identificó.
test('la planilla que leyó otra cosa NO puede pisar el listado del modelo', () => {
  // Las 13 descripciones REALES que el parser sacó de las bases de 1057922-23-LE26, contra los 9
  // productos REALES que el modelo listó. Copiadas de la BD, no inventadas.
  const planilla = [
    'DIRECCI”N DEPTO. ASESORÕA JURÕDICA A.2/Folio DSF5997',
    'Carro aseo c/estrujamopas NO 5 $790.000.-',
    'Carro yegua NO 3 $371.000.-',
    'Escalera 2 peldaños plegable NO 5 $225.000.-',
    'Pallet NO 14 $1.261.000.-',
    '3. Decreto 63 Exento que Aprueba Norma Técnica N°226 que establece Obligatoriedad de Implementar un Sistema de Registro',
    'Apertura de las Ofertas',
    'de estas Bases, hasta la Recepción Conforme del mismo.',
    'Apoderado UTP',
    'HERRAMIENTAS MANUALES',
    'INSTRUMENTOS DE MEDICIÓN Y TRAZADO',
    'ELEMENTOS DE SUJECIÓN Y ACABADO',
    'Contenedores de color gris.',
  ];
  const modelo = ['Set herramientas', 'Carro aseo c/estrujamopas', 'Carro yegua', 'Escalera 2 peldaños plegable',
    'Pallet', 'Romana', 'Termohigrómetro', 'Set contenedores', 'Fullspace'];
  const r = planillaReconoceElListado(planilla, modelo);
  assert.equal(r.reconoce, false,
    `la planilla basura habría pisado el manifiesto correcto (solape ${Math.round(r.solape * 100)}%)`);
});

test('una planilla FIEL sí puede pisar al modelo (el gate no bloquea lo bueno)', () => {
  // Prueba negativa: el parser leyó la planilla de verdad y trae el detalle completo; el modelo
  // había resumido. Ahí la planilla DEBE ganar — es el caso para el que existe el reemplazo.
  const modelo = ['Chaleco Balístico con funda', 'Cascos balísticos', 'Bastón Retráctil', 'Cinturón Táctico', 'Lentes balísticos'];
  const planilla = [...modelo, 'Funda Chaleco Balístico con logo institucional', 'Botiquín control de hemorragias',
    'Gas pimienta con funda', 'Esposas de seguridad', 'Linterna con funda'];
  assert.equal(planillaReconoceElListado(planilla, modelo).reconoce, true);
});

test('un CATÁLOGO largo puede pisar al modelo aunque el modelo haya truncado la lista', () => {
  // El modelo trunca listas largas: de 300 filas de ferretería lista 20. El solape cae de forma
  // legítima, y por eso el umbral baja a un tercio cuando la planilla más que dobla al modelo.
  const catalogo = Array.from({ length: 300 }, (_, i) => `Artículo de ferretería ${i + 1}`);
  const modelo = [...catalogo.slice(0, 8), 'Kit de herramientas surtido', 'Set de brocas', 'Caja organizadora'];
  assert.equal(planillaReconoceElListado(catalogo, modelo).reconoce, true,
    'un catálogo real no debe quedar bloqueado por el resumen del modelo');
});

test('con muy pocos ítems del modelo el gate no opina (el solape no es medida confiable)', () => {
  assert.equal(planillaReconoceElListado(['Cemento', 'Arena'], ['Grava', 'Ripio']).reconoce, true);
});

test('el filtro descarta cronograma, normativa citada y prosa de las bases', () => {
  const basura = [
    'Apertura de las Ofertas',
    'Recepción de las Ofertas',
    'Cierre Período de consultas',
    'Cierre de presentación de las ofertas.',
    'Publicación de Respuestas',
    '3. Decreto 63 Exento que Aprueba Norma Técnica N°226 que establece Obligatoriedad de Implementar un Sistema de Registro',
    'Ley N° 19.886 de Bases sobre Contratos Administrativos de Suministro',
    'Resolución Exenta N°13609',
    'de estas Bases, hasta la Recepción Conforme del mismo.',
    'Apoderado UTP',
  ];
  for (const d of basura) {
    assert.equal(esFilaNoProducto(d), true, `no se detectó como no-producto: "${d}"`);
  }
});

test('los filtros de cronograma/normativa/prosa NO borran productos reales', () => {
  // Productos que comparten vocabulario con las reglas nuevas — todos deben sobrevivir.
  const productosReales = [
    'Caja de recepción de muestras',
    'Cierre hermético para contenedor',
    'Casco certificado según norma NCh 461',
    'Panel de entrega de comandas',
    'Reglamento de sala impreso y enmarcado',   // arranca con "reglamento" pero es un bien
    'Termohigrómetro digital',
    'Set contenedores',
    'Pallet',
    'Escalera 2 peldaños plegable',
    'Carro aseo c/estrujamopas',
    'Fullspace',
    'Romana',
  ];
  for (const d of productosReales) {
    assert.equal(esFilaNoProducto(d), false, `se borró un producto real: "${d}"`);
  }
});

// ─── INVARIANTE: LA PLANILLA DEBE RECONOCER LO QUE EL MODELO YA IDENTIFICÓ ────────────────
// (25-ago-2026.) Los gates (a)-(c) persiguen FORMAS conocidas de basura y siempre aparece una
// nueva — este caso fue la cuarta. El gate (d) no mira vocabulario: compara las dos lecturas del
// mismo expediente. Si el parser no encuentra la mayoría de lo que el modelo listó, no está
// leyendo el mismo listado y no puede pisarlo. Se verifica sobre el fuente por la misma razón que
// el invariante de orden de más arriba: si alguien lo saca, el informe sigue saliendo "válido".
test('el gate del parser exige solape con el listado del modelo', async () => {
  const { readFileSync } = await import('node:fs');
  const { fileURLToPath } = await import('node:url');
  const src = readFileSync(fileURLToPath(new URL('../viabilidad-ia.ts', import.meta.url)), 'utf8');
  assert.match(src, /planillaReconoceAlLLM/,
    'falta el gate de solape planilla↔modelo: sin él, un parser que leyó otra cosa vuelve a pisar el manifiesto correcto');
  assert.match(src, /planillaReconoceElListado\(/,
    'el gate debe usar planillaReconoceElListado, la regla compartida y testeada');
  const iCalc = src.indexOf('const planillaReconoceAlLLM = solape.reconoce');
  const iUso = src.indexOf('planillaSana && !planillaDegradaLineas && planillaReconoceAlLLM');
  assert.ok(iCalc !== -1 && iUso !== -1 && iCalc < iUso,
    'planillaReconoceAlLLM debe calcularse antes del gate y estar en la condición que reemplaza el manifiesto');
});

// ─── TRAZA DE FUENTES: SE ESCRIBE SIEMPRE, NO SOLO CUANDO HAY PLANILLA ────────────────────
// (26-ago-2026, auditoría técnica.) Antes era `_fuentes_manifiesto: planilla ? {...} : null` —
// como el 70% de las licitaciones no tiene una planilla parseable, la traza cubría el 3% de los
// informes reales (16 de 515 medidos). V-15, la regla que debía escalar a revisión humana cuando
// las fuentes se contradicen, casi nunca tenía con qué opinar: no es que fallara, es que la
// mayoría de las veces no había dato para juzgar.
test('_fuentes_manifiesto se escribe SIEMPRE, no condicionado a que exista planilla', async () => {
  const { readFileSync } = await import('node:fs');
  const { fileURLToPath } = await import('node:url');
  const src = readFileSync(fileURLToPath(new URL('../viabilidad-ia.ts', import.meta.url)), 'utf8');
  assert.doesNotMatch(src, /_fuentes_manifiesto:\s*planilla\s*\?/,
    'la traza volvió a condicionarse a "hay planilla" — eso es la regresión exacta que dejaba el 70% de los informes sin traza');
  assert.match(src, /_fuentes_manifiesto:\s*\{[\s\S]{0,40}origen:\s*origenManifiesto/,
    'la traza debe ser siempre un objeto con `origen`, no un null condicional');
});

// El origen se declara en las 4 fuentes reales que puede tener el manifiesto final: el modelo
// (por defecto), la tabla canónica de bases técnicas, la planilla, y la extracción dedicada de
// secciones "LÍNEA DE PRODUCTO". Si se agrega una fuente nueva sin marcar el origen, la traza
// vuelve a mentir sobre de dónde salió el dato.
test('las 4 fuentes reales del manifiesto marcan su origen', async () => {
  const { readFileSync } = await import('node:fs');
  const { fileURLToPath } = await import('node:url');
  const src = readFileSync(fileURLToPath(new URL('../viabilidad-ia.ts', import.meta.url)), 'utf8');
  assert.match(src, /origenManifiesto:\s*'modelo'\s*\|\s*'tabla_canonica'\s*\|\s*'planilla'\s*\|\s*'extraccion_lineas_producto'/,
    'falta declarar el tipo con las 4 fuentes reales');
  assert.match(src, /manifiesto = canonica\.map[\s\S]{0,300}origenManifiesto = 'tabla_canonica'/,
    'la tabla canónica reemplaza el manifiesto pero no marca su origen');
  assert.match(src, /origenManifiesto = 'planilla'/, 'la planilla no marca su origen al ganar');
  assert.match(src, /manifiesto = extra;\s*\n\s*origenManifiesto = 'extraccion_lineas_producto'/,
    'la extracción dedicada de líneas no marca su origen');
});

// EL BUG QUE ESTO DESTAPÓ: `planilla` (la variable) queda con el resultado del PARSEO exista o
// no gane — los gates (sana/degradaLineas/reconoceAlLLM/largo) pueden rechazarla y el manifiesto
// final seguir siendo el del modelo. La traza vieja decía `elegida: planilla.fuenteDoc` con solo
// mirar "¿se parseó algo?", así que en una planilla RECHAZADA la traza mentía diciendo que había
// ganado. `planillaGanaManifiesto` es la condición real (la misma que decide si se reemplaza el
// manifiesto) y debe ser lo que gobierna qué queda como `elegida`.
test('la traza no confunde "se parseó una planilla" con "la planilla ganó" (bug real corregido)', async () => {
  const { readFileSync } = await import('node:fs');
  const { fileURLToPath } = await import('node:url');
  const src = readFileSync(fileURLToPath(new URL('../viabilidad-ia.ts', import.meta.url)), 'utf8');
  assert.match(src, /const planillaGanaManifiesto = !!\(planilla && planillaSana/,
    'falta nombrar la condición completa — sin esto la traza no puede distinguir "se leyó" de "ganó"');
  assert.match(src, /elegida:\s*origenManifiesto === 'planilla' \? planilla!\.fuenteDoc/,
    '`elegida` debe depender de origenManifiesto (si la planilla REALMENTE ganó), no de que `planilla` exista');
  // Y cuando se leyó pero NO ganó, el motivo del rechazo queda trazado — no silencioso.
  assert.match(src, /planillaRechazada:\s*\(planilla && !planillaGanaManifiesto\)/,
    'falta registrar por qué se rechazó una planilla que sí se pudo leer');
});
