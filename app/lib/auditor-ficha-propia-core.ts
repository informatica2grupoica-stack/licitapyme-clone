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

/** Los requisitos de la línea con lo que ofrecemos, en el orden de las bases. */
export function especificacionesDeOpcion(o: OpcionDTO): EspecificacionFicha[] {
  return (o.tecnico.resultado?.filas ?? []).map(f => ({
    descripcion: f.requeridoTexto,
    tipo: null,
    valorRequeridoTexto: f.requeridoTexto,
    valorRequeridoNumero: null, valorRequeridoNumeroMax: null, unidadRequerida: null,
    valorOfertadoTexto: datoParaPresentar(f.partes[0]?.ofertadoValor),
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
    cantidad: l.cantidad, unidad: l.unidad || null,
  };
}
