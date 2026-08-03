// app/lib/anexos-ia-total.ts
// Resolución de campos 100% por IA (decisión del usuario, 3-ago-2026): la IA decide QUÉ VALOR va
// en CADA casilla, sin diccionario de regex de por medio. Reemplaza a resolverCandidatosCelda
// (diccionario → respaldo IA) cuando el flag ANEXOS_IA_TOTAL está activo.
//
// Por qué se cambió: el diccionario tocó su techo. Medido en el ANEXO Nº1-6 de 1057472-89-LE26,
// resolvía 22 casillas y la IA aportaba CERO — no porque fallara, sino por dos frenos del diseño
// viejo que acá desaparecen:
//   1. El veto de campos ya usados (`camposUsadosPorIA`): un campo que el diccionario gastó en el
//      ANEXO N°1 quedaba prohibido para el resto del documento, aunque los anexos 2 al 6 pidan
//      legítimamente el MISMO dato. Acá un campo se puede repetir tantas veces como el documento
//      lo pida, que es lo normal en un Word con 6 formularios pegados.
//   2. Cada variante de redacción nueva ("RUT DEL REPRESENTANTE" sin la palabra "legal", "Nº
//      Cédula de Identidad" con el N° adelante) había que parcharla a mano con otra regex. Eso no
//      escala a "cualquier organismo".
//
// LO QUE NO CAMBIA: la ESCRITURA sigue siendo 100% determinista (anexos-docx.ts edita el <w:t>
// del run existente). La IA nunca toca el .docx ni decide maquetación — solo dice "en la casilla
// 47 va este texto". El formato, los logos y las tablas del organismo quedan intactos.
//
// GUARDA ANTI-INVENCIÓN: la IA elige, pero no escribe libre. Todo valor que devuelve tiene que
// existir en la ficha de la empresa (comparado normalizado) o ser la fecha de hoy; si devuelve
// algo que no calza con ningún dato real, se descarta y la casilla queda pendiente. Sin esto, un
// modelo que "ayuda" rellenando una nacionalidad o un capital social que nadie le dio metería
// datos falsos en un documento que se presenta al Estado.
//
// gemini.ts es server-only (arrastra node:async_hooks) — este módulo NUNCA se importa desde un
// Client Component, solo desde anexos-rellenar.ts.
import { crearChatIA } from '@/app/lib/gemini';
import { parseJsonIA } from '@/app/lib/json-ia';
import { esMatchCoherente, type EmpresaCampos } from '@/app/lib/anexos-diccionario';
import type { Parrafo } from '@/app/lib/anexos-docx';
import type { CandidatoCelda } from '@/app/lib/anexos-detectar';

// Mismo tamaño que anexos-clasificar-ia.ts y por la misma razón medida en vivo: cada candidato
// carga varios párrafos de contexto, así que un lote grande satura el prompt y el modelo empieza
// a fallar hasta en casos triviales.
const TAMANO_LOTE = 8;
const CANTIDAD_PARRAFOS_PREVIOS = 6;

function enLotes<T>(items: T[], tamano: number): T[][] {
  const lotes: T[][] = [];
  for (let i = 0; i < items.length; i += tamano) lotes.push(items.slice(i, i + tamano));
  return lotes;
}

// Los últimos N párrafos NO vacíos antes del candidato: es el contexto que un humano leería para
// saber "¿de quién es este dato y en qué bloque estoy?" — incluye los encabezados de sección
// ("REPRESENTANTE LEGAL:", "A.- IDENTIFICACIÓN PARA PERSONA NATURAL", "DATOS ENCARGADO DE LA
// PROPUESTA"), que es justo lo que el prompt necesita para decidir bien.
function contextoPrevio(parrafos: Parrafo[], antesDeIndice: number): string[] {
  const out: string[] = [];
  for (let i = antesDeIndice - 1; i >= 0 && out.length < CANTIDAD_PARRAFOS_PREVIOS; i--) {
    const p = parrafos[i];
    if (p?.texto && !p.vacio) out.push(p.texto);
  }
  return out.reverse();
}

