// app/lib/competencia-core.ts
// Cálculos puros del módulo «Competencia y mercado» (fase 1: Resumen y Competidores). Sin BD ni red: reciben los negocios
// y la adjudicación que ya entregan /api/negocios y /api/postuladas/estado, así que cada empresa-cliente ve solo lo suyo.
//
// Mismo criterio que /adjudicadas (no se tocó esa pantalla): resultado = lo que dice el acta de MP si está completa; si no,
// el estado ya promovido. Competidor = RUT sin puntos (si falta, el nombre). Monto de una línea = precio × cantidad.
import { normalizarEstado } from '@/app/lib/pipeline';

export interface NegocioComp {
  licitacion_codigo: string; licitacion_nombre?: string | null; licitacion_organismo?: string | null;
  estado_pipeline: string | null; empresa_nombre?: string | null; monto_ofertado?: number;
}
export interface LineaAdj {
  cantidad?: number; montoUnitario: number | null; rutProveedor: string | null; proveedor: string | null; esNuestra?: boolean;
}
export interface AdjComp {
  esAdjudicada: boolean; ganamos?: boolean; montoNuestro?: number | null; fechaAdjudicacion?: string | null;
  adjudicacion?: { numeroOferentes?: number | null } | null;
  lineasAdjudicadas?: LineaAdj[]; montoAdjudicadoTotal?: number | null;
}

export type Resultado = 'ganada' | 'perdida';
export interface LicitacionPerdida { codigo: string; nombre: string; empresa: string | null; organismo: string | null; fecha: string | null; lineas: number; lineasTotal: number; monto: number }
export interface Competidor { clave: string; nombre: string; rut: string | null; licitaciones: number; monto: number; detalle: LicitacionPerdida[] }
export interface ResumenCompetencia {
  resueltas: number; ganadas: number; perdidas: number;
  /** ganadas ÷ (ganadas + perdidas); null si no hay resueltas. */
  efectividad: number | null;
  montoGanado: number;
  /** Perdidas con acta y detalle por línea (las que entran al ranking). */
  perdidasConDetalle: number; perdidasSinDetalle: number;
  competidoresDistintos: number; montoAdjudicadoATerceros: number;
  /** Mediana de oferentes de las licitaciones resueltas que traen el dato, y cuántas lo traen. */
  oferentesMediana: number | null; oferentesConDato: number;
}
export interface PorEmpresa { empresa: string; ganadas: number; perdidas: number; efectividad: number | null; montoGanado: number }

export function claveProveedor(l: LineaAdj): string {
  const rut = (l.rutProveedor || '').replace(/[.\s]/g, '').toUpperCase();
  return rut || (l.proveedor || '').trim().toUpperCase();
}

/** Resultado real: si el acta de MP está completa manda ese; si no, el estado ya promovido por el cron. */
export function resultadoDe(n: NegocioComp, adj?: AdjComp | null): Resultado {
  if (adj?.esAdjudicada && typeof adj.ganamos === 'boolean') return adj.ganamos ? 'ganada' : 'perdida';
  return normalizarEstado(n.estado_pipeline) === 'PERDIDA' ? 'perdida' : 'ganada';
}

/** ¿Está resuelta? Manda el cache de adjudicación; si aún no hay, el estado ya promovido. */
export function esResuelta(n: NegocioComp, adj?: AdjComp | null): boolean {
  if (adj) return !!adj.esAdjudicada;
  const e = normalizarEstado(n.estado_pipeline);
  return e === 'ADJUDICADA' || e === 'PERDIDA';
}

/** Una fila por código de licitación (la de id mayor), solo en estados que pueden estar resueltos. */
export function universoResuelto(todas: (NegocioComp & { id: number })[]): (NegocioComp & { id: number })[] {
  const permitidos = ['ADJUDICADA', 'PERDIDA', 'POSTULADA', 'POSIBLE_ADJ'];
  const porCodigo = new Map<string, NegocioComp & { id: number }>();
  for (const n of todas) {
    if (!n.licitacion_codigo || !permitidos.includes(n.estado_pipeline || '')) continue;
    const prev = porCodigo.get(n.licitacion_codigo);
    if (!prev || n.id > prev.id) porCodigo.set(n.licitacion_codigo, n);
  }
  return [...porCodigo.values()];
}

