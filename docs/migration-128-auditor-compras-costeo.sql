-- migration-128-auditor-compras-costeo.sql
-- AUDITOR DE COMPRAS · VERIFICADOR DE COTIZACIONES (PROMPT 5 v1.2, 25-sep-2026).
-- Audita cada línea de la TABLA_DE_COSTEO (negocio_costeo_editor): que el costo tenga un respaldo real
-- (link visitado en vivo, cotización, histórico), que sea el mismo producto, la misma unidad, el IVA
-- bien tratado, sin costos ocultos, y ubica el proyecto frente al precio de mercado y al presupuesto.
--
--   compras_auditor_costeo_linea    → el resultado por línea (JSON del modelo + lo que agrega el sistema),
--                                     la justificación de ahorro (V10) y la habilitación (EM / CA).
--   compras_auditor_costeo_captura  → evidencia inmutable: cada link visitado, con fecha, texto y (si se
--                                     pudo) imagen. Nunca se actualiza: cada auditoría agrega capturas.
--   compras_auditor_costeo_proyecto → la posición de precio del proyecto (Parte IX) y la última pasada final.
--
-- fila_id = FilaEditorCosteo.id (clave estable dentro de negocio_costeo_editor.datos_json).
-- Aplicar con `node scripts/aplicar-migration-128.mjs` (idempotente).

CREATE TABLE IF NOT EXISTS compras_auditor_costeo_linea (
  id INT AUTO_INCREMENT PRIMARY KEY,
  negocio_id INT NOT NULL,
  fila_id VARCHAR(40) NOT NULL,
  veredicto VARCHAR(30) NOT NULL,
  n_bloqueos INT NOT NULL DEFAULT 0,
  n_alertas INT NOT NULL DEFAULT 0,
  costo_verificado_neto DECIMAL(18,2) NULL,
  resultado_json LONGTEXT NULL,
  modelo VARCHAR(40) NULL,
  pasada VARCHAR(10) NOT NULL DEFAULT 'linea',
  generado_at DATETIME NOT NULL,
  generado_por INT NULL,
  generado_por_nombre VARCHAR(160) NULL,
  justificacion_ahorro TEXT NULL,
  justificacion_por_nombre VARCHAR(160) NULL,
  justificacion_at DATETIME NULL,
  habilitado_por INT NULL,
  habilitado_por_nombre VARCHAR(160) NULL,
  habilitado_nivel VARCHAR(4) NULL,
  habilitado_motivo TEXT NULL,
  habilitado_at DATETIME NULL,
  UNIQUE KEY uk_auditor_costeo_linea (negocio_id, fila_id),
  INDEX idx_auditor_costeo_linea_negocio (negocio_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

CREATE TABLE IF NOT EXISTS compras_auditor_costeo_captura (
  id INT AUTO_INCREMENT PRIMARY KEY,
  negocio_id INT NOT NULL,
  fila_id VARCHAR(40) NOT NULL,
  url VARCHAR(1000) NOT NULL,
  capturado_at DATETIME NOT NULL,
  http_status INT NULL,
  estado_link VARCHAR(24) NOT NULL,
  titulo VARCHAR(400) NULL,
  texto MEDIUMTEXT NULL,
  hash_texto VARCHAR(64) NULL,
  imagen MEDIUMBLOB NULL,
  INDEX idx_auditor_costeo_captura (negocio_id, fila_id, capturado_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

CREATE TABLE IF NOT EXISTS compras_auditor_costeo_proyecto (
  negocio_id INT NOT NULL PRIMARY KEY,
  resultado_json LONGTEXT NULL,
  pasada_final_json LONGTEXT NULL,
  pasada_final_at DATETIME NULL,
  updated_at DATETIME NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