// Etiquetas legibles para el prompt: la IA razona mucho mejor sobre "Correo electrónico de la
// empresa" que sobre "email1".
const DESCRIPCION_CAMPO: Partial<Record<keyof EmpresaCampos, string>> = {
  razon_social: 'Razón social / nombre de la empresa que postula',
  rut: 'RUT de la empresa',
  direccion: 'Dirección comercial de la empresa',
  region: 'Región de la empresa',
  giro: 'Giro comercial de la empresa',
  tipo_persona_juridica: 'Tipo de persona jurídica',
  fecha_sociedad: 'Datos de constitución de la sociedad (fecha, tipo, notaría)',
  representante_nombre: 'Nombre completo del representante legal',
  representante_rut: 'RUT / cédula de identidad del representante legal',
  representante_cargo: 'Cargo del representante legal',
  email1: 'Correo electrónico de la empresa',
  telefono1: 'Teléfono de la empresa',
  banco_tipo_cuenta: 'Tipo de cuenta bancaria',
  banco_numero: 'Número de cuenta bancaria',
  banco_nombre: 'Nombre del banco',
  banco_email: 'Correo electrónico para pagos / notificaciones bancarias',
  fecha_hoy: 'Fecha de hoy — con la que se firma y presenta esta oferta',
};

const SYS = `Eres un experto en licitaciones públicas chilenas (Mercado Público) que completa los ANEXOS que el organismo comprador entrega en Word para que los llene el oferente.

Te doy:
1. La FICHA de la empresa que postula, con sus datos reales.
2. Una lista NUMERADA de CASILLAS EN BLANCO detectadas en el documento. Cada casilla trae su etiqueta y el CONTEXTO real que la rodea: la fila y columna si viene de una tabla, y los párrafos que la preceden (donde suelen estar los encabezados de bloque: "REPRESENTANTE LEGAL:", "DATOS DEL ENCARGADO", "A.- PARA PERSONA NATURAL", etc.).

Para cada casilla decide QUÉ DATO de la ficha corresponde escribir ahí, o ninguno.

REGLA CLAVE — UNA SOLA PERSONA:
En esta empresa el OFERENTE, el PROPONENTE, el REPRESENTANTE LEGAL, el ENCARGADO DE LA PROPUESTA, el CONTACTO para efectos de la licitación y el ADMINISTRADOR DE CONTRATO son SIEMPRE LA MISMA PERSONA: la que está en la ficha. Si un bloque pide "Nombre completo", "Cargo o función", "Cédula de identidad", "Teléfono" o "Correo" bajo cualquiera de esos títulos, se llena con los datos del representante legal / de la empresa según el dato pedido. No lo dejes pendiente por dudar de quién es.

CUÁNDO **NO** LLENAR (importante — es peor un dato equivocado que uno pendiente):
- La casilla pertenece a un bloque de PERSONA NATURAL o de UNIÓN TEMPORAL DE PROVEEDORES (UTP). Esta empresa postula como PERSONA JURÍDICA individual: esos bloques van en blanco. Fíjate en los párrafos previos para saber en qué bloque estás.
- El dato es de un TERCERO ajeno: otro integrante de una UTP, el organismo comprador o mandante, un cliente anterior tuyo (tablas de "experiencia", "referencias", "contratos anteriores"), un socio o accionista, un inspector técnico.
- El dato NO ESTÁ en la ficha (nacionalidad, estado civil, profesión, fax, ciudad, notaría, capital social, número de empleados). NO lo inventes ni lo deduzcas de otro campo: déjalo sin asignar.
- Es un encabezado, un título de sección o un nombre de columna, sin un dato propio que pedir.
- Es una casilla de precio, cantidad, plazo, o de cumplimiento técnico de un producto: eso no sale de la ficha de la empresa.
- Es una línea de firma o de "Ciudad y fecha" que exige la ciudad (no la tenemos).

QUE UN DATO SE REPITA ES NORMAL Y CORRECTO: un mismo Word suele traer 6 anexos pegados que piden la razón social y el RUT cada uno por separado. Llena TODAS las veces que aparezca. No "ahorres" un dato porque ya lo usaste en otra casilla.

LA PRUEBA QUE DEBES APLICAR A CADA CASILLA, SIN EXCEPCIÓN:
¿La ETIQUETA MISMA nombra el dato que vas a escribir? Tiene que decir explícitamente razón social / nombre / RUT / cédula / dirección / domicilio / teléfono / correo / cargo / giro / región / banco / cuenta / fecha. Si la etiqueta describe otra cosa —una característica de un producto, un requisito técnico, una pregunta, una casilla de "Cumple Sí/No", "Observaciones", "Marca", "Modelo", "Página/Catálogo", "Evaluación", un ítem de una lista numerada— la respuesta es null. SIEMPRE.
Ejemplos de lo que NUNCA se llena con datos de la empresa: "Cumple (Sí/No)", "B) ES LIBRE DE LATEX", "Material: Polipropileno", "Observaciones del Proveedor", "Evaluación Funcional", "Interfaz intuitiva de usuario", "Capacitación", "Marca", "Modelo".

LA MAYORÍA DE LAS CASILLAS DE UN ANEXO **NO** SE LLENAN CON DATOS DE LA EMPRESA. En un anexo con tabla técnica, lo normal es que el 80% o más sean null. Devolver muchos null NO es un error tuyo: es la respuesta correcta. Un dato de la empresa escrito en una casilla técnica arruina el documento completo.

Devuelve SOLO JSON, sin markdown ni texto adicional. Responde por TODAS las casillas que te di, en orden, cada una con su campo o con null:
{"casillas":[{"id":<número de la casilla>,"campo":"<campo exacto de la ficha>"|null}]}`;

