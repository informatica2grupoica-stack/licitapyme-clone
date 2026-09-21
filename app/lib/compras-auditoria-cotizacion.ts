// app/lib/compras-auditoria-cotizacion.ts
// AUDITOR REAL DE COTIZACIONES — pedido explícito del usuario (21-sep-2026): "si subo una cotización
// y el producto que estoy subiendo no es el que corresponde debe ser capaz de decirme que no, y por
// qué; no solo ponerle 'pasa'". Hasta acá el `cumple` de cada cotización × producto lo elegía la
// persona (por defecto "Cumple") o lo adivinaba una IA que solo leía el texto libre: nadie comparaba
// la cotización contra lo que el producto DEBE cumplir, y ningún "pasa" traía su motivo.
//
// CÓMO DECIDE (dos capas, por diseño):
//   1. Reglas por CÓDIGO, sin IA: plazo del proveedor vs. reloj de entrega, compra a pérdida,
//      cotización vencida, RUT inválido, precio sin cargar. Son hechos, no opiniones.
//   2. Revisión por IA contra lo exigido (Auditor Técnico + línea de la licitación + Bases Técnicas):
//      ¿es el producto?, ¿cumple cada especificación?, garantía, cantidad, condiciones.
//
// REGLA DE ORO (el "por qué" nunca es opinión): la IA NO puede dar "cumple" sin una cita LITERAL
// de la cotización que lo respalde, y esa cita la verifica el CÓDIGO (substring-match contra el
// texto real del documento), no otra IA. Si el documento no dice nada sobre un requisito, el
// resultado es "no verificable" — nunca "cumple por omisión". Mismo criterio de citas verificadas
// que ya usa compras-agente-documentos.ts, y de "nunca inventar datos" del resto del módulo.
//
// NO EXCLUYE (spec §8.8.1): el dictamen se traduce al `cumple` de siempre (CUMPLE / INFERIOR_* /
// NO_ES_EL_PRODUCTO) para que cuadro comparativo y escenarios sigan funcionando igual; una
// cotización no verificable se ordena detrás de las verificadas, pero no se descarta.
//
// OVERRIDE: una persona puede decidir distinto al auditor, pero con motivo obligatorio y a su
// nombre — queda en el historial y en la pantalla, junto al dictamen original.
import pool from '@/app/lib/db';
import { ahoraChileSQL } from '@/app/lib/tz';
import { registrarEvento } from '@/app/lib/historial';
import { crearChatIA } from '@/app/lib/gemini';
import { parseJsonIA } from '@/app/lib/json-ia';
import { listarProductosCompra, invalidarAprobacionesCompras, type ProductoCompra } from '@/app/lib/compras';
import { obtenerEstadoReloj } from '@/app/lib/compras-reloj';
import { extraerDatosCotizacionDeDocumento } from '@/app/lib/compras-cotizacion-ocr';

export type CumpleAuditado = 'CUMPLE' | 'MEJORA' | 'INFERIOR_NEGOCIABLE' | 'INFERIOR_INSALVABLE' | 'NO_ES_EL_PRODUCTO';
export type Dictamen = 'APTA' | 'CON_OBSERVACIONES' | 'NO_APTA' | 'NO_ES_EL_PRODUCTO' | 'NO_VERIFICABLE';
export type ResultadoRevision = 'CUMPLE' | 'NO_CUMPLE' | 'NO_VERIFICABLE';
export type AreaRevision = 'producto' | 'especificacion' | 'garantia' | 'cantidad' | 'condiciones' | 'precio' | 'plazo' | 'vigencia' | 'proveedor' | 'documento';

export interface Revision {
  area: AreaRevision;
  criterio: string;
  requerido: string | null;
  cotizado: string | null;
  resultado: ResultadoRevision;
  gravedad: 'critico' | 'aviso' | 'info';
  explicacion: string;
  origen: 'codigo' | 'ia';
  // Evidencia: cita literal de la cotización y de lo exigido; `*Verificada` la calcula el código.
  citaCotizacion: string | null; citaCotizacionVerificada: boolean;
  citaRequisito: string | null; citaRequisitoVerificada: boolean;
}

export interface AuditoriaFila {
  cotizacionId: number; productoId: number; dictamen: Dictamen; resumen: string | null;
  revisiones: Revision[]; modelo: string | null; generadoAt: string; generadoPorNombre: string | null;
  cumpleAplicado: CumpleAuditado | null;
  override: { cumple: CumpleAuditado; motivo: string; porNombre: string | null; at: string } | null;
}

const MODELO = 'glm-4.7';
const MAX_BASES_CHARS = 30_000;
const MAX_COTIZACION_CHARS = 12_000;

const fmtCLP = (n: number) => new Intl.NumberFormat('es-CL', { style: 'currency', currency: 'CLP', maximumFractionDigits: 0 }).format(n);

/** Traduce el dictamen al `cumple` que ya consumen el cuadro comparativo y los escenarios. Una
 *  cotización NO VERIFICABLE cae en INFERIOR_NEGOCIABLE: no se excluye (§8.8.1) pero tampoco pasa
 *  por "cumple" sin evidencia — los escenarios prefieren siempre a las verificadas. */
export function cumpleDeDictamen(d: Dictamen): CumpleAuditado {
  switch (d) {
    case 'APTA': return 'CUMPLE';
    case 'CON_OBSERVACIONES': return 'INFERIOR_NEGOCIABLE';
    case 'NO_APTA': return 'INFERIOR_INSALVABLE';
    case 'NO_ES_EL_PRODUCTO': return 'NO_ES_EL_PRODUCTO';
    default: return 'INFERIOR_NEGOCIABLE';
  }
}

