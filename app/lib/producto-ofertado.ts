// app/lib/producto-ofertado.ts
// Lee MARCA / MODELO / FABRICANTE / PAÍS del texto de la ficha técnica del proveedor.
//
// POR QUÉ (26-ago-2026): los formularios técnicos abren con "INFORMACIÓN DE LA OFERTA" pidiendo
// justo esos campos, y el sistema no los tenía en ninguna parte. Pero SÍ están en la ficha que el
// asistente ya sube: en el caso real 611669-17-LE26 la ficha se llama
// "Ficha tecnica original LS-150.pdf" y adentro dice la marca y el modelo. Los teníamos delante.
//
// DETERMINISTA, SIN IA. Se buscan las etiquetas tal como las escriben los fabricantes ("Marca:",
// "Brand:", "Modelo:", "Model:"). Es un módulo PURO: entra texto, sale lo encontrado, sin tocar
// red ni base — así se testea contra fichas reales sin montar nada.
//
// NUNCA INVENTA. Si una etiqueta no está, el campo sale null y alguien lo escribe a mano. Estos
// cuatro datos se imprimen en un documento que evalúa el organismo: declarar una marca equivocada
// es peor que dejar la casilla vacía. Por eso lo leído queda marcado como `origen: 'ficha'` y
// necesita confirmación humana antes de considerarse definitivo — ver migration-79.
//
// OJO CON UNA CONFUSIÓN CARA: el informe guarda `marca_modelo_referencia`, que es LA MARCA QUE
// PIDEN LAS BASES ("marca X o equivalente"), NO la que ofertamos. Este módulo no la mira.

export interface ProductoOfertado {
  marca: string | null;
  modelo: string | null;
  fabricante: string | null;
  paisFabricacion: string | null;
  anioFabricacion: string | null;
}

/** Etiquetas por campo, en castellano e inglés (las fichas de fábrica suelen venir en inglés). */
const ETIQUETAS: Record<keyof ProductoOfertado, string[]> = {
  marca: ['marca', 'brand', 'fabricante/marca'],
  modelo: ['modelo', 'model', 'model no', 'modelo n', 'referencia', 'part number', 'p/n'],
  fabricante: ['fabricante', 'manufacturer', 'fabricado por', 'manufactured by', 'made by'],
  paisFabricacion: ['pais de fabricacion', 'pais de origen', 'pais', 'country of origin', 'origen', 'made in'],
  anioFabricacion: ['ano de fabricacion', 'anio de fabricacion', 'year of manufacture', 'ano'],
};

const sinTildes = (s: string) =>
  s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

/**
 * Valores que NO son un dato aunque aparezcan después de la etiqueta: la ficha trae el rótulo
 * vacío, o un guion de relleno. Guardar eso sería peor que no guardar nada.
 */
const RE_VACIO = /^([-_.\s]|n\/?a|s\/?i|sin informacion|no aplica)*$/i;

/** Un valor razonable para estos campos: corto y sin saltos. Si es largo, se agarró una frase. */
function valorPlausible(v: string): string | null {
  const t = v.replace(/\s+/g, ' ').trim().replace(/[.;,]+$/, '');
  if (!t || t.length > 80) return null;
  if (RE_VACIO.test(sinTildes(t))) return null;
  return t;
}

/**
 * Busca `Etiqueta: valor` en el texto. Acepta que el valor esté en la misma línea o en la
 * siguiente (las fichas en tabla parten el rótulo y el dato en renglones distintos al extraerse).
 */
