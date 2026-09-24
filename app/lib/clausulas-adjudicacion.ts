// app/lib/clausulas-adjudicacion.ts
// LECTOR DE LA CLÁUSULA "¿SE ADJUDICA POR LÍNEA O TODO JUNTO?" — con cita verificada.
//
// Por qué existe (caso real 1171317-88-LE26, 24-sep-2026): las bases dicen textualmente "Los
// oferentes podrán postular a una o a ambas líneas. Cada línea será evaluada y adjudicada en forma
// independiente", el modelo respondió POR_LINEAS, y la red de seguridad de viabilidad-ia.ts lo
// bajó a GLOBAL porque ninguno de los ~8 detectores regex reconoció la frase (todos exigían el
// verbo "ofertar"; esta usa "postular"). Cada redacción nueva exigía un regex nuevo: no escala.
//
// Diseño (agente acotado, no regex ni "confía en el modelo"):
//  1. EXHAUSTIVO en código: se recorre el texto COMPLETO de TODOS los documentos (sin recortes por
//     tamaño ni jerarquía) y se extraen las frases que hablan de líneas/lotes/ítems/adjudicación.
//  2. UNA pregunta cerrada al modelo sobre esos fragmentos, con cita textual obligatoria.
//  3. VERIFICACIÓN determinista: la cita debe existir literalmente en el documento (normalizada).
//     Si el modelo inventa o parafrasea, la respuesta se descarta — mismo principio anti-invento
//     del Auditor de cotizaciones. Solo una cita verificada cuenta como evidencia.

export type ModoAdjudicacion = 'POR_LINEAS' | 'GLOBAL' | 'INDETERMINADO';

export interface ClausulaAdjudicacion {
  modo: ModoAdjudicacion;
  cita: string | null;        // frase textual verificada en el documento
  documento: string | null;
  verificada: boolean;        // true solo si la cita existe literalmente en algún documento
}

export interface DocClausula { nombre: string; texto: string }

const INDETERMINADA: ClausulaAdjudicacion = { modo: 'INDETERMINADO', cita: null, documento: null, verificada: false };

const norm = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();

// Frases que pueden decidir la pregunta. Amplio a propósito: filtrar de más solo agrega contexto
// al modelo; filtrar de menos es lo que causó el error original.
const RE_CLAVE = /l[ií]neas?|lotes?|[ií]tems?|adjudic|postul|ofert(?:ar|ad|e)|globalmente|totalidad|independiente|por\s+separado|inadmisible|un\s+solo\s+(?:proveedor|oferente)|m[uú]ltiple/i;

function prioridad(nombre: string): number {
  const n = norm(nombre);
  if (/aclarac|respuesta|consulta/.test(n)) return 0;
  if (/administrativ|bases/.test(n)) return 1;
  if (/tecnic|especif/.test(n)) return 2;
  return 3;
}

// Frase "fuerte": habla de líneas/lotes Y de cómo se postula, evalúa o adjudica. Es la que casi
// siempre contiene la cláusula; se incluye primero para que una base enorme (200 págs.) no agote el
// presupuesto de fragmentos con frases genéricas ("oferta", "ítems") antes de llegar a ella.
const RE_LINEA = /l[ií]neas?|lotes?/i;
const RE_ACCION = /adjudic|postul|ofert|evalu|independ|separad|inadmisible|conjunto|ambas|un\s+solo/i;
const esFuerte = (f: string) => RE_LINEA.test(f) && RE_ACCION.test(f);

