// app/lib/auditor-tecnico-core.ts
// PARTE PURA del Auditor Técnico — tipos y funciones sin IA, importables desde Client Components.
//
// Separado de auditor-tecnico.ts porque ese módulo importa crearChatIA (app/lib/gemini.ts), que
// a su vez usa node:async_hooks (solo Node). checklist-comercial.ts se importa desde un Client
// Component (app/negocios/[id]/page.tsx) y solo necesita lineasTecnicasDelInforme() — al traerla
// de auditor-tecnico.ts arrastraba toda la cadena hasta gemini.ts y rompía el build de Turbopack
// ("the chunking context does not support external modules: node:async_hooks"). Este módulo es
// el punto de import seguro para código puro; auditor-tecnico.ts sigue siendo dueño de las
// funciones que llaman IA y re-exporta lo de aquí para no romper a sus consumidores existentes.

export type TipoRequisitoTecnico = 'PISO' | 'TECHO' | 'EXACTO' | 'RANGO';
export type VeredictoTecnico = 'CUMPLE' | 'NO_CUMPLE' | 'CUMPLE_CON_COMPLEMENTO';
export type OrigenCaracteristica = 'interrogatorio' | 'ficha' | 'manual';

export interface LineaTecnica {
  linea: number;
  nombre: string;
  clasificacion: 'especifico' | 'generico' | null;
  marcaModeloReferencia: string | null;
  admiteEquivalente: boolean | null;
  caracteristicas: string[];   // texto libre, tal cual el informe de viabilidad
  cantidad: number | null;
  unidadMedida: string | null;
}

export interface CaracteristicaClasificada {
  descripcion: string;
  tipo: TipoRequisitoTecnico;
  valorRequeridoTexto: string | null;
  valorRequeridoNumero: number | null;
  valorRequeridoNumeroMax: number | null;   // solo RANGO
  unidadRequerida: string | null;
  fundamentoCita: string | null;
  confianza: number;   // 0-100
}

export interface VeredictoCaracteristica {
  valorOfertadoTexto: string | null;
  valorOfertadoNumero: number | null;
  unidadOfertadaOriginal: string | null;
  valorConvertidoNumero: number | null;
  veredicto: VeredictoTecnico | null;
  pendienteConfirmacionProveedor: boolean;
  fundamentoDocumento: string | null;
  fundamentoCita: string | null;
  confianza: number;
}

export interface ResumenLinea { total: number; cumplen: number; noCumplen: number; conComplemento: number; sinEvaluar: number; pendientesProveedor: number }

// Normaliza "confianza" a escala 0-100. Verificado en vivo (27-jul-2026, caso real 2279-44-LE26):
// pese a que el prompt pide explícitamente "0-100", glm-5.2 devuelve sistemáticamente una
// fracción 0-1 (0.95, 0.98…) para este campo. Guardia determinista: si viene ≤1 (y no es
// exactamente 0), se asume escala 0-1 y se multiplica — un valor legítimo de "1%" de confianza
// es prácticamente inexistente en la práctica, así que el falso positivo de esta heurística es
// irrelevante frente al bug sistemático que corrige.
export function normalizarConfianza(raw: unknown): number {
  const n = Number(raw);
  if (!Number.isFinite(n)) return 50;
  const escalada = n > 0 && n <= 1 ? n * 100 : n;
  return Math.max(0, Math.min(100, escalada));
}

/**
 * Líneas técnicas desde el informe de viabilidad, preservando caracteristicas[]/clasificacion/
 * marca_modelo_referencia/admite_equivalente — a diferencia de lineasDelInforme() (en
 * checklist-comercial.ts), que solo trae descripcion/cantidad/unidad para el bloque COMERCIAL.
 * Lee informe.productos.items (shape rico, v3.3) con respaldo a manifiesto_productos/costeo.items
 * (shape aplanado, sin caracteristicas — en ese caso la línea sale sin nada que clasificar).
 */
