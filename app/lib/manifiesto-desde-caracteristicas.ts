// app/lib/manifiesto-desde-caracteristicas.ts
// Rescate DETERMINISTA (código, no IA) del manifiesto cuando el modelo dejó el listado real de
// productos como TEXTO dentro de `caracteristicas` de un ítem genérico sin cantidad.
//
// BUG REAL (30-sep-2026, 3477-80-LE26, Municipalidad de Vilcún): las bases técnicas traen, por
// línea, "LINEA: Materiales de Ferretería" seguido de una lista plana "CANT UNIDAD DESCRIPCIÓN"
// (200 un Perfiles…, 1.700 un Pernos…, 50 kg Electrodos…). No es tabla ni "LÍNEA DE PRODUCTO N°X",
// así que ninguna extracción determinista lo tomó, y el modelo resumió cada línea a UN ítem
// genérico con cantidad=0 y los 17 productos como strings en `caracteristicas`. El manifiesto
// quedó con 4 filas (los títulos de línea) y el costeo salió con 1 fila por línea, sin productos
// ni cantidades. Los datos correctos ya estaban en el informe; solo había que desplegarlos.
//
// Módulo puro y sin dependencias: lo usan el análisis (viabilidad-ia.ts) y el adaptador del Excel
// (generar-costeo.ts, para informes ya guardados).

const UNIDADES = [
  'un', 'und', 'unid', 'unidad', 'unidades', 'u', 'kg', 'kgs', 'kilo', 'kilos', 'gr', 'g', 'gal', 'galon', 'galón', 'galones',
  'bid', 'bidon', 'bidón', 'bidones', 'saco', 'sacos', 'lt', 'lts', 'l', 'litro', 'litros', 'm', 'mt', 'mts', 'ml', 'm2', 'm3',
  'metro', 'metros', 'mlin', 'mlineal', 'mlineales', 'caja', 'cajas', 'rollo', 'rollos', 'set', 'kit', 'par', 'pares', 'pza', 'pzas', 'pieza', 'piezas',
  'jgo', 'juego', 'plancha', 'planchas', 'paquete', 'paquetes', 'pqte', 'bolsa', 'bolsas', 'tarro', 'tarros', 'tubo', 'tubos',
  'barra', 'barras', 'docena', 'docenas', 'tambor', 'tambores', 'balde', 'baldes', 'global', 'glb',
];
// Cantidad (con miles "1.700" o decimal "2,5") + unidad conocida + descripción.
const RE_LINEA_CANT = new RegExp(`^\\s*(\\d{1,3}(?:\\.\\d{3})+|\\d+(?:,\\d+)?)\\s+(${UNIDADES.join('|')})\\.?\\s+(\\S.*)$`, 'i');

function numeroCL(s: string): number {
  return Number(s.replace(/\./g, '').replace(',', '.'));
}

export function parsearLineaCantidadUnidad(s: string): { cantidad: number; unidad: string; descripcion: string } | null {
  const m = RE_LINEA_CANT.exec(String(s ?? ''));
  if (!m) return null;
  const cantidad = numeroCL(m[1]);
  if (!Number.isFinite(cantidad) || cantidad <= 0) return null;
  return { cantidad, unidad: m[2].toLowerCase(), descripcion: m[3].trim() };
}

/** Despliega, sobre el listado crudo del modelo (`productos.items`), los ítems que no traen
 *  cantidad propia pero cuyas `caracteristicas` son un listado "CANT UNIDAD DESCRIPCIÓN" (≥3
 *  entradas y ≥80% con ese formato). Cada entrada pasa a ser un ítem propio de la misma línea, con
 *  el mismo presupuesto_linea. Los demás ítems quedan intactos (las fichas de características de
 *  UN producto no calzan: sus specs no empiezan con cantidad + unidad). Devuelve null si no hubo
 *  nada que desplegar, para que el llamador conserve el arreglo original. */
export function desplegarItemsDesdeCaracteristicas(items: any[]): any[] | null {
  if (!Array.isArray(items)) return null;
  let cambio = false;
  const salida: any[] = [];
  for (const it of items) {
    const carac: unknown[] = Array.isArray(it?.caracteristicas) ? it.caracteristicas : [];
    const textos = carac.map(c => String(c ?? '').trim()).filter(Boolean);
    const parseadas = textos.map(parsearLineaCantidadUnidad);
    const calzan = parseadas.filter(Boolean).length;
    if (Number(it?.cantidad) > 0 || textos.length < 3 || calzan < textos.length * 0.8) { salida.push(it); continue; }
    cambio = true;
    textos.forEach((t, i) => {
      const p = parseadas[i];
      salida.push({
        ...it,
        nombre: p ? p.descripcion : t,
        cantidad: p ? p.cantidad : null,
        unidad_medida: p ? p.unidad : '',
        unidad_inferida: false,
        caracteristicas: [],
      });
    });
  }
  return cambio ? salida : null;
}
