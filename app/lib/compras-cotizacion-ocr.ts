// app/lib/compras-cotizacion-ocr.ts
// LECTURA AUTOMÁTICA DE COTIZACIONES (spec §8.2: "de cada cotización se extrae: precio, SKU,
// producto, precio unitario, dirección de bodega, plazo de entrega y ficha técnica"). Hasta acá,
// subir un PDF/imagen solo lo guardaba como respaldo — nadie leía el contenido; el encargado tenía
// que tipear todo a mano igual, aunque el documento ya trajera esos datos.
//
// Usa el MISMO motor GLM-OCR que ya lee bases y documentos en el resto del proyecto
// (app/lib/zai-ocr.ts) — no se agrega ningún proveedor nuevo.
//
// REGLA DE ORO: esto solo PROPONE valores para los campos que el usuario dejó vacíos. Nunca pisa
// lo que alguien tipeó a mano (mismo criterio que "la ficha del catálogo manda sobre el texto
// suelto" en compras-auditor.ts) y, si la IA no está segura de un dato, lo deja en null — no
// inventa (feedback_datos_reales_nunca_inventados: "un default también desactiva los gates").
import { ocrImagenConGlmOcr, extraerTextoPdfPorUrlConGlmOcr } from '@/app/lib/zai-ocr';
import { ocrPdfLocalTesseract, ocrImagenLocalTesseract } from '@/app/lib/tesseract-ocr';
import { crearChatIA } from '@/app/lib/gemini';
import { parseJsonIA } from '@/app/lib/json-ia';

export interface DatosExtraidosCotizacion {
  proveedorNombre: string | null; proveedorRut: string | null;
  // `precioUnitario` es el BRUTO (antes de descuento) tal como aparece en la línea del producto —
  // mismo criterio de siempre, "lo que dice el documento". `descuentoPct`, si el documento trae un
  // descuento explícito sobre el subtotal (caso real, 14-sep-2026: cotización de Trotec Chile con
  // "Descuento 4%"), para que quien registre la cotización vea el precio NETO real ya calculado en
  // vez de tener que restarlo a mano.
  precioUnitario: number | null; precioTotal: number | null; descuentoPct: number | null; moneda: string | null;
  // Monto de flete/despacho que el proveedor cobra APARTE, si el documento lo desglosa como línea
  // propia (caso real, 14-sep-2026: "si pongo no incluye flete es porque nos cobran el flete pero
  // no me deja poner cuánto es") — sin esto, el sistema le aplicaba un flete interno GENÉRICO
  // ($40.000, spec §8.10.2) a cualquier cotización marcada "no incluye flete", aunque el documento
  // ya dijera el monto real que cobra el proveedor.
  fleteMonto: number | null;
  plazoEntregaTexto: string | null; direccionBodega: string | null;
  // Pedido explícito del usuario (15-sep-2026): "si yo subo la cotización tiene que poder decirme
  // algo... sobre todo si esa cotización tiene información más allá de los precios del producto,
  // algunos traen más cosas, pero solo algunos" — garantía ofrecida, condiciones de pago, vigencia
  // de la oferta, certificaciones, servicio postventa, etc. Antes existía un solo campo `notas` de
  // UNA frase que la pantalla nunca mostraba (se extraía y se tiraba); ahora es una LISTA — un
  // documento puede traer varias cosas distintas — y sí se muestra (ver leerArchivo en
  // AuditorComprasCard.tsx). Vacío si el documento de verdad no trae nada más allá de precio/plazo.
  notasAdicionales: string[];
  // El texto transcrito completo del documento (no solo los campos estructurados de arriba).
  // Existe para cotizaciones de VARIOS ítems (spec §8.6-§8.8): esos campos solo describen "el
  // producto principal" — sin el texto completo, homologarCotizacionIA (compras-auditor.ts) no
  // tiene de dónde sacar los otros 29 ítems de una cotización de 30, y quedaba obligando a
  // retipear a mano lo que el documento ya traía. Se usa SOLO para rellenar `descripcionLibre`
  // cuando el usuario la dejó vacía — mismo criterio de "propone, nunca pisa" del resto del módulo.
  textoCompleto: string | null;
}

