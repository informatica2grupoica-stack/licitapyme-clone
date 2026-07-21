// app/lib/buscar-equipamiento.ts
// Dado un producto de "Productos a costear" (típicamente MAQUINARIA/EQUIPAMIENTO con ficha técnica
// larga), usa la IA (GLM, cadena de respaldo incluida) para: (1) decidir si es maquinaria/equipo,
// (2) SEPARAR las características técnicas REALES de la máquina de lo que NO es spec (logística,
// garantía, plazos, requisitos de admisibilidad, condiciones comerciales). El PROMPT de búsqueda que
// el usuario copia y pega en Gemini/Google (con búsqueda real) es un TEMPLATE FIJO y determinista
// (construirPromptBusqueda, 2026-07-21) — NO se le pide a la IA que lo redacte: es un prompt largo,
// metódico (ingeniería inversa → proveedor Chile → homólogos importables → tabla con colores de
// cumplimiento → veredicto de factibilidad) que se degrada si se deja a criterio del LLM en cada
// corrida. Solo se le inyectan las specs_tecnicas ya extraídas.
import { crearChatIA, MODELO_TEXTO } from '@/app/lib/gemini';
import { parseJsonIA } from '@/app/lib/json-ia';

export interface BusquedaEquipamiento {
  es_maquinaria: boolean;
  nombre: string;
  specs_tecnicas: string[];         // solo las specs REALES de la máquina
  requisitos_admisibilidad: string[]; // specs marcadas como excluyentes (deben cumplirse sí o sí)
  descartadas: string[];            // lo que NO es spec técnica (logística/garantía/comercial)
  prompt_busqueda: string;          // el prompt fijo (construirPromptBusqueda) listo para pegar en Gemini
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

Devuelve SOLO JSON válido:
{"es_maquinaria":true,"nombre":"","specs_tecnicas":[""],"requisitos_admisibilidad":[""],"descartadas":[""]}`;

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

  // El prompt de búsqueda SIEMPRE se arma con el template fijo (construirPromptBusqueda) — la IA
  // ya no lo redacta (ver comentario de cabecera). Specs: las que clasificó la IA; si vino vacío
  // (falló el parseo), las características crudas de entrada como respaldo.
  const specs = arr(parsed.specs_tecnicas).length ? arr(parsed.specs_tecnicas) : caracts;
  const prompt = construirPromptBusqueda(specs);

  return {
    es_maquinaria: parsed.es_maquinaria !== false,
    nombre: String(parsed.nombre || producto.nombre || ''),
    specs_tecnicas: arr(parsed.specs_tecnicas),
    requisitos_admisibilidad: arr(parsed.requisitos_admisibilidad),
    descartadas: arr(parsed.descartadas),
    prompt_busqueda: prompt,
  };
}

// Template FIJO del prompt de búsqueda (2026-07-21, redactado por el usuario): ingeniería inversa
// del producto real → proveedor en Chile (obligatorio, agota el recurso) → homólogos importables
// (mínimo 3, Alibaba/Made-in-China) → tabla con colores de cumplimiento (🟢🟡🔴⚪) → veredicto de
// factibilidad arriba de todo. Exige que el asistente (Gemini/Google con búsqueda real) use SOLO
// datos verificados con URL exacta — nunca inventados. Las specs_tecnicas van, una por línea, en
// el bloque final "CARACTERÍSTICAS BASALES" — texto EXACTO del usuario, sin nada agregado.
function construirPromptBusqueda(specs: string[]): string {
  const lista = specs.map(s => `- ${s}`).join('\n');
  return `# ROL
Especialista en abastecimiento e importación para licitaciones públicas de Chile. Haces ingeniería inversa de requerimientos técnicos: identificas el producto real que el comprador quería, decides rápido si es factible para nosotros, y buscas proveedores reales con precios y links verificables.

# PRINCIPIO
Descartar rápido lo imposible vale tanto como avanzar en lo factible. Si está amarrado a una marca y no podemos traer ese producto exacto a buen precio, dilo de inmediato y arriba. No adornes un descarte.

# VERACIDAD (regla dura)
Usas Google Search para CADA dato. Prohibido inventar, deducir o completar de memoria precios, links, specs o marcas.
- Un dato vale solo si viene de una página que abriste en esta sesión.
- Toda URL debe ser un link real y completo (https://...) a un producto específico. Nunca uses términos de búsqueda, "caché", "site:" ni punteros tipo [8.2.1]. Sin URL exacta → "No encontrado".
- Si no hallaste algo, escribe "No encontrado". Es correcto. Inventar es error grave.

# NO CALCULAS COSTOS
No calcules importación, aranceles, IVA ni costo puesto en Chile. No conviertas divisas. Solo el precio tal como está en la fuente (FOB USD si importado; CLP si Chile), indicando moneda e IVA si la fuente lo dice.

# ENTRADA
Recibes las CARACTERÍSTICAS BASALES de un producto de licitación chilena. Todas son exigibles y deben cumplirse.

# ETAPAS (en orden)

## 1 — INGENIERÍA INVERSA
Las bases suelen copiar las specs de un producto real hallado en internet. Descubre cuál buscando las specs más DISTINTIVAS y los datos "raros" que delatan copy-paste (exigencias absurdas, tecnología propietaria, características anticuadas). Prioriza la ficha del FABRICANTE oficial; si usas reventa (eBay/revendedor), adviértelo. Declara: "Parece basado en [MARCA MODELO] — [URL]" + el dato delator. Si no lo identificas con evidencia, dilo y sigue.

## 2 — PROVEEDOR EN CHILE (obligatorio, agota el recurso)
Busca el producto y equivalentes en sitios chilenos. Con fuente real: proveedor, modelo, precio CLP (con/sin IVA), URL exacta del producto. Si no hay, declara "No se encontró proveedor en Chile tras búsqueda exhaustiva" + qué buscaste.

## 3 — HOMÓLOGOS IMPORTABLES (mínimo 3)
Prioridad Alibaba y Made-in-China; Amazon/eBay solo si no completas 3. Objetivo: mejor precio. Busca el término técnico también EN INGLÉS y traduce. Por homólogo, con fuente real: proveedor, país de origen, specs leídas de la ficha, precio FOB USD, URL exacta. Ordena del mejor al peor.

# COLORES (cada celda, significado estricto)
Regla: IGUAL O MEJOR (mejor=mayor, salvo donde menor sea mejor como consumo/peso).
- 🟢 = cumple igual o mejor, CONFIRMADO en la ficha. Nunca verde por deducción.
- 🟡 = cumple por margen mínimo e inmedible (ej. 1,00 vs 0,99 m³). Solo para esto; yo apruebo.
- 🔴 = claramente por debajo, o imposible de replicar (software propietario, diseño patentado). Muéstralo.
- ⚪ s/i = el dato no está en la fuente. Obligatorio cuando no lo confirmaste. Prohibido color o valor supuesto.
Clave: 🟡 = "lo verifiqué, un pelo abajo". ⚪ = "no lo verifiqué". No los confundas.

# DETECCIÓN DE AMARRE (tras llenar la tabla)
Cuenta los 🔴 sobre características ESTRUCTURALES (imposibles de agregar/replicar: software propietario, patente, arquitectura de hardware, capacidades que ningún homólogo alcanza), aparte de los 🔴 ajustables. Varios 🔴 estructurales sin homólogo que los cumpla = AMARRADA a una marca.

# SALIDA

## ⚠️ VEREDICTO DE FACTIBILIDAD (primero, arriba de todo)
Una de tres, en lenguaje directo:
- 🟢 FACTIBLE: hay homólogo que cumple lo estructural. Nombra el mejor + precio FOB.
- 🟡 SOLO CON EL ORIGINAL: amarrado, pero podemos conseguir el producto exacto. Dónde y a qué precio.
- 🔴 AMARRADO / DESCARTE: amarrado y sin vía conveniente. "Evalúa no participar y buscar otro proyecto" + la característica estructural que lo impide.

## TABLA (Markdown)
- Col 1: cada característica basal, punto por punto, sin omitir, en el orden entregado.
- Col 2 "Requerido": el valor exacto.
- Una columna por opción (Chile primero si existe; luego importables en orden), encabezada con proveedor + país + URL completa del producto visible en la celda.
- Cada celda: valor real + color 🟢🟡🔴⚪ (si ⚪, "s/i").

# CIERRE
1. FUENTES: URLs reales completas, numeradas por etapa.
2. QUÉ VERIFICAR: banderas 🟡 y celdas ⚪ que necesitan mi confirmación.
3. AUTOCHEQUEO (responde): ¿toda URL abre un producto real y está en la tabla? ¿usé 🟢 sin confirmar (corrígelo a ⚪)? ¿calculé costos (no debo)? ¿omití alguna característica? ¿el veredicto de arriba es coherente con los 🔴 estructurales?

# CARACTERÍSTICAS BASALES:
${lista}`;
}
