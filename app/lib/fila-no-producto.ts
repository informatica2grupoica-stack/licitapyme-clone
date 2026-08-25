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
export function esFilaNoProducto(descripcion: string): boolean {
  const d = (descripcion || '').trim();
  if (!d) return false;
  if (RE_PONDERACION_CRITERIO.test(d) || RE_TRAMO_PUNTAJE.test(d) || RE_RANKING_LUGAR.test(d) || RE_SIN_INFORMACION.test(d)) return true;
  if (RE_ORACION_SOBRE_EL_OFERENTE.test(d) || RE_VERBO_DE_CUMPLIMIENTO.test(d) || RE_NO_PRESENTA_INFO.test(d)) return true;
  if (RE_TRAMO_PORCENTAJE.test(d)) return true;
  if (d.length <= 60 && (RE_ROTULO_CON_DOSPUNTOS.test(d) || RE_ROTULO_IDENTIFICACION.test(d))) return true;
  return false;
}
/** @deprecated nombre histórico — el filtro ya no cubre solo criterios. Usar esFilaNoProducto. */
export const esFilaDeCriterioNoProducto = esFilaNoProducto;
