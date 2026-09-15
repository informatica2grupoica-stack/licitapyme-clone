// app/lib/compras-agente-documentos.ts
// AGENTE DE DOCUMENTOS PARA COMPRAS — pedido explícito del usuario (14-sep-2026): "la IA lea los
// documentos que tiene las licitaciones de compra... y nos vaya guiando... poniendo lo que
// tenemos que llenar" y "vamos a usar la API de Gemini, archivo aparte, no lo mezcles con las
// otras APIs que ya tenemos". Por eso este archivo llama a Gemini DIRECTO (fetch propio, sin
// pasar por app/lib/gemini.ts) — nace del bug real que se encontró y corrigió en el negocio 1054
// (el toggle "Incluye flete" quedó marcado al revés de lo que decía la propia justificación del
// comprador): la idea es que ANTES de guardar, alguien (o algo) cruce lo que se está tipeando
// contra lo que dicen los documentos reales del proyecto.
//
// QUÉ LEE (spec §3.5, mismos documentos que ve DocumentosLicitacionCard.tsx):
//   - Bases administrativas / técnicas y lo subido por Compras (Anexo Admin/Económico/Técnico,
//     Costeo) → tabla `documentos_cache`, categorías BASES_ADMINISTRATIVAS/BASES_TECNICAS/
//     DOCUMENTOS_PROPIOS. Estos últimos NUNCA se extraen automáticamente (a diferencia de las
//     bases descargadas de Mercado Público) — este archivo es el primero en leerlos.
//   - Acta de evaluación → tabla APARTE `acta_documento` (ver acta-adjudicacion.ts).
//
// CÓMO EXTRAE EL TEXTO: reusa `texto_extraido` si `documentos_cache` ya lo tiene (lo llenó la
// Viabilidad IA al leer las bases). Si no existe (siempre el caso de DOCUMENTOS_PROPIOS y del
// acta), lo extrae con la File API de Gemini y lo cachea de vuelta en `documentos_cache` para no
// gastar créditos releyendo el mismo PDF en cada cotización — el acta y los anexos propios no
// cambian una vez subidos.
//
// NUNCA INVENTAR DATOS: si un documento no se pudo leer o no dice algo, el agente debe decirlo
// explícito ("no está en los documentos que tengo") en vez de adivinar — mismo criterio que el
// resto del proyecto (parser de manifiestos, chat de licitación, etc.).
import pool from '@/app/lib/db';
import { ahoraChileSQL } from '@/app/lib/tz';
// Auditoría de negocio COMPLETO (pedido explícito, 15-sep-2026: "tiene que leer todos estos
// documentos la IA para poder ver todo el área de compras desde tareas a entrega y cierre") — se
// reutilizan las funciones que YA arman cada pestaña, no se duplica ninguna consulta SQL.
import { listarTareas, obtenerResumenFases } from '@/app/lib/compras';
import { obtenerEstadoReloj } from '@/app/lib/compras-reloj';
import { listarCotizaciones, calcularEscenarios } from '@/app/lib/compras-auditor';
import { obtenerAprobaciones, calcularPresupuestoCompra, calcularMargenPrevisto, listarSkus, obtenerEscenarioElegido } from '@/app/lib/compras-aprobaciones';
import { proveedoresParaOrdenCompra, ordenesCompraParaVista } from '@/app/lib/compras-oc-obuma';
import { obtenerReparto, listarRespaldosHito } from '@/app/lib/compras-reparto';
import { obtenerModalidadRetiro } from '@/app/lib/compras-logistica';
import { listarGastos, resumenGastos } from '@/app/lib/compras-gastos';
import { obtenerEntrega, listarPostventa } from '@/app/lib/compras-entrega';
import { listarIncidencias } from '@/app/lib/compras-incidencias';
import { obtenerFracaso } from '@/app/lib/compras-fracaso';

const GEMINI_API_KEY = process.env.GEMINI_API_KEY || '';
const GEMINI_BASE = 'https://generativelanguage.googleapis.com';
// Mismo criterio de costo que el resto del proyecto: flash-lite para leer/transcribir (barato),
// flash normal para razonar sobre el borrador (necesita más criterio, sigue siendo barato).
const MODELO_LECTURA = process.env.AGENTE_COMPRAS_MODELO_OCR || 'gemini-2.5-flash-lite';
const MODELO_AUDITORIA = process.env.AGENTE_COMPRAS_MODELO || 'gemini-2.5-flash';

export function agenteDocumentosDisponible(): boolean {
  return Boolean(GEMINI_API_KEY);
}

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

// ─── Tope diario de uso (pedido explícito, 14-sep-2026: "si te preocupa el gasto puedo agregar un
// tope diario o un contador visible" → "realizalo") ─────────────────────────────────────────────
// Cada auditoría completa (lectura de PDFs nuevos + razonamiento) gasta créditos REALES de Gemini
// — no hay forma de "simular" el costo, así que se cuenta cuántas llamadas completas se hicieron
// HOY (hora de Chile, un solo contador GLOBAL — no por negocio, el gasto es de la cuenta entera) y
// se corta antes de llamar a Gemini si ya se llegó al tope. El contador solo sube DESPUÉS de una
// llamada exitosa — un intento que falla (ej. Gemini caído) no debe consumir cupo del día.
export const TOPE_DIARIO_AGENTE = Math.max(1, Number(process.env.AGENTE_COMPRAS_TOPE_DIARIO) || 25);

function hoyChile(): string { return ahoraChileSQL().slice(0, 10); }

export interface UsoDiarioAgente { llamadas: number; tope: number; agotado: boolean }

export async function usoDiarioAgente(): Promise<UsoDiarioAgente> {
  const [rows] = await pool.query(
    `SELECT llamadas FROM compras_agente_uso_diario WHERE fecha = ?`, [hoyChile()],
  ) as any;
  const llamadas = Number((rows as any[])[0]?.llamadas ?? 0);
  return { llamadas, tope: TOPE_DIARIO_AGENTE, agotado: llamadas >= TOPE_DIARIO_AGENTE };
}

async function registrarUsoAgente(): Promise<void> {
  await pool.query(
    `INSERT INTO compras_agente_uso_diario (fecha, llamadas, actualizado_at) VALUES (?, 1, NOW())
     ON DUPLICATE KEY UPDATE llamadas = llamadas + 1, actualizado_at = NOW()`,
    [hoyChile()],
  );
}

async function licitacionDeNegocio(negocioId: number): Promise<string | null> {
  const [rows] = await pool.query(`SELECT licitacion_codigo FROM negocios WHERE id = ? LIMIT 1`, [negocioId]) as any;
  return (rows as any[])[0]?.licitacion_codigo ?? null;
}

// ─── Extracción de un PDF vía la File API de Gemini (llamada directa, propia de este archivo) ──
async function extraerTextoPdf(buffer: Buffer, etiqueta: string): Promise<string> {
  if (!GEMINI_API_KEY) throw new Error('GEMINI_API_KEY no configurada');

  const start = await fetch(`${GEMINI_BASE}/upload/v1beta/files?key=${GEMINI_API_KEY}`, {
    method: 'POST',
    headers: {
      'X-Goog-Upload-Protocol': 'resumable', 'X-Goog-Upload-Command': 'start',
      'X-Goog-Upload-Header-Content-Length': String(buffer.length),
      'X-Goog-Upload-Header-Content-Type': 'application/pdf', 'Content-Type': 'application/json',
    },
    body: JSON.stringify({ file: { display_name: etiqueta.slice(0, 100) } }),
    signal: AbortSignal.timeout(120_000),
  });
  const uploadUrl = start.headers.get('x-goog-upload-url');
  if (!uploadUrl) throw new Error(`Gemini File API (start) ${start.status}: ${(await start.text().catch(() => '')).slice(0, 150)}`);

  const up = await fetch(uploadUrl, {
    method: 'POST',
    headers: { 'X-Goog-Upload-Command': 'upload, finalize', 'X-Goog-Upload-Offset': '0', 'Content-Type': 'application/pdf' },
    body: buffer as any,
    signal: AbortSignal.timeout(180_000),
  });
  let file = (await up.json())?.file;
  if (!file?.name) throw new Error('Gemini File API: subida sin nombre de archivo');

  try {
    for (let i = 0; i < 30 && file.state !== 'ACTIVE'; i++) {
      await sleep(2_000);
      file = await fetch(`${GEMINI_BASE}/v1beta/${file.name}?key=${GEMINI_API_KEY}`).then(r => r.json()).catch(() => file);
      if (file.state === 'FAILED') throw new Error('Gemini File API: procesamiento FAILED');
    }
    if (file.state !== 'ACTIVE') throw new Error(`Gemini File API: archivo no quedó ACTIVE (estado=${file.state})`);

    // Marcadores [[PÁGINA N]] (pedido explícito, 15-sep-2026: "ponele un ojo... y citas a la IA
      // para ver de dónde sacó esa información") — mismo formato que ya usa el resto del proyecto
      // para citar (document-extraction.ts, viabilidad IA) para poder verificar después, página por
      // página, que una cita que da el agente de verdad existe en el documento.
    const body = JSON.stringify({
      contents: [{ parts: [
        { text: 'Transcribe TODO el texto de este documento, página por página y en orden — incluye tablas con sus valores, montos, porcentajes, plazos y condiciones. Antes de cada página, en su propia línea, pon el marcador exacto [[PÁGINA N]] (N = número de página, empezando en 1). No resumas ni omitas nada. Devuelve solo el texto transcrito con sus marcadores.' },
        { fileData: { mimeType: 'application/pdf', fileUri: file.uri } },
      ] }],
      generationConfig: { temperature: 0, maxOutputTokens: 60_000, thinkingConfig: { thinkingBudget: 0 } },
    });
    const res = await fetch(`${GEMINI_BASE}/v1beta/models/${MODELO_LECTURA}:generateContent?key=${GEMINI_API_KEY}`,
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body, signal: AbortSignal.timeout(180_000) });
    if (!res.ok) throw new Error(`Gemini (lectura) ${res.status}: ${(await res.text().catch(() => '')).slice(0, 200)}`);
    const data = await res.json();
    return String(data.candidates?.[0]?.content?.parts?.[0]?.text ?? '').trim();
  } finally {
    fetch(`${GEMINI_BASE}/v1beta/${file.name}?key=${GEMINI_API_KEY}`, { method: 'DELETE' }).catch(() => {});
  }
}