const TIER: Record<CumpleAuditado, number> = { CUMPLE: 0, MEJORA: 0, INFERIOR_NEGOCIABLE: 1, INFERIOR_INSALVABLE: 2, NO_ES_EL_PRODUCTO: 3 };

// ── Verificación de citas (determinística, sin IA) ────────────────────────────────────────────
// Se compara solo la secuencia de palabras: sin tildes, mayúsculas, signos ni viñetas — un OCR
// mete "➢", comillas y saltos de línea distintos, y eso no debe invalidar una cita legítima.
function soloPalabras(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}
/** Una cita cuenta si tiene al menos 2 palabras y 8 caracteres y aparece tal cual en el texto: sirve
 *  "TTK 655S" (un modelo) o "91 litros", pero no un "7" o un "si" suelto, que aparecerían en
 *  cualquier documento y no prueban nada. */
export function citaExiste(texto: string, cita: string | null | undefined): boolean {
  if (!cita) return false;
  const c = soloPalabras(cita);
  if (c.split(' ').length < 2 || c.length < 8) return false;
  return soloPalabras(texto).includes(c);
}

/** Dígito verificador del RUT chileno (módulo 11). */
export function rutValido(rut: string): boolean {
  const limpio = rut.replace(/[^0-9kK]/g, '').toUpperCase();
  if (limpio.length < 2) return false;
  const cuerpo = limpio.slice(0, -1); const dv = limpio.slice(-1);
  let suma = 0, mult = 2;
  for (let i = cuerpo.length - 1; i >= 0; i--) { suma += Number(cuerpo[i]) * mult; mult = mult === 7 ? 2 : mult + 1; }
  const resto = 11 - (suma % 11);
  const esperado = resto === 11 ? '0' : resto === 10 ? 'K' : String(resto);
  return dv === esperado;
}

async function licitacionDeNegocio(negocioId: number): Promise<string | null> {
  const [rows] = await pool.query(`SELECT licitacion_codigo FROM negocios WHERE id = ? LIMIT 1`, [negocioId]) as any;
  return (rows as any[])[0]?.licitacion_codigo ?? null;
}

// ── Qué se EXIGE (las tres fuentes, de más a menos estructurada) ──────────────────────────────
interface Exigencias {
  lineaLicitacion: string | null;      // descripción de la línea en Mercado Público
  caracteristicas: string[];           // Auditor Técnico (valor requerido por característica)
  basesTecnicas: string;               // extracto de las bases (texto_extraido)
  documentosBases: string[];
  hayAlgo: boolean;
}

async function obtenerExigencias(negocioId: number, licitacionCodigo: string | null, producto: ProductoCompra): Promise<Exigencias> {
  let lineaLicitacion: string | null = null;
  const caracteristicas: string[] = [];
  let basesTecnicas = ''; const documentosBases: string[] = [];

  if (licitacionCodigo) {
    const [adj] = await pool.query(`SELECT lineas FROM adjudicacion_cache WHERE licitacion_codigo = ? LIMIT 1`, [licitacionCodigo]) as any;
    try {
      const lineas = JSON.parse((adj as any[])[0]?.lineas || '[]');
      const l = Array.isArray(lineas) ? lineas.find((x: any) => Number(x.correlativo) === producto.correlativo) || (lineas.length === 1 ? lineas[0] : null) : null;
      if (l) lineaLicitacion = [l.producto, l.descripcion].filter(Boolean).join(' — ') || null;
    } catch { /* lineas mal formadas: se sigue con las otras fuentes */ }

    // Prefiere las bases TÉCNICAS; si no hay, las administrativas (a veces traen el anexo técnico).
    for (const categorias of [['BASES_TECNICAS'], ['BASES_ADMINISTRATIVAS']]) {
      if (basesTecnicas) break;
      const [docs] = await pool.query(
        `SELECT documento_nombre, texto_extraido FROM documentos_cache
          WHERE licitacion_codigo = ? AND categoria IN (${categorias.map(() => '?').join(',')}) AND texto_extraido IS NOT NULL AND texto_extraido <> ''
          ORDER BY id ASC`,
        [licitacionCodigo, ...categorias],
      ) as any;
      for (const d of docs as any[]) {
        if (basesTecnicas.length >= MAX_BASES_CHARS) break;
        basesTecnicas += `[[${d.documento_nombre}]]\n${String(d.texto_extraido).slice(0, MAX_BASES_CHARS - basesTecnicas.length)}\n\n`;
        documentosBases.push(d.documento_nombre);
      }
    }
  }

  if (producto.correlativo != null) {
    const [rows] = await pool.query(
      `SELECT c.descripcion, c.tipo, c.valor_requerido_texto, c.valor_requerido_numero, c.valor_requerido_numero_max, c.unidad_requerida
         FROM checklist_comercial_caracteristicas c JOIN checklist_comercial i ON i.id = c.item_id
        WHERE c.negocio_id = ? AND i.linea_numero = ? ORDER BY c.orden, c.id`,
      [negocioId, producto.correlativo],
    ) as any;
    for (const c of rows as any[]) {
      const min = c.valor_requerido_numero != null ? Number(c.valor_requerido_numero) : null;
      const max = c.valor_requerido_numero_max != null ? Number(c.valor_requerido_numero_max) : null;
      const valor = c.valor_requerido_texto
        || (min != null && max != null ? `entre ${min} y ${max}` : min != null ? `${c.tipo === 'MAXIMO' ? 'máximo' : 'mínimo'} ${min}` : max != null ? `máximo ${max}` : 'según bases');
      caracteristicas.push(`${c.descripcion}: ${valor}${c.unidad_requerida ? ` ${c.unidad_requerida}` : ''}`);
    }
  }

  return { lineaLicitacion, caracteristicas, basesTecnicas: basesTecnicas.trim(), documentosBases, hayAlgo: !!(lineaLicitacion || caracteristicas.length || basesTecnicas.trim()) };
}

