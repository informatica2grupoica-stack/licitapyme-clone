// app/lib/auditor-compras-core.ts
// AUDITOR DE COMPRAS · VERIFICADOR DE COTIZACIONES (PROMPT 5 v1.2) — la parte que decide el CÓDIGO.
// Regla del prompt (0.3): "la aritmética y la navegación no se delegan al modelo. El modelo lee,
// extrae, compara y explica. El sistema navega, calcula y bloquea." Este archivo es puro (sin base de
// datos ni red) para poder probarlo entero: normalización de precios, regla por impacto en el margen
// (V4: R1/R2), dispersión y comparador (V10-b/c), fórmula de importación (Ruta B), guardarraíles sobre
// lo que dijo el modelo, veredicto de la línea + matriz de bloqueo (Parte VIII) y posición de precio
// del proyecto (Parte IX).
import type { EstadoCosteoEditor, FilaEditorCosteo } from '@/app/lib/costeo-editor';
import { calcularFormulas, margenDeFila, MARGEN_VENTA_DEFECTO } from '@/app/lib/costeo-editor';

// ── Parámetros (0.6) ────────────────────────────────────────────────────────────────────────────
export const PARAMS = {
  umbralDispersion: 0.40,            // sobre la mediana de las referencias del mismo producto
  vigenciaSinDeclararMeses: 5,
  historicoAntiguoMeses: 12,
  umbralJustificacionAhorro: 0.05,   // referencia más barata que obliga a justificar
  minDatosMercadoPublico: 3,         // OC mínimas para no marcar "dato débil"
  margenMinimo: 20,                  // % REGLA DURA
  caidaMargenBloqueo: 2,             // puntos porcentuales (R1)
  logisticaInternaDias: 2,           // Talagante, estimado (dato de contexto F)
} as const;

export const IVA = 1.19;
const r0 = (n: number) => Math.round(n);
const r1 = (n: number) => Math.round(n * 10) / 10;
const r2 = (n: number) => Math.round(n * 100) / 100;

// ── Tipos de lo que devuelve el modelo (PARTE X + adenda) ────────────────────────────────────────
export type IvaRespaldo = 'incluido' | 'neto' | 'no_declarado';
export interface OpcionComparador {
  opcion: string; origen: 'asistente' | 'auditor'; id_respaldo?: string | null;
  precio: number | null; iva: IvaRespaldo; moneda?: string; factor_unidades?: number | null;
  despacho?: string; despacho_monto_neto_clp_total?: number | null;
  stock?: string; plazo?: string; tipo_respaldo?: string; vende_al_estado?: boolean; alertas?: string[];
  url?: string; cita?: string;
}
export interface SalidaModelo {
  linea?: number; ruta?: 'A' | 'B';
  respaldos?: Array<{
    id?: string; tipo?: string; archivo_o_url?: string; captura_id?: string;
    emisor?: { razon_social?: string; rut?: string; vendedor?: string };
    fecha?: string; vigencia?: string; estado_link?: string; legibilidad?: 'completa' | 'parcial' | 'nula';
    no_legible_detalle?: string; sostiene_costo?: boolean;
  }>;
  conflicto_respaldos?: { existe?: boolean; versiones?: Array<{ respaldo?: string; valor?: string; cita?: string }> };
  verificaciones?: {
    V1_identidad?: { estado?: string; marca_respaldo?: string; modelo_respaldo?: string; sku_fabricante?: string; accesorios_exigidos_no_costeados?: string[]; cita?: string };
    V2_unidad?: { estado?: string; precio_respaldo?: number | null; unidad_respaldo?: string; contenido_empaque?: string; unidad_licitacion?: string; cantidad_costeo?: number | null; cantidad_licitacion?: number | null; minimo_compra?: string; cita?: string; factor_unidades?: number | null };
    V3_iva_moneda?: { estado?: string; iva_respaldo?: IvaRespaldo; moneda?: string; cita?: string };
    V4_precio?: { precio_extraido?: number | null; unidad?: string; iva?: string; cita?: string };
    V5_costos_ocultos?: Array<{ tipo?: string; detalle?: string; monto?: string; cita?: string; monto_neto_clp_total?: number | null }>;
    V6_stock?: { estado?: string; unidades_visibles?: string; cita?: string };
    V7_vigencia?: { estado?: string; fecha_emision?: string; vigencia_declarada?: string; moneda_cotizacion?: string };
    V8_plazo?: { plazo_proveedor?: string; tipo_dias?: 'habiles' | 'corridos' | 'no_declarado'; cita?: string; plazo_proveedor_dias?: number | null };
    V9_proveedor_mp?: { vende_al_estado?: boolean; alerta_competidor?: boolean; evidencia?: string; precios_adjudicados?: Array<{ precio?: number; fecha?: string; organismo?: string; oc?: string }> };
    V10_referencias?: {
      consultas_propuestas?: string[];
      referencias?: Array<{ proveedor?: string; precio?: number | null; unidad?: string; iva?: string; stock?: string; despacho?: string; url?: string; fecha?: string; mismo_producto?: boolean; factor_unidades?: number | null; despacho_monto_neto_clp_total?: number | null }>;
      descartadas_no_mismo_producto?: Array<{ url?: string; motivo?: string }>; sin_referencias?: boolean;
    };
    V10b_discordancia?: { activa?: boolean; fuente_discordante?: string; es_la_del_asistente?: boolean; causa_probable?: string; evidencia?: string; referencias_adicionales?: Array<{ proveedor?: string; precio?: number; url?: string }> };
    V10c_comparador?: OpcionComparador[];
    V11_datos_oc?: { faltantes?: string[]; disponibles_en_respaldo?: Array<{ campo?: string; valor?: string }> };
  };
  ruta_b?: {
    proveedor?: string; pais?: string; fecha?: string; vigencia?: string; precio_unitario?: number | null; moneda?: string; incoterm?: string;
    cantidad_cotizada?: number | null; moq?: number | null; plazo_fabricacion?: string; condiciones_pago?: string; alertas?: string[]; cita?: string;
  };
  origen_dato?: 'RESPALDO_FORMAL' | 'RESPALDO_INFORMAL' | 'HISTORICO_INTERNO' | 'DECLARADO' | 'NO_LEGIBLE';
  ayuda?: { diagnostico?: string; causa_probable?: string; pregunta_proveedor?: string; accion_concreta?: string; datos_para_impacto?: string };
  no_pude_leer?: Array<{ respaldo?: string; que?: string; donde?: string }>;
}

// ── Normalización de números leídos de páginas chilenas ───────────────────────────────────────────
/** Todos los números que aparecen en un texto, ya interpretados ("4.390.000" → 4390000; "1.234,56" →
 *  1234.56; "12,5" → 12.5). Sirve para comprobar que un precio que el modelo dice haber leído
 *  ESTÁ de verdad en el respaldo. */
export function numerosDelTexto(texto: string): number[] {
  const out: number[] = [];
  for (const m of texto.matchAll(/\d[\d.,]*\d|\d/g)) {
    const s = m[0];
    const puntos = (s.match(/\./g) || []).length, comas = (s.match(/,/g) || []).length;
    let n: number;
    if (puntos && comas) {
      const decimal = s.lastIndexOf('.') > s.lastIndexOf(',') ? '.' : ',';
      n = Number(s.split(decimal === '.' ? ',' : '.').join('').replace(decimal, '.'));
    } else if (puntos + comas > 1) {
      // varios separadores iguales: son de miles ("4.390.000")
      n = Number(s.replace(/[.,]/g, ''));
    } else if (puntos + comas === 1) {
      const sep = puntos ? '.' : ',';
      const dec = s.length - s.indexOf(sep) - 1;
      // exactamente 3 dígitos tras el separador = miles ("4.390"); si no, decimal ("12,5")
      n = dec === 3 ? Number(s.replace(sep, '')) : Number(s.replace(sep, '.'));
      if (dec === 3) { const alt = Number(s.replace(sep, '.')); if (Number.isFinite(alt)) out.push(alt); }
    } else n = Number(s);
    if (Number.isFinite(n)) out.push(n);
  }
  return out;
}