interface DocumentoAgente { nombre: string; categoria: string; texto: string; url: string | null }
// Fuente pública de un documento leído — lo que necesita la UI para el botón "ver documento"
// (pedido explícito, 15-sep-2026: "ponele un ojo... para ver los documentos").
export interface FuenteDocumento { nombre: string; url: string | null }

// ── Documentos de compras_cache (bases + subidos por Compras) ──────────────────────────────
// BUG REAL (15-sep-2026, negocio 332): el plazo de entrega que NOSOTROS ofertamos ("30 días
// hábiles") vive en el Formulario B/Anexo de Oferta Económica YA RELLENADO Y ENVIADO a Mercado
// Público — pero ese anexo relleno queda clasificado como `ANEXOS_OFERENTE` (la categoría del
// clasificador para los anexos de la postulación), no `DOCUMENTOS_PROPIOS` (que acá es solo lo que
// Compras sube DESPUÉS de ganar). El filtro original no incluía ANEXOS_OFERENTE, así que el agente
// nunca vio el documento que de verdad tenía el número — solo las BASES, que apenas dicen "el
// plazo que declare el proveedor", sin el valor. Se agrega ANEXOS_OFERENTE para que el agente
// tenga acceso al anexo YA RELLENO (distinto del anexo en blanco descargado de MP, que puede
// convivir en la misma lista — el prompt le pide preferir el que tenga un valor concreto).
async function documentosCacheParaCompras(licitacionCodigo: string): Promise<DocumentoAgente[]> {
  const [rows] = await pool.query(
    `SELECT id, documento_nombre AS nombre, categoria, documento_url_local AS url, texto_extraido AS texto
       FROM documentos_cache
      WHERE licitacion_codigo = ? AND categoria IN ('BASES_ADMINISTRATIVAS','BASES_TECNICAS','DOCUMENTOS_PROPIOS','ANEXOS_OFERENTE')
      ORDER BY id ASC`,
    [licitacionCodigo],
  ) as any;

  const out: DocumentoAgente[] = [];
  for (const r of rows as any[]) {
    let texto = (r.texto || '').trim();
    if (!texto && r.url && /\.pdf($|\?)/i.test(r.url)) {
      // DOCUMENTOS_PROPIOS (Anexo Admin/Económico/Técnico, Costeo si es PDF) nunca vienen con
      // texto_extraido — se extrae acá y se cachea, para no volver a gastar créditos con el
      // mismo archivo en la próxima cotización de este mismo negocio.
      try {
        const res = await fetch(r.url);
        const buf = Buffer.from(await res.arrayBuffer());
        texto = await extraerTextoPdf(buf, r.nombre);
        if (texto) {
          await pool.query(
            `UPDATE documentos_cache SET texto_extraido = ?, texto_extraido_at = NOW(), metodo_extraccion = 'agente-compras-gemini' WHERE id = ?`,
            [texto, r.id],
          ).catch(() => { /* no crítico — igual se devuelve el texto recién leído */ });
        }
      } catch (e) {
        console.warn(`[agente-compras] no se pudo leer "${r.nombre}":`, e instanceof Error ? e.message : e);
        continue;
      }
    }
    if (texto) out.push({ nombre: r.nombre, categoria: r.categoria, texto, url: r.url ?? null });
  }
  return out;
}

// ── Acta de evaluación (tabla aparte, nunca se extrae en ningún otro flujo) ────────────────
async function documentoActaParaCompras(licitacionCodigo: string): Promise<DocumentoAgente | null> {
  const [rows] = await pool.query(
    `SELECT id, nombre, url_r2 FROM acta_documento WHERE licitacion_codigo = ? AND url_r2 IS NOT NULL ORDER BY id LIMIT 1`,
    [licitacionCodigo],
  ) as any;
  const r = (rows as any[])[0];
  if (!r) return null;
  try {
    const res = await fetch(r.url_r2);
    const buf = Buffer.from(await res.arrayBuffer());
    const texto = await extraerTextoPdf(buf, r.nombre);
    return texto ? { nombre: r.nombre, categoria: 'ACTA', texto, url: r.url_r2 ?? null } : null;
  } catch (e) {
    console.warn('[agente-compras] no se pudo leer el acta:', e instanceof Error ? e.message : e);
    return null;
  }
}

const MAX_CHARS_CONTEXTO = 300_000; // mismo orden de magnitud que el chat de licitación (gemini-2.5-flash aguanta de sobra)

/** Arma el corpus de documentos del proyecto relevantes para Compras — bases, lo que Compras
 *  mismo subió, y el acta. Se llama una vez por auditoría; el costo de lectura de cada PDF solo
 *  se paga la primera vez (después queda cacheado en documentos_cache, salvo el acta). Devuelve
 *  también el texto POR DOCUMENTO (sin concatenar) — lo usa verificarCitas() para comprobar, con
 *  un simple substring-match (nada de "confiar" en que la IA citó bien), que cada cita que el
 *  agente da de verdad existe en el documento que dice citar. */
export async function contextoDocumentosCompras(negocioId: number): Promise<{
  texto: string; documentos: string[]; fuentes: FuenteDocumento[]; licitacionCodigo: string | null;
  porDocumento: Map<string, string>;
}> {
  const licitacionCodigo = await licitacionDeNegocio(negocioId);
  if (!licitacionCodigo) return { texto: '', documentos: [], fuentes: [], licitacionCodigo: null, porDocumento: new Map() };

  const [cache, acta] = await Promise.all([
    documentosCacheParaCompras(licitacionCodigo),
    documentoActaParaCompras(licitacionCodigo),
  ]);
  const docs = acta ? [...cache, acta] : cache;
  if (docs.length === 0) return { texto: '', documentos: [], fuentes: [], licitacionCodigo, porDocumento: new Map() };

  let texto = docs.map(d => `[[DOCUMENTO: ${d.nombre} — ${d.categoria}]]\n${d.texto}`).join('\n\n');
  if (texto.length > MAX_CHARS_CONTEXTO) {
    texto = texto.slice(0, MAX_CHARS_CONTEXTO) + '\n\n[[CONTEXTO TRUNCADO — quedaron documentos afuera por tamaño.]]';
  }
  return {
    texto, documentos: docs.map(d => d.nombre),
    fuentes: docs.map(d => ({ nombre: d.nombre, url: d.url })),
    licitacionCodigo,
    porDocumento: new Map(docs.map(d => [d.nombre, d.texto])),
  };
}

