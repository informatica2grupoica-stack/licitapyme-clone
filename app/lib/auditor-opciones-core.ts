// app/lib/auditor-opciones-core.ts
// AUDITOR unificado · la parte que decide el CÓDIGO sobre lo que extrajo el Lector (Prompt 6):
//   · normalizar montos/plazos que el Lector copió TAL CUAL del documento,
//   · emparejar cada producto de una cotización con una línea del costeo,
//   · verificar la opción por código (vía liviana + V1..V4, V6, V7, V11 del Prompt 5 v2.0) y calcular el
//     veredicto y los bloqueos con su ruta de salida (Parte VIII: "el veredicto lo calcula el SISTEMA").
// Puro (sin base de datos ni red) para poder probarlo entero. Reutiliza las reglas de costo que ya usa el
// Auditor de Compras del módulo Compras (auditor-compras-core.ts): normalización neto/IVA, margen del
// proyecto con R1/R2, tokens de modelo. Spec: docs/ESPECIFICACION_AUDITOR_v1.md §5 y §8.
import {
  PARAMS, precioNetoUnitario, margenProyecto, mesesEntre, tokensDeProducto, costoRutaB,
  type LineaCosteo, type Veredicto, type Bloqueo, type Alerta, type MargenProyecto, numerosDelTexto,
} from '@/app/lib/auditor-compras-core';
import type { SalidaLector, ProductoLector } from '@/app/lib/auditor-lector';

// ── Montos y plazos ──────────────────────────────────────────────────────────────────────────────
/** "$1.234.567" → 1234567 · "1.234,56" → 1234.56 · "12,5" → 12.5 · "US$ 1,400" → 1400. null si no hay número. */
export function parsearMonto(v: string | number | null | undefined): number | null {
  if (v == null) return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  const limpio = v.replace(/[^\d.,]/g, '');
  if (!/\d/.test(limpio)) return null;
  const puntos = (limpio.match(/\./g) || []).length, comas = (limpio.match(/,/g) || []).length;
  let n: number;
  if (puntos && comas) {
    const dec = limpio.lastIndexOf('.') > limpio.lastIndexOf(',') ? '.' : ',';
    n = Number(limpio.split(dec === '.' ? ',' : '.').join('').replace(dec, '.'));
  } else if (puntos + comas > 1) {
    n = Number(limpio.replace(/[.,]/g, ''));            // varios separadores iguales = miles
  } else if (puntos + comas === 1) {
    const sep = puntos ? '.' : ',';
    const dec = limpio.length - limpio.indexOf(sep) - 1;
    n = dec === 3 ? Number(limpio.replace(sep, '')) : Number(limpio.replace(sep, '.'));
  } else n = Number(limpio);
  return Number.isFinite(n) ? n : null;
}

const MESES: Record<string, string> = { enero: '01', febrero: '02', marzo: '03', abril: '04', mayo: '05', junio: '06', julio: '07', agosto: '08', septiembre: '09', setiembre: '09', octubre: '10', noviembre: '11', diciembre: '12' };