// Extrae el número de línea de "L5"/"5"/"Línea 5" — el manifiesto de viabilidad guarda `linea`
// como texto con el prefijo "L" ("L1".."L7"). MISMA lógica que `_lineaNum` en viabilidad-ia.ts,
// duplicada acá a propósito (no importada) por el boundary server/cliente de arriba: traer
// viabilidad-ia.ts arrastra toda la cadena hasta gemini.ts/node:async_hooks para reusar una
// función de una línea.
//
// BUG REAL (26-ago-2026, auditoría técnica, caso real 986278-14-LE26): antes era
// `Number(it?.linea ?? it?.numero ?? i + 1) || i + 1`. `Number("L5")` da NaN, y `NaN || i+1` cae
// SIEMPRE al índice del array — nunca al número real dentro del string. Una licitación por línea
// donde una línea trae varios productos (L7 con 11 herramientas, caso real) generaba una "línea
// técnica" DISTINTA por cada producto, numeradas 1..28 por POSICIÓN en vez de 1..7 por línea real:
// la "Línea 7" del checklist mostraba un producto de la línea real 5 (el 7° del array), mientras
// los 11 productos reales de la línea 7 quedaban dispersos como "líneas" 18 a 28.
// Exportada porque el lado COMERCIAL (lineasDelInforme en checklist-comercial.ts) tenía
// EXACTAMENTE el mismo bug y necesita numerar igual: si el técnico dice "Línea 7" y el comercial
// dice "Línea 22" para lo mismo, el selector de líneas a ofertar filtra bien un bloque y mal el otro.
export function numeroDeLinea(v: unknown): number | null {
  if (v == null) return null;
  const m = String(v).match(/\d+/);
  return m ? Number(m[0]) : null;
}

// FUSIÓN DE VARIOS PRODUCTOS QUE COMPARTEN LÍNEA REAL — una línea de licitación puede ser un
// PAQUETE (caso real 986278-14-LE26: la Línea 7 es "Equipos y Herramientas Ferretería General",
// 11 productos distintos — juego de dados, llaves Allen, esmeril, taladro… — todos bajo la misma
// línea). El manifiesto de viabilidad ya los trae correctamente etiquetados con el mismo `linea`;
// lo que antes se leía como "duplicado a descartar" (ver el bug de numeroDeLinea de arriba) en
// realidad son productos DISTINTOS que hay que conservar TODOS, no solo el primero.
//
// `caracteristicas` viene SIN prefijo de producto ("Cuadrante de 1/2\" entre 14mm y 32mm" no dice
// a cuál de los 11 productos pertenece) — concatenar los arrays a secas perdería esa trazabilidad
// y el Camino B (comparación contra la ficha del proveedor) no podría saber a qué producto del
// paquete aplica cada especificación. Cada característica se antepone con el nombre de SU
// producto ("Juego de dados con chicharra: Cuadrante de 1/2\" entre 14mm y 32mm").
//
// clasificacion/admiteEquivalente se combinan por el criterio MÁS EXIGENTE del grupo, no por
// mayoría ni por el primero: si UN SOLO producto del paquete es 'especifico' o no admite
// equivalente, perder esa restricción para toda la línea sería más grave que ser conservador con
// los productos genéricos del mismo paquete.
function fusionarProductosDeLinea(linea: number, productos: any[]): LineaTecnica {
  if (productos.length === 1) {
    const it = productos[0];
    return {
      linea,
      nombre: String(it?.nombre || it?.descripcion_exacta || it?.descripcion || `Línea ${linea}`).slice(0, 280),
      clasificacion: it?.clasificacion === 'generico' ? 'generico' : it?.clasificacion === 'especifico' ? 'especifico' : null,
      marcaModeloReferencia: it?.marca_modelo_referencia ? String(it.marca_modelo_referencia).slice(0, 200) : null,
      admiteEquivalente: typeof it?.admite_equivalente === 'boolean' ? it.admite_equivalente : null,
      caracteristicas: Array.isArray(it?.caracteristicas) ? it.caracteristicas.map((c: any) => String(c || '').trim()).filter(Boolean) : [],
      cantidad: Number.isFinite(Number(it?.cantidad)) ? Number(it.cantidad) : null,
      unidadMedida: it?.unidad_medida ? String(it.unidad_medida) : null,
    };
  }
  const nombreDe = (it: any) => String(it?.nombre || it?.descripcion_exacta || it?.descripcion || '').trim();
  const nombres = productos.map(nombreDe).filter(Boolean);
  const caracteristicas = productos.flatMap((it) => {
    const nombre = nombreDe(it);
    const cs = Array.isArray(it?.caracteristicas) ? it.caracteristicas.map((c: any) => String(c || '').trim()).filter(Boolean) : [];
    return cs.map((c: string) => (nombre ? `${nombre}: ${c}` : c));
  });
  return {
    linea,
    nombre: `${productos.length} productos: ${nombres.join(', ')}`.slice(0, 280),
    clasificacion: productos.some(it => it?.clasificacion === 'especifico') ? 'especifico'
      : productos.some(it => it?.clasificacion === 'generico') ? 'generico' : null,
    marcaModeloReferencia: productos.map(it => it?.marca_modelo_referencia).filter(Boolean).join('; ').slice(0, 200) || null,
    admiteEquivalente: productos.some(it => it?.admite_equivalente === false) ? false
      : productos.some(it => it?.admite_equivalente === true) ? true : null,
    caracteristicas,
    cantidad: null,       // sumar cantidades de productos distintos con unidades distintas no tiene sentido
    unidadMedida: null,
  };
}