// ── Verificación de citas (pedido explícito, 15-sep-2026: "las citas las puedes hacer con una
// librería o algo que no falle y sea exacto") — deliberadamente NO se le pide a otro modelo de IA
// que "revise" la cita (eso solo cambiaría un posible error por otro). Es un match de texto
// determinístico: la cita tiene que ser un fragmento LITERAL (normalizando espacios/tildes/mayús-
// culas, nada más) del documento que el agente dice haber citado. Si no calza, se marca como no
// verificada — se sigue mostrando la alerta (puede ser válida igual), pero la persona sabe que esa
// cita puntual no se pudo confirmar automáticamente contra el texto real. ──────────────────────
function normalizarParaComparar(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
}

function verificarCita(documento: string | undefined, citaTextual: string | undefined, porDocumento: Map<string, string>): boolean {
  if (!documento || !citaTextual?.trim()) return false;
  const texto = porDocumento.get(documento);
  if (!texto) return false;
  return normalizarParaComparar(texto).includes(normalizarParaComparar(citaTextual));
}

// ── Auditoría/guía del borrador de cotización contra los documentos ────────────────────────
export interface BorradorCotizacion {
  productoDescripcion: string | null;
  // Texto libre de "Qué cotizó" (pedido explícito, 15-sep-2026: el agente decía "el producto no
  // está especificado" incluso cuando SÍ estaba tipeado acá — nunca se lo mandábamos. Es el dato
  // que permite el único cruce técnico real: ¿lo que ofrece el proveedor cumple lo que exigen las
  // Bases Técnicas/Anexo Técnico?).
  descripcionLibre: string | null; cantidad: number | null;
  proveedorNombre: string; precioUnitario: number | null; descuentoPct: number | null;
  incluyeFlete: boolean | null; fleteMonto: number | null; plazoEntregaTexto: string | null;
}
// Citas (pedido explícito, 15-sep-2026): cada alerta/sugerencia trae de qué documento sale y una
// cita textual corta — `citaVerificada` la calcula el código (verificarCita), no la IA, después de
// recibir la respuesta.
export interface AlertaAgente { campo: string; mensaje: string; gravedad: 'info' | 'aviso' | 'critico'; documento: string | null; citaTextual: string | null; citaVerificada: boolean; area?: string }
export interface SugerenciaAgente { campo: string; valor: string; razon: string; documento: string | null; citaTextual: string | null; citaVerificada: boolean; area?: string }
export interface ResultadoAuditoriaAgente {
  encontroDocumentos: boolean; documentosLeidos: string[]; fuentes: FuenteDocumento[];
  alertas: AlertaAgente[]; sugerencias: SugerenciaAgente[]; resumen: string;
  usoHoy: UsoDiarioAgente;
}

const ESQUEMA_RESPUESTA = {
  type: 'OBJECT',
  properties: {
    resumen: { type: 'STRING', description: 'Una o dos frases: qué se revisó y la conclusión general.' },
    alertas: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          campo: { type: 'STRING', enum: ['proveedorNombre', 'precioUnitario', 'descuentoPct', 'incluyeFlete', 'fleteMonto', 'plazoEntregaTexto', 'general'] },
          mensaje: { type: 'STRING' },
          gravedad: { type: 'STRING', enum: ['info', 'aviso', 'critico'] },
          documento: { type: 'STRING', description: 'Nombre EXACTO del documento (tal como aparece en el marcador [[DOCUMENTO: ...]]) de donde sale esta alerta. Si la alerta no se basa en un documento puntual (ej. una contradicción interna del propio borrador), deja este campo vacío.' },
          citaTextual: { type: 'STRING', description: 'Cita LITERAL y corta (8-25 palabras) copiada tal cual del documento — NUNCA una paráfrasis. Se verifica por código que existe de verdad en el texto; si no la encuentras exacta, mejor dejarla vacía que inventarla.' },
        },
        required: ['campo', 'mensaje', 'gravedad'],
      },
    },
    sugerencias: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          campo: { type: 'STRING', enum: ['proveedorNombre', 'precioUnitario', 'descuentoPct', 'incluyeFlete', 'fleteMonto', 'plazoEntregaTexto'] },
          valor: { type: 'STRING', description: 'El valor sugerido como texto plano — para incluyeFlete usar "true" o "false"; para montos, solo números sin puntos ni símbolos.' },
          razon: { type: 'STRING' },
          documento: { type: 'STRING', description: 'Igual que en alertas: nombre EXACTO del documento fuente.' },
          citaTextual: { type: 'STRING', description: 'Igual que en alertas: cita literal corta, nunca inventada.' },
        },
        required: ['campo', 'valor', 'razon'],
      },
    },
  },
  required: ['resumen', 'alertas', 'sugerencias'],
};