// ── Texto de la cotización (lo que el documento REALMENTE dice) ───────────────────────────────
async function textoDeCotizacion(cot: any): Promise<string> {
  let doc = String(cot.texto_documento || '').trim();
  // Si nunca se leyó el archivo (cotización cargada antes de que existiera esta columna, o cuya
  // lectura falló al subirla), se lee ahora: auditar sin ver el documento no sirve.
  // (si lo tipeado/autocompletado ya es largo, es que el documento ya se leyó al subirlo: no se repite el OCR)
  if (!doc && cot.archivo_url && String(cot.descripcion_libre || '').trim().length < 400) {
    try {
      const res = await fetch(cot.archivo_url);
      if (res.ok) {
        const buf = Buffer.from(await res.arrayBuffer());
        const url = String(cot.archivo_url).toLowerCase().split('?')[0];
        const mime = url.endsWith('.pdf') ? 'application/pdf' : url.endsWith('.png') ? 'image/png' : url.endsWith('.webp') ? 'image/webp' : 'image/jpeg';
        const ext = await extraerDatosCotizacionDeDocumento(cot.archivo_url, buf, mime);
        doc = (ext?.textoCompleto || '').trim();
        if (doc) await pool.query(`UPDATE compras_cotizacion SET texto_documento = ? WHERE id = ?`, [doc, cot.id]).catch(() => {});
      }
    } catch (e) { console.warn('[auditoria-cotizacion] no se pudo leer el archivo de la cotización', cot.id, String(e).slice(0, 150)); }
  }
  const libre = String(cot.descripcion_libre || '').trim();
  // Si lo tipeado es el mismo texto del documento (la pantalla lo autocompleta), no se duplica.
  const partes = [doc, libre && !doc.includes(libre.slice(0, 200)) ? libre : ''].filter(Boolean);
  return partes.join('\n\n').slice(0, MAX_COTIZACION_CHARS);
}

// ── Reglas por código ──────────────────────────────────────────────────────────────────────────
function revisionesPorCodigo(
  cot: any, producto: ProductoCompra, precioCosto: number | null,
  reloj: { fechaLimiteVigente: string | null; diasRestantes: number | null } | null,
): Revision[] {
  const out: Revision[] = [];
  const base = { origen: 'codigo' as const, citaCotizacion: null, citaCotizacionVerificada: false, citaRequisito: null, citaRequisitoVerificada: false };

  // Precio: sin precio no hay nada que comparar ni que comprar.
  if (precioCosto == null) {
    out.push({ ...base, area: 'precio', criterio: 'Precio unitario cargado', requerido: 'Un precio en pesos para este producto', cotizado: null,
      resultado: 'NO_VERIFICABLE', gravedad: 'critico',
      explicacion: 'Esta cotización no tiene un precio unitario en pesos asignado a este producto (o está en moneda extranjera sin tipo de cambio), así que no entra a las cuentas.' });
  } else if (producto.montoUnitario != null && producto.montoUnitario > 0) {
    const venta = producto.montoUnitario;
    if (precioCosto >= venta) {
      out.push({ ...base, area: 'precio', criterio: 'Costo vs. precio de venta al cliente', requerido: `Costo menor a ${fmtCLP(venta)} (lo que se le vendió al cliente)`, cotizado: fmtCLP(precioCosto),
        resultado: 'NO_CUMPLE', gravedad: 'critico',
        explicacion: `Comprar a ${fmtCLP(precioCosto)} c/u cuando se vendió a ${fmtCLP(venta)} c/u deja pérdida (asumiendo que el precio de la cotización es neto).` });
    } else {
      const margen = Math.round((1 - precioCosto / venta) * 1000) / 10;
      out.push({ ...base, area: 'precio', criterio: 'Costo vs. precio de venta al cliente', requerido: `Costo menor a ${fmtCLP(venta)}`, cotizado: fmtCLP(precioCosto),
        resultado: 'CUMPLE', gravedad: 'info', explicacion: `Margen bruto unitario de ${margen}% (asumiendo que el precio de la cotización es neto).` });
    }
  }

  // Vigencia.
  if (cot.vigencia_at) {
    const vig = String(cot.vigencia_at).slice(0, 10);
    const hoy = ahoraChileSQL().slice(0, 10);
    if (vig < hoy) {
      out.push({ ...base, area: 'vigencia', criterio: 'Cotización vigente', requerido: `Vigente a hoy (${hoy})`, cotizado: `Vigente hasta ${vig}`,
        resultado: 'NO_CUMPLE', gravedad: 'aviso', explicacion: 'La cotización ya venció: hay que pedirle al proveedor que la confirme o la renueve antes de comprar sobre ese precio.' });
    }
  }

  // Plazo del proveedor vs. lo que queda para entregarle al cliente.
  const texto = String(cot.plazo_entrega_texto || '');
  const dias = cot.plazo_entrega_dias != null ? Number(cot.plazo_entrega_dias) : null;
  if (dias != null && reloj?.diasRestantes != null) {
    // Si el proveedor habla de días hábiles, en corridos son ~1,4 veces más.
    const diasCorridos = /h[aá]bil/i.test(texto) ? Math.ceil(dias * 1.4) : dias;
    if (diasCorridos > reloj.diasRestantes) {
      out.push({ ...base, area: 'plazo', criterio: 'Plazo del proveedor vs. reloj de entrega', requerido: `Menos de ${reloj.diasRestantes} día(s) (hasta el ${reloj.fechaLimiteVigente})`, cotizado: texto || `${dias} días`,
        resultado: 'NO_CUMPLE', gravedad: 'critico',
        explicacion: `El proveedor tarda ~${diasCorridos} día(s) corridos y al cliente hay que entregarle en ${reloj.diasRestantes}: no alcanza.`, citaCotizacion: texto || null, citaCotizacionVerificada: true });
    } else {
      out.push({ ...base, area: 'plazo', criterio: 'Plazo del proveedor vs. reloj de entrega', requerido: `Menos de ${reloj.diasRestantes} día(s)`, cotizado: texto || `${dias} días`,
        resultado: 'CUMPLE', gravedad: 'info', explicacion: `~${diasCorridos} día(s) del proveedor caben en los ${reloj.diasRestantes} que quedan.`, citaCotizacion: texto || null, citaCotizacionVerificada: true });
    }
  } else if (dias == null && texto) {
    const inmediata = /inmediat|en stock|stock/i.test(texto);
    out.push({ ...base, area: 'plazo', criterio: 'Plazo del proveedor', requerido: reloj?.fechaLimiteVigente ? `Antes del ${reloj.fechaLimiteVigente}` : 'Un plazo verificable', cotizado: texto,
      resultado: inmediata ? 'CUMPLE' : 'NO_VERIFICABLE', gravedad: inmediata ? 'info' : 'aviso',
      explicacion: inmediata
        ? 'El proveedor declara entrega inmediata / en stock (ojo: suele venir "salvo venta previa"; confírmalo antes de comprar).'
        : 'El plazo está escrito sin un número de días, no se puede comparar con el reloj de entrega.',
      citaCotizacion: texto, citaCotizacionVerificada: true });
  }

  // RUT del proveedor.
  if (cot.proveedor_rut && !rutValido(String(cot.proveedor_rut))) {
    out.push({ ...base, area: 'proveedor', criterio: 'RUT del proveedor', requerido: 'RUT con dígito verificador correcto', cotizado: String(cot.proveedor_rut),
      resultado: 'NO_CUMPLE', gravedad: 'aviso', explicacion: 'El dígito verificador del RUT no calza: revisa que esté bien copiado (o que la cotización sea del proveedor correcto).' });
  }
  return out;
}

