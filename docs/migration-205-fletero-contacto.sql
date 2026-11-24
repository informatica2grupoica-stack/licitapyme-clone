-- migration-205: datos de contacto del fletero + separación por cliente (pedido del dueño, 24-nov-2026).
--   contacto_nombre / telefono / correo / comuna: se llenan al importar desde Obuma/Proveedores o a mano.
--   cliente_id: el catálogo de fleteros pasa a ser por cliente (multiempresa). Los ya cargados quedan con cliente 1 (ICA).
ALTER TABLE compras_fletero
  ADD COLUMN cliente_id       INT          NOT NULL DEFAULT 1,
  ADD COLUMN contacto_nombre  VARCHAR(160) NULL,
  ADD COLUMN telefono         VARCHAR(40)  NULL,
  ADD COLUMN correo           VARCHAR(160) NULL,
  ADD COLUMN comuna           VARCHAR(120) NULL,
  ADD INDEX idx_compras_fletero_cliente (cliente_id, activo);