/** ¿El precio aparece literalmente (como número) en el texto del respaldo? */
export function precioEnTexto(texto: string, precio: number | null | undefined): boolean {
  if (precio == null || !Number.isFinite(precio) || precio <= 0) return false;
  const tol = precio >= 1000 ? 0.5 : 0.011;
  return numerosDelTexto(texto).some(n => Math.abs(n - precio) <= tol);
}

function soloPalabras(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}
/** Cita literal: ≥ 2 palabras y ≥ 8 caracteres, y aparece tal cual en el texto (mismo criterio que el
 *  auditor de cotizaciones de 21-sep). */
export function citaExiste(texto: string, cita: string | null | undefined): boolean {
  if (!cita) return false;
  const c = soloPalabras(cita);
  if (c.split(' ').length < 2 || c.length < 8) return false;
  return soloPalabras(texto).includes(c);
}

/** Tokens que identifican el producto (modelo / SKU del fabricante). Un token es "modelo-like" si mezcla
 *  letras y dígitos ("tt655s", "hds8184c") o es largo con dígitos; los modelos partidos por espacios o guiones
 *  ("HDS 8/18-4 C") se reconstruyen pegando el fragmento numérico con sus vecinos cortos. */
export function tokensDeProducto(...textos: Array<string | null | undefined>): string[] {
  const set = new Set<string>();
  const compacto = (x: string) => x.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');
  for (const t of textos) {
    const trozos = (t || '').split(/\s+/).filter(Boolean);
    trozos.forEach((trozo, i) => {
      const c = compacto(trozo);
      if (!/\d/.test(c)) return;
      if (c.length >= 3 && (/[a-z]/.test(c) || c.length >= 5)) set.add(c);
      const prev = i > 0 ? compacto(trozos[i - 1]) : '', next = i < trozos.length - 1 ? compacto(trozos[i + 1]) : '';
      const cortoAlfa = (x: string) => x.length >= 1 && x.length <= 4 && /^[a-z]+$/.test(x);
      const combos = [cortoAlfa(prev) ? prev + c : '', cortoAlfa(next) ? c + next : '', cortoAlfa(prev) && cortoAlfa(next) ? prev + c + next : ''];
      for (const k of combos) if (k.length >= 5) set.add(k);
    });
  }
  return [...set];
}
/** ¿El título de una referencia o de un histórico corresponde al MISMO producto? Regla dura del prompt
 *  (V10): mismo modelo/SKU del fabricante. Sin token de modelo NO se puede afirmar. */
export function mismoProductoPorTokens(titulo: string, tokens: string[]): boolean {
  if (tokens.length === 0) return false;
  const t = soloPalabras(titulo).split(' ');
  const compacto = t.join('');
  return tokens.some(k => t.includes(k) || compacto.includes(k));
}

// ── Aritmética de precios (C1) ────────────────────────────────────────────────────────────────────
export function mediana(xs: number[]): number | null {
  const v = xs.filter(x => Number.isFinite(x)).sort((a, b) => a - b);
  if (v.length === 0) return null;
  const m = Math.floor(v.length / 2);
  return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
}

/** Costo unitario NETO (CLP) por unidad de la licitación, a partir de un precio de respaldo. null si
 *  falta algo que no se puede suponer (IVA no declarado, moneda que no es CLP, empaque desconocido). */
export function precioNetoUnitario(
  o: { precio: number | null | undefined; iva: IvaRespaldo | string | undefined; moneda?: string | null; factor_unidades?: number | null },
): { neto: number | null; motivo: string | null } {
  if (o.precio == null || !Number.isFinite(o.precio) || o.precio <= 0) return { neto: null, motivo: 'sin precio' };
  const moneda = (o.moneda || 'CLP').toUpperCase();
  if (moneda !== 'CLP') return { neto: null, motivo: `moneda ${moneda} (no es CLP)` };
  if (o.iva !== 'incluido' && o.iva !== 'neto') return { neto: null, motivo: 'IVA no declarado' };
  const f = o.factor_unidades == null ? 1 : Number(o.factor_unidades);
  if (!Number.isFinite(f) || f <= 0) return { neto: null, motivo: 'empaque desconocido' };
  const neto = (o.iva === 'incluido' ? o.precio / IVA : o.precio) / f;
  return { neto: r0(neto), motivo: null };
}

/** Ruta B: costo = FOB (USD) × (dólar observado BCCh del día + $10) × 1,06 × 1,3 × 1,19. El resultado
 *  de la fórmula queda CON IVA (por el 1,19): se devuelve también normalizado a neto. */
export function costoRutaB(fobUsd: number, dolarMasDiez: number): { conIva: number; neto: number } {
  const conIva = fobUsd * dolarMasDiez * 1.06 * 1.3 * IVA;
  return { conIva: r0(conIva), neto: r0(conIva / IVA) };
}

export interface Dispersion { mediana: number | null; n: number; discordantes: number[]; activa: boolean }
/** V10-b: precios del MISMO producto que se separan de la mediana más de `umbral`. Devuelve los índices
 *  discordantes. No decide cuál está mal (eso lo triangula el modelo con 2-3 referencias más). */
export function dispersion(precios: number[], umbral = PARAMS.umbralDispersion): Dispersion {
  const med = mediana(precios);
  if (med == null || precios.length < 2) return { mediana: med, n: precios.length, discordantes: [], activa: false };
  const discordantes = precios.map((p, i) => (Math.abs(p - med) / med > umbral ? i : -1)).filter(i => i >= 0);
  return { mediana: med, n: precios.length, discordantes, activa: discordantes.length > 0 };
}

// ── Costeo: la línea, el margen y los costos ──────────────────────────────────────────────────────
export interface LineaCosteo {
  id: string; item: number; lineaReal: number | null; grupo: string; detalle: string; unidad: string; sku: string;
  cantidad: number | null; valorConIva: number | null; costoRealUnitario: number | null;
  links: string[]; esGastoExtra: boolean; ofertamos: boolean;
  costoEstimadoNeto: number | null;   // lo que costeó el asistente: valorConIva / 1,19
  costoRegistradoNeto: number | null; // lo que hoy está costeado: el REAL de Compras si lo cargó, si no el estimado
  precioVentaUnitario: number | null; // precio unitario de venta registrado (sin decimales)
}

export function lineasDelCosteo(estado: EstadoCosteoEditor): LineaCosteo[] {
  const general = Number.isFinite(estado.margenVenta) ? estado.margenVenta : MARGEN_VENTA_DEFECTO;
  const out: LineaCosteo[] = [];
  for (const g of estado.grupos || []) {
    for (const f of g.filas || []) {
      if (!f.detalle?.trim() && f.cantidad == null && f.valorConIva == null && f.costoRealUnitario == null) continue;
      const calc = calcularFormulas(f, margenDeFila(f, g, general));
      const est = calc.costoUnitario != null ? r0(calc.costoUnitario) : null;
      out.push({
        id: f.id, item: f.item, lineaReal: f.lineaReal ?? g.linea ?? null, grupo: g.nombre, detalle: f.detalle?.trim() || '',
        unidad: f.unidad || '', sku: f.skuProveedor || '', cantidad: f.cantidad ?? null, valorConIva: f.valorConIva ?? null,
        costoRealUnitario: f.costoRealUnitario ?? null,
        links: [f.link1, f.link2, f.link3].filter(Boolean),
        esGastoExtra: !!f.agregadoPorCompras, ofertamos: g.ofertamos !== false,
        costoEstimadoNeto: f.agregadoPorCompras ? null : est,
        costoRegistradoNeto: f.costoRealUnitario ?? (f.agregadoPorCompras ? null : est),
        precioVentaUnitario: f.agregadoPorCompras ? null : calc.precioUnitarioSinDecimales,
      });
    }
  }
  return out;
}