/** Caso real (09-sep-2026, cotización de Unisource): la IA leyó "2.052,00" (formato chileno) como
 *  2.05 — un error de separador de miles/decimales que el precioTotal (bien leído, 8.243) permite
 *  detectar sin volver a llamar a la IA: si hay cantidad, precioUnitario × cantidad debería
 *  aproximarse al precioTotal. Cuando no cuadra ni de cerca, el precioUnitario no es confiable —
 *  se anula (null) en vez de usarse mal: mejor pedirle al encargado que lo tipee que dejar pasar un
 *  precio equivocado a los escenarios y el margen (feedback_no_inventar_datos_parser).
 *
 *  10-sep-2026 — el MISMO documento volvió a fallar de la MISMA forma: esta vez la IA no devolvió
 *  `cantidadPrincipal`, así que el chequeo de arriba nunca corría (early return) y el "2.05" pasó
 *  igual. Se agrega un segundo resguardo que NO depende de la cantidad: un precio unitario que es
 *  una fracción minúscula del total (más de 10 veces menor) es sospechoso sea cual sea la cantidad
 *  — nadie compra >10 unidades a un precio que ni se acerca al total sin que aparezca también una
 *  cantidad grande explícita. Mejor pedir confirmación humana que dejar pasar el mismo bug dos veces. */
function precioUnitarioConfiable(
  precioUnitario: number | null, precioTotal: number | null, cantidad: number | null,
): number | null {
  if (precioUnitario == null) return null;
  if (precioTotal == null) return precioUnitario;

  if (cantidad && cantidad > 0) {
    const esperado = precioUnitario * cantidad;
    // Tolerancia amplia (30%): despacho, descuentos u otros ítems de la cotización pueden mover el
    // total sin que el precio unitario esté mal. Lo que se busca es un desfase de ORDEN DE MAGNITUD.
    const razon = esperado > precioTotal ? esperado / precioTotal : precioTotal / esperado;
    return razon > 3 ? null : precioUnitario;
  }

  // Sin cantidad confiable: chequeo más laxo, pero sigue atajando el error de orden de magnitud.
  if (precioUnitario > precioTotal) return null; // un ítem no puede costar más que el total del documento
  if (precioTotal / precioUnitario > 10) return null; // implicaría >10 unidades sin que la IA haya visto esa cantidad
  return precioUnitario;
}

/** Caso real (15-sep-2026, cotización de Zhengzhou Meiwo — proveedor chino): la factura decía
 *  clarísimo "Transportation fee by air to Santiago airport with insurance 1400" (US$1.400 de
 *  flete sobre un producto de US$16.000), pero la IA de extracción devolvió fleteMonto=500.000 —
 *  31 VECES el precio del producto. Al convertir a CLP con el tipo de cambio ($957,53), ese error
 *  se infló a $478.765.000 y voló los escenarios del Auditor de Compras a casi $500 millones.
 *  Mismo criterio que `precioUnitarioConfiable`: un flete no puede razonablemente costar más que
 *  el producto mismo (ni por asomo un orden de magnitud más) — si lo hace, es casi seguro un error
 *  de lectura, no un flete real. Mejor pedir que se tipee a mano que dejar pasar un número
 *  disparatado a los escenarios y al cuadro comparativo. */
function fleteMontoConfiable(
  fleteMonto: number | null, precioTotal: number | null, precioUnitario: number | null,
): number | null {
  if (fleteMonto == null) return null;
  const referencia = precioTotal ?? precioUnitario;
  if (referencia == null || referencia <= 0) return fleteMonto; // sin nada con qué comparar
  if (fleteMonto / referencia > 10) return null; // orden de magnitud, mismo umbral que el precio unitario
  return fleteMonto;
}

/** Respaldo determinístico (regex, no IA) para el descuento — mismo criterio que `monedaDelTexto`
 *  de abajo: segunda opinión barata cuando la IA no lo trajo, solo si el documento tiene una
 *  etiqueta explícita "Descuento X%"/"Dscto X%"/"Desc. X%". Nunca calcula un descuento implícito
 *  comparando montos — eso sería adivinar, spec "nunca inventar datos". */
function descuentoPctDelTexto(texto: string): number | null {
  const m = texto.match(/(?:descuento|dscto\.?|desc\.?)\s*[:\-]?\s*(\d{1,2}(?:[.,]\d{1,2})?)\s*%/i);
  if (!m) return null;
  const pct = Number(m[1].replace(',', '.'));
  return Number.isFinite(pct) && pct > 0 && pct < 100 ? pct : null;
}

