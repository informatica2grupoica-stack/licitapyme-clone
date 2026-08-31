// app/lib/anexos-derivados.ts
// Campos que los anexos piden constantemente pero que la tabla `empresas` no guarda como columna
// propia: la CIUDAD/COMUNA (que sí está, pero enterrada al final de `direccion`), la REGIÓN en su
// forma completa, y la FECHA DE HOY (que no es un dato de la empresa sino del momento en que se
// presenta la oferta).
//
// Se resuelven aquí, de forma 100% determinista y sin IA, y se fusionan al registro de empresa
// ANTES de que el diccionario/IA lo vean — así el resto del sistema no se entera de que estos
// campos tienen otro origen: `buscarCampo("Ciudad")` funciona igual que `buscarCampo("RUT")`.
//
// Por qué no una migración a la tabla `empresas`: ciudad y comuna ya vienen dentro de `direccion`
// (el usuario las escribe ahí igual), y la fecha no es un dato guardable — sería un campo que hay
// que acordarse de actualizar cada vez. Si más adelante se quiere una comuna explícita (ej. la
// dirección no la trae, o la comuna tributaria difiere de la comercial), esto es el único lugar
// que hay que tocar.
import type { EmpresaCampos } from '@/app/lib/anexos-ia-motor';

// Los anexos se presentan y se fechan en hora de Chile — un cron o un servidor en UTC no debe
// escribir la fecha de "mañana" en una declaración jurada. Mismo criterio que el resto del
// sistema (ver TZ=America/Santiago en el despliegue).
const ZONA_CHILE = 'America/Santiago';

const MESES = [
  'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
  'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre',
];

function partesFechaChile(ahora: Date): { dia: string; mes: string; anio: string } {
  const fmt = new Intl.DateTimeFormat('es-CL', {
    timeZone: ZONA_CHILE, day: 'numeric', month: 'numeric', year: 'numeric',
  });
  const partes = Object.fromEntries(fmt.formatToParts(ahora).map(p => [p.type, p.value]));
  return { dia: partes.day, mes: partes.month, anio: partes.year };
}

// "3 de agosto de 2026" — la forma en que se firma una declaración jurada en Chile, no "03-08-2026".
export function fechaLargaChile(ahora = new Date()): string {
  const { dia, mes, anio } = partesFechaChile(ahora);
  return `${dia} de ${MESES[Number(mes) - 1]} de ${anio}`;
}

// La comuna no es una columna propia de `empresas` — vive enterrada al final de `direccion`
// ("Barros Arana N°492 Of.78, Concepción" → "Concepción", el último segmento separado por coma).
// REVERTIDO (3-ago-2026, pedido explícito del usuario): antes se dejaba fuera a propósito porque
// era una inferencia sobre texto libre; ahora el usuario pide explícitamente que "Región" salga
// con región Y comuna juntas (ej. "Región del Bío Bío, Concepción"), así que se deriva de nuevo.
function comunaDeDireccion(direccion: string | null | undefined): string | null {
  const partes = (direccion || '').split(',').map(s => s.trim()).filter(Boolean);
  return partes.length > 1 ? partes[partes.length - 1] : null;
}

// Calle y número, sueltos de `direccion` — pedido explícito del usuario (6-ago-2026, caso real
// 4777-24-LE26): un anexo con "Domicilio: Calle ___ N°: ___ Comuna: ___ Ciudad: ___" como CUATRO
// casillas separadas no tenía ningún campo propio que ofrecerle a cada una por separado, así que
// el motor terminaba repitiendo la dirección COMPLETA en "Calle" y de nuevo en "N°" (y, en un caso
// peor, el nombre del representante en "N°" porque no había ninguna opción mejor que calzara).
//
// Deliberadamente NO es una migración a `empresas` (mismo criterio que comunaDeDireccion, ver
// comentario de arriba): es texto que ya existe en `direccion`, solo hay que partirlo. El corte es
// en el PRIMER "N°"/"Nº"/"N" seguido de dígito — el separador que casi cualquier dirección chilena
// usa entre la calle y el número. Si esa marca no aparece, NO se inventa una calle/número: se
// deja `null` y la casilla queda pendiente (mejor sin dato que un dato mal cortado) — misma regla
// de oro anti-alucinación que el resto del motor.
const RE_MARCA_NUMERO = /\bN[°ºo]?\.?\s*(?=\d)/i;

