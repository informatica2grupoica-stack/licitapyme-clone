// app/lib/anexos-diccionario.ts
// Frente E.1 — cruza una etiqueta detectada en el Word ("Razón social", "RUT"...) contra los
// datos reales de la empresa (tabla `empresas`). A propósito es CONSERVADOR: varias etiquetas
// se repiten en un mismo documento con significados distintos según el bloque en que caen
// ("Nombre" y "Cédula de identidad" aparecen tanto para el representante legal como para el
// director del estudio, en documentos reales) — sin detectar en qué bloque cae cada una, un
// diccionario ciego adivinaría mal la segunda vez. Por eso esas etiquetas ambiguas NO están
// en este diccionario (ni "Nombre" ni "Correo electrónico" a secas): solo entran las que, tal
// cual vienen escritas, ya dicen a QUIÉN describen (empresa, representante legal, o banco) —
// nunca se inventan, quedan siempre en categoría B (humano completa) o van al respaldo IA
// (ver anexos-ia-matching.ts) si ni así calzan.
export interface EmpresaCampos {
  razon_social: string | null;
  rut: string | null;
  direccion: string | null;
  region: string | null;
  giro: string | null;
  tipo_persona_juridica: string | null;
  fecha_sociedad: string | null;
  representante_nombre: string | null;
  representante_rut: string | null;
  representante_cargo: string | null;
  email1: string | null;
  telefono1: string | null;
  banco_tipo_cuenta: string | null;
  banco_numero: string | null;
  banco_nombre: string | null;
  banco_email: string | null;
  firma_url: string | null;
}

interface EntradaDiccionario {
  campo: keyof EmpresaCampos;
  patrones: RegExp[];   // se prueban en orden; la primera que matchee la etiqueta completa gana
}

// Sufijo opcional "del oferente / de la empresa / del proponente" — en anexos reales de
// distintos organismos la MISMA pregunta viene con cualquiera de estos tres remates ("RUT",
// "RUT del oferente", "RUT. DEL PROPONENTE"…). Encontrado al comparar contra 20 anexos ya
// presentados de verdad (golden set en Downloads, jul-2026): sin este sufijo, "RUT DEL
// OFERENTE:" o "NOMBRE O RAZÓN SOCIAL DEL PROPONENTE" no matcheaban con nada.
const SUFIJO_OFERENTE = '(\\s+(del\\s+|de\\s+la\\s+)?(empresa|oferente|proponente))?';