export interface MargenProyecto {
  ventaNeta: number; costoBase: number; costoFinal: number;
  margenBase: number | null; margenFinal: number | null;   // % sobre la venta (misma fórmula que "% Margen" del cuadro comparativo: 1 − costo/venta)
  caidaPuntos: number | null; r1: boolean; r2: boolean;
}

/** Margen TOTAL del proyecto con el precio de venta registrado. `base` usa el costo que supuso el asistente
 *  (la última versión aprobada del costeo); `final` reemplaza cada línea por su costo verificado (o, si aún no
 *  se audita, por el costo hoy registrado). Las alzas se ACUMULAN porque `final` las suma todas. */
export function margenProyecto(lineas: LineaCosteo[], verificadoNeto: Record<string, number | undefined>): MargenProyecto {
  let venta = 0, base = 0, fin = 0;
  for (const l of lineas) {
    if (l.esGastoExtra || !l.ofertamos || l.cantidad == null || l.precioVentaUnitario == null || l.costoEstimadoNeto == null) continue;
    venta += l.cantidad * l.precioVentaUnitario;
    base += l.cantidad * l.costoEstimadoNeto;
    fin += l.cantidad * (verificadoNeto[l.id] ?? l.costoRegistradoNeto ?? l.costoEstimadoNeto);
  }
  const mb = venta > 0 ? (1 - base / venta) * 100 : null;
  const mf = venta > 0 ? (1 - fin / venta) * 100 : null;
  const caida = mb != null && mf != null ? mb - mf : null;
  return {
    ventaNeta: r0(venta), costoBase: r0(base), costoFinal: r0(fin),
    margenBase: mb != null ? r1(mb) : null, margenFinal: mf != null ? r1(mf) : null,
    caidaPuntos: caida != null ? r1(caida) : null,
    r1: caida != null && caida >= PARAMS.caidaMargenBloqueo - 1e-9,
    r2: mf != null && mf < PARAMS.margenMinimo,
  };
}

// ── Lo que se guarda por línea ────────────────────────────────────────────────────────────────────
export interface OpcionNormalizada extends OpcionComparador {
  neto_unitario: number | null; costo_bodega: number | null; motivo_sin_normalizar: string | null;
}
export interface DatosSistemaLinea {
  dolar: { observado: number | null; usado: number | null; fecha: string | null; fuente: string | null };
  costeadoNeto: number | null;          // lo costeado (registrado) por unidad
  verificadoNeto: number | null;        // costo del respaldo normalizado, puesto en bodega
  respaldoQueSostiene: string | null;
  diffMonto: number | null; diffPct: number | null; direccion: 'MAS_CARO' | 'MAS_BARATO' | 'IGUAL' | null;
  precioNoVerificado: boolean;          // el precio que dijo el modelo no está literalmente en el respaldo
  costosOcultosNeto: number;            // por unidad
  comparador: OpcionNormalizada[];
  refMediana: number | null;
  dispersion: Dispersion | null;
  refMasBaratas: Array<{ opcion: string; neto: number; ahorroPct: number }>;
  rutaB: { fob: number; dolarUsado: number; costoNeto: number; costoConIva: number } | null;
  plazo: { proveedorDias: number | null; logisticaDias: number; totalDias: number | null; diasDisponibles: number | null; holguraDias: number | null } | null;
  guardarrailes: string[];              // lo que el código corrigió o degradó del modelo
  precioMercadoPublico: PrecioMercadoPublico | null;
  antiguedadHistoricoMeses: number | null;
}
export interface PrecioMercadoPublico {
  neto: number | null; n: number; desde: string | null; hasta: string | null; calidad: 'mismo_producto' | 'comparable' | 'sin_datos';
  ocs: Array<{ precio: number; fecha: string | null; organismo: string | null; oc: string | null; proveedor: string | null }>;
}
export interface LineaGuardada {
  fila: { id: string; item: number; lineaReal: number | null; detalle: string; unidad: string; sku: string; cantidad: number | null; grupo: string };
  auditadoAt: string; modeloIA: string; pasada: 'linea' | 'final';
  modelo: SalidaModelo; sistema: DatosSistemaLinea;
  capturas: Array<{ id: number; url: string; estado: string; capturadoAt: string; hayImagen: boolean }>;
  cambiosVsAnterior?: string[];
}

// ── Guardarraíles: el código verifica lo que dice el modelo ───────────────────────────────────────
export interface CorpusRespaldos { texto: string; porRespaldo: Record<string, string> }

/** Aplica sobre la salida del modelo lo que el prompt le prohíbe hacer y solo el código puede garantizar. */
export function aplicarGuardarrailes(
  s: SalidaModelo, corpus: CorpusRespaldos,
  ctx: { tokensProducto: string[]; candidatasBusqueda: Array<{ url: string; nombre: string; precio: number | null; tienda: string }> },
): { salida: SalidaModelo; avisos: string[]; precioNoVerificado: boolean } {
  const avisos: string[] = [];
  const v = s.verificaciones || (s.verificaciones = {});
  let precioNoVerificado = false;

  // 1) El precio extraído debe estar LITERALMENTE en algún respaldo (PROHIBIDO dar por verificado un precio que no leíste).
  const p = v.V4_precio?.precio_extraido;
  if (p != null && p > 0 && !precioEnTexto(corpus.texto, p)) {
    precioNoVerificado = true;
    avisos.push(`El precio ${p} que dijo leer el modelo no aparece en el texto de ningún respaldo: no se da por verificado.`);
  }
  // 2) V1: si hay producto técnico con modelo, ese modelo debe verse en el respaldo para decir "OK".
  if (v.V1_identidad?.estado === 'OK' && ctx.tokensProducto.length > 0) {
    const cabe = ctx.tokensProducto.some(k => soloPalabras(corpus.texto).split(' ').some(w => w === k) || soloPalabras(corpus.texto).replace(/ /g, '').includes(k));
    if (!cabe) {
      v.V1_identidad = { ...v.V1_identidad, estado: 'NO_VERIFICABLE' };
      avisos.push(`V1 degradada a NO_VERIFICABLE: el modelo/SKU (${ctx.tokensProducto.slice(0, 3).join(', ')}) no se ve en el texto de ningún respaldo.`);
    }
  }
  // 3) Referencias de mercado: solo valen las que salieron de la búsqueda real, con SU precio, y que además
  //    calcen con el modelo/SKU del fabricante ("un similar no es referencia").
  const r = v.V10_referencias;
  if (r) {
    const buenas: NonNullable<typeof r.referencias> = [];
    const descartadas = [...(r.descartadas_no_mismo_producto || [])];
    for (const ref of r.referencias || []) {
      const cand = ctx.candidatasBusqueda.find(c => c.url && ref.url && c.url === ref.url);
      if (!cand) { descartadas.push({ url: ref.url, motivo: 'Descartada por el sistema: la URL no salió de la búsqueda real.' }); avisos.push(`Referencia inventada descartada (${ref.url || 'sin url'}).`); continue; }
      if (ref.mismo_producto === false) { descartadas.push({ url: ref.url, motivo: 'El modelo la marcó como distinto producto.' }); continue; }
      if (!mismoProductoPorTokens(cand.nombre, ctx.tokensProducto)) {
        descartadas.push({ url: ref.url, motivo: `Descartada por el sistema: el título "${cand.nombre.slice(0, 80)}" no trae el modelo/SKU del producto.` });
        continue;
      }
      buenas.push({ ...ref, precio: cand.precio, proveedor: ref.proveedor || cand.tienda, mismo_producto: true });
    }
    r.referencias = buenas; r.descartadas_no_mismo_producto = descartadas;
    r.sin_referencias = buenas.length === 0;
  }
  // 4) V10-c: las opciones "del auditor" tienen que ser referencias válidas; se recalcula abajo por código.
  return { salida: s, avisos, precioNoVerificado };
}