/** Frases relevantes de TODOS los documentos, con su vecina anterior/siguiente para dar contexto. */
export function extraerFragmentosClave(docs: DocClausula[], maxChars = 14_000): { doc: string; texto: string }[] {
  const ordenados = docs.slice().sort((a, b) => prioridad(a.nombre) - prioridad(b.nombre));
  const parseados = ordenados.filter(d => d.texto).map(d => ({
    nombre: d.nombre,
    // Una frase = hasta el próximo punto/; seguido de espacio. Las tablas HTML se aplanan primero.
    frases: d.texto.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').split(/(?<=[.;:])\s+/).filter(f => f.length >= 25),
  }));
  const armar = (frases: string[], criterio: (f: string) => boolean, tope: number) => {
    const usadas = new Set<number>();
    frases.forEach((f, i) => { if (criterio(f)) { usadas.add(i); if (i > 0) usadas.add(i - 1); if (i < frases.length - 1) usadas.add(i + 1); } });
    let bloque = '';
    for (const i of [...usadas].sort((a, b) => a - b)) {
      if (bloque.length >= tope) break;
      bloque += frases[i].slice(0, 700) + ' ';
    }
    return bloque.trim().slice(0, tope);
  };
  // Pasada 1: frases fuertes de TODOS los documentos, con tope por documento para que ninguno
  // deje sin espacio a los demás. Pasada 2: si sobra presupuesto, frases con cualquier palabra clave.
  const porDoc = Math.max(2_000, Math.floor(maxChars / Math.max(1, parseados.length)));
  const salida: { doc: string; texto: string }[] = [];
  let total = 0;
  for (const d of parseados) {
    const b = armar(d.frases, esFuerte, Math.min(porDoc * 2, maxChars - total));
    if (b) { salida.push({ doc: d.nombre, texto: b }); total += b.length; }
  }
  for (const d of parseados) {
    if (total >= maxChars) break;
    const yaTiene = salida.find(s => s.doc === d.nombre);
    const b = armar(d.frases, f => RE_CLAVE.test(f) && !esFuerte(f), Math.min(porDoc, maxChars - total));
    if (!b) continue;
    if (yaTiene) yaTiene.texto += ' ' + b; else salida.push({ doc: d.nombre, texto: b });
    total += b.length;
  }
  return salida;
}

const SYSTEM = `Eres un lector de bases de licitación pública chilena. Responde UNA pregunta cerrada sobre cómo se ADJUDICA, citando textualmente.

Definiciones:
- POR_LINEAS: las bases dividen lo licitado en líneas/lotes/ítems que se evalúan y adjudican de forma independiente (un oferente puede postular a una o algunas líneas, o cada línea puede ganarla un proveedor distinto).
- GLOBAL: hay un solo adjudicatario para el conjunto; la oferta es todo-o-nada.
- INDETERMINADO: los fragmentos no lo dicen claramente.

Reglas:
- La "cita" debe ser una frase COPIADA LITERALMENTE de los fragmentos (máx. 300 caracteres), sin parafrasear ni unir frases de lugares distintos.
- Que la evaluación de puntaje sea "por línea" NO basta si no dice que la adjudicación también es independiente por línea.
- Si dudas, responde INDETERMINADO con cita null.

Responde SOLO JSON: {"modo":"POR_LINEAS|GLOBAL|INDETERMINADO","cita":"...","documento":"nombre exacto del documento"}`;

/** Verifica que la cita exista literalmente (normalizada) en algún documento; devuelve el nombre. */
export function verificarCita(cita: string, docs: DocClausula[], preferido?: string | null): string | null {
  const c = norm(cita);
  if (c.length < 20) return null;
  const candidatos = preferido ? [...docs].sort((a, b) => Number(b.nombre === preferido) - Number(a.nombre === preferido)) : docs;
  for (const d of candidatos) if (norm(d.texto).includes(c)) return d.nombre;
  return null;
}

/**
 * Lee la cláusula de adjudicación. `preguntar` recibe (system, user) y devuelve el JSON ya
 * parseado del modelo (inyectado para poder probar sin red). Nunca lanza: ante cualquier fallo
 * devuelve INDETERMINADO y el flujo sigue con el resto de las señales.
 */
export async function leerClausulaAdjudicacion(
  docs: DocClausula[],
  preguntar: (system: string, user: string) => Promise<any>,
): Promise<ClausulaAdjudicacion> {
  try {
    const fragmentos = extraerFragmentosClave(docs);
    if (!fragmentos.length) return INDETERMINADA;
    const user = fragmentos.map(f => `### DOCUMENTO: ${f.doc}\n${f.texto}`).join('\n\n')
      + '\n\nPregunta: ¿la adjudicación es POR_LINEAS, GLOBAL o INDETERMINADO? Cita la frase textual que lo dice.';
    const r = await preguntar(SYSTEM, user);
    const modo = String(r?.modo ?? '').toUpperCase() as ModoAdjudicacion;
    if (modo !== 'POR_LINEAS' && modo !== 'GLOBAL') return INDETERMINADA;
    const cita = typeof r?.cita === 'string' ? r.cita.trim() : '';
    const documento = cita ? verificarCita(cita, docs, typeof r?.documento === 'string' ? r.documento : null) : null;
    if (!documento) return INDETERMINADA; // cita inventada o parafraseada → no cuenta
    return { modo, cita, documento, verificada: true };
  } catch {
    return INDETERMINADA;
  }
}
