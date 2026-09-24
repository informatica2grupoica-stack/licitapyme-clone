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
  const porCorrelativo = new Map(existentes.filter(e => e.correlativo != null).map(e => [e.correlativo as number, e]));
  const sinCorrelativo = existentes.filter(e => e.correlativo == null);
  const libre = (e?: ProductoExistente) => (e && !usados.has(e.id) ? e : undefined);

  const existentePorFila = filas.map(f => {
    let e: ProductoExistente | undefined;
    if (f.lineaPublicada != null) {
      e = libre(porCorrelativo.get(f.lineaPublicada));
      // La fila ganó su número de línea después de crearse el producto: mismo texto = mismo producto.
      if (!e) e = sinCorrelativo.find(x => !usados.has(x.id) && norm(x.descripcion) === norm(f.detalle));
    } else {
      // Sin línea: primero el de la misma descripción; si no, el primero libre sin correlativo (comportamiento de siempre).
      e = sinCorrelativo.find(x => !usados.has(x.id) && norm(x.descripcion) === norm(f.detalle))
        ?? sinCorrelativo.find(x => !usados.has(x.id));
    }
    if (e) usados.add(e.id);
    return e ? e.id : null;
  });

  const descripcionesEmparejadas = new Set(existentes.filter(e => usados.has(e.id)).map(e => norm(e.descripcion)));
  const duplicados = sinCorrelativo.filter(e => !usados.has(e.id) && descripcionesEmparejadas.has(norm(e.descripcion))).map(e => e.id);
  return { existentePorFila, duplicados };
}
