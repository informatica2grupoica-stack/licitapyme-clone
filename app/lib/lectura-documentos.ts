// app/lib/lectura-documentos.ts
// GARANTÍA DE LECTURA: nadie analiza una licitación con el expediente a medio leer.
//
// Por qué existe (26-ago-2026, auditoría completa). Se midieron 1.889 documentos en formato
// perfectamente legible (PDF con texto, Word, Excel) que quedaron SIN texto extraído en 375
// licitaciones que igual entregaron su informe de viabilidad — 240 de ellas sin haber leído sus
// bases administrativas. Al correr el lector sobre una muestra de esos mismos archivos, 9 de cada
// 10 se leyeron sin problema en menos de 3 segundos. Los lectores nunca estuvieron rotos: el
// análisis siguió adelante sin ellos y NADIE SE ENTERÓ, porque el fallo de lectura no se
// registraba en ningún lado (ver `registrarIntentoLectura` en viabilidad-ia.ts).
//
// La regla de negocio es simple y no se negocia: un informe construido sin las bases NO es un
// informe, es una adivinanza cara. Vale más gastar 3 segundos releyendo que una llamada de IA
// sobre un expediente incompleto.
//
// Este módulo es determinista y sin dependencias (solo strings) para poder testearlo entero.

/** Extensiones que el sistema SABE leer. Si un documento tiene una de estas y quedó sin texto,
 *  es un fallo nuestro — no una limitación del formato. */
const FORMATOS_LEGIBLES = new Set(['pdf', 'docx', 'doc', 'xlsx', 'xls']);

/** Extensiones que NO se pueden leer y nunca deben contar como fallo: comprimidos, planos CAD,
 *  imágenes sueltas, mapas. Se listan explícitas para que un formato nuevo caiga en "legible" y
 *  moleste, en vez de colarse en silencio como "no me tocaba". */
const FORMATOS_NO_LEGIBLES = new Set(['rar', 'zip', '7z', 'dwg', 'dxf', 'kmz', 'kml', 'jpg', 'jpeg', 'png', 'gif', 'tif', 'tiff', 'mp4', 'exe']);

export function extensionDe(nombre: string): string {
  const n = String(nombre || '').toLowerCase().trim();
  const i = n.lastIndexOf('.');
  // Sin punto o con "extensión" larguísima (nombre truncado por MP, p.ej. "download"): sin extensión.
  if (i < 0 || i === n.length - 1) return '';
  const ext = n.slice(i + 1);
  return /^[a-z0-9]{1,5}$/.test(ext) ? ext : '';
}

/** ¿Este documento DEBERÍA poder leerse? Un `.rar` sin texto no es un fallo; un `.docx` sí. */
export function esFormatoLegible(nombre: string): boolean {
  const ext = extensionDe(nombre);
  if (!ext) return false;                    // sin extensión: no se puede afirmar que sea legible
  if (FORMATOS_NO_LEGIBLES.has(ext)) return false;
  return FORMATOS_LEGIBLES.has(ext);
}

/** Categorías cuyo contenido DECIDE el análisis. Que falte una de estas invalida el informe: son
 *  las que traen el objeto de la compra, los criterios de evaluación y el cuadro a cotizar.
 *  DOCUMENTOS_PROPIOS queda fuera a propósito — son archivos nuestros (el Excel de costeo que
 *  genera este mismo sistema), no fuente de verdad sobre la licitación. */
const CATEGORIAS_CRITICAS = new Set([
  'BASES_ADMINISTRATIVAS',
  'BASES_TECNICAS',
  'ANEXOS_ECONOMICOS',
  'ANEXOS_TECNICOS',
  'ANEXOS_OFERENTE',
]);

