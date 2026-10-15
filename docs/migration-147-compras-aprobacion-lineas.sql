-- migration-147: aprobación POR PRODUCTO de la compra (14-oct-2026). El jefe de ventas va aprobando (o rechazando) cada
-- producto de la tabla «Qué se va a aprobar»; cuando todos están aprobados, aprueba la compra completa con un botón.
-- La aprobación de la compra (compras_aprobacion, tipo COMPRA) no cambia. Idempotente.
CREATE TABLE IF NOT EXISTS compras_aprobacion_linea (
  negocio_id          INT          NOT NULL,
  producto_id         INT          NOT NULL,
  estado              VARCHAR(16)  NOT NULL,           -- APROBADA | RECHAZADA
  comentario          TEXT         NULL,
  resuelto_por        INT          NULL,
  resuelto_por_nombre VARCHAR(160) NULL,
  resuelto_at         DATETIME     NOT NULL,
  PRIMARY KEY (negocio_id, producto_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