const SYSTEM_PROMPT = `Eres el agente de apoyo del encargado de Compras de nuestra empresa. Tu trabajo es cruzar lo que la persona está a punto de guardar en una cotización de COMPRA contra DOS fuentes que se te entregan como contexto: los documentos REALES del proyecto, y el estado actual del resto del negocio (lo que ya está cargado en las otras pestañas de Compras — Tareas, Costeo, Aprobación/SKU, Compra/Logística, Entrega). Pedido explícito del usuario (15-sep-2026): "todo el campo de información que está en el módulo de compra se debería poder leer entre ellas" — no le pidas a la persona un dato que el sistema ya tiene en otro lado.

MUY IMPORTANTE — no confundas dos relaciones comerciales distintas que aparecen en los mismos documentos:
1) LA VENTA: nuestra empresa (el "oferente" o "adjudicatario" que aparece en las bases, el Acta de Evaluación y los anexos) le vendió algo a un organismo público, a un precio, plazo y condiciones que YA quedaron fijados y no se pueden cambiar. Los datos de identificación del oferente, el monto ofertado al cliente y el plazo de entrega COMPROMETIDO CON EL CLIENTE salen de ahí.
2) LA COMPRA (lo que estás auditando): para cumplir esa venta, Compras cotiza y compra el producto/servicio a un PROVEEDOR EXTERNO — el "proveedorNombre" del borrador es ESE proveedor, nunca nuestra propia empresa. El precio que ese proveedor cobra (nuestro COSTO) es normal y ESPERADO que sea distinto (más bajo, por margen) del precio al que le vendimos al cliente — eso NO es un error, no lo marques como alerta. Tampoco existe "descuento" del cliente en las bases: el descuento del borrador es el que nos da NUESTRO proveedor, no algo que deba aparecer en los anexos de la oferta.

EJEMPLO CONCRETO (para que quede clarísimo): si las bases dicen que "Inversiones Claro ARZ SpA" es el adjudicatario que le vende deshumidificadores Trotec a una municipalidad por $2.630.678 c/u, y el borrador de compra dice proveedor "TROTEC" a $1.927.825 c/u — TROTEC es el fabricante/proveedor real al que le compramos, "Inversiones Claro ARZ SpA" somos NOSOTROS MISMOS, y la diferencia de precio es exactamente el margen esperado. NO generes ninguna alerta de "el proveedor no coincide con el adjudicatario" ni "el precio no coincide con lo ofertado" — esa comparación está fuera de lugar por diseño.

Tu auditoría tiene que ser COMPLETA, de principio a fin — no te detengas en el primer par de campos obvios (flete, plazo). Recorre CADA uno de estos puntos, uno por uno, antes de responder:

1. PRODUCTO/ESPECIFICACIONES TÉCNICAS: lee "descripcionLibre" (lo que el proveedor efectivamente ofreció, texto libre) y compáralo punto por punto contra las Bases Técnicas / Anexo Técnico — marca, modelo, capacidad/potencia, dimensiones, certificaciones, cualquier requisito mínimo exigido. Si "descripcionLibre" viene vacío, esa ES una alerta real (no se puede verificar cumplimiento técnico sin saber qué se cotizó) — pero si SÍ viene, úsalo, no digas que "no está especificado".
2. CANTIDAD: si viene informada, que alcance para cubrir lo que hay que entregarle al cliente según las bases/anexo económico. Si viene vacía, NO la sugieras como campo a llenar acá (la cantidad NO es un campo de esta cotización — se asigna aparte, por producto, en "Asignar productos") — como mucho, menciónalo como algo a revisar en esa pantalla, no como un dato que falte en este formulario.
3. GARANTÍA: si las bases exigen una garantía mínima del producto (plazo, cobertura) y el texto libre de la cotización la menciona, compara que cumpla — si no la menciona, dilo como algo a confirmar con el proveedor, no lo des por hecho.
4. PLAZO DE ENTREGA DEL PROVEEDOR (plazoEntregaTexto) contra el plazo que NOSOTROS le prometimos AL CLIENTE — que deje margen real, no solo que "exista". El plazo comprometido con el cliente normalmente YA está fijado en el "ESTADO ACTUAL DEL RESTO DEL NEGOCIO" (sección Tareas → reloj de entrega) — úsalo de ahí como fuente principal, no lo re-adivines de un documento si ya está ahí.
5. FLETE/DESPACHO: coherencia interna entre "incluyeFlete" y lo que describe el texto libre de la cotización (ej. si el texto dice que retiramos nosotros pero el campo dice "incluye flete", es una contradicción real). OJO: "incluyeFlete=no" junto con "fleteMonto=0" NO es una inconsistencia — es exactamente cómo se registra "lo retiramos nosotros y no tiene costo", una opción válida y deliberada del formulario. Nunca sugieras que "debería haber un costo asociado" en ese caso.
6. PRECIO Y DESCUENTO: NUNCA los compares contra el precio de venta al cliente (ver regla de abajo) — pero SÍ revisa que el cálculo bruto→descuento→neto sea consistente si el texto libre menciona ambos números.

DOS FUENTES DISTINTAS — no las mezcles al citar:
- "DOCUMENTOS DEL PROYECTO" (bases, anexos, acta) → usa "documento"/"citaTextual" (ver reglas de CITAS abajo), y esa cita se verifica por código.
- "ESTADO ACTUAL DEL RESTO DEL NEGOCIO" (Tareas, Costeo, Aprobación/SKU, Compra/Logística, Entrega) → es dato YA CARGADO en el sistema, no un documento — cuando lo uses, dilo en el propio "mensaje" (ej. "según el reloj de entrega ya fijado en Tareas, el plazo comprometido es de 5 días corridos") y deja "documento"/"citaTextual" vacíos — no inventes un nombre de archivo para un dato que no viene de un PDF.

CITAS (pedido explícito, 15-sep-2026 — "para ver de dónde sacó esa información... que no falle y sea exacto"): cuando la alerta/sugerencia SÍ se basa en un documento, trae "documento" y "citaTextual". Esa cita se va a verificar por CÓDIGO (no por otra IA) haciendo una búsqueda de texto literal contra el documento real — si no calza exacto, se marca "sin verificar" en pantalla. Por eso:
- "documento" debe ser EXACTAMENTE uno de los nombres de archivo que aparecen en los marcadores [[DOCUMENTO: nombre — categoría]] del contexto — nunca el nombre de un anexo, artículo o sección DENTRO de un documento (ej. "Anexo N°4" casi siempre es una SECCIÓN dentro de "Bases_Administrativas....pdf" o de un PDF de anexos, no un archivo propio — si no estás seguro de en qué archivo está, usa el nombre del archivo completo donde de verdad aparece el texto).
- "citaTextual" tiene que ser una copia CARÁCTER POR CARÁCTER de 8 a 25 palabras SEGUIDAS del documento — no reordenes palabras, no resumas números ("18 meses" tiene que aparecer tal cual si así está escrito, no "garantía mayor o igual a 18 meses" si el documento dice otra cosa), no le agregues ni le quites nada. Ejemplo de cita VÁLIDA (si el documento dice exactamente esto en algún lugar): "Garantía mínima de 18 meses contados desde la recepción conforme". Ejemplo de cita INVÁLIDA (paráfrasis, aunque diga lo mismo): "el producto debe tener garantía de a lo menos año y medio".
- Si no puedes copiar un fragmento exacto que sostenga la afirmación, es mejor dejar "citaTextual" vacía que inventar o parafrasear algo que no vas a poder sostener.
- Una alerta que nace de una contradicción INTERNA del propio borrador, o de un dato del "ESTADO ACTUAL DEL RESTO DEL NEGOCIO" (no de un documento puntual), deja "documento"/"citaTextual" vacíos.

Reglas estrictas:
- NUNCA inventes un dato que no esté en los documentos. Si algo no aparece, dilo explícito en vez de asumir.
- NUNCA generes una alerta comparando el precio, el proveedor, o el plazo de venta al CLIENTE contra el precio/proveedor/plazo del borrador de COMPRA — son dos cosas distintas por diseño, no un error.
- Si un campo del borrador está vacío pero se puede inferir con certeza desde el propio contexto de la compra (nunca desde el precio o identidad de venta), sugiérelo citando de dónde sale.
- El "campo" de cada alerta/sugerencia debe ser EXACTAMENTE una de estas claves: proveedorNombre, precioUnitario, descuentoPct, incluyeFlete, fleteMonto, plazoEntregaTexto — o "general" para una alerta que no apunta a un campo puntual.
- Recorre LOS 6 PUNTOS de arriba — si un punto no tiene nada que decir (todo calza o no hay información suficiente para evaluarlo), no generes una alerta vacía por ese punto, simplemente pasa al siguiente. No es necesario forzar una alerta por cada punto.
- Sé conciso en cada alerta individual, pero no sacrifiques cobertura por brevedad: es mejor una lista más larga con hallazgos reales de los 6 puntos que una corta que se quedó solo en flete y plazo.
- NUNCA repitas la misma sugerencia (mismo campo + mismo valor) más de una vez, aunque varios documentos la respalden — elige la cita más clara y genera UNA sola sugerencia por campo. Varias tarjetas idénticas con el mismo botón confunden más de lo que ayudan.
- Responde SOLO en el idioma español de Chile.`;

/** Llama a Gemini con el borrador + el contexto documental y devuelve alertas/sugerencias
 *  estructuradas. No escribe nada — el llamador decide si aplica una sugerencia. */