/** Agrupa los ítems crudos del informe por línea real, SIN fusionar — cada línea puede traer 1 o
 *  varios productos (ver fusionarProductosDeLinea). Compartido por lineasTecnicasDelInforme() y
 *  productosCrudosDeLinea(): ambas necesitan el mismo agrupamiento, solo difieren en si fusionan. */
function agruparCrudoPorLinea(informe: any): Map<number, any[]> {
  const crudo: any[] =
    (Array.isArray(informe?.productos?.items) && informe.productos.items) ||
    (Array.isArray(informe?.manifiesto_productos) && informe.manifiesto_productos) ||
    (Array.isArray(informe?.costeo?.items) && informe.costeo.items) || [];

  const porLinea = new Map<number, any[]>();
  crudo.forEach((it: any, i: number) => {
    const linea = numeroDeLinea(it?.linea) ?? numeroDeLinea(it?.numero) ?? i + 1;
    if (!porLinea.has(linea)) porLinea.set(linea, []);
    porLinea.get(linea)!.push(it);
  });
  return porLinea;
}

export function lineasTecnicasDelInforme(informe: any): LineaTecnica[] {
  const out = Array.from(agruparCrudoPorLinea(informe).entries())
    .map(([linea, productos]) => fusionarProductosDeLinea(linea, productos));
  return out.sort((a, b) => a.linea - b.linea);
}

/**
 * Los productos de UNA línea, SIN fusionar — para la ficha técnica PROPIA (ver ficha-tecnica.ts) y
 * el bloque "Producto que ofertamos" del Auditor: cuando una línea real junta varios productos
 * (caso real 2446-240-LE26: "Hidrolavadora H300" + "Vacuolavadora DB51 Dimer" bajo la misma línea
 * de precio), cada uno necesita SU PROPIA marca/modelo/foto — fusionarlos en un solo nombre (como
 * hace lineasTecnicasDelInforme, para el checklist de cumplimiento) perdería esa distinción.
 * Solo nombre/cantidad/unidad: las características fusionadas (con o sin prefijo de producto) ya
 * las da lineasTecnicasDelInforme y no hace falta duplicarlas acá.
 */
export function productosCrudosDeLinea(informe: any, linea: number): Array<{ nombre: string; cantidad: number | null; unidadMedida: string | null }> {
  const productos = agruparCrudoPorLinea(informe).get(linea) || [];
  return productos.map((it: any) => ({
    nombre: String(it?.nombre || it?.descripcion_exacta || it?.descripcion || '').trim() || `Línea ${linea}`,
    cantidad: Number.isFinite(Number(it?.cantidad)) ? Number(it.cantidad) : null,
    unidadMedida: it?.unidad_medida ? String(it.unidad_medida) : null,
  }));
}

// ─── Conversión de unidades determinista (sin IA) ───────────────────────────────────────────────
type FamiliaUnidad = 'longitud' | 'peso' | 'volumen' | 'potencia' | 'tiempo';
const UNIDADES: Record<string, { familia: FamiliaUnidad; factor: number }> = {
  // longitud → base mm
  mm: { familia: 'longitud', factor: 1 }, cm: { familia: 'longitud', factor: 10 },
  m: { familia: 'longitud', factor: 1000 }, km: { familia: 'longitud', factor: 1_000_000 },
  in: { familia: 'longitud', factor: 25.4 },
  // peso → base g
  mg: { familia: 'peso', factor: 0.001 }, g: { familia: 'peso', factor: 1 },
  kg: { familia: 'peso', factor: 1000 }, ton: { familia: 'peso', factor: 1_000_000 },
  lb: { familia: 'peso', factor: 453.592 },
  // volumen → base ml
  ml: { familia: 'volumen', factor: 1 }, l: { familia: 'volumen', factor: 1000 },
  m3: { familia: 'volumen', factor: 1_000_000 }, gal: { familia: 'volumen', factor: 3785.41 },
  // potencia → base w
  w: { familia: 'potencia', factor: 1 }, kw: { familia: 'potencia', factor: 1000 },
  hp: { familia: 'potencia', factor: 745.7 },
  // tiempo → base seg
  seg: { familia: 'tiempo', factor: 1 }, min: { familia: 'tiempo', factor: 60 }, hr: { familia: 'tiempo', factor: 3600 },
};

