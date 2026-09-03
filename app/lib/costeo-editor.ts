// app/lib/costeo-editor.ts
// COSTEO EN EL SISTEMA — el costeo se edita como una planilla dentro del negocio (pestaña
// "Costeo", arriba del Auditor Técnico), sin bajar un Excel, llenarlo aparte y volver a subirlo.
//
// Reusa la MISMA estructura que ya arma generar-costeo.ts para el Excel (adaptarViabilidadACosteo:
// una hoja "Costeo" en suma_alzada, o una hoja por línea/categoría) y las MISMAS fórmulas que trae
// la plantilla real (tabla-costeo-v3.xlsx, hoja "Costeo", columnas F→K — ver la cabecera de
// generar-costeo.ts):
//   G (Costo unitario neto)        = F / 1.19            (F = "VALOR C/ IVA", precio de mercado)
//   H (Costo total neto)           = E * G                (E = cantidad)
//   I (Precio unitario venta)      = G * (1 + margen)      margen fijo de la plantilla: 27%
//   J (Precio unitario s/decimales)= TRUNC(I, 0)           es lo que de verdad se oferta en MP
//   K (Precio total neto)          = J * E
// Acá el margen queda como UN número editable para todo el costeo (en la plantilla real es la
// misma constante ×1.27 repetida en cada fila) — nunca se le pide al usuario tipear el precio de
// venta a mano, se deriva del costo, igual que en el Excel.
//
// Misma forma de fila que consume motor-comercial.ts (FilaCosteo) — así las 4 alertas del Motor
// Comercial y el auto-precarga del checklist no distinguen si el costeo vino de un .xlsx subido o
// de acá.
import type { DatosCosteo, ModalidadCosteo } from '@/app/lib/generar-costeo';
import type { FilaCosteo } from '@/app/lib/motor-comercial';
import { numeroDeLinea } from '@/app/lib/auditor-tecnico-core';

export const MARGEN_VENTA_DEFECTO = 27; // % — mismo multiplicador ×1.27 que trae la plantilla real

export interface FilaEditorCosteo {
  id: string;                       // clave local (para la grilla), no es ninguna PK real
  item: number;                     // # de fila DENTRO de la hoja — solo para mostrar, se
                                     // renumera solo al agregar/borrar filas (no es la línea real)
  // Número REAL de línea de la licitación (el mismo que usa lineasDelInforme para el chequeo de
  // "Error de origen"). BUG REAL (03-sep-2026, 1271359-92-LE26): antes no existía este campo y el
  // motor comparaba por POSICIÓN (`item`) — al borrar la línea 1 del manifiesto (no se ofertaba),
  // las filas siguientes se renumeraban 1,2,3,4,5 y el chequeo las comparó contra las líneas
  // publicadas 1,2,3,4,5 (que en realidad eran 2,3,4,5,6) — "Error de origen" en TODAS. Se guarda
  // aparte y sobrevive a cualquier borrado/reordenado de filas.
  lineaReal: number | null;
  detalle: string;                  // B — Detalle de producto
  unidad: string;                   // C — Unidad de medida
  skuProveedor: string;             // D — Sku de proveedor (tienda/proveedor de referencia)
  cantidad: number | null;          // E — Cantidad original
  valorConIva: number | null;       // F — VALOR C/ IVA (precio de mercado, referencia)
  // Costo unitario NETO realmente pagado al proveedor, una vez comprado. Es el único dato del
  // cuadro comparativo que no se deriva de nada: se tipea cuando llega la factura/OC. Vacío
  // mientras no se sepa (nunca se rellena con el estimado — ver feedback "no inventar datos").
  costoRealUnitario: number | null;
  link1: string;                    // S — Link 1
  link2: string;                    // T — Link 2
  link3: string;                    // V — Link 3
}

