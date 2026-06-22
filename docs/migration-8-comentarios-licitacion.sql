-- migration-8-comentarios-licitacion.sql
-- Comentarios por licitación (sección "Comentarios" de la ficha de detalle).
-- Ejecutar en Bluehost → phpMyAdmin → licitapyme → SQL

CREATE TABLE IF NOT EXISTS comentarios_licitacion (
  id                INT AUTO_INCREMENT PRIMARY KEY,
  licitacion_codigo VARCHAR(100) NOT NULL,
  usuario_id        INT NOT NULL,
  comentario        TEXT NOT NULL,
  created_at        TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_comentarios_lic_codigo (licitacion_codigo)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
