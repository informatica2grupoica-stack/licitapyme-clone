// app/lib/anexos-feedback.ts
// FEEDBACK LOOP del Anexo Creator (mismo patrón que viabilidad-feedback.ts, adaptado): cuando el
// usuario corrige una casilla que el motor IA rellenó MAL (ej. el nombre de una persona en la
// casilla "N°"), la corrección se destila en UNA regla general por TIPO DE ETIQUETA — no por
// documento ni por licitación — y se inyecta en el prompt de TODO análisis futuro. Así, un anexo
// nuevo con una casilla "N°"/"Calle"/"Comuna" parecida (de cualquier organismo) se beneficia de
// la corrección sin haber pasado por ese caso antes.
//
// Por qué por ETIQUETA y no por documento (decisión explícita del usuario, 6-ago-2026): el motor
// ya tiene guardarraíles deterministas para errores de FORMA (campoCalzaConLaEtiqueta en
// anexos-ia-motor.ts). Este circuito cubre lo que un guardarraíl de forma no puede — errores de
// JUICIO ("esta etiqueta en particular en realidad pide tal campo, no el que la IA asumió") que
// se repiten porque el patrón de etiqueta es común a muchos organismos (ANID, GORE, municipios
// suelen copiar el mismo formulario tipo).
import pool from '@/app/lib/db';
import { crearChatIA, iaTextoConfigurada } from '@/app/lib/gemini';

const MAX_REGLAS_INYECTADAS = 40;

export interface AnexoFeedback {
  id: number;
  licitacion_codigo: string | null;
  usuario_id: number | null;
  etiqueta: string;
  valor_ia: string | null;
  valor_correcto: string;
  regla: string;
  activa: number;
  created_at: string;
}

async function ensureTable(): Promise<void> {
  await pool.query(`CREATE TABLE IF NOT EXISTS anexos_feedback (
    id                INT AUTO_INCREMENT PRIMARY KEY,
    licitacion_codigo VARCHAR(64) NULL,
    usuario_id        INT NULL,
    etiqueta          VARCHAR(255) NOT NULL,
    valor_ia          VARCHAR(255) NULL,
    valor_correcto    VARCHAR(255) NOT NULL,
    regla             TEXT NOT NULL,
    activa            TINYINT NOT NULL DEFAULT 1,
    created_at        TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_activa (activa)
  )`);
}

// Destila la corrección puntual ("en la casilla 'N°:' la IA puso 'Lidia Valenzuela', debía ser
// '575 N° 6'") en UNA regla CONDICIONAL general, sin nombrar la licitación ni el valor concreto
// de esta empresa — la regla describe el TIPO de etiqueta y el TIPO de campo que corresponde, para
// que sirva en cualquier anexo futuro con una casilla parecida. Fallback seguro si la IA de texto
// no está configurada o falla: una regla literal armada del propio dato (peor redactada, pero
// nunca se pierde la corrección).
async function destilarReglaAnexo(etiqueta: string, valorIA: string | null, valorCorrecto: string): Promise<string> {
  const fallback = valorIA
    ? `Cuando una casilla de anexo tenga una etiqueta similar a "${etiqueta}", NO uses un valor con la forma de "${valorIA}" — usa el campo de la ficha que corresponda a "${valorCorrecto}".`
    : `Cuando una casilla de anexo tenga una etiqueta similar a "${etiqueta}", el campo correcto es el que corresponde a un valor con la forma de "${valorCorrecto}".`;
  if (!iaTextoConfigurada()) return fallback;
  try {
    const completion = await crearChatIA({
      temperature: 0.2,
      max_tokens: 250,
      response_format: { type: 'json_object' },
      messages: [
        {
          role: 'system',
          content: `Conviertes la corrección de un experto en licitaciones públicas chilenas sobre una casilla de un ANEXO DE OFERENTE (Word) mal rellenada por una IA en UNA regla breve, general y accionable, para que un analista IA no repita el error.
La regla debe: (1) referirse al TIPO de etiqueta de casilla, no a esta licitación puntual (generalízala: "cuando una casilla diga algo como '...' "); (2) decir qué CAMPO/tipo de dato corresponde de verdad, sin inventar el valor exacto de esta empresa; (3) ser CONDICIONAL ("Si la casilla pide ... entonces ..."); (4) máximo 220 caracteres.
Devuelve SOLO JSON: {"regla": "..."}.`,
        },
        {
          role: 'user',
          content: `Etiqueta de la casilla: "${etiqueta}"
Valor que puso la IA (incorrecto): ${valorIA || '(vacío/pendiente)'}
Valor correcto que puso el experto: "${valorCorrecto}"

Devuelve {"regla": "..."} con UNA sola regla general.`,
        },
      ],
    });
    const txt = completion.choices[0]?.message?.content ?? '';
    const ini = txt.indexOf('{'); const fin = txt.lastIndexOf('}');
    const obj = JSON.parse(ini !== -1 ? txt.slice(ini, fin + 1) : txt);
    const regla = String(obj?.regla || '').trim();
    return regla.length >= 8 ? regla.slice(0, 220) : fallback;
  } catch (e) {
    console.warn('[anexos-feedback] destilación falló, uso la regla de respaldo:', String(e).slice(0, 120));
    return fallback;
  }
}

