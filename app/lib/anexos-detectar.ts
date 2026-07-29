// app/lib/anexos-detectar.ts
// Frente E.1 — detección de campos a rellenar en un anexo real, sin conocimiento previo del
// documento. Probado contra 4 anexos reales de 4 organismos (Chile Chico, Lo Barnechea, y 2
// más) — ver docs/BITACORA-CAMBIOS-VIABILIDAD.md para el detalle de cada hallazgo.
import { listarParrafos, listarBlancosInline, type Parrafo } from '@/app/lib/anexos-docx';

// ── Patrón 1: etiqueta corta + párrafo vacío inmediatamente después ───────────────────────
// (celda de tabla de 2 columnas: "Razón social" | <celda vacía>). Es RUIDOSO a propósito: no
// distingue un título corto ("ANEXO N°1") de un campo real ("RUT") — esa distinción la hace
// después el diccionario (anexos-diccionario.ts): si la etiqueta no cruza con ningún campo
// conocido, no se autocompleta nada, como mucho queda disponible para que un humano la vea.
export interface CandidatoCelda { etiqueta: string; paraId: string; indice: number }

export function detectarCandidatosCelda(parrafos: Parrafo[]): CandidatoCelda[] {
  const out: CandidatoCelda[] = [];
  for (let i = 0; i < parrafos.length - 1; i++) {
    const actual = parrafos[i];
    const siguiente = parrafos[i + 1];
    if (actual.texto && actual.texto.length <= 60 && siguiente.vacio) {
      out.push({ etiqueta: actual.texto, paraId: siguiente.paraId, indice: siguiente.indice });
    }
  }
  return out;
}

// ── Patrón 1b: celdas dentro de TABLAS de 3+ columnas (specs, evaluación técnica…) ────────
// El patrón 1 asume una tabla de 2 columnas "Etiqueta | Valor" — el párrafo justo antes de la
// celda vacía ES la etiqueta. En una tabla de más columnas (N° | Especificación | Criterio |
// SI/NO | Observaciones), el párrafo "justo antes" de una celda vacía es apenas OTRA columna de
// la MISMA fila (ej. "CO", el valor de Criterio) — no describe qué hay que escribir ahí. Acá se
// arma la etiqueta con la celda MÁS LARGA de la fila (heurística: la columna de descripción
// siempre es la más larga en una tabla de requisitos) + el nombre de columna, sacado de la
// primera fila de la tabla (encabezado). Caso real: hallado en un Anexo de Evaluación Técnica
// donde el patrón 1 mostraba "CO" como etiqueta cuatro veces sin poder distinguirlas.
//
// Límite conocido y aceptado: usa regex, no un parser XML real — una tabla ANIDADA dentro de
// una celda puede confundir el emparejamiento de <w:tr>/<w:tc>. Bajo riesgo aquí porque solo
// afecta la ETIQUETA mostrada al humano (nunca escribe el valor solo) — el peor caso es una
// etiqueta rara, no un dato incorrecto en el documento.
function offsetsAIndices(xml: string): Map<number, number> {
  const mapa = new Map<number, number>();
  let indice = 0;
  for (const m of xml.matchAll(/<w:p\b[^>]*w14:paraId="[0-9A-Fa-f]+"[^>]*>[\s\S]*?<\/w:p>/g)) {
    mapa.set(m.index!, indice);
    indice++;
  }
  return mapa;
}

interface CeldaCruda { texto: string; vacio: boolean; paraId: string | null; indiceGlobal: number | null }

