// app/lib/fila-no-producto.ts
// Filtro DETERMINISTA (código, no IA) de filas que NO son productos a cotizar.
//
// Vive en su propio módulo —y no dentro de planilla-costeo-parser.ts— porque lo consumen los TRES
// caminos que terminan mostrando o costeando un manifiesto, incluido uno de CLIENTE:
//   · el análisis (viabilidad-ia.ts), que ESCRIBE el manifiesto;
//   · el adaptador del Excel (generar-costeo.ts), última barrera para informes ya guardados;
//   · la vista de Productos (ViabilidadIAPanel.tsx, componente de cliente).
// Importarlo desde el parser metería 1.600 líneas de parsing al bundle del navegador. Sin
// dependencias a propósito: solo regex.

// Guardarraíl DETERMINISTA (código, no IA) contra filas de la tabla de CRITERIOS DE EVALUACIÓN
// coladas en el manifiesto de productos — el prompt ya lo prohíbe explícito (ver punto ⑨ del
// bloque v3.5, BLOQUE_BARRIDO_V35 más abajo), pero un guardarraíl de código no depende de que el
// modelo se acuerde cada vez. BUG REAL (14-ago-2026, caso 2345-128-LP26, pedido explícito del
// usuario: "me pone cualquier cantidad de cosas… que no son parte del costeo"): 20 de 30
// "productos" del manifiesto eran en realidad la tabla de criterios — ponderaciones ("Oferta
// Técnica" con cantidad=26, el % del criterio leído como si fuera cantidad), tramos de puntaje
// ("Entre 10 y 14" cantidad=10), rankings ("1er Lugar: Oferta con…" cantidad=6) y el texto legal
// completo de una declaración jurada de cumplimiento ("El oferente… acredita que cuenta con
// Programa de Integridad…") — todo mezclado con los 10 productos reales (chalecos, cascos, etc.)
// en el mismo manifiesto, y de ahí derecho al Excel de costeo como si fueran ítems a cotizar.
const RE_PONDERACION_CRITERIO = /^oferta\s+(t[ée]cnica|econ[óo]mica|administrativa)$/i;
const RE_TRAMO_PUNTAJE = /^(entre\s+\d+\s+y\s+\d+|\d+\s+o\s+m[áa]s|menos\s+de\s+\d+)$/i;
const RE_RANKING_LUGAR = /^\d+(er|d[oa]|t[oa]|v[oa]|m[oa])\s+lugar\b/i;
const RE_SIN_INFORMACION = /^["“]?sin\s+informaci[óo]n["”]?$/i;
// Las DOS CARAS de un criterio BINARIO: frases que describen AL OFERENTE o su conducta
// documental ("El oferente… acredita/cuenta con…" / "No presenta los antecedentes…"). La señal
// no es el LARGO sino la FORMA: un producto real es siempre una frase NOMINAL — un objeto con
// su nombre ("Chaleco balístico con funda", "Bastón retráctil") — jamás una oración con sujeto
// "el oferente" ni encabezada por un verbo conjugado de cumplimiento. Ningún producto de un
// catálogo real empieza así, por eso no hace falta acotar por largo (la primera versión de este
// filtro exigía >120 caracteres y dejaba pasar 6 de las 20 filas de criterios del caso real).
const RE_ORACION_SOBRE_EL_OFERENTE = /^(el|la|los|las)\s+(oferente|proponente|adjudicatario|postulante)s?\b/i;
const RE_VERBO_DE_CUMPLIMIENTO = /^(no\s+)?(presenta|acredita|cumple|declara|adjunta|entrega)\b/i;
const RE_NO_PRESENTA_INFO = /\bno\s+presenta\s+informaci[óo]n\b/i;

// ─── RÓTULOS DE FORMULARIO ────────────────────────────────────────────────────────────────
// BUG REAL (25-ago-2026, caso 2981-225-LE26, PDI — 165 botiquines IFAK): el manifiesto traía 16
// "productos" que eran los CAMPOS EN BLANCO de los anexos administrativos del PDF de bases
// ("Nombre:", "Domicilio:", "Teléfono:", "E-mail:", "FIRMA:", "GIRO:", "NOMBRE / RAZON SOCIAL",
// "FECHA DECLARACIÓN:") más los tramos del criterio de inclusión ("Más de 40%", "1% a 10%").
// El único producto real —el botiquín, cantidad 165— quedó sepultado: la vista de Productos
// mostraba 16 rótulos y el Excel de costeo se generaba con esas 16 filas.
//
// La señal es de FORMA, no de vocabulario: un producto es una frase NOMINAL que nombra un objeto;
// un rótulo de formulario es una etiqueta que ANUNCIA un campo a rellenar, y en castellano
// administrativo eso se escribe terminando en dos puntos. Se acota por largo (<=60) para no tocar
// una descripción real que por OCR quedara con ":" al final.
const RE_ROTULO_CON_DOSPUNTOS = /:\s*$/;
// Rótulos de identificación que aparecen SIN dos puntos (encabezado de una celda de firma o de un
// recuadro de datos del oferente). Lista cerrada de datos de la EMPRESA/PERSONA que firma —
// ninguno puede ser jamás un bien o servicio a cotizar.
const RE_ROTULO_IDENTIFICACION =
  /^(nombre(\s+(completo|del\s+(oferente|proponente|representante)))?|raz[óo]n\s+social|nombre\s*\/\s*raz[óo]n\s+social|rut|r\.u\.t\.?|c[ée]dula(\s+de\s+identidad)?|giro(\s+comercial)?|domicilio|direcci[óo]n|comuna|ciudad|regi[óo]n|tel[ée]fono|fono|celular|e\s*-?\s*mail|correo(\s+electr[óo]nico)?|firma(\s+y\s+timbre)?|timbre|fecha(\s+declaraci[óo]n)?|lugar\s+y\s+fecha|cargo|profesi[óo]n|nacionalidad|representante\s+legal)\s*$/i;
