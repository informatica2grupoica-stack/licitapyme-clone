// app/lib/auditor-ficha-propia-core.ts
// FICHA TÉCNICA PROPIA desde el AUDITOR (27-oct-2026, pedido del dueño): la ficha que presentamos se arma
// con la comparación de fichas del Auditor (comparador v3: por cada requisito de las bases, el estado y el
// dato ofertado que se leyó del documento del proveedor), no con el checklist técnico antiguo, que se va
// a retirar. El PDF lo sigue armando construirFichaTecnicaHtml (ficha-tecnica.ts): mismo formato, una
// ficha por producto.
//
// Solo se arma cuando lo técnico está TODO cumplido (estado técnico CUMPLE: sin ❌ ni ❓ abiertos; lo
// confirmado a mano cuenta como cerrado). Nunca inventa: un requisito confirmado a mano sin dato
// ofertado sale con la casilla vacía, que la pantalla avisa antes de presentar.
//
// Puro (sin BD): lo usa auditor-ficha-propia.ts y lo prueban los tests.
import type { OpcionDTO, LineaAuditorDTO } from '@/app/lib/auditor-opciones';
import type { ProductoFicha, EspecificacionFicha } from '@/app/lib/ficha-tecnica';

/** null = la opción está lista para su ficha; si no, el motivo en palabras simples. */
export function motivoFichaNoLista(o: OpcionDTO): string | null {
  if (o.estado === 'descartada') return 'La opción está descartada.';
  const t = o.tecnico;
  if (t.estado === 'NO_CORRIDO' || !t.resultado) return 'Todavía no se compara contra las bases: compara la línea primero.';
  if (t.legado) return 'La comparación es la antigua: vuelve a comparar la línea.';
  if (t.estado === 'SIN_REQUISITOS' || t.estado === 'NO_APLICA' || t.resultado.filas.length === 0)
    return 'La línea no tiene requisitos técnicos de las bases: no hay especificaciones que poner en la ficha.';
  if (t.estado !== 'CUMPLE') {
    const r = t.resultado.resumen;
    const partes = [r.noCumple ? `${r.noCumple} no cumple${r.noCumple === 1 ? '' : 'n'}` : '', r.sinVeredicto ? `${r.sinVeredicto} por resolver` : '']
      .filter(Boolean).join(' y ');
    return `Falta cerrar lo técnico${partes ? `: ${partes}` : ''}.`;
  }
  return null;
}

// El dato ofertado viene del comparador y a veces trae su propia observación pegada («GPU Intel ARC 140T
// (integrada); ningún documento acredita rendimiento suficiente para ARBOTOM», 2427-98-LE26). Esa frase es
// una nota interna: en el documento que se presenta no puede ir. Se quita cada tramo (separado por «;») que
// dice que falta el dato; si no queda nada, la casilla sale vacía.
// También el tramo que habla de nuestros documentos («cotización incluye 4 bandejas…»): eso va en «Incluye».
const RE_NOTA_SIN_DATO = /\b(ning[uú]n documento|no (se )?(indica|acredita|declara|especifica|informa|menciona|detalla)|sin (dato|informaci[oó]n|respaldo)|cotizaci[oó]n|proveedor)\b/i;
export function datoParaPresentar(datoOfertado: string | null | undefined): string | null {
  const tramos = String(datoOfertado || '').split(';').map(t => t.trim()).filter(t => t && !RE_NOTA_SIN_DATO.test(t));
  return tramos.join('; ') || null;
}

/** Qué opción va en la oferta técnica de cada línea ofertada: la definitiva (firmada) si existe; si no, la única que tiene
 *  lo técnico listo. Con dos o más listas y ninguna firmada no se elige por el equipo: la línea queda en `faltan`. */
export function opcionesDeLaOferta(panel: { lineas: LineaAuditorDTO[] }, todas = panel.lineas): { ids: number[]; faltan: string[] } {
  const ids: number[] = [], faltan: string[] = [];
  for (const l of panel.lineas) {
    if (l.noOfertada) continue;
    const variosItems = l.lineaReal != null && todas.filter(x => x.lineaReal === l.lineaReal).length > 1;
    const nombre = `Línea ${l.lineaReal ?? l.item}${variosItems ? ` · ítem ${l.item}` : ''} (${nombreDeLinea(l.detalle)})`;
    const definitiva = l.opciones.find(o => o.id === l.opcionDefinitivaId);
    const listas = l.opciones.filter(o => !motivoFichaNoLista(o));
    if (definitiva && !motivoFichaNoLista(definitiva)) ids.push(definitiva.id);
    else if (definitiva) faltan.push(`${nombre}: la opción firmada aún no tiene lo técnico cumplido`);
    else if (listas.length === 1) ids.push(listas[0].id);
    else faltan.push(`${nombre}: ${listas.length ? 'hay varias opciones listas, firma la que se oferta' : 'ninguna opción tiene lo técnico cumplido'}`);
  }
  return { ids, faltan };
}

// El requisito que la ficha del proveedor no traía y el asistente cerró con una nota (27-oct-2026, «Control de Humedad»
// del horno de 1414396-26-LP26): «confirmado con proveedor y en el link aparece textual Control de la humedad: 0 - 20 –
// 40 - 60 - 80 - 100%.». La nota es interna; al documento va solo el valor, lo que sigue al «:». La nota más reciente
// manda. Sin un «algo: valor» la casilla queda vacía, como siempre.
export function datoDeComplemento(notas: (string | null | undefined)[]): string | null {
  for (const nota of [...notas].reverse()) {
    const i = String(nota || '').indexOf(':');
    const valor = i < 0 ? '' : String(nota).slice(i + 1).trim().replace(/\.$/, '').trim();
    if (valor) return valor;
  }
  return null;
}

