-- migration-181: tipo del SERVICIO (migration-177): 'FLETE' o 'ADICIONAL' (grúa, armado, instalación…). Pedido del dueño 05-nov-2026:
-- en «Compra y logística → Gastos extra» se agrega un gasto con SKU y OC eligiendo si es flete o adicional; va a aprobación de ese ítem
-- (compra rápida) sin tocar el costeo ni la aprobación de la compra completa. NULL = servicio anterior a esta migración (se trata como flete).
-- Aplicar con scripts/aplicar-migration-181.mjs (local por defecto).
ALTER TABLE compras_producto
  ADD COLUMN servicio_tipo VARCHAR(20) NULL AFTER es_servicio;
