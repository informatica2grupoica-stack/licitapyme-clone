// app/lib/anexos-rellenar.ts
// Frente E.1 — orquestador de alto nivel: junta detección + diccionario + respaldo IA + relleno.
// Expone dos funciones puras (buffer → resultado, sin DB ni R2 — eso vive en anexos-datos.ts):
//
//   analizarAnexoParaUI()  — SOLO LECTURA. Para la pantalla: qué se completaría solo y qué le
//                            falta a un humano, con un id ESTABLE por cada pendiente para que
//                            el formulario pueda mandarlo de vuelta en generarAnexoFinal().
//   generarAnexoFinal()    — aplica el auto-relleno (diccionario + IA) MÁS las respuestas del
//                            humano, y devuelve el .docx final.
//
// Como no hay estado entre una llamada HTTP y la otra (analizar y generar son requests
// separados), los ids de los pendientes NO pueden depender del w14:paraId que
// normalizarParaIds() inventa para párrafos que no traían uno — ese id es aleatorio y cambia
// en cada llamada. En cambio, el ÍNDICE de aparición (posición en el documento, calculado por
// simple orden de un regex.matchAll) es determinístico para el mismo documento sin importar
// qué string de paraId le haya tocado esta vez — por eso los ids usan índice, nunca paraId.
import {
  normalizarParaIds, rellenarCeldaVacia, rellenarRunPorIndice, insertarImagenEnParrafo,
  verificarParrafos, abrirDocx, guardarDocx,
} from '@/app/lib/anexos-docx';
import { analizarAnexo, type CandidatoCelda } from '@/app/lib/anexos-detectar';
import { buscarCampo, type EmpresaCampos } from '@/app/lib/anexos-diccionario';
import { matchearConIA } from '@/app/lib/anexos-ia-matching';
import { detectarFormularios, type FormularioDetectado } from '@/app/lib/anexos-dividir';

export interface CampoCompletado { etiqueta: string; campo: string; valor: string; via: 'diccionario' | 'ia' }
export interface PendienteCelda { id: string; etiqueta: string; formulario?: string }
export interface PendienteInline { id: string; contexto: string; formulario?: string }
export interface SeccionInfo { tipo: string; decision: string; textoEncabezado: string }

// A qué formulario ("FORMULARIO N°X") pertenece un párrafo, si el documento tiene varios
// pegados — mismo detector que usa anexos-dividir.ts para separarlos en archivos. Sirve para
// agrupar los pendientes en el modal: sin esto, un texto repetido en cada formulario (ej. "Firma
// del Oferente" o la fecha de la ciudad) sale 5 veces idéntico y no hay forma de saber cuál es
// cuál. Si el documento no tiene ese patrón, todos quedan sin grupo (undefined) — no cambia nada.
function formularioDe(indiceParrafo: number, formularios: FormularioDetectado[]): string | undefined {
  return formularios.find(f => indiceParrafo >= f.indiceInicio && indiceParrafo <= f.indiceFin)?.titulo;
}

// Separa los candidatos de celda en "se completan con el diccionario" y "les falta match" —
// compartido entre analizarAnexoParaUI y generarAnexoFinal para no duplicar la lógica.
function aplicarDiccionario(candidatos: CandidatoCelda[], empresa: EmpresaCampos) {
  const matcheados: { c: CandidatoCelda; campo: string; valor: string }[] = [];
  const sinMatch: CandidatoCelda[] = [];
  const camposYaUsados = new Set<string>();
  for (const c of candidatos) {
    const match = buscarCampo(c.etiqueta, empresa);
    if (match && !camposYaUsados.has(match.campo)) {
      matcheados.push({ c, campo: match.campo, valor: match.valor });
      camposYaUsados.add(match.campo);
    } else {
      sinMatch.push(c);
    }
  }
  return { matcheados, sinMatch, camposYaUsados };
}

