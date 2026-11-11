// Núcleo PURO del costeo digital (sin base de datos ni nada de servidor): tipos de fila/hoja/estado y la lógica
// que cruza el costeo guardado con la viabilidad (nombres, líneas, filas que ya no vienen). Lo usan el servidor
// (costeo-editor.ts, re-análisis) y la pantalla del editor («Actualizar»): una sola copia, para que no se
// desfasen — antes la pantalla tenía su propia copia y «Actualizar» hacía otra cosa que el re-análisis.
import type { ModalidadCosteo } from '@/app/lib/generar-costeo';

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
  // Texto original del detalle (el que vino del manifiesto) antes de que alguien lo complementara a mano.
  // Lo que `detalle` tenga de más se pinta en rojo en el editor. Opcional: costeos previos no lo traen.
  detalleBase?: string | null;
  // Columna «Complemento»: texto largo que se pega/escribe en un modal y se lee en un globo editable.
  // Se muestra en rojo. Opcional: los costeos anteriores no lo traen.
  complemento?: string | null;
  unidad: string;                   // C — Unidad de medida
  skuProveedor: string;             // D — Sku de proveedor (tienda/proveedor de referencia)
  cantidad: number | null;          // E — Cantidad original
  valorConIva: number | null;       // F — VALOR C/ IVA (precio de mercado, referencia)
  // Costo unitario NETO realmente pagado al proveedor, una vez comprado. Es el único dato del
  // cuadro comparativo que no se deriva de nada: se tipea cuando llega la factura/OC. Vacío
  // mientras no se sepa (nunca se rellena con el estimado — ver feedback "no inventar datos").
  costoRealUnitario: number | null;
  // Recargo sobre el costo de ESTA fila, en %. null/undefined = hereda el de la hoja (y esa, el
  // del costeo completo). El caso real es 1114-12-LE26: en el Excel del asistente el multiplicador
  // NO es una constante del costeo, va escrito fila por fila — I4 =G4*2.1 (plataforma satelital) e
  // I5 =G5*2 (sensor de presión), en la MISMA hoja. Con el margen solo global, el editor vendía el
  // sensor a $3.516.421 en vez de $3.348.973: $669.792 de más en una oferta que iba a 1,94% del
  // tope, y ese precio inflado es el que después toma el Anexo Económico
  // (obtenerItemsCosteoDelEditor). El global sigue mandando en todo lo que no se toque a mano.
  margenVenta?: number | null;
  // Foto del producto (URL pública en R2): columna «Imagen», justo después del detalle. Opcional: los costeos anteriores no la traen.
  imagenUrl?: string | null;
  link1: string;                    // S — Link 1
  link2: string;                    // T — Link 2
  link3: string;                    // V — Link 3
  // Fila agregada por el perfil de Compras (no viene de la viabilidad): a diferencia del resto, Compras
  // puede editarla entera y borrarla. Ver fusionarEdicionCompras (costeo-compras.ts).
  agregadoPorCompras?: boolean;
  // Fila (ofertada o costo adicional) que agregó Compras con el permiso correspondiente: Compras puede editarla y borrarla.
  propiaCompras?: boolean;
  // COSTO ADICIONAL a mano (flete, despacho, capacitación…): se escribe el «Costo total neto» directamente, sin cantidad ni costo unitario.
  // Suma al costo total, a la utilidad y al margen del costeo, pero NO se vende: no tiene precio, no va al anexo económico, al Motor
  // Comercial ni al Auditor. Es lo que el comercial hace en el Excel pisando la fórmula de esa celda (caso 1288505-5-LE26).
  esCostoAdicional?: boolean;
  costoAdicionalNeto?: number | null;
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

export const uid = () => Math.random().toString(36).slice(2, 10);

// Coma o punto entre dígitos y la comilla escrita como &quot; dan el mismo producto: al re-analizar
// 3712-74-LP26 (27-oct-2026) «1,5 hp» y «20,000(Lt)» no calzaron con «1.5 hp» y «20.000(Lt)» ya
// guardados y «Actualizar» los duplicó.
export function normDesc(s: string): string {
  return (s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/&quot;/g, '"').replace(/(\d),(?=\d)/g, '$1.').replace(/\s+/g, ' ').trim();
}

