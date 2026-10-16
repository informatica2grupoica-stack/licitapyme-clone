// app/lib/compras-producto-sync.ts
// EMPAREJAMIENTO costeo ↔ "Productos y cobertura" (compras_producto) — pura, para poder probarla.
//
// BUG REAL (24-sep-2026, negocio #994): una fila del costeo que primero no tenía "Línea" y después la
// recibió se veía DOS veces en Productos y cobertura. La sincronización solo emparejaba por número de
// línea: al aparecer la línea 2, no encontraba ninguna fila con correlativo 2 y creaba una nueva,
// dejando la vieja (sin correlativo) huérfana para siempre. Ahora una fila sin correlativo con la MISMA
// descripción se reutiliza (y recibe el correlativo), y las que igual quedaron duplicadas se reportan
// para limpiarlas.
export interface ProductoExistente { id: number; correlativo: number | null; descripcion: string }
export interface FilaDelCosteo { lineaPublicada: number | null; detalle: string | null }

const norm = (s: string | null | undefined) =>
  (s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim();

export interface Emparejamiento {
  /** Por cada fila del costeo (mismo orden), el id del producto existente que le corresponde, o null = crear uno nuevo. */
  existentePorFila: (number | null)[];
  /** Productos sin correlativo que quedaron sin fila y repiten la descripción de uno ya emparejado. */
  duplicados: number[];
}

export function emparejarProductos(existentes: ProductoExistente[], filas: FilaDelCosteo[]): Emparejamiento {
  const usados = new Set<number>();
  // VARIAS filas pueden compartir el mismo número de línea (un grupo de suma alzada: «Línea 2» agrupa 5 productos). Antes el mapa
  // guardaba UNA sola fila por línea, y en cada sincronización las demás se creaban de nuevo: 5 productos pasaban a 13, 21, …
  const porCorrelativo = new Map<number, ProductoExistente[]>();
  for (const e of existentes) if (e.correlativo != null) porCorrelativo.set(e.correlativo, [...(porCorrelativo.get(e.correlativo) ?? []), e]);
  const sinCorrelativo = existentes.filter(e => e.correlativo == null);
  const asignado: (ProductoExistente | undefined)[] = filas.map(() => undefined);
  const tomar = (i: number, e?: ProductoExistente) => { if (e && !usados.has(e.id) && !asignado[i]) { usados.add(e.id); asignado[i] = e; } };

  // 1) Misma línea y misma descripción: es el mismo producto.
  filas.forEach((f, i) => {
    if (f.lineaPublicada == null) return;
    tomar(i, (porCorrelativo.get(f.lineaPublicada) ?? []).find(x => !usados.has(x.id) && norm(x.descripcion) === norm(f.detalle)));
  });
  // 2) Misma línea pero la descripción cambió: el primero que quede libre de esa línea.
  filas.forEach((f, i) => {
    if (f.lineaPublicada == null || asignado[i]) return;
    tomar(i, (porCorrelativo.get(f.lineaPublicada) ?? []).find(x => !usados.has(x.id)));
  });
  // 3) La fila ganó su número de línea después de crearse el producto: mismo texto = mismo producto.
  filas.forEach((f, i) => {
    if (f.lineaPublicada == null || asignado[i]) return;
    tomar(i, sinCorrelativo.find(x => !usados.has(x.id) && norm(x.descripcion) === norm(f.detalle)));
  });
  // 4) Sin línea: primero el de la misma descripción; si no, el primero libre sin correlativo (comportamiento de siempre).
  filas.forEach((f, i) => {
    if (f.lineaPublicada != null || asignado[i]) return;
    tomar(i, sinCorrelativo.find(x => !usados.has(x.id) && norm(x.descripcion) === norm(f.detalle)) ?? sinCorrelativo.find(x => !usados.has(x.id)));
  });

  const existentePorFila = asignado.map(e => (e ? e.id : null));
  // Sobrantes que repiten la descripción de un producto ya emparejado (con o sin correlativo): el borrado solo los toca si no tienen NADA colgando.
  const descripcionesEmparejadas = new Set(existentes.filter(e => usados.has(e.id)).map(e => norm(e.descripcion)));
  const duplicados = existentes.filter(e => !usados.has(e.id) && descripcionesEmparejadas.has(norm(e.descripcion))).map(e => e.id);
  return { existentePorFila, duplicados };
}