export function fechaISO(t: string | null | undefined): string | null {
  if (!t) return null;
  // "22 de Septiembre de 2026" / "4 septiembre 2026"
  const txt = t.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  const mm = txt.match(/(\d{1,2})\s*(?:de\s+)?(enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|setiembre|octubre|noviembre|diciembre)\s*(?:de\s+|del\s+)?(\d{4})/);
  if (mm) return `${mm[3]}-${MESES[mm[2]]}-${mm[1].padStart(2, '0')}`;
  let m = t.match(/(\d{4})[-/](\d{1,2})[-/](\d{1,2})/);
  if (m) return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
  m = t.match(/(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})/);
  if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  m = t.match(/(\d{1,2})[-/.](\d{1,2})[-/.](\d{2})\b/);
  if (m) return `20${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  return null;
}
function sumarDias(iso: string, dias: number): string {
  const d = new Date(iso + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + dias); return d.toISOString().slice(0, 10);
}
function diasDelTexto(t: string | null | undefined): number | null {
  if (!t) return null;
  const m = t.match(/(\d{1,3})\s*(?:d[ií]as?|d\.)/i) || t.match(/^\s*(\d{1,3})\s*$/);
  return m ? Number(m[1]) : null;
}

// ── Producto normalizado (lo que salió del Lector, con números ya interpretados) ─────────────────
export interface ProductoNormalizado {
  idx: number;
  nombre: string;                 // "tipo marca modelo versión" para mostrar
  tipo: string; marca: string; modelo: string; version: string; sku: string;
  precio: number | null;          // el precio que rige (ver elegirPrecio)
  preciosMultiples: string[];     // otros precios visibles con su condición (para alertar)
  precioAmbiguo: boolean;
  moneda: string; iva: 'incluido' | 'neto' | 'no_declarado'; ivaTexto: string;
  /** Precio de un LINK de tienda sin IVA declarado: se asumió CON IVA (así publican las tiendas) y el costo neto se calcula sacándoselo. */
  ivaSupuesto?: boolean;
  unidadPrecio: string; contenidoEmpaque: string; unidadesPorEmpaque: number | null;
  cantidadCotizada: number | null; moq: number | null;
  stock: string; plazoTexto: string; plazoDias: number | null; tipoDias: string; despacho: string; incoterm: string;
  costosAdicionales: Array<{ detalle: string; monto: number | null; texto: string }>;
  garantia: string; condiciones: string[];
  /** Flete, despacho, instalación… cobrado como línea aparte: no es un producto y no se empareja con una línea. */
  esCargo: boolean;
  /** El código corrigió lo que leyó el Lector (p. ej. precio pegado a la cantidad); se muestra como alerta. */
  correccion?: string | null;
}

const CONDICIONES_NO_RIGEN = new Set(['tachado', 'tarjeta', 'desde']);
const ES_CARGO = /\b(despacho|flete|env[ií]o|transporte|instalaci[oó]n|shipping|freight|embalaje)\b/i;

/** Guardarraíl sobre el IVA: el Lector puede marcar "incluido" o "neto" por inferencia (ej. viendo "I.V.A 19%"
 *  al pie de una cotización cuyos precios unitarios son netos). El código solo lo acepta si la frase literal
 *  que copió lo dice de verdad; si no, queda no_declarado y la opción pide confirmarlo con el proveedor
 *  (Prompt 5 v2.0: "PROHIBIDO suponer si un precio incluye IVA"). */
export function ivaConfiable(iva: string | undefined, frase: string | undefined): 'incluido' | 'neto' | 'no_declarado' {
  const f = (frase || '').toLowerCase();
  if (iva === 'incluido' && /incluid|iva\s*incl|con\s*i\.?v\.?a|precio\s*final|total\s*con|bruto/.test(f)) return 'incluido';
  if (iva === 'neto' && /neto|\+\s*i\.?v\.?a|m[aá]s\s*i\.?v\.?a|sin\s*i\.?v\.?a|afecto|exento|no\s*incluye/.test(f)) return 'neto';
  return 'no_declarado';
}

function elegirPrecio(p: ProductoLector, cantidad: number | null): { precio: number | null; ambiguo: boolean; otros: string[] } {
  const lista = (p.comercial?.precios || []).map(x => ({ ...x, n: parsearMonto(x.valor) })).filter(x => x.n != null && x.n > 0);
  if (lista.length === 0) return { precio: null, ambiguo: false, otros: [] };
  const elegido = lista.find(x => x.seleccionada) || lista.find(x => x.condicion === 'actual')
    || lista.find(x => !CONDICIONES_NO_RIGEN.has(x.condicion || '')) || lista[0];
  // Otros precios "distintos": no cuenta el total de la línea (precio × cantidad), que no es otro precio.
  const esTotalDeLinea = (n: number) => cantidad != null && cantidad > 1 && Math.abs(n - (elegido.n as number) * cantidad) <= Math.max(2, cantidad);
  const otros = lista.filter(x => x !== elegido && x.n !== elegido.n && !esTotalDeLinea(x.n as number) && !/total/i.test(x.detalle_condicion || ''))
    .map(x => `${x.condicion || 'otro'}: ${x.valor}`);
  return { precio: elegido.n as number, ambiguo: !!elegido.numero_ambiguo, otros };
}

/** Cuando la capa de texto de un PDF pega la cantidad con el precio unitario ("17" + "374.000" → "17374.000"), el Lector lee $17.374.000. Se detecta con
 *  ARITMÉTICA sobre el propio documento: si el precio es «cantidad ‖ unitario» y la cantidad × el unitario aparece como número en el texto (el total
 *  de la línea), el precio real es el unitario. Sin ese total en el documento no se toca nada (un precio dudoso se deja como está). */
export function separarPrecioPegadoACantidad(texto: string, precio: number): { cantidad: number; precioUnitario: number; total: number } | null {
  if (!Number.isInteger(precio) || precio < 10_000) return null;
  const digitos = String(precio);
  if (!texto.replace(/[.,\s]/g, '').includes(digitos)) return null;           // el número tiene que estar tal cual en el documento
  const numeros = new Set(numerosDelTexto(texto));
  for (let k = 1; k <= 3 && k < digitos.length - 3; k++) {
    const cantidad = Number(digitos.slice(0, k)), resto = digitos.slice(k);
    if (cantidad < 2 || resto[0] === '0') continue;
    const unitario = Number(resto), total = cantidad * unitario;
    if (unitario >= 1 && numeros.has(total)) return { cantidad, precioUnitario: unitario, total };
  }
  return null;
}

export function normalizarProductos(salida: SalidaLector, texto?: string, esWeb = false): ProductoNormalizado[] {
  return (salida.productos || []).map((p, idx) => {
    const c = p.comercial || {}, d = p.producto || {};
    const condiciones = (c.condiciones_generales || []).map(x => x.texto || '').filter(Boolean);
    const cantTexto = condiciones.map(t => t.match(/cantidad\s*cotizada\s*[:=]?\s*([\d.,]+)/i)?.[1]).find(Boolean);
    const elegido = elegirPrecio(p, parsearMonto(cantTexto));
    let { precio } = elegido; const { ambiguo, otros } = elegido;
    let cantidadCorregida: number | null = null, correccion: string | null = null;
    const pegado = texto && precio != null && !ambiguo ? separarPrecioPegadoACantidad(texto, precio) : null;
    if (pegado) {
      correccion = `El precio venía pegado a la cantidad («${precio!.toLocaleString('es-CL')}»): se separó en ${pegado.cantidad} unidades × $${pegado.precioUnitario.toLocaleString('es-CL')}, porque el total del documento ($${pegado.total.toLocaleString('es-CL')}) lo confirma.`;
      precio = pegado.precioUnitario; cantidadCorregida = pegado.cantidad;
    }
    let iva = ivaConfiable(c.iva, c.iva_texto_literal), ivaSupuesto = false;
    // Regla del usuario (30-sep-2026): las páginas de tienda publican el precio CON IVA salvo que digan lo contrario; las cotizaciones formales traen su IVA explícito
    // y NO se suponen. Si el Lector vio "neto" pero sin frase válida, tampoco se supone: queda pendiente de confirmar.
    if (esWeb && iva === 'no_declarado' && c.iva !== 'neto') { iva = 'incluido'; ivaSupuesto = true; }
    const plazoTexto = c.plazo_entrega || '';
    const nombre = [d.tipo, d.marca, d.modelo, d.version].filter(Boolean).join(' ').trim() || d.sku_proveedor || `Producto ${idx + 1}`;
    return {
      idx,
      esCargo: ES_CARGO.test(nombre) && !d.modelo,
      nombre,
      tipo: d.tipo || '', marca: d.marca || '', modelo: d.modelo || '', version: d.version || '',
      sku: d.sku_fabricante || d.sku_proveedor || '',
      precio, preciosMultiples: otros, precioAmbiguo: ambiguo,
      moneda: (c.moneda || 'CLP').toUpperCase().replace(/^\$$/, 'CLP').replace(/PESOS?/, 'CLP'),
      iva, ivaSupuesto, ivaTexto: c.iva_texto_literal || '',
      unidadPrecio: c.unidad_precio || '', contenidoEmpaque: c.contenido_empaque || '',
      unidadesPorEmpaque: parsearMonto(c.unidades_por_empaque),
      cantidadCotizada: parsearMonto(cantTexto) ?? cantidadCorregida, moq: parsearMonto(c.moq), correccion,
      stock: c.stock || '', plazoTexto, plazoDias: diasDelTexto(plazoTexto), tipoDias: c.tipo_dias || 'no_declarado',
      despacho: c.despacho || '', incoterm: (c.incoterm || '').trim(),
      costosAdicionales: (c.costos_adicionales || []).map(x => ({ detalle: x.detalle || '', monto: parsearMonto(x.monto), texto: x.monto || '' })),
      garantia: c.garantia || '', condiciones,
    };
  });
}

/** Igual que normalizarProductos, sabiendo si la extracción viene de la captura de un link (ahí el IVA sin declarar se asume incluido). */
export function normalizarExtraccion(d: { salida: SalidaLector; texto: string; metodoTexto?: string }): ProductoNormalizado[] {
  return normalizarProductos(d.salida, d.texto, d.metodoTexto === 'captura-web');
}

// ── Emparejar producto de la cotización ↔ línea del costeo ──────────────────────────────────────
const STOP = new Set(['de', 'del', 'la', 'el', 'los', 'las', 'con', 'para', 'por', 'sin', 'una', 'uno', 'y', 'o', 'en', 'al', 'tipo', 'set', 'kit', 'sistema', 'equipo', 'unidad', 'incluye', 'marca', 'modelo']);
function palabras(s: string): string[] {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/(\d)[.,](\d{3})(?!\d)/g, '$1$2').replace(/["”“']/g, ' pulg ').replace(/[^a-z0-9]+/g, ' ').split(' ')
    .filter(w => w.length >= 2 && !STOP.has(w));
}

export interface Emparejamiento { productoIdx: number; filaId: string; puntaje: number; confianza: 'alta' | 'media'; motivos: string[] }

export function puntuar(prod: ProductoNormalizado, linea: LineaCosteo): { puntaje: number; motivos: string[] } {
  const wp = new Set(palabras(`${prod.tipo} ${prod.marca} ${prod.modelo} ${prod.version} ${prod.nombre}`));
  const textoLinea = `${linea.detalle} ${linea.sku}`;
  const wl = new Set(palabras(textoLinea));
  if (wp.size === 0 || wl.size === 0) return { puntaje: 0, motivos: [] };
  const motivos: string[] = [];
  // Cobertura de palabras del producto dentro del detalle de la línea (las líneas son largas, los productos cortos).
  const comunes = [...wp].filter(w => wl.has(w));
  let puntaje = comunes.length / wp.size;
  if (comunes.length) motivos.push(`palabras en común: ${comunes.slice(0, 5).join(', ')}`);
  // Categoría de la línea ("PROYECTOR - Proyector XGA…" → "proyector"): peso extra si el producto es de esa categoría.
  const categoria = palabras(linea.detalle.split(/\s[-–—]\s/)[0] || '');
  if (categoria.length && linea.detalle.includes(' - ')) {
    const frac = categoria.filter(w => wp.has(w)).length / categoria.length;
    if (frac > 0) { puntaje += 0.4 * frac; motivos.push(`categoría: ${categoria.join(' ')}`); }
  }
  // Números (55 vs 70 pulgadas, 9000 BTU): si el producto trae un número y la línea trae OTROS distintos, penaliza.
  const numsP = [...wp].filter(w => /^\d+$/.test(w)), numsL = new Set([...wl].filter(w => /^\d+$/.test(w)));
  const numsCoinciden = numsP.filter(n => numsL.has(n)), numsChocan = numsP.filter(n => !numsL.has(n) && numsL.size > 0);
  if (numsCoinciden.length) { puntaje += 0.25 * numsCoinciden.length; motivos.push(`mismo valor: ${numsCoinciden.join(', ')}`); }
  if (numsChocan.length && !numsCoinciden.length) { puntaje -= 0.3; motivos.push(`número distinto: ${numsChocan.join(', ')}`); }
  // Modelo/SKU escrito en la línea.
  // Un número suelto ("12000" de "12.000 BTUH") no es un modelo: el token debe mezclar letras y dígitos, o coincidiría con cualquier «12,000 horas».
  const tk = tokensDeProducto(prod.modelo, prod.sku).filter(k => /[a-z]/.test(k));
  const tl = textoLinea.toLowerCase().replace(/[^a-z0-9]/g, '');
  if (tk.some(k => tl.includes(k))) { puntaje += 0.5; motivos.push('modelo/SKU coincide'); }
  // Cantidad cotizada = cantidad de la línea.
  if (prod.cantidadCotizada != null && linea.cantidad != null && prod.cantidadCotizada === linea.cantidad) { puntaje += 0.2; motivos.push(`cantidad ${linea.cantidad}`); }
  // Precio en el mismo orden de magnitud que lo costeado.
  const neto = prod.precio != null ? precioNetoUnitario({ precio: prod.precio, iva: prod.iva, moneda: prod.moneda, factor_unidades: prod.unidadesPorEmpaque }).neto : null;
  if (neto != null && linea.costoEstimadoNeto) {
    const r = neto / linea.costoEstimadoNeto;
    if (r > 0.4 && r < 2.5) { puntaje += 0.15; motivos.push('precio en el orden de lo costeado'); }
    else if (r < 0.1 || r > 10) { puntaje -= 0.3; motivos.push('precio fuera de orden de magnitud'); }
  }
  return { puntaje: Math.round(puntaje * 100) / 100, motivos };
}

/** Empareja los productos de UNA cotización con líneas del costeo. Cada línea se usa una vez por documento
 *  (la mejor coincidencia gana); lo que no llega al umbral queda sin emparejar para asignar a mano. */
export function emparejarProductos(productos: ProductoNormalizado[], lineas: LineaCosteo[], umbral = 0.55): { asignaciones: Emparejamiento[]; sinEmparejar: number[] } {
  const candidatos: Emparejamiento[] = [];
  for (const p of productos.filter(x => !x.esCargo)) for (const l of lineas) {
    const { puntaje, motivos } = puntuar(p, l);
    if (puntaje >= umbral) candidatos.push({ productoIdx: p.idx, filaId: l.id, puntaje, confianza: puntaje >= 0.9 ? 'alta' : 'media', motivos });
  }
  candidatos.sort((a, b) => b.puntaje - a.puntaje);
  const productosUsados = new Set<number>(), lineasUsadas = new Set<string>(), asignaciones: Emparejamiento[] = [];
  for (const c of candidatos) {
    if (productosUsados.has(c.productoIdx) || lineasUsadas.has(c.filaId)) continue;
    productosUsados.add(c.productoIdx); lineasUsadas.add(c.filaId); asignaciones.push(c);
  }
  return { asignaciones, sinEmparejar: productos.filter(p => !p.esCargo && !productosUsados.has(p.idx)).map(p => p.idx) };
}

// ── Verificación de UNA opción por código ────────────────────────────────────────────────────────
export interface EntradaVerificacion {
  linea: LineaCosteo;
  lineasProyecto: LineaCosteo[];
  producto: ProductoNormalizado | null;            // null = la opción no tiene respaldo con precio
  documento: SalidaLector['documento'] | null;
  proveedor: SalidaLector['proveedor'] | null;
  opcion: { marca: string | null; modelo: string | null };
  hoyISO: string;
  /** Solo si el respaldo que sostiene el costo es un link: cómo lo encontró la última captura del sistema. */
  estadoLink?: 'activo' | 'caido' | 'redirige' | 'login' | 'precio_variable_region' | null;
  /** Fecha de la captura del link (un link no tiene vigencia: su precio vale a esa fecha). */
  capturadoAt?: string | null;
  /** Suma de los costos asociados activos (estimados por el asistente): entran al margen de R1/R2. */
  costosAsociadosNeto?: number;
  /** Dólar observado BCCh del día + $10 (Ruta B: importación con proforma en USD). */
  dolar?: { usado: number | null; fecha: string | null } | null;
}
export type OrigenDato = 'RESPALDO_FORMAL' | 'RESPALDO_INFORMAL';
export interface ResultadoVerificacion {
  veredicto: Veredicto;
  bloqueos: Bloqueo[];
  alertas: Alerta[];
  costoNetoUnitario: number | null;
  costeadoNeto: number | null;
  diffMonto: number | null; diffPct: number | null; direccion: 'MAS_CARO' | 'MAS_BARATO' | 'IGUAL' | null;
  margen: MargenProyecto | null;
  origenDato: OrigenDato | null;
  requiereHabilitacion: boolean;
  faltantesProveedor: string[];
}

const CAMPOS_PROVEEDOR: Array<[keyof NonNullable<SalidaLector['proveedor']>, string]> = [
  ['razon_social', 'razón social'], ['rut', 'RUT'], ['giro', 'giro'], ['direccion', 'dirección'], ['comuna', 'comuna'],
  ['region', 'región'], ['vendedor', 'vendedor'], ['telefono', 'teléfono'], ['email', 'correo'], ['condiciones_pago', 'condiciones de pago'],
];
export function faltantesProveedor(prov: SalidaLector['proveedor'] | null | undefined): string[] {
  const p: any = prov || {};
  const f = CAMPOS_PROVEEDOR.filter(([k]) => !(p[k]?.valor || '').trim()).map(([, n]) => n);
  if (!(p.transferencia?.numero_cuenta || '').trim()) f.push('cuenta bancaria');
  return f;
}

const r1 = (n: number) => Math.round(n * 10) / 10;

/** Los COSTOS ASOCIADOS (capacitación, instalación, despacho a región…) suben el costo total del proyecto sin llevar
 *  margen propio (spec §8.3): bajan el margen REAL. Se suman al costo base y al final por igual, así R1 (caída vs el
 *  costeo) no se altera por ellos y R2 (piso del 20%) sí los considera. */
export function margenConAsociados(m: MargenProyecto, asociadosNeto: number): MargenProyecto {
  if (!asociadosNeto || asociadosNeto <= 0 || m.ventaNeta <= 0) return m;
  const mb = (1 - (m.costoBase + asociadosNeto) / m.ventaNeta) * 100, mf = (1 - (m.costoFinal + asociadosNeto) / m.ventaNeta) * 100;
  const caida = mb - mf;
  return {
    ...m, costoBase: Math.round(m.costoBase + asociadosNeto), costoFinal: Math.round(m.costoFinal + asociadosNeto),
    margenBase: r1(mb), margenFinal: r1(mf), caidaPuntos: r1(caida),
    r1: caida >= PARAMS.caidaMargenBloqueo - 1e-9, r2: mf < PARAMS.margenMinimo,
  };
}

/** Margen total del proyecto reemplazando el costo de cada línea que ya tiene opción definitiva por su
 *  costo verificado (misma fórmula del "% Margen" del costeo) y sumando los costos asociados. */
export function margenProyectoConOpciones(lineas: LineaCosteo[], verificados: Array<{ filaId: string; neto: number }>, asociadosNeto = 0): MargenProyecto {
  const m: Record<string, number> = {};
  for (const v of verificados) m[v.filaId] = v.neto;
  return margenConAsociados(margenProyecto(lineas, m), asociadosNeto);
}

// ── Avance parcial a PRE-POSTULACIÓN (spec §11.4) ────────────────────────────────────────────────
export interface EntradaAvance {
  modalidad: string | null;                                   // 'suma_alzada' = licitación GLOBAL
  lineas: Array<{ filaId: string; item: number; noOfertada: boolean; tieneAprobada: boolean }>;
}
export interface ResultadoAvance { puede: boolean; mensaje: string; ofertadas: number; aprobadas: number; sinResolver: number[]; noOfertadas: number[] }
export function evaluarAvance(e: EntradaAvance): ResultadoAvance {
  const ofertadas = e.lineas.filter(l => !l.noOfertada);
  const sinResolver = ofertadas.filter(l => !l.tieneAprobada).map(l => l.item);
  const noOfertadas = e.lineas.filter(l => l.noOfertada).map(l => l.item);
  const base = { ofertadas: ofertadas.length, aprobadas: ofertadas.length - sinResolver.length, sinResolver, noOfertadas };
  if (ofertadas.length === 0) return { ...base, puede: false, mensaje: 'No hay ninguna línea ofertada.' };
  if (e.modalidad === 'suma_alzada' && noOfertadas.length > 0)
    return { ...base, puede: false, mensaje: `Esta licitación exige ofertar todas las líneas (es GLOBAL): ${noOfertadas.length === 1 ? 'la línea' : 'las líneas'} ${noOfertadas.join(', ')} no se puede${noOfertadas.length === 1 ? '' : 'n'} dejar fuera.` };
  if (sinResolver.length > 0)
    return { ...base, puede: false, mensaje: `Faltan líneas sin opción aprobada: ${sinResolver.join(', ')}. Apruébalas o márcalas como NO OFERTADA (con motivo).` };
  return { ...base, puede: true, mensaje: noOfertadas.length ? `Listo para PRE-POSTULACIÓN con ${ofertadas.length} línea${ofertadas.length === 1 ? '' : 's'} (no ofertada${noOfertadas.length === 1 ? '' : 's'}: ${noOfertadas.join(', ')}).` : 'Todas las líneas tienen su opción aprobada.' };
}

export function verificarOpcion(e: EntradaVerificacion): ResultadoVerificacion {
  const { linea, producto: p } = e;
  const bloqueos: Bloqueo[] = [], alertas: Alerta[] = [];
  const costeadoNeto = linea.costoRegistradoNeto;
  const base: ResultadoVerificacion = {
    veredicto: 'SIN_RESPALDO', bloqueos, alertas, costoNetoUnitario: null, costeadoNeto,
    diffMonto: null, diffPct: null, direccion: null, margen: null, origenDato: null, requiereHabilitacion: false,
    faltantesProveedor: faltantesProveedor(e.proveedor),
  };

  // Un link que no carga, que redirige a otro producto o que pide iniciar sesión NO es respaldo (Prompt 5 Parte III).
  if (e.estadoLink === 'caido' || e.estadoLink === 'redirige' || e.estadoLink === 'login') {
    const motivo = { caido: 'no carga o el producto ya no existe', redirige: 'redirige a otro producto o a un listado', login: 'pide iniciar sesión' }[e.estadoLink];
    bloqueos.push({ codigo: 'SIN_RESPALDO', mensaje: `El link ${motivo}: no sirve como respaldo del costo.`, salida: 'Reemplaza el link por el de la ficha del producto, o pide la cotización formal al proveedor.', accion: 'subir' });
    return base;
  }
  if (!p || p.precio == null) {
    bloqueos.push({ codigo: 'SIN_RESPALDO', mensaje: 'La opción no tiene un respaldo con precio legible.', salida: 'Sube la cotización (o un link) de este producto, o reemplaza el documento si no se pudo leer.', accion: 'subir' });
    return base;
  }
  if (e.estadoLink === 'precio_variable_region') alertas.push({ codigo: 'V5', nivel: 'amarillo', mensaje: 'El precio del link cambia según la región o comuna: confirma el valor con despacho a Talagante.', accion: 'pedir_proveedor' });

  // ── V1 identidad ──
  const marcaOpc = (e.opcion.marca || '').trim().toLowerCase(), modeloOpc = (e.opcion.modelo || '').trim().toLowerCase();
  if (!p.marca && !p.modelo && !p.sku) {
    bloqueos.push({ codigo: 'V1', mensaje: 'El respaldo no identifica marca, modelo ni SKU: no se puede verificar que sea el producto que se evalúa.', salida: 'Pide al proveedor la cotización con marca y modelo (o el SKU del fabricante).', accion: 'pedir_proveedor' });
  } else if ((marcaOpc && p.marca && marcaOpc !== p.marca.trim().toLowerCase()) || (modeloOpc && p.modelo && modeloOpc !== p.modelo.trim().toLowerCase())) {
    bloqueos.push({ codigo: 'V1', mensaje: `El respaldo es de otro producto (${[p.marca, p.modelo].filter(Boolean).join(' ')}) que el de la opción (${[e.opcion.marca, e.opcion.modelo].filter(Boolean).join(' ')}).`, salida: 'Corrige la opción o crea una opción nueva con este producto (evento producto_cambiado).', accion: 'corregir_costeo' });
  }

  // ── V3 IVA y moneda ──
  const moneda = p.moneda || 'CLP';
  // RUTA B (importación): proforma en USD. El costo lo calcula el SISTEMA: FOB × (dólar observado del día + $10) × 1,06 × 1,3 (queda neto).
  const esRutaB = moneda === 'USD' && e.documento?.tipo === 'proforma_importacion';
  let netoRutaB: number | null = null;
  if (esRutaB) {
    if ((p.incoterm || '').toUpperCase() !== 'FOB') {
      bloqueos.push({ codigo: 'V3', mensaje: `El Incoterm de la proforma es ${p.incoterm || 'no declarado'}: la fórmula de importación asume precio FOB.`, salida: 'Pide al proveedor el precio FOB, o que un humano decida cómo costear este Incoterm.', accion: 'pedir_proveedor' });
    } else if (!e.dolar?.usado) {
      bloqueos.push({ codigo: 'V3', mensaje: 'No se pudo obtener el dólar observado del día para calcular la importación.', salida: 'Reintenta en unos minutos o costea a mano con el dólar del día.', accion: 'corregir_costeo' });
    } else {
      netoRutaB = costoRutaB(p.precio, e.dolar.usado).neto;
      alertas.push({ codigo: 'V3', nivel: 'info', mensaje: `Ruta B: US$${p.precio.toLocaleString('es-CL')} FOB × dólar $${e.dolar.usado.toLocaleString('es-CL')} (observado + $10${e.dolar.fecha ? `, ${e.dolar.fecha}` : ''}) × 1,06 × 1,3 = $${netoRutaB.toLocaleString('es-CL')} neto.`, accion: 'revisar' });
    }
    if (p.moq != null && linea.cantidad != null && p.moq > linea.cantidad) alertas.push({ codigo: 'V2', nivel: 'rojo', mensaje: `El MOQ del proveedor (${p.moq}) es mayor que nuestra cantidad (${linea.cantidad}).`, accion: 'pedir_proveedor' });
  } else if (moneda !== 'CLP') {
    bloqueos.push({ codigo: 'V3', mensaje: `El precio está en ${moneda}, no en CLP.`, salida: 'Convierte el costo a CLP con el tipo de cambio del día (o costea por Ruta B si es importación con proforma en USD).', accion: 'corregir_costeo' });
  } else if (p.iva === 'no_declarado') {
    bloqueos.push({ codigo: 'V3', mensaje: 'El respaldo no dice si el precio incluye IVA (no se supone).', salida: 'Pregunta al proveedor si el precio es neto o con IVA incluido.', accion: 'pedir_proveedor' });
  }

  // ── V2 unidad y cantidad ──
  if (p.moq != null && linea.cantidad != null && p.moq > linea.cantidad) {
    bloqueos.push({ codigo: 'V2', mensaje: `El proveedor exige un mínimo de compra de ${p.moq} y la licitación pide ${linea.cantidad}.`, salida: 'Confirma con el proveedor si vende la cantidad pedida o busca otra opción.', accion: 'pedir_proveedor' });
  }
  if (p.cantidadCotizada != null && linea.cantidad != null && p.cantidadCotizada !== linea.cantidad) {
    alertas.push({ codigo: 'V2', nivel: p.cantidadCotizada < linea.cantidad ? 'rojo' : 'amarillo',
      mensaje: `La cotización es por ${p.cantidadCotizada} unidades y la licitación pide ${linea.cantidad}: el precio unitario puede cambiar con otra cantidad.`, accion: 'pedir_proveedor' });
  }
  const pareceEmpaque = /(caja|pack|pack\.|docena|set|kit|rollo|bolsa|display)/i.test(p.contenidoEmpaque + ' ' + p.unidadPrecio);
  if (pareceEmpaque && !(p.unidadesPorEmpaque && p.unidadesPorEmpaque >= 1)) {
    alertas.push({ codigo: 'V2', nivel: 'amarillo', mensaje: `El precio parece ser por "${(p.contenidoEmpaque || p.unidadPrecio).trim()}": confirma cuántas unidades trae para calcular el costo unitario.`, accion: 'pedir_proveedor' });
  }

  // ── V4 precio (regla por impacto en el margen) ──
  const norm = precioNetoUnitario({ precio: p.precio, iva: p.iva, moneda: p.moneda, factor_unidades: p.unidadesPorEmpaque });
  const neto = esRutaB ? netoRutaB : norm.neto;
  if (p.ivaSupuesto && !esRutaB && norm.neto != null) {
    alertas.push({ codigo: 'V3', nivel: 'info', mensaje: `Precio del link $${p.precio.toLocaleString('es-CL')}: la página no dice si incluye IVA y las tiendas publican con IVA, así que se asumió CON IVA y se le sacó → neto $${norm.neto.toLocaleString('es-CL')}.`, accion: 'revisar' });
  }
  // Un precio AMBIGUO (¿1.022.000 o 1.022? ¿miles o decimales?) no se usa para nada: ni costo, ni diferencia, ni margen. Si entrara,
  // una mala lectura hunde el margen del proyecto entero (caso real: un proyector leído a $840 millones). Se bloquea y pide confirmarlo.
  if (p.precioAmbiguo) {
    bloqueos.push({ codigo: 'LECTURA', mensaje: 'El precio del documento es ambiguo (no se sabe si el punto o la coma separan miles o decimales): no se usa para calcular el costo ni el margen.',
      salida: 'Compara el precio contra el documento original, o pide al proveedor la cotización con el precio claro.', accion: 'revisar' });
  } else base.costoNetoUnitario = neto;
  if (!p.precioAmbiguo && neto != null && costeadoNeto != null && costeadoNeto > 0) {
    base.diffMonto = neto - costeadoNeto; base.diffPct = r1((base.diffMonto / costeadoNeto) * 100);
    base.direccion = Math.abs(base.diffPct) < 0.5 ? 'IGUAL' : base.diffMonto > 0 ? 'MAS_CARO' : 'MAS_BARATO';
    base.margen = margenConAsociados(margenProyecto(e.lineasProyecto, { [linea.id]: neto }), e.costosAsociadosNeto || 0);
    if (base.direccion === 'MAS_CARO') {
      const m = base.margen;
      const detalle = m.margenBase != null && m.margenFinal != null ? ` Margen del proyecto: ${m.margenBase}% → ${m.margenFinal}% (${m.caidaPuntos != null ? `−${m.caidaPuntos}` : '?'} pts).` : '';
      if (m.r1 || m.r2) {
        bloqueos.push({ codigo: 'V4', mensaje: `Alza importante: el respaldo cuesta ${base.diffPct}% más que lo costeado (+$${Math.round(base.diffMonto).toLocaleString('es-CL')} por unidad).${detalle} ${m.r2 ? 'Queda bajo el 20% (regla dura).' : 'Cae 2 puntos o más (R1).'}`,
          salida: 'Actualiza el costo, pide otra cotización o busca otro proveedor; con el precio de venta vigente la oferta pierde demasiado margen.', accion: 'corregir_costeo' });
      } else {
        alertas.push({ codigo: 'V4', nivel: 'amarillo', mensaje: `El respaldo cuesta ${base.diffPct}% más que lo costeado (+$${Math.round(base.diffMonto).toLocaleString('es-CL')} por unidad), sin comprometer el margen.${detalle}`, accion: 'corregir_costeo' });
      }
    } else if (base.direccion === 'MAS_BARATO') {
      alertas.push({ codigo: 'V4', nivel: 'info', mensaje: `El respaldo cuesta ${Math.abs(base.diffPct)}% menos que lo costeado: quizá se sobrecosteó.`, accion: 'corregir_costeo' });
    }
  }
  if (p.correccion) alertas.push({ codigo: 'LECTURA', nivel: 'amarillo', mensaje: p.correccion, accion: 'revisar' });
  if (p.preciosMultiples.length) alertas.push({ codigo: 'V5', nivel: 'amarillo', mensaje: `El documento muestra otros precios para este producto (${p.preciosMultiples.slice(0, 3).join(' · ')}): confirma cuál rige.`, accion: 'revisar' });

  // ── V5 costos ocultos (los que el documento cobra aparte) ──
  for (const c of p.costosAdicionales) {
    alertas.push({ codigo: 'V5', nivel: 'amarillo', mensaje: `Costo aparte en el documento: ${c.detalle || 'cargo adicional'}${c.texto ? ` (${c.texto})` : ''}. Suma al costo real de compra.`, accion: 'corregir_costeo' });
  }
  if (/no incluye (flete|despacho)|despacho no incluido|flete aparte/i.test(p.despacho)) alertas.push({ codigo: 'V5', nivel: 'amarillo', mensaje: `Despacho: "${p.despacho}". Verifica que el flete esté en el costeo.`, accion: 'corregir_costeo' });

  // ── V6 stock (informativo, nunca bloquea) ──
  if (/sin\s+stock|agotad/i.test(p.stock)) alertas.push({ codigo: 'V6', nivel: 'rojo', mensaje: `Stock: "${p.stock}". VALIDAR STOCK CON EL PROVEEDOR (no bloquea).`, accion: 'pedir_proveedor' });

  // ── V7 vigencia (informativo) ──
  const emision = fechaISO(e.documento?.fecha_emision), vigTexto = e.documento?.vigencia || '';
  if (e.documento?.tipo === 'link_web') {
    alertas.push({ codigo: 'V7', nivel: 'info', mensaje: `Es un link: su precio vale a la fecha de la captura${e.capturadoAt ? ` (${e.capturadoAt.slice(0, 16).replace('T', ' ')})` : ''}. Pide la cotización formal para congelarlo.`, accion: 'pedir_proveedor' });
  } else if (emision) {
    const dias = diasDelTexto(vigTexto), fin = fechaISO(vigTexto) || (dias != null ? sumarDias(emision, dias) : null);
    if (fin && fin < e.hoyISO) alertas.push({ codigo: 'V7', nivel: 'rojo', mensaje: `La cotización venció el ${fin} (emitida el ${emision}): REVALIDAR PRECIO.`, accion: 'pedir_proveedor' });
    else if (!fin) {
      const meses = mesesEntre(emision, e.hoyISO);
      if (meses != null && meses > PARAMS.vigenciaSinDeclararMeses) alertas.push({ codigo: 'V7', nivel: 'amarillo', mensaje: `Cotización de hace ${Math.round(meses)} meses y sin vigencia declarada: REVALIDAR PRECIO.`, accion: 'pedir_proveedor' });
    }
  } else {
    alertas.push({ codigo: 'V7', nivel: 'info', mensaje: 'El documento no trae fecha de emisión: no se puede medir la vigencia.', accion: 'revisar' });
  }

  // ── V11 datos del proveedor (solo alerta) ──
  if (base.faltantesProveedor.length) alertas.push({ codigo: 'V11', nivel: 'info', mensaje: `Faltan datos del proveedor para crearlo en OBUMA: ${base.faltantesProveedor.join(', ')}.`, accion: 'pedir_proveedor' });

  // ── Origen del dato y veredicto ──
  base.origenDato = e.documento?.formalidad === 'informal' ? 'RESPALDO_INFORMAL' : 'RESPALDO_FORMAL';
  base.requiereHabilitacion = base.origenDato === 'RESPALDO_INFORMAL';
  if (e.documento?.legibilidad === 'parcial') alertas.push({ codigo: 'LECTURA', nivel: 'amarillo', mensaje: `Documento leído parcialmente${e.documento.no_legible_detalle ? `: ${e.documento.no_legible_detalle}` : ''}.`, accion: 'revisar' });

  if (bloqueos.length) base.veredicto = 'NO_VERIFICADO';
  else if (base.requiereHabilitacion) base.veredicto = 'REQUIERE_HABILITACION';
  else if (alertas.some(a => a.nivel !== 'info')) base.veredicto = 'VERIFICADO_CON_ALERTAS';
  else base.veredicto = 'VERIFICADO';
  return base;
}

// ── Identidad ficha ↔ opción (Prompt 4 v2.0 Parte III ②) ────────────────────────────────────────────
// ¿La ficha que se sube a una opción es del MISMO producto? Compara marca, modelo y SKU sin distinguir mayúsculas, tildes ni
// separadores ("LS-150" = "LS150"). Un modelo contenido en el otro ("EOS Rebel T7" ⊂ "Canon EOS Rebel T7 Kit") cuenta como el mismo.
export type CoincidenciaProducto = 'coincide' | 'distinto' | 'sin_dato';
const idNorm = (v: string | null | undefined) => (v || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '');
const mismoOContiene = (a: string, b: string) => a === b || (Math.min(a.length, b.length) >= 3 && (a.includes(b) || b.includes(a)));

export function coincidenciaIdentidad(
  opcion: { marca?: string | null; modelo?: string | null; sku?: string | null },
  ficha: { marca?: string | null; modelo?: string | null; sku?: string | null },
): CoincidenciaProducto {
  const oMarca = idNorm(opcion.marca), oModelo = idNorm(opcion.modelo), oSku = idNorm(opcion.sku);
  const fMarca = idNorm(ficha.marca), fModelo = idNorm(ficha.modelo), fSku = idNorm(ficha.sku);
  if (!oMarca && !oModelo && !oSku) return 'sin_dato';
  if (!fMarca && !fModelo && !fSku) return 'sin_dato';
  if (oMarca && fMarca && !mismoOContiene(oMarca, fMarca)) return 'distinto';
  if (oModelo && fModelo) return mismoOContiene(oModelo, fModelo) ? 'coincide' : 'distinto';
  if (oSku && fSku) return oSku === fSku ? 'coincide' : 'distinto';
  return 'sin_dato';
}

// ── Re-análisis de un documento: ¿qué producto de la lectura nueva es el que ya estaba en una opción? ──
const nombreNorm = (v: string) => v.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/(\d)[.,](\d{3})(?!\d)/g, '$1$2').replace(/[^a-z0-9]+/g, ' ').trim().split(' ').filter(Boolean).sort().join(' ');
/** Devuelve el idx del producto NUEVO que corresponde al VIEJO (mismo nombre, o mismo modelo/SKU con la misma marca), o null si no hay equivalente. */
export function emparejarProductoReleido(viejo: Pick<ProductoNormalizado, 'nombre' | 'marca' | 'modelo' | 'sku'>, nuevos: Array<Pick<ProductoNormalizado, 'idx' | 'nombre' | 'marca' | 'modelo' | 'sku'>>): number | null {
  const n = nombreNorm(viejo.nombre);
  if (n) { const igual = nuevos.find(x => nombreNorm(x.nombre) === n); if (igual) return igual.idx; }
  if (viejo.modelo || viejo.sku) {
    const cand = nuevos.filter(x => coincidenciaIdentidad(viejo, x) === 'coincide');
    if (cand.length === 1) return cand[0].idx;
  }
  return null;
}