export interface ResueltoIA { indice: number; campo: keyof EmpresaCampos; valor: string }

function formatearCandidato(c: CandidatoCelda, parrafos: Parrafo[], n: number): string {
  const partes: string[] = [];
  const compuesta = c.etiqueta.match(/^(.+?)\s+—\s+(.+)$/);
  if (compuesta) {
    partes.push(`etiqueta: "${compuesta[2]}"`, `fila/bloque: "${compuesta[1]}"`);
  } else {
    partes.push(`etiqueta: "${c.etiqueta}"`);
  }
  const previos = contextoPrevio(parrafos, c.indice - 1);
  if (previos.length) partes.push(`texto anterior (del más lejano al más cercano): ${previos.map(p => `"${p.slice(0, 160)}"`).join(' / ')}`);
  return `${n}. ${partes.join(' — ')}`;
}

// Normaliza para comparar el valor devuelto por la IA contra los datos reales de la ficha: sin
// tildes, sin puntuación, minúsculas y con los espacios colapsados. Un RUT escrito "76902659-2"
// tiene que reconocerse como el mismo que "76.902.659-2".
function normalizarValor(v: string): string {
  return v.normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/[^\w@]+/g, '').trim();
}

async function resolverLote(
  items: CandidatoCelda[], parrafos: Parrafo[], empresa: EmpresaCampos,
  camposConDato: (keyof EmpresaCampos)[],
): Promise<ResueltoIA[]> {
  const ficha = camposConDato
    .map(c => `- ${c}: "${String(empresa[c])}"   (${DESCRIPCION_CAMPO[c] ?? c})`)
    .join('\n');

  const user = `FICHA DE LA EMPRESA QUE POSTULA:
${ficha}

CASILLAS EN BLANCO A DECIDIR (${items.length}):
${items.map((c, i) => formatearCandidato(c, parrafos, i + 1)).join('\n')}`;

  try {
    const completion: any = await crearChatIA({
      messages: [{ role: 'system', content: SYS }, { role: 'user', content: user }],
      temperature: 0, stream: false, max_tokens: 4_000,
      response_format: { type: 'json_object' },
    }, { timeoutMs: 60_000 });

    const txt = String(completion.choices?.[0]?.message?.content ?? '');
    const parsed: any = parseJsonIA(txt) || {};
    const arr = Array.isArray(parsed.casillas) ? parsed.casillas : [];

    const validos = new Set(camposConDato as string[]);
    const out: ResueltoIA[] = [];
    for (const r of arr) {
      if (!r) continue;
      const i = Number(r.id);
      const campo = String(r.campo || '') as keyof EmpresaCampos;
      const item = items[i - 1];
      // Fuera de rango o campo inventado → se descarta, nunca se adivina.
      if (!item || !Number.isInteger(i) || !validos.has(campo as string)) continue;
      const valor = empresa[campo];
      if (valor == null || !String(valor).trim()) continue;
      // GUARDARRAÍL ANTI-BASURA. La IA sigue decidiendo QUÉ campo va en cada casilla; esto solo
      // descarta los pares IMPOSIBLES — que la etiqueta no mencione ni de lejos el dato propuesto.
      // No es opcional: medido sobre estos 3 documentos, sin él la IA metía datos de la empresa en
      // 37 casillas técnicas ("Cumple (Sí/No)" → nombre del representante, "B) ES LIBRE DE LATEX"
      // → giro, "Página, Catálogo" → fecha). Un anexo así es peor que uno en blanco: se presenta
      // al Estado con respuestas absurdas en la tabla de especificaciones.
      if (!esMatchCoherente(item.etiqueta, campo)) {
        console.warn(`[anexos-ia-total] descartado por incoherente: "${item.etiqueta.slice(0, 60)}" → ${campo}`);
        continue;
      }
      out.push({ indice: item.indice, campo, valor: String(valor) });
    }
    return out;
  } catch (error) {
    console.error('[anexos-ia-total] Falló un lote, esas casillas quedan pendientes:', String(error).slice(0, 200));
    return [];
  }
}

