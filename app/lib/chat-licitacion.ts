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
// Modelo principal: Gemini 2.5-flash (respuestas en español natural). Respaldo:
// DeepSeek (getGemini() del proyecto apunta a DeepSeek).

import pool from './db';
import { crearChatIA, MODELO_TEXTO, geminiHabilitado } from './gemini';

// ~45k tokens de contexto. Holgado para el corpus de una licitación (bases admin +
// técnicas + aclaraciones); el exceso se trunca SACRIFICANDO lo de menor jerarquía
// (ver orden por precedencia en construirContextoChat), nunca las bases.
export const MAX_CHARS_CONTEXTO = 180_000;

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
// documento salió cada dato. Mismo formato en el corpus y en el doc individual.
const marcador = (nombre: string) => `[[DOCUMENTO: ${nombre}]]`;

export interface MensajeHistorial {
  rol: 'usuario' | 'asistente';
  mensaje: string;
}

// ─── Contexto: corpus completo de la licitación (cacheado) ──────────────────────
export async function construirContextoChat(
  codigo: string,
): Promise<{ texto: string; encontrado: boolean; numDocumentos: number }> {
  // Firma barata de las fuentes: cuántos documentos tienen texto y cuándo se extrajo
  // el más nuevo. Sirve para invalidar el cache sin leer todos los LONGTEXT.
  const [srcRows] = await pool.query(
    `SELECT COUNT(*) AS n, COALESCE(MAX(UNIX_TIMESTAMP(texto_extraido_at)), 0) AS maxts
       FROM documentos_cache
      WHERE licitacion_codigo = ? AND texto_extraido IS NOT NULL AND texto_extraido <> ''
        ${FILTRO_NO_PROPIOS}`,
    [codigo],
  );
  const src = (srcRows as any[])[0];
  const nDocs = Number(src?.n || 0);
  if (nDocs === 0) return { texto: '', encontrado: false, numDocumentos: 0 };

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
    return { texto: cache.contexto_texto, encontrado: true, numDocumentos: nDocs };
  }

  // Reconstruir el corpus desde el texto ya extraído (excluyendo documentos propios).
  const [docRows] = await pool.query(
    `SELECT documento_nombre AS nombre, categoria, texto_extraido AS texto
       FROM documentos_cache
      WHERE licitacion_codigo = ? AND texto_extraido IS NOT NULL AND texto_extraido <> ''
        ${FILTRO_NO_PROPIOS}
      ORDER BY id ASC`,
    [codigo],
  );
  // Orden por PRECEDENCIA (aclaraciones/bases primero) para que un eventual truncado
  // sacrifique lo de menor jerarquía (anexos/planos) y nunca las bases con el presupuesto.
  const docs = (docRows as Array<{ nombre: string; categoria: string | null; texto: string }>)
    .sort((a, b) => prioridadChat(a.nombre, a.categoria) - prioridadChat(b.nombre, b.categoria));
  let texto = docs.map(d => `${marcador(d.nombre)}\n${(d.texto || '').trim()}`).join('\n\n');
  if (texto.length > MAX_CHARS_CONTEXTO) {
    texto = texto.slice(0, MAX_CHARS_CONTEXTO) + '\n[...contexto truncado: documentos de menor jerarquía omitidos...]';
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

  return { texto, encontrado: true, numDocumentos: docs.length };
}

// ─── Contexto: un solo documento (chat rápido por fila) ─────────────────────────
// Sin cache propio: es una sola fila, mucho menos texto → respuesta más rápida.
export async function construirContextoDocumento(
  codigo: string,
  documentoNombre: string,
): Promise<{ texto: string; encontrado: boolean }> {
  const [rows] = await pool.query(
    `SELECT texto_extraido AS texto
       FROM documentos_cache
      WHERE licitacion_codigo = ? AND documento_nombre = ? LIMIT 1`,
    [codigo, documentoNombre],
  );
  const raw = ((rows as any[])[0]?.texto || '').trim();
  if (!raw) return { texto: '', encontrado: false };

  let texto = `${marcador(documentoNombre)}\n${raw}`;
  if (texto.length > MAX_CHARS_CONTEXTO) {
    texto = texto.slice(0, MAX_CHARS_CONTEXTO) + '\n[...documento truncado...]';
  }
  return { texto, encontrado: true };
}

// ─── Historial ──────────────────────────────────────────────────────────────────
export async function obtenerHistorial(
  codigo: string,
  sesionId: string,
): Promise<MensajeHistorial[]> {
  const [rows] = await pool.query(
    `SELECT rol, mensaje FROM chat_licitacion
      WHERE licitacion_codigo = ? AND sesion_id = ?
      ORDER BY creado_en ASC, id ASC`,
    [codigo, sesionId],
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
const REGLAS = `Eres un asistente experto en licitaciones públicas de Chile (Ley 19.886, DS 250, portal Mercado Público).
Respondes preguntas sobre UNA licitación usando EXCLUSIVAMENTE el contenido de los documentos entregados.

Reglas:
- Responde en español, claro y directo, como un analista que ya leyó las bases.
- Básate SOLO en los documentos. Si el dato no aparece, dilo con honestidad ("No aparece en los documentos disponibles"). NUNCA inventes cifras, plazos ni requisitos.
- Cuando entregues un dato importante, indica de qué documento proviene (cada documento viene marcado con [[DOCUMENTO: nombre]]).
- Resalta montos, plazos, porcentajes y fechas. Usa viñetas o numeración cuando aclare.
- Sé conciso: ve al punto, sin relleno.`;

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
    generationConfig: { temperature: 0.2, maxOutputTokens: 4_000, thinkingConfig: { thinkingBudget: 0 } },
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
  const completion = await crearChatIA({
    messages,
    temperature: 0.2,
    stream: false,
    max_tokens: 4_000,
  });
  const texto = (completion.choices[0]?.message?.content ?? '').trim();
  if (!texto) throw new Error(`${MODELO_TEXTO}: respuesta vacía`);
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
    return { respuesta, modelo: MODELO_TEXTO };
  } catch (e) {
    if (!geminiHabilitado()) throw e;
    console.warn('[chat-licitacion] GLM falló, uso Gemini de respaldo:', e instanceof Error ? e.message : e);
    const respuesta = await responderConGemini(contexto, historial, pregunta);
    return { respuesta, modelo: MODELO_GEMINI };
  }
}
