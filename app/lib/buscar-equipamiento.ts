// app/lib/buscar-equipamiento.ts
// Dado un producto de "Productos a costear" (típicamente MAQUINARIA/EQUIPAMIENTO con ficha técnica
// larga), usa la IA (GLM, cadena de respaldo incluida) para: (1) decidir si es maquinaria/equipo,
// (2) SEPARAR las características técnicas REALES de la máquina de lo que NO es spec (logística,
// garantía, plazos, requisitos de admisibilidad, condiciones comerciales), y (3) redactar un PROMPT
// de búsqueda exhaustivo para pegar en Gemini/Google y encontrar VARIAS (3-5) opciones homólogas o
// superiores priorizando PROVEEDORES CHILENOS, y solo si no alcanza, homólogos importables desde China
// (Alibaba) u otros exportadores a Chile que cumplan o superen EXACTAMENTE las mismas specs.
import { crearChatIA, MODELO_TEXTO } from '@/app/lib/gemini';
import { parseJsonIA } from '@/app/lib/json-ia';

export interface BusquedaEquipamiento {
  es_maquinaria: boolean;
  nombre: string;
  specs_tecnicas: string[];         // solo las specs REALES de la máquina
  requisitos_admisibilidad: string[]; // specs marcadas como excluyentes (deben cumplirse sí o sí)
  descartadas: string[];            // lo que NO es spec técnica (logística/garantía/comercial)
  prompt_busqueda: string;          // el prompt listo para pegar en Gemini
}

const SYS = `Eres un experto en ABASTECIMIENTO INDUSTRIAL e importación para licitaciones públicas chilenas.
Te doy UN producto/ítem de una licitación con su lista de "características" tal cual las bases (mezcla specs
reales de la máquina con condiciones que NO describen el equipo). Tu trabajo:

1. es_maquinaria: true si el ítem es una MÁQUINA/EQUIPO/VEHÍCULO/HERRAMIENTA compleja (algo que se busca por
   modelo y specs técnicas); false si es un insumo/material/consumible simple.

2. specs_tecnicas: SOLO las características TÉCNICAS que describen la máquina y sirven para buscar un homólogo
   (dimensiones, capacidad, potencia, voltaje, alturas, velocidad, sistemas de seguridad, tracción, etc.).
   Transcríbelas literales, una por una, SIN agrupar y SIN partir una característica en dos.

3. requisitos_admisibilidad: el SUBCONJUNTO de specs_tecnicas que las bases marcan como EXCLUYENTES/obligatorias
   ("(requisito de admisibilidad)", "igual o superior a…", "mínimo…"). REPITE aquí el texto EXACTO tal como
   aparece en specs_tecnicas (no lo reformules) — sirve solo para resaltar el piso innegociable.

4. descartadas: lo que NO es spec de la máquina y por tanto NO sirve para buscar el producto (entrega/lugar,
   costos de transporte, garantía comercial, servicio técnico, año de fabricación, "equipo nuevo", manuales,
   plazos, certificados de inspección pre-entrega, condiciones de pago, etc.).

REGLA DE PARTICIÓN (crítica, respétala siempre):
   · specs_tecnicas y descartadas son DISJUNTAS: cada característica de entrada va en UNA sola de las dos, NUNCA
     en ambas. requisitos_admisibilidad es un subconjunto de specs_tecnicas (esas sí se repiten, solo ahí).
   · Clasifica CADA característica de la lista de entrada exactamente UNA vez. No inventes, no dupliques, no
     dividas una línea en varias. La suma de specs_tecnicas + descartadas debe cubrir el total de entrada sin
     repetir. Si una línea mezcla spec + condición (p.ej. "motor 20 HP, entrega en 30 días"), pon la parte de
     spec en specs_tecnicas y la parte de condición en descartadas, pero SIN duplicar el texto completo.

5. prompt_busqueda: un PROMPT en español, autocontenido y EXHAUSTIVO, listo para pegar en una IA de búsqueda
   (Gemini/Google). Su objetivo es encontrar VARIAS opciones reales, priorizando Chile. Debe pedir explícitamente:
   · PRIMERO, entre 3 y 5 PROVEEDORES CHILENOS (empresas que venden/distribuyen/importan el equipo EN CHILE, con
     sitio .cl, RUT, sucursal o representación local). El objetivo es el PROVEEDOR CHILENO, no la fábrica. Cuantas
     más alternativas chilenas, mejor.
   · SOLO SI no hay oferta suficiente en Chile, homólogos importables desde China (Alibaba/Made-in-China) u otros
     exportadores a Chile, como alternativa secundaria y diciéndolo explícitamente. Los homólogos de China deben
     CUMPLIR O SUPERAR EXACTAMENTE las MISMAS specs_tecnicas (mismo piso técnico, sin rebajar ninguna spec ni
     ningún requisito de admisibilidad).
   Para CADA opción pide: marca/modelo, NOMBRE DEL PROVEEDOR (en Chile; o exportador si es de China), ciudad/país,
   sitio web/contacto, precio estimado (CLP para Chile; USD FOB si viene importado), plazo de entrega, y una línea
   de "cumple/supera" que confirme que satisface TODAS las specs. Ordena: primero Chile, luego China.
   Incluye TODAS las specs_tecnicas dentro del prompt (no las resumas) y marca los requisitos_admisibilidad como
   piso innegociable. Redáctalo como una orden clara al asistente.

Devuelve SOLO JSON válido:
{"es_maquinaria":true,"nombre":"","specs_tecnicas":[""],"requisitos_admisibilidad":[""],"descartadas":[""],"prompt_busqueda":""}`;