// Resuelve TODAS las casillas del documento por IA. Nunca lanza: si un lote falla, esas casillas
// quedan pendientes para que las llene un humano, sin tumbar el resto del análisis.
export async function resolverTodoConIA(
  candidatos: CandidatoCelda[], parrafos: Parrafo[], empresa: EmpresaCampos,
): Promise<Map<number, { campo: keyof EmpresaCampos; valor: string }>> {
  const camposConDato = (Object.keys(empresa) as (keyof EmpresaCampos)[])
    .filter(c => c !== 'firma_url' && empresa[c] != null && String(empresa[c]).trim());
  const mapa = new Map<number, { campo: keyof EmpresaCampos; valor: string }>();
  if (!candidatos.length || !camposConDato.length) return mapa;

  const resultados = await Promise.all(
    enLotes(candidatos, TAMANO_LOTE).map(lote => resolverLote(lote, parrafos, empresa, camposConDato)),
  );
  // SIN veto por campo repetido — a diferencia del camino viejo, un mismo dato se escribe tantas
  // veces como el documento lo pida (ver cabecera).
  for (const r of resultados.flat()) mapa.set(r.indice, { campo: r.campo, valor: r.valor });
  return mapa;
}

// Exportado solo para pruebas del banco: verifica que un valor propuesto exista de verdad en la
// ficha (la guarda anti-invención descrita en la cabecera).
export function valorExisteEnFicha(valor: string, empresa: EmpresaCampos): boolean {
  const n = normalizarValor(valor);
  if (!n) return false;
  return Object.values(empresa).some(v => v != null && normalizarValor(String(v)) === n);
}
