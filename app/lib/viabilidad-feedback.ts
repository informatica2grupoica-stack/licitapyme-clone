// app/lib/viabilidad-feedback.ts
// FEEDBACK LOOP (aprendizaje por refuerzo manual) del análisis de viabilidad.
//
// El experto corrige un veredicto de la IA con un comentario. En vez de reescribir el
// prompt maestro (frágil, no auditable), guardamos la corrección como una LECCIÓN atómica
// y la destilamos en una REGLA general y reutilizable. En cada análisis, esas reglas se
// INYECTAN en el prompt (prompt dinámico por composición). Cada regla es desactivable, así
// que un mal aprendizaje se revierte sin tocar el prompt base.

import pool from '@/app/lib/db';
import { getGemini } from '@/app/lib/gemini';

const MAX_REGLAS_INYECTADAS = 40; // tope de reglas que entran al prompt (las más recientes)

export interface Feedback {
  id: number;
  licitacion_codigo: string;
  usuario_id: number | null;
  veredicto_ia: string | null;
  veredicto_humano: string | null;
  comentario: string;
  regla: string;
  ambito: string;
  activa: number;
  created_at: string;
}

async function ensureTable(): Promise<void> {
  await pool.query(`CREATE TABLE IF NOT EXISTS viabilidad_feedback (
    id                INT AUTO_INCREMENT PRIMARY KEY,
    licitacion_codigo VARCHAR(64) NOT NULL,
    usuario_id        INT NULL,
    veredicto_ia      VARCHAR(32) NULL,
    veredicto_humano  VARCHAR(16) NULL,
    comentario        TEXT NOT NULL,
    regla             TEXT NOT NULL,
    ambito            VARCHAR(40) NOT NULL DEFAULT 'global',
    activa            TINYINT NOT NULL DEFAULT 1,
    created_at        TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_codigo (licitacion_codigo),
    INDEX idx_activa (activa)
  )`);
}

// Destila el comentario libre del experto en UNA regla breve y GENERAL (sin el nombre de la
// licitación concreta), apta para inyectarse en el prompt. Si DeepSeek falla o no hay API key,
// se usa el comentario tal cual (fallback seguro: siempre queda algo accionable).
async function destilarRegla(comentario: string, veredictoHumano: string | null, veredictoIA: string | null): Promise<string> {
  const limpio = comentario.trim();
  if (!process.env.DEEPSEEK_API_KEY) return limpio;
  try {
    const client = getGemini();
    const completion = await client.chat.completions.create({
      model: 'deepseek-chat',
      temperature: 0.2,
      max_tokens: 300,
      response_format: { type: 'json_object' },
      messages: [
        {
          role: 'system',
          content: `Conviertes la corrección de un experto en licitaciones públicas chilenas en UNA regla breve, general y accionable para que un analista IA NO repita el error.
La regla debe: (1) ser CONDICIONAL cuando aplique ("Si ... entonces ..."), (2) NO mencionar el ID/nombre de la licitación concreta (generalízala para casos futuros), (3) estar pensada para una empresa que VENDE bienes/equipamiento con bodega en Santiago, (4) máximo 240 caracteres.
Devuelve SOLO JSON: {"regla": "..."}.`,
        },
        {
          role: 'user',
          content: `Veredicto de la IA: ${veredictoIA || '(desconocido)'}
Veredicto correcto según el experto: ${veredictoHumano || '(no especificado)'}
Explicación del experto: ${limpio}

Devuelve {"regla": "..."} con UNA sola regla general.`,
        },
      ],
    });
    const txt = completion.choices[0]?.message?.content ?? '';
    const ini = txt.indexOf('{'); const fin = txt.lastIndexOf('}');
    const obj = JSON.parse(ini !== -1 ? txt.slice(ini, fin + 1) : txt);
    const regla = String(obj?.regla || '').trim();
    return regla.length >= 8 ? regla.slice(0, 240) : limpio;
  } catch (e) {
    console.warn('[viabilidad-feedback] destilación falló, uso el comentario crudo:', String(e).slice(0, 120));
    return limpio;
  }
}

export async function guardarFeedback(input: {
  codigo: string; usuarioId: number | null; comentario: string;
  veredictoHumano: string | null; veredictoIA: string | null;
}): Promise<{ regla: string }> {
  await ensureTable();
  const regla = await destilarRegla(input.comentario, input.veredictoHumano, input.veredictoIA);
  await pool.query(
    `INSERT INTO viabilidad_feedback (licitacion_codigo, usuario_id, veredicto_ia, veredicto_humano, comentario, regla)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [input.codigo, input.usuarioId, input.veredictoIA, input.veredictoHumano, input.comentario.trim(), regla],
  );
  return { regla };
}

export async function listarFeedback(codigo: string): Promise<Feedback[]> {
  try {
    const [rows] = await pool.query(
      `SELECT * FROM viabilidad_feedback WHERE licitacion_codigo = ? ORDER BY created_at DESC`, [codigo]);
    return rows as Feedback[];
  } catch { return []; }
}

export async function eliminarFeedback(id: number): Promise<void> {
  try { await pool.query(`DELETE FROM viabilidad_feedback WHERE id = ?`, [id]); } catch { /* tabla puede no existir */ }
}

// Reglas activas para inyectar en el prompt (las más recientes primero). Resiliente: si la
// tabla aún no existe, no rompe el análisis — simplemente no hay reglas aprendidas todavía.
export async function cargarReglasAprendidas(limite = MAX_REGLAS_INYECTADAS): Promise<string[]> {
  try {
    const [rows] = await pool.query(
      `SELECT regla FROM viabilidad_feedback WHERE activa = 1 ORDER BY created_at DESC LIMIT ?`, [limite]);
    return (rows as any[]).map(r => String(r.regla || '').trim()).filter(Boolean);
  } catch { return []; }
}

// Bloque de texto listo para inyectar en el system prompt (vacío si no hay reglas).
export function bloqueReglasAprendidas(reglas: string[]): string {
  if (!reglas.length) return '';
  const lista = reglas.map((r, i) => `${i + 1}. ${r}`).join('\n');
  return `REGLAS APRENDIDAS DEL EXPERTO (PRIORIDAD MÁXIMA — el equipo corrigió análisis previos de la IA; aplícalas SIEMPRE y NO repitas esos errores. Si una regla aplica al caso, ajusta el veredicto y el score en consecuencia y menciónala en las advertencias):
${lista}

`;
}
