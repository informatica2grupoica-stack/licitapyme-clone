// app/lib/anexos-resumen-tecnico.ts
// RESUMEN TÉCNICO LIBRE — un tercer tipo de anexo, distinto de la matriz de cumplimiento y del
// motor de identificación.
//
// POR QUÉ EXISTE (27-ago-2026, caso real 611669-17-LE26 "LUMINANCÍMETROS", ANEXO N°2 "OFERTA
// TÉCNICA"): el usuario mostró un PDF que Alexis llenó A MANO para este anexo y preguntó si el
// sistema puede lograr eso. La respuesta es sí, y casi todo el dato ya estaba guardado — solo
// faltaba el módulo que sabe leer y escribir ESTA forma de documento.
//
// Es una tercera forma, distinta de las otras dos:
//   · Matriz de cumplimiento (anexos-matriz-tecnica.ts): una fila POR CARACTERÍSTICA, con columna
//     CUMPLE SI/NO. Uno o varios veredictos por línea.
//   · Este módulo: tablas de 2 filas (encabezado + UNA fila de datos), donde la ÚLTIMA celda es un
//     bloque de TEXTO LIBRE que junta TODAS las características de la línea en una sola casilla.
//     Estructura real medida:
//
//       Cantidad | Producto        | Especificaciones Técnicas
//       3        | Luminancímetros | (blanco — acá va la lista completa)
//
//       Cantidad | Producto        | Plazo de Entrega (días hábiles)
//       3        | Luminancímetros | (blanco — acá va "40 días hábiles")
//
//       Cantidad | Producto        | Plazo de Garantía (meses)
//       3        | Luminancímetros | (blanco)
//
// LO QUE HACE QUE ESTO SEA DETERMINISTA: el texto que Alexis escribió a mano para
// "Especificaciones Técnicas" es, característica por característica, la MISMA descripción y el
// mismo valor exigido que ya están guardados en checklist_comercial_caracteristicas. No hay nada
// que interpretar — es transcribir lo que ya se sabe, igual que en la ficha propia
// (ficha-tecnica.ts) y en la matriz de cumplimiento.
//
// LÍMITE HONESTO: "Plazo de Garantía (meses)" NO se completa. Se buscó el dato en toda la base del
// negocio y no existe en ningún lado como un número concreto — lo único guardado es el CRITERIO de
// evaluación ("mayor plazo de garantía obtiene 100 puntos"), que no es un valor que podamos
// ofertar. Escribir un número inventado ahí sería exactamente el tipo de dato fabricado que este
// proyecto prohíbe. La celda queda vacía y marcada como pendiente, para que una persona la llene.

import { escribirEnCelda, textoDeXml, normalizar } from '@/app/lib/anexos-matriz-tecnica';

export type RolTablaResumen = 'especificaciones' | 'plazo_entrega' | 'garantia';

const ETIQUETAS_ROL: Array<[RegExp, RolTablaResumen]> = [
  [/especificacion(es)?\s+tecnicas?/, 'especificaciones'],
  [/plazo\s+de\s+entrega/, 'plazo_entrega'],
  [/plazo\s+de\s+garantia|garantia\s+tecnica/, 'garantia'],
];

function rolDeTabla(encabezados: string[]): RolTablaResumen | null {
  const normalizados = encabezados.map(normalizar);
  // Se exige "cantidad" Y "producto" además del rol: sin esas dos, cualquier tabla que mencione
  // "especificaciones" de pasada (un título de sección, por ejemplo) calificaría por error.
  if (!normalizados.some(t => t === 'cantidad')) return null;
  if (!normalizados.some(t => t === 'producto')) return null;
  for (const h of normalizados) {
    for (const [re, rol] of ETIQUETAS_ROL) if (re.test(h)) return rol;
  }
  return null;
}

export interface FilaProductoResumen {
  fila: number;
  producto: string;
  /** Índice de la columna "Producto" y de la columna de VALOR (la que hay que llenar). */
  colProducto: number;
  colValor: number;
}

export interface TablaResumen {
  indiceTabla: number;
  rol: RolTablaResumen;
  filas: FilaProductoResumen[];
}

/**
 * Encuentra las tablas de este tipo en el documento. Puede haber 0, 1, 2 o 3 (una por rol) — un
 * organismo puede pedir solo especificaciones y plazo, sin garantía, por ejemplo.
 */
