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

// Toma el registro tal cual sale de la tabla `empresas` y devuelve el mismo registro CON los
// campos derivados resueltos. No pisa nada que ya venga con dato propio.
export function conCamposDerivados(empresa: EmpresaCampos, ahora = new Date()): EmpresaCampos {
  const comuna = comunaDeDireccion(empresa.direccion);
  const { calle, numero } = calleYNumeroDeDireccion(empresa.direccion);
  return {
    ...empresa,
    region: regionCompleta(empresa.region, empresa.direccion),
    // Chile no distingue de forma confiable "comuna" de "ciudad" en una dirección comercial en
    // texto libre (Talagante es comuna Y ciudad a la vez) — se ofrece el mismo valor para las dos
    // etiquetas, igual de válido para cualquiera de las dos.
    comuna, ciudad: comuna,
    direccion_calle: calle, direccion_numero: numero,
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
    }))(partesFechaChile(ahora)),
  };
}
