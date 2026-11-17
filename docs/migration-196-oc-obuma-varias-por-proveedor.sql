-- migration-196: un proveedor puede tener MÁS DE UNA orden de compra emitida desde Licitank en el mismo negocio.
-- 1089 (17-nov-2026): la OC 4062 de SINERGIA TRADE solo llevaba el Set Instrumental; la Mesa auxiliar del mismo proveedor quedó
-- sin OC y no se podía emitir. La pantalla ya separa lo que falta en otra tarjeta, pero esta clave única (migration-106,
-- «una fila por proveedor») hacía fallar el INSERT de la segunda OC DESPUÉS de crearla en Obuma: quedaba en Obuma y no en Licitank.
-- Se cambia por un índice normal. Cuelga de negocios (cliente por JOIN), igual que el resto de compras_orden_compra_obuma.
ALTER TABLE compras_orden_compra_obuma
  DROP INDEX uq_compras_oc_obuma_negocio_proveedor,
  ADD INDEX idx_compras_oc_obuma_negocio_proveedor (negocio_id, proveedor_id);
