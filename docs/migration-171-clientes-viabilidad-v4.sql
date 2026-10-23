-- migration-171-clientes-viabilidad-v4.sql
-- Viabilidad COMPLETA (copia del motor v4) de las empresas-cliente: el informe por empresa y licitación. Tabla NUEVA; no toca tablas de ICA.
CREATE TABLE IF NOT EXISTS cliente_viabilidad_v4 (
  id                INT AUTO_INCREMENT PRIMARY KEY,
  cliente_id        INT NOT NULL,
  licitacion_codigo VARCHAR(100) NOT NULL,
  informe           LONGTEXT NOT NULL,
  nivel_atractivo   VARCHAR(20) NULL,
  nivel_num         INT NULL,
  accion_asistente  VARCHAR(40) NULL,
  modelo            VARCHAR(100) NULL,
  created_by        INT NULL,
  created_at        DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_cliente_viab_v4 (cliente_id, licitacion_codigo),
  INDEX idx_cliente_viab_v4_mes (cliente_id, created_at)
);

-- Análisis en curso (segundo plano + polling), por empresa y licitación.
CREATE TABLE IF NOT EXISTS cliente_viabilidad_jobs (
  cliente_id        INT NOT NULL,
  licitacion_codigo VARCHAR(100) NOT NULL,
  run_id            VARCHAR(40) NOT NULL,
  estado            VARCHAR(12) NOT NULL,
  fase              VARCHAR(30) NULL,
  error             VARCHAR(600) NULL,
  iniciado_at       DATETIME NOT NULL,
  actualizado_at    DATETIME NOT NULL,
  PRIMARY KEY (cliente_id, licitacion_codigo)
);