/** ¿"la misma fila", con texto exacto o no? BUG REAL (03-sep-2026, 1271359-92-LE26): al volver a
 *  analizar la viabilidad, la IA no solo reclasificó las líneas — también RECORTÓ las
 *  descripciones ("Locker metálicos colores 15 cuerpos - Sin marca/modelo de referencia
 *  explícito" pasó a solo "Locker metálicos colores"). Comparar por texto EXACTO hacía que
 *  ninguna fila ya guardada calzara con la fresca — "Actualizar" las trataba a todas como nuevas y
 *  duplicaba el costeo entero en vez de reclasificar. Alcanza con que una sea prefijo largo de la
 *  otra (≥12 caracteres, para no confundir dos productos cortos que por casualidad empiecen igual). */
export function mismoProducto(a: string, b: string): boolean {
  const na = normDesc(a), nb = normDesc(b);
  if (!na || !nb) return false;
  if (na === nb) return true;
  const [corta, larga] = na.length <= nb.length ? [na, nb] : [nb, na];
  if (corta.length >= 12 && larga.startsWith(corta)) return true;
  // Mismo nombre escrito distinto (3712-74-LP26, 28-oct-2026: «Quimitank 150 (Lt)» / «150(Lt)», «90cm,
  // base pesada» / «90 cm. base pesada», y erratas de OCR «portátil»/«partátil», «Esfuerzo»/«Estuerzo»):
  // «Actualizar» agregaba 23 copias. Sin espacios ni signos, y hasta 2 letras distintas si los NÚMEROS
  // son los mismos («DN 63» y «DN 75» siguen siendo productos distintos).
  const ca = na.normalize('NFKD').replace(/[^a-z0-9]/g, ''), cb = nb.normalize('NFKD').replace(/[^a-z0-9]/g, '');
  if (ca === cb) return true;
  const [cc, cl] = ca.length <= cb.length ? [ca, cb] : [cb, ca];
  if (cc.length >= 12 && cl.startsWith(cc)) return true;
  const numeros = (s: string) => (s.match(/\d+(?:\.\d+)?/g) || []).join(' ');
  return cc.length >= 15 && numeros(na.normalize('NFKD')) === numeros(nb.normalize('NFKD')) && distanciaHasta2(ca, cb);
}

/** Mismo texto salvo espacios, signos y hasta 2 letras (errata de OCR): «Estuerzo» / «Esfuerzo». */
export function casiIgual(a: string, b: string): boolean {
  const c = (s: string) => normDesc(s).normalize('NFKD').replace(/[^a-z0-9]/g, '');
  return distanciaHasta2(c(a), c(b));
}

/** ¿Se pasa de `a` a `b` con 2 cambios de letra o menos (Levenshtein ≤ 2)? */
function distanciaHasta2(a: string, b: string): boolean {
  if (Math.abs(a.length - b.length) > 2) return false;
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    if (Math.min(...cur) > 2) return false;
    prev = cur;
  }
  return prev[b.length] <= 2;
}

/** Encuentra, dentro de `filas`, la que representa el mismo producto real que `detalle` — ver
 *  mismoProducto. Lineal (no hash-map): las listas de un costeo son chicas (decenas de ítems),
 *  y el fuzzy-match no se puede indexar por clave exacta. */
export function buscarMismoProducto<T extends { detalle: string }>(filas: T[], detalle: string): T | undefined {
  return filas.find(f => mismoProducto(f.detalle, detalle));
}

/** El producto de la viabilidad que corresponde a una fila del costeo, cuidando las líneas. BUG REAL
 *  (28-oct-2026, 2827-102-LE26): las DOS líneas se llamaban «Barredora de suelos» (el nombre genérico de
 *  Mercado Público) y el re-análisis tomó la primera: movió la barredora manual de la hoja LINEA2 a LINEA1,
 *  que tenía recargo 0 %, y su precio bajó en silencio de $774.687 a $609.989. Si el nombre calza con
 *  productos de más de una línea, vale el de la línea de la fila; si ninguno es de su línea, no se sabe
 *  cuál es: undefined. */
export function mismoProductoEnSuLinea<T extends { detalle: string; lineaReal?: number | null }>(
  filas: T[], detalle: string, lineaReal: number | null | undefined,
): T | undefined {
  const candidatos = filas.filter(f => mismoProducto(f.detalle, detalle));
  if (new Set(candidatos.map(f => f.lineaReal ?? null)).size <= 1) return candidatos[0];
  return candidatos.find(f => (f.lineaReal ?? null) === (lineaReal ?? null));
}

