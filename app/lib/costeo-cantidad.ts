// Qué ítems del costeo cambiaron de CANTIDAD entre dos guardados (pura, sin BD).
// Las filas se emparejan por `id` (se guarda en datos_json y sobrevive entre guardados). Solo cuentan los ítems que
// existían antes y siguen existiendo: agregar o quitar un ítem no es «modificar la cantidad». Los costos adicionales
// no llevan cantidad. Sin guardado previo no hay nada con qué comparar (la propuesta inicial nace de la viabilidad).
import type { EstadoCosteoEditor } from '@/app/lib/costeo-editor-fusion';

const num = (n: number | null | undefined) => n == null ? 'vacío' : String(n).replace('.', ',');

export function cambiosDeCantidad(antes: EstadoCosteoEditor | null, despues: EstadoCosteoEditor): string[] {
  if (!antes) return [];
  const previas = new Map(antes.grupos.flatMap(g => g.filas).map(f => [f.id, f]));
  const out: string[] = [];
  for (const g of despues.grupos) for (const f of g.filas) {
    const a = previas.get(f.id);
    if (!a || a.esCostoAdicional || f.esCostoAdicional) continue;
    if ((a.cantidad ?? null) === (f.cantidad ?? null)) continue;
    out.push(`«${(f.detalle || `ítem ${f.item}`).trim().slice(0, 50)}»: ${num(a.cantidad)} → ${num(f.cantidad)}`);
  }
  return out;
}
