// app/lib/anexos-determinista.ts
// Motor DETERMINISTA de relleno de anexos administrativos: etiqueta → campo de la ficha, sin IA.
//
// POR QUÉ EXISTE (decisión del usuario, 17-ago-2026: "sacar 100% la IA y hacerlo con código"):
// el tramo que la IA hacía —etiqueta → nombre de campo— es una tabla de equivalencias, no un
// juicio. Medido sobre el banco de documentos reales: de 111 casillas automáticas, casi todas son
// mapeo directo ("NOMBRE REPRESENTANTE LEGAL" → representante_nombre). Dejarlo en un prompt tenía
// tres costos concretos que este archivo elimina:
//   1. Un 429 del proveedor se veía en la UI como "el motor no supo" (fallo silencioso).
//   2. Tocar una regla del prompt movía otras: dos ediciones en un día produjeron una regresión
//      verificada (el "NOMBRE" pelado del Anexo N°5 pasó de la persona a la razón social).
//   3. No se podía testear. El prompt no tiene un solo test que lo ejercite — por eso esas dos
//      regresiones pasaron los 227 tests sin despeinarse. Cada regla de acá SÍ tiene test.
//
// LO QUE NO HACE: no detecta dónde hay una casilla (eso ya es determinista y vive en
// anexos-detectar.ts: secciones PN/PJ/UTP, líneas de firma, tripletes de fecha, alternativas
// excluyentes) y no escribe el .docx (anexos-docx.ts). Solo decide QUÉ CAMPO va en cada casilla
// ya detectada.
//
// LÍMITE HONESTO: lo que NO sale de la ficha de empresa sigue sin salir de acá — precios y
// cantidades (los resuelve anexos-precios-ia.ts contra el costeo), especificaciones técnicas (las
// bases), experiencia contra órdenes de compra, y los anexos escaneados (imagen). Este módulo
// cubre el anexo ADMINISTRATIVO, que es donde estaba el 100% del trabajo repetitivo.
import type { CandidatoCelda, CandidatoInline } from '@/app/lib/anexos-detectar';
import type { Parrafo } from '@/app/lib/anexos-docx';
import type { EmpresaCampos, Resolucion, CategoriaCampo } from '@/app/lib/anexos-ia-motor';

type Campo = keyof EmpresaCampos;

export interface EntradaDeterminista {
  candidatos: CandidatoCelda[];
  blancosInline: CandidatoInline[];
  parrafos: Parrafo[];
  empresa: EmpresaCampos;
  /**
   * Correcciones que el experto ya hizo con el lápiz de la pantalla, traducidas a (etiqueta →
   * campo de la ficha) — ver anexos-feedback.ts. Se aplican por ENCIMA del diccionario: si el
   * equipo corrigió una etiqueta a mano, esa decisión manda sobre la regla general.
   *
   * Antes del 28-ago-2026 estas correcciones solo existían como texto dentro de un prompt que está
   * apagado por defecto, así que no cambiaban ningún anexo. Acá sí: mismo guardarraíl de siempre,
   * el valor sale de `empresa[campo]` y nunca del texto que se guardó (que es de otra empresa).
   */
  overridesAprendidos?: { etiqueta: string; campo: string }[];
}

export interface ResultadoDeterminista {
  celda: Map<number, Resolucion>;
  inline: Map<string, Resolucion>;
  /** Lo que el diccionario no cubrió — va al respaldo IA si está habilitado, si no, al humano. */
  celdaSinResolver: CandidatoCelda[];
  inlineSinResolver: CandidatoInline[];
  /**
   * Campos de la ficha de la empresa que ESTE documento pide y que están vacíos. Es la lista de
   * "llena esto UNA vez y el anexo sale completo a la primera" — la única forma de arreglarlo
   * ANTES de generar en vez de descubrir el hueco al abrir el .docx. `campo` → etiqueta donde se
   * pidió (la primera, para poder mostrar de dónde salió).
   */
  faltantesFicha: { campo: string; nombre: string; etiqueta: string; origen: 'ficha' | 'licitacion' }[];
}

// ── Normalización ────────────────────────────────────────────────────────────────────────────
// Una misma pregunta viene escrita de N formas en anexos de distintos organismos ("R.U.T.",
// "RUT:", "Rut del oferente", "R U T"). Todo lo que sigue compara SOBRE el texto normalizado.
// BUG REAL (18-ago-2026, caso "Formatos Esmaltes", La Serena): el paréntesis se usa de las DOS
// formas opuestas y el limpiador de abajo solo contemplaba una. Como ACOTACIÓN de una etiqueta que
// ya existe ("Nombre (si correspondiere)") hay que borrarlo — es lo que hace `.replace(/\(.*?\)/g)`.
// Pero cuando el organismo NO escribe etiqueta y deja SOLO el paréntesis como marcador de qué va
// ahí — "(Razón social empresa)", "(Rut de Empresa)", "(Rut representante legal)" — borrarlo deja
// la etiqueta VACÍA: el diccionario no matchea nada y la casilla queda pendiente, aunque el
// documento dijera literalmente el nombre del campo. Se distingue sin ambigüedad por la forma: si
// el paréntesis envuelve TODO el texto, es el marcador y su contenido ES la etiqueta; si hay texto
// afuera, es una acotación y se descarta como siempre.
function sinParentesisEnvolvente(s: string): string {
  // [\s\S] en vez del flag /s (dotAll): el target del proyecto es ES2017 y ahí ese flag no existe.
  const m = s.trim().match(/^\(([\s\S]+)\)$/);
  return m ? m[1] : s;
}

// El organismo aclara al final de la etiqueta PARA QUÉ TIPO DE OFERENTE sirve la casilla, porque
// la misma casilla sirve para los dos: "Razón social o nombre persona natural" (2724-35-LP26,
// ANEXO N°1), "RUT persona natural o jurídica", "…o persona natural según corresponda"
// (1247197-54-LE26). Eso NO cambia QUÉ dato se pide — solo dice a quién describe — así que se
// saca antes de comparar contra el diccionario: sin esto, "Razón social o nombre persona natural"
// no matcheaba ninguna entrada de `razon_social` y la etiqueta más básica que existe (la primera
// fila de toda tabla de identificación) quedaba pendiente. Mismo criterio que ya aplica
// REGLAS_MARCADOR con "o persona natural según corresponda": el QUÉ manda, el DE QUIÉN no.
const RE_TIPO_DE_PERSONA_AL_FINAL =
  /\s*(?:o\s+|de\s+la\s+|de\s+|para\s+)?personas?\s+(?:natural(?:es)?|juridicas?)(?:\s*(?:o|y|\/)\s*(?:personas?\s+)?(?:natural(?:es)?|juridicas?))?(?:\s+segun\s+corresponda)?$/;

// Ver el uso en normalizarEtiqueta: son las etiquetas que quedan SIN SENTIDO si se les saca el
// remate "persona natural/jurídica", porque preguntan justamente por esa clasificación.
const PALABRAS_QUE_NECESITAN_EL_REMATE = new Set(['tipo', 'naturaleza', 'calidad', 'clase', 'condicion', 'categoria']);

