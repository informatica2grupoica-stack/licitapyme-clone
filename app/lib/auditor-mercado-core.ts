// app/lib/auditor-mercado-core.ts
// AUDITOR · VERIFICADOR DE COSTO, parte "de mercado" (Prompt 5 v2.0: V9, V10, V10-b, V10-c) — lo que decide el CÓDIGO. Puro.
//   · V9  — el proveedor vende al Estado → alerta de competidor (informa, no descarta).
//   · V10 — referencias de mercado del MISMO producto (mismo modelo/SKU por tokens: "un similar no es referencia").
//           Una referencia ≥ 5% más barata que el costo de la opción OBLIGA a justificar por qué no se usó (bloquea hasta justificar);
//           < 5% solo informa como oportunidad de ahorro.
//   · V10-b — dispersión: precios del mismo producto separados de la mediana más del 40% → "OJO CON ESTE PRECIO" (no se supone cuál está mal).
//   · V10-c — comparador: todas las fuentes válidas del mismo producto en una lista ordenada por costo neto.
import { PARAMS, mediana, dispersion, type Bloqueo, type Alerta, type PrecioMercadoPublico } from '@/app/lib/auditor-compras-core';
import type { ResultadoVerificacion } from '@/app/lib/auditor-opciones-core';

export interface CandidataMercado { url: string; nombre: string; precioNeto: number | null; precio: number | null; tienda: string; canal: string }
export interface ReferenciaMercado { tienda: string; nombre: string; url: string; precioNeto: number; canal: string }
export interface ReferenciaDescartada { tienda: string; nombre: string; url: string; motivo: string }
export interface CompetidorMP { venteAlEstado: boolean; nLicitaciones: number; nOrdenesCompra: number; rubros: string[]; ejemplos: string[]; limitacion: string }

export interface ResultadoMercado {
  consulta: string;
  referencias: ReferenciaMercado[];
  descartadas: ReferenciaDescartada[];
  competidor: CompetidorMP | null;
  mercadoPublico: PrecioMercadoPublico | null;
  error: string | null;
  creadoAt: string;
}

const norm = (t: string) => t.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

/** Tokens que identifican el MISMO producto: los de modelo/SKU de la tabla de Compras y, además, el modelo completo compactado y sus
 *  palabras con dígitos ("Eos Rebel T7" → eosrebelt7, t7). Como un token corto ("t7") es ambiguo entre marcas, quien compara exige TAMBIÉN la marca. */
export function tokensDeIdentidad(marca: string | null, modelo: string | null, sku: string | null, tokensBase: string[]): string[] {
  const set = new Set<string>(tokensBase);
  const m = norm(modelo || '');
  if (m && /\d/.test(m)) {
    const compacto = m.replace(/\s+/g, '');
    if (compacto.length >= 4) set.add(compacto);
    for (const w of m.split(' ')) if (/\d/.test(w) && w.length >= 2) set.add(w);
  }
  const k = norm(sku || '').replace(/\s+/g, '');
  if (k.length >= 4) set.add(k);
  void marca;
  return [...set];
}

export function esMismoProducto(titulo: string, marca: string | null, tokens: string[]): boolean {
  if (tokens.length === 0) return false;
  const t = norm(titulo), palabras = t.split(' '), compacto = palabras.join('');
  const hayToken = tokens.some(k => palabras.includes(k) || compacto.includes(k));
  if (!hayToken) return false;
  const mk = norm(marca || '');
  return !mk || compacto.includes(mk.replace(/\s+/g, ''));
}

/** Separa las candidatas de la búsqueda: solo valen las del MISMO producto (modelo/SKU y marca en el título) y con precio. */
export function clasificarReferencias(candidatas: CandidataMercado[], id: { marca: string | null; tokens: string[] }, hostPropio: string | null): { validas: ReferenciaMercado[]; descartadas: ReferenciaDescartada[] } {
  const validas: ReferenciaMercado[] = [], descartadas: ReferenciaDescartada[] = [];
  const vistas = new Set<string>();
  for (const c of candidatas) {
    const base = { tienda: c.tienda, nombre: c.nombre.slice(0, 140), url: c.url };
    let host = ''; try { host = new URL(c.url).hostname.replace(/^www\./, ''); } catch { /* url rara */ }
    if (hostPropio && host && host === hostPropio) { descartadas.push({ ...base, motivo: 'Es la misma tienda del respaldo de la opción.' }); continue; }
    if (!esMismoProducto(c.nombre, id.marca, id.tokens)) { descartadas.push({ ...base, motivo: 'No es el mismo producto (sin el modelo/SKU en el título): un similar no es referencia.' }); continue; }
    if (c.precioNeto == null || c.precioNeto <= 0) { descartadas.push({ ...base, motivo: 'La página no muestra un precio utilizable.' }); continue; }
    if (vistas.has(c.url)) continue;
    vistas.add(c.url);
    validas.push({ ...base, precioNeto: Math.round(c.precioNeto), canal: c.canal });
  }
  return { validas: validas.sort((a, b) => a.precioNeto - b.precioNeto).slice(0, 8), descartadas: descartadas.slice(0, 8) };
}

export interface FuenteComparador { origen: 'opcion' | 'referencia'; nombre: string; precioNeto: number; url?: string; venteAlEstado?: boolean }
export interface EvaluacionMercado {
  bloqueos: Bloqueo[]; alertas: Alerta[];
  comparador: FuenteComparador[];
  medianaReferencias: number | null;
  dispersion: { activa: boolean; discordantes: string[] };
  ahorroMaximoPct: number | null;
}