// Descarga la firma escaneada desde su URL pública (R2) y detecta su extensión real por
// Content-Type (más confiable que confiar en el nombre del archivo). null si falla o no hay
// firma cargada — nunca rompe el análisis/generación completa por esto.
async function descargarFirma(firmaUrl: string): Promise<{ buffer: Buffer; extension: string } | null> {
  try {
    const res = await fetch(firmaUrl);
    if (!res.ok) return null;
    const buffer = Buffer.from(await res.arrayBuffer());
    const contentType = res.headers.get('content-type') || '';
    const extension = /png/i.test(contentType) ? 'png'
      : /jpe?g/i.test(contentType) ? 'jpg'
      : (firmaUrl.split('.').pop() || 'png').split('?')[0].toLowerCase();
    return { buffer, extension };
  } catch {
    return null;
  }
}

export interface FirmaInfo { detectada: boolean; disponible: boolean }

export interface AnalisisAnexo {
  completadosAuto: CampoCompletado[];
  pendientesCelda: PendienteCelda[];
  pendientesInline: PendienteInline[];
  secciones: SeccionInfo[];
  firma: FirmaInfo;
}

export async function analizarAnexoParaUI(bufferOriginal: Buffer, empresa: EmpresaCampos): Promise<AnalisisAnexo> {
  const { xml: xmlCrudo } = await abrirDocx(bufferOriginal);
  const { xml: xmlNormalizado } = normalizarParaIds(xmlCrudo);
  const analisis = analizarAnexo(xmlNormalizado);
  const formularios = detectarFormularios(xmlNormalizado);

  const completadosAuto: CampoCompletado[] = [];
  const { matcheados, sinMatch, camposYaUsados } = aplicarDiccionario(analisis.candidatosCelda, empresa);
  for (const m of matcheados) completadosAuto.push({ etiqueta: m.c.etiqueta, campo: m.campo, valor: m.valor, via: 'diccionario' });

  // Respaldo IA: solo para lo que el diccionario no pudo matchear.
  const matchesIA = await matchearConIA(sinMatch.map(c => c.etiqueta), empresa);
  const mapaIA = new Map(matchesIA.map(m => [m.etiqueta, m.campo]));

  const pendientesCelda: PendienteCelda[] = [];
  for (const c of sinMatch) {
    const campoIA = mapaIA.get(c.etiqueta);
    const valorIA = campoIA ? empresa[campoIA] : null;
    if (campoIA && valorIA && !camposYaUsados.has(campoIA)) {
      completadosAuto.push({ etiqueta: c.etiqueta, campo: campoIA, valor: String(valorIA), via: 'ia' });
      camposYaUsados.add(campoIA);
    } else {
      pendientesCelda.push({ id: `celda:${c.indice}`, etiqueta: c.etiqueta, formulario: formularioDe(c.indice, formularios) });
    }
  }

  const pendientesInline: PendienteInline[] = analisis.blancosInline.map(b => ({
    id: `inline:${b.indiceRun}:${b.posEnTexto}`,
    contexto: b.contexto || '(sin contexto)',
    formulario: formularioDe(b.indiceParrafo, formularios),
  }));

  const firma: FirmaInfo = { detectada: analisis.lineasFirma.length > 0, disponible: !!empresa.firma_url };
  if (firma.detectada && firma.disponible) {
    completadosAuto.push({ etiqueta: 'Firma', campo: 'firma_url', valor: '(imagen de la firma guardada)', via: 'diccionario' });
  }

  return {
    completadosAuto,
    pendientesCelda,
    pendientesInline,
    secciones: analisis.secciones.map(s => ({ tipo: s.tipo, decision: s.decision, textoEncabezado: s.textoEncabezado })),
    firma,
  };
}

export interface ResultadoGeneracion {
  buffer: Buffer;
  completados: number;
  respondidos: number;
  integridad: { parrafosIguales: boolean; parrafosAntes: number; parrafosDespues: number };
}

