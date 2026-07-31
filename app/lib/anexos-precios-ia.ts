// app/lib/anexos-precios-ia.ts
// Respaldo de PRECIOS del Anexo Creator — hermano de anexos-ia-matching.ts (que cruza datos de
// EMPRESA), pero para la tabla de ítems de un anexo económico (materiales, EPP, arriendo de
// maquinaria...). Cuando la licitación ya tiene un costeo real subido (Motor Comercial, ver
// motor-comercial.ts), se cruza la descripción de cada fila del Word contra la descripción de
// cada ítem del costeo — mismo principio conservador que el resto del sistema: si la IA no está
// segura de que es EL MISMO ítem físico, no asigna nada (queda pendiente para que un humano lo
// revise, como hoy).
//
// Caso real que motiva esto (1738-18-LE26): los 7 campos de identidad de empresa se completaban
// solos, pero los ~30 precios unitarios del "ANEXO N°2 ECONÓMICO" quedaban en blanco porque el
// motor de anexos nunca conoció una fuente de precios — solo conocía datos de `empresas`.
//
// gemini.ts es server-only (arrastra node:async_hooks) — este módulo NUNCA se importa desde un
// Client Component, solo desde anexos-rellenar.ts (que a su vez solo corren las rutas /api/anexos).
import { crearChatIA } from '@/app/lib/gemini';
import { parseJsonIA } from '@/app/lib/json-ia';
import type { ItemCosteoPrecio } from '@/app/lib/motor-comercial';

const TAMANO_LOTE = 25;

function enLotes<T>(items: T[], tamano: number): T[][] {
  const lotes: T[][] = [];
  for (let i = 0; i < items.length; i += tamano) lotes.push(items.slice(i, i + tamano));
  return lotes;
}

// Solo la columna de precio UNITARIO — nunca "Precio total", "Cantidad" ni cualquier otra. La
// columna total NUNCA se autocompleta: no hay certeza de que la cantidad que usa el Word para
// calcularlo sea la misma del costeo (una tabla puede pedir la cantidad de las bases, que no
// siempre calza con la del costeo) — mejor dejarla en blanco que escribir un total mal calculado.
// Por construcción excluye "precio total"/"valor total": esas frases no matchean ninguno de los
// patrones exactos de abajo.
const RE_COLUMNA_PRECIO_UNITARIO = /^(precio(\s+unitario)?|valor(\s+unitario)?|monto(\s+unitario)?)$/i;

export function esCandidatoDePrecioUnitario(etiqueta: string): boolean {
  const partes = etiqueta.split(' — ');
  if (partes.length < 2) return false; // siempre viene como "<ítem> — <columna>" (patrón 1b de tablas)
  return RE_COLUMNA_PRECIO_UNITARIO.test(partes[partes.length - 1].trim());
}

const SYS = `Eres un asistente que ayuda a llenar la tabla de precios de una oferta a una licitación pública chilena.

Te doy una lista NUMERADA de FILAS detectadas en una tabla de un formulario Word (cada una describe un ítem —material, EPP, servicio, arriendo de maquinaria— y pide su PRECIO UNITARIO) y una lista NUMERADA de ÍTEMS DEL COSTEO real que la empresa ya calculó para esta misma licitación (con su precio unitario de venta).

Para cada fila, decide si describe EXACTAMENTE el mismo ítem físico que alguno del costeo — aunque esté redactado distinto (abreviado, con o sin marca/modelo, mayúsculas, orden de palabras, con o sin comillas de pulgada). Tiene que ser el MISMO producto o servicio, no uno parecido:
- "Casco de seguridad" y "Casco de seguridad industrial Bullard" SÍ son el mismo ítem.
- "Guantes de cuero" y "Guantes de látex" NO son el mismo ítem (material distinto).
- "Arriendo retroexcavadora" y "Arriendo excavadora" NO son el mismo ítem (máquina distinta) salvo que el texto sea claramente la misma máquina con otro nombre.

Ante cualquier duda, NO asignes — es mucho peor escribir un precio equivocado en una oferta que dejarlo pendiente para que un humano lo revise.

Responde SOLO con los NÚMEROS (nunca copies el texto) — devuelve SOLO JSON, sin markdown ni texto adicional:
{"matches":[{"fila":<número de la fila>,"item":<número del ítem del costeo que elegiste>}]}`;

