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
}

export interface ResultadoDeterminista {
  celda: Map<number, Resolucion>;
  inline: Map<string, Resolucion>;
  /** Lo que el diccionario no cubrió — va al respaldo IA si está habilitado, si no, al humano. */
  celdaSinResolver: CandidatoCelda[];
  inlineSinResolver: CandidatoInline[];
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
    /^(?:n[°º]?\s*)?cedula de identidad o rut$/, /^c\s*i\s*o\s*r\s*u\s*t$/,
    /^(?:n[°º]?\s*)?rut o cedula de identidad$/,
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
  { campo: 'direccion_numero', patrones: [/^n[°º]$/, /^numero$/, /^nro$/, /^numero de (?:la )?(?:calle|direccion|domicilio)$/] },
  { campo: 'comuna', patrones: [/^comuna$/, new RegExp(`^comuna${OFERENTE}$`)] },
  { campo: 'ciudad', patrones: [/^ciudad$/, new RegExp(`^ciudad${OFERENTE}$`), /^localidad$/] },
  { campo: 'region', patrones: [/^region$/, /^region y comuna$/, /^ciudad y region$/, /^region\/comuna$/] },
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

  // ── Constitución ──
  { campo: 'fecha_escritura', patrones: [/^fecha (?:de (?:la )?)?escritura(?: publica)?(?: de constitucion)?$/] },
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
  ] },
  { campo: 'representante_nombres', patrones: [/^nombres$/, /^nombres? de pila$/] },
  { campo: 'representante_apellidos', patrones: [/^apellidos$/, /^apellido paterno y materno$/] },
  { campo: 'representante_rut', patrones: [
    new RegExp(`^(?:rut|r\\s*u\\s*t|run|cedula(?:\\s+de\\s+identidad)?|c\\s*i)${REPRE}$`),
    /^cedula de identidad(?: n[°º]?)?$/, /^c i n[°º]?$/, /^run$/, /^numero de (?:cedula|run)$/,
    /^rut representante$/, /^(?:n[°º]?\s*(?:de\s+)?)?cedula (?:nacional )?de identidad(?: nacional)?$/,
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
  ] },
];

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

const RE_CTX_PERSONA = /\b(representante(\s+legal)?|apoderado|declarante|firmante|don|dona|suscribe|persona natural|encargado|administrador de contrato|contacto)\b/;

// BUG REAL (18-ago-2026, FORMULARIO N°1 de 1063538-204-LE26): el bloque "COORDINADOR TÉCNICO" trae
// las etiquetas peladas "Nombre completo", "Cargo o función", "Correo electrónico" — las mismas del
// bloque del representante legal que viene justo arriba. La capa 2 las resolvió por contexto
// (RE_CTX_PERSONA matchea "encargado"/"contacto") y escribió los datos del REPRESENTANTE en el
// coordinador. Regla del usuario, explícita: "en el coordinador técnico no se pone nada, eso lo
// llena el asistente" — es una persona que se designa PARA ESA licitación (con su teléfono directo,
// su cargo real en el proyecto), no un dato de la ficha de la empresa. Escribir ahí a la
// representante legal es un dato equivocado en un documento que el organismo usa para contactar.
//
// Va como bloqueo DURO (misma familia que esBloqueDeTercero): ninguna capa por debajo de campoFijo
// rellena dentro de un bloque así. La casilla queda pendiente, que es exactamente lo que se busca.
const RE_BLOQUE_DESIGNADO_POR_NOSOTROS = /\b(coordinador|contraparte\s+tecnica|jefe\s+de\s+proyecto|supervisor\s+del\s+contrato|administrador\s+del\s+contrato)\b/;

/** ¿Este bloque describe a alguien que el asistente designa para ESTA licitación, y no a la empresa
 *  ni a su representante legal? Ver RE_BLOQUE_DESIGNADO_POR_NOSOTROS. */
export function esBloqueDesignadoPorNosotros(texto: string): boolean {
  return RE_BLOQUE_DESIGNADO_POR_NOSOTROS.test(normalizarEtiqueta(texto));
}

