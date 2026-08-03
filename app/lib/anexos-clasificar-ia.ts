// app/lib/anexos-clasificar-ia.ts
// Reemplaza, para los candidatos que el diccionario determinista (buscarCampo) NO resolvió, el
// heurístico frágil "candidato anterior en una lista plana" (desambiguarDuplicados) + el respaldo
// IA sin contexto real (matchearConIA) + el clasificador de títulos (clasificarTitulos) — todo
// por un ÚNICO criterio: mostrarle a la IA el CONTEXTO REAL del candidato (fila/columna si viene
// de una tabla, párrafos anteriores si es un formulario de texto corrido) y que devuelva
// DIRECTAMENTE el campo de EmpresaCampos que corresponde, o ninguno.
//
// Caso real que motiva esto (1057472-89-LE26): el bloque "REPRESENTANTE LEGAL" de un anexo
// quedaba vacío por completo porque "Nombre completo" era la PRIMERA vez que esa etiqueta
// aparecía en el documento — desambiguarDuplicados no tenía ningún "candidato anterior" del cual
// heredar contexto, así que nunca se enteraba de que estaba bajo el encabezado "REPRESENTANTE
// LEGAL:". Acá se le da a la IA el contexto REAL (los párrafos que preceden al campo), no un
// parche de texto.
//
// Respuesta SIEMPRE por vocabulario controlado (uno de EmpresaCampos), nunca texto libre: si la
// IA devolviera una frase parafraseada, buscarCampo (que matchea contra la REDACCIÓN ORIGINAL del
// anexo) nunca la reconocería — por eso "clasificar" y "decidir el campo" se fusionan en una sola
// llamada, no en dos pasos.
//
// gemini.ts es server-only (arrastra node:async_hooks) — este módulo NUNCA se importa desde un
// Client Component, solo desde anexos-rellenar.ts (que a su vez solo corren las rutas /api/anexos).
import { crearChatIA } from '@/app/lib/gemini';
import { parseJsonIA } from '@/app/lib/json-ia';
import { CAMPOS_DISPONIBLES } from '@/app/lib/anexos-ia-matching';
import type { EmpresaCampos } from '@/app/lib/anexos-diccionario';
import type { Parrafo } from '@/app/lib/anexos-docx';
import type { CandidatoCelda } from '@/app/lib/anexos-detectar';

// Lote MUCHO más chico que el de otros matchers de este sistema (25-35 en anexos-ia-matching.ts /
// anexos-precios-ia.ts): cada candidato acá carga bastante más contexto (hasta 5 párrafos previos
// completos, no solo una etiqueta corta), así que el prompt por lote es varias veces más largo.
// Probado en vivo (1057472-89-LE26): con lote de 25 el modelo fallaba hasta en casos triviales
// ("Correo electrónico" con contexto de empresa clarísimo); con el MISMO candidato en un lote de
// 2, acertó perfecto — señal de saturación por tamaño de prompt, no de que el contexto no alcance.
const TAMANO_LOTE = 8;
const CANTIDAD_PARRAFOS_PREVIOS = 5;

function enLotes<T>(items: T[], tamano: number): T[][] {
  const lotes: T[][] = [];
  for (let i = 0; i < items.length; i += tamano) lotes.push(items.slice(i, i + tamano));
  return lotes;
}

// Los últimos N párrafos NO vacíos antes del candidato, en orden cronológico — el contexto que un
// humano leería para saber "¿de quién es este dato?" (ej. ve "REPRESENTANTE LEGAL:" tres párrafos
// arriba y entiende que el "Nombre completo" de acá abajo es el del representante, no el de la
// empresa). `antesDeIndice` es el índice de la etiqueta (candidato.indice - 1 en un formulario
// plano) — nunca el del blanco mismo, que siempre está vacío y no aportaría nada.
function contextoParrafosPrevios(parrafos: Parrafo[], antesDeIndice: number): string[] {
  const out: string[] = [];
  for (let i = antesDeIndice - 1; i >= 0 && out.length < CANTIDAD_PARRAFOS_PREVIOS; i--) {
    const p = parrafos[i];
    if (p?.texto && !p.vacio) out.push(p.texto);
  }
  return out.reverse();
}

export interface CandidatoConContexto {
  candidato: CandidatoCelda;
  contexto: { filaTabla?: string; columnaTabla?: string; parrafosPrevios?: string[] };
}

// Si la etiqueta viene compuesta ("<fila> — <columna>", patrón 1b de anexos-detectar.ts — SIN
// pasar por desambiguarDuplicados, así que acá SIEMPRE es fila real de tabla, nunca el parche de
// "candidato anterior"), se separan las dos piezas. Los párrafos previos se agregan SIEMPRE como
// red adicional — barato, y para una tabla suele ser ruido menor comparado con fila/columna, pero
// nunca hace daño tenerlo.
export function armarContexto(candidatos: CandidatoCelda[], parrafos: Parrafo[]): CandidatoConContexto[] {
  return candidatos.map(c => {
    const compuesta = c.etiqueta.match(/^(.+?)\s+—\s+(.+)$/);
    const contexto: CandidatoConContexto['contexto'] = {
      parrafosPrevios: contextoParrafosPrevios(parrafos, c.indice - 1),
    };
    if (compuesta) { contexto.filaTabla = compuesta[1]; contexto.columnaTabla = compuesta[2]; }
    return { candidato: c, contexto };
  });
}

