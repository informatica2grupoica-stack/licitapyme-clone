-- migration-179: CANTIDAD A COMPRAR distinta de la del costeo, cambiada desde «Compara precios» con observación obligatoria.
-- El costeo dice 30 pero se compran 20: `compras_producto.cantidad` pasa a ser la cantidad a COMPRAR (así el cuadro, la aprobación
-- y la OC la toman sin cambios) y la del costeo queda en `cantidad_costeo`. Mientras `cantidad_motivo` tenga texto, «Sincronizar con
-- costeo» NO pisa `cantidad`: solo actualiza `cantidad_costeo`. Todo NULL = la cantidad es la del costeo (los productos existentes no cambian).
-- Aplicar con scripts/aplicar-migration-179.mjs (local por defecto).
ALTER TABLE compras_producto
  ADD COLUMN cantidad_costeo              DECIMAL(14,3) NULL AFTER cantidad,
  ADD COLUMN cantidad_motivo              VARCHAR(500)  NULL AFTER cantidad_costeo,
  ADD COLUMN cantidad_cambiada_por        INT           NULL AFTER cantidad_motivo,
  ADD COLUMN cantidad_cambiada_por_nombre VARCHAR(150)  NULL AFTER cantidad_cambiada_por,
  ADD COLUMN cantidad_cambiada_at         DATETIME      NULL AFTER cantidad_cambiada_por_nombre;