// La ficha declara lo que OFRECEMOS (27-oct-2026, pedido del dueño): la columna izquierda lleva el nombre corto de la
// característica, nunca el texto de las bases. Cuando el requisito ya lo trae antes de «:» («Control de Humedad: ajustes
// en…», «Peldaños: 24») se usa ese; si no («RAM 32 GB mínimo.», GETAC de 2427-98-LE26) lo pone la IA en
// auditor-ficha-propia.ts, y mientras tanto queda vacío.
const LARGO_MAX_NOMBRE = 50;
export function nombreDeCaracteristica(requeridoTexto: string): string | null {
  const i = requeridoTexto.indexOf(':');
  const nombre = i > 0 ? requeridoTexto.slice(0, i).replace(/\s+/g, ' ').trim() : '';
  return nombre && nombre.length <= LARGO_MAX_NOMBRE ? nombre : null;
}

/** NUESTRA ficha se arma por LÍNEA (27-oct-2026, decisión del dueño): una línea con varios ítems (2446-240-LE26 L1:
 *  hidrolavadora, plato de lavado y vacuolavadora) sale en UN PDF, cada ítem en su página. Antes cada ítem generaba su
 *  PDF con el mismo nombre (…_L1.pdf) y el segundo reemplazaba al primero en Documentos. Para el ítem de la opción
 *  pulsada va esa opción; para los otros, la misma regla que la oferta técnica (firmada o única lista). Sin número de
 *  línea, solo ese ítem. */
export function opcionesDeLaLinea(panel: { lineas: LineaAuditorDTO[] }, opcionId: number): { ids: number[]; faltan: string[] } {
  const propia = panel.lineas.find(l => l.opciones.some(o => o.id === opcionId));
  if (!propia) return { ids: [opcionId], faltan: [] };
  const hermanas = propia.lineaReal == null ? [] : panel.lineas.filter(l => l !== propia && l.lineaReal === propia.lineaReal);
  const otras = opcionesDeLaOferta({ lineas: hermanas }, panel.lineas);
  const orden = (id: number) => panel.lineas.findIndex(l => l.opciones.some(o => o.id === id));
  return { ids: [opcionId, ...otras.ids].sort((a, b) => orden(a) - orden(b)), faltan: otras.faltan };
}

/** Lo que ofrecemos por cada requisito de la línea, en el orden de las bases. `descripcion` = nombre corto (o '' si falta). */
export function especificacionesDeOpcion(o: OpcionDTO): EspecificacionFicha[] {
  return (o.tecnico.resultado?.filas ?? []).map(f => ({
    descripcion: nombreDeCaracteristica(f.requeridoTexto) ?? '',
    tipo: null,
    valorRequeridoTexto: f.requeridoTexto,
    valorRequeridoNumero: null, valorRequeridoNumeroMax: null, unidadRequerida: null,
    valorOfertadoTexto: datoParaPresentar(f.partes[0]?.ofertadoValor)
      ?? datoDeComplemento((o.tecnico.respaldosCelda?.[f.n] ?? []).map(r => r.nota)),
    valorOfertadoNumero: null, unidadOfertada: null,
  }));
}

/** Modelo + versión sin repetir la versión cuando el modelo ya la trae («B360 G3» + «G3»), ni pegar una «versión» que en
 *  realidad es la descripción del producto («Bakerlux Shop.Pro Touch, 4 bandejas 600x400, abatible…», horno Unox). */
const modeloConVersion = (modelo: string | null, version: string | null) => {
  const v = version && version.length <= 30 && !version.includes(',') && !(modelo || '').toLowerCase().includes(version.toLowerCase()) ? version : null;
  return [modelo, v].filter(Boolean).join(' ') || null;
};

/** Nombre del producto de la línea del costeo («Horno convector - 10 bandejas» → «Horno convector»). */
const nombreDeLinea = (detalle: string) => detalle.split(' - ')[0].trim() || detalle.trim();

/** Lo que se entrega junto al producto según sus complementos (27-oct-2026, horno Unox de 1414396-26-LP26: bandejas,
 *  enchufe trifásico, instalación). El envío y los cargos manuales son costo, no parte técnica de la oferta: no van. */
export function incluyeDeOpcion(o: OpcionDTO): string[] {
  return (o.complementos || [])
    .filter(c => c.tipo === 'producto' || c.tipo === 'instalacion')
    .map(c => c.tipo === 'producto' && c.cantidadDoc && c.cantidadDoc > 1 ? `${c.cantidadDoc} × ${c.nombre}` : c.nombre);
}

/** `imagen.puestaPorPersona`: la subió alguien en el costeo (true) o salió sola de la ficha del proveedor (false, se avisa en pantalla).
 *  `fotosExtra`: más fotos del producto, debajo de la principal. */
export function productoFichaDeOpcion(o: OpcionDTO, l: LineaAuditorDTO, imagen: { dataUri: string; puestaPorPersona: boolean } | null, fotosExtra: string[] = []): ProductoFicha {
  return {
    nombre: nombreDeLinea(l.detalle),
    marca: o.marca, modelo: modeloConVersion(o.modelo, o.version),
    fabricante: null, paisFabricacion: null, anioFabricacion: null, garantiaMeses: null,
    // Marca y modelo los revisó el equipo al cerrar la comparación de la opción.
    confirmado: true,
    imagenDataUri: imagen?.dataUri ?? null,
    imagenConfirmada: imagen?.puestaPorPersona ?? false,
    imagenesExtraDataUri: imagen ? fotosExtra : [],
    incluye: incluyeDeOpcion(o),
    especificaciones: especificacionesDeOpcion(o),
    cantidad: l.cantidad, unidad: l.unidad || null, item: l.item,
  };
}