const DICCIONARIO: EntradaDiccionario[] = [
  { campo: 'razon_social', patrones: [
    new RegExp(`^raz[óo]n\\s+social${SUFIJO_OFERENTE}$`, 'i'),
    // "Nombre COMPLETO o Razón Social" (1057472-89-LE26) — la palabra "completo" de más rompía
    // el patrón de arriba, que exige "nombre" seguido DIRECTO de "o razón social".
    new RegExp(`^nombre\\s+(completo\\s+)?o\\s+raz[óo]n\\s+social${SUFIJO_OFERENTE}$`, 'i'),
    new RegExp(`^nombre\\s+(completo\\s+)?del\\s+(proponente|oferente)\\s+o\\s+raz[óo]n\\s+social$`, 'i'),
    /^empresa$/i,
    /^identificaci[óo]n\s+del\s+oferente$/i,
    // "Proveedor:" es como piden la razón social las actas y órdenes de compra (caso real
    // 4291-38-LP26, FORMULARIO N°4 "ACTA DE CAPACITACIÓN": "Proveedor: _____________").
    /^(nombre\s+del\s+)?proveedor$/i,
  ] },
  { campo: 'rut', patrones: [
    /^rol\s+[úu]nico\s+tributario$/i,
    new RegExp(`^r\\.?u\\.?t\\.?${SUFIJO_OFERENTE}$`, 'i'),
    // "N° Cédula de Identidad o RUT" (1057472-89-LE26) — así piden el RUT de la empresa las
    // bases tipo Mercado Público genérico (formularios que no distinguen persona natural/jurídica
    // en la etiqueta). "N°"/"Nº" con cualquiera de los dos caracteres de grado/ordinal.
    new RegExp(`^n[°º]?\\.?\\s*c[ée]dula\\s+de\\s+identidad\\s+o\\s+r\\.?u\\.?t\\.?${SUFIJO_OFERENTE}$`, 'i'),
  ] },
  { campo: 'direccion', patrones: [
    new RegExp(`^direcci[óo]n(\\s+comercial)?${SUFIJO_OFERENTE}$`, 'i'),
    new RegExp(`^domicilio(\\s+comercial)?${SUFIJO_OFERENTE}$`, 'i'),
  ] },
  { campo: 'region', patrones: [/^regi[óo]n$/i] },
  { campo: 'giro', patrones: [/^giro(\s+comercial)?(\s*\/\s*c[óo]digo\s+sii)?$/i] },
  { campo: 'tipo_persona_juridica', patrones: [/^tipo\s+de\s+persona\s+jur[íi]dica$/i, /^naturaleza\s+jur[íi]dica$/i] },
  { campo: 'fecha_sociedad', patrones: [/^escritura\s+p[úu]blica.*$/i, /^fecha\s+(de\s+)?(la\s+)?sociedad$/i, /^fecha\s+(de\s+)?constituci[óo]n$/i] },
  { campo: 'representante_nombre', patrones: [
    /^nombre\s+(completo\s+)?(del\s+|de\s+)?rep(\.|resentante)?\s*legal$/i,
    /^representante\s+legal$/i,
    /^identificaci[óo]n\s+del\s+rep(\.|resentante)?\s*legal$/i,
  ] },
  { campo: 'representante_rut', patrones: [
    /^r\.?u\.?t\.?\s+(del\s+|de\s+)?rep(\.|resentante)?\s*legal$/i,
    /^c[ée]dula\s+de\s+identidad\s+(del\s+)?rep(\.|resentante)?\s*legal$/i,
  ] },
  { campo: 'representante_cargo', patrones: [/^cargo\s+(del\s+)?rep(\.|resentante)?\s*legal$/i] },
  { campo: 'email1', patrones: [
    new RegExp(`^correo\\s+electr[óo]nico${SUFIJO_OFERENTE}$`, 'i'),
    new RegExp(`^e-?mail${SUFIJO_OFERENTE}$`, 'i'),
  ] },
  { campo: 'telefono1', patrones: [
    new RegExp(`^tel[ée]fono(s)?(\\s+fijo)?${SUFIJO_OFERENTE}$`, 'i'),
    /^fono$/i,
    new RegExp(`^n[°º]?\\.?\\s*de\\s+tel[ée]fono(s)?${SUFIJO_OFERENTE}$`, 'i'),
  ] },
  { campo: 'banco_tipo_cuenta', patrones: [/^tipo\s+de\s+cuenta(\s+bancaria)?$/i] },
  { campo: 'banco_numero', patrones: [/^n[úu]mero\s+de\s+cuenta$/i, /^cuenta\s+(bancaria|corriente)$/i] },
  { campo: 'banco_nombre', patrones: [/^banco$/i] },
  { campo: 'banco_email', patrones: [/^correo\s+(para\s+)?pagos$/i, /^e-?mail\s+de\s+pagos$/i] },
];

// Quita numeración/viñetas al INICIO ("1.1. Nombre o Razón Social" → "Nombre o Razón Social",
// "1.- RUT" → "RUT"), aclaraciones entre paréntesis pegadas al final ("Dirección (Calle, N°,
// Comuna):" → "Dirección") y puntuación colgante al FINAL ("RUT del oferente:" → "RUT del
// oferente") antes de comparar — el diccionario exige match de principio a fin, y los anexos
// reales casi siempre numeran sus campos y cierran con dos puntos. Exige un ESPACIO después del
// separador de numeración para no confundir una abreviatura real ("E-mail") con una viñeta ("a) ").
// El separador de numeración admite HASTA 2 símbolos seguidos (".", "-", ")") porque en anexos
// reales chilenos es común numerar como "1.- " (punto + guion), no solo "1." o "1)" sueltos.
function normalizarParaMatch(etiqueta: string): string {
  return etiqueta
    .trim()
    .replace(/^\(?\d+(?:\.\d+)*[.\-)]{0,2}\s+/, '')
    .replace(/^\(?[a-hA-H]\)\s+/, '')
    .replace(/\s*\([^()]*\)\s*(?=[:.\s]*$)/, '')
    .replace(/[:.\s]+$/, '')
    .trim();
}

