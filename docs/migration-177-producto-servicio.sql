-- migration-177: SERVICIO que se compra con proveedor, cotización, SKU y OC pero no se vende (flete de toda la entrega, armado, instalación).
-- Es un producto más de Compras SIN línea del costeo, SIN precio de venta y SIN producto del que colgar (a diferencia de una «parte»).
-- Columna NOT NULL con DEFAULT 0: los productos existentes no cambian. Aplicar con scripts/aplicar-migration-177.mjs (local por defecto).
ALTER TABLE compras_producto
  ADD COLUMN es_servicio TINYINT(1) NOT NULL DEFAULT 0 AFTER producto_padre_id;