// ── Revisión por IA ────────────────────────────────────────────────────────────────────────────
const SYS_AUDITOR = `Eres el AUDITOR de cotizaciones de compra de una empresa chilena que revende productos adjudicados en licitaciones públicas. Tu trabajo es decidir, con EVIDENCIA, si la cotización de un proveedor corresponde al producto que hay que comprar y si cumple lo exigido. Eres escéptico: un "cumple" sin prueba es un error grave.

Recibes: (1) EL PRODUCTO A COMPRAR, (2) LO EXIGIDO (características del Auditor Técnico, línea de la licitación y extracto de las Bases Técnicas), (3) EL TEXTO DE LA COTIZACIÓN.

REGLAS DE EVIDENCIA (se verifican por código, no las puedes saltar):
- Para resultar "CUMPLE" debes copiar en "citaCotizacion" un fragmento LITERAL (mínimo 2 palabras seguidas y 8 caracteres, p. ej. "TTK 655S" o "91 litros"; idealmente una frase de 6-25 palabras que incluya el valor) del TEXTO DE LA COTIZACIÓN que demuestre el dato. Si la cotización no dice nada sobre ese requisito, el resultado es "NO_VERIFICABLE" — NUNCA "CUMPLE por omisión" ni por suposición.
- Para resultar "NO_CUMPLE" debes citar literalmente lo que la cotización dice (citaCotizacion) y, si existe, lo exigido (citaRequisito, literal de las Bases/línea). Si solo sospechas, es "NO_VERIFICABLE".
- Copia carácter por carácter, sin parafrasear ni corregir. Una cita inventada se descarta y tu revisión se degrada.

QUÉ REVISAR:
1. area "producto" (OBLIGATORIA, exactamente una): ¿lo que ofrece el proveedor ES el producto que hay que comprar? Compara tipo de equipo, marca/modelo y función. Las bases suelen decir "o equivalente": un equivalente es válido solo si cumple las especificaciones. Si ofrece algo de otra categoría o claramente distinto, es NO_CUMPLE. En "explicacion" di en una frase qué producto ofrece la cotización y qué se pedía.
2. area "especificacion": una revisión por cada requisito técnico concreto de LO EXIGIDO (potencia, capacidad, medidas, voltaje, materiales, certificaciones, etc.). Compara el valor exigido con el valor cotizado, con sus unidades (convierte si hace falta y dilo). "obligatorio": true si la exigencia es un mínimo/máximo/requisito excluyente.
3. area "garantia": si se exige garantía, compárala.
4. area "cantidad": si la cotización menciona cantidad mínima de compra, stock o cantidad ofertada, compárala con la cantidad requerida.
5. area "condiciones": condiciones de la cotización que afecten la compra (IVA incluido o no, forma de pago, exclusiones, "salvo venta previa", instalación no incluida). Solo si el texto las dice.
- No repitas revisiones. Máximo 25. Prioriza lo obligatorio. Si LO EXIGIDO viene vacío o es solo "según bases" sin detalle, dilo en la revisión de "producto" y no inventes requisitos.
- NO evalúes precio, plazo de entrega ni RUT: eso lo revisa otro proceso.

Responde SOLO JSON, sin markdown:
{"resumen":"<2-3 frases: qué ofrece la cotización, si es el producto y el balance>","revisiones":[{"area":"producto"|"especificacion"|"garantia"|"cantidad"|"condiciones","criterio":"<qué se revisa>","requerido":"<lo exigido o null>","cotizado":"<lo que dice la cotización o null>","resultado":"CUMPLE"|"NO_CUMPLE"|"NO_VERIFICABLE","obligatorio":true|false,"explicacion":"<por qué, 1 frase concreta>","citaCotizacion":"<literal o null>","citaRequisito":"<literal o null>"}]}`;