function calleYNumeroDeDireccion(direccion: string | null | undefined): { calle: string | null; numero: string | null } {
  const sinComuna = (direccion || '').split(',')[0]?.trim() || '';
  const m = RE_MARCA_NUMERO.exec(sinComuna);
  if (!m) return { calle: null, numero: null };
  const calle = sinComuna.slice(0, m.index).trim().replace(/[,\-]+$/, '');
  const numero = sinComuna.slice(m.index + m[0].length).trim();
  if (!calle || !numero) return { calle: null, numero: null };
  return { calle, numero };
}

// Oficina / departamento, suelto de `direccion` (31-ago-2026, medido por el auditor de
// generalización sobre 502 formularios reales): los formularios de identificación que parten el
// domicilio en columnas ("Calle | N° | DPTO./OF. | Comuna") dejaban la casilla de oficina siempre
// pendiente, aunque el dato ya viene dentro de `direccion` ("Barros Arana N°492 Of.78, Concepción").
//
// Mismo criterio anti-invención que calleYNumeroDeDireccion: solo se corta cuando la dirección trae
// una marca EXPLÍCITA de oficina/departamento. Si no la trae, `null` y la casilla queda pendiente —
// jamás se ofrece el número de la calle como si fuera la oficina.
// Las alternativas van de MÁS LARGA a más corta y con `\b` de cierre, las dos cosas a propósito:
// con el orden al revés, `of` matcheaba DENTRO de "Oficina" y la marca quedaba capturando "icina"
// en vez del número (verificado con "Av. X 123, Oficina 45", que es de las formas más comunes que
// existe). `piso` queda FUERA: un piso no es una oficina, es otro dato.
const RE_MARCA_OFICINA = /\b(?:oficina|departamento|depto|dpto|ofic|of)\b\.?\s*:?\s*(?:n[°ºo]?\.?\s*)?([\w-]+)/i;

// A diferencia de calleYNumeroDeDireccion (que solo mira el PRIMER segmento, donde por definición
// vive la calle), la oficina aparece indistintamente pegada a la calle ("Barros Arana N°492 Of.78")
// o como segmento propio ("Av. Providencia 1234, Oficina 45"). Se miran todos los segmentos MENOS
// el último, que es la comuna (ver comunaDeDireccion) y nunca trae la oficina.
function oficinaDeDireccion(direccion: string | null | undefined): string | null {
  const partes = (direccion || '').split(',').map(s => s.trim()).filter(Boolean);
  const buscables = partes.length > 1 ? partes.slice(0, -1) : partes;
  for (const parte of buscables) {
    const m = RE_MARCA_OFICINA.exec(parte);
    if (m?.[1]?.trim()) return m[1].trim();
  }
  return null;
}

// Nombres y apellidos, sueltos de `representante_nombre` — pedido explícito del usuario (10-ago-
// 2026, caso real 1426039-8-LE26, ANEXO N°6): una tabla "Nombres | Apellidos" como DOS casillas
// separadas no tenía ningún campo propio que ofrecerle a cada una, así que el motor repetía el
// NOMBRE COMPLETO en las dos ("Lidia Valenzuela" en "Nombres" Y en "Apellidos").
//
// Deliberadamente NO adivina más allá de lo que el conteo de palabras permite asegurar (misma
// regla de oro que calleYNumeroDeDireccion): un nombre chileno completo casi siempre es
// "Nombre(s) ApellidoPaterno [ApellidoMaterno]", pero de un string suelto no hay forma de saber
// SIN AMBIGÜEDAD cuántas palabras son nombre y cuántas apellido salvo en los casos más comunes:
//   2 palabras → 1 nombre + 1 apellido (ej. "Lidia Valenzuela").
//   3 palabras → 1 nombre + 2 apellidos (paterno + materno, el patrón chileno más común).
//   4 palabras → 2 nombres + 2 apellidos.
// Con 1 palabra o 5+, no se separa (mejor pendiente que un corte inventado).
function nombresYApellidosDe(nombreCompleto: string | null | undefined): { nombres: string | null; apellidos: string | null } {
  const palabras = (nombreCompleto || '').trim().split(/\s+/).filter(Boolean);
  if (palabras.length === 2) return { nombres: palabras[0], apellidos: palabras[1] };
  if (palabras.length === 3) return { nombres: palabras[0], apellidos: palabras.slice(1).join(' ') };
  if (palabras.length === 4) return { nombres: palabras.slice(0, 2).join(' '), apellidos: palabras.slice(2).join(' ') };
  return { nombres: null, apellidos: null };
}

