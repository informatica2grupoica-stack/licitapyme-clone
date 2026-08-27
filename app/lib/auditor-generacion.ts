// app/lib/auditor-generacion.ts
// AUDITOR — decide si un BLOQUE del checklist ya está en condiciones de generar su anexo, y con
// QUÉ documento de la licitación hacerlo.
//
// POR QUÉ POR BLOQUE Y NO POR ÍTEM (18-ago-2026): un anexo ADMINISTRATIVO es uno por punto del
// checklist, así que el botón "Generar" por fila funciona. El ECONÓMICO no: es UN solo documento
// que consume TODAS las líneas de precio (12 líneas = 12 filas del checklist, un único anexo). Un
// botón por fila obligaría a apretar doce para un mismo archivo. Lo mismo el TÉCNICO, que consume
// la ficha técnica de todos los productos.
//
// REGLA QUE NO SE NEGOCIA: el documento a rellenar es SIEMPRE el .docx que publicó el organismo en
// Mercado Público. Nunca una plantilla nuestra. Este módulo solo ELIGE cuál de los documentos ya
// descargados corresponde; el relleno lo hace el motor de anexos sobre ese archivo, y su chequeo de
// integridad (mismo número de párrafos antes y después) garantiza que sale el documento del
// organismo con los datos puestos, no otro.
//
// Módulo PURO: sin DB, sin red, sin IA. Recibe lo que el auditor ya tiene cargado y devuelve una
// decisión con su motivo. Así se puede testear cada regla, que es donde estaban los errores caros.

export type BloqueGenerable = 'COMERCIAL' | 'TECNICO';

/** Categoría con la que anexos-dividir.ts clasificó cada documento al separarlo. */
export type CategoriaAnexoDoc = 'administrativo' | 'tecnico' | 'economico' | 'sin_clasificar';

export interface DocumentoCandidato {
  id: number;
  nombre: string;
  categoria: CategoriaAnexoDoc | null;
  /** URL del archivo en R2 — la necesita el modal de relleno para abrir el documento original. */
  url?: string;
}

/**
 * Etiquetas que muestran lo que DISTINGUE a cada documento candidato, no lo que comparten.
 *
 * BUG REAL (26-ago-2026, 1057922-23-LE26): la pantalla mostraba `nombre.slice(0, 40)` y los 7
 * anexos técnicos de esa licitación se llaman
 * `FORMULARIO_N3_ESPECIFICACIONES_TÉCNICAS_<PRODUCTO>.docx`. El prefijo común mide EXACTAMENTE 40
 * caracteres, así que los 7 botones salían idénticos: se mostraba justo la parte que todos
 * comparten y se escondía la única que los diferencia. Elegir era imposible.
 *
 * Se recorta el prefijo común a todos, pero solo hasta un separador (_ - espacio) para no cortar
 * a mitad de palabra, y solo si a TODOS les queda algo que mostrar — si a alguno lo dejara vacío
 * (su nombre es el prefijo de los demás), se devuelven los nombres completos: mejor largo que
 * ambiguo.
 */
export function etiquetasDistinguibles(nombres: string[]): string[] {
  const limpio = (n: string) => String(n || '').replace(/\.(docx?|pdf|xlsx?)$/i, '');
  const base = nombres.map(limpio);
  if (base.length <= 1) return base.map(bonito);

  // Prefijo común carácter a carácter, recortado al último separador para no partir una palabra.
  let corte = base[0].length;
  for (const n of base.slice(1)) {
    let i = 0;
    while (i < corte && i < n.length && base[0][i] === n[i]) i++;
    corte = i;
  }
  const sep = Math.max(base[0].lastIndexOf('_', corte), base[0].lastIndexOf('-', corte),
                       base[0].lastIndexOf(' ', corte));
  const recorte = sep > 0 ? sep + 1 : 0;
  const cortos = base.map(n => n.slice(recorte).trim());
  return cortos.every(c => c.length > 0) ? cortos.map(bonito) : base.map(bonito);
}

/** `SET_CONTENEDORES` → `Set contenedores`. Los nombres vienen en MAYÚSCULAS con guiones bajos. */
function bonito(n: string): string {
  const texto = n.replace(/_+/g, ' ').replace(/\s+/g, ' ').trim();
  const legible = texto === texto.toUpperCase()
    ? texto.charAt(0) + texto.slice(1).toLowerCase()
    : texto;
  return legible.length > 46 ? `${legible.slice(0, 46)}…` : legible;
}

export interface ItemBloque {
  /** 'PENDIENTE' | 'CARGADO' | 'APROBADO' | 'OBSERVADO' */
  estado: string | null;
  /** Las líneas que el asistente marcó "no ofertamos" no bloquean la generación. */
  ofertamos?: boolean | null;
}

export interface DecisionGeneracion {
  puede: boolean;
  /** Frase para mostrar en la UI: si `puede` es false, dice exactamente qué falta. */
  motivo: string;
  /** Documento de la licitación pre-seleccionado. El humano confirma; nunca se genera a ciegas. */
  documentoSugerido: DocumentoCandidato | null;
  /** Otros documentos de la misma categoría, por si el sugerido no es el correcto. */
  alternativas: DocumentoCandidato[];
}