interface RevisionIA {
  area?: string; criterio?: string; requerido?: string | null; cotizado?: string | null; resultado?: string;
  obligatorio?: boolean; explicacion?: string; citaCotizacion?: string | null; citaRequisito?: string | null;
}

async function revisionesPorIA(
  producto: ProductoCompra, exig: Exigencias, textoCotizacion: string,
): Promise<{ resumen: string; revisiones: Revision[] }> {
  const exigido = [
    exig.lineaLicitacion ? `LÍNEA DE LA LICITACIÓN: ${exig.lineaLicitacion}` : '',
    exig.caracteristicas.length ? `CARACTERÍSTICAS EXIGIDAS (Auditor Técnico):\n${exig.caracteristicas.map(c => `- ${c}`).join('\n')}` : '',
    exig.basesTecnicas ? `EXTRACTO DE LAS BASES:\n${exig.basesTecnicas}` : '',
  ].filter(Boolean).join('\n\n') || '(no hay especificaciones exigidas cargadas)';

  const user = `PRODUCTO A COMPRAR: ${producto.descripcion}${producto.cantidad ? ` — cantidad requerida: ${producto.cantidad}${producto.unidad ? ` ${producto.unidad}` : ''}` : ''}

=== LO EXIGIDO ===
${exigido}

=== TEXTO DE LA COTIZACIÓN ===
${textoCotizacion}`;

  // GLM a veces devuelve una respuesta vacía o cortada (medido: 1 de 2 corridas en la prueba real):
  // se reintenta una vez antes de rendirse, y si sigue fallando se avisa — nunca se calla.
  let parsed: any = {};
  for (let intento = 1; intento <= 2; intento++) {
    const completion: any = await crearChatIA({
      messages: [{ role: 'system', content: SYS_AUDITOR }, { role: 'user', content: user }],
      temperature: 0, stream: false, max_tokens: 8_000, response_format: { type: 'json_object' },
    }, { timeoutMs: 150_000, modeloPreferido: MODELO, soloGlm: true });
    const contenido = String(completion.choices?.[0]?.message?.content ?? '');
    parsed = parseJsonIA(contenido) || {};
    if (Array.isArray(parsed.revisiones) && parsed.revisiones.length > 0) break;
    console.warn(`[auditoria-cotizacion] intento ${intento}: la IA no devolvió revisiones — finish=${completion.choices?.[0]?.finish_reason}, largo=${contenido.length}, cola="${contenido.slice(-150).replace(/\s+/g, ' ')}"`);
  }
  if (!Array.isArray(parsed.revisiones) || parsed.revisiones.length === 0) throw new Error('la IA no devolvió una respuesta interpretable (2 intentos)');
  const crudas: RevisionIA[] = Array.isArray(parsed.revisiones) ? parsed.revisiones.slice(0, 25) : [];

  // Pool donde se buscan las citas de lo EXIGIDO (las tres fuentes juntas).
  const poolExigido = [exig.lineaLicitacion || '', exig.caracteristicas.join('\n'), exig.basesTecnicas].join('\n');
  const areas: AreaRevision[] = ['producto', 'especificacion', 'garantia', 'cantidad', 'condiciones'];

  const revisiones: Revision[] = crudas.map(r => {
    const area = (areas.includes(r.area as AreaRevision) ? r.area : 'especificacion') as AreaRevision;
    const citaCotOk = citaExiste(textoCotizacion, r.citaCotizacion);
    const citaReqOk = citaExiste(poolExigido, r.citaRequisito);
    let resultado: ResultadoRevision = r.resultado === 'CUMPLE' || r.resultado === 'NO_CUMPLE' ? r.resultado : 'NO_VERIFICABLE';
    let explicacion = String(r.explicacion || '').trim();
    // El guardarraíl que responde al "por qué pasa": sin cita verificada no hay veredicto firme.
    if (resultado === 'CUMPLE' && !citaCotOk) {
      resultado = 'NO_VERIFICABLE';
      explicacion = `${explicacion} [Degradado: la IA dijo "cumple" pero no pudo respaldarlo con una cita literal de la cotización.]`.trim();
    } else if (resultado === 'NO_CUMPLE' && !citaCotOk && !citaReqOk) {
      resultado = 'NO_VERIFICABLE';
      explicacion = `${explicacion} [Degradado: la IA dijo "no cumple" pero ninguna de sus citas se pudo verificar en los documentos.]`.trim();
    }
    const obligatorio = r.obligatorio !== false; // ante la duda, se trata como obligatorio
    const gravedad: Revision['gravedad'] =
      resultado === 'CUMPLE' ? 'info'
      : area === 'producto' || (area === 'especificacion' && obligatorio) ? (resultado === 'NO_CUMPLE' ? 'critico' : 'aviso')
      : 'aviso';
    return {
      area, criterio: String(r.criterio || 'Revisión').slice(0, 200),
      requerido: r.requerido ? String(r.requerido).slice(0, 400) : null, cotizado: r.cotizado ? String(r.cotizado).slice(0, 400) : null,
      resultado, gravedad, explicacion: explicacion.slice(0, 700), origen: 'ia' as const,
      citaCotizacion: r.citaCotizacion ? String(r.citaCotizacion).slice(0, 500) : null, citaCotizacionVerificada: citaCotOk,
      citaRequisito: r.citaRequisito ? String(r.citaRequisito).slice(0, 500) : null, citaRequisitoVerificada: citaReqOk,
    };
  });
  return { resumen: String(parsed.resumen || '').trim(), revisiones };
}