function extraerCeldasDeFila(filaXml: string, offsetFila: number, offsetsIndices: Map<number, number>): CeldaCruda[] {
  const celdas: CeldaCruda[] = [];
  for (const tc of filaXml.matchAll(/<w:tc\b[^>]*>([\s\S]*?)<\/w:tc>/g)) {
    const cuerpoCelda = tc[1];
    const parrafosCelda = [...cuerpoCelda.matchAll(/<w:p\b[^>]*w14:paraId="([0-9A-Fa-f]+)"[^>]*>([\s\S]*?)<\/w:p>/g)];
    const textoCelda = parrafosCelda
      .map(p => [...p[2].matchAll(/<w:t[^>]*>([^<]*)<\/w:t>/g)].map(t => t[1]).join(''))
      .join(' ').trim();
    // Toma el ÚLTIMO párrafo sin <w:r> de la celda como candidato a rellenar — casi siempre
    // las celdas de una tabla de specs traen un solo párrafo, así que en la práctica es el único.
    const parrafoVacio = [...parrafosCelda].reverse().find(p => !/<w:r[ >]/.test(p[2]));
    let paraId: string | null = null;
    let indiceGlobal: number | null = null;
    if (parrafoVacio && textoCelda === '') {
      paraId = parrafoVacio[1];
      // tc.index es la posición del <w:tc>...</w:tc> completo; cuerpoCelda (tc[1]) arranca
      // DESPUÉS de la apertura "<w:tc...>" — hay que sumar esa diferencia para llegar a la
      // posición real del párrafo dentro del XML completo (mismo ajuste para parrafoVacio.index,
      // que es relativo a cuerpoCelda).
      const offsetCelda = offsetFila + tc.index! + tc[0].indexOf(cuerpoCelda);
      indiceGlobal = offsetsIndices.get(offsetCelda + (parrafoVacio.index ?? 0)) ?? null;
    }
    celdas.push({ texto: textoCelda, vacio: textoCelda === '' && paraId != null, paraId, indiceGlobal });
  }
  return celdas;
}

export function detectarCandidatosTabla(xml: string): CandidatoCelda[] {
  const out: CandidatoCelda[] = [];
  const offsetsIndices = offsetsAIndices(xml);

  for (const tabla of xml.matchAll(/<w:tbl\b[^>]*>([\s\S]*?)<\/w:tbl>/g)) {
    const cuerpoTabla = tabla[1];
    const offsetTabla = tabla.index! + tabla[0].indexOf(cuerpoTabla);
    const filas = [...cuerpoTabla.matchAll(/<w:tr\b[^>]*>([\s\S]*?)<\/w:tr>/g)];
    if (filas.length < 2) continue; // hace falta al menos encabezado + 1 fila de datos

    const [primeraFila, ...restoFilas] = filas;
    const nombresColumna = extraerCeldasDeFila(primeraFila[1], 0, new Map()).map(c => c.texto);
    const hayEncabezado = nombresColumna.some(t => t.length > 0);

    for (const fila of restoFilas) {
      // Mismo ajuste que arriba: fila.index es la posición del <w:tr>...</w:tr> completo, pero
      // fila[1] (lo que se le pasa a extraerCeldasDeFila) arranca después de la apertura "<w:tr...>".
      const offsetFila = offsetTabla + fila.index! + fila[0].indexOf(fila[1]);
      const celdas = extraerCeldasDeFila(fila[1], offsetFila, offsetsIndices);
      if (celdas.length < 3) continue; // 2 columnas ya las cubre el patrón 1 (etiqueta | valor)

      let filaContexto = '';
      for (const c of celdas) if (c.texto.length > filaContexto.length) filaContexto = c.texto;
      if (!filaContexto) continue; // fila sin ningún texto real — no hay de dónde sacar etiqueta

      celdas.forEach((c, colIndex) => {
        if (!c.vacio || c.indiceGlobal == null || !c.paraId) return;
        const nombreColumna = hayEncabezado ? nombresColumna[colIndex] : '';
        const etiqueta = nombreColumna ? `${filaContexto} — ${nombreColumna}` : filaContexto;
        out.push({ etiqueta: etiqueta.slice(0, 160), paraId: c.paraId, indice: c.indiceGlobal });
      });
    }
  }
  return out;
}

// ── Patrón 2: subrayados dentro de una misma oración ──────────────────────────────────────
// indiceRun es GLOBAL (posición entre TODOS los <w:t> del documento — lo que espera
// rellenarRunPorIndice para editar). indiceParrafo ubica en qué párrafo cae (para agrupar por
// formulario después). El CONTEXTO se arma con el texto de TODO el párrafo, no solo del run
// donde cae el blanco — en Word real, la etiqueta ("Proveedor:") y la raya de subrayado
// (`____`) casi siempre son runs SEPARADOS (distinto formato), así que mirar solo el run del
// blanco perdía la etiqueta y mostraba "(sin contexto)" aunque el párrafo sí la tuviera.
export interface CandidatoInline {
  indiceRun: number; indiceParrafo: number;
  textoRunOriginal: string; posEnTexto: number; largo: number; contexto: string;
}