export async function generarBusquedaEquipamiento(producto: {
  nombre: string;
  caracteristicas: string[];
  cantidad?: number | null;
  region?: string;
}): Promise<BusquedaEquipamiento> {
  const caracts = (producto.caracteristicas || []).filter(Boolean);
  const user = `PRODUCTO: ${producto.nombre || '(sin nombre)'}${producto.cantidad ? ` · Cantidad: ${producto.cantidad}` : ''}${producto.region ? ` · Región de entrega: ${producto.region}` : ''}
CARACTERÍSTICAS SEGÚN LAS BASES (literal, mezcladas):
${caracts.map((c, i) => `${i + 1}. ${c}`).join('\n')}`;

  const completion: any = await crearChatIA({
    messages: [{ role: 'system', content: SYS }, { role: 'user', content: user }],
    temperature: 0.2,
    stream: false,
    max_tokens: 4_000,
    response_format: { type: 'json_object' },
  }, { timeoutMs: 60_000 });

  const txt = String(completion.choices?.[0]?.message?.content ?? '');
  const parsed = parseJsonIA(txt) || {};
  const arr = (x: any): string[] => (Array.isArray(x) ? x.map(String).filter(Boolean) : []);

  let prompt = String(parsed.prompt_busqueda || '').trim();
  // Respaldo: si la IA no armó el prompt, construimos uno determinista con las specs disponibles.
  if (!prompt) {
    const specs = arr(parsed.specs_tecnicas).length ? arr(parsed.specs_tecnicas) : caracts;
    prompt = construirPromptFallback(producto.nombre, specs, producto.region);
  }
  return {
    es_maquinaria: parsed.es_maquinaria !== false,
    nombre: String(parsed.nombre || producto.nombre || ''),
    specs_tecnicas: arr(parsed.specs_tecnicas),
    requisitos_admisibilidad: arr(parsed.requisitos_admisibilidad),
    descartadas: arr(parsed.descartadas),
    prompt_busqueda: prompt,
  };
}

// Prompt determinista de respaldo (por si la IA falla): SIEMPRE devuelve algo usable.
function construirPromptFallback(nombre: string, specs: string[], region?: string): string {
  return `Actúa como experto en abastecimiento en Chile. Necesito encontrar PROVEEDORES CHILENOS del siguiente equipo para una licitación pública${region ? ` (entrega en ${region})` : ''}: ${nombre}.
Búscame PRIMERO entre 3 y 5 opciones REALES con PROVEEDOR EN CHILE (marca, modelo y empresa con sitio .cl / contacto) que CUMPLAN O SUPEREN estas especificaciones. SOLO si no hay oferta suficiente en Chile, agrega homólogos importables desde China (Alibaba/Made-in-China) u otros exportadores a Chile que cumplan o superen EXACTAMENTE las MISMAS especificaciones (mismo piso técnico, sin rebajar ninguna), y dilo explícitamente:
${specs.map(s => `- ${s}`).join('\n')}
Para cada opción indica: marca/modelo, nombre del proveedor (en Chile; o exportador si es de China), ciudad/país, sitio web/contacto, precio estimado (CLP en Chile; USD FOB si es importado), plazo de entrega, y por qué cumple o supera. Ordena: primero Chile, luego China. Prioriza los requisitos obligatorios como piso innegociable.`;
}
