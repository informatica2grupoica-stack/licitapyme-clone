// app/lib/anexos-match.ts
// Frente E.1 ↔ Auditor Técnico — puente de nombres, sin DB ni red: empareja el título de un
// punto del checklist ("Anexo N°2-A - Declaración jurada simple") contra nombres de archivo
// reales (el Word original bajado de MP, o el .docx ya generado y dividido por formulario en
// anexos-dividir.ts) usando el número de anexo + palabras significativas compartidas.
//
// Nunca decide solo qué documento ES un anexo: es un ORDEN de mejor a peor candidato para que
// el selector se lo ofrezca ya pre-elegido al asistente, que confirma con un clic. Cuando SÍ
// reparte automáticamente (repartirArchivosGenerados), es sobre archivos que la propia app
// generó en el paso anterior — nunca sobre documentos originales sin tocar.

function normalizar(s: string): string {
  return String(s || '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase();
}

// "Anexo N°2-A", "ANEXO_N2A_FORMULARIOS.docx", "FORMULARIO N°2-A" → "2a" — mismo número sin
// importar el separador, así calzan el título del checklist, el documento original de MP y el
// archivo ya generado (que anexos-dividir.ts nombra con el mismo número de formulario).
// La letra sufijo ("2-A") va PEGADA al número, sin espacio de por medio — a propósito no se
// permite un espacio antes de ella: "Anexo N°1 - Ficha del Oferente" casi se cuela como "1f"
// (la effe de "Ficha") porque un `\s*[-\s]?\s*` laxo se comía el " - " del título y capturaba la
// primera letra de la palabra siguiente. `(?![a-z])` además exige que la letra capturada sea la
// ÚLTIMA del sufijo (no la primera de una palabra de verdad): sin eso, "2a" de un nombre de
// archivo real ("N2ANEXO...") capturaría solo "a" en vez de fallar limpio.
const RE_NUMERO = /(?:anexo|formulario)[^0-9]{0,6}(\d+)(?:-?([a-z])(?![a-z]))?/i;

function numeroDe(texto: string): string | null {
  const m = normalizar(texto).match(RE_NUMERO);
  if (!m) return null;
  return m[1] + (m[2] || '');
}

// Palabras demasiado genéricas para contar como coincidencia por sí solas — "anexo" y
// "formulario" aparecen en TODOS los títulos, no distinguen nada.
const STOPWORDS = new Set(['anexo', 'anexos', 'formulario', 'formularios', 'del', 'de', 'la', 'el', 'los', 'las', 'oferente', 'n']);

function palabrasSignificativas(texto: string): Set<string> {
  return new Set(
    normalizar(texto).replace(/[^a-z0-9]+/g, ' ').split(' ')
      .filter(w => w.length >= 4 && !STOPWORDS.has(w)),
  );
}

export interface Candidato { id: number | string; nombre: string }

/** Puntaje de UN candidato contra el título de un punto del checklist. Más alto = mejor match. 0 = sin señal. */
export function puntajeCoincidencia(tituloItem: string, nombreCandidato: string): number {
  const numItem = numeroDe(tituloItem);
  const numCand = numeroDe(nombreCandidato);
  let puntaje = 0;
  // El número de anexo es la señal fuerte: "Anexo N°2-A" contra "ANEXO_2A_..." es casi
  // siempre el mismo documento aunque no compartan ni una palabra más.
  if (numItem && numCand && numItem === numCand) puntaje += 100;
  const wItem = palabrasSignificativas(tituloItem);
  const wCand = palabrasSignificativas(nombreCandidato);
  for (const w of wItem) if (wCand.has(w)) puntaje += 5;
  return puntaje;
}

/** Candidatos ordenados de mejor a peor match — para ofrecerlos en el selector manual. */
export function ordenarPorCoincidencia<T extends Candidato>(tituloItem: string, candidatos: T[]): (T & { puntaje: number })[] {
  return candidatos
    .map(c => ({ ...c, puntaje: puntajeCoincidencia(tituloItem, c.nombre) }))
    .sort((a, b) => b.puntaje - a.puntaje);
}

export interface ArchivoGenerado { nombre: string; url: string }

/**
 * Reparte archivos YA GENERADOS por /api/anexos/generar entre los puntos del checklist que
 * podrían corresponderles. Cuando el Word fuente traía varios "FORMULARIO N°X" pegados,
 * anexos-dividir.ts los separó en un archivo por formulario — cada uno debe ir a SU punto, no
 * todos al punto que abrió el modal (que fue uno solo, elegido por el asistente al azar entre
 * los N que ese documento cubre).
 *
 * Si ningún punto matchea con confianza (puntaje 0 — nombre de archivo genérico, sin número
 * reconocible), el archivo cae en itemIdOrigen: mejor que quede visible ahí, para que el
 * asistente lo reubique a mano, que perderlo de vista silenciosamente.
 */
export function repartirArchivosGenerados<T extends { id: number; titulo: string }>(
  archivos: ArchivoGenerado[],
  itemsElegibles: T[],
  itemIdOrigen: number,
): Map<number, ArchivoGenerado[]> {
  const reparto = new Map<number, ArchivoGenerado[]>();
  const agregar = (itemId: number, archivo: ArchivoGenerado) => {
    if (!reparto.has(itemId)) reparto.set(itemId, []);
    reparto.get(itemId)!.push(archivo);
  };
  for (const archivo of archivos) {
    const ranking = ordenarPorCoincidencia(archivo.nombre, itemsElegibles.map(i => ({ id: i.id, nombre: i.titulo })));
    const mejor = ranking[0];
    agregar(mejor && mejor.puntaje > 0 ? Number(mejor.id) : itemIdOrigen, archivo);
  }
  return reparto;
}
