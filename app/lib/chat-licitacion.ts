// app/lib/chat-licitacion.ts
// Backend del chatbot por licitación.
//
// Idea central: NO re-descargar ni re-OCR-ear en cada pregunta. El texto de cada
// documento ya está en documentos_cache.texto_extraido (lo llena la viabilidad IA).
// Aquí solo se CONCATENA/CACHEA ese texto y se responde con un LLM:
//   - Corpus completo de la licitación → construirContextoChat (cacheado en
//     licitacion_contexto_chat, se invalida cuando cambian/re-extraen documentos).
//   - Un solo documento (chat rápido por fila) → construirContextoDocumento (una fila
//     de documentos_cache, sin cache propio: es poco texto).
//
// Historial persistido en chat_licitacion por sesion_id ("corpus" para el panel
// completo; "doc:<nombre>" para el chat rápido de un documento).
//
// Modelo principal: GLM de Z.AI, fijado a glm-4.7 (MODELO_CHAT_PRINCIPAL más abajo) — NO el
// glm-4.7-flashx por defecto del resto del sistema, ver el comentario junto a esa constante.
// Respaldo automático (cfgTextoRespaldos en gemini.ts): otro modelo GLM más liviano, luego
// DeepSeek. Gemini está RETIRADO (dormido salvo GEMINI_HABILITADO=1 + key).

import pool from './db';
import { crearChatIA, geminiHabilitado } from './gemini';
import { ocrTieneHuecos } from './zai-ocr';

// AUDITORÍA ago-2026 (alucinaciones reportadas por el dueño): medido en BD, 27.6% de las
// licitaciones (291/1053) tenían un corpus > 180_000 chars y se truncaban — perdiendo bases
// técnicas/anexos completos sin que el modelo lo supiera con claridad. La viabilidad (mismo
// modelo GLM, mismo proveedor) ya usa 350_000 chars (~95k tokens, ver MAX_CHARS_DOCS_ANALISIS en
// viabilidad-ia.ts) porque glm-4.7 aguanta ese contexto de sobra — se alinea el chat al mismo
// tope en vez de quedarse más corto sin motivo. Con 350k, p95 de corpus real (355_501) casi
// entra completo: solo ~5% de licitaciones (las más grandes) siguen truncando.
export const MAX_CHARS_CONTEXTO = Math.max(60_000, Number(process.env.CHAT_MAX_CHARS_CONTEXTO) || 350_000);

// Precedencia documental para el corpus del chat: si hay que truncar, se conserva lo
// soberano (aclaraciones/bases) y se sacrifican anexos/planos. Menor nº = va primero.
// Mismo criterio que la viabilidad (prioridadDoc), para que el chat "vea" lo mismo.
function prioridadChat(nombre: string, categoria: string | null): number {
  const n = `${nombre} ${categoria || ''}`.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  if (/aclarac|respuesta|consulta|foro/.test(n)) return 0;
  if (/especial/.test(n)) return 1;
  if (/administrativ|bases_admin/.test(n)) return 2;
  if (/tecnic/.test(n)) return 3;
  if (/anexo|formulario|declarac/.test(n)) return 5;
  if (/plano|croquis|lamina|elevacion|planta|isometric|render|imagen|fotograf/.test(n)) return 9;
  return 4;
}

// Los documentos que generamos NOSOTROS (Excel de costeo) NO son fuente de la licitación:
// son ruido que infla el contexto y puede desplazar a las bases. Se excluyen del corpus del
// chat, igual que en la viabilidad.
const FILTRO_NO_PROPIOS =
  `AND (categoria IS NULL OR categoria <> 'DOCUMENTOS_PROPIOS') AND documento_nombre NOT LIKE 'COSTEO\\_%'`;
// Turnos recientes que se envían al modelo como memoria de la conversación.
const MAX_TURNOS = 6;

const MODELO_GEMINI = 'gemini-2.5-flash';

