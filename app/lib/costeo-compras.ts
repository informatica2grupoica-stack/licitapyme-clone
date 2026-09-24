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
import { esLinkDeProducto } from '@/app/lib/costeo-comparativo';

const num = (v: unknown): number | null => {
  if (v == null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? n : null;
};
const txt = (v: unknown, max: number): string => String(v ?? '').trim().slice(0, max);
/** Acepta lo mismo que acepta la pantalla (esLinkDeProducto): con protocolo o "tienda.cl/p/1" pegado
 *  de la barra del navegador. Lo segundo se guarda con https:// para que el botón de abrir funcione.
 *  Cualquier otro esquema (javascript:, data:) o una frase suelta se descarta. */
const link = (v: unknown): string => {
  const t = txt(v, 500);
  if (!esLinkDeProducto(t)) return '';
  return /^https?:\/\//i.test(t) ? t : `https://${t}`;
};

/** Fila nueva de Compras = GASTO EXTRA (flete, horas extra, un imprevisto): suma al costo real, no
 *  se vende. Por eso nunca lleva precio de mercado ni margen — aunque el cliente los mande, aquí se
 *  descartan, así no se cuelan a la venta ni al estimado. Sin cantidad se toma 1. */
function filaNueva(f: any, item: number): FilaEditorCosteo {
  return {
    id: txt(f.id, 40) || Math.random().toString(36).slice(2, 10),
    item, lineaReal: f.lineaReal == null ? null : num(f.lineaReal),
    detalle: txt(f.detalle, 300), unidad: txt(f.unidad, 20) || 'UN', skuProveedor: txt(f.skuProveedor, 120),
    cantidad: num(f.cantidad) ?? 1, valorConIva: null, costoRealUnitario: num(f.costoRealUnitario),
    margenVenta: null,
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

// ── Qué cambió Compras (para la bitácora) ─────────────────────────────────────────────────────────
export interface CambiosCompras {
  costosCargados: number;      // filas que pasaron de sin costo real a con costo real
  costosModificados: number;   // filas que ya tenían costo real y cambió el monto
  costosBorrados: number;      // filas a las que se les quitó el costo real
  itemsAgregados: string[];
  itemsEliminados: string[];
  hayCambios: boolean;
}

/** Compara el costeo guardado con el resultante de la fusión y describe lo que hizo Compras. */
export function cambiosDeCompras(antes: EstadoCosteoEditor, despues: EstadoCosteoEditor): CambiosCompras {
  const filasAntes = new Map(antes.grupos.flatMap(g => g.filas).map(f => [f.id, f]));
  const filasDespues = new Map(despues.grupos.flatMap(g => g.filas).map(f => [f.id, f]));
  const c: CambiosCompras = { costosCargados: 0, costosModificados: 0, costosBorrados: 0, itemsAgregados: [], itemsEliminados: [], hayCambios: false };
  for (const [id, f] of filasDespues) {
    const a = filasAntes.get(id);
    if (!a) { c.itemsAgregados.push(f.detalle || `ítem ${f.item}`); continue; }
    if (a.costoRealUnitario == null && f.costoRealUnitario != null) c.costosCargados++;
    else if (a.costoRealUnitario != null && f.costoRealUnitario == null) c.costosBorrados++;
    else if (a.costoRealUnitario !== f.costoRealUnitario) c.costosModificados++;
  }
  for (const [id, a] of filasAntes) if (!filasDespues.has(id)) c.itemsEliminados.push(a.detalle || `ítem ${a.item}`);
  c.hayCambios = !!(c.costosCargados || c.costosModificados || c.costosBorrados || c.itemsAgregados.length || c.itemsEliminados.length);
  return c;
}

export function mensajeCambiosCompras(c: CambiosCompras): string {
  const partes: string[] = [];
  if (c.costosCargados) partes.push(`cargó costo real en ${c.costosCargados} ítem(s)`);
  if (c.costosModificados) partes.push(`corrigió el costo real de ${c.costosModificados} ítem(s)`);
  if (c.costosBorrados) partes.push(`quitó el costo real de ${c.costosBorrados} ítem(s)`);
  if (c.itemsAgregados.length) partes.push(`agregó ${c.itemsAgregados.length} gasto(s) extra: ${c.itemsAgregados.slice(0, 3).map(d => `"${d.slice(0, 40)}"`).join(', ')}`);
  if (c.itemsEliminados.length) partes.push(`eliminó ${c.itemsEliminados.length} gasto(s) extra`);
  return `Compras actualizó el costeo: ${partes.join('; ')}.`;
}
