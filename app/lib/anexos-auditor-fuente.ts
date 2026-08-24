// app/lib/anexos-auditor-fuente.ts
// Resuelve casillas de anexo TÉCNICO/COMERCIAL contra el AUDITOR (checklist_comercial +
// checklist_comercial_caracteristicas), en vez de contra el Costeo o la ficha de empresa.
//
// POR QUÉ (21-ago-2026, pedido explícito del usuario): el Auditor ya tiene, por licitación, la
// ficha técnica línea por línea (con lo exigido y lo ofertado, ya verificado) y la comercial
// (precio, plazo) — y esos datos YA pasaron por Aprobaciones antes de llegar acá. Generar el anexo
// desde ahí evita cargar el mismo dato dos veces (una en el Auditor, otra a mano en el Word) y
// garantiza que el anexo diga exactamente lo que el asesor visó.
//
// Confirmado contra 5 anexos técnicos reales de licitaciones distintas (ver conversación): hay DOS
// formas de columna, no una —
//   Patrón A — narrativa por línea: "Ítem/Línea | Especificaciones técnicas | Cant." — la celda de
//              especificaciones es un párrafo con TODAS las características pegadas.
//   Patrón B — matriz de cumplimiento: "Característica | SI | NO" — una fila por característica,
//              con una marca en la columna que corresponde al veredicto.
// Este módulo reconoce las dos por el ENCABEZADO de columna, igual criterio que ya usa
// anexos-precios-columnas.ts para reconocer una columna de precio unitario.
//
// LÍMITE HONESTO (v1): el patrón B matchea la característica contra TODAS las líneas de la
// licitación (no solo la línea del bloque donde vive la tabla) — si el mismo texto de
// característica aparece en más de una línea, se cuenta como ambiguo y queda pendiente. No lee
// todavía el título "Línea N°X" que antecede a la tabla como encabezado de sección.
//
// Módulo PURO (sin DB, sin red, sin IA) — mismo contrato que anexos-precios-ia.ts. Los datos ya
// vienen cargados y filtrados a ítems APROBADOS desde anexos-datos.ts
// (ver obtenerDatosAuditorParaAnexo).
import { normalizarParaMatchExacto } from '@/app/lib/anexos-precios-ia';

export interface CaracteristicaAuditor {
  descripcion: string;                    // "Fuerza Centrífuga máxima: 250 Kn / 52.600 Lb" (etiqueta: exigido)
  valorOfertadoTexto: string | null;
  valorOfertadoNumero: number | null;
  unidadRequerida: string | null;
  veredicto: string | null;               // CUMPLE | NO_CUMPLE | CUMPLE_CON_COMPLEMENTO | null
  pendienteConfirmacionProveedor: boolean; // el propio Auditor dice "esto no está confirmado" — nunca se estampa
}

export interface LineaTecnicaAuditor {
  lineaNumero: number | null;
  titulo: string;                         // "Línea 1 — Rodillo compactador de suelos"
  caracteristicas: CaracteristicaAuditor[];
}

export interface ItemComercialAuditor {
  lineaNumero: number | null;
  titulo: string;
  tipo: string;                           // 'precio' | 'dato'
  descripcion: string | null;             // trae "Cantidad: 310" para precios por línea
  valorTexto: string | null;
  valorNumero: number | null;
}

export interface DatosAuditorAnexo {
  lineasTecnicas: LineaTecnicaAuditor[];
  itemsComerciales: ItemComercialAuditor[];
}

export interface MatchAuditor { etiqueta: string; valor: string }

// ── Reconocer el ROL de una columna por su encabezado ──────────────────────────────────────────
const RE_COL_ESPECIFICACION = /especificaci|caracter[ií]stic|descripci[oó]n|detalle/i;
const RE_COL_CANTIDAD = /^cant\.?$|cantidad/i;
const RE_COL_SI = /^s[ií]$/i;
const RE_COL_NO = /^no$/i;
// La celda de un anexo TÉCNICO trae precio en muy pocos casos (el económico es aparte), pero
// cuando trae "Garantía"/"Plazo de entrega" como columna suelta (no una tabla por línea), esos se
// resuelven en resolverCamposSueltosConAuditor, no acá.

function extraerNumeroInicial(s: string): number | null {
  const m = String(s || '').match(/\d+/);
  return m ? parseInt(m[0], 10) : null;
}