// ── Comparador (V10-c) y datos de sistema ─────────────────────────────────────────────────────────
export function normalizarOpciones(opciones: OpcionComparador[], cantidad: number | null): OpcionNormalizada[] {
  return opciones.map(o => {
    const { neto, motivo } = precioNetoUnitario({ precio: o.precio, iva: o.iva, moneda: o.moneda, factor_unidades: o.factor_unidades });
    const despachoUnit = o.despacho_monto_neto_clp_total && cantidad && cantidad > 0 ? o.despacho_monto_neto_clp_total / cantidad : 0;
    return { ...o, neto_unitario: neto, costo_bodega: neto != null ? r0(neto + despachoUnit) : null, motivo_sin_normalizar: motivo };
  });
}

/** Une, por código, las opciones del asistente (las que dijo el modelo) con las referencias válidas del
 *  auditor, todas normalizadas a costo puesto en bodega, ordenadas de menor a mayor. */
export function armarComparador(salida: SalidaModelo, cantidad: number | null): OpcionNormalizada[] {
  const v = salida.verificaciones || {};
  const deAsistente = (v.V10c_comparador || []).filter(o => o.origen === 'asistente');
  const deAuditor: OpcionComparador[] = (v.V10_referencias?.referencias || []).filter(x => x.mismo_producto).map(x => ({
    opcion: x.proveedor || x.url || 'Referencia', origen: 'auditor' as const, precio: x.precio ?? null, iva: (x.iva === 'incluido' || x.iva === 'neto' ? x.iva : 'no_declarado') as IvaRespaldo,
    factor_unidades: x.factor_unidades ?? null, despacho: x.despacho, despacho_monto_neto_clp_total: x.despacho_monto_neto_clp_total ?? null,
    stock: x.stock, tipo_respaldo: 'link web', url: x.url,
  }));
  const todas = normalizarOpciones([...deAsistente, ...deAuditor], cantidad);
  return todas.sort((a, b) => (a.costo_bodega ?? Infinity) - (b.costo_bodega ?? Infinity));
}

export function mesesEntre(desdeISO: string | null | undefined, hoyISO: string): number | null {
  if (!desdeISO) return null;
  const a = new Date(desdeISO.slice(0, 10) + 'T00:00:00Z'), b = new Date(hoyISO.slice(0, 10) + 'T00:00:00Z');
  if (Number.isNaN(a.getTime()) || Number.isNaN(b.getTime())) return null;
  return (b.getTime() - a.getTime()) / (1000 * 60 * 60 * 24 * 30.4375);
}

/** Todo lo numérico de una línea: costo verificado, diferencia, dispersión, comparador, Ruta B, plazo. */
export function calcularSistemaLinea(
  linea: LineaCosteo, salida: SalidaModelo,
  ext: {
    dolar: DatosSistemaLinea['dolar']; guardarrailes: string[]; precioNoVerificado: boolean; diasDisponibles: number | null;
    precioMercadoPublico: PrecioMercadoPublico | null; hoyISO: string; fechaHistorico?: string | null;
  },
): DatosSistemaLinea {
  const v = salida.verificaciones || {};
  const cant = linea.cantidad;
  const comparador = armarComparador(salida, cant);

  // Costo que sostiene el costeo: la opción del asistente que el modelo marcó (o la primera del asistente).
  const idSostiene = (salida.respaldos || []).find(x => x.sostiene_costo)?.id ?? null;
  const delAsistente = comparador.filter(o => o.origen === 'asistente');
  let sostiene = delAsistente.find(o => idSostiene && o.id_respaldo === idSostiene && o.neto_unitario != null) ?? delAsistente.find(o => o.neto_unitario != null) ?? null;

  // Ruta B: el precio es FOB en USD y lo convierte el sistema con el dólar del día + $10.
  let rutaB: DatosSistemaLinea['rutaB'] = null;
  const rb = salida.ruta_b;
  if (salida.ruta === 'B' && rb?.precio_unitario && (rb.moneda || 'USD').toUpperCase() === 'USD' && (rb.incoterm || '').toUpperCase() === 'FOB' && ext.dolar.usado) {
    const c = costoRutaB(rb.precio_unitario, ext.dolar.usado);
    rutaB = { fob: rb.precio_unitario, dolarUsado: ext.dolar.usado, costoNeto: c.neto, costoConIva: c.conIva };
  }

  // Costos ocultos (V5) prorrateados por unidad.
  let ocultos = 0;
  for (const c of v.V5_costos_ocultos || []) if (c.monto_neto_clp_total && cant && cant > 0 && (c.tipo === 'despacho' || c.tipo === 'cargo_adicional' || c.tipo === 'accesorio')) ocultos += c.monto_neto_clp_total / cant;

  let verificado: number | null = rutaB ? rutaB.costoNeto : sostiene?.costo_bodega ?? null;
  if (verificado != null && !rutaB && sostiene && (sostiene.despacho_monto_neto_clp_total ?? 0) === 0) verificado = r0(verificado + ocultos);
  if (ext.precioNoVerificado && !rutaB) verificado = null;

  const costeado = linea.costoRegistradoNeto;
  let diffMonto: number | null = null, diffPct: number | null = null, dir: DatosSistemaLinea['direccion'] = null;
  if (verificado != null && costeado != null && costeado > 0) {
    diffMonto = verificado - costeado; diffPct = r1((diffMonto / costeado) * 100);
    dir = Math.abs(diffPct) < 0.5 ? 'IGUAL' : diffMonto > 0 ? 'MAS_CARO' : 'MAS_BARATO';
  }

  // V10 / V10-b sobre las referencias del auditor + la opción del asistente.
  const refs = comparador.filter(o => o.origen === 'auditor' && o.costo_bodega != null);
  const preciosMismoProducto = [...(sostiene?.costo_bodega != null ? [sostiene.costo_bodega] : []), ...refs.map(o => o.costo_bodega as number)];
  const disp = preciosMismoProducto.length >= 2 ? dispersion(preciosMismoProducto) : null;
  const refMediana = mediana(refs.map(o => o.costo_bodega as number));
  const refBaratas = verificado != null ? refs.filter(o => (o.costo_bodega as number) < verificado! * (1 - PARAMS.umbralJustificacionAhorro + 1e-9))
    .map(o => ({ opcion: o.opcion, neto: o.costo_bodega as number, ahorroPct: r1(((verificado! - (o.costo_bodega as number)) / verificado!) * 100) })) : [];

  // V8 plazo.
  let plazo: DatosSistemaLinea['plazo'] = null;
  const pd = v.V8_plazo?.plazo_proveedor_dias ?? null;
  if (pd != null || ext.diasDisponibles != null) {
    const corridos = pd == null ? null : v.V8_plazo?.tipo_dias === 'habiles' ? Math.ceil(pd * 1.4) : pd;
    const total = corridos == null ? null : corridos + PARAMS.logisticaInternaDias;
    plazo = { proveedorDias: corridos, logisticaDias: PARAMS.logisticaInternaDias, totalDias: total, diasDisponibles: ext.diasDisponibles, holguraDias: total != null && ext.diasDisponibles != null ? ext.diasDisponibles - total : null };
  }

  return {
    dolar: ext.dolar, costeadoNeto: costeado, verificadoNeto: verificado, respaldoQueSostiene: sostiene?.id_respaldo ?? idSostiene,
    diffMonto, diffPct, direccion: dir, precioNoVerificado: ext.precioNoVerificado, costosOcultosNeto: r0(ocultos),
    comparador, refMediana: refMediana != null ? r0(refMediana) : null, dispersion: disp, refMasBaratas: refBaratas, rutaB, plazo,
    guardarrailes: ext.guardarrailes, precioMercadoPublico: ext.precioMercadoPublico,
    antiguedadHistoricoMeses: ext.fechaHistorico ? mesesEntre(ext.fechaHistorico, ext.hoyISO) : null,
  };
}

