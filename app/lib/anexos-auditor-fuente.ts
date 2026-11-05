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

/** Una línea del Auditor NUEVO (auditor_opcion + comparador técnico), lista para la ficha de
 *  especificaciones del anexo técnico. `opcion` es la opción APROBADA de la línea; sin ella, todo
 *  queda pendiente y `motivo` dice por qué (lo que ve el equipo en el anexo). */
export interface FichaLineaAuditor {
  lineaNumero: number | null;
  producto: string;                       // "Camilla de Transporte"
  opcion: {
    marca: string | null; modelo: string | null; fabricante: string | null; pais: string | null; anio: string | null;
    documento: string | null;             // la ficha técnica que respalda (nombre del archivo)
  } | null;
  requisitos: Array<{ texto: string; estado: 'CUMPLE' | 'NO_CUMPLE' | 'FALTA_DATO' | null; ofertado: string; cita: string }>;
  motivo: string | null;
}

export interface DatosAuditorAnexo {
  lineasTecnicas: LineaTecnicaAuditor[];
  itemsComerciales: ItemComercialAuditor[];
  /** Auditor nuevo (opciones + comparador). Vacío/ausente en licitaciones del Auditor antiguo. */
  fichas?: FichaLineaAuditor[];
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

// «PLAZO DE ENTREGA: ______ días hábiles…» (4844-24-LE26, Anexo N°5): el papel ya trae la unidad
// impresa después de la raya, así que va solo el número — con el plazo del Auditor completo salía
// «1 día habil días hábiles». Si el Auditor dice corridos y el papel hábiles (o al revés) no se
// convierte nada: null, la casilla queda para el equipo.
export function plazoSinUnidadImpresa(valor: string, textoDespues: string): string | null {
  const impresa = textoDespues.match(/^\s*d[ií]as?\b\s*(h[aá]bil(?:es)?|corridos?)?/i);
  if (!impresa) return valor;
  const m = valor.match(/^\s*(\d+)\s*(?:d[ií]as?\b\s*(h[aá]bil(?:es)?|corridos?)?)?\s*$/i);
  if (!m) return valor;
  const tipo = (s?: string) => (s ? (/^h/i.test(s) ? 'habil' : 'corrido') : null);
  const enPapel = tipo(impresa[1]), enValor = tipo(m[2]);
  if (enPapel && enValor && enPapel !== enValor) return null;
  return m[1];
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

// ── Ficha de especificaciones contra el Auditor NUEVO (opción aprobada + comparador) ─────────────
// Forma real (1057922-28-LP26, «FORMULARIO N°2 ESPECIFICACIONES TÉCNICAS <EQUIPO>»): arriba
// «Marca | Modelo | Fabricante | País/Año de Fabricación» y abajo una fila por requisito de las bases
// con «CUMPLE SI/NO | CATÁLOGO/PÁGINA/DATASHEET | OBSERVACIONES». El Auditor ya comparó cada requisito
// contra la ficha del fabricante: aquí solo se copia lo que dijo, y SOLO lo que cumple — un «NO» o un
// requisito sin dato queda en blanco para que el equipo lo resuelva (escribir «NO» en un obligatorio
// es dejar la oferta inadmisible). Sin opción aprobada no se escribe nada y cada casilla dice por qué.
const RE_COL_CUMPLE = /\bcumple\b/i;
const RE_COL_RESPALDO = /cat[aá]logo|datasheet|data\s*sheet|ficha|folleto|brochure|p[aá]gina|respaldo|documento|referencia/i;
const RE_COL_OBSERVACION = /observaci|ofertad|valor\s+ofrecido|caracter[ií]stica\s+ofrecida|propuesta\s+del\s+oferente/i;
const RE_ETQ_MARCA = /^marca\b/i;
const RE_ETQ_MODELO = /^modelo\b/i;
const RE_ETQ_FABRICANTE = /^fabricante\b/i;
const RE_ETQ_PAIS = /^pa[ií]s\b|procedencia|origen/i;

const norm = (s: string) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
const palabras = (s: string) => new Set(norm(s).split(' ').filter(w => w.length > 1));

/** La línea del Auditor a la que corresponde este documento: por el nombre del equipo en su título. */
export function fichaDelDocumento(titulos: string[], datos: DatosAuditorAnexo): FichaLineaAuditor | null {
  const fichas = datos.fichas ?? [];
  if (!fichas.length) return null;
  const t = norm(titulos.join(' '));
  const porTitulo = fichas.filter(f => { const p = norm(f.producto); return p.length > 3 && t.includes(p); });
  if (porTitulo.length === 1) return porTitulo[0];
  if (porTitulo.length > 1) {
    // «Set refrigeradores clínicos» contiene «refrigeradores clínicos»: gana el nombre más largo.
    const largo = [...porTitulo].sort((a, b) => norm(b.producto).length - norm(a.producto).length);
    return norm(largo[0].producto).length > norm(largo[1].producto).length ? largo[0] : null;
  }
  // Sin el nombre del equipo en el título no se adivina: con una sola línea en el Auditor, el
  // formulario del tensiómetro recibía la marca y el modelo de la camilla (1057922-28-LP26).
  return null;
}

/** El requisito del Auditor que es esta fila del formulario (mismo texto de las bases, con o sin recorte). */
function requisitoDeFila(ficha: FichaLineaAuditor, fila: string): FichaLineaAuditor['requisitos'][number] | null {
  const f = norm(fila);
  if (f.length < 4) return null;
  const exactos = ficha.requisitos.filter(r => { const n = norm(r.texto); return n === f || (f.length >= 40 && n.startsWith(f)) || (n.length >= 40 && f.startsWith(n)); });
  if (exactos.length === 1) return exactos[0];
  if (exactos.length > 1) return null;
  const pf = palabras(fila);
  let mejor: { r: FichaLineaAuditor['requisitos'][number]; s: number } | null = null, segundo = 0;
  for (const r of ficha.requisitos) {
    const pr = palabras(r.texto);
    const comunes = [...pf].filter(w => pr.has(w)).length;
    const s = comunes / Math.max(pf.size, pr.size, 1);
    if (!mejor || s > mejor.s) { segundo = mejor?.s ?? 0; mejor = { r, s }; } else if (s > segundo) segundo = s;
  }
  return mejor && mejor.s >= 0.75 && mejor.s - segundo >= 0.15 ? mejor.r : null;
}

export interface ResultadoFichaTecnica { matches: MatchAuditor[]; motivos: Map<string, string> }

export function resolverFichaTecnicaConAuditor(etiquetas: string[], datos: DatosAuditorAnexo, titulos: string[]): ResultadoFichaTecnica {
  const matches: MatchAuditor[] = [];
  const motivos = new Map<string, string>();
  if (!datos.fichas?.length) return { matches, motivos };
  // Solo en un formulario de especificaciones (tiene la columna «CUMPLE»): un «País» o «Marca» de otro
  // anexo no es asunto de la ficha técnica.
  if (!etiquetas.some(e => { const p = e.split(' — '); return p.length > 1 && RE_COL_CUMPLE.test(p[p.length - 1]); })) return { matches, motivos };
  const ficha = fichaDelDocumento(titulos, datos);
  for (const etiqueta of etiquetas) {
    const partes = etiqueta.split(' — ');
    const columna = partes.length > 1 ? partes[partes.length - 1].trim() : '';
    const fila = partes.length > 1 ? partes.slice(0, -1).join(' — ').trim() : etiqueta.trim();
    const esCabecera = !columna && (RE_ETQ_MARCA.test(fila) || RE_ETQ_MODELO.test(fila) || RE_ETQ_FABRICANTE.test(fila) || RE_ETQ_PAIS.test(fila));
    const esColumnaFicha = RE_COL_CUMPLE.test(columna) || RE_COL_RESPALDO.test(columna) || RE_COL_OBSERVACION.test(columna);
    if (!esCabecera && !esColumnaFicha) continue;
    if (!ficha) { motivos.set(etiqueta, 'Este equipo no está entre las líneas que se ofertan en el Auditor (revisar el costeo): no hay producto ni ficha técnica que poner.'); continue; }
    if (!ficha.opcion) { motivos.set(etiqueta, ficha.motivo || `Línea ${ficha.lineaNumero ?? '?'} (${ficha.producto}): sin opción aprobada en el Auditor.`); continue; }
    const o = ficha.opcion;
    if (esCabecera) {
      const valor = RE_ETQ_MARCA.test(fila) ? o.marca : RE_ETQ_MODELO.test(fila) ? o.modelo : RE_ETQ_FABRICANTE.test(fila) ? o.fabricante
        // «País/Año de Fabricación» pide los dos: con uno solo queda para completar a mano.
        : /a[ñn]o/i.test(fila) ? (o.pais && o.anio ? `${o.pais} / ${o.anio}` : null) : o.pais;
      if (valor) matches.push({ etiqueta, valor });
      else motivos.set(etiqueta, `La ficha técnica de la opción aprobada no trae «${fila}».`);
      continue;
    }
    const req = requisitoDeFila(ficha, fila);
    if (!req) { motivos.set(etiqueta, 'Este requisito no aparece en la comparación técnica del Auditor.'); continue; }
    if (req.estado !== 'CUMPLE') {
      motivos.set(etiqueta, req.estado === 'NO_CUMPLE'
        ? `El Auditor marcó que NO cumple${req.ofertado ? ` (ofertado: ${req.ofertado})` : ''}: decidirlo antes de presentar.`
        : 'La ficha técnica no trae este dato: falta confirmarlo con el proveedor.');
      continue;
    }
    if (RE_COL_CUMPLE.test(columna)) matches.push({ etiqueta, valor: 'SI' });
    else if (RE_COL_RESPALDO.test(columna)) { if (o.documento) matches.push({ etiqueta, valor: o.documento }); else motivos.set(etiqueta, 'La opción aprobada no tiene ficha técnica cargada.'); }
    else if (req.ofertado) matches.push({ etiqueta, valor: req.ofertado });
  }
  return { matches, motivos };
}