// Cada documento se envuelve con este marcador para que el modelo pueda citar de qué
// documento salió cada dato. Mismo formato en el corpus y en el doc individual. Si el método de
// extracción fue de menor confianza (OCR incompleto o de respaldo), se agrega una ADVERTENCIA
// visible en el propio marcador — así el modelo la ve pegada al texto que debe tratar con cautela,
// en vez de asumir que todo el corpus tiene la misma fiabilidad.
const marcador = (nombre: string, advertencia?: string) =>
  `[[DOCUMENTO: ${nombre}${advertencia ? ` — ADVERTENCIA: ${advertencia}` : ''}]]`;

// Métodos de extracción que NO son de máxima confianza (ver document-extraction.ts). El chat no
// tenía forma de saberlo: aunque el texto ya venía marcado con el hueco literal OCR_NO_DISPONIBLE
// cuando la extracción quedó incompleta, el prompt nunca le explicaba al modelo qué significa esa
// marca ni que un documento entero podía ser de menor fiabilidad — sin ese aviso, el modelo trataba
// ese texto igual que el resto y podía "leer" con seguridad algo que en realidad es un hueco.
function advertenciaExtraccion(metodo: string | null, texto: string): string | undefined {
  if (ocrTieneHuecos(texto)) return 'este documento tiene páginas que aún no se pudieron leer por OCR (marcadas como OCR_NO_DISPONIBLE en el texto) — no asumas que esas páginas no dicen nada, simplemente no se pudieron leer todavía';
  if (metodo === 'pdf-tesseract-local' || metodo === 'pdf-glm-ocr+tesseract-relleno') return 'texto leído por OCR de respaldo (menor precisión que el OCR principal), puede tener errores de reconocimiento en cifras o nombres';
  if (metodo === 'pdf-sin-ocr' || metodo === 'pdf-sin-texto' || metodo === 'pdf-error' || metodo === 'word-error' || metodo === 'excel-error') return 'extracción de baja confianza, puede tener texto incompleto o mal reconocido';
  return undefined;
}

export interface MensajeHistorial {
  rol: 'usuario' | 'asistente';
  mensaje: string;
}

