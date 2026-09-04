// app/lib/motor-comercial.ts
// MOTOR COMERCIAL (Auditor Técnico, Fase 4, spec §7) — parsea el costeo real que el asistente
// subió como prueba de que cotizó el proyecto, y calcula las 4 alertas obligatorias (§7.4).
//
// Lee la MISMA plantilla que genera app/lib/generar-costeo.ts (TABLA_DE_COSTEO_V3): hoja
// "Costeo" (suma_alzada) o una hoja por línea/categoría (LINEA1, LINEA2…), ítems desde la fila
// 4. Columnas (letra → índice, spec §7.2):
//   A=ITEM  B=Detalle  C=Unidad  D=Sku proveedor  E=Cantidad original
//   F=VALOR C/IVA  G=Costo unitario neto  H=Costo total neto
//   I=Precio unitario venta  J=Precio unitario sin decimales  K=Precio total neto
//   L=Costo unitario REAL  M=Costo total neto REAL  (sección Compras, se llena después)
// La hoja "AUDITORIA" se ignora: es un espejo con fórmulas, no datos propios.
import ExcelJS from 'exceljs';
import { IVA } from '@/app/lib/costeo-comparativo';

// Posiciones de la plantilla V3 que genera generar-costeo.ts. Se conservan SOLO como respaldo
// para una hoja cuyo encabezado no se pueda reconocer (ver detectarEsquema) — ya no como supuesto.
const FILA_ITEM_1 = 4;
const COL = { item: 1, detalle: 2, unidad: 3, cantidad: 5, costoUnitario: 7, costoTotal: 8, precioUnitario: 10, precioTotal: 11 };

// ── Esquema por ENCABEZADO, no por posición fija ─────────────────────────────────────────────
// BUG REAL (18-ago-2026, "1787062742902_1_COSTEO_2296-48-LE26.xlsx"): la empresa cotiza en SU
// propia planilla histórica (hojas "Analisis"/"COSTEO"/"Datos Proveedor"), no en la plantilla V3
// que genera el sistema. Ahí los ítems arrancan en la fila 3 (no la 4) y las columnas están
// corridas (unidad="CONVERSION" en D, cantidad en C, precio sin decimales en I). Con las
// posiciones fijas el resultado era catastrófico Y SILENCIOSO: el único ítem real se perdía,
// itemsPrecioDeCosteo devolvía [] (por eso el anexo de Oferta Económica salía en blanco) y
// totalesDeCosteo daba $0 — o sea, el motor comercial calculaba sus alertas de "sobre
// presupuesto" y "discordancia con el anexo" contra un costeo que creía vacío. Además se
// parseaban como ítems las hojas que no son de costeo ("Datos Proveedor" → 323 filas basura).
//
// Ahora cada hoja se lee por lo que DICE su encabezado. Una hoja solo se considera de costeo si
// tiene una columna de PRECIO DE VENTA: es lo único que distingue un costeo real de una tabla de
// proveedores o de un resumen — "Datos Proveedor" también trae ITEM/Detalle/Cantidad y costos,
// pero nunca precio de venta.
const PATRONES_COLUMNA: Array<{ campo: keyof EsquemaHoja['col']; re: RegExp }> = [
  { campo: 'item', re: /^item$|^n[°º]?$|^nro$/ },
  { campo: 'detalle', re: /^detalle|^descripcion|^producto$|^glosa$/ },
  // "CONVERSION" es como esa planilla rotula la unidad de medida.
  { campo: 'unidad', re: /^unidad|^conversion$|^u\.?\s*m\.?$/ },
  { campo: 'cantidad', re: /^cantidad/ },
  // "REAL" es la sección de Compras (lo que efectivamente se pagó después), NUNCA el costeo de
  // la oferta — se excluye a propósito en las cuatro columnas de costo/precio.
  { campo: 'costoUnitario', re: /^costo unitario(?! real)/ },
  { campo: 'costoTotal', re: /^costo total(?! .*real)/ },
  { campo: 'precioTotal', re: /^precio total(?! .*real)/ },
  { campo: 'linea', re: /^linea|^l[ií]nea/ },
];

// El precio unitario se elige aparte porque hay DOS columnas candidatas y el orden importa: la de
// "sin decimales" es la que de verdad se oferta en el portal (la otra trae la fracción del cálculo).
const RE_PRECIO_UNIT_SIN_DECIMALES = /^precio unitario sin decimal/;
const RE_PRECIO_UNIT = /^precio unitario(?! .*real)/;