const SYS = `Eres un asistente que identifica a qué dato de una empresa corresponde un campo detectado en un formulario Word de una licitación pública chilena (anexo de oferta).

Te doy una lista NUMERADA de CANDIDATOS — cada uno es un blanco a rellenar, con su etiqueta cruda y el CONTEXTO real que lo rodea (fila/columna si viene de una tabla, o los párrafos anteriores si es un formulario de texto corrido) — y una lista NUMERADA de CAMPOS DISPONIBLES de la empresa que postula.

Para cada candidato, decide si pide EXACTAMENTE uno de esos campos — aunque la etiqueta esté redactada distinto (abreviada, con errores de tipeo, en otro orden de palabras). Usa el CONTEXTO para saber DE QUIÉN es el dato:
- Si el contexto deja claro que es un dato de la EMPRESA que postula, asígnalo al campo de empresa correspondiente.
- Si el contexto deja claro que es del REPRESENTANTE LEGAL (ej. aparece bajo un encabezado "REPRESENTANTE LEGAL", o la fila/columna lo menciona), usa los campos representante_*.
- Si el contexto deja claro que es de un TERCERO que no es ni la empresa ni su representante legal (administrador de contrato, encargado de la propuesta, persona de contacto, titular de una cuenta bancaria ajena, un participante de una capacitación, la contraparte/mandante) — NO asignes, aunque el dato pedido "se parezca" a uno que tenemos. No inventes de quién es si el contexto no lo dice.
- Si es un encabezado, título de sección, o nombre de columna genérico ("CANTIDAD", "PRECIO", "OBSERVACIONES") sin un dato propio que pedir — NO asignes.

Ante cualquier duda, NO asignes — es mucho peor escribir un dato incorrecto (o en el campo de la persona equivocada) que dejarlo pendiente para que un humano lo complete.

Responde SOLO con NÚMEROS (nunca copies texto) — devuelve SOLO JSON, sin markdown ni texto adicional:
{"clasificaciones":[{"id":<número del candidato>,"campo":<número del campo, o null si ninguno aplica>}]}`;

export interface ClasificacionIA { indice: number; campo: keyof EmpresaCampos }

function formatearCandidato(it: CandidatoConContexto, n: number): string {
  const partes = [`etiqueta: "${it.candidato.etiqueta}"`];
  if (it.contexto.filaTabla) partes.push(`fila de tabla: "${it.contexto.filaTabla}"`);
  if (it.contexto.columnaTabla) partes.push(`columna: "${it.contexto.columnaTabla}"`);
  if (it.contexto.parrafosPrevios?.length) {
    partes.push(`párrafos anteriores (del más lejano al más cercano): ${it.contexto.parrafosPrevios.map(p => `"${p}"`).join(' / ')}`);
  }
  return `${n}. ${partes.join(' — ')}`;
}

async function clasificarLote(
  items: CandidatoConContexto[], camposConDato: { campo: keyof EmpresaCampos; descripcion: string }[],
): Promise<ClasificacionIA[]> {
  const user = `CANDIDATOS (${items.length}):
${items.map((it, i) => formatearCandidato(it, i + 1)).join('\n')}

CAMPOS DISPONIBLES DE LA EMPRESA (número: campo):
${camposConDato.map((c, i) => `${i + 1}: ${c.descripcion}`).join('\n')}`;

  try {
    const completion: any = await crearChatIA({
      messages: [{ role: 'system', content: SYS }, { role: 'user', content: user }],
      temperature: 0, stream: false, max_tokens: 4_000,
      response_format: { type: 'json_object' },
    }, { timeoutMs: 60_000 });

    const txt = String(completion.choices?.[0]?.message?.content ?? '');
    const parsed: any = parseJsonIA(txt) || {};
    const arr = Array.isArray(parsed.clasificaciones) ? parsed.clasificaciones : [];

    const out: ClasificacionIA[] = [];
    for (const c of arr) {
      if (!c) continue;
      const iItem = Number(c.id), iCampo = Number(c.campo);
      if (!Number.isInteger(iItem) || !Number.isInteger(iCampo)) continue; // null/no numérico → sin asignar
      const item = items[iItem - 1];
      const campo = camposConDato[iCampo - 1];
      if (!item || !campo) continue; // número fuera de rango — se descarta, nunca se adivina
      out.push({ indice: item.candidato.indice, campo: campo.campo });
    }
    return out;
  } catch (error) {
    console.error('[anexos-clasificar-ia] Falló un lote, ese lote sigue sin clasificar:', String(error).slice(0, 200));
    return [];
  }
}

// Devuelve, por índice de candidato, el campo de EmpresaCampos que le corresponde — solo los que
// la IA logró clasificar con confianza. Cada campo se usa a lo más UNA vez (mismo principio que
// el resto del sistema: un posible acierto real no vale el riesgo de que un mismo error se repita
// en varios lugares del documento). Nunca lanza: si un lote falla, se degrada a "sin clasificar
// PARA ESE LOTE", sin tumbar el resto del análisis.
export async function clasificarConIA(
  candidatos: CandidatoCelda[], parrafos: Parrafo[], empresa: EmpresaCampos,
): Promise<Map<number, keyof EmpresaCampos>> {
  const camposConDato = CAMPOS_DISPONIBLES.filter(c => empresa[c.campo] != null && String(empresa[c.campo]).trim());
  if (candidatos.length === 0 || camposConDato.length === 0) return new Map();

  const conContexto = armarContexto(candidatos, parrafos);
  const resultados = await Promise.all(enLotes(conContexto, TAMANO_LOTE).map(lote => clasificarLote(lote, camposConDato)));

  const usados = new Set<string>();
  const mapa = new Map<number, keyof EmpresaCampos>();
  for (const r of resultados.flat()) {
    if (usados.has(r.campo)) continue;
    usados.add(r.campo);
    mapa.set(r.indice, r.campo);
  }
  return mapa;
}