export function detectarBlancosInline(xml: string): CandidatoInline[] {
  const out: CandidatoInline[] = [];
  let indiceRunGlobal = 0;
  const parrafos = [...xml.matchAll(/<w:p\b[^>]*>([\s\S]*?)<\/w:p>/g)];

  parrafos.forEach((parMatch, indiceParrafo) => {
    const runsDelParrafo = [...parMatch[1].matchAll(/<w:t[^>]*>([^<]*)<\/w:t>/g)].map(m => m[1]);
    const textoParrafoCompleto = runsDelParrafo.join('');
    let offsetAcumulado = 0;

    for (const texto of runsDelParrafo) {
      for (const b of listarBlancosInline(texto)) {
        const posGlobalEnParrafo = offsetAcumulado + b.posEnTexto;
        const previo = textoParrafoCompleto.slice(0, posGlobalEnParrafo);
        const contexto = (previo.split(/[,.;]|\(\*+\)/).pop() || previo).trim().slice(-60);
        out.push({
          indiceRun: indiceRunGlobal, indiceParrafo,
          textoRunOriginal: texto, posEnTexto: b.posEnTexto, largo: b.largo,
          contexto: contexto || '(sin contexto)',
        });
      }
      offsetAcumulado += texto.length;
      indiceRunGlobal++;
    }
  });
  return out;
}

// ── Patrón 3: secciones por tipo de oferente (Natural / Jurídica / UTP) ───────────────────
// Regla del plan (categoría C): "omitir sin preguntar" Natural y UTP — nuestra empresa
// siempre postula como persona jurídica. Solo se habilita para rellenar la sección jurídica.
//
// Dos exclusiones agregadas después de encontrar falsos positivos reales:
//   1. Párrafos que EMPIEZAN con "firma" ("Firma representante legal o persona natural:") —
//      es un pie de firma que se repite en cada anexo, no un divisor de secciones.
//   2. Coincidencias donde después de la frase sigue más texto real (no solo puntuación) —
//      ej. "Naturaleza Jurídica (Persona Natural, Jurídica, Otra)" es la lista de opciones
//      de UN campo, no el título de una sección nueva.
export type TipoSeccion = 'PERSONA_NATURAL' | 'PERSONA_JURIDICA' | 'UTP';
export interface SeccionOferente { indiceInicio: number; indiceFin: number; tipo: TipoSeccion; decision: 'RELLENAR' | 'OMITIR'; textoEncabezado: string }