interface EsquemaHoja {
  filaPrimerItem: number;
  col: { item: number; detalle: number; unidad: number; cantidad: number; costoUnitario: number; costoTotal: number; precioUnitario: number; precioTotal: number; linea: number };
}

const normEncabezado = (v: unknown): string =>
  (texto(v) || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();

const FILAS_A_MIRAR_ENCABEZADO = 12;

function detectarEsquema(ws: ExcelJS.Worksheet): EsquemaHoja | null {
  const maxCol = Math.min(ws.columnCount || 0, 40);
  for (let r = 1; r <= Math.min(ws.rowCount || 0, FILAS_A_MIRAR_ENCABEZADO); r++) {
    const col: any = { item: 0, detalle: 0, unidad: 0, cantidad: 0, costoUnitario: 0, costoTotal: 0, precioUnitario: 0, precioTotal: 0, linea: 0 };
    let precioUnitExacto = 0, precioUnitLaxo = 0;
    for (let c = 1; c <= maxCol; c++) {
      const h = normEncabezado(ws.getCell(r, c).value);
      if (!h) continue;
      if (RE_PRECIO_UNIT_SIN_DECIMALES.test(h)) precioUnitExacto ||= c;
      else if (RE_PRECIO_UNIT.test(h)) precioUnitLaxo ||= c;
      for (const p of PATRONES_COLUMNA) if (!col[p.campo] && p.re.test(h)) { col[p.campo] = c; break; }
    }
    col.precioUnitario = precioUnitExacto || precioUnitLaxo;
    // Mínimo para considerarla hoja de costeo: algo que identifique la fila (item o detalle) y
    // AL MENOS un precio de venta. Sin precio de venta no es un costeo.
    if ((col.item || col.detalle) && (col.precioUnitario || col.precioTotal)) {
      return { filaPrimerItem: r + 1, col };
    }
  }
  return null;
}

export interface FilaCosteo {
  hoja: string; fila: number;
  item: number | null; detalle: string | null; unidad: string | null;
  cantidadOriginal: number | null;
  costoUnitarioNeto: number | null; costoTotalNeto: number | null;
  precioUnitarioSinDecimales: number | null; precioTotalNeto: number | null;
  // Línea REAL de la licitación a la que pertenece esta fila — NUNCA es lo mismo que `item`.
  // `item` es la posición del producto DENTRO de su hoja (una línea puede traer varios
  // sub-productos, cada uno con su propio ITEM 1, 2, 3…); `lineaPublicada` sale del NOMBRE de
  // la hoja ("LINEA4" → 4), que es como generar-costeo.ts arma el archivo en por_linea (ver
  // lineaDeHoja). null en suma_alzada/por_categoria, donde la hoja no se llama "LINEAn".
  lineaPublicada: number | null;
}

// generar-costeo.ts nombra cada hoja "LINEA${k+1}" cuando la modalidad es por_linea (ver
// app/lib/generar-costeo.ts:265). Antes de este fix, calcularAlertasMotorComercial comparaba
// `item` (1, 2, 3… reiniciado en CADA hoja) contra el número de línea publicada — dos cosas
// completamente distintas — y disparaba "Error de origen" en casi cualquier costeo real de más
// de una línea. Sacar el número de línea del NOMBRE de la hoja es la fuente correcta.
export function lineaDeHoja(hoja: string): number | null {
  const m = /^LINEA\s*(\d+)$/i.exec(hoja.trim());
  return m ? Number(m[1]) : null;
}

// Una celda de fórmula ya calculada trae { formula, result }; una celda de valor trae el
// primitivo directo. Ambas casuísticas conviven según cómo se guardó el Excel.
function num(v: unknown): number | null {
  if (v == null) return null;
  const raw = (typeof v === 'object' && v !== null && 'result' in (v as any)) ? (v as any).result : v;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}
function texto(v: unknown): string | null {
  if (v == null) return null;
  const raw = (typeof v === 'object' && v !== null && 'result' in (v as any)) ? (v as any).result : v;
  const s = String(raw).trim();
  return s || null;
}

/** Parsea el .xlsx subido: todas las hojas salvo AUDITORIA, desde la fila 4 hasta la primera
 *  fila sin ITEM ni Detalle (fin del bloque de ítems de esa hoja). */
export async function parsearCosteo(buffer: Buffer): Promise<FilaCosteo[]> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer as any);
  const filas: FilaCosteo[] = [];

  // BUG REAL (19-ago-2026, 3489-29-LP26): el asistente DUPLICÓ la hoja de costeo para trabajar
  // ("Costeo" + "Hoja1", 85 de 88 filas idénticas) y el parser sumó las dos — el total ofertado
  // salió $181.422.753 en vez de $90.329.192, y con eso la app declaró "sobre presupuesto" una
  // oferta que en realidad estaba DENTRO del presupuesto ($91.478.151). Duplicar una hoja para
  // probar precios es normal en Excel; sumar la copia no.
  //
  // Regla: si el libro trae al menos una hoja con NOMBRE OFICIAL de la plantilla ("Costeo" o
  // "LINEAn"), esas son las únicas que cuentan y cualquier otra es una copia de trabajo. Si no hay
  // ninguna oficial (planilla histórica de la empresa, hojas con nombre arbitrario), se mantiene el
  // comportamiento anterior: vale cualquier hoja cuyo encabezado sea de costeo.
  const esNombreOficial = (nombre: string) => /^costeo$/i.test(nombre.trim()) || lineaDeHoja(nombre) != null;
  const hayOficiales = wb.worksheets.some(w => esNombreOficial(w.name));
  const ignoradas: string[] = [];

  wb.eachSheet(ws => {
    if (ws.name.trim().toUpperCase() === 'AUDITORIA') return;
    if (hayOficiales && !esNombreOficial(ws.name)) {
      // Solo se reporta si PARECÍA un costeo: una hoja auxiliar sin encabezado de precios no
      // interesa a nadie, pero una copia con datos sí hay que decirla — si no, volvemos al fallo
      // silencioso que este comentario documenta.
      if (detectarEsquema(ws)) ignoradas.push(ws.name);
      return;
    }
    const esquema = detectarEsquema(ws);
    // Sin encabezado de costeo reconocible la hoja se SALTA entera. Antes se leía igual con las
    // posiciones fijas, que es como "Datos Proveedor" y "Analisis" entraban con cientos de filas
    // basura. La excepción es la hoja que la propia plantilla V3 llama "Costeo"/"LINEAn": ahí el
    // formato lo controlamos nosotros, así que el respaldo por posición sigue siendo válido.
    const esHojaNuestra = /^costeo$/i.test(ws.name.trim()) || lineaDeHoja(ws.name) != null;
    if (!esquema && !esHojaNuestra) return;
    const col = esquema ? esquema.col : { ...COL, linea: 0 };
    const desde = esquema ? esquema.filaPrimerItem : FILA_ITEM_1;
    const lineaDelNombre = lineaDeHoja(ws.name);
    const leer = (r: number, c: number) => (c ? ws.getCell(r, c).value : null);

    // Una fila vacía NO corta el recorrido: la planilla histórica de la empresa deja huecos entre
    // bloques de ítems. Se corta después de varias vacías seguidas, que sí marca el fin real.
    let vaciasSeguidas = 0;
    for (let r = desde; r <= Math.min(ws.rowCount || 0, 5000); r++) {
      const item = num(leer(r, col.item));
      const detalle = texto(leer(r, col.detalle));
      if (item == null && !detalle) {
        if (++vaciasSeguidas >= 5) break;
        continue;
      }
      vaciasSeguidas = 0;
      const cantidad = num(leer(r, col.cantidad));
      const costoUnitario = num(leer(r, col.costoUnitario));
      const precioUnitario = num(leer(r, col.precioUnitario));
      const precioTotal = num(leer(r, col.precioTotal));
      // Una fila de PIE ("COSTEADO POR: …", "Total neto venta", notas al margen) suele caer en la
      // misma columna de precio total y, sumada, DUPLICA el costeo: en el caso real que motivó
      // esto el total daba $68.872.084 en vez de $21.589.995, porque el pie repetía el total neto
      // y el total con IVA. Un ítem real siempre trae, además del texto, una cantidad o un precio
      // POR UNIDAD; un pie trae solo un monto acumulado. Ese es el corte, y es determinista.
      const tieneDatoPropio = cantidad != null || costoUnitario != null || precioUnitario != null;
      const esFilaDeItem = item != null ? (detalle != null || tieneDatoPropio) : (detalle != null && tieneDatoPropio);
      if (!esFilaDeItem) continue;
      // La línea sale de la COLUMNA si la planilla la trae (una sola hoja con todas las líneas) y
      // si no, del NOMBRE de la hoja ("LINEA4" → 4, que es como la arma generar-costeo.ts). Los
      // dos formatos de "por línea" conviven en la realidad; antes solo se reconocía el segundo.
      const lineaCelda = num(leer(r, col.linea));
      filas.push({
        hoja: ws.name, fila: r, item, detalle,
        lineaPublicada: lineaCelda ?? lineaDelNombre,
        unidad: texto(leer(r, col.unidad)),
        cantidadOriginal: cantidad,
        costoUnitarioNeto: costoUnitario,
        costoTotalNeto: num(leer(r, col.costoTotal)),
        precioUnitarioSinDecimales: precioUnitario,
        precioTotalNeto: precioTotal,
      });
    }
  });
  if (ignoradas.length) {
    console.warn(`[motor-comercial] hoja(s) ignorada(s) por ser copia de trabajo (el libro ya trae hojas oficiales): ${ignoradas.join(', ')}`);
  }
  return filas;
}