export interface Coincidencia { campo: keyof EmpresaCampos; valor: string }

function conValor(campo: keyof EmpresaCampos, empresa: EmpresaCampos): Coincidencia | null {
  const valor = empresa[campo];
  return valor != null && String(valor).trim() ? { campo, valor: String(valor) } : null;
}

// Cuando una etiqueta viene compuesta como "<contexto de fila> — <campo>" (ver
// desambiguarDuplicados en anexos-detectar.ts — pasa cuando el mismo texto corto, ej. "RUT", se
// repite en el documento en bloques distintos), el contexto dice A QUIÉN describe. Si el
// contexto menciona al representante legal, "RUT"/"Nombre"/"Cargo" pelados se redirigen a sus
// campos de representante en vez de los de la empresa — sin este ruteo, "RUT" duplicado nunca
// se resuelve (el diccionario ya usó el campo `rut` con la primera ocurrencia y la segunda queda
// pendiente para siempre, aunque si tengamos el dato).
// Exportados: anexos-detectar.ts los reusa para buscar el rol más cercano en los párrafos REALES
// del documento (ver contextoDeRolCercano) en vez de heredar el candidato vecino en una lista
// plana — mismo vocabulario de roles, una sola fuente de verdad.
export const CONTEXTO_REPRESENTANTE = /(representante\s+legal|rep\.?\s*legal)/i;

// Mismo principio para el bloque de datos bancarios (Tipo de Cuenta / Entidad Bancaria / Nombre
// del Titular / Cédula del Titular / Correo electrónico / Teléfono) — el "Correo electrónico" de
// ESE bloque es el de pagos (banco_email), no el correo general de la empresa (email1).
export const CONTEXTO_BANCARIO = /(banco|cuenta\s+(bancaria|corriente|vista)|entidad\s+bancaria|titular)/i;

// Caso real encontrado (1058086-43-LP26): "Correo Electrónico" se repite en el documento en TRES
// bloques distintos — identificación de la empresa, datos del REPRESENTANTE LEGAL, y datos del
// ADMINISTRADOR DE CONTRATO (una tercera persona de la que no tenemos ningún dato) — el mismo
// patrón se repite con "Nombre"/"Cédula de Identidad"/"Cargo"/"Teléfono". Sin un contexto
// reconocido (representante legal o cuenta bancaria, ambos manejados arriba), rellenar estos
// términos con el dato general de la empresa es EXACTAMENTE el error que este diccionario evita
// a propósito (ver comentario del encabezado del archivo: "Nombre" y "Correo electrónico" a
// secas NO están acá porque describen a quien sea según el bloque) — mejor dejarlo pendiente
// (o que lo intente el respaldo IA, que sí tiene instrucciones explícitas contra esto) que
// escribir el dato de una persona en el campo de otra.
// El sufijo "del Titular" (bloque bancario: Nombre del Titular / Cédula de Identidad del
// Titular) es OTRA forma de decir "sin calificador reconocido" — no tenemos un campo separado
// para el titular de la cuenta (no siempre es la misma persona que el representante legal), así
// que igual debe quedar pendiente en vez de adivinar con representante_nombre/representante_rut.
const SUFIJO_AMBIGUO_SIN_CALIFICAR = '(\\s+del\\s+titular)?';
// "CONTACTO OFERENTE 1 / 2" (caso real 4291-38-LP26) es la PERSONA de contacto que designa el
// oferente — un dato que la ficha de empresa no tiene. Aunque diga "oferente", no equivale a la
// razón social ni al representante legal: sin este término en la lista, la IA lo resolvía igual y
// escribía "Representante" (el valor de representante_cargo) como si fuera el nombre de alguien.
const TERMINOS_AMBIGUOS_SIN_CONTEXTO = new RegExp(
  `^(correo(\\s+electr[óo]nico)?|e-?mail|n[°º]?\\.?\\s*de\\s+tel[ée]fono(s)?|tel[ée]fono(s)?|fono|nombre(\\s+completo)?|c[ée]dula\\s+de\\s+identidad|cargo|contacto(\\s+(del\\s+)?(oferente|proponente|empresa))?(\\s*\\d+)?)${SUFIJO_AMBIGUO_SIN_CALIFICAR}$`,
  'i',
);