// La ficha de empresa guarda la región como la escribió el usuario ("Metropolitana", "Región del
// Bío Bío"). En un anexo se escribe siempre con la palabra "Región" adelante — si ya la trae, se
// deja tal cual — y se le agrega la comuna (ver comunaDeDireccion) cuando la dirección la trae.
export function regionCompleta(region: string | null | undefined, direccion?: string | null): string | null {
  const limpia = (region || '').trim();
  if (!limpia) return null;
  const base = /^regi[óo]n\b/i.test(limpia) ? limpia : `Región ${limpia}`;
  const comuna = comunaDeDireccion(direccion);
  return comuna ? `${base}, ${comuna}` : base;
}

// Socio único al 100% (14-ago-2026, pedido explícito del usuario, instructivo interno "Presentacion_
// Creacion_Anexos_FINAL_CON_EJEMPLOS.pdf" punto 4): sin un registro societario real con varios
// socios, la política documentada de la empresa es declarar al representante legal como socio
// único. `null` si no hay representante (mismo criterio anti-invención que el resto del archivo:
// sin nombre de representante, tampoco hay socio que ofrecer).
function socioUnicoDe(representanteNombre: string | null | undefined): { nombre: string | null; participacion: string | null } {
  const nombre = (representanteNombre || '').trim() || null;
  return { nombre, participacion: nombre ? '100%' : null };
}

// Programa de Integridad / Compliance (mismo instructivo, punto 5): política fija de la empresa,
// no depende de la licitación ni de la ficha — se responde "SÍ" siempre que se pregunte.
const PROGRAMA_INTEGRIDAD_RESPUESTA = 'SÍ';

// NACIONALIDAD (28-ago-2026, respuesta del usuario a la auditoría: "nacionalidad siempre es
// chilena"). Medida por el auditor en 21 licitaciones de organismos distintos: es de las casillas
// más repetidas de las declaraciones juradas ("de nacionalidad ___", "NACIONALIDAD") y no había
// ninguna columna que la respondiera, así que quedaba SIEMPRE en blanco.
//
// Va como política fija y no como columna nueva por la misma razón que el Programa de Integridad:
// no depende de la licitación ni varía entre anexos. Pero se resuelve con `??`, no a la fuerza —
// si algún día se agrega la columna `nacionalidad` a `empresas` (un representante extranjero, una
// segunda empresa), el dato REAL de la ficha manda sobre esta política sin tocar nada más.
const NACIONALIDAD_POR_DEFECTO = 'Chilena';