// ── Puente hacia el Anexo Creator (app/lib/anexos-precios-ia.ts) ────────────────────────────
// El costeo ya trae, por ítem, EXACTAMENTE lo que le falta al motor de anexos para autocompletar
// una tabla de precios unitarios: descripción + precio de venta. Mismo patrón que ya usa esta
// ruta para todo lo demás (parsearCosteo se corre en caliente desde el .xlsx en R2, nunca se
// persiste el detalle por fila en una tabla propia — ver cabecera del archivo).
// `cantidad` NO la usa el match de precios unitarios (ahí solo se cruza descripción → precio):
// existe para el anexo económico que pide UN SOLO monto por toda la oferta, sin tabla de ítems
// donde poner los unitarios (caso real 2585-87-LE26, "OFERTA VALOR") — ver totalNetoDeItemsCosteo
// y anexos-monto-oferta.ts. Puede venir null: la planilla del organismo no siempre trae cantidad.
export interface ItemCosteoPrecio { descripcion: string; precioUnitario: number; unidad: string | null; cantidad: number | null }

export function itemsPrecioDeCosteo(filas: FilaCosteo[]): ItemCosteoPrecio[] {
  return filas
    .filter(f => f.detalle && f.precioUnitarioSinDecimales != null && f.precioUnitarioSinDecimales > 0)
    .map(f => ({ descripcion: f.detalle!.trim(), precioUnitario: f.precioUnitarioSinDecimales!, unidad: f.unidad, cantidad: f.cantidadOriginal }));
}

