-- migration-7-descarga-cola.sql
-- Cola de descargas automáticas de documentos de Mercado Público (radar).
-- Ejecutar en Bluehost → phpMyAdmin → licitapyme → SQL

CREATE TABLE IF NOT EXISTS documentos_descarga_cola (
  id                     INT AUTO_INCREMENT PRIMARY KEY,
  licitacion_codigo      VARCHAR(100) NOT NULL,
  estado                 ENUM('pendiente','procesando','completado','agotado') NOT NULL DEFAULT 'pendiente',
  intentos               INT NOT NULL DEFAULT 0,
  max_intentos           INT NOT NULL DEFAULT 5,
  documentos_encontrados INT NOT NULL DEFAULT 0,
  ultimo_error           TEXT,
  proxima_ejecucion      TIMESTAMP NULL,
  created_at             TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at             TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY unique_cola_codigo (licitacion_codigo),
  INDEX idx_cola_estado (estado, proxima_ejecucion)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
