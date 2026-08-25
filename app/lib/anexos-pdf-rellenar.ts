// app/lib/anexos-pdf-rellenar.ts
// Relleno de anexos PDF ESCANEADOS (sin capa de texto, sin campos de formulario) con los datos
// de la empresa — la contraparte de anexos-rellenar.ts (que trabaja sobre .docx). Existe porque
// en una licitación pública el documento que se sube tiene que ser el MISMO que publicó el
// organismo: no se puede pasar a Word y volver a generar un PDF, porque el resultado ya no es el
// archivo oficial. Este motor NUNCA reconstruye el documento — abre el PDF original con pdf-lib
// y escribe los valores encima, en las coordenadas exactas del casillero vacío; todo lo demás
// (logo, timbre, firma, texto) queda intacto byte a byte salvo el texto agregado.
//
// ── LAS TRES FORMAS EN QUE UN FORMATO PIDE UN DATO ────────────────────────────────────────────
// Un anexo escaneado no es solo "tablas con casilleros". Medido sobre los 7 formatos de
// 545774-35-LE26 (San Miguel), conviven tres formas y cada una necesita su tratamiento:
//
//   1. TABLA de dos columnas: "R.U.T OFERENTE: | <casillero vacío>". Se detecta por geometría y
//      se ESCRIBE el valor en la celda vacía. Es el caso seguro: hay espacio en blanco de sobra
//      y el organismo lo dejó ahí justamente para eso.
//
//   2. GRILLA de N columnas: "NOMBRE | REPRESENTANTE | RUT | DOMICILIO | CORREO", una fila por
//      integrante de la UTP; o "PRODUCTO | VALOR UNITARIO | IVA | TOTAL" del anexo económico.
//      Se DETECTA pero NUNCA se autocompleta. Antes de esto el motor tomaba siempre la segunda
//      línea vertical como "el casillero" y escribía en la columna 2 de una grilla de cinco —
//      el RUT de la empresa terminaba en la columna "REPRESENTANTE LEGAL". Una grilla de UTP
//      habla de TERCEROS y la económica sale del costeo, no de la ficha de la empresa: en ambos
//      casos el dato correcto no está acá, así que van a `pendientes`.
//
//   3. BLANCO INLINE en prosa: "Yo, ______ en representación de la empresa ______ RUT ______".
//      No hay tabla: hay una raya y una oración alrededor. La raya se ubica por geometría y el
//      contexto se lee por OCR; QUÉ dato va lo decide `campoDeBlancoInline` — el MISMO
//      diccionario que resuelve los .docx, no una copia. Se escribe encima de la raya.
//
//   3b. MARCADOR "<nombre de representante legal>" incrustado en el párrafo. Se detecta y se
//      resuelve el campo, pero NO se escribe: tapar un marcador exige pintar un rectángulo blanco
//      sobre un escaneo gris (se nota) y el valor casi nunca mide lo mismo que el texto que
//      reemplaza, así que rompe el párrafo justificado. Va a `pendientes` CON el valor propuesto,
//      que es lo útil: el asistente sabe exactamente qué escribir en cada marcador.
//
// ── CÓMO DETECTA LA GEOMETRÍA (el PDF no tiene estructura, es una imagen escaneada) ───────────
//   1. Rasteriza cada página DOS VECES: fino (2.5×) para el OCR, y GRUESO (0.75×) para buscar
//      las líneas de las tablas. Lo grueso no es un ahorro, es la corrección del SESGO del
//      escaneo: medido en la pág. 35 del documento real, la línea de la tabla de oferta económica
//      cae ~18 px a lo largo del ancho a 2.5×, así que ninguna fila de píxeles la contiene entera
//      y NINGUNA línea se detectaba (0 casillas en todo el formato económico). Ensanchar la banda
//      de tolerancia vertical no sirve: a ±8 px el texto corrido empieza a contar como línea y la
//      página se llena de casillas falsas. Al rasterizar a 0.75× ese mismo sesgo se comprime a
//      ~5 px, que la banda de ±2 absorbe sin ensancharse. Verificado: la misma página pasa de 0 a
//      7 líneas correctas, y las páginas que ya funcionaban dan el MISMO resultado que antes.
//   2. El umbral de "esto es una línea de tabla" es un % del ancho de la PÁGINA (0.30). Antes era
//      0.65 y dejaba fuera cualquier tabla más angosta que dos tercios de la hoja — justamente la
//      del FORMATO N°7.
//   3. Las líneas se agrupan en TABLAS por solapamiento horizontal: dos líneas pertenecen a la
//      misma tabla si comparten la mayor parte de su rango de x. Así una fila alta de una tabla
//      no se confunde con el hueco que hay entre dos recuadros distintos.
//   4. Dentro de cada fila se buscan las VERTICALES, y las columnas son los intervalos entre
//      ellas. Dos columnas → etiqueta | casillero. Tres o más → grilla (ver arriba).
//   5. OCR AISLADO por celda de etiqueta (Tesseract con la opción `rectangle`, sin re-cortar la
//      imagen): mucho más preciso que OCR de la página completa, que se confunde con las líneas
//      del recuadro y da texto irreconocible.
//   6. La etiqueta reconocida se resuelve contra el MISMO diccionario que usan los .docx
//      (`campoDeEtiquetaInequivoca`, anexos-determinista.ts — afinado con casos reales) — no se
//      reimplementa el mapeo etiqueta→dato acá. PERO el diccionario espera coincidencia EXACTA
//      (patrones anclados con ^...$): funciona perfecto contra el texto LIMPIO de un XML de Word,
//      pero el OCR nunca es perfecto — "RUT OFERENTE |" (la '|' es ruido del borde de la celda) o
//      "LECIAL" en vez de "LEGAL" no matchean nada tal cual. Por eso antes de consultar el
//      diccionario se limpia el ruido típico de OCR (`limpiarRuidoOcr`), y si aun así no matchea,
//      un respaldo de palabras clave AMPLIAS cubre los campos de identificación más comunes —
//      bug real medido armando esto: 0/9 casillas resueltas sin esta limpieza, 7/9 con ella.
//
// ── QUÉ NO SE INVENTA ─────────────────────────────────────────────────────────────────────────
// Todo lo que no se resuelve con un dato REAL de la ficha queda en `campos` con `escrito: false`
// y sin valor. Es un asistente, no un reemplazo del criterio humano — sobre todo tratándose de
// una licitación pública. Además, ANTES de escribir se comprueba que la celda esté vacía: si ya
// tiene tinta, no es un casillero para completar y se deja como está.
//
// ── DE DÓNDE SALE EL DOCUMENTO ────────────────────────────────────────────────────────────────
// Puede ser un anexo suelto publicado por el organismo, o un formato RECORTADO de las bases por
// anexos-pdf-dividir.ts. En este segundo caso la página trae un CROPBOX más chico que el
// MediaBox, y eso importa: mupdf rasteriza el CropBox (lo que se ve) mientras que pdf-lib dibuja
// en el espacio del MediaBox. Sin corregir ese desplazamiento el texto sale escrito fuera de la
// zona visible. Ver `mapearAPuntos`.
import type { EmpresaCampos } from '@/app/lib/anexos-ia-motor';
import {
  campoDeEtiquetaInequivoca, normalizarEtiqueta, campoDeBlancoInline,
} from '@/app/lib/anexos-determinista';