export interface AlertaMotorComercial { codigo: string; descripcion: string; detalle: string }

/**
 * ¿El `presupuestoLinea` que trae el informe es en realidad el precio máximo POR UNIDAD?
 *
 * Caso real 2296-48-LE26: presupuesto global $26.500.000 bruto, línea única de 7 juegos, y la IA
 * guardó `presupuesto_linea = 3.785.714` — que es 26.500.000 / 7, el unitario. Usarlo como tope de
 * la línea hace que CUALQUIER costeo con cantidad > 1 dispare "sobre presupuesto".
 *
 * La señal es aritmética: si `presupuestoLinea × cantidad` reconstruye el presupuesto global (±2%,
 * margen para el IVA y el redondeo), lo guardado es el unitario. Se exige cantidad > 1, porque con
 * cantidad 1 el unitario y el total son el mismo número y no hay nada que distinguir ni que
 * arreglar. Devuelve true = "no se puede confiar en este tope", nunca corrige el valor: preferimos
 * no alertar antes que alertar con un dato mal interpretado.
 */
export function presupuestoDeLineaEsUnitario(
  pub: { cantidad: number | null; presupuestoLinea: number | null },
  presupuestoGlobal: number | null,
): boolean {
  const { cantidad, presupuestoLinea } = pub;
  if (presupuestoLinea == null || presupuestoGlobal == null) return false;
  if (cantidad == null || cantidad <= 1) return false;
  const reconstruido = presupuestoLinea * cantidad;
  // Se compara contra el global tal cual y contra su versión bruta: el informe guarda el
  // presupuesto en neto, pero el "unitario" suele salir de dividir el monto CON IVA publicado.
  for (const referencia of [presupuestoGlobal, presupuestoGlobal * 1.19]) {
    if (Math.abs(reconstruido - referencia) / referencia <= 0.02) return true;
  }
  return false;
}

