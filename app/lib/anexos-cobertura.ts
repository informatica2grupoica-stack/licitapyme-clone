// app/lib/anexos-cobertura.ts
// AUTODIAGNÓSTICO del motor de anexos: ¿este documento se entendió, o el motor se quedó ciego?
//
// POR QUÉ EXISTE (18-ago-2026): todos los bugs graves de este motor se descubrieron porque un
// HUMANO abrió el .docx generado y vio que faltaba algo. Ejemplos reales del mismo día:
//   · 2296-48-LE26  — el organismo rotula "FORMATO" y no "FORMULARIO": 7 anexos pegados, 0 detectados.
//   · 1247197-54-LE26 — marcadores con UN par de ángulos (`<nombre…>`): 7 marcadores, 0 detectados.
// En los dos casos el sistema respondió "no hay nada que separar" / "no hay nada que llenar" — una
// respuesta INDISTINGUIBLE de la de un documento que de verdad no pide nada. El fallo era silencioso
// y podía durar semanas hasta que alguien mirara.
//
// La señal que los delata a los dos es la misma y es puramente aritmética: **el texto está lleno de
// marcas de "acá escribe tú" y el detector no encontró ninguna casilla.** Un documento de solo
// lectura (unas bases, un decreto) no tiene esas marcas; un formulario sí. Comparar las dos cifras
// convierte un fallo invisible en un aviso.
//
// NO reemplaza al detector ni intenta arreglar nada: solo mide y avisa. Es la red que hace que un
// formato nuevo cueste minutos en vez de una licitación perdida.

/** Marcas de relleno en el texto plano — las mismas formas que reconoce anexos-docx.ts. */
const SENALES: { nombre: string; re: RegExp }[] = [
  { nombre: 'rayas', re: /_{4,}/g },
  { nombre: 'puntos', re: /[.…]{6,}/g },
  { nombre: 'marcador <<>>', re: /<<[^<>]{2,200}?>>/g },
  { nombre: 'marcador <>', re: /<[^<>]{2,200}?>/g },
  { nombre: 'marcador []', re: /\[[^[\]]{2,200}?\]/g },
  { nombre: 'marcador {{}}', re: /\{\{[^{}]{2,200}?\}\}/g },
  { nombre: 'marcador «»', re: /«[^«»]{2,200}?»/g },
  // "Etiqueta:" al final de una línea — el patrón 5. Se exige que la línea sea corta para no contar
  // los dos puntos de una oración legal ("…declara bajo juramento que:").
  { nombre: 'etiqueta:', re: /^[^\n]{2,70}:[ \t]*$/gm },
];

export type SeveridadCobertura = 'ok' | 'revisar' | 'ciego';

export interface DiagnosticoCobertura {
  severidad: SeveridadCobertura;
  /** Frase lista para mostrar o loguear. */
  motivo: string;
  /** Cuántas marcas de relleno trae el texto, por tipo (solo las que aparecen). */
  senales: Record<string, number>;
  totalSenales: number;
  casillasDetectadas: number;
  casillasResueltas: number;
  parrafosConTexto: number;
}

// Un documento puede traer una raya suelta (una línea decorativa, un separador) sin ser un
// formulario. Por debajo de este número de señales no se concluye nada.
const MIN_SENALES_PARA_SOSPECHAR = 3;
// Si el detector encontró menos de esta fracción de las señales, algo se está perdiendo. No se
// exige 1:1 a propósito: una línea de firma, un separador decorativo o una raya dentro de una
// instrucción son señales legítimas que NO son casillas.
const FRACCION_MINIMA_DETECTADA = 0.4;

/**
 * Compara las marcas de relleno del texto contra lo que el detector realmente encontró.
 *
 * `casillasDetectadas` es el total de casillas (celda + inline + celdas de tabla), resueltas o no.
 * `casillasResueltas` son las que quedaron con un valor. La distinción importa: 0 detectadas es un
 * problema de DETECCIÓN (formato nuevo); muchas detectadas y 0 resueltas es un problema de
 * DICCIONARIO (etiquetas que no conocemos).
 */