// ─── Contexto: corpus completo de la licitación (cacheado) ──────────────────────
export async function construirContextoChat(
  codigo: string,
): Promise<{ texto: string; encontrado: boolean; numDocumentos: number; actualizadoEn: Date | null }> {
  // Firma barata de las fuentes: cuántos documentos tienen texto y cuándo se extrajo
  // el más nuevo. Sirve para invalidar el cache sin leer todos los LONGTEXT, y también
  // para saber desde cuándo el historial de chat deja de ser confiable (ver `actualizadoEn`).
  const [srcRows] = await pool.query(
    `SELECT COUNT(*) AS n, MAX(texto_extraido_at) AS max_dt, COALESCE(MAX(UNIX_TIMESTAMP(texto_extraido_at)), 0) AS maxts
       FROM documentos_cache
      WHERE licitacion_codigo = ? AND texto_extraido IS NOT NULL AND texto_extraido <> ''
        ${FILTRO_NO_PROPIOS}`,
    [codigo],
  );
  const src = (srcRows as any[])[0];
  const nDocs = Number(src?.n || 0);
  const actualizadoEn: Date | null = src?.max_dt ?? null;
  if (nDocs === 0) return { texto: '', encontrado: false, numDocumentos: 0, actualizadoEn };

  // ¿Cache vigente? Válido si mismo nº de documentos y ninguno se re-extrajo después.
  const [cacheRows] = await pool.query(
    `SELECT contexto_texto, num_documentos, UNIX_TIMESTAMP(actualizado_en) AS act
       FROM licitacion_contexto_chat WHERE licitacion_codigo = ? LIMIT 1`,
    [codigo],
  );
  const cache = (cacheRows as any[])[0];
  if (
    cache &&
    cache.contexto_texto &&
    Number(cache.num_documentos) === nDocs &&
    Number(src.maxts) <= Number(cache.act)
  ) {
    return { texto: cache.contexto_texto, encontrado: true, numDocumentos: nDocs, actualizadoEn };
  }

  // Reconstruir el corpus desde el texto ya extraído (excluyendo documentos propios).
  // metodo_extraccion viaja también: sirve para marcar en el propio corpus los documentos de
  // menor confianza (OCR de respaldo, extracción incompleta) — ver advertenciaExtraccion().
  const [docRows] = await pool.query(
    `SELECT documento_nombre AS nombre, categoria, texto_extraido AS texto, metodo_extraccion AS metodo
       FROM documentos_cache
      WHERE licitacion_codigo = ? AND texto_extraido IS NOT NULL AND texto_extraido <> ''
        ${FILTRO_NO_PROPIOS}
      ORDER BY id ASC`,
    [codigo],
  );
  // Orden por PRECEDENCIA (aclaraciones/bases primero) para que un eventual truncado
  // sacrifique lo de menor jerarquía (anexos/planos) y nunca las bases con el presupuesto.
  const docs = (docRows as Array<{ nombre: string; categoria: string | null; texto: string; metodo: string | null }>)
    .sort((a, b) => prioridadChat(a.nombre, a.categoria) - prioridadChat(b.nombre, b.categoria));
  let texto = docs
    .map(d => {
      const t = (d.texto || '').trim();
      return `${marcador(d.nombre, advertenciaExtraccion(d.metodo, t))}\n${t}`;
    })
    .join('\n\n');
  if (texto.length > MAX_CHARS_CONTEXTO) {
    texto = texto.slice(0, MAX_CHARS_CONTEXTO) +
      '\n\n[[CONTEXTO TRUNCADO: por límite de tamaño se omitió el resto — quedaron afuera documentos ' +
      'de MENOR jerarquía (anexos/planos/formularios); las bases y aclaraciones, si entran en el ' +
      'presupuesto de caracteres, van primero y completas. Si la pregunta trata algo que razonablemente ' +
      'estaría en un documento que no ves arriba, NO respondas como si ese documento no existiera o no ' +
      'dijera nada: dilo explícitamente ("no tengo ese documento cargado en este momento; puedes abrirlo ' +
      'y preguntar directamente sobre él") en vez de inventar o asumir su contenido.]]';
  }

  await pool.query(
    `INSERT INTO licitacion_contexto_chat (licitacion_codigo, contexto_texto, num_chars, num_documentos)
       VALUES (?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       contexto_texto = VALUES(contexto_texto),
       num_chars      = VALUES(num_chars),
       num_documentos = VALUES(num_documentos),
       actualizado_en = CURRENT_TIMESTAMP`,
    [codigo, texto, texto.length, docs.length],
  );

  return { texto, encontrado: true, numDocumentos: docs.length, actualizadoEn };
}

// ─── Contexto: un solo documento (chat rápido por fila) ─────────────────────────
// Sin cache propio: es una sola fila, mucho menos texto → respuesta más rápida.
export async function construirContextoDocumento(
  codigo: string,
  documentoNombre: string,
): Promise<{ texto: string; encontrado: boolean; actualizadoEn: Date | null }> {
  const [rows] = await pool.query(
    `SELECT texto_extraido AS texto, texto_extraido_at AS actualizadoEn, metodo_extraccion AS metodo
       FROM documentos_cache
      WHERE licitacion_codigo = ? AND documento_nombre = ? LIMIT 1`,
    [codigo, documentoNombre],
  );
  const fila = (rows as any[])[0];
  const raw = (fila?.texto || '').trim();
  const actualizadoEn: Date | null = fila?.actualizadoEn ?? null;
  if (!raw) return { texto: '', encontrado: false, actualizadoEn };

  let texto = `${marcador(documentoNombre, advertenciaExtraccion(fila?.metodo ?? null, raw))}\n${raw}`;
  if (texto.length > MAX_CHARS_CONTEXTO) {
    texto = texto.slice(0, MAX_CHARS_CONTEXTO) +
      '\n\n[[DOCUMENTO TRUNCADO: por límite de tamaño no se incluyó el resto de este documento. Si la ' +
      'pregunta apunta a una parte que no ves arriba, dilo explícitamente en vez de asumir su contenido.]]';
  }
  return { texto, encontrado: true, actualizadoEn };
}