/**
 * EL PRESUPUESTO CONTRA EL QUE SE COMPARA LA OFERTA, cuando no se postula a todas las líneas.
 *
 * POR QUÉ (03-sep-2026, 1271359-92-LE26, reportado por el usuario mirando su pantalla): el Motor
 * mostraba "Presupuesto: $33.040.000" —el GLOBAL de la licitación— mientras se ofertaba UNA sola
 * de las dos canastas, cuyo tope propio es $21.478.000 con IVA ($18.048.739 neto). Con el global,
 * una oferta de $19.556.323 parecía tener 40% de holgura cuando en realidad iba 8% POR ENCIMA de
 * su tope. Es el mismo error que ya se corrigió en el cuadro comparativo del editor de costeo:
 * comparar una línea contra la suma de todas.
 *
 * Reglas, todas conservadoras:
 *  · EL TOPE ES LA SUMA DE LAS LÍNEAS MARCADAS, marques una, otra o todas — es la regla que pidió
 *    el usuario con el selector a la vista (03-sep-2026): "cuando selecciono uno o dos me debe
 *    poner el presupuesto de uno, del otro o de ambos según se seleccione". Antes, con TODAS
 *    marcadas se devolvía el global sin sumar nada: en 1271359-92-LE26 daba el mismo número
 *    ($17.839.600 + $21.478.000 = $39.317.600 = el global publicado), así que se veía bien por
 *    casualidad — pero era otra regla, y en cuanto el global no fuera exactamente la suma de sus
 *    líneas el presupuesto habría dejado de seguir a la selección.
 *  · Si UNA de las líneas ofertadas no tiene tope propio utilizable (no lo fijan las bases, o el
 *    guardado es en realidad el precio por unidad — ver presupuestoDeLineaEsUnitario), se vuelve
 *    al global: sumar los topes que sí existen daría un máximo inventado, más bajo que el real,
 *    y dispararía "sobre presupuesto" contra una oferta sana.
 *  · La suma nunca puede pasar del global: ese es el techo que publican las bases para toda la
 *    licitación. Con un subconjunto la suma ya es menor por definición, así que este freno solo
 *    actúa si los topes por línea vienen inflados respecto del total.
 *  · `presupuesto_linea` viene CON IVA (así lo publican las bases) y la oferta se compara SIEMPRE
 *    en neto, así que se divide. El global se toma de `neto` y, si solo hay `bruto`, se
 *    convierte — usar un bruto como si fuera neto regala 19% de tope y calla la alerta.
 */
export function presupuestoDeLaOferta(
  informe: any,
  lineasPublicadas: Array<{ linea: number; cantidad: number | null; presupuestoLinea: number | null }>,
  excluidas: Set<number>,
): number | null {
  const conIva = informe?.presupuesto?.con_iva !== false;
  const bruto = Number(informe?.presupuesto?.bruto) || null;
  const global: number | null =
    Number(informe?.presupuesto?.neto) || (bruto != null ? (conIva ? bruto / IVA : bruto) : null);

  const ofertadas = lineasPublicadas.filter(l => !excluidas.has(l.linea));
  if (ofertadas.length === 0) return global;

  let suma = 0;
  for (const l of ofertadas) {
    if (l.presupuestoLinea == null || l.presupuestoLinea <= 0) return global;
    if (presupuestoDeLineaEsUnitario(l, global)) return global;
    suma += conIva ? l.presupuestoLinea / IVA : l.presupuestoLinea;
  }
  return global != null ? Math.min(suma, global) : suma;
}

// Mismo criterio de normalización de unidad que auditor-tecnico-core.ts (alias es/plural/tildes),
// pero acá solo para COMPARAR igualdad textual, no para convertir — el motor comercial no
// convierte unidades, solo detecta que costeo y línea publicada dicen algo distinto.
function normUnidad(u: string | null): string {
  return (u || '').trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/s$/, '');
}

const fmtCLP = (n: number) => new Intl.NumberFormat('es-CL', { style: 'currency', currency: 'CLP', maximumFractionDigits: 0 }).format(n);

/**
 * Las 4 alertas obligatorias del motor comercial (spec §7.4). Tolerancia CERO en la
 * discordancia costeo↔anexo (spec §7.3: "no existe rango por redondeo, para eso está la
 * columna sin decimales") — cualquier diferencia, por mínima que sea, alerta.
 */