/** ¿Hay una justificación del asistente para no usar la referencia más barata? Se guarda como evento (`justificacion_ahorro`). */
export function evaluarMercado(m: ResultadoMercado, costoNetoOpcion: number | null, nombreOpcion: string, hayJustificacion: boolean): EvaluacionMercado {
  const bloqueos: Bloqueo[] = [], alertas: Alerta[] = [];
  const precios = m.referencias.map(r => r.precioNeto);
  const med = mediana(precios);
  const comparador: FuenteComparador[] = [
    ...(costoNetoOpcion != null ? [{ origen: 'opcion' as const, nombre: nombreOpcion, precioNeto: costoNetoOpcion, venteAlEstado: m.competidor?.venteAlEstado }] : []),
    ...m.referencias.map(r => ({ origen: 'referencia' as const, nombre: r.tienda || r.nombre, precioNeto: r.precioNeto, url: r.url })),
  ].sort((a, b) => a.precioNeto - b.precioNeto);

  if (m.error) alertas.push({ codigo: 'V10', nivel: 'info', mensaje: `No se pudieron buscar referencias de mercado: ${m.error}`, accion: 'revisar' });
  else if (m.referencias.length === 0) alertas.push({ codigo: 'V10', nivel: 'info', mensaje: `No se encontraron referencias del MISMO producto en la búsqueda (${m.descartadas.length} candidatas descartadas por no ser el mismo modelo).`, accion: 'revisar' });

  // V10 — la referencia más barata contra el costo de la opción.
  let ahorro: number | null = null;
  if (costoNetoOpcion != null && precios.length) {
    const minRef = Math.min(...precios);
    if (minRef < costoNetoOpcion) {
      ahorro = Math.round(((costoNetoOpcion - minRef) / costoNetoOpcion) * 1000) / 10;
      const barata = m.referencias.find(r => r.precioNeto === minRef)!;
      const texto = `Una referencia del mismo producto cuesta ${ahorro}% menos (${barata.tienda || barata.nombre}: $${minRef.toLocaleString('es-CL')} neto contra $${costoNetoOpcion.toLocaleString('es-CL')}).`;
      if (ahorro >= PARAMS.umbralJustificacionAhorro * 100 - 1e-9) {
        if (hayJustificacion) alertas.push({ codigo: 'V10', nivel: 'info', mensaje: `${texto} El asistente justificó por qué no se usó.`, accion: 'justificar' });
        else bloqueos.push({ codigo: 'V10', mensaje: texto, salida: 'Justifica por qué no usaste esa opción (plazo, garantía, respaldo formal, confiabilidad, stock, despacho, factura) o cambia de proveedor.', accion: 'justificar' });
      } else alertas.push({ codigo: 'V10', nivel: 'info', mensaje: `${texto} Oportunidad de ahorro (menos del ${PARAMS.umbralJustificacionAhorro * 100}%).`, accion: 'revisar' });
    }
  }

  // V10-b — dispersión entre los precios del MISMO producto (la opción y las referencias).
  const conjunto = [...(costoNetoOpcion != null ? [costoNetoOpcion] : []), ...precios];
  const disp = conjunto.length >= 3 ? dispersion(conjunto) : { activa: false, discordantes: [] as number[], mediana: null, n: conjunto.length };
  const discordantes = disp.activa ? disp.discordantes.map(i => (i === 0 && costoNetoOpcion != null ? 'la opción' : (m.referencias[i - (costoNetoOpcion != null ? 1 : 0)]?.tienda || 'una referencia'))) : [];
  if (disp.activa) alertas.push({ codigo: 'V10B', nivel: 'amarillo', mensaje: `OJO CON ESTE PRECIO: los precios del mismo producto se separan más de ${PARAMS.umbralDispersion * 100}% de la mediana ($${Math.round(disp.mediana ?? 0).toLocaleString('es-CL')}). Puede estar en otra moneda, otra unidad o ser un sitio poco serio: revisa ${discordantes.join(', ')}.`, accion: 'revisar' });

  // V9 — proveedor que vende al Estado.
  if (m.competidor?.venteAlEstado) alertas.push({ codigo: 'V9', nivel: 'amarillo', mensaje: `Este proveedor vende directamente al Estado (${m.competidor.nLicitaciones} licitación(es), ${m.competidor.nOrdenesCompra} OC en nuestra base${m.competidor.rubros.length ? `; rubros: ${m.competidor.rubros.join(', ')}` : ''}): puede estar ofertando en esta misma licitación. Es una muestra, no todo MercadoPúblico.`, accion: 'revisar' });

  return { bloqueos, alertas, comparador, medianaReferencias: med != null ? Math.round(med) : null, dispersion: { activa: disp.activa, discordantes }, ahorroMaximoPct: ahorro };
}

/** Suma bloqueos y alertas de mercado al veredicto de costo ya calculado y lo recalcula (misma matriz de la Parte VIII). */
export function aplicarEvaluacion(v: ResultadoVerificacion, ev: { bloqueos: Bloqueo[]; alertas: Alerta[] }): ResultadoVerificacion {
  if (v.veredicto === 'SIN_RESPALDO') return v;
  const bloqueos = [...v.bloqueos, ...ev.bloqueos], alertas = [...v.alertas, ...ev.alertas];
  const veredicto = bloqueos.length ? 'NO_VERIFICADO' : v.requiereHabilitacion ? 'REQUIERE_HABILITACION' : alertas.some(a => a.nivel !== 'info') ? 'VERIFICADO_CON_ALERTAS' : 'VERIFICADO';
  return { ...v, bloqueos, alertas, veredicto };
}
