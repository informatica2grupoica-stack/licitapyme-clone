// app/lib/anexos-rellenar.ts
// Frente E.1 — orquestador de alto nivel: junta detección + diccionario + relleno. Expone dos
// funciones puras (buffer → resultado, sin DB ni R2 — eso vive en anexos-datos.ts):
//
//   analizarAnexoParaUI()  — SOLO LECTURA. Para la pantalla: qué se completaría solo y qué le
//                            falta a un humano, con un id ESTABLE por cada pendiente para que
//                            el formulario pueda mandarlo de vuelta en generarAnexoFinal().
//   generarAnexoFinal()    — aplica el auto-relleno del diccionario MÁS las respuestas del
//                            humano, y devuelve el .docx final.
//
// Como no hay estado entre una llamada HTTP y la otra (analizar y generar son requests
// separados), los ids de los pendientes NO pueden depender del w14:paraId que
// normalizarParaIds() inventa para párrafos que no traían uno — ese id es aleatorio y cambia
// en cada llamada. En cambio, el ÍNDICE de aparición (posición en el documento, calculado por
// simple orden de un regex.matchAll) es determinístico para el mismo documento sin importar
// qué string de paraId le haya tocado esta vez — por eso los ids usan índice, nunca paraId.
import {
  normalizarParaIds, rellenarCeldaVacia, rellenarRunPorIndice,
  verificarParrafos, abrirDocx, guardarDocx,
} from '@/app/lib/anexos-docx';
import { analizarAnexo } from '@/app/lib/anexos-detectar';
import { buscarCampo, type EmpresaCampos } from '@/app/lib/anexos-diccionario';
import { detectarFormularios, type FormularioDetectado } from '@/app/lib/anexos-dividir';

export interface CampoCompletado { etiqueta: string; campo: string; valor: string }
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

export interface AnalisisAnexo {
  completadosAuto: CampoCompletado[];
  pendientesCelda: PendienteCelda[];
  pendientesInline: PendienteInline[];
  secciones: SeccionInfo[];
}

export async function analizarAnexoParaUI(bufferOriginal: Buffer, empresa: EmpresaCampos): Promise<AnalisisAnexo> {
  const { xml: xmlCrudo } = await abrirDocx(bufferOriginal);
  const { xml: xmlNormalizado } = normalizarParaIds(xmlCrudo);
  const analisis = analizarAnexo(xmlNormalizado);
  const formularios = detectarFormularios(xmlNormalizado);

  const completadosAuto: CampoCompletado[] = [];
  const pendientesCelda: PendienteCelda[] = [];
  const camposYaUsados = new Set<string>();

  for (const c of analisis.candidatosCelda) {
    const match = buscarCampo(c.etiqueta, empresa);
    if (match && !camposYaUsados.has(match.campo)) {
      completadosAuto.push({ etiqueta: c.etiqueta, campo: match.campo, valor: match.valor });
      camposYaUsados.add(match.campo);
    } else if (!match) {
      pendientesCelda.push({ id: `celda:${c.indice}`, etiqueta: c.etiqueta, formulario: formularioDe(c.indice, formularios) });
    }
  }

  const pendientesInline: PendienteInline[] = analisis.blancosInline.map(b => ({
    id: `inline:${b.indiceRun}:${b.posEnTexto}`,
    contexto: b.contexto || '(sin contexto)',
    formulario: formularioDe(b.indiceParrafo, formularios),
  }));

  return {
    completadosAuto,
    pendientesCelda,
    pendientesInline,
    secciones: analisis.secciones.map(s => ({ tipo: s.tipo, decision: s.decision, textoEncabezado: s.textoEncabezado })),
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

  // 2) Celdas de tabla: automáticas (diccionario) + manuales (lo que el humano escribió para
  //    las que no matchearon). Van después — ver comentario arriba.
  let completados = 0;
  const camposYaUsados = new Set<string>();
  for (const c of analisis.candidatosCelda) {
    const match = buscarCampo(c.etiqueta, empresa);
    if (match && !camposYaUsados.has(match.campo)) {
      xml = rellenarCeldaVacia(xml, c.paraId, match.valor);
      camposYaUsados.add(match.campo);
      completados++;
    } else {
      const respuesta = respuestas[`celda:${c.indice}`];
      if (respuesta && respuesta.trim()) {
        xml = rellenarCeldaVacia(xml, c.paraId, respuesta.trim());
        respondidos++;
      }
    }
  }

  const integridad = verificarParrafos(xmlCrudo, xml);
  const buffer = await guardarDocx(zip, xml);

  return { buffer, completados, respondidos, integridad };
}