// El contexto de una etiqueta compuesta ("<contexto> — <campo>") solo debe BLOQUEAR el campo
// cuando de verdad señala a una PERSONA/ROL distinto del oferente, de la que no tenemos ficha
// (administrador de contrato, encargado, contacto, coordinador...) — casos reales documentados
// arriba. Caso real encontrado (1057472-89-LE26): "Fax — Correo electrónico" bloqueaba el correo
// de la EMPRESA porque "Fax" no calzaba con representante/bancario — pero "Fax" no es una persona,
// es puro ruido: el candidato inmediatamente anterior en una lista plana (ver desambiguarDuplicados
// en anexos-detectar.ts), sin ninguna relación real con el dato pedido. Bloquear ahí no evita un
// error, solo esconde un dato que sí teníamos.
export const CONTEXTO_TERCERO_DESCONOCIDO = /(administrador|encargado|contacto|coordinador|apoderado|ejecutivo)/i;

// Devuelve el campo+valor si la etiqueta cruza con el diccionario Y la empresa tiene ese dato
// cargado; null si no hay match confiable (queda para el respaldo IA o la pantalla de "completar
// a mano").
export function buscarCampo(etiqueta: string, empresa: EmpresaCampos): Coincidencia | null {
  const compuesta = etiqueta.match(/^(.+?)\s+—\s+(.+)$/);
  if (compuesta) {
    const [, contexto, campoTexto] = compuesta;
    const limpio = normalizarParaMatch(campoTexto);
    if (CONTEXTO_REPRESENTANTE.test(contexto)) {
      // "(?:\s+completo)?" — caso real (1057472-89-LE26): bajo "REPRESENTANTE LEGAL:" el campo se
      // pide como "Nombre completo" (2 palabras), no "Nombre" pelado — el match exacto original
      // solo cubría la forma corta y el bloque entero quedaba sin resolver pese a tener el dato.
      if (/^r\.?u\.?t\.?$/i.test(limpio) || /^c[ée]dula\s+de\s+identidad$/i.test(limpio)) return conValor('representante_rut', empresa);
      if (/^nombre(\s+completo)?$/i.test(limpio)) return conValor('representante_nombre', empresa);
      if (/^cargo(\s+o\s+funci[óo]n)?$/i.test(limpio)) return conValor('representante_cargo', empresa);
    }
    if (CONTEXTO_BANCARIO.test(contexto) && /^(correo(\s+electr[óo]nico)?|e-?mail)$/i.test(limpio)) {
      return conValor('banco_email', empresa);
    }
    // Solo bloquea si el contexto es un tercero real y desconocido — si es puro ruido (ver
    // CONTEXTO_TERCERO_DESCONOCIDO), se prueba igual como si no tuviera prefijo.
    if (TERMINOS_AMBIGUOS_SIN_CONTEXTO.test(limpio) && CONTEXTO_TERCERO_DESCONOCIDO.test(contexto)) return null;
    return buscarCampo(campoTexto, empresa); // el resto del campo (ej. "Dirección") sigue tal cual
  }

  const limpia = normalizarParaMatch(etiqueta);
  for (const entrada of DICCIONARIO) {
    if (entrada.patrones.some(re => re.test(limpia))) return conValor(entrada.campo, empresa);
  }
  return null;
}

