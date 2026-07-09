// app/lib/buscar-equipamiento.ts
// Dado un producto de "Productos a costear" (típicamente MAQUINARIA/EQUIPAMIENTO con ficha técnica
// larga), usa la IA (GLM, cadena de respaldo incluida) para: (1) decidir si es maquinaria/equipo,
// (2) SEPARAR las características técnicas REALES de la máquina de lo que NO es spec (logística,
// garantía, plazos, requisitos de admisibilidad, condiciones comerciales), y (3) redactar un PROMPT
// de búsqueda exhaustivo para pegar en Gemini/Google y encontrar 3 productos homólogos o superiores
// disponibles en Chile o importables desde China (Alibaba) u otros exportadores a Chile.
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
   Transcríbelas literales, una por una, SIN agrupar.
3. requisitos_admisibilidad: las specs que las bases marcan como EXCLUYENTES/obligatorias ("(requisito de
   admisibilidad)", "igual o superior a…", "mínimo…") — van también en specs_tecnicas, pero además acá para
   resaltar que son un piso innegociable.
4. descartadas: lo que NO es spec de la máquina y por tanto NO sirve para buscar el producto (entrega/lugar,
   costos de transporte, garantía comercial, servicio técnico, año de fabricación, "equipo nuevo", manuales,
   plazos, certificados de inspección pre-entrega, condiciones de pago, etc.).
5. prompt_busqueda: un PROMPT en español, autocontenido y EXHAUSTIVO, listo para pegar en una IA (Gemini).
   Debe pedir 3 productos REALES (marca, modelo, PROVEEDOR y link) que CUMPLAN O SUPEREN las specs_tecnicas.
   PRIORIDAD ABSOLUTA: PROVEEDORES CHILENOS (empresas que venden/distribuyen/importan el equipo EN CHILE, con
   sitio .cl, RUT, sucursal o representación local). El objetivo es encontrar al PROVEEDOR CHILENO, no la
   fábrica. Solo si no existe oferta en Chile, sugiere homólogos importables (China/Alibaba) como alternativa
   secundaria y dilo explícitamente. Para cada opción: marca/modelo, NOMBRE DEL PROVEEDOR EN CHILE, ciudad,
   sitio web/contacto, precio estimado (CLP; USD si viene importado), plazo de entrega, y por qué cumple/supera.
   Prioriza los requisitos_admisibilidad como piso innegociable. Redáctalo como una orden clara al asistente;
   incluye TODAS las specs técnicas dentro del prompt (no las resumas).

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
Búscame 3 opciones REALES (marca, modelo y PROVEEDOR EN CHILE con sitio .cl / contacto) que CUMPLAN O SUPEREN estas especificaciones. Prioridad: proveedores/importadores establecidos en Chile; solo si no hay oferta local, sugiere homólogos importables (China/Alibaba) como alternativa y dilo:
${specs.map(s => `- ${s}`).join('\n')}
Para cada opción indica: marca/modelo, nombre del proveedor en Chile, ciudad, sitio web/contacto, precio estimado (CLP), plazo de entrega, y por qué cumple o supera. Prioriza los requisitos obligatorios.`;
}
