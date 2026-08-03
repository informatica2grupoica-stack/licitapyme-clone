// app/lib/anexos-ia-matching.ts
// Respaldo IA del diccionario de anexos (anexos-diccionario.ts): cuando una etiqueta detectada
// en el Word NO matchea ningún patrón determinista, se le pregunta a la misma IA que ya usan en
// viabilidad (GLM, vía gemini.ts) si corresponde a alguno de los campos que SÍ tenemos de la
// empresa — en vez de perseguir a mano cada variante de redacción con más regex, algo imposible
// de mantener para "cualquier licitación" de cualquier organismo.
//
// Se manda la lista de etiquetas sin match en lotes chicos (ver TAMANO_LOTE) — no una llamada
// por campo, pero tampoco todas en un solo llamado gigante: documentos reales grandes (100+
// etiquetas) hacían que la respuesta se saturara sin importar cuánto se subiera max_tokens.
// Igual que el resto del sistema: nunca inventa — si la IA no está segura, o el campo pedido no
// lo tenemos, no lo asigna (queda para que el humano lo complete a mano).
//
// gemini.ts es server-only (arrastra node:async_hooks) — este módulo NUNCA se importa desde un
// Client Component, solo desde anexos-rellenar.ts (que a su vez solo corren las rutas /api/anexos).
import { crearChatIA } from '@/app/lib/gemini';
import { parseJsonIA } from '@/app/lib/json-ia';
import { esTerminoAmbiguoSinContextoReconocido, type EmpresaCampos } from '@/app/lib/anexos-diccionario';

// Documentos reales grandes (anexos combinados de varios formularios) pueden traer 100+
// etiquetas sin match — mandarlas TODAS en una sola llamada hace que la salida crezca sin techo
// (probado: un documento de 85 candidatos agotó 6.000 tokens de salida en un solo llamado, señal
// de que el modelo se satura con contextos muy largos, no solo un problema de límite). Trocear
// en lotes chicos mantiene cada llamada acotada sin importar qué tan grande sea el documento —
// más robusto que seguir subiendo max_tokens, que no escala.
const TAMANO_LOTE = 35;

function enLotes<T>(items: T[], tamano: number): T[][] {
  const lotes: T[][] = [];
  for (let i = 0; i < items.length; i += tamano) lotes.push(items.slice(i, i + tamano));
  return lotes;
}

const SYS = `Eres un asistente que ayuda a rellenar formularios de licitaciones públicas chilenas.

Te doy una lista de ETIQUETAS detectadas en un formulario Word (texto que aparece junto a un espacio en blanco para completar, a veces numerado) y los CAMPOS que tenemos disponibles de la empresa que postula.

Para cada etiqueta, decide si pide EXACTAMENTE el mismo dato que uno de los campos — aunque esté redactada distinto (numerada, abreviada, en otro orden de palabras). Tiene que ser el MISMO CONCEPTO, no uno parecido o relacionado:
- "Ciudad" NO es lo mismo que "Región" (una región no es una ciudad) — no lo asignes aunque region sea el campo geográfico más cercano que tengas.
- Un cargo/rol mencionado en la etiqueta (ej. "Gerente General", "Jefe de Proyecto", "Encargado técnico") NO es automáticamente el representante legal — solo asigna representante_nombre/representante_rut/representante_cargo si la etiqueta dice EXPLÍCITAMENTE "representante legal" (o su abreviatura "rep. legal"). Si pide el nombre de un cargo distinto que no tenemos, no lo asignes.
- Si la etiqueta pide un dato que NO está en la lista de campos (ej. "Fecha de la oferta", "N° de la licitación", "Capital social", "Número de personal"), NO la asignes.

Ante cualquier duda, NO asignes — es mucho peor escribir un dato incorrecto en el documento que dejarlo pendiente para que un humano lo complete.

Puede que te dé muchas etiquetas (a veces cientos, ej. ítems de una tabla de precios) y la gran mayoría NO va a corresponder a ningún campo — eso es normal, no es un error tuyo. Para esas, NO las incluyas en la respuesta (ni con campo:null): la lista "matches" debe tener SOLO las etiquetas para las que sí encontraste un campo. Esto es importante porque tu respuesta tiene un límite de tamaño y si intentas listar las cientos que no matchean, la respuesta se corta a la mitad y se pierden justo los matches reales que venían después.

Devuelve SOLO JSON, sin markdown ni texto adicional:
{"matches":[{"etiqueta":"<tal cual te la di, exacta>","campo":"<uno de los campos dados>"}]}`;