// ── Dictamen ───────────────────────────────────────────────────────────────────────────────────
export function calcularDictamen(revisiones: Revision[], hayTextoCotizacion: boolean): Dictamen {
  if (!hayTextoCotizacion) return 'NO_VERIFICABLE';
  const producto = revisiones.find(r => r.area === 'producto' && r.origen === 'ia');
  if (producto?.resultado === 'NO_CUMPLE') return 'NO_ES_EL_PRODUCTO';
  if (revisiones.some(r => r.resultado === 'NO_CUMPLE' && r.gravedad === 'critico')) return 'NO_APTA';
  const conEvidencia = revisiones.filter(r => r.origen === 'ia' && r.resultado === 'CUMPLE').length;
  if (conEvidencia === 0) return 'NO_VERIFICABLE'; // nada probado: no se puede decir que sirva
  const productoConfirmado = producto?.resultado === 'CUMPLE';
  const hayPendiente = revisiones.some(r => r.resultado !== 'CUMPLE' && (r.gravedad === 'aviso' || r.gravedad === 'critico'));
  if (!productoConfirmado || hayPendiente) return 'CON_OBSERVACIONES';
  return 'APTA';
}

function resumenDeterminista(d: Dictamen, revs: Revision[], resumenIA: string): string {
  const lista = (xs: string[]) => xs.length <= 4 ? xs.join('; ') : `${xs.slice(0, 4).join('; ')} (y ${xs.length - 4} más)`;
  const noCumple = revs.filter(r => r.resultado === 'NO_CUMPLE').map(r => r.criterio);
  const noVerif = revs.filter(r => r.resultado === 'NO_VERIFICABLE').map(r => r.criterio);
  const cabeza = {
    APTA: 'APTA: el producto es el pedido y cada punto revisado quedó respaldado con evidencia.',
    CON_OBSERVACIONES: 'CON OBSERVACIONES: sirve, pero hay puntos que no cumplen o que la cotización no permite confirmar.',
    NO_APTA: 'NO APTA: incumple algo que no se puede pasar por alto.',
    NO_ES_EL_PRODUCTO: 'NO ES EL PRODUCTO: lo que ofrece la cotización no corresponde a lo que hay que comprar.',
    NO_VERIFICABLE: 'NO VERIFICABLE: no hay evidencia suficiente en la cotización para aprobarla.',
  }[d];
  // El resumen de la IA a veces razona en voz alta; se recorta a sus dos primeras frases.
  const ia = resumenIA.split(/(?<=[.!?])\s+/).slice(0, 2).join(' ').slice(0, 350);
  return [cabeza, ia,
    noCumple.length ? `No cumple: ${lista(noCumple)}.` : '',
    noVerif.length ? `Sin poder verificar: ${lista(noVerif)}.` : ''].filter(Boolean).join(' ').slice(0, 1200);
}

// ── Orquestación ───────────────────────────────────────────────────────────────────────────────
export interface ResultadoAuditoria { productoId: number; dictamen: Dictamen; cumpleEfectivo: CumpleAuditado }

/** Audita UNA cotización contra cada producto al que está asignada (o solo `productoId`). Escribe
 *  compras_auditoria_cotizacion y deja `compras_cotizacion_item.cumple` = override de una persona si
 *  lo hay, si no el que resulta del dictamen. Si el veredicto EMPEORA respecto al que había, invalida
 *  las aprobaciones de compra (§10.5): quedaron sobre una cotización que no es lo que parecía. */
