// app/lib/anexos-traer.ts
// «Traer desde Documentos» (Pre-postulación › Anexos a generar, 28-oct-2026): el anexo se hizo FUERA
// de la app (firma a puño y letra) y se subió a Documentos, pero no quedó en ninguna casilla, así que
// Postulación salía vacía (4022-19-LE26). Sin DB ni red: decide qué archivos propios cuentan como
// «sueltos» y propone a qué punto va cada uno. La propuesta siempre la confirma una persona.
import { ordenarPorCoincidencia } from './anexos-match';

export interface DocPropio {
  id: number;
  documento_nombre: string;
  documento_url_local: string;
  categoria?: string | null;
  subcategoria?: string | null;
  created_at?: string | null;
}

export interface PuntoAnexo { id: number; titulo: string; estado: string }

// Lo que la propia app genera (anexos rellenados y divididos): eso entra por «Generar anexo», no es
// un archivo suelto que haya que traer.
const SUBCAT_GENERADAS = new Set(['Anexos Administrativos', 'Anexos Técnicos', 'Anexos Económicos']);
// Carpetas de Documentos Propios que no son parte de la oferta (subcategorías escritas a mano por el equipo).
const RE_SUBCAT_AJENA = /cotiz|ficha|experien|comprobante|orden de compra|costeo|acta|resoluc|perdida|comparativo|informe|respaldo/i;
const RE_NOMBRE_AJENO = /^(?:\d+_)?(?:costeo|informe)_/i;
const RE_EXTENSION = /\.(pdf|docx?|xlsx?)$/i;

/** Archivos propios que pueden ir en la oferta (PDF, Word o Excel; ni el costeo ni el informe). */
export function documentosPropiosDeOferta(docs: DocPropio[]): DocPropio[] {
  return docs.filter(d =>
    String(d.categoria || '').toUpperCase() === 'DOCUMENTOS_PROPIOS'
    && !!d.documento_url_local
    && RE_EXTENSION.test(d.documento_nombre || '')
    && !RE_NOMBRE_AJENO.test(d.documento_nombre || ''));
}

/** Subido por el equipo, sin casilla todavía y de una carpeta que puede ser de la oferta. */
export function esDocumentoSuelto(doc: DocPropio, urlsCargadas: Set<string>): boolean {
  if (urlsCargadas.has(doc.documento_url_local)) return false;
  const sub = doc.subcategoria || '';
  return !SUBCAT_GENERADAS.has(sub) && !RE_SUBCAT_AJENA.test(sub);
}

export interface PropuestaReparto { doc: DocPropio; itemId: number | null; puntaje: number }

// Mínimo para PROPONER un punto: el número de anexo (100) o dos palabras en común (5 c/u). Una sola
// palabra no basta: «FICHA TECNICA.pdf» calzaba con «Anexo Técnico 3 - Oferta Técnica» solo por «tecnica».
const PUNTAJE_MINIMO = 10;

/** A qué punto va cada archivo: el de mejor coincidencia entre los que aún no están aprobados.
 *  Con poca señal queda sin punto: no se adivina. */
export function proponerReparto(docs: DocPropio[], puntos: PuntoAnexo[]): PropuestaReparto[] {
  const abiertos = puntos.filter(p => p.estado !== 'APROBADO');
  return docs.map(doc => {
    const mejor = ordenarPorCoincidencia(doc.documento_nombre, abiertos.map(p => ({ id: p.id, nombre: p.titulo })))[0];
    return mejor && mejor.puntaje >= PUNTAJE_MINIMO ? { doc, itemId: Number(mejor.id), puntaje: mejor.puntaje } : { doc, itemId: null, puntaje: 0 };
  });
}

/** Título para un punto nuevo creado desde un archivo: el nombre sin extensión. */
export const tituloDesdeArchivo = (nombre: string) => nombre.replace(/\.[a-z0-9]+$/i, '').replace(/[_]+/g, ' ').trim();
