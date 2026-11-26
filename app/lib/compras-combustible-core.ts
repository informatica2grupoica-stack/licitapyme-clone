// app/lib/compras-combustible-core.ts
// GASTO EXTRA «COMBUSTIBLE» — reglas puras (sin base de datos ni Obuma) para poder probarlas.
//
// Una factura de combustible trae TRES cosas (así quedó la OC 4058 del 387-55-LE26, factura 33 N° 186536):
//   · neto afecto a IVA ................ $35.810  (línea «combustible», afecta)
//   · impuesto específico .............. $ 7.537  (línea «impuesto especifico», EXENTA de IVA)
//   · IVA (19 % solo del neto afecto) .. $ 6.804
//   · total de la factura .............. $50.151
// Para el proyecto el costo es NETO + IMPUESTO ESPECÍFICO: el IVA es crédito fiscal (las cargas son siempre con factura y el
// vehículo es camioneta, confirmado por el dueño el 20-nov-2026). La tasa del impuesto NO se escribe en el código: se toma de la
// factura (cambia con el MEPCO y es distinta para diésel y gasolinas).

export const TIPOS_COMBUSTIBLE = [
  { clave: 'DIESEL', etiqueta: 'Diésel' },
  { clave: 'GASOLINA_93', etiqueta: 'Gasolina 93' },
  { clave: 'GASOLINA_95', etiqueta: 'Gasolina 95' },
  { clave: 'GASOLINA_97', etiqueta: 'Gasolina 97' },
  { clave: 'PARAFINA', etiqueta: 'Parafina' },
] as const;
export type TipoCombustible = (typeof TIPOS_COMBUSTIBLE)[number]['clave'];

export const etiquetaCombustible = (c: string): string => TIPOS_COMBUSTIBLE.find(t => t.clave === c)?.etiqueta ?? c;
export const esTipoCombustible = (c: unknown): c is TipoCombustible => TIPOS_COMBUSTIBLE.some(t => t.clave === c);

export interface CargaCombustible {
  tipo: TipoCombustible;
  litros: number;
  /** Neto afecto a IVA, en pesos. */
  netoAfecto: number;
  /** Impuesto específico en pesos (va exento de IVA). */
  impuestoEspecifico: number;
  patente?: string | null;
}

export const TASA_IVA = 0.19;

/** Litros como los escribe el equipo. La coma es decimal («25,757»); un punto suelto con 1 o 2 cifras enteras también («36.19», «25.757»:
 *  una carga de camioneta no pasa de 99 L), porque con el punto quitado se guardaban ×100 / ×1.000 (OC 4088–4093 de 2736-44-LE26).
 *  Con miles de verdad («1.250,5» o «1.250.000») el punto se quita como siempre. */
export function parsearLitros(texto: string): number {
  const t = String(texto).replace(/[^\d,.]/g, '');
  const puntos = (t.match(/\./g) ?? []).length;
  if (!t.includes(',') && puntos === 1 && /^\d{1,2}\.\d+$/.test(t)) return Number(t);
  return Number(t.replace(/\./g, '').replace(',', '.'));
}