export interface GrupoEditorCosteo {
  nombre: string;                   // "Costeo" | "LINEA1" | nombre de categoría
  linea: number | null;             // número REAL de línea (solo en por_linea; null en el resto)
  filas: FilaEditorCosteo[];
  // ¿Se oferta esta hoja/línea? (default true). Selector propio del costeo — pensado para el caso
  // real (03-sep-2026, 1271359-92-LE26) donde las bases arman "canastas" independientes dentro de
  // una licitación que el análisis clasificó como global: al separar por línea (ver
  // separarPorLinea) cada canasta queda en su hoja y se puede apagar sin borrar nada. Apagada, la
  // hoja NO entra a los totales/alertas (editorAFilasCosteo) y "Actualizar desde viabilidad" deja
  // de traerla de vuelta (fusionarConViabilidad) — antes borrar la fila no alcanzaba: sin memoria
  // de la decisión, el ítem volvía cada vez que se actualizaba.
  ofertamos: boolean;
  // Tope (presupuesto NETO) de ESTA línea/canasta, para el cuadro comparativo. El presupuesto casi
  // siempre viene POR LÍNEA, no uno global: en el Excel real de 1271359-92-LE26 la canasta 1 tenía
  // tope $17.839.600 c/IVA y la canasta 2 $21.478.000 — comparar cualquiera de las dos contra el
  // global ($33.040.000) da una distancia inventada. Se precarga con el presupuesto_linea del
  // informe y queda editable. null = usar el que mande presupuestoDeHoja (ver el editor).
  presupuestoNeto?: number | null;
  // Recargo sobre el costo de ESTA hoja, en %. null/undefined = usa el del costeo completo
  // (EstadoCosteoEditor.margenVenta). En el Excel real de 1271359-92-LE26 cada canasta tiene el
  // suyo —la 2 vende a ×1,25 y la 1 a ×1,34— incrustado en la fórmula de cada fila; acá es un
  // número por hoja.
  margenVenta?: number | null;
}

export interface EstadoCosteoEditor {
  modalidad: ModalidadCosteo;
  margenVenta: number;              // % — I = G × (1 + margenVenta/100), igual para todo el costeo
  grupos: GrupoEditorCosteo[];
}

const uid = () => Math.random().toString(36).slice(2, 10);

