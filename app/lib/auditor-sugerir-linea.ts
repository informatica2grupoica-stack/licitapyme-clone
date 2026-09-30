// Sugerir la LÍNEA de cada producto de una cotización que el emparejador por palabras no pudo ubicar.
// Un producto de nombre críptico («TSG-200», «Relacart EZ MI2+») no comparte palabras con el detalle de la línea: aquí la IA lo lee
// como lo leería una persona (¿qué ES este producto? ¿a qué línea corresponde?) y responde con la línea y el porqué, o «ninguna».
// Solo se asigna sola cuando la confianza es ALTA y trae motivo; lo demás queda como sugerencia de un clic o como «no corresponde».
import { crearChatIA } from '@/app/lib/gemini';
import { parseJsonIA } from '@/app/lib/json-ia';

export interface ProductoParaSugerir { idx: number; nombre: string; precioNeto: number | null; cantidad: number | null; proveedor: string }
export interface LineaParaSugerir { item: number; filaId: string; detalle: string; cantidad: number | null; costoNeto: number | null }
export interface SugerenciaLinea { idx: number; filaId: string | null; item: number | null; confianza: 'alta' | 'media' | 'baja'; motivo: string }

const MODELO = 'glm-4.7';

export const SISTEMA_SUGERIR = `Eres un asistente de compras públicas en Chile. Te doy (A) las LÍNEAS de una licitación (lo que el organismo pide comprar) y (B) productos que un proveedor cotizó. Para cada producto decide a qué línea corresponde.
REGLAS:
- Un producto corresponde a una línea SOLO si es esa misma clase de cosa (un proyector va a la línea de proyectores; un parlante amplificado o un set con mezclador va a «SET AMPLIFICACIÓN»). Compartir una palabra suelta (p. ej. «cámara») no basta: una webcam no es la cámara fotográfica.
- Si el producto es un accesorio, repuesto, otro tamaño/capacidad distinto del pedido, o algo que ninguna línea pide, responde linea = null (ninguna).
- Usa la cantidad y el precio solo como pista secundaria.
- confianza «alta» = es claramente esa línea y puedes decir por qué en una frase concreta; «media» = probable; «baja» = dudoso (en ese caso mejor linea = null).
- No inventes características: razona con lo que dice el nombre del producto y el detalle de la línea.
Responde SOLO un JSON: {"productos":[{"idx":0,"linea":5,"confianza":"alta","motivo":"frase corta"}]} con un elemento por producto (idx = el número que te di; linea = el número de la línea o null).`;

export function construirUsuarioSugerir(productos: ProductoParaSugerir[], lineas: LineaParaSugerir[]): string {
  const l = lineas.map(x => `LÍNEA ${x.item}: ${x.detalle.replace(/\s+/g, ' ').slice(0, 260)} | cantidad ${x.cantidad ?? '?'}${x.costoNeto ? ` | costeo neto unit. ~$${Math.round(x.costoNeto)}` : ''}`).join('\n');
  const p = productos.map(x => `PRODUCTO idx=${x.idx}: ${x.nombre} | proveedor ${x.proveedor || '?'} | cantidad cotizada ${x.cantidad ?? '?'}${x.precioNeto ? ` | precio neto unit. ~$${Math.round(x.precioNeto)}` : ''}`).join('\n');
  return `(A) LÍNEAS DE LA LICITACIÓN\n${l}\n\n(B) PRODUCTOS COTIZADOS SIN LÍNEA\n${p}`;
}

/** Interpreta la respuesta del modelo: descarta líneas que no existen y baja a «media» una «alta» sin motivo concreto. */
export function interpretarSugerencias(raw: unknown, productos: ProductoParaSugerir[], lineas: LineaParaSugerir[]): SugerenciaLinea[] {
  const lista: any[] = Array.isArray((raw as any)?.productos) ? (raw as any).productos : Array.isArray(raw) ? (raw as any[]) : [];
  const porItem = new Map(lineas.map(l => [l.item, l]));
  const out: SugerenciaLinea[] = [];
  for (const p of productos) {
    const r = lista.find(x => Number(x?.idx) === p.idx);
    const item = r?.linea == null || r.linea === '' ? null : Number(r.linea);
    const linea = item != null ? porItem.get(item) : undefined;
    const motivo = String(r?.motivo || '').replace(/\s+/g, ' ').trim().slice(0, 300);
    let confianza: SugerenciaLinea['confianza'] = ['alta', 'media', 'baja'].includes(String(r?.confianza)) ? r.confianza : 'baja';
    if (!linea) { out.push({ idx: p.idx, filaId: null, item: null, confianza: 'baja', motivo: motivo || 'No corresponde a ninguna línea de la licitación.' }); continue; }
    if (confianza === 'alta' && motivo.length < 12) confianza = 'media';
    if (confianza === 'baja') { out.push({ idx: p.idx, filaId: null, item: null, confianza: 'baja', motivo: motivo || 'No se pudo decidir.' }); continue; }
    out.push({ idx: p.idx, filaId: linea.filaId, item: linea.item, confianza, motivo });
  }
  return out;
}

export async function sugerirLineas(productos: ProductoParaSugerir[], lineas: LineaParaSugerir[]): Promise<SugerenciaLinea[]> {
  if (!productos.length || !lineas.length) return [];
  const completion: any = await crearChatIA({
    messages: [{ role: 'system', content: SISTEMA_SUGERIR }, { role: 'user', content: construirUsuarioSugerir(productos, lineas) }],
    temperature: 0, stream: false, max_tokens: 3_000, response_format: { type: 'json_object' },
  }, { timeoutMs: 120_000, modeloPreferido: MODELO, soloGlm: true });
  const parsed = parseJsonIA<any>(String(completion.choices?.[0]?.message?.content ?? ''));
  if (!parsed) throw new Error('el modelo no devolvió una respuesta interpretable');
  return interpretarSugerencias(parsed, productos, lineas);
}
