// app/lib/anexos-matriz-tecnica.ts
// MATRIZ DE CUMPLIMIENTO TÉCNICO — el otro tipo de anexo, el que el motor de anexos no puede.
//
// POR QUÉ EXISTE (26-ago-2026, caso real 1057922-23-LE26 / FORMULARIO N°3 SET CONTENEDORES):
// el motor de anexos (anexos-detectar.ts) está hecho para formularios de IDENTIFICACIÓN — "Razón
// social:", "RUT:", "Representante:", firma —, donde cada blanco se llena con un dato de la
// empresa. Contra un Formulario N°3 encuentra 156 campos vacíos, se los manda todos a la IA y no
// puede acertar ninguno: el dato que va ahí NO ESTÁ en la ficha de la empresa. De ahí que "se
// demore un montón y no genere nada".
//
// Un Formulario N°3 es otra cosa: una TABLA donde cada fila es una especificación exigida y el
// oferente declara si cumple.
//
//   N° | ESPECIFICACIONES TÉCNICAS | TIPO DE REQUERIMIENTO | PUNTAJE EETT | CUMPLE SI/NO |
//      | CATÁLOGO/PÁGINA PROVEEDOR/DATASHEET | OBSERVACIONES | PUNTAJE ASIGNADO
//
// LO QUE HACE QUE ESTO SEA DETERMINISTA (medido, no supuesto): el texto de cada fila es el MISMO
// que el de las características que el Auditor ya tiene guardadas para esa línea — 45 de 45 en el
// caso real. Es esperable, porque el informe las extrajo de este mismo formulario. Así que
// emparejar fila↔característica es comparar texto, no interpretar: cero IA, cero adivinanza.
//
// Este módulo es PURO (entra XML y características, sale un plan). No escribe el .docx ni toca la
// BD: así se puede testear contra el documento real sin montar nada.

import { normalizarValorParaDocumento } from '@/app/lib/valor-ofertado-normalizar';

// ─── Lectura del XML ────────────────────────────────────────────────────────────────────────────

const RE_TEXTO = /<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>/g;

/** Texto plano de un fragmento de XML de Word. OJO con `<w:t` vs `<w:tcPr`: el patrón exige que
 *  después de `w:t` venga un espacio o el cierre, si no captura las propiedades de celda. */