function tituloSinPrefijoLinea(titulo: string): string {
  return titulo.replace(/^l[ií]nea\s*\d+\s*[—–-]\s*/i, '').trim();
}

/** Empareja el texto de la fila (número de línea, o nombre del producto) contra una línea real. */
function matchearLinea(datos: DatosAuditorAnexo, filaContexto: string): LineaTecnicaAuditor | null {
  const n = extraerNumeroInicial(filaContexto);
  if (n != null) {
    const porNumero = datos.lineasTecnicas.filter(l => l.lineaNumero === n);
    if (porNumero.length === 1) return porNumero[0];
  }
  const t = normalizarParaMatchExacto(filaContexto);
  if (!t) return null;
  const porTexto = datos.lineasTecnicas.filter(l => {
    const nombre = normalizarParaMatchExacto(tituloSinPrefijoLinea(l.titulo));
    return nombre && (t.includes(nombre) || nombre.includes(t));
  });
  return porTexto.length === 1 ? porTexto[0] : null;
}

/** La descripción trae "Etiqueta: valor exigido" (formato del Agente Técnico) — se usa solo la
 *  etiqueta; el valor real va aparte (lo OFERTADO, no lo exigido). */
function etiquetaDeCaracteristica(c: CaracteristicaAuditor): string {
  const m = c.descripcion.match(/^([^:]+):/);
  return (m ? m[1] : c.descripcion).trim();
}

/** Arma el párrafo de especificaciones de una línea, juntando lo YA aprobado — sin IA, código
 *  puro: los datos son la fuente, solo hay que darles formato de lista legible. */
function armarTextoEspecificaciones(linea: LineaTecnicaAuditor): string | null {
  const filas = linea.caracteristicas
    .filter(c => !c.pendienteConfirmacionProveedor && (c.valorOfertadoTexto || c.valorOfertadoNumero != null))
    .map(c => {
      const valor = c.valorOfertadoTexto ?? `${c.valorOfertadoNumero}${c.unidadRequerida ? ' ' + c.unidadRequerida : ''}`;
      return `${etiquetaDeCaracteristica(c)}: ${valor}`;
    });
  return filas.length ? filas.join('\n') : null;
}

function cantidadDeLinea(datos: DatosAuditorAnexo, lineaNumero: number | null): string | null {
  if (lineaNumero == null) return null;
  const item = datos.itemsComerciales.find(i => i.tipo === 'precio' && i.lineaNumero === lineaNumero);
  const m = item?.descripcion?.match(/Cantidad:\s*([\d.,]+)/i);
  return m ? m[1] : null;
}

// ── Patrón B: buscar UNA característica (de cualquier línea) por su texto ──────────────────────
function matchearCaracteristicaPorTexto(
  datos: DatosAuditorAnexo, textoFila: string,
): CaracteristicaAuditor | null {
  const t = normalizarParaMatchExacto(textoFila);
  if (!t) return null;
  const candidatas: CaracteristicaAuditor[] = [];
  for (const linea of datos.lineasTecnicas) {
    for (const c of linea.caracteristicas) {
      const etiqueta = normalizarParaMatchExacto(etiquetaDeCaracteristica(c));
      if (etiqueta && (t.includes(etiqueta) || etiqueta.includes(t))) candidatas.push(c);
    }
  }
  // Ambiguo (aparece en más de una línea con ese texto) → no se adivina, queda pendiente.
  return candidatas.length === 1 ? candidatas[0] : null;
}

/**
 * Resuelve candidatos de CELDA DE TABLA cuya etiqueta viene en formato "<fila> — <columna>"
 * (ver detectarCandidatosTabla en anexos-detectar.ts — es el mismo formato que ya usa el
 * matching de precios). Devuelve solo lo que pudo resolver con certeza.
 */