// ─── Historial ──────────────────────────────────────────────────────────────────
// `soloDesde`: si viene, descarta turnos ANTERIORES a esa fecha. Se usa para que el modelo no
// "recuerde" respuestas dadas sobre un documento que después se reprocesó (ej. un re-OCR que
// completó páginas que antes venían con huecos): sin este corte, el LLM tiende a repetir su
// propia respuesta vieja de la conversación en vez de releer el contexto fresco que se le mandó
// en el mismo turno — vimos exactamente este caso en 3310-35-LE26 (respondía "página 26 no
// disponible" 18 minutos DESPUÉS de que el re-OCR ya la había completado). El historial completo
// (para mostrarlo en la UI) sigue viniendo de una llamada sin este filtro.
export async function obtenerHistorial(
  codigo: string,
  sesionId: string,
  soloDesde: Date | null = null,
): Promise<MensajeHistorial[]> {
  const [rows] = await pool.query(
    `SELECT rol, mensaje FROM chat_licitacion
      WHERE licitacion_codigo = ? AND sesion_id = ? ${soloDesde ? 'AND creado_en > ?' : ''}
      ORDER BY creado_en ASC, id ASC`,
    soloDesde ? [codigo, sesionId, soloDesde] : [codigo, sesionId],
  );
  return (rows as any[]).map(r => ({ rol: r.rol as 'usuario' | 'asistente', mensaje: r.mensaje }));
}

export async function guardarTurno(
  codigo: string,
  sesionId: string,
  pregunta: string,
  respuesta: string,
  modelo: string,
  usuarioId: number | null = null,
): Promise<void> {
  await pool.query(
    `INSERT INTO chat_licitacion (licitacion_codigo, sesion_id, rol, mensaje, modelo, usuario_id)
     VALUES (?, ?, 'usuario', ?, NULL, ?), (?, ?, 'asistente', ?, ?, ?)`,
    [codigo, sesionId, pregunta, usuarioId, codigo, sesionId, respuesta, modelo, usuarioId],
  );
}

