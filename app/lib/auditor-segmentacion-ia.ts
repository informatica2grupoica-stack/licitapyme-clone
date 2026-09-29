// app/lib/auditor-segmentacion-ia.ts
// Plan B de "un PDF con todos los ítems": cuando el documento NO trae encabezados "ÍTEM N" ni tabla numerada
// (caso típico: varias fichas/capturas de productos DISTINTOS pegadas en un PDF, sin numerar), la IA solo AGRUPA
// páginas por producto y sugiere a qué línea pertenece cada grupo. No compara ni inventa datos: el texto de cada
// bloque es el del documento tal cual. La comparación posterior sigue siendo la de siempre.
import { crearChatIA } from '@/app/lib/gemini';
import { parseJsonIA } from '@/app/lib/json-ia';
import { MOTOR_GLM } from '@/app/lib/auditor-tecnico';
import type { BloqueDocumento, LineaAMapear } from '@/app/lib/auditor-segmentacion';

export interface PaginaDoc { n: number; texto: string }

/** Parte el texto extraído en páginas usando los marcadores `[[PÁGINA n]]` del extractor. [] si no los trae. */
export function paginasDelTexto(texto: string): PaginaDoc[] {
  const partes = String(texto || '').split(/^\[\[P[ÁA]GINA\s+(\d+)\]\]\s*$/im);
  const out: PaginaDoc[] = [];
  for (let i = 1; i + 1 < partes.length; i += 2) out.push({ n: Number(partes[i]), texto: partes[i + 1].trim() });
  return out;
}

export interface AgrupacionCruda { nombre?: unknown; paginas?: unknown; linea?: unknown }

/** Convierte la respuesta de la IA en bloques. Cada página se usa una sola vez y cada línea recibe un solo producto. */
export function bloquesDeAgrupacion(paginas: PaginaDoc[], crudos: AgrupacionCruda[], lineasValidas: Set<number>): { bloques: BloqueDocumento[]; porLinea: Map<number, BloqueDocumento> } {
  const porN = new Map(paginas.map(p => [p.n, p]));
  const usadas = new Set<number>();
  const bloques: BloqueDocumento[] = [];
  const porLinea = new Map<number, BloqueDocumento>();
  for (const c of crudos) {
    const nombre = String(c?.nombre ?? '').trim().slice(0, 200);
    const pags = (Array.isArray(c?.paginas) ? c.paginas : []).map(Number).filter(n => porN.has(n) && !usadas.has(n)).sort((a, b) => a - b);
    if (!nombre || !pags.length) continue;
    pags.forEach(n => usadas.add(n));
    const bloque: BloqueDocumento = { numero: null, titulo: nombre, texto: pags.map(n => `[[PÁGINA ${n}]]\n${porN.get(n)!.texto}`).join('\n\n') };
    bloques.push(bloque);
    const linea = Number(c?.linea);
    if (Number.isInteger(linea) && lineasValidas.has(linea) && !porLinea.has(linea)) porLinea.set(linea, bloque);
  }
  return { bloques, porLinea };
}

const SYS = `Recibes el texto (con OCR, puede tener ruido) de un PDF que junta fichas técnicas o capturas de varios productos DISTINTOS, cada página marcada con [[PÁGINA n]], y la lista de LÍNEAS de una licitación.
Tu única tarea es AGRUPAR las páginas por producto y decir a qué línea corresponde cada producto.
Reglas:
- Un producto puede ocupar varias páginas seguidas. Una página pertenece a un solo producto.
- "nombre" = el producto tal como lo nombra el documento (marca y modelo si aparecen). No inventes nada que no esté en el texto.
- "linea" = número de la línea de la lista que ese producto podría satisfacer; null si ninguna claramente corresponde. No fuerces coincidencias.
- Páginas que no son de ningún producto (portadas, avisos) se omiten.
Responde SOLO JSON: {"productos":[{"nombre":"...","paginas":[1,2],"linea":3}]}`;

export async function segmentarConIA(paginas: PaginaDoc[], lineas: LineaAMapear[]): Promise<{ bloques: BloqueDocumento[]; porLinea: Map<number, BloqueDocumento> }> {
  const user = `LÍNEAS DE LA LICITACIÓN:\n${lineas.map(l => `${l.linea}. ${l.nombre}`).join('\n')}\n\nPÁGINAS DEL PDF:\n${paginas.map(p => `[[PÁGINA ${p.n}]]\n${p.texto.slice(0, 900)}`).join('\n\n')}`;
  const completion: any = await crearChatIA({
    messages: [{ role: 'system', content: SYS }, { role: 'user', content: user }],
    temperature: 0.1, stream: false, max_tokens: MOTOR_GLM.maxTokens, response_format: { type: 'json_object' },
  }, { timeoutMs: MOTOR_GLM.timeoutMs, modeloPreferido: MOTOR_GLM.modeloPreferido, proveedorPreferido: MOTOR_GLM.proveedorPreferido, sinRespaldo: MOTOR_GLM.sinRespaldo });
  const parsed = parseJsonIA(String(completion.choices?.[0]?.message?.content ?? '')) as any;
  return bloquesDeAgrupacion(paginas, Array.isArray(parsed?.productos) ? parsed.productos : [], new Set(lineas.map(l => l.linea)));
}