// Ruido típico que el OCR pega a una celda recortada: la línea del borde de la tabla ("|"), o una
// letra suelta mal leída al final ("Nombre Representante 5 Apoderado" — el "o" de "o Apoderado"
// se leyó "5"). Se limpia ANTES de normalizarEtiqueta, sin tocar esa función (es la que usan los
// .docx, con sus propios tests — no se le agregan reglas pensadas solo para ruido de imagen).
function limpiarRuidoOcr(texto: string): string {
  return String(texto || '')
    .replace(/[|_~`]+/g, ' ')
    .replace(/\s+\d\s*$/, ' ') // dígito suelto al final (línea/borde mal leído)
    .replace(/\s+/g, ' ')
    .trim();
}

// Respaldo SOLO para cuando el diccionario exacto no matchea nada — no lo reemplaza, corre
// después. Palabras clave amplias a propósito (el texto vino de OCR sobre una imagen escaneada,
// nunca perfecto) pero acotadas a los campos de identificación de MENOR ambigüedad: no hay una
// versión de "nombre representante legal" que se pueda confundir con otro dato de la ficha, así
// que ensanchar el match acá es seguro. Campos más finos (fechas partidas, notaría, banco…) se
// dejan al diccionario exacto — si el OCR no los lee limpio, quedan pendientes, que es preferible
// a adivinar en un documento que se presenta a un organismo público.
const RESPALDO_OCR: Array<{ campo: keyof EmpresaCampos; patron: RegExp }> = [
  { campo: 'rut', patron: /^r\.?\s*u\.?\s*t\.?\s*(oferente|empresa)?$/i },
  { campo: 'razon_social', patron: /raz[oó]n\s+social|nombre\s+(del\s+)?oferente/i },
  { campo: 'representante_nombre', patron: /nombre.*(representante|apoderado)/i },
  { campo: 'representante_rut', patron: /c[eé]dula|identidad/i },
  { campo: 'direccion', patron: /direcci[oó]n/i },
  { campo: 'telefono1', patron: /tel[eé]fono|\bfono\b/i },
  { campo: 'email1', patron: /correo|e-?mail/i },
];

// ── CAPA DIFUSA — última red antes de dar la casilla por perdida ──────────────────────────────
// El diccionario exacto y el respaldo de arriba suponen que el texto llegó *casi* bien. Sobre un
// escaneo malo no llega: medido en el FORMATO N°1 de 545774-35-LE26, Tesseract leyó "GIRECCIÓN"
// por DIRECCIÓN, "NOMBRE RECRESENTANTE LECIAL" por NOMBRE REPRESENTANTE LEGAL, "CÉBULA DE
// ICENTIDCAD" por CÉDULA DE IDENTIDAD y "RLUTOFERENTE" por R.U.T OFERENTE. Ninguna matchea nada
// por regex: el formulario de identificación más típico que existe se resolvía en 0 de 6 casillas.
//
// Ninguna de esas lecturas se arregla agregando patrones — el error está en LETRAS SUELTAS, y hay
// infinitas variantes. Lo que sí es estable es la DISTANCIA: "girection" está a una sustitución de
// "direccion". Por eso la última capa compara la etiqueta contra un puñado de frases canónicas por
// distancia de edición normalizada.
//
// VIVE SOLO EN EL CAMINO DEL PDF ESCANEADO, nunca en el de los .docx: ahí el texto viene limpio de
// un XML y una comparación difusa solo podría EMPEORAR lo que ya resuelve bien. El umbral es
// relativo al largo, así que las etiquetas cortas ("RUT", "GIRO") exigen coincidencia exacta —
// justo las que más se confundirían entre sí si se les permitiera holgura.
const ETIQUETAS_CANONICAS: Array<{ campo: keyof EmpresaCampos; frases: string[] }> = [
  { campo: 'razon_social', frases: ['razon social del oferente', 'nombre o razon social del oferente', 'razon social', 'nombre del oferente', 'nombre o razon social', 'nombre del oferente o razon social de la utp', 'oferente'] },
  { campo: 'rut', frases: ['rut oferente', 'r u t oferente', 'rut de la empresa', 'rut empresa', 'cedula de identidad o rut'] },
  { campo: 'representante_nombre', frases: ['nombre representante legal', 'nombre del representante legal', 'nombre representante o apoderado comun', 'nombre del representante o apoderado comun'] },
  { campo: 'representante_rut', frases: ['cedula de identidad', 'cedula de identidad representante legal'] },
  { campo: 'direccion', frases: ['direccion', 'domicilio'] },
  { campo: 'telefono1', frases: ['telefono', 'telefono de contacto'] },
  { campo: 'email1', frases: ['correo electronico', 'correo'] },
  { campo: 'giro', frases: ['giro'] },
];
const DISTANCIA_MAX_RELATIVA = 0.25;

function distanciaEdicion(a: string, b: string): number {
  const fila = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let anterior = fila[0];
    fila[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const temp = fila[j];
      fila[j] = Math.min(fila[j] + 1, fila[j - 1] + 1, anterior + (a[i - 1] === b[j - 1] ? 0 : 1));
      anterior = temp;
    }
  }
  return fila[b.length];
}

function campoPorParecido(etiquetaNormalizada: string): keyof EmpresaCampos | null {
  const n = etiquetaNormalizada.replace(/\s+/g, ' ').trim();
  if (n.length < 3) return null;
  let mejor: { campo: keyof EmpresaCampos; ratio: number } | null = null;
  for (const entrada of ETIQUETAS_CANONICAS) {
    for (const frase of entrada.frases) {
      // Se compara SIN espacios: el OCR los pierde y los inventa ("RLUTOFERENTE" por "R.U.T
      // OFERENTE"), y un espacio de más no debería costar lo mismo que una letra equivocada.
      const a = n.replace(/ /g, ''), b = frase.replace(/ /g, '');
      const ratio = distanciaEdicion(a, b) / Math.max(a.length, b.length);
      if (ratio <= DISTANCIA_MAX_RELATIVA && (!mejor || ratio < mejor.ratio)) {
        mejor = { campo: entrada.campo, ratio };
      }
    }
  }
  return mejor?.campo ?? null;
}

function resolverEtiquetaPdf(etiquetaCruda: string, empresa: EmpresaCampos): { campo: string | null; valor: string | null } {
  const limpia = limpiarRuidoOcr(etiquetaCruda);
  let campo = campoDeEtiquetaInequivoca(limpia);
  const n = normalizarEtiqueta(limpia);
  if (!campo) campo = (RESPALDO_OCR.find(r => r.patron.test(n))?.campo as any) ?? null;
  if (!campo) campo = (campoPorParecido(n) as any) ?? null;
  return { campo, valor: valorDeCampo(empresa, campo) };
}

function valorDeCampo(empresa: EmpresaCampos, campo: string | null): string | null {
  if (!campo) return null;
  const v = (empresa as any)[campo];
  if (v == null) return null;
  const s = String(v).trim();
  return s ? s : null;
}

// ── Parámetros ────────────────────────────────────────────────────────────────────────────────
const ESCALA_OCR = 2.5;          // resolución del rasterizado que lee Tesseract
const ESCALA_GEOM = 0.75;        // resolución del rasterizado que busca líneas (ver cabecera: sesgo)
const TOL_PX = 2;                // banda de tolerancia en el rasterizado grueso
const UMBRAL_OSCURO = 35;        // oscuridad (255-luminosidad) que cuenta como "hay tinta"
const PCT_LINEA_TABLA = 0.30;    // % del ancho de página para que una corrida sea línea de tabla
const ALTO_MIN_FILA_FRAC = 0.012;
const ALTO_MAX_FILA_FRAC = 0.075;
const SOLAPE_MIN_TABLA = 0.60;   // solapamiento horizontal para que dos líneas sean la misma tabla
// Blanco inline: una raya de relleno. Más corta que una línea de tabla y con espacio en blanco
// encima (el hueco donde va el dato) — esa segunda condición es la que la distingue del subrayado
// de un título o del trazo grueso de una palabra en negrita.
const LARGO_MIN_BLANCO = 0.025;
const LARGO_MAX_BLANCO = 0.55;
const TINTA_MAX_VECINDAD = 0.06; // tinta admitida arriba Y abajo de una raya de relleno
const TINTA_MAX_CASILLA = 0.02;  // por encima de esto la celda ya tiene contenido: no se escribe

export type TipoCampoPdf = 'casilla' | 'grilla' | 'inline' | 'marcador';

export interface CampoPdfDetectado {
  pagina: number;
  tipo: TipoCampoPdf;
  etiqueta: string;
  campo: string | null;
  valor: string | null;
  /** Si el valor se escribió de verdad en el PDF. Falso en grillas y marcadores (ver cabecera). */
  escrito: boolean;
  /** Por qué no se escribió, cuando corresponde — para mostrárselo al asistente. */
  motivo?: string;
  confianzaOcr: number;
}

export interface ResultadoRellenoPdf {
  bufferFinal: Buffer;
  campos: CampoPdfDetectado[];
  totalDetectados: number;
  completados: number;
}

// ── Rasterizado ───────────────────────────────────────────────────────────────────────────────

/** Copia los píxeles ANTES de pedir el PNG: mupdf reusa la memoria WASM y `asPNG()` invalida el
 *  typed array que devuelve `getPixels()` si se llama después (bug real, mismo hallazgo). */
function rasterizar(page: any, mupdf: any, escala: number) {
  const pix = page.toPixmap(mupdf.Matrix.scale(escala, escala), mupdf.ColorSpace.DeviceRGB, false);
  return {
    stride: pix.getStride(),
    comp: pix.getNumberOfComponents(),
    width: pix.getWidth(),
    height: pix.getHeight(),
    pixels: Buffer.from(pix.getPixels()),
    png: Buffer.from(pix.asPNG()),
  };
}

interface Lienzo {
  width: number; height: number;
  oscuridad(x: number, y: number): number;
  tintaH(x: number, y: number): boolean;  // tolerancia VERTICAL (para líneas horizontales)
  tintaV(x: number, y: number): boolean;  // tolerancia HORIZONTAL (para líneas verticales)
  proporcionTinta(x0: number, y0: number, x1: number, y1: number): number;
}

function crearLienzo(r: { stride: number; comp: number; width: number; height: number; pixels: Buffer }): Lienzo {
  const { stride, comp, width, height, pixels } = r;
  const oscuridad = (x: number, y: number) => {
    if (x < 0 || y < 0 || x >= width || y >= height) return 0;
    const i = y * stride + x * comp;
    return 255 - (pixels[i] + pixels[i + 1] + pixels[i + 2]) / 3;
  };
  return {
    width, height, oscuridad,
    tintaH(x, y) {
      for (let d = -TOL_PX; d <= TOL_PX; d++) if (oscuridad(x, y + d) > UMBRAL_OSCURO) return true;
      return false;
    },
    tintaV(x, y) {
      for (let d = -TOL_PX; d <= TOL_PX; d++) if (oscuridad(x + d, y) > UMBRAL_OSCURO) return true;
      return false;
    },
    proporcionTinta(x0, y0, x1, y1) {
      let oscuros = 0, total = 0;
      for (let y = Math.max(0, Math.round(y0)); y < Math.min(height, Math.round(y1)); y++) {
        for (let x = Math.max(0, Math.round(x0)); x < Math.min(width, Math.round(x1)); x++) {
          total++;
          if (oscuridad(x, y) > UMBRAL_OSCURO) oscuros++;
        }
      }
      return total ? oscuros / total : 0;
    },
  };
}

// ── Líneas y tablas ───────────────────────────────────────────────────────────────────────────

interface Linea { y: number; x0: number; x1: number }

/** Corridas horizontales de tinta, agrupadas en líneas (una línea de 3 px de grosor es UNA línea). */
function detectarLineas(l: Lienzo, largoMinFrac: number): Linea[] {
  const largoMin = l.width * largoMinFrac;
  const crudas: Linea[] = [];
  for (let y = 0; y < l.height; y++) {
    let inicio = 0, corrida = 0, mejor = { largo: 0, x0: 0, x1: 0 };
    for (let x = 0; x < l.width; x++) {
      if (l.tintaH(x, y)) {
        if (corrida === 0) inicio = x;
        corrida++;
        if (corrida > mejor.largo) mejor = { largo: corrida, x0: inicio, x1: x };
      } else corrida = 0;
    }
    if (mejor.largo > largoMin) crudas.push({ y, x0: mejor.x0, x1: mejor.x1 });
  }
  const lineas: Linea[] = [];
  let grupo: Linea[] = [];
  const cerrar = () => {
    if (!grupo.length) return;
    lineas.push({
      y: Math.round(grupo.reduce((a, b) => a + b.y, 0) / grupo.length),
      x0: Math.min(...grupo.map(g => g.x0)),
      x1: Math.max(...grupo.map(g => g.x1)),
    });
    grupo = [];
  };
  for (const c of crudas) {
    if (grupo.length && c.y - grupo[grupo.length - 1].y > 3) cerrar();
    grupo.push(c);
  }
  cerrar();
  return lineas;
}

/** Dos líneas son de la misma tabla si comparten la mayor parte de su rango horizontal. */
function mismaTabla(a: Linea, b: Linea): boolean {
  const solape = Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0);
  if (solape <= 0) return false;
  const menor = Math.min(a.x1 - a.x0, b.x1 - b.x0);
  return menor > 0 && solape / menor >= SOLAPE_MIN_TABLA;
}

interface Tabla { lineas: Linea[]; x0: number; x1: number; y0: number; y1: number }

function agruparTablas(lineas: Linea[]): Tabla[] {
  const tablas: Tabla[] = [];
  for (const linea of lineas) {
    const abierta = tablas.find(t => mismaTabla(t.lineas[t.lineas.length - 1], linea));
    if (abierta) {
      abierta.lineas.push(linea);
      abierta.x0 = Math.min(abierta.x0, linea.x0);
      abierta.x1 = Math.max(abierta.x1, linea.x1);
      abierta.y1 = linea.y;
    } else {
      tablas.push({ lineas: [linea], x0: linea.x0, x1: linea.x1, y0: linea.y, y1: linea.y });
    }
  }
  return tablas.filter(t => t.lineas.length >= 2);
}

/** Líneas verticales dentro de una banda, agrupadas (un borde de 2 px es UNA vertical). */
function verticalesEnBanda(l: Lienzo, y0: number, y1: number, x0: number, x1: number): number[] {
  const alto = y1 - y0;
  if (alto < 4) return [];
  const xs: number[] = [];
  for (let x = Math.max(0, x0); x <= Math.min(l.width - 1, x1); x++) {
    let corrida = 0, max = 0;
    for (let y = y0 + 2; y < y1 - 2; y++) {
      if (l.tintaV(x, y)) { corrida++; if (corrida > max) max = corrida; } else corrida = 0;
    }
    if (max > (alto - 4) * 0.7) xs.push(x);
  }
  const salida: number[] = [];
  let grupo: number[] = [];
  const cerrar = () => {
    if (grupo.length) salida.push(Math.round(grupo.reduce((a, b) => a + b, 0) / grupo.length));
    grupo = [];
  };
  // Dos verticales más juntas que esto son el MISMO borde leído doble (el trazo del escaneo, o el
  // marco doble de un recuadro). Contarlas por separado inventa una columna de dos píxeles de
  // ancho y convierte un simple "etiqueta | casillero" en una falsa grilla de tres columnas —
  // bug real medido en el FORMATO N°1, donde TELÉFONO y CORREO ELECTRÓNICO se reportaban como
  // grilla y quedaban sin rellenar pese a estar perfectamente leídos.
  const separacionMinima = Math.max(3, l.width * 0.015);
  for (const x of xs) {
    if (grupo.length && x - grupo[grupo.length - 1] > separacionMinima) cerrar();
    grupo.push(x);
  }
  cerrar();
  return salida;
}

interface FilaTabla { y0: number; y1: number; columnas: Array<{ x0: number; x1: number }> }

/**
 * Vuelve a buscar la línea horizontal en el TRAMO de x que interesa.
 *
 * La `y` de una línea es el promedio de toda su longitud, y en un escaneo torcido eso no coincide
 * con dónde pasa la línea sobre una celda concreta: medido en la pág. 35 del documento real, el
 * desvío entre el extremo izquierdo y el derecho llega a ~18 px (a 2.5×). Recortar la celda de la
 * etiqueta con la `y` promedio corta el texto por la mitad, y el OCR devuelve basura — "OFERENTE"
 * se leía "fa o a" y "RUT" se leía "E Y", con lo que el FORMATO N°7 quedaba en 0 casillas pese a
 * tener la tabla perfectamente detectada.
 */
function ajustarYLocal(l: Lienzo, y: number, x0: number, x1: number, altoFila: number): number {
  // El margen de búsqueda NO puede acercarse al alto de la fila: si se le permite, la línea de
  // arriba puede "encontrarse" a la altura de la de abajo y la banda de la celda termina abarcando
  // el borde del recuadro. Ese borde cuenta como tinta, y una celda perfectamente vacía se
  // descarta con un "el casillero ya tiene contenido" — bug real en el FORMATO N°7, donde el
  // casillero de OFERENTE quedaba sin rellenar.
  const margen = Math.max(2, Math.min(Math.round(l.height * 0.008), Math.floor(altoFila * 0.3)));
  let mejor = { y, tinta: -1 };
  for (let candidata = y - margen; candidata <= y + margen; candidata++) {
    const tinta = l.proporcionTinta(x0, candidata, x1, candidata + 1);
    if (tinta > mejor.tinta) mejor = { y: candidata, tinta };
  }
  return mejor.y;
}

/** Filas de una tabla, con sus columnas. Una "fila" sin verticales es el hueco entre dos recuadros. */
function filasDeTabla(l: Lienzo, tabla: Tabla): FilaTabla[] {
  const altoMin = l.height * ALTO_MIN_FILA_FRAC;
  const altoMax = l.height * ALTO_MAX_FILA_FRAC;
  const filas: FilaTabla[] = [];
  for (let i = 0; i < tabla.lineas.length - 1; i++) {
    const y0 = tabla.lineas[i].y, y1 = tabla.lineas[i + 1].y;
    const alto = y1 - y0;
    if (alto < altoMin || alto > altoMax) continue;
    const verticales = verticalesEnBanda(l, y0, y1, tabla.x0, tabla.x1);
    if (verticales.length < 2) continue;

    const anchoMinimoColumna = l.width * 0.03;
    const columnas: Array<{ x0: number; x1: number }> = [];
    for (let v = 0; v < verticales.length - 1; v++) {
      const columna = { x0: verticales[v], x1: verticales[v + 1] };
      if (columna.x1 - columna.x0 >= anchoMinimoColumna) columnas.push(columna);
    }
    // Borde derecho no detectado (pasa cuando la última vertical se pierde en el margen): la
    // última columna llega hasta donde llegaba la línea horizontal.
    if (columnas.length === 1 && tabla.x1 - verticales[verticales.length - 1] > 10) {
      columnas.push({ x0: verticales[verticales.length - 1], x1: tabla.x1 });
    }
    if (columnas.length) filas.push({ y0, y1, columnas });
  }
  return filas;
}

// ── Blancos inline (rayas de relleno en prosa) ────────────────────────────────────────────────

/**
 * Corrida de tinta continua en UNA SOLA fila de píxeles, tolerando micro-huecos del escaneo.
 *
 * A diferencia de las líneas de tabla, acá NO se usa la banda de tolerancia vertical: una raya de
 * relleno es corta, y con tolerancia ±2 cualquier renglón de texto produce corridas larguísimas
 * (la banda va uniendo letras de filas vecinas). Medido en el FORMATO N°5: 39 "candidatas" con
 * tolerancia, de las cuales 35 eran renglones de prosa atravesados por una raya falsa.
 */
function corridaContinua(l: Lienzo, y: number): { largo: number; x0: number; x1: number } {
  const HUECO_MAX = 2;
  let inicio = -1, fin = -1, hueco = 0;
  let mejor = { largo: 0, x0: 0, x1: 0 };
  const cerrar = () => { if (inicio >= 0 && fin - inicio > mejor.largo) mejor = { largo: fin - inicio, x0: inicio, x1: fin }; };
  for (let x = 0; x < l.width; x++) {
    if (l.oscuridad(x, y) > UMBRAL_OSCURO) { if (inicio < 0) inicio = x; fin = x; hueco = 0; }
    else if (inicio >= 0 && ++hueco > HUECO_MAX) { cerrar(); inicio = -1; hueco = 0; }
  }
  cerrar();
  return mejor;
}

/**
 * Rayas de relleno: cortas, continuas, fuera de toda tabla, y AISLADAS verticalmente.
 *
 * El aislamiento es el filtro que de verdad separa una raya de relleno de un renglón de texto: una
 * raya tiene blanco arriba (el hueco donde va el dato) Y abajo. Un trazo de texto siempre tiene el
 * cuerpo de su propia línea en uno de los dos lados. Medido sobre el FORMATO N°5, este par de
 * comprobaciones deja exactamente las 4 rayas reales de la hoja y descarta las 35 falsas.
 *
 * La banda se mide a cierta DISTANCIA de la raya, no pegada a ella: pegada, lo que se cuenta es el
 * propio antialiasing del trazo y no queda ninguna raya en pie (probado: 0 de 4).
 */
function detectarRayas(l: Lienzo, zonasTabla: Array<{ y0: number; y1: number; x0: number; x1: number }>): Linea[] {
  const largoMin = l.width * LARGO_MIN_BLANCO;
  const crudas: Linea[] = [];
  for (let y = 0; y < l.height; y++) {
    const c = corridaContinua(l, y);
    if (c.largo > largoMin) crudas.push({ y, x0: c.x0, x1: c.x1 });
  }
  const lineas: Linea[] = [];
  let grupo: Linea[] = [];
  const cerrar = () => {
    if (grupo.length) {
      lineas.push({
        y: Math.round(grupo.reduce((a, b) => a + b.y, 0) / grupo.length),
        x0: Math.min(...grupo.map(g => g.x0)),
        x1: Math.max(...grupo.map(g => g.x1)),
      });
    }
    grupo = [];
  };
  for (const c of crudas) {
    if (grupo.length && c.y - grupo[grupo.length - 1].y > 3) cerrar();
    grupo.push(c);
  }
  cerrar();

  const cerca = Math.round(2 * ESCALA_OCR);   // dónde empieza la banda de vecindad
  const lejos = Math.round(5 * ESCALA_OCR);   // dónde termina
  return lineas.filter(linea => {
    const largo = (linea.x1 - linea.x0) / l.width;
    if (largo < LARGO_MIN_BLANCO || largo > LARGO_MAX_BLANCO) return false;
    const enTabla = zonasTabla.some(z =>
      linea.y >= z.y0 - cerca && linea.y <= z.y1 + cerca &&
      Math.min(linea.x1, z.x1) - Math.max(linea.x0, z.x0) > (linea.x1 - linea.x0) * 0.5);
    if (enTabla) return false;
    if (l.proporcionTinta(linea.x0, linea.y - lejos, linea.x1, linea.y - cerca) > TINTA_MAX_VECINDAD) return false;
    return l.proporcionTinta(linea.x0, linea.y + cerca, linea.x1, linea.y + lejos) <= TINTA_MAX_VECINDAD;
  });
}

/**
 * Una raya con "FIRMA" escrito justo debajo es el renglón donde el oferente firma de puño y letra,
 * no una casilla de dato. Escribir el nombre del representante ahí lo pondría en el lugar de la
 * firma en un documento que se presenta a un organismo público.
 */
function esRayaDeFirma(raya: Linea, lineas: LineaOcrPagina[]): boolean {
  return lineas.some(linea => {
    const alto = Math.max(1, linea.y1 - linea.y0);
    if (linea.y0 < raya.y || linea.y0 > raya.y + alto * 2.2) return false;
    const solape = Math.min(linea.x1, raya.x1) - Math.max(linea.x0, raya.x0);
    if (solape <= 0) return false;
    return /firma|firmado/i.test(linea.texto);
  });
}

// ── OCR: líneas, palabras y párrafos ──────────────────────────────────────────────────────────

interface PalabraOcr { texto: string; x0: number; x1: number }
interface LineaOcrPagina { texto: string; y0: number; y1: number; x0: number; x1: number; palabras: PalabraOcr[] }

function lineasDeOcr(data: any): LineaOcrPagina[] {
  const salida: LineaOcrPagina[] = [];
  for (const b of data?.blocks || []) {
    for (const p of b.paragraphs || []) {
      for (const linea of p.lines || []) {
        const texto = String(linea.text || '').trim();
        if (!texto) continue;
        salida.push({
          texto,
          y0: linea.bbox.y0, y1: linea.bbox.y1, x0: linea.bbox.x0, x1: linea.bbox.x1,
          palabras: (linea.words || [])
            .map((w: any) => ({ texto: String(w.text || ''), x0: w.bbox.x0, x1: w.bbox.x1 }))
            .filter((w: PalabraOcr) => w.texto.trim()),
        });
      }
    }
  }
  return salida.sort((a, b) => a.y0 - b.y0);
}

// Marca con la que se representa una raya de relleno dentro del párrafo reconstruido. Se usan
// guiones bajos porque es lo que `campoDeBlancoInline` ve en un .docx: sus reglas ya conviven con
// ellos (hay una que existe justamente para que la raya ANTERIOR no se coma la etiqueta actual).
const MARCA_BLANCO = '_____';

interface ParrafoReconstruido {
  texto: string;
  /** Blancos de este párrafo, con su posición dentro de `texto` y la raya que los produjo. */
  blancos: Array<{ pos: number; raya: Linea }>;
}

/**
 * Reconstruye los párrafos de la página a partir de las líneas OCR, insertando una marca donde
 * cada raya de relleno cae entre dos palabras.
 *
 * POR QUÉ POR PÁRRAFO Y NO POR LÍNEA: el FORMATO N°5 dice "Yo, ___ en representación de la empresa
 * ___ RUT ___" repartido en dos renglones. Si cada renglón se mira por separado, el blanco que
 * abre el segundo no tiene NADA a su izquierda y `campoDeBlancoInline` lo descarta (con razón:
 * un blanco sin contexto previo no se puede resolver). Unidos en un párrafo, ese mismo blanco
 * lleva delante "en representación de la empresa" y se resuelve solo.
 */
function reconstruirParrafos(lineas: LineaOcrPagina[], rayas: Linea[], factorGeomAOcr: number): ParrafoReconstruido[] {
  const rayasOcr = rayas.map(r => ({
    raya: r,
    y: r.y * factorGeomAOcr,
    x0: r.x0 * factorGeomAOcr,
    x1: r.x1 * factorGeomAOcr,
  }));
  const usadas = new Set<number>();
  const parrafos: ParrafoReconstruido[] = [];
  let actual: ParrafoReconstruido | null = null;
  let finAnterior = -1e9;
  let altoAnterior = 0;

  lineas.forEach(linea => {
    const alto = Math.max(1, linea.y1 - linea.y0);
    // Renglón del mismo párrafo si el hueco vertical es menor que ~una línea. Un salto mayor es
    // otro bloque (título, otra cláusula) y arrastrar su contexto llevaría a resolver mal.
    const sigue = actual != null && linea.y0 - finAnterior < Math.max(alto, altoAnterior) * 0.9;
    if (!sigue) { actual = { texto: '', blancos: [] }; parrafos.push(actual); }
    const parrafo = actual!;

    // Piezas de este renglón: palabras y rayas, ordenadas por x.
    const piezas: Array<{ x: number; texto: string; raya?: Linea; indice?: number }> =
      linea.palabras.map(p => ({ x: p.x0, texto: p.texto }));
    rayasOcr.forEach((r, i) => {
      if (usadas.has(i)) return;
      // La raya se apoya en la base del renglón: cae dentro de la caja o justo debajo.
      if (r.y >= linea.y0 && r.y <= linea.y1 + alto * 0.55) {
        usadas.add(i);
        piezas.push({ x: r.x0, texto: MARCA_BLANCO, raya: r.raya, indice: i });
      }
    });
    piezas.sort((a, b) => a.x - b.x);

    for (const pieza of piezas) {
      if (parrafo.texto && !parrafo.texto.endsWith(' ')) parrafo.texto += ' ';
      if (pieza.raya) parrafo.blancos.push({ pos: parrafo.texto.length, raya: pieza.raya });
      parrafo.texto += pieza.texto;
    }
    finAnterior = linea.y1;
    altoAnterior = alto;
  });

  return parrafos;
}

// Marcador del organismo incrustado en la prosa: "<nombre de representante legal>". El OCR de un
// escaneo destroza los delimitadores (medido en la pág. 34 del documento real: "«nombre de
// representante legal-o persona natural," — la apertura quedó como comilla angular y el cierre
// como coma). Por eso la apertura se acepta laxa y el cierre también; lo que NO se hace es
// escribir sobre un marcador reconocido así (ver cabecera: van a pendientes con el valor
// propuesto, porque una lectura dudosa no puede decidir dónde se pinta encima del documento).
const RE_MARCADOR = /[<\u00ab]\s*([^<\u00ab\n]{3,90}?)\s*(?=[<\u00ab]|$)/g;

// ── Coordenadas ───────────────────────────────────────────────────────────────────────────────

/**
 * Convierte un punto del rasterizado (px, medido desde ARRIBA) a coordenadas de pdf-lib.
 *
 * mupdf rasteriza el CROPBOX — lo que se ve de la página — mientras que pdf-lib dibuja en el
 * espacio del MediaBox. En un anexo suelto los dos coinciden y da igual; en un formato RECORTADO
 * de las bases (anexos-pdf-dividir.ts) el CropBox es una franja, y sin sumar su desplazamiento el
 * texto termina escrito en una parte de la hoja que nadie ve.
 */
function mapearAPuntos(caja: { x: number; y: number; width: number; height: number }, escala: number) {
  return (xPx: number, yPx: number) => ({
    x: caja.x + xPx / escala,
    y: caja.y + caja.height - yPx / escala,
  });
}

// ── Motor ─────────────────────────────────────────────────────────────────────────────────────

/** Rellena un PDF escaneado (sin capa de texto ni campos de formulario) con los datos de la
 *  empresa, escribiendo directo sobre el documento original. Multi-página: procesa todas. */
export async function rellenarAnexoPdfEscaneado(
  bufferOriginal: Buffer, empresa: EmpresaCampos,
): Promise<ResultadoRellenoPdf> {
  const mupdf = await import('mupdf');
  const { createWorker } = await import('tesseract.js');
  const { PDFDocument, rgb, StandardFonts } = await import('pdf-lib');

  const mupdfDoc = mupdf.Document.openDocument(bufferOriginal, 'application/pdf');
  const totalPaginas = mupdfDoc.countPages();

  const pdfLibDoc = await PDFDocument.load(bufferOriginal);
  const font = await pdfLibDoc.embedFont(StandardFonts.Helvetica);
  const paginasPdfLib = pdfLibDoc.getPages();

  const worker = await createWorker('spa', undefined, { cachePath: process.env.TESSERACT_CACHE_PATH || '.tesseract-cache' });
  const campos: CampoPdfDetectado[] = [];
  const AZUL = rgb(0.05, 0.05, 0.55);

  try {
    for (let p = 0; p < totalPaginas; p++) {
      const page = mupdfDoc.loadPage(p);
      const fino = rasterizar(page, mupdf, ESCALA_OCR);
      const grueso = rasterizar(page, mupdf, ESCALA_GEOM);
      const lienzo = crearLienzo(grueso);   // líneas de tabla: robusto al sesgo del escaneo
      const lienzoFino = crearLienzo(fino);  // rayas de relleno: precisión de un solo píxel
      const pdfPage = paginasPdfLib[p];
      // El CropBox es lo que mupdf rasterizó; el factor lo alinea con el espacio de pdf-lib.
      const caja = pdfPage.getCropBox();
      const aPuntos = mapearAPuntos(caja, ESCALA_GEOM);
      const aPuntosFino = mapearAPuntos(caja, ESCALA_OCR);
      const geomAOcr = ESCALA_OCR / ESCALA_GEOM;

      const lineas = detectarLineas(lienzo, PCT_LINEA_TABLA);
      const tablas = agruparTablas(lineas);

      // ── 1 y 2. Tablas ───────────────────────────────────────────────────────────────────────
      for (const tabla of tablas) {
        for (const fila of filasDeTabla(lienzo, tabla)) {
          const etiquetaCelda = fila.columnas[0];
          // ¿Hay contenido en esta celda? Se mide solo el TERCIO CENTRAL de la fila. Un escaneo
          // torcido mete el borde del recuadro en diagonal dentro de la banda de la celda —
          // medido en el FORMATO N°7: el casillero de OFERENTE, vacío a la vista, daba 5% de
          // "tinta" porque la línea superior de la tabla lo cruzaba por arriba. Con eso el motor
          // lo descartaba con un "el casillero ya tiene contenido". El centro de la fila, en
          // cambio, solo tiene tinta si de verdad hay algo escrito.
          const tinta = (f: FilaTabla, c: { x0: number; x1: number }) => {
            const arriba = ajustarYLocal(lienzo, f.y0, c.x0, c.x1, f.y1 - f.y0);
            const abajo = ajustarYLocal(lienzo, f.y1, c.x0, c.x1, f.y1 - f.y0);
            const margen = (abajo - arriba) * 0.2;
            return lienzo.proporcionTinta(c.x0 + 2, arriba + margen, c.x1 - 2, abajo - margen);
          };

          // La banda vertical se recalcula SOBRE CADA COLUMNA (ver ajustarYLocal): con el escaneo
          // torcido, la fila no está a la misma altura a la izquierda que a la derecha.
          const rect = (c: { x0: number; x1: number }) => {
            const alto = fila.y1 - fila.y0;
            const arriba = ajustarYLocal(lienzo, fila.y0, c.x0, c.x1, alto);
            const abajo = ajustarYLocal(lienzo, fila.y1, c.x0, c.x1, alto);
            return {
              left: Math.round((c.x0 + 2) * geomAOcr),
              top: Math.round((arriba + 2) * geomAOcr),
              width: Math.max(10, Math.round((c.x1 - c.x0 - 4) * geomAOcr)),
              height: Math.max(10, Math.round((abajo - arriba - 4) * geomAOcr)),
            };
          };

          // UNA GRILLA SE RECONOCE POR TENER VARIAS COLUMNAS CON TEXTO, no por tener varias
          // columnas. Bug real del FORMATO N°1: los recuadros de TELÉFONO y CORREO ELECTRÓNICO
          // traen una línea vertical de más (el marco doble del recuadro), así que salían como
          // "grilla de 3 columnas" y quedaban sin rellenar aunque la etiqueta se leía perfecta.
          // Una grilla de verdad — la de integrantes de la UTP, la del anexo económico — tiene
          // ENCABEZADOS en todas sus columnas; un casillero subdividido tiene texto solo en la
          // primera y el resto vacío, esperando el dato.
          const conTinta = fila.columnas.filter(c => tinta(fila, c) > TINTA_MAX_CASILLA);
          const esGrilla = fila.columnas.length >= 3 && conTinta.length >= 2;

          if (esGrilla) {
            // Se leen TODAS las columnas para que el pendiente diga qué pide la grilla, no solo
            // la primera celda. No se escribe nada: ver la cabecera del archivo.
            const textos: string[] = [];
            let confianza = 0;
            for (const columna of fila.columnas) {
              const { data } = await worker.recognize(fino.png, { rectangle: rect(columna) });
              textos.push((data.text || '').trim().replace(/\s+/g, ' '));
              confianza = Math.max(confianza, Math.round(data.confidence || 0));
            }
            const etiqueta = textos.filter(Boolean).join(' | ');
            if (!etiqueta) continue;
            campos.push({
              pagina: p + 1, tipo: 'grilla', etiqueta, campo: null, valor: null, escrito: false,
              motivo: `Grilla de ${fila.columnas.length} columnas: se completa a mano (una fila por integrante o por ítem, no son datos de la ficha de la empresa).`,
              confianzaOcr: confianza,
            });
            continue;
          }

          const { data: ocr } = await worker.recognize(fino.png, { rectangle: rect(etiquetaCelda) });
          const etiqueta = (ocr.text || '').trim().replace(/\s+/g, ' ');
          if (!etiqueta) continue;
          const { campo, valor } = resolverEtiquetaPdf(etiqueta, empresa);
          // El casillero es la columna VACÍA más ancha a la derecha de la etiqueta: en un recuadro
          // subdividido la segunda columna puede ser una astilla del marco, y el dato va en la de
          // al lado.
          const vacias = fila.columnas.slice(1).filter(c => !conTinta.includes(c));
          const casilla = vacias.sort((a, b) => (b.x1 - b.x0) - (a.x1 - a.x0))[0];

          let escrito = false;
          let motivo: string | undefined;
          if (!valor) {
            motivo = campo ? 'La ficha de la empresa no tiene este dato.' : 'No se pudo reconocer qué dato pide.';
          } else if (!casilla) {
            motivo = 'La fila no tiene ningún casillero vacío donde escribir.';
          } else {
            const alto = fila.y1 - fila.y0;
            const arriba = ajustarYLocal(lienzo, fila.y0, casilla.x0, casilla.x1, alto);
            const abajo = ajustarYLocal(lienzo, fila.y1, casilla.x0, casilla.x1, alto);
            const { x, y } = aPuntos(casilla.x0 + 4, (arriba + abajo) / 2);
            pdfPage.drawText(valor, { x, y: y - 4, size: 10, font, color: AZUL });
            escrito = true;
          }
          campos.push({
            pagina: p + 1, tipo: 'casilla', etiqueta, campo, valor: escrito ? valor : null,
            escrito, motivo, confianzaOcr: Math.round(ocr.confidence || 0),
          });
        }
      }

      // ── 3. Blancos inline y marcadores ──────────────────────────────────────────────────────
      // Las tablas viven en el rasterizado grueso y las rayas en el fino: hay que llevar las
      // zonas de tabla al mismo sistema antes de excluirlas.
      const zonasTabla = tablas.map(t => ({
        y0: t.y0 * geomAOcr, y1: t.y1 * geomAOcr, x0: t.x0 * geomAOcr, x1: t.x1 * geomAOcr,
      }));
      const { data: ocrPagina } = await worker.recognize(fino.png, {}, { blocks: true } as any);
      const lineasOcr = lineasDeOcr(ocrPagina);
      const rayas = detectarRayas(lienzoFino, zonasTabla).filter(r => !esRayaDeFirma(r, lineasOcr));
      const parrafos = reconstruirParrafos(lineasOcr, rayas, 1);
      const confianzaPagina = Math.round((ocrPagina as any).confidence || 0);

      for (const parrafo of parrafos) {
        for (const blanco of parrafo.blancos) {
          const campo = campoDeBlancoInline({
            indiceRun: 0, indiceParrafo: 0, textoRunOriginal: parrafo.texto,
            posEnTexto: blanco.pos, largo: MARCA_BLANCO.length,
            contexto: parrafo.texto.slice(Math.max(0, blanco.pos - 70), blanco.pos + 70),
            parrafoCompleto: parrafo.texto, posEnParrafo: blanco.pos,
          } as any);
          const valor = valorDeCampo(empresa, campo);
          const etiqueta = parrafo.texto.slice(Math.max(0, blanco.pos - 60), blanco.pos).trim() || '(sin contexto)';

          let escrito = false;
          let motivo: string | undefined;
          if (!campo) motivo = 'No se pudo determinar qué dato va en esta raya.';
          else if (!valor) motivo = 'La ficha de la empresa no tiene este dato.';
          else {
            // Encima de la raya, no sobre ella: el escaneo ya trae la línea dibujada.
            const { x, y } = aPuntosFino(blanco.raya.x0 + 4, blanco.raya.y);
            pdfPage.drawText(valor, { x, y: y + 2, size: 9, font, color: AZUL });
            escrito = true;
          }
          campos.push({
            pagina: p + 1, tipo: 'inline', etiqueta: `…${etiqueta} ___`,
            campo: campo ?? null, valor: escrito ? valor : null, escrito, motivo,
            confianzaOcr: confianzaPagina,
          });
        }

        RE_MARCADOR.lastIndex = 0;
        let m: RegExpExecArray | null;
        while ((m = RE_MARCADOR.exec(parrafo.texto)) != null) {
          const campo = campoDeBlancoInline({
            indiceRun: 0, indiceParrafo: 0, textoRunOriginal: parrafo.texto,
            posEnTexto: m.index, largo: m[0].length, contexto: m[0], textoMarcador: m[1],
            parrafoCompleto: parrafo.texto, posEnParrafo: m.index,
          } as any);
          // Solo se reporta el marcador que el diccionario supo resolver: con el cierre laxo, un
          // marcador sin campo es casi siempre ruido del OCR, y llenar la lista de pendientes con
          // ruido la vuelve inútil.
          if (!campo) continue;
          campos.push({
            pagina: p + 1, tipo: 'marcador', etiqueta: m[0].trim(),
            campo, valor: valorDeCampo(empresa, campo), escrito: false,
            motivo: 'Marcador dentro del párrafo: hay que reemplazarlo a mano (escribir encima taparía el texto original del organismo).',
            confianzaOcr: confianzaPagina,
          });
        }
      }
    }
  } finally {
    await worker.terminate().catch(() => {});
  }

  const bufferFinal = Buffer.from(await pdfLibDoc.save());
  return {
    bufferFinal, campos,
    totalDetectados: campos.length,
    completados: campos.filter(c => c.escrito).length,
  };
}
