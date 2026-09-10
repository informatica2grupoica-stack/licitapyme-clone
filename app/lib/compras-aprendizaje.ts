// app/lib/compras-aprendizaje.ts
// VISIÓN DE APRENDIZAJE (spec §19) — dentro del alcance (§19.3): "sugerencia de proveedor
// histórico. OBUMA ya está conectado y existen proyectos desde 2020. Comportamiento esperado: si
// el sensor X se compró 20 veces al proveedor Y, el sistema lo propone con su precio histórico,
// sin que nadie lo pregunte. Endpoints que la sostienen: comprasOc.listItems.json y
// ventas.listItems.json, ambos filtrables por SKU."
//
// FUERA DE ALCANCE (§19.4, explícito en la spec — no se construye acá): "búsqueda automática en
// Internet de alternativa más barata" y "búsqueda automática de compra... apoyada en el buscador de
// ferretería."
//
// POR QUÉ ES BAJO DEMANDA Y NO AUTOMÁTICO EN CADA CARGA: la propia spec (§7.2) advierte que la API
// de OBUMA tiene un límite de 1.000 consultas diarias POR ENDPOINT — disparar esta búsqueda sola en
// cada vista de cada producto de cada negocio agotaría la cuota rápido. Se dispara con un botón, no
// solo (mismo criterio que `calcularEscenariosMulta` en compras-reloj.ts).
//
// POR QUÉ REQUIERE SKU HOMOLOGADO: `comprasOc.listItems.json` se filtra por el ID de producto DE
// OBUMA (parámetro real "producto" — verificado en vivo 10-sep-2026, "producto_id" NO filtra nada
// y se usó por error hasta esa fecha, bug real: mostraba proveedores de cualquier producto), no por
// texto libre — homologar por nombre/descripción sería adivinar qué ítem de OBUMA es "el mismo" que
// el nuestro, y esa clase de match difuso ya causó bugs reales en este proyecto (ver memoria:
// homologación de productos por texto). Sin `compras_sku.obuma_producto_id` (§7.4, homologación de
// códigos — hoy manual, la sync automática sigue en standby por §7.5) esta función no inventa una
// respuesta: devuelve null.
import { listarComprasOcItems, compraOcPorId, proveedorPorId } from '@/app/lib/obuma';

export interface SugerenciaProveedorHistorico {
  proveedorNombre: string; proveedorRut: string | null; vecesComprado: number; precioPromedio: number | null; precioMasReciente: number | null;
}

export async function sugerenciaProveedorHistorico(obumaProductoId: string): Promise<SugerenciaProveedorHistorico[]> {
  const listado = await listarComprasOcItems({ producto: obumaProductoId, limit: 50 });
  const items = listado?.data || [];
  if (items.length === 0) return [];

  // Un mismo proveedor puede aparecer en varias OC — se agrupa por rel_compra_oc_id primero para
  // no llamar compraOcPorId más veces de las necesarias, y se cachea proveedorPorId por RUT/ID.
  const ocIds = [...new Set(items.map(it => it.rel_compra_oc_id).filter(Boolean))].slice(0, 20);
  const proveedorPorOc = new Map<string, string | null>();
  await Promise.all(ocIds.map(async ocId => {
    try {
      const oc = await compraOcPorId(ocId);
      proveedorPorOc.set(ocId, (oc as any)?.rel_proveedor_id ?? null);
    } catch { proveedorPorOc.set(ocId, null); }
  }));

  const proveedorIds = [...new Set([...proveedorPorOc.values()].filter((v): v is string => !!v))];
  const nombresPorId = new Map<string, { nombre: string; rut: string | null }>();
  await Promise.all(proveedorIds.map(async pid => {
    try {
      const p = await proveedorPorId(pid);
      if (p) nombresPorId.set(pid, { nombre: p.proveedor_razon_social || p.proveedor_nombre_fantasia, rut: p.proveedor_rut || null });
    } catch { /* proveedor no resuelto: ese ítem no cuenta */ }
  }));

  const acumulado = new Map<string, { nombre: string; rut: string | null; veces: number; sumaPrecio: number; conPrecio: number; ultimoPrecio: number | null }>();
  for (const it of items) {
    const pid = proveedorPorOc.get(it.rel_compra_oc_id);
    if (!pid) continue;
    const info = nombresPorId.get(pid);
    if (!info) continue;
    const precio = Number(it.precio);
    const actual = acumulado.get(pid) || { nombre: info.nombre, rut: info.rut, veces: 0, sumaPrecio: 0, conPrecio: 0, ultimoPrecio: null };
    actual.veces++;
    if (Number.isFinite(precio) && precio > 0) { actual.sumaPrecio += precio; actual.conPrecio++; actual.ultimoPrecio = precio; }
    acumulado.set(pid, actual);
  }

  return [...acumulado.values()]
    .map(a => ({
      proveedorNombre: a.nombre, proveedorRut: a.rut, vecesComprado: a.veces,
      precioPromedio: a.conPrecio > 0 ? Math.round(a.sumaPrecio / a.conPrecio) : null, precioMasReciente: a.ultimoPrecio,
    }))
    .sort((a, b) => b.vecesComprado - a.vecesComprado);
}