export function textoDeXml(fragmento: string): string {
  RE_TEXTO.lastIndex = 0;
  return Array.from(fragmento.matchAll(RE_TEXTO))
    .map(m => m[1])
    .join('')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Comparación tolerante: sin tildes, sin puntuación, sin dobles espacios. */
export function normalizar(s: string): string {
  return String(s || '').toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

// ─── Qué columna es cuál ────────────────────────────────────────────────────────────────────────

/** Los roles de columna que este módulo sabe reconocer y (algunos) rellenar. */
export type RolColumna =
  | 'numero'          // 1.1, 1.2…
  | 'especificacion'  // el requisito exigido — la clave del emparejamiento
  | 'tipo'            // OBLIGATORIO / DESEABLE — lo pone el organismo
  | 'puntaje'         // puntaje EETT — lo pone el organismo
  | 'cumple'          // SÍ/NO — LO LLENA EL OFERENTE
  | 'catalogo'        // catálogo / página / datasheet — LO LLENA EL OFERENTE
  | 'observaciones'   // LO LLENA EL OFERENTE
  | 'puntajeAsignado' // lo pone el evaluador
  | null;

/**
 * Rol de una columna por el texto de su encabezado.
 *
 * Se buscan las palabras que de verdad identifican la columna, no el encabezado completo: los
 * organismos escriben lo mismo de muchas formas ("CUMPLE SI/NO", "CUMPLE (SI/NO)", "¿CUMPLE?").
 * El ORDEN de las comprobaciones importa: "PUNTAJE ASIGNADO" también contiene "PUNTAJE", así que
 * lo más específico va primero.
 */
export function rolDeEncabezado(texto: string): RolColumna {
  const t = normalizar(texto);
  if (!t) return null;
  if (/\b(n|no|num|numero|item)\b/.test(t) && t.length <= 8) return 'numero';
  if (t.includes('especificacion') || t.includes('requerimiento tecnico')) return 'especificacion';
  if (t.includes('puntaje asignado')) return 'puntajeAsignado';
  if (t.includes('cumple')) return 'cumple';
  if (t.includes('catalogo') || t.includes('datasheet') || t.includes('ficha tecnica')) return 'catalogo';
  if (t.includes('observacion')) return 'observaciones';
  if (t.includes('tipo de requerimiento') || t === 'tipo') return 'tipo';
  if (t.includes('puntaje')) return 'puntaje';
  return null;
}

export interface FilaMatriz {
  /** Índice de la fila dentro de la tabla (para poder ubicarla al escribir). */
  indice: number;
  numero: string;
  especificacion: string;
  /** Texto de la celda de "tipo" (OBLIGATORIO / DESEABLE), si la tabla la trae. */
  tipo: string | null;
}

export interface MatrizTecnica {
  /** Índice de la tabla dentro del documento. */
  indiceTabla: number;
  /** Rol de cada columna, por posición. */
  columnas: RolColumna[];
  /** Índice de la fila de encabezado dentro de la tabla. */
  indiceEncabezado: number;
  /** Cuántas celdas tiene una fila "completa" de especificación. */
  celdasPorFila: number;
  filas: FilaMatriz[];
  /** Encabezados tal como venían, para poder mostrárselos a un humano si algo no calza. */
  encabezados: string[];
}

/**
 * ¿Este .docx es una matriz de cumplimiento técnico? Devuelve la matriz, o null si no lo es.
 *
 * El criterio es deliberadamente ESTRICTO: tiene que existir una tabla con una columna de
 * especificaciones Y una de "cumple". Con menos que eso no se puede rellenar nada útil, y confundir
 * un formulario de identificación con una matriz sería peor que no detectarla — el documento
 * seguiría por el motor de anexos, que es lo que corresponde.
 */
export function detectarMatrizTecnica(xml: string): MatrizTecnica | null {
  const tablas = xml.match(/<w:tbl>[\s\S]*?<\/w:tbl>/g) || [];

  for (let ti = 0; ti < tablas.length; ti++) {
    const filasXml = tablas[ti].match(/<w:tr\b[\s\S]*?<\/w:tr>/g) || [];
    if (filasXml.length < 3) continue;

    // El encabezado es la primera fila cuyos textos incluyan "especificacion" y "cumple". No se
    // asume que sea la fila 0: estos formularios suelen abrir con el nombre del equipo.
    let indiceEncabezado = -1;
    let columnas: RolColumna[] = [];
    let encabezados: string[] = [];
    for (let fi = 0; fi < filasXml.length && indiceEncabezado < 0; fi++) {
      const celdas = filasXml[fi].match(/<w:tc>[\s\S]*?<\/w:tc>/g) || [];
      if (celdas.length < 4) continue;
      const textos = celdas.map(textoDeXml);
      const roles = textos.map(rolDeEncabezado);
      if (roles.includes('especificacion') && roles.includes('cumple')) {
        indiceEncabezado = fi;
        columnas = roles;
        encabezados = textos;
      }
    }
    if (indiceEncabezado < 0) continue;

    const celdasPorFila = columnas.length;

    // La columna de numeración suele venir SIN encabezado (la celda del título está vacía), así
    // que `rolDeEncabezado` no la reconoce — pasa en el caso real. Se deduce de los DATOS: si la
    // primera columna sin rol trae valores cortos tipo "1.1", "2.3", es la numeración.
    if (columnas[0] == null) {
      const muestras = filasXml.slice(indiceEncabezado + 1, indiceEncabezado + 8)
        .map(fx => fx.match(/<w:tc>[\s\S]*?<\/w:tc>/g) || [])
        .filter(cs => cs.length === celdasPorFila)
        .map(cs => textoDeXml(cs[0]));
      const parecenNumeracion = muestras.filter(t => /^\d+(\.\d+)*$/.test(t)).length;
      if (muestras.length && parecenNumeracion >= Math.ceil(muestras.length / 2)) columnas[0] = 'numero';
    }

    const colNumero = columnas.indexOf('numero');
    const colEspec = columnas.indexOf('especificacion');
    const colTipo = columnas.indexOf('tipo');

    const filas: FilaMatriz[] = [];
    for (let fi = indiceEncabezado + 1; fi < filasXml.length; fi++) {
      const celdas = filasXml[fi].match(/<w:tc>[\s\S]*?<\/w:tc>/g) || [];
      // Las filas con MENOS celdas son títulos de sección ("I · CONTENEDORES CON PEDAL 20 [L]"),
      // no especificaciones. Se saltan: no hay nada que declarar en ellas.
      if (celdas.length !== celdasPorFila) continue;
      const especificacion = colEspec >= 0 ? textoDeXml(celdas[colEspec]) : '';
      if (!especificacion) continue;
      filas.push({
        indice: fi,
        numero: colNumero >= 0 ? textoDeXml(celdas[colNumero]) : '',
        especificacion,
        tipo: colTipo >= 0 ? textoDeXml(celdas[colTipo]) || null : null,
      });
    }
    if (!filas.length) continue;

    return { indiceTabla: ti, columnas, indiceEncabezado, celdasPorFila, filas, encabezados };
  }
  return null;
}

// ─── Emparejamiento con lo que el Auditor ya sabe ───────────────────────────────────────────────

export interface CaracteristicaConocida {
  descripcion: string;
  /** CUMPLE | NO_CUMPLE | CUMPLE_CON_COMPLEMENTO | null */
  veredicto: string | null;
  valorOfertado: string | null;
  /** De dónde salió lo ofertado: nombre de la ficha del proveedor, página, etc. */
  fuente: string | null;
}

export interface CeldaARellenar {
  /** Índice de la fila en la tabla (el mismo `FilaMatriz.indice`). */
  fila: number;
  columna: number;
  rol: Exclude<RolColumna, null>;
  texto: string;
}

export interface PlanRelleno {
  celdas: CeldaARellenar[];
  /** Filas del documento que no se pudieron emparejar con ninguna característica conocida. */
  sinEmparejar: FilaMatriz[];
  /** Características que teníamos y que no aparecen en el documento (señal de que es otra línea). */
  sobrantes: CaracteristicaConocida[];
  /**
   * FILAS del documento emparejadas. Es lo que hay que mirar para saber si el formulario quedó
   * cubierto.
   *
   * Se cuentan FILAS y no características únicas por un caso real: en el Formulario N°3 de
   * SET CONTENEDORES la misma frase ("Contenedores para residuos asimilables a domiciliarios…")
   * se repite una vez por cada tamaño de contenedor —20 L, 40-45 L, 120 L, 240 L—, así que 46
   * filas se emparejan contra 26 textos distintos. Contar los textos daba "26 de 46" y parecía
   * que faltaba la mitad, cuando en realidad estaba todo cubierto.
   */
  filasEmparejadas: number;
  /** Textos distintos usados. Útil para diagnóstico, no para medir cobertura. */
  textosUsados: number;
}

/** Lo que se escribe en "CUMPLE SI/NO". Sin veredicto NO SE ESCRIBE NADA. */
export function textoCumple(veredicto: string | null): string | null {
  switch (veredicto) {
    case 'CUMPLE': return 'SÍ';
    case 'NO_CUMPLE': return 'NO';
    // Cumple sólo con un complemento: declarar "SÍ" a secas sería declarar de más en un documento
    // que el organismo evalúa. Se deja vacío para que lo resuelva una persona.
    case 'CUMPLE_CON_COMPLEMENTO': return null;
    default: return null;
  }
}

/**
 * Empareja las filas del documento con las características conocidas y arma el plan de escritura.
 *
 * El emparejamiento es por TEXTO NORMALIZADO, exacto. No se usa parecido difuso a propósito: en un
 * documento que se presenta a evaluación, escribir "CUMPLE" en la fila equivocada es peor que
 * dejarla en blanco. Lo que no calce exacto queda en `sinEmparejar` para que una persona lo mire.
 *
 * NUNCA INVENTA: una característica sin veredicto no produce ninguna celda. La misma regla de la
 * ficha propia — el vacío honesto antes que el dato plausible.
 */
export function planDeRelleno(
  matriz: MatrizTecnica,
  caracteristicas: CaracteristicaConocida[],
): PlanRelleno {
  const colCumple = matriz.columnas.indexOf('cumple');
  const colCatalogo = matriz.columnas.indexOf('catalogo');
  const colObs = matriz.columnas.indexOf('observaciones');

  const porTexto = new Map<string, CaracteristicaConocida>();
  for (const c of caracteristicas) {
    const k = normalizar(c.descripcion);
    if (k && !porTexto.has(k)) porTexto.set(k, c);
  }

  const celdas: CeldaARellenar[] = [];
  const sinEmparejar: FilaMatriz[] = [];
  const usadas = new Set<string>();
  let filasEmparejadas = 0;

  for (const fila of matriz.filas) {
    const clave = normalizar(fila.especificacion);
    const c = porTexto.get(clave);
    if (!c) { sinEmparejar.push(fila); continue; }
    usadas.add(clave);
    filasEmparejadas++;

    const cumple = textoCumple(c.veredicto);
    if (cumple && colCumple >= 0) {
      celdas.push({ fila: fila.indice, columna: colCumple, rol: 'cumple', texto: cumple });
    }
    if (c.fuente && colCatalogo >= 0) {
      celdas.push({ fila: fila.indice, columna: colCatalogo, rol: 'catalogo', texto: c.fuente });
    }
    if (c.valorOfertado && colObs >= 0) {
      // Se imprime limpio (formato numérico chileno, sin traducciones erradas del inglés). El
      // valor crudo queda en la base como evidencia — ver valor-ofertado-normalizar.ts.
      const texto = normalizarValorParaDocumento(c.valorOfertado);
      if (texto) celdas.push({ fila: fila.indice, columna: colObs, rol: 'observaciones', texto });
    }
  }

  return {
    celdas,
    sinEmparejar,
    sobrantes: caracteristicas.filter(c => !usadas.has(normalizar(c.descripcion))),
    filasEmparejadas,
    textosUsados: usadas.size,
  };
}

// ─── Escritura en el .docx ──────────────────────────────────────────────────────────────────────

/**
 * Inserta texto dentro de una celda de tabla, respetando su párrafo y su formato.
 *
 * Se escribe DENTRO del `<w:p>` que la celda ya tiene, después de su `<w:pPr>` si lo trae: así la
 * celda conserva alineación, bordes y fuente del formulario original. Crear un párrafo nuevo
 * cambiaría la cantidad de párrafos del documento, que es justo lo que `verificarParrafos`
 * (anexos-docx.ts) usa como control de integridad antes de subir nada.
 */
export function escribirEnCelda(celdaXml: string, texto: string): string {
  const run = `<w:r><w:t xml:space="preserve">${texto
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')}</w:t></w:r>`;

  const p = /<w:p\b[^>]*(?:\/>|>)/.exec(celdaXml);
  if (!p) return celdaXml;                       // celda sin párrafo: no se toca

  // Párrafo auto-cerrado (`<w:p/>`): hay que abrirlo para poder meterle el run.
  if (p[0].endsWith('/>')) {
    const abierto = `${p[0].slice(0, -2)}>${run}</w:p>`;
    return celdaXml.slice(0, p.index) + abierto + celdaXml.slice(p.index + p[0].length);
  }

  const desde = p.index + p[0].length;
  const pPr = /^<w:pPr\b[\s\S]*?<\/w:pPr>/.exec(celdaXml.slice(desde));
  const corte = desde + (pPr ? pPr[0].length : 0);
  return celdaXml.slice(0, corte) + run + celdaXml.slice(corte);
}

export interface ResultadoRelleno {
  xml: string;
  escritas: number;
  /** Celdas del plan que NO se pudieron escribir (fila o columna fuera de rango). */
  omitidas: number;
}

/**
 * Aplica el plan sobre el XML del documento.
 *
 * Solo toca celdas VACÍAS: si el formulario ya trae algo escrito en esa casilla (una plantilla que
 * el equipo empezó a llenar a mano), se respeta y se cuenta como omitida. Pisar trabajo humano en
 * un documento que se presenta sería el peor error posible de este módulo.
 */
export function aplicarPlan(xml: string, matriz: MatrizTecnica, plan: PlanRelleno): ResultadoRelleno {
  const tablas = Array.from(xml.matchAll(/<w:tbl>[\s\S]*?<\/w:tbl>/g));
  const tabla = tablas[matriz.indiceTabla];
  if (!tabla) return { xml, escritas: 0, omitidas: plan.celdas.length };

  // OJO con el `\b`: sin él, `<w:tr` también engancha `<w:trPr>` y el conteo de filas queda
  // corrido respecto del que hizo detectarMatrizTecnica — el plan apunta a filas que no existen y
  // no se escribe nada, SIN error (pasó de verdad: 90 celdas planificadas, 0 escritas, 0 omitidas).
  const filasXml = tabla[0].match(/<w:tr\b[\s\S]*?<\/w:tr>/g) || [];
  // Agrupadas por fila para reconstruir cada una una sola vez.
  const porFila = new Map<number, CeldaARellenar[]>();
  for (const c of plan.celdas) {
    if (!porFila.has(c.fila)) porFila.set(c.fila, []);
    porFila.get(c.fila)!.push(c);
  }

  let escritas = 0;
  let omitidas = 0;
  const filasNuevas = filasXml.map((filaXml, fi) => {
    const cambios = porFila.get(fi);
    if (!cambios?.length) return filaXml;
    const celdas = filaXml.match(/<w:tc>[\s\S]*?<\/w:tc>/g) || [];
    if (!celdas.length) { omitidas += cambios.length; return filaXml; }

    const nuevas = [...celdas];
    for (const c of cambios) {
      if (c.columna < 0 || c.columna >= nuevas.length) { omitidas++; continue; }
      if (textoDeXml(nuevas[c.columna])) { omitidas++; continue; }   // ya tenía algo escrito
      nuevas[c.columna] = escribirEnCelda(nuevas[c.columna], c.texto);
      escritas++;
    }
    // Se reemplaza cada celda en su posición, sin recomponer la fila desde cero: así se conservan
    // `<w:trPr>` y cualquier otro nodo que la fila traiga fuera de las celdas.
    let out = filaXml;
    for (let i = celdas.length - 1; i >= 0; i--) {
      if (nuevas[i] === celdas[i]) continue;
      const pos = out.lastIndexOf(celdas[i]);
      if (pos < 0) { omitidas++; escritas--; continue; }
      out = out.slice(0, pos) + nuevas[i] + out.slice(pos + celdas[i].length);
    }
    return out;
  });

  const tablaNueva = filasXml.length
    ? (() => {
        let t = tabla[0];
        for (let i = filasXml.length - 1; i >= 0; i--) {
          if (filasNuevas[i] === filasXml[i]) continue;
          const pos = t.lastIndexOf(filasXml[i]);
          if (pos < 0) continue;
          t = t.slice(0, pos) + filasNuevas[i] + t.slice(pos + filasXml[i].length);
        }
        return t;
      })()
    : tabla[0];

  const inicio = tabla.index!;
  return {
    xml: xml.slice(0, inicio) + tablaNueva + xml.slice(inicio + tabla[0].length),
    escritas, omitidas,
  };
}

// ═══ TABLA "INFORMACIÓN DE LA OFERTA" — marca/modelo/fabricante/país/año/garantía ═══════════════
//
// Es OTRA tabla del mismo documento, con OTRA forma: no es "una fila por especificación con
// columnas fijas" como la matriz de cumplimiento — es "etiqueta | valor", una fila por dato.
// Caso real (FORMULARIO_N3_..._SET_CONTENEDORES.docx):
//
//   Nombre de la Empresa | (vacío)      Marca | (vacío)      Modelo | (vacío)
//   Fabricante | (vacío)                País/Año de Fabricación | (vacío)
//   Plazo de Entrega (marcar con una X) | ____ 15 días ____ 30 días ____ 45 días
//   Garantía Técnica | ____ meses (igual o superior a 12 meses)
//
// Se completan MARCA/MODELO/FABRICANTE/PAÍS/AÑO/GARANTÍA — los mismos datos que ya se capturan al
// subir la ficha del proveedor (producto-ofertado.ts) y que se pueden confirmar en el modal de
// comparación. "Plazo de Entrega" queda FUERA a propósito: no es un blanco que se rellena con
// texto, es una lista de opciones donde hay que marcar una con X — estructura distinta, se deja
// para una pasada aparte en vez de forzarla acá.

export type RolCampoOferta = 'marca' | 'modelo' | 'fabricante' | 'pais' | 'anio' | 'garantia' | null;

const ETIQUETAS_OFERTA: Array<[RegExp, RolCampoOferta]> = [
  [/^marca(\s*\/\s*fabricante)?$/, 'marca'],
  [/^modelo$/, 'modelo'],
  [/^fabricante$/, 'fabricante'],
  // "País/Año de Fabricación" en una sola fila: se manda al país (es el dato más citado); el año
  // rara vez se pide por separado y forzarlo ahí mezclaría dos valores en una celda.
  //
  // OJO: normalizar() convierte cualquier carácter no alfanumérico (incluida la "/") en espacio,
  // así que "País/Año de Fabricación" llega aquí como "pais ano de fabricacion" — un patrón con
  // "\/" literal nunca la reconoce. Se prueba primero la forma combinada (con "ano" opcional) y
  // se exige que "fabricacion" cierre la frase, para no confundir con "empresa de fabricación X".
  [/^pa[ií]s(\s+a[ñn]o)?\s+de\s+fabricaci[oó]n$/, 'pais'],
  [/^a[ñn]o\s+de\s+fabricaci[oó]n$/, 'anio'],
  [/^garant[ií]a\s+t[eé]cnica$/, 'garantia'],
];

function rolDeEtiquetaOferta(texto: string): RolCampoOferta {
  const t = normalizar(texto);
  for (const [re, rol] of ETIQUETAS_OFERTA) if (re.test(t)) return rol;
  return null;
}

export interface CampoOferta { fila: number; rol: Exclude<RolCampoOferta, null>; etiqueta: string }
export interface TablaOferta { indiceTabla: number; campos: CampoOferta[] }

/**
 * ¿Hay una tabla "etiqueta | valor" con datos del producto ofertado? Devuelve dónde está cada
 * campo reconocido, o null si el documento no trae ninguno — no todo Formulario N°3 pide marca y
 * modelo, y no hay que suponer que sí.
 */
export function detectarTablaOferta(xml: string): TablaOferta | null {
  const tablas = xml.match(/<w:tbl>[\s\S]*?<\/w:tbl>/g) || [];
  for (let ti = 0; ti < tablas.length; ti++) {
    const filasXml = tablas[ti].match(/<w:tr\b[\s\S]*?<\/w:tr>/g) || [];
    const campos: CampoOferta[] = [];
    for (let fi = 0; fi < filasXml.length; fi++) {
      const celdas = filasXml[fi].match(/<w:tc>[\s\S]*?<\/w:tc>/g) || [];
      if (celdas.length !== 2) continue;                 // etiqueta | valor: siempre 2 celdas
      const etiqueta = textoDeXml(celdas[0]);
      const rol = rolDeEtiquetaOferta(etiqueta);
      if (rol) campos.push({ fila: fi, rol, etiqueta });
    }
    if (campos.length) return { indiceTabla: ti, campos };
  }
  return null;
}

export interface DatosProductoParaOferta {
  marca?: string | null; modelo?: string | null; fabricante?: string | null;
  paisFabricacion?: string | null; garantiaMeses?: number | null;
}

/**
 * Escribe los valores en la columna derecha de las filas reconocidas. Mismo criterio que
 * aplicarPlan(): SOLO celdas vacías, nunca pisa algo que ya esté escrito.
 */
export function aplicarPlanOferta(
  xml: string, tabla: TablaOferta, datos: DatosProductoParaOferta,
): ResultadoRelleno {
  const tablas = Array.from(xml.matchAll(/<w:tbl>[\s\S]*?<\/w:tbl>/g));
  const t = tablas[tabla.indiceTabla];
  if (!t) return { xml, escritas: 0, omitidas: tabla.campos.length };

  const valorDe: Record<Exclude<RolCampoOferta, null>, string | null> = {
    marca: datos.marca ?? null, modelo: datos.modelo ?? null, fabricante: datos.fabricante ?? null,
    pais: datos.paisFabricacion ?? null,
    anio: null,   // no se separa de "país/año" en una fila combinada — ver comentario arriba
    // Garantía: en el caso real la celda trae SIEMPRE el texto instructivo
    // "____ meses (igual o superior a 12 meses)" — no está vacía, así que aplicarPlanOferta la
    // omite (correcto: no se pisa). Rellenarla de verdad exige escribir DENTRO de ese blanco
    // inline, el mismo mecanismo que usa el motor de anexos para los formularios de
    // identificación — no el de esta tabla. Queda mapeada para el día que se conecte ese camino.
    garantia: datos.garantiaMeses != null ? `${datos.garantiaMeses} meses` : null,
  };

  const filasXml = t[0].match(/<w:tr\b[\s\S]*?<\/w:tr>/g) || [];
  let escritas = 0, omitidas = 0;
  const filasNuevas = filasXml.map((filaXml, fi) => {
    const campo = tabla.campos.find(c => c.fila === fi);
    if (!campo) return filaXml;
    const valor = valorDe[campo.rol];
    if (!valor) { omitidas++; return filaXml; }           // no hay dato para ese campo: se omite

    const celdas = filaXml.match(/<w:tc>[\s\S]*?<\/w:tc>/g) || [];
    if (celdas.length !== 2) { omitidas++; return filaXml; }
    if (textoDeXml(celdas[1])) { omitidas++; return filaXml; }   // la celda ya tenía algo escrito

    const nueva = escribirEnCelda(celdas[1], valor);
    escritas++;
    const pos = filaXml.lastIndexOf(celdas[1]);
    return pos < 0 ? filaXml : filaXml.slice(0, pos) + nueva + filaXml.slice(pos + celdas[1].length);
  });

  let tablaNueva = t[0];
  for (let i = filasXml.length - 1; i >= 0; i--) {
    if (filasNuevas[i] === filasXml[i]) continue;
    const pos = tablaNueva.lastIndexOf(filasXml[i]);
    if (pos < 0) continue;
    tablaNueva = tablaNueva.slice(0, pos) + filasNuevas[i] + tablaNueva.slice(pos + filasXml[i].length);
  }

  const inicio = t.index!;
  return {
    xml: xml.slice(0, inicio) + tablaNueva + xml.slice(inicio + t[0].length),
    escritas, omitidas,
  };
}