/** Patente chilena sin puntos ni guiones, en mayúsculas («ABCD12», «AB1234»). */
export function normalizarPatente(p: string | null | undefined): string | null {
  const s = String(p ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  return s || null;
}

/** null = la carga es válida; si no, el motivo en palabras para el equipo. */
export function validarCarga(c: CargaCombustible): string | null {
  if (!esTipoCombustible(c.tipo)) return 'Elige el tipo de combustible.';
  if (!Number.isFinite(c.litros) || c.litros <= 0) return 'Faltan los litros de la carga.';
  if (!Number.isFinite(c.netoAfecto) || c.netoAfecto <= 0) return 'Falta el neto de la factura (sin IVA ni impuesto específico).';
  if (!Number.isInteger(c.netoAfecto)) return 'El neto va en pesos enteros, como en la factura.';
  if (!Number.isFinite(c.impuestoEspecifico) || c.impuestoEspecifico < 0) return 'El impuesto específico no es válido (si no lleva, pon 0).';
  if (!Number.isInteger(c.impuestoEspecifico)) return 'El impuesto específico va en pesos enteros, como en la factura.';
  const p = normalizarPatente(c.patente);
  if (c.patente && c.patente.trim() && (!p || p.length < 5 || p.length > 7)) return 'La patente no parece válida (ejemplo ABCD12).';
  return null;
}

export interface CalculoCarga {
  iva: number;
  /** Lo que dice la factura: neto + impuesto específico + IVA. */
  totalFactura: number;
  /** Costo para el proyecto: neto + impuesto específico (el IVA es crédito fiscal). */
  costo: number;
  precioLitroNeto: number;
  /** Costo por litro incluido el impuesto específico. */
  precioLitroCosto: number;
  impuestoPorLitro: number;
}

export function calcularCarga(c: Pick<CargaCombustible, 'litros' | 'netoAfecto' | 'impuestoEspecifico'>): CalculoCarga {
  const iva = Math.round(c.netoAfecto * TASA_IVA);
  const costo = c.netoAfecto + c.impuestoEspecifico;
  const porLitro = (n: number) => (c.litros > 0 ? Math.round((n / c.litros) * 100) / 100 : 0);
  return {
    iva, totalFactura: costo + iva, costo,
    precioLitroNeto: porLitro(c.netoAfecto), precioLitroCosto: porLitro(costo), impuestoPorLitro: porLitro(c.impuestoEspecifico),
  };
}

/** ¿Cuadra lo digitado con el total de la factura? Tolerancia de $1 por redondeo del IVA (Obuma trae decimales, la factura no). */
export function cuadraConFactura(c: Pick<CargaCombustible, 'netoAfecto' | 'impuestoEspecifico'>, totalFactura: number): boolean {
  return Math.abs(calcularCarga({ litros: 1, ...c }).totalFactura - totalFactura) <= 1;
}

export interface LineaOcCombustible {
  nombre: string; cantidad: number; precioUnitarioNeto: number; exento: boolean; descripcion: string | null;
}

/** Las líneas de la OC en Obuma, como la 4058: combustible afecto + «impuesto especifico» exento (esta última solo si hay impuesto). */
export function lineasOcCombustible(c: CargaCombustible, nombreProducto: string): LineaOcCombustible[] {
  const patente = normalizarPatente(c.patente);
  const lineas: LineaOcCombustible[] = [{
    nombre: nombreProducto, cantidad: 1, precioUnitarioNeto: c.netoAfecto, exento: false,
    descripcion: `${c.litros.toLocaleString('es-CL')} L de ${etiquetaCombustible(c.tipo)}${patente ? ` · patente ${patente}` : ''}`,
  }];
  if (c.impuestoEspecifico > 0) lineas.push({ nombre: 'IMPUESTO ESPECIFICO', cantidad: 1, precioUnitarioNeto: c.impuestoEspecifico, exento: true, descripcion: null });
  return lineas;
}

/** Totales de una OC con líneas afectas y exentas (el IVA solo sobre las afectas; internacional = todo exento y sin IVA). */
export function totalesOc(lineas: Array<{ subtotal: number; exento: boolean }>, internacional: boolean, redondear: (n: number) => number) {
  const exento = redondear(lineas.filter(l => internacional || l.exento).reduce((s, l) => s + l.subtotal, 0));
  const afecto = redondear(lineas.filter(l => !internacional && !l.exento).reduce((s, l) => s + l.subtotal, 0));
  const iva = internacional ? 0 : Math.round(afecto * TASA_IVA);
  const subtotal = redondear(afecto + exento);
  return { afecto, exento, iva, subtotal, total: redondear(subtotal + iva) };
}

const mediana = (xs: number[]) => { const s = [...xs].sort((a, b) => a - b); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };

/** Avisos (no bloquean): precio por litro o impuesto por litro muy lejos de lo que ya se cargó del mismo combustible. Detecta digitación mala. */
export function avisosCarga(c: CargaCombustible, previas: Array<{ tipo: string; litros: number; netoAfecto: number; impuestoEspecifico: number }>): string[] {
  const avisos: string[] = [];
  const act = calcularCarga(c);
  // Sin historial también se nota un error de digitación: «25.757» (coma de miles) se leía como 25.757 L en vez de 25,757 L (OC 4088–4093 de 2736-44-LE26).
  if (c.litros > 0 && (act.precioLitroNeto < 100 || act.precioLitroNeto > 5000))
    avisos.push(`El neto por litro ($${Math.round(act.precioLitroNeto).toLocaleString('es-CL')}) no es creíble: revisa los litros (los decimales van con coma, 25,757) y el neto.`);
  const mismas = previas.filter(p => p.tipo === c.tipo && p.litros > 0);
  if (mismas.length < 2) return avisos;
  const medPrecio = mediana(mismas.map(p => p.netoAfecto / p.litros));
  if (medPrecio > 0 && Math.abs(act.precioLitroNeto - medPrecio) / medPrecio > 0.25)
    avisos.push(`El neto por litro ($${Math.round(act.precioLitroNeto).toLocaleString('es-CL')}) se aleja más de 25 % de lo habitual en ${etiquetaCombustible(c.tipo)} ($${Math.round(medPrecio).toLocaleString('es-CL')}). Revisa litros y neto.`);
  const conImp = mismas.filter(p => p.impuestoEspecifico > 0);
  if (conImp.length >= 2 && c.impuestoEspecifico > 0) {
    const medImp = mediana(conImp.map(p => p.impuestoEspecifico / p.litros));
    if (medImp > 0 && Math.abs(act.impuestoPorLitro - medImp) / medImp > 0.3)
      avisos.push(`El impuesto específico por litro ($${act.impuestoPorLitro.toLocaleString('es-CL')}) se aleja de lo habitual ($${Math.round(medImp * 100) / 100}). Revisa que sea el de la factura.`);
  }
  return avisos;
}