export function detectarResumenTecnico(xml: string): TablaResumen[] {
  const tablas = xml.match(/<w:tbl>[\s\S]*?<\/w:tbl>/g) || [];
  const out: TablaResumen[] = [];

  tablas.forEach((t, ti) => {
    const filasXml = t.match(/<w:tr\b[\s\S]*?<\/w:tr>/g) || [];
    if (filasXml.length < 2) return;

    const celdas0 = filasXml[0]!.match(/<w:tc>[\s\S]*?<\/w:tc>/g) || [];
    if (celdas0.length < 3) return;
    const encabezados = celdas0.map(textoDeXml);
    const rol = rolDeTabla(encabezados);
    if (!rol) return;

    const colProducto = encabezados.findIndex(h => normalizar(h) === 'producto');
    // La columna de valor es la ÚLTIMA columna con la etiqueta del rol (evita adivinar por
    // posición fija: algunos formularios podrían traer más columnas intermedias).
    const colValor = encabezados.findIndex(h => {
      const n = normalizar(h);
      return ETIQUETAS_ROL.some(([re, r]) => r === rol && re.test(n));
    });
    if (colProducto < 0 || colValor < 0) return;

    const celdasPorFila = celdas0.length;
    const filas: FilaProductoResumen[] = [];
    for (let fi = 1; fi < filasXml.length; fi++) {
      const celdas = filasXml[fi].match(/<w:tc>[\s\S]*?<\/w:tc>/g) || [];
      if (celdas.length !== celdasPorFila) continue;
      const producto = textoDeXml(celdas[colProducto]);
      if (!producto) continue;
      filas.push({ fila: fi, producto, colProducto, colValor });
    }
    if (filas.length) out.push({ indiceTabla: ti, rol, filas });
  });

  return out;
}

/**
 * "Ángulo de Medición" + "al menos 1°" → "Ángulo de Medición: al menos 1°".
 *
 * No se intenta imitar la redacción natural que escribiría una persona ("Ángulo de Medición DE al
 * menos 1°"): construir gramática es interpretar, y acá el objetivo es transcribir sin inventar.
 * Si el valor exigido ya viene incluido en la descripción (pasa en los tipo EXACTO, donde el
 * clasificador guarda la frase completa en ambos campos), no se duplica.
 */
export function textoCaracteristicaResumen(descripcion: string, valorRequeridoTexto: string | null): string {
  const d = String(descripcion || '').trim();
  const v = String(valorRequeridoTexto || '').trim();
  if (!v || !d) return d || v;
  if (normalizar(d).includes(normalizar(v))) return d;
  return `${d}: ${v}`;
}

export interface ProductoResumenDatos {
  /** Nombre del producto tal como lo conocemos (título de la línea técnica), para emparejar
   *  contra la columna "Producto" del documento por parecido de texto. */
  nombre: string;
  especificaciones: Array<{ descripcion: string; valorRequeridoTexto: string | null }>;
  /** Texto ya listo del plazo comprometido ("40 días hábiles"), o null si no se cargó todavía. */
  plazoEntregaTexto: string | null;
  /** Garantía en meses. Casi siempre null — ver el límite documentado arriba del archivo. */
  garantiaTexto: string | null;
}

export interface CeldaResumenARellenar {
  indiceTabla: number;
  fila: number;
  columna: number;
  texto: string;
}

export interface PlanResumen {
  celdas: CeldaResumenARellenar[];
  /** Filas del documento cuyo producto no se pudo emparejar con ninguna línea conocida. */
  sinEmparejar: Array<{ indiceTabla: number; producto: string }>;
  /** Compañeros de tabla sin dato para escribir (p.ej. garantía sin valor conocido). */
  sinDato: Array<{ indiceTabla: number; rol: RolTablaResumen; producto: string }>;
}

/**
 * Empareja cada fila "Producto" del documento contra los productos conocidos y arma el plan.
 *
 * Emparejamiento simple por normalización (minúsculas, sin tildes): un documento real dirá
 * "Luminancímetros" y nuestro título de línea dice lo mismo o un superconjunto ("Línea 1 —
 * Luminancímetros" ya sin el prefijo). Si un negocio tiene una sola línea y el documento una sola
 * fila de producto, esto siempre calza sin ambigüedad — que es el caso real que lo motivó.
 */
export function planDeRellenoResumen(
  tablas: TablaResumen[], productos: ProductoResumenDatos[],
): PlanResumen {
  const celdas: CeldaResumenARellenar[] = [];
  const sinEmparejar: PlanResumen['sinEmparejar'] = [];
  const sinDato: PlanResumen['sinDato'] = [];

  const porNombre = new Map(productos.map(p => [normalizar(p.nombre), p]));

  for (const t of tablas) {
    for (const f of t.filas) {
      const clave = normalizar(f.producto);
      // Exacto primero; si no calza, el que MÁS se parezca por inclusión de palabras (para
      // "Línea 1 — Luminancímetros" vs "Luminancímetros" sueltos en el documento).
      let producto = porNombre.get(clave) ?? null;
      if (!producto) {
        producto = productos.find(p => {
          const n = normalizar(p.nombre);
          return n.includes(clave) || clave.includes(n);
        }) ?? null;
      }
      if (!producto) { sinEmparejar.push({ indiceTabla: t.indiceTabla, producto: f.producto }); continue; }

      let texto: string | null = null;
      if (t.rol === 'especificaciones') {
        texto = producto.especificaciones
          .map(e => textoCaracteristicaResumen(e.descripcion, e.valorRequeridoTexto))
          .filter(Boolean)
          .join('\n');
      } else if (t.rol === 'plazo_entrega') {
        texto = producto.plazoEntregaTexto;
      } else if (t.rol === 'garantia') {
        texto = producto.garantiaTexto;
      }

      if (!texto) { sinDato.push({ indiceTabla: t.indiceTabla, rol: t.rol, producto: f.producto }); continue; }
      celdas.push({ indiceTabla: t.indiceTabla, fila: f.fila, columna: f.colValor, texto });
    }
  }

  return { celdas, sinEmparejar, sinDato };
}