export async function auditarBorradorConAgente(
  negocioId: number, borrador: BorradorCotizacion,
): Promise<ResultadoAuditoriaAgente> {
  if (!GEMINI_API_KEY) throw new Error('GEMINI_API_KEY no configurada — el agente de documentos no está disponible.');

  // Tope diario (pedido explícito, 14-sep-2026) — se corta ANTES de leer/llamar a Gemini, para no
  // gastar nada del cupo del día siguiente ni de créditos si ya se llegó al límite de hoy.
  const usoAntes = await usoDiarioAgente();
  if (usoAntes.agotado) {
    throw new Error(`Se alcanzó el tope de revisiones con IA de hoy (${usoAntes.tope}). Vuelve a intentar mañana, o ajusta AGENTE_COMPRAS_TOPE_DIARIO si hace falta subirlo.`);
  }

  const [{ texto: contexto, documentos, fuentes, porDocumento }, resumenNegocio] = await Promise.all([
    contextoDocumentosCompras(negocioId),
    // Pedido explícito del usuario (15-sep-2026: "los días... eso lo pongo en Tareas, debería de
    // poder tomarlo de ahí... todo el campo de información que está en el módulo de compra se
    // debería poder leer entre ellas") — antes esta auditoría SOLO veía los documentos (PDF/anexos),
    // nunca los datos que YA están cargados en el resto de Compras (ej. el plazo comprometido con
    // el cliente vive en el reloj de entrega de Tareas, no hay que re-adivinarlo de un PDF cada
    // vez). Se reusa el mismo resumen de las 5 pestañas que arma auditarNegocioCompleto — visto
    // como dato del SISTEMA (no como cita de documento: no necesita citaTextual/verificación).
    resumenNegocioParaAuditoria(negocioId).catch(() => '(no se pudo leer el resto del negocio)'),
  ]);
  if (!contexto && !resumenNegocio) {
    return { encontroDocumentos: false, documentosLeidos: [], fuentes: [], alertas: [], sugerencias: [], resumen: 'No hay documentos ni datos del negocio cargados todavía — sube al menos uno para que el agente pueda revisar.', usoHoy: usoAntes };
  }

  const userPrompt = `DOCUMENTOS DEL PROYECTO:\n${contexto || '(sin documentos cargados todavía)'}\n\n---\n\nESTADO ACTUAL DEL RESTO DEL NEGOCIO (Tareas, Costeo, Aprobación/SKU, Compra/Logística, Entrega — datos YA cargados en el sistema, no hace falta re-adivinarlos de un documento):\n${resumenNegocio}\n\n---\n\nBORRADOR DE COTIZACIÓN QUE SE ESTÁ LLENANDO:\n` +
    `Producto que se busca comprar: ${borrador.productoDescripcion ?? '(no especificado)'}\n` +
    `Qué cotizó el proveedor (texto libre, tal como lo escribió el comprador): ${borrador.descripcionLibre?.trim() || '(vacío)'}\n` +
    `Cantidad cotizada: ${borrador.cantidad ?? '(vacío)'}\n` +
    `Proveedor: ${borrador.proveedorNombre || '(vacío)'}\n` +
    `Precio unitario: ${borrador.precioUnitario ?? '(vacío)'}\n` +
    `Descuento %: ${borrador.descuentoPct ?? '(vacío)'}\n` +
    `Incluye flete: ${borrador.incluyeFlete == null ? '(vacío)' : (borrador.incluyeFlete ? 'sí' : 'no')}\n` +
    `Monto de flete: ${borrador.fleteMonto ?? '(vacío)'}\n` +
    `Plazo de entrega: ${borrador.plazoEntregaTexto || '(vacío)'}\n\n` +
    `Revisa este borrador contra los documentos Y contra el estado del negocio — recorre los 6 puntos de la auditoría completa — y responde con el JSON pedido.`;

  const body = JSON.stringify({
    systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
    contents: [{ parts: [{ text: userPrompt }] }],
    generationConfig: {
      // BUG REAL #1 (15-sep-2026, reportado en vivo: "el agente devolvió una respuesta no
      // interpretable"): esta llamada no limitaba el "thinking" de Gemini 2.5 Flash — a diferencia
      // de extraerTextoPdf() más arriba. Medido: una corrida gastó 3164 tokens de pensamiento
      // INVISIBLE antes de escribir la respuesta, compitiendo por el mismo presupuesto de
      // maxOutputTokens (4000) — con más alertas que evaluar, el JSON de salida se corta a medio
      // camino y JSON.parse revienta.
      // BUG REAL #2 (mismo día, visto al probar el fix de arriba con thinkingBudget:0): sin nada de
      // razonamiento, el modelo volvía a confundir venta con compra (mismo error que ya se había
      // corregido en el prompt) — el caso es genuinamente sutil y necesita algo de "pensar antes de
      // responder", no cero. thinkingBudget:2048 deja margen para razonar sin arriesgar el
      // presupuesto total (maxOutputTokens:8000 cubre thinking + JSON de sobra).
      // 15-sep-2026: el prompt ahora pide recorrer 6 puntos de auditoría (antes eran ~3) — más
      // margen de pensamiento y de salida para que una respuesta más completa no vuelva a
      // truncarse (mismo bug del BUG REAL #1, ahora con más contenido que generar).
      temperature: 0.1, maxOutputTokens: 12_000, thinkingConfig: { thinkingBudget: 3072 },
      responseMimeType: 'application/json', responseSchema: ESQUEMA_RESPUESTA,
    },
  });

  const res = await fetch(`${GEMINI_BASE}/v1beta/models/${MODELO_AUDITORIA}:generateContent?key=${GEMINI_API_KEY}`,
    { method: 'POST', headers: { 'Content-Type': 'application/json' }, body, signal: AbortSignal.timeout(60_000) });
  if (!res.ok) throw new Error(`Gemini (auditoría) ${res.status}: ${(await res.text().catch(() => '')).slice(0, 300)}`);
  const data = await res.json();
  const raw = String(data.candidates?.[0]?.content?.parts?.[0]?.text ?? '{}');
  let parsed: any;
  try { parsed = JSON.parse(raw); } catch {
    const finishReason = data.candidates?.[0]?.finishReason;
    console.error(`[agente-compras] JSON no interpretable — finishReason=${finishReason}, largo=${raw.length}, cola="${raw.slice(-200)}"`);
    throw new Error('El agente devolvió una respuesta no interpretable — intenta de nuevo.');
  }

  // Solo se cuenta contra el tope UNA VEZ que Gemini respondió bien — un fallo de red o un JSON
  // roto no debe gastar cupo del día.
  await registrarUsoAgente();
  const usoDespues = await usoDiarioAgente();

  // Verificación determinística de citas (no otro modelo de IA "revisando" — substring-match
  // contra el texto real de cada documento, ver verificarCita más arriba).
  const alertas: AlertaAgente[] = (Array.isArray(parsed.alertas) ? parsed.alertas : []).map((a: any) => ({
    campo: String(a.campo || 'general'), mensaje: String(a.mensaje || ''), gravedad: a.gravedad === 'critico' || a.gravedad === 'aviso' ? a.gravedad : 'info',
    documento: a.documento || null, citaTextual: a.citaTextual || null,
    citaVerificada: verificarCita(a.documento, a.citaTextual, porDocumento),
  }));
  const sugerenciasCrudas: SugerenciaAgente[] = (Array.isArray(parsed.sugerencias) ? parsed.sugerencias : []).map((s: any) => ({
    campo: String(s.campo || ''), valor: String(s.valor ?? ''), razon: String(s.razon || ''),
    documento: s.documento || null, citaTextual: s.citaTextual || null,
    citaVerificada: verificarCita(s.documento, s.citaTextual, porDocumento),
  }));
  // Deduplicar por (campo + valor) — pedido explícito, 15-sep-2026: "no me deja poner los días de
  // entrega" resultó ser 4 sugerencias IDÉNTICAS ("→ 5 días corridos") apiladas, cada una con su
  // propio botón "Usar" — la persona no sabía cuál apretar ni si ya lo había hecho. Se queda con la
  // PRIMERA de cada grupo (la que Gemini escribió primero, normalmente la de mejor cita).
  const vistos = new Set<string>();
  const sugerencias = sugerenciasCrudas.filter(s => {
    const clave = `${s.campo}::${s.valor}`;
    if (vistos.has(clave)) return false;
    vistos.add(clave);
    return true;
  });

  return {
    encontroDocumentos: true, documentosLeidos: documentos, fuentes,
    resumen: String(parsed.resumen || ''),
    alertas, sugerencias,
    usoHoy: usoDespues,
  };
}

// ═══════════════════════════════════════════════════════════════════════════════════════════
// AUDITORÍA DE NEGOCIO COMPLETO (pedido explícito, 15-sep-2026: "tiene que leer todos estos
// documentos la IA para poder ver todo el área de compras desde tareas a entrega y cierre... sería
// tareas, costeo y auditoría, aprobación y sku, compra importación y logística, entrega y cierre").
// A diferencia de auditarBorradorConAgente (que audita UN formulario de cotización a medio
// llenar), esto revisa TODO lo que ya hay cargado en las 5 pestañas de un negocio contra los
// documentos reales, de una sola pasada — mismo motor de citas/verificación de abajo.
// ═══════════════════════════════════════════════════════════════════════════════════════════

const fmtM = (n: number | null | undefined) => n == null ? '(sin dato)' : new Intl.NumberFormat('es-CL', { style: 'currency', currency: 'CLP', maximumFractionDigits: 0 }).format(n);

/** Junta lo cargado en las 5 pestañas de Compras para un negocio, en texto compacto — reusa las
 *  funciones que YA arman cada pestaña (no duplica ninguna consulta). Pensado para leerse rápido,
 *  no para ser un volcado completo de cada tabla: se seleccionan los campos que de verdad importan
 *  para auditar (estados, montos, fechas, quién hizo qué), no cada columna de cada fila. */
