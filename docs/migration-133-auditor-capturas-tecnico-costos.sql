-- migration-133-auditor-capturas-tecnico-costos.sql
-- AUDITOR unificado (29-sep-2026) — tablas que faltaban según docs/ESPECIFICACION_AUDITOR_v1.md y
-- docs/NOTA_PROGRAMADOR_Unificacion_AUDITOR.md §6:
--
--   auditor_captura              → S1 "visitar URL": captura FECHADA e inmutable (texto + imagen) de cada link de una
--                                  opción. Una captura no se edita; cada visita agrega la suya (spec §3.2, Prompt 5 §0.3).
--   auditor_verificacion_tecnica → salida del verificador técnico (Prompt 4 v2.0) por opción: JSON del modelo + el estado
--                                  técnico calculado por código. Una fila por corrida (historial, no se pisa).
--   auditor_costo_asociado       → compromisos de las bases con costo (capacitación, instalación, despacho…): los detecta el
--                                  verificador técnico o los agrega el asistente; los estima el asistente SIN respaldo,
--                                  no llevan margen y solo suben el costo (spec §8.3). Anular exige comentario.
--   auditor_linea_estado         → NO OFERTADA por línea, con motivo obligatorio (spec §11.4).
--
-- Aplicar con `node scripts/aplicar-migration-133.mjs` (idempotente: CREATE TABLE IF NOT EXISTS).

CREATE TABLE IF NOT EXISTS auditor_captura (
  id INT AUTO_INCREMENT PRIMARY KEY,
  negocio_id INT NOT NULL,
  opcion_id INT NULL,
  respaldo_id INT NULL,
  url VARCHAR(1000) NOT NULL,
  url_final VARCHAR(1000) NULL,
  estado_link ENUM('activo','caido','redirige','login','precio_variable_region') NOT NULL,
  http_status INT NULL,
  titulo VARCHAR(400) NULL,
  texto MEDIUMTEXT NULL,
  hash_texto CHAR(64) NULL,
  imagen MEDIUMBLOB NULL,
  metodo VARCHAR(12) NULL,
  origen VARCHAR(20) NOT NULL DEFAULT 'lectura',
  capturado_at DATETIME NOT NULL,
  INDEX idx_auditor_captura_opcion (opcion_id),
  INDEX idx_auditor_captura_negocio (negocio_id),
  INDEX idx_auditor_captura_respaldo (respaldo_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

CREATE TABLE IF NOT EXISTS auditor_verificacion_tecnica (
  id INT AUTO_INCREMENT PRIMARY KEY,
  negocio_id INT NOT NULL,
  opcion_id INT NOT NULL,
  pasada ENUM('L1','L2') NOT NULL DEFAULT 'L1',
  resultado_json LONGTEXT NOT NULL,
  estado_tecnico VARCHAR(30) NULL,
  motor VARCHAR(60) NULL,
  version_prompt VARCHAR(12) NOT NULL DEFAULT 'v2.0',
  error VARCHAR(500) NULL,
  creado_por INT NULL,
  creado_at DATETIME NOT NULL,
  INDEX idx_auditor_vt_opcion (opcion_id, id),
  INDEX idx_auditor_vt_negocio (negocio_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

CREATE TABLE IF NOT EXISTS auditor_costo_asociado (
  id INT AUTO_INCREMENT PRIMARY KEY,
  negocio_id INT NOT NULL,
  fila_id VARCHAR(40) NULL,
  opcion_id INT NULL,
  materia VARCHAR(40) NOT NULL DEFAULT 'otro',
  exige_base_literal TEXT NULL,
  fuente_bases VARCHAR(300) NULL,
  cuantificacion VARCHAR(300) NULL,
  criticidad VARCHAR(20) NULL,
  monto_estimado DECIMAL(14,2) NULL,
  origen VARCHAR(12) NOT NULL DEFAULT 'tecnico',
  anulado TINYINT(1) NOT NULL DEFAULT 0,
  comentario_anulacion VARCHAR(500) NULL,
  creado_at DATETIME NOT NULL,
  actualizado_por INT NULL,
  actualizado_por_nombre VARCHAR(160) NULL,
  actualizado_at DATETIME NOT NULL,
  INDEX idx_auditor_costo_asoc_negocio (negocio_id, anulado)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

CREATE TABLE IF NOT EXISTS auditor_linea_estado (
  id INT AUTO_INCREMENT PRIMARY KEY,
  negocio_id INT NOT NULL,
  fila_id VARCHAR(40) NOT NULL,
  no_ofertada TINYINT(1) NOT NULL DEFAULT 0,
  motivo VARCHAR(500) NULL,
  actualizado_por INT NULL,
  actualizado_por_nombre VARCHAR(160) NULL,
  actualizado_at DATETIME NOT NULL,
  UNIQUE KEY uk_auditor_linea_estado (negocio_id, fila_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
