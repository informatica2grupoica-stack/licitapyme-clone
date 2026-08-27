// app/lib/producto-ofertado-db.ts
// Escritura de linea_producto_ofertado (migración 79) — separado de producto-ofertado.ts (que es
// puro: solo lee texto y devuelve datos, sin tocar la BD) siguiendo el mismo criterio que
// lineas-oferta.ts.
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
 */
export async function guardarProductoLeidoDeFicha(args: {
  itemId: number; negocioId: number; producto: ProductoOfertado; fuenteDocumento: string;
}): Promise<void> {
  const { itemId, negocioId, producto, fuenteDocumento } = args;
  const hayDato = Object.values(producto).some(v => v != null && String(v).trim() !== '');
  if (!hayDato) return;

  const [existente] = await pool.query(
    `SELECT confirmado_por FROM linea_producto_ofertado WHERE item_id = ?`, [itemId],
  ) as any;
  if ((existente as any[])[0]?.confirmado_por != null) return;   // una persona ya lo confirmó: no se toca

  await pool.query(
    `INSERT INTO linea_producto_ofertado
       (item_id, negocio_id, marca, modelo, fabricante, pais_fabricacion, anio_fabricacion,
        origen, fuente_documento, actualizado_en)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'ficha', ?, ?)
     ON DUPLICATE KEY UPDATE
       marca = COALESCE(VALUES(marca), marca),
       modelo = COALESCE(VALUES(modelo), modelo),
       fabricante = COALESCE(VALUES(fabricante), fabricante),
       pais_fabricacion = COALESCE(VALUES(pais_fabricacion), pais_fabricacion),
       anio_fabricacion = COALESCE(VALUES(anio_fabricacion), anio_fabricacion),
       fuente_documento = VALUES(fuente_documento), actualizado_en = VALUES(actualizado_en)`,
    [
      itemId, negocioId, producto.marca, producto.modelo, producto.fabricante,
      producto.paisFabricacion, producto.anioFabricacion, fuenteDocumento.slice(0, 300),
      ahoraChileSQL(),
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
  itemId: number; negocioId: number; usuarioId: number;
  marca: string | null; modelo: string | null; fabricante: string | null;
  paisFabricacion: string | null; anioFabricacion: string | null;
}): Promise<void> {
  const { itemId, negocioId, usuarioId, marca, modelo, fabricante, paisFabricacion, anioFabricacion } = args;
  const ahora = ahoraChileSQL();
  await pool.query(
    `INSERT INTO linea_producto_ofertado
       (item_id, negocio_id, marca, modelo, fabricante, pais_fabricacion, anio_fabricacion,
        origen, confirmado_por, confirmado_en, actualizado_en)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'manual', ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       marca = VALUES(marca), modelo = VALUES(modelo), fabricante = VALUES(fabricante),
       pais_fabricacion = VALUES(pais_fabricacion), anio_fabricacion = VALUES(anio_fabricacion),
       origen = 'manual', confirmado_por = VALUES(confirmado_por),
       confirmado_en = VALUES(confirmado_en), actualizado_en = VALUES(actualizado_en)`,
    [itemId, negocioId, marca, modelo, fabricante, paisFabricacion, anioFabricacion, usuarioId, ahora, ahora],
  );
}

export interface ProductoOfertadoGuardado extends ProductoOfertado {
  garantiaMeses: number | null;
  origen: 'ficha' | 'manual';
  fuenteDocumento: string | null;
  confirmadoPor: number | null;
}

export async function leerProductoOfertado(itemId: number): Promise<ProductoOfertadoGuardado | null> {
  const [rows] = await pool.query(
    `SELECT marca, modelo, fabricante, pais_fabricacion, anio_fabricacion, garantia_meses,
            origen, fuente_documento, confirmado_por
       FROM linea_producto_ofertado WHERE item_id = ?`, [itemId],
  ) as any;
  const r = (rows as any[])[0];
  if (!r) return null;
  return {
    marca: r.marca, modelo: r.modelo, fabricante: r.fabricante,
    paisFabricacion: r.pais_fabricacion, anioFabricacion: r.anio_fabricacion,
    garantiaMeses: r.garantia_meses, origen: r.origen,
    fuenteDocumento: r.fuente_documento, confirmadoPor: r.confirmado_por,
  };
}