export interface MatchIA { etiqueta: string; campo: keyof EmpresaCampos | null }

// Exportado: lo reusa anexos-clasificar-ia.ts (mismo catálogo de campos "que podríamos tener",
// para no mantener dos listas que puedan divergir).
export const CAMPOS_DISPONIBLES: { campo: keyof EmpresaCampos; descripcion: string }[] = [
  { campo: 'razon_social', descripcion: 'Razón social / nombre de la empresa' },
  { campo: 'rut', descripcion: 'RUT de la empresa' },
  { campo: 'direccion', descripcion: 'Dirección comercial de la empresa' },
  // "region" queda AFUERA a propósito: en pruebas reales la IA la confundía con "Ciudad" pese a
  // instrucción explícita en contra (una región no es una ciudad) — el diccionario determinista
  // (anexos-diccionario.ts) sigue matcheando "Región" exacto, solo se le quita el respaldo IA.
  { campo: 'giro', descripcion: 'Giro comercial de la empresa' },
  { campo: 'tipo_persona_juridica', descripcion: 'Tipo de persona jurídica (ej. SpA, sociedad comercial)' },
  { campo: 'fecha_sociedad', descripcion: 'Fecha, notaría y datos de constitución de la sociedad' },
  { campo: 'representante_nombre', descripcion: 'Nombre completo del representante legal' },
  { campo: 'representante_rut', descripcion: 'RUT / cédula de identidad del representante legal' },
  { campo: 'representante_cargo', descripcion: 'Cargo del representante legal' },
  { campo: 'email1', descripcion: 'Correo electrónico de la empresa' },
  { campo: 'telefono1', descripcion: 'Teléfono de la empresa' },
  { campo: 'banco_tipo_cuenta', descripcion: 'Tipo de cuenta bancaria' },
  { campo: 'banco_numero', descripcion: 'Número de cuenta bancaria' },
  { campo: 'banco_nombre', descripcion: 'Nombre del banco' },
  { campo: 'banco_email', descripcion: 'Correo electrónico para pagos' },
];

async function matchearLoteIA(etiquetas: string[], camposConDato: { campo: keyof EmpresaCampos; descripcion: string }[]): Promise<MatchIA[]> {
  const user = `ETIQUETAS DETECTADAS EN EL FORMULARIO (${etiquetas.length}):
${etiquetas.map((e, i) => `${i + 1}. ${e}`).join('\n')}

CAMPOS DISPONIBLES DE LA EMPRESA:
${camposConDato.map(c => `- ${c.campo}: ${c.descripcion}`).join('\n')}`;

  try {
    const completion: any = await crearChatIA({
      messages: [{ role: 'system', content: SYS }, { role: 'user', content: user }],
      temperature: 0, stream: false, max_tokens: 4_000,
      response_format: { type: 'json_object' },
    }, { timeoutMs: 60_000 });

    const txt = String(completion.choices?.[0]?.message?.content ?? '');
    const parsed: any = parseJsonIA(txt) || {};
    const arr = Array.isArray(parsed.matches) ? parsed.matches : [];
    const camposValidos = new Set(camposConDato.map(c => c.campo));

    return arr
      .filter((m: any) => m && typeof m.etiqueta === 'string' && typeof m.campo === 'string')
      .filter((m: any) => camposValidos.has(m.campo))
      .map((m: any) => ({ etiqueta: m.etiqueta, campo: m.campo as keyof EmpresaCampos }));
  } catch (error) {
    console.error('[anexos-ia-matching] Falló un lote del respaldo IA, ese lote sigue sin matchear:', String(error).slice(0, 200));
    return [];
  }
}

