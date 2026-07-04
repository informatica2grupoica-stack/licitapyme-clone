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
import { crearChatIA, iaTextoConfigurada, MODELO_TEXTO } from '@/app/lib/gemini';
import { parseJsonIA } from '@/app/lib/json-ia';
import { leerCache } from '@/app/lib/licitaciones-cache';

// ─── Tipos ──────────────────────────────────────────────────────────────────────
export type DecisionPrefiltro = 'PASA' | 'EXCLUIDO' | 'REVISION_HUMANA';
export type CategoriaExclusion =
  | 'servicio' | 'aseo_servicio' | 'consultoria' | 'asesoria' | 'capacitacion_pura'
  | 'obra_civil' | 'construccion' | 'mejoramiento_ambiguo'
  | 'convenio_suministro' | 'convenio_rm'
  | 'commodity' | 'insumo_consumible' | 'presupuesto' | null;

export type PasadaPrefiltro = '1_palabra_dura' | '2_naturaleza' | null;
export type DestinoPrefiltro = 'FASE_1' | 'NO_REALIZAMOS' | 'NO_CALIFICADOS' | 'REVISION_HUMANA';

export interface PrefiltroResult {
  codigo: string;
  decision: DecisionPrefiltro;
  categoria: CategoriaExclusion;
  motivo: string;
  evidencia: string;
  confianza: number;
  monto_neto: number | null;
  // v2.0
  pasada: PasadaPrefiltro;
  palabra_negativa: { nivel: 'dura' | 'contextual' | null; termino: string } | null;
  destino: DestinoPrefiltro;
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

const MODELO = MODELO_TEXTO;
const PISO_NETO_PREFILTRO = 8_000_000; // < $8M neto → EXCLUIDO por presupuesto
const LOTE_IA = 15;                    // licitaciones por llamada a DeepSeek

const sinTildes = (s: string) => (s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

// ─── Diccionario de palabras negativas DURAS (Pasada 1 — sin ambigüedad) ──────────
// Nunca tocar "aseo" a secas: vendemos maquinaria de aseo (negocio central).
// Solo son duras las frases que no tienen excepción conocida.
// Crece vía loop de retroalimentación (flag "no lo hacemos").
const PALABRAS_DURAS: Array<{ termino: string; categoria: CategoriaExclusion; motivo: string }> = [
  { termino: 'toner',           categoria: 'insumo_consumible', motivo: 'Insumo consumible (tóner): no es nuestro rubro.' },
  { termino: 'tóner',           categoria: 'insumo_consumible', motivo: 'Insumo consumible (tóner): no es nuestro rubro.' },
  { termino: 'insumos dentales',categoria: 'insumo_consumible', motivo: 'Insumos dentales: fuera de nuestro rubro.' },
  { termino: 'articulos de aseo',categoria: 'insumo_consumible', motivo: 'Artículos/insumos de aseo (consumibles), no maquinaria.' },
  { termino: 'artículos de aseo',categoria: 'insumo_consumible', motivo: 'Artículos/insumos de aseo (consumibles), no maquinaria.' },
];

/** Pasada 1: pre-filtro de string sobre palabras negativas DURAS. Sin IA, confianza 1.0. */
function pasada1PalabraDura(m: MetaLic): PrefiltroResult | null {
  const texto = sinTildes(`${m.nombre} ${m.descripcion} ${m.itemsTexto}`);
  for (const pw of PALABRAS_DURAS) {
    if (texto.includes(sinTildes(pw.termino))) {
      return {
        codigo: m.codigo,
        decision: 'EXCLUIDO',
        categoria: pw.categoria,
        motivo: pw.motivo,
        evidencia: pw.termino,
        confianza: 1.0,
        monto_neto: chequearPresupuesto(m).neto,
        pasada: '1_palabra_dura',
        palabra_negativa: { nivel: 'dura', termino: pw.termino },
        destino: 'NO_REALIZAMOS',
      };
    }
  }
  return null;
}

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

// ─── Prompt v2.0 ─────────────────────────────────────────────────────────────────
// Pasada 2: juicio por naturaleza del objeto (DeepSeek).
// Las palabras negativas DURAS ya fueron procesadas en Pasada 1 (código), no llegan aquí.
const SYSTEM_PROMPT = `Eres el FILTRO DE PRIMERA LÍNEA (Fase 0, Pasada 2) de una empresa chilena que vende productos/equipamiento (ferretería, materiales, mobiliario urbano, maquinaria de aseo, equipamiento municipal) en licitaciones públicas de Mercado Público.

Recibes METADATA de portada (nombre, organismo, región, presupuesto opcional, descripción/ítems cuando existe). NO tienes los documentos. Las palabras negativas DURAS (tóner, insumos dentales, artículos de aseo) ya fueron excluidas antes de llegar aquí.

PRINCIPIO DE CAUTELA (crítico — no negociable):
- Descarte equivocado = oportunidad perdida → GRAVE.
- Pase equivocado = unos tokens de más → menor (lo atrapa Fase 2).
→ Excluye SOLO cuando la metadata lo deja INEQUÍVOCO. Ante CUALQUIER duda → PASA o REVISION_HUMANA, NUNCA descarte.
→ Exclusión por la NATURALEZA DEL OBJETO, no por una palabra clave aislada.

PALABRAS CONTEXTUALES — nunca excluyen solas; obligan a evaluar la naturaleza:
"aseo", "mejoramiento", "construcción", "capacitación", "convenio", "mantención", "consultoría", "asesoría".
Si la metadata no aclara la naturaleza con estas palabras → PASA.

QUÉ SE EXCLUYE (con su excepción):

A. SERVICIO PURO (categoría "servicio"): mantención, reparación, servicio técnico, vigilancia, como OBJETO del contrato.
   Excepción: NO excluir si el servicio (instalación/garantía/capacitación) viene INCLUIDO en la venta de un equipo. Si MEZCLA compra + servicio → PASA o REVISION_HUMANA, nunca EXCLUIDO.

A-bis. SERVICIO DE ASEO (categoría "aseo_servicio"): servicio/contrato de limpieza/aseo como objeto íntegro.
   CRÍTICO: MAQUINARIA de aseo (barredora, vacuolavadora, hidrolavadora, fregadora, aspiradora industrial) = NEGOCIO CENTRAL → PASA. "Aseo" sola NUNCA excluye: analiza el objeto.

B. CONSULTORÍA / ASESORÍA / CAPACITACIÓN PURA (categorías "consultoria", "asesoria", "capacitacion_pura"): estudio, asesoría, consultoría, curso como servicio independiente.
   Excepción: capacitación ANEXA a la entrega de una máquina → PASA.

C. OBRA CIVIL / CONSTRUCCIÓN (categoría "construccion"): pavimento, alcantarillado, edificación, sede, multicancha; núcleo = ejecución que exige constructor/profesional certificado en obra.
   Excepción: instalación menor de equipamiento urbano que sí vendemos (mobiliario, juegos de plaza) → PASA.

C-bis. "MEJORAMIENTO DE …" (categoría "mejoramiento_ambiguo"): señal AMBIGUA.
   Si la metadata muestra compra de bienes que sí vendemos → PASA.
   Si no hay señal de producto → REVISION_HUMANA (nunca EXCLUIDO directo).

D. CONVENIO DE SUMINISTRO (categoría "convenio_suministro"): contrato de largo horizonte, entregas recurrentes mes a mes / según demanda.
   Excepción: adquisición única / ejecución inmediata → PASA.
   Excepción RM: si región = Región Metropolitana → REVISION_HUMANA (categoría "convenio_rm"), no EXCLUIDO.

E. COMMODITY DE ALTA OFERTA (categoría "commodity"): el proyecto COMPLETO es un solo genérico de mucha oferta (solo computadores, discos duros, resmas, impresoras estándar).
   Excepción: mezclado con productos especializados, o zona remota / baja competencia → PASA.

UMBRALES DE CONFIANZA:
- EXCLUIDO solo si confianza ≥ 0.8 y metadata inequívoca.
- 0.5–0.8 → REVISION_HUMANA.
- < 0.5 → PASA.

CONFIANZA: refleja qué tan inequívoca es la exclusión con la metadata disponible. Si solo tienes el nombre y no es concluyente → confianza baja.

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

  return `Evalúa estas ${metas.length} licitaciones (Pasada 2 — las palabras negativas duras ya fueron filtradas antes). Para CADA una devuelve un objeto con su índice "i" (el número #N).

LICITACIONES:
${lineas}

Devuelve EXACTAMENTE este JSON (un elemento por licitación, en el mismo orden):
{
  "resultados": [
    {
      "i": 0,
      "decision": "PASA | EXCLUIDO | REVISION_HUMANA",
      "categoria_exclusion": "servicio | aseo_servicio | consultoria | asesoria | capacitacion_pura | obra_civil | construccion | mejoramiento_ambiguo | convenio_suministro | convenio_rm | commodity | null",
      "palabra_negativa_contextual": "término contextual que disparó la evaluación, o null",
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
  'servicio', 'aseo_servicio', 'consultoria', 'asesoria', 'capacitacion_pura',
  'obra_civil', 'construccion', 'mejoramiento_ambiguo',
  'convenio_suministro', 'convenio_rm',
  'commodity', 'insumo_consumible',
  // retrocompatibilidad con registros v1 en BD
  'alta_ejecucion_tecnica',
]);

function normalizarCategoria(c: any): CategoriaExclusion {
  const s = String(c || '').toLowerCase().trim();
  // Mapear categoría legacy a su equivalente v2.0
  if (s === 'alta_ejecucion_tecnica') return 'construccion';
  return CATEGORIAS_VALIDAS.has(s) ? (s as CategoriaExclusion) : null;
}

function calcularDestino(decision: DecisionPrefiltro, categoria: CategoriaExclusion): DestinoPrefiltro {
  if (decision === 'PASA') return 'FASE_1';
  if (decision === 'REVISION_HUMANA') return 'REVISION_HUMANA';
  // EXCLUIDO
  return categoria === 'presupuesto' ? 'NO_CALIFICADOS' : 'NO_REALIZAMOS';
}

// ─── Núcleo: prefiltrar un lote (v2.0) ───────────────────────────────────────────
// Orden: (1) presupuesto determinista → (2) Pasada 1 palabras duras → (3) Pasada 2 IA.
// Ante cualquier fallo de IA → PASA (cautela).
export async function prefiltrarLote(metas: MetaLic[]): Promise<PrefiltroResult[]> {
  if (metas.length === 0) return [];

  const out = new Map<string, PrefiltroResult>();
  const paraP1: MetaLic[] = [];

  // Paso 1 — pre-check de presupuesto (determinista, sin IA).
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
        pasada: null,
        palabra_negativa: null,
        destino: 'NO_CALIFICADOS',
      });
    } else {
      paraP1.push(m);
    }
  }