const CATEGORIA_DE_BLOQUE: Record<BloqueGenerable, CategoriaAnexoDoc> = {
  COMERCIAL: 'economico',
  TECNICO: 'tecnico',
};

const ETIQUETA: Record<BloqueGenerable, string> = {
  COMERCIAL: 'económico',
  TECNICO: 'técnico',
};

/**
 * ¿Se puede generar el anexo de este bloque?
 *
 * El orden de los chequeos importa: se informa PRIMERO lo que el usuario puede resolver por sí
 * mismo (cargar el costeo, pedir la aprobación) y al final lo que no depende de él (la licitación
 * no pide ese anexo). Nunca se devuelve un botón habilitado sin documento, ni un "no se puede"
 * sin decir qué falta — un botón muerto o un error mudo son justo lo que este auditor viene a
 * evitar.
 */
export function decidirGeneracion(args: {
  bloque: BloqueGenerable;
  /** Ítems del bloque en el checklist. */
  items: ItemBloque[];
  /** ¿Hay una versión de costeo vigente cargada? Solo se exige para el bloque COMERCIAL. */
  hayCosteoVigente: boolean;
  /**
   * ¿El bloque COMERCIAL del Auditor ya trae datos aprobados con qué llenar el anexo (precio,
   * plazo)? (21-ago-2026) El precio que vive en un ítem APROBADO ya es el número que bendijo el
   * asesor — exigir ADEMÁS un costeo cargado es pedir dos veces lo mismo. El Costeo sigue siendo
   * válido como fuente (y tiene prioridad si el Auditor no alcanza a cubrir alguna casilla), pero
   * deja de ser un requisito duro para habilitar el botón.
   */
  hayDatosAuditorComercial?: boolean;
  /** Documentos Word de la licitación, ya clasificados por anexos-dividir.ts. */
  documentos: DocumentoCandidato[];
  /** El costeo cambió después de la aprobación — ver `congelado` más abajo. */
  costeoCambiadoTrasAprobar?: boolean;
}): DecisionGeneracion {
  const { bloque, items, hayCosteoVigente, hayDatosAuditorComercial, documentos } = args;
  const etiqueta = ETIQUETA[bloque];
  const vacia = { documentoSugerido: null, alternativas: [] as DocumentoCandidato[] };

  // Los puntos que el asistente marcó "no ofertamos" salen del cálculo: no tener precio en una
  // línea que no se oferta no es un pendiente.
  const relevantes = items.filter(i => i.ofertamos !== false);

  if (relevantes.length === 0) {
    return { puede: false, motivo: `Este bloque no tiene puntos que generen el anexo ${etiqueta}.`, ...vacia };
  }

  // 1. Alguna fuente de precios — el Costeo O el propio Auditor ya aprobado. Antes exigía SIEMPRE
  //    el Costeo; ahora basta con cualquiera de los dos, y el Auditor manda si ambos existen (ver
  //    anexos-auditor-fuente.ts).
  if (bloque === 'COMERCIAL' && !hayCosteoVigente && !hayDatosAuditorComercial) {
    return { puede: false, motivo: 'Falta el costeo o el precio aprobado en el Auditor. El anexo económico necesita alguno de los dos para saber qué precio poner.', ...vacia };
  }

  // 2. Aprobación del asesor. Un anexo económico generado desde un costeo sin visar es
  //    exactamente el error que el flujo de doble firma existe para evitar.
  const sinAprobar = relevantes.filter(i => i.estado !== 'APROBADO');
  if (sinAprobar.length > 0) {
    const observados = relevantes.filter(i => i.estado === 'OBSERVADO').length;
    return {
      puede: false,
      motivo: observados > 0
        ? `${observados} punto(s) observado(s) por el asesor. Corrígelos y vuelve a enviarlos a visar antes de generar el anexo ${etiqueta}.`
        : `Faltan ${sinAprobar.length} punto(s) por aprobar. El anexo ${etiqueta} se genera recién con el bloque visado.`,
      ...vacia,
    };
  }

  // 3. El costeo cambió DESPUÉS de que el asesor aprobó: lo aprobado ya no es lo que se generaría.
  if (args.costeoCambiadoTrasAprobar) {
    return {
      puede: false,
      motivo: 'El costeo cambió después de la aprobación. Pide al asesor que vuelva a visar el bloque para que el anexo salga con las cifras aprobadas.',
      ...vacia,
    };
  }

  // 4. ¿La licitación pide este anexo? Si al separar no apareció ninguno de esta categoría, no hay
  //    nada que generar — y eso NO es un error: hay licitaciones que no piden anexo técnico.
  const dela = documentos.filter(d => d.categoria === CATEGORIA_DE_BLOQUE[bloque]);
  if (dela.length === 0) {
    return {
      puede: false,
      motivo: `Esta licitación no trae ningún anexo ${etiqueta} entre sus documentos. Si existe pero quedó sin clasificar, sepáralo o elígelo a mano.`,
      ...vacia,
    };
  }

  return {
    puede: true,
    motivo: dela.length === 1
      ? `Listo para generar sobre "${dela[0].nombre}".`
      : `Listo para generar. Hay ${dela.length} anexos ${etiqueta}: confirma cuál corresponde.`,
    documentoSugerido: dela[0],
    alternativas: dela.slice(1),
  };
}