// ── Guard de coherencia para el respaldo IA ───────────────────────────────────────────────
// El diccionario decide por patrón exacto, así que nunca escribe un dato en un campo que no le
// corresponde. La IA sí puede: elige entre TODOS los campos con dato de la empresa y, si ninguno
// calza, igual devuelve el que "más se parece".
//
// BUG REAL encontrado (4291-38-LP26): a la etiqueta "CIUDAD" —un dato que la ficha de empresa
// simplemente no tiene— la IA le asignó `banco_email`, y el anexo salía con
// "sociedadcomercialmp@gmail.com" escrito en la casilla de la ciudad. Ya había un precedente igual
// con `region` (ver CAMPOS_DISPONIBLES en anexos-ia-matching.ts), que se resolvió sacando ese
// campo de la lista; sacar campos de a uno no escala, porque el error puede aparecer con cualquier
// par etiqueta/campo.
//
// Esto lo ataja de raíz: cada campo declara qué tiene que mencionar la etiqueta para que ese valor
// sea plausible ahí. Es una condición NECESARIA, no suficiente — no valida que el match sea bueno,
// solo descarta los que son imposibles. Si la etiqueta no menciona nada de eso, el match se
// descarta y el campo queda pendiente para que lo llene un humano, que es el comportamiento seguro.
const COHERENCIA_CAMPO: Record<keyof EmpresaCampos, RegExp | null> = {
  razon_social: /(nombre|raz[óo]n|empresa|oferente|proponente|proveedor|contratista|entidad)/i,
  rut: /(r\.?u\.?t|rol\s+[úu]nico|c[ée]dula|identificaci[óo]n)/i,
  direccion: /(direcci[óo]n|domicilio|calle|ubicaci[óo]n)/i,
  region: /(regi[óo]n)/i,
  giro: /(giro|actividad|rubro)/i,
  tipo_persona_juridica: /(tipo|naturaleza|persona|constituci[óo]n|sociedad)/i,
  fecha_sociedad: /(fecha|escritura|constituci[óo]n|inicio|vigencia|notar[íi]a)/i,
  representante_nombre: /(nombre|representante|apoderado|firmante)/i,
  representante_rut: /(r\.?u\.?t|c[ée]dula|r\.?u\.?n|identidad)/i,
  representante_cargo: /(cargo|calidad|funci[óo]n)/i,
  email1: /(correo|e-?mail|electr[óo]nico)/i,
  telefono1: /(tel[ée]fono|fono|celular|m[óo]vil|contacto|anexo)/i,
  banco_tipo_cuenta: /(tipo|cuenta)/i,
  banco_numero: /(n[úu]mero|cuenta|n[°º])/i,
  banco_nombre: /(banco|entidad|instituci[óo]n)/i,
  banco_email: /(correo|e-?mail|electr[óo]nico)/i,
  firma_url: null, // la firma no se resuelve por texto (ver detectarLineasFirma)
};

export function esMatchCoherente(etiqueta: string, campo: keyof EmpresaCampos): boolean {
  const exigido = COHERENCIA_CAMPO[campo];
  if (!exigido) return false;
  return exigido.test(etiqueta);
}

// Misma regla de "sin contexto reconocido, no se adivina" pero para el respaldo IA (ver
// matchearConIA en anexos-ia-matching.ts) — sin esto, el diccionario se abstiene correctamente
// pero la IA todavía podría intentar (y a veces acertar por casualidad, a veces no) asignarle
// email1/representante_nombre a un tercero (administrador de contrato, titular bancario, etc.)
// solo porque el CAMPOS_DISPONIBLES de la IA no distingue esos casos tampoco.
export function esTerminoAmbiguoSinContextoReconocido(etiqueta: string): boolean {
  const compuesta = etiqueta.match(/^(.+?)\s+—\s+(.+)$/);
  if (!compuesta) {
    // Etiqueta SIMPLE (sin desambiguar): igual es ambigua si es uno de estos términos pelados —
    // el diccionario ya exige el calificador ("... del representante legal") para matchear a
    // representante_*, así que si llegó hasta acá es porque NO lo trae. Caso real encontrado:
    // "Cédula de Identidad" y "Cargo" del ADMINISTRADOR DE CONTRATO (una tercera persona, sin
    // relación con el representante legal) se estaban asignando igual a representante_rut /
    // representante_cargo — la IA no respetó su propia instrucción de exigir la mención
    // explícita porque el label, sin más contexto que su propio texto, no dice de quién es.
    return TERMINOS_AMBIGUOS_SIN_CONTEXTO.test(normalizarParaMatch(etiqueta));
  }
  const [, contexto, campoTexto] = compuesta;
  if (CONTEXTO_REPRESENTANTE.test(contexto) || CONTEXTO_BANCARIO.test(contexto)) return false;
  if (!CONTEXTO_TERCERO_DESCONOCIDO.test(contexto)) return false; // ruido de vecino, no una persona real — no bloquea
  return TERMINOS_AMBIGUOS_SIN_CONTEXTO.test(normalizarParaMatch(campoTexto));
}