export async function generarAnexoFinal(
  bufferOriginal: Buffer,
  empresa: EmpresaCampos,
  respuestas: Record<string, string>,
): Promise<ResultadoGeneracion> {
  const { zip, xml: xmlCrudo } = await abrirDocx(bufferOriginal);
  const { xml: xmlNormalizado } = normalizarParaIds(xmlCrudo);
  const analisis = analizarAnexo(xmlNormalizado);

  let xml = xmlNormalizado;
  let respondidos = 0;

  // 1) Blancos inline PRIMERO. rellenarRunPorIndice ubica cada run por su posición de aparición
  //    (indiceRun), calculada sobre el documento tal cual quedó tras normalizar. El paso 2
  //    (celdas) INSERTA un <w:t> nuevo dentro de párrafos que hoy no tienen ninguno — eso
  //    correría el índice de todos los runs que aparecen después. Mientras este paso solo EDITE
  //    texto de runs que ya existían (nunca agrega/quita un <w:t>), el orden de aparición no
  //    cambia y los índices siguen siendo válidos.
  const porRun = new Map<number, { pos: number; largo: number; valor: string }[]>();
  for (const b of analisis.blancosInline) {
    const respuesta = respuestas[`inline:${b.indiceRun}:${b.posEnTexto}`];
    if (!respuesta || !respuesta.trim()) continue;
    if (!porRun.has(b.indiceRun)) porRun.set(b.indiceRun, []);
    porRun.get(b.indiceRun)!.push({ pos: b.posEnTexto, largo: b.largo, valor: respuesta.trim() });
    respondidos++;
  }
  for (const [indiceRun, ediciones] of porRun) {
    xml = rellenarRunPorIndice(xml, indiceRun, ediciones);
  }

  // 2) Celdas de tabla: diccionario → respaldo IA → lo que escribió el humano. Van después —
  //    ver comentario arriba.
  let completados = 0;
  const { matcheados, sinMatch, camposYaUsados } = aplicarDiccionario(analisis.candidatosCelda, empresa);
  for (const m of matcheados) {
    xml = rellenarCeldaVacia(xml, m.c.paraId, m.valor);
    completados++;
  }

  const matchesIA = await matchearConIA(sinMatch.map(c => c.etiqueta), empresa);
  const mapaIA = new Map(matchesIA.map(m => [m.etiqueta, m.campo]));
  for (const c of sinMatch) {
    const campoIA = mapaIA.get(c.etiqueta);
    const valorIA = campoIA ? empresa[campoIA] : null;
    if (campoIA && valorIA && !camposYaUsados.has(campoIA)) {
      xml = rellenarCeldaVacia(xml, c.paraId, String(valorIA));
      camposYaUsados.add(campoIA);
      completados++;
    } else {
      const respuesta = respuestas[`celda:${c.indice}`];
      if (respuesta && respuesta.trim()) {
        xml = rellenarCeldaVacia(xml, c.paraId, respuesta.trim());
        respondidos++;
      }
    }
  }

  // 3) Línea de firma: inserta la IMAGEN real (no texto) si la empresa tiene una firma
  //    escaneada cargada. Va AL FINAL a propósito: insertarImagenEnParrafo() quita el <w:t> de
  //    la raya de subrayado y lo reemplaza por un <w:drawing> — eso cambia la cuenta global de
  //    <w:t> del documento, así que tiene que correr DESPUÉS del paso 1 (que todavía depende de
  //    esa cuenta para ubicar runs por índice). El paso 2 no le importa el orden porque ubica
  //    todo por paraId, nunca por índice.
  if (analisis.lineasFirma.length > 0 && empresa.firma_url) {
    const firma = await descargarFirma(empresa.firma_url);
    if (firma) {
      for (const linea of analisis.lineasFirma) {
        xml = await insertarImagenEnParrafo(zip, xml, linea.paraId, firma.buffer, firma.extension);
      }
    }
  }

  const integridad = verificarParrafos(xmlCrudo, xml);
  const buffer = await guardarDocx(zip, xml);

  return { buffer, completados, respondidos, integridad };
}