const PATRONES: { tipo: TipoSeccion; re: RegExp }[] = [
  { tipo: 'PERSONA_NATURAL', re: /persona\s+natural/i },
  { tipo: 'PERSONA_JURIDICA', re: /persona\s+jur[íi]dica/i },
  { tipo: 'UTP', re: /uni[óo]n\s+temporal\s+de\s+proveedores/i },
];
const LARGO_MAX_ENCABEZADO = 80;
const SOLO_PUNTUACION_FINAL = /^[\s_:"'”)]*$/;

function esEncabezadoDeSeccion(texto: string): { tipo: TipoSeccion } | null {
  if (texto.length > LARGO_MAX_ENCABEZADO) return null;
  if (/^firma\b/i.test(texto.trim())) return null; // pie de firma, no divisor
  for (const pat of PATRONES) {
    const m = texto.match(pat.re);
    if (!m) continue;
    const restante = texto.slice((m.index ?? 0) + m[0].length);
    if (SOLO_PUNTUACION_FINAL.test(restante)) return { tipo: pat.tipo }; // la frase es el final real del párrafo
  }
  return null;
}

export function detectarSecciones(parrafos: Parrafo[]): SeccionOferente[] {
  const encabezados: { indice: number; tipo: TipoSeccion; texto: string }[] = [];
  parrafos.forEach(p => {
    const h = esEncabezadoDeSeccion(p.texto);
    if (h) encabezados.push({ indice: p.indice, tipo: h.tipo, texto: p.texto });
  });

  return encabezados.map((h, i) => ({
    indiceInicio: h.indice,
    indiceFin: (encabezados[i + 1]?.indice ?? parrafos.length + 1) - 1,
    tipo: h.tipo,
    decision: h.tipo === 'PERSONA_JURIDICA' ? 'RELLENAR' : 'OMITIR',
    textoEncabezado: h.texto,
  }));
}

// Filtra candidatos de celda para quedarse SOLO con los que caen dentro de secciones
// habilitadas (RELLENAR) — si el documento no tiene secciones (caso común: un solo anexo sin
// variantes), no se descarta nada.
export function acotarASeccionesHabilitadas(candidatos: CandidatoCelda[], secciones: SeccionOferente[]): CandidatoCelda[] {
  if (!secciones.length) return candidatos;
  const rangosOmitidos = secciones.filter(s => s.decision === 'OMITIR');
  if (!rangosOmitidos.length) return candidatos;
  return candidatos.filter(c => !rangosOmitidos.some(r => c.indice >= r.indiceInicio && c.indice <= r.indiceFin));
}

// ── Patrón 4: línea de firma ("____________" + "Firma del Oferente...") ──────────────────
// Patrón real visto en TODOS los anexos con firma: un párrafo que es SOLO una raya larga,
// seguido (1-2 párrafos después, a veces con una línea en blanco entre medio) por una leyenda
// que menciona "firma". Es DISTINTO al blanco inline (patrón 2): no se le pide texto al humano,
// se le ofrece insertar la IMAGEN de la firma guardada en la ficha de la empresa (si existe) —
// ver insertarImagenEnParrafo() en anexos-docx.ts.
export interface LineaFirma { paraId: string; indice: number; contexto: string }

const RE_RAYA_LARGA = /^_{10,}$/;
// La leyenda bajo la raya no siempre dice "firma" — un caso real dice "Nombre Persona Natural o
// Representante legal..." sin esa palabra. "representante legal" / "persona natural" al pie de
// una raya de 10+ guiones es, en la práctica, siempre un bloque de firma en estos documentos.
const RE_LEYENDA_FIRMA = /firma|representante\s+legal|persona\s+natural/i;

export function detectarLineasFirma(parrafos: Parrafo[]): LineaFirma[] {
  const out: LineaFirma[] = [];
  for (let i = 0; i < parrafos.length; i++) {
    const p = parrafos[i];

    // Caso A: la raya ES todo el párrafo — la leyenda viene en el/los párrafo(s) siguiente(s)
    // ("____________\nFirma del Oferente...", en párrafos separados).
    if (RE_RAYA_LARGA.test(p.texto)) {
      const siguiente1 = parrafos[i + 1]?.texto || '';
      const siguiente2 = parrafos[i + 2]?.texto || '';
      const contexto = RE_LEYENDA_FIRMA.test(siguiente1) ? siguiente1 : (RE_LEYENDA_FIRMA.test(siguiente2) ? siguiente2 : '');
      if (contexto) { out.push({ paraId: p.paraId, indice: p.indice, contexto }); continue; }
    }

    // Caso B: la raya y la leyenda comparten el MISMO párrafo — otro patrón real visto
    // ("____________________ Nombre Persona Natural o Representante legal...", todo junto).
    const compuesto = p.texto.match(/^_{10,}\s*(.+)$/);
    if (compuesto && RE_LEYENDA_FIRMA.test(compuesto[1])) {
      out.push({ paraId: p.paraId, indice: p.indice, contexto: compuesto[1].trim() });
    }
  }
  return out;
}

// ── Punto de entrada: analiza un XML completo y devuelve los patrones + secciones ─────────
export function analizarAnexo(xml: string) {
  const parrafos = listarParrafos(xml);
  const secciones = detectarSecciones(parrafos);

  // El patrón de tabla (1b) va PRIMERO — tiene mejor etiqueta — y el patrón plano (1) solo
  // aporta los índices que la tabla no reclamó, para no mostrar el mismo blanco dos veces con
  // una etiqueta buena y otra mala ("CO").
  const candidatosTabla = detectarCandidatosTabla(xml);
  const indicesTabla = new Set(candidatosTabla.map(c => c.indice));
  const candidatosCeldaCrudos = detectarCandidatosCelda(parrafos).filter(c => !indicesTabla.has(c.indice));

  const candidatosCelda = acotarASeccionesHabilitadas([...candidatosTabla, ...candidatosCeldaCrudos], secciones);

  const lineasFirma = detectarLineasFirma(parrafos);
  const indicesFirma = new Set(lineasFirma.map(f => f.indice));
  // La raya de una línea de firma también matchea el patrón 2 (blanco inline, "_{4,}") — se
  // excluye de ahí para no ofrecer un input de texto Y la firma para el mismo párrafo.
  const blancosInline = detectarBlancosInline(xml).filter(b => !indicesFirma.has(b.indiceParrafo));

  return { parrafos, secciones, candidatosCelda, blancosInline, lineasFirma };
}