// ── Veredicto y matriz de bloqueo (Parte VIII) ────────────────────────────────────────────────────
export type Veredicto = 'VERIFICADO' | 'VERIFICADO_CON_ALERTAS' | 'REQUIERE_HABILITACION' | 'NO_VERIFICADO' | 'SIN_RESPALDO' | 'PENDIENTE_CRUCE_TECNICO';
export interface Bloqueo { codigo: string; mensaje: string; salida: string }
export interface Alerta { codigo: string; nivel: 'rojo' | 'amarillo' | 'info'; mensaje: string }
export interface Habilitacion { nivel: 'EM' | 'CA'; porNombre: string | null; motivo: string; at: string }
export interface ContextoLinea {
  margen: MargenProyecto | null;
  justificacionAhorro: string | null;
  habilitacion: Habilitacion | null;
  hoyISO: string;
  esGastoExtra: boolean;
}
export interface LineaDerivada {
  veredicto: Veredicto; bloqueos: Bloqueo[]; alertas: Alerta[];
  habilitacionRequerida: 'no' | 'EM' | 'CA';
  pasaAnexosOk: boolean;             // ¿puede seguir hacia ANEXOS OK?
  impactoCostoTotalNeto: number | null;
  v4: { importante: boolean; r1: boolean; r2: boolean; margenAntes: number | null; margenDespues: number | null; caidaPuntos: number | null };
}

const SALIDA = {
  respaldo: 'Reemplaza el link por uno activo del mismo producto, o sube la cotización formal del proveedor.',
  identidad: 'Confirma con el proveedor la marca, modelo y SKU exactos, o corrige el respaldo para que sea el producto que aprobó el Auditor Técnico.',
  unidad: 'Corrige la unidad o el empaque: costea la unidad que pide la licitación (pide al proveedor el precio por unidad).',
  iva: 'Pide al proveedor que indique si el precio es neto o con IVA y corrige el costeo (sin doble IVA ni IVA omitido).',
  precio: 'Actualiza el costo al valor del respaldo, o pide una cotización formal que congele el precio. También puedes justificar y pedir habilitación al EM.',
  ahorro: 'Escribe por qué no usaste la opción más barata (plazo, garantía, respaldo formal, confiabilidad, stock, despacho) o pásate a esa opción.',
  rutaB: 'Pide una proforma FOB en USD, o que un humano defina cómo costear este Incoterm/moneda.',
  conflicto: 'Elige cuál de los respaldos es el vigente y elimina o corrige el otro.',
};

