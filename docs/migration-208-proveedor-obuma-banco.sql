-- migration-208: banco del proveedor leído de Obuma (pedido del dueño, 25-nov-2026).
--   Obuma guarda en el proveedor el ID del banco (`proveedor_banco_cuenta`); su nombre sale de `pg-bancos.list.json`.
--   Son columnas de SOLO LECTURA (se pisan en cada sincronización); `banco` / `numero_cuenta` siguen siendo los de Licitank.
ALTER TABLE compras_proveedor
  ADD COLUMN obuma_banco_id VARCHAR(20) NULL AFTER obuma_tiene_cuenta_bancaria,
  ADD COLUMN obuma_banco VARCHAR(150) NULL AFTER obuma_banco_id;