export interface ResultadoResumen { xml: string; escritas: number; omitidas: number }

/**
 * Escribe el plan sobre el XML. Mismo criterio que el resto del proyecto: SOLO celdas vacías,
 * nunca pisa lo que ya esté escrito (un formulario que el equipo empezó a llenar a mano).
 *
 * NOTA: el texto de "especificaciones" puede traer varios renglones (uno por característica,
 * separados por \n). Word necesita un `<w:p>` por renglón visible, así que cada salto de línea se
 * escribe como un párrafo NUEVO dentro de la celda — a diferencia de escribirEnCelda() (que
 * escribe un solo run dentro del párrafo YA EXISTENTE), acá se agregan párrafos hermanos después
 * del primero. Esto SÍ cambia el conteo total de párrafos del documento, a propósito: es contenido
 * nuevo, no un valor dentro de un blanco ya existente. verificarParrafos() en el endpoint no
 * aplica tal cual a este módulo por esa razón — ver el caller.
 */
export function aplicarPlanResumen(xml: string, celdas: CeldaResumenARellenar[]): ResultadoResumen {
  const tablas = Array.from(xml.matchAll(/<w:tbl>[\s\S]*?<\/w:tbl>/g));
  const porTabla = new Map<number, CeldaResumenARellenar[]>();
  for (const c of celdas) {
    if (!porTabla.has(c.indiceTabla)) porTabla.set(c.indiceTabla, []);
    porTabla.get(c.indiceTabla)!.push(c);
  }

  let out = xml;
  let escritas = 0, omitidas = 0;

  // De atrás hacia adelante: escribir en una tabla no debe correr los índices de las que siguen.
  const indices = Array.from(porTabla.keys()).sort((a, b) => b - a);
  for (const ti of indices) {
    const tablaMatch = Array.from(out.matchAll(/<w:tbl>[\s\S]*?<\/w:tbl>/g))[ti];
    if (!tablaMatch) { omitidas += porTabla.get(ti)!.length; continue; }
    const filasXml = tablaMatch[0].match(/<w:tr\b[\s\S]*?<\/w:tr>/g) || [];

    let tablaNueva = tablaMatch[0];
    for (const c of porTabla.get(ti)!) {
      const filaXml = filasXml[c.fila];
      if (!filaXml) { omitidas++; continue; }
      const celdasFila = filaXml.match(/<w:tc>[\s\S]*?<\/w:tc>/g) || [];
      const celdaVieja = celdasFila[c.columna];
      if (!celdaVieja) { omitidas++; continue; }
      if (textoDeXml(celdaVieja)) { omitidas++; continue; }   // ya tenía algo escrito

      const lineas = c.texto.split('\n').filter(Boolean);
      const celdaNueva = lineas.length <= 1
        ? escribirEnCelda(celdaVieja, lineas[0] || c.texto)
        : escribirVariasLineas(celdaVieja, lineas);

      const pos = tablaNueva.lastIndexOf(celdaVieja);
      if (pos < 0) { omitidas++; continue; }
      tablaNueva = tablaNueva.slice(0, pos) + celdaNueva + tablaNueva.slice(pos + celdaVieja.length);
      escritas++;
    }

    const inicio = tablaMatch.index!;
    out = out.slice(0, inicio) + tablaNueva + out.slice(inicio + tablaMatch[0].length);
  }

  return { xml: out, escritas, omitidas };
}

/** Escribe la primera línea con escribirEnCelda() (respeta el párrafo/formato ya existente) y
 *  agrega un `<w:p>` nuevo, con el MISMO `<w:pPr>` del primero, por cada línea adicional. */
function escribirVariasLineas(celdaXml: string, lineas: string[]): string {
  const conPrimera = escribirEnCelda(celdaXml, lineas[0]);
  const p = /<w:p\b[^>]*>[\s\S]*?<\/w:p>/.exec(conPrimera);
  if (!p) return conPrimera;
  const pPr = /^<w:pPr\b[\s\S]*?<\/w:pPr>/.exec(p[0].slice(p[0].indexOf('>') + 1)) ;
  const estiloPPr = pPr ? pPr[0] : '';
  const escape = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const nuevosParrafos = lineas.slice(1)
    .map(l => `<w:p>${estiloPPr}<w:r><w:t xml:space="preserve">${escape(l)}</w:t></w:r></w:p>`)
    .join('');
  const fin = p.index + p[0].length;
  return conPrimera.slice(0, fin) + nuevosParrafos + conPrimera.slice(fin);
}