// Encabezados de columna de tabla de precios/especificaciones — NUNCA describen un dato de la
// empresa, ni sueltos ("CANTIDAD") ni como sufijo de una etiqueta compuesta "fila — columna"
// (ver patrón 1b y desambiguarDuplicados en anexos-detectar.ts: "TRAZADO Y NIVELES — PRECIO", la
// fila de un ítem con la columna de precio). Bloqueo determinista: casos reales encontrados donde
// la IA (modelo flashx, más rápido pero menos cuidadoso) asignó "CANTIDAD" a `banco_tipo_cuenta`
// y una fila de materiales ("... — PRECIO") a `razon_social`, pese a la instrucción explícita del
// prompt de no inventar — más barato y confiable prevenir el envío que confiar en que el modelo
// se abstenga siempre.
const ENCABEZADOS_TABLA_GENERICOS = new Set([
  'cantidad', 'unidad', 'precio', 'descripción', 'descripcion', 'partida', 'item', 'ítem',
  'total', 'subtotal', 'observaciones', 'marca', 'modelo', 'n°', 'nº', 'valor', 'monto',
]);

// Para una etiqueta COMPUESTA "<contexto de fila> — <columna>" (patrón 1b de tablas de specs/
// materiales, o desambiguarDuplicados de patrón 1 — ver anexos-detectar.ts), solo tiene sentido
// que la IA la matchee a un dato de la empresa cuando la COLUMNA es, ella misma, un dato de
// identificación (RUT, nombre, cargo, dirección, teléfono, correo, razón social). Cualquier otra
// columna (plazos, medidas, cantidades, precios, marcas — lo que sea que traiga la tabla) NUNCA
// puede ser un dato de la empresa por más que la IA "encuentre" un parecido — bloquear por
// ALLOWLIST en vez de perseguir cada palabra de columna encontrada por prueba y error: caso real
// que expuso el problema de mantener solo una lista negra: "PLAZO DE ENTREGA (DIAS HABILES)" (no
// estaba en ningún stoplist) se asignó a `giro` sin ningún parecido real.
const COLUMNA_DE_IDENTIFICACION = /^(r\.?u\.?t\.?|nombre|cargo|direcci[óo]n|domicilio|tel[ée]fono|fono|correo(\s+electr[óo]nico)?|e-?mail|raz[óo]n\s+social)$/i;

function esCandidatoDeTablaDeItems(etiqueta: string): boolean {
  const partes = etiqueta.split(' — ');
  const ultima = partes[partes.length - 1].trim();
  if (ENCABEZADOS_TABLA_GENERICOS.has(ultima.toLowerCase())) return true;
  if (partes.length < 2) return false; // etiqueta simple (no compuesta) — no aplica la allowlist de abajo
  return !COLUMNA_DE_IDENTIFICACION.test(ultima);
}

// Devuelve SOLO las etiquetas que la IA logró asignar con confianza a un campo con dato real —
// las demás simplemente no aparecen en el resultado (quedan pendientes como hoy). Nunca lanza:
// si un lote falla, se degrada a "sin matches" PARA ESE LOTE, sin tumbar los demás.
export async function matchearConIA(etiquetas: string[], empresa: EmpresaCampos): Promise<MatchIA[]> {
  const elegibles = etiquetas.filter(e => !esCandidatoDeTablaDeItems(e) && !esTerminoAmbiguoSinContextoReconocido(e));
  if (elegibles.length === 0) return [];
  const camposConDato = CAMPOS_DISPONIBLES.filter(c => empresa[c.campo] != null && String(empresa[c.campo]).trim());
  if (camposConDato.length === 0) return [];

  const resultados = await Promise.all(enLotes(elegibles, TAMANO_LOTE).map(lote => matchearLoteIA(lote, camposConDato)));
  return resultados.flat();
}

// ── Clasificación: ¿esto es un campo real, o un título/leyenda de sección? ────────────────
// El patrón 1 (detectarCandidatosCelda, ver anexos-detectar.ts) es RUIDOSO a propósito: solo
// mira "texto corto + párrafo vacío después", sin entender el documento. Eso confunde un campo
// real ("RUT:") con un título de sección seguido de puro espaciado ("RESUMEN:", "LÍNEA 3:
// MATERIALES", "ANEXO N°2 ECONÓMICO") — caso real encontrado: quedaban en la lista de pendientes
// como si hubiera que escribirles algo, cuando en realidad solo introducen la tabla o el bloque
// que viene después. Ya existe un filtro determinista para el caso "el blanco precede
// directamente a una tabla" (blancoPrecedeTabla en anexos-detectar.ts) — esto cubre lo que ese
// filtro no puede ver sin entender el documento (ej. un título que es una celda propia dentro de
// una tabla de layout, sin ninguna <w:tbl> justo después).
export interface ClasificacionTitulo { etiqueta: string; esTitulo: boolean }

