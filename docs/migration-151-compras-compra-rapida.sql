-- migration-151: COMPRA RÁPIDA por producto (16-oct-2026). El encargado manda un producto a comprar en una tienda (sin cotización ni ficha)
-- y el jefe de ventas lo aprueba ANTES de comprar. Aprobado, ese producto puede crear SKU / proveedor / OC sin esperar las
-- compuertas 1 y 2 de toda la compra. Tabla aparte de compras_aprobacion_linea para no mezclar con la aprobación de la compra. Idempotente.
CREATE TABLE IF NOT EXISTS compras_compra_rapida (
  negocio_id             INT          NOT NULL,
  producto_id            INT          NOT NULL,
  estado                 VARCHAR(16)  NOT NULL,           -- PENDIENTE | APROBADA | RECHAZADA
  proveedor_nombre       VARCHAR(200) NULL,
  proveedor_rut          VARCHAR(20)  NULL,
  precio_unitario        DECIMAL(14,2) NULL,
  link                   VARCHAR(500) NULL,
  motivo                 TEXT         NULL,               -- por qué se compra así (lo escribe el encargado)
  comentario             TEXT         NULL,               -- motivo del rechazo (lo escribe el jefe)
  solicitado_por         INT          NULL,
  solicitado_por_nombre  VARCHAR(160) NULL,
  solicitado_at          DATETIME     NOT NULL,
  resuelto_por           INT          NULL,
  resuelto_por_nombre    VARCHAR(160) NULL,
  resuelto_at            DATETIME     NULL,
  PRIMARY KEY (negocio_id, producto_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
