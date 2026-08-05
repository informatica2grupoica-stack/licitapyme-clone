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

// Solo la columna de precio UNITARIO — nunca "Precio total", "Cantidad" ni cualquier otra: no hay
// certeza de que la cantidad que usa el Word para calcular un total sea la misma del costeo (una
// tabla puede pedir la cantidad de las bases, que no siempre calza), así que un total nunca se
// autocompleta CRUZANDO CONTRA EL COSTEO. (Sí se calcula, aparte, sumando la columna ya rellenada
// del propio anexo — ver calcularTotalesAlPie en anexos-totales-seccion.ts.)
//
// El criterio de "¿esta columna pide un precio unitario?" vive en anexos-precios-columnas.ts —
// es una regla pura que también usa anexos-totales-seccion.ts, que no puede importar este módulo
// (arrastra gemini.ts, server-only). Se re-exporta para no cambiarles el import a quienes ya la
// consumían desde acá.
export { esCandidatoDePrecioUnitario } from '@/app/lib/anexos-precios-columnas';
import { esCandidatoDePrecioUnitario } from '@/app/lib/anexos-precios-columnas';

// ── Match EXACTO por texto normalizado — antes de gastar ni un token de IA ───────────────────
// El costeo casi siempre copia la descripción del ítem TAL CUAL viene en el anexo (es de donde
// salió) — la única diferencia real suele ser mayúsculas, espacios dobles o comillas de pulgada
// escritas distinto, nunca la redacción. Para ESE caso (la inmensa mayoría en la práctica) no
// hace falta preguntarle nada a un modelo: es el mismo texto. Sin esto, CADA apertura del modal y
// CADA click en "Generar" volvían a gastarle tokens a la IA para "adivinar" algo que ya se sabía
// con certeza — y de paso, al no depender de un timeout de red, este paso NUNCA falla ni varía de
// una corrida a otra (a diferencia del respaldo IA, ver el caso real más abajo).
function normalizarParaMatchExacto(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/['´`]/g, '"')
    .replace(/\s+/g, ' ')
    // Caso real (1738-18-LE26): "e:0,1 METROS" (anexo) vs "e:0,10 METROS" (costeo) — el MISMO
    // espesor (0,1 = 0,10), pero como texto no calzan. A diferencia de una palabra, un cero final
    // en un número decimal nunca cambia su valor — quitarlo es matemáticamente seguro, no una
    // adivinanza.
    .replace(/(\d+,\d*[1-9])0+(?!\d)/g, '$1')
    .trim();
}

function matchExacto(etiquetas: string[], items: ItemCosteoPrecio[]): { matches: MatchPrecio[]; sinResolver: string[] } {
  const porTexto = new Map(items.map(it => [normalizarParaMatchExacto(it.descripcion), it]));
  const matches: MatchPrecio[] = [];
  const sinResolver: string[] = [];
  for (const etiqueta of etiquetas) {
    const filaTexto = etiqueta.split(' — ')[0].trim(); // la parte del ítem, sin "— Precio unitario"
    const item = porTexto.get(normalizarParaMatchExacto(filaTexto));
    if (item) matches.push({ etiqueta, precioUnitario: item.precioUnitario, itemDescripcion: item.descripcion });
    else sinResolver.push(etiqueta);
  }
  return { matches, sinResolver };
}

// ── Guard de coherencia (determinista, no depende de que la IA se abstenga) ──────────────────
// Caso real encontrado (1738-18-LE26): la IA cruzó "TRAZADO Y NIVELES" con "NIVEL DE ALUMINIO
// 48" GRIS STANLEY" — un ítem de nivelación de terreno con una herramienta de carpintería que no
// tiene nada que ver, solo porque comparten la palabra "nivel"/"niveles". "TRAZADO Y NIVELES" ni
// siquiera está en el costeo (es una partida de mano de obra, no un material) — la IA debió
// abstenerse por instrucción del prompt, pero con decenas de ítems que comparten el MISMO precio
// exacto (datos de prueba muy repetitivos, ver memoria del proyecto) el modelo a veces "elige"
// el más parecido en vez de admitir que ninguno calza. Esto ataja el caso de raíz: exige que la
// fila del Word y la descripción del ítem del costeo compartan AL MENOS una palabra real (≥3
// letras, sin conectores) — condición NECESARIA, no suficiente, igual que esMatchCoherente en
// anexos-diccionario.ts. Si no comparten ninguna, el match se descarta aunque la IA lo haya dado
// por bueno: mejor un precio pendiente que uno inventado.
const CONECTORES = new Set(['de', 'la', 'el', 'los', 'las', 'del', 'y', 'a', 'en', 'un', 'una', 'con', 'por', 'para', 'sin']);

function palabrasSignificativas(texto: string): Set<string> {
  const normalizado = texto.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  const palabras = normalizado.replace(/[^a-z0-9]+/g, ' ').split(' ').filter(Boolean);
  return new Set(palabras.filter(p => p.length >= 3 && !CONECTORES.has(p)));
}

function compartenPalabra(a: string, b: string): boolean {
  const pa = palabrasSignificativas(a);
  const pb = palabrasSignificativas(b);
  for (const p of pa) if (pb.has(p)) return true;
  return false;
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
      if (!compartenPalabra(fila, item.descripcion)) continue; // sin ninguna palabra en común: no es el mismo ítem
      out.push({ etiqueta: fila, precioUnitario: item.precioUnitario, itemDescripcion: item.descripcion });
    }
    return out;
  } catch (error) {
    console.error('[anexos-precios-ia] Falló un lote de precios, ese lote sigue sin matchear:', String(error).slice(0, 200));
    return [];
  }
}