/** Respaldo determinístico (regex, no IA) para el flete — mismo criterio que el descuento: solo
 *  dispara si el documento trae una etiqueta explícita de flete/despacho seguida de un monto.
 *  Nunca asume que hay flete solo porque el retiro es en bodega del proveedor — eso sería inventar
 *  un cargo que el documento no dice (feedback_no_inventar_datos_parser).
 *
 *  CASO REAL (15-sep-2026, cotización italiana de Eter srl): "Spedizione 427,00 €" nunca se
 *  detectó — el regex solo conocía las palabras en español. Se agregan sus equivalentes en
 *  inglés/italiano (los idiomas más comunes en cotizaciones de proveedores extranjeros); no es
 *  exhaustivo para cualquier idioma, pero cubre los casos reales vistos hasta ahora. */
function fleteMontoDelTexto(texto: string): number | null {
  const m = texto.match(/(?:flete|despacho|env[ií]o|spedizione|shipping|freight)\s*[:\-]?\s*[€$]?\s*([\d.,]{3,})/i);
  if (!m) return null;
  // Formato chileno/italiano: punto de miles, coma decimal — se limpia igual que parsearMontoCL.
  const limpio = m[1].replace(/\.(?=\d{3}(?:\D|$))/g, '').replace(',', '.');
  const monto = Number(limpio);
  return Number.isFinite(monto) && monto > 0 ? Math.round(monto) : null;
}

/** Respaldo determinístico (regex, no IA) para la moneda: el mismo documento que falló en el
 *  precio unitario también le hizo perder a la IA la etiqueta "5.- TIPO MONEDA: DOLAR" — que
 *  SÍ está literal en el texto transcrito. No reemplaza a la IA (sigue siendo la fuente principal,
 *  entiende contexto que un regex no), pero sirve de segunda opinión barata cuando la IA no
 *  devolvió nada: si el texto trae una etiqueta de moneda explícita, se usa esa. */
function monedaDelTexto(texto: string): 'USD' | 'EUR' | 'CLP' | null {
  const cerca = texto.match(/(?:TIPO\s+MONEDA|MONEDA|CURRENCY|VALUTA)\s*[:\-]?\s*([A-ZÁÉÍÓÚÑ$€]+)/i);
  const candidato = (cerca?.[1] || '').toUpperCase();
  if (/USD|D[OÓ]LAR/.test(candidato)) return 'USD';
  if (/EUR|EURO/.test(candidato)) return 'EUR';
  if (/CLP|PESO/.test(candidato)) return 'CLP';
  // Sin etiqueta explícita cerca de "moneda": buscar el símbolo/código suelto en el documento como
  // última pista, pero solo si NO aparece también un signo "$"/"CLP" claro de peso chileno, para
  // no adivinar cuando el documento es ambiguo. El símbolo € es inequívoco (ninguna otra moneda que
  // lee este sistema lo usa) — caso real, 15-sep-2026: cotización italiana de Eter srl, "10.573,00
  // €" sin ninguna etiqueta "MONEDA"/"CURRENCY" en ningún lado del documento.
  if (/€/.test(texto)) return 'EUR';
  if (/\bUSD\b|US\$/.test(texto) && !/\bCLP\b/.test(texto)) return 'USD';
  return null;
}