export function calcularAlertasMotorComercial(args: {
  filas: FilaCosteo[];
  totalAnexoEconomico: number | null;
  presupuestoPublicado: number | null;
  lineasPublicadas: Array<{ linea: number; cantidad: number | null; unidad: string | null; presupuestoLinea: number | null }>;
  // Líneas que el asistente marcó "no ofertamos" en el checklist (algunas licitaciones por
  // línea se postulan solo parcialmente) — se sacan de TODO lo de acá abajo: total, sobre
  // presupuesto, discordancia con el anexo. Cotizarlas en el costeo no significa comprometerse
  // a ofertarlas.
  lineasExcluidas?: Set<number>;
}): AlertaMotorComercial[] {
  const alertas: AlertaMotorComercial[] = [];
  const excluidas = args.lineasExcluidas ?? new Set<number>();
  // La línea real de cada fila: si la hoja se llama "LINEAn" (por_linea, generar-costeo.ts) se
  // usa esa; si no (suma_alzada/por_categoria: una sola hoja plana, una fila = una línea), cae a
  // `item`, que en ESE caso sí coincide con el número de línea — es el comportamiento original,
  // que era correcto para suma_alzada y solo estaba mal para por_linea multi-hoja.
  const lineaDe = (f: FilaCosteo) => f.lineaPublicada ?? f.item;
  const filasOfertadas = args.filas.filter(f => {
    const l = lineaDe(f);
    return l == null || !excluidas.has(l);
  });

  const totalCosteo = filasOfertadas.reduce((s, f) => s + (f.precioTotalNeto ?? 0), 0);
  const totalCosto = filasOfertadas.reduce((s, f) => s + (f.costoTotalNeto ?? 0), 0);

  // El texto decía "el ANEXO económico dice $X", pero este chequeo NO abre ningún documento:
  // `totalAnexoEconomico` es la suma de los precios que el asistente cargó A MANO en el checklist
  // (ver totalAnexoEconomico en la ruta del costeo). El usuario lo reportó el 19-ago-2026 sobre
  // 3489-29-LP26: la alerta salía ANTES de cargar ningún anexo y lo mandó a buscar un documento
  // que no existía. El nombre del código se conserva (hay filas guardadas con él), pero el mensaje
  // ahora dice de dónde sale de verdad cada cifra y qué hacer.
  //
  // "el costeo SUBIDO" (03-sep-2026): este chequeo corre para los DOS orígenes de costeo —
  // archivo .xlsx subido Y el editor integrado del sistema (checklist_comercial_costeo.origen,
  // migración 85) — pero el texto solo nombraba el primero. Un usuario que arma el costeo
  // directo en el editor (nunca sube ningún archivo) reportó no entender a qué costeo se refería
  // la alerta, porque le hablaba de algo que él nunca hizo. "Guardado" es neutro entre ambos.
  //
  // ESTA ALERTA YA NO ES RUIDO DE CADA EDICIÓN (03-sep-2026): antes el checklist se sincronizaba
  // con el costeo UNA SOLA VEZ (mientras seguía en PENDIENTE) y quedaba congelado para siempre —
  // así que cualquier ajuste posterior al costeo (bajar el recargo, un ítem nuevo) disparaba esta
  // alerta aunque nadie hubiera tocado el checklist a mano. El usuario lo reportó: "no cada vez
  // que modifique el costeo me va a salir eso... la idea es que el costeo mande las cosas al
  // auditor técnico" — y, al precisarlo, agregó el criterio final: "que sea manual y automático
  // pero siempre prioridad al automático". Ahora ingresarVersionCosteo (comercial/costeo/route.ts)
  // resincroniza el precio en CADA guardado del costeo — el costeo manda SIEMPRE, incluso sobre un
  // precio que alguien cargó a mano — salvo que el punto ya esté APROBADO por el asesor: ese es el
  // ÚNICO freno real, porque un valor aprobado que cambia sin que nadie lo vea es justo lo que la
  // doble firma existe para evitar. Por eso el texto de acá habla de una aprobación que quedó
  // vieja, no de un descuadre genérico a investigar.
  if (args.totalAnexoEconomico != null && Math.round((args.totalAnexoEconomico - totalCosteo) * 100) !== 0) {
    alertas.push({
      codigo: 'DISCORDANCIA_COSTEO_ANEXO',
      descripcion: 'El precio aprobado quedó desactualizado',
      detalle: `El checklist tiene un precio de ${fmtCLP(args.totalAnexoEconomico)} — probablemente ya APROBADO, por eso el costeo no lo pisó solo — `
        + `pero el costeo cambió después y ahora da ${fmtCLP(totalCosteo)} de precio de venta. `
        + 'Si el cambio del costeo es válido, reabre el punto para que se actualice; si el precio aprobado sigue siendo el correcto, no hagas nada.',
    });
  }

  const bajoCosto = filasOfertadas.filter(f => f.precioTotalNeto != null && f.costoTotalNeto != null && f.precioTotalNeto < f.costoTotalNeto);
  if (bajoCosto.length > 0) {
    alertas.push({
      codigo: 'VENTA_BAJO_COSTO',
      descripcion: 'Venta bajo costo',
      detalle: `Ítem(s) ${bajoCosto.map(f => lineaDe(f) != null ? `línea ${lineaDe(f)} ítem ${f.item ?? '?'}` : (f.item ?? '?')).join(', ')} del costeo tienen precio de venta por debajo del costo.`,
    });
  }

  const sobrePresupuestoGlobal =
    args.presupuestoPublicado != null && Math.round((totalCosteo - args.presupuestoPublicado) * 100) > 0;

  // Presupuesto POR LÍNEA — algunas bases fijan un monto máximo INDEPENDIENTE por línea (lote),
  // no solo un total global (viabilidad-ia.ts ya detecta esa señal y la guarda como
  // presupuesto_linea en el manifiesto). Un costeo puede estar bajo el total global y aun así
  // pasarse en una línea puntual — el chequeo de arriba no lo vería. Solo se evalúa donde las
  // bases de VERDAD fijan ese monto (presupuestoLinea no nulo); si no lo fijan, esa línea queda
  // cubierta únicamente por el chequeo global.
  //
  // FALSO POSITIVO REAL (18-ago-2026, 2296-48-LE26 "7 juegos modulares"): la alerta saltaba con un
  // costeo que estaba CÓMODAMENTE bajo el presupuesto ($21.589.995 vs $22.268.908). Dos causas
  // encadenadas, las dos generales:
  //
  //  1. La licitación es SUMA ALZADA: no hay líneas independientes, hay un solo total. El informe
  //     igual trae una "línea 1" (es el ítem publicado), así que el chequeo corría y comparaba el
  //     total contra un tope que las bases nunca fijaron para una línea. Cuando la modalidad no es
  //     por línea, el chequeo global de arriba YA cubre el caso — este no aporta nada y solo puede
  //     equivocarse. Ver `hayVariasLineas` abajo.
  //  2. El `presupuestoLinea` guardado era $3.785.714 = 26.500.000 / 7, o sea el precio máximo POR
  //     UNIDAD, no el tope de la línea. Comparar el TOTAL de la línea contra un UNITARIO es
  //     comparar peras con manzanas y siempre alerta en cuanto la cantidad es > 1.
  //
  // El guardarraíl de (2) es aritmético y no depende de ningún juicio: si `presupuestoLinea` ×
  // cantidad se acerca al presupuesto global, entonces lo guardado es el unitario y no se puede
  // usar como tope de la línea. Ante la duda NO se alerta: una alerta falsa en el auditor
  // enseña a ignorar las alertas, que es peor que no tenerla.
  const hayVariasLineas = args.lineasPublicadas.length > 1;
  const sobrePresupuestoLinea: number[] = [];
  for (const pub of args.lineasPublicadas) {
    if (pub.presupuestoLinea == null || excluidas.has(pub.linea)) continue;
    if (!hayVariasLineas) continue;   // suma alzada: lo cubre el chequeo global
    if (presupuestoDeLineaEsUnitario(pub, args.presupuestoPublicado)) continue;
    const totalLinea = filasOfertadas.filter(f => lineaDe(f) === pub.linea).reduce((s, f) => s + (f.precioTotalNeto ?? 0), 0);
    if (totalLinea > 0 && Math.round((totalLinea - pub.presupuestoLinea) * 100) > 0) sobrePresupuestoLinea.push(pub.linea);
  }
  if (sobrePresupuestoLinea.length > 0) {
    alertas.push({
      codigo: 'SOBRE_PRESUPUESTO_LINEA',
      descripcion: 'Sobre presupuesto por línea',
      detalle: `Línea(s) ${sobrePresupuestoLinea.join(', ')}: el costeo de esa línea supera el máximo que las bases fijan para ELLA (no el total global).`,
    });
  }

  // EL AVISO GLOBAL VA DESPUÉS DE SABER SI EL POR LÍNEA YA LO DIJO (03-sep-2026). Cuando se
  // oferta UNA sola línea, el "total ofertado" y "el total de esa línea" son el mismo número
  // contra el mismo tope: dos alertas para un solo problema. Se conserva la específica, que dice
  // estrictamente más (nombra la línea). Si el exceso NO está cubierto línea por línea —varias
  // líneas ofertadas, o líneas sin tope propio— el aviso global sigue apareciendo, porque ahí es
  // el único que ve el conjunto.
  const ofertadasConAviso = args.lineasPublicadas
    .filter(l => !excluidas.has(l.linea))
    .every(l => sobrePresupuestoLinea.includes(l.linea));
  if (sobrePresupuestoGlobal && !(sobrePresupuestoLinea.length > 0 && ofertadasConAviso)) {
    alertas.push({
      codigo: 'SOBRE_PRESUPUESTO',
      descripcion: 'Sobre presupuesto',
      detalle: `El total ofertado (${fmtCLP(totalCosteo)}) supera el presupuesto publicado (${fmtCLP(args.presupuestoPublicado!)}).`,
    });
  }

  if (args.lineasPublicadas.length > 0) {
    const porLinea = new Map(args.lineasPublicadas.map(l => [l.linea, l]));
    // Agrupadas por línea real, no por fila: una línea con varios sub-productos no tiene una
    // única "cantidad"/"unidad" propia que comparar contra cada sub-ítem por separado — antes
    // esto disparaba en casi cualquier costeo real con más de un producto por línea. Solo se
    // compara cuando la línea trae exactamente UN sub-ítem: ahí sí es una comparación 1:1 válida.
    const filasPorLinea = new Map<number, FilaCosteo[]>();
    for (const f of filasOfertadas) {
      const l = lineaDe(f);
      if (l == null) continue;
      if (!filasPorLinea.has(l)) filasPorLinea.set(l, []);
      filasPorLinea.get(l)!.push(f);
    }
    const descuadres: number[] = [];
    for (const [linea, filasDeLinea] of filasPorLinea) {
      if (filasDeLinea.length !== 1) continue;
      const pub = porLinea.get(linea);
      if (!pub) continue;
      const f = filasDeLinea[0];
      const cantidadDistinta = pub.cantidad != null && f.cantidadOriginal != null && Number(pub.cantidad) !== Number(f.cantidadOriginal);
      const unidadDistinta = !!pub.unidad && !!f.unidad && normUnidad(pub.unidad) !== normUnidad(f.unidad);
      if (cantidadDistinta || unidadDistinta) descuadres.push(linea);
    }
    if (descuadres.length > 0) {
      alertas.push({
        codigo: 'ERROR_DE_ORIGEN',
        descripcion: 'Error de origen',
        detalle: `Línea(s) ${descuadres.sort((a, b) => a - b).join(', ')}: la cantidad o unidad del costeo no coincide con la línea publicada. Se levanta antes de generar cualquier documento.`,
      });
    }
  }

  return alertas;
}