/** Palabras que no dicen qué producto es («igual o superior», «o equivalente»…). */
export const PALABRAS_DE_RELLENO = new Set(['igual', 'equivalente', 'similar', 'superior', 'marca', 'modelo', 'referencia', 'tipo']);

/** ¿La fila del costeo y el producto de la viabilidad son el MISMO producto con el nombre reescrito?
 *  Al re-analizar, la IA alarga, acorta o reordena el nombre: «Notebook» ↔ «Notebook - Ryzen 5 3450U»,
 *  «Proyector … igual o superior» ↔ «… o superior» (1028897-42-LP26), «TACA TACA» ↔ «TACA TACA MEDIDAS:
 *  …» (1002588-102-LP26), «SET TASAS DE LOZA 12» ↔ «SET 12 TAZAS DE LOZA» (701426-14-LP26). mismoProducto
 *  no los une y cada re-análisis agregaba una copia (28-oct-2026). Solo se usa con lo que quedó SIN par
 *  por nombre y exige misma línea, misma cantidad, los números del nombre corto dentro del largo
 *  («DN 63» ≠ «DN 75»), la misma primera palabra y la mayoría de las palabras del nombre corto. */
function puntajeReescrito(f: FilaEditorCosteo, fresca: FilaEditorCosteo): number {
  if ((f.lineaReal ?? null) !== (fresca.lineaReal ?? null)) return 0;
  if (f.cantidad == null || f.cantidad !== fresca.cantidad) return 0;
  const a = normDesc(f.detalleBase ?? f.detalle), b = normDesc(fresca.detalle);
  // Sin números: «SET 12 VASOS CORTOS» y «SET COPAS 12» no deben parecerse por compartir el 12.
  const palabras = (s: string) => [...palabrasDeProducto(s)].filter(w => !PALABRAS_DE_RELLENO.has(w) && !/^\d/.test(w));
  const [pa, pb] = [palabras(a), palabras(b)];
  if (!pa.length || !pb.length || pa[0] !== pb[0]) return 0;
  const [corta, larga] = pa.length <= pb.length ? [pa, pb] : [pb, pa];
  const numeros = (s: string) => new Set(s.match(/\d+(?:\.\d+)?/g) || []);
  const [na, nb] = [numeros(a), numeros(b)];
  const [nMenos, nMas] = na.size <= nb.size ? [na, nb] : [nb, na];
  if (![...nMenos].every(n => nMas.has(n))) return 0;
  const comunes = corta.filter(w => larga.includes(w)).length / corta.length;
  return comunes >= 0.6 ? comunes : 0;
}

/** Une 1 a 1, por mejor puntaje, las filas sin par con los productos frescos sin par (ver puntajeReescrito). */
export function emparejarReescritos(filas: FilaEditorCosteo[], frescas: FilaEditorCosteo[]): Map<FilaEditorCosteo, FilaEditorCosteo> {
  const candidatos: { f: FilaEditorCosteo; x: FilaEditorCosteo; p: number }[] = [];
  for (const f of filas) for (const x of frescas) { const p = puntajeReescrito(f, x); if (p > 0) candidatos.push({ f, x, p }); }
  candidatos.sort((u, v) => v.p - u.p);
  const pares = new Map<FilaEditorCosteo, FilaEditorCosteo>();
  const usadas = new Set<FilaEditorCosteo>();
  for (const { f, x } of candidatos) if (!pares.has(f) && !usadas.has(x)) { pares.set(f, x); usadas.add(x); }
  return pares;
}

/** Fila del costeo → producto fresco con el nombre reescrito, entre los que no calzan por nombre. */
export function paresReescritos(actual: EstadoCosteoEditor, frescas: FilaEditorCosteo[]): Map<FilaEditorCosteo, FilaEditorCosteo> {
  const filas = actual.grupos.flatMap(g => g.filas)
    .filter(f => f.detalle?.trim() && !f.esCostoAdicional && !f.agregadoPorCompras);
  const filasSinPar = filas.filter(f => !buscarMismoProducto(frescas, f.detalleBase ?? f.detalle));
  const frescasSinPar = frescas.filter(x => x.detalle?.trim() && !filas.some(f => mismoProducto(f.detalleBase ?? f.detalle, x.detalle)));
  return emparejarReescritos(filasSinPar, frescasSinPar);
}