// Tramos de un criterio expresados en PORCENTAJE — la otra mitad de las filas basura del caso
// 2981-225-LE26. RE_TRAMO_PUNTAJE solo cubría tramos numéricos secos ("Entre 10 y 14").
const RE_TRAMO_PORCENTAJE =
  /^(m[áa]s\s+de|menos\s+de|hasta|sobre|bajo|desde|igual\s+o\s+(mayor|menor)\s+a)?\s*\d+([.,]\d+)?\s*%(\s*(a|y|hasta|o\s+m[áa]s|o\s+menos)\s*\d+([.,]\d+)?\s*%?)?\s*$/i;

// ¿Esta fila del manifiesto NO es un producto a cotizar? Cubre las dos familias de basura que se
// cuelan desde un PDF de bases: filas de la tabla de CRITERIOS DE EVALUACIÓN y RÓTULOS de los
// formularios/anexos administrativos. Determinista a propósito: no depende de que el LLM se
// acuerde de la instrucción del prompt.
// ─── CRITERIO CON ACRÓNIMO PEGADO ────────────────────────────────────────────────────────
// (25-ago-2026, auditoría de los 252 informes de agosto — caso 2296-45-LE26.) Las tablas de
// criterios suelen nombrar cada criterio con su sigla al lado: "OFERTA ECONÓMICA(OE)", "PLAZO DE
// ENTREGA(PE)", "COMPORTAMIENTO CONTRACTUAL ANTERIOR(CCA)", "PRESENCIA LOCAL DE PROVEEDORES(PLP)".
// RE_PONDERACION_CRITERIO no los cazaba (exige "Oferta <tipo>" a secas), así que los 4 entraron al
// manifiesto como productos — con las "cantidades" 1,2,3,4, que eran el correlativo de la tabla.
//
// El discriminador NO es "termina en paréntesis" (una marca real también: "Notebook 15\" (HP)"),
// sino que la sigla sean las INICIALES de las propias palabras de la frase. "OFERTA ECONÓMICA(OE)"
// → O,E ✓. "Notebook 15 pulgadas (HP)" → iniciales N,P ≠ HP ✗, se conserva.
// SEGUNDO CANDADO, y no es opcional. La primera versión de esta regla se conformaba con que la
// sigla fuera las iniciales de la frase, y eso borra PRODUCTOS REALES: al correrla sobre los
// documentos de las 348 licitaciones con listado aparecieron "Desfibrilador Externo Automático(DEA)"
// y "Mascara de alto flujo (MAF)" — equipamiento médico legítimo cuyas iniciales calzan igual de
// bien que las de un criterio. Borrar un producto real del costeo es PEOR que mostrar uno de más:
// el de más se ve y se saca, el que falta no se nota hasta que la oferta ya salió incompleta.
// Por eso la frase debe además hablar de EVALUACIÓN. Lista cerrada: son los nombres que usan las
// tablas de criterios, y ninguno nombra un bien.
const RE_VOCABULARIO_DE_CRITERIO =
  /\b(oferta|comportamiento\s+contractual|presencia\s+local|plazo\s+de\s+entrega|precio\s+ofertado|experiencia\s+del\s+(oferente|proponente)|criterio)\b/i;
const RE_SIGLA_FINAL = /^(.+?)\s*\(([A-ZÁÉÍÓÚÑ]{2,5})\)\s*$/;
const PALABRAS_VACIAS = new Set(['de', 'del', 'la', 'el', 'los', 'las', 'y', 'e', 'o', 'u', 'a', 'en', 'por']);
function esCriterioConSigla(d: string): boolean {
  const m = d.match(RE_SIGLA_FINAL);
  if (!m) return false;
  const iniciales = m[1]
    .split(/\s+/)
    .map(w => w.replace(/[^A-Za-zÁÉÍÓÚÑáéíóúñ]/g, ''))
    .filter(w => w && !PALABRAS_VACIAS.has(w.toLowerCase()))
    .map(w => w[0].toUpperCase())
    .join('');
  if (iniciales.length < 2 || iniciales !== m[2].toUpperCase()) return false;
  return RE_VOCABULARIO_DE_CRITERIO.test(m[1]);
}

