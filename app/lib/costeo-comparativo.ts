// app/lib/costeo-comparativo.ts
// CUADRO COMPARATIVO DEL COSTEO — el mismo bloque de totales que el comercial arma a mano al pie
// del Excel (pedido del usuario, 03-sep-2026, con la planilla real a la vista):
//
//   ┌ estimado (lo que sale del costeo) ──────┐   ┌ real (lo que de verdad costó) ──────┐
//   │ Total venta C/IVA      23.272.024       │   │ Total neto          19.556.323      │
//   │ Venta IVA               3.715.701       │   │ Total costo REAL    15.100.000      │
//   │ Total neto venta       19.556.323       │   │ Utilidad neta REAL   4.456.323      │
//   │ Total costo neto       15.645.076       │   │ % Margen                    23%     │
//   │ Utilidad total neta     3.911.247       │   │ % de Variación              -3%     │
//   │ % Margen                      20%       │   └─────────────────────────────────────┘
//   │ % distancia del presup.       -8%       │
//   └─────────────────────────────────────────┘
//
// Fórmulas verificadas 1:1 contra el Excel real (COSTEO_1271359-92-LE26, hoja "canasta 2"):
//   H16 = K16*1,19        Total venta C/iva          H17 = K16*19%   venta iva
//   K16 = SUM(K)          Total neto venta           K17 = SUM(H)    Total costo neto
//   K18 = K16-K17         Utilidad total neta        K19 = 1-(K17/K16)   % Margen
//   K14 = F15/1,19        Presupuesto neto (F15 se tipea CON IVA)
//   K20 = 1-(K16/K14)     % distancia del tope
//   N16 = K12 (venta)     N17 = SUM(M) = SUM(L×E)    N18 = N16-N17   Utilidad neta REAL
// DOS CELDAS DEL EXCEL ESTÁN MALAS y acá se implementó lo que querían decir, no lo que dicen:
//   · N19 "% Margen" REAL apunta a M17/M16, que son las CELDAS DE TEXTO de las etiquetas — por eso
//     en la planilla sale #¡VALOR!. Debía ser 1-(N17/N16). Acá: utilidad real / venta.
//   · N20 "% de Variación" apunta a M12, que es la SUMA del costo real, no una variación — por eso
//     marcaba 0% con el costo real vacío. Acá se usa la fórmula de la columna N de las filas,
//     =(L/G)-1, pero sobre los TOTALES (el AVERAGE de N12 pesa igual un ítem de $80.000 que uno de
//     $3.000.000).
//
// Ojo con los dos porcentajes que se parecen y NO son lo mismo:
//   · el margen de la plantilla (MARGEN_VENTA_DEFECTO, 27%) es un RECARGO SOBRE EL COSTO
//     (precio = costo × 1.27) — es lo que se tipea arriba en el editor;
//   · el "% Margen" de este cuadro es utilidad SOBRE LA VENTA (3.911.247 / 19.556.323 = 20%) —
//     que es el número que se mira para decidir. Un recargo de 27% da un margen de 21,3%.
// Se calcula acá, en un módulo sin dependencias, para que el editor (cliente) y el backend usen
// exactamente la misma aritmética en vez de duplicarla — ver la cabecera de costeo-editor.ts.

export interface EntradaComparativo {
  /** Σ Precio total neto de las filas ofertadas (columna K de la plantilla). */
  ventaNeta: number;
  /** Σ Costo total neto ESTIMADO (columna H) — lo que se supuso al cotizar. */
  costoNetoEstimado: number;
  /** Σ (cantidad × costo real unitario neto) de las filas que YA tienen costo real cargado. */
  costoNetoReal: number | null;
  /** Cuántas filas ofertadas tienen costo real y cuántas son en total — el cuadro REAL no significa
   *  nada si está a medio llenar, así que se muestra el avance en vez de un total falso. */
  filasConCostoReal: number;
  filasTotales: number;
  /** Presupuesto NETO de la licitación (publicado o corregido a mano). null = no hay. */
  presupuestoNeto: number | null;
}

export interface Comparativo {
  ventaConIva: number;
  ventaIva: number;
  ventaNeta: number;
  costoNetoEstimado: number;
  utilidadEstimada: number;
  /** Utilidad / venta neta, en % (no es el recargo sobre el costo). null si no hay venta. */
  margenEstimado: number | null;
  presupuestoNeto: number | null;
  presupuestoConIva: number | null;
  /** (presupuesto − venta) / presupuesto, en %. Negativo = la oferta se pasó del presupuesto. */
  distanciaPresupuesto: number | null;
  costoNetoReal: number | null;
  utilidadReal: number | null;
  margenReal: number | null;
  /** (costo real − costo estimado) / costo estimado, en %. Negativo = se compró más barato de lo
   *  cotizado. null mientras no haya ningún costo real cargado. */
  variacionCosto: number | null;
  filasConCostoReal: number;
  filasTotales: number;
  /** true solo si TODAS las filas ofertadas ya tienen costo real: recién ahí el bloque REAL es un
   *  cierre y no una foto a medias. */
  realCompleto: boolean;
}