export function resolverTablaConAuditor(etiquetas: string[], datos: DatosAuditorAnexo): MatchAuditor[] {
  if (!datos.lineasTecnicas.length && !datos.itemsComerciales.length) return [];
  const resultados: MatchAuditor[] = [];

  for (const etiqueta of etiquetas) {
    const partes = etiqueta.split(' — ');
    if (partes.length < 2) continue; // sin columna reconocible, no es una celda de tabla por-línea
    const columna = partes[partes.length - 1].trim();
    const fila = partes.slice(0, -1).join(' — ').trim();

    if (RE_COL_ESPECIFICACION.test(columna)) {
      const linea = matchearLinea(datos, fila);
      const texto = linea ? armarTextoEspecificaciones(linea) : null;
      if (texto) resultados.push({ etiqueta, valor: texto });
      continue;
    }
    if (RE_COL_CANTIDAD.test(columna)) {
      const linea = matchearLinea(datos, fila);
      const cant = linea ? cantidadDeLinea(datos, linea.lineaNumero) : null;
      if (cant) resultados.push({ etiqueta, valor: cant });
      continue;
    }
    // Patrón B: la COLUMNA es la respuesta binaria (SI/NO) y la FILA es la característica misma.
    if (RE_COL_SI.test(columna) || RE_COL_NO.test(columna)) {
      const caracteristica = matchearCaracteristicaPorTexto(datos, fila);
      if (!caracteristica || !caracteristica.veredicto || caracteristica.pendienteConfirmacionProveedor) continue;
      const cumple = caracteristica.veredicto === 'CUMPLE' || caracteristica.veredicto === 'CUMPLE_CON_COMPLEMENTO';
      const marcaEstaColumna = RE_COL_SI.test(columna) ? cumple : !cumple;
      if (marcaEstaColumna) resultados.push({ etiqueta, valor: 'X' });
      // Si esta columna NO es la que corresponde, se deja pendiente (no se escribe nada) — la
      // columna correcta la resuelve la misma pasada, en su propia iteración.
    }
  }
  return resultados;
}

// ── Campos sueltos del bloque COMERCIAL (no son tabla): plazo, garantía técnica del producto ────
// OJO: la garantía TÉCNICA del producto (bloque comercial/técnico) es distinta de la garantía de
// FIEL CUMPLIMIENTO (bloque administrativo, boleta) — nunca se cruzan.
const RE_PLAZO_ENTREGA = /plazo.*entrega/i;
const RE_GARANTIA_PRODUCTO = /garant[ií]a.*(equipo|producto|t[eé]cnica)|garant[ií]a\s*$/i;

export function resolverCamposSueltosConAuditor(etiquetas: string[], datos: DatosAuditorAnexo): MatchAuditor[] {
  const resultados: MatchAuditor[] = [];
  const plazo = datos.itemsComerciales.find(i => i.tipo === 'dato' && RE_PLAZO_ENTREGA.test(i.titulo));
  const garantia = datos.itemsComerciales.find(i => i.tipo === 'dato' && RE_GARANTIA_PRODUCTO.test(i.titulo));

  for (const etiqueta of etiquetas) {
    if (plazo?.valorTexto && RE_PLAZO_ENTREGA.test(etiqueta)) {
      resultados.push({ etiqueta, valor: plazo.valorTexto });
    } else if (garantia?.valorTexto && RE_GARANTIA_PRODUCTO.test(etiqueta)) {
      resultados.push({ etiqueta, valor: garantia.valorTexto });
    }
  }
  return resultados;
}

/** Precio por línea del bloque COMERCIAL — mismo rol que matchearPreciosConIA pero desde el
 *  Auditor ya aprobado en vez del Costeo. Se intenta ANTES que el Costeo (ver anexos-rellenar.ts):
 *  si el Auditor ya tiene el precio visado, es más autoritativo que la planilla que lo calculó. */
export function resolverPreciosConAuditor(etiquetas: string[], datos: DatosAuditorAnexo): MatchAuditor[] {
  if (!datos.itemsComerciales.length) return [];
  const resultados: MatchAuditor[] = [];
  for (const etiqueta of etiquetas) {
    const partes = etiqueta.split(' — ');
    if (partes.length < 2) continue;
    const fila = partes.slice(0, -1).join(' — ').trim();
    const t = normalizarParaMatchExacto(fila);
    if (!t) continue;
    const candidatos = datos.itemsComerciales.filter(i => {
      if (i.tipo !== 'precio' || i.valorNumero == null) return false;
      const nombre = normalizarParaMatchExacto(tituloSinPrefijoLinea(i.titulo));
      return nombre && (t.includes(nombre) || nombre.includes(t));
    });
    if (candidatos.length === 1) {
      resultados.push({ etiqueta, valor: new Intl.NumberFormat('es-CL', { maximumFractionDigits: 0 }).format(candidatos[0].valorNumero!) });
    }
  }
  return resultados;
}
