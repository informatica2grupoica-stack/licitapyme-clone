// app/lib/compras-recomendaciones.ts
// DE 952 COMBINACIONES A UNAS POCAS RECOMENDADAS — funciones PURAS, con pruebas.
//
// Pedido del usuario (07-oct-2026): «eso no me puede dar tantas combinaciones». Con 8 proveedores y 3 productos hay cientos de
// formas de repartir la compra, y nadie las lee. Se muestran pocas, cada una con la razón por la que está ahí:
//   · TODO A UN PROVEEDOR  — comprarle todo a uno solo (menos viajes, una sola coordinación); hasta 3, las más baratas;
//   · MÁS BARATA           — el menor costo total (mercadería + flete);
//   · MÁS RÁPIDA           — el menor plazo; si hay empate, la más barata;
//   · EQUILIBRADA          — la que mejor reparte precio, plazo y viajes.
// Siempre se prefieren las que CUMPLEN (sin problemas críticos); solo si ninguna cumple se usan las "inferiores negociables".
// Nada se excluye (§8.8.1): lo que no se recomienda sigue disponible armando la compra a mano en la matriz.

export type EtiquetaRecomendada = 'UN_PROVEEDOR' | 'MAS_BARATA' | 'MAS_RAPIDA' | 'EQUILIBRADA';

export interface CombinacionMin {
  clave: string; costoTotal: number; diasEstimados: number | null; viajes: number; nProveedores: number; proveedores: string[]; peorCumple: string;
}

const tier = (c: string): number => ({ CUMPLE: 0, MEJORA: 0, INFERIOR_NEGOCIABLE: 1, INFERIOR_INSALVABLE: 2 } as Record<string, number>)[c] ?? 3;
const dias = (c: CombinacionMin): number => c.diasEstimados ?? Number.POSITIVE_INFINITY;

export function recomendarCombinaciones<T extends CombinacionMin>(combos: T[], maxUnProveedor = 3): Array<{ comb: T; etiquetas: EtiquetaRecomendada[] }> {
  if (combos.length === 0) return [];
  const mejorTier = Math.min(...combos.map(c => tier(c.peorCumple)));
  const pool = combos.filter(c => tier(c.peorCumple) === mejorTier);

  const elegidas = new Map<string, { comb: T; etiquetas: EtiquetaRecomendada[] }>();
  const poner = (comb: T | undefined, et: EtiquetaRecomendada) => {
    if (!comb) return;
    const e = elegidas.get(comb.clave);
    if (e) { if (!e.etiquetas.includes(et)) e.etiquetas.push(et); } else elegidas.set(comb.clave, { comb, etiquetas: [et] });
  };

  // Todo a un proveedor: la mejor combinación de cada proveedor que cubre todo con una sola cotización, las más baratas primero.
  // Aquí cuenta el cumplimiento de cada una por separado (un proveedor con problemas igual puede ser la única forma de comprar a uno solo).
  const porProveedor = new Map<string, T>();
  for (const c of combos.filter(x => x.nProveedores === 1)) {
    const prov = c.proveedores[0];
    const actual = porProveedor.get(prov);
    if (!actual || tier(c.peorCumple) < tier(actual.peorCumple) || (tier(c.peorCumple) === tier(actual.peorCumple) && c.costoTotal < actual.costoTotal)) porProveedor.set(prov, c);
  }
  [...porProveedor.values()]
    .sort((a, b) => tier(a.peorCumple) - tier(b.peorCumple) || a.costoTotal - b.costoTotal)
    .slice(0, maxUnProveedor)
    .forEach(c => poner(c, 'UN_PROVEEDOR'));

  const masBarata = [...pool].sort((a, b) => a.costoTotal - b.costoTotal || dias(a) - dias(b))[0];
  const masRapida = [...pool].sort((a, b) => dias(a) - dias(b) || a.costoTotal - b.costoTotal)[0];
  poner(masBarata, 'MAS_BARATA');
  poner(masRapida, 'MAS_RAPIDA');

  // Equilibrada: puntaje 0..1 de cada eje (costo 50 %, plazo 30 %, viajes 20 %); gana el menor.
  const costos = pool.map(c => c.costoTotal), plazos = pool.map(dias).filter(Number.isFinite), viajes = pool.map(c => c.viajes);
  const norm = (v: number, xs: number[]) => { const mn = Math.min(...xs), mx = Math.max(...xs); return mx === mn ? 0 : (v - mn) / (mx - mn); };
  const puntaje = (c: CombinacionMin) => 0.5 * norm(c.costoTotal, costos) + 0.3 * (Number.isFinite(dias(c)) && plazos.length ? norm(dias(c), plazos) : 1) + 0.2 * norm(c.viajes, viajes);
  poner([...pool].sort((a, b) => puntaje(a) - puntaje(b) || a.costoTotal - b.costoTotal)[0], 'EQUILIBRADA');

  const orden: EtiquetaRecomendada[] = ['EQUILIBRADA', 'MAS_RAPIDA', 'MAS_BARATA', 'UN_PROVEEDOR'];
  return [...elegidas.values()].sort((a, b) => Math.min(...a.etiquetas.map(e => orden.indexOf(e))) - Math.min(...b.etiquetas.map(e => orden.indexOf(e))) || a.comb.costoTotal - b.comb.costoTotal);
}
