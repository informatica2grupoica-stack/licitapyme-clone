-- migration-184: «unidades para este negocio» en las líneas de una OC de Obuma (negocio 256 / OC 3811: la OC trae 2 rodillos y solo se vende 1).
-- El costo del negocio descuenta las unidades que no son suyas (quedan como inventario / otro negocio). No toca nada en Obuma.
-- Aplicar con scripts/aplicar-migration-184.mjs (local por defecto; --produccion solo con OK del dueño). Tabla nueva: no cambia datos existentes.
CREATE TABLE IF NOT EXISTS compras_oc_linea_negocio (
  id INT AUTO_INCREMENT PRIMARY KEY,
  cliente_id INT NOT NULL DEFAULT 1,
  negocio_id INT NOT NULL,
  compra_oc_id VARCHAR(30) NOT NULL,
  linea_id VARCHAR(30) NOT NULL,
  cantidad_total DECIMAL(14,3) NOT NULL,
  cantidad_negocio DECIMAL(14,3) NOT NULL,
  nota VARCHAR(300) NULL,
  actor_id INT NULL,
  actor_nombre VARCHAR(120) NULL,
  created_at DATETIME NOT NULL,
  updated_at DATETIME NOT NULL,
  UNIQUE KEY uq_oc_linea_negocio (negocio_id, compra_oc_id, linea_id),
  KEY idx_oc_linea_cliente (cliente_id, negocio_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
