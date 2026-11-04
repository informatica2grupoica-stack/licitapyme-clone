// app/lib/auditor-ranking-fichas.ts
// «¿Qué ficha cumple más?» en el Auditor del negocio: cuando una línea tiene 2 o más opciones con ficha técnica, las ordena por la proporción de
// requisitos de las bases que cumplen (la misma regla del panel de Compras) y dice cuál gana, si empatan y cuáles faltan por comparar.
export interface OpcionParaRanking {
  id: number; nombre: string; proveedor: string | null; fichas: string[];
  estado: string; cumple: number | null; total: number | null; noCumple: number | null;
}
export interface FilaRanking extends OpcionParaRanking { pct: number }
export interface Ranking {
  filas: FilaRanking[];             // comparadas, de la que más cumple a la que menos
  ganadoraId: number | null;        // null si empatan o no hay contra quién ganar
  empatan: number[];                // ids empatados en el primer lugar (más de uno)
  ningunaCumple: boolean;
  sinComparar: OpcionParaRanking[]; // con ficha pero sin comparación contra las bases todavía
}

const comparada = (o: OpcionParaRanking) => o.fichas.length > 0 && o.total != null && o.total > 0 && o.cumple != null;

export function rankearFichas(opciones: OpcionParaRanking[]): Ranking {
  const conFicha = opciones.filter(o => o.fichas.length > 0);
  const filas: FilaRanking[] = conFicha.filter(comparada)
    .map(o => ({ ...o, pct: Math.round((o.cumple! / o.total!) * 100) }))
    .sort((a, b) => b.cumple! / b.total! - a.cumple! / a.total! || (a.noCumple ?? 0) - (b.noCumple ?? 0) || a.id - b.id);
  const sinComparar = conFicha.filter(o => !comparada(o));
  if (filas.length === 0) return { filas, ganadoraId: null, empatan: [], ningunaCumple: false, sinComparar };
  const top = filas[0];
  const empatan = filas.filter(f => f.cumple! / f.total! === top.cumple! / top.total! && (f.noCumple ?? 0) === (top.noCumple ?? 0)).map(f => f.id);
  return { filas, ganadoraId: empatan.length === 1 && filas.length > 1 ? top.id : null, empatan: empatan.length > 1 ? empatan : [], ningunaCumple: !filas.some(f => f.estado === 'CUMPLE'), sinComparar };
}