// ─── Respuesta del modelo ────────────────────────────────────────────────────────
// AUDITORÍA ANTI-ALUCINACIÓN (ago-2026): la versión anterior de este prompt solo decía "no
// inventes" al pasar, sin darle al modelo un PROCEDIMIENTO concreto ni explicarle las señales que
// el propio sistema ya le manda en el contexto (marca de hueco de OCR, aviso de truncado,
// documentos de menor confianza) — el modelo no tenía cómo distinguir "el dato no está" de "el
// dato está en la parte que no llegué a leer". Reescrito con la misma técnica de "regla de oro
// anti-alucinación" + procedimiento explícito que ya usa anexos-ia-motor.ts (SYS_CAMPOS) para el
// relleno de anexos, adaptada a respuesta libre en vez de JSON estructurado.
const REGLAS = `Eres ankIA, el asistente de lectura de documentos de LICITANK, experto en licitaciones públicas de Chile (Ley 19.886, DS 250, portal Mercado Público).
Respondes preguntas sobre UNA licitación usando EXCLUSIVAMENTE el contenido de los documentos entregados abajo. Tu conocimiento de licitaciones chilenas es solo para ENTENDER ese texto (jerga, siglas, estructura típica de unas bases) — NUNCA para rellenar con lo "típico" o "esperable" un dato que el texto no trae.

PROCEDIMIENTO OBLIGATORIO (síguelo en orden antes de responder):
1. Busca el dato TEXTUALMENTE en los documentos entregados. Si no aparece tal cual (como cifra, fecha, plazo o requisito exacto), NO existe para ti — no lo estimes, no lo completes por analogía con licitaciones típicas, no "redondees".
2. Todo dato duro (monto, plazo, fecha, porcentaje, requisito, garantía, multa, criterio de evaluación) debe quedar asociado al documento del que salió, citando su marcador tal como aparece en el contexto (cada documento viene envuelto en [[DOCUMENTO: nombre]]). Si no puedes señalar de qué documento sale un dato, no lo afirmes como hecho: dilo como "no encontrado" en vez de arriesgarlo.
3. Si el dato NO aparece en ningún documento, dilo con honestidad y así de explícito: "No aparece en los documentos disponibles." NUNCA inventes cifras, plazos ni requisitos para no dejar la respuesta incompleta — una respuesta incompleta pero honesta es correcta; una completa pero inventada es el peor resultado posible.
4. Si dentro del texto de un documento ves la marca "OCR_NO_DISPONIBLE", esa parte específica todavía no se pudo leer por OCR — es un HUECO, no evidencia de que el documento no menciona el dato. Si la pregunta cae ahí, dilo explícitamente ("esa parte del documento aún no se pudo leer por OCR, no puedo confirmarlo") en vez de responder como si esa sección no existiera o no dijera nada.
5. Si un documento trae "ADVERTENCIA" en su marcador (extracción incompleta o de menor confianza), trata sus datos con más cautela y avísale al usuario en la respuesta en vez de darlos con total seguridad.
6. Si ves un bloque "[[CONTEXTO TRUNCADO...]]" o "[[DOCUMENTO TRUNCADO...]]", parte de los documentos no llegó a tu contexto por tamaño. Si la pregunta apunta a algo que razonablemente estaría en lo que falta y no lo ves en lo que sí tienes, dilo ("no tengo ese documento cargado en este momento") — nunca lo interpretes como que ese documento no existe o no trata el tema.
7. El HISTORIAL de la conversación es solo para seguir el hilo de la charla, JAMÁS una fuente de datos: si respondiste algo antes y el contexto de documentos (que se te reenvía completo en cada turno) lo contradice, corrígelo — prevalece siempre lo que dicen los documentos AHORA, no lo que dijiste antes.

Estilo de respuesta:
- Responde en español, claro y directo, como un analista que ya leyó las bases.
- Resalta montos, plazos, porcentajes y fechas. Usa viñetas o numeración cuando aclare.
- Sé conciso: ve al punto, sin relleno — pero nunca sacrifiques una advertencia de dato faltante o incierto por ir más rápido.`;

function historialParaModelo(historial: MensajeHistorial[]): MensajeHistorial[] {
  // Solo los últimos MAX_TURNOS pares (usuario+asistente) para no inflar el prompt.
  return historial.slice(-MAX_TURNOS * 2);
}

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

