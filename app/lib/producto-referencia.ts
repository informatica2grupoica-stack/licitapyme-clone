// app/lib/producto-referencia.ts
// "Producto de referencia" (spec P9 / PROMPT_3a v1.0): identifica el modelo comercial que el cliente tenía
// en mente al redactar las bases. Flujo: (1) la IA propone búsquedas; (2) Serper las busca en la web;
// (3) se descargan las fichas de los primeros resultados; (4) la IA compara la ficha de las bases contra
// cada candidato (CUMPLE / NO_CUMPLE / NO_INFORMA); (5) el CÓDIGO calcula % de coincidencia, ordena y
// decide el aviso de "especificaciones copiadas". El modelo extrae, el código decide.
// Corre solo a pedido y solo en proyectos asignados (lo exige la ruta). Rotulado "Referencia para buscar":
// no cambia la ficha ni lo que se oferta.
import { crearChatIA as crearChatIABase } from '@/app/lib/gemini';
import { conModuloIA } from '@/app/lib/ia-uso';
import { parseJsonIA } from '@/app/lib/json-ia';
const crearChatIA = conModuloIA('costeo', crearChatIABase);

// Valores iniciales (spec: "en configuración"; CA confirma el umbral con casos reales).
const RESULTADOS_A_ABRIR = 5;
const CANDIDATOS_A_MOSTRAR = 3;
const UMBRAL_COPIADO = 0.8;
const MAX_CHARS_CANDIDATO = 30_000;
const MAX_BYTES_DESCARGA = 8 * 1024 * 1024;

const SERPER_KEY = process.env.SERPER_API_KEY || '';

export interface ItemReferencia {
  nombre: string;
  marca_modelo_referencia?: string | null;
  caracteristicas: string[];
}

export type TipoFuente = 'FABRICANTE' | 'DISTRIBUIDOR' | 'MARKETPLACE' | 'OTRO';

export interface CandidatoReferencia {
  marca: string;
  modelo: string;
  url: string;
  tipo_fuente: TipoFuente;
  porcentaje: number;                 // CUMPLE ÷ total de características de las bases (0-100)
  cumple: number;
  no_cumple: number;
  no_informa: number;
  no_cumple_detalle: { caracteristica: string; dato_candidato: string }[];
  copiado: boolean;                   // texto_casi_igual en ≥ UMBRAL_COPIADO de las características
}

export interface ResultadoReferencia {
  busquedas: string[];
  candidatos: CandidatoReferencia[];  // los mejores CANDIDATOS_A_MOSTRAR
  aviso_copiado: boolean;
  total_revisados: number;
}

// ─── Prompt 1 · Búsquedas ──────────────────────────────────────────────────────
const SYS_BUSQUEDAS = `Eres un analista de abastecimiento para licitaciones públicas chilenas.
Recibes la ficha de UN producto tal como la piden las bases. Propón búsquedas
web para encontrar el modelo comercial exacto que el cliente tenía en mente.

Reglas:
- Si las bases nombran marca o modelo de referencia, la primera búsqueda es esa
  marca y modelo, tal cual.
- Las demás combinan el tipo de producto con 2 o 3 características
  distintivas: las más específicas (valores exactos, códigos, medidas poco
  comunes), no las genéricas.
- Copia los valores tal cual las bases. No inventes marcas ni modelos.
- Una de las búsquedas agrega "ficha técnica pdf" (o "datasheet pdf" si va
  en inglés), para llegar al documento del fabricante.
- Entre 3 y 5 búsquedas, en español o inglés según rinda mejor el producto.

Responde SOLO JSON: {"busquedas":["..."]}`;

// ─── Prompt 2 · Comparación con cada candidato ────────────────────────────────
const SYS_COMPARAR = `Eres un comparador técnico. Recibes (1) las características de un producto tal
como las piden unas bases de licitación y (2) el texto de la página o ficha
técnica de un producto comercial candidato. Para cada característica de las
bases, di si el candidato la cumple según su propia ficha.

Reglas:
- Usa solo lo que dice el texto del candidato. No uses conocimiento externo.
- CUMPLE: la ficha del candidato informa un valor que cumple el requisito
  (igual o mejor).
- NO_CUMPLE: la ficha informa un valor que no lo cumple.
- NO_INFORMA: la ficha no dice nada sobre esa característica.
- En "dato_candidato" copia el valor del candidato tal cual (en su idioma) y
  agrega la traducción al español si viene en otro idioma.
- "texto_casi_igual": true si la redacción de la característica en las bases
  es casi igual a la del candidato (mismas palabras y valores, en el mismo
  orden), aunque cambie el idioma.
- Marca y modelo: cópialos del texto del candidato; si no aparecen, déjalos
  vacíos.
- "tipo_fuente": FABRICANTE si la página o ficha es de la marca del producto;
  DISTRIBUIDOR si es de un vendedor o importador; MARKETPLACE si es un sitio
  de avisos o tienda de muchos vendedores; OTRO en cualquier otro caso.

Responde SOLO JSON:
{"marca":"","modelo":"","url":"","tipo_fuente":"FABRICANTE|DISTRIBUIDOR|MARKETPLACE|OTRO",
 "caracteristicas":[{"n":1,"resultado":"CUMPLE|NO_CUMPLE|NO_INFORMA",
   "dato_candidato":"","texto_casi_igual":false}]}`;