  // Paso 2 — Pasada 1: palabras negativas DURAS (string, sin IA).
  const paraIA: MetaLic[] = [];
  for (const m of paraP1) {
    const resultado = pasada1PalabraDura(m);
    if (resultado) {
      out.set(m.codigo, resultado);
    } else {
      paraIA.push(m);
    }
  }

  // Paso 3 — Pasada 2: IA en lote para lo que sobrevive. Default seguro = PASA.
  const fallbackPasa = (m: MetaLic): PrefiltroResult => ({
    codigo: m.codigo, decision: 'PASA', categoria: null,
    motivo: '', evidencia: '', confianza: 0,
    monto_neto: chequearPresupuesto(m).neto,
    pasada: null, palabra_negativa: null, destino: 'FASE_1',
  });

  if (paraIA.length > 0 && iaTextoConfigurada()) {
    for (let i = 0; i < paraIA.length; i += LOTE_IA) {
      const chunk = paraIA.slice(i, i + LOTE_IA);
      try {
        const completion = await crearChatIA({
          messages: [
            { role: 'system', content: SYSTEM_PROMPT },
            { role: 'user', content: construirUserPrompt(chunk) },
          ],
          temperature: 0.1,
          max_tokens: 4_000,
          response_format: { type: 'json_object' },
        });
        const raw = completion.choices[0]?.message?.content || '';
        const parsed: any = parseJsonIA(raw) ?? {};
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
          const termCtx = r.palabra_negativa_contextual
            ? String(r.palabra_negativa_contextual).slice(0, 60) : null;
          out.set(m.codigo, {
            codigo: m.codigo,
            decision,
            categoria,
            motivo: String(r.motivo || '').slice(0, 500),
            evidencia: String(r.evidencia || '').slice(0, 500),
            confianza,
            monto_neto: chequearPresupuesto(m).neto,
            pasada: '2_naturaleza',
            palabra_negativa: termCtx
              ? { nivel: 'contextual', termino: termCtx }
              : null,
            destino: calcularDestino(decision, categoria),
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