export function diagnosticarCobertura(args: {
  textoPlano: string;
  parrafosConTexto: number;
  casillasDetectadas: number;
  casillasResueltas: number;
  /**
   * Casillas que NO salen de la ficha de empresa por diseño: precios, cantidades, marcas, modelos,
   * plazos ofertados, decisiones del usuario, firmas de terceros. Salen del costeo, de la ficha
   * técnica o de un juicio comercial — que queden en blanco es lo CORRECTO, no un fallo.
   *
   * Sin esto, un anexo económico con 45 celdas de precios se reportaba como "no se pudo completar
   * ninguna" (caso real 1171142-100-LE26). Un aviso que salta donde no hay problema enseña a
   * ignorar los avisos, que es exactamente lo que este módulo viene a evitar.
   */
  casillasFueraDeAlcance?: number;
}): DiagnosticoCobertura {
  const { textoPlano, parrafosConTexto, casillasDetectadas, casillasResueltas } = args;
  const fueraDeAlcance = args.casillasFueraDeAlcance ?? 0;
  // Lo que el motor SÍ debía poder completar. Si todo lo detectado está fuera de alcance, no hay
  // nada que reprocharle.
  const enAlcance = Math.max(0, casillasDetectadas - fueraDeAlcance);
  const senales: Record<string, number> = {};
  let totalSenales = 0;
  for (const s of SENALES) {
    const n = (textoPlano.match(s.re) || []).length;
    if (n > 0) { senales[s.nombre] = n; totalSenales += n; }
  }

  const base = { senales, totalSenales, casillasDetectadas, casillasResueltas, parrafosConTexto };

  // Documento de solo lectura (bases, decreto, resolución): sin marcas de relleno no hay nada que
  // detectar y "0 casillas" es la respuesta correcta, no un fallo.
  if (totalSenales < MIN_SENALES_PARA_SOSPECHAR) {
    return { ...base, severidad: 'ok', motivo: 'El documento no trae marcas de relleno — no es un formulario a completar.' };
  }

  // CIEGO: el texto está lleno de marcas y el detector no vio ninguna. Es el patrón exacto de
  // "formato nuevo que no entiendo" (FORMATO, marcador <…>).
  if (casillasDetectadas === 0) {
    return {
      ...base, severidad: 'ciego',
      motivo: `El documento trae ${totalSenales} marca(s) de relleno (${describir(senales)}) pero el motor no detectó ninguna casilla. `
        + 'Probablemente usa un formato de casilla que todavía no reconocemos.',
    };
  }

  // Detectó bastante menos de lo que el texto sugiere.
  if (casillasDetectadas / totalSenales < FRACCION_MINIMA_DETECTADA) {
    return {
      ...base, severidad: 'revisar',
      motivo: `Se detectaron ${casillasDetectadas} casilla(s) para ${totalSenales} marca(s) de relleno (${describir(senales)}). `
        + 'Puede que parte del documento use un formato que no reconocemos.',
    };
  }

  // Detectó, pero no supo llenar NADA de lo que le tocaba. No es ceguera: es el diccionario.
  if (casillasResueltas === 0 && enAlcance > 0) {
    return {
      ...base, severidad: 'revisar',
      motivo: `Se detectaron ${enAlcance} casilla(s) que deberían salir de la ficha, pero no se pudo `
        + 'completar ninguna — las etiquetas de este documento no calzan con ningún dato conocido.',
    };
  }

  // FALLO REAL NO DETECTADO (18-ago-2026, ANEXO N°5 de 1057480-41-LP26, reportado por el usuario):
  // el anexo tenía DOS casillas de ficha —"NOMBRE PROVEEDOR / EMPRESA" y "RUT"— y solo se llenó el
  // RUT. Como `casillasResueltas > 0`, el diagnóstico daba "ok" y yo reporté la auditoría como
  // limpia: en un anexo de cinco líneas faltaba el nombre del oferente. Un aviso que solo mira "¿se
  // llenó ALGO?" no sirve; tiene que mirar cuánto de lo que le TOCABA quedó sin llenar.
  const sinResolverEnAlcance = Math.max(0, enAlcance - casillasResueltas);
  if (sinResolverEnAlcance > 0) {
    return {
      ...base, severidad: 'revisar',
      motivo: `Quedaron ${sinResolverEnAlcance} de ${enAlcance} casilla(s) que debían salir de la ficha sin completar `
        + `(se completaron ${casillasResueltas}). Revisa si alguna etiqueta de este documento no está en el diccionario.`,
    };
  }

  return { ...base, severidad: 'ok', motivo: `${casillasResueltas} de ${casillasDetectadas} casilla(s) completadas automáticamente.` };
}

function describir(senales: Record<string, number>): string {
  return Object.entries(senales).map(([k, n]) => `${n} ${k}`).join(', ');
}

/**
 * Línea de log lista para el servidor. Se emite SOLO cuando hay algo que mirar, para que en los
 * logs del VPS un formato nuevo salte a la vista en vez de perderse entre corridas normales.
 */
export function logCobertura(codigo: string, documento: string, d: DiagnosticoCobertura): void {
  if (d.severidad === 'ok') return;
  const marca = d.severidad === 'ciego' ? '🔴 CIEGO' : '🟡 REVISAR';
  console.warn(`[anexos-cobertura] ${marca} · ${codigo} · "${documento}" — ${d.motivo}`);
}
