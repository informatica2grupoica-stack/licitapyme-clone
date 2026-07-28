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

// ── Patrón 2: subrayados dentro de una misma oración ──────────────────────────────────────
export interface CandidatoInline { indiceRun: number; textoRunOriginal: string; posEnTexto: number; largo: number; contexto: string }

export function detectarBlancosInline(xml: string): CandidatoInline[] {
  const out: CandidatoInline[] = [];
  const runs = [...xml.matchAll(/<w:t[^>]*>([^<]*)<\/w:t>/g)].map(m => m[1]);
  runs.forEach((texto, indiceRun) => {
    for (const b of listarBlancosInline(texto)) {
      out.push({ indiceRun, textoRunOriginal: texto, posEnTexto: b.posEnTexto, largo: b.largo, contexto: b.contexto });
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

// ── Punto de entrada: analiza un XML completo y devuelve los 3 patrones + secciones ───────
export function analizarAnexo(xml: string) {
  const parrafos = listarParrafos(xml);
  const secciones = detectarSecciones(parrafos);
  const candidatosCeldaCrudos = detectarCandidatosCelda(parrafos);
  const candidatosCelda = acotarASeccionesHabilitadas(candidatosCeldaCrudos, secciones);
  const blancosInline = detectarBlancosInline(xml);
  return { parrafos, secciones, candidatosCelda, blancosInline };
}