async function resumenNegocioParaAuditoria(negocioId: number): Promise<string> {
  const [
    tareas, reloj, cotizaciones, escenarios, escenarioElegido, aprobaciones, presupuesto, margen, skus,
    proveedoresOC, ordenesOC, reparto, respaldosHito, modalidadRetiro, gastos, resumenGto, entrega, postventa, incidencias, fracaso,
  ] = await Promise.all([
    listarTareas(negocioId), obtenerEstadoReloj(negocioId).catch(() => null),
    listarCotizaciones(negocioId), calcularEscenarios(negocioId), obtenerEscenarioElegido(negocioId),
    obtenerAprobaciones(negocioId), calcularPresupuestoCompra(negocioId).catch(() => null), calcularMargenPrevisto(negocioId).catch(() => null),
    listarSkus(negocioId),
    proveedoresParaOrdenCompra(negocioId).catch(() => []), ordenesCompraParaVista(negocioId).catch(() => []),
    obtenerReparto(negocioId).catch(() => null), listarRespaldosHito(negocioId).catch(() => []),
    obtenerModalidadRetiro(negocioId).catch(() => null), listarGastos(negocioId).catch(() => []), resumenGastos(negocioId).catch(() => null),
    obtenerEntrega(negocioId).catch(() => null), listarPostventa(negocioId).catch(() => new Map()),
    listarIncidencias(negocioId).catch(() => []), obtenerFracaso(negocioId).catch(() => null),
  ]);

  const partes: string[] = [];

  partes.push(`## TAREAS (§5 — checklist de validación y plazos administrativos)\n` +
    (tareas.length === 0 ? '(sin tareas cargadas)' : tareas.map(t =>
      `- [${t.estado}]${t.vencida ? ' VENCIDA' : ''} ${t.titulo}` +
      (t.registro ? ` — respuestas: ${Object.entries(t.registro).map(([k, v]) => `${k}=${v}`).join(', ')}` : '') +
      (t.hallazgo ? ' — ⚠ marcado con HALLAZGO (algo no salió como se esperaba)' : '')
    ).join('\n')));
  if (reloj) partes.push(`\nReloj de entrega: plazo hasta ${reloj.fechaLimiteVigente ?? reloj.fechaLimite ?? '(sin fijar)'}, ${reloj.diasRestantes ?? '?'} días restantes${reloj.prorroga ? ' (con prórroga)' : ''}.`);

  partes.push(`\n## COSTEO Y AUDITORÍA (§8 — cotizaciones y escenarios)\n` +
    `Cotizaciones registradas: ${cotizaciones.length === 0 ? '(ninguna)' : cotizaciones.map(c =>
      `${c.proveedorNombre} (${fmtM(c.precioUnitarioClp ?? c.precioUnitario)}/u, flete=${c.incluyeFlete == null ? '?' : c.incluyeFlete ? 'incluido' : `no incluido${c.fleteMonto != null ? ` (${fmtM(c.fleteMonto)})` : ' (sin monto)'}`}, plazo="${c.plazoEntregaTexto || '?'}")`
    ).join('; ')}\n` +
    `Escenario elegido: ${escenarioElegido ? `${escenarioElegido.tipo}, ${fmtM(Number(escenarioElegido.costo_total))}${escenarioElegido.elegido_justificacion ? ` — justificación: "${escenarioElegido.elegido_justificacion}"` : ''}` : '(ninguno elegido todavía)'}` +
    (escenarios.find(e => e.fleteSinConfirmar) ? '\n⚠ Hay un escenario con flete de retiro SIN CONFIRMAR (nadie escribió el monto real).' : ''));

  partes.push(`\n## APROBACIÓN Y SKU (§7/§10)\n` +
    `Compuerta 1 (compra): ${aprobaciones.compra?.estado ?? 'PENDIENTE'}${aprobaciones.compra?.motivo ? ` — "${aprobaciones.compra.motivo}"` : ''}\n` +
    `Compuerta 2 (margen): ${aprobaciones.margen?.estado ?? 'PENDIENTE'}\n` +
    (presupuesto ? `Presupuesto costeado (mercadería): ${fmtM(presupuesto.presupuestoOriginal)} · Comprando: ${fmtM(presupuesto.costoEscenario)}${presupuesto.excede ? ` — ${presupuesto.excedePct}% SOBRE presupuesto` : ''}${presupuesto.costoFlete ? ` · flete aparte: ${fmtM(presupuesto.costoFlete)}` : ''}\n` : '') +
    (margen ? `Margen previsto: ${margen.margenPct != null ? margen.margenPct + '%' : '(sin calcular)'}\n` : '') +
    `SKU: ${skus.length === 0 ? '(sin SKU creado todavía)' : skus.map(s => `${s.skuPropio}${s.verificadoObuma ? ' (verificado en Obuma)' : ' (SIN verificar en Obuma)'}`).join(', ')}`);

  partes.push(`\n## COMPRA, IMPORTACIÓN Y LOGÍSTICA (§11/§12/§13)\n` +
    `Órdenes de compra: ${ordenesOC.length === 0 ? '(ninguna creada todavía)' : ordenesOC.map(o => `${o.proveedorNombre} folio ${o.folio ?? o.obumaCompraOcId ?? '?'} — ${fmtM(o.total)}${o.origen === 'OBUMA_MANUAL' ? ' (registrada a mano, no vía Licitank)' : ''}`).join('; ')}\n` +
    `Proveedores pendientes de OC: ${proveedoresOC.filter(p => !p.yaCreada).map(p => p.proveedorNombre).join(', ') || '(ninguno)'}${proveedoresOC.some(p => p.posibleDuplicadoObuma) ? ' — ⚠ posible OC duplicada detectada' : ''}\n` +
    `Modalidad de retiro: ${modalidadRetiro?.modalidad ?? '(sin definir)'}\n` +
    `Proceso administrativo (§11, hitos de Obuma): ` + (reparto ? [
      ['ocEmitida', 'OC emitida', reparto.ocEmitidaAt], ['pagoRegistrado', 'Pago registrado', reparto.pagoRegistradoAt],
      ['anticipoPagado', 'Anticipo pagado', reparto.anticipoPagadoAt], ['facturaCompraRegistrada', 'Factura registrada', reparto.facturaCompraRegistradaAt],
      ['carpetaProyectoCreada', 'Carpeta creada', reparto.carpetaProyectoCreadaAt], ['provisionFondos', 'Provisión de fondos', reparto.provisionFondosAt],
    ].map(([clave, label, at]) => {
      const resp = respaldosHito.find(r => r.hito === clave);
      const estado = at ? 'hecho' : resp?.estado === 'NO_APLICA' ? `no aplica (${resp.nota})` : 'pendiente';
      // Monto de la OC (15-sep-2026, pedido explícito: "creo que nunca me pidió el valor de la
      // OC") — si está registrado a mano (fuera de la integración real con Obuma), este es el
      // ÚNICO lugar donde puede existir el monto; sin esto el agente veía $0 en "Órdenes de
      // compra" (la consulta en vivo a Obuma suele fallar por cuota) y lo marcaba como error,
      // cuando en realidad nadie le había pedido el dato a la persona hasta ahora.
      // Neto y con IVA (pedido explícito, 15-sep-2026: "tienes que hacer la conversión a con IVA
      // para que tengamos todo eso visible") — se guarda solo el neto (mismo criterio que el resto
      // del proyecto), el con IVA se calcula acá con el mismo factor 1.19 que usa costeo-comparativo.ts.
      const conMonto = clave === 'ocEmitida' && at
        ? ` (monto registrado: ${reparto.ocMonto != null ? `${fmtM(reparto.ocMonto)} neto (${fmtM(Math.round(reparto.ocMonto * 1.19))} c/IVA)` : 'no capturado — opcional, no es necesariamente un error'})`
        : '';
      return `${label}: ${estado}${conMonto}`;
    }).join(', ') : '(sin datos)') +
    `\nGastos reales registrados: ${gastos.length === 0 ? '(ninguno)' : `${fmtM(resumenGto?.total ?? null)} total — ${gastos.map(g => `${g.categoriaEtiqueta || g.descripcion}: ${fmtM(g.monto)}`).join(', ')}`}`);

  partes.push(`\n## ENTREGA Y CIERRE\n` +
    (entrega ? `Modalidad: ${entrega.modalidad ?? '(sin definir)'} · Verificación: ${entrega.verificacionAt ? (entrega.actaConformidad === 'CONFORME' ? 'conforme' : 'NO conforme') : '(sin verificar)'} · Acta: ${entrega.actaGeneradaAt ? (entrega.actaAprobadaAt ? 'aprobada' : 'generada, sin aprobar') : '(sin generar)'} · Cerrada: ${entrega.cerradaAt ? 'sí' : 'no'}` : '(sin datos de entrega)') +
    `\nIncidencias: ${incidencias.length === 0 ? '(ninguna)' : incidencias.map(i => `[${i.estado}] ${i.tituloTipo || i.tipoLibre || i.tipoClave} (${i.naturaleza})`).join(', ')}` +
    (fracaso ? `\n⚠ FRACASO DECLARADO: "${fracaso.motivoDeclarado}"${fracaso.dictamenJefeVentas ? ` — dictamen: "${fracaso.dictamenJefeVentas}"` : ' (sin dictamen del jefe de ventas todavía)'}` : ''));

  return partes.join('\n');
}

