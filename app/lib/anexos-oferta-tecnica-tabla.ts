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
import type { FichaLineaAuditor } from '@/app/lib/anexos-auditor-fuente';
import { sinMarcaNiModelo } from '@/app/lib/ficha-tecnica';
import { normalizarValorParaDocumento } from '@/app/lib/valor-ofertado-normalizar';

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

const tokens = (s: string) => new Set(sinTildes(s).split(/[^a-z0-9]+/).filter(t => t.length > 2));

/**
 * La ficha APROBADA del Auditor que corresponde a un producto del costeo: por parecido claro del
 * nombre (60 % de las palabras del más corto y sin empate). Sin opción aprobada o sin parecido
 * claro, null — la especificación queda en blanco para el equipo, nunca se adivina.
 */
export function fichaDeProducto(nombre: string, fichas: FichaLineaAuditor[] | undefined): FichaLineaAuditor | null {
  const tn = tokens(nombre);
  if (!fichas?.length || !tn.size) return null;
  const puntaje = fichas.filter(f => f.opcion).map(f => {
    const tf = tokens(f.producto);
    const comunes = [...tn].filter(x => tf.has(x)).length;
    return { f, s: comunes / Math.max(1, Math.min(tn.size, tf.size)) };
  }).sort((a, b) => b.s - a.s);
  return puntaje[0] && puntaje[0].s >= 0.6 && (!puntaje[1] || puntaje[1].s < puntaje[0].s) ? puntaje[0].f : null;
}

/**
 * Lo que se escribe en la columna ESPECIFICACIÓN: SOLO lo que nosotros ofertamos (la columna derecha del Auditor), no el
 * texto del requisito de las bases (regla del dueño, 09-nov-2026). Sin marca ni modelo: nuestra ficha no los nombra para no
 * amarrarnos a entregar ese equipo (ver sinMarcaNiModelo). Solo requisitos cerrados (CUMPLE o confirmados a mano con su
 * valor); uno sin valor ofertado no se inventa.
 */
export function textoEspecificacionDeFicha(f: FichaLineaAuditor): string | null {
  const o = f.opcion;
  if (!o) return null;
  const partes: string[] = [];
  for (const r of f.requisitos) {
    if (r.estado !== 'CUMPLE' || !r.ofertado?.trim()) continue;
    // Al quitar la marca o el modelo puede quedar su rótulo suelto («SmartSolar, marca Victron, 100V» → «marca, 100V»): se descarta.
    const v = sinMarcaNiModelo(normalizarValorParaDocumento(r.ofertado), { marca: o.marca, modelo: o.modelo })
      .split(/\s*,\s+/).filter(seg => !/^(?:marca|modelo|versi[oó]n|fabricante)$/i.test(seg.trim())).join(', ')
      .replace(/[.\s]+$/, '');
    if (v && !partes.includes(v)) partes.push(v);
  }
  return partes.length ? partes.join('. ') + '.' : null;
}

export function resolverTablaProductosEnBlanco(tablasCrudo: TablaCruda[], items: ItemCosteoPrecio[], fichas?: FichaLineaAuditor[]): RellenoProductoTecnico[] {
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
      // La especificación SOLO sale de la ficha aprobada del Auditor (nunca del costeo ni inventada).
      const ficha = fichaDeProducto(nombre || item.descripcion, fichas);
      const especificacion = ficha ? textoEspecificacionDeFicha(ficha) : null;
      if (especificacion) out.push({ paraId: fila[iEspecificacion].ultimoParaId!, indiceGlobal: fila[iEspecificacion].indiceGlobal!, valor: especificacion, etiqueta: 'ESPECIFICACIÓN' });
      const cantidad = item.cantidad;
      if (cantidad != null && Number.isFinite(cantidad) && cantidad > 0) {
        out.push({ paraId: fila[iCantidad].ultimoParaId!, indiceGlobal: fila[iCantidad].indiceGlobal!, valor: String(cantidad), etiqueta: 'CANTIDAD' });
      }
    });
    break; // una sola tabla por anexo: dos tablas iguales no dicen a cuál va cada producto
  }
  return out;
}