/** ¿Sin este documento el informe queda cojo? */
export function esDocumentoCritico(categoria: string | null | undefined, nombre: string): boolean {
  const cat = String(categoria || '').toUpperCase();
  if (cat === 'DOCUMENTOS_PROPIOS') return false;
  if (CATEGORIAS_CRITICAS.has(cat)) return true;
  // Sin categoría todavía (la clasificación corre después): se decide por el NOMBRE. Un archivo
  // llamado "bases" o "anexo económico" es crítico aunque nadie lo haya clasificado aún.
  if (!cat || cat === 'OTROS') {
    return /bases|anexo|eett|especificaci|t[ée]rminos.?de.?referencia|ttr|formulario.?econ|oferta.?econ|itemiz|presupuesto/i
      .test(String(nombre || ''));
  }
  return false;
}

export interface DocParaCobertura {
  nombre: string;
  categoria?: string | null;
  /** Texto ya extraído (vacío o corto = no se pudo leer). */
  texto?: string | null;
  /** Método con que se leyó/intentó leer. */
  metodo?: string | null;
}

export interface CoberturaLectura {
  /** Documentos en formato legible (el universo que DEBERÍA leerse). */
  legibles: number;
  /** De esos, cuántos tienen texto utilizable. */
  leidos: number;
  /** Los legibles que quedaron sin texto. */
  faltantes: string[];
  /** Los faltantes que además son críticos (bases, anexos): estos invalidan el informe. */
  criticosFaltantes: string[];
  /** Formatos que no se pueden leer (informativo, nunca cuenta como fallo). */
  noLegibles: string[];
  /** 0..1 sobre los legibles. 1 cuando no hay nada legible que leer. */
  cobertura: number;
  /** ¿Se puede confiar en un informe hecho con esto? */
  completa: boolean;
}

/** Umbral de "tiene texto utilizable". Alineado con el que ya usa cargarDocumentos. */
export const MIN_CHARS_UTIL = 50;

/**
 * Radiografía de qué se pudo leer y qué no. Es la base del portero: se calcula ANTES de gastar
 * una sola llamada de IA, porque analizar un expediente incompleto cuesta lo mismo que analizarlo
 * completo y el resultado no sirve.
 */
export function evaluarCoberturaLectura(docs: DocParaCobertura[]): CoberturaLectura {
  const legiblesArr: DocParaCobertura[] = [];
  const noLegibles: string[] = [];
  for (const d of docs) {
    const cat = String(d.categoria || '').toUpperCase();
    if (cat === 'DOCUMENTOS_PROPIOS') continue;      // archivos nuestros: no son fuente
    if (esFormatoLegible(d.nombre)) legiblesArr.push(d);
    else noLegibles.push(d.nombre);
  }
  const tieneTexto = (d: DocParaCobertura) => (d.texto || '').trim().length >= MIN_CHARS_UTIL;
  const faltantesArr = legiblesArr.filter(d => !tieneTexto(d));
  const criticosFaltantes = faltantesArr.filter(d => esDocumentoCritico(d.categoria, d.nombre)).map(d => d.nombre);
  const leidos = legiblesArr.length - faltantesArr.length;
  return {
    legibles: legiblesArr.length,
    leidos,
    faltantes: faltantesArr.map(d => d.nombre),
    criticosFaltantes,
    noLegibles,
    cobertura: legiblesArr.length ? leidos / legiblesArr.length : 1,
    completa: criticosFaltantes.length === 0,
  };
}

/** Frase para el log y para el informe. Se escribe SIEMPRE, se haya leído todo o no: el registro
 *  de que la lectura salió completa vale tanto como el aviso de que no. */
export function resumirCobertura(c: CoberturaLectura): string {
  if (!c.legibles) return 'sin documentos legibles que leer';
  const base = `${c.leidos}/${c.legibles} documentos legibles leídos (${Math.round(c.cobertura * 100)}%)`;
  if (c.completa) return c.faltantes.length ? `${base} — faltan ${c.faltantes.length} no críticos` : base;
  return `${base} — FALTAN ${c.criticosFaltantes.length} CRÍTICOS: ${c.criticosFaltantes.slice(0, 5).join(', ')}`;
}
