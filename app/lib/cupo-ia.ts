// app/lib/cupo-ia.ts
// Limita cuántas llamadas a la IA corren A LA VEZ por grupo (dentro de este proceso). Caso real (07-oct-2026): al subir 6 cotizaciones
// juntas, cada una disparaba lectura + homologación + auditoría en paralelo (~30 llamadas) y el proveedor respondió con 429 y timeouts;
// una cotización quedó sin leer. Con un cupo chico las llamadas hacen fila en vez de competir, y ninguna se pierde.

const grupos = new Map<string, { activos: number; fila: Array<() => void> }>();

export async function conCupo<T>(grupo: string, max: number, fn: () => Promise<T>): Promise<T> {
  let g = grupos.get(grupo);
  if (!g) { g = { activos: 0, fila: [] }; grupos.set(grupo, g); }
  if (g.activos >= max) await new Promise<void>(res => g!.fila.push(res));
  g.activos++;
  try { return await fn(); }
  finally {
    g.activos--;
    const sig = g.fila.shift();
    if (sig) sig();
  }
}