async function matchearVarios(etiquetas: string[], items: ItemCosteoPrecio[], tamanoLote: number): Promise<MatchPrecio[]> {
  const resultados = await Promise.all(enLotes(etiquetas, tamanoLote).map(lote => matchearLotePrecios(lote, items)));
  return resultados.flat();
}

// Devuelve SOLO las filas que la IA logró cruzar con un ítem del costeo — cada ítem se usa a lo
// más UNA vez (mismo principio que el respaldo de datos de empresa: si dos filas del Word
// calzaran con el mismo ítem, la primera se queda con el match y la segunda queda pendiente, en
// vez de duplicar el mismo precio por un posible error de matching). Nunca lanza: si un lote
// falla, ese lote se degrada a "sin matches", sin tumbar el resto del análisis.
//
// Segundo intento SOLO para lo que no calzó en la primera pasada — caso real: un timeout del
// modelo principal (glm-4.7-flashx) degrada 3 lotes al respaldo (glm-4.5-air, menos cuidadoso),
// que se saltó 3 ítems que SÍ estaban en el costeo ("FIERRO Ø 12 ESTRIADO", "HORMIGÓN G-25
// e:0,1 METROS", "MOLDAJE") — con 30+ ítems en una sola línea, basta que a UNO se le escape para
// que la línea entera se quede sin total (ver calcularTotalesPorSeccion: nunca escribe un total
// parcial). El segundo intento usa lotes más chicos (menos ítems compitiendo por la atención del
// modelo) para lo que quedó pendiente — no repite lo que ya calzó bien.
export async function matchearPreciosConIA(etiquetas: string[], items: ItemCosteoPrecio[]): Promise<MatchPrecio[]> {
  const elegibles = etiquetas.filter(esCandidatoDePrecioUnitario);
  if (elegibles.length === 0 || items.length === 0) return [];

  // Paso 0: match exacto por texto (ver matchExacto) — sin esto, se le pagaba a la IA por
  // resolver algo que ya se sabía con certeza en el 90%+ de los casos reales.
  const { matches: exactos, sinResolver: sinResolverExacto } = matchExacto(elegibles, items);
  if (sinResolverExacto.length === 0) return exactos;

  const primeraPasada = await matchearVarios(sinResolverExacto, items, TAMANO_LOTE);
  const resueltosEnPrimera = new Set(primeraPasada.map(m => m.etiqueta));
  const sinResolver = sinResolverExacto.filter(e => !resueltosEnPrimera.has(e));
  const segundaPasada = sinResolver.length > 0
    ? await matchearVarios(sinResolver, items, Math.max(5, Math.floor(TAMANO_LOTE / 2)))
    : [];

  const usados = new Set(exactos.map(m => m.itemDescripcion));
  const out: MatchPrecio[] = [...exactos];
  for (const m of [...primeraPasada, ...segundaPasada]) {
    if (usados.has(m.itemDescripcion)) continue;
    usados.add(m.itemDescripcion);
    out.push(m);
  }
  return out;
}
