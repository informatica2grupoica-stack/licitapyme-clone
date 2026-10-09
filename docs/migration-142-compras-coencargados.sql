-- migration-142: varios encargados por negocio en Compras.
-- El encargado principal sigue en compras_asignacion.asignado_a; los demás (co-encargados) viven acá. Tienen el mismo acceso operativo
-- al negocio que el principal. Idempotente.
CREATE TABLE IF NOT EXISTS compras_coencargado (
  negocio_id   INT NOT NULL,
  usuario_id   INT NOT NULL,
  asignado_por INT NULL,
  asignado_at  DATETIME NOT NULL,
  PRIMARY KEY (negocio_id, usuario_id),
  KEY idx_coencargado_usuario (usuario_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
