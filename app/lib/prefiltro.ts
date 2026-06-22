// app/lib/prefiltro.ts
// PROMPT 0 — Prefiltro de perfil inicial (Fase 0).
// Filtro de PRIMERA LÍNEA sobre la metadata de portada (nombre/objeto/descripción/
// ítems/región/presupuesto). NO descarga documentos. Corta barato lo que es
// claramente un no-go por la NATURALEZA del objeto (servicio / obra civil /
// capacitación / consultoría / convenio de suministro / commodity) o por
// presupuesto < $8M neto, ANTES de la clasificación (Fase 1) y la viabilidad (Fase 2).
//
// PRINCIPIO DE CAUTELA (clave): vemos info limitada → la asimetría manda.
//   • Descarte equivocado = oportunidad perdida → GRAVE.
//   • Pase equivocado = unos tokens de más → menor, lo atrapa Fase 2.
// → Excluir SOLO cuando la metadata lo deja inequívoco. Ante CUALQUIER duda o
//   fallo técnico → PASA. Nunca se descarta por un error de parseo/timeout.
//
// Modelo: DeepSeek (getGemini() apunta a DeepSeek). Se procesa en LOTE (varias
// licitaciones por llamada) para abaratar tokens. Una sola decisión por código,
// persistida y compartida entre usuarios (tabla prefiltro_licitacion).

import pool from '@/app/lib/db';
import { getGemini } from '@/app/lib/gemini';
import { leerCache } from '@/app/lib/licitaciones-cache';

// ─── Tipos ──────────────────────────────────────────────────────────────────────
export type DecisionPrefiltro = 'PASA' | 'EXCLUIDO' | 'REVISION_HUMANA';
export type CategoriaExclusion =
  | 'servicio' | 'obra_civil' | 'alta_ejecucion_tecnica' | 'capacitacion_pura'
  | 'consultoria' | 'convenio_suministro' | 'commodity' | 'presupuesto' | null;

export interface PrefiltroResult {
  codigo: string;
  decision: DecisionPrefiltro;
  categoria: CategoriaExclusion;
  motivo: string;
  evidencia: string;
  confianza: number;
  monto_neto: number | null;
}

// Metadata de portada de una licitación para el prefiltro.
interface MetaLic {
  codigo: string;
  nombre: string;
  organismo: string;
  region: string;
  monto: number | null;     // monto bruto disponible (alerta o caché)
  descripcion: string;      // del caché si fue enriquecida
  itemsTexto: string;       // producto/desc/categoría concatenados (acotado)
}

const MODELO = 'deepseek-chat';
const PISO_NETO_PREFILTRO = 8_000_000; // < $8M neto → EXCLUIDO por presupuesto
const LOTE_IA = 15;                    // licitaciones por llamada a DeepSeek