export async function guardarFeedbackAnexo(input: {
  codigo: string | null; usuarioId: number | null;
  etiqueta: string; valorIA: string | null; valorCorrecto: string;
}): Promise<{ regla: string }> {
  await ensureTable();
  const etiqueta = input.etiqueta.trim().slice(0, 255);
  const valorCorrecto = input.valorCorrecto.trim().slice(0, 255);
  const regla = await destilarReglaAnexo(etiqueta, input.valorIA, valorCorrecto);
  await pool.query(
    `INSERT INTO anexos_feedback (licitacion_codigo, usuario_id, etiqueta, valor_ia, valor_correcto, regla)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [input.codigo, input.usuarioId, etiqueta, input.valorIA ? input.valorIA.slice(0, 255) : null, valorCorrecto, regla],
  );
  return { regla };
}

export async function listarFeedbackAnexo(limite = 100): Promise<AnexoFeedback[]> {
  try {
    const [rows] = await pool.query(
      `SELECT * FROM anexos_feedback ORDER BY created_at DESC LIMIT ?`, [limite]);
    return rows as AnexoFeedback[];
  } catch { return []; }
}

export async function eliminarFeedbackAnexo(id: number): Promise<void> {
  try { await pool.query(`DELETE FROM anexos_feedback WHERE id = ?`, [id]); } catch { /* tabla puede no existir */ }
}

// Reglas activas para inyectar en el prompt del motor — resiliente: si la tabla no existe aún,
// no rompe el análisis (simplemente no hay reglas aprendidas todavía).
export async function cargarReglasAprendidasAnexo(limite = MAX_REGLAS_INYECTADAS): Promise<string[]> {
  try {
    const [rows] = await pool.query(
      `SELECT regla FROM anexos_feedback WHERE activa = 1 ORDER BY created_at DESC LIMIT ?`, [limite]);
    return (rows as any[]).map(r => String(r.regla || '').trim()).filter(Boolean);
  } catch { return []; }
}

// Bloque de texto listo para inyectar en el prompt del motor (vacío si no hay reglas).
export function bloqueReglasAprendidasAnexo(reglas: string[]): string {
  if (!reglas.length) return '';
  const lista = reglas.map((r, i) => `${i + 1}. ${r}`).join('\n');
  return `\n\nREGLAS APRENDIDAS DEL EXPERTO SOBRE ESTE TIPO DE CASILLAS (PRIORIDAD MÁXIMA — el equipo corrigió a mano casillas parecidas en otros anexos; si una regla aplica a alguna de las casillas de abajo, síguela en vez de tu criterio por defecto):\n${lista}`;
}
