// app/lib/anexos-ia-matching.ts
// Respaldo IA del diccionario de anexos (anexos-diccionario.ts): cuando una etiqueta detectada
// en el Word NO matchea ningún patrón determinista, se le pregunta a la misma IA que ya usan en
// viabilidad (GLM, vía gemini.ts) si corresponde a alguno de los campos que SÍ tenemos de la
// empresa — en vez de perseguir a mano cada variante de redacción con más regex, algo imposible
// de mantener para "cualquier licitación" de cualquier organismo.
//
// Se manda TODA la lista de etiquetas sin match en UNA sola llamada por documento (no una por
// campo) para controlar costo y latencia. Igual que el resto del sistema: nunca inventa — si la
// IA no está segura, o el campo pedido no lo tenemos, no lo asigna (queda para que el humano lo
// complete a mano).
//
// gemini.ts es server-only (arrastra node:async_hooks) — este módulo NUNCA se importa desde un
// Client Component, solo desde anexos-rellenar.ts (que a su vez solo corren las rutas /api/anexos).
import { crearChatIA } from '@/app/lib/gemini';
import { parseJsonIA } from '@/app/lib/json-ia';
import type { EmpresaCampos } from '@/app/lib/anexos-diccionario';

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

const CAMPOS_DISPONIBLES: { campo: keyof EmpresaCampos; descripcion: string }[] = [
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

// Devuelve SOLO las etiquetas que la IA logró asignar con confianza a un campo con dato real —
// las demás simplemente no aparecen en el resultado (quedan pendientes como hoy). Nunca lanza:
// si la IA falla, se degrada a "sin matches" en vez de romper el análisis/generación completa.
export async function matchearConIA(etiquetas: string[], empresa: EmpresaCampos): Promise<MatchIA[]> {
  if (etiquetas.length === 0) return [];
  const camposConDato = CAMPOS_DISPONIBLES.filter(c => empresa[c.campo] != null && String(empresa[c.campo]).trim());
  if (camposConDato.length === 0) return [];

  const user = `ETIQUETAS DETECTADAS EN EL FORMULARIO (${etiquetas.length}):
${etiquetas.map((e, i) => `${i + 1}. ${e}`).join('\n')}

CAMPOS DISPONIBLES DE LA EMPRESA:
${camposConDato.map(c => `- ${c.campo}: ${c.descripcion}`).join('\n')}`;

  try {
    const completion: any = await crearChatIA({
      messages: [{ role: 'system', content: SYS }, { role: 'user', content: user }],
      temperature: 0, stream: false, max_tokens: 3_000,
      response_format: { type: 'json_object' },
    }, { timeoutMs: 45_000 });

    const txt = String(completion.choices?.[0]?.message?.content ?? '');
    const parsed: any = parseJsonIA(txt) || {};
    const arr = Array.isArray(parsed.matches) ? parsed.matches : [];
    const camposValidos = new Set(camposConDato.map(c => c.campo));

    return arr
      .filter((m: any) => m && typeof m.etiqueta === 'string' && typeof m.campo === 'string')
      .filter((m: any) => camposValidos.has(m.campo))
      .map((m: any) => ({ etiqueta: m.etiqueta, campo: m.campo as keyof EmpresaCampos }));
  } catch (error) {
    console.error('[anexos-ia-matching] Falló el respaldo IA, sigue sin matchear:', String(error).slice(0, 200));
    return [];
  }
}