// Alias en español (con y sin plural/tildes) hacia la clave canónica de UNIDADES.
const ALIAS_UNIDAD: Record<string, string> = {
  milimetro: 'mm', milimetros: 'mm', mm: 'mm',
  centimetro: 'cm', centimetros: 'cm', cm: 'cm',
  metro: 'm', metros: 'm', mts: 'm', mt: 'm', m: 'm',
  kilometro: 'km', kilometros: 'km', km: 'km',
  pulgada: 'in', pulgadas: 'in', in: 'in',
  miligramo: 'mg', miligramos: 'mg', mg: 'mg',
  gramo: 'g', gramos: 'g', gr: 'g', g: 'g',
  kilogramo: 'kg', kilogramos: 'kg', kilo: 'kg', kilos: 'kg', kg: 'kg',
  tonelada: 'ton', toneladas: 'ton', ton: 'ton', t: 'ton',
  mililitro: 'ml', mililitros: 'ml', ml: 'ml',
  litro: 'l', litros: 'l', lt: 'l', lts: 'l', l: 'l',
  m3: 'm3', metrocubico: 'm3',
  galon: 'gal', galones: 'gal', gal: 'gal',
  watt: 'w', watts: 'w', w: 'w',
  kilowatt: 'kw', kilowatts: 'kw', kw: 'kw',
  hp: 'hp', caballosdefuerza: 'hp',
  segundo: 'seg', segundos: 'seg', seg: 'seg', s: 'seg',
  minuto: 'min', minutos: 'min', min: 'min',
  hora: 'hr', horas: 'hr', hrs: 'hr', hr: 'hr', h: 'hr',
};

function normalizarUnidad(u: string | null): string | null {
  if (!u) return null;
  const limpio = String(u).trim().toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[.\s]+/g, '');
  return ALIAS_UNIDAD[limpio] || null;
}

/** Factor para convertir 1 unidad de `origen` a `destino`, o null si no son de la misma familia
 *  o alguna es desconocida. */
function factorConversion(origen: string, destino: string): number | null {
  const o = normalizarUnidad(origen);
  const d = normalizarUnidad(destino);
  if (!o || !d) return null;
  if (o === d) return 1;
  const infoO = UNIDADES[o];
  const infoD = UNIDADES[d];
  if (!infoO || !infoD || infoO.familia !== infoD.familia) return null;
  return infoO.factor / infoD.factor;
}

// ─── Tolerancias: "al menos ±2,5%" es un TECHO, no un piso ──────────────────────────────────────
//
// BUG REAL (26-ago-2026, 611669-17-LE26 "LUMINANCÍMETROS"): las bases pedían
// "Precisión: al menos +/-2,5%" y el clasificador lo guardó como PISO con valor 2,5. Pero la
// precisión es una TOLERANCIA: ±2% es MEJOR que ±2,5%, no peor. Con tipo=PISO el evaluador
// determinista hace `2 >= 2,5` → NO_CUMPLE, o sea marca incumplimiento en un equipo que sí cumple
// y de sobra.
//
// En ese caso concreto zafó de casualidad: el valor ofertado venía como texto largo
// ("+/-2% +/- 2 dígitos…"), no se pudo convertir a número, el determinista devolvió null y resolvió
// la IA, que razonó bien. Si la ficha hubiera dicho "±2%" a secas, el veredicto habría salido
// invertido — y en una evaluación técnica eso cuesta puntos o la admisibilidad.
//
// La señal es doble y se exigen LAS DOS, para no dar vuelta requisitos que sí son un piso:
//   1) la característica habla de una magnitud de ERROR (precisión, exactitud, tolerancia,
//      desviación, incertidumbre, repetibilidad), y
//   2) el valor aparece como ± / +/- , que es como se escribe una tolerancia.
// "Resolución de al menos 100 gr" no lleva ± y sigue siendo PISO, que es lo correcto.

const RE_MAGNITUD_DE_ERROR =
  /\b(precisi[oó]n|exactitud|tolerancia|desviaci[oó]n|incertidumbre|repetibilidad|error)\b/i;
const RE_SIMBOLO_TOLERANCIA = /(±|\+\/-|\+-)/;

/**
 * Corrige el tipo cuando el requisito es una tolerancia mal clasificada como PISO.
 *
 * Se aplica DESPUÉS de la clasificación (venga de la IA o de donde venga) y solo da vuelta
 * PISO→TECHO: nunca toca TECHO, EXACTO ni RANGO. Es una regla determinista sobre el texto de las
 * bases, no una interpretación — por eso vive acá y no en el prompt, donde no se podría testear.
 */