export async function auditarCotizacion(
  negocioId: number, cotizacionId: number,
  opts: { productoId?: number; actor?: { id: number; nombre: string | null } } = {},
): Promise<ResultadoAuditoria[]> {
  const [cotRows] = await pool.query(`SELECT * FROM compras_cotizacion WHERE id = ? AND negocio_id = ? LIMIT 1`, [cotizacionId, negocioId]) as any;
  const cot = (cotRows as any[])[0];
  if (!cot) throw new Error('Cotización no encontrada.');

  const [itemRows] = await pool.query(`SELECT producto_id, precio_unitario, cumple FROM compras_cotizacion_item WHERE cotizacion_id = ?`, [cotizacionId]) as any;
  let items = itemRows as any[];
  if (opts.productoId != null) items = items.filter(i => i.producto_id === opts.productoId);
  if (items.length === 0) return []; // sin producto asignado no hay contra qué auditar

  const productos = await listarProductosCompra(negocioId);
  const licitacionCodigo = await licitacionDeNegocio(negocioId);
  const [texto, reloj] = await Promise.all([textoDeCotizacion(cot), obtenerEstadoReloj(negocioId).catch(() => null)]);
  const resultados: ResultadoAuditoria[] = [];
  let empeoro = false;

  for (const it of items) {
    const producto = productos.find(p => p.id === it.producto_id);
    if (!producto) continue;
    const precioCosto = it.precio_unitario != null ? Number(it.precio_unitario) : null;
    const porCodigo = revisionesPorCodigo(cot, producto, precioCosto, reloj);

    let revisiones: Revision[] = [];
    let resumenIA = '';
    let modelo: string | null = null;
    if (!texto) {
      revisiones.push({ area: 'documento', criterio: 'Contenido de la cotización', requerido: 'Un documento o texto que describa lo que se cotiza', cotizado: null,
        resultado: 'NO_VERIFICABLE', gravedad: 'critico', origen: 'codigo', citaCotizacion: null, citaCotizacionVerificada: false, citaRequisito: null, citaRequisitoVerificada: false,
        explicacion: 'No hay texto de la cotización para auditar (no se pudo leer el archivo y no se escribió una descripción). Sin ver qué se cotiza, no se puede saber si es el producto.' });
    } else {
      const exig = await obtenerExigencias(negocioId, licitacionCodigo, producto);
      try {
        const ia = await revisionesPorIA(producto, exig, texto);
        revisiones = ia.revisiones; resumenIA = ia.resumen; modelo = MODELO;
        if (!exig.hayAlgo) revisiones.unshift({ area: 'especificacion', criterio: 'Especificaciones exigidas', requerido: null, cotizado: null,
          resultado: 'NO_VERIFICABLE', gravedad: 'aviso', origen: 'codigo', citaCotizacion: null, citaCotizacionVerificada: false, citaRequisito: null, citaRequisitoVerificada: false,
          explicacion: 'No hay especificaciones exigidas cargadas (ni en el Auditor Técnico, ni en la línea, ni en bases con texto leído): solo se puede confirmar qué producto es, no si cumple.' });
      } catch (e) {
        console.error('[auditoria-cotizacion] la IA falló:', String(e).slice(0, 200));
        revisiones.push({ area: 'producto', criterio: 'Revisión del producto con IA', requerido: null, cotizado: null, resultado: 'NO_VERIFICABLE', gravedad: 'aviso', origen: 'codigo',
          citaCotizacion: null, citaCotizacionVerificada: false, citaRequisito: null, citaRequisitoVerificada: false,
          explicacion: `La revisión con IA no se pudo completar (${String((e as Error).message || e).slice(0, 120)}). Reintenta; mientras tanto solo valen las reglas por código.` });
      }
    }
    revisiones = [...revisiones, ...porCodigo];
    const dictamen = calcularDictamen(revisiones, !!texto);
    const resumen = resumenDeterminista(dictamen, revisiones, resumenIA);
    const mapeado = cumpleDeDictamen(dictamen);

    const [prev] = await pool.query(`SELECT override_cumple FROM compras_auditoria_cotizacion WHERE cotizacion_id = ? AND producto_id = ? LIMIT 1`, [cotizacionId, producto.id]) as any;
    const override = ((prev as any[])[0]?.override_cumple as CumpleAuditado | null) ?? null;
    const efectivo = override ?? mapeado;
    const ahora = ahoraChileSQL();

    await pool.query(
      `INSERT INTO compras_auditoria_cotizacion
         (negocio_id, cotizacion_id, producto_id, dictamen, resumen, revisiones_json, modelo, generado_at, generado_por, generado_por_nombre, cumple_aplicado)
       VALUES (?,?,?,?,?,?,?,?,?,?,?)
       ON DUPLICATE KEY UPDATE dictamen = VALUES(dictamen), resumen = VALUES(resumen), revisiones_json = VALUES(revisiones_json),
         modelo = VALUES(modelo), generado_at = VALUES(generado_at), generado_por = VALUES(generado_por),
         generado_por_nombre = VALUES(generado_por_nombre), cumple_aplicado = VALUES(cumple_aplicado)`,
      [negocioId, cotizacionId, producto.id, dictamen, resumen, JSON.stringify(revisiones), modelo, ahora, opts.actor?.id ?? null, opts.actor?.nombre ?? null, mapeado],
    );
    await pool.query(
      `UPDATE compras_cotizacion_item SET cumple = ?, detalle_desviacion = ? WHERE cotizacion_id = ? AND producto_id = ?`,
      [efectivo, resumen.slice(0, 900), cotizacionId, producto.id],
    );
    if (TIER[efectivo] > TIER[it.cumple as CumpleAuditado] ) empeoro = true;
    resultados.push({ productoId: producto.id, dictamen, cumpleEfectivo: efectivo });

    await registrarEvento({
      tipo: 'COMPRAS_COTIZACION_AUDITADA', licitacionCodigo, actorId: opts.actor?.id, actorNombre: opts.actor?.nombre,
      mensaje: `El auditor dictaminó la cotización de "${cot.proveedor_nombre}" para "${producto.descripcion}": ${dictamen.replace(/_/g, ' ')}.`,
      metadata: { negocio_id: negocioId, cotizacion_id: cotizacionId, producto_id: producto.id, dictamen, override: override ?? null },
    }).catch(() => {});
  }

  if (empeoro) await invalidarAprobacionesCompras(negocioId, 'El auditor de cotizaciones dio un veredicto más exigente sobre una cotización.').catch(() => {});
  return resultados;
}