const sinTildes = (s: string) => (s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

// ─── Pre-check de presupuesto (determinista, sin IA) ──────────────────────────────
// Si el texto sugiere "IVA incluido" se normaliza ÷1,19; si no, se trata el monto
// como neto (conservador: menos exclusiones). Solo excluye si hay monto > 0.
function chequearPresupuesto(m: MetaLic): { neto: number | null; excluido: boolean } {
  if (m.monto == null || m.monto <= 0) return { neto: null, excluido: false };
  const texto = sinTildes(`${m.nombre} ${m.descripcion} ${m.itemsTexto}`);
  const conIva = texto.includes('iva incluido') || texto.includes('impuesto incluido');
  const neto = conIva ? Math.round(m.monto / 1.19) : m.monto;
  return { neto, excluido: neto < PISO_NETO_PREFILTRO };
}

// ─── Lectura de metadata para un set de códigos ───────────────────────────────────
// Combina la alerta (nombre/organismo/monto/región — siempre presente) con el caché
// de licitaciones (descripción/ítems — solo si fue enriquecida).
export async function cargarMetadata(codigos: string[]): Promise<MetaLic[]> {
  if (codigos.length === 0) return [];

  const base = new Map<string, MetaLic>();
  for (let i = 0; i < codigos.length; i += 500) {
    const chunk = codigos.slice(i, i + 500);
    const placeholders = chunk.map(() => '?').join(',');
    const [rows] = await pool.query(
      `SELECT licitacion_codigo AS codigo,
              MAX(licitacion_nombre)    AS nombre,
              MAX(licitacion_organismo) AS organismo,
              MAX(licitacion_region)    AS region,
              MAX(licitacion_monto)     AS monto
       FROM alertas_licitaciones
       WHERE licitacion_codigo IN (${placeholders})
       GROUP BY licitacion_codigo`,
      chunk,
    ) as any[];
    for (const r of rows as any[]) {
      base.set(r.codigo, {
        codigo: r.codigo,
        nombre: r.nombre || '',
        organismo: r.organismo || '',
        region: r.region || '',
        monto: r.monto != null ? Number(r.monto) : null,
        descripcion: '',
        itemsTexto: '',
      });
    }
  }

  // Enriquecer con el caché persistente (descripción + ítems) donde exista.
  const cache = await leerCache(codigos);
  for (const [cod, entry] of cache) {
    const meta = base.get(cod);
    if (!meta) continue;
    meta.descripcion = entry.lic.Descripcion || '';
    if (!meta.monto && entry.lic.MontoEstimado) meta.monto = Number(entry.lic.MontoEstimado);
    meta.itemsTexto = (entry.lic.Items || [])
      .slice(0, 20)
      .map(it => [it.NombreProducto, it.Descripcion, it.Categoria].filter(Boolean).join(' · '))
      .filter(Boolean)
      .join(' | ')
      .slice(0, 1200);
  }

  // Conservar el orden de entrada (recientes primero).
  return codigos.map(c => base.get(c)).filter(Boolean) as MetaLic[];
}

// ─── Prompt ───────────────────────────────────────────────────────────────────────
const SYSTEM_PROMPT = `Eres el FILTRO DE PRIMERA LÍNEA de una empresa que vende productos/equipamiento (ferretería, equipamiento, materiales, mobiliario urbano) en licitaciones públicas de Chile (Mercado Público).

Recibes solo METADATA de portada de varias licitaciones (nombre, organismo, región, presupuesto si viene, y a veces descripción/ítems). NO tienes los documentos. Tu tarea: descartar BARATO solo lo que es CLARAMENTE un no-go por la NATURALEZA DEL OBJETO, y dejar pasar todo lo demás.

PRINCIPIO DE CAUTELA (crítico): ves información limitada. La asimetría manda:
- Descarte equivocado = oportunidad perdida → GRAVE.
- Pase equivocado = unos tokens de más → menor (lo atrapa un gate posterior).
→ Excluye SOLO cuando la metadata lo deja INEQUÍVOCO. Ante CUALQUIER duda → PASA o REVISION_HUMANA, NUNCA descarte.
→ Exclusión por la NATURALEZA del objeto, NO por una palabra clave aislada.

QUÉ SE EXCLUYE (cada categoría con su excepción):
- servicio: el objeto es mantención, reparación, servicio técnico. NO si el servicio (instalación/capacitación/garantía) viene incluido en la VENTA de un equipo.
- obra_civil: pavimentar/hormigón de calzada, edificación. NO si es instalación menor de equipamiento urbano que sí se vende (mobiliario urbano, juegos de plaza).
- alta_ejecucion_tecnica: el núcleo es ejecución que exige profesional/constructor certificado en obra o experiencia mínima exigida en obras.
- capacitacion_pura / consultoria: curso, estudio o asesoría como servicio independiente. NO si la capacitación es anexa a la entrega de una máquina que la requiere.
- convenio_suministro: contrato de largo horizonte con entregas recurrentes mes a mes / según demanda. NO si es adquisición única / ejecución inmediata con uno o pocos despachos. EXCEPCIÓN IMPORTANTE: si el convenio es de PRODUCTOS DE NUESTRO RUBRO (ferretería, materiales de construcción, herramientas, equipamiento, insumos que vendemos) → NO lo excluyas: marca REVISION_HUMANA para decidir caso a caso. Solo EXCLUIDO como convenio si es de servicios o de productos claramente fuera de nuestra línea.
- commodity: el proyecto COMPLETO es un solo producto genérico de mucha oferta (solo computadores, solo resmas, solo impresoras estándar). NO si viene mezclado con productos especializados o es zona remota / baja competencia.

Señales que NO bastan por sí solas (confirma la naturaleza antes de excluir): "hormigón", "pavimento", "construcción", "capacitación", "mantención", "convenio". Pueden aparecer en proyectos que SÍ hacemos (venta de material/equipamiento). Si la metadata no aclara la naturaleza → PASA.

REGLA MIXTA (clave por la asimetría): si el objeto MEZCLA adquisición/compra/suministro de equipos o materiales CON un servicio (mantención, instalación, reparación, capacitación) — p.ej. "Adquisición y mantención de máquinas X", "Compra e instalación de Y" — NO es un servicio puro: hay venta de por medio → PASA o REVISION_HUMANA, NUNCA EXCLUIDO. Solo excluye como servicio cuando el objeto es ÍNTEGRAMENTE servicio sin venta de bienes.

CONFIANZA: número 0.0–1.0 de qué tan inequívoca es la exclusión según la metadata. Si solo tienes el nombre y este no es concluyente, la confianza debe ser baja.

Responde ÚNICAMENTE un objeto JSON válido, sin markdown ni texto extra.`;

function construirUserPrompt(metas: MetaLic[]): string {
  const lineas = metas.map((m, i) => {
    const partes = [
      `#${i} [${m.codigo}]`,
      `NOMBRE: ${m.nombre || '(sin nombre)'}`,
      m.organismo ? `ORGANISMO: ${m.organismo}` : '',
      m.region ? `REGIÓN: ${m.region}` : '',
      m.monto ? `PRESUPUESTO: $${m.monto.toLocaleString('es-CL')}` : 'PRESUPUESTO: (no informado)',
      m.descripcion ? `DESCRIPCIÓN: ${m.descripcion.slice(0, 600)}` : '',
      m.itemsTexto ? `ÍTEMS: ${m.itemsTexto}` : '',
    ].filter(Boolean);
    return partes.join('\n');
  }).join('\n\n---\n\n');

  return `Evalúa estas ${metas.length} licitaciones. Para CADA una devuelve un objeto con su índice "i" (el número #N).

LICITACIONES:
${lineas}

Devuelve EXACTAMENTE este JSON (un elemento por licitación, en el mismo orden):
{
  "resultados": [
    {
      "i": 0,
      "decision": "PASA | EXCLUIDO | REVISION_HUMANA",
      "categoria_exclusion": "servicio | obra_civil | alta_ejecucion_tecnica | capacitacion_pura | consultoria | convenio_suministro | commodity | null",
      "motivo": "1 frase breve",
      "evidencia": "frase exacta tomada del nombre/descripción/ítems",
      "confianza": 0.0
    }
  ]
}`;
}

// ─── Normalización + guardarraíl de umbrales ──────────────────────────────────────
// La IA propone; el CÓDIGO decide el destino final según la confianza, para garantizar
// la cautela aunque la IA sea demasiado agresiva:
//   EXCLUIDO real solo con confianza ≥ 0.8; entre 0.5 y 0.8 → REVISION_HUMANA; < 0.5 → PASA.
function aplicarUmbral(
  decisionIA: string,
  categoria: CategoriaExclusion,
  confianza: number,
): { decision: DecisionPrefiltro; categoria: CategoriaExclusion } {
  const d = (decisionIA || '').toUpperCase();
  if (d === 'EXCLUIDO') {
    if (confianza >= 0.8) return { decision: 'EXCLUIDO', categoria };
    if (confianza >= 0.5) return { decision: 'REVISION_HUMANA', categoria };
    return { decision: 'PASA', categoria: null };
  }
  if (d === 'REVISION_HUMANA') return { decision: 'REVISION_HUMANA', categoria };
  return { decision: 'PASA', categoria: null };
}

const CATEGORIAS_VALIDAS = new Set<string>([
  'servicio', 'obra_civil', 'alta_ejecucion_tecnica', 'capacitacion_pura',
  'consultoria', 'convenio_suministro', 'commodity',
]);

function normalizarCategoria(c: any): CategoriaExclusion {
  const s = String(c || '').toLowerCase().trim();
  return CATEGORIAS_VALIDAS.has(s) ? (s as CategoriaExclusion) : null;
}

// ─── Núcleo: prefiltrar un lote ───────────────────────────────────────────────────
// 1) Pre-check de presupuesto (sin IA). 2) IA en lote para el resto. Ante fallo → PASA.
export async function prefiltrarLote(metas: MetaLic[]): Promise<PrefiltroResult[]> {
  if (metas.length === 0) return [];

  const out = new Map<string, PrefiltroResult>();
  const paraIA: MetaLic[] = [];

  // Paso 1 — pre-check de presupuesto (determinista).
  for (const m of metas) {
    const { neto, excluido } = chequearPresupuesto(m);
    if (excluido) {
      out.set(m.codigo, {
        codigo: m.codigo,
        decision: 'EXCLUIDO',
        categoria: 'presupuesto',
        motivo: `Presupuesto neto ($${neto?.toLocaleString('es-CL')}) bajo el piso de $8.000.000.`,
        evidencia: `Presupuesto $${m.monto?.toLocaleString('es-CL')}`,
        confianza: 1,
        monto_neto: neto,
      });
    } else {
      paraIA.push(m);
    }
  }

  // Paso 2 — IA en lote para el resto. Default seguro = PASA.
  const fallbackPasa = (m: MetaLic): PrefiltroResult => ({
    codigo: m.codigo, decision: 'PASA', categoria: null,
    motivo: '', evidencia: '', confianza: 0,
    monto_neto: chequearPresupuesto(m).neto,
  });

  if (paraIA.length > 0 && process.env.DEEPSEEK_API_KEY) {
    for (let i = 0; i < paraIA.length; i += LOTE_IA) {
      const chunk = paraIA.slice(i, i + LOTE_IA);
      try {
        const completion = await getGemini().chat.completions.create({
          model: MODELO,
          messages: [
            { role: 'system', content: SYSTEM_PROMPT },
            { role: 'user', content: construirUserPrompt(chunk) },
          ],
          temperature: 0.1,
          max_tokens: 4_000,
          response_format: { type: 'json_object' },
        });
        const raw = completion.choices[0]?.message?.content || '';
        const ini = raw.indexOf('{'); const fin = raw.lastIndexOf('}');
        const parsed = JSON.parse(ini !== -1 ? raw.slice(ini, fin + 1) : raw);
        const arr: any[] = Array.isArray(parsed?.resultados) ? parsed.resultados
          : Array.isArray(parsed) ? parsed : [];

        // Mapear por índice "i" (robusto ante reordenamiento de la IA).
        const porIndice = new Map<number, any>();
        for (const r of arr) {
          const idx = Number(r?.i);
          if (Number.isInteger(idx)) porIndice.set(idx, r);
        }

        chunk.forEach((m, j) => {
          const r = porIndice.get(j);
          if (!r) { out.set(m.codigo, fallbackPasa(m)); return; }
          const confianza = Math.max(0, Math.min(1, Number(r.confianza) || 0));
          const catRaw = normalizarCategoria(r.categoria_exclusion);
          const { decision, categoria } = aplicarUmbral(r.decision, catRaw, confianza);
          out.set(m.codigo, {
            codigo: m.codigo,
            decision,
            categoria,
            motivo: String(r.motivo || '').slice(0, 500),
            evidencia: String(r.evidencia || '').slice(0, 500),
            confianza,
            monto_neto: chequearPresupuesto(m).neto,
          });
        });
      } catch (e) {
        console.warn('[prefiltro] Lote IA falló, marcando PASA por cautela:', String(e).slice(0, 150));
        for (const m of chunk) out.set(m.codigo, fallbackPasa(m));
      }
    }
  } else {
    // Sin API key → todo PASA (no se descarta nada).
    for (const m of paraIA) out.set(m.codigo, fallbackPasa(m));
  }

  return metas.map(m => out.get(m.codigo)!).filter(Boolean);
}

// ─── Persistencia ──────────────────────────────────────────────────────────────────
export async function guardarPrefiltro(results: PrefiltroResult[]): Promise<void> {
  if (results.length === 0) return;
  try {
    const placeholders = results.map(() => '(?,?,?,?,?,?,?,?)').join(',');
    const values: unknown[] = [];
    for (const r of results) {
      values.push(
        r.codigo,
        r.decision,
        r.categoria,
        Number.isFinite(r.confianza) ? Number(r.confianza.toFixed(3)) : null,
        r.motivo || null,
        r.evidencia || null,
        r.monto_neto ?? null,
        `${MODELO}`,
      );
    }
    await pool.query(
      `INSERT INTO prefiltro_licitacion
         (licitacion_codigo, decision, categoria, confianza, motivo, evidencia, monto_neto, modelo)
       VALUES ${placeholders}
       ON DUPLICATE KEY UPDATE
         decision   = VALUES(decision),
         categoria  = VALUES(categoria),
         confianza  = VALUES(confianza),
         motivo     = VALUES(motivo),
         evidencia  = VALUES(evidencia),
         monto_neto = VALUES(monto_neto),
         modelo     = VALUES(modelo)`,
      values,
    );
  } catch (e) {
    // Tabla inexistente (migración 21 pendiente) → no rompe; simplemente no persiste.
    console.warn('[prefiltro] No se pudo guardar (¿migración 21 pendiente?):', String(e).slice(0, 150));
  }
}

// Prefiltra un lote de códigos y persiste en un solo paso. Devuelve los resultados.
export async function prefiltrarYGuardar(codigos: string[]): Promise<PrefiltroResult[]> {
  const metas = await cargarMetadata(codigos);
  const results = await prefiltrarLote(metas);
  await guardarPrefiltro(results);
  return results;
}
