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
import { crearChatIA } from '@/app/lib/gemini';
import { parseJsonIA } from '@/app/lib/json-ia';

export interface DatosExtraidosCotizacion {
  proveedorNombre: string | null; proveedorRut: string | null;
  precioUnitario: number | null; precioTotal: number | null; moneda: string | null;
  plazoEntregaTexto: string | null; direccionBodega: string | null; notas: string | null;
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

/** Respaldo determinístico (regex, no IA) para la moneda: el mismo documento que falló en el
 *  precio unitario también le hizo perder a la IA la etiqueta "5.- TIPO MONEDA: DOLAR" — que
 *  SÍ está literal en el texto transcrito. No reemplaza a la IA (sigue siendo la fuente principal,
 *  entiende contexto que un regex no), pero sirve de segunda opinión barata cuando la IA no
 *  devolvió nada: si el texto trae una etiqueta de moneda explícita, se usa esa. */
function monedaDelTexto(texto: string): 'USD' | 'CLP' | null {
  const cerca = texto.match(/(?:TIPO\s+MONEDA|MONEDA|CURRENCY)\s*[:\-]?\s*([A-ZÁÉÍÓÚÑ$]+)/i);
  const candidato = (cerca?.[1] || '').toUpperCase();
  if (/USD|D[OÓ]LAR/.test(candidato)) return 'USD';
  if (/CLP|PESO/.test(candidato)) return 'CLP';
  // Sin etiqueta explícita cerca de "moneda": buscar "USD"/"US$" sueltos en el documento como
  // última pista, pero solo si NO aparece también un signo "$"/"CLP" claro de peso chileno, para
  // no adivinar cuando el documento es ambiguo.
  if (/\bUSD\b|US\$/.test(texto) && !/\bCLP\b/.test(texto)) return 'USD';
  return null;
}

const SYS_EXTRACCION = `Eres un asistente que lee cotizaciones de proveedores (PDF o imagen, ya transcritas a texto) para una empresa chilena que compra productos adjudicados en licitaciones públicas.

Del texto que te paso, extrae SOLO lo que esté explícito y sea inequívoco:
- proveedorNombre: nombre o razón social del proveedor que EMITE la cotización (no el destinatario).
- proveedorRut: RUT del proveedor, formato XX.XXX.XXX-X si aparece.
- precioUnitario: precio unitario del producto principal, en número (sin símbolo de moneda ni puntos de miles).
- precioTotal: precio total de la cotización, en número.
- cantidadPrincipal: la cantidad del producto principal en la línea de ese precio unitario (ej. "4,00" → 4), si aparece. Sirve para verificar que precioUnitario × cantidadPrincipal cuadre con precioTotal — sin ella no se puede validar el precio unitario.
- moneda: "CLP", "USD" u otra si se indica explícitamente; si no dice nada, usa "CLP".
- plazoEntregaTexto: el plazo de entrega tal como lo describe el documento (ej. "15 días hábiles").
- direccionBodega: dirección de despacho/bodega del proveedor, si aparece.
- notas: cualquier condición relevante que no calce en los campos anteriores (1 frase o null).

FORMATO DE NÚMEROS CHILENO/LATINOAMERICANO — el documento casi siempre usa PUNTO como separador de
MILES y COMA como separador DECIMAL (al revés que en inglés): "2.052,00" es DOS MIL CINCUENTA Y DOS
(2052.00), NO dos coma cero cinco. "8.243,00" es OCHO MIL DOSCIENTOS CUARENTA Y TRES (8243.00). No
confundas un punto de miles con un punto decimal.

MONEDA — revisa TODO el documento, incluyendo tablas chicas de "condiciones comerciales" o pie de
página, no solo el encabezado. Busca explícitamente una etiqueta de tipo "TIPO MONEDA", "MONEDA",
"CURRENCY" y frases como "DOLAR"/"DÓLAR"/"USD"/"US$" (→ moneda: "USD") o "PESO"/"PESOS CHILENOS"/"CLP"
(→ moneda: "CLP"). Un documento puede mostrar precios en dólares aunque el proveedor y el domicilio
sean chilenos — no asumas CLP solo porque el proveedor es de Chile.

Si un dato no aparece con certeza, usa null — NUNCA inventes ni asumas un valor.

Responde SOLO JSON: {"proveedorNombre":<string o null>,"proveedorRut":<string o null>,"precioUnitario":<número o null>,"precioTotal":<número o null>,"cantidadPrincipal":<número o null>,"moneda":<string o null>,"plazoEntregaTexto":<string o null>,"direccionBodega":<string o null>,"notas":<string o null>}`;

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
    console.error('[compras-cotizacion-ocr] OCR falló:', String(e).slice(0, 200));
    return null;
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
    // Si la IA no trajo moneda (o solo detectó "CLP" por defecto sin decirlo explícito), el regex
    // determinístico sobre el texto transcrito es la segunda opinión — barata y no inventa: solo
    // dispara si hay una etiqueta o mención de moneda literal en el documento.
    const moneda = parsed.moneda || monedaDelTexto(texto);
    return {
      proveedorNombre: parsed.proveedorNombre || null, proveedorRut: parsed.proveedorRut || null,
      precioUnitario: precioUnitarioConfiable(precioUnitario, precioTotal, cantidadPrincipal),
      precioTotal,
      moneda, plazoEntregaTexto: parsed.plazoEntregaTexto || null,
      direccionBodega: parsed.direccionBodega || null, notas: parsed.notas || null,
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
      moneda: null, plazoEntregaTexto: null, direccionBodega: null, notas: null,
      textoCompleto: texto.slice(0, 12_000),
    };
  }
}