function normDesc(s: string): string {
  return (s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim();
}

/** ¿"la misma fila", con texto exacto o no? BUG REAL (03-sep-2026, 1271359-92-LE26): al volver a
 *  analizar la viabilidad, la IA no solo reclasificó las líneas — también RECORTÓ las
 *  descripciones ("Locker metálicos colores 15 cuerpos - Sin marca/modelo de referencia
 *  explícito" pasó a solo "Locker metálicos colores"). Comparar por texto EXACTO hacía que
 *  ninguna fila ya guardada calzara con la fresca — "Actualizar" las trataba a todas como nuevas y
 *  duplicaba el costeo entero en vez de reclasificar. Alcanza con que una sea prefijo largo de la
 *  otra (≥12 caracteres, para no confundir dos productos cortos que por casualidad empiecen igual). */
function mismoProducto(a: string, b: string): boolean {
  const na = normDesc(a), nb = normDesc(b);
  if (!na || !nb) return false;
  if (na === nb) return true;
  const [corta, larga] = na.length <= nb.length ? [na, nb] : [nb, na];
  return corta.length >= 12 && larga.startsWith(corta);
}

/** Encuentra, dentro de `filas`, la que representa el mismo producto real que `detalle` — ver
 *  mismoProducto. Lineal (no hash-map): las listas de un costeo son chicas (decenas de ítems),
 *  y el fuzzy-match no se puede indexar por clave exacta. */
function buscarMismoProducto<T extends { detalle: string }>(filas: T[], detalle: string): T | undefined {
  return filas.find(f => mismoProducto(f.detalle, detalle));
}

/** Las 4 columnas que se calculan solas — MISMA cadena de fórmulas que la plantilla real
 *  (F→G→H→I→J→K). null en cascada si falta el dato de entrada (F o cantidad), igual que Excel. */
export function calcularFormulas(f: FilaEditorCosteo, margenVenta: number) {
  const costoUnitario = f.valorConIva != null ? f.valorConIva / 1.19 : null;
  const costoTotal = f.cantidad != null && costoUnitario != null ? f.cantidad * costoUnitario : null;
  const precioUnitario = costoUnitario != null ? costoUnitario * (1 + margenVenta / 100) : null;
  const precioUnitarioSinDecimales = precioUnitario != null ? Math.trunc(precioUnitario) : null;
  const precioTotal = f.cantidad != null && precioUnitarioSinDecimales != null ? f.cantidad * precioUnitarioSinDecimales : null;
  return { costoUnitario, costoTotal, precioUnitario, precioUnitarioSinDecimales, precioTotal };
}

/** Primera carga: arma la planilla editable desde el manifiesto de viabilidad — mismos grupos que
 *  arma generar-costeo.ts (global o por línea/categoría, según lo que diga el informe). El precio
 *  de mercado (F) queda en blanco: se completa acá (a mano, o pegando el link donde se cotizó) y
 *  todo lo demás se deriva solo. */
export function datosCosteoAEditor(datos: DatosCosteo): EstadoCosteoEditor {
  const grupos: GrupoEditorCosteo[] = datos.grupos
    .filter(g => g.items.length > 0)
    .map(g => {
      const m = /^LINEA(\d+)$/i.exec(g.nombre.trim());
      return {
        nombre: g.nombre,
        linea: m ? Number(m[1]) : null,
        ofertamos: true,
        filas: g.items.map((it, i) => ({
          id: uid(),
          item: i + 1,
          lineaReal: numeroDeLinea((it as any).linea) ?? null,
          detalle: [it.descripcion, it.modelo].filter(Boolean).join(' - '),
          unidad: (it.unidad_medida || '').trim() || 'UN',
          skuProveedor: '',
          cantidad: it.cantidad ?? null,
          valorConIva: null,
          costoRealUnitario: null,
          link1: '', link2: '', link3: '',
        })),
      };
    });
  return { modalidad: datos.modalidad, margenVenta: MARGEN_VENTA_DEFECTO, grupos };
}

/** Agrega a `actual` los ítems de `nuevo` (recién derivado de viabilidad) que todavía no existen
 *  en ningún grupo, comparando descripción normalizada — NUNCA borra ni pisa lo que el usuario ya
 *  tipeó (costo, precio, links). Además RECONCILIA: si la viabilidad se volvió a analizar y una
 *  fila que ya tenías cambió de línea real, la reubica en la hoja correcta.
 *
 *  BUG REAL (03-sep-2026, 1271359-92-LE26): el generador del Excel (generar-costeo.ts) SIEMPRE
 *  relee la viabilidad fresca, así que cuando el análisis se corrigió (de "6 líneas sueltas" a "2:
 *  Pasto solo + los 5 muebles como UN paquete, línea 2") el Excel regenerado salió bien de
 *  inmediato. Este editor en cambio guarda una FOTO editable — y esa foto se quedó con la
 *  numeración vieja (Locker/Bancas/Estante/Mesas/Carro cada uno en su propia línea 2..6). Antes
 *  "Actualizar" solo AGREGABA lo que faltara por descripción; una fila que ya existía (misma
 *  descripción) nunca se tocaba, así que la reclasificación nunca llegaba — la única forma de
 *  arreglarlo era borrar y volver a escribir todo a mano. Ahora se sincroniza `lineaReal` de toda
 *  fila que matchee por descripción, y si el costeo está organizado por línea (una hoja = una
 *  línea) la fila se MUEVE a la hoja que le corresponde de verdad. */
export function fusionarConViabilidad(
  actual: EstadoCosteoEditor,
  nuevo: EstadoCosteoEditor,
): { estado: EstadoCosteoEditor; agregados: number; reclasificados: number } {
  const frescas = nuevo.grupos.flatMap(g => g.filas);
  // Líneas que el usuario apagó a propósito (GrupoEditorCosteo.ofertamos) — NUNCA vuelven solas al
  // actualizar, ni siquiera si `nuevo` las sigue trayendo (adaptarViabilidadACosteo no sabe nada de
  // esta decisión: se regenera fresco desde el informe cada vez).
  const lineasExcluidas = new Set(actual.grupos.filter(g => !g.ofertamos && g.linea != null).map(g => g.linea as number));
  // ¿Una hoja = una línea? Si es así, una fila que cambió de línea real tiene que CAMBIAR de hoja,
  // no solo corregir el número. Si el costeo sigue plano (suma_alzada, una sola hoja mixta),
  // corregir el campo alcanza — mover no tendría a dónde.
  const organizadoPorLinea = actual.grupos.some(g => g.linea != null);

  let reclasificados = 0;
  const reubicar: FilaEditorCosteo[] = [];
  let grupos: GrupoEditorCosteo[] = actual.grupos.map(g => {
    const filas: FilaEditorCosteo[] = [];
    for (const f of g.filas) {
      const fresco = buscarMismoProducto(frescas, f.detalle);
      const lineaFresca = fresco?.lineaReal ?? f.lineaReal;
      if (lineaFresca === f.lineaReal) { filas.push(f); continue; }
      reclasificados++;
      const actualizada = { ...f, lineaReal: lineaFresca };
      if (organizadoPorLinea) reubicar.push(actualizada); else filas.push(actualizada);
    }
    return { ...g, filas };
  });

  if (reubicar.length) {
    const porLineaTmp = new Map(grupos.filter(g => g.linea != null).map(g => [g.linea as number, g]));
    for (const f of reubicar) {
      let destino = f.lineaReal != null ? porLineaTmp.get(f.lineaReal) : undefined;
      if (!destino) {
        destino = { nombre: f.lineaReal != null ? `Línea ${f.lineaReal}` : 'Sin línea', linea: f.lineaReal, ofertamos: true, filas: [] };
        grupos.push(destino);
        if (f.lineaReal != null) porLineaTmp.set(f.lineaReal, destino);
      }
      destino.filas.push(f);
    }
    // Las hojas que quedaron vacías tras mover sus filas a la línea correcta ya no aportan nada.
    grupos = grupos.filter(g => g.filas.length > 0).map(g => ({ ...g, filas: g.filas.map((f, i) => ({ ...f, item: i + 1 })) }));
  }

  // Se busca destino para lo NUEVO por NOMBRE de hoja (comportamiento de siempre) y también por
  // LÍNEA REAL: si el costeo ya está organizado por línea, sus hojas se llaman "Línea N" y no
  // calzan con el nombre que trae `nuevo` — sin este segundo cruce cada ítem nuevo caería en una
  // hoja aparte en vez de sumarse a SU línea ya existente.
  const existentes = grupos.flatMap(g => g.filas); // lista viva: se le van agregando las que se crean abajo
  const porNombre = new Map(grupos.map(g => [g.nombre, g]));
  const porLinea = new Map(grupos.filter(g => g.linea != null).map(g => [g.linea as number, g]));
  let agregados = 0;

  for (const gNuevo of nuevo.grupos) {
    for (const f of gNuevo.filas) {
      if (f.lineaReal != null && lineasExcluidas.has(f.lineaReal)) continue;
      if (!f.detalle?.trim() || buscarMismoProducto(existentes, f.detalle)) continue;

      let destino = (f.lineaReal != null ? porLinea.get(f.lineaReal) : undefined) ?? porNombre.get(gNuevo.nombre);
      if (!destino) {
        destino = { nombre: gNuevo.nombre, linea: gNuevo.linea, ofertamos: true, filas: [] };
        grupos.push(destino);
        porNombre.set(gNuevo.nombre, destino);
        if (gNuevo.linea != null) porLinea.set(gNuevo.linea, destino);
      }
      const nueva = { ...f, id: uid(), item: destino.filas.length + 1 };
      destino.filas.push(nueva);
      existentes.push(nueva);
      agregados++;
    }
  }
  return {
    estado: { modalidad: actual.grupos.length ? actual.modalidad : nuevo.modalidad, margenVenta: actual.margenVenta ?? MARGEN_VENTA_DEFECTO, grupos },
    agregados, reclasificados,
  };
}

/** Reparte TODAS las filas del costeo (sin importar en qué hoja estén hoy) en una hoja por línea
 *  REAL — usa `lineaReal` de cada fila, no el nombre de su hoja de origen. Las filas sin línea
 *  conocida (agregadas a mano, sin match con el manifiesto) quedan juntas en "Sin línea".
 *
 *  Para cuando el análisis clasificó la licitación como global pero las bases en realidad arman
 *  canastas/líneas independientes con total propio (caso real 03-sep-2026, 1271359-92-LE26: 2
 *  "CANASTA N°" con su propio total en el Formulario de Oferta Económica, aunque el informe decía
 *  modalidad "suma_alzada"). Es una corrección MANUAL, acotada a este costeo — no toca la
 *  modalidad guardada en el informe de viabilidad ni el checklist del Auditor Técnico. */
export function separarPorLinea(estado: EstadoCosteoEditor): EstadoCosteoEditor {
  const porLinea = new Map<number, GrupoEditorCosteo>();
  const sinLinea: FilaEditorCosteo[] = [];
  for (const g of estado.grupos) {
    for (const f of g.filas) {
      if (f.lineaReal == null) { sinLinea.push(f); continue; }
      if (!porLinea.has(f.lineaReal)) porLinea.set(f.lineaReal, { nombre: `Línea ${f.lineaReal}`, linea: f.lineaReal, ofertamos: true, filas: [] });
      porLinea.get(f.lineaReal)!.filas.push(f);
    }
  }
  const grupos = [...porLinea.entries()]
    .sort(([a], [b]) => a - b)
    .map(([, g]) => ({ ...g, filas: g.filas.map((f, i) => ({ ...f, item: i + 1 })) }));
  if (sinLinea.length) grupos.push({ nombre: 'Sin línea', linea: null, ofertamos: true, filas: sinLinea.map((f, i) => ({ ...f, item: i + 1 })) });
  return { ...estado, modalidad: 'por_linea', grupos: grupos.length ? grupos : estado.grupos };
}

/** Reverso de separarPorLinea: junta todas las hojas en una sola. Las filas de hojas marcadas
 *  "no ofertamos" NO se traen de vuelta — es la misma decisión que dejarlas fuera, no un accidente
 *  al unir. */
export function unirEnUnaHoja(estado: EstadoCosteoEditor): EstadoCosteoEditor {
  const filas = estado.grupos.filter(g => g.ofertamos).flatMap(g => g.filas).map((f, i) => ({ ...f, item: i + 1 }));
  return { ...estado, modalidad: 'suma_alzada', grupos: [{ nombre: 'Costeo', linea: null, ofertamos: true, filas }] };
}

/** Convierte el estado editable a FilaCosteo[] — MISMA forma que produce parsearCosteo() al leer
 *  un .xlsx subido — para reusar sin cambios calcularAlertasMotorComercial/totalesDeCosteo/el
 *  auto-precarga del checklist. Costo y precio se recalculan acá con calcularFormulas, nunca se
 *  confía en una cuenta que venga hecha del cliente. */
export function editorAFilasCosteo(estado: EstadoCosteoEditor): FilaCosteo[] {
  const margenGeneral = Number.isFinite(estado.margenVenta) ? estado.margenVenta : MARGEN_VENTA_DEFECTO;
  const filas: FilaCosteo[] = [];
  for (const g of estado.grupos || []) {
    if (g.ofertamos === false) continue; // línea/canasta que se decidió no ofertar — fuera del todo
    // Cada hoja puede vender con su propio recargo (así lo hace el Excel del comercial); si no
    // tiene uno propio, usa el del costeo completo.
    const margenVenta = Number.isFinite(g.margenVenta as number) ? (g.margenVenta as number) : margenGeneral;
    for (const f of g.filas || []) {
      const sinDatos = !f.detalle?.trim() && f.cantidad == null && f.valorConIva == null;
      if (sinDatos) continue;
      const { costoUnitario, costoTotal, precioUnitarioSinDecimales, precioTotal } = calcularFormulas(f, margenVenta);
      filas.push({
        hoja: g.nombre, fila: f.item,
        item: f.item, detalle: f.detalle?.trim() || null,
        // La línea real de la fila manda sobre la de la hoja — necesario en suma_alzada, donde
        // una sola hoja mezcla varias líneas (g.linea siempre null ahí). En por_linea coinciden.
        lineaPublicada: f.lineaReal ?? g.linea,
        unidad: f.unidad?.trim() || null,
        cantidadOriginal: f.cantidad ?? null,
        costoUnitarioNeto: costoUnitario,
        costoTotalNeto: costoTotal,
        precioUnitarioSinDecimales,
        precioTotalNeto: precioTotal,
      });
    }
  }
  return filas;
}