// ─── CAMPO CON LÍNEA DE PUNTOS PARA RELLENAR ─────────────────────────────────────────────
// (25-ago-2026, caso 2409-49-LP26.) El formulario de oferta trae renglones a completar a mano:
// "PLAZO DE INSTALACION ………………DÍAS HABILES. (lunes a viernes)". Se repetía una vez por cada una
// de las 13 líneas del lote, inflando el manifiesto con 13 filas que nadie cotiza. Misma familia
// que los rótulos con dos puntos: es un espacio en blanco, no un bien.
// Se exigen 4+ puntos seguidos (o 2+ ellipsis, o 3+ guiones bajos) para no tocar una descripción
// que el OCR haya truncado con un "..." normal.
const RE_LINEA_PARA_RELLENAR = /\.{4,}|…{2,}|…\s*…|_{3,}/;

// ─── NOTA AL PIE DE LA TABLA ─────────────────────────────────────────────────────────────
// (25-ago-2026, caso 2409-49-LP26, paneles interactivos por colegio.) Debajo del cuadro de oferta
// las bases cuelgan advertencias marcadas con asterisco: "* EL PLAZO DE INSTALACIÓN NO PODRÁ SER
// SUPERIOR A 25 DÍAS HÁBILES, DE LO CONTRARIO LA OFERTA SERÁ DECLARADA FUERA DE BASES". El parser
// las lee como una fila más. El asterisco inicial ES la marca tipográfica de "esto es una nota,
// no una fila de la tabla" — por eso alcanza con mirar el primer carácter.
const RE_NOTA_AL_PIE = /^\(?\*+\)?\s*\S/;

// ─── RÓTULO COMPUESTO ────────────────────────────────────────────────────────────────────
// Mismo caso: "Nombre Oferente o Representante Legal" es el pie de firma del formulario. No lo
// cazaba RE_ROTULO_IDENTIFICACION, que es una lista de rótulos EXACTOS y no cubre las infinitas
// combinaciones ("Nombre y firma del proponente", "RUT y razón social", "Firma Representante
// Legal"). En vez de seguir alargando esa lista, se invierte la pregunta: ¿la frase está hecha
// SOLO de palabras que nombran datos del que firma? Si sí, es un rótulo. Un producto siempre
// aporta al menos una palabra de fuera de este vocabulario ("Panel", "Monitor", "Cemento").
const PALABRAS_DE_ROTULO = new Set([
  'nombre', 'nombres', 'apellido', 'apellidos', 'completo', 'completa',
  'oferente', 'oferentes', 'proponente', 'proponentes', 'adjudicatario', 'postulante',
  'representante', 'legal', 'firma', 'firmas', 'timbre', 'rut', 'run', 'cedula', 'identidad',
  'razon', 'social', 'giro', 'comercial', 'empresa', 'contacto',
  'domicilio', 'direccion', 'comuna', 'ciudad', 'region', 'pais',
  'telefono', 'fono', 'celular', 'email', 'mail', 'correo', 'electronico',
  'cargo', 'profesion', 'nacionalidad', 'fecha', 'lugar', 'declaracion',
]);
const CONECTORES_DE_ROTULO = new Set(['de', 'del', 'la', 'el', 'los', 'las', 'y', 'e', 'o', 'u', 'a', 'en', 'para']);
function esRotuloCompuesto(d: string): boolean {
  if (d.length > 60) return false;
  const palabras = d.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    .split(/[^a-z0-9]+/).filter(Boolean);
  if (palabras.length < 2 || palabras.length > 7) return false;
  let deRotulo = 0;
  for (const w of palabras) {
    if (CONECTORES_DE_ROTULO.has(w)) continue;
    if (!PALABRAS_DE_ROTULO.has(w)) return false;  // una palabra de fuera basta para salvarla
    deRotulo++;
  }
  return deRotulo >= 2;
}

export function esFilaNoProducto(descripcion: string): boolean {
  const d = (descripcion || '').trim();
  if (!d) return false;
  if (RE_PONDERACION_CRITERIO.test(d) || RE_TRAMO_PUNTAJE.test(d) || RE_RANKING_LUGAR.test(d) || RE_SIN_INFORMACION.test(d)) return true;
  if (RE_ORACION_SOBRE_EL_OFERENTE.test(d) || RE_VERBO_DE_CUMPLIMIENTO.test(d) || RE_NO_PRESENTA_INFO.test(d)) return true;
  if (RE_TRAMO_PORCENTAJE.test(d)) return true;
  if (RE_LINEA_PARA_RELLENAR.test(d)) return true;
  if (esCriterioConSigla(d)) return true;
  if (RE_NOTA_AL_PIE.test(d)) return true;
  if (esRotuloCompuesto(d)) return true;
  if (d.length <= 60 && (RE_ROTULO_CON_DOSPUNTOS.test(d) || RE_ROTULO_IDENTIFICACION.test(d))) return true;
  return false;
}
/** @deprecated nombre histórico — el filtro ya no cubre solo criterios. Usar esFilaNoProducto. */
export const esFilaDeCriterioNoProducto = esFilaNoProducto;
