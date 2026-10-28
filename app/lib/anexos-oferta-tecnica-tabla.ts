// app/lib/anexos-oferta-tecnica-tabla.ts
// LA TABLA «PRODUCTO | ESPECIFICACIÓN | CANTIDAD» EN BLANCO del anexo técnico.
//
// Caso real 4022-19-LE26 (Municipalidad de Putre), Anexo 3 «Oferta técnica»: 14 filas totalmente
// vacías donde el oferente lista lo que ofrece. Ninguna fila trae un nombre contra el cual cruzar
// el Auditor, así que la tabla salía vacía aunque el costeo tenía los 7 productos con su cantidad.
// Esa lista ES lo que ofrecemos, no hay nada que adivinar: el producto i del costeo va en la fila i.
//
// Qué NO hace, a propósito:
//   · ESPECIFICACIÓN queda pendiente: el costeo no guarda especificaciones y inventarlas sería
//     peor que el blanco (si el Auditor la aprobó, ya la resuelve resolverTablaConAuditor).
//   · Una tabla con CUALQUIER texto en sus filas de datos no se toca: ahí cada fila ya nombra su
//     producto y lo resuelven el Auditor y el motor de precios.
//   · Con más productos que filas no se escribe nada: llenar solo una parte sin avisar deja una
//     oferta incompleta que parece completa.
//   · Una tabla con columna de precio es del anexo económico, no de este módulo.
//
// Módulo PURO (sin DB, sin red, sin IA).
import type { TablaCruda } from '@/app/lib/anexos-detectar';
import type { ItemCosteoPrecio } from '@/app/lib/motor-comercial';
import { esCandidatoDePrecioUnitario } from '@/app/lib/anexos-precios-columnas';

export interface RellenoProductoTecnico { paraId: string; indiceGlobal: number; valor: string; etiqueta: string }

const sinTildes = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim().toLowerCase();
const RE_COL_PRODUCTO = /^(?:producto|productos|articulo|articulos|bien|bienes|item|items)$/;
const RE_COL_ESPECIFICACION = /^(?:especificacion(?:es)?(?: tecnicas?)?|caracteristicas?(?: tecnicas?)?|descripcion tecnica|detalle tecnico)$/;
const RE_COL_CANTIDAD = /^cantidad(?:es)?$/;

/**
 * El nombre del producto como se escribe en el papel. El costeo guarda «Nombre - Modelo», y a veces
 * el modelo ya viene dentro del nombre («Panel Solar Enertik Policristalino 120W - Enertik
 * Policristalino 120W»): ahí se deja solo la primera parte.
 */
export function nombreDeProductoParaAnexo(descripcion: string): string {
  const d = descripcion.replace(/\s+/g, ' ').trim();
  const palabras = (s: string) => sinTildes(s).split(/[\s|]+/).filter(Boolean);
  // De izquierda a derecha: el primer « - » cuyo resto repite palabras que ya estaban antes es el
  // «- Modelo» agregado por el costeo (el nombre mismo puede traer « - » propios: «… 24 peldaños -
  // 7.2m - Fibra de Vidrio 24 peldaños - 7.2m»).
  for (let desde = d.indexOf(' - '); desde > 0; desde = d.indexOf(' - ', desde + 3)) {
    const antes = d.slice(0, desde).trim();
    const despues = d.slice(desde + 3).trim();
    const yaDichas = new Set(palabras(antes));
    if (despues && palabras(despues).every(w => yaDichas.has(w))) return antes.replace(/\s*\|\s*/g, ' ');
  }
  return d.replace(/\s*\|\s*/g, ' ');
}

export function resolverTablaProductosEnBlanco(tablasCrudo: TablaCruda[], items: ItemCosteoPrecio[]): RellenoProductoTecnico[] {
  if (!items.length) return [];
  const out: RellenoProductoTecnico[] = [];
  for (const t of tablasCrudo) {
    if (t.filas.length < 2) continue;
    const header = t.filas[0].celdas.map(c => sinTildes(c.texto));
    if (header.some(h => esCandidatoDePrecioUnitario(`x — ${h}`))) continue;
    const iProducto = header.findIndex(h => RE_COL_PRODUCTO.test(h));
    const iEspecificacion = header.findIndex(h => RE_COL_ESPECIFICACION.test(h));
    const iCantidad = header.findIndex(h => RE_COL_CANTIDAD.test(h));
    // Producto + especificación + cantidad: la forma del anexo técnico. Sin la especificación
    // podría ser cualquier otra tabla de producto y cantidad.
    if (iProducto < 0 || iEspecificacion < 0 || iCantidad < 0) continue;

    const datos = t.filas.slice(1);
    if (datos.some(f => f.celdas.length !== header.length || f.celdas.some(c => c.texto.trim() !== '' || c.indiceGlobal == null || !c.ultimoParaId))) continue;
    if (datos.length < items.length) continue;

    items.forEach((item, k) => {
      const fila = datos[k].celdas;
      const nombre = nombreDeProductoParaAnexo(item.descripcion);
      if (nombre) out.push({ paraId: fila[iProducto].ultimoParaId!, indiceGlobal: fila[iProducto].indiceGlobal!, valor: nombre, etiqueta: 'PRODUCTO' });
      const cantidad = item.cantidad;
      if (cantidad != null && Number.isFinite(cantidad) && cantidad > 0) {
        out.push({ paraId: fila[iCantidad].ultimoParaId!, indiceGlobal: fila[iCantidad].indiceGlobal!, valor: String(cantidad), etiqueta: 'CANTIDAD' });
      }
    });
    break; // una sola tabla por anexo: dos tablas iguales no dicen a cuál va cada producto
  }
  return out;
}
