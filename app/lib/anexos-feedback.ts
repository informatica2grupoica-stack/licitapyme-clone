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
    campo             VARCHAR(64) NULL,
    activa            TINYINT NOT NULL DEFAULT 1,
    created_at        TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_activa (activa)
  )`);
  // Instalaciones que ya tenían la tabla antes de que existiera `campo` (28-ago-2026). MySQL no
  // soporta ADD COLUMN IF NOT EXISTS, así que se pregunta primero — y si falla, no se rompe nada:
  // sin la columna, el circuito determinista simplemente no encuentra overrides.
  try {
    const [cols] = await pool.query(`SHOW COLUMNS FROM anexos_feedback LIKE 'campo'`);
    if (!(cols as any[]).length) await pool.query(`ALTER TABLE anexos_feedback ADD COLUMN campo VARCHAR(64) NULL`);
  } catch { /* si no se puede, el override queda inactivo — nunca bloquea guardar la corrección */ }
}

// ── El circuito que de verdad aplica la corrección (28-ago-2026, auditoría) ───────────────────
// HALLAZGO: hasta hoy este módulo solo producía TEXTO para un prompt (`regla`), y ese prompt vive
// dentro de `resolverLoteCampos` (anexos-ia-motor.ts), que está detrás de `ANEXOS_IA_RESPALDO=1`
// — APAGADO por defecto desde que el motor pasó a ser 100% determinista (17-ago-2026). Resultado:
// las 10 correcciones guardadas nunca cambiaron un solo anexo, mientras la pantalla prometía "la
// IA va a aplicar esto en este y en futuros anexos". El circuito estaba cortado en el medio.
//
// El arreglo NO es encender la IA: es traducir la corrección a lo único que el motor determinista
// entiende, un par (etiqueta → CAMPO de la ficha). Se deduce mirando qué campo de la empresa vale
// exactamente lo que el experto escribió — así el override hereda el guardarraíl anti-invención
// completo: lo que se escribe sale SIEMPRE de `empresa[campo]`, nunca del texto guardado (que es
// de OTRA empresa y de otro momento).
//
// Cuando el valor corregido no calza con ningún campo de la ficha (el experto escribió algo
// específico de esa licitación, o un recorte a mano), NO se inventa un override: la corrección se
// guarda igual como regla de texto, y `guardarFeedbackAnexo` devuelve `campo: null` para que la
// pantalla diga la verdad en vez de prometer un aprendizaje que no ocurrió.

/** Normaliza para comparar VALORES (no etiquetas): sin tildes, sin puntuación de RUT ni miles. */
function normalizarValor(s: string): string {
  // El punto se BORRA (no se cambia por espacio): el mismo RUT se escribe "76.902.659-2" o
  // "76902659-2" según el organismo, y son el mismo dato. Los espacios se colapsan aparte.
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/\./g, '').replace(/\s+/g, ' ').trim();
}

// Etiquetas que NO son una etiqueta: el placeholder que manda la pantalla cuando un blanco inline
// no tiene ningún texto alrededor. Un override sobre esto calzaría con CUALQUIER blanco sin
// contexto de cualquier anexo y escribiría el dato en un lugar al azar — es el peor error posible
// en un documento legal, así que se ataja acá y también en la ruta que guarda.
const ETIQUETAS_NO_APRENDIBLES = new Set(['(sin contexto)', 'sin contexto', '-', '—']);

export function esEtiquetaAprendible(etiqueta: string): boolean {
  const e = (etiqueta || '').trim();
  if (e.length < 3) return false;
  if (ETIQUETAS_NO_APRENDIBLES.has(e.toLowerCase())) return false;
  return /\p{L}{2,}/u.test(e); // tiene que contener al menos una palabra real
}

/**
 * Qué campo de la ficha vale EXACTAMENTE lo que el experto escribió. null si ninguno — y eso es
 * una respuesta legítima, no un fallo: significa que la corrección no es generalizable a un campo.
 * Las URLs de imagen quedan fuera (no son texto que se escriba en una casilla).
 */
export function campoDeLaFichaConEsteValor(
  valorCorrecto: string, empresa: object | null | undefined,
): string | null {
  if (!empresa) return null;
  const objetivo = normalizarValor(valorCorrecto);
  if (!objetivo) return null;
  for (const [campo, valor] of Object.entries(empresa)) {
    if (campo === 'firma_url' || campo === 'timbre_url') continue;
    if (valor == null) continue;
    const texto = String(valor).trim();
    // Valores muy cortos ("1", "SI") calzarían con demasiadas cosas por coincidencia.
    if (texto.length < 3) continue;
    if (normalizarValor(texto) === objetivo) return campo;
  }
  return null;
}

export interface OverrideAprendido { etiqueta: string; campo: string }

/**
 * Los pares (etiqueta → campo) que el motor determinista puede aplicar. Resiliente igual que
 * `cargarReglasAprendidasAnexo`: si la tabla o la columna no existen todavía, no hay overrides y
 * el análisis sigue exactamente como antes.
 */
export async function cargarOverridesAprendidosAnexo(limite = MAX_REGLAS_INYECTADAS): Promise<OverrideAprendido[]> {
  try {
    const [rows] = await pool.query(
      `SELECT etiqueta, campo FROM anexos_feedback
        WHERE activa = 1 AND campo IS NOT NULL AND campo <> ''
        ORDER BY created_at DESC LIMIT ?`, [limite]);
    return (rows as any[])
      .map(r => ({ etiqueta: String(r.etiqueta || '').trim(), campo: String(r.campo || '').trim() }))
      .filter(r => r.etiqueta && r.campo && esEtiquetaAprendible(r.etiqueta));
  } catch { return []; }
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
  /** Ficha de la empresa asignada a esa licitación — para deducir QUÉ campo corrigió el experto. */
  empresa?: object | null;
}): Promise<{ regla: string; campo: string | null }> {
  await ensureTable();
  const etiqueta = input.etiqueta.trim().slice(0, 255);
  const valorCorrecto = input.valorCorrecto.trim().slice(0, 255);
  const regla = await destilarReglaAnexo(etiqueta, input.valorIA, valorCorrecto);
  // Solo se aprende un override cuando las DOS condiciones se cumplen: la etiqueta es una etiqueta
  // real (no el placeholder de un blanco sin contexto) y el valor corregido ES un campo de la
  // ficha. Si no, la corrección igual queda guardada como regla de texto.
  const campo = esEtiquetaAprendible(etiqueta)
    ? campoDeLaFichaConEsteValor(valorCorrecto, input.empresa)
    : null;
  await pool.query(
    `INSERT INTO anexos_feedback (licitacion_codigo, usuario_id, etiqueta, valor_ia, valor_correcto, regla, campo)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [input.codigo, input.usuarioId, etiqueta, input.valorIA ? input.valorIA.slice(0, 255) : null, valorCorrecto, regla, campo],
  );
  return { regla, campo };
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
