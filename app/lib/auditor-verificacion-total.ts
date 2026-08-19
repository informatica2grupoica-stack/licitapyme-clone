// app/lib/auditor-verificacion-total.ts
// GUARDARRAÍL FINAL del anexo económico: antes de subir el .docx generado, comprobar que lo que
// quedó escrito en el papel es lo mismo que el asesor aprobó en el costeo.
//
// POR QUÉ (18-ago-2026): el anexo económico es el único documento donde un error de cifra cuesta
// la licitación completa — se adjudica por precio. El motor comercial YA detecta la discordancia
// costeo↔anexo, pero solo como ALERTA informativa: el archivo se subía igual. Acá el mismo chequeo
// pasa a ser BLOQUEANTE en el momento de generar, que es el último punto donde todavía se puede
// evitar el error sin consecuencias.
//
// Módulo PURO (sin DB, sin red): recibe los dos totales y decide. Toda la dificultad real está en
// las dos excepciones legítimas de abajo — el IVA y las líneas no ofertadas — que son la razón por
// la que esto no puede ser una comparación de igualdad a secas.

/** Multiplicador de IVA en Chile. */
const IVA = 1.19;

/**
 * Tolerancia en PESOS, no en porcentaje.
 *
 * Doctrina heredada del motor comercial (spec §7.3: "no existe rango por redondeo, para eso está la
 * columna sin decimales"): el costeo trae una columna de precio unitario SIN decimales justamente
 * para que el total sea exacto. Se admite $1 por línea de holgura porque al multiplicar
 * unitario × cantidad y sumar, el redondeo del último peso puede desplazarse; más que eso ya no es
 * redondeo, es otro precio.
 */
const TOLERANCIA_POR_LINEA = 1;

export interface VerificacionTotal {
  /** true = se puede subir el anexo. */
  calza: boolean;
  /** Diferencia en pesos contra la referencia más cercana (0 si calza). */
  diferencia: number;
  /** Contra qué calzó o debía calzar: el neto del costeo o ese neto con IVA. */
  referencia: 'neto' | 'con_iva' | 'ninguna';
  /** Frase para mostrarle al usuario. Siempre explica qué hacer, nunca "no cumple" a secas. */
  mensaje: string;
}

/**
 * Convierte un monto escrito en un documento chileno a número.
 *
 * Vive acá y no suelto en la ruta porque es donde un error silencioso es más caro: si devuelve 0
 * por no entender el formato, el guardarraíl lo lee como "anexo sin precio" y BLOQUEA una oferta
 * correcta. El sufijo ".-" ("$ 21.589.995.-") es la forma más común de escribir un monto en Chile y
 * era justo el que rompía el parseo.
 */
export function montoDesdeTexto(v: string): number {
  const limpio = String(v ?? '')
    .replace(/[^\d,.-]/g, '')      // fuera "$", espacios, "CLP", "IVA incl."
    .replace(/[.,-]+$/, '')        // sufijos: "21.589.995.-", "1.000.-", "500,"
    .replace(/\./g, '')            // puntos de miles
    .replace(',', '.');            // coma decimal chilena
  const n = Number(limpio);
  return Number.isFinite(n) ? n : 0;
}

const fmt = (n: number) =>
  new Intl.NumberFormat('es-CL', { style: 'currency', currency: 'CLP', maximumFractionDigits: 0 }).format(n);

/**
 * ¿El total escrito en el anexo coincide con el costeo aprobado?
 *
 * Se acepta que calce con el NETO o con el BRUTO (neto × 1,19): hay organismos que piden la oferta
 * con IVA incluido en el formulario y otros sin IVA, y el costeo siempre guarda el neto. Bloquear
 * una oferta correcta por eso sería peor que el error que se busca evitar.
 */
export function verificarTotalEconomico(args: {
  /** Suma de los precios que quedaron escritos en el anexo (del costeo + lo que el humano escribió). */
  totalEnAnexo: number | null;
  /** Total neto del costeo vigente y aprobado. */
  totalCosteoNeto: number | null;
  /** Cuántas líneas de precio tiene el anexo — define la holgura de redondeo admitida. */
  lineas?: number;
}): VerificacionTotal {
  const { totalEnAnexo, totalCosteoNeto } = args;
  const holgura = Math.max(1, args.lineas ?? 1) * TOLERANCIA_POR_LINEA;

  // Sin costeo no hay contra qué comparar: no se bloquea, pero se dice. El chequeo de que HAYA
  // costeo vive en auditor-generacion.ts; acá no se duplica.
  if (totalCosteoNeto == null || totalCosteoNeto <= 0) {
    return { calza: true, diferencia: 0, referencia: 'ninguna', mensaje: 'No hay un total de costeo con el que comparar; el anexo se genera sin esta verificación.' };
  }

  // El anexo no trae ningún precio escrito: es un anexo económico en blanco. Bloquear acá evita
  // subir un formulario de oferta sin oferta, que es inadmisible de plano.
  if (totalEnAnexo == null || totalEnAnexo <= 0) {
    return {
      calza: false, diferencia: totalCosteoNeto, referencia: 'ninguna',
      mensaje: `El anexo económico quedó sin ningún precio escrito, pero el costeo aprobado suma ${fmt(totalCosteoNeto)}. `
        + 'Revisa que las casillas de precio se hayan detectado antes de subirlo.',
    };
  }

  const conIva = totalCosteoNeto * IVA;
  const difNeto = Math.abs(totalEnAnexo - totalCosteoNeto);
  const difIva = Math.abs(totalEnAnexo - conIva);

  if (difNeto <= holgura) {
    return { calza: true, diferencia: 0, referencia: 'neto', mensaje: `El total del anexo (${fmt(totalEnAnexo)}) coincide con el costeo aprobado.` };
  }
  if (difIva <= holgura) {
    return { calza: true, diferencia: 0, referencia: 'con_iva', mensaje: `El total del anexo (${fmt(totalEnAnexo)}) coincide con el costeo aprobado, con IVA incluido.` };
  }

  // No calza con ninguna de las dos referencias: se informa la MÁS CERCANA, porque es la que revela
  // qué pasó (si se acerca al bruto, el formulario pedía IVA y falta o sobra alguna línea).
  const cercaDelIva = difIva < difNeto;
  const referencia = cercaDelIva ? 'con_iva' : 'neto';
  const esperado = cercaDelIva ? conIva : totalCosteoNeto;
  const diferencia = cercaDelIva ? difIva : difNeto;
  return {
    calza: false, diferencia, referencia,
    mensaje: `El total escrito en el anexo (${fmt(totalEnAnexo)}) NO coincide con el costeo aprobado `
      + `(${fmt(esperado)}${cercaDelIva ? ' con IVA' : ''}): difieren en ${fmt(diferencia)}. `
      + 'Revisa el costeo o las casillas de precio del anexo antes de subirlo — el precio es lo que se evalúa.',
  };
}
