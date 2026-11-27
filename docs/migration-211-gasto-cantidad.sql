-- migration-211: un gasto extra puede llevar cantidad y precio unitario (ej. 155 candados × $2.300). `monto` sigue siendo el TOTAL neto.
-- Columnas NULL: los gastos existentes no cambian. Aplicar con scripts/aplicar-migration-211.mjs (local por defecto).
ALTER TABLE compras_gasto
  ADD COLUMN cantidad DECIMAL(12,2) NULL AFTER monto,
  ADD COLUMN precio_unitario DECIMAL(14,2) NULL AFTER cantidad;
