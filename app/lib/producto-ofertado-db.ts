// app/lib/producto-ofertado-db.ts
// Escritura de linea_producto_ofertado (migración 79) — separado de producto-ofertado.ts (que es
// puro: solo lee texto y devuelve datos, sin tocar la BD) siguiendo el mismo criterio que
// lineas-oferta.ts.
//
// VARIOS PRODUCTOS POR LÍNEA (migración 82, caso real 2446-240-LE26): una línea real puede juntar
// más de un producto bajo el mismo precio ("Hidrolavadora H300" + "Vacuolavadora DB51 Dimer"). Cada
// uno tiene su PROPIA marca/modelo/foto, así que la clave ya no es solo `item_id`: es
// `(item_id, producto_index)`. Para el caso normal —una línea, un producto— productoIndex siempre
// es 0 y el comportamiento es idéntico al de antes de esta migración.
import pool from '@/app/lib/db';
import { ahoraChileSQL } from '@/app/lib/tz';
import type { ProductoOfertado } from '@/app/lib/producto-ofertado';

/**
 * Guarda lo leído de la ficha, SIN pisar un dato que una persona ya confirmó.
 *
 * `origen='ficha'` y sin `confirmado_por`: es una LECTURA, no una declaración. Si el asistente ya
 * había confirmado manualmente marca/modelo (origen='manual' o confirmado_por no nulo), esta
 * llamada no toca esa fila — subir una ficha nueva no debe revertir en silencio lo que una persona
 * ya validó. Es el mismo criterio de "no pisar trabajo humano" que aplicarPlan() usa en la matriz
 * de cumplimiento y que guardarLineasOfertadas() usa con el checklist.
 *
 * SOLO escribe en `productoIndex` (normalmente 0, el "primer" producto de la línea): la extracción
 * automática lee la ficha completa sin saber a cuál de los N productos de una línea-paquete
 * corresponde cada dato, así que no tiene sentido que intente repartirlo entre varios — el resto
 * de los productos de la línea los completa una persona a mano (ver confirmarProductoOfertado).
 */
export async function guardarProductoLeidoDeFicha(args: {
  itemId: number; negocioId: number; productoIndex: number; producto: ProductoOfertado; fuenteDocumento: string;
  /** URL en R2 de la foto sacada de la ficha (ver ficha-imagen-extraer.ts), o null si no se
   *  encontró/no se pudo extraer — nunca bloquea guardar el resto del producto. */
  imagenUrl?: string | null;
}): Promise<void> {
  const { itemId, negocioId, productoIndex, producto, fuenteDocumento, imagenUrl } = args;
  const hayDato = Object.values(producto).some(v => v != null && String(v).trim() !== '') || !!imagenUrl;
  if (!hayDato) return;

  const [existente] = await pool.query(
    `SELECT confirmado_por FROM linea_producto_ofertado WHERE item_id = ? AND producto_index = ?`, [itemId, productoIndex],
  ) as any;
  if ((existente as any[])[0]?.confirmado_por != null) return;   // una persona ya lo confirmó: no se toca

  await pool.query(
    `INSERT INTO linea_producto_ofertado
       (item_id, producto_index, negocio_id, marca, modelo, fabricante, pais_fabricacion, anio_fabricacion,
        imagen_url, origen, fuente_documento, actualizado_en)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'ficha', ?, ?)
     ON DUPLICATE KEY UPDATE
       marca = COALESCE(VALUES(marca), marca),
       modelo = COALESCE(VALUES(modelo), modelo),
       fabricante = COALESCE(VALUES(fabricante), fabricante),
       pais_fabricacion = COALESCE(VALUES(pais_fabricacion), pais_fabricacion),
       anio_fabricacion = COALESCE(VALUES(anio_fabricacion), anio_fabricacion),
       imagen_url = COALESCE(VALUES(imagen_url), imagen_url),
       -- Si la nueva ficha trae una foto DISTINTA de la que había, la confirmación anterior ya
       -- no aplica a esta imagen — vuelve a quedar pendiente de revisión (ver migration-81). Si
       -- no trajo foto nueva (COALESCE se quedó con la de antes), no se toca.
       imagen_confirmada = CASE
         WHEN VALUES(imagen_url) IS NOT NULL AND VALUES(imagen_url) <> imagen_url THEN 0
         ELSE imagen_confirmada
       END,
       fuente_documento = VALUES(fuente_documento), actualizado_en = VALUES(actualizado_en)`,
    [
      itemId, productoIndex, negocioId, producto.marca, producto.modelo, producto.fabricante,
      producto.paisFabricacion, producto.anioFabricacion, imagenUrl || null,
      fuenteDocumento.slice(0, 300), ahoraChileSQL(),
    ],
  );
}

