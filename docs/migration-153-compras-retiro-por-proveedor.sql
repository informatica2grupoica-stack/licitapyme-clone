-- migration-153: modalidad de retiro POR PROVEEDOR (cada proveedor está en un lugar distinto).
-- La columna compras_asignacion.modalidad_retiro sigue existiendo como resumen del negocio.
CREATE TABLE IF NOT EXISTS compras_retiro_proveedor (
  negocio_id        INT          NOT NULL,
  proveedor_nombre  VARCHAR(300) NOT NULL,
  modalidad         VARCHAR(16)  NOT NULL,  -- INTERNA | EXTERNA
  por_nombre        VARCHAR(160) NULL,
  updated_at        DATETIME     NOT NULL,
  PRIMARY KEY (negocio_id, proveedor_nombre(190))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