const SYSTEM_PROMPT_NEGOCIO = `Eres el agente auditor del negocio completo de Compras de nuestra empresa. A diferencia de una auditoría de un solo formulario, acá revisas TODO lo que ya está cargado en las 5 etapas del negocio (Tareas, Costeo y Auditoría, Aprobación y SKU, Compra/Importación/Logística, Entrega y Cierre) contra los documentos REALES del proyecto (bases, anexos, acta).

MISMA REGLA CRÍTICA que en la auditoría de cotizaciones — no confundas VENTA (lo que nuestra empresa, el adjudicatario, le vendió al cliente — precio, plazo, garantía comprometidos, ya fijados) con COMPRA (lo que Compras cotiza/compra a un PROVEEDOR EXTERNO para cumplir esa venta — su propio costo, plazo y condiciones, normalmente distintos por diseño, nunca un error en sí mismo).

Busca specíficamente estos tipos de problema, de punta a punta:
1. CONTRADICCIONES entre lo que se prometió al cliente (bases/anexos/acta) y lo que se está ejecutando internamente (garantía, plazo, especificaciones técnicas, cantidad).
2. INCONSISTENCIAS de secuencia o de datos entre pestañas — ej. una OC ya creada pero la Compuerta 1 sigue pendiente; un escenario elegido con flete sin confirmar de verdad; un SKU sin verificar en Obuma pero ya con orden de compra; una tarea marcada con "hallazgo" que nadie resolvió después.
DOS MATICES CONFIRMADOS POR EL USUARIO (15-sep-2026, no los repitas como error):
- Un gasto real (ej. flete/transporte) que aparece por fuera del escenario ($0 o sin confirmar) NO es una contradicción a "aclarar con urgencia" — es exactamente el costo interno real de un retiro propio (bencina, peaje, etc.), un gasto adicional normal de la licitación. Menciónalo como informativo/reconciliación si aporta, nunca como "inconsistencia grave" ni pidas "corrección inmediata".
- El monto de una OC registrada a mano puede venir vacío/$0 legítimamente — es un campo OPCIONAL del checklist, no todos lo cargan. Solo márcalo como problema si hay evidencia de que el monto real es OTRO (ej. no calza con lo que sí se sabe del escenario) — la sola ausencia del dato no es un error por sí misma.
3. HITOS o PLAZOS vencidos o en riesgo — reloj de entrega, plazos administrativos, incidencias abiertas hace tiempo. OJO con la DIRECCIÓN del desfase cuando compares una fecha calculada (inicio + plazo) contra la fecha que el sistema tiene fijada: si la fecha fijada es MÁS TEMPRANA que la calculada (entregar antes de lo que exige el plazo), eso NO es un riesgo — es margen a favor, y como mucho merece "info", nunca "aviso"/"critico". Solo es un riesgo real si la fecha fijada es MÁS TARDÍA que la calculada (entregaríamos después de lo comprometido).
4. Cosas que YA se revisaron bien y no necesitan alerta — no generes ruido confirmando lo que está correcto, salvo que sea relevante para el resumen general.

PLAZO DE ENTREGA OFERTADO AL CLIENTE (pedido explícito del usuario, 15-sep-2026) — CAMPO OBLIGATORIO, siempre inténtalo, nunca lo omitas de la respuesta: además de las alertas, completa "plazoEntregaDetectado" — el plazo de entrega que NUESTRA empresa comprometió con el cliente, buscando en ESTE ORDEN de preferencia:
  1. El Anexo/Formulario de Oferta Económica o Plazo de Entrega que YA RELLENAMOS y enviamos con la propuesta (puede aparecer como "ANEXOS_OFERENTE" o como documento propio) — ojo, el MISMO formulario puede existir DOS VECES: una plantilla EN BLANCO (celdas vacías, guiones bajos "____", o solo la etiqueta del campo sin valor) y otra YA RELLENA (con un número concreto, ej. "30 días hábiles"). Usa siempre la versión RELLENA con el dato real; ignora la plantilla en blanco aunque tenga el mismo nombre de archivo.
  2. Si ningún documento propio tiene el dato relleno, el plazo ofertable/máximo que exigen las BASES (bases administrativas o técnicas) — pero en ese caso deja claro en "texto" que es el tope de las bases, no lo que nosotros ofertamos (ej. "15 días hábiles (tope de las bases, no encontramos el plazo que ofertamos)").
Si ninguno de los dos aparece con un valor concreto en los documentos, devuelve "plazoEntregaDetectado" con "texto" y "dias" en null (pero SIGUE incluyendo el campo, no lo borres de la respuesta) — nunca inventes un número.
"dias" es el número de días tal como aparece en el texto (si dice "hábiles" o "corridos" igual va el número crudo, sin convertir). "documento" y "citaTextual" son OBLIGATORIOS si "texto"/"dias" no son null — misma regla de citas verificadas que el resto: "citaTextual" copiada LITERAL (8-25 palabras) del documento con el valor RELLENO, nunca parafraseada ni copiada de la plantilla en blanco.

DOS ERRORES QUE NO DEBES COMETER (pedido explícito del usuario, 15-sep-2026, tras verlos en vivo):
- "No incluye flete" con "Monto de flete = 0" NO es una inconsistencia — es exactamente cómo se registra "lo retiramos nosotros y no tiene costo" (una de las 3 opciones reales del formulario). NUNCA la marques como contradicción ni sugieras que "debería haber un costo asociado" — eso ya está resuelto por diseño.
- "Cantidad" NO es un campo del formulario de cotización — vive aparte, en "Asignar productos" (por producto, no por cotización). Si falta, dilo así: "la cantidad del producto no está asignada — revísalo en 'Asignar productos'", nunca insinúes que hay un campo de cantidad en la cotización esperando llenarse, porque no existe.

FORMATO DE CADA ALERTA — esta auditoría es de SOLO LECTURA, no hay un botón para "aplicar" nada acá (a diferencia de la auditoría de una sola cotización, que si tiene sugerencias con botón). Por eso:
- NUNCA termines una alerta con "→ valor sugerido" como si fuera algo clickeable — acá no lo es, y confunde a quien lo lee pensando que puede apretar algo que no existe.
- En vez de eso, escribe la alerta como una observación completa que además diga EXACTAMENTE dónde ir a corregirlo: la pestaña/pantalla concreta (ej. "corrígelo en la pestaña Costeo y Auditoría, editando la cotización de TROTEC" o "revísalo en Aprobación y SKU").

Reglas estrictas (idénticas a la auditoría de cotización):
- NUNCA inventes un dato. Si algo no aparece en el resumen del negocio ni en los documentos, dilo explícito.
- Cada alerta trae "area" (una de: tareas, costeo, aprobacion, compra, entrega, general), "documento" y "citaTextual" cuando la alerta se basa en un documento — "documento" tiene que ser el nombre EXACTO del archivo (nunca el nombre de una sección/anexo interno), "citaTextual" una copia LITERAL de 8-25 palabras, nunca parafraseada — se verifica por código, así que mejor vacía que inventada. Si la alerta nace de datos internos del negocio (no de un documento), deja documento/citaTextual vacíos.
- No hay "sugerencias" de campo puntual en esta auditoría (no hay un formulario que rellenar) — deja el array de sugerencias vacío, todo va en "alertas".
- Sé conciso por alerta, pero cubre las 5 áreas si hay algo real que decir en cada una.
- Responde SOLO en español de Chile.`;

const ESQUEMA_RESPUESTA_NEGOCIO = {
  type: 'OBJECT',
  properties: {
    resumen: { type: 'STRING', description: 'Tres o cuatro frases: estado general del negocio y los hallazgos más importantes.' },
    alertas: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          area: { type: 'STRING', enum: ['tareas', 'costeo', 'aprobacion', 'compra', 'entrega', 'general'] },
          mensaje: { type: 'STRING' },
          gravedad: { type: 'STRING', enum: ['info', 'aviso', 'critico'] },
          documento: { type: 'STRING' },
          citaTextual: { type: 'STRING' },
        },
        required: ['area', 'mensaje', 'gravedad'],
      },
    },
    plazoEntregaDetectado: {
      type: 'OBJECT',
      properties: {
        texto: { type: 'STRING', description: 'El plazo tal como aparece en el documento, ej. "15 días hábiles" o "15 días hábiles (tope de las bases, no encontramos el plazo que ofertamos)".' },
        dias: { type: 'INTEGER', description: 'El número de días tal como aparece, sin convertir hábiles/corridos.' },
        documento: { type: 'STRING', description: 'Nombre EXACTO del archivo de donde se sacó — obligatorio si texto/dias no son null.' },
        citaTextual: { type: 'STRING', description: 'Copia literal de 8-25 palabras del documento — obligatoria si texto/dias no son null.' },
      },
    },
  },
  required: ['resumen', 'alertas', 'plazoEntregaDetectado'],
};

// Plazo de entrega ofertado al cliente, detectado leyendo los documentos reales del negocio
// (pedido explícito, 15-sep-2026) — mientras el Auditor Técnico no tenga cargado el plazo
// comprometido, esto reemplaza el texto de relleno "tope de las bases" del Resumen Ejecutivo.
export interface PlazoEntregaDetectado {
  texto: string; dias: number | null; documento: string | null; citaTextual: string | null; citaVerificada: boolean;
}

export interface ResultadoAuditoriaNegocio {
  encontroDatos: boolean; documentosLeidos: string[]; fuentes: FuenteDocumento[];
  resumen: string; alertas: AlertaAgente[]; usoHoy: UsoDiarioAgente; creadoAt?: string;
  plazoEntregaDetectado: PlazoEntregaDetectado | null;
}