export function derivarLinea(linea: LineaCosteo, g: LineaGuardada, ctx: ContextoLinea): LineaDerivada {
  const v = g.modelo.verificaciones || {};
  const s = g.sistema;
  const bloqueos: Bloqueo[] = [];
  const alertas: Alerta[] = [];
  const add = (b: Bloqueo) => bloqueos.push(b);
  const alerta = (codigo: string, nivel: Alerta['nivel'], mensaje: string) => alertas.push({ codigo, nivel, mensaje });

  // Respaldo
  const respaldos = g.modelo.respaldos || [];
  const utiles = respaldos.filter(r => r.legibilidad !== 'nula' && (r.tipo !== 'LINK_WEB' || r.estado_link === 'activo' || r.estado_link === 'precio_variable_region'));
  const sinRespaldo = utiles.length === 0 || g.modelo.origen_dato === 'DECLARADO';
  if (sinRespaldo) add({ codigo: 'SIN_RESPALDO', mensaje: 'Ningún respaldo sostiene el costo (no hay link activo, cotización ni histórico legibles).', salida: SALIDA.respaldo });
  for (const r of respaldos) {
    if (r.tipo === 'LINK_WEB' && (r.estado_link === 'caido' || r.estado_link === 'redirige' || r.estado_link === 'login'))
      alerta('LINK_' + String(r.estado_link).toUpperCase(), 'rojo', `El link ${r.archivo_o_url || ''} está ${r.estado_link === 'caido' ? 'caído' : r.estado_link === 'redirige' ? 'redirigiendo a otro producto' : 'pidiendo login'}: no cuenta como respaldo.`);
  }
  if (g.modelo.conflicto_respaldos?.existe) add({ codigo: 'CONFLICTO_RESPALDOS', mensaje: 'Los respaldos se contradicen entre sí (ver las dos versiones).', salida: SALIDA.conflicto });

  // V1
  const v1 = v.V1_identidad;
  if (v1?.estado === 'NO_COINCIDE') add({ codigo: 'V1_NO_COINCIDE', mensaje: 'Lo cotizado NO es el producto que aprobó el Auditor Técnico (marca/modelo/SKU distintos).', salida: SALIDA.identidad });
  else if (v1?.estado === 'NO_VERIFICABLE') add({ codigo: 'V1_NO_VERIFICABLE', mensaje: 'El respaldo no permite verificar marca, modelo o SKU del producto.', salida: SALIDA.identidad });
  for (const a of v1?.accesorios_exigidos_no_costeados || []) if (a) add({ codigo: 'V1_ACCESORIO', mensaje: `Falta costear el accesorio exigido por el Auditor Técnico: ${a}.`, salida: 'Cotiza el accesorio y súmalo al costeo (es un costo oculto).' });

  // V2 / V3
  const v2 = v.V2_unidad;
  // En Ruta B el precio viene en USD por diseño: la conversión la hace la fórmula del sistema, no es un error de unidad.
  if (v2?.estado === 'ERROR' && !(g.modelo.ruta === 'B' && /usd|us\$|d[oó]lar|eur/i.test(String(v2.unidad_respaldo || '')))) add({ codigo: 'V2_UNIDAD', mensaje: `Unidad, empaque o cantidad no calzan con la licitación (${v2.unidad_respaldo || '?'}${v2.contenido_empaque ? `, ${v2.contenido_empaque}` : ''}).`, salida: SALIDA.unidad });
  else if (v2?.estado === 'NO_DECLARADO') alerta('V2_NO_DECLARADO', 'amarillo', 'El respaldo no dice claramente la unidad de venta: confírmala con el proveedor.');
  const v3 = v.V3_iva_moneda;
  if (v3?.estado === 'DOBLE_IVA' || v3?.estado === 'IVA_OMITIDO') add({ codigo: 'V3_' + v3.estado, mensaje: v3.estado === 'DOBLE_IVA' ? 'Se le sumó el 19% a un precio que ya incluía IVA (doble IVA).' : 'Un precio con IVA se registró como neto (IVA omitido): el costo real es distinto.', salida: SALIDA.iva });
  else if (v3?.estado === 'MONEDA_NO_CONVERTIDA' && g.modelo.ruta !== 'B') add({ codigo: 'V3_MONEDA', mensaje: 'El respaldo está en otra moneda y no se convirtió a CLP.', salida: SALIDA.iva });
  else if (v3?.estado === 'IVA_NO_DECLARADO') alerta('V3_IVA_NO_DECLARADO', 'amarillo', 'El respaldo no dice si el precio es neto o con IVA: no se supone. Pregúntale al proveedor.');

  // V4 + V5: el costo real mayor que el costeado bloquea SOLO si le pega al margen del proyecto (R1 / R2).
  const alza = s.direccion === 'MAS_CARO' && s.diffMonto != null && s.diffMonto > 0;
  const m = ctx.margen;
  const importante = !ctx.esGastoExtra && alza && !!m && (m.r1 || m.r2);
  if (s.precioNoVerificado) add({ codigo: 'V4_PRECIO_SIN_CITA', mensaje: 'El precio que se dice haber leído no aparece en el respaldo: no se puede dar por verificado.', salida: SALIDA.respaldo });
  if (importante && m) {
    const razon = m.r2 && !m.r1 ? `deja el margen del proyecto en ${m.margenFinal}% (bajo el piso del ${PARAMS.margenMinimo}%)`
      : m.r1 && !m.r2 ? `baja el margen del proyecto ${m.caidaPuntos} puntos (de ${m.margenBase}% a ${m.margenFinal}%)`
      : `baja el margen ${m.caidaPuntos} puntos y lo deja en ${m.margenFinal}%, bajo el piso del ${PARAMS.margenMinimo}%`;
    add({ codigo: 'V4_ALZA_IMPORTANTE', mensaje: `Alza de ${s.diffPct}% (+$${Math.round(s.diffMonto!).toLocaleString('es-CL')} por unidad) que ${razon}.`, salida: SALIDA.precio });
  } else if (alza) {
    alerta('V4_ALZA', 'amarillo', `El costo real es ${s.diffPct}% más caro que lo costeado (+$${Math.round(s.diffMonto!).toLocaleString('es-CL')} por unidad)${m?.caidaPuntos != null ? `; al margen del proyecto le pega ${m.caidaPuntos} punto(s)` : ' (aún no hay precio de venta para medir el impacto en el margen)'}.`);
  } else if (s.direccion === 'MAS_BARATO') alerta('V4_BAJA', 'info', `El costo real es ${Math.abs(s.diffPct!)}% más barato que lo costeado: se sobrecosteó y eso resta competitividad.`);
  for (const c of v.V5_costos_ocultos || []) if (c.tipo) alerta('V5_' + c.tipo.toUpperCase(), 'amarillo', `Costo oculto (${c.tipo.replace(/_/g, ' ')}): ${c.detalle || ''}${c.monto ? ` — ${c.monto}` : ''}`.trim());

  // V6 stock (informa, nunca bloquea)
  const st = v.V6_stock?.estado;
  if (st === 'sin_stock' || st === 'agotado') alerta('V6_SIN_STOCK', 'rojo', 'La página dice "sin stock / agotado": VALIDAR STOCK CON EL PROVEEDOR (muchas tiendas no enlazan el stock con su inventario real; no bloquea).');
  else if (st === 'pocas_unidades') alerta('V6_POCAS', 'amarillo', `Quedan pocas unidades${v.V6_stock?.unidades_visibles ? ` (${v.V6_stock.unidades_visibles})` : ''}: confirma que alcanzan para ${linea.cantidad ?? 'la cantidad requerida'}.`);
  else if (st === 'a_pedido') alerta('V6_A_PEDIDO', 'amarillo', 'El producto es "a pedido": confirma el plazo real de entrega.');

  // V7 vigencia (informa)
  if (v.V7_vigencia?.estado === 'REVALIDAR') alerta('V7_REVALIDAR', 'amarillo', 'REVALIDAR PRECIO: la cotización está vencida o es más antigua que 5 meses sin vigencia declarada.');
  // V8 plazo (alerta fuerte, no bloquea — el prompt deja la decisión abierta)
  if (s.plazo?.diasDisponibles != null && s.plazo.diasDisponibles < 0)
    alerta('V8_RELOJ_VENCIDO', 'rojo', `El plazo para entregarle al cliente ya venció (hace ${Math.abs(s.plazo.diasDisponibles)} día(s)); cualquier plazo del proveedor queda fuera. Derívalo a quien define el plazo de la oferta.`);
  else if (s.plazo?.holguraDias != null && s.plazo.holguraDias < 0)
    alerta('V8_PLAZO', 'rojo', `Plazo del proveedor + logística (~${s.plazo.totalDias} días corridos) no cabe en los ${s.plazo.diasDisponibles} que quedan para entregar. Derívalo a quien define el plazo de la oferta.`);
  else if (v.V8_plazo && v.V8_plazo.tipo_dias === 'no_declarado' && v.V8_plazo.plazo_proveedor_dias == null) alerta('V8_NO_DECLARADO', 'amarillo', 'El proveedor no declara plazo de entrega: pregúntaselo.');
  // V9 competidor
  if (v.V9_proveedor_mp?.alerta_competidor) alerta('V9_COMPETIDOR', 'amarillo', `El proveedor vende al Estado en el mismo rubro y podría estar ofertando en esta licitación. ${v.V9_proveedor_mp.evidencia || ''}`.trim());
  // V10
  const ah = s.refMasBaratas.sort((a, b) => b.ahorroPct - a.ahorroPct)[0];
  if (ah) {
    const justificado = !!(ctx.justificacionAhorro && ctx.justificacionAhorro.trim().length >= 15);
    if (justificado) alerta('V10_AHORRO_JUSTIFICADO', 'info', `Hay una opción ${ah.ahorroPct}% más barata (${ah.opcion}, $${ah.neto.toLocaleString('es-CL')} neto): ya se justificó por qué no se usó.`);
    else add({ codigo: 'V10_AHORRO', mensaje: `${ah.opcion} vende el MISMO producto ${ah.ahorroPct}% más barato ($${ah.neto.toLocaleString('es-CL')} neto puesto en bodega vs $${(s.verificadoNeto ?? 0).toLocaleString('es-CL')}).`, salida: SALIDA.ahorro });
  } else if (s.verificadoNeto != null) {
    const menor = s.comparador.filter(o => o.origen === 'auditor' && o.costo_bodega != null && o.costo_bodega < s.verificadoNeto!).sort((a, b) => (a.costo_bodega! - b.costo_bodega!))[0];
    if (menor) alerta('V10_AHORRO_MENOR', 'info', `Oportunidad de ahorro: ${menor.opcion} lo vende ${r1(((s.verificadoNeto - menor.costo_bodega!) / s.verificadoNeto) * 100)}% más barato.`);
  }
  if (v.V10_referencias?.sin_referencias) alerta('V10_SIN_REFERENCIAS', 'info', 'No se encontró ninguna referencia del MISMO producto en el mercado para comparar.');
  const d = v.V10b_discordancia;
  if (d?.activa && d.es_la_del_asistente && ['moneda', 'unidad_empaque', 'pagina_extranjera', 'version', 'repuesto_o_arriendo'].includes(String(d.causa_probable))) {
    // Nota V10-b: si la triangulación confirma que el precio del asistente está mal, ya no es una discordancia: es un error de V1/V2/V3 y bloquea.
    const c = String(d.causa_probable);
    add({ codigo: c === 'moneda' || c === 'pagina_extranjera' ? 'V3_MONEDA' : c === 'unidad_empaque' ? 'V2_UNIDAD' : 'V1_NO_COINCIDE', mensaje: `La triangulación confirmó que el precio usado por el asistente está mal (${c.replace(/_/g, ' ')}). ${d.evidencia || ''}`.trim(), salida: c === 'unidad_empaque' ? SALIDA.unidad : c === 'moneda' || c === 'pagina_extranjera' ? SALIDA.iva : SALIDA.identidad });
  }
  if (v.V10b_discordancia?.activa) alerta('V10B_OJO', 'amarillo', `OJO CON ESTE PRECIO: ${v.V10b_discordancia.fuente_discordante || 'una fuente'} — ${v.V10b_discordancia.causa_probable || 'causa indeterminada'}. ${v.V10b_discordancia.evidencia || ''}`.trim());
  // Ruta B
  const rb = g.modelo.ruta_b;
  if (g.modelo.ruta === 'B' && rb) {
    if ((rb.incoterm || '').toUpperCase() !== 'FOB' || (rb.moneda || 'USD').toUpperCase() !== 'USD')
      add({ codigo: 'RUTA_B_INCOTERM', mensaje: `La proforma viene en ${rb.moneda || '?'} con Incoterm ${rb.incoterm || 'no declarado'}: la fórmula asume FOB en USD.`, salida: SALIDA.rutaB });
    if (rb.moq != null && linea.cantidad != null && rb.moq > linea.cantidad) alerta('RUTA_B_MOQ', 'amarillo', `El MOQ (${rb.moq}) es mayor que la cantidad a comprar (${linea.cantidad}).`);
    for (const a of rb.alertas || []) if (a) alerta('RUTA_B', 'amarillo', a);
  }
  // Histórico antiguo
  if (g.modelo.origen_dato === 'HISTORICO_INTERNO' && s.antiguedadHistoricoMeses != null && s.antiguedadHistoricoMeses >= PARAMS.historicoAntiguoMeses)
    alerta('HISTORICO_ANTIGUO', 'amarillo', `COMPRA ANTIGUA (${Math.floor(s.antiguedadHistoricoMeses)} meses) — revalidar precio si es posible. Sigue siendo válida.`);
  // V11
  const falt = v.V11_datos_oc?.faltantes || [];
  if (falt.length) alerta('V11_DATOS_OC', 'amarillo', `Faltan datos para la orden de compra: ${falt.join(', ')}.`);
  for (const t of g.modelo.no_pude_leer || []) if (t.que) alerta('NO_LEGIBLE', 'amarillo', `No se pudo leer: ${t.que}${t.donde ? ` (${t.donde})` : ''}.`);

  // Veredicto
  const hayBloqueo = bloqueos.length > 0;
  const habilitacionRequerida: LineaDerivada['habilitacionRequerida'] =
    (g.modelo.origen_dato === 'RESPALDO_INFORMAL' || g.modelo.origen_dato === 'HISTORICO_INTERNO') ? 'EM' : 'no';
  let veredicto: Veredicto;
  if (sinRespaldo) veredicto = 'SIN_RESPALDO';
  else if (hayBloqueo) veredicto = 'NO_VERIFICADO';
  else if (v1?.estado === 'PENDIENTE_CRUCE_TECNICO') veredicto = 'PENDIENTE_CRUCE_TECNICO';
  else if (habilitacionRequerida === 'EM') veredicto = 'REQUIERE_HABILITACION';
  else if (alertas.some(a => a.nivel !== 'info')) veredicto = 'VERIFICADO_CON_ALERTAS';
  else veredicto = 'VERIFICADO';

  // ¿Puede seguir hacia ANEXOS OK? CA lo puede todo; el EM habilita lo informal/histórico.
  const hab = ctx.habilitacion;
  let pasa = veredicto === 'VERIFICADO' || veredicto === 'VERIFICADO_CON_ALERTAS' || veredicto === 'PENDIENTE_CRUCE_TECNICO';
  if (!pasa && hab) pasa = hab.nivel === 'CA' || (veredicto === 'REQUIERE_HABILITACION' && (hab.nivel === 'EM' || hab.nivel === 'CA'));

  return {
    veredicto, bloqueos, alertas, habilitacionRequerida, pasaAnexosOk: pasa,
    impactoCostoTotalNeto: s.diffMonto != null && linea.cantidad != null ? r0(s.diffMonto * linea.cantidad) : null,
    v4: { importante, r1: !!m?.r1, r2: !!m?.r2, margenAntes: m?.margenBase ?? null, margenDespues: m?.margenFinal ?? null, caidaPuntos: m?.caidaPuntos ?? null },
  };
}