// Gemini 2.5-flash vía REST (texto). Alterna al alias estable ante 429/503.
async function responderConGemini(contexto: string, historial: MensajeHistorial[], pregunta: string): Promise<string> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error('GEMINI_API_KEY no configurada');

  const contents = [
    { role: 'user', parts: [{ text: `DOCUMENTOS DE LA LICITACIÓN:\n\n${contexto}` }] },
    { role: 'model', parts: [{ text: 'Entendido. Tengo el contenido de los documentos de esta licitación. ¿Qué necesitas saber?' }] },
    ...historialParaModelo(historial).map(h => ({
      role: h.rol === 'usuario' ? 'user' : 'model',
      parts: [{ text: h.mensaje }],
    })),
    { role: 'user', parts: [{ text: pregunta }] },
  ];

  const body = JSON.stringify({
    systemInstruction: { parts: [{ text: REGLAS }] },
    contents,
    // thinkingBudget:0 → sin tokens de "thinking" (un chat sobre contexto dado no lo necesita):
    // ahorra tokens y evita que el thinking se coma el presupuesto y devuelva texto vacío.
    generationConfig: { temperature: 0.1, maxOutputTokens: 4_000, thinkingConfig: { thinkingBudget: 0 } },
  });

  const MODELOS = [MODELO_GEMINI, 'gemini-flash-latest'];
  const ESPERAS = [0, 5_000];
  let ultimoErr = '';
  for (let i = 0; i < MODELOS.length; i++) {
    if (i > 0) await sleep(ESPERAS[i]);
    const modelo = MODELOS[i];
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${modelo}:generateContent?key=${apiKey}`,
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body, signal: AbortSignal.timeout(60_000) },
    );
    if (res.ok) {
      const data = await res.json();
      const texto = String(data.candidates?.[0]?.content?.parts?.[0]?.text ?? '').trim();
      if (texto) return texto;
      ultimoErr = `${modelo}: respuesta vacía (finishReason=${data.candidates?.[0]?.finishReason})`;
      continue;
    }
    ultimoErr = `${modelo} ${res.status}: ${(await res.text().catch(() => '')).slice(0, 150)}`;
    if (res.status !== 429 && res.status !== 503) break;
  }
  throw new Error(`Gemini no respondió: ${ultimoErr}`);
}

// AUDITORÍA ago-2026: el chat usaba el proveedor de texto ACTIVO sin fijar modelo, es decir
// GLM_TEXT_MODEL por defecto (glm-4.7-flashx) — el rung más barato/rápido de la cadena, el mismo
// que el propio .env.local documenta como causante de "manifiestos de ítems vacíos/errados" en la
// viabilidad, y que anexos-ia-motor.ts/auditor-tecnico.ts evitan a propósito con modeloPreferido
// (glm-4.7 / glm-5.2) para sus pasos más sensibles a errores. El chat responde directo al usuario
// sin ningún validador/guardarraíl posterior (a diferencia de viabilidad y anexos, que sí tienen
// uno) — es exactamente el caso donde MENOS conviene el modelo más barato. Se fija glm-4.7 (el
// mismo que anexos-ia-motor.ts eligió tras medir que flashx confundía datos): más cuidadoso,
// sigue siendo GLM (mismo costo de cuenta), y NO se activa soloGlm para no perder el respaldo
// DeepSeek — el dueño lo quiere reservado justo para el chat (ver cfgTextoRespaldos en gemini.ts).
// Trade-off asumido: ~5-8x más caro por token que flashx (glm-4.7 $0.60/$2.20 vs flashx
// $0.07/$0.4 por M) — aceptable porque el chat es interactivo (una llamada por pregunta de un
// humano), no una corrida batch sobre miles de licitaciones como la viabilidad.
const MODELO_CHAT_PRINCIPAL = 'glm-4.7';

// Respaldo con el proveedor de texto activo (GLM de Z.AI por defecto; DeepSeek si se revierte).
async function responderConIA(contexto: string, historial: MensajeHistorial[], pregunta: string): Promise<string> {
  const messages = [
    { role: 'system' as const, content: `${REGLAS}\n\nDOCUMENTOS DE LA LICITACIÓN:\n\n${contexto}` },
    ...historialParaModelo(historial).map(h => ({
      role: (h.rol === 'usuario' ? 'user' : 'assistant') as 'user' | 'assistant',
      content: h.mensaje,
    })),
    { role: 'user' as const, content: pregunta },
  ];
  const completion = await crearChatIA(
    { messages, temperature: 0.1, stream: false, max_tokens: 4_000 },
    { modeloPreferido: MODELO_CHAT_PRINCIPAL },
  );
  const texto = (completion.choices[0]?.message?.content ?? '').trim();
  if (!texto) throw new Error(`${MODELO_CHAT_PRINCIPAL}: respuesta vacía`);
  return texto;
}

export async function responderChat(opts: {
  contexto: string;
  historial: MensajeHistorial[];
  pregunta: string;
}): Promise<{ respuesta: string; modelo: string }> {
  const { contexto, historial, pregunta } = opts;
  // Principal: GLM de Z.AI (crearChatIA ya trae respaldo DeepSeek automático). Gemini está
  // RETIRADO: su respaldo solo corre si se reactiva a propósito (GEMINI_HABILITADO=1 + key).
  try {
    const respuesta = await responderConIA(contexto, historial, pregunta);
    return { respuesta, modelo: MODELO_CHAT_PRINCIPAL };
  } catch (e) {
    if (!geminiHabilitado()) throw e;
    console.warn('[chat-licitacion] GLM falló, uso Gemini de respaldo:', e instanceof Error ? e.message : e);
    const respuesta = await responderConGemini(contexto, historial, pregunta);
    return { respuesta, modelo: MODELO_GEMINI };
  }
}