async function llamarIAJson(system: string, user: string, maxTokens: number): Promise<any> {
  const completion: any = await crearChatIA({
    messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
    temperature: 0.1,
    stream: false,
    max_tokens: maxTokens,
    response_format: { type: 'json_object' },
  }, { timeoutMs: 60_000 });
  return parseJsonIA(String(completion.choices?.[0]?.message?.content ?? '')) || {};
}

async function proponerBusquedas(item: ItemReferencia): Promise<string[]> {
  const user = `PRODUCTO: ${item.nombre}
MARCA/MODELO DE REFERENCIA EN BASES: ${item.marca_modelo_referencia || '(no indica)'}
CARACTERÍSTICAS (literal de bases):
${item.caracteristicas.map(c => '- ' + c).join('\n')}`;
  const j = await llamarIAJson(SYS_BUSQUEDAS, user, 600);
  const qs: string[] = Array.isArray(j.busquedas) ? j.busquedas.map((q: any) => String(q).trim()).filter(Boolean) : [];
  return qs.slice(0, 5);
}

// ─── Búsqueda web (Serper) y descarga de fichas ───────────────────────────────
interface ResultadoWeb { link: string; title: string }

async function buscarWeb(q: string): Promise<ResultadoWeb[]> {
  if (!SERPER_KEY) return [];
  try {
    const r = await fetch('https://google.serper.dev/search', {
      method: 'POST',
      headers: { 'X-API-KEY': SERPER_KEY, 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(12_000),
      body: JSON.stringify({ q, num: 8 }),
    });
    if (!r.ok) return [];
    const data = await r.json();
    return (data.organic || [])
      .map((o: any) => ({ link: String(o.link || ''), title: String(o.title || '') }))
      .filter((o: ResultadoWeb) => o.link);
  } catch { return []; }
}

const MARKETPLACES = ['mercadolibre', 'amazon.', 'ebay.', 'alibaba.', 'aliexpress.', 'facebook.', 'yapo.', 'olx.'];

// Solo https y host con nombre (sin IP literal ni localhost): la URL viene de un buscador, no del usuario,
// pero igual no se pide nada hacia la red interna.
function urlPermitida(link: string): boolean {
  try {
    const u = new URL(link);
    if (u.protocol !== 'https:') return false;
    const h = u.hostname.toLowerCase();
    if (h === 'localhost' || h.endsWith('.localhost') || h.endsWith('.local') || h.endsWith('.internal')) return false;
    if (/^[\d.]+$/.test(h) || h.includes(':')) return false;
    return true;
  } catch { return false; }
}

// Fabricante / PDF primero, distribuidores después, marketplaces al final (spec §0, paso 2).
function prioridadFuente(link: string): number {
  const l = link.toLowerCase();
  if (MARKETPLACES.some(m => l.includes(m))) return 2;
  return l.split('?')[0].endsWith('.pdf') ? 0 : 1;
}

function htmlATexto(html: string): string {
  return html
    .replace(/<(script|style|noscript|svg)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<\/(p|div|li|tr|h\d|br)>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/[ \t]+/g, ' ').replace(/\n\s*\n+/g, '\n').trim();
}

async function descargarTextoCandidato(url: string): Promise<string> {
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(15_000), redirect: 'follow', headers: { 'User-Agent': 'Mozilla/5.0 (compatible; Licitank/1.0)' } });
    if (!r.ok) return '';
    const buf = Buffer.from(await r.arrayBuffer());
    if (buf.length === 0 || buf.length > MAX_BYTES_DESCARGA) return '';
    const ct = String(r.headers.get('content-type') || '').toLowerCase();
    let texto = '';
    if (ct.includes('pdf') || url.toLowerCase().split('?')[0].endsWith('.pdf')) {
      const pdfParse = (await import('pdf-parse')).default;
      texto = ((await pdfParse(buf)).text || '').trim();
    } else if (ct.includes('html') || ct.includes('text')) {
      texto = htmlATexto(buf.toString('utf8'));
    }
    return texto.length >= 200 ? texto.slice(0, MAX_CHARS_CANDIDATO) : '';
  } catch { return ''; }
}