export const IVA = 1.19;

/** Recargo sobre el COSTO que hay que aplicar para quedarse con `m`% de utilidad sobre la VENTA —
 *  el reverso exacto de margen = recargo / (1 + recargo). Pedir 20% s/venta ⇒ 25% s/costo; 25% ⇒
 *  33,3%. Sirve para editar el cuadro "al revés": se escribe el margen que se quiere y el editor
 *  despeja el recargo de esa hoja. null si el margen es imposible (≥100% pediría precio infinito). */
export function recargoParaMargen(m: number): number | null {
  if (!Number.isFinite(m) || m >= 100) return null;
  return (m / (100 - m)) * 100;
}

/** margen sobre la venta que deja un recargo sobre el costo — la ida del cálculo de arriba. */
export function margenDeRecargo(recargo: number): number {
  return (recargo / (1 + recargo / 100));
}

/** Lee el recargo que alguien tipeó en la columna "% margen" de una fila del costeo. Acepta las
 *  dos formas en que el asistente escribe el margen en su Excel: el recargo en % ("110", "110%")
 *  o el multiplicador ("x2,1" / "2,1x"), que es literal lo que hay en la celda I4 del
 *  COSTEO_1114-12-LE26 (=G4*2.1). Coma o punto decimal, da lo mismo.
 *
 *  '' (vacío) ⇒ null: la fila vuelve a heredar el margen del costeo. Basura o un recargo ≤ −100%
 *  (vender a $0 o menos) ⇒ undefined: no se toca lo que ya había. */
export function parsearRecargo(txt: string): number | null | undefined {
  if (txt.trim() === '') return null;
  const limpio = txt.trim().toLowerCase().replace('%', '').trim();
  const mult = /^(?:x\s*(.+)|(.+?)\s*x)$/.exec(limpio);
  const n = Number((mult ? (mult[1] ?? mult[2]) : limpio).replace(',', '.'));
  if (!Number.isFinite(n)) return undefined;
  // Redondeo a 6 decimales: (2,1 − 1) × 100 da 110,00000000000001 en coma flotante, y ese número
  // se guarda y se vuelve a mostrar. Ningún margen real necesita más precisión que la millonésima.
  const recargo = mult ? Math.round((n - 1) * 1e8) / 1e6 : n;
  return recargo <= -100 ? undefined : recargo;
}

/** ¿Esto es de verdad el link de un producto? El costeo exige respaldo: toda fila cotizada tiene
 *  que decir DE DÓNDE salió ese precio (decisión del usuario, 04-sep-2026). Alcanza con que parezca
 *  una dirección web — se acepta con o sin protocolo ("https://falabella.cl/p/1", "falabella.cl/p/1"),
 *  porque los links se pegan de la barra del navegador o del correo del proveedor y llegan de las
 *  dos formas. Lo que NO pasa es una nota suelta en su lugar ("pendiente", "cotizado por mail"). */
export function esLinkDeProducto(url: string | null | undefined): boolean {
  const t = (url || '').trim();
  if (!t || /\s/.test(t)) return false;                  // una frase no es un link
  if (/^https?:\/\//i.test(t)) return t.length > 'https://'.length + 3;
  return /^[a-z0-9-]+(\.[a-z0-9-]+)+(\/|$|\?|:)/i.test(t);  // dominio.tld, con o sin ruta
}

const pct = (num: number, den: number): number | null => (den === 0 ? null : (num / den) * 100);

export function calcularComparativo(e: EntradaComparativo): Comparativo {
  const ventaNeta = e.ventaNeta;
  const ventaConIva = ventaNeta * IVA;
  const utilidadEstimada = ventaNeta - e.costoNetoEstimado;
  const hayReal = e.costoNetoReal != null && e.filasConCostoReal > 0;
  const costoNetoReal = hayReal ? (e.costoNetoReal as number) : null;

  return {
    ventaConIva,
    ventaIva: ventaConIva - ventaNeta,
    ventaNeta,
    costoNetoEstimado: e.costoNetoEstimado,
    utilidadEstimada,
    margenEstimado: pct(utilidadEstimada, ventaNeta),
    presupuestoNeto: e.presupuestoNeto,
    presupuestoConIva: e.presupuestoNeto != null ? e.presupuestoNeto * IVA : null,
    distanciaPresupuesto: e.presupuestoNeto != null ? pct(e.presupuestoNeto - ventaNeta, e.presupuestoNeto) : null,
    costoNetoReal,
    utilidadReal: costoNetoReal != null ? ventaNeta - costoNetoReal : null,
    margenReal: costoNetoReal != null ? pct(ventaNeta - costoNetoReal, ventaNeta) : null,
    variacionCosto: costoNetoReal != null ? pct(costoNetoReal - e.costoNetoEstimado, e.costoNetoEstimado) : null,
    filasConCostoReal: e.filasConCostoReal,
    filasTotales: e.filasTotales,
    realCompleto: e.filasTotales > 0 && e.filasConCostoReal === e.filasTotales,
  };
}