function mediana(xs: number[]): number | null {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b), m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

export function calcularCompetencia(negocios: NegocioComp[], adj: Record<string, AdjComp | null>) {
  const resueltas = negocios.filter(n => esResuelta(n, adj[n.licitacion_codigo]));
  let ganadas = 0, perdidas = 0, montoGanado = 0, sinDetalle = 0;
  const oferentes: number[] = [];
  const comp = new Map<string, { clave: string; nombres: Map<string, number>; rut: string | null; detalle: Map<string, LicitacionPerdida>; monto: number }>();
  const emp = new Map<string, PorEmpresa>();

  for (const n of resueltas) {
    const a = adj[n.licitacion_codigo] || null;
    const r = resultadoDe(n, a);
    const nombreEmp = n.empresa_nombre || 'Sin empresa';
    const pe = emp.get(nombreEmp) || { empresa: nombreEmp, ganadas: 0, perdidas: 0, efectividad: null, montoGanado: 0 };
    const nOf = Number(a?.adjudicacion?.numeroOferentes);
    if (Number.isFinite(nOf) && nOf > 0) oferentes.push(nOf);

    if (r === 'ganada') {
      ganadas++; pe.ganadas++;
      if (a?.ganamos && a.montoNuestro) { montoGanado += a.montoNuestro; pe.montoGanado += a.montoNuestro; }
    } else {
      perdidas++; pe.perdidas++;
      const lineas = (a?.lineasAdjudicadas || []).filter(l => !l.esNuestra && claveProveedor(l));
      if (!a?.esAdjudicada || lineas.length === 0) sinDetalle++;
      else for (const l of lineas) {
        const clave = claveProveedor(l);
        const e = comp.get(clave) || { clave, nombres: new Map(), rut: l.rutProveedor, detalle: new Map(), monto: 0 };
        const nombre = (l.proveedor || l.rutProveedor || 'Proveedor').trim();
        e.nombres.set(nombre, (e.nombres.get(nombre) || 0) + 1);
        const montoLinea = (Number(l.montoUnitario) || 0) * (Number(l.cantidad) || 1);
        const d = e.detalle.get(n.licitacion_codigo) || {
          codigo: n.licitacion_codigo, nombre: n.licitacion_nombre || n.licitacion_codigo, empresa: n.empresa_nombre || null,
          organismo: n.licitacion_organismo || null, fecha: a.fechaAdjudicacion || null, lineas: 0, lineasTotal: (a.lineasAdjudicadas || []).length, monto: 0,
        };
        d.lineas++; d.monto += montoLinea;
        e.detalle.set(n.licitacion_codigo, d);
        e.monto += montoLinea;
        comp.set(clave, e);
      }
    }
    emp.set(nombreEmp, pe);
  }

  const competidores: Competidor[] = [...comp.values()].map(e => ({
    clave: e.clave, rut: e.rut, licitaciones: e.detalle.size, monto: e.monto,
    detalle: [...e.detalle.values()].sort((x, y) => (Date.parse(y.fecha || '') || 0) - (Date.parse(x.fecha || '') || 0)),
    nombre: [...e.nombres.entries()].sort((x, y) => y[1] - x[1])[0][0],
  })).sort((x, y) => y.licitaciones - x.licitaciones || y.monto - x.monto);

  const porEmpresa: PorEmpresa[] = [...emp.values()].map(e => ({
    ...e, efectividad: e.ganadas + e.perdidas ? e.ganadas / (e.ganadas + e.perdidas) : null,
  })).sort((x, y) => (y.ganadas + y.perdidas) - (x.ganadas + x.perdidas));

  const resumen: ResumenCompetencia = {
    resueltas: resueltas.length, ganadas, perdidas,
    efectividad: ganadas + perdidas ? ganadas / (ganadas + perdidas) : null,
    montoGanado,
    perdidasConDetalle: perdidas - sinDetalle, perdidasSinDetalle: sinDetalle,
    competidoresDistintos: competidores.length,
    montoAdjudicadoATerceros: competidores.reduce((s, c) => s + c.monto, 0),
    oferentesMediana: mediana(oferentes), oferentesConDato: oferentes.length,
  };
  return { resumen, competidores, porEmpresa };
}