// ─── Comparación y cálculo ─────────────────────────────────────────────────────
const TIPOS_FUENTE: TipoFuente[] = ['FABRICANTE', 'DISTRIBUIDOR', 'MARKETPLACE', 'OTRO'];
const ORDEN_FUENTE: Record<TipoFuente, number> = { FABRICANTE: 0, DISTRIBUIDOR: 1, MARKETPLACE: 2, OTRO: 3 };

async function compararCandidato(item: ItemReferencia, url: string, texto: string): Promise<CandidatoReferencia | null> {
  const user = `CARACTERÍSTICAS DE LAS BASES (numeradas):
${item.caracteristicas.map((c, i) => `${i + 1}. ${c}`).join('\n')}

TEXTO DEL CANDIDATO (${url}):
${texto}`;
  let j: any;
  try { j = await llamarIAJson(SYS_COMPARAR, user, 4_000); } catch { return null; }
  const filas: any[] = Array.isArray(j.caracteristicas) ? j.caracteristicas : [];
  if (filas.length === 0) return null;

  const total = item.caracteristicas.length;
  const porN = new Map<number, any>();
  for (const f of filas) { const n = Number(f?.n); if (Number.isInteger(n) && n >= 1 && n <= total) porN.set(n, f); }

  let cumple = 0, noCumple = 0, casiIguales = 0;
  const detalle: CandidatoReferencia['no_cumple_detalle'] = [];
  for (let n = 1; n <= total; n++) {
    const f = porN.get(n);
    const res = String(f?.resultado || 'NO_INFORMA').toUpperCase();
    if (res === 'CUMPLE') cumple++;
    else if (res === 'NO_CUMPLE') { noCumple++; detalle.push({ caracteristica: item.caracteristicas[n - 1], dato_candidato: String(f?.dato_candidato || '') }); }
    if (f?.texto_casi_igual === true) casiIguales++;
  }
  const tipo = String(j.tipo_fuente || '').toUpperCase() as TipoFuente;
  return {
    marca: String(j.marca || '').trim(),
    modelo: String(j.modelo || '').trim(),
    url,
    tipo_fuente: TIPOS_FUENTE.includes(tipo) ? tipo : 'OTRO',
    porcentaje: Math.round((cumple / total) * 100),
    cumple,
    no_cumple: noCumple,
    no_informa: total - cumple - noCumple,
    no_cumple_detalle: detalle,
    copiado: total > 0 && casiIguales / total >= UMBRAL_COPIADO,
  };
}

export async function buscarProductoReferencia(item: ItemReferencia): Promise<ResultadoReferencia> {
  const caracteristicas = (item.caracteristicas || []).map(c => String(c).trim()).filter(Boolean);
  if (caracteristicas.length === 0) throw new Error('El producto no tiene características para comparar');
  const it: ItemReferencia = { ...item, caracteristicas };

  const busquedas = await proponerBusquedas(it);
  if (busquedas.length === 0) throw new Error('La IA no propuso búsquedas');

  const porBusqueda = await Promise.all(busquedas.map(buscarWeb));
  const vistos = new Set<string>();
  const enlaces: string[] = [];
  for (const lista of porBusqueda) {
    for (const o of lista) {
      if (!urlPermitida(o.link) || vistos.has(o.link)) continue;
      vistos.add(o.link);
      enlaces.push(o.link);
    }
  }
  // sort estable: conserva el orden de relevancia dentro de cada prioridad.
  const elegidos = enlaces.map((l, i) => ({ l, i })).sort((a, b) => prioridadFuente(a.l) - prioridadFuente(b.l) || a.i - b.i)
    .slice(0, RESULTADOS_A_ABRIR).map(x => x.l);

  const candidatos = (await Promise.all(elegidos.map(async url => {
    const texto = await descargarTextoCandidato(url);
    return texto ? compararCandidato(it, url, texto) : null;
  }))).filter((c): c is CandidatoReferencia => c !== null);

  // Mayor % primero; a igual %, menos NO_CUMPLE; a igualdad, fabricante antes que distribuidor, marketplace y otro.
  candidatos.sort((a, b) => b.porcentaje - a.porcentaje || a.no_cumple - b.no_cumple || ORDEN_FUENTE[a.tipo_fuente] - ORDEN_FUENTE[b.tipo_fuente]);
  const mostrados = candidatos.slice(0, CANDIDATOS_A_MOSTRAR);
  return {
    busquedas,
    candidatos: mostrados,
    aviso_copiado: mostrados.some(c => c.copiado),
    total_revisados: candidatos.length,
  };
}