// Persistencia de la ÚLTIMA auditoría (pedido explícito, 15-sep-2026: "no lo pasamos a la base de
// datos que es lo que podemos hacer" — no puede ser tiempo real de verdad por el costo/tope, pero
// el último resultado REAL sí se guarda, para que la pantalla lo muestre sin gastar una revisión
// nueva y para que todos vean el mismo estado). UNA fila por negocio, la auditoría nueva reemplaza
// a la anterior — no se guarda historial, no hace falta para este uso.
export async function ultimaAuditoriaNegocio(negocioId: number): Promise<ResultadoAuditoriaNegocio | null> {
  const [rows] = await pool.query(
    `SELECT resumen, alertas_json, fuentes_json, documentos_leidos_json, plazo_entrega_json, creado_at
       FROM compras_agente_auditoria_negocio WHERE negocio_id = ?`,
    [negocioId],
  ) as any;
  const r = (rows as any[])[0];
  if (!r) return null;
  const usoHoy = await usoDiarioAgente();
  try {
    return {
      encontroDatos: true, resumen: r.resumen, alertas: JSON.parse(r.alertas_json), fuentes: JSON.parse(r.fuentes_json),
      documentosLeidos: JSON.parse(r.documentos_leidos_json), usoHoy, creadoAt: r.creado_at,
      plazoEntregaDetectado: r.plazo_entrega_json ? JSON.parse(r.plazo_entrega_json) : null,
    };
  } catch { return null; }
}

/** El plazo detectado de la ÚLTIMA auditoría guardada, sin tocar el resto del resultado — lo usa
 *  el Resumen Ejecutivo de Compras (construirResumenEjecutivoCompras) para no gastar una revisión
 *  nueva solo por armar el resumen. */
export async function plazoEntregaDetectadoNegocio(negocioId: number): Promise<PlazoEntregaDetectado | null> {
  const [rows] = await pool.query(
    `SELECT plazo_entrega_json FROM compras_agente_auditoria_negocio WHERE negocio_id = ?`,
    [negocioId],
  ) as any;
  const raw = (rows as any[])[0]?.plazo_entrega_json;
  if (!raw) return null;
  try { return JSON.parse(raw); } catch { return null; }
}

async function guardarAuditoriaNegocio(negocioId: number, resultado: ResultadoAuditoriaNegocio): Promise<void> {
  await pool.query(
    `INSERT INTO compras_agente_auditoria_negocio (negocio_id, resumen, alertas_json, fuentes_json, documentos_leidos_json, plazo_entrega_json, creado_at)
     VALUES (?, ?, ?, ?, ?, ?, NOW())
     ON DUPLICATE KEY UPDATE resumen = VALUES(resumen), alertas_json = VALUES(alertas_json),
       fuentes_json = VALUES(fuentes_json), documentos_leidos_json = VALUES(documentos_leidos_json),
       plazo_entrega_json = VALUES(plazo_entrega_json), creado_at = NOW()`,
    [negocioId, resultado.resumen, JSON.stringify(resultado.alertas), JSON.stringify(resultado.fuentes),
     JSON.stringify(resultado.documentosLeidos), resultado.plazoEntregaDetectado ? JSON.stringify(resultado.plazoEntregaDetectado) : null],
  );
}

/** Auditoría de punta a punta de UN negocio — lee documentos + resumen de las 5 pestañas, y pide
 *  a Gemini un solo informe con alertas por área. Mismo motor de citas verificadas que
 *  auditarBorradorConAgente (verificarCita). Cuenta como UNA llamada contra el tope diario.
 *  Guarda el resultado (ultimaAuditoriaNegocio lo recupera sin gastar una revisión nueva). */
export async function auditarNegocioCompleto(negocioId: number): Promise<ResultadoAuditoriaNegocio> {
  if (!GEMINI_API_KEY) throw new Error('GEMINI_API_KEY no configurada — el agente de documentos no está disponible.');

  const usoAntes = await usoDiarioAgente();
  if (usoAntes.agotado) {
    throw new Error(`Se alcanzó el tope de revisiones con IA de hoy (${usoAntes.tope}). Vuelve a intentar mañana, o ajusta AGENTE_COMPRAS_TOPE_DIARIO si hace falta subirlo.`);
  }

  const [{ texto: contexto, documentos, fuentes, porDocumento }, resumenNegocio] = await Promise.all([
    contextoDocumentosCompras(negocioId),
    resumenNegocioParaAuditoria(negocioId),
  ]);

  const userPrompt = `DOCUMENTOS DEL PROYECTO:\n${contexto || '(sin documentos cargados todavía)'}\n\n---\n\nESTADO ACTUAL DEL NEGOCIO (las 5 pestañas de Compras):\n${resumenNegocio}\n\n---\n\nAuditá este negocio de punta a punta contra los documentos y responde con el JSON pedido.`;

  const body = JSON.stringify({
    systemInstruction: { parts: [{ text: SYSTEM_PROMPT_NEGOCIO }] },
    contents: [{ parts: [{ text: userPrompt }] }],
    generationConfig: {
      // Más contexto que la auditoría de un solo formulario (5 pestañas + documentos) — mismo
      // criterio de presupuesto que auditarBorradorConAgente (thinkingBudget no-cero para no
      // repetir el bug de venta/compra, maxOutputTokens generoso para no truncar el JSON).
      temperature: 0.1, maxOutputTokens: 16_000, thinkingConfig: { thinkingBudget: 4096 },
      responseMimeType: 'application/json', responseSchema: ESQUEMA_RESPUESTA_NEGOCIO,
    },
  });

  const res = await fetch(`${GEMINI_BASE}/v1beta/models/${MODELO_AUDITORIA}:generateContent?key=${GEMINI_API_KEY}`,
    { method: 'POST', headers: { 'Content-Type': 'application/json' }, body, signal: AbortSignal.timeout(90_000) });
  if (!res.ok) throw new Error(`Gemini (auditoría de negocio) ${res.status}: ${(await res.text().catch(() => '')).slice(0, 300)}`);
  const data = await res.json();
  const raw = String(data.candidates?.[0]?.content?.parts?.[0]?.text ?? '{}');
  let parsed: any;
  try { parsed = JSON.parse(raw); } catch {
    const finishReason = data.candidates?.[0]?.finishReason;
    console.error(`[agente-compras] auditoría de negocio — JSON no interpretable — finishReason=${finishReason}, largo=${raw.length}`);
    throw new Error('El agente devolvió una respuesta no interpretable — intenta de nuevo.');
  }

  await registrarUsoAgente();
  const usoDespues = await usoDiarioAgente();

  const alertas: AlertaAgente[] = (Array.isArray(parsed.alertas) ? parsed.alertas : []).map((a: any) => ({
    campo: 'general', area: String(a.area || 'general'), mensaje: String(a.mensaje || ''),
    gravedad: a.gravedad === 'critico' || a.gravedad === 'aviso' ? a.gravedad : 'info',
    documento: a.documento || null, citaTextual: a.citaTextual || null,
    citaVerificada: verificarCita(a.documento, a.citaTextual, porDocumento),
  }));

  // Solo se guarda si trae texto/días de verdad Y la cita se verifica contra el documento real —
  // misma regla dura que las alertas: mejor sin dato que un plazo inventado que nadie chequeó.
  const pe = parsed.plazoEntregaDetectado;
  let plazoEntregaDetectado: PlazoEntregaDetectado | null = null;
  if (pe && (pe.texto || pe.dias != null)) {
    const citaVerificada = verificarCita(pe.documento, pe.citaTextual, porDocumento);
    if (citaVerificada) {
      plazoEntregaDetectado = {
        texto: String(pe.texto || (pe.dias != null ? `${pe.dias} días` : '')),
        dias: pe.dias != null ? Number(pe.dias) : null,
        documento: pe.documento || null, citaTextual: pe.citaTextual || null, citaVerificada: true,
      };
    } else {
      console.warn(`[agente-compras] plazoEntregaDetectado del negocio ${negocioId} sin cita verificable — se descarta.`);
    }
  }

  const resultado: ResultadoAuditoriaNegocio = {
    encontroDatos: true, documentosLeidos: documentos, fuentes,
    resumen: String(parsed.resumen || ''), alertas, usoHoy: usoDespues, plazoEntregaDetectado,
  };
  await guardarAuditoriaNegocio(negocioId, resultado).catch(e => console.error('[agente-compras] no se pudo guardar la auditoría (no crítico):', e));
  return resultado;
}
