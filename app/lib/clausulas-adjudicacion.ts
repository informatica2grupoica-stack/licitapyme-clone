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
//
// v4.0 (02-oct-2026, especificación 1 P1 + prompt auxiliar A): ya NO responde un modo
// (POR_LINEAS/GLOBAL/INDETERMINADO). Entrega EVIDENCIAS TIPADAS en los dos sentidos, que se suman
// a las del analizador y pasan por la tabla de decisión del código (viabilidad-v4/adjudicacion.ts).
// Antes solo se usaba la rama POR_LINEAS: una frase que decía "a un solo oferente" se perdía.

export const TIPOS_CLAUSULA = ['COTIZAR_TOTALIDAD', 'ADJUDICA_GLOBAL', 'ADJUDICA_POR_LINEA', 'TOTAL_O_PARCIAL', 'OFERTA_POR_BIEN', 'DESIERTA_POR_LINEA'] as const;
export type TipoClausula = typeof TIPOS_CLAUSULA[number];

export interface EvidenciaClausula {
  tipo: TipoClausula;
  cita: { documento: string; numeral: string; frase: string };
}

export interface ClausulaAdjudicacion {
  evidencias: EvidenciaClausula[];   // solo las que tienen frase verificada literal
  descartadas: number;               // frases que el modelo citó y no existen en los documentos
}

export interface DocClausula { nombre: string; texto: string }

const VACIA: ClausulaAdjudicacion = { evidencias: [], descartadas: 0 };

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
// v4.0: además de línea/lote, "bien(es)", "ítem(s)", "total o parcialmente", "por separado" y
// "desierta" (Cholchol: "en caso de ofertar más de un bien…"; Arica: "adjudicar total o parcialmente").
const RE_LINEA = /l[ií]neas?|lotes?|\bbienes?\b|[ií]tems?|total\s+o\s+parcial|parcialmente|por\s+separado|desiert/i;
const RE_ACCION = /adjudic|postul|ofert|evalu|independ|separad|inadmisible|conjunto|ambas|un\s+solo|totalidad|parcial|desiert/i;
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

// Prompt auxiliar A (PROMPTS_Auxiliares_Fase2_v4_0), texto íntegro.
const SYSTEM = `Eres un lector de bases de licitaciones públicas chilenas. Tu única tarea es
encontrar frases que digan si el conjunto de líneas (o ítems, lotes o bienes)
puede repartirse entre distintos proveedores.

Reporta cada frase que encuentres de estos tipos:
- COTIZAR_TOTALIDAD: obliga a ofertar todas las líneas ("no se aceptan ofertas
  parciales").
- ADJUDICA_GLOBAL: se adjudica a un solo oferente o por el total.
- ADJUDICA_POR_LINEA: se adjudica por línea, ítem, lote o bien.
- TOTAL_O_PARCIAL: "se reserva el derecho de adjudicar total o parcialmente".
- OFERTA_POR_BIEN: permite ofertar uno o más bienes ("en caso de ofertar más de
  un bien… por separado").
- DESIERTA_POR_LINEA: permite declarar desierta una o más líneas.

Reglas:
- La "frase" se copia LITERAL de los fragmentos (máximo 300 caracteres), sin
  parafrasear ni unir frases de lugares distintos. No copies los marcadores
  [[PÁGINA N]].
- "documento": nombre exacto del documento; "numeral": artículo o punto, si
  aparece en el fragmento (si no, vacío).
- Que el puntaje se evalúe por línea NO es ninguno de estos tipos.
- No concluyas GLOBAL ni POR LÍNEA. Si no hay frases de estos tipos, devuelve
  la lista vacía.

Responde SOLO JSON:
{"evidencias":[{"tipo":"…","cita":{"documento":"","numeral":"","frase":""}}]}`;

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
 * devuelve la lista vacía y el flujo sigue con el resto de las evidencias.
 */
export async function leerClausulaAdjudicacion(
  docs: DocClausula[],
  preguntar: (system: string, user: string) => Promise<any>,
): Promise<ClausulaAdjudicacion> {
  try {
    const fragmentos = extraerFragmentosClave(docs);
    if (!fragmentos.length) return VACIA;
    const user = fragmentos.map(f => `### DOCUMENTO: ${f.doc}\n${f.texto}`).join('\n\n')
      + '\n\nPregunta: lista las frases de los tipos indicados, cada una con su cita (documento exacto, numeral y frase literal).';
    const r = await preguntar(SYSTEM, user);
    const crudas: any[] = Array.isArray(r?.evidencias) ? r.evidencias : [];
    const out: EvidenciaClausula[] = [];
    let descartadas = 0;
    for (const e of crudas) {
      const tipo = String(e?.tipo ?? '').toUpperCase() as TipoClausula;
      if (!TIPOS_CLAUSULA.includes(tipo)) continue;
      const frase = String(e?.cita?.frase ?? e?.frase ?? '').replace(/\[\[P[ÁA]GINA[^\]]*\]\]/gi, ' ').trim();
      const documento = frase ? verificarCita(frase, docs, typeof e?.cita?.documento === 'string' ? e.cita.documento : null) : null;
      if (!documento) { descartadas++; continue; }   // frase inventada o parafraseada → no cuenta
      out.push({ tipo, cita: { documento, numeral: String(e?.cita?.numeral ?? ''), frase } });
    }
    return { evidencias: out, descartadas };
  } catch {
    return VACIA;
  }
}