// Toma el registro tal cual sale de la tabla `empresas` y devuelve el mismo registro CON los
// campos derivados resueltos. No pisa nada que ya venga con dato propio.
// El código de la licitación partido en sus tres tramos ("2495-17-B226" → "2495" / "17" / "B226"),
// para los formularios que imprimen los guiones y dejan tres blancos (2495-17-B226, FORMULARIO
// ADMI-1: "de la licitación pública ID N°____-____-______"). `null` en los tres si no hay código o
// si no tiene exactamente tres tramos — nunca se rellena de a pedazos algo que no calza.
// Se exporta como bloque de campos (y no como tupla) porque hay DOS puntos donde hace falta y en
// uno de ellos el código todavía no existe: `cargarEmpresaEnriquecida` (anexos-datos.ts) llama a
// conCamposDerivados con la ficha CRUDA —sin los `licitacion_*`, que llegan de la API de Mercado
// Público— y recién después fusiona los dos objetos. Si esto viviera solo acá adentro, los tres
// tramos se calcularían siempre sobre un código vacío y quedarían en null para siempre (fue
// exactamente lo que pasó al escribirlo: la regla identificaba los tres blancos y los tres decían
// "falta el dato").
export function camposDelCodigoLicitacion(codigo: string | null | undefined): {
  licitacion_codigo_p1: string | null; licitacion_codigo_p2: string | null; licitacion_codigo_p3: string | null;
} {
  const partes = String(codigo || '').trim().split('-');
  const ok = partes.length === 3 && partes.every(p => p.trim().length > 0);
  return {
    licitacion_codigo_p1: ok ? partes[0].trim() : null,
    licitacion_codigo_p2: ok ? partes[1].trim() : null,
    licitacion_codigo_p3: ok ? partes[2].trim() : null,
  };
}

export function conCamposDerivados(empresa: EmpresaCampos, ahora = new Date()): EmpresaCampos {
  const comuna = comunaDeDireccion(empresa.direccion);
  const { calle, numero } = calleYNumeroDeDireccion(empresa.direccion);
  const { nombres, apellidos } = nombresYApellidosDe(empresa.representante_nombre);
  const socio = socioUnicoDe(empresa.representante_nombre);
  return {
    ...empresa,
    region: regionCompleta(empresa.region, empresa.direccion),
    // Chile no distingue de forma confiable "comuna" de "ciudad" en una dirección comercial en
    // texto libre (Talagante es comuna Y ciudad a la vez) — se ofrece el mismo valor para las dos
    // etiquetas, igual de válido para cualquiera de las dos.
    comuna, ciudad: comuna,
    direccion_calle: calle, direccion_numero: numero,
    direccion_oficina: oficinaDeDireccion(empresa.direccion),
    ...camposDelCodigoLicitacion(empresa.licitacion_codigo),
    representante_nombres: nombres, representante_apellidos: apellidos,
    socio_nombre: socio.nombre, socio_participacion: socio.participacion,
    programa_integridad_respuesta: PROGRAMA_INTEGRIDAD_RESPUESTA,
    nacionalidad: (empresa as { nacionalidad?: string | null }).nacionalidad || NACIONALIDAD_POR_DEFECTO,
    fecha_hoy: fechaLargaChile(ahora),
    // Las tres partes por separado, para los pies de firma "Fecha: ____ /____ /____" (tres casillas
    // independientes, el formato más común de los anexos chilenos). Misma hora de Chile que
    // fechaLargaChile — nunca se derivan del string ya formateado.
    ...(({ dia, mes, anio }) => ({
      fecha_hoy_dia: dia, fecha_hoy_mes: mes, fecha_hoy_anio: anio,
      // El OTRO formato de pie de firma, igual de común: "___ de ___ de ___" en vez de barras.
      // Ahí la casilla del medio pide el MES EN PALABRA ("agosto"), no el número — mismo criterio
      // que la fecha larga (nadie escribe "3 de 08 de 2026" en una declaración jurada). Ver
      // detectarTripletesFecha en anexos-detectar.ts, que resuelve este trío sin pasar por la IA.
      fecha_hoy_mes_palabra: MESES[Number(mes) - 1],
      // Caso real (4777-24-LE26, "LA UNIÓN, ___ DE 2026.-"): el AÑO ya viene impreso como texto
      // fijo en la plantilla y queda UN solo blanco para "día + de + mes en palabra" — no es un
      // triplete (no hay tres casillas) así que no pasa por detectarTripletesFecha, y ninguno de
      // los campos de arriba sirve solo (fecha_hoy trae el año de más, fecha_hoy_dia es un número
      // huérfano sin el mes). A diferencia de esos, este SÍ es válido como respuesta suelta de una
      // sola celda — se lee completo ("06 de agosto") sin depender de casillas vecinas.
      fecha_hoy_dia_mes: `${dia} de ${MESES[Number(mes) - 1]}`,
    }))(partesFechaChile(ahora)),
  };
}