function buscarEtiqueta(lineas: string[], etiquetas: string[]): string | null {
  for (let i = 0; i < lineas.length; i++) {
    const linea = lineas[i];
    const plano = sinTildes(linea);
    for (const et of etiquetas) {
      // La etiqueta tiene que estar al PRINCIPIO del renglón (o tras una viñeta): si no,
      // "equivalente a la marca X" se leería como si fuera nuestra marca.
      const re = new RegExp(`^[\\s>*·•\\-|]*${et.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')}\\s*[:=]\\s*(.*)$`, 'i');
      const m = plano.match(re);
      if (!m) continue;
      // Se recorta sobre la línea ORIGINAL (con tildes y mayúsculas), no sobre la normalizada.
      const desde = linea.length - m[1].length;
      const enLinea = valorPlausible(linea.slice(Math.max(0, desde)));
      if (enLinea) return enLinea;
      // Rótulo sin valor al lado → el dato suele estar en el renglón siguiente.
      if (i + 1 < lineas.length) {
        const siguiente = valorPlausible(lineas[i + 1]);
        // Que el renglón siguiente no sea OTRA etiqueta.
        if (siguiente && !/[:=]\s*$/.test(siguiente) && !esEtiquetaConocida(siguiente)) return siguiente;
      }
    }
  }
  return null;
}

function esEtiquetaConocida(texto: string): boolean {
  const plano = sinTildes(texto).replace(/[:=].*$/, '').trim();
  return Object.values(ETIQUETAS).some(lista => lista.includes(plano));
}

/**
 * Extrae lo que se pueda del texto de la ficha. Los campos que no aparecen quedan en null.
 *
 * @param texto texto ya extraído de la ficha (PDF/Word)
 * @param nombreArchivo opcional; se usa SOLO para el modelo y solo si el texto no lo trae —
 *        "Ficha tecnica original LS-150.pdf" lleva el modelo en el nombre, que es una pista real
 *        pero más débil que el contenido, así que nunca le gana a lo que diga la ficha.
 */
export function extraerProductoOfertado(texto: string, nombreArchivo?: string): ProductoOfertado {
  const lineas = String(texto || '').split(/\r?\n/).map(l => l.trim()).filter(Boolean);

  const out: ProductoOfertado = {
    marca: buscarEtiqueta(lineas, ETIQUETAS.marca),
    modelo: buscarEtiqueta(lineas, ETIQUETAS.modelo),
    fabricante: buscarEtiqueta(lineas, ETIQUETAS.fabricante),
    paisFabricacion: buscarEtiqueta(lineas, ETIQUETAS.paisFabricacion),
    anioFabricacion: buscarEtiqueta(lineas, ETIQUETAS.anioFabricacion),
  };

  // Las fichas de fábrica muchas veces NO son una tabla con "Marca:" sino un folleto comercial
  // (caso real LS-150: la palabra "marca" solo aparece en "marcas registradas"). Ahí hay que leer
  // las señales que el folleto sí trae. Se usan solo como respaldo: lo etiquetado siempre gana.
  if (!out.marca) out.marca = marcaDesdeDominio(texto);
  if (!out.fabricante) out.fabricante = out.marca;   // en un folleto de fábrica son lo mismo
  if (!out.modelo) out.modelo = modeloDesdeEncabezado(texto);
  if (!out.modelo && nombreArchivo) out.modelo = modeloDesdeNombreArchivo(nombreArchivo);
  return out;
}

/** Dominios que no dicen nada de la marca. */
const SUBDOMINIOS_GENERICOS = new Set(['www', 'sensing', 'shop', 'store', 'soporte', 'support', 'es', 'us', 'cl']);
const DOMINIOS_GENERICOS = new Set(['gmail', 'hotmail', 'outlook', 'youtube', 'facebook', 'linkedin', 'instagram', 'google']);

/**
 * Marca a partir del sitio web que aparece en la ficha.
 *
 * "SENSING.KONICAMINOLTA.COM" → el dominio es "konicaminolta" → y como el texto además escribe
 * "KONICA MINOLTA" separado, se devuelve ESA grafía, que es la correcta. El dominio confirma cuál
 * es la marca; el texto da cómo se escribe. Si el texto no trae la versión separada, se devuelve
 * el dominio tal cual, que sigue siendo un dato real del documento y no un invento.
 */