// ── Mensajes agrupados por proveedor (Parte VII) ──────────────────────────────────────────────────
export function mensajesPorProveedor(lineas: Array<{ linea: LineaGuardada; derivada: LineaDerivada }>): Array<{ proveedor: string; mensaje: string; lineas: number[] }> {
  const grupos = new Map<string, { preguntas: string[]; lineas: number[] }>();
  for (const { linea, derivada } of lineas) {
    if (derivada.veredicto === 'VERIFICADO') continue;
    const preg = linea.modelo.ayuda?.pregunta_proveedor?.trim();
    if (!preg) continue;
    const emisor = (linea.modelo.respaldos || []).find(r => r.sostiene_costo)?.emisor?.razon_social || (linea.modelo.respaldos || [])[0]?.emisor?.razon_social || 'Proveedor sin identificar';
    const g = grupos.get(emisor) || { preguntas: [], lineas: [] };
    g.preguntas.push(`• ${linea.fila.detalle.slice(0, 80)}${linea.fila.sku ? ` (SKU ${linea.fila.sku})` : ''}: ${preg}`);
    g.lineas.push(linea.fila.item);
    grupos.set(emisor, g);
  }
  return [...grupos.entries()].map(([proveedor, g]) => ({
    proveedor, lineas: g.lineas,
    mensaje: `Hola, junto con saludar, necesito confirmar lo siguiente sobre nuestra cotización:\n${g.preguntas.join('\n')}\nQuedo atento. Gracias.`,
  }));
}

// ── Posición de precio del proyecto (Parte IX, C3) ────────────────────────────────────────────────
export interface PosicionPrecio {
  presupuesto: { monto_neto: number | null; nivel: 'linea' | 'proyecto' | null; fuente: string };
  mercado_publico: { monto_neto: number | null; n_datos: number; rango_fechas: string; calidad: 'mismo_producto' | 'comparable' | 'sin_datos'; lineas_con_dato: number };
  mercado_privado: { monto_neto: number | null; n_referencias: number; lineas_con_referencias: number; costo_de_esas_lineas: number | null };
  costo_verificado: { monto_neto: number | null; lineas_pendientes: number; lineas_total: number };
  espacio_maniobra: { monto: number | null; pct_sobre_costo: number | null };
  margen: { con_precio_venta: number | null; al_presupuesto: number | null; venta_neta: number };
  alertas: Array<{ tipo: string; nivel: 'rojo' | 'amarillo' | 'info' | 'ok'; detalle: string; lineas_que_mas_aportan: number[] }>;
  orden_sano: boolean | null;
  lectura: string;
}