export function normalizarEtiqueta(s: string): string {
  return sinParentesisEnvolvente(s || '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')   // sin tildes
    .toLowerCase()
    .replace(/\(.*?\)/g, ' ')                            // "(si correspondiere)", "(en palabras)"
    // Numeración de lista al inicio ("3. DIRECCIÓN", "a) Giro", "- Comuna"). El espacio final es
    // OBLIGATORIO: sin él, "R.U.T." se leía como la viñeta "r." seguida de "U.T." y la etiqueta
    // más común del país quedaba en "u t", sin matchear nada (lo cazó el test de los remates).
    // `[.)-]+` (uno o más), no uno solo: medido contra 1738-18-LE26, donde las OCHO casillas de la
    // tabla de identificación vienen numeradas "1.- NOMBRE COMPLETO DEL PROPONENTE…". Con un solo
    // signo, "1." se comía y quedaba "- nombre completo…", que no matcheaba nada: el anexo más
    // típico que existe se resolvía en 0 casillas.
    // La viñeta de LETRA acepta la misma puntuación compuesta que la de número ("A.- RAZÓN
    // SOCIAL DEL PROPONENTE", "B.- NOMBRE DEL REPRESENTANTE LEGAL" — caso real 2296-48-LE26,
    // FORMATO Nº2): antes solo se aceptaba UN signo ("a)" / "a."), así que "a.-" no se quitaba y
    // la etiqueta quedaba como "a - razon social del proponente", sin matchear nada. El espacio
    // final obligatorio sigue protegiendo "R.U.T." igual que en la viñeta de número: ahí no hay
    // espacio entre la "r." y la "U", así que nunca se confunde con una viñeta.
    .replace(/^\s*(?:\d+\s*[.)-]+|[a-z]\s*[.)-]+|[-•*])\s+/, ' ')
    .replace(/[.:;,_·"'“”]+/g, ' ')                      // puntuación y rayas de relleno
    .replace(/\s+/g, ' ')
    .trim()
    .replace(RE_TIPO_DE_PERSONA_AL_FINAL, (coincidencia, ...resto) => {
      // Solo se saca si queda etiqueta después: "PERSONA NATURAL" pelada NO es una casilla con
      // aclaración, es el título de un bloque (lo maneja detectarSecciones, no este diccionario).
      const antes = String(resto[resto.length - 1]).slice(0, resto[resto.length - 2] as number).trim();
      if (!antes) return coincidencia;
      // BUG REAL (auditoría 28-ago-2026, medido en 11 licitaciones de 700 documentos): en
      // "TIPO DE PERSONA JURÍDICA" el remate NO es una aclaración de a quién describe la casilla —
      // ES el dato que se pide. Sacarlo dejaba la etiqueta en "tipo", que no calza con nada, y la
      // entrada del diccionario para `tipo_persona_juridica` (/^tipo de (persona|sociedad|empresa)…/)
      // era código MUERTO: no había forma de que se ejecutara. La señal que los separa es lo que
      // queda antes: una palabra que solo describe UNA CLASIFICACIÓN ("tipo", "naturaleza",
      // "calidad") no es el nombre de ningún dato por sí sola, así que ahí el remate se conserva.
      // En cambio "Razón social o nombre persona natural" o "RUT persona natural" sí dejan el
      // nombre de un dato ("razon social o nombre", "rut") y siguen limpiándose como hasta ahora.
      return PALABRAS_QUE_NECESITAN_EL_REMATE.has(antes) ? coincidencia : '';
    })
    .trim();
}

const CATEGORIA_DE_CAMPO = (campo: Campo): CategoriaCampo => {
  if (String(campo).startsWith('representante_')) return 'perfil_representante_legal';
  if (String(campo).startsWith('banco_')) return 'perfil_bancario';
  if (String(campo).startsWith('licitacion_')) return 'datos_licitacion';
  return 'perfil_empresa';
};

// ── CAPA 1 — Diccionario de etiquetas INEQUÍVOCAS ────────────────────────────────────────────
// Doctrina heredada del anexos-diccionario.ts original (borrado en 43c1898) y que se conserva a
// propósito: solo entran las etiquetas que, tal cual vienen escritas, YA dicen a QUIÉN describen.
// "Nombre", "RUT" o "Cargo" a secas NO están acá — los resuelve la capa 2 mirando el bloque. Un
// diccionario que adivina la segunda aparición de "Nombre" es peor que no tener diccionario.
//
// Sufijo opcional "del oferente / de la empresa / del proponente": la MISMA pregunta viene con
// cualquiera de esos remates según el organismo. Sin él, "RUT DEL OFERENTE:" no matcheaba nada.
const OFERENTE = '(?:\\s+(?:del?\\s+|de\\s+la\\s+)?(?:empresa|oferente|proponente|participante|postulante|contribuyente|prestador|proveedor))?';
// "representate" (sin la "n") es un error de tipeo REAL y frecuente en los pliegos — visto en
// "Formatos Esmaltes" (La Serena) como "(representate legal)". La casilla dice exactamente de quién
// es el dato; perderla por una letra sería absurdo. La "n" opcional no introduce ninguna
// ambigüedad: no existe otra palabra del dominio que se escriba "representate".
const REPRE = '(?:\\s+(?:del?\\s+|de\\s+la\\s+)?(?:representan?te(?:\\s+legal)?|apoderado|declarante|firmante|suscriptor))';

// Sufijos que NO cambian QUÉ dato se pide, solo cómo el organismo lo rotula. Se aplican al teléfono
// y al correo, nunca al nombre ni al RUT.
//  · "principal y alternativo" / "principal" / "alternativo": el ANEXO N°2 de 1247197-54-LE26 pide
//    "Teléfono principal y alternativo:" y "Correo electrónico principal y alternativo:" en UNA sola
//    casilla. Regla del usuario (18-ago-2026): la empresa usa el MISMO teléfono y el MISMO correo
//    para todo, así que principal y alternativo son el mismo dato.
//  · El remate de REPRESENTANTE: por la misma regla, el teléfono y el correo del representante son
//    los de la empresa. Por eso estos dos campos aceptan el remate de OFERENTE **y** el de REPRE, a
//    diferencia del nombre o el RUT, donde sí son personas distintas y confundirlas es un error.
const PRINCIPAL_ALT = '(?:\\s+(?:principal(?:es)?|alternativos?|secundarios?)(?:\\s+y\\s+(?:el\\s+)?(?:alternativos?|secundarios?|principal(?:es)?))?)?';
const CONTACTO = `(?:${OFERENTE}|${REPRE})?`;

interface Entrada { campo: Campo; patrones: RegExp[] }

const DICCIONARIO: Entrada[] = [
  // ── Empresa ──
  { campo: 'razon_social', patrones: [
    new RegExp(`^razon\\s+social${OFERENTE}$`),
    new RegExp(`^nombre\\s+(?:completo\\s+)?o\\s+razon\\s+social${OFERENTE}$`),
    new RegExp(`^razon\\s+social\\s+o\\s+nombre(?:\\s+completo)?${OFERENTE}$`),
    new RegExp(`^nombre\\s+(?:completo\\s+)?(?:del?\\s+|de\\s+la\\s+)(?:empresa|oferente|proponente|participante|postulante|sociedad|entidad|institucion|firma)$`),
    /^nombre (?:completo )?(?:del? (?:proponente|oferente)) o razon social$/,
    /^(?:identificacion|individualizacion) del (?:oferente|proponente|contribuyente)$/,
    /^empresa$/, /^empresa oferente$/, /^nombre de fantasia$/,
    // "Mi representada ______" / "Mi representada es ______" — fórmula estándar con la que el
    // representante legal nombra a SU empresa en una declaración jurada. Medida por la auditoría
    // del 28-ago-2026 en 20 licitaciones de organismos distintos (24 casillas), todas quedando en
    // blanco. Es inequívoca: "mi representada" solo puede ser la empresa que se representa, nunca
    // una persona (para eso los anexos dicen "mi representante" o "el suscrito").
    /^mi representada$/, /^mi representada es$/, /^la empresa que represento$/,
    // "NOMBRE OFERENTE O RAZÓN SOCIAL:" (caso real 2296-48-LE26, FORMATOS Nº3/Nº4/Nº6 — la
    // etiqueta más repetida de ese pliego): el patrón de arriba exige "nombre O razon social"
    // seguidos, sin nada en medio; acá el organismo intercala a QUIÉN se refiere. Es la misma
    // pregunta, no una distinta.
    /^nombre (?:completo )?(?:del? |de la )?(?:empresa|oferente|proponente|participante|postulante|proveedor) o razon social$/,
    // La palabra sola, sin "nombre" ni "razón social" delante ("PROPONENTE:…………", 2296-48-LE26
    // FORMATO Nº1-A/Nº1-B). Es INEQUÍVOCA en el sentido de esta capa: ya dice a quién describe
    // (al oferente, no a la persona que firma) — no es un "Nombre" pelado, que sí es ambiguo y
    // por eso se resuelve por bloque en la capa 2.
    /^(?:oferente|proponente|postulante|participante|contratista)$/,
    // "NOMBRE EMPRESA" / "NOMBRE PROVEEDOR" — sin el "de la" que exige el patrón de arriba
    // (evidencia de anexos reales ya presentados).
    /^nombre (?:empresa|sociedad|oferente|proponente|proveedor|contratista)$/,
    // El organismo ofrece DOS palabras separadas por barra para cubrir los dos tipos de oferente:
    // "NOMBRE PROVEEDOR / EMPRESA" (ANEXO N°5 de 1057480-41-LP26). Es una sola casilla y el dato
    // es el mismo: la razón social. Se acepta la barra con o sin espacios alrededor.
    /^nombre (?:del? |de la )?(?:proveedor|empresa|oferente|proponente|contratista|razon social)\s*\/\s*(?:proveedor|empresa|oferente|proponente|contratista|razon social)$/,
    // "Nombre del proveedor postulante A LA LICITACIÓN" (1786987035022_ANEXO_N2.docx) — el
    // sufijo OFERENTE exige que la frase TERMINE en la palabra que dice a quién describe; acá
    // sigue "a la licitación/a este proceso" después, y por eso no calzaba con nada de arriba.
    new RegExp(`^nombre\\s+del?\\s+(?:proveedor|oferente|proponente|participante|postulante)(?:\\s+postulante)?\\s+a\\s+(?:la\\s+licitacion|este\\s+proceso|esta\\s+propuesta)$`),
  ] },
  { campo: 'rut', patrones: [
    new RegExp(`^r\\s*u\\s*t${OFERENTE}$`),
    new RegExp(`^rol\\s+unico\\s+tributario${OFERENTE}$`),
    /^rut (?:de la )?(?:empresa|sociedad|entidad|razon social)$/,
    // "R.U.T. N°:" (1058086-43-LP26) — tras normalizar queda "r u t n°", con el signo de grado
    // intacto a propósito (ver normalizarEtiqueta: quitarlo confundiría "N°" con "No").
    /^r\s*u\s*t\s*(?:n[°º]?)?$/, /^rut\/run$/,
    // "RUT o C.I:" (2296-48-LE26, FORMATO Nº1-A/Nº1-B) — el organismo ofrece las dos formas en la
    // MISMA casilla porque el oferente puede ser empresa o persona natural. Para nosotros
    // (persona jurídica) es el RUT de la empresa; el RUT del representante tiene su propia
    // casilla más abajo en ese mismo formulario, así que no hay colisión.
    /^r\s*u\s*t\s*o\s*c\s*i$/, /^rut o cedula(?: de identidad)?$/,
    // Mismas dos formas al revés y con la cédula escrita completa (FORMULARIO N°1 de
    // 1063538-204-LE26: "RUT o Cédula de Identidad" en el bloque de datos del oferente).
    //
    // BUG REAL (27-ago-2026, 611669-17-LE26, ANEXO N°1-A): "N° DE RUT O CÉDULA DE IDENTIDAD"
    // quedaba pendiente pese a que el RUT de la empresa ya estaba en la ficha. El "N°" de acá NO
    // va pegado a "RUT" — el organismo escribe "N° DE RUT", con un "DE" en el medio ("N° de
    // fojas", "N° de folio" es la misma construcción en otros documentos chilenos) — y el patrón
    // solo aceptaba `(?:n[°º]?\s*)?` seguido DIRECTO de "rut"/"cedula", sin ese "de" opcional.
    // Verificado contra la etiqueta real tal cual la normaliza normalizarEtiqueta().
    /^(?:n[°º]?\s*(?:de\s+)?)?cedula de identidad o rut$/, /^c\s*i\s*o\s*r\s*u\s*t$/,
    /^(?:n[°º]?\s*(?:de\s+)?)?rut o cedula de identidad$/,
    /^rut\/cedula(?: de identidad)?$/, /^cedula(?: de identidad)?\/rut$/,
  ] },
  { campo: 'giro', patrones: [
    new RegExp(`^giro(?:\\s+(?:comercial|del\\s+negocio|o\\s+actividad))?${OFERENTE}$`),
    /^actividad (?:economica|comercial)$/, /^rubro$/,
    // "GIRO SII:" / "GIRO SERVICIOS DE IMPUESTOS INTERNOS:" (2296-48-LE26) — el organismo aclara
    // de dónde sale el giro (el registrado en el SII), que es exactamente el que guarda la ficha.
    /^giro s\s*i\s*i$/, /^giro servicios de impuestos internos$/,
    // "PROFESIÓN, OFICIO O GIRO" — evidencia de anexos REALES ya presentados (banco de plantillas
    // del usuario, 18-ago-2026): el organismo ofrece las tres palabras porque el oferente puede ser
    // persona natural; para una empresa el dato es el giro, que es lo que el humano escribió ahí.
    /^profesion,? oficio o giro$/, /^giro,? profesion u oficio$/,
  ] },
  { campo: 'direccion', patrones: [
    new RegExp(`^(?:direccion|domicilio)(?:\\s+(?:comercial|legal|particular|de\\s+la\\s+empresa))?${OFERENTE}$`),
    /^direccion completa$/, /^domicilio (?:para efectos de )?(?:esta )?(?:licitacion|propuesta)$/,
    // Evidencia de anexos reales ya presentados: el humano escribe la dirección completa (con la
    // comuna dentro) en una sola casilla cuando la etiqueta pide las dos cosas juntas.
    /^(?:direccion|domicilio) y comuna$/, /^comuna y (?:direccion|domicilio)$/,
    /^domicilio comercial(?: que acredita| declarado)?$/,
  ] },
  { campo: 'direccion_calle', patrones: [/^calle(?: y numero)?$/, /^nombre de (?:la )?calle$/, /^avenida\/calle$/] },
  // "DPTO./OF:" — la cuarta columna del domicilio partido ("Calle | N° | DPTO./OF. | Comuna"),
  // medida en 3 licitaciones por el auditor del 31-ago-2026. Ver oficinaDeDireccion en
  // anexos-derivados.ts: si la dirección de la ficha no trae marca de oficina, el campo llega
  // vacío y la casilla queda pendiente (aviso accionable), nunca con el número de la calle.
  { campo: 'direccion_oficina' as Campo, patrones: [
    /^(?:dpto|depto|departamento)\s*\/\s*(?:of|ofic|oficina)$/, /^(?:of|ofic|oficina)\s*\/\s*(?:dpto|depto|departamento)$/,
    /^oficina$/, /^(?:dpto|depto|departamento)$/, /^of$/, /^n[°º]?\s*(?:de\s+)?oficina$/,
  ] },
  { campo: 'direccion_numero', patrones: [/^n[°º]$/, /^numero$/, /^nro$/, /^numero de (?:la )?(?:calle|direccion|domicilio)$/] },
  { campo: 'comuna', patrones: [/^comuna$/, new RegExp(`^comuna${OFERENTE}$`)] },
  { campo: 'ciudad', patrones: [/^ciudad$/, new RegExp(`^ciudad${OFERENTE}$`), /^localidad$/] },
  // REGRESIÓN 2928-17-LE26: "Comuna y región" (orden invertido de "región y comuna", que ya
  // estaba cubierto) quedaba sin diccionario — misma casilla combinada, mismo campo.
  { campo: 'region', patrones: [/^region$/, /^region y comuna$/, /^comuna y region$/, /^ciudad y region$/, /^region\/comuna$/] },
  { campo: 'telefono1', patrones: [
    new RegExp(`^(?:telefono|fono|celular|movil)(?:s)?(?:\\s+(?:de\\s+contacto|comercial|fijo))?${PRINCIPAL_ALT}${CONTACTO}${PRINCIPAL_ALT}$`),
    /^telefono\/celular$/, /^fono contacto$/, /^numero de (?:telefono|contacto)$/,
    /^n[°º]? de telefono$/,
    // "TELÉFONO FIJO Y CELULAR" — una sola casilla para las dos formas (anexos reales presentados).
    /^telefono fijo y celular$/, /^telefono(?: fijo)?\/celular$/, /^fono fijo y movil$/,
    // "Teléfono (Anexo) / Fax" (FORMULARIO N°1 de 1063538-204-LE26): el fax ya no existe, pero
    // el organismo lo sigue imprimiendo junto al teléfono en la misma casilla. El dato que se
    // escribe ahí es el teléfono. Una casilla de FAX SOLA sigue quedando pendiente: no tenemos fax.
    /^telefono\s*\/?\s*fax$/, /^fono\s*\/?\s*fax$/,
    // "N° teléfono" — el "N°" va PEGADO al dato, sin el "de" que sí exige `n[°º]? de telefono`
    // de arriba (misma construcción que "N° DE RUT" vs "N° RUT"). Medido por el auditor de
    // generalización del 31-ago-2026 en 3 licitaciones de organismos distintos.
    /^n[°º]?\s*telefono$/, /^n[°º]?\s*(?:de\s+)?fono$/,
  ] },
  { campo: 'email1', patrones: [
    // El GUION cuenta como separador ("E-mail", de las etiquetas más frecuentes que existe).
    // normalizarEtiqueta conserva el guion a propósito (lo necesita el sufijo de letra tipo
    // "N°1-A"), así que "e-mail" llegaba con el guion intacto y `e\s*mail` —que solo acepta espacio
    // o nada— no lo reconocía: el correo quedaba en blanco en cualquier anexo que lo rotule así.
    new RegExp(`^(?:correo|correo\\s+electronico|e[\\s-]*mail|mail|casilla\\s+electronica)(?:\\s+de\\s+contacto)?${PRINCIPAL_ALT}${CONTACTO}${PRINCIPAL_ALT}$`),
    /^correo electronico para (?:notificaciones|efectos de (?:esta )?licitacion)$/,
  ] },
  // "FECHA:" suelta (un solo blanco, no un triplete día/mes/año — esos ya los resuelve entero
  // detectarTripletesFecha antes de llegar acá) → fecha larga con la que se firma la oferta.
  { campo: 'fecha_hoy', patrones: [/^fecha$/, /^fecha de (?:la )?(?:oferta|presentacion|propuesta|declaracion)$/] },
  { campo: 'tipo_persona_juridica', patrones: [/^tipo de (?:persona|sociedad|empresa)(?: juridica)?$/, /^naturaleza juridica$/] },
  // NACIONALIDAD: politica fija de la empresa ("Chilena") — ver NACIONALIDAD_POR_DEFECTO en
  // anexos-derivados.ts. Medida por el auditor del 28-ago-2026 en 21 licitaciones, siempre en
  // blanco. Es inequivoca: en un anexo de oferente la nacionalidad que se pide es la nuestra.
  { campo: 'nacionalidad' as Campo, patrones: [
    /^nacionalidad$/, /^nacionalidad del? (?:oferente|proponente|representante(?: legal)?|declarante|empresa|suscrito)$/,
    /^pais de origen$/,
  ] },

  // ── Constitución ──
  // "Fecha de constitución" (auditor de generalización 31-ago-2026, 4 licitaciones): el dato que se
  // escribe ahí es la FECHA sola, que es exactamente `fecha_escritura` ("20 de Agosto de 2018").
  // NO es `fecha_sociedad`, que en la ficha es el párrafo descriptivo completo (fecha + tipo de
  // sociedad + notaría) y en una casilla de fecha saldría desbordado.
  { campo: 'fecha_escritura', patrones: [
    /^fecha (?:de (?:la )?)?escritura(?: publica)?(?: de constitucion)?$/,
    /^fecha de constitucion(?: de la (?:empresa|sociedad))?$/, /^fecha de la constitucion$/,
  ] },
  { campo: 'fecha_sociedad', patrones: [/^(?:datos de )?(?:la )?constitucion(?: de la sociedad)?$/, /^antecedentes de constitucion$/] },
  { campo: 'notaria', patrones: [/^notaria$/, /^notario$/, /^notaria (?:en que se firmo|de)$/] },
  { campo: 'numero_repertorio', patrones: [/^(?:numero de )?repertorio(?: n[°º]?)?$/] },
  { campo: 'fojas_numero_anio', patrones: [/^fojas(?: numero)?(?: anio)?$/, /^inscripcion (?:de )?(?:fojas|comercio)$/] },

  // ── Representante legal ──
  { campo: 'representante_nombre', patrones: [
    new RegExp(`^nombre(?:\\s+completo)?${REPRE}$`),
    new RegExp(`^(?:representan?te\\s+legal|apoderado)$`),
    /^nombre y apellidos? del representante(?: legal)?$/,
    /^(?:identificacion|individualizacion) del (?:representante(?: legal)?|apoderado)$/,
    /^representante legal de la empresa$/, /^nombre del firmante$/, /^quien suscribe$/,
    // "Nombre Contacto" / "Persona de contacto" (auditor 31-ago-2026, 3 licitaciones). Regla ya
    // documentada del usuario (ver CAMPOS_DE_LA_MISMA_PERSONA_Y_EMPRESA en anexos-ia-motor.ts):
    // en esta operación el oferente, el representante legal y el contacto son SIEMPRE la misma
    // persona. Ojo: "Contacto" A SECAS queda FUERA a propósito — no dice si pide nombre, teléfono
    // o correo, y adivinar ahí es exactamente lo que la capa 1 no debe hacer.
    /^nombre (?:del? )?contacto$/, /^persona de contacto$/, /^nombre de la persona de contacto$/,
    /^nombre y apellidos? del? contacto$/, /^contacto (?:comercial )?nombre$/,
  ] },
  { campo: 'representante_nombres', patrones: [/^nombres$/, /^nombres? de pila$/] },
  { campo: 'representante_apellidos', patrones: [/^apellidos$/, /^apellido paterno y materno$/] },
  { campo: 'representante_rut', patrones: [
    new RegExp(`^(?:rut|r\\s*u\\s*t|run|cedula(?:\\s+de\\s+identidad)?|c\\s*i)${REPRE}$`),
    /^cedula de identidad(?: n[°º]?)?$/, /^c i n[°º]?$/, /^run$/, /^numero de (?:cedula|run)$/,
    /^rut representante$/, /^(?:n[°º]?\s*(?:de\s+)?)?cedula (?:nacional )?de identidad(?: nacional)?$/,
    // "RUT Socio" → el RUT del representante legal, porque por política de la empresa el socio
    // único ES el representante legal (mismo criterio que socio_nombre/socio_participacion, ya
    // documentado en el instructivo interno y en el prompt de anexos-ia-motor.ts). No se crea un
    // campo `socio_rut`: es literalmente el mismo dato.
    // Ojo: esto resuelve la etiqueta de UN socio. Una GRILLA numerada de socios ("1 — Rut Socio",
    // "2 — Rut Socio"…) la ataja esFilaDeSocioPosterior más abajo, que bloquea todas menos la
    // fila 1 — si no, el mismo RUT se repetiría en las 12 filas.
    /^rut (?:del? )?(?:socio|accionista)(?:\/accionista)?$/, /^rut socio\/accionista$/,
  ] },
  // La PROFESIÓN u OFICIO no es el CARGO: un anexo puede pedir las dos en el mismo bloque
  // ("Cargo: Gerente" / "Profesión u oficio: Empresaria"). Ver migration-69.
  { campo: 'representante_profesion' as Campo, patrones: [
    new RegExp(`^(?:profesion|oficio|profesion u oficio|profesion o oficio)${REPRE}$`),
    /^profesion$/, /^oficio$/, /^profesion u oficio$/, /^profesion o oficio$/,
    /^titulo profesional$/, /^actividad o profesion$/,
  ] },
  { campo: 'representante_cargo', patrones: [
    new RegExp(`^cargo${REPRE}$`),
    /^cargo(?: o funcion| que desempena| en la empresa)?$/, /^calidad en que comparece$/,
  ] },

  // ── Bancario ──
  { campo: 'banco_nombre', patrones: [/^(?:nombre del )?banco$/, /^institucion (?:bancaria|financiera)$/] },
  { campo: 'banco_tipo_cuenta', patrones: [/^tipo de cuenta$/, /^cuenta (?:corriente\/vista|tipo)$/] },
  { campo: 'banco_numero', patrones: [/^n[°º] de cuenta$/, /^numero de cuenta$/, /^cuenta n[°º]?$/, /^cuenta bancaria$/] },
  { campo: 'banco_email', patrones: [/^correo(?: electronico)? para (?:pagos|aviso de pago|transferencias)$/] },
  { campo: 'banco_titular_nombre', patrones: [/^(?:nombre del )?titular(?: de la cuenta)?$/] },
  { campo: 'banco_titular_rut', patrones: [/^rut del titular(?: de la cuenta)?$/] },

  // ── CAPA 4 — Datos de ESTA licitación (vienen de la API de MP, nunca de un juicio) ──
  { campo: 'licitacion_codigo', patrones: [
    /^(?:id|codigo|n[°º]|numero)(?: de(?: la)?)? (?:licitacion|adquisicion|proceso|propuesta)(?: publica)?$/,
    /^id(?: de)? mercado publico$/, /^licitacion (?:id|n[°º]|numero)$/, /^id$/,
  ] },
  { campo: 'licitacion_nombre', patrones: [
    /^nombre(?: de(?: la)?)? licitacion(?: publica)?$/, /^licitacion publica$/,
    /^nombre del (?:proceso|proyecto|servicio licitado)$/, /^denominacion de la licitacion$/,
  ] },
  { campo: 'licitacion_organismo', patrones: [
    /^(?:nombre del )?organismo(?: comprador| licitante| demandante)?$/,
    /^(?:entidad|institucion|servicio|municipalidad) licitante$/, /^mandante$/, /^comprador$/,
  ] },
  { campo: 'licitacion_organismo_rut', patrones: [/^rut del? (?:organismo|entidad|institucion|mandante)(?: licitante| comprador)?$/] },
  { campo: 'licitacion_unidad_compradora', patrones: [/^unidad(?: de)? compra(?:dora)?$/] },

  // ── CAPA 6 — Reglas fijas de política de la empresa ──
  { campo: 'socio_nombre', patrones: [/^nombre (?:del )?(?:socio|accionista)(?:\/accionista)?$/, /^socio\/accionista$/, /^socios? o accionistas?$/] },
  { campo: 'socio_participacion', patrones: [
    /^porcentaje de (?:derechos|participacion)(?: o participacion)?$/, /^% de (?:participacion|derechos)$/,
    /^participacion(?: societaria| accionaria)?$/,
    // "% de Participación EN LA SOCIEDAD" (auditor 31-ago-2026, 4 licitaciones): mismo dato, el
    // organismo agrega dónde se participa. `porcentaje` escrito en palabra es la otra mitad del par.
    /^(?:%|porcentaje) de (?:participacion|derechos) en la sociedad$/,
  ] },
];

// ── Grilla NUMERADA de socios: solo la fila 1 ────────────────────────────────────────────────
// Una tabla de socios trae una fila por socio, y el detector rotula cada celda con el texto de su
// fila más el de su columna ("1 — Rut Socio", "2 — % de Participación en la Sociedad"; ver
// `${filaContexto} — ${nombreColumna}` en anexos-detectar.ts).
//
// El guardarraíl `soloManual` de anexos-detectar.ts —el que evita rellenar las 8 filas de una tabla
// de asistentes con el RUT de la empresa— NO se activa acá: solo cubre filas SIN ningún texto
// propio, y estas sí lo tienen (el número). Sin esta función, agregar "Rut Socio" al diccionario
// habría escrito el MISMO RUT del representante en las 12 filas de la grilla: un registro
// societario inventado dentro de una declaración jurada.
//
// La política de la empresa (instructivo interno, punto 4) es socio ÚNICO al 100% = el
// representante legal. Eso justifica exactamente UNA fila: la primera. Las demás quedan pendientes,
// que es la respuesta honesta — no tenemos más socios que declarar.
//
// El alcance está acotado a propósito a los campos de socio: en cualquier OTRA grilla numerada
// (integrantes de una UTP, productos, asistentes) la fila 1 tampoco somos nosotros.
// Es un BLOQUEO, no una resolución: la fila 1 no necesita ayuda porque `etiquetaPropia` ya recorta
// el "1 — " y el diccionario resuelve la columna sola. El problema es exactamente el contrario —
// que las filas 2, 3 … 12 se resuelven IGUAL de bien y quedan todas con el mismo RUT.
// (Encontrado por el test end-to-end de esta misma tanda: la versión anterior de esta regla llegaba
// tarde, después de que el diccionario ya había resuelto por la etiqueta propia.)
const CAMPOS_DE_SOCIO = new Set<string>(['socio_nombre', 'socio_participacion', 'representante_rut']);
const RE_FILA_NUMERADA = /^\s*(\d{1,3})\s*[—–-]\s*(.+)$/;

/** ¿Es la fila 2+ de una grilla numerada de SOCIOS? Entonces no hay dato honesto que ofrecer. */
export function esFilaDeSocioPosterior(etiqueta: string): boolean {
  const m = RE_FILA_NUMERADA.exec(etiqueta || '');
  if (!m || Number(m[1]) === 1) return false;
  const columna = m[2];
  const campo = campoDeEtiquetaInequivoca(columna);
  if (!campo || !CAMPOS_DE_SOCIO.has(String(campo))) return false;
  // `representante_rut` también lo devuelve "Cédula de identidad" (una grilla de terceros): el
  // bloqueo solo aplica cuando la columna habla de SOCIOS, que es donde nace el dato duplicado.
  return campo !== 'representante_rut' || /\b(socio|accionista)\b/i.test(columna);
}

/** Etiqueta que ya dice a quién describe → campo, sin mirar el contexto. `null` si es ambigua. */
export function campoDeEtiquetaInequivoca(etiqueta: string): Campo | null {
  const n = normalizarEtiqueta(etiqueta);
  if (!n) return null;
  for (const e of DICCIONARIO) if (e.patrones.some(p => p.test(n))) return e.campo;
  return null;
}

// ── CAPA 6b — Programa de integridad: respuesta fija de política ─────────────────────────────
// Preguntar "¿cuenta con Programa de Integridad?" siempre se responde SÍ. Distinto de una casilla
// que pide DESCRIBIR el programa: esa es texto libre y queda al humano.
const RE_INTEGRIDAD = /\b(programa|politica|codigo)\s+(de\s+)?(integridad|etica|cumplimiento|compliance)\b|\bdirectiva\s+n?\s*[°º]?\s*31\b/;
const RE_PIDE_DESCRIBIR = /\b(describ|detall|indique en que consiste|explique|senale como|adjunte)\w*/;
// BUG REAL (19-ago-2026, ANEXO N°2 de 2724-35-LP26, encontrado por el repaso de IA): esta regla
// se evalúa sobre la etiqueta MÁS el contexto del bloque, y en un anexo cuyo título es justamente
// "PROGRAMA DE INTEGRIDAD" el contexto la activa para CUALQUIER casilla del documento que no se
// haya resuelto antes. El pie de firma "<Ciudad>, <día/mes/año>" terminó completado con "SÍ".
// Escribir la respuesta de una pregunta de sí/no dentro de la casilla de la fecha es indefendible:
// queda a la vista en el documento que se sube al portal.
//
// El contexto del bloque se conserva a propósito (una casilla "SI___NO___" no dice por sí sola de
// qué pregunta es, y sin el contexto no habría forma de resolverla), pero ahora pierde SIEMPRE
// contra una etiqueta que nombra un dato concreto y distinto. Ojo con el orden de lectura: acá no
// se decide qué campo va, solo que NO es la respuesta de integridad — si ninguna otra capa la
// resuelve, la casilla queda pendiente, que es el resultado correcto.
const RE_ETIQUETA_PIDE_OTRO_DATO =
  /\b(fecha|dia|mes|anio|ciudad|comuna|region|domicilio|direccion|calle|rut|run|cedula|nombre|razon social|telefono|fono|correo|mail|giro|cargo|firma)\b|d[ií]a\s*\/\s*mes\s*\/\s*a[nñ]o/;

function esPreguntaDeIntegridad(texto: string): boolean {
  const n = normalizarEtiqueta(texto);
  return RE_INTEGRIDAD.test(n) && !RE_PIDE_DESCRIBIR.test(n);
}

// ── CAPA 2 — Desambiguación por BLOQUE ───────────────────────────────────────────────────────
// Una etiqueta pelada ("NOMBRE", "RUT", "CARGO") se decide mirando las OTRAS casillas del mismo
// bloque y el encabezado que lo precede. Esta es exactamente la regla que evita la regresión
// verificada del 17-ago-2026 (caso real 1058086-43-LP26, ANEXO N°5):
//     NOMBRE: ___  /  RUT: ___  /  NOMBRE DE LA EMPRESA (si correspondiere): ___
// Poner la razón social en la primera duplica la empresa y borra al firmante.
const ETIQUETAS_PELADAS: { re: RegExp; persona: Campo; empresa: Campo }[] = [
  { re: /^nombre(?: completo)?$/,                    persona: 'representante_nombre', empresa: 'razon_social' },
  { re: /^(?:rut|r u t|rol unico tributario)$/,      persona: 'representante_rut',    empresa: 'rut' },
  { re: /^(?:rut|cedula|c i|run)(?: n[°º]?)?$/,      persona: 'representante_rut',    empresa: 'rut' },
];
const RE_PELADA_NOMBRE = ETIQUETAS_PELADAS[0].re;
// El RUT pelado es el ÚNICO de los tres que además calza con una entrada del diccionario de la
// capa 1 (`^r u t${OFERENTE}$`, con el sufijo opcional): "RUT" a secas se resuelve ahí como el de
// la EMPRESA y nunca llega a esta capa. Ver el paso 1b de resolverDeterminista.
const RE_PELADA_RUT = /^(?:rut|r u t|rol unico tributario|cedula|c i|run)(?: n[°º]?)?$/;

// Subcampos del domicilio escritos PELADOS: por sí solos no dicen que hablan de una dirección
// ("N°" es también el número de fila de cualquier tabla). Ver la capa 1c de resolverDeterminista.
const RE_SUBCAMPO_DOMICILIO_PELADO = /^(?:n[°º]|numero|nro|of|oficina|dpto|depto|departamento)$/;
// La señal de que el bloque SÍ habla de un domicilio: alguna hermana o el contexto lo nombra.
const RE_HERMANA_DOMICILIO = /\b(?:direccion|domicilio|calle|avenida|comuna|ciudad|villa|poblacion)\b/;

// "contraparte"/"coordinador" se suman el 31-ago-2026: ese bloque ahora SIEMPRE se llena (ver
// RE_BLOQUE_DESIGNADO_POR_NOSOTROS), y su "Nombre completo" es el de una PERSONA. Sin esto ganaba
// RE_CTX_EMPRESA (el encabezado dice "del OFERENTE") y la casilla del nombre salía con la razón
// social — una empresa donde el organismo espera a quién llamar por teléfono.
const RE_CTX_PERSONA = /\b(representante(\s+legal)?|apoderado|declarante|firmante|don|dona|suscribe|persona natural|encargado|administrador de contrato|contacto|contraparte|coordinador)\b/;

// BUG REAL (18-ago-2026, FORMULARIO N°1 de 1063538-204-LE26): "jefe de proyecto" / "supervisor del
// contrato" / "administrador del contrato" son roles que el organismo designa para EJECUTAR el
// contrato — no son la empresa ni su representante legal, así que la ficha no tiene ese dato.
// Escribir ahí al representante legal es un dato equivocado en un documento que el organismo usa
// para contactar a esa persona puntual.
//
// Va como bloqueo DURO (misma familia que esBloqueDeTercero): ninguna capa por debajo de campoFijo
// rellena dentro de un bloque así. La casilla queda pendiente, que es exactamente lo que se busca.
//
// "coordinador"/"contraparte técnica" NO están acá: tuvieron el mismo bloqueo hasta el 31-ago-2026,
// pero el usuario decidió que a secas también se llenan con los datos del oferente (antes solo se
// llenaba cuando el documento decía explícitamente "...del oferente"). Confiar en que se
// desambigüen la ficha era peor que dejarlas en blanco.
const RE_BLOQUE_DESIGNADO_POR_NOSOTROS = /\b(jefe\s+de\s+proyecto|supervisor\s+del\s+contrato|administrador\s+del\s+contrato)\b/;

/** ¿Este bloque describe a alguien que el asistente designa para ESTA licitación, y no a la empresa
 *  ni a su representante legal? Ver RE_BLOQUE_DESIGNADO_POR_NOSOTROS. */
export function esBloqueDesignadoPorNosotros(texto: string): boolean {
  const n = normalizarEtiqueta(texto);
  return RE_BLOQUE_DESIGNADO_POR_NOSOTROS.test(n);
}

// Un ENCABEZADO DE SECCIÓN dentro de una tabla de identificación: línea corta, en mayúsculas y casi
// siempre terminada en ":" ("DATOS DEL PROPONENTE:", "REPRESENTANTE LEGAL:", "COORDINADOR TECNICO*:",
// "CONTACTO DEL PROPONENTE:"). Se distingue de una etiqueta de campo ("Nombre completo") porque esta
// última va en minúsculas o Capitalizada.
const RE_ENCABEZADO_SECCION = /^[^a-z]{4,60}$/;

// El mismo criterio (línea sin una sola minúscula) pero SIN el tope de 60 caracteres, para cortar
// bloques: los encabezados de sección reales son largos ("2.REPRESENTANTE LEGAL O APODERADO (EN
// CASO DE SER EL OFERENTE PERSONA JURÍDICA O UTP)." son 86). El tope de 60 de arriba existe para
// BUSCAR el encabezado más cercano hacia atrás sin barrer prosa; acá se prueba un párrafo puntual
// que ya se sabe que está entre dos casillas, así que puede ser más largo sin riesgo.
const RE_ENCABEZADO_QUE_CORTA = /^[^a-z]{4,140}$/;

/**
 * El encabezado de sección más cercano HACIA ARRIBA de una casilla.
 *
 * Por qué no basta el contexto del bloque: `construirBloques` agrupa casillas separadas por 4
 * párrafos o menos, y en una tabla de identificación densa eso mete "COORDINADOR TÉCNICO" y
 * "CONTACTO DEL PROPONENTE" en el MISMO bloque — con el mismo contexto. Mirar el contexto haría que
 * los dos se traten igual, cuando uno se llena y el otro no (caso real: FORMULARIO N°1 de
 * 1063538-204-LE26). Buscar el encabezado real de cada casilla los separa bien.
 */
export function encabezadoDeSeccionMasCercano(parrafos: Parrafo[], indice: number): string {
  for (let i = indice - 1; i >= 0 && i > indice - 40; i--) {
    const t = (parrafos[i]?.texto || '').trim();
    if (!t || t.length > 60) continue;
    if (RE_ENCABEZADO_SECCION.test(t)) return t;
  }
  return '';
}
const RE_CTX_EMPRESA = /\b(oferente|proponente|empresa|razon social|proveedor|postulante|sociedad|contribuyente|antecedentes (del|de la) (proveedor|empresa))\b/;
// Casillas HERMANAS que ya cubren explícitamente a uno de los dos titulares. Si el bloque ya tiene
// una casilla propia de la empresa, el pelado es la persona — y viceversa.
const RE_HERMANA_EMPRESA = /^(?:nombre (?:de la |del )?(?:empresa|sociedad|oferente|proponente)|razon social|nombre o razon social|rut (?:de la )?empresa)/;
const RE_HERMANA_PERSONA = /^(?:nombre(?: completo)? del (?:representante|apoderado)|representante legal|cedula de identidad|rut del representante)/;

interface Bloque { indices: number[]; etiquetas: string[]; contexto: string }

/**
 * Bloque = casillas contiguas en el documento. Dos casillas separadas por más de `GAP` párrafos ya
 * no se explican entre sí (son otra tabla, otra sección). Es el mismo criterio con el que un
 * humano lee: lo que está junto en el papel habla de lo mismo.
 */
const GAP = 4;
function construirBloques(candidatos: CandidatoCelda[], parrafos: Parrafo[]): Map<number, Bloque> {
  const orden = [...candidatos].sort((a, b) => a.indice - b.indice);
  const bloques: Bloque[] = [];
  let actual: CandidatoCelda[] = [];
  const cerrar = () => {
    if (!actual.length) return;
    const primero = actual[0].indice;
    const previos: string[] = [];
    for (let i = primero - 1; i >= 0 && previos.length < 3; i--) {
      const p = parrafos[i];
      if (p?.texto && !p.vacio) previos.push(p.texto);
    }
    // El prefijo "FILA — COLUMNA" de una etiqueta compuesta es contexto del bloque, no la etiqueta.
    const encabezados = actual.map(c => c.etiqueta.match(/^(.+?)\s+—\s+/)?.[1] || '').filter(Boolean);
    bloques.push({
      indices: actual.map(c => c.indice),
      etiquetas: actual.map(c => normalizarEtiqueta(etiquetaPropia(c.etiqueta))),
      contexto: normalizarEtiqueta([...previos, ...encabezados].join(' · ')),
    });
    actual = [];
  };
  // BUG REAL (2495-17-B226, FORMULARIO ADMI-1, reportado por el usuario: "en el oferente me pones
  // el RUT del representante legal"): el bloque de la SECCIÓN 1 (datos del oferente: Nombre o Razón
  // Social / RUT / Dirección / Teléfono / Email) se comía la SECCIÓN 2 (representante legal: Nombre
  // / Profesión / RUT / …). Entre la última casilla de una y la primera de la otra hay exactamente
  // 4 párrafos y el corte por distancia es `> GAP`, así que no cortaba por un párrafo.
  //
  // Con las dos secciones en un mismo bloque, la capa 1b ("coherencia de titular para el RUT
  // pelado") encontraba como hermana el "Nombre" pelado del REPRESENTANTE y concluía que el RUT
  // del OFERENTE era el de la persona. Resultado: el RUT del representante en la casilla de la
  // empresa, dentro de una declaración jurada de identificación. La distancia nunca va a ser un
  // criterio confiable acá — lo que separa dos secciones es su ENCABEZADO, no cuántos párrafos hay.
  //
  // El encabezado que corta NO se puede confundir con una etiqueta de campo: las etiquetas también
  // vienen en mayúsculas en muchos pliegos ("RAZÓN SOCIAL", "R.U.T."), y cortar en cada una dejaría
  // a cada casilla en su propio bloque, apagando la capa 2 entera. Por eso se descarta explícitamente
  // el párrafo que ES la etiqueta de la casilla siguiente: lo que queda es un título de sección.
  const cortaBloque = (desde: number, hasta: number, siguiente: CandidatoCelda): boolean => {
    const etiquetaSiguiente = normalizarEtiqueta(etiquetaPropia(siguiente.etiqueta));
    for (let i = desde + 1; i < hasta; i++) {
      const t = (parrafos[i]?.texto || '').trim();
      if (!t) continue;
      if (normalizarEtiqueta(t) === etiquetaSiguiente) continue;   // es su propia etiqueta
      if (RE_ENCABEZADO_QUE_CORTA.test(t)) return true;
    }
    return false;
  };
  for (const c of orden) {
    const previo = actual[actual.length - 1];
    if (previo && (c.indice - previo.indice > GAP || cortaBloque(previo.indice, c.indice, c))) cerrar();
    actual.push(c);
  }
  cerrar();
  const porIndice = new Map<number, Bloque>();
  for (const b of bloques) for (const i of b.indices) porIndice.set(i, b);
  return porIndice;
}

/** De "IDENTIFICACIÓN DEL REPRESENTANTE — NOMBRE" devuelve solo "NOMBRE". */
function etiquetaPropia(etiqueta: string): string {
  return etiqueta.match(/^(?:.+?)\s+—\s+(.+)$/)?.[1] ?? etiqueta;
}

/**
 * Resuelve una etiqueta pelada por su bloque. Devuelve `null` cuando el bloque no da ninguna
 * señal: preferimos una casilla pendiente que el humano llena en 3 segundos antes que un dato
 * equivocado en una declaración jurada.
 */
export function resolverPeladaPorBloque(
  etiqueta: string, hermanas: string[], contexto: string, esPieDeFirma: boolean,
): Campo | null {
  const n = normalizarEtiqueta(etiquetaPropia(etiqueta));
  const regla = ETIQUETAS_PELADAS.find(r => r.re.test(n));
  if (!regla) return null;

  const propias = hermanas.filter(h => h !== n);
  // 1. Hermana explícita: la señal más fuerte y la que evita la regresión del Anexo N°5.
  if (propias.some(h => RE_HERMANA_EMPRESA.test(h))) return regla.persona;
  if (propias.some(h => RE_HERMANA_PERSONA.test(h))) return regla.empresa;
  // 2. Encabezado del bloque.
  const ctxPersona = RE_CTX_PERSONA.test(contexto);
  const ctxEmpresa = RE_CTX_EMPRESA.test(contexto);
  if (ctxPersona && !ctxEmpresa) return regla.persona;
  if (ctxEmpresa && !ctxPersona) return regla.empresa;
  // 3. Pie de firma sin más contexto: quien firma es la persona.
  if (esPieDeFirma) return regla.persona;
  return null;
}

// ── CAPA 3 — Declaración jurada corrida (blancos a mitad de oración) ─────────────────────────
// El texto da la respuesta en las palabras INMEDIATAMENTE ANTERIORES al blanco. No es un juicio:
// es una tabla de regex sobre la cola del texto previo. Caso real verificado sin llenar (ANEXO N°4
// "DECLARACIÓN JURADA SIMPLE DE PRÁCTICAS ANTISINDICALES"):
//   "Yo ___, Cédula de identidad N.º ___, con domicilio en la ciudad de ___, en representación de
//    ___, Rut Nº ___"  → 5 casillas, 5 reglas, cero ambigüedad.
// Se evalúan EN ORDEN y manda la primera que calce: "en representación de la empresa ___" tiene
// que ganarle a "empresa ___".
const REGLAS_PREVIAS: { re: RegExp; campo: Campo }[] = [
  // A quién se representa → la EMPRESA (nunca la persona, aunque venga tras "representante").
  { re: /\ben\s+represent(?:acion|ación)\s+(?:legal\s+)?de(?:\s+la)?(?:\s+(?:empresa|sociedad|razon\s+social))?\s*$/i, campo: 'razon_social' },
  { re: /\b(?:para|por)\s+(?:y\s+en\s+nombre\s+de|cuenta\s+de)\s*$/i, campo: 'razon_social' },
  // "Mi representada ______" / "mi representada es ______" — fórmula estándar con la que el
  // representante legal nombra a SU empresa dentro de una declaración jurada. Medida por el
  // auditor del 28-ago-2026 en 20 licitaciones de organismos distintos (24 casillas), todas
  // quedando en blanco. El diccionario de CELDAS ya la reconoce, pero acá el blanco es INLINE y
  // ese camino usa esta otra lista — por eso seguía sin resolverse. Es inequívoca: "mi
  // representada" solo puede ser la empresa representada; para la persona los anexos escriben
  // "el suscrito" o "el compareciente".
  { re: /\bmi\s+representada\s*,?\s*(?:es\s*)?:?\s*$/i, campo: 'razon_social' },
  // "1.-Representar a: ______" (2495-17-B226, FORMULARIO ADMI-3, dentro de "DECLARO:"): el que
  // firma es el representante legal y lo que declara representar es su empresa. Misma familia que
  // las dos reglas de arriba, distinta redacción. El guardarraíl de bloque de TERCERO sigue
  // aplicando antes, así que un "representar a" dentro de la firma de un tercero no entra.
  { re: /\brepresentar\s+a\s*:?\s*$/i, campo: 'razon_social' },
  { re: /\bla\s+empresa\s+que\s+represento\s*,?\s*(?:es\s*)?:?\s*$/i, campo: 'razon_social' },
  // "Yo, Lidia Valenzuela, representante legal de ______" — a quien se representa es la EMPRESA, no
  // otra persona. Detectado por la auditoría del 18-ago-2026 sobre 1057480-41-LP26. El "de" final es
  // obligatorio y es lo que lo separa del caso vecino: "nombre del representante legal ___" (sin
  // "de" al final) sigue resolviendo al NOMBRE de la persona, que es un dato distinto.
  // ORDEN: esta va ANTES que la de razón social de abajo. "Nombre del representante legal ___" pide
  // a la PERSONA; "representante legal DE ___" pide a la empresa que representa. La diferencia es la
  // preposición final, y si la de empresa se evaluara primero se comería esta.
  { re: /\bnombre\s+(?:completo\s+)?(?:del?\s+|de\s+la\s+)?representan?te(?:\s+legal)?\s*:?\s*$/i, campo: 'representante_nombre' },
  { re: /\brepresentan?te\s+legal\s+de(?:\s+la)?(?:\s+(?:empresa|sociedad))?\s*$/i, campo: 'razon_social' },
  // Nombre de quien declara.
  { re: /\byo,?\s*$/i, campo: 'representante_nombre' },
  { re: /\b(?:don|dona|doña|sr|sra|senor|señor)\.?,?\s*$/i, campo: 'representante_nombre' },
  // "En Santiago, a __ días del mes de __ de 2026, comparece ___, de nacionalidad ___, C.I.
  // N°___, con domicilio en ___, quien bajo juramento expone…" — fórmula notarial estándar de
  // toda declaración jurada chilena. BUG REAL (27-ago-2026, 611669-17-LE26, ANEXO N°1-B): las dos
  // casillas HERMANAS de esta misma oración ("C.I. N°" y "con domicilio en") ya resolvían bien,
  // pero "comparece" —el nombre de quien declara— no tenía regla propia y quedaba pendiente pese
  // a tener representante_nombre en la ficha. Sin "quien" al final: "comparece quien suscribe" es
  // una fórmula distinta que no nombra a nadie todavía.
  { re: /\bcomparece\s*$/i, campo: 'representante_nombre' },
  // "…, de nacionalidad ______, cédula de identidad N°…" — la casilla que sigue al nombre en esa
  // misma fórmula notarial. Medida por el auditor del 28-ago-2026 en 10 licitaciones (16
  // casillas), siempre en blanco: sus hermanas de la oración (nombre, C.I., domicilio) resolvían
  // bien y esta no tenía ningún campo que la respondiera. Ver NACIONALIDAD_POR_DEFECTO.
  { re: /\b(?:de\s+)?nacionalidad\s*:?\s*$/i, campo: 'nacionalidad' as Campo },
  { re: /\bnombre\s+(?:completo\s+)?(?:del\s+)?(?:representante|apoderado|declarante)?\s*:?\s*$/i, campo: 'representante_nombre' },
  // Cédula de la persona — distinta del RUT de la empresa aunque compartan la oración.
  { re: /\b(?:c(?:é|e)dula\s+(?:nacional\s+)?de\s+identidad|c\.?\s*i\.?|run)\s*(?:n[°º.]*|numero|nro)?\s*:?\s*$/i, campo: 'representante_rut' },
  // Domicilio.
  { re: /\b(?:con\s+)?domicili(?:o|ado)\s+(?:en|para\s+estos\s+efectos\s+en)(?:\s+(?:la\s+)?(?:ciudad|comuna)\s+de)?\s*$/i, campo: 'direccion' },
  { re: /\bdirecci(?:o|ó)n\s*:?\s*$/i, campo: 'direccion' },
  // RUT: por defecto el de la EMPRESA. La cédula de la persona ya se atrapó arriba con su palabra
  // propia ("cédula", "C.I.", "RUN"); un "Rut N°" pelado en una declaración jurada acompaña
  // siempre a la razón social recién nombrada.
  { re: /\b(?:r\.?\s*u\.?\s*t\.?|rol\s+(?:u|ú)nico\s+tributario)\s*(?:n[°º.]*|numero|nro)?\s*:?\s*$/i, campo: 'rut' },
  { re: /\bgiro\s*:?\s*$/i, campo: 'giro' },
  { re: /\b(?:tel(?:e|é)fono|fono|celular)\s*:?\s*$/i, campo: 'telefono1' },
  { re: /\b(?:correo(?:\s+electr(?:o|ó)nico)?|e-?mail)\s*:?\s*$/i, campo: 'email1' },
  { re: /\bcargo\s+(?:de\s+)?\s*:?\s*$/i, campo: 'representante_cargo' },
  // Datos de la licitación.
  { re: /\b(?:licitaci(?:o|ó)n\s+p(?:u|ú)blica|id\s+(?:de\s+)?mercado\s+p(?:u|ú)blico|propuesta\s+p(?:u|ú)blica)\s*(?:n[°º.]*|id)?\s*:?\s*$/i, campo: 'licitacion_codigo' },
  { re: /\b(?:denominada|individualizada\s+como|cuyo\s+nombre\s+es)\s*$/i, campo: 'licitacion_nombre' },
  // "Mediante el presente Formulario, la empresa ______ certifica que el plazo para entrega…"
  // (FORMULARIO N°5 de 1063538-204-LE26, reportado por el usuario 18-ago-2026). El blanco viene
  // pegado a "la empresa" y es siempre la razón social del oferente — sea Comercial MP o
  // Inversiones Claro, la que esté asignada al negocio.
  //
  // VA AL FINAL DE LA LISTA A PROPÓSITO: `REGLAS_PREVIAS` se recorre en orden y gana la primera que
  // matchea, así que cualquier regla MÁS ESPECÍFICA que también termine en "empresa" sigue
  // ganándole. Ejemplos que ya están arriba y NO se ven afectados: "domicilio de la empresa ___"
  // (→ direccion), "RUT de la empresa ___" (→ rut), "giro de la empresa ___" (→ giro),
  // "el representante legal de la empresa ___" (→ representante_nombre). Esta regla solo recoge
  // el caso en que "empresa" es la ÚLTIMA palabra antes del blanco sin ningún otro dato pedido.
  // Exige COMA (o inicio de frase) justo antes de "la empresa". Sin eso, la regla se comía a las más
  // específicas: "el domicilio de la empresa ___" devolvía la razón social en vez de la dirección —
  // lo atrapó el guardarraíl del test antes de llegar a producción. La forma real de este caso
  // SIEMPRE trae la coma ("…presente Formulario, la empresa ___"), mientras que "<dato> DE la
  // empresa" nunca la tiene.
  // "…llenar con el Nombre o razón social de la empresa participante ___" (5251-65-LE26,
  // detectado por la auditoría): el organismo escribe la INSTRUCCIÓN de qué va antes del blanco.
  { re: /\bnombre\s+(?:completo\s+)?o\s+raz(?:o|ó)n\s+social(?:\s+de(?:\s+la)?)?(?:\s+(?:empresa|sociedad))?(?:\s+(?:participante|oferente|proponente|postulante))?\s*:?\s*$/i, campo: 'razon_social' },
  { re: /(?:^|,)\s*(?:la\s+)?empresa\s*,?\s*$/i, campo: 'razon_social' },

  // ── Formas medidas en el muestreo de 1.500 documentos (31-ago-2026) ──
  //
  // "Don (ña) ______" / "a don(a) ______": el organismo cubre los dos géneros con un paréntesis
  // pegado a la palabra. La regla de "don/doña" que ya existía exige que la palabra sea la ÚLTIMA
  // antes del blanco, así que el "(ña)" la desactivaba por completo (5 licitaciones, 20 casillas).
  { re: /\b(?:don|do[ñn]a|sr|sra)\s*\(\s*(?:[ñn]a|a|esa)\s*\)\s*\.?,?\s*$/i, campo: 'representante_nombre' },

  // "FECHA ______" sin los dos puntos (33 licitaciones, 126 casillas — la forma más repetida de
  // todas). El match de etiqueta de campoDeBlancoInline exige que termine en ":", así que la misma
  // palabra sin el signo no llegaba nunca al diccionario.
  //
  // El anclaje a INICIO de segmento es lo que la hace segura, y no es teórico: "Ordinario N° 123
  // DE FECHA ______" (8 licitaciones) es la fecha de un oficio del organismo, NO la nuestra —
  // escribir ahí la fecha de hoy sería un dato falso dentro de una declaración jurada. Con el
  // ancla, "de fecha" nunca entra porque viene precedido de "de".
  { re: /(?:^|[.;·|\t])\s*fecha\s*:?\s*$/i, campo: 'fecha_hoy' },

  // "…, profesión u oficio ______ RUT ……" (2495-17-B226, en los DOS formularios del pliego): el
  // dato está en la ficha (`representante_profesion` = "Ingeniero Constructor") y quedaba en blanco
  // solo porque acá la etiqueta viene SIN dos puntos, y el camino de etiqueta de campoDeBlancoInline
  // exige que termine en ":".
  { re: /\bprofesi(?:o|ó)n\s*(?:u|o)\s*oficio\s*:?\s*$/i, campo: 'representante_profesion' as Campo },
  { re: /\bprofesi(?:o|ó)n\s+del?\s+(?:representante(?:\s+legal)?|apoderado|declarante)\s*:?\s*$/i, campo: 'representante_profesion' as Campo },

  // "Correo electrónico para notificaciones. ______" (2495-17-B226): la MISMA etiqueta ya está en el
  // diccionario, pero termina en PUNTO en vez de dos puntos y por eso no llegaba nunca.
  { re: /\bcorreo\s+electr(?:o|ó)nico\s+para\s+(?:notificaciones|efectos\s+de(?:\s+esta)?\s+licitaci(?:o|ó)n)\s*[.:]?\s*$/i, campo: 'email1' },

  // "…consta en escritura pública de fecha ______" (3 licitaciones): acá la fecha SÍ es un dato de
  // la ficha, pero es la de la constitución de la sociedad, no la de hoy. Va después de la regla
  // de arriba y no choca con ella (aquella exige inicio de segmento; esta, la frase completa).
  { re: /\bescritura\s+p(?:u|ú)blica\s+de\s+fecha\s*$/i, campo: 'fecha_escritura' },
];

// CAPA 5 — Localidad de firma. "En ______ a ___ de ___" cae hoy en firma_fecha → null, y el dato
// existe sin usar: la comuna del ORGANISMO licitante (ComunaUnidad). Ojo: la regla vieja mandaba
// "[ciudad/país]" a la región de la EMPRESA — el instructivo pide la del organismo. Corregido acá.
const RE_LOCALIDAD_FIRMA = /(?:^|[.;])\s*(?:en|ciudad\s+de)\s*$/i;
const RE_SIGUE_FECHA = /^\s*[,]?\s*(?:a|con\s+fecha|el\s+d(?:i|í)a)\b|^\s*,?\s*\d{0,2}\s*de\b/i;

// Marcadores literales del organismo ("[Insertar RUT]"): el texto dentro del marcador dice
// EXACTAMENTE qué va ahí y manda sobre cualquier inferencia del contexto.
const REGLAS_MARCADOR: { re: RegExp; campo: Campo }[] = [
  // BUG REAL (18-ago-2026, 1247197-54-LE26, "DECLARACIÓN JURADA PARA CONTRATAR"): el marcador
  // "<RUT representante legal o persona natural según corresponda>" caía en la regla de
  // "representante legal" (que estaba PRIMERA) y se completaba con el NOMBRE del representante
  // donde el documento pedía su RUT — un dato equivocado dentro de una declaración jurada, que es
  // peor que dejarlo en blanco. La regla general: un marcador que nombra las dos cosas dice QUÉ
  // dato es ("RUT") y DE QUIÉN es ("representante legal"); el QUÉ manda, el DE QUIÉN solo elige
  // entre las dos variantes del mismo dato. Por eso estas dos van ANTES que cualquier regla de
  // titular: son las únicas que miran las dos señales a la vez.
  // Ojo con "o persona natural según corresponda": el organismo lo pega a los DOS marcadores (el
  // del representante y el de la empresa) para cubrir ambos tipos de oferente, así que NO sirve
  // para desambiguar — usarlo mandaba el RUT del representante a la casilla del RUT de la empresa.
  // Lo que decide es la palabra pegada al dato: "RUT empresa…" vs "RUT representante legal…".
  { re: /(?:rut|run)\s*(?:n[°º.]?\s*)?(?:de\s+la\s+|del\s+|de\s+)?(?:empresa|raz(?:o|ó)n\s+social|sociedad|proponente|oferente|persona\s+jur(?:i|í)dica)/i, campo: 'rut' },
  { re: /(?:rut|run|c(?:e|é)dula)[\s\S]{0,25}?(?:representante|apoderado|firmante|declarante)/i, campo: 'representante_rut' },
  { re: /nombre\s+completo\s+del\s+representante|representante\s+legal/i, campo: 'representante_nombre' },
  { re: /n(?:u|ú)mero\s+de\s+run|\brun\b|c(?:e|é)dula/i, campo: 'representante_rut' },
  { re: /nombre\s+o\s+raz(?:o|ó)n\s+social|raz(?:o|ó)n\s+social|nombre\s+persona\s+(?:natural|jur(?:i|í)dica)/i, campo: 'razon_social' },
  { re: /insertar\s+rut|^\s*rut\s*$/i, campo: 'rut' },
  // "id licitación" (sin "de") y "id DE licitación" son la misma pregunta — BUG REAL (28-ago-2026,
  // ANEXO N°2B, 2928-17-LE26): "indique ID de licitación" no calzaba por la "de" de más.
  { re: /id\s+de\s+mercado\s+p(?:u|ú)blico|id\s+(?:de\s+)?licitaci(?:o|ó)n/i, campo: 'licitacion_codigo' },
  { re: /nombre\s+(?:de\s+la\s+)?licitaci(?:o|ó)n/i, campo: 'licitacion_nombre' },
  { re: /^\s*fecha\s*$/i, campo: 'fecha_hoy' },
  // El marcador ESCRIBE el formato en vez de la palabra "fecha": "<día/mes/año>", "<dd/mm/aaaa>",
  // "<DD-MM-AAAA>". Caso real 2724-35-LP26 (ANEXO N°1 y los otros seis del mismo pliego, todos con
  // el mismo pie "<Ciudad>, <día/mes/año>"): la ciudad SÍ se llenaba y la fecha quedaba con el
  // marcador literal a la vista en el documento que se sube al portal. Es la fecha completa en UN
  // solo hueco — distinto del triplete "___ de ___ de ___", que ya resuelve detectarTripletesFecha
  // con sus tres campos por separado.
  { re: /^\s*(?:d(?:i|í)a|dd?)\s*[/\-.]\s*(?:mes|mm?)\s*[/\-.]\s*(?:a(?:n|ñ)o|a{2,4}|yy(?:yy)?)\s*$/i, campo: 'fecha_hoy' },
  // BUG REAL (18-ago-2026, ANEXO N°4 de 1247197-54-LE26): esta regla mandaba CUALQUIER marcador
  // que dijera "comuna"/"ciudad" a la comuna del ORGANISMO comprador. En "con domicilio en
  // <domicilio>, <comuna>, <ciudad> en representación de…" el resultado fue
  // "Camino El Oliveto N° 575 N° 6, Talagante, CONCHALÍ, CONCHALÍ" — la comuna de la
  // Municipalidad de Conchalí metida dentro del domicilio de una empresa de Talagante.
  // La comuna del organismo SOLO aplica en la localidad de firma ("En ____, a 12 de agosto"), y
  // ese caso ya lo resuelve RE_LOCALIDAD_FIRMA ANTES de llegar acá (ver campoDeBlancoInline). Un
  // marcador que dice "comuna" a secas, en medio de una frase, es la comuna del OFERENTE.
  // BUG REAL (28-ago-2026, ANEXO N°2B, 2928-17-LE26): "indique dirección, comuna y región" pide
  // los TRES datos en UN solo blanco. Sin esta regla compuesta, "comuna" (la siguiente, más abajo)
  // ganaba por orden y la casilla salía con SOLO la comuna ("Concepción") en vez de la dirección
  // completa — un dato incompleto sin ningún aviso, peor que dejarlo pendiente. `direccion` ya
  // trae la comuna metida al final ("Barros Arana N°492 Of.78, Concepción" — ver comunaDeDireccion
  // más abajo), así que responde las tres preguntas con un solo valor real. Va ANTES que las reglas
  // sueltas de ciudad/comuna a propósito: tiene que ganarles cuando las dos aparecen juntas.
  { re: /(?:domicilio|direcci(?:o|ó)n)\b[\s\S]{0,40}?\b(?:comuna|regi(?:o|ó)n|ciudad)\b/i, campo: 'direccion' },
  { re: /\bciudad\b/i, campo: 'ciudad' },
  { re: /\bcomuna\b/i, campo: 'comuna' },
  // "localidad" sigue siendo la del organismo: es la palabra de la fórmula de cierre ("En la
  // localidad de ___, a 12 de agosto"), nunca parte del domicilio del oferente.
  { re: /localidad/i, campo: 'licitacion_comuna' },
  { re: /domicilio|direcci(?:o|ó)n/i, campo: 'direccion' },
  { re: /giro/i, campo: 'giro' },
];

// Un marcador que es una INSTRUCCIÓN al oferente no es un dato de la ficha: lo llena el humano
// sabiendo qué va a adjuntar. Nunca autocompletar, nunca esconder.
// Ojo con los verbos recortados: un `complet\w*` genérico matchea "Nombre COMPLETO del
// Representante Legal" y descartaba el marcador más útil que existe (lo cazó el test de marcadores).
// Van solo las formas verbales, nunca el adjetivo.
const RE_MARCADOR_INSTRUCCION = /\b(?:indicar|indique|marcar|marque|senalar|señalar|senale|señale|completar|complete|adjuntar|adjunte|describir|describa|detallar|detalle|explicar|explique)\b/i;

// BUG REAL atrapado por el banco (1058086-43-LP26): un bloque "Nombre: ___ Cargo: ___
// Institución: ___" es la firma de un TERCERO que certifica algo del oferente (ej. un cliente
// anterior), no la del propio oferente. "Cargo:" solo, sin más pista, es una etiqueta inequívoca
// para NUESTRO representante — pero puesta al lado de "Institución:" pasa a describir a la
// persona de esa OTRA institución. Con datos de un tercero, pendiente es siempre más seguro que
// un dato nuestro puesto en la declaración de otro.
// BUG REAL 2 (1786987035022_ANEXO_N2.docx, certificado de experiencia): la lista de abajo no
// cazaba con "DATOS DE LA PERSONA QUE EXTIENDE EL CERTIFICADO" — un encabezado real que tampoco
// dice "institución"/"mandante"/"cliente" — y el "Correo electrónico:" de ESA persona (el cliente
// que certifica, no nosotros) se llenó con el correo de la propia empresa. Ampliado a cualquier
// frase que hable de EXTENDER/EMITIR un certificado o de haber RECIBIDO el servicio — el lenguaje
// que usa el organismo que certifica, nunca el que usa el oferente para hablar de sí mismo.
//
// BUG REAL 3 (2928-17-LE26, ANEXO N°1A "IDENTIFICACIÓN PERSONA JURÍDICA"): "contraparte" a secas
// también matchea "ANTECEDENTES CONTRAPARTE TÉCNICA DEL OFERENTE" — el nombre estándar chileno del
// enlace técnico que EL PROPIO oferente designa para el contrato (misma familia que "coordinador
// técnico", ver RE_BLOQUE_DESIGNADO_POR_NOSOTROS más abajo), no un tercero que certifica algo. Y
// como `esTercero` se prueba contra las etiquetas de TODO el bloque (construirBloques agrupa toda
// casilla contigua), una sola sección "contraparte técnica" en una tabla de identificación densa
// apagaba la resolución de las 14 casillas de la tabla entera — "Nombre o Razón Social", "RUT",
// "Domicilio legal"… ninguna es del tercero, pero todas comparten bloque con la que sí lo parecía.
// Se excluye solo "contraparte técnica", que ya tiene su propio manejo correcto; "contraparte" sin
// calificar (ej. "la contraparte del cliente anterior") sigue marcando tercero como siempre.
const RE_BLOQUE_TERCERO = /\b(instituci(?:o|ó)n|cliente|mandante|contraparte(?!\s+t[eé]cnica)|quien\s+certifica|emisor\s+del\s+certificado|contratante|entidad\s+que\s+certifica|extiende\s+el\s+certificado|persona\s+que\s+extiende|certificad[oa]\s+por|recibi[oó]\s+el\s+servicio|organismo\s+que\s+recibi[oó]|qui[eé]n\s+emite)\b/i;
// El guion bajo es \w para el motor de regex, así que "___Institución" no tiene frontera de
// palabra ANTES de la I (\w seguido de \w no es \b) y el \b de arriba nunca dispara. Se prueba
// sobre el texto con las rayas de relleno ya convertidas a espacio, nunca sobre el crudo.
const esBloqueDeTercero = (texto: string) => RE_BLOQUE_TERCERO.test(texto.replace(/_+/g, ' '));

/** Campo que pide un blanco a mitad de oración, por lo que el documento dice ANTES de él. */
// ── La FECHA DE FIRMA, pieza por pieza ────────────────────────────────────────────────────────
// HALLAZGO del muestreo de 1.500 documentos reales (31-ago-2026, pedido del usuario: "la fecha
// está en distintas formas siempre"). Medido sobre los blancos que el motor NO resolvía:
//
//     en ⎵ , a            27 licitaciones      santiago,            22 licitaciones
//     en ⎵ , a ⎵ de       26 licitaciones      santiago, ⎵ de       19 licitaciones
//     en ⎵ a              18 licitaciones      fecha: ⎵ /           15 licitaciones
//     en ⎵ a ⎵ dias del mes de   12            fecha: ⎵ / ⎵ /       13 licitaciones
//
// Es SIEMPRE la misma frase de cierre de una declaración jurada, escrita de cuatro formas:
//   · "En <Ciudad>, a <día> de <mes> de <año>"        (la ciudad también es un blanco)
//   · "<Ciudad>, <día> de <mes> de <año>"             (la ciudad viene IMPRESA por el organismo)
//   · "En <Ciudad>, a <día> días del mes de <mes> de <año>"
//   · "Fecha: <día> / <mes> / <año>"                  (números, no palabras)
//
// La ciudad ya la resolvía RE_LOCALIDAD_FIRMA; las TRES piezas de la fecha, no. Y `detectarTripletes
// Fecha` (anexos-detectar.ts) tampoco las alcanza en estas variantes — por eso llegan hasta acá.
//
// Se mira `antes` Y `despues` a propósito: "de" solo no distingue el mes del año ("12 de ___ de
// 2026" vs "12 de agosto de ___"), y equivocarse ahí escribe el año donde va el mes. Lo que
// desambigua es qué VIENE DESPUÉS del blanco, no qué viene antes.
const MES_PALABRA = '(?:enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|setiembre|octubre|noviembre|diciembre)';
const HUECO = '(?:_{2,}|\\.{3,}|…+)';
// El nexo entre el día y el mes. El mismo pliego usa las DOS formas en formularios distintos
// (2495-17-B226: "a ___ días del mes de ___" en ADMI-1 y "a ___ del mes de ___" en ADMI-3), así que
// el "días" es opcional. La alternativa LARGA va primero: con `de` adelante, el motor de regex
// consume el "de" de "del", falla, y aunque backtrackea, dejarlo explícito evita la duda al leerlo.
const NEXO_DIA_MES = '(?:(?:d[ií]as?\\s+)?del\\s+mes\\s+de|de)';

// DÍA. Tres separadores REALES entre la ciudad y el día, medidos en 2495-17-B226 (Coyhaique) y en
// el muestreo grande — la primera versión solo cubría el primero y dejaba los otros dos afuera:
//   · coma:      "Coyhaique, ___ de septiembre"
//   · dos puntos: "Coyhaique: ___de…………del 2026"   ← FORMULARIO ADMI-2/ADMI-4 de Coyhaique
//   · sin nada:  "En …………… a ___ días del mes de"  ← la ciudad es un blanco, no hay coma
// Se exige que DESPUÉS venga "de" + un mes (palabra, número u otro hueco): sin eso, cualquier
// "…de la empresa X, a ___" entraría acá.
const RE_ANTES_DIA = new RegExp(
  `(?:^|[.;])\\s*(?:en\\s+)?[^,;:]{2,45}\\s*[,:]\\s*a?\\s*$` +
  `|(?:^|[.;])\\s*en\\s+[^,;:]{2,45}\\s+a\\s*$`, 'i');
// El espacio después de "de" es OPCIONAL a propósito: el organismo escribe "......de……………" pegado
// (2495-17-B226). Lo que sigue tiene que ser igual un mes, un hueco o un número, así que aflojar el
// espacio no abre la puerta a nada ("deficiente ___" no calza: tras "de" viene "ficiente").
const RE_DESPUES_DIA = new RegExp(`^\\s*${NEXO_DIA_MES}\\s*(?:${MES_PALABRA}|${HUECO}|\\d{1,2}\\b)`, 'i');
// MES en PALABRA: "…12 de ___ de 2026" / "…12 días del mes de ___ de 2026". Antes tiene que venir
// un día (número o hueco) y después el año.
const RE_ANTES_MES_PALABRA = new RegExp(`(?:\\d{1,2}|${HUECO})\\s*${NEXO_DIA_MES}\\s*$`, 'i');
const RE_DESPUES_MES_PALABRA = new RegExp(`^\\s*del?\\s+(?:\\d{2,4}|${HUECO}|20\\s*${HUECO})`, 'i');
// AÑO: "…de agosto de ___". Antes viene el mes (palabra o hueco) + "de".
//
// Lo que lo distingue del MES no es cómo termina la frase, sino que DESPUÉS ya no venga más fecha.
// La primera versión exigía que el año cerrara el párrafo (`/^\s*[.\-,;)]*\s*$/`) y por eso perdía
// el caso más común de una declaración jurada, donde la frase SIGUE: "…de …………., comparece don…"
// (2495-17-B226). Ahora el año es "lo que queda cuando ya no hay un 'de <año>' detrás", y el orden
// de las pruebas (mes ANTES que año) es lo que hace que esto sea correcto y no una puerta abierta.
const RE_ANTES_ANIO = new RegExp(`(?:${MES_PALABRA}|${HUECO})\\s*del?\\s*(?:20)?\\s*$`, 'i');
// Forma con BARRAS: "Fecha: ___ / ___ / ___" — acá el mes va en NÚMERO, no en palabra.
const RE_BARRAS_DIA = /(?:fecha|fecha\s+de\s+(?:presentacion|la\s+oferta))\s*:?\s*$/i;
const RE_DESPUES_BARRA = /^\s*[/\-]/;
const RE_ANTES_BARRAS_MES = new RegExp(`(?:\\d{1,2}|${HUECO})\\s*[/\\-]\\s*$`, 'i');
const RE_ANTES_BARRAS_ANIO = new RegExp(`(?:\\d{1,2}|${HUECO})\\s*[/\\-]\\s*(?:\\d{1,2}|${HUECO})\\s*[/\\-]\\s*$`, 'i');

// ── El CÓDIGO de la licitación partido en tres ────────────────────────────────────────────────
// Caso real 2495-17-B226 (FORMULARIO ADMI-1): "…de la licitación pública ID N°____-____-______".
// El organismo imprime los guiones, así que no hay una casilla donde quepa "2495-17-B226" entero:
// son TRES blancos y cada uno lleva su tramo. Misma idea que la fecha partida en día/mes/año.
//
// Cuál de los tres es se deduce contando los guiones que hay entre el rótulo "ID" y el blanco: 0
// guiones = primer tramo, 1 = segundo, 2 = tercero. Se exige que entre medio solo haya huecos,
// guiones y espacios — así una frase cualquiera con un guion no se cuela.
const RE_SOLO_HUECOS_Y_GUIONES = /^[\s.…_-]*$/;

/** Qué tramo del código de licitación es este blanco. `null` si no está en esa fórmula. */
export function campoDeCodigoEnPartes(antes: string, despues: string): Campo | null {
  // Tiene que haber un guion impreso cerca: sin eso es un "ID N° ____" de UNA sola casilla, que ya
  // resuelve el diccionario con `licitacion_codigo` entero y no hay que partir nada.
  if (!/-/.test(despues.slice(0, 40)) && !/-/.test(antes.slice(-40))) return null;
  // El rótulo más cercano al blanco: `[\s\S]*` es codicioso, así que corta en el ÚLTIMO "ID".
  const m = antes.match(/[\s\S]*\b(?:id|c(?:o|ó)digo)\b/i);
  if (!m) return null;
  // Entre el rótulo y el blanco el organismo escribe "N°" ("ID N°____-____"). Sin sacarlo, la
  // comprobación de "solo huecos y guiones" fallaba y la regla no disparaba nunca.
  const cola = antes.slice(m[0].length).replace(/^\s*n[°º.]?\s*/i, '');
  if (!RE_SOLO_HUECOS_Y_GUIONES.test(cola)) return null;
  const guiones = (cola.match(/-/g) || []).length;
  if (guiones === 0) return 'licitacion_codigo_p1' as Campo;
  if (guiones === 1) return 'licitacion_codigo_p2' as Campo;
  if (guiones === 2) return 'licitacion_codigo_p3' as Campo;
  return null;
}

/** Qué pieza de la fecha de firma es este blanco, mirando lo que lo rodea. `null` si no es una. */
export function campoDeFechaEnFormula(antes: string, despues: string): Campo | null {
  // Las barras se prueban PRIMERO y de más específica a menos: "12 / 08 / ___" también calza con
  // el patrón del mes si se prueba al revés, y el año terminaría con el número del mes.
  if (RE_ANTES_BARRAS_ANIO.test(antes)) return 'fecha_hoy_anio' as Campo;
  if (RE_ANTES_BARRAS_MES.test(antes)) return 'fecha_hoy_mes' as Campo;
  if (RE_BARRAS_DIA.test(antes) && RE_DESPUES_BARRA.test(despues)) return 'fecha_hoy_dia' as Campo;

  // El MES va ANTES que el AÑO y el orden es parte de la regla, no un detalle: los dos tienen el
  // mismo `antes` cuando el día todavía está en blanco ("……… de ⟦?⟧"). Lo único que los separa es
  // que al mes le sigue un "de <año>" y al año no. Probar el mes primero y el año como "lo que
  // queda" resuelve los dos sin ambigüedad; al revés, el año se llevaría también al mes.
  if (RE_ANTES_MES_PALABRA.test(antes) && RE_DESPUES_MES_PALABRA.test(despues)) return 'fecha_hoy_mes_palabra' as Campo;
  if (RE_ANTES_ANIO.test(antes) && !RE_DESPUES_MES_PALABRA.test(despues)) return 'fecha_hoy_anio' as Campo;
  if (RE_ANTES_DIA.test(antes) && RE_DESPUES_DIA.test(despues)) return 'fecha_hoy_dia' as Campo;
  return null;
}

export function campoDeBlancoInline(b: CandidatoInline): Campo | null {
  if (b.textoMarcador) {
    // BUG REAL (28-ago-2026, ANEXO N°2B, 2928-17-LE26): "indique dirección, comuna y región",
    // "indique ID de licitación" — el verbo de instrucción bloqueaba el marcador ANTES de mirar
    // si de verdad nombraba un dato conocido, así que "indique" + [dato real] quedaba tan
    // pendiente como "[indicar en esta casilla el número o nombre del documento…]", que sí es
    // genuinamente libre. En el español burocrático chileno "indique"/"señale" casi siempre
    // significa "escriba aquí", no "redacte usted el contenido" — la señal real de que es libre
    // es que NO calce con ningún campo conocido. Se prueba REGLAS_MARCADOR primero (con el
    // marcador tal cual, instrucción incluida — las reglas no necesitan que se les pele el verbo)
    // y el bloqueo por instrucción queda de red de seguridad, solo para lo que de verdad no
    // matchea nada.
    const m = REGLAS_MARCADOR.find(r => r.re.test(b.textoMarcador!));
    if (m) return m.campo;
    if (RE_MARCADOR_INSTRUCCION.test(b.textoMarcador)) return null;
  }
  const parrafo = b.parrafoCompleto ?? b.contexto ?? '';
  const pos = b.posEnParrafo ?? b.posEnTexto ?? 0;
  if (esBloqueDeTercero(parrafo)) return null;
  const antes = parrafo.slice(0, pos);
  if (!antes.trim()) return null;
  const despues = parrafo.slice(pos + (b.largo || 0));

  // Localidad de firma: "En ______ a 12 de agosto de 2026".
  if (RE_LOCALIDAD_FIRMA.test(antes) && RE_SIGUE_FECHA.test(despues)) return 'licitacion_comuna';

  // FÓRMULA DE FECHA DE FIRMA, pieza por pieza. Ver campoDeFechaEnFormula: es el hallazgo más
  // grande del muestreo de 1.500 documentos (31-ago-2026) y va ANTES de REGLAS_PREVIAS y de la
  // etiqueta con dos puntos porque las dos resuelven de menos acá: "Fecha: ___ / ___ / ___" caía
  // en la etiqueta "Fecha:" y devolvía la fecha COMPLETA para la primera de tres casillas.
  const enFormula = campoDeFechaEnFormula(antes, despues);
  if (enFormula) return enFormula;

  // "ID N°____-____-______": tres blancos, un tramo del código en cada uno.
  const tramo = campoDeCodigoEnPartes(antes, despues);
  if (tramo) return tramo;

  const regla = REGLAS_PREVIAS.find(r => r.re.test(antes));
  if (regla) return regla.campo;

  // Blanco que sigue a una ETIQUETA con dos puntos ("Nombre o Razón Social: ____", "ID
  // LICITACIÓN: ____", "Cargo: ____"). Es el mismo problema de la capa 1 pero escrito en prosa, así
  // que se resuelve con el MISMO diccionario en vez de duplicar reglas: medido en 1058086-43-LP26,
  // donde seis casillas de un bloque de contacto quedaban pendientes solo por venir inline.
  //
  // BUG REAL atrapado por el propio banco de pruebas: excluir solo \n\t·; no bastaba. Cuando el
  // blanco ANTERIOR del mismo párrafo es una raya de guiones bajos literal ("Nombre: ___Cargo:
  // ___"), esos guiones bajos entran en la clase de caracteres permitidos y el regex, al probar
  // desde el inicio del párrafo, capturaba "Nombre: ___...Cargo" ENTERO como si fuera una sola
  // etiqueta — normalizada a algo que no calza con nada, perdiendo un campo real. Excluir el
  // guion bajo (y limitar a una sola línea de "palabras") obliga a que el match empiece DESPUÉS
  // de la raya anterior, en la etiqueta inmediatamente pegada al blanco actual.
  const etiqueta = antes.match(/[\p{L}\p{N} .()°ºª/-]{2,60}:\s*$/u)?.[0];
  // Si la etiqueta con dos puntos NO resuelve, se sigue probando el rótulo entre paréntesis de más
  // abajo en vez de rendirse: caso real "FIRMA: ______ (Rut de Empresa)", donde la etiqueta con
  // ":" es genérica ("Firma") y el dato real lo dice el paréntesis.
  if (etiqueta) {
    const campo = campoDeEtiquetaInequivoca(etiqueta);
    if (campo) return campo;
  }

  // BUG REAL (18-ago-2026, "Formatos Esmaltes" de La Serena): el organismo rotula la casilla con un
  // PARÉNTESIS en vez de una etiqueta con dos puntos — "_________ (Razón social empresa)",
  // "________ (Rut representante legal)". El match de arriba exige que el texto termine en ":", así
  // que estas casillas no llegaban nunca al diccionario y quedaban en blanco pese a que el propio
  // documento decía qué campo va ahí. Se prueba tanto ANTES como DESPUÉS del blanco porque el
  // paréntesis-rótulo suele ir DEBAJO/al lado de la raya, no delante. Solo AGREGA resolución: si el
  // paréntesis no nombra un campo conocido, `campoDeEtiquetaInequivoca` devuelve null igual que antes.
  const RE_ROTULO_PARENTESIS = /\(([^()]{2,60})\)\s*$/;
  const rotuloAntes = antes.match(RE_ROTULO_PARENTESIS)?.[0];
  if (rotuloAntes) {
    const campo = campoDeEtiquetaInequivoca(rotuloAntes);
    if (campo) return campo;
  }
  const rotuloDespues = despues.match(/^\s*\(([^()]{2,60})\)/)?.[0];
  return rotuloDespues ? campoDeEtiquetaInequivoca(rotuloDespues) : null;
}

// Nombre de cada campo de la ficha tal como lo ve el usuario en la pantalla de Empresas — para
// que el aviso diga "Falta Razón social en la ficha" y no "falta razon_social". Lo que no esté
// acá cae a una versión legible del nombre técnico, que igual se entiende.
const NOMBRE_HUMANO_CAMPO: Record<string, string> = {
  razon_social: 'Razón social', rut: 'RUT', direccion: 'Dirección', region: 'Región', giro: 'Giro',
  tipo_persona_juridica: 'Tipo de persona jurídica', fecha_sociedad: 'Fecha de la sociedad',
  fecha_escritura: 'Fecha de escritura', notaria: 'Notaría', numero_repertorio: 'N° de repertorio',
  fojas_numero_anio: 'Fojas / número / año',
  representante_nombre: 'Nombre del representante legal', representante_rut: 'RUT del representante legal',
  representante_cargo: 'Cargo del representante legal', representante_profesion: 'Profesión u oficio del representante',
  email1: 'Email de contacto', telefono1: 'Teléfono de contacto',
  banco_tipo_cuenta: 'Tipo de cuenta bancaria', banco_numero: 'N° de cuenta bancaria',
  banco_nombre: 'Banco', banco_email: 'Email para el banco',
  banco_titular_nombre: 'Titular de la cuenta', banco_titular_rut: 'RUT del titular de la cuenta',
  // Estos NO son de la ficha — los trae la API de Mercado Público (ver esDatoDeLaLicitacion).
  licitacion_codigo: 'Código de la licitación', licitacion_nombre: 'Nombre de la licitación',
  licitacion_organismo: 'Organismo comprador', licitacion_organismo_rut: 'RUT del organismo',
  licitacion_comuna: 'Comuna del organismo', licitacion_region: 'Región del organismo',
  licitacion_unidad_compradora: 'Unidad compradora',
};
/** Los `licitacion_*` no son de la ficha: los trae la API de Mercado Público en cada análisis. */
export function esDatoDeLaLicitacion(campo: string | Campo): boolean {
  return String(campo).startsWith('licitacion_');
}

export function nombreHumanoDeCampo(campo: string | Campo): string {
  const c = String(campo);
  return NOMBRE_HUMANO_CAMPO[c] ?? c.replace(/_/g, ' ');
}

// ── Guardarraíl anti-invención ───────────────────────────────────────────────────────────────
// Se conserva del diseño anterior: si el campo elegido no tiene un valor real en la ficha, la
// casilla queda PENDIENTE. Es peor un dato equivocado en una declaración jurada que uno vacío.
function valorDe(empresa: EmpresaCampos, campo: Campo): string | null {
  const v = empresa[campo];
  if (v == null) return null;
  const s = String(v).trim();
  return s ? s : null;
}

// Las tres partes sueltas de la fecha solo tienen sentido dentro de un triplete, que ya se resuelve
// entero y determinista antes de llegar acá (detectarTripletesFecha). Si alguna regla las propone
// para una celda suelta, queda un número huérfano en el documento sin nada que lo explique.
//
// LA ÚNICA EXCEPCIÓN (31-ago-2026) es campoDeFechaEnFormula: ese camino no "propone" la pieza a
// partir de una etiqueta, la DEDUCE de la frase completa mirando lo que hay antes Y después del
// blanco ("…a ___ de agosto de 2026"). Ahí el triplete existe, solo que escrito en prosa en vez de
// en tres celdas, así que el número nunca queda huérfano. Sin esta excepción el bloque de fecha
// resolvía el campo y `anotar` lo tiraba igual: medido, el 60+ licitaciones de mejora se quedaba
// en +0,4%.
const SOLO_TRIPLETE = new Set<Campo>(['fecha_hoy_dia', 'fecha_hoy_mes', 'fecha_hoy_anio', 'fecha_hoy_mes_palabra'] as Campo[]);

// ── Clasificación del PENDIENTE ──────────────────────────────────────────────────────────────
// Una casilla que no se resolvió no es toda igual: la UI decide con esto si la muestra pidiendo un
// dato o si la calla por ser un título. Ante la duda entre título y campo, gana título: una casilla
// de más que el humano llena cuesta menos que un dato suelto a mitad del documento.
const RE_TITULO = /^(?:antecedentes|identificacion|datos|propuesta|oferta|declaracion|anexo|formulario|seccion|i+\.?|[ivx]+)\b/;
const RE_ESPECIFICO = /\b(precio|valor|monto|total|neto|iva|cantidad|unidad|plazo|dias|marca|modelo|especificacion|caracteristica|cumple|catalogo|item|producto|servicio|garantia|dimension|codigo del producto)\b/;
const RE_DECISION = /\b(marque|marcar|con una x|describa|describ|indique|senale|detalle|explique|justifique|seleccione)\b/;
const RE_TERCERO = /\b(cliente|mandante|contraparte|quien certifica|emisor del certificado|contratante)\b/;
// La etiqueta propia de la casilla es SOLO la palabra de la columna — anclada a los dos extremos a
// propósito: "SI" es una casilla para marcar, "SI CORRESPONDE" o "no aplica al oferente" no.
const RE_CASILLA_MARCAR = /^(?:si|no|si\s*\/\s*no|cumple|no cumple|aplica|no aplica|acompana|adjunta)$/;

export function clasificarPendiente(etiqueta: string): { categoria: CategoriaCampo; motivo: string } {
  const n = normalizarEtiqueta(etiquetaPropia(etiqueta));
  if (!n) {
    return { categoria: 'especifico_licitacion', motivo: 'Casilla sin etiqueta ni contexto alrededor — hay que revisarla directamente en el documento.' };
  }
  if (RE_TERCERO.test(n)) {
    return { categoria: 'declaracion_tercero', motivo: 'Debe completarlo y firmarlo un tercero (ej. un cliente anterior), no el oferente.' };
  }
  if (RE_DECISION.test(n)) {
    return { categoria: 'decision_del_usuario', motivo: 'Hay que decidirlo o redactarlo — no se puede inferir de forma segura de la ficha.' };
  }
  if (RE_ESPECIFICO.test(n)) {
    return { categoria: 'especifico_licitacion', motivo: 'Dato específico de esta oferta (precio, cantidad, plazo o especificación técnica) — se intenta cruzar contra el costeo y las bases; si tampoco aparece ahí, hay que escribirlo a mano.' };
  }
  // Columna de MARCAR ("ANTECEDENTE FORMAL | SI | NO", "Cumple | No cumple"). La etiqueta propia de
  // la casilla es literalmente "SI" o "NO", así que no calza con ninguna regla de arriba y caía al
  // fallback callado `no_aplica_al_oferente` — que la pantalla NO muestra.
  //
  // BUG REAL (31-ago-2026, 1954-1-LE26 ANEXO N°5, encontrado con el banco de 17 licitaciones): ese
  // anexo es un checklist de 6 antecedentes (escritura de constitución, certificado de vigencia,
  // RUT de la persona jurídica…) con dos casillas SI/NO cada uno. Las 12 se detectaban y NINGUNA
  // llegaba a la pantalla: el anexo se habría subido con el checklist entero en blanco y sin un
  // solo aviso. Es una decisión del oferente (qué documentos adjunta), nunca un dato de la ficha.
  if (RE_CASILLA_MARCAR.test(n)) {
    return { categoria: 'decision_del_usuario', motivo: 'Casilla para marcar (SÍ/NO): la decide el oferente según los documentos que adjunte.' };
  }
  if (RE_TITULO.test(n) && n.split(' ').length <= 5) {
    return { categoria: 'no_aplica_al_oferente', motivo: 'Es un encabezado o título de sección — anuncia lo que viene abajo, no pide un dato.' };
  }
  // Fallback deliberadamente CALLADO (no_aplica_al_oferente, no especifico_licitacion): una
  // etiqueta que el diccionario no reconoce y que tampoco habla de precio/plazo/decisión es, la
  // mayoría de las veces, un encabezado. Las casillas del patrón 1 se siguen mostrando igual —
  // ese camino ignora la categoría (ver resolverTodo en anexos-rellenar.ts); esta clasificación
  // solo decide si un "Etiqueta:" del patrón 5 llena la pantalla o no.
  return { categoria: 'no_aplica_al_oferente', motivo: 'La etiqueta no corresponde a ningún dato de la ficha de la empresa ni de la licitación — si es una casilla real, complétala a mano.' };
}

// ── Entrada principal ────────────────────────────────────────────────────────────────────────
/**
 * La dirección de la ficha SIN la comuna del final. Se usa solo cuando el mismo párrafo pide la
 * comuna en su propia casilla — ver el uso en resolverDeterminista.
 *
 * Recorta el sufijo en vez de recomponer desde `direccion_calle` + `direccion_numero`: así se
 * conserva EXACTAMENTE el formato que escribió el usuario en la ficha ("Camino El Oliveto N° 575
 * N° 6"), incluidos los "N°" y las oficinas, que una recomposición perdería. Si tras el recorte no
 * queda nada (una ficha cuya dirección es solo el nombre de la comuna), se devuelve la original:
 * antes dejar el dato repetido que dejar la casilla vacía.
 */
export function direccionSinComuna(empresa: EmpresaCampos): string | null {
  const direccion = String((empresa as any).direccion ?? '').trim();
  if (!direccion) return null;
  const comuna = String((empresa as any).comuna ?? '').trim();
  if (!comuna) return direccion;
  const escapada = comuna.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const recortada = direccion
    .replace(new RegExp(`\\s*,?\\s*${escapada}\\s*$`, 'i'), '')
    .replace(/[,;\s]+$/, '')
    .trim();
  return recortada || direccion;
}

/**
 * Índice (etiqueta normalizada → campo) de las correcciones del experto. Se descartan las que
 * nombran un campo que no existe en la ficha: una corrección vieja sobre una columna que ya no
 * está no puede reactivarse como un campo fantasma.
 */
function indexarOverrides(
  overrides: { etiqueta: string; campo: string }[] | undefined, empresa: EmpresaCampos,
): Map<string, Campo> {
  const mapa = new Map<string, Campo>();
  for (const o of overrides || []) {
    if (!(o.campo in empresa)) continue;
    const clave = normalizarEtiqueta(o.etiqueta);
    if (!clave) continue;
    if (!mapa.has(clave)) mapa.set(clave, o.campo as Campo); // el más reciente gana (vienen ordenados)
  }
  return mapa;
}

export function resolverDeterminista(entrada: EntradaDeterminista): ResultadoDeterminista {
  const { candidatos, blancosInline, parrafos, empresa } = entrada;
  const overrides = indexarOverrides(entrada.overridesAprendidos, empresa);
  const campoAprendido = (etiqueta: string): Campo | null =>
    (overrides.size ? overrides.get(normalizarEtiqueta(etiqueta || '')) ?? null : null);
  const celda = new Map<number, Resolucion>();
  const inline = new Map<string, Resolucion>();
  const celdaSinResolver: CandidatoCelda[] = [];
  const inlineSinResolver: CandidatoInline[] = [];

  const bloques = construirBloques(candidatos, parrafos);

  // Tres respuestas, no dos (28-ago-2026 — la causa raíz de "no me llena los campos"):
  //
  //   'auto'   el campo se reconoció Y la ficha tiene el dato → se escribe.
  //   'falta'  el campo se reconoció PERO la ficha no tiene el dato → pendiente ACCIONABLE.
  //   'no'     no se reconoció la etiqueta → sigue a las capas de abajo.
  //
  // Antes 'falta' y 'no' eran el MISMO `return false`, y ahí se perdía la única información que le
  // sirve al usuario. La casilla caía en `celdaSinResolver` y `clasificarPendiente` la rotulaba
  // "La etiqueta no corresponde a ningún dato de la ficha de la empresa ni de la licitación" —
  // literalmente lo contrario de lo que pasaba: el motor SÍ sabía qué dato pedía esa casilla, lo
  // que faltaba era el dato en la ficha. Con ese mensaje no había forma de saber que bastaba con
  // completar la ficha, así que el hueco se descubría recién al abrir el .docx ya generado.
  const faltantesFicha = new Map<string, string>();   // campo → etiqueta donde se pidió
  const anotar = (campo: Campo | null, etiqueta: string, set: (r: Resolucion) => void,
                  desdeFormulaDeFecha = false): 'auto' | 'falta' | 'no' => {
    if (!campo || (SOLO_TRIPLETE.has(campo) && !desdeFormulaDeFecha)) return 'no';
    const valor = valorDe(empresa, campo);
    if (!valor) {
      if (!faltantesFicha.has(String(campo))) faltantesFicha.set(String(campo), etiqueta);
      // El motivo tiene que decir QUÉ HACER, y eso depende de DE DÓNDE sale el dato. Los campos
      // `licitacion_*` no viven en la ficha de la empresa: los trae la API de Mercado Público al
      // abrir el anexo (ver obtenerLicitacionParaAnexo en anexos-datos.ts). Mandar a completarlos
      // en /empresas sería mandar a llenar un campo que no existe en esa pantalla — y cuando
      // faltan, la causa real es que MP no respondió, que se arregla reintentando.
      set({
        tipo: 'pendiente', categoria: CATEGORIA_DE_CAMPO(campo),
        motivo: esDatoDeLaLicitacion(campo)
          ? `No se pudo leer "${nombreHumanoDeCampo(campo)}" desde Mercado Público. Cierra y vuelve a abrir esta pantalla para reintentarlo.`
          : `Falta "${nombreHumanoDeCampo(campo)}" en la ficha de la empresa. Complétalo en Empresas y esta casilla se llena sola.`,
        campo: String(campo),
      } as Resolucion);
      return 'falta';
    }
    set({ tipo: 'auto', valor, categoria: CATEGORIA_DE_CAMPO(campo), evidencia: etiqueta, campo: String(campo) });
    return 'auto';
  };

  for (const c of candidatos) {
    const propia = etiquetaPropia(c.etiqueta);
    const bloque = bloques.get(c.indice);

    // 0. `campoFijo` — ya resuelto por la ESTRUCTURA del documento (asignarCamposDeBloqueFirma:
    //    un "RUT:" colgando de "FIRMA REPRESENTANTE LEGAL:" no admite discusión). Manda sobre todo.
    let campo: Campo | null = (c.campoFijo as Campo | undefined) ?? null;
    // Bloque de un TERCERO (ver RE_BLOQUE_TERCERO): "Nombre / Cargo / Institución" que certifica
    // algo del oferente es la firma de OTRA persona, no la nuestra — "Cargo" ahí es inequívoco
    // como etiqueta pero describe al cargo de esa otra persona. Ninguna capa por debajo de
    // campoFijo puede rellenar con datos de la empresa dentro de este bloque.
    // El bloque de JEFE DE PROYECTO / SUPERVISOR o ADMINISTRADOR DEL CONTRATO se trata igual que el
    // de un tercero: sus etiquetas son las mismas que las del representante legal ("Nombre
    // completo", "Cargo"), pero la persona la designa el asistente para esta licitación. Ver
    // esBloqueDesignadoPorNosotros ("coordinador"/"contraparte técnica" ya no entran acá: se llenan).
    // Solo se mira el CONTEXTO del bloque, nunca la etiqueta propia: "Nombre completo" es idéntico
    // en los dos bloques y es el encabezado lo único que los distingue.
    // Fila 2+ de una grilla numerada de SOCIOS ("2 — Rut Socio"): se corta acá, antes de cualquier
    // capa. Tiene que ir primero porque `etiquetaPropia` ya recortó el "2 — " y el diccionario
    // resolvería la columna igual de bien que en la fila 1 — repitiendo el mismo RUT en las 12
    // filas. Ver esFilaDeSocioPosterior.
    if (esFilaDeSocioPosterior(c.etiqueta)) { celdaSinResolver.push(c); continue; }
    const esTercero = !campo && (
      esBloqueDeTercero(`${propia} ${bloque?.contexto ?? ''} ${(bloque?.etiquetas ?? []).join(' ')}`)
      // SOLO el encabezado MÁS CERCANO, no los 3 párrafos de contexto: en este mismo formulario el
      // bloque "CONTACTO DEL PROPONENTE" viene justo debajo del de "COORDINADOR TÉCNICO", y mirar
      // todo el contexto arrastraba el encabezado del anterior — dejaba en blanco un bloque que SÍ
      // se llena (el contacto del proponente somos nosotros). `construirBloques` arma el contexto
      // con el párrafo más cercano primero, separado por " · ".
      || esBloqueDesignadoPorNosotros(encabezadoDeSeccionMasCercano(parrafos, c.indice))
    );
    // 0b. Corrección aprendida del experto (lápiz de la pantalla, ver anexos-feedback.ts). Va
    //     ANTES del diccionario —el experto está corrigiendo justamente lo que el diccionario dijo—
    //     y DESPUÉS de campoFijo, que es estructura del documento y no admite discusión. Nunca
    //     dentro del bloque de un TERCERO: la corrección se aprendió por el TEXTO de la etiqueta y
    //     no sabe en qué bloque cayó esta vez; rellenar ahí pondría nuestros datos en la firma de
    //     otra persona.
    if (!campo && !esTercero) campo = campoAprendido(propia) ?? campoAprendido(c.etiqueta);
    // 1. Diccionario de etiquetas inequívocas, sobre la etiqueta propia y sobre la compuesta
    //    ("IDENTIFICACIÓN DEL REPRESENTANTE LEGAL — NOMBRE" resuelve por la compuesta).
    if (!campo && !esTercero) campo = campoDeEtiquetaInequivoca(propia) ?? campoDeEtiquetaInequivoca(c.etiqueta.replace(/\s+—\s+/g, ' '));
    // 1b. Coherencia de TITULAR dentro del bloque, solo para el RUT pelado.
    //
    // BUG REAL (2724-35-LP26, ANEXO N°1, bloque "B) DATOS DEL CONTACTO DEL OFERENTE"): ese bloque
    // pide "Nombre completo / Rut / Cargo" de la PERSONA de contacto. "Nombre completo" y "Cargo"
    // salen bien (la persona), pero "Rut" salía con el RUT de la EMPRESA — un bloque con el nombre
    // de una persona y el RUT de otra. La causa es de orden: el RUT pelado calza con una entrada
    // del diccionario de la capa 1 (`^r u t${OFERENTE}$`, sufijo OPCIONAL), así que se resuelve
    // como dato de empresa y nunca llega a la capa 2 que sí mira el bloque — pese a que la
    // doctrina escrita de la capa 1 dice que "Nombre", "RUT" o "Cargo" a secas NO van ahí.
    //
    // El arreglo no invierte el orden de las capas (eso mandaría a la persona el RUT de cualquier
    // tabla de identificación con "Nombre o Razón Social" al lado, que es el patrón más común del
    // país): solo exige COHERENCIA cuando el mismo bloque trae la otra etiqueta pelada del par.
    // Si el "Nombre" pelado hermano describe a la PERSONA, el "RUT" pelado describe a la MISMA
    // persona — son las dos casillas del mismo titular. Cuando la hermana no es pelada
    // ("Nombre o Razón Social", "Razón social del oferente"), esto no se activa y el RUT sigue
    // siendo el de la empresa, como hasta ahora.
    if (campo === 'rut' && !esTercero && bloque && RE_PELADA_RUT.test(normalizarEtiqueta(propia))) {
      const hermanaNombre = bloque.etiquetas.find(h => RE_PELADA_NOMBRE.test(h));
      const titularDelNombre = hermanaNombre
        ? resolverPeladaPorBloque(hermanaNombre, bloque.etiquetas, bloque.contexto, RE_CTX_PERSONA.test(bloque.contexto))
        : null;
      if (titularDelNombre === 'representante_nombre') campo = 'representante_rut';
    }
    // 1c. Los SUBCAMPOS del domicilio pelados ("N°", "Oficina") solo significan eso DENTRO de un
    //     bloque de dirección.
    //
    // BUG REAL (2495-17-B226, encontrado revisando el documento generado): la tabla de socios
    // tiene una columna "Nº" que es el NÚMERO DE FILA, y la casilla salía con "492 Of.78" — el
    // número de la calle de la empresa, metido en la fila de totales de un registro societario.
    // "N°" como encabezado de columna es de lo más común que existe (numerar filas), así que la
    // entrada del diccionario `^n[°º]$` no puede resolver sola.
    //
    // Las formas EXPLÍCITAS ("Número de la calle", "N° del domicilio") no pasan por acá: ya dicen
    // de qué son y siguen resolviendo como siempre. Lo que se exige contexto es lo pelado.
    if (campo && RE_SUBCAMPO_DOMICILIO_PELADO.test(normalizarEtiqueta(propia))
        && (campo === 'direccion_numero' || campo === ('direccion_oficina' as Campo))) {
      const enBloqueDeDireccion = (bloque?.etiquetas ?? []).some(h => RE_HERMANA_DOMICILIO.test(h))
        || RE_HERMANA_DOMICILIO.test(bloque?.contexto ?? '');
      if (!enBloqueDeDireccion) campo = null;
    }

    // 2. Etiqueta pelada, desambiguada por el bloque.
    if (!campo && !esTercero && bloque) {
      campo = resolverPeladaPorBloque(c.etiqueta, bloque.etiquetas, bloque.contexto, RE_CTX_PERSONA.test(bloque.contexto));
    }
    // 6. Política fija: programa de integridad siempre "SÍ".
    // La etiqueta manda sobre el contexto: si nombra un dato concreto y distinto (una fecha, una
    // ciudad, un RUT), no es la casilla de la pregunta de integridad por más que el bloque entero
    // hable de eso — ver RE_ETIQUETA_PIDE_OTRO_DATO.
    // BUG REAL (2495-17-B226, FORMULARIO ADMI-4, 31-ago-2026): el documento generado salía con
    // "DATOS DEL PROPONENTE: SÍ" — un "SÍ" pegado al ENCABEZADO de la tabla de identificación,
    // dentro de un formulario que en su conjunto habla de Programa de Integridad. Mientras tanto,
    // las tres opciones reales ("Marque con X según corresponda") quedaban sin tocar.
    //
    // Es el MISMO patrón del bug de "contraparte" (2928-17-LE26): la condición se prueba contra el
    // BLOQUE ENTERO y no contra la casilla puntual, así que cualquier casilla del formulario hereda
    // el tema del formulario. Acá el guardarraíl no puede ser "etiqueta en mayúsculas = no", porque
    // una casilla legítima se rotula "PROGRAMA DE INTEGRIDAD:" y también va en mayúsculas.
    //
    // La regla exacta: si la etiqueta ES un encabezado de sección, tiene que nombrar la integridad
    // ELLA MISMA — el contexto de alrededor no se la presta. Una pregunta escrita en prosa
    // ("¿Cuenta la empresa con un programa…?") no es encabezado y sigue resolviéndose por contexto.
    const etiquetaEsEncabezado = RE_ENCABEZADO_SECCION.test(String(propia).trim());
    if (!campo && !RE_ETIQUETA_PIDE_OTRO_DATO.test(normalizarEtiqueta(propia))
        && esPreguntaDeIntegridad(etiquetaEsEncabezado ? propia : `${c.etiqueta} ${bloque?.contexto ?? ''}`)) {
      campo = 'programa_integridad_respuesta' as Campo;
    }

    // 'falta' ya dejó el pendiente accionable en el mapa: no se manda a las capas de abajo, porque
    // el dato que pide esta casilla ya está identificado — lo que hay que hacer es llenar la ficha,
    // no seguir adivinando otro campo.
    if (anotar(campo, propia, r => celda.set(c.indice, r)) !== 'no') continue;
    celdaSinResolver.push(c);
  }

  // Se resuelven TODOS los campos antes de escribir ninguno: la dirección necesita saber si el
  // MISMO párrafo pide además la comuna por separado (ver direccionSinComuna).
  // Mismo orden de prioridad que en las celdas: la corrección aprendida del experto manda sobre el
  // diccionario. Acá la "etiqueta" es el marcador (`<RAZÓN SOCIAL>`) o el texto que rodea al
  // blanco — nunca el placeholder vacío, que `esEtiquetaAprendible` ya dejó fuera al guardar.
  const camposInline = blancosInline.map(b => {
    const aprendido = campoAprendido(b.textoMarcador || b.contexto || '');
    const campo = aprendido ?? campoDeBlancoInline(b);
    // En el camino INLINE las tres piezas sueltas de la fecha solo las puede devolver
    // campoDeFechaEnFormula: ninguna otra regla de acá (marcador, previa, diccionario) las
    // propone — todas devuelven `fecha_hoy` entera. Por eso el flag se deduce del propio campo en
    // vez de arrastrar un segundo valor de retorno por todo campoDeBlancoInline.
    return { b, campo, desdeFormulaDeFecha: !aprendido && !!campo && SOLO_TRIPLETE.has(campo) };
  });
  const parrafosQuePidenComunaAparte = new Set(
    camposInline.filter(x => x.campo === 'comuna' || x.campo === 'ciudad').map(x => x.b.indiceParrafo),
  );

  for (const { b, campo, desdeFormulaDeFecha } of camposInline) {
    const clave = `${b.indiceRun}:${b.posEnTexto}`;
    const etiqueta = (b.textoMarcador || b.contexto || '').slice(0, 120);
    // "con domicilio en <domicilio>, <comuna>, <ciudad>" → el campo `direccion` de la ficha YA trae
    // la comuna adentro ("Camino El Oliveto N° 575 N° 6, Talagante"), así que al llenar los tres
    // marcadores salía "…, Talagante, Talagante, Talagante" (caso real reportado por el usuario en
    // el ANEXO N°4 de 1247197-54-LE26). Cuando el propio párrafo pide la comuna en su propia
    // casilla, la dirección va SIN ella: cada dato aparece una sola vez, que es como lo escribiría
    // un humano. Si el párrafo NO pide comuna aparte, la dirección va completa como siempre.
    if (campo === 'direccion' && parrafosQuePidenComunaAparte.has(b.indiceParrafo)) {
      const valor = direccionSinComuna(empresa);
      if (valor) {
        inline.set(clave, { tipo: 'auto', valor, categoria: 'perfil_empresa', evidencia: etiqueta, campo: 'direccion' });
        continue;
      }
    }
    if (anotar(campo, etiqueta, r => inline.set(clave, r), desdeFormulaDeFecha) !== 'no') continue;
    inlineSinResolver.push(b);
  }

  return {
    celda, inline, celdaSinResolver, inlineSinResolver,
    faltantesFicha: [...faltantesFicha.entries()].map(([campo, etiqueta]) => ({
      campo, nombre: nombreHumanoDeCampo(campo), etiqueta,
      origen: esDatoDeLaLicitacion(campo) ? 'licitacion' as const : 'ficha' as const,
    })),
  };
}