export function marcaDesdeDominio(texto: string): string | null {
  const t = String(texto || '');
  const dominios = t.match(/\b[a-z0-9][a-z0-9.-]*\.(?:com|cl|net|org|es|de|jp)\b/gi) || [];
  for (const d of dominios) {
    const partes = d.toLowerCase().split('.');
    partes.pop();                                   // el TLD
    const nombre = partes.reverse().find(p => !SUBDOMINIOS_GENERICOS.has(p));
    if (!nombre || nombre.length < 4 || DOMINIOS_GENERICOS.has(nombre)) continue;

    // ¿El texto escribe ese mismo nombre separado en palabras? ("konicaminolta" → "KONICA MINOLTA")
    const separado = buscarGrafiaSeparada(t, nombre);
    return separado || nombre.toUpperCase();
  }
  return null;
}

/**
 * Busca en el texto una secuencia de 2 o 3 palabras cuya concatenación sea `compacto`.
 * Devuelve la grafía tal como aparece, o null.
 */
function buscarGrafiaSeparada(texto: string, compacto: string): string | null {
  const palabras = texto.match(/[A-Za-zÁÉÍÓÚÑáéíóúñ]{2,}/g) || [];
  const encontradas: string[] = [];
  for (let i = 0; i < palabras.length; i++) {
    for (const largo of [2, 3]) {
      if (i + largo > palabras.length) continue;
      const trozo = palabras.slice(i, i + largo);
      if (sinTildes(trozo.join('')) === compacto) encontradas.push(trozo.join(' '));
    }
  }
  if (!encontradas.length) return null;
  // Se prefiere la grafía que NO viene toda en mayúsculas: en las fichas, la versión en altas casi
  // siempre sale del aviso legal ("KONICA MINOLTA … son marcas registradas") y la de tipo título es
  // la que el fabricante usa para nombrarse. En un documento que evalúa el organismo, "Konica
  // Minolta" se lee mejor que "KONICA MINOLTA".
  return encontradas.find(g => g !== g.toUpperCase()) || encontradas[0];
}

/**
 * Modelo desde el encabezado de la ficha ("Medidor de Luminancia LS-150/LS-160").
 *
 * Solo decide si encuentra UN código en las primeras líneas. Si la ficha cubre varios modelos
 * —"LS-150/LS-160" es un folleto de dos equipos— NO elige uno: cuál se oferta es una decisión
 * comercial, no algo que se deduzca del documento. Queda para el nombre del archivo o para la
 * persona.
 */
export function modeloDesdeEncabezado(texto: string): string | null {
  const primeras = String(texto || '').split(/\r?\n/).slice(0, 8).join(' ');
  const RE_CODIGO = /\b[A-Z]{1,6}-?\d{2,6}[A-Z0-9-]*\b/g;
  const encontrados = Array.from(new Set(primeras.match(RE_CODIGO) || []));
  return encontrados.length === 1 ? encontrados[0] : null;
}

/**
 * Modelo a partir del nombre del archivo: "Ficha tecnica original LS-150.pdf" → "LS-150".
 *
 * Se exige la forma típica de un código de modelo —letras y números unidos por guion, o letras
 * seguidas de números— y que NO sea una palabra común del nombre del archivo. Es una pista, no una
 * certeza: por eso solo se usa cuando la ficha no lo dice, y queda como `origen: 'ficha'`,
 * pendiente de confirmación.
 */
export function modeloDesdeNombreArchivo(nombre: string): string | null {
  const base = String(nombre || '').replace(/\.[a-z0-9]{2,5}$/i, '');
  const candidatos = base.split(/[\s_]+/).filter(Boolean);
  const RE_MODELO = /^[A-Za-z]{1,6}[-–]?\d{2,6}[A-Za-z0-9-]*$/;
  for (let i = candidatos.length - 1; i >= 0; i--) {         // el modelo suele ir al final
    const c = candidatos[i].replace(/^[([]|[)\]]$/g, '');
    if (RE_MODELO.test(c)) return c;
  }
  return null;
}

/** ¿Se encontró al menos un dato? Para no crear filas vacías en la base. */
export function tieneAlgo(p: ProductoOfertado): boolean {
  return Object.values(p).some(v => v != null && String(v).trim() !== '');
}