/**
 * Guarda lo que una PERSONA confirmó o corrigió a mano. A diferencia de guardarProductoLeidoDeFicha,
 * ESTA SÍ pisa lo anterior — es la fuente de la verdad final, la que se imprime en los documentos
 * con confianza. `confirmado_por` queda escrito, que es la señal que respeta la función de arriba
 * para no volver a pisarlo con la próxima ficha que se suba.
 */
export async function confirmarProductoOfertado(args: {
  itemId: number; negocioId: number; productoIndex: number; usuarioId: number;
  marca: string | null; modelo: string | null; fabricante: string | null;
  paisFabricacion: string | null; anioFabricacion: string | null;
}): Promise<void> {
  const { itemId, negocioId, productoIndex, usuarioId, marca, modelo, fabricante, paisFabricacion, anioFabricacion } = args;
  const ahora = ahoraChileSQL();
  await pool.query(
    `INSERT INTO linea_producto_ofertado
       (item_id, producto_index, negocio_id, marca, modelo, fabricante, pais_fabricacion, anio_fabricacion,
        origen, confirmado_por, confirmado_en, actualizado_en)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'manual', ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       marca = VALUES(marca), modelo = VALUES(modelo), fabricante = VALUES(fabricante),
       pais_fabricacion = VALUES(pais_fabricacion), anio_fabricacion = VALUES(anio_fabricacion),
       origen = 'manual', confirmado_por = VALUES(confirmado_por),
       confirmado_en = VALUES(confirmado_en), actualizado_en = VALUES(actualizado_en)`,
    [itemId, productoIndex, negocioId, marca, modelo, fabricante, paisFabricacion, anioFabricacion, usuarioId, ahora, ahora],
  );
}

/**
 * Confirma (o reemplaza) la foto del producto — decisión INDEPENDIENTE de confirmar marca/modelo
 * (ver migration-81): una persona puede revisar la foto sin haber tocado el resto, o viceversa.
 * `imagenUrl` es la que queda en firme: la ya extraída (si solo se está confirmando que está bien)
 * o una recién subida a mano (ver .../[itemId]/producto-imagen/route.ts).
 */
export async function confirmarImagenProducto(args: {
  itemId: number; negocioId: number; productoIndex: number; imagenUrl: string,
}): Promise<void> {
  const { itemId, negocioId, productoIndex, imagenUrl } = args;
  await pool.query(
    `INSERT INTO linea_producto_ofertado (item_id, producto_index, negocio_id, imagen_url, imagen_confirmada, origen, actualizado_en)
     VALUES (?, ?, ?, ?, 1, 'manual', ?)
     ON DUPLICATE KEY UPDATE
       imagen_url = VALUES(imagen_url), imagen_confirmada = 1, actualizado_en = VALUES(actualizado_en)`,
    [itemId, productoIndex, negocioId, imagenUrl, ahoraChileSQL()],
  );
}

/** Descarta la foto actual (la extracción trajo la equivocada y no hay con qué reemplazarla). */
export async function quitarImagenProducto(itemId: number, productoIndex: number): Promise<void> {
  await pool.query(
    `UPDATE linea_producto_ofertado SET imagen_url = NULL, imagen_confirmada = 0, actualizado_en = ?
      WHERE item_id = ? AND producto_index = ?`,
    [ahoraChileSQL(), itemId, productoIndex],
  );
}

