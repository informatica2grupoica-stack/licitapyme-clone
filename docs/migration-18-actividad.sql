-- migration-18-actividad.sql
-- Historial de actividad de usuarios (Plan A). Lo ve solo el admin en /alertas.
-- Registra acciones: comentarios, cambios de etiqueta/línea de negocio, asignaciones,
-- login, ver licitación, nuevas licitaciones al radar, etc.
-- Ejecutar en Bluehost → phpMyAdmin → ica_licitaciones → SQL

CREATE TABLE IF NOT EXISTS actividad_usuario (
  id           INT AUTO_INCREMENT PRIMARY KEY,
  usuario_id   INT NULL,
  accion       VARCHAR(50)  NOT NULL,   -- comentario_licitacion | comentario_negocio | cambio_etiqueta | asignacion | login | ver_licitacion | radar_nuevas ...
  entidad_tipo VARCHAR(30)  NULL,       -- licitacion | negocio | radar
  entidad_id   VARCHAR(100) NULL,       -- código de licitación o id de negocio
  descripcion  VARCHAR(500) NULL,       -- texto legible para el timeline
  metadata     JSON         NULL,       -- datos extra (etiquetas, monto, etc.)
  created_at   TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_act_usuario (usuario_id),
  INDEX idx_act_created (created_at),
  INDEX idx_act_accion  (accion),
  CONSTRAINT fk_act_usuario FOREIGN KEY (usuario_id) REFERENCES usuarios(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
