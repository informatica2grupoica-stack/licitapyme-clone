-- migration-140: adicionales por cotización (06-oct-2026)
--
-- POR QUÉ: una cotización cotiza el producto "pelado" y el resto aparte (caso real 1173418-1-LE26: el horno
-- ROMCO sin quemador, el carro sin bandejas). Comparar solo el precio del producto contra lo costeado daba
-- veredictos falsos ("más barata" cuando con quemador y bandejas era más cara). Cada producto de una cotización
-- puede llevar ADICIONALES (concepto, cantidad por unidad del producto, precio neto unitario).
--
-- INVARIANTE: compras_cotizacion_item.precio_unitario sigue siendo el precio EFECTIVO (producto + adicionales) que
-- leen el cuadro, los escenarios, las aprobaciones y el auditor. `precio_base` guarda el precio del producto solo
-- (NULL = sin adicionales, el base es precio_unitario). Idempotente.

CREATE TABLE IF NOT EXISTS compras_cotizacion_adicional (
  id INT AUTO_INCREMENT PRIMARY KEY,
  negocio_id INT NOT NULL,
  cotizacion_id INT NOT NULL,
  producto_id INT NOT NULL,
  concepto VARCHAR(160) NOT NULL,
  cantidad DECIMAL(12,2) NOT NULL DEFAULT 1,
  precio_unitario DECIMAL(18,2) NOT NULL,
  creado_por INT NULL,
  creado_por_nombre VARCHAR(160) NULL,
  creado_at DATETIME NOT NULL,
  INDEX idx_cot_adic (cotizacion_id, producto_id),
  INDEX idx_cot_adic_negocio (negocio_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

ALTER TABLE compras_cotizacion_item ADD COLUMN precio_base DECIMAL(18,2) NULL;