export interface ProductoOfertadoGuardado extends ProductoOfertado {
  garantiaMeses: number | null;
  imagenUrl: string | null;
  imagenConfirmada: boolean;
  origen: 'ficha' | 'manual';
  fuenteDocumento: string | null;
  confirmadoPor: number | null;
}

/** Un producto de la línea (0..N-1) — igual haya dato guardado o no (ver leerProductosDeLinea). */
export interface ProductoDeLinea {
  index: number;
  /** Nombre de ESTE producto dentro del paquete, del informe (productosCrudosDeLinea) — null si no
   *  se pudo determinar (línea sin informe o sin línea_numero). La pantalla usa el título de la
   *  línea completa en ese caso, igual que antes de esta migración. */
  nombre: string | null;
  ofertado: ProductoOfertadoGuardado | null;
}

/** Un solo producto — usado internamente por leerProductosDeLinea() y donde no hace falta la lista completa. */
export async function leerProductoOfertado(itemId: number, productoIndex: number): Promise<ProductoOfertadoGuardado | null> {
  const [rows] = await pool.query(
    `SELECT marca, modelo, fabricante, pais_fabricacion, anio_fabricacion, garantia_meses,
            imagen_url, imagen_confirmada, origen, fuente_documento, confirmado_por
       FROM linea_producto_ofertado WHERE item_id = ? AND producto_index = ?`, [itemId, productoIndex],
  ) as any;
  const r = (rows as any[])[0];
  if (!r) return null;
  return {
    marca: r.marca, modelo: r.modelo, fabricante: r.fabricante,
    paisFabricacion: r.pais_fabricacion, anioFabricacion: r.anio_fabricacion,
    garantiaMeses: r.garantia_meses, imagenUrl: r.imagen_url ?? null,
    imagenConfirmada: !!r.imagen_confirmada, origen: r.origen,
    fuenteDocumento: r.fuente_documento, confirmadoPor: r.confirmado_por,
  };
}

/**
 * TODOS los productos de una línea, en orden — el shape que consumen la pantalla del Auditor y
 * ficha-tecnica/route.ts. `nombresCrudos` viene de productosCrudosDeLinea(informe, linea) (el
 * llamador resuelve el informe; este módulo no lo necesita conocer). Si el informe no tiene esa
 * línea (línea manual, informe viejo, etc.) se devuelve UN producto sin nombre — mismo
 * comportamiento que antes de existir varios productos por línea.
 */
export async function leerProductosDeLinea(itemId: number, nombresCrudos: string[]): Promise<ProductoDeLinea[]> {
  const [rows] = await pool.query(
    `SELECT producto_index, marca, modelo, fabricante, pais_fabricacion, anio_fabricacion, garantia_meses,
            imagen_url, imagen_confirmada, origen, fuente_documento, confirmado_por
       FROM linea_producto_ofertado WHERE item_id = ? ORDER BY producto_index`, [itemId],
  ) as any;
  const porIndice = new Map<number, any>((rows as any[]).map(r => [r.producto_index, r]));
  const n = Math.max(1, nombresCrudos.length);
  return Array.from({ length: n }, (_, index) => {
    const r = porIndice.get(index);
    const ofertado: ProductoOfertadoGuardado | null = r ? {
      marca: r.marca, modelo: r.modelo, fabricante: r.fabricante,
      paisFabricacion: r.pais_fabricacion, anioFabricacion: r.anio_fabricacion,
      garantiaMeses: r.garantia_meses, imagenUrl: r.imagen_url ?? null,
      imagenConfirmada: !!r.imagen_confirmada, origen: r.origen,
      fuenteDocumento: r.fuente_documento, confirmadoPor: r.confirmado_por,
    } : null;
    return { index, nombre: nombresCrudos[index] ?? null, ofertado };
  });
}