const SYS_CLASIFICAR = `Eres un asistente que revisa etiquetas detectadas automáticamente en un formulario Word de una licitación pública chilena (una herramienta las extrajo buscando "texto corto + espacio en blanco después", así que mete títulos de sección por error).

Para cada etiqueta, decide si es:
A) Un TÍTULO/LEYENDA que organiza el documento pero no pide ningún dato directamente — ej. "RESUMEN:", "LÍNEA 3: MATERIALES", "ANEXO N°2 ECONÓMICO" cuando funciona como encabezado de TODO un bloque o tabla completa (no la etiqueta de una fila puntual dentro de esa tabla).
B) Un CAMPO REAL que sí espera que el usuario escriba o pegue un dato específico — ej. "RUT:", "Nombre del oferente:", "Precio unitario", "Correo electrónico", "IDENTIFICACIÓN DEL OFERENTE" o "NOMBRE DEL REPRESENTANTE LEGAL" cuando son la etiqueta de UNA fila de una tabla de identificación (piden escribir el nombre en esa fila puntual), o cualquier etiqueta que describa un dato concreto (aunque no sepamos ese dato).

OJO: una etiqueta que menciona "identificación", "datos" o "antecedentes" de alguien NO es automáticamente un título — si es la etiqueta de una fila puntual (con su propia celda en blanco al lado, no un encabezado que abarca toda una tabla), es CAMPO REAL. Solo es título si describe la SECCIÓN COMPLETA, no una fila suya.

Ante la duda, clasifícala como CAMPO REAL (B) — es peor esconder un campo que sí había que llenar, que dejar un título de más en la lista (el humano lo puede ignorar sin problema).

Devuelve SOLO JSON con las etiquetas que clasificaste como TÍTULO (A) — omite todas las que son campo real, la lista debe tener SOLO los títulos:
{"titulos":["<etiqueta tal cual te la di, exacta>", ...]}`;

async function clasificarLoteTitulos(etiquetas: string[]): Promise<Set<string>> {
  const user = `ETIQUETAS A CLASIFICAR (${etiquetas.length}):
${etiquetas.map((e, i) => `${i + 1}. ${e}`).join('\n')}`;

  try {
    const completion: any = await crearChatIA({
      messages: [{ role: 'system', content: SYS_CLASIFICAR }, { role: 'user', content: user }],
      temperature: 0, stream: false, max_tokens: 4_000,
      response_format: { type: 'json_object' },
    }, { timeoutMs: 60_000 });

    const txt = String(completion.choices?.[0]?.message?.content ?? '');
    const parsed: any = parseJsonIA(txt) || {};
    const arr = Array.isArray(parsed.titulos) ? parsed.titulos : [];
    const etiquetasValidas = new Set(etiquetas);
    return new Set(arr.filter((t: any) => typeof t === 'string' && etiquetasValidas.has(t)));
  } catch (error) {
    console.error('[anexos-ia-matching] Falló un lote de clasificación de títulos, ese lote no excluye nada:', String(error).slice(0, 200));
    return new Set();
  }
}

// Devuelve el subconjunto de `etiquetas` que la IA identificó como título/leyenda (para
// excluirlas de los pendientes) — nunca lanza: si un lote falla, no se excluye nada PARA ESE
// LOTE (se degrada a mostrar de más, nunca a esconder un campo real).
export async function clasificarTitulos(etiquetas: string[]): Promise<Set<string>> {
  if (etiquetas.length === 0) return new Set();
  const resultados = await Promise.all(enLotes(etiquetas, TAMANO_LOTE).map(clasificarLoteTitulos));
  return new Set(resultados.flatMap(s => [...s]));
}