// Un ENCABEZADO DE SECCIÓN dentro de una tabla de identificación: línea corta, en mayúsculas y casi
// siempre terminada en ":" ("DATOS DEL PROPONENTE:", "REPRESENTANTE LEGAL:", "COORDINADOR TECNICO*:",
// "CONTACTO DEL PROPONENTE:"). Se distingue de una etiqueta de campo ("Nombre completo") porque esta
// última va en minúsculas o Capitalizada.
const RE_ENCABEZADO_SECCION = /^[^a-z]{4,60}$/;

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
  for (const c of orden) {
    if (actual.length && c.indice - actual[actual.length - 1].indice > GAP) cerrar();
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
  { re: /id\s+de\s+mercado\s+p(?:u|ú)blico|id\s+licitaci(?:o|ó)n/i, campo: 'licitacion_codigo' },
  { re: /nombre\s+(?:de\s+la\s+)?licitaci(?:o|ó)n/i, campo: 'licitacion_nombre' },
  { re: /^\s*fecha\s*$/i, campo: 'fecha_hoy' },
  // BUG REAL (18-ago-2026, ANEXO N°4 de 1247197-54-LE26): esta regla mandaba CUALQUIER marcador
  // que dijera "comuna"/"ciudad" a la comuna del ORGANISMO comprador. En "con domicilio en
  // <domicilio>, <comuna>, <ciudad> en representación de…" el resultado fue
  // "Camino El Oliveto N° 575 N° 6, Talagante, CONCHALÍ, CONCHALÍ" — la comuna de la
  // Municipalidad de Conchalí metida dentro del domicilio de una empresa de Talagante.
  // La comuna del organismo SOLO aplica en la localidad de firma ("En ____, a 12 de agosto"), y
  // ese caso ya lo resuelve RE_LOCALIDAD_FIRMA ANTES de llegar acá (ver campoDeBlancoInline). Un
  // marcador que dice "comuna" a secas, en medio de una frase, es la comuna del OFERENTE.
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
const RE_BLOQUE_TERCERO = /\b(instituci(?:o|ó)n|cliente|mandante|contraparte|quien\s+certifica|emisor\s+del\s+certificado|contratante|entidad\s+que\s+certifica|extiende\s+el\s+certificado|persona\s+que\s+extiende|certificad[oa]\s+por|recibi[oó]\s+el\s+servicio|organismo\s+que\s+recibi[oó]|qui[eé]n\s+emite)\b/i;
// El guion bajo es \w para el motor de regex, así que "___Institución" no tiene frontera de
// palabra ANTES de la I (\w seguido de \w no es \b) y el \b de arriba nunca dispara. Se prueba
// sobre el texto con las rayas de relleno ya convertidas a espacio, nunca sobre el crudo.
const esBloqueDeTercero = (texto: string) => RE_BLOQUE_TERCERO.test(texto.replace(/_+/g, ' '));

/** Campo que pide un blanco a mitad de oración, por lo que el documento dice ANTES de él. */
export function campoDeBlancoInline(b: CandidatoInline): Campo | null {
  if (b.textoMarcador) {
    if (RE_MARCADOR_INSTRUCCION.test(b.textoMarcador)) return null;
    const m = REGLAS_MARCADOR.find(r => r.re.test(b.textoMarcador!));
    if (m) return m.campo;
  }
  const parrafo = b.parrafoCompleto ?? b.contexto ?? '';
  const pos = b.posEnParrafo ?? b.posEnTexto ?? 0;
  if (esBloqueDeTercero(parrafo)) return null;
  const antes = parrafo.slice(0, pos);
  if (!antes.trim()) return null;
  const despues = parrafo.slice(pos + (b.largo || 0));

  // Localidad de firma: "En ______ a 12 de agosto de 2026".
  if (RE_LOCALIDAD_FIRMA.test(antes) && RE_SIGUE_FECHA.test(despues)) return 'licitacion_comuna';

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
const SOLO_TRIPLETE = new Set<Campo>(['fecha_hoy_dia', 'fecha_hoy_mes', 'fecha_hoy_anio', 'fecha_hoy_mes_palabra'] as Campo[]);

// ── Clasificación del PENDIENTE ──────────────────────────────────────────────────────────────
// Una casilla que no se resolvió no es toda igual: la UI decide con esto si la muestra pidiendo un
// dato o si la calla por ser un título. Ante la duda entre título y campo, gana título: una casilla
// de más que el humano llena cuesta menos que un dato suelto a mitad del documento.
const RE_TITULO = /^(?:antecedentes|identificacion|datos|propuesta|oferta|declaracion|anexo|formulario|seccion|i+\.?|[ivx]+)\b/;
const RE_ESPECIFICO = /\b(precio|valor|monto|total|neto|iva|cantidad|unidad|plazo|dias|marca|modelo|especificacion|caracteristica|cumple|catalogo|item|producto|servicio|garantia|dimension|codigo del producto)\b/;
const RE_DECISION = /\b(marque|marcar|con una x|describa|describ|indique|senale|detalle|explique|justifique|seleccione)\b/;
const RE_TERCERO = /\b(cliente|mandante|contraparte|quien certifica|emisor del certificado|contratante)\b/;

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

export function resolverDeterminista(entrada: EntradaDeterminista): ResultadoDeterminista {
  const { candidatos, blancosInline, parrafos, empresa } = entrada;
  const celda = new Map<number, Resolucion>();
  const inline = new Map<string, Resolucion>();
  const celdaSinResolver: CandidatoCelda[] = [];
  const inlineSinResolver: CandidatoInline[] = [];

  const bloques = construirBloques(candidatos, parrafos);

  const anotar = (campo: Campo | null, etiqueta: string, set: (r: Resolucion) => void): boolean => {
    if (!campo || SOLO_TRIPLETE.has(campo)) return false;
    const valor = valorDe(empresa, campo);
    if (!valor) return false;
    set({ tipo: 'auto', valor, categoria: CATEGORIA_DE_CAMPO(campo), evidencia: etiqueta });
    return true;
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
    // El bloque del COORDINADOR TÉCNICO (y equivalentes) se trata igual que el de un tercero: sus
    // etiquetas son las mismas que las del representante legal ("Nombre completo", "Cargo"), pero
    // la persona la designa el asistente para esta licitación. Ver esBloqueDesignadoPorNosotros.
    // Solo se mira el CONTEXTO del bloque, nunca la etiqueta propia: "Nombre completo" es idéntico
    // en los dos bloques y es el encabezado lo único que los distingue.
    const esTercero = !campo && (
      esBloqueDeTercero(`${propia} ${bloque?.contexto ?? ''} ${(bloque?.etiquetas ?? []).join(' ')}`)
      // SOLO el encabezado MÁS CERCANO, no los 3 párrafos de contexto: en este mismo formulario el
      // bloque "CONTACTO DEL PROPONENTE" viene justo debajo del de "COORDINADOR TÉCNICO", y mirar
      // todo el contexto arrastraba el encabezado del anterior — dejaba en blanco un bloque que SÍ
      // se llena (el contacto del proponente somos nosotros). `construirBloques` arma el contexto
      // con el párrafo más cercano primero, separado por " · ".
      || esBloqueDesignadoPorNosotros(encabezadoDeSeccionMasCercano(parrafos, c.indice))
    );
    // 1. Diccionario de etiquetas inequívocas, sobre la etiqueta propia y sobre la compuesta
    //    ("IDENTIFICACIÓN DEL REPRESENTANTE LEGAL — NOMBRE" resuelve por la compuesta).
    if (!campo && !esTercero) campo = campoDeEtiquetaInequivoca(propia) ?? campoDeEtiquetaInequivoca(c.etiqueta.replace(/\s+—\s+/g, ' '));
    // 2. Etiqueta pelada, desambiguada por el bloque.
    if (!campo && !esTercero && bloque) {
      campo = resolverPeladaPorBloque(c.etiqueta, bloque.etiquetas, bloque.contexto, RE_CTX_PERSONA.test(bloque.contexto));
    }
    // 6. Política fija: programa de integridad siempre "SÍ".
    if (!campo && esPreguntaDeIntegridad(`${c.etiqueta} ${bloque?.contexto ?? ''}`)) campo = 'programa_integridad_respuesta' as Campo;

    if (anotar(campo, propia, r => celda.set(c.indice, r))) continue;
    celdaSinResolver.push(c);
  }

  // Se resuelven TODOS los campos antes de escribir ninguno: la dirección necesita saber si el
  // MISMO párrafo pide además la comuna por separado (ver direccionSinComuna).
  const camposInline = blancosInline.map(b => ({ b, campo: campoDeBlancoInline(b) }));
  const parrafosQuePidenComunaAparte = new Set(
    camposInline.filter(x => x.campo === 'comuna' || x.campo === 'ciudad').map(x => x.b.indiceParrafo),
  );

  for (const { b, campo } of camposInline) {
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
        inline.set(clave, { tipo: 'auto', valor, categoria: 'perfil_empresa', evidencia: etiqueta });
        continue;
      }
    }
    if (anotar(campo, etiqueta, r => inline.set(clave, r))) continue;
    inlineSinResolver.push(b);
  }

  return { celda, inline, celdaSinResolver, inlineSinResolver };
}