const SYS_EXTRACCION = `Eres un asistente que lee cotizaciones de proveedores (PDF o imagen, ya transcritas a texto) para una empresa chilena que compra productos adjudicados en licitaciones públicas.

Del texto que te paso, extrae SOLO lo que esté explícito y sea inequívoco:
- proveedorNombre: nombre o razón social del proveedor que EMITE la cotización (no el destinatario).
- proveedorRut: RUT del proveedor, formato XX.XXX.XXX-X si aparece.
- precioUnitario: precio unitario del producto principal, en número (sin símbolo de moneda ni puntos de miles). Si el documento muestra una tabla con "Unitario"/"Unitario Neto" por un lado y un descuento aplicado DESPUÉS sobre el subtotal, usa el precio unitario de la TABLA (antes del descuento) — el descuento se extrae aparte, en descuentoPct.
- precioTotal: precio total de la cotización, en número (el que corresponda ANTES del descuento — el mismo subtotal que multiplicarías por precioUnitario × cantidad).
- cantidadPrincipal: la cantidad del producto principal en la línea de ese precio unitario (ej. "4,00" → 4), si aparece. Sirve para verificar que precioUnitario × cantidadPrincipal cuadre con precioTotal — sin ella no se puede validar el precio unitario.
- descuentoPct: si el documento aplica un descuento porcentual explícito sobre el subtotal (ej. "Descuento 4%", "Dscto. 10%"), el número solo (4, 10...). Si el descuento viene como monto fijo en vez de porcentaje, o no hay descuento, usa null — no lo calcules ni lo adivines desde otros campos.
- fleteMonto: si el documento cobra flete/despacho/envío/transporte como una línea de costo APARTE con un monto explícito, ese número — en CUALQUIER idioma en que venga la cotización (ej. "Flete: $50.000", "Despacho $30.000", "Envío $25.000", "Shipping: $1,400", "Transportation fee: $1,400", "Spedizione 427,00 €"). Los proveedores extranjeros cotizan en su propio idioma; no te limites a las palabras en español. Si el documento dice que el despacho está incluido en el precio, o no menciona flete para nada, usa null — no inventes un monto ni asumas que hay flete porque el retiro es en bodega del proveedor.
- moneda: "CLP", "USD", "EUR" u otra si se indica explícitamente; si no dice nada, usa "CLP".
- plazoEntregaTexto: el plazo de entrega tal como lo describe el documento (ej. "15 días hábiles").
- direccionBodega: dirección de despacho/bodega del proveedor, si aparece.
- notasAdicionales: LISTA de datos o condiciones relevantes que el documento menciona y que NO calzan en ninguno de los campos anteriores — ej. garantía ofrecida ("Garantía: 12 meses"), condiciones/plazo de pago ("Pago: 30 días fecha factura"), vigencia de la oferta ("Válida por 15 días"), certificaciones, incluye instalación/capacitación, servicio técnico o postventa, mínimo de compra, forma de pago exigida, etc. Cada elemento de la lista es UNA frase corta y concreta, tal como la dice el documento (no la inventes ni la generalices). Si el documento de verdad no trae nada más allá de precio/plazo/flete, usa una lista vacía — no fuerces algo solo por rellenar.

FORMATO DE NÚMEROS CHILENO/LATINOAMERICANO — el documento casi siempre usa PUNTO como separador de
MILES y COMA como separador DECIMAL (al revés que en inglés): "2.052,00" es DOS MIL CINCUENTA Y DOS
(2052.00), NO dos coma cero cinco. "8.243,00" es OCHO MIL DOSCIENTOS CUARENTA Y TRES (8243.00). No
confundas un punto de miles con un punto decimal.

MONEDA — revisa TODO el documento, incluyendo tablas chicas de "condiciones comerciales" o pie de
página, no solo el encabezado. Busca explícitamente una etiqueta de tipo "TIPO MONEDA", "MONEDA",
"CURRENCY", "VALUTA" y frases como "DOLAR"/"DÓLAR"/"USD"/"US$" (→ moneda: "USD"), "EURO"/"EUR"/"€"
(→ moneda: "EUR") o "PESO"/"PESOS CHILENOS"/"CLP" (→ moneda: "CLP"). El símbolo € por sí solo (sin
ninguna etiqueta "moneda"/"currency" cerca, como en muchas facturas europeas que solo ponen "€"
junto a cada monto) ya es suficiente para moneda: "EUR" — no hace falta una etiqueta explícita
además del símbolo. Un documento puede mostrar precios en una moneda extranjera aunque el proveedor
tenga nombre chileno o viceversa — no asumas CLP solo por el idioma o el domicilio, mira los montos.

Si un dato no aparece con certeza, usa null — NUNCA inventes ni asumas un valor.

Responde SOLO JSON: {"proveedorNombre":<string o null>,"proveedorRut":<string o null>,"precioUnitario":<número o null>,"precioTotal":<número o null>,"cantidadPrincipal":<número o null>,"descuentoPct":<número o null>,"fleteMonto":<número o null>,"moneda":<string o null>,"plazoEntregaTexto":<string o null>,"direccionBodega":<string o null>,"notasAdicionales":[<string, ...>]}`;

/** Lee un archivo de cotización (PDF por URL pública, imagen por buffer) y extrae los campos que
 *  la spec pide (§8.2). Devuelve todo en null si el OCR no logró transcribir nada legible — nunca
 *  se le pasa texto vacío a la IA para que no "complete" con una adivinanza. */