export function totalesDeCosteo(filas: FilaCosteo[]): { totalCostoNeto: number; totalPrecioNeto: number } {
  return {
    totalCostoNeto: filas.reduce((s, f) => s + (f.costoTotalNeto ?? 0), 0),
    totalPrecioNeto: filas.reduce((s, f) => s + (f.precioTotalNeto ?? 0), 0),
  };
}

/** Línea real de una fila — misma regla que usa calcularAlertasMotorComercial (ver lineaDe ahí):
 *  el nombre de hoja manda si es "LINEAn"; si no, cae a `item` (suma_alzada de una sola hoja). */
export function lineaDeFila(f: FilaCosteo): number | null {
  return f.lineaPublicada ?? f.item;
}

/**
 * ¿El costeo dice EXPLÍCITAMENTE a qué línea pertenece cada fila?
 *
 * Solo es true cuando la línea viene de una fuente inequívoca: el nombre de hoja ("LINEA4") o una
 * columna "Línea". Si no, `lineaDeFila` cae a `item`, que es la POSICIÓN del producto dentro de la
 * hoja — un costeo de suma alzada con 86 productos aparenta tener 86 "líneas".
 *
 * RIESGO QUE CIERRA (19-ago-2026, auditoría de 3489-29-LP26): en una licitación POR LÍNEA cuyo
 * costeo venga en una sola hoja plana, usar `item` como número de línea le asignaría a la línea 3
 * el precio del tercer producto de la lista, que puede no tener ninguna relación. Eso precarga un
 * precio equivocado en el checklist — y el precio es lo que se evalúa. Ante la duda, no se precarga
 * nada y lo carga el humano.
 */
export function costeoTieneLineasExplicitas(filas: FilaCosteo[]): boolean {
  return filas.some(f => f.lineaPublicada != null);
}

/** Total del costeo para UNA línea — suma TODOS sus sub-ítems (una línea puede traer varios
 *  productos, cada uno su propia fila). Antes la auto-precarga tomaba una sola fila por línea
 *  con una clave equivocada (`item`, que se repite 1,2,3… en cada hoja) — ver costeo/route.ts. */
export function totalPrecioDeLinea(filas: FilaCosteo[], linea: number): number | null {
  // Sin líneas explícitas en el costeo no se adivina cuál es cuál — ver costeoTieneLineasExplicitas.
  if (!costeoTieneLineasExplicitas(filas)) return null;
  const deLaLinea = filas.filter(f => lineaDeFila(f) === linea);
  if (!deLaLinea.length) return null;
  const total = deLaLinea.reduce((s, f) => s + (f.precioTotalNeto ?? 0), 0);
  return total > 0 ? total : null;
}
