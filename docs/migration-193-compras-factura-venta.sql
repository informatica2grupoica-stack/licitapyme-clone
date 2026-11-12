-- migration-193: factura de venta al cliente final (la que cierra el proyecto). Una fila por archivo subido.
CREATE TABLE IF NOT EXISTS compras_factura_venta (
  id                INT AUTO_INCREMENT PRIMARY KEY,
  negocio_id        INT          NOT NULL,
  archivo_url       VARCHAR(600) NOT NULL,
  archivo_nombre    VARCHAR(255) NOT NULL,
  numero            VARCHAR(40)      NULL,
  emitida_at        DATE             NULL,
  pagada_at         DATE             NULL,
  subida_por        INT              NULL,
  subida_por_nombre VARCHAR(160)     NULL,
  created_at        DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_factura_venta_negocio (negocio_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