export function calcularPosicionPrecio(
  lineas: LineaCosteo[],
  auditadas: Record<string, LineaGuardada | undefined>,
  presupuesto: { neto: number | null; nivel: 'linea' | 'proyecto' | null; fuente: string },
): PosicionPrecio {
  const utiles = lineas.filter(l => !l.esGastoExtra && l.ofertamos && l.cantidad != null && l.cantidad > 0);
  let costo = 0, pendientes = 0, priv = 0, costoCubierto = 0, nRefs = 0, lineasRef = 0, pub = 0, nPub = 0, lineasPub = 0, ventaNeta = 0;
  const fechas: string[] = []; let calidadPub = 'sin_datos' as PrecioMercadoPublico['calidad']; let algunoDebil = false;
  const brecha: Array<{ item: number; dif: number }> = [];
  for (const l of utiles) {
    const a = auditadas[l.id];
    const cVer = a?.sistema.verificadoNeto ?? null;
    const c = cVer ?? l.costoRegistradoNeto;
    if (cVer == null) pendientes++;
    if (c != null) costo += l.cantidad! * c;
    if (l.precioVentaUnitario != null) ventaNeta += l.cantidad! * l.precioVentaUnitario;
    if (a?.sistema.refMediana != null && c != null) {
      priv += l.cantidad! * a.sistema.refMediana; costoCubierto += l.cantidad! * c;
      nRefs += a.sistema.comparador.filter(o => o.origen === 'auditor' && o.costo_bodega != null).length; lineasRef++;
      if (c > a.sistema.refMediana) brecha.push({ item: l.item, dif: l.cantidad! * (c - a.sistema.refMediana) });
    }
    const mp = a?.sistema.precioMercadoPublico;
    if (mp?.neto != null && mp.n > 0) {
      pub += l.cantidad! * mp.neto; nPub += mp.n; lineasPub++;
      if (mp.desde) fechas.push(mp.desde); if (mp.hasta) fechas.push(mp.hasta);
      if (mp.calidad === 'comparable' || mp.n < PARAMS.minDatosMercadoPublico) algunoDebil = true;
      calidadPub = mp.calidad === 'mismo_producto' && calidadPub !== 'comparable' ? 'mismo_producto' : mp.calidad === 'comparable' ? 'comparable' : calidadPub;
    }
  }
  costo = r0(costo); priv = r0(priv); pub = r0(pub);
  const pres = presupuesto.neto;
  const tienePriv = lineasRef > 0, tienePub = lineasPub > 0;
  const espacio = pres != null && costo > 0 ? pres - costo : null;
  const mCon = ventaNeta > 0 && costo > 0 ? r1((1 - costo / ventaNeta) * 100) : null;
  const mPres = pres != null && costo > 0 ? r1((1 - costo / pres) * 100) : null;

  const alertas: PosicionPrecio['alertas'] = [];
  const top = brecha.sort((a, b) => b.dif - a.dif).slice(0, 3).map(b => b.item);
  if (tienePriv && costoCubierto > priv) alertas.push({ tipo: 'costo_sobre_mercado', nivel: 'rojo', detalle: 'No estamos cotizando bien: nuestro costo está sobre el mercado. Probablemente tenemos menos opciones de ganar.', lineas_que_mas_aportan: top });
  if (pres != null && tienePub && pres < pub) alertas.push({ tipo: 'presupuesto_bajo_mercado_publico', nivel: 'amarillo', detalle: 'El presupuesto está bajo el precio histórico del Estado: licitación apretada o con riesgo de quedar desierta.', lineas_que_mas_aportan: [] });
  if (pres != null && costo > 0 && pres < costo) alertas.push({ tipo: 'presupuesto_bajo_costo', nivel: 'rojo', detalle: 'El presupuesto no alcanza a cubrir el costo.', lineas_que_mas_aportan: [] });
  if (mCon != null && mCon < PARAMS.margenMinimo) alertas.push({ tipo: 'bajo_margen_minimo', nivel: 'rojo', detalle: `Bajo el piso del ${PARAMS.margenMinimo}%: con el precio de venta registrado el margen es ${mCon}%.`, lineas_que_mas_aportan: [] });
  if (mPres != null && mPres < PARAMS.margenMinimo && !(pres != null && pres < costo)) alertas.push({ tipo: 'espacio_bajo_minimo', nivel: 'rojo', detalle: `Ni vendiendo al presupuesto llegamos al ${PARAMS.margenMinimo}% (daría ${mPres}%).`, lineas_que_mas_aportan: [] });
  if (!tienePub) alertas.push({ tipo: 'sin_datos_mp', nivel: 'info', detalle: 'SIN DATOS SUFICIENTES de mercado público: no se estima. El resumen funciona con presupuesto, mercado privado y costo.', lineas_que_mas_aportan: [] });
  else if (algunoDebil) alertas.push({ tipo: 'mp_dato_debil', nivel: 'info', detalle: `El precio de mercado público es un dato débil (menos de ${PARAMS.minDatosMercadoPublico} OC o productos comparables).`, lineas_que_mas_aportan: [] });

  let ordenSano: boolean | null = null;
  if (pres != null && costo > 0) {
    const cadena = [pres, tienePub ? pub : null, tienePriv ? priv : null, tienePriv ? costoCubierto : costo].filter((x): x is number => x != null);
    ordenSano = cadena.every((x, i) => i === 0 || cadena[i - 1] >= x - 1);
    // El costo del tramo comparable es el de las líneas con referencias; la cadena pide presupuesto ≥ público > privado ≥ costo.
  }
  const fechasOrd = fechas.sort();
  return {
    presupuesto: { monto_neto: pres, nivel: presupuesto.nivel, fuente: presupuesto.fuente },
    mercado_publico: { monto_neto: tienePub ? pub : null, n_datos: nPub, rango_fechas: fechasOrd.length ? `${fechasOrd[0].slice(0, 7)} – ${fechasOrd[fechasOrd.length - 1].slice(0, 7)}` : '', calidad: tienePub ? calidadPub : 'sin_datos', lineas_con_dato: lineasPub },
    mercado_privado: { monto_neto: tienePriv ? priv : null, n_referencias: nRefs, lineas_con_referencias: lineasRef, costo_de_esas_lineas: tienePriv ? r0(costoCubierto) : null },
    costo_verificado: { monto_neto: costo > 0 ? costo : null, lineas_pendientes: pendientes, lineas_total: utiles.length },
    espacio_maniobra: { monto: espacio, pct_sobre_costo: espacio != null && costo > 0 ? r1((espacio / costo) * 100) : null },
    margen: { con_precio_venta: mCon, al_presupuesto: mPres, venta_neta: r0(ventaNeta) },
    alertas, orden_sano: ordenSano, lectura: '',
  };
}

// ── Diferencias entre dos auditorías de la misma línea (pasada final) ─────────────────────────────
export function cambiosEntreAuditorias(antes: LineaGuardada | null, ahora: LineaGuardada): string[] {
  if (!antes) return [];
  const out: string[] = [];
  const a = antes.sistema.verificadoNeto, b = ahora.sistema.verificadoNeto;
  if (a != null && b != null && a !== b) out.push(`El precio ${b > a ? 'SUBIÓ' : 'BAJÓ'} de $${a.toLocaleString('es-CL')} a $${b.toLocaleString('es-CL')} neto (${r1(((b - a) / a) * 100)}%).`);
  const sa = antes.modelo.verificaciones?.V6_stock?.estado, sb = ahora.modelo.verificaciones?.V6_stock?.estado;
  if (sa && sb && sa !== sb) out.push(`El stock cambió de "${sa}" a "${sb}".`);
  const la = (antes.modelo.respaldos || []).filter(r => r.tipo === 'LINK_WEB'), lb = (ahora.modelo.respaldos || []).filter(r => r.tipo === 'LINK_WEB');
  for (const r of lb) {
    const previo = la.find(x => x.archivo_o_url === r.archivo_o_url);
    if (previo && previo.estado_link === 'activo' && r.estado_link !== 'activo') out.push(`El link ${r.archivo_o_url} ya no está activo (${r.estado_link}).`);
  }
  return out;
}

export type { FilaEditorCosteo };
