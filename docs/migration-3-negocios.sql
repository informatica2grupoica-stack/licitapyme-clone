-- ============================================================
-- MIGRACIÓN 3: Módulo Negocios (asignación + etiquetas + comentarios)
-- Fecha: 2026-05-27
-- ============================================================

-- 1. ETIQUETAS (líneas de negocio) — creadas por el admin
-- ============================================================
CREATE TABLE IF NOT EXISTS etiquetas (
  id          INT AUTO_INCREMENT PRIMARY KEY,
  nombre      VARCHAR(100) NOT NULL,
  color       VARCHAR(20)  NOT NULL DEFAULT '#3B82F6',
  descripcion TEXT,
  activa      BOOLEAN NOT NULL DEFAULT TRUE,
  created_by  INT NULL,
  created_at  TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY unique_etiqueta (nombre),
  CONSTRAINT fk_etiq_creador FOREIGN KEY (created_by) REFERENCES usuarios(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Etiquetas de ejemplo
INSERT IGNORE INTO etiquetas (nombre, color) VALUES
  ('EQUIPAMIENTO',        '#3B82F6'),
  ('MAQUINARIA',          '#8B5CF6'),
  ('MATERIALES EN GENERAL','#10B981'),
  ('SERVICIOS',           '#F59E0B'),
  ('OBRAS',               '#EF4444'),
  ('TECNOLOGÍA',          '#06B6D4');

-- 2. NEGOCIOS (licitaciones asignadas a usuarios)
-- ============================================================
CREATE TABLE IF NOT EXISTS negocios (
  id                    INT AUTO_INCREMENT PRIMARY KEY,
  licitacion_codigo     VARCHAR(100) NOT NULL,
  licitacion_nombre     TEXT,
  licitacion_organismo  VARCHAR(500),
  licitacion_monto      BIGINT,
  licitacion_cierre     DATETIME,
  licitacion_estado     VARCHAR(100),
  licitacion_tipo       VARCHAR(50),
  licitacion_region     VARCHAR(100),
  licitacion_descripcion TEXT,
  monto_ofertado        BIGINT DEFAULT 0,
  asignado_a            INT NOT NULL,
  asignado_por          INT NULL,
  activo                BOOLEAN NOT NULL DEFAULT TRUE,
  created_at            TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at            TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY unique_negocio (asignado_a, licitacion_codigo),
  INDEX idx_neg_asignado (asignado_a),
  INDEX idx_neg_codigo   (licitacion_codigo),
  CONSTRAINT fk_neg_asignado FOREIGN KEY (asignado_a)  REFERENCES usuarios(id) ON DELETE CASCADE,
  CONSTRAINT fk_neg_admin    FOREIGN KEY (asignado_por) REFERENCES usuarios(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 3. NEGOCIOS_ETIQUETAS (relación M:N — una licitación puede tener varias líneas de negocio)
-- ============================================================
CREATE TABLE IF NOT EXISTS negocios_etiquetas (
  negocio_id  INT NOT NULL,
  etiqueta_id INT NOT NULL,
  PRIMARY KEY (negocio_id, etiqueta_id),
  CONSTRAINT fk_ne_negocio  FOREIGN KEY (negocio_id)  REFERENCES negocios(id)  ON DELETE CASCADE,
  CONSTRAINT fk_ne_etiqueta FOREIGN KEY (etiqueta_id) REFERENCES etiquetas(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 4. COMENTARIOS POR NEGOCIO (hilo colaborativo)
-- ============================================================
CREATE TABLE IF NOT EXISTS comentarios_negocio (
  id          INT AUTO_INCREMENT PRIMARY KEY,
  negocio_id  INT NOT NULL,
  usuario_id  INT NOT NULL,
  etiqueta_id INT NULL,
  comentario  TEXT NOT NULL,
  created_at  TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_com_negocio (negocio_id),
  CONSTRAINT fk_com_negocio  FOREIGN KEY (negocio_id)  REFERENCES negocios(id)  ON DELETE CASCADE,
  CONSTRAINT fk_com_usuario  FOREIGN KEY (usuario_id)  REFERENCES usuarios(id)  ON DELETE CASCADE,
  CONSTRAINT fk_com_etiqueta FOREIGN KEY (etiqueta_id) REFERENCES etiquetas(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