export interface MatchPrecio { etiqueta: string; precioUnitario: number; itemDescripcion: string }

async function matchearLotePrecios(filas: string[], items: ItemCosteoPrecio[]): Promise<MatchPrecio[]> {
  // Matching por ÍNDICE NUMÉRICO, no por texto copiado: un primer intento pidiéndole a la IA que
  // devolviera la descripción exacta del ítem falló en la práctica — el modelo la parafraseaba
  // (ej. le pegaba de vuelta la unidad "(UN)" que solo iba de contexto) y el lookup por texto
  // exacto descartaba TODOS los matches en silencio. Pedirle un número es inmune a paráfrasis,
  // comillas de pulgada mal escapadas, mayúsculas o cualquier otra variación de copiado.
  const user = `FILAS DE LA TABLA (piden precio unitario) (${filas.length}):
${filas.map((f, i) => `${i + 1}. ${f}`).join('\n')}

ÍTEMS DEL COSTEO (número: descripción, unidad, precio unitario neto):
${items.map((it, i) => `${i + 1}: ${it.descripcion}${it.unidad ? `, unidad ${it.unidad}` : ''}, $${Math.round(it.precioUnitario).toLocaleString('es-CL')}`).join('\n')}`;

  try {
    const completion: any = await crearChatIA({
      messages: [{ role: 'system', content: SYS }, { role: 'user', content: user }],
      temperature: 0, stream: false, max_tokens: 4_000,
      response_format: { type: 'json_object' },
    }, { timeoutMs: 60_000 });

    const txt = String(completion.choices?.[0]?.message?.content ?? '');
    const parsed: any = parseJsonIA(txt) || {};
    const arr = Array.isArray(parsed.matches) ? parsed.matches : [];

    const out: MatchPrecio[] = [];
    for (const m of arr) {
      if (!m) continue;
      const iFila = Number(m.fila), iItem = Number(m.item);
      if (!Number.isInteger(iFila) || !Number.isInteger(iItem)) continue;
      const fila = filas[iFila - 1];
      const item = items[iItem - 1];
      if (!fila || !item) continue; // número fuera de rango — se descarta, nunca se adivina
      out.push({ etiqueta: fila, precioUnitario: item.precioUnitario, itemDescripcion: item.descripcion });
    }
    return out;
  } catch (error) {
    console.error('[anexos-precios-ia] Falló un lote de precios, ese lote sigue sin matchear:', String(error).slice(0, 200));
    return [];
  }
}

// Devuelve SOLO las filas que la IA logró cruzar con un ítem del costeo — cada ítem se usa a lo
// más UNA vez (mismo principio que el respaldo de datos de empresa: si dos filas del Word
// calzaran con el mismo ítem, la primera se queda con el match y la segunda queda pendiente, en
// vez de duplicar el mismo precio por un posible error de matching). Nunca lanza: si un lote
// falla, ese lote se degrada a "sin matches", sin tumbar el resto del análisis.
export async function matchearPreciosConIA(etiquetas: string[], items: ItemCosteoPrecio[]): Promise<MatchPrecio[]> {
  const elegibles = etiquetas.filter(esCandidatoDePrecioUnitario);
  if (elegibles.length === 0 || items.length === 0) return [];

  const resultados = await Promise.all(enLotes(elegibles, TAMANO_LOTE).map(lote => matchearLotePrecios(lote, items)));
  const usados = new Set<string>();
  const out: MatchPrecio[] = [];
  for (const m of resultados.flat()) {
    if (usados.has(m.itemDescripcion)) continue;
    usados.add(m.itemDescripcion);
    out.push(m);
  }
  return out;
}
