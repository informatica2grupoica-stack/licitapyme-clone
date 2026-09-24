// app/lib/costeo-compras.ts
// EDICIÓN DEL COSTEO POR EL PERFIL DE COMPRAS (24-sep-2026).
//
// Regla pedida por el usuario: Compras NO puede modificar el costeo armado por los asistentes o el
// encargado de licitaciones (columnas Línea → Precio total neto). Solo puede:
//   · cargar el "Costo unit. REAL" y los Links 1-3 de las filas que ya existen, y
//   · agregar filas nuevas (ítems), que sí puede editar enteras y borrar.
//
// La regla se aplica AQUÍ, sobre lo que el cliente manda, y no en el front: el editor deshabilita
// los campos, pero lo que garantiza que Compras no toque el costeo ajeno es que este merge ignore
// cualquier otro campo. Pura (solo tipos), para poder probarla sin base de datos.
import type { EstadoCosteoEditor, FilaEditorCosteo } from '@/app/lib/costeo-editor';

const num = (v: unknown): number | null => {
  if (v == null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? n : null;
};
const txt = (v: unknown, max: number): string => String(v ?? '').trim().slice(0, max);
const link = (v: unknown): string => {
  const t = txt(v, 500);
  return /^https?:\/\//i.test(t) ? t : '';
};

/** Fila nueva de Compras: se aceptan todos los campos editables, saneados. */
function filaNueva(f: any, item: number): FilaEditorCosteo {
  return {
    id: txt(f.id, 40) || Math.random().toString(36).slice(2, 10),
    item, lineaReal: f.lineaReal == null ? null : num(f.lineaReal),
    detalle: txt(f.detalle, 300), unidad: txt(f.unidad, 20) || 'UN', skuProveedor: txt(f.skuProveedor, 120),
    cantidad: num(f.cantidad), valorConIva: num(f.valorConIva), costoRealUnitario: num(f.costoRealUnitario),
    margenVenta: f.margenVenta == null ? null : num(f.margenVenta),
    link1: link(f.link1), link2: link(f.link2), link3: link(f.link3),
    agregadoPorCompras: true,
  };
}

export type ResultadoFusion =
  | { ok: true; estado: EstadoCosteoEditor }
  | { ok: false; error: string };

/**
 * Aplica la edición que mandó Compras sobre el costeo GUARDADO. Devuelve el estado resultante, o un
 * error. Lo único que cambia de una fila existente es costoRealUnitario y los tres links.
 */
export function fusionarEdicionCompras(guardado: EstadoCosteoEditor, cliente: { grupos?: any[] }): ResultadoFusion {
  const gc = Array.isArray(cliente?.grupos) ? cliente.grupos : [];
  if (gc.length !== guardado.grupos.length) {
    return { ok: false, error: 'El costeo cambió mientras lo editabas (distinta cantidad de hojas). Recarga y vuelve a intentar.' };
  }
  const sinLink: string[] = [];
  const grupos = guardado.grupos.map((g, gi) => {
    const filasCliente: any[] = Array.isArray(gc[gi]?.filas) ? gc[gi].filas : [];
    const porId = new Map(filasCliente.map(f => [String(f?.id), f]));
    const idsGuardados = new Set(g.filas.map(f => f.id));
    const filas: FilaEditorCosteo[] = [];

    for (const f of g.filas) {
      const c = porId.get(f.id);
      if (f.agregadoPorCompras) {
        if (!c) continue; // Compras borró su propia fila
        filas.push(filaNueva({ ...c, id: f.id }, f.item));
      } else {
        // Fila ajena: el resto de lo que mande el cliente se ignora.
        filas.push(c ? { ...f, costoRealUnitario: num(c.costoRealUnitario), link1: link(c.link1), link2: link(c.link2), link3: link(c.link3) } : f);
      }
    }
    for (const c of filasCliente) {
      if (idsGuardados.has(String(c?.id))) continue;
      filas.push(filaNueva(c, 0));
    }
    filas.forEach((f, i) => { f.item = i + 1; });
    for (const f of filas) if (f.costoRealUnitario != null && !f.link1) sinLink.push(f.detalle || `ítem ${f.item}`);
    return { ...g, filas };
  });

  if (sinLink.length) {
    const muestra = sinLink.slice(0, 3).map(d => `"${d.slice(0, 40)}"`).join(', ');
    return { ok: false, error: `Falta el link (Link 1) donde cotizaste el costo real de: ${muestra}${sinLink.length > 3 ? ` y ${sinLink.length - 3} más` : ''}.` };
  }
  return { ok: true, estado: { ...guardado, grupos } };
}