export function corregirTipoDeTolerancia(
  descripcion: string, tipo: TipoRequisitoTecnico, valorRequeridoTexto?: string | null,
): TipoRequisitoTecnico {
  if (tipo !== 'PISO') return tipo;
  const texto = `${descripcion || ''} ${valorRequeridoTexto || ''}`;
  if (!RE_MAGNITUD_DE_ERROR.test(texto)) return tipo;
  if (!RE_SIMBOLO_TOLERANCIA.test(texto)) return tipo;
  return 'TECHO';
}

/** Camino A, paso 1: intento determinista (mismas unidades, o conversión por tabla estática de
 *  unidades dimensionales comunes). Devuelve null si no puede resolver (unidad desconocida, no
 *  comparable, o falta algún dato) — en ese caso el caller cae a evaluarCaracteristicaConIA(). */
export function evaluarCaracteristicaDeterminista(args: {
  tipo: TipoRequisitoTecnico; valorRequeridoNumero: number | null; valorRequeridoNumeroMax: number | null;
  unidadRequerida: string | null; valorOfertadoNumero: number | null; unidadOfertadaOriginal: string | null;
}): { veredicto: VeredictoTecnico; valorConvertidoNumero: number | null } | null {
  const { tipo, valorRequeridoNumero, valorRequeridoNumeroMax, unidadRequerida, valorOfertadoNumero, unidadOfertadaOriginal } = args;
  // 0 es el valor que el clasificador (IA) guarda cuando en realidad NO hay dato numérico (debería
  // ser null pero Number(null)=0 se cuela — ver ModalAuditorLineaTecnica.tsx). Sin esta guardia,
  // una característica puramente cualitativa ("Cabina: ROPS/FOPS...", sin unidad) queda con
  // exigido=0 y ofertado=0, y EXACTO da 0===0 → "Cumple" SIN haber comparado nada contra la ficha.
  if (!valorOfertadoNumero || !valorRequeridoNumero) return null;

  let convertido = valorOfertadoNumero;
  if (unidadRequerida) {
    if (!unidadOfertadaOriginal) return null;   // exige unidad y no sabemos en cuál viene lo ofertado
    const factor = factorConversion(unidadOfertadaOriginal, unidadRequerida);
    if (factor == null) return null;            // unidad desconocida o de otra familia → no resolvemos sin IA
    convertido = valorOfertadoNumero * factor;
  }

  let veredicto: VeredictoTecnico;
  switch (tipo) {
    case 'PISO': veredicto = convertido >= valorRequeridoNumero ? 'CUMPLE' : 'NO_CUMPLE'; break;
    case 'TECHO': veredicto = convertido <= valorRequeridoNumero ? 'CUMPLE' : 'NO_CUMPLE'; break;
    case 'EXACTO': veredicto = Math.abs(convertido - valorRequeridoNumero) < 1e-9 ? 'CUMPLE' : 'NO_CUMPLE'; break;
    case 'RANGO': {
      const max = valorRequeridoNumeroMax ?? valorRequeridoNumero;
      veredicto = convertido >= valorRequeridoNumero && convertido <= max ? 'CUMPLE' : 'NO_CUMPLE';
      break;
    }
    default: return null;
  }
  return { veredicto, valorConvertidoNumero: convertido };
}

// ─── Resumen para el nivel 1 de la UI ────────────────────────────────────────────────────────
export function resumenLinea(caracteristicas: Array<{ veredicto: string | null; pendiente_confirmacion_proveedor: boolean }>): ResumenLinea {
  return {
    total: caracteristicas.length,
    cumplen: caracteristicas.filter(c => c.veredicto === 'CUMPLE').length,
    noCumplen: caracteristicas.filter(c => c.veredicto === 'NO_CUMPLE').length,
    conComplemento: caracteristicas.filter(c => c.veredicto === 'CUMPLE_CON_COMPLEMENTO').length,
    sinEvaluar: caracteristicas.filter(c => c.veredicto == null).length,
    pendientesProveedor: caracteristicas.filter(c => c.pendiente_confirmacion_proveedor).length,
  };
}

/** Normaliza un texto a una clave estable para clave_caracteristica (mismo criterio que slug() de checklist-comercial.ts). */
export function slugCaracteristica(s: string): string {
  return String(s || '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '').slice(0, 120) || 'sin_nombre';
}