export async function extraerDatosCotizacionDeDocumento(
  archivoUrl: string, buffer: Buffer, mimeType: string,
): Promise<DatosExtraidosCotizacion | null> {
  const esPdf = mimeType === 'application/pdf' || archivoUrl.toLowerCase().endsWith('.pdf');
  let texto = '';
  try {
    texto = esPdf
      ? await extraerTextoPdfPorUrlConGlmOcr(archivoUrl, 0)
      : await ocrImagenConGlmOcr(buffer, mimeType);
  } catch (e) {
    console.error('[compras-cotizacion-ocr] GLM-OCR falló:', String(e).slice(0, 200));
  }

  // Respaldo 100% local (pedido explícito, 15-sep-2026: "la idea es que las lea todas dependiente
  // de donde sea, china, estados unidos, chile, de donde sea") — GLM-OCR lee por URL pública: un
  // proveedor extranjero cuya factura mezcla texto en inglés/chino con una foto de producto grande
  // puede hacerlo fallar (saturación, timeout, o un formato que no procesa bien), y sin respaldo
  // el usuario se queda sin nada que leer. Tesseract corre sobre el BUFFER local, sin depender de
  // que la URL sea alcanzable ni de la cuenta de Z.AI — mismo respaldo que ya usa el resto del
  // proyecto para documentos escaneados (ver tesseract-ocr.ts). Calidad menor en tablas complejas,
  // pero mejor un dato imperfecto para revisar que forzar a tipear todo a mano.
  if (!texto || texto.trim().length < 20) {
    try {
      texto = esPdf ? await ocrPdfLocalTesseract(buffer) : await ocrImagenLocalTesseract(buffer);
    } catch (e) {
      console.error('[compras-cotizacion-ocr] respaldo Tesseract también falló:', String(e).slice(0, 200));
    }
  }
  if (!texto || texto.trim().length < 20) return null; // nada legible: no hay de dónde extraer

  try {
    const completion: any = await crearChatIA({
      messages: [{ role: 'system', content: SYS_EXTRACCION }, { role: 'user', content: texto.slice(0, 12_000) }],
      temperature: 0, stream: false, max_tokens: 800,
      response_format: { type: 'json_object' },
    }, { timeoutMs: 45_000, modeloPreferido: 'glm-4.7', soloGlm: true });

    const parsed: any = parseJsonIA(String(completion.choices?.[0]?.message?.content ?? '')) || {};
    const precioUnitario = Number.isFinite(Number(parsed.precioUnitario)) ? Number(parsed.precioUnitario) : null;
    const precioTotal = Number.isFinite(Number(parsed.precioTotal)) ? Number(parsed.precioTotal) : null;
    const cantidadPrincipal = Number.isFinite(Number(parsed.cantidadPrincipal)) ? Number(parsed.cantidadPrincipal) : null;
    const descuentoPct = Number.isFinite(Number(parsed.descuentoPct)) && Number(parsed.descuentoPct) > 0
      ? Number(parsed.descuentoPct) : descuentoPctDelTexto(texto);
    const fleteMonto = Number.isFinite(Number(parsed.fleteMonto)) && Number(parsed.fleteMonto) > 0
      ? Number(parsed.fleteMonto) : fleteMontoDelTexto(texto);
    // Si la IA no trajo moneda (o solo detectó "CLP" por defecto sin decirlo explícito), el regex
    // determinístico sobre el texto transcrito es la segunda opinión — barata y no inventa: solo
    // dispara si hay una etiqueta o mención de moneda literal en el documento.
    const moneda = parsed.moneda || monedaDelTexto(texto);
    return {
      proveedorNombre: parsed.proveedorNombre || null, proveedorRut: parsed.proveedorRut || null,
      precioUnitario: precioUnitarioConfiable(precioUnitario, precioTotal, cantidadPrincipal),
      precioTotal, descuentoPct, fleteMonto: fleteMontoConfiable(fleteMonto, precioTotal, precioUnitario),
      moneda, plazoEntregaTexto: parsed.plazoEntregaTexto || null,
      direccionBodega: parsed.direccionBodega || null,
      notasAdicionales: Array.isArray(parsed.notasAdicionales) ? parsed.notasAdicionales.filter((n: unknown) => typeof n === 'string' && n.trim()) : [],
      // Tope generoso (12.000 — el mismo que se le pasa a la IA de extracción arriba) para no
      // guardar un documento gigante entero si alguien sube algo fuera de lo esperado.
      textoCompleto: texto.slice(0, 12_000),
    };
  } catch (e) {
    console.error('[compras-cotizacion-ocr] extracción IA falló:', String(e).slice(0, 200));
    // El OCR sí transcribió texto legible — aunque la IA de campos estructurados haya fallado, ese
    // texto sigue sirviendo para rellenar `descripcionLibre` y que homologarCotizacionIA lo use.
    return {
      proveedorNombre: null, proveedorRut: null, precioUnitario: null, precioTotal: null,
      descuentoPct: descuentoPctDelTexto(texto), fleteMonto: fleteMontoDelTexto(texto),
      moneda: null, plazoEntregaTexto: null, direccionBodega: null, notasAdicionales: [],
      textoCompleto: texto.slice(0, 12_000),
    };
  }
}