/** Corre el auditor en segundo plano sin bloquear a quien llama (mismo patrón que la homologación). */
export function auditarCotizacionEnSegundoPlano(negocioId: number, cotizacionId: number, actor?: { id: number; nombre: string | null }): void {
  auditarCotizacion(negocioId, cotizacionId, { actor }).catch(e =>
    console.error(`[auditoria-cotizacion] falló en segundo plano (cotización ${cotizacionId}):`, String(e).slice(0, 200)));
}

export async function listarAuditoriasNegocio(negocioId: number): Promise<AuditoriaFila[]> {
  const [rows] = await pool.query(
    `SELECT cotizacion_id, producto_id, dictamen, resumen, revisiones_json, modelo, cumple_aplicado, generado_por_nombre,
            DATE_FORMAT(generado_at, '%Y-%m-%d %H:%i:%s') AS generado_at,
            override_cumple, override_motivo, override_por_nombre, DATE_FORMAT(override_at, '%Y-%m-%d %H:%i:%s') AS override_at
       FROM compras_auditoria_cotizacion WHERE negocio_id = ?`,
    [negocioId],
  ) as any;
  return (rows as any[]).map(r => {
    let revisiones: Revision[] = [];
    try { revisiones = JSON.parse(r.revisiones_json || '[]'); } catch { /* fila corrupta: se muestra sin detalle */ }
    return {
      cotizacionId: r.cotizacion_id, productoId: r.producto_id, dictamen: r.dictamen, resumen: r.resumen, revisiones,
      modelo: r.modelo, generadoAt: r.generado_at, generadoPorNombre: r.generado_por_nombre, cumpleAplicado: r.cumple_aplicado,
      override: r.override_cumple ? { cumple: r.override_cumple, motivo: r.override_motivo || '', porNombre: r.override_por_nombre, at: r.override_at } : null,
    };
  });
}

/** Una persona decide distinto al auditor. El motivo es obligatorio (mínimo 15 caracteres) y queda a
 *  su nombre en el historial: "el auditor dijo X, [persona] lo cambió a Y porque…". `cumple = null`
 *  quita el override y vuelve al dictamen del auditor. */
export async function registrarOverrideAuditoria(
  negocioId: number, cotizacionId: number, productoId: number,
  cumple: CumpleAuditado | null, motivo: string, actor: { id: number; nombre: string | null },
): Promise<void> {
  const [rows] = await pool.query(
    `SELECT dictamen, cumple_aplicado FROM compras_auditoria_cotizacion WHERE cotizacion_id = ? AND producto_id = ? AND negocio_id = ? LIMIT 1`,
    [cotizacionId, productoId, negocioId],
  ) as any;
  const fila = (rows as any[])[0];
  if (!fila) throw new Error('Esta cotización todavía no fue auditada para este producto: audítala primero.');
  const licitacionCodigo = await licitacionDeNegocio(negocioId);
  const ahora = ahoraChileSQL();

  if (cumple == null) {
    await pool.query(`UPDATE compras_auditoria_cotizacion SET override_cumple = NULL, override_motivo = NULL, override_por = NULL, override_por_nombre = NULL, override_at = NULL WHERE cotizacion_id = ? AND producto_id = ?`, [cotizacionId, productoId]);
    await pool.query(`UPDATE compras_cotizacion_item SET cumple = ? WHERE cotizacion_id = ? AND producto_id = ?`, [fila.cumple_aplicado, cotizacionId, productoId]);
    await registrarEvento({ tipo: 'COMPRAS_AUDITORIA_OVERRIDE_QUITADO', licitacionCodigo, actorId: actor.id, actorNombre: actor.nombre,
      mensaje: `Se quitó la decisión manual sobre la cotización #${cotizacionId}: vuelve a valer el dictamen del auditor (${String(fila.dictamen).replace(/_/g, ' ')}).`,
      metadata: { negocio_id: negocioId, cotizacion_id: cotizacionId, producto_id: productoId } }).catch(() => {});
  } else {
    if (motivo.trim().length < 15) throw new Error('Explica el motivo (mínimo 15 caracteres): queda registrado a tu nombre.');
    await pool.query(
      `UPDATE compras_auditoria_cotizacion SET override_cumple = ?, override_motivo = ?, override_por = ?, override_por_nombre = ?, override_at = ? WHERE cotizacion_id = ? AND producto_id = ?`,
      [cumple, motivo.trim().slice(0, 2000), actor.id, actor.nombre, ahora, cotizacionId, productoId],
    );
    await pool.query(`UPDATE compras_cotizacion_item SET cumple = ? WHERE cotizacion_id = ? AND producto_id = ?`, [cumple, cotizacionId, productoId]);
    await registrarEvento({ tipo: 'COMPRAS_AUDITORIA_OVERRIDE', licitacionCodigo, actorId: actor.id, actorNombre: actor.nombre,
      mensaje: `${actor.nombre || 'Un usuario'} decidió "${cumple}" sobre la cotización #${cotizacionId} aunque el auditor dictaminó ${String(fila.dictamen).replace(/_/g, ' ')}. Motivo: ${motivo.trim()}`,
      metadata: { negocio_id: negocioId, cotizacion_id: cotizacionId, producto_id: productoId, dictamen: fila.dictamen, cumple, motivo: motivo.trim() } }).catch(() => {});
  }
  await invalidarAprobacionesCompras(negocioId, 'Se cambió por decisión manual el veredicto de una cotización.').catch(() => {});
}