/** Palabras que identifican al producto: solo la PRIMERA línea del nombre (lo que sigue suele ser "Especificación: …"), sin tildes ni signos. */
export function palabrasDeProducto(s: string): Set<string> {
  const primera = (s || '').split('\n')[0].toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  return new Set(primera.split(/[^a-z0-9]+/).filter(w => w.length >= 2 && !['de', 'la', 'el', 'en', 'con', 'sin', 'por', 'para', 'los', 'las', 'del', 'y', 'o', 'un', 'una'].includes(w)));
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
  // Productos frescos que ya están en el costeo con el nombre reescrito: no se agregan otra vez.
  const yaEstan = new Set(paresReescritos(actual, frescas).values());

  let reclasificados = 0;
  const reubicar: FilaEditorCosteo[] = [];
  let grupos: GrupoEditorCosteo[] = actual.grupos.map(g => {
    const filas: FilaEditorCosteo[] = [];
    for (const f of g.filas) {
      const fresco = mismoProductoEnSuLinea(frescas, f.detalle, f.lineaReal);
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
      if (!f.detalle?.trim() || yaEstan.has(f) || buscarMismoProducto(existentes, f.detalle)) continue;

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
  // Las hojas creadas al final (una línea que faltaba) se acomodan por número de línea.
  if (agregados > 0 && grupos.length > 1 && grupos.every(g => g.linea != null)) {
    grupos = grupos.map((g, i) => ({ g, i })).sort((a, b) => (a.g.linea as number) - (b.g.linea as number) || a.i - b.i).map(x => x.g);
  }
  return {
    estado: { modalidad: actual.grupos.length ? actual.modalidad : nuevo.modalidad, margenVenta: actual.margenVenta ?? MARGEN_VENTA_DEFECTO, grupos },
    agregados, reclasificados,
  };
}

/** ¿Alguien trabajó esta fila? Precio, link, SKU o costo real — decisión del dueño (27-oct-2026):
 *  solo una fila SIN nada de eso se puede quitar al actualizar desde la viabilidad. */
export function filaTrabajada(f: FilaEditorCosteo): boolean {
  return f.valorConIva != null || f.costoRealUnitario != null || !!f.skuProveedor?.trim()
    || !!(f.link1?.trim() || f.link2?.trim() || f.link3?.trim())
    || !!f.complemento?.trim() || !!f.imagenUrl?.trim()
    || (f.detalleBase != null && f.detalle !== f.detalleBase);
}

/** Filas del costeo que la viabilidad (`nuevo`) ya no trae: las que no calzan con ningún producto
 *  fresco, y las copias de más (cada producto fresco cubre UNA fila; las trabajadas eligen primero).
 *  Devuelve solo las que se pueden quitar — sin precio, link, SKU ni costo real — y cuenta aparte
 *  las que tampoco vienen pero alguien trabajó. Nunca toca costos adicionales ni filas de Compras
 *  (no vienen de la viabilidad) ni filas en blanco. Caso real 3712-74-LP26 (27-oct-2026): la versión
 *  1 se armó con el parser viejo (pauta X1…X6, plazo, fichas repetidas) y «Actualizar» nunca las
 *  sacaba. */
export function filasQueViabilidadYaNoTrae(
  actual: EstadoCosteoEditor,
  nuevo: EstadoCosteoEditor,
): { quitables: FilaEditorCosteo[]; trabajadas: number } {
  const frescas = nuevo.grupos.flatMap(g => g.filas).filter(f => f.detalle?.trim());
  const candidatas = actual.grupos.flatMap(g => g.filas)
    .filter(f => f.detalle?.trim() && !f.esCostoAdicional && !f.agregadoPorCompras);
  // Cada producto fresco cubre UNA fila y gana la MEJOR coincidencia, no la primera en el orden de la
  // hoja (2410-21-LE26: «Campímetro computarizado $32.000.000» —un presupuesto pegado al nombre— iba
  // antes que «Campímetro computarizado», se quedaba con el producto y la limpia salía como «sobra»).
  // Entre filas trabajadas y sin trabajar, las trabajadas eligen primero; después, nombre exacto y misma línea.
  // Un nombre que es prefijo de productos de DOS líneas y de ninguna propia («MONTURA DE PRUEBA DE», cortado,
  // contra «…adulto» y «…pediátrica») no dice cuál es: queda sin par.
  const pares: { f: FilaEditorCosteo; x: FilaEditorCosteo; trabajada: number; puntaje: number; pos: number }[] = [];
  candidatas.forEach((f, pos) => {
    const posibles = frescas.filter(x => mismoProducto(x.detalle, f.detalle));
    const lineas = new Set(posibles.map(x => x.lineaReal ?? null));
    const ambiguo = lineas.size > 1 && !lineas.has(f.lineaReal ?? null);
    if (ambiguo) return;
    for (const x of posibles) {
      pares.push({
        f, x, pos, trabajada: filaTrabajada(f) ? 1 : 0,
        puntaje: (normDesc(f.detalle) === normDesc(x.detalle) ? 2 : 0) + ((f.lineaReal ?? null) === (x.lineaReal ?? null) ? 1 : 0),
      });
    }
  });
  pares.sort((a, b) => b.trabajada - a.trabajada || b.puntaje - a.puntaje || a.pos - b.pos);
  const cubiertas = new Set<FilaEditorCosteo>();
  const usadas = new Set<FilaEditorCosteo>();
  for (const p of pares) if (!cubiertas.has(p.f) && !usadas.has(p.x)) { cubiertas.add(p.f); usadas.add(p.x); }
  const sinPar = candidatas.filter(f => !cubiertas.has(f));
  const libres = frescas.filter(x => !usadas.has(x));
  // La que solo tiene el nombre reescrito por la IA sigue siendo ese producto: no se propone quitarla.
  const reescritas = emparejarReescritos(sinPar, libres);
  const quitables: FilaEditorCosteo[] = [];
  let trabajadas = 0;
  for (const f of sinPar) {
    if (reescritas.has(f)) continue;
    if (filaTrabajada(f)) trabajadas++; else quitables.push(f);
  }
  const posicion = new Map(candidatas.map((f, i) => [f.id, i]));
  quitables.sort((a, b) => posicion.get(a.id)! - posicion.get(b.id)!);
  return { quitables, trabajadas };
}

/** Saca del costeo las filas que filasQueViabilidadYaNoTrae da por quitables (sin precio, link, SKU,
 *  costo real, complemento ni foto). Renumera las hojas y deja de lado las que quedaron vacías.
 *  Va ANTES de fusionar: una fila cortada o sucia («MONTURA DE PRUEBA DE») calza por prefijo con el
 *  producto fresco y evita que se agregue el bueno. */
export function quitarFilasQueViabilidadYaNoTrae(
  actual: EstadoCosteoEditor,
  nuevo: EstadoCosteoEditor,
  opciones: { soloDelDocumento?: boolean } = {},
): { estado: EstadoCosteoEditor; quitadas: FilaEditorCosteo[]; hojasVaciadas: string[] } {
  // `soloDelDocumento` (re-análisis, que quita sin preguntar): solo filas con línea asignada, o sea las que vinieron
  // del documento. Una fila sin línea la agregó una persona a mano (842: Fassi, carrocería, cajoneras aún sin precio)
  // y borrarla sin confirmar sería borrar su trabajo; «Actualizar» sí pregunta y no usa esta opción.
  const quitables = filasQueViabilidadYaNoTrae(actual, nuevo).quitables.filter(f => !opciones.soloDelDocumento || f.lineaReal != null);
  if (!quitables.length) return { estado: actual, quitadas: [], hojasVaciadas: [] };
  const fuera = new Set(quitables.map(f => f.id));
  const hojasVaciadas: string[] = [];
  const grupos = actual.grupos.map(g => {
    if (!g.filas.some(f => fuera.has(f.id))) return g;
    const filas = g.filas.filter(f => !fuera.has(f.id)).map((f, i) => ({ ...f, item: i + 1 }));
    if (!filas.length) hojasVaciadas.push(g.nombre);
    return { ...g, filas };
  });
  return { estado: { ...actual, grupos }, quitadas: quitables, hojasVaciadas };
}
